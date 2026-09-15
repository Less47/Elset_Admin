import { buildDocumentReference, calculateInvoiceBalanceDue, calculateInvoicePaidAmount, calculateInvoiceTotal, roundCurrency } from "./quote-template.js";
import { invoiceHasBeenSent } from "./invoice-deletion.js";

export function invoiceToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function invoiceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

export function invoiceOverdueDays(balance, dueDate, today = invoiceToday()) {
  if (!(balance > 0) || !invoiceDate(dueDate) || !invoiceDate(today) || dueDate >= today) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

// Existing ELSET status order and labels. Amounts must share the same unit.
export function invoiceStatusFromAmounts({ exists = true, total = 0, balance = 0, paid = 0, paymentCount = 0, sentCount = 0, dueDate = "", today = invoiceToday() } = {}) {
  const status = !exists ? ["not-invoiced", "Not invoiced", 0, "bg-surface-raised text-secondary-foreground"]
    : total > 0 && balance <= 0 ? ["paid", "Paid", 6, "bg-status-success-surface text-status-success"]
    : invoiceOverdueDays(balance, dueDate, today) ? ["overdue", "Overdue", 1, "bg-status-danger-surface text-status-danger"]
    : paid > 0 ? paymentCount <= 1
      ? ["deposit-paid", "Deposit Paid", 4, "bg-status-warning-surface text-status-warning"]
      : ["partially-paid", "Partially Paid", 5, "bg-status-special-surface text-status-special"]
    : sentCount > 0 ? ["unpaid", "Unpaid", 3, "bg-status-info-surface text-status-info"]
    : ["draft", "Draft", 2, "bg-status-warning-surface text-status-warning"];
  const [id, label, rank, className] = status;
  return { id, label, rank, className };
}

export function isInactiveInvoice(invoice) {
  if (!invoice || typeof invoice !== "object" || Array.isArray(invoice)) return true;
  const status = String(invoice.status || invoice.invoiceStatus || "").trim().toLowerCase();
  return ["void", "voided", "cancelled", "canceled", "deleted"].includes(status)
    || ["voidedAt", "cancelledAt", "canceledAt", "deletedAt"].some((key) => Boolean(invoice[key]))
    || ["voided", "cancelled", "canceled", "deleted"].some((key) => invoice[key] === true);
}

function safeCents(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invoice amount cannot be represented safely in cents.");
  return value;
}

export function summarizeInvoiceAccount(customerId, records, { today = invoiceToday(), limit = 5 } = {}) {
  const invoices = [];
  for (const record of records) {
    // Only actual invoice projections enter this function; never Job/Quote values.
    if (record.customerId !== customerId || isInactiveInvoice(record.metadata)
      || !(record.sentCount > 0 || record.paidCents > 0) || !(record.balanceCents > 0)) continue;
    const totalCents = safeCents(record.totalCents), paidCents = safeCents(record.paidCents), balanceCents = safeCents(record.balanceCents);
    const dueDate = invoiceDate(record.dueDate), issueDate = invoiceDate(record.issueDate);
    const overdueDays = invoiceOverdueDays(balanceCents, dueDate, today);
    const status = invoiceStatusFromAmounts({ total: totalCents, balance: balanceCents, paid: paidCents,
      paymentCount: record.paymentCount, sentCount: record.sentCount, dueDate, today });
    invoices.push({ invoiceId: record.invoiceId, jobId: record.jobId, invoiceNumber: record.invoiceNumber,
      issueDate, dueDate, totalCents, paidCents, balanceCents, status, overdueDays });
  }
  invoices.sort((a, b) => Number(b.overdueDays > 0) - Number(a.overdueDays > 0)
    || (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31")
    || b.issueDate.localeCompare(a.issueDate) || b.invoiceNumber.localeCompare(a.invoiceNumber, "en", { numeric: true })
    || a.invoiceId.localeCompare(b.invoiceId));
  return { customerId, asOfDate: today,
    outstandingCents: safeCents(invoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0)),
    openInvoiceCount: invoices.length, overdueInvoiceCount: invoices.filter((invoice) => invoice.overdueDays > 0).length,
    oldestOverdueDays: invoices.reduce((days, invoice) => Math.max(days, invoice.overdueDays), 0),
    invoices: invoices.slice(0, limit), hasMore: invoices.length > limit };
}

// JSON mode already supplies Jobs to Customer Profile. Reuse its invoice helpers
// without fetching another workspace or persisting a Customer balance.
export function summarizeJsonCustomerAccount(customerId, jobs = [], options) {
  const records = [];
  for (const job of jobs) {
    const invoice = job.invoice;
    if (job.customerId !== customerId || isInactiveInvoice(invoice) || (invoice.type && invoice.type !== "invoice")) continue;
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const total = calculateInvoiceTotal(items);
    let payments = (Array.isArray(invoice.payments) ? invoice.payments : []).filter((payment) => Number(payment?.amount) > 0)
      .map((payment) => ({ amount: roundCurrency(payment.amount) }));
    if (!payments.length && String(invoice.paymentStatus || "").toLowerCase() === "paid" && total > 0) payments = [{ amount: total }];
    const paid = calculateInvoicePaidAmount(payments), balance = calculateInvoiceBalanceDue(items, payments);
    records.push({ customerId: job.customerId, jobId: job.id, invoiceId: invoice.id || `${job.id}:invoice`,
      invoiceNumber: buildDocumentReference(job, "invoice"), issueDate: invoice.issueDate, dueDate: invoice.dueDate,
      totalCents: Math.round(total * 100), paidCents: Math.round(paid * 100), balanceCents: Math.round(balance * 100),
      sentCount: invoiceHasBeenSent(invoice) ? invoice.sentHistory.length : 0, paymentCount: payments.length, metadata: invoice });
  }
  return summarizeInvoiceAccount(customerId, records, options);
}
