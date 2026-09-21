import { AccountingError } from '../server-accounting-errors.js';
const fail = (message, code = 'PAYMENT_STATE_CONFLICT') => { throw new AccountingError(code, message, 409); };
const cents = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : NaN;

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


export async function xeroPaymentSnapshot(provider, context, external, source, mapping, contact) {
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

  return { ...amounts, payments, updatedAt: String(external.UpdatedDateUTC || '') };
}
