import { AccountingError } from "./server-accounting-errors.js";
import { accountingProviderName } from "./src/lib/addons.js";

export function assertInvoiceAccountingOwner(db, invoiceId, provider, tenant) {
  const other = db.prepare(`SELECT provider FROM integration_entity_mappings WHERE local_entity_type='invoice'
    AND local_entity_id=? AND (provider<>? OR external_tenant_id<>?) LIMIT 1`).get(invoiceId, provider, tenant);
  if (other) throw new AccountingError("INVOICE_PROVIDER_CONFLICT", `This invoice already belongs to ${accountingProviderName(other.provider)} in another connection. Its existing accounting mapping must be reviewed; it cannot be sent to a second provider or company.`, 409);
}

export function invoiceHasAccountingMapping(db, invoiceId) {
  return Boolean(db.prepare(`SELECT 1 FROM integration_entity_mappings
    WHERE local_entity_type='invoice' AND local_entity_id=? LIMIT 1`).get(invoiceId));
}

export function assertLocalPaymentAllowed(db, invoiceId) {
  if (!invoiceHasAccountingMapping(db, invoiceId)) return;
  const owner = db.prepare("SELECT provider FROM integration_entity_mappings WHERE local_entity_type='invoice' AND local_entity_id=? LIMIT 1").get(invoiceId);
  const error = new Error(`Payments on this invoice are managed in ${accountingProviderName(owner?.provider)}. Existing manual payments require accounting review before synchronisation.`);
  error.statusCode = 409;
  error.code = "PAYMENTS_MANAGED_EXTERNALLY";
  throw error;
}
