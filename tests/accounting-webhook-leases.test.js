import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { accountingSchemaSql } from "../server-accounting-schema.js";
import { accountingV3SchemaSql } from "../server-accounting-v3-schema.js";
import { assertWorkspaceSchema, migrateWorkspaceSchema, openWorkspaceDb } from "../server-workspace-db.js";

function fixture(t, version, withLease) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "accounting-leases-"));
  const dbPath = path.join(directory, "workspace.db");
  const db = new Database(dbPath);
  t.after(() => { if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  db.exec(fs.readFileSync(new URL("../fixtures/workspace-schema-v7.sql", import.meta.url), "utf8"));
  db.exec(fs.readFileSync(new URL("../server-workspace-db.js", import.meta.url), "utf8").match(/version: 8,[\s\S]*?sql: `([\s\S]*?)`/)[1]);
  db.exec("INSERT INTO workspace_schema_migrations VALUES(8,'optional-job-costing','fixture');");
  db.exec(accountingSchemaSql);
  db.exec("INSERT INTO workspace_schema_migrations VALUES(9,'provider-neutral-accounting-integrations','fixture');");
  db.exec(fs.readFileSync(new URL("../fixtures/accounting-payment-schema-v10-without-leases.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO workspace_schema_migrations VALUES(10,'accounting-payment-reconciliation','fixture'); PRAGMA user_version=10;");
  if (withLease) db.exec("ALTER TABLE integration_webhook_events ADD COLUMN lease_owner TEXT NOT NULL DEFAULT ''");
  if (version === 11) {
    db.exec(accountingV3SchemaSql);
    db.exec("INSERT INTO workspace_schema_migrations VALUES(11,'accounting-online-provider-allocations','fixture'); PRAGMA user_version=11;");
  }
  db.exec(`
    INSERT INTO customers(id,name,created_at,extra_json) VALUES('customer','Preserve customer','fixture','{"keep":true}');
    INSERT INTO jobs(id,title,customer_id,created_at,updated_at) VALUES('job','Preserve job','customer','fixture','fixture');
    INSERT INTO invoices(id,job_id,created_at,updated_at) VALUES('invoice','job','fixture','fixture');
    INSERT INTO payments(id,invoice_id,amount_cents,created_at,source,extra_json)
      VALUES('manual','invoice',100,'fixture','manual','{"keep":1}'),('external','invoice',50000,'fixture','xero','{"keep":2}');
    INSERT INTO workspace_integrations(id,workspace_id,provider,external_tenant_id,encrypted_access_token,encrypted_refresh_token,created_at,updated_at)
      SELECT 'connection',workspace_id,'xero','tenant','fixture-ciphertext','fixture-refresh','fixture','fixture' FROM integration_workspace;
    INSERT INTO integration_entity_mappings(id,workspace_id,provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id,created_at,updated_at)
      SELECT 'invoice-mapping',workspace_id,'xero','tenant','invoice','invoice','external-invoice','fixture','fixture' FROM integration_workspace;
    INSERT INTO integration_entity_mappings(id,workspace_id,provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id,created_at,updated_at)
      SELECT 'customer-mapping',workspace_id,'xero','tenant','customer','customer','external-customer','fixture','fixture' FROM integration_workspace;
    INSERT INTO integration_external_payments(workspace_id,provider,external_tenant_id,external_payment_id,invoice_id,external_invoice_id,local_payment_id,amount_cents,payment_date,status,created_at,updated_at)
      SELECT workspace_id,'xero','tenant','payment','invoice','external-invoice','external',50000,'fixture','ACTIVE','fixture','fixture' FROM integration_workspace;
    INSERT INTO integration_invoice_payment_sync(invoice_id,workspace_id,provider,external_tenant_id,external_invoice_id,managed,status,updated_at)
      SELECT 'invoice',workspace_id,'xero','tenant','external-invoice',1,'SYNCED','fixture' FROM integration_workspace;
    INSERT INTO integration_sync_log(workspace_id,provider,entity_type,entity_id,operation,status,created_at)
      SELECT workspace_id,'xero','invoice','invoice','SYNC','SUCCESS','fixture' FROM integration_workspace;
    INSERT INTO integration_oauth_states(state_hash,workspace_id,provider,user_id,session_hash,expires_at)
      SELECT 'state',workspace_id,'xero','fixture-user','fixture-session',12345 FROM integration_workspace;
  `);
  for (const [id, provider, status] of [["pending", "xero", "PENDING"], ["retry", "quickbooks", "RETRYABLE"], ["processing", "xero", "PROCESSING"], ["done", "quickbooks", "PROCESSED"]]) {
    db.prepare(`INSERT INTO integration_webhook_events(id,provider,external_tenant_id,event_category,event_type,external_resource_id,event_sequence,event_date,status,attempt_count,retry_at,lease_until,received_at)
      VALUES(?,?,'tenant','INVOICE','UPDATE','external-invoice',?,'fixture',?,2,123,456,'fixture')`).run(id, provider, id, status);
  }
  if (withLease) db.exec("UPDATE integration_webhook_events SET lease_owner='existing-owner' WHERE id='processing'");
  return { db, dbPath };
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => ({ name, columns: db.pragma(`table_info(${quote(name)})`).map((row) => quote(row.name)).join(","),
      rows: db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all() }));
}
function assertPreserved(db, before, { migrated = false } = {}) {
  for (const { name, columns, rows } of before) {
    if (migrated && ["workspace_info", "workspace_schema_migrations"].includes(name)) continue;
    assert.deepEqual(db.prepare(`SELECT ${columns} FROM ${quote(name)} ORDER BY rowid`).all(), rows, `${name} rows preserved`);
  }
}
function assertLease(db) {
  const column = db.pragma("table_info(integration_webhook_events)").find((row) => row.name === "lease_owner");
  assert.ok(column);
  assert.equal(column.type, "TEXT"); assert.equal(column.notnull, 1); assert.equal(column.dflt_value, "''");
  assert.equal(db.pragma("user_version", { simple: true }), 12);
  assert.equal(db.prepare("SELECT schema_version FROM workspace_info").get().schema_version, 12);
  assert.deepEqual(db.prepare("SELECT version,name FROM workspace_schema_migrations WHERE version=12").all(), [{ version: 12, name: "accounting-webhook-event-leases" }]);
  assert.deepEqual(assertWorkspaceSchema(db), { schemaVersion: 12 });
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
}

for (const version of [10, 11]) for (const withLease of [false, true]) {
  test(`schema ${version} ${withLease ? "with an existing lease owner" : "without lease_owner"} upgrades atomically and preserves every record`, (t) => {
    const { db, dbPath } = fixture(t, version, withLease);
    const before = snapshot(db);
    const columnsBefore = db.pragma("table_info(integration_webhook_events)");
    db.exec("CREATE TRIGGER fail_v12 BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version=12 BEGIN SELECT RAISE(ABORT,'fixture late failure'); END");
    assert.throws(() => migrateWorkspaceSchema(db), /11 -> 12 failed: fixture late failure/);
    assert.equal(db.pragma("user_version", { simple: true }), version);
    assert.deepEqual(db.pragma("table_info(integration_webhook_events)"), columnsBefore);
    assertPreserved(db, before);
    db.exec("DROP TRIGGER fail_v12");
    const applied = [];
    migrateWorkspaceSchema(db, { onMigration: ({ toVersion }) => applied.push(toVersion) });
    assert.deepEqual(applied, version === 10 ? [11, 12] : [12]);
    assertLease(db); assertPreserved(db, before, { migrated: true });
    assert.deepEqual(db.prepare("SELECT lease_owner FROM integration_webhook_events WHERE id='processing'").get(), { lease_owner: withLease ? "existing-owner" : "" });
    if (!withLease) assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events WHERE lease_owner=''").get().n, 4);
    const latest = snapshot(db);
    db.close();
    const reopened = openWorkspaceDb({ dbPath, migrate: true, fileMustExist: true });
    try { assertLease(reopened); assertPreserved(reopened, latest); }
    finally { reopened.close(); }
  });
}

test("fresh database applies versions 1 through 12 exactly once, then reopening performs no migration", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "accounting-leases-fresh-"));
  const dbPath = path.join(directory, "workspace.db");
  const db = new Database(dbPath);
  t.after(() => { if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const applied = [];
  migrateWorkspaceSchema(db, { onMigration: ({ toVersion }) => applied.push(toVersion) });
  assert.deepEqual(applied, Array.from({ length: 12 }, (_, index) => index + 1));
  assertLease(db);
  const before = snapshot(db);
  db.close();
  const reopened = openWorkspaceDb({ dbPath, migrate: true });
  try {
    migrateWorkspaceSchema(reopened, { onMigration() { assert.fail("Must not rerun migrations"); } });
    assertLease(reopened); assertPreserved(reopened, before);
  } finally { reopened.close(); }
});

test("current metadata with missing required lease_owner is rejected, including migrate=true reopen", (t) => {
  const { db, dbPath } = fixture(t, 11, false);
  migrateWorkspaceSchema(db);
  // Corrupt only this disposable fixture, retaining genuinely applied metadata.
  db.exec("ALTER TABLE integration_webhook_events DROP COLUMN lease_owner");
  assert.throws(() => assertWorkspaceSchema(db), /no such column: lease_owner/);
  const before = snapshot(db);
  assert.throws(() => migrateWorkspaceSchema(db), /no such column: lease_owner/);
  assertPreserved(db, before);
  db.close();
  assert.throws(() => openWorkspaceDb({ dbPath, migrate: true }), /no such column: lease_owner/);
});
