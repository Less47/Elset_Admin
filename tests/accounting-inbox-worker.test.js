import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { createAccountingInboxWorker, processAccountingInbox } from "../server-accounting-webhooks.js";
import { AccountingStore } from "../server-accounting-store.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { pendingQuickBooksCompany } from "../server-quickbooks-oauth.js";

function fixture(t, enabled = "xero") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "accounting-inbox-worker-"));
  const dbPath = path.join(directory, "workspace.db");
  const db = openWorkspaceDb({ dbPath });
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  updateWorkspaceAddons(db, { [enabled]: true });
  for (const provider of ["xero", "quickbooks"]) {
    const store = new AccountingStore(db, provider);
    store.ensureIntegration();
    store.update({ status: "CONNECTED", external_tenant_id: "fixture-tenant", granted_scopes: JSON.stringify(["accounting.payments.read", "com.intuit.quickbooks.accounting"]) });
    db.prepare(`INSERT INTO integration_webhook_events(id,provider,external_tenant_id,event_category,event_type,external_resource_id,event_sequence,event_date,received_at)
      VALUES(?,?,'fixture-tenant','INVOICE','UPDATE','unmapped-fixture','1','fixture','fixture')`).run(provider, provider);
  }
  const env = { ELSET_WORKSPACE_STORAGE: "sqlite", ELSET_WORKSPACE_DB_PATH: dbPath, QUICKBOOKS_ENVIRONMENT: "sandbox" };
  const logs = [];
  t.mock.method(console, "error", (...values) => logs.push(values));
  const worker = createAccountingInboxWorker({ env, fetchImpl() { assert.fail("Unmapped events must not call providers"); } });
  t.after(() => worker.stop());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tick = async (milliseconds = 0) => { t.mock.timers.tick(milliseconds); await setImmediate(); };
  return { db, env, worker, logs, tick };
}
const event = (db, id) => db.prepare("SELECT status,attempt_count,lease_owner,lease_until FROM integration_webhook_events WHERE id=?").get(id);

for (const failing of ["xero", "quickbooks"]) {
  test(`${failing} failure leaves the other provider operational and retries persisted events after recovery`, async (t) => {
    const healthy = failing === "xero" ? "quickbooks" : "xero";
    const { db, worker, logs, tick } = fixture(t, healthy);
    const secrets = "fixture-access-token fixture-verifier-token fixture-client-secret fixture-auth-code fixture-private-customer-body";
    db.exec(`CREATE TRIGGER fail_provider BEFORE UPDATE OF lease_owner ON integration_webhook_events
      WHEN OLD.provider='${failing}' AND NEW.status='PROCESSING' BEGIN SELECT RAISE(ABORT,'${secrets}'); END`);
    worker.start(); await tick();
    assert.deepEqual(event(db, healthy), { status: "IGNORED", attempt_count: 1, lease_owner: "", lease_until: 0 });
    assert.deepEqual(event(db, failing), { status: "PENDING", attempt_count: 0, lease_owner: "", lease_until: 0 });
    assert.equal(logs.length, 1); assert.match(logs[0][0], new RegExp(`${failing} inbox processing failed`));
    assert.equal(logs[0][1].type, "SqliteError");
    assert.ok(logs[0][1].locations.some((location) => location.startsWith("server-accounting-webhooks.js:")));
    for (const secret of secrets.split(" ")) assert.ok(!JSON.stringify(logs).includes(secret));
    await tick(59_999); assert.equal(logs.length, 1, "Broken provider must not spin on an overdue persisted row");
    db.exec("DROP TRIGGER fail_provider");
    // Demonstrate another event still runs for the healthy provider on the retry.
    db.prepare("UPDATE integration_webhook_events SET status='PENDING' WHERE id=?").run(healthy);
    await tick(1);
    assert.equal(event(db, failing).status, "PAUSED"); assert.equal(event(db, failing).attempt_count, 1);
    assert.equal(event(db, healthy).status, "IGNORED"); assert.equal(event(db, healthy).attempt_count, 2);
    assert.equal(logs.length, 1);
  });
}

test("missing lease column logs the real SQLite diagnostic and source locations for both providers", async (t) => {
  const { db, worker, logs, tick } = fixture(t);
  db.exec("ALTER TABLE integration_webhook_events DROP COLUMN lease_owner");
  worker.start(); await tick();
  assert.equal(logs.length, 2);
  for (const [index, provider] of ["xero", "quickbooks"].entries()) {
    assert.match(logs[index][0], new RegExp(`${provider} inbox processing failed`));
    assert.equal(logs[index][1].type, "SqliteError");
    assert.equal(logs[index][1].code, "SQLITE_ERROR");
    assert.equal(logs[index][1].message, "no such column: lease_owner");
    assert.ok(logs[index][1].locations.some((location) => location.startsWith("server-accounting-webhooks.js:")));
  }
  assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events WHERE status='PENDING' AND attempt_count=0").get().n, 2);
});

test("database-open failure produces safe diagnostics and retries after the database returns", async (t) => {
  const { db, env, worker, logs, tick } = fixture(t);
  const originalPath = env.ELSET_WORKSPACE_DB_PATH;
  env.ELSET_WORKSPACE_DB_PATH = path.join(path.dirname(originalPath), "fixture-private-payload-missing.db");
  worker.start(); await tick();
  assert.equal(logs.length, 1); assert.match(logs[0][0], /Inbox processing unavailable/);
  assert.ok(!JSON.stringify(logs).includes("fixture-private-payload"));
  env.ELSET_WORKSPACE_DB_PATH = originalPath;
  await tick(60_000);
  assert.equal(event(db, "xero").status, "IGNORED");
  assert.equal(event(db, "quickbooks").status, "PAUSED");
});

test("stored JSON failures log a safe message without credential or payload fragments", async (t) => {
  const { db, worker, logs, tick } = fixture(t);
  db.exec("UPDATE workspace_integrations SET granted_scopes='fixture-private-credential-and-customer-payload' WHERE provider='xero'");
  worker.start(); await tick();
  assert.equal(logs.length, 1); assert.equal(logs[0][1].type, "SyntaxError");
  assert.match(logs[0][1].message, /Invalid stored accounting JSON/);
  assert.ok(!JSON.stringify(logs).includes("fixture-private-credential-and-customer-payload"));
  assert.equal(event(db, "quickbooks").status, "PAUSED");
});

test("Xero ignores QuickBooks pending-company metadata, including malformed JSON", async (t) => {
  assert.equal(pendingQuickBooksCompany({ provider: { id: "xero" }, store: { integration() { assert.fail("Xero must not inspect QuickBooks metadata"); } } }), null);
  const { db, env } = fixture(t);
  db.exec("UPDATE workspace_integrations SET credential_metadata_json='malformed-fixture-json' WHERE provider='xero'; UPDATE integration_webhook_events SET status='PAUSED' WHERE provider='xero'");
  assert.equal(await processAccountingInbox(db, { providerId: "xero", env }), 1);
  assert.deepEqual(event(db, "xero"), { status: "IGNORED", attempt_count: 1, lease_owner: "", lease_until: 0 });
  assert.equal(event(db, "quickbooks").status, "PENDING");
});
