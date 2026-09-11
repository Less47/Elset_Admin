import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateWorkspaceSchema, openWorkspaceDb, readWorkspaceSchemaVersion } from "../server-workspace-db.js";
import { assertSqliteWorkspaceReady, getWorkspaceReadinessStatus, initializeWorkspaceStorage } from "../server-workspace-storage.js";
import { getMaintenanceOccurrences, scheduleMaintenancePlan, generateMaintenanceJob } from "../server-workspace-maintenance.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const historicalSchema = fs.readFileSync(new URL("../fixtures/workspace-schema-v4.sql", import.meta.url), "utf8");
const timestamp = "2026-01-01T00:00:00.000Z";
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

function insert(db, table, record) {
  const keys = Object.keys(record);
  db.prepare(`INSERT INTO ${quoteIdentifier(table)} (${keys.map(quoteIdentifier).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(record));
}

function seedRecords(db) {
  const created = { created_at: timestamp };
  const dated = { ...created, updated_at: timestamp };
  insert(db, "staff", { id: "tech", name: "Legacy Technician", ...created, extra_json: '{"userId":"account-42"}' });
  insert(db, "customers", { id: "customer", name: "Legacy Customer", address: "14 Sesame St, Caroline Springs VIC 3023", ...created, extra_json: '{"custom":"preserve"}' });
  insert(db, "sites", { id: "site", customer_id: "customer", address: "14 Sesame St, Caroline Springs VIC 3023", ...dated });
  insert(db, "customer_contacts", { id: "contact", customer_id: "customer", site_id: "site", name: "Legacy Contact", email: "legacy@example.test" });
  insert(db, "site_assets", { id: "asset", site_id: "site", name: "Entry Gate", ...dated });
  insert(db, "site_access_notes", { id: "access", customer_id: "customer", address: "14 Sesame St", notes: "Call on arrival" });
  insert(db, "maintenance_plans", { id: "plan", customer_id: "customer", plan_name: "Original plan snapshot", site_address: "14 Sesame St, Caroline Springs VIC 3023", frequency: "six-monthly", next_due_date: "2027-03-09", default_technician_id: "tech", contract_price_cents: 35000, ...dated,
    extra_json: JSON.stringify({ siteId: "site", active: true, contractPriceSet: true, recurrence: { segments: [{ id: "legacy-series", anchorDate: "2027-03-09", frequency: "six-monthly" }] }, customHistory: ["retain"] }) });
  insert(db, "maintenance_checklist_items", { id: "check", maintenance_plan_id: "plan", position: 1, text: "Inspect safety edge" });
  insert(db, "jobs", { id: "job", job_number: 123, title: "Existing Job", customer_id: "customer", assigned_technician_id: "tech", maintenance_plan_id: "plan", maintenance_due_date: "2026-09-09", ...dated });
  insert(db, "job_notes", { id: "note", job_id: "job", text: "Preserve service history", ...created });
  insert(db, "job_attachments", { id: "photo", job_id: "job", path: "uploads/legacy.png", ...created });
  insert(db, "quotes", { id: "quote", job_id: "job", notes: "Original quote", ...dated });
  insert(db, "quote_line_items", { id: "quote-item", quote_id: "quote", position: 1, description: "Gate service", qty_text: "1.25", quantity_micros: 1250000, rate_cents: 20000 });
  insert(db, "invoices", { id: "invoice", job_id: "job", notes: "Original invoice", ...dated });
  insert(db, "invoice_line_items", { id: "invoice-item", invoice_id: "invoice", position: 1, description: "Gate service", qty_text: "1.25", quantity_micros: 1250000, rate_cents: 20000 });
  insert(db, "payments", { id: "payment", invoice_id: "invoice", amount_cents: 15000, reference: "Legacy receipt", ...created });
  insert(db, "document_send_history", { id: "sent", document_kind: "invoice", invoice_id: "invoice", job_id: "job", sent_at: timestamp, job_snapshot_json: '{"title":"Historic snapshot"}' });
  insert(db, "inventory_items", { id: "part", name: "Gate controller", quantity_micros: 3000000, unit_cost_cents: 9500, ...dated });
  insert(db, "settings", { key: "accountReference", value_json: '{"userId":"account-42","themePreset":"elset"}', updated_at: timestamp });
  insert(db, "document_templates", { type: "invoice", company_name: "Legacy Company", updated_at: timestamp });
  insert(db, "deleted_records", { id: "archived-job", kind: "job", record_id: "old-job", deleted_at: timestamp, payload_json: '{"id":"old-job","keep":true}' });
  insert(db, "deleted_maintenance_plans", { id: "archived-plan", plan_id: "old-plan", deleted_at: timestamp, payload_json: '{"id":"old-plan"}' });
  insert(db, "deleted_inventory_items", { id: "archived-part", item_id: "old-part", deleted_at: timestamp, payload_json: '{"id":"old-part"}' });
  if (db.pragma("user_version", { simple: true }) >= 4) insert(db, "deleted_staff_members", { id: "archived-staff", staff_id: "old-staff", deleted_at: timestamp, payload_json: '{"id":"old-staff"}', assigned_job_ids_json: '["job"]', maintenance_plan_ids_json: '["plan"]' });
  insert(db, "service_m8_refs", { id: "external", entity_type: "customer", entity_id: "customer", service_m8_uuid: "legacy-external-reference" });
  db.prepare("UPDATE workspace_info SET imported_at = ?, source_json_sha256 = 'original-checksum', importer_version = 'legacy', meta_json = ? WHERE id = 1").run(timestamp, '{"accountReference":"account-42"}');
}

function withFixture(t, { version = 4, seed = true } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-schema-upgrade-"));
  t.after(() => {
    const target = path.resolve(tempDir);
    assert.ok(target.startsWith(path.join(os.tmpdir(), "elset-schema-upgrade-")));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const dbPath = path.join(tempDir, "elset-workspace.db");
  const db = new Database(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    db.transaction(() => {
      db.exec(version === 3 ? historicalSchema.split("-- Migration 4:")[0] : historicalSchema);
      if (seed) seedRecords(db);
    })();
  } finally { db.close(); }
  return { tempDir, dbPath, env: { NODE_ENV: "production", FLY_APP_NAME: "", ELSET_DATA_DIR: tempDir, ELSET_WORKSPACE_DB_PATH: dbPath, ELSET_WORKSPACE_STORAGE: "sqlite" } };
}

function inspect(dbPath, callback, readonly = true) {
  const db = new Database(dbPath, { readonly, fileMustExist: true });
  try { return callback(db); } finally { db.close(); }
}

function snapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM ${quoteIdentifier(name)} ORDER BY rowid`).all()]));
}

test("v5 invoice archive migration rolls back safely, preserves existing records and is idempotent", (t) => {
  const { dbPath, env } = withFixture(t);
  // Build the historical v5 schema without running the new archive migration.
  inspect(dbPath, (db) => db.exec(`
    CREATE TABLE maintenance_occurrence_exceptions (
      occurrence_key TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
      series_id TEXT NOT NULL, original_date TEXT NOT NULL, override_date TEXT NOT NULL DEFAULT '',
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, generated_job_id TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '', snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(plan_id, series_id, original_date)
    );
    CREATE INDEX idx_maintenance_exception_plan ON maintenance_occurrence_exceptions(plan_id);
    CREATE INDEX idx_maintenance_exception_date ON maintenance_occurrence_exceptions(override_date);
    CREATE UNIQUE INDEX idx_maintenance_exception_job ON maintenance_occurrence_exceptions(job_id) WHERE job_id IS NOT NULL;
    INSERT INTO maintenance_occurrence_exceptions (occurrence_key, plan_id, series_id, original_date, job_id, snapshot_json, created_at, updated_at)
      VALUES ('visit', 'plan', 'series', '2026-09-09', 'job', '{"keep":true}', '2026-01-01', '2026-01-01');
    INSERT INTO workspace_schema_migrations VALUES (5, 'maintenance-recurrence-exceptions', '2026-01-01');
    UPDATE workspace_info SET schema_version = 5; PRAGMA user_version = 5;
    CREATE TRIGGER fail_v6 BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version = 6 BEGIN SELECT RAISE(ABORT, 'injected archive migration failure'); END;
  `), false);
  const before = inspect(dbPath, snapshot);
  assert.throws(() => initializeWorkspaceStorage(env, { log() {} }), /5 -> 6 failed: injected archive migration failure/);
  assert.deepEqual(inspect(dbPath, snapshot), before);
  inspect(dbPath, (db) => db.exec("DROP TRIGGER fail_v6"), false);
  const logs = [];
  initializeWorkspaceStorage(env, { log: (line) => logs.push(line) });
  assert.deepEqual(logs, ["Workspace database schema: 5", "Migrating workspace schema 5 -> 6", "Workspace schema migration complete: 6"]);
  const after = inspect(dbPath, snapshot);
  for (const [table, rows] of Object.entries(before)) {
    if (table === "workspace_info") assert.deepEqual(after[table], rows.map((row) => ({ ...row, schema_version: 6 })));
    else if (table === "workspace_schema_migrations") assert.deepEqual(after[table].slice(0, 5), rows);
    else assert.deepEqual(after[table], rows, table);
  }
  assert.deepEqual(after.deleted_invoices, []);
  initializeWorkspaceStorage(env, { log() { assert.fail("No migration on restart"); } });
  assert.deepEqual(inspect(dbPath, snapshot), after);
});

test("production initialization upgrades genuine v4, preserves all existing rows, and restarts without writes", (t) => {
  const { tempDir, dbPath, env } = withFixture(t);
  const authPath = path.join(tempDir, "auth.db");
  const auth = new Database(authPath);
  auth.exec("CREATE TABLE user_ui_preferences (user_id TEXT PRIMARY KEY, preferences_json TEXT); INSERT INTO user_ui_preferences VALUES ('account-42', '{\"themePreset\":\"elset\"}');");
  auth.close();
  const authBefore = fs.readFileSync(authPath);
  const before = inspect(dbPath, snapshot);
  assert.equal(before.workspace_info[0].schema_version, 4);
  assert.equal(before.maintenance_occurrence_exceptions, undefined);
  assert.throws(() => assertSqliteWorkspaceReady(dbPath), /schema version 4 is not compatible with required version 6/);
  assert.equal(getWorkspaceReadinessStatus(env).ok, false);
  assert.equal(inspect(dbPath, readWorkspaceSchemaVersion), 4, "health checks must not migrate");
  const logs = [];
  assert.equal(initializeWorkspaceStorage(env, { log: (line) => logs.push(line) }).mode, "sqlite");
  assert.deepEqual(logs, ["Workspace database schema: 4", "Migrating workspace schema 4 -> 5", "Migrating workspace schema 5 -> 6", "Workspace schema migration complete: 6"]);
  assert.deepEqual(assertSqliteWorkspaceReady(dbPath), { schemaVersion: 6 });
  assert.equal(getWorkspaceReadinessStatus(env).ok, true);
  const after = inspect(dbPath, snapshot);
  for (const [table, rows] of Object.entries(before)) {
    if (table === "workspace_info") assert.deepEqual(after[table], rows.map((row) => ({ ...row, schema_version: 6 })));
    else if (table === "workspace_schema_migrations") assert.deepEqual(after[table].slice(0, 4), rows);
    else assert.deepEqual(after[table], rows, `unchanged ${table}`);
  }
  assert.equal(after.workspace_schema_migrations.length, 6);
  assert.deepEqual(after.maintenance_occurrence_exceptions, []);
  logs.length = 0;
  initializeWorkspaceStorage(env, { log: (line) => logs.push(line) });
  assert.deepEqual(logs, []);
  assert.deepEqual(inspect(dbPath, snapshot), after);
  assert.deepEqual(fs.readFileSync(authPath), authBefore);
});

test("supported v3 applies 3 -> 4 -> 5 -> 6 in order", (t) => {
  const { dbPath, env } = withFixture(t, { version: 3 });
  const logs = [];
  initializeWorkspaceStorage(env, { log: (line) => logs.push(line) });
  assert.deepEqual(logs, ["Workspace database schema: 3", "Migrating workspace schema 3 -> 4", "Migrating workspace schema 4 -> 5", "Migrating workspace schema 5 -> 6", "Workspace schema migration complete: 6"]);
  assert.equal(inspect(dbPath, readWorkspaceSchemaVersion), 6);
});

for (const version of [3, 4]) test(`failed v${version} upgrade rolls back DDL and all metadata; retry succeeds`, (t) => {
  const { dbPath, env } = withFixture(t, { version });
  inspect(dbPath, (db) => db.exec("CREATE TRIGGER fail_v5 BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version = 5 BEGIN SELECT RAISE(ABORT, 'injected migration ledger failure'); END;"), false);
  const before = inspect(dbPath, snapshot);
  const logs = [];
  assert.throws(() => initializeWorkspaceStorage(env, { log: (line) => logs.push(line) }), /Workspace schema migration 4 -> 5 failed: injected migration ledger failure/);
  assert.deepEqual(inspect(dbPath, snapshot), before);
  assert.equal(inspect(dbPath, readWorkspaceSchemaVersion), version);
  assert.ok(!logs.some((line) => line.includes("migration complete")));
  inspect(dbPath, (db) => {
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name LIKE '%maintenance_exception%' OR name = 'maintenance_occurrence_exceptions'").get().n, 0);
    if (version === 3) assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name = 'deleted_staff_members'").get().n, 0);
    db.exec("DROP TRIGGER fail_v5");
  }, false);
  initializeWorkspaceStorage(env, { log() {} });
  assert.deepEqual(assertSqliteWorkspaceReady(dbPath), { schemaVersion: 6 });
});

const invalidSchemas = [
  ["newer metadata", "UPDATE workspace_info SET schema_version = 7", /newer than required version 6/],
  ["newer user_version", "PRAGMA user_version = 7", /refusing to downgrade/],
  ["newer migration ledger", "INSERT INTO workspace_schema_migrations VALUES (7, 'future', '2026-01-01')", /refusing to downgrade/],
  ["missing intermediate migration", "DELETE FROM workspace_schema_migrations WHERE version = 2", /metadata is inconsistent/],
  ["mismatched metadata", "UPDATE workspace_info SET schema_version = 3", /metadata is inconsistent/],
  ["missing metadata row", "DELETE FROM workspace_info", /metadata is inconsistent/],
  ["missing ledger", "DROP TABLE workspace_schema_migrations", /metadata is missing/],
];
for (const [name, sql, expected] of invalidSchemas) test(`startup rejects ${name} without modifying existing records`, (t) => {
  const { dbPath, env } = withFixture(t);
  inspect(dbPath, (db) => db.exec(sql), false);
  const before = inspect(dbPath, snapshot);
  const userVersion = inspect(dbPath, (db) => db.pragma("user_version", { simple: true }));
  assert.throws(() => initializeWorkspaceStorage(env, { log() {} }), expected);
  assert.deepEqual(inspect(dbPath, snapshot), before);
  assert.equal(inspect(dbPath, (db) => db.pragma("user_version", { simple: true })), userVersion);
});

test("unknown non-workspace databases and damaged current schemas are refused", (t) => {
  const { tempDir, dbPath, env } = withFixture(t);
  const unknownPath = path.join(tempDir, "unknown.db");
  const unknown = new Database(unknownPath);
  unknown.exec("CREATE TABLE unrelated (id INTEGER)"); unknown.close();
  assert.throws(() => initializeWorkspaceStorage({ ...env, ELSET_WORKSPACE_DB_PATH: unknownPath }, { log() {} }), /unknown database/);
  assert.deepEqual(inspect(unknownPath, snapshot), { unrelated: [] });
  initializeWorkspaceStorage(env, { log() {} });
  inspect(dbPath, (db) => db.exec("DROP INDEX idx_maintenance_exception_job"), false);
  assert.throws(() => initializeWorkspaceStorage(env, { log() {} }), /missing required index idx_maintenance_exception_job/);
  assert.equal(getWorkspaceReadinessStatus(env).ok, false);
});

test("foreign-key failures prevent migration without changing the schema version", (t) => {
  const { dbPath, env } = withFixture(t);
  inspect(dbPath, (db) => { db.pragma("foreign_keys = OFF"); db.exec("UPDATE sites SET customer_id = 'missing-customer'"); }, false);
  const before = inspect(dbPath, snapshot);
  assert.throws(() => initializeWorkspaceStorage(env, { log() {} }), /foreign-key check failed/);
  assert.deepEqual(inspect(dbPath, snapshot), before);
});

test("fresh databases bootstrap to complete v6 metadata; missing production storage is not created", (t) => {
  const { tempDir, env } = withFixture(t);
  const freshPath = path.join(tempDir, "fresh.db");
  const fresh = openWorkspaceDb({ dbPath: freshPath });
  assert.equal(readWorkspaceSchemaVersion(fresh), 6);
  migrateWorkspaceSchema(fresh);
  fresh.close();
  assert.deepEqual(assertSqliteWorkspaceReady(freshPath), { schemaVersion: 6 });
  const missingPath = path.join(tempDir, "missing.db");
  assert.throws(() => initializeWorkspaceStorage({ ...env, ELSET_WORKSPACE_DB_PATH: missingPath }, { log() {} }), /database does not exist/);
  assert.equal(fs.existsSync(missingPath), false);
});

test("migrated plans can persist a single exception and generate a linked job using v5", (t) => {
  const { dbPath, env } = withFixture(t);
  initializeWorkspaceStorage(env, { log() {} });
  const db = openWorkspaceDb({ dbPath });
  try {
    const occurrence = getMaintenanceOccurrences(db, "2027-01-01", "2028-12-31")[1];
    scheduleMaintenancePlan(db, "plan", { occurrenceKey: occurrence.key, revision: occurrence.revision, scope: "occurrence", nextDueDate: "2027-09-16" });
    const visits = getMaintenanceOccurrences(db, "2027-01-01", "2028-12-31");
    assert.deepEqual(visits.map((entry) => entry.date), ["2027-03-09", "2027-09-16", "2028-03-09", "2028-09-09"]);
    const generated = generateMaintenanceJob(db, "plan", { occurrenceKey: visits[1].key, revision: visits[1].revision });
    assert.equal(generated.job.maintenancePlanId, "plan");
    assert.equal(generated.job.scheduledDate, "2027-09-16");
    assert.equal(db.prepare("SELECT job_id FROM maintenance_occurrence_exceptions WHERE occurrence_key = ?").get(occurrence.key).job_id, generated.job.id);
    assert.equal(loadWorkspaceStateFromDb(db).maintenancePlans[0].occurrenceExceptions[0].key, occurrence.key);
  } finally { db.close(); }
});

function startChild(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

test("concurrent initializers apply the migration only once", async (t) => {
  const { dbPath, env } = withFixture(t);
  const script = "const {initializeWorkspaceStorage}=await import('./server-workspace-storage.js'); initializeWorkspaceStorage();";
  const children = [startChild(["--input-type=module", "-e", script], env), startChild(["--input-type=module", "-e", script], env)];
  const results = await Promise.all(children.map(async ({ child, output }) => {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, output());
    return output();
  }));
  assert.equal(results.join("\n").match(/Migrating workspace schema 4 -> 5/g)?.length, 1);
  assert.deepEqual(assertSqliteWorkspaceReady(dbPath), { schemaVersion: 6 });
});

test("normal production server startup upgrades v4 before listening and serves healthy storage", { timeout: 20000 }, async (t) => {
  const { tempDir, dbPath, env } = withFixture(t);
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const { child, output } = startChild(["server.js"], { ...env, ELSET_AUTH_DB_PATH: path.join(tempDir, "auth.db"), BETTER_AUTH_SECRET: "isolated-workspace-upgrade-test-secret-123", BETTER_AUTH_URL: url, ELSET_FRONTEND_URL: url, ELSET_API_PORT: String(port), PORT: String(port) });
  try {
    let healthy = false;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
        const health = await response.json();
        healthy = response.ok && health.ok && health.storage.mode === "sqlite";
        if (healthy) break;
      } catch { /* Startup may still be initializing authentication. */ }
      await delay(50);
    }
    assert.ok(healthy, output());
    assert.match(output(), /Workspace schema migration complete: 6/);
    assert.ok(output().indexOf("Workspace schema migration complete: 6") < output().indexOf("Elset quote API listening"), output());
    assert.deepEqual(assertSqliteWorkspaceReady(dbPath), { schemaVersion: 6 });
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
});
