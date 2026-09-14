import { createHash } from "node:crypto";
import { readSavedPosition, siteGeocodingAddress, summarizeSiteLocations } from "./src/lib/site-location.js";

function parseExtra(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* Fail closed rather than overwriting malformed metadata. */ }
  throw new Error("Site location audit found invalid record metadata.");
}

function siteRecord(row) {
  return { ...parseExtra(row.extra_json), id: row.id, customerId: row.customer_id, address: row.address };
}

export function readSiteLocationWorkspace(db) {
  const rows = db.prepare("SELECT id, customer_id, address, extra_json FROM sites ORDER BY id").all();
  const customers = new Map();
  for (const row of rows) {
    if (!customers.has(row.customer_id)) customers.set(row.customer_id, { id: row.customer_id, sites: [] });
    customers.get(row.customer_id).sites.push(siteRecord(row));
  }
  const jobs = db.prepare("SELECT id, customer_id, job_address, extra_json FROM jobs ORDER BY id").all()
    .map((row) => ({ ...parseExtra(row.extra_json), id: row.id, customerId: row.customer_id, jobAddress: row.job_address }));
  return { customers: [...customers.values()], jobs, rows };
}

export function auditSiteLocations(db) {
  const { customers, jobs } = readSiteLocationWorkspace(db);
  const coordinateFieldPresence = {};
  for (const site of customers.flatMap((customer) => customer.sites)) {
    for (const [prefix, record] of [["", site], ["location.", site.location]]) {
      for (const key of ["latitude", "longitude", "lat", "lng", "lon"]) {
        if (Object.hasOwn(record || {}, key)) coordinateFieldPresence[prefix + key] = (coordinateFieldPresence[prefix + key] || 0) + 1;
      }
    }
  }
  return { schemaVersion: db.pragma("user_version", { simple: true }), ...summarizeSiteLocations(customers, jobs), coordinateFieldPresence };
}

const fingerprint = (site) => createHash("sha256").update(siteGeocodingAddress(site).replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");
const failure = (code, stop = false) => Object.assign(new Error(code), { code, stop });
const safeCodes = new Set(["ZERO_RESULTS", "MULTIPLE_RESULTS", "PARTIAL_MATCH", "IMPRECISE_RESULT", "OUTSIDE_AU", "INVALID_COORDINATES", "REQUEST_DENIED", "OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT", "INVALID_REQUEST", "NETWORK_ERROR"]);

export async function geocodeSiteAddress(address, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey?.trim()) throw failure("REQUEST_DENIED", true);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({ address, key: apiKey.trim(), components: "country:AU", region: "au", language: "en" }).toString();
  let response, payload;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (response.ok) payload = await response.json();
  } catch { throw failure("NETWORK_ERROR", true); }
  if (!response.ok) throw failure(response.status === 429 ? "OVER_QUERY_LIMIT" : [401, 403].includes(response.status) ? "REQUEST_DENIED" : "NETWORK_ERROR", true);
  if (payload.status !== "OK") {
    const code = safeCodes.has(payload.status) ? payload.status : "NETWORK_ERROR";
    throw failure(code, code !== "ZERO_RESULTS");
  }
  if (!Array.isArray(payload.results) || payload.results.length !== 1) throw failure("MULTIPLE_RESULTS");
  const result = payload.results[0];
  if (result.partial_match) throw failure("PARTIAL_MATCH");
  if (result.geometry?.location_type !== "ROOFTOP" || !result.types?.some((type) => ["street_address", "premise", "subpremise"].includes(type))) throw failure("IMPRECISE_RESULT");
  if (!result.address_components?.some((component) => component.types?.includes("country") && component.short_name === "AU")) throw failure("OUTSIDE_AU");
  const position = readSavedPosition(result.geometry.location);
  if (!position) throw failure("INVALID_COORDINATES");
  return position;
}

export async function backfillSiteCoordinates(db, { apply = false, limit = 25, retryFailed = false, apiKey, geocode, onProgress = () => {}, pause = () => new Promise((resolve) => setTimeout(resolve, 200)), now = () => new Date() } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Backfill limit must be an integer from 1 to 1000.");
  if (apply && !geocode && !apiKey?.trim()) throw new Error("GOOGLE_GEOCODING_API_KEY is required for an applied backfill. The browser Maps key is not used.");
  const { rows } = readSiteLocationWorkspace(db);
  const candidates = [];
  const summary = { mode: apply ? "apply" : "dry-run", totalSites: rows.length, alreadyLocated: 0, noAddress: 0, heldForReview: 0, eligibleSites: 0, selectedSites: 0, processed: 0, saved: 0, skippedChanged: 0, failed: 0, errors: {}, stopped: false };
  for (const row of rows) {
    const site = siteRecord(row);
    if (readSavedPosition(site)) { summary.alreadyLocated++; continue; }
    if (!siteGeocodingAddress(site)) { summary.noAddress++; continue; }
    const last = site.coordinateBackfill;
    if (!retryFailed && last?.status === "failed" && last.addressFingerprint === fingerprint(site)) { summary.heldForReview++; continue; }
    candidates.push(row);
  }
  summary.eligibleSites = candidates.length;
  summary.selectedSites = Math.min(candidates.length, limit);
  // Preview never invokes the provider, writes the database, or needs a key.
  if (!apply) return summary;
  const resolve = geocode || ((address) => geocodeSiteAddress(address, { apiKey }));
  const readCurrent = db.prepare("SELECT id, customer_id, address, extra_json FROM sites WHERE id = ?");
  const save = db.prepare("UPDATE sites SET extra_json = ? WHERE id = ? AND customer_id = ? AND address = ? AND extra_json = ?");
  for (const original of candidates.slice(0, limit)) {
    const row = readCurrent.get(original.id);
    summary.processed++;
    if (!row || row.address !== original.address || row.extra_json !== original.extra_json || row.customer_id !== original.customer_id) {
      summary.skippedChanged++;
      onProgress({ ...summary, errors: { ...summary.errors } });
      continue;
    }
    const site = siteRecord(row);
    let position = null, error = null;
    try {
      position = readSavedPosition(await resolve(siteGeocodingAddress(site)));
      if (!position) throw failure("INVALID_COORDINATES");
    } catch (caught) {
      // Never relay provider exception text, which could contain an address/key.
      error = { code: safeCodes.has(caught?.code) ? caught.code : "NETWORK_ERROR", stop: caught?.stop || !safeCodes.has(caught?.code) };
    }
    const next = { ...parseExtra(row.extra_json),
      ...(position ? { latitude: position.lat, longitude: position.lng } : {}),
      coordinateBackfill: { status: error ? "failed" : "saved", ...(error ? { code: error.code } : {}), addressFingerprint: fingerprint(site), attemptedAt: now().toISOString() },
    };
    // Compare-and-set: a concurrent address/metadata edit wins over this result.
    const { changes } = save.run(JSON.stringify(next), row.id, row.customer_id, row.address, row.extra_json);
    if (!changes) summary.skippedChanged++;
    else if (error) { summary.failed++; summary.errors[error.code] = (summary.errors[error.code] || 0) + 1; }
    else summary.saved++;
    summary.stopped = Boolean(error?.stop);
    onProgress({ ...summary, errors: { ...summary.errors } });
    if (summary.stopped) break;
    if (summary.processed < summary.selectedSites) await pause();
  }
  return summary;
}
