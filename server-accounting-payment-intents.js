import { AccountingError } from "./server-accounting-errors.js";
import { getWorkspaceAddons } from "./server-workspace-addons.js";

// Called only inside the existing document mutation transaction. No network I/O.
export function queueQuickBooksPayment(db, jobId, invoiceId, paymentId, previousPayment) {
  const mapping = db.prepare("SELECT * FROM integration_entity_mappings WHERE local_entity_type='invoice' AND local_entity_id=? LIMIT 1").get(invoiceId);
  if (mapping && mapping.provider !== "quickbooks") return;
  const connection = db.prepare("SELECT * FROM workspace_integrations WHERE provider='quickbooks'").get();
  if (!mapping && (!getWorkspaceAddons(db).quickbooks || !connection?.external_tenant_id)) return;
  const tenant = mapping?.external_tenant_id || connection.external_tenant_id;
  const workspace = mapping?.workspace_id || connection.workspace_id;
  const previous = db.prepare("SELECT * FROM integration_payment_outbox WHERE local_payment_id=?").get(paymentId);
  if (previous && (previous.invoice_id !== invoiceId || previous.external_tenant_id !== tenant || previous.workspace_id !== workspace)) {
    throw new AccountingError("PAYMENT_MAPPING_CONFLICT", "This payment belongs to another invoice or accounting company. Review required.", 409);
  }
  const payment = db.prepare("SELECT * FROM payments WHERE id=? AND invoice_id=?").get(paymentId, invoiceId);
  if (payment && previousPayment && payment.amount_cents === previousPayment.amount_cents && payment.date === previousPayment.date) return;
  const earlier = previous && previous.revision > previous.completed_revision ? JSON.parse(previous.desired_json) : null;
  const desired = JSON.stringify(payment ? { amountCents: payment.amount_cents, date: payment.date,
    dateChanged: !previousPayment || payment.date !== previousPayment.date || earlier?.dateChanged === true } : null);
  // Method/reference/notes stay local; they do not generate accounting writes.
  if (previous?.desired_json === desired && previous.revision > previous.completed_revision) return;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO integration_payment_outbox(workspace_id,provider,external_tenant_id,provider_environment,
    local_payment_id,invoice_id,job_id,desired_json,created_at,updated_at) VALUES(?,'quickbooks',?,?,?,?,?,?,?,?)
    ON CONFLICT(local_payment_id) DO UPDATE SET desired_json=excluded.desired_json,revision=revision+1,
    status='PENDING',attempt_count=0,retry_at=0,error_code='',safe_error_message='',updated_at=excluded.updated_at`)
    .run(workspace, tenant, previous?.provider_environment || connection?.provider_environment || "", paymentId, invoiceId, jobId, desired, now, now);
}

export function assertNoPendingPaymentWrites(db, invoiceId) {
  if (db.prepare("SELECT 1 FROM integration_payment_outbox WHERE invoice_id=? AND revision>completed_revision LIMIT 1").get(invoiceId)) {
    throw new AccountingError("OUTBOUND_PAYMENT_PENDING", "An ELSET payment change is waiting to sync with QuickBooks. Local payments were retained.", 503, 30);
  }
}
