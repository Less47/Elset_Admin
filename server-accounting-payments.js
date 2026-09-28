import crypto from "node:crypto";
import { AccountingError, safeAccountingError } from "./server-accounting-errors.js";
import { readAccountingInvoice } from "./server-accounting-workspace.js";
import { requireWorkspaceAddon } from "./server-workspace-addons.js";
import { assertInvoiceAccountingOwner } from "./server-accounting-payment-policy.js";
import { assertNoPendingPaymentWrites } from "./server-accounting-payment-intents.js";

const now = () => new Date().toISOString();
const fail = (message, code = "PAYMENT_STATE_CONFLICT") => { throw new AccountingError(code, message, 409); };
const snapshot = (invoice) => JSON.stringify(invoice);
const money = (amount) => `$${(amount / 100).toFixed(2)}`;

export function paymentSyncStatus(service, invoiceId) {
  const pending = service.db.prepare(`SELECT * FROM integration_payment_outbox WHERE invoice_id=? AND provider=?
    AND revision>completed_revision ORDER BY CASE WHEN safe_error_message<>'' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`).get(invoiceId, service.provider.id);
  const row = service.db.prepare("SELECT * FROM integration_invoice_payment_sync WHERE invoice_id=? AND workspace_id=? AND provider=?")
    .get(invoiceId, service.store.workspaceId, service.provider.id);
  const history = service.db.prepare(`SELECT operation,status,safe_error_message AS message,created_at AS createdAt
    FROM integration_sync_log WHERE workspace_id=? AND provider=? AND entity_type='invoice-payment' AND entity_id=? ORDER BY id DESC LIMIT 20`)
    .all(service.store.workspaceId, service.provider.id, invoiceId);
  return { status: pending?.status || row?.status || "NOT_SYNCED", managed: Boolean(row?.managed), lastSyncedAt: row?.last_synced_at || null,
    error: pending?.safe_error_message || row?.safe_error_message || "", history };
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


export async function reconcileInvoicePayments(service, jobId, { expectedTenant, batch } = {}) {
  const { db, store, provider } = service;
  const reconcile = async () => {
    const source = readAccountingInvoice(db, jobId), tenant = store.integration()?.external_tenant_id || "";
    if (expectedTenant && expectedTenant !== tenant) fail(`The ${provider.name} organisation changed. No payments were applied.`, "TENANT_CHANGED");
    const mapping = store.mapping(tenant, "invoice", source.id);
    if (!mapping) fail(`Send this invoice to ${provider.name} before syncing payments.`, "INVOICE_NOT_MAPPED");
    assertInvoiceAccountingOwner(db, source.id, provider.id, tenant);
    const previous = paymentSyncStatus(service, source.id);
    try {
      if (provider.id === "quickbooks") assertNoPendingPaymentWrites(db, source.id);
      // Removing the only receipt from an unsent, already mapped invoice must
      // still reconcile its reversal. Other eligibility failures remain guarded.
      if (!source.eligible && !(provider.id === "quickbooks" && source.reason === "Only sent invoices or invoices with recorded payments can be sent to accounting.")) fail("This ELSET invoice is no longer eligible for accounting reconciliation.");
      if (store.integration()?.status !== "CONNECTED") await service.credentials();
      if (service.status().paymentSync !== "CONNECTED") throw new AccountingError("PAYMENT_PERMISSION_REQUIRED", `${provider.name} needs additional permission to sync payments.`, 409);
      const owned = db.prepare("SELECT * FROM integration_invoice_payment_sync WHERE invoice_id=?").get(source.id);
      if (owned && (owned.provider !== provider.id || owned.external_tenant_id !== tenant || owned.workspace_id !== store.workspaceId || owned.external_invoice_id !== mapping.external_entity_id))
        fail("This invoice has payment history with a different accounting organisation. Review required.");
      if (db.prepare(`SELECT 1 FROM payments p WHERE invoice_id=? AND source='manual' AND (?<>'quickbooks' OR NOT EXISTS
        (SELECT 1 FROM integration_external_payments e WHERE e.local_payment_id=p.id AND e.provider=? AND e.external_tenant_id=?)) LIMIT 1`).get(source.id, provider.id, provider.id, tenant))
        fail(`Existing manual payments require accounting review. They were retained and no ${provider.name} amounts were added.`, "MANUAL_PAYMENT_CONFLICT");
      const context = await service.credentials();
      const organisations = await provider.getOrganisations(context.accessToken, { realmId: context.authorisedTenantId || context.tenantId });
      if (!organisations.some((org) => org.id === tenant)) throw new AccountingError("NEEDS_REAUTHORIZATION", `The selected ${provider.name} organisation is no longer connected. Reconnect ${provider.name}.`, 409);
      const organisation = await provider.getOrganisation(context);
      if (organisation.id !== tenant || organisation.currency !== source.currency) fail(`The ${provider.name} organisation identity or currency differs. Review required.`);
      const external = await provider.getInvoice(context, mapping.external_entity_id);
      const contact = store.mapping(tenant, "customer", source.customerId);
      const amounts = await provider.paymentSnapshot(context, external, source, mapping, contact);
      const { payments } = amounts;
      if (payments.reduce((sum, payment) => sum + payment.amountCents, 0) !== amounts.paid) fail(`${provider.name} payment details do not match its invoice totals. No payments were applied.`);
      // A payment can change during the detail reads. Never apply a mixed snapshot.
      const confirmed = await provider.getInvoice(context, mapping.external_entity_id);
      if (snapshot(external) !== snapshot(confirmed)) throw new AccountingError("EXTERNAL_CHANGING", `${provider.name} changed during reconciliation. Try again shortly.`, 503, 30);

      const apply = () => {
        requireWorkspaceAddon(db, provider.id);
        if (store.integration()?.status !== "CONNECTED" || store.integration()?.external_tenant_id !== tenant
          || store.mapping(tenant, "invoice", source.id)?.external_entity_id !== mapping.external_entity_id) fail(`The ${provider.name} connection changed. No payments were applied.`);
        if (snapshot(readAccountingInvoice(db, jobId)) !== snapshot(source)) fail("The ELSET invoice changed during reconciliation. Save and sync again.", "LOCAL_EDIT_CONFLICT");
        if (provider.id === "quickbooks") assertNoPendingPaymentWrites(db, source.id);
        if (db.prepare(`SELECT 1 FROM payments p WHERE invoice_id=? AND source='manual' AND (?<>'quickbooks' OR NOT EXISTS
          (SELECT 1 FROM integration_external_payments e WHERE e.local_payment_id=p.id AND e.provider=? AND e.external_tenant_id=?))`).get(source.id, provider.id, provider.id, tenant)) fail("Manual payments changed during reconciliation. Review required.", "MANUAL_PAYMENT_CONFLICT");
        const existing = db.prepare("SELECT * FROM integration_external_payments WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND invoice_id=?")
          .all(store.workspaceId, provider.id, tenant, source.id);
        const beforePaid = db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM payments WHERE invoice_id=?").get(source.id).amount;
        const audit = (operation, message, id = mapping.external_entity_id) => store.log(tenant, "invoice-payment", source.id, operation, "SYNCED", id, { message });
        for (const payment of payments) {
          if (!provider.multipleInvoicePayments && db.prepare("SELECT 1 FROM integration_external_payments WHERE provider=? AND external_tenant_id=? AND external_payment_id=? AND invoice_id<>?")
            .get(provider.id, tenant, payment.id, source.id)) fail("This accounting payment is already mapped to another invoice.", "PAYMENT_MAPPING_CONFLICT");
          const old = db.prepare("SELECT * FROM integration_external_payments WHERE provider=? AND external_tenant_id=? AND external_payment_id=? AND invoice_id=?")
            .get(provider.id, tenant, payment.id, source.id);
          if (old && (old.invoice_id !== source.id || old.workspace_id !== store.workspaceId || old.external_invoice_id !== mapping.external_entity_id)) fail(`This ${provider.name} payment is already mapped to another invoice. Review required.`, "PAYMENT_MAPPING_CONFLICT");
          const localId = old?.local_payment_id || crypto.randomUUID(), timestamp = now();
          db.prepare(`INSERT INTO integration_external_payments(workspace_id,provider,external_tenant_id,external_payment_id,invoice_id,external_invoice_id,local_payment_id,amount_cents,payment_date,status,external_updated_at,created_at,updated_at,external_snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?)
            ON CONFLICT(workspace_id,provider,external_tenant_id,external_payment_id,invoice_id) DO UPDATE SET amount_cents=excluded.amount_cents,
            payment_date=excluded.payment_date,status='ACTIVE',external_updated_at=excluded.external_updated_at,updated_at=excluded.updated_at,external_snapshot_json=excluded.external_snapshot_json`)
            .run(store.workspaceId, provider.id, tenant, payment.id, source.id, mapping.external_entity_id, localId, payment.amountCents, payment.date, payment.updatedAt, old?.created_at || timestamp, timestamp, payment.snapshot ? JSON.stringify(payment.snapshot) : "");
          const local = db.prepare("SELECT * FROM payments WHERE id=?").get(localId);
          if (local && (local.invoice_id !== source.id || (local.source !== provider.id && !(provider.id === "quickbooks" && old && local.source === "manual")))) fail("The local payment identity conflicts. Review required.");
          db.prepare(`INSERT INTO payments(id,invoice_id,amount_cents,date,method,reference,notes,created_at,extra_json,source)
            VALUES(?,?,?,?,?,'','',?,'{}',?) ON CONFLICT(id) DO UPDATE SET amount_cents=excluded.amount_cents,date=excluded.date`)
            .run(localId, source.id, payment.amountCents, payment.date, provider.name, old?.created_at || timestamp, provider.id);
          if (!old || old.status === "REMOVED") audit("payment-created", `${provider.name} payment synced: ${money(payment.amountCents)}`, payment.id);
          else if (old.amount_cents !== payment.amountCents || old.payment_date !== payment.date)
            audit("payment-updated", `${provider.name} payment updated: ${money(old.amount_cents)} to ${money(payment.amountCents)} (${payment.date})`, payment.id);
        }
        for (const old of existing.filter((row) => row.status === "ACTIVE" && !payments.some((payment) => payment.id === row.external_payment_id))) {
          db.prepare("DELETE FROM payments WHERE id=? AND invoice_id=? AND (source=? OR (?='quickbooks' AND source='manual'))").run(old.local_payment_id, source.id, provider.id, provider.id);
          db.prepare("UPDATE integration_external_payments SET status='REMOVED',updated_at=? WHERE local_payment_id=?").run(now(), old.local_payment_id);
          audit("payment-removed", `${provider.name} payment removed/reversed: ${money(old.amount_cents)}`, old.external_payment_id);
        }
        if (source.totalCents > 0 && beforePaid !== amounts.paid && amounts.due === 0) audit("invoice-paid", `Invoice marked paid from ${provider.name} reconciliation`);
        saveState(service, source, tenant, mapping, "SYNCED", null, amounts.updatedAt);
        db.prepare("UPDATE jobs SET updated_at=? WHERE id=?").run(now(), jobId);
        db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(now());
        store.update({ last_success_at: now(), safe_error_message: "", retry_after: 0 });
      };
      if (batch) { batch.push({ apply, context, external, mapping, source, payments }); return; }
      db.transaction(apply)();
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
  };
  return batch ? reconcile() : service.work(reconcile);
}

// QuickBooks permits a payment to move between invoices. Prepare the complete
// connected allocation group before one local transaction, so a failed refresh
// cannot leave the old receipt counted alongside its new allocation.
export function reconcilePaymentGroup(service, jobId, options = {}) {
  return service.work(async () => {
    const { db, store, provider } = service;
    const batch = [], pending = [jobId], visited = new Set(), paymentIds = new Set();
    while (pending.length) {
      const next = pending.shift();
      if (visited.has(next)) continue;
      if (visited.size >= 100) fail("This payment allocation group exceeds the supported size. Accounting review required.");
      visited.add(next);
      await reconcileInvoicePayments(service, next, { ...options, batch });
      const prepared = batch.at(-1), tenant = prepared.context.tenantId;
      const historic = db.prepare("SELECT external_payment_id FROM integration_external_payments WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND invoice_id=?")
        .all(store.workspaceId, provider.id, tenant, prepared.source.id).map((row) => row.external_payment_id);
      const current = (prepared.external.LinkedTxn || []).filter((link) => link.TxnType === "Payment").map((link) => link.TxnId);
      for (const id of new Set([...historic, ...current])) {
        if (paymentIds.has(id)) continue;
        if (paymentIds.size >= 500) fail("This payment allocation group exceeds the supported size. Accounting review required.");
        paymentIds.add(id);
        const previous = db.prepare("SELECT external_invoice_id FROM integration_external_payments WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND external_payment_id=?")
          .all(store.workspaceId, provider.id, tenant, id).map((row) => row.external_invoice_id);
        const externalIds = [...previous, ...await provider.paymentInvoiceIds(prepared.context, id)];
        for (const externalId of new Set(externalIds)) {
          const mapped = db.prepare(`SELECT i.job_id FROM integration_entity_mappings m JOIN invoices i ON i.id=m.local_entity_id
            WHERE m.workspace_id=? AND m.provider=? AND m.external_tenant_id=? AND m.local_entity_type='invoice' AND m.external_entity_id=?`)
            .get(store.workspaceId, provider.id, tenant, externalId);
          if (mapped && !visited.has(mapped.job_id)) pending.push(mapped.job_id);
        }
      }
    }
    for (const prepared of batch) {
      if (snapshot(prepared.external) !== snapshot(await provider.getInvoice(prepared.context, prepared.mapping.external_entity_id))) {
        throw new AccountingError("EXTERNAL_CHANGING", "QuickBooks changed during allocation reconciliation. Retry shortly.", 503, 30);
      }
      for (const payment of prepared.payments) {
        if (payment.snapshot && snapshot(payment.snapshot) !== snapshot(await provider.getPayment(prepared.context, payment.id))) {
          throw new AccountingError("EXTERNAL_CHANGING", "QuickBooks changed during allocation reconciliation. Retry shortly.", 503, 30);
        }
      }
    }
    db.transaction(() => { for (const prepared of batch) prepared.apply(); })();
    return service.invoiceStatus(jobId);
  });
}
