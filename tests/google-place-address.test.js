import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { googlePlaceAddress } from "../src/lib/google-place-address.js";
import { siteAddressMetadata, updatedSiteAddressMetadata, resolveJobMapPosition } from "../src/lib/site-location.js";
import { maintenancePlanName } from "../src/lib/maintenance-plan.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { createCustomer, createCustomerSite, updateCustomerSite, updateCustomer } from "../server-workspace-customers.js";

function place({ suburb = "Caroline Springs", suburbType = "locality", unit = "", route = "Sesame Street", postcode = "3023", state = "VIC" } = {}) {
  return { addressComponents: [
    ["street_number", "14"], ["route", route], [suburbType, suburb], ["subpremise", unit],
    ["administrative_area_level_1", state], ["postal_code", postcode], ["country", "Australia", "AU"],
  ].filter(([, value]) => value).map(([type, longText, shortText = longText]) => ({ types: [type], longText, shortText })),
  location: { lat: () => -37.7305, lng: () => 144.7428 } };
}

for (const suburb of ["Caroline Springs", "Brighton East", "South Melbourne"]) {
  test(`Places preserves the complete ${suburb} suburb and Maintenance display casing`, () => {
    const address = googlePlaceAddress(place({ suburb }));
    assert.equal(address.address, `14 Sesame Street, ${suburb} VIC 3023`);
    assert.equal(address.suburb, suburb);
    assert.equal(maintenancePlanName(address), `14 Sesame Street ${suburb.toUpperCase()}`);
    assert.deepEqual([address.latitude, address.longitude], [-37.7305, 144.7428]);
  });
}
test("unit, highway, locality fallback, state and leading-zero postcode are deliberate components", () => {
  const parsed = googlePlaceAddress(place({ unit: "4", route: "Princes Highway", suburb: "South Melbourne", suburbType: "postal_town", state: "Victoria", postcode: "0800" }));
  assert.equal(parsed.streetAddress, "Unit 4/14 Princes Highway");
  assert.equal(parsed.address, "Unit 4/14 Princes Highway, South Melbourne VIC 0800");
  assert.equal(parsed.postcode, "0800");
  assert.equal(googlePlaceAddress(place({ suburbType: "sublocality_level_1" })).suburb, "Caroline Springs");
});
test("non-Australian, incomplete and missing-geometry results never become saved locations", () => {
  const overseas = place(); overseas.addressComponents.at(-1).shortText = "US";
  assert.throws(() => googlePlaceAddress(overseas));
  assert.throws(() => googlePlaceAddress({ ...place(), location: null }));
  assert.throws(() => googlePlaceAddress({ ...place(), location: { lat: null, lng: null } }));
  assert.throws(() => googlePlaceAddress({ ...place(), addressComponents: [] }));
});
test("untouched Sites retain coordinates; material edits clear stale metadata; manual PO boxes remain possible", () => {
  const address = googlePlaceAddress(place());
  assert.deepEqual(updatedSiteAddressMetadata(address, { notes: "new note" }), siteAddressMetadata(address));
  assert.deepEqual(updatedSiteAddressMetadata(address, { address: `  ${address.address.toUpperCase()} ` }), siteAddressMetadata(address));
  const manual = updatedSiteAddressMetadata(address, { address: "PO Box 41, South Melbourne VIC 3205" });
  assert.equal(manual.latitude, null); assert.equal(manual.longitude, null);
  assert.equal(manual.suburb, ""); assert.equal(manual.streetAddress, "");
  assert.deepEqual(siteAddressMetadata({ address: "Legacy only" }), {});
  assert.deepEqual(siteAddressMetadata({ location: { lat: -38, lng: 145 } }), { latitude: -38, longitude: 145 });
});
test("the Google map prefers the current Site over stale cache/job coordinates and respects clearing", () => {
  const stale = { latitude: -38, longitude: 145 };
  const selected = googlePlaceAddress(place());
  assert.deepEqual(resolveJobMapPosition(stale, selected, stale), { lat: selected.latitude, lng: selected.longitude });
  assert.equal(resolveJobMapPosition(stale, { ...stale, latitude: null, longitude: null, location: stale }, null), null);
  assert.deepEqual(resolveJobMapPosition(stale, { address: "legacy" }, null), { lat: -38, lng: 145 });
});
test("SQLite saves primary/additional Sites and edits without losing coordinates, ownership, or unrelated data", () => {
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  try {
    importWorkspaceJsonData(db, JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8")));
    const before = loadWorkspaceStateFromDb(db);
    const selected = googlePlaceAddress(place());
    createCustomer(db, { id: "places-customer", name: "Places Fixture", address: selected.address,
      sites: [{ id: "places-primary", ...selected, notes: "Keep notes", ocNumber: "OC-FIXTURE" }] });
    updateCustomer(db, "places-customer", { name: "Edited account" });
    let customer = loadWorkspaceStateFromDb(db).customers.find((c) => c.id === "places-customer");
    assert.deepEqual(siteAddressMetadata(customer.sites[0]), siteAddressMetadata(selected));
    const second = googlePlaceAddress(place({ unit: "4" }));
    createCustomerSite(db, customer.id, { id: "places-secondary", ...second });
    const updated = googlePlaceAddress(place({ suburb: "Brighton East" }));
    updated.latitude = -37.91;
    updateCustomerSite(db, customer.id, "places-primary", updated);
    customer = loadWorkspaceStateFromDb(db).customers.find((c) => c.id === customer.id);
    assert.equal(customer.address, updated.address);
    assert.deepEqual(siteAddressMetadata(customer.sites.find((s) => s.id === "places-primary")), siteAddressMetadata(updated));
    assert.equal(customer.sites[0].ocNumber, "OC-FIXTURE");
    updateCustomerSite(db, customer.id, "places-primary", { address: "PO Box 4, South Melbourne VIC 3205" });
    const after = loadWorkspaceStateFromDb(db);
    const primary = after.customers.find((c) => c.id === customer.id).sites.find((s) => s.id === "places-primary");
    assert.equal(primary.latitude, null); assert.equal(primary.longitude, null);
    assert.deepEqual(after.customers.filter((c) => c.id !== customer.id), before.customers);
    for (const key of ["jobs", "maintenancePlans", "settings", "staff"]) assert.deepEqual(after[key], before[key]);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});
