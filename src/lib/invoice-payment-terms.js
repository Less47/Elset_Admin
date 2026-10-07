import { invoiceDate } from "./invoice-account.js";
import { calculateInvoicePaidAmount, calculateInvoiceTotal } from "./quote-template.js";

export function addCalendarMonth(value) {
  if (!invoiceDate(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(`${value}T00:00:00Z`);
  next.setUTCDate(1);
  next.setUTCMonth(month);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next.toISOString().slice(0, 10);
}

// Invoice dates use the workspace's Australian business day, including sends
// whose UTC timestamp falls on the previous date.
export function invoiceSendDate(sentAt) {
  if (invoiceDate(sentAt)) return sentAt;
  if (!sentAt) return "";
  const date = new Date(sentAt);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function invoiceIsFullyPaid(invoice) {
  const total = calculateInvoiceTotal(invoice?.items || []);
  return total > 0 && (calculateInvoicePaidAmount(invoice?.payments || []) >= total
    || String(invoice?.paymentStatus || "").toLowerCase() === "paid");
}

export function invoiceDueDateMode(invoice) {
  if (["auto", "manual"].includes(invoice?.dueDateMode)) return invoice.dueDateMode;
  // Historical sent/paid invoices keep their dates. For legacy unsent invoices
  // only the old issue-date + 7-day default (or no date) is automatic.
  if (invoice?.sentHistory?.length || invoiceIsFullyPaid(invoice)) return "manual";
  if (!invoice?.dueDate) return "auto";
  if (!invoiceDate(invoice?.issueDate)) return "manual";
  const oldDefault = new Date(`${invoice.issueDate}T00:00:00Z`);
  oldDefault.setUTCDate(oldDefault.getUTCDate() + 7);
  return invoice.dueDate === oldDefault.toISOString().slice(0, 10) ? "auto" : "manual";
}

// Also used to show the prospective customer copy before submission. The
// persisted anchor is established only with confirmed successful send history.
export function invoiceTermsOnFirstSend(invoice, sentAt) {
  if (!invoice || invoice.sentHistory?.length || invoiceIsFullyPaid(invoice)
    || invoiceDueDateMode(invoice) !== "auto") return invoice;
  const dueDate = addCalendarMonth(invoiceSendDate(sentAt));
  return dueDate ? { ...invoice, dueDate, dueDateMode: "auto" } : invoice;
}
