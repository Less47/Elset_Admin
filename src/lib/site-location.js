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
