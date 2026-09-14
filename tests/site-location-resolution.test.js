import assert from "node:assert/strict";
import test from "node:test";
import { indexCustomerSites, resolveJobSiteLocation, readSavedPosition, siteGeocodingAddress, summarizeSiteLocations, siteAddressMetadata } from "../src/lib/site-location.js";
import { groupJobsByPosition } from "../src/components/map/google-map-data.js";

const customers = [{ id: "customer", address: "Main office", latitude: -30, longitude: 140, sites: [
  { id: "main", address: "Main office", latitude: -31, longitude: 141 },
  { id: "site", address: "14 Sesame Street", latitude: "-37.7305", longitude: "144.7428" },
  { id: "legacy", address: "Legacy address", location: { lat: -38, lon: 145 } },
  { id: "missing", address: "Address without coordinates" },
  { id: "invalid", address: "Invalid coordinates", latitude: 91, longitude: 145 },
] }];

test("explicit Site ID wins over stale Job address, customer and embedded coordinates", () => {
  const job = { customerId: "customer", siteId: "site", jobAddress: "Main office", latitude: -10, longitude: 100, site: { latitude: -20, longitude: 110 } };
  const result = resolveJobSiteLocation(job, indexCustomerSites(customers));
  assert.equal(result.site.id, "site");
  assert.equal(result.matchBy, "id");
  assert.deepEqual(result.position, { lat: -37.7305, lng: 144.7428 });
});

test("legacy Jobs resolve their own customer's normalized Site address", () => {
  const index = indexCustomerSites([...customers, { id: "other", sites: [{ id: "foreign", address: "Legacy address", lat: 1, lng: 2 }] }]);
  const result = resolveJobSiteLocation({ customerId: "customer", jobAddress: "  LEGACY   address " }, index);
  assert.equal(result.site.id, "legacy");
  assert.deepEqual(result.position, { lat: -38, lng: 145 });
  assert.equal(result.matchBy, "address");
  assert.equal(resolveJobSiteLocation({ customerId: "customer", siteId: "foreign", jobAddress: "Legacy address" }, index).site, null);
});

test("missing/invalid coordinates and unresolved or ambiguous Site links remain unmapped", () => {
  const index = indexCustomerSites([...customers, { id: "duplicate", sites: [{ id: "a", address: "Same" }, { id: "b", address: "Same", lat: 1, lng: 1 }] }]);
  for (const job of [
    { customerId: "customer", siteId: "missing" }, { customerId: "customer", siteId: "invalid" },
    { customerId: "customer", siteId: "deleted", jobAddress: "14 Sesame Street" },
    { customerId: "customer", jobAddress: "Unknown", latitude: -38, longitude: 145 },
    { customerId: "customer", jobAddress: "" }, { customerId: "duplicate", jobAddress: "Same" },
  ]) assert.equal(resolveJobSiteLocation(job, index).position, null);
  assert.equal(resolveJobSiteLocation({ customerId: "duplicate", jobAddress: "Same" }, index).reason, "ambiguous-site");
});

test("Google and legacy Site coordinate aliases normalize safely including zero and negative latitude", () => {
  for (const site of [{ latitude: "-37.8", longitude: "145" }, { lat: -37.8, lng: 145 }, { lat: "-37.8", lon: "145" }, { location: { latitude: -37.8, longitude: 145 } }]) {
    assert.deepEqual(readSavedPosition(site), { lat: -37.8, lng: 145 });
    assert.deepEqual(siteAddressMetadata(site), { latitude: -37.8, longitude: 145 });
  }
  assert.deepEqual(readSavedPosition({ latitude: 0, longitude: 0 }), { lat: 0, lng: 0 });
  for (const value of ["", " ", null, undefined, NaN, Infinity, true, 91]) assert.equal(readSavedPosition({ latitude: value, longitude: 145 }), null);
  assert.equal(readSavedPosition({ latitude: null, longitude: null, lat: -37.8, lon: 145 }), null);
});

test("several jobs share one Site position group and counts contain no private fields", () => {
  const jobs = [1, 2, 3].map((id) => ({ id, customerId: "customer", siteId: "site" }));
  jobs.push({ id: 4, customerId: "customer", siteId: "missing" });
  const index = indexCustomerSites(customers);
  const groups = groupJobsByPosition(jobs.map((job) => ({ ...job, position: resolveJobSiteLocation(job, index).position })));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].jobs.length, 3);
  const summary = summarizeSiteLocations(customers, jobs);
  assert.equal(summary.mappedJobs, 3);
  assert.equal(summary.unmappedJobs, 1);
  assert.equal(summary.uniqueSitesReferenced, 2);
  assert.equal(summary.sitesWithLegacyCoordinateFields, 1);
  assert.equal(JSON.stringify(summary).includes("Sesame"), false);
});

test("backfill uses full structured address or the formatted Site fallback", () => {
  assert.equal(siteGeocodingAddress({ streetAddress: "14 Sesame Street", suburb: "Caroline Springs", state: "VIC", postcode: "3023", address: "Old display" }), "14 Sesame Street, Caroline Springs VIC 3023");
  assert.equal(siteGeocodingAddress({ addressLine1: "14 Sesame Street", address: "14 Sesame Street, Caroline Springs VIC 3023" }), "14 Sesame Street, Caroline Springs VIC 3023");
  assert.equal(siteGeocodingAddress({ suburb: "Melbourne", state: "VIC", postcode: "3000" }), "");
});
