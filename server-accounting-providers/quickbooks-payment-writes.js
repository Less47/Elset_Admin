import { AccountingError } from "../server-accounting-errors.js";
import { digest } from "../server-accounting-crypto.js";

const cents = value => Math.round(value * 100);
const conflict = message => { throw new AccountingError("EXTERNAL_PAYMENT_CONFLICT", message, 409); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const paymentFingerprint = payment => digest(JSON.stringify(canonical(payment)));

export function paymentAllocation(payment, invoiceId) {
  return (payment?.Line || []).filter(line => line.LinkedTxn?.[0]?.TxnType === "Invoice" && line.LinkedTxn[0].TxnId === invoiceId)
    .reduce((sum, line) => sum + cents(line.Amount), 0);
}

// Full Payment updates replace the allocation list. Preserve writable fields
// from the verified read; never process a card or initiate a money movement.
export function paymentWritePayload(current, invoiceId, desired) {
  if (!/^\d+$/.test(String(current.SyncToken ?? "")) || current.ProcessPayment === true || current.CreditCardPayment || current.CreditCardPaymentInfo
    || current.LinkedTxn?.length || /^Voided/i.test(current.PrivateNote || "")) {
    conflict("This QuickBooks payment has a protected state. Review it in QuickBooks before changing it.");
  }
  const previous = paymentAllocation(current, invoiceId);
  if (!previous) conflict("QuickBooks moved or removed this payment allocation. Review the payment before syncing.");
  const total = cents(current.TotalAmt) - previous + (desired?.amountCents || 0);
  if (total === 0) return { kind: "delete", payload: { Id: current.Id, SyncToken: current.SyncToken } };
  const payload = { ...current, sparse: false, ProcessPayment: false, TotalAmt: total / 100,
    TxnDate: desired?.date || current.TxnDate,
    Line: current.Line.filter(line => line.LinkedTxn[0].TxnId !== invoiceId) };
  delete payload.MetaData;
  if (desired) payload.Line.push({ Amount: desired.amountCents / 100, LinkedTxn: [{ TxnId: invoiceId, TxnType: "Invoice" }] });
  return { kind: "update", payload };
}

export function paymentMatchesWrite(payment, request) {
  const expected = request.payload;
  if (!payment || payment.CustomerRef?.value !== expected.CustomerRef?.value || payment.TxnDate !== expected.TxnDate
    || cents(payment.TotalAmt) !== cents(expected.TotalAmt) || (payment.PrivateNote || "") !== (expected.PrivateNote || "")) return false;
  const allocations = row => (row.Line || []).map(line => ({ amount: cents(line.Amount), links: line.LinkedTxn }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(canonical(allocations(payment))) === JSON.stringify(canonical(allocations(expected)))
    && (payment.CurrencyRef?.value || "AUD") === (expected.CurrencyRef?.value || "AUD")
    && (!expected.DepositToAccountRef || payment.DepositToAccountRef?.value === expected.DepositToAccountRef.value)
    && (!expected.PaymentMethodRef || payment.PaymentMethodRef?.value === expected.PaymentMethodRef.value);
}

export async function findPaymentRequest(provider, context, marker, customerId) {
  if (!/^\d+$/.test(customerId)) conflict("The QuickBooks payment customer is not mapped.");
  const matches = (await provider.query(context, "Payment", `CustomerRef = '${customerId}'`)).filter(row => row.PrivateNote === marker);
  if (matches.length > 1) conflict("QuickBooks returned multiple payments for one ELSET request. Accounting review required.");
  return matches[0] || null;
}

export async function writePayment(provider, context, request, key) {
  const response = await provider.request(context, request.kind === "delete" ? "payment?operation=delete" : "payment", "POST", request.payload, key);
  const payment = response?.Payment;
  if (!/^\d{1,50}$/.test(payment?.Id || "") || (request.payload.Id && payment.Id !== request.payload.Id)
    || (request.kind === "delete" ? payment.status !== "Deleted" : !paymentMatchesWrite(payment, request))) {
    throw new AccountingError("PAYMENT_RESPONSE", "QuickBooks did not confirm the payment change. Its original request was retained for reconciliation.", 503);
  }
  return request.kind === "delete" ? null : payment;
}
