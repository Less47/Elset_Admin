import { structuredSiteAddress, updatedStructuredSiteAddress } from "./maintenance-plan.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const addressKey = (value) => clean(value).toLowerCase();
const has = (record, key) => Object.prototype.hasOwnProperty.call(record || {}, key);

function coordinate(value, limit) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export function readSavedPosition(record) {
  // An explicit cleared pair must not resurrect an older alias or nested location.
  if (has(record, "latitude") || has(record, "longitude")) {
    const lat = coordinate(record.latitude, 90);
    const lng = coordinate(record.longitude, 180);
    return lat !== null && lng !== null ? { lat, lng } : null;
  }
  for (const source of [record, record?.location]) {
    for (const [latitude, longitude] of [[source?.latitude, source?.longitude], [source?.lat, source?.lon], [source?.lat, source?.lng]]) {
      const lat = coordinate(latitude, 90);
      const lng = coordinate(longitude, 180);
      if (lat !== null && lng !== null) return { lat, lng };
    }
  }
  return null;
}

// Optional Site metadata uses the existing SQLite extra_json / JSON record slot.
// Do not invent empty metadata when normalizing an untouched legacy Site.
export function siteAddressMetadata(site) {
  const result = { ...structuredSiteAddress(site) };
  for (const key of ["state", "postcode"]) if (has(site, key)) result[key] = clean(site[key]);
  const position = readSavedPosition(site);
  if (position || ["latitude", "longitude", "lat", "lon", "lng", "location"].some((key) => has(site, key))) {
    result.latitude = position?.lat ?? null;
    result.longitude = position?.lng ?? null;
  }
  return result;
}

export function updatedSiteAddressMetadata(existing, input) {
  const previous = siteAddressMetadata(existing);
  const incoming = siteAddressMetadata(input);
  if (input?.address !== undefined && addressKey(input.address) !== addressKey(existing?.address)) {
    return {
      ...Object.fromEntries(Object.keys(previous).map((key) => [key, key === "latitude" || key === "longitude" ? null : ""])),
      ...updatedStructuredSiteAddress(existing, input),
      latitude: null,
      longitude: null,
      ...incoming,
    };
  }
  return { ...previous, ...incoming };
}

export function resolveJobMapPosition(job, site, cached) {
  // The Site owns the address location. A manually cleared Site also invalidates
  // stale job coordinates after the existing address-reference sync has run.
  return readSavedPosition(site) || readSavedPosition(cached)
    || (has(site, "latitude") || has(site, "longitude") ? null : readSavedPosition(job));
}

// The persisted legacy Job relationship is customerId + jobAddress. Prefer an
// explicit Site ID when supplied, and never substitute a customer's main address.
export function indexCustomerSites(customers = []) {
  const byId = new Map();
  const byAddress = new Map();
  const sites = [];
  for (const customer of customers) for (const site of customer.sites || []) {
    sites.push(site);
    byId.set(`${customer.id}:${site.id}`, site);
    const address = addressKey(site.address);
    if (!address) continue;
    const key = `${customer.id}:${address}`;
    if (!byAddress.has(key)) byAddress.set(key, []);
    byAddress.get(key).push(site);
  }
  return { byId, byAddress, sites };
}

export function resolveJobSiteLocation(job, index) {
  const siteId = clean(job?.siteId || job?.site_id);
  const address = addressKey(job?.jobAddress);
  const matches = siteId ? [index.byId.get(`${job?.customerId}:${siteId}`)].filter(Boolean)
    : address ? index.byAddress.get(`${job?.customerId}:${address}`) || [] : [];
  const site = matches.length === 1 ? matches[0] : null;
  const position = readSavedPosition(site);
  return {
    site, position, matchBy: site ? siteId ? "id" : "address" : null,
    reason: matches.length > 1 ? "ambiguous-site" : !site ? "site-not-found" : !position ? "site-missing-coordinates" : null,
  };
}

export function siteGeocodingAddress(site) {
  const street = clean(site?.streetAddress || site?.addressLine1);
  const locality = clean(site?.suburb || site?.city || site?.locality);
  const region = [locality, clean(site?.state), clean(site?.postcode)].filter(Boolean).join(" ");
  return street && locality ? `${street}, ${region}` : clean(site?.address) || (street ? [street, region].filter(Boolean).join(", ") : "");
}

export function summarizeSiteLocations(customers = [], jobs = []) {
  const index = indexCustomerSites(customers);
  const resolutions = jobs.map((job) => resolveJobSiteLocation(job, index));
  const referenced = new Set(resolutions.map((entry) => entry.site).filter(Boolean));
  const count = (records, predicate) => records.filter(predicate).length;
  const valid = (site) => Boolean(readSavedPosition(site));
  return {
    totalJobs: jobs.length,
    jobsWithSiteId: count(jobs, (job) => Boolean(clean(job.siteId || job.site_id))),
    jobsLinkedById: count(resolutions, (entry) => entry.matchBy === "id"),
    jobsLinkedByAddress: count(resolutions, (entry) => entry.matchBy === "address"),
    jobsWithoutSite: count(resolutions, (entry) => entry.reason === "site-not-found"),
    jobsWithAmbiguousSite: count(resolutions, (entry) => entry.reason === "ambiguous-site"),
    mappedJobs: count(resolutions, (entry) => Boolean(entry.position)),
    unmappedJobs: count(resolutions, (entry) => !entry.position),
    uniqueSitesReferenced: referenced.size,
    totalSites: index.sites.length,
    sitesWithValidCoordinates: count(index.sites, valid),
    sitesMissingCoordinates: count(index.sites, (site) => !valid(site)),
    sitesWithAddressNoCoordinates: count(index.sites, (site) => !valid(site) && Boolean(siteGeocodingAddress(site))),
    referencedSitesWithAddressNoCoordinates: count([...referenced], (site) => !valid(site) && Boolean(siteGeocodingAddress(site))),
    sitesWithLegacyCoordinateFields: count(index.sites, (site) => ["lat", "lon", "lng", "location"].some((key) => has(site, key))),
  };
}
