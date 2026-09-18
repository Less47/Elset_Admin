export function invoiceHasAccountingMapping(db, invoiceId) {
  return Boolean(db.prepare(`SELECT 1 FROM integration_entity_mappings
    WHERE provider='xero' AND local_entity_type='invoice' AND local_entity_id=? LIMIT 1`).get(invoiceId));
}

export function assertLocalPaymentAllowed(db, invoiceId) {
  if (!invoiceHasAccountingMapping(db, invoiceId)) return;
  const error = new Error("Payments on this invoice are managed in Xero. Existing manual payments require accounting review before synchronisation.");
  error.statusCode = 409;
  error.code = "PAYMENTS_MANAGED_EXTERNALLY";
  throw error;
}
