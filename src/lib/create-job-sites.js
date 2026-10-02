import { normalizeSiteAddress } from "./site-address.js";

const addressKey = (address) => normalizeSiteAddress(address).toLowerCase();

// Customer normalization can assign IDs to inferred primary/access-note profiles.
// Only records supplied by customer.sites without that marker are saved sites.
export function buildCreateJobSiteOptions(customer, jobs = []) {
  const savedSites = (customer?.sites || []).filter((site) => site.id && !site._inferredProfile && addressKey(site.address));
  const savedAddresses = new Set(savedSites.map((site) => addressKey(site.address)));
  const primaryAddress = normalizeSiteAddress(customer?.address);
  const primarySite = primaryAddress && !savedAddresses.has(addressKey(primaryAddress))
    ? { address: primaryAddress, _inferredProfile: true }
    : null;
  const ownedAddresses = new Set([...savedAddresses, addressKey(primaryAddress)].filter(Boolean));
  const previousAddresses = new Map();
  for (const job of jobs) {
    if (!customer || job.customerId !== customer.id) continue;
    const address = normalizeSiteAddress(job.jobAddress);
    const key = addressKey(address);
    if (key && !ownedAddresses.has(key) && !previousAddresses.has(key)) previousAddresses.set(key, address);
  }
  return { savedSites, primarySite, previousJobAddresses: [...previousAddresses.values()] };
}

// Read-only diagnostic for loaded workspace records (including normalized UI data).
// No fuzzy matching: units, abbreviations and punctuation remain significant.
export function findJobsWithoutOwnedSite(customers, jobs) {
  const ownership = new Map(customers.map((customer) => {
    const { savedSites } = buildCreateJobSiteOptions(customer);
    return [customer.id, new Set([customer.address, ...savedSites.map((site) => site.address)].map(addressKey).filter(Boolean))];
  }));
  return jobs.filter((job) => !ownership.get(job.customerId)?.has(addressKey(job.jobAddress)))
    .map((job) => ({ jobId: job.id, customerId: job.customerId, jobAddress: job.jobAddress || "" }));
}
