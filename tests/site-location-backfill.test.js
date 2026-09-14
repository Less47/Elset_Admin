import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { auditSiteLocations, backfillSiteCoordinates, geocodeSiteAddress } from "../server-site-location-tools.js";
import { siteLocationsCli } from "../scripts/site-locations.mjs";

function workspace() {
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  db.prepare("INSERT INTO customers(id,name,created_at) VALUES('customer','Private customer','2026-01-01')").run();
  const insert = db.prepare("INSERT INTO sites(id,customer_id,address,notes,extra_json) VALUES(?,'customer',?,'Keep notes',?)");
  insert.run("a", "Private first service address", JSON.stringify({ unrelated: "Keep metadata" }));
  insert.run("b", "Private second service address", "{}");
  insert.run("c", "Already located", JSON.stringify({ location: { lat: "-38", lon: "145" } }));
  for (let i = 0; i < 4; i++) db.prepare("INSERT INTO jobs(id,title,customer_id,job_address,created_at,updated_at) VALUES(?,'Private job','customer','Private first service address','2026-01-01','2026-01-01')").run(String(i));
  return db;
}
const sites = (db) => db.prepare("SELECT * FROM sites ORDER BY id").all();
const pause = async () => {};

test("CLI audit and default backfill leave an existing database unchanged and require no key", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-site-location-test-"));
  const dbPath = path.join(directory, "workspace.db");
  const db = workspace();
  try {
    await db.backup(dbPath);
    const before = fs.readFileSync(dbPath);
    const output = [];
    assert.equal(await siteLocationsCli(["audit", "--db", dbPath], { env: {}, output: (line) => output.push(line) }), 0);
    assert.equal(await siteLocationsCli(["backfill", "--db", dbPath], { env: {}, output: (line) => output.push(line) }), 0);
    assert.deepEqual(fs.readFileSync(dbPath), before);
    assert.equal(output.join("").includes("Private"), false);
    await assert.rejects(siteLocationsCli(["backfill", "--db", dbPath, "--apply"], { env: { VITE_GOOGLE_MAPS_API_KEY: "browser-key-is-not-accepted" } }), /GOOGLE_GEOCODING_API_KEY/);
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
    fs.rmdirSync(directory);
  }
});

test("audit and default backfill preview are aggregate-only, read-only and make no provider requests", async () => {
  const db = workspace();
  try {
    const before = sites(db);
    db.pragma("query_only = ON");
    const audit = auditSiteLocations(db);
    assert.equal(audit.totalJobs, 4);
    assert.equal(audit.uniqueSitesReferenced, 1);
    assert.equal(audit.sitesWithValidCoordinates, 1);
    assert.equal(audit.sitesWithAddressNoCoordinates, 2);
    assert.equal(audit.coordinateFieldPresence["location.lat"], 1);
    const preview = await backfillSiteCoordinates(db, { geocode: () => assert.fail("Preview cannot geocode") });
    assert.equal(preview.mode, "dry-run");
    assert.equal(preview.selectedSites, 2);
    assert.equal(JSON.stringify([audit, preview]).includes("Private"), false);
    assert.deepEqual(sites(db), before);
  } finally { db.close(); }
});

test("backfill skips Sites with no street or formatted address", async () => {
  const db = workspace();
  try {
    db.prepare("UPDATE sites SET address='', extra_json=? WHERE id IN ('a','b')").run(JSON.stringify({ suburb: "Melbourne", state: "VIC", postcode: "3000" }));
    const before = sites(db);
    const result = await backfillSiteCoordinates(db, { apply: true, geocode: () => assert.fail("Locality alone is not a Site address") });
    assert.equal(result.noAddress, 2);
    assert.equal(result.selectedSites, 0);
    assert.deepEqual(sites(db), before);
  } finally { db.close(); }
});

test("backfill geocodes unique missing Sites once, preserves data and skips valid legacy coordinates", async () => {
  const db = workspace();
  try {
    const before = sites(db);
    const jobsBefore = db.prepare("SELECT * FROM jobs").all();
    const calls = [], progress = [];
    const result = await backfillSiteCoordinates(db, { apply: true, pause, onProgress: (event) => progress.push(event), geocode: async (address) => { calls.push(address); return { lat: -37.8, lng: 144.9 }; } });
    assert.equal(calls.length, 2);
    assert.equal(result.saved, 2);
    assert.equal(auditSiteLocations(db).mappedJobs, 4);
    const after = sites(db);
    for (let i = 0; i < after.length; i++) assert.deepEqual({ ...after[i], extra_json: before[i].extra_json }, before[i]);
    assert.equal(JSON.parse(after[0].extra_json).unrelated, "Keep metadata");
    assert.equal(JSON.parse(after[0].extra_json).latitude, -37.8);
    assert.equal(after[2].extra_json, before[2].extra_json);
    assert.deepEqual(db.prepare("SELECT * FROM jobs").all(), jobsBefore);
    assert.equal(JSON.stringify(progress).includes("Private"), false);
    const again = await backfillSiteCoordinates(db, { apply: true, pause, geocode: () => assert.fail("Located Sites must not be geocoded again") });
    assert.equal(again.selectedSites, 0);
  } finally { db.close(); }
});

test("concurrent Site address or coordinate changes win over in-flight geocoding", async () => {
  for (const update of ["UPDATE sites SET address='Changed address' WHERE id='a'", "UPDATE sites SET extra_json='{\"latitude\":-39,\"longitude\":146}' WHERE id='a'"]) {
    const db = workspace();
    try {
      let expected;
      const result = await backfillSiteCoordinates(db, { apply: true, limit: 1, pause, geocode: async () => {
        db.exec(update); expected = sites(db)[0]; return { lat: -37.8, lng: 144.9 };
      } });
      assert.equal(result.saved, 0);
      assert.equal(result.skippedChanged, 1);
      assert.deepEqual(sites(db)[0], expected);
    } finally { db.close(); }
  }
});

test("failures are sanitized without writes, and fatal provider failures stop the batch", async () => {
  const db = workspace();
  try {
    const before = sites(db);
    let calls = 0;
    const failed = await backfillSiteCoordinates(db, { apply: true, pause, geocode: async () => { calls++; throw new Error("Private address and key must never be logged"); } });
    assert.equal(calls, 1);
    assert.equal(failed.stopped, true);
    assert.deepEqual(failed.errors, { NETWORK_ERROR: 1 });
    assert.equal(JSON.stringify(failed).includes("Private"), false);
    assert.deepEqual(sites(db), before);
    const preview = await backfillSiteCoordinates(db);
    assert.equal(preview.heldForReview, 0);
    assert.equal(preview.eligibleSites, 2);
    assert.equal((await backfillSiteCoordinates(db, { retryFailed: true })).eligibleSites, 2);
    db.prepare("UPDATE sites SET address='New service address' WHERE id='a'").run();
    assert.equal((await backfillSiteCoordinates(db)).eligibleSites, 2);
    await assert.rejects(backfillSiteCoordinates(db, { apply: true }), /GOOGLE_GEOCODING_API_KEY/);
  } finally { db.close(); }
});

const goodResult = { types: ["street_address"], address_components: [{ types: ["country"], short_name: "AU" }], geometry: { location_type: "ROOFTOP", location: { lat: -37.8, lng: 144.9 } } };
test("backfill provider accepts only one precise Australian result using a separate server key", async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url.origin, "https://maps.googleapis.com");
    assert.equal(url.searchParams.get("key"), "fake-server-key");
    assert.equal(url.searchParams.get("address"), "Private unit & street");
    assert.equal(url.searchParams.get("components"), "country:AU");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ status: "OK", results: [goodResult] }) };
  };
  assert.deepEqual(await geocodeSiteAddress("Private unit & street", { apiKey: "fake-server-key", fetchImpl }), { lat: -37.8, lng: 144.9 });
  assert.equal(calls, 1);
  for (const [payload, code] of [
    [{ status: "ZERO_RESULTS" }, "ZERO_RESULTS"], [{ status: "REQUEST_DENIED", error_message: "Private key" }, "REQUEST_DENIED"],
    [{ status: "OK", results: [goodResult, goodResult] }, "MULTIPLE_RESULTS"],
    [{ status: "OK", results: [{ ...goodResult, partial_match: true }] }, "PARTIAL_MATCH"],
    [{ status: "OK", results: [{ ...goodResult, geometry: { ...goodResult.geometry, location_type: "APPROXIMATE" } }] }, "IMPRECISE_RESULT"],
    [{ status: "OK", results: [{ ...goodResult, address_components: [] }] }, "OUTSIDE_AU"],
    [{ status: "OK", results: [{ ...goodResult, geometry: { ...goodResult.geometry, location: { lat: null, lng: 145 } } }] }, "INVALID_COORDINATES"],
  ]) await assert.rejects(geocodeSiteAddress("Private address", { apiKey: "fake", fetchImpl: async () => ({ ok: true, json: async () => payload }) }), { message: code });
});
