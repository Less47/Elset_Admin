import crypto from "node:crypto";
import { AccountingError, safeAccountingError } from "./server-accounting-errors.js";
import { assertInvoiceAccountingOwner } from "./server-accounting-payment-policy.js";
import { readAccountingInvoice } from "./server-accounting-workspace.js";
import { requireWorkspaceAddon } from "./server-workspace-addons.js";
import { pendingQuickBooksCompany } from "./server-quickbooks-oauth.js";
import { digest } from "./server-accounting-crypto.js";
import { findPaymentRequest, paymentAllocation, paymentFingerprint, paymentMatchesWrite, paymentWritePayload, writePayment } from "./server-accounting-providers/quickbooks-payment-writes.js";

const operationType = "payment-write";
const timestamp = () => new Date().toISOString();
const invoiceContent = source => digest(JSON.stringify({ ...source, eligible: undefined, reason: undefined }));
const fail = (message, code = "EXTERNAL_PAYMENT_CONFLICT") => { throw new AccountingError(code, message, 409); };
const retryable = new Set(["PROVIDER_UNAVAILABLE", "RATE_LIMITED", "INTEGRATION_BUSY", "INTEGRATION_ERROR", "PAYMENT_RESPONSE", "EXTERNAL_CHANGING", "OUTBOUND_PAYMENT_PENDING"]);
const paused = new Set(["NOT_CONNECTED", "NEEDS_REAUTHORIZATION", "COMPANY_SWITCH_PENDING", "ADDON_DISABLED", "PAYMENT_PERMISSION_REQUIRED"]);

function assertScope(service, row) {
  const connection = service.store.integration();
  requireWorkspaceAddon(service.db, "quickbooks");
  service.assertEnvironment();
  if (connection?.external_tenant_id !== row.external_tenant_id || connection?.provider_environment !== row.provider_environment
    || row.workspace_id !== service.store.workspaceId) fail("The QuickBooks company or environment changed. This payment was retained for review in its original company.", "TENANT_CHANGED");
  if (pendingQuickBooksCompany(service)) fail("Confirm or cancel the QuickBooks company switch before payment synchronisation resumes.", "COMPANY_SWITCH_PENDING");
  assertInvoiceAccountingOwner(service.db, row.invoice_id, "quickbooks", row.external_tenant_id);
  const state = service.db.prepare("SELECT * FROM integration_invoice_payment_sync WHERE invoice_id=?").get(row.invoice_id);
  if (state && (state.workspace_id !== row.workspace_id || state.provider !== row.provider || state.external_tenant_id !== row.external_tenant_id
    || state.external_invoice_id !== service.store.mapping(row.external_tenant_id, "invoice", row.invoice_id)?.external_entity_id)) {
    fail("This invoice has payment history with another accounting organisation or invoice. Review required.", "PAYMENT_MAPPING_CONFLICT");
  }
}

function mappedPayment(service, row) {
  const mapping = service.db.prepare("SELECT * FROM integration_external_payments WHERE local_payment_id=?").get(row.local_payment_id);
  if (mapping && (mapping.workspace_id !== row.workspace_id || mapping.provider !== row.provider || mapping.external_tenant_id !== row.external_tenant_id
    || mapping.invoice_id !== row.invoice_id)) fail("This payment has history in another accounting company or invoice.", "PAYMENT_MAPPING_CONFLICT");
  return mapping;
}

async function readPayment(provider, context, id) {
  try { return await provider.getPayment(context, id); }
  catch (error) { if (error.code === "EXTERNAL_NOT_FOUND") return null; throw error; }
}

function finishWrite(service, row, request, external) {
  const { db, store } = service, now = timestamp();
  db.transaction(() => {
    assertScope(service, row);
    const invoice = store.mapping(row.external_tenant_id, "invoice", row.invoice_id);
    if (invoice?.external_entity_id !== request.externalInvoiceId) fail("The invoice mapping changed during payment sync.", "PAYMENT_MAPPING_CONFLICT");
    const id = external?.Id || request.payload.Id;
    const amount = external ? paymentAllocation(external, request.externalInvoiceId) : 0;
    const existing = mappedPayment(service, row);
    if (existing && existing.external_payment_id !== id) fail("The payment identity changed during sync.", "PAYMENT_MAPPING_CONFLICT");
    const allocation = db.prepare(`SELECT local_payment_id FROM integration_external_payments WHERE workspace_id=? AND provider='quickbooks'
      AND external_tenant_id=? AND external_payment_id=? AND invoice_id=?`).get(row.workspace_id, row.external_tenant_id, id, row.invoice_id);
    if (allocation && allocation.local_payment_id !== row.local_payment_id) fail("This QuickBooks allocation already belongs to another local payment.", "PAYMENT_MAPPING_CONFLICT");
    db.prepare(`INSERT INTO integration_external_payments(workspace_id,provider,external_tenant_id,external_payment_id,invoice_id,external_invoice_id,
      local_payment_id,amount_cents,payment_date,status,external_updated_at,created_at,updated_at,external_snapshot_json)
      VALUES(?,'quickbooks',?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,provider,external_tenant_id,external_payment_id,invoice_id) DO UPDATE SET
      amount_cents=excluded.amount_cents,payment_date=excluded.payment_date,status=excluded.status,external_updated_at=excluded.external_updated_at,
      updated_at=excluded.updated_at,external_snapshot_json=excluded.external_snapshot_json
      WHERE local_payment_id=excluded.local_payment_id`)
      .run(row.workspace_id, row.external_tenant_id, id, row.invoice_id, request.externalInvoiceId, row.local_payment_id,
        amount, external?.TxnDate || request.date || "", amount ? "ACTIVE" : "REMOVED", external?.MetaData?.LastUpdatedTime || "", existing?.created_at || now, now, external ? JSON.stringify(external) : "");
    if (mappedPayment(service, row)?.external_payment_id !== id) fail("This QuickBooks allocation already belongs to another local payment.", "PAYMENT_MAPPING_CONFLICT");
    // A full Payment mutation also advances the shared receipt's version. Other
    // allocation intents may follow under the same provider lock.
    if (external) db.prepare(`UPDATE integration_external_payments SET external_snapshot_json=? WHERE workspace_id=? AND provider='quickbooks'
      AND external_tenant_id=? AND external_payment_id=?`).run(JSON.stringify(external), row.workspace_id, row.external_tenant_id, id);
    store.finishOperation(row.external_tenant_id, operationType, row.local_payment_id);
    db.prepare(`UPDATE integration_payment_outbox SET completed_revision=?,status=CASE WHEN revision=? THEN 'SYNCED' ELSE 'PENDING' END,
      attempt_count=0,retry_at=0,error_code='',safe_error_message='',updated_at=? WHERE local_payment_id=?`)
      .run(request.revision, request.revision, now, row.local_payment_id);
    store.log(row.external_tenant_id, "invoice-payment", row.invoice_id, `payment-${request.kind}`, "SYNCED", id,
      { message: `ELSET payment ${request.kind === "delete" || !amount ? "removed" : request.kind === "create" ? "created" : "updated"} in QuickBooks.` });
    // Persist a confirmation job too, so shared allocations and invoice status
    // refresh even if the provider's echo webhook is delayed or unavailable.
    const eventId = `elset-payment:${row.workspace_id}:${row.external_tenant_id}:${row.local_payment_id}:${request.revision}`;
    db.prepare(`INSERT OR IGNORE INTO integration_webhook_events(id,provider,external_tenant_id,event_category,event_type,
      external_resource_id,event_sequence,event_date,received_at) VALUES(?,'quickbooks',?,'PAYMENT','ELSET_PAYMENT_CONFIRMED',?,?,?,?)`)
      .run(eventId, row.external_tenant_id, id, eventId, now, now);
  })();
}

async function syncIntent(service, row) {
  const { db, store, provider } = service;
  assertScope(service, row);
  let context = await service.credentials();
  if (service.status().paymentSync !== "CONNECTED") fail("QuickBooks payment permission is required.", "PAYMENT_PERMISSION_REQUIRED");
  let mapping = mappedPayment(service, row);
  const operation = store.operation(row.external_tenant_id, operationType, row.local_payment_id);
  let request = operation?.status === "PENDING" ? JSON.parse(operation.request_json || "null") : null;
  if (operation?.status === "PENDING" && !request) fail("An earlier payment request needs accounting review.", "AMBIGUOUS_WRITE");
  const desired = JSON.parse(row.desired_json);
  if (!desired && !mapping && !request) {
    // Added and removed locally before dispatch: no external receipt to undo.
    db.prepare("UPDATE integration_payment_outbox SET completed_revision=revision,status='SYNCED',safe_error_message='',error_code='' WHERE local_payment_id=? AND revision=?").run(row.local_payment_id, row.revision);
    return;
  }
  if (!store.mapping(row.external_tenant_id, "invoice", row.invoice_id)) await service.syncInvoiceUnlocked(row.job_id);
  assertScope(service, row);
  context = await service.credentials();
  const source = readAccountingInvoice(db, row.job_id);
  const invoiceMapping = store.mapping(row.external_tenant_id, "invoice", row.invoice_id);
  const customer = store.mapping(row.external_tenant_id, "customer", source.customerId);
  if (source.id !== row.invoice_id || !invoiceMapping || !customer) fail("The invoice or customer mapping is missing or changed.", "PAYMENT_MAPPING_CONFLICT");
  if (mapping && mapping.external_invoice_id !== invoiceMapping.external_entity_id) fail("The payment's invoice mapping changed.", "PAYMENT_MAPPING_CONFLICT");
  const organisation = await provider.getOrganisation(context);
  if (organisation.id !== row.external_tenant_id || organisation.currency !== source.currency) fail("The QuickBooks company identity or currency differs.");

  if (request) {
    if (request.externalInvoiceId !== invoiceMapping.external_entity_id || request.customerId !== customer.external_entity_id) fail("The earlier payment request belongs to a different invoice or customer.", "PAYMENT_MAPPING_CONFLICT");
    // Read before replay, even inside the bounded same-request retry window.
    const actual = request.kind === "create" && !mapping
      ? await findPaymentRequest(provider, context, request.payload.PrivateNote, request.customerId)
      : request.kind === "create" ? await readPayment(provider, context, mapping.external_payment_id)
      : await readPayment(provider, context, request.payload.Id);
    if ((request.kind === "delete" && !actual) || (actual && paymentMatchesWrite(actual, request))) {
      finishWrite(service, row, request, actual);
      return;
    }
    if (actual && (request.kind === "create" || paymentFingerprint(actual) !== request.baseline)) {
      // Preserve a discovered create identity even when somebody subsequently
      // edited it. Never repeat a new create to resolve this situation.
      if (request.kind === "create" && !mapping) {
        db.prepare(`INSERT INTO integration_external_payments(workspace_id,provider,external_tenant_id,external_payment_id,invoice_id,
          external_invoice_id,local_payment_id,amount_cents,payment_date,status,created_at,updated_at)
          VALUES(?,'quickbooks',?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(row.workspace_id, row.external_tenant_id, actual.Id, row.invoice_id,
            request.externalInvoiceId, row.local_payment_id, request.payload.TotalAmt * 100, request.payload.TxnDate, timestamp(), timestamp());
      }
      fail("QuickBooks changed after an uncertain payment request. Review required; no replacement payment was created.", "AMBIGUOUS_WRITE");
    }
    if (!actual && request.kind === "create" && mapping) fail("QuickBooks removed an already identified payment. Review required; no replacement was created.", "AMBIGUOUS_WRITE");
    if (!actual && request.kind !== "create") fail("QuickBooks removed the payment during an uncertain update. Review required.");
    if (request.invoiceContent !== invoiceContent(source)) fail("The invoice changed after an uncertain payment request. Review required.", "LOCAL_EDIT_CONFLICT");
    const externalInvoice = await provider.getInvoice(context, invoiceMapping.external_entity_id);
    const amounts = await provider.paymentSnapshot(context, externalInvoice, source, invoiceMapping, customer);
    const allocation = request.kind === "delete" ? 0 : paymentAllocation(request.payload, request.externalInvoiceId);
    if (allocation > amounts.due + (actual ? paymentAllocation(actual, request.externalInvoiceId) : 0)) {
      fail("The QuickBooks invoice balance changed after an uncertain payment request. Review required.", "PAYMENT_OVERPAYMENT");
    }
  } else {
    const externalInvoice = await provider.getInvoice(context, invoiceMapping.external_entity_id);
    const snapshot = await provider.paymentSnapshot(context, externalInvoice, source, invoiceMapping, customer);
    mapping = mappedPayment(service, row);
    const current = mapping ? await readPayment(provider, context, mapping.external_payment_id) : null;
    if (mapping) {
      if (!current || mapping.status !== "ACTIVE") fail("QuickBooks removed or moved this payment. Review required before changing it.");
      if (!mapping.external_snapshot_json) {
        // Forward migration leaves historical rows intact. Their recorded
        // provider modification timestamp can establish the initial baseline.
        if (!mapping.external_updated_at || current.MetaData?.LastUpdatedTime !== mapping.external_updated_at
          || paymentAllocation(current, mapping.external_invoice_id) !== mapping.amount_cents || current.TxnDate !== mapping.payment_date) {
          fail("This older payment has changed in QuickBooks. Review its current allocation before syncing.");
        }
      } else if (paymentFingerprint(current) !== paymentFingerprint(JSON.parse(mapping.external_snapshot_json))) {
        fail("This payment changed in QuickBooks since ELSET last reconciled it. Review both changes before syncing.");
      }
      // paymentSnapshot has verified every current allocation, customer and currency.
      if (!snapshot.payments.some(payment => payment.id === current.Id)) fail("QuickBooks no longer allocates this payment to the invoice.");
    }
    const previousAmount = current ? paymentAllocation(current, invoiceMapping.external_entity_id) : 0;
    if (desired && desired.amountCents > snapshot.due + previousAmount) fail("The payment exceeds the QuickBooks invoice balance. The ELSET payment was saved; accounting review is required.", "PAYMENT_OVERPAYMENT");
    if (current && desired?.dateChanged) {
      const siblings = db.prepare(`SELECT o.desired_json FROM integration_payment_outbox o JOIN integration_external_payments e ON e.local_payment_id=o.local_payment_id
        WHERE e.workspace_id=? AND e.provider='quickbooks' AND e.external_tenant_id=? AND e.external_payment_id=? AND o.local_payment_id<>?
        AND o.revision>o.completed_revision`).all(row.workspace_id, row.external_tenant_id, current.Id, row.local_payment_id);
      if (siblings.some(sibling => { const target = JSON.parse(sibling.desired_json); return target?.dateChanged && target.date !== desired.date; })) {
        fail("Two ELSET allocations request different dates for the same QuickBooks payment. Review the receipt date before syncing.", "LOCAL_PAYMENT_CONFLICT");
      }
    }
    const effective = current && desired?.dateChanged === false ? { ...desired, date: current.TxnDate } : desired;
    request = { ...(current ? paymentWritePayload(current, invoiceMapping.external_entity_id, effective) : {
      kind: "create", payload: { CustomerRef: { value: customer.external_entity_id }, CurrencyRef: { value: source.currency },
        TxnDate: desired.date, TotalAmt: desired.amountCents / 100, ProcessPayment: false,
        PrivateNote: `ELSET payment request ${crypto.randomUUID()}`,
        Line: [{ Amount: desired.amountCents / 100, LinkedTxn: [{ TxnId: invoiceMapping.external_entity_id, TxnType: "Invoice" }] }] },
    }), revision: row.revision, externalInvoiceId: invoiceMapping.external_entity_id, customerId: customer.external_entity_id,
      baseline: current ? paymentFingerprint(current) : "", date: current?.TxnDate || desired?.date || "", invoiceContent: invoiceContent(source) };
    if (current && desired && paymentMatchesWrite(current, request)) {
      finishWrite(service, row, request, current);
      return;
    }
    db.transaction(() => {
      store.prepareOperation(row.external_tenant_id, operationType, row.local_payment_id, request);
      db.prepare("UPDATE integration_operations SET request_json=? WHERE workspace_id=? AND provider='quickbooks' AND external_tenant_id=? AND entity_type=? AND entity_id=?")
        .run(JSON.stringify(request), row.workspace_id, row.external_tenant_id, operationType, row.local_payment_id);
    })();
  }
  assertScope(service, row);
  if (JSON.stringify(readAccountingInvoice(db, row.job_id)) !== JSON.stringify(source)) fail("The ELSET invoice changed while syncing its payment. Review required.", "LOCAL_EDIT_CONFLICT");
  // prepareOperation enforces identical payload, request ID and retry lifetime.
  const key = store.prepareOperation(row.external_tenant_id, operationType, row.local_payment_id, request);
  let external;
  try { external = await writePayment(provider, context, request, key); }
  catch (error) {
    if (["PROVIDER_VALIDATION", "STALE_SYNC_TOKEN"].includes(error.code)) store.finishOperation(row.external_tenant_id, operationType, row.local_payment_id, "REJECTED");
    if (error.code === "STALE_SYNC_TOKEN") fail("QuickBooks changed while the payment was being saved. Review the latest payment before retrying.");
    throw error;
  }
  finishWrite(service, row, request, external);
}

export async function processPaymentOutbox(service, { jobId, manual = false, limit = 20 } = {}) {
  if (service.provider.id !== "quickbooks") return 0;
  const { db } = service;
  const connection = service.store.integration();
  if (service.enabled() && connection?.status === "CONNECTED" && !pendingQuickBooksCompany(service)) {
    db.prepare("UPDATE integration_payment_outbox SET status='PENDING',retry_at=0 WHERE status='PAUSED' AND external_tenant_id=?").run(connection.external_tenant_id);
  }
  const rows = db.prepare(`SELECT * FROM integration_payment_outbox WHERE revision>completed_revision
    AND (? IS NULL OR job_id=?) AND (? OR (status IN ('PENDING','RETRYABLE','PROCESSING') AND retry_at<=?))
    ORDER BY created_at,local_payment_id LIMIT ?`).all(jobId || null, jobId || null, manual ? 1 : 0, Date.now(), limit);
  let firstError;
  for (const row of rows) {
    try {
      if (!service.enabled()) throw new AccountingError("ADDON_DISABLED", "Payment synchronisation is paused until QuickBooks is enabled.", 409);
      await service.work(async () => {
        const current = db.prepare("SELECT * FROM integration_payment_outbox WHERE local_payment_id=?").get(row.local_payment_id);
        if (current.revision !== row.revision || current.completed_revision >= row.revision) return;
        db.prepare("UPDATE integration_payment_outbox SET status='PROCESSING',attempt_count=attempt_count+1 WHERE local_payment_id=? AND revision=?").run(row.local_payment_id, row.revision);
        await syncIntent(service, row);
      });
      const remaining = db.prepare("SELECT * FROM integration_payment_outbox WHERE local_payment_id=?").get(row.local_payment_id);
      if (remaining.revision > remaining.completed_revision && remaining.status === "PENDING" && rows.length < limit) rows.push(remaining);
    } catch (cause) {
      const error = safeAccountingError(cause); firstError ||= error;
      const attempts = row.attempt_count + 1;
      const status = paused.has(error.code) ? "PAUSED" : retryable.has(error.code) && attempts < 8 ? "RETRYABLE" : "REVIEW_REQUIRED";
      const retryAt = status === "RETRYABLE" ? Date.now() + Math.max(error.retryAfter * 1000, Math.min(3_600_000, 30_000 * 2 ** (attempts - 1))) : 0;
      db.prepare(`UPDATE integration_payment_outbox SET status=?,attempt_count=?,retry_at=?,error_code=?,safe_error_message=?,updated_at=?
        WHERE local_payment_id=? AND revision=?`).run(status, attempts, retryAt, error.code, error.message, timestamp(), row.local_payment_id, row.revision);
      service.store.log(row.external_tenant_id, "invoice-payment", row.invoice_id, "payment-outbound", status, "", error);
    }
  }
  if (manual && firstError) throw firstError;
  return rows.length;
}
