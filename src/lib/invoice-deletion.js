export function invoiceHasBeenSent(invoice) {
  return Array.isArray(invoice?.sentHistory) && invoice.sentHistory.length > 0;
}

function hasPayments(invoice) {
  return (Array.isArray(invoice?.payments) && invoice.payments.length > 0)
    || Number(invoice?.paidAmount || 0) > 0
    || String(invoice?.paymentStatus || "").toLowerCase() === "paid";
}

export function invoiceDeletionRestriction(invoice) {
  if (hasPayments(invoice)) return "This invoice has recorded payments and cannot be deleted until those payments are handled.";
  const hasReceipts = (Array.isArray(invoice?.sentHistory) ? invoice.sentHistory : []).filter(Boolean).some((entry) =>
    ["paid-receipt", "part-payment-receipt"].includes(entry.emailPurpose)
    || ["PAID", "PART PAYMENT"].includes(String(entry.stampText || "").trim().toUpperCase())
    || hasPayments(entry.documentSnapshot || entry.document)
  );
  return hasReceipts ? "This invoice has payment receipt history and cannot be deleted. Review its payment records first." : "";
}

export function normalizeDeletedInvoices(records) {
  return Array.isArray(records) ? records.filter((record) => record?.id && record.jobId && record.invoice && record.deletedAt) : [];
}
