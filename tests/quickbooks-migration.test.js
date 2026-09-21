import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { accountingSchemaSql } from "../server-accounting-schema.js";
import { accountingPaymentSchemaSql } from "../server-accounting-payment-schema.js";
import { migrateWorkspaceSchema, openWorkspaceDb } from "../server-workspace-db.js";

test("committed schema 10 migrates once through 11 to 12, preserving Xero/business data and rolling back a late failure", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qbo-schema-")), dbPath = path.join(directory, "workspace.db");
  let db = new Database(dbPath);
  t.after(() => { if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  db.exec(fs.readFileSync(new URL("../fixtures/workspace-schema-v7.sql", import.meta.url), "utf8"));
  db.exec(fs.readFileSync(new URL("../server-workspace-db.js", import.meta.url), "utf8").match(/version: 8,[\s\S]*?sql: `([\s\S]*?)`/)[1]);
  db.exec("INSERT INTO workspace_schema_migrations VALUES(8,'optional-job-costing','fixture');");
  db.exec(accountingSchemaSql); db.exec("INSERT INTO workspace_schema_migrations VALUES(9,'provider-neutral-accounting-integrations','fixture');");
  db.exec(accountingPaymentSchemaSql); db.exec("INSERT INTO workspace_schema_migrations VALUES(10,'accounting-payment-reconciliation','fixture'); PRAGMA user_version=10;");
  db.exec(`INSERT INTO customers(id,name,created_at,extra_json) VALUES('c','Preserve customer','fixture','{"keep":true}');
    INSERT INTO jobs(id,title,customer_id,created_at,updated_at) VALUES('j','Preserve job','c','fixture','fixture');
    INSERT INTO invoices(id,job_id,created_at,updated_at) VALUES('i','j','fixture','fixture');
    INSERT INTO payments(id,invoice_id,amount_cents,created_at,source,extra_json) VALUES('manual','i',100,'fixture','manual','{"keep":1}'),('external','i',50000,'fixture','xero','{"keep":2}');
    INSERT INTO workspace_integrations(id,workspace_id,provider,external_tenant_id,encrypted_access_token,encrypted_refresh_token,config_json,created_at,updated_at)
      SELECT 'xero',workspace_id,'xero','tenant','existing-ciphertext','existing-refresh','{"taxMappings":{"taxable":"OUTPUT"}}','fixture','fixture' FROM integration_workspace;
    INSERT INTO integration_entity_mappings(id,workspace_id,provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id,external_fingerprint,created_at,updated_at)
      SELECT 'mapping',workspace_id,'xero','tenant','invoice','i','external-invoice','original-fingerprint','fixture','fixture' FROM integration_workspace;
    INSERT INTO integration_external_payments SELECT workspace_id,'xero','tenant','payment','i','external-invoice','external',50000,'2026-09-18','ACTIVE','fixture','fixture','fixture' FROM integration_workspace;
    INSERT INTO integration_invoice_payment_sync(invoice_id,workspace_id,provider,external_tenant_id,external_invoice_id,managed,status,updated_at)
      SELECT 'i',workspace_id,'xero','tenant','external-invoice',1,'SYNCED','fixture' FROM integration_workspace;
    INSERT INTO integration_webhook_events(id,provider,external_tenant_id,event_category,event_type,external_resource_id,event_sequence,event_date,received_at)
      VALUES('event','xero','tenant','INVOICE','UPDATE','external-invoice','1:1:0','fixture','fixture');`);
  const tables = ["customers", "jobs", "invoices", "payments", "workspace_integrations", "integration_entity_mappings", "integration_external_payments", "integration_invoice_payment_sync", "integration_webhook_events"];
  const before = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  db.exec("CREATE TRIGGER fail_v11 BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version=11 BEGIN SELECT RAISE(ABORT,'fixture late failure'); END");
  assert.throws(() => migrateWorkspaceSchema(db), /10 -> 11 failed/); assert.equal(db.pragma("user_version", { simple: true }), 10);
  for (const table of tables) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
  assert.ok(!db.pragma("table_info(workspace_integrations)").some((row) => row.name === "provider_environment"));
  db.exec("DROP TRIGGER fail_v11"); migrateWorkspaceSchema(db);
  for (const table of tables) {
    const columns = Object.keys(before[table][0]).join(",");
    assert.deepEqual(db.prepare(`SELECT ${columns} FROM ${table}`).all(), before[table], `${table} preserved`);
  }
  db.prepare("INSERT INTO payments(id,invoice_id,amount_cents,created_at,source) VALUES('quickbooks','i',50,'fixture','quickbooks')").run();
  assert.throws(() => db.prepare("INSERT INTO payments(id,invoice_id,created_at,source) VALUES('bad','i','fixture','unknown')").run(), /CHECK/);
  assert.deepEqual(db.pragma("foreign_key_check"), []); assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  db.close(); db = openWorkspaceDb({ dbPath });
  assert.equal(db.pragma("user_version", { simple: true }), 12); assert.equal(db.prepare("SELECT count(*) n FROM workspace_schema_migrations WHERE version=11").get().n, 1);
  assert.equal(db.prepare("SELECT encrypted_access_token FROM workspace_integrations").get().encrypted_access_token, "existing-ciphertext");
});
