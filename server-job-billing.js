import { WARRANTY_EXISTING_INVOICE_MESSAGE, WARRANTY_INVOICE_MESSAGE } from "./src/lib/job-billing.js";
import { AccountingError } from "./server-accounting-errors.js";

export function assertJobCanBecomeWarranty(db, jobId) {
  const invoice = db.prepare("SELECT 1 FROM invoices WHERE job_id=? LIMIT 1").get(jobId);
  const mapped = db.prepare(`SELECT 1 FROM integration_entity_mappings WHERE local_entity_type='invoice'
    AND (local_entity_id=? OR local_entity_id IN (SELECT id FROM invoices WHERE job_id=?)
      OR local_entity_id IN (SELECT invoice_id FROM deleted_invoices WHERE job_id=?)) LIMIT 1`).get(`${jobId}:invoice`, jobId, jobId);
  if (invoice || mapped) throw Object.assign(new Error(WARRANTY_EXISTING_INVOICE_MESSAGE), { statusCode: 409 });
}

export function assertJobInvoiceAllowed(db, jobId) {
  if (db.prepare("SELECT billing_type FROM jobs WHERE id=?").get(jobId)?.billing_type === "warranty") {
    throw new AccountingError("WARRANTY_NON_BILLABLE", WARRANTY_INVOICE_MESSAGE, 409);
  }
}
