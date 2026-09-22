import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import Database from "better-sqlite3";
import { openWorkspaceDb, migrateWorkspaceSchema } from "../server-workspace-db.js";
import { insertInvoiceTree, addInvoicePayment, updateInvoicePayment, deleteInvoicePayment, deleteInvoiceForJob, restoreDeletedInvoice } from "../server-workspace-documents.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { AccountingService } from "../server-accounting-service.js";
import { createAccountingRouter } from "../server-accounting-routes.js";
import { createXeroMock } from "./helpers/xero-mock.js";
import { getCustomerAccountSummary } from "../server-customer-account.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { accountingSchemaSql } from "../server-accounting-schema.js";
import { persistXeroEvents, processXeroInbox, registerXeroWebhook, verifyXeroSignature, createXeroInboxWorker } from "../server-xero-webhooks.js";

async function fixture(t, { manual = 0, total = 1100, file = false } = {}) {
  const directory = file ? fs.mkdtempSync(path.join(os.tmpdir(), "xero-v2-")) : null;
  const dbPath = directory ? path.join(directory, "workspace.db") : ":memory:";
  const db = openWorkspaceDb({ dbPath });
  t.after(() => { if (db.open) db.close(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
  db.exec("INSERT INTO customers(id,name,created_at) VALUES('customer','Demo customer','2026-09-01'); INSERT INTO jobs(id,job_number,title,customer_id,status,created_at,updated_at) VALUES('job',1,'Demo invoice','customer','Completed','2026-09-01','2026-09-01')");
  insertInvoiceTree(db, "job", { id: "invoice", issueDate: "2026-09-01", dueDate: "2099-10-01", items: [{ description: "Work", qty: 1, rate: total / 1.1 }],
    sentHistory: [{ id: "sent", sentAt: "2026-09-01", toEmail: "demo@example.test" }], payments: manual ? [{ id: "manual", amount: manual, date: "2026-09-02" }] : [] });
  updateWorkspaceAddons(db, { xero: true });
  const mock = createXeroMock();
  const env = { NODE_ENV: "test", ELSET_WORKSPACE_STORAGE: "sqlite", ELSET_WORKSPACE_DB_PATH: dbPath, XERO_CLIENT_ID: "fixture", XERO_CLIENT_SECRET: "fixture-secret", XERO_REDIRECT_URI: "http://localhost:3101/api/integrations/xero/callback", XERO_WEBHOOK_KEY: "fixture-signing-key", ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  const service = new AccountingService(db, { env, fetchImpl: mock.fetch, authorizeOAuthInitiator: async () => true });
  await consent(service);
  await service.configure({ salesAccountId: "sales-id", taxMappings: { taxable: "OUTPUT" } });
  await service.syncInvoice("job");
  return { db, dbPath, mock, env, service };
}
async function consent(service) {
  const { url } = await service.connect("admin", "session");
  return service.callback({ state: new URL(url).searchParams.get("state"), code: "demo-code" }, "admin", "session");
}
function payments(mock, entries) {
  const invoice = mock.invoices[0];
  mock.payments = entries.map(([id, amount, status = "AUTHORISED"]) => ({ PaymentID: id, Amount: amount, Status: status,
    Invoice: { InvoiceID: invoice.InvoiceID }, Date: "/Date(1789344000000+0000)/", UpdatedDateUTC: "/Date(1789430400000+0000)/" }));
  invoice.Payments = mock.payments.filter((payment) => payment.Status === "AUTHORISED").map(({ PaymentID }) => ({ PaymentID }));
  invoice.AmountPaid = mock.payments.filter((payment) => payment.Status === "AUTHORISED").reduce((sum, payment) => sum + payment.Amount, 0);
  invoice.AmountDue = Math.round((invoice.Total - invoice.AmountPaid) * 100) / 100;
  invoice.Status = invoice.AmountDue === 0 ? "PAID" : "AUTHORISED";
}
const paid = (db) => db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM payments").get().amount;
const history = (db) => db.prepare("SELECT * FROM integration_sync_log WHERE entity_type='invoice-payment'").all();
const envelope = (mock, overrides = {}, sequence = 1) => ({ firstEventSequence: sequence, lastEventSequence: sequence, entropy: "fixture",
  events: [{ tenantId: "tenant-demo", tenantType: "ORGANISATION", resourceId: mock.invoices[0].InvoiceID, resourceUrl: "https://untrusted.example/ignored", eventCategory: "INVOICE", eventType: "UPDATE", eventDateUtc: "2026-09-18T00:00:00Z", ...overrides }] });

test("partial/full/multiple payments use normal balances and status, repeat sync does not duplicate history", async (t) => {
  const { db, mock, service } = await fixture(t);
  payments(mock, [["one", 500]]);
  const partial = await service.syncPayments("job");
  assert.equal(paid(db), 50000);
  assert.equal(partial.invoice.payments[0].source, "xero");
  assert.equal(getCustomerAccountSummary(db, "customer").outstandingCents, 60000);
  assert.equal(getCustomerAccountSummary(db, "customer").invoices[0].status.id, "deposit-paid");
  const count = history(db).length;
  await service.syncPayments("job");
  assert.equal(history(db).length, count);
  payments(mock, [["one", 300], ["two", 400], ["three", 400]]);
  await service.syncPayments("job");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM integration_external_payments").get().n, 3);
  assert.equal(paid(db), 110000);
  assert.equal(getCustomerAccountSummary(db, "customer").outstandingCents, 0);
  assert.equal(service.invoiceStatus("job").paymentSync.status, "SYNCED");
  assert.ok(history(db).some((row) => row.operation === "invoice-paid"));
  assert.equal(mock.calls.filter((call) => call.url.includes("/Payments") && call.method !== "GET").length, 0);
});

test("correction 5000 to 500 updates same row; removed payment stops counting and retains evidence", async (t) => {
  const { db, mock, service } = await fixture(t, { total: 5500 });
  payments(mock, [["one", 5000]]); await service.syncPayments("job");
  const id = db.prepare("SELECT id FROM payments").get().id;
  payments(mock, [["one", 500]]); await service.syncPayments("job");
  assert.equal(paid(db), 50000); assert.equal(db.prepare("SELECT id FROM payments").get().id, id);
  assert.ok(history(db).some((row) => row.safe_error_message.includes("$5000.00 to $500.00")));
  payments(mock, [["one", 500, "DELETED"]]); await service.syncPayments("job");
  assert.equal(paid(db), 0);
  assert.equal(db.prepare("SELECT status FROM integration_external_payments").get().status, "REMOVED");
  assert.ok(history(db).some((row) => row.operation === "payment-removed"));
  const count = history(db).length; await service.syncPayments("job"); assert.equal(history(db).length, count);
  payments(mock, [["one", 500]]); await service.syncPayments("job");
  assert.equal(db.prepare("SELECT id FROM payments").get().id, id);
});

for (const amount of [500, 300]) test(`historical manual ${amount} versus Xero 500 requires review without double counting/deletion`, async (t) => {
  const { db, mock, service } = await fixture(t, { manual: amount });
  payments(mock, [["one", 500]]);
  const original = db.prepare("SELECT * FROM payments").all();
  await assert.rejects(service.syncPayments("job"), { code: "MANUAL_PAYMENT_CONFLICT" });
  assert.deepEqual(db.prepare("SELECT * FROM payments").all(), original);
  assert.equal(service.invoiceStatus("job").paymentSync.status, "CONFLICT");
  const count = history(db).length; await assert.rejects(service.syncPayments("job")); assert.equal(history(db).length, count);
  assert.throws(() => addInvoicePayment(db, "job", { id: "new", amount: 1 }), { code: "PAYMENTS_MANAGED_EXTERNALLY" });
  assert.throws(() => updateInvoicePayment(db, "job", "manual", { amount: 1 }), { code: "PAYMENTS_MANAGED_EXTERNALLY" });
  assert.throws(() => deleteInvoicePayment(db, "job", "manual"), { code: "PAYMENTS_MANAGED_EXTERNALLY" });
});

test("external payments cannot be changed through local CRUD, including after disconnect/disable", async (t) => {
  const { db, mock, service } = await fixture(t);
  payments(mock, [["one", 500]]); await service.syncPayments("job");
  const id = db.prepare("SELECT id FROM payments").get().id;
  await service.disconnect(); updateWorkspaceAddons(db, { xero: false });
  assert.throws(() => addInvoicePayment(db, "job", { id: "new", amount: 100 }), { code: "PAYMENTS_MANAGED_EXTERNALLY" });
  assert.throws(() => updateInvoicePayment(db, "job", id, { amount: 100 }), { code: "PAYMENTS_MANAGED_EXTERNALLY" });
  assert.throws(() => deleteInvoicePayment(db, "job", id), { code: "PAYMENTS_MANAGED_EXTERNALLY" });
  assert.equal(paid(db), 50000);
});

test("restoring an unpaid mapped invoice retains its mapping and payment ownership", async (t) => {
  const { db, mock, service } = await fixture(t);
  const mapping = service.store.mapping("tenant-demo", "invoice", "invoice");
  const { archiveId } = deleteInvoiceForJob(db, "job", { confirmSent: true });
  restoreDeletedInvoice(db, archiveId);
  assert.deepEqual(service.store.mapping("tenant-demo", "invoice", "invoice"), mapping);
  assert.equal(service.invoiceStatus("job").invoice.paymentManagement, "xero");
  payments(mock, [["one", 500]]); await service.syncPayments("job");
  assert.equal(paid(db), 50000);
});

for (const [label, change] of [
  ["total", (invoice) => { invoice.Total = 1600; }], ["void", (invoice) => { invoice.Status = "VOIDED"; }],
  ["number", (invoice) => { invoice.InvoiceNumber = "different"; }], ["contact", (invoice) => { invoice.Contact.ContactID = "other"; }],
  ["currency", (invoice) => { invoice.CurrencyCode = "USD"; }], ["credits", (invoice) => { invoice.AmountCredited = 1; }],
  ["unexpected status", (invoice) => { invoice.Status = "DRAFT"; }], ["incomplete amount", (invoice) => { delete invoice.AmountDue; }],
]) test(`${label} conflict preserves local invoice and financial rows`, async (t) => {
  const { db, mock, service } = await fixture(t); payments(mock, [["one", 500]]);
  const before = loadWorkspaceStateFromDb(db); change(mock.invoices[0]);
  await assert.rejects(service.syncPayments("job"));
  assert.deepEqual(loadWorkspaceStateFromDb(db), before);
  assert.equal(service.invoiceStatus("job").paymentSync.status, "CONFLICT");
});

test("missing invoice, wrong tenant, revoked connection and insufficient scope fail safely", async (t) => {
  const { db, mock, service } = await fixture(t); payments(mock, [["one", 500]]);
  await assert.rejects(service.syncPayments("job", { expectedTenant: "other" }), { code: "TENANT_CHANGED" });
  const invoice = mock.invoices.pop(); await assert.rejects(service.syncPayments("job"), { code: "EXTERNAL_NOT_FOUND" }); mock.invoices.push(invoice);
  mock.failNext = { path: "/Payments", status: 403, headers: { "www-authenticate": 'Bearer error="insufficient_scope"' } };
  await assert.rejects(service.syncPayments("job"), { code: "PAYMENT_PERMISSION_REQUIRED" });
  assert.equal(service.status().paymentSync, "PAYMENT_PERMISSION_REQUIRED");
  const calls = mock.calls.length;
  await assert.rejects(service.syncPayments("job"), { code: "PAYMENT_PERMISSION_REQUIRED" }); assert.equal(mock.calls.length, calls);
  const config = service.status().config, mappings = db.prepare("SELECT * FROM integration_entity_mappings").all();
  mock.organisations.push({ id: "connection-other", tenantId: "tenant-other", tenantName: "Other demo", tenantType: "ORGANISATION" });
  await consent(service);
  assert.equal(service.status().paymentSync, "CONNECTED"); assert.equal(service.status().externalTenantId, "tenant-demo");
  assert.deepEqual(service.status().config, config); assert.deepEqual(db.prepare("SELECT * FROM integration_entity_mappings").all(), mappings);
  mock.failNext = { path: "/Invoices", status: 401 }; await assert.rejects(service.syncPayments("job"), { code: "NEEDS_REAUTHORIZATION" });
  assert.equal(paid(db), 0);
});

test("legacy invoice-only grants still permit V1 and rotating refresh before additive consent", async (t) => {
  const { service, mock } = await fixture(t);
  mock.scopes = mock.scopes.replace(" accounting.payments.read", "");
  service.store.update({ granted_scopes: JSON.stringify(mock.scopes.split(" ")), token_expires_at: 0 });
  await service.syncInvoice("job"); assert.equal(mock.refreshes, 1);
  assert.equal(service.status().paymentSync, "PAYMENT_PERMISSION_REQUIRED");
  mock.scopes += " accounting.payments.read"; await consent(service);
  assert.equal(service.status().paymentSync, "CONNECTED");
});

test("transaction rolls back all financial/history rows on insert failure; concurrent local edit fails safely", async (t) => {
  const { db, mock, service } = await fixture(t); payments(mock, [["one", 300], ["two", 400]]);
  db.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON payments WHEN NEW.amount_cents=40000 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(service.syncPayments("job"));
  assert.equal(paid(db), 0); assert.equal(db.prepare("SELECT count(*) n FROM integration_external_payments").get().n, 0);
  assert.ok(history(db).every((entry) => entry.status !== "SYNCED"));
  db.exec("DROP TRIGGER fail_payment");
  const original = service.provider.getPayment.bind(service.provider);
  service.provider.getPayment = async (...args) => { const result = await original(...args); db.prepare("UPDATE invoice_line_items SET rate_cents=200000").run(); return result; };
  await assert.rejects(service.syncPayments("job"), { code: "LOCAL_EDIT_CONFLICT" }); assert.equal(paid(db), 0);
});

test("payment IDs cannot cross invoice/workspace boundaries and data disagreement is rejected", async (t) => {
  const { db, mock, service } = await fixture(t); payments(mock, [["one", 500]]);
  mock.payments[0].Invoice.InvoiceID = "other";
  await assert.rejects(service.syncPayments("job")); assert.equal(paid(db), 0);
  mock.payments[0].Invoice.InvoiceID = mock.invoices[0].InvoiceID;
  mock.payments[0].Amount = 400; await assert.rejects(service.syncPayments("job"));
  mock.payments[0].Amount = 500;
  await service.syncPayments("job");
  db.prepare("UPDATE integration_external_payments SET invoice_id='another-invoice'").run();
  await assert.rejects(service.syncPayments("job"), { code: "PAYMENT_MAPPING_CONFLICT" }); assert.equal(paid(db), 50000);
});

test("raw webhook signatures, public intent validation, cookies and durable acknowledgement", async (t) => {
  const { db, mock, env } = await fixture(t, { file: true });
  let wakeCount = 0;
  const app = express(); registerXeroWebhook(app, { env, worker: { wake() { wakeCount++; } } }); app.use(express.json());
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/integrations/xero/webhook`;
  const raw = JSON.stringify(envelope(mock), null, 3), sign = (value) => crypto.createHmac("sha256", env.XERO_WEBHOOK_KEY).update(value).digest("base64");
  const call = (body, signature) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(signature ? { "x-xero-signature": signature } : {}) }, body });
  const calls = mock.calls.length;
  for (const signature of [undefined, sign("wrong"), sign(JSON.stringify(JSON.parse(raw)))]) assert.equal((await call(raw, signature)).status, 401);
  assert.equal(wakeCount, 0); assert.equal(mock.calls.length, calls); assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events").get().n, 0);
  assert.equal(verifyXeroSignature(Buffer.from(raw), sign(raw), env.XERO_WEBHOOK_KEY), true);
  const start = Date.now(), accepted = await call(raw, sign(raw));
  assert.equal(accepted.status, 200); assert.equal(accepted.headers.get("set-cookie"), null); assert.ok(Date.now() - start < 5000);
  assert.equal(mock.calls.length, calls); assert.equal(db.prepare("SELECT status FROM integration_webhook_events").get().status, "PENDING");
  await call(raw, sign(raw)); assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events").get().n, 1);
  const validation = JSON.stringify({ events: [], firstEventSequence: 0, lastEventSequence: 0, entropy: "test" });
  assert.equal((await call(validation, sign(validation))).status, 200);
  assert.equal((await call(validation, sign("wrong"))).status, 401);
});

test("inbox replay, unknown tenant/resource, retry-after and crash lease recovery", async (t) => {
  const { db, mock, env, service } = await fixture(t); payments(mock, [["one", 500]]);
  for (const body of [envelope(mock), envelope(mock), envelope(mock, { tenantId: "wrong" }, 2), envelope(mock, { resourceId: "unknown" }, 3), envelope(mock, { eventType: "CREATE" }, 4)]) persistXeroEvents(db, body);
  await processXeroInbox(db, { env, fetchImpl: mock.fetch }); assert.equal(paid(db), 50000);
  assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events WHERE status='PROCESSED'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events WHERE status='IGNORED'").get().n, 3);
  const count = history(db).length; persistXeroEvents(db, envelope(mock, {}, 5)); await processXeroInbox(db, { env, fetchImpl: mock.fetch }); assert.equal(history(db).length, count);
  persistXeroEvents(db, envelope(mock, {}, 6));
  mock.failNext = { path: "/Invoices", status: 429, headers: { "retry-after": "120" } };
  await processXeroInbox(db, { env, fetchImpl: mock.fetch });
  const pending = db.prepare("SELECT * FROM integration_webhook_events WHERE status='RETRYABLE'").get(); assert.ok(pending.retry_at > Date.now() + 110_000);
  const calls = mock.calls.length; await processXeroInbox(db, { env, fetchImpl: mock.fetch }); assert.equal(mock.calls.length, calls);
  service.store.update({ retry_after: 0 }); db.prepare("UPDATE integration_webhook_events SET status='PROCESSING',lease_until=0 WHERE id=?").run(pending.id);
  await processXeroInbox(db, { env, fetchImpl: mock.fetch }); assert.equal(db.prepare("SELECT status FROM integration_webhook_events WHERE id=?").get(pending.id).status, "PROCESSED");
  persistXeroEvents(db, envelope(mock, {}, 7));
  db.prepare("UPDATE integration_webhook_events SET status='PROCESSING',attempt_count=8,lease_until=0 WHERE status='PENDING'").run();
  const exhaustedCalls = mock.calls.length;
  await processXeroInbox(db, { env, fetchImpl: mock.fetch });
  assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events WHERE status='FAILED'").get().n, 1);
  assert.equal(mock.calls.length, exhaustedCalls);
});

test("startup worker consumes persisted events without a live webhook request", async (t) => {
  const { db, mock, env } = await fixture(t, { file: true }); payments(mock, [["one", 500]]); persistXeroEvents(db, envelope(mock));
  const worker = createXeroInboxWorker({ env, fetchImpl: mock.fetch }); t.after(() => worker.stop()); worker.start();
  for (let index = 0; index < 100 && paid(db) !== 50000; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(paid(db), 50000);
});

test("payment sync browser endpoint enforces auth, roles and origin", async (t) => {
  const { db, mock, env } = await fixture(t, { file: true }); payments(mock, [["one", 500]]);
  const app = express(); app.use(express.json()); app.use(createAccountingRouter({ env, fetchImpl: mock.fetch,
    requireAuth(req, res, next) { if (!req.get("test-role")) return res.status(401).end(); req.user = { id: "user", role: req.get("test-role") }; next(); },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).end(),
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/jobs/job/invoice/integrations/xero/sync-payments`;
  for (const [headers, status] of [[{}, 401], [{ "test-role": "technician" }, 403], [{ "test-role": "office" }, 403], [{ "test-role": "admin", "X-Accounting-Request": "1", "Sec-Fetch-Site": "cross-site" }, 403]]) {
    assert.equal((await fetch(url, { method: "POST", headers })).status, status);
  }
  assert.equal(paid(db), 0);
  assert.equal((await fetch(url, { method: "POST", headers: { "test-role": "office", "X-Accounting-Request": "1" } })).status, 200);
  assert.equal(paid(db), 50000);
});

test("genuine V1 schema 9 through 10 to latest preserves all records, rolls back atomically and only runs once", (t) => {
  const db = new Database(":memory:"); t.after(() => db.close());
  db.exec(fs.readFileSync(new URL("../fixtures/workspace-schema-v7.sql", import.meta.url), "utf8"));
  db.exec(fs.readFileSync(new URL("../server-workspace-db.js", import.meta.url), "utf8").match(/version: 8,[\s\S]*?sql: `([\s\S]*?)`/)[1]);
  db.exec("INSERT INTO workspace_schema_migrations VALUES(8,'optional-job-costing','2026-09-17');");
  db.exec(accountingSchemaSql); db.exec("INSERT INTO workspace_schema_migrations VALUES(9,'provider-neutral-accounting-integrations','2026-09-17'); PRAGMA user_version=9;");
  db.exec("INSERT INTO customers(id,name,created_at) VALUES('c','Customer','2026-09-01'); INSERT INTO jobs(id,title,customer_id,created_at,updated_at) VALUES('j','Job','c','2026-09-01','2026-09-01'); INSERT INTO invoices(id,job_id,created_at,updated_at) VALUES('i','j','2026-09-01','2026-09-01'); INSERT INTO payments(id,invoice_id,amount_cents,created_at) VALUES('p','i',50000,'2026-09-01');");
  const tables = ["customers", "jobs", "invoices", "payments", "integration_workspace", "workspace_integrations", "integration_entity_mappings"];
  const before = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  db.exec("CREATE TABLE integration_external_payments(collision TEXT)"); assert.throws(() => migrateWorkspaceSchema(db), /9 -> 10 failed/);
  assert.equal(db.pragma("user_version", { simple: true }), 9); assert.ok(!db.pragma("table_info(payments)").some((column) => column.name === "source"));
  db.exec("DROP TABLE integration_external_payments"); migrateWorkspaceSchema(db);
  for (const table of tables) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), table === "payments" ? before[table].map((row) => ({ ...row, source: "manual" })) : before[table]);
  migrateWorkspaceSchema(db); assert.equal(db.prepare("SELECT COUNT(*) n FROM workspace_schema_migrations WHERE version=10").get().n, 1);
  assert.equal(db.pragma("user_version", { simple: true }), 13);
});
