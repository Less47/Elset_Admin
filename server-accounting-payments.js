import crypto from "node:crypto";
import { AccountingError, safeAccountingError } from "./server-accounting-errors.js";
import { readAccountingInvoice } from "./server-accounting-workspace.js";
import { requireWorkspaceAddon } from "./server-workspace-addons.js";

const now = () => new Date().toISOString();
const fail = (message, code = "PAYMENT_STATE_CONFLICT") => { throw new AccountingError(code, message, 409); };
const cents = (value) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : NaN;
const snapshot = (invoice) => JSON.stringify(invoice);
const money = (amount) => `$${(amount / 100).toFixed(2)}`;

export function paymentSyncStatus(service, invoiceId) {
  const row = service.db.prepare("SELECT * FROM integration_invoice_payment_sync WHERE invoice_id=? AND workspace_id=? AND provider=?")
    .get(invoiceId, service.store.workspaceId, service.provider.id);
  const history = service.db.prepare(`SELECT operation,status,safe_error_message AS message,created_at AS createdAt
    FROM integration_sync_log WHERE workspace_id=? AND provider=? AND entity_type='invoice-payment' AND entity_id=? ORDER BY id DESC LIMIT 20`)
    .all(service.store.workspaceId, service.provider.id, invoiceId);
  return { status: row?.status || "NOT_SYNCED", managed: Boolean(row?.managed), lastSyncedAt: row?.last_synced_at || null,
    error: row?.safe_error_message || "", history };
}

function saveState(service, source, tenant, mapping, status, error, updatedAt = "") {
  service.db.prepare(`INSERT INTO integration_invoice_payment_sync(invoice_id,workspace_id,provider,external_tenant_id,external_invoice_id,
    managed,status,error_code,safe_error_message,last_synced_at,external_updated_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(invoice_id) DO UPDATE SET status=excluded.status,error_code=excluded.error_code,safe_error_message=excluded.safe_error_message,
    managed=MAX(managed,excluded.managed),last_synced_at=COALESCE(excluded.last_synced_at,last_synced_at),
    external_updated_at=CASE WHEN excluded.status='SYNCED' THEN excluded.external_updated_at ELSE external_updated_at END,updated_at=excluded.updated_at`)
    .run(source.id, service.store.workspaceId, service.provider.id, tenant, mapping.external_entity_id, status === "SYNCED" ? 1 : 0,
      status, error?.code || "", error?.message || "", status === "SYNCED" ? now() : null, updatedAt, now());
}

function validateInvoice(external, source, mapping, contact) {
  if (external.InvoiceID !== mapping.external_entity_id || external.InvoiceNumber !== mapping.external_reference || external.InvoiceNumber !== source.number)
    fail("The mapped Xero invoice identity or number differs. Accounting review required.");
  if (external.Type !== "ACCREC" || external.Contact?.ContactID !== contact?.external_entity_id || external.CurrencyCode !== source.currency)
    fail("The Xero invoice contact, type or currency differs. Accounting review required.");
  if (external.Status === "VOIDED") fail("Xero invoice is voided. Accounting review required; the ELSET invoice is unchanged.");
  if (!["AUTHORISED", "PAID"].includes(external.Status)) fail("Xero invoice status requires accounting review.");
  if (cents(external.Total) !== source.totalCents) fail("Xero invoice total differs from ELSET. Accounting review required.", "TOTALS_MISMATCH");
  if (Number(external.AmountCredited || 0) !== 0 || ["CreditNotes", "Prepayments", "Overpayments"].some((key) => external[key]?.length))
    fail("This Xero invoice has credit or advance-payment allocations. Accounting review required; V2 only reconciles invoice payments.");
  const paid = cents(external.AmountPaid), due = cents(external.AmountDue);
  if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(due) || paid < 0 || due < 0 || paid + due !== source.totalCents
    || (external.Status === "PAID" && due !== 0) || (source.totalCents > 0 && due === 0 && external.Status !== "PAID"))
    fail("Xero invoice payment totals or status are inconsistent. Sync again after accounting review.");
  if (!Array.isArray(external.Payments) && paid !== 0) fail("Xero did not return complete invoice payment references.");
  return { paid, due };
}

export async function reconcileInvoicePayments(service, jobId, { expectedTenant } = {}) {
  const { db, store, provider } = service;
  return service.work(async () => {
    const source = readAccountingInvoice(db, jobId), tenant = store.integration()?.external_tenant_id || "";
    if (expectedTenant && expectedTenant !== tenant) fail("The Xero organisation changed. No payments were applied.", "TENANT_CHANGED");
    const mapping = store.mapping(tenant, "invoice", source.id);
    if (!mapping) fail("Send this invoice to Xero before syncing payments.", "INVOICE_NOT_MAPPED");
    const previous = paymentSyncStatus(service, source.id);
    try {
      if (!source.eligible) fail("This ELSET invoice is no longer eligible for accounting reconciliation.");
      if (store.integration()?.status !== "CONNECTED") await service.credentials();
      if (service.status().paymentSync !== "CONNECTED") throw new AccountingError("PAYMENT_PERMISSION_REQUIRED", "Xero needs additional permission to sync payments.", 409);
      const owned = db.prepare("SELECT * FROM integration_invoice_payment_sync WHERE invoice_id=?").get(source.id);
      if (owned && (owned.external_tenant_id !== tenant || owned.workspace_id !== store.workspaceId || owned.external_invoice_id !== mapping.external_entity_id))
        fail("This invoice has payment history with a different accounting organisation. Review required.");
      if (db.prepare("SELECT 1 FROM payments WHERE invoice_id=? AND source='manual' LIMIT 1").get(source.id))
        fail("Existing manual payments require accounting review. They were retained and no Xero amounts were added.", "MANUAL_PAYMENT_CONFLICT");
      const context = await service.credentials();
      const organisations = await provider.getOrganisations(context.accessToken);
      if (!organisations.some((org) => org.id === tenant)) throw new AccountingError("NEEDS_REAUTHORIZATION", "The selected Xero organisation is no longer connected. Reconnect Xero.", 409);
      const organisation = await provider.getOrganisation(context);
      if (organisation.id !== tenant || organisation.currency !== source.currency) fail("The Xero organisation identity or currency differs. Review required.");
      const external = await provider.getInvoice(context, mapping.external_entity_id);
      const contact = store.mapping(tenant, "customer", source.customerId);
      const amounts = validateInvoice(external, source, mapping, contact);
      const ids = (external.Payments || []).map((payment) => payment.PaymentID);
      if (ids.length > 500 || ids.some((id) => typeof id !== "string" || !id || id.length > 128) || new Set(ids).size !== ids.length)
        fail("Xero payment references require accounting review.");
      const payments = [];
      for (const id of ids) {
        const payment = await provider.getPayment(context, id);
        if (payment.invoiceId !== mapping.external_entity_id) fail("A Xero payment belongs to a different invoice. No payments were applied.");
        if (!["AUTHORISED", "DELETED"].includes(payment.status)) fail("A Xero payment has an unsupported status. Review required.");
        if (payment.status === "DELETED") continue;
        if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date))
          fail("Xero returned incomplete payment amounts or dates.");
        payments.push(payment);
      }
      if (payments.reduce((sum, payment) => sum + payment.amountCents, 0) !== amounts.paid) fail("Xero payment details do not match its invoice totals. No payments were applied.");
      // A payment can change during the detail reads. Never apply a mixed snapshot.
      const confirmed = await provider.getInvoice(context, mapping.external_entity_id);
      if (snapshot(external) !== snapshot(confirmed)) throw new AccountingError("EXTERNAL_CHANGING", "Xero changed during reconciliation. Try again shortly.", 503, 30);

      db.transaction(() => {
        requireWorkspaceAddon(db, provider.id);
        if (store.integration()?.status !== "CONNECTED" || store.integration()?.external_tenant_id !== tenant
          || store.mapping(tenant, "invoice", source.id)?.external_entity_id !== mapping.external_entity_id) fail("The Xero connection changed. No payments were applied.");
        if (snapshot(readAccountingInvoice(db, jobId)) !== snapshot(source)) fail("The ELSET invoice changed during reconciliation. Save and sync again.", "LOCAL_EDIT_CONFLICT");
        if (db.prepare("SELECT 1 FROM payments WHERE invoice_id=? AND source='manual'").get(source.id)) fail("Manual payments changed during reconciliation. Review required.", "MANUAL_PAYMENT_CONFLICT");
        const existing = db.prepare("SELECT * FROM integration_external_payments WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND invoice_id=?")
          .all(store.workspaceId, provider.id, tenant, source.id);
        const beforePaid = db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM payments WHERE invoice_id=?").get(source.id).amount;
        const audit = (operation, message, id = mapping.external_entity_id) => store.log(tenant, "invoice-payment", source.id, operation, "SYNCED", id, { message });
        for (const payment of payments) {
          const old = db.prepare("SELECT * FROM integration_external_payments WHERE provider=? AND external_tenant_id=? AND external_payment_id=?")
            .get(provider.id, tenant, payment.id);
          if (old && (old.invoice_id !== source.id || old.workspace_id !== store.workspaceId || old.external_invoice_id !== mapping.external_entity_id)) fail("This Xero payment is already mapped to another invoice. Review required.", "PAYMENT_MAPPING_CONFLICT");
          const localId = old?.local_payment_id || crypto.randomUUID(), timestamp = now();
          db.prepare(`INSERT INTO integration_external_payments VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?)
            ON CONFLICT(workspace_id,provider,external_tenant_id,external_payment_id) DO UPDATE SET amount_cents=excluded.amount_cents,
            payment_date=excluded.payment_date,status='ACTIVE',external_updated_at=excluded.external_updated_at,updated_at=excluded.updated_at`)
            .run(store.workspaceId, provider.id, tenant, payment.id, source.id, mapping.external_entity_id, localId, payment.amountCents, payment.date, payment.updatedAt, old?.created_at || timestamp, timestamp);
          const local = db.prepare("SELECT * FROM payments WHERE id=?").get(localId);
          if (local && (local.invoice_id !== source.id || local.source !== provider.id)) fail("The local payment identity conflicts. Review required.");
          db.prepare(`INSERT INTO payments(id,invoice_id,amount_cents,date,method,reference,notes,created_at,extra_json,source)
            VALUES(?,?,?,?,'Xero','','',?,'{}','xero') ON CONFLICT(id) DO UPDATE SET amount_cents=excluded.amount_cents,date=excluded.date`)
            .run(localId, source.id, payment.amountCents, payment.date, old?.created_at || timestamp);
          if (!old || old.status === "REMOVED") audit("payment-created", `Xero payment synced: ${money(payment.amountCents)}`, payment.id);
          else if (old.amount_cents !== payment.amountCents || old.payment_date !== payment.date)
            audit("payment-updated", `Xero payment updated: ${money(old.amount_cents)} to ${money(payment.amountCents)} (${payment.date})`, payment.id);
        }
        for (const old of existing.filter((row) => row.status === "ACTIVE" && !payments.some((payment) => payment.id === row.external_payment_id))) {
          db.prepare("DELETE FROM payments WHERE id=? AND invoice_id=? AND source='xero'").run(old.local_payment_id, source.id);
          db.prepare("UPDATE integration_external_payments SET status='REMOVED',updated_at=? WHERE local_payment_id=?").run(now(), old.local_payment_id);
          audit("payment-removed", `Xero payment removed/reversed: ${money(old.amount_cents)}`, old.external_payment_id);
        }
        if (source.totalCents > 0 && beforePaid !== amounts.paid && amounts.due === 0) audit("invoice-paid", "Invoice marked paid from Xero reconciliation");
        saveState(service, source, tenant, mapping, "SYNCED", null, String(external.UpdatedDateUTC || ""));
        db.prepare("UPDATE jobs SET updated_at=? WHERE id=?").run(now(), jobId);
        db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(now());
        store.update({ last_success_at: now(), safe_error_message: "", retry_after: 0 });
      })();
      return service.invoiceStatus(jobId);
    } catch (cause) {
      const error = safeAccountingError(cause);
      const state = error.code === "PAYMENT_PERMISSION_REQUIRED" ? error.code : error.code === "NEEDS_REAUTHORIZATION" ? error.code : error.statusCode === 409 ? "CONFLICT" : "FAILED";
      if (error.code === "PAYMENT_PERMISSION_REQUIRED") {
        const scopes = JSON.parse(store.integration().granted_scopes).filter((scope) => scope !== provider.paymentScope);
        store.update({ granted_scopes: JSON.stringify(scopes) });
      }
      db.transaction(() => {
        saveState(service, source, tenant, mapping, state, error);
        if (previous.status !== state || previous.error !== error.message) store.log(tenant, "invoice-payment", source.id, "reconcile", state, mapping.external_entity_id, error);
      })();
      throw error;
    }
  });
}
