import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getWorkspaceDbPath, openWorkspaceDb } from "../server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { auditSiteLocations, backfillGeocodingAddress, backfillSiteCoordinates, geocodeSiteAddress } from "../server-site-location-tools.js";
import { PRODUCTION_DB_PATH, openExistingBackfillDb, parseBackfillArgs, resolveProductionBackfillDb } from "../scripts/backfill-site-coordinates.mjs";

const pause = async () => {};
const position = { lat: -37.8, lng: 144.9 };
const precise = { types: ["street_address"], address_components: [{ types: ["country"], short_name: "AU" }], geometry: { location_type: "ROOFTOP", location: position } };
const response = (payload) => ({ ok: true, json: async () => payload });
const ok = () => response({ status: "OK", results: [precise] });
const rows = (db) => db.prepare("SELECT * FROM sites ORDER BY id").all();

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-coordinate-fixture-"));
  const dbPath = path.join(directory, "elset-workspace.db");
  const db = openWorkspaceDb({ dbPath });
  t.after(() => {
    if (db.open) db.close();
    // Every removal is a known fixture file under the directory created above.
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  });
  db.prepare("INSERT INTO customers(id,name,created_at) VALUES('customer','Synthetic customer','2026-09-15')").run();
  const insert = db.prepare("INSERT INTO sites(id,customer_id,address,notes,extra_json) VALUES(?,'customer',?,'Keep history',?)");
  const add = (id, metadata = {}, address = "10 Example Street, Melbourne VIC 3000") => insert.run(id, address, JSON.stringify(metadata));
  return { db, dbPath, add, directory };
}

test("production CLI requires an explicit mode and has no arbitrary database override", () => {
  assert.deepEqual(parseBackfillArgs(["--dry-run"]), { apply: false, limit: null, retryFailed: false });
  assert.deepEqual(parseBackfillArgs(["--execute", "--limit", "25", "--retry-failed"]), { apply: true, limit: 25, retryFailed: true });
  for (const args of [[], ["--execute", "--dry-run"], ["--execute", "--execute"], ["--dry-run", "--db", "copy.db"], ["--dry-run", "--limit", "0"], ["--execute", "--limit", "1001"], ["--dry-run", "--limit"], ["--execute", "--verbose"]]) {
    assert.throws(() => parseBackfillArgs(args), /Usage/);
  }
});

test("Fly preflight uses the normal resolver, prints the path before inspection, and rejects missing/wrong targets", () => {
  const env = { FLY_APP_NAME: "elset-admin", FLY_MACHINE_ID: "synthetic-machine", ELSET_DATA_DIR: "/app/data" };
  const expected = getWorkspaceDbPath(env);
  const events = [];
  const filesystem = {
    statSync: (target) => { events.push(`stat:${target}`); return { isFile: () => true }; },
    realpathSync: (target) => target,
  };
  const options = { env, platform: "linux", filesystem, output: (line) => events.push(line) };
  assert.equal(resolveProductionBackfillDb(options), path.resolve(PRODUCTION_DB_PATH));
  assert.equal(events[0], `Resolved workspace DB: ${expected}`);
  assert.equal(events[1], `stat:${expected}`);
  for (const override of [
    { platform: "win32" }, { env: { ...env, FLY_APP_NAME: "another-app" } }, { env: { ...env, FLY_MACHINE_ID: "" } },
    { env: { ...env, ELSET_WORKSPACE_DB_PATH: "/app/data/empty.db" } }, { env: { ...env, ELSET_DATA_DIR: "/tmp" } },
    { env: { ...env, ELSET_WORKSPACE_STORAGE: "json" } },
  ]) assert.throws(() => resolveProductionBackfillDb({ ...options, ...override }), /Refusing|inside the deployed/);
  for (const broken of [
    { statSync: () => { throw new Error("ENOENT"); } },
    { statSync: () => ({ isFile: () => false }) },
    { ...filesystem, realpathSync: () => "/tmp/unexpected.db" },
  ]) assert.throws(() => resolveProductionBackfillDb({ ...options, filesystem: broken }), /No database will be created/);
});

test("both modes refuse missing, empty, foreign and outdated databases without creating or migrating", (t) => {
  const { db, dbPath, directory } = fixture(t);
  db.close();
  const missing = path.join(directory, "missing.db");
  const empty = path.join(directory, "empty.db");
  fs.writeFileSync(empty, "");
  const foreignPath = path.join(directory, "foreign.db");
  const foreign = new Database(foreignPath);
  foreign.exec("CREATE TABLE unrelated (id INTEGER)");
  foreign.close();
  const old = new Database(dbPath);
  old.exec("DELETE FROM workspace_schema_migrations WHERE version=6; UPDATE workspace_info SET schema_version=5; PRAGMA user_version=5;");
  old.close();
  for (const apply of [false, true]) {
    assert.throws(() => openExistingBackfillDb(missing, { apply }), /Refusing/);
    assert.equal(fs.existsSync(missing), false);
    for (const target of [empty, foreignPath, dbPath]) {
      const before = fs.readFileSync(target);
      assert.throws(() => openExistingBackfillDb(target, { apply }), /Refusing/);
      assert.deepEqual(fs.readFileSync(target), before);
    }
  }
});

test("dry-run reads committed live WAL Sites, with no key, provider calls or database writes", async (t) => {
  const { db, dbPath, add } = fixture(t);
  add("mapped", { latitude: "-38", longitude: "145" });
  add("needs-coordinates");
  add("no-address", {}, "");
  const before = rows(db);
  const mainBefore = fs.readFileSync(dbPath), walBefore = fs.readFileSync(dbPath + "-wal");
  const reader = openExistingBackfillDb(dbPath);
  try {
    assert.equal(reader.readonly, true);
    assert.throws(() => reader.prepare("UPDATE sites SET notes='forbidden'").run(), /readonly/);
    const result = await backfillSiteCoordinates(reader, { limit: null, geocode: () => assert.fail("Dry run must not call Google") });
    assert.equal(result.totalSites, 3);
    assert.equal(result.alreadyLocated, 1);
    assert.equal(result.eligibleSites, 1);
    assert.equal(result.noAddress, 1);
    assert.deepEqual(rows(db), before);
    assert.deepEqual(fs.readFileSync(dbPath), mainBefore);
    assert.deepEqual(fs.readFileSync(dbPath + "-wal"), walBefore);
  } finally { reader.close(); }
});

test("coordinate backfill changes only two JSON keys, maps shared jobs and is idempotent", async (t) => {
  const { db, dbPath, add } = fixture(t);
  add("missing", { streetAddress: "10 Example Street", suburb: "Melbourne", state: "VIC", postcode: "3000", country: "Australia", placeId: "preserve-legacy-id", coordinateBackfill: { status: "historical" }, custom: { keep: true } });
  add("numeric", { latitude: "-90", longitude: "180" }, "20 Example Street, Melbourne VIC 3000");
  add("legacy", { location: { lat: "-38.1", lon: "145.2" } }, "30 Example Street, Melbourne VIC 3000");
  add("aliases", { lat: "-37", lng: "144" }, "40 Example Street, Melbourne VIC 3000");
  add("invalid", { latitude: "bad", longitude: 181 }, "50 Example Street, Melbourne VIC 3000");
  db.prepare("UPDATE sites SET extra_json=json_set(extra_json,'$.largeLegacyNumber',json('9007199254740993')) WHERE id='missing'").run();
  const insertJob = db.prepare("INSERT INTO jobs(id,title,customer_id,job_address,created_at,updated_at) VALUES(?,'Synthetic job','customer','10 Example Street, Melbourne VIC 3000','2026-09-15','2026-09-15')");
  for (let index = 0; index < 20; index++) insertJob.run(`job-${index}`);
  db.prepare("INSERT INTO site_assets(id,site_id,name) VALUES('asset','missing','Keep asset')").run();
  const snapshot = loadWorkspaceStateFromDb(db);
  const before = rows(db), jobs = db.prepare("SELECT * FROM jobs").all();
  const writer = openExistingBackfillDb(dbPath, { apply: true });
  try {
    let calls = 0;
    const result = await backfillSiteCoordinates(writer, { apply: true, limit: null, pause, geocode: async () => { calls++; return position; } });
    assert.equal(calls, 2);
    assert.equal(result.saved, 2);
    assert.equal(result.alreadyLocated, 3);
    assert.equal(auditSiteLocations(db).mappedJobs, 20);
    const after = rows(db);
    for (let index = 0; index < after.length; index++) {
      assert.deepEqual({ ...after[index], extra_json: before[index].extra_json }, before[index]);
      if (!["invalid", "missing"].includes(after[index].id)) assert.equal(after[index].extra_json, before[index].extra_json);
    }
    assert.deepEqual(db.prepare("SELECT * FROM jobs").all(), jobs);
    const metadata = JSON.parse(after.find((row) => row.id === "missing").extra_json);
    assert.equal(metadata.placeId, "preserve-legacy-id");
    assert.deepEqual(metadata.coordinateBackfill, { status: "historical" });
    assert.match(after.find((row) => row.id === "missing").extra_json, /9007199254740993/);
    const state = loadWorkspaceStateFromDb(db);
    assert.deepEqual(state.customers[0].sites.find((site) => site.id === "missing").assets, snapshot.customers[0].sites.find((site) => site.id === "missing").assets);
    const again = await backfillSiteCoordinates(writer, { apply: true, limit: null, pause, geocode: () => assert.fail("Second run must skip completed Sites") });
    assert.equal(again.selectedSites, 0);
  } finally { writer.close(); }
});

test("address builder prefers complete structured fields, preserves fallback and rejects obvious malformed input", () => {
  assert.equal(backfillGeocodingAddress({ address: "Historical address untouched", streetAddress: "10 Example St", suburb: "Richmond", state: "VIC", postcode: 3121 }), "10 Example St, Richmond VIC 3121, Australia");
  assert.equal(backfillGeocodingAddress({ address: "10 Example St, Richmond VIC 3121, Australia" }), "10 Example St, Richmond VIC 3121, Australia");
  assert.equal(backfillGeocodingAddress({ address: "10 Example St, Richmond", streetAddress: {} }), "10 Example St, Richmond, Australia");
  for (const site of [{ address: "???" }, { address: "Unknown address" }, { address: "Australia" }, { address: "1234567" }, { address: {} }, { address: "10 Example\u0000 St" }, { suburb: "Richmond", state: "VIC" }, { address: "10 Example Street", country: "NZ" }]) assert.equal(backfillGeocodingAddress(site), "");
});

test("malformed metadata and unusable addresses are skipped without writes or provider calls", async (t) => {
  const { db, add } = fixture(t);
  add("malformed");
  db.prepare("UPDATE sites SET extra_json='broken JSON' WHERE id='malformed'").run();
  add("placeholder", {}, "Unknown address");
  add("blank", {}, "");
  add("empty-metadata");
  db.prepare("UPDATE sites SET extra_json='' WHERE id='empty-metadata'").run();
  const before = rows(db);
  const result = await backfillSiteCoordinates(db, { apply: true, geocode: () => assert.fail("Unsafe inputs must be skipped") });
  assert.equal(result.invalidMetadata, 2);
  assert.equal(result.noAddress, 2);
  assert.equal(result.selectedSites, 0);
  assert.deepEqual(rows(db), before);
});

test("a second SQLite connection editing a Site during geocoding wins atomically", async (t) => {
  const { db, dbPath, add } = fixture(t);
  add("changed");
  const other = openExistingBackfillDb(dbPath, { apply: true });
  try {
    for (const sql of ["UPDATE sites SET address='Changed address'", "UPDATE sites SET extra_json='{\"latitude\":-38,\"longitude\":145}'", "UPDATE sites SET extra_json='{\"streetAddress\":\"New street\"}'", "DELETE FROM sites"]) {
      if (!rows(db).length) add("changed");
      db.prepare("UPDATE sites SET extra_json='{}'").run();
      let expected;
      const result = await backfillSiteCoordinates(db, { apply: true, pause, geocode: async () => {
        other.exec(sql); expected = rows(other); return position;
      } });
      assert.equal(result.saved, 0);
      assert.equal(result.skippedChanged, 1);
      assert.deepEqual(rows(db), expected);
    }
  } finally { other.close(); }
});

test("all Google address failures leave every field intact and continue to the next Site", async (t) => {
  const { db, add } = fixture(t);
  add("a"); add("b");
  for (const payload of [
    { status: "ZERO_RESULTS", results: [] }, { status: "INVALID_REQUEST" },
    { status: "OK", results: [precise, precise] },
    { status: "OK", results: [{ ...precise, partial_match: true }] },
    { status: "OK", results: [{ ...precise, geometry: { location_type: "RANGE_INTERPOLATED", location: position } }] },
  ]) {
    const before = rows(db);
    let calls = 0;
    const result = await backfillSiteCoordinates(db, { apply: true, pause, geocode: (address) => geocodeSiteAddress(address, { apiKey: "fake-server-key", pause, fetchImpl: async () => { calls++; return response(payload); } }) });
    assert.equal(result.failed, 2);
    assert.equal(result.stopped, false);
    assert.equal(calls, 2);
    assert.deepEqual(rows(db), before);
  }
});

test("transient network, HTTP 429/5xx and Google quota/server errors retry at 500 and 1000 ms", async () => {
  for (const transient of [
    () => { throw new Error("private address / fake-key"); }, () => ({ ok: false, status: 429 }), () => ({ ok: false, status: 503 }),
    () => response({ status: "OVER_QUERY_LIMIT" }), () => response({ status: "UNKNOWN_ERROR" }),
    () => ({ ok: true, json: async () => { throw new TypeError("Body connection lost with private details"); } }),
  ]) {
    let calls = 0;
    const delays = [];
    assert.deepEqual(await geocodeSiteAddress("10 Example Street", { apiKey: "fake", pause: async (delay) => delays.push(delay), fetchImpl: async () => ++calls < 3 ? transient() : ok() }), position);
    assert.equal(calls, 3);
    assert.deepEqual(delays, [500, 1000]);
    calls = 0;
    await assert.rejects(geocodeSiteAddress("10 Example Street", { apiKey: "fake", pause, fetchImpl: async () => { calls++; return transient(); } }));
    assert.equal(calls, 3);
  }
});

test("fatal provider errors stop safely, report aggregate errors and never persist response text", async (t) => {
  const { db, add } = fixture(t);
  add("a"); add("b");
  for (const payload of [{ status: "REQUEST_DENIED", error_message: "Private key/address" }, { status: "OVER_DAILY_LIMIT" }, null, { status: "OK", results: [null] }]) {
    const before = rows(db), progress = [];
    let calls = 0;
    const result = await backfillSiteCoordinates(db, { apply: true, pause, onProgress: (event) => progress.push(event), geocode: (address) => geocodeSiteAddress(address, { apiKey: "fake", pause, fetchImpl: async () => { calls++; return response(payload); } }) });
    assert.equal(result.stopped, true);
    assert.equal(result.failed, 1);
    assert.equal(result.processed, 1);
    assert.equal(calls, 1);
    assert.deepEqual(rows(db), before);
    assert.doesNotMatch(JSON.stringify([result, progress]), /Private|Example|fake/);
  }
});

test("execution paces Sites sequentially, honors limits and preserves old review markers", async (t) => {
  const { db, add } = fixture(t);
  const address = "10 Example Street, Melbourne VIC 3000";
  const addressFingerprint = createHash("sha256").update(address.toLowerCase()).digest("hex");
  add("held", { coordinateBackfill: { status: "failed", addressFingerprint, code: "ZERO_RESULTS" } });
  add("a"); add("b"); add("c");
  const events = [];
  const result = await backfillSiteCoordinates(db, { apply: true, limit: 2, pause: async (ms) => events.push(ms), geocode: async () => { events.push("geocode"); return position; } });
  assert.equal(result.heldForReview, 1);
  assert.equal(result.eligibleSites, 3);
  assert.equal(result.saved, 2);
  assert.deepEqual(events, ["geocode", 250, "geocode"]);
  const preview = await backfillSiteCoordinates(db, { retryFailed: true, limit: null });
  assert.equal(preview.selectedSites, 2);
  await assert.rejects(backfillSiteCoordinates(db, { apply: true, apiKey: "" }), /GOOGLE_GEOCODING_API_KEY/);
});

test("invoking the production CLI on a developer PC refuses without reading local Sites", () => {
  const script = fileURLToPath(new URL("../scripts/backfill-site-coordinates.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--dry-run"], {
    env: { ...process.env, FLY_APP_NAME: "", FLY_MACHINE_ID: "", GOOGLE_GEOCODING_API_KEY: "", ELSET_DATA_DIR: os.tmpdir() }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Resolved workspace DB:/);
  assert.match(result.stderr, /inside the deployed elset-admin Fly/);
  assert.doesNotMatch(result.stdout, /totalSites/);
});
