// Jobs identify their Site by customerId and normalized jobAddress, as in Job Details.
// Capture only document-facing Site data so sent copies never look up a live Site.
export function withDocumentSiteSnapshot(job, customers, type) {
  if (type !== "invoice") return job;

  const addressKey = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const customer = (customers || []).find((entry) => entry.id === job.customerId);
  const jobAddress = addressKey(job.jobAddress);
  const site = jobAddress
    ? customer?.sites?.find((entry) => addressKey(entry.address) === jobAddress)
    : null;

  return {
    ...job,
    siteSnapshot: site ? {
      id: site.id,
      address: site.address,
      ocNumber: String(site.ocNumber ?? "").trim(),
    } : null,
  };
}
