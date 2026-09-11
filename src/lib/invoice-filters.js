export function matchesInvoiceJobStatus(row, statusFilter) {
  // Missing linked jobs/statuses belong only to the unfiltered result set.
  return statusFilter === "all" || row?.job?.status === statusFilter;
}
