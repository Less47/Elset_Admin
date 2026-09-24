import { isQualifyingActualInvoice } from "./invoice-account.js";

export function isInvoicedRow(row) {
  return isQualifyingActualInvoice({ metadata: row?.job?.invoice,
    sentCount: row?.invoice?.sentHistory?.length || 0,
    paidCents: Math.round((row?.paymentSummary?.paidAmount || 0) * 100) });
}

export function matchesInvoiceJobStatus(row, statusFilter) {
  // Missing linked jobs/statuses belong only to the unfiltered result set.
  return statusFilter === "all" || row?.job?.status === statusFilter;
}
