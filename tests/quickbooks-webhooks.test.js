import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import express from "express";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { insertInvoiceTree } from "../server-workspace-documents.js";
import { AccountingService } from "../server-accounting-service.js";
import { createAccountingInboxWorker } from "../server-accounting-webhooks.js";
import { parseQuickBooksEvents, persistQuickBooksEvents, registerQuickBooksWebhook } from "../server-quickbooks-webhooks.js";
import { getCustomerAccountSummary } from "../server-customer-account.js";
import { createQuickBooksMock } from "./helpers/quickbooks-mock.js";
import { quickBooksCloudEvent, quickBooksCloudEvents } from "./helpers/quickbooks-webhooks.js";

async function fixture(t, { connect = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qbo-cloudevents-"));
  const dbPath = path.join(directory, "workspace.db");
  let db = openWorkspaceDb({ dbPath });
  const workers = [], servers = [];
  t.after(async () => {
    for (const worker of workers) worker.stop?.();
    for (const server of servers) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (db.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const env = { NODE_ENV: "test", ELSET_WORKSPACE_STORAGE: "sqlite", ELSET_WORKSPACE_DB_PATH: dbPath,
    QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_CLIENT_ID: "fixture-client", QUICKBOOKS_CLIENT_SECRET: "fixture-secret",
    QUICKBOOKS_REDIRECT_URI: "http://localhost:3101/api/integrations/quickbooks/callback",
    QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: "fixture-verifier", ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  const mock = createQuickBooksMock();
  const service = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: mock.fetch, authorizeOAuthInitiator: async () => true });
  if (connect) {
    updateWorkspaceAddons(db, { quickbooks: true });
    db.exec(`INSERT INTO customers(id,name,created_at) VALUES('customer','Synthetic CloudEvents customer','fixture');
      INSERT INTO jobs(id,job_number,title,customer_id,status,created_at,updated_at) VALUES('job',42,'Synthetic CloudEvents invoice','customer','Completed','fixture','fixture')`);
    insertInvoiceTree(db, "job", { id: "invoice", issueDate: "2026-09-21", dueDate: "2099-10-01",
      items: [{ description: "Service", qty: 1, rate: 1000 }], sentHistory: [{ id: "sent", sentAt: "2026-09-21", toEmail: "fixture@example.test" }] });
    const state = new URL((await service.connect("admin", "session")).url).searchParams.get("state");
    await service.callback({ state, code: "fixture-code", realmId: mock.realm });
    await service.configure({ itemId: "20", taxMappings: { taxable: "30" } });
    await service.syncInvoice("job");
  }
  return { get db() { return db; }, env, mock, service,
    reopen() { db.close(); db = openWorkspaceDb({ dbPath, migrate: false, fileMustExist: true }); },
    worker() { const worker = createAccountingInboxWorker({ env, fetchImpl: mock.fetch }); workers.push(worker); return worker; },
    async receiver(worker = { wake() {} }) {
      const app = express();
      registerQuickBooksWebhook(app, { env, worker });
      app.use(express.json());
      const server = app.listen(0, "127.0.0.1"); servers.push(server);
      await new Promise((resolve) => server.once("listening", resolve));
      return async (payload, options = {}) => {
        const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
        const signature = crypto.createHmac("sha256", options.signingKey || env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN).update(options.signedBody ?? body).digest("base64");
        return fetch(`http://127.0.0.1:${server.address().port}/api/integrations/quickbooks/webhook`, {
          method: "POST", signal: AbortSignal.timeout(2500), body,
          headers: { "Content-Type": options.contentType || "application/cloudevents+json", ...(options.missingSignature ? {} : { "intuit-signature": options.signature ?? signature }) },
        });
      };
    },
  };
}
const events = (db) => db.prepare("SELECT * FROM integration_webhook_events ORDER BY rowid").all();
const receipt = (db) => db.prepare("SELECT id,amount_cents,source FROM payments WHERE invoice_id='invoice'").all();
const paymentHistory = (db) => db.prepare("SELECT * FROM integration_sync_log WHERE entity_type='invoice-payment' ORDER BY id").all();
const eventRow = (db, eventId) => db.prepare("SELECT * FROM integration_webhook_events WHERE event_sequence=? AND external_tenant_id='123456789'").get(eventId);
async function waitFor(check) {
  const deadline = Date.now() + 2500;
  while (!check()) { if (Date.now() >= deadline) assert.fail("Timed out waiting for the durable worker"); await delay(10); }
}

test("documented CloudEvents fixture projects each event's routing metadata and preserves nanosecond timestamps", async (t) => {
  const f = await fixture(t);
  assert.equal(persistQuickBooksEvents(f.db, quickBooksCloudEvents), 6);
  const rows = events(f.db);
  for (const [index, input] of quickBooksCloudEvents.entries()) {
    assert.equal(rows[index].external_tenant_id, input.intuitaccountid);
    assert.equal(rows[index].external_resource_id, input.intuitentityid);
    assert.equal(rows[index].event_sequence, input.id);
    assert.equal(rows[index].event_date, input.time);
    assert.equal(rows[index].event_type, input.type);
    assert.equal(rows[index].provider, "quickbooks");
  }
  assert.deepEqual(rows.map((row) => row.event_category), ["PAYMENT", "PAYMENT", "PAYMENT", "INVOICE", "OTHER", "PAYMENT"]);
  assert.equal(rows[4].status, "IGNORED"); assert.ok(rows[4].processed_at);
  assert.notEqual(rows[0].id, rows[5].id, "Same event ID in different companies must not collide");
  assert.equal(persistQuickBooksEvents(f.db, quickBooksCloudEvents), 0);
  assert.deepEqual(events(f.db), rows);
  assert.equal(f.mock.calls.length, 0);
});

test("type routing is case tolerant, data is optional and neither data nor source is persisted", async (t) => {
  const f = await fixture(t);
  const input = quickBooksCloudEvent({ type: "QBO.Payment.UpDaTeD.V1", data: { private: "fixture-customer-payload" } });
  const normalized = parseQuickBooksEvents([input])[0];
  assert.equal(normalized.category, "PAYMENT"); assert.equal(normalized.type, "qbo.payment.updated.v1");
  assert.ok(!Object.hasOwn(normalized, "data"));
  assert.equal(persistQuickBooksEvents(f.db, [input]), 1);
  assert.ok(!JSON.stringify(events(f.db)).includes("fixture-customer-payload"));
  assert.ok(!JSON.stringify(events(f.db)).includes(input.source));
  const withoutData = quickBooksCloudEvent(); delete withoutData.data; delete withoutData.datacontenttype;
  assert.equal(persistQuickBooksEvents(f.db, [withoutData]), 1);
  assert.equal(persistQuickBooksEvents(f.db, [{ ...input, data: { private: "changed-fixture-body" }, time: "2026-09-22T00:00:00Z" }]), 0);
  assert.equal(events(f.db).length, 2, "Event identity must not depend on payload data or redelivery timestamp");
});

test("CloudEvents source scopes identity, while replays of older durable keys preserve their existing retry state", async (t) => {
  const f = await fixture(t);
  const first = quickBooksCloudEvent({ id: "same-event-id", source: "intuit.first-fixture-source" });
  const second = { ...first, source: "intuit.second-fixture-source" };
  assert.equal(persistQuickBooksEvents(f.db, [first, second]), 2);
  assert.equal(persistQuickBooksEvents(f.db, [first, second]), 0);
  assert.equal(events(f.db).length, 2);
  const old = quickBooksCloudEvent({ id: "earlier-inbox-event" });
  const oldId = crypto.createHash("sha256").update(JSON.stringify(["quickbooks", old.intuitaccountid, old.id])).digest("hex");
  f.db.prepare(`INSERT INTO integration_webhook_events(id,provider,external_tenant_id,event_category,event_type,external_resource_id,event_sequence,event_date,status,attempt_count,retry_at,received_at)
    VALUES(?,'quickbooks',?,'PAYMENT',?,?,?,?,'RETRYABLE',2,9999999999999,'fixture')`)
    .run(oldId, old.intuitaccountid, old.type, old.intuitentityid, old.id, old.time);
  const before = events(f.db);
  assert.equal(persistQuickBooksEvents(f.db, [old]), 0);
  assert.deepEqual(events(f.db), before, "Old rows must not be duplicated, rekeyed or have their retries reset");
});

test("signed Payment Created, Updated and Deleted automatically reconcile current API truth without writes to QBO", async (t) => {
  const f = await fixture(t, { connect: true });
  const worker = f.worker(), send = await f.receiver(worker), callsBefore = f.mock.calls.length;
  let localId;
  for (const [index, amount] of [500, 350, 0].entries()) {
    f.mock.setPayments(amount ? [{ id: "900", allocations: [[f.mock.invoices[0].Id, amount]] }] : []);
    const input = { ...quickBooksCloudEvents[index], data: { TotalAmt: 999999, Line: [{ Amount: 999999 }] } };
    assert.equal((await send([input])).status, 200);
    await waitFor(() => eventRow(f.db, input.id)?.status === "PROCESSED");
    const payments = receipt(f.db);
    if (amount) {
      assert.equal(payments.length, 1); assert.equal(payments[0].amount_cents, amount * 100); assert.equal(payments[0].source, "quickbooks");
      if (localId) assert.equal(payments[0].id, localId, "Correction must update the same local receipt");
      localId = payments[0].id;
    } else {
      assert.deepEqual(payments, []);
      assert.equal(f.db.prepare("SELECT status FROM integration_external_payments WHERE external_payment_id='900'").get().status, "REMOVED");
    }
    assert.equal(getCustomerAccountSummary(f.db, "customer").outstandingCents, 110000 - amount * 100);
    assert.equal(eventRow(f.db, input.id).attempt_count, 1);
    assert.equal(eventRow(f.db, input.id).lease_owner, "");
    const history = paymentHistory(f.db), calls = f.mock.calls.length;
    assert.equal((await send([input])).status, 200);
    assert.deepEqual(paymentHistory(f.db), history); assert.equal(f.mock.calls.length, calls);
    assert.equal(eventRow(f.db, input.id).attempt_count, 1);
  }
  assert.equal(events(f.db).length, 3);
  assert.ok(f.mock.calls.slice(callsBefore).some((call) => new URL(call.url).pathname.endsWith("/payment/900")));
  assert.ok(f.mock.calls.slice(callsBefore).every((call) => call.method === "GET"), "Webhook processing must not create or mutate QuickBooks invoices/payments");
});

test("Invoice events reconcile payments, and mixed-company batches never use another realm's credentials", async (t) => {
  const f = await fixture(t, { connect: true });
  f.mock.setPayments([{ id: "900", allocations: [[f.mock.invoices[0].Id, 250]] }]);
  const worker = f.worker(), send = await f.receiver(worker), callsBefore = f.mock.calls.length;
  const first = quickBooksCloudEvent({ type: "qbo.invoice.updated.v1", intuitentityid: f.mock.invoices[0].Id });
  const foreign = { ...first, intuitaccountid: "987654321" };
  assert.equal((await send([foreign, first])).status, 200);
  await waitFor(() => events(f.db).every((row) => ["PROCESSED", "IGNORED"].includes(row.status)));
  const rows = events(f.db); assert.equal(rows.length, 2);
  assert.equal(rows[0].external_tenant_id, "987654321"); assert.equal(rows[0].status, "IGNORED");
  assert.equal(rows[1].external_tenant_id, f.mock.realm); assert.equal(rows[1].status, "PROCESSED");
  assert.equal(receipt(f.db)[0].amount_cents, 25000);
  assert.equal(getCustomerAccountSummary(f.db, "customer").outstandingCents, 85000);
  assert.ok(f.mock.calls.slice(callsBefore).every((call) => new URL(call.url).pathname.startsWith(`/v3/company/${f.mock.realm}/`) && call.method === "GET"));
});

test("a changed Payment reconciles both its previous invoice and its new allocation", async (t) => {
  const f = await fixture(t, { connect: true });
  f.db.exec("INSERT INTO jobs(id,job_number,title,customer_id,status,created_at,updated_at) VALUES('job-b',43,'Second fixture invoice','customer','Completed','fixture','fixture')");
  insertInvoiceTree(f.db, "job-b", { id: "invoice-b", issueDate: "2026-09-21", dueDate: "2099-10-01", items: [{ description: "Service", qty: 1, rate: 1000 }], sentHistory: [{ id: "sent-b", sentAt: "2026-09-21", toEmail: "fixture@example.test" }] });
  await f.service.syncInvoice("job-b");
  const send = await f.receiver(f.worker());
  f.mock.setPayments([{ id: "900", allocations: [[f.mock.invoices[0].Id, 500]] }]);
  const created = quickBooksCloudEvent(); await send([created]);
  await waitFor(() => eventRow(f.db, created.id)?.status === "PROCESSED");
  f.mock.setPayments([{ id: "900", allocations: [[f.mock.invoices[1].Id, 350]] }]);
  const updated = quickBooksCloudEvent({ type: "qbo.payment.updated.v1" }); await send([updated]);
  await waitFor(() => eventRow(f.db, updated.id)?.status === "PROCESSED");
  assert.deepEqual(receipt(f.db), []);
  assert.equal(f.db.prepare("SELECT amount_cents FROM payments WHERE invoice_id='invoice-b'").get().amount_cents, 35000);
  assert.equal(getCustomerAccountSummary(f.db, "customer").outstandingCents, 185000);
});

test("all supported Invoice/Payment operations and case variants route; unknown types and versions are terminally ignored", async (t) => {
  const f = await fixture(t);
  for (const entity of ["invoice", "payment"]) for (const operation of ["created", "updated", "deleted", "voided"]) {
    const input = quickBooksCloudEvent({ type: `QBO.${entity}.${operation}.V1` });
    assert.equal(parseQuickBooksEvents([input])[0].category, entity.toUpperCase());
  }
  const send = await f.receiver(f.worker());
  const payload = ["qbo.customer.updated.v1", "qbo.unrecognized.created.v1", "qbo.payment.merged.v1", "qbo.payment.updated.v2"]
    .map((type) => quickBooksCloudEvent({ type, intuitentityid: "unknown-opaque-resource" }));
  assert.equal((await send(payload)).status, 200);
  assert.equal(events(f.db).length, 4);
  assert.ok(events(f.db).every((row) => row.status === "IGNORED" && row.attempt_count === 0 && row.processed_at));
  assert.equal(f.mock.calls.length, 0);
});

test("exact raw-body HMAC is checked before parsing, for JSON and CloudEvents content types", async (t) => {
  const f = await fixture(t);
  let wakes = 0; const send = await f.receiver({ wake() { wakes++; assert.equal(events(f.db).length, wakes); } });
  for (const contentType of ["application/json", "application/cloudevents+json", "application/cloudevents-batch+json"]) {
    const payload = [quickBooksCloudEvent()];
    const response = await send(payload, { contentType });
    assert.equal(response.status, 200); assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await send(payload, { contentType })).status, 200);
  }
  assert.equal(wakes, 3, "Duplicate deliveries must not add queue work or wake the worker again");
  const before = events(f.db);
  for (const options of [{ missingSignature: true }, { signature: "invalid" }, { signingKey: "wrong-fixture-verifier" }, { signedBody: "{ invalid body } " }]) {
    assert.equal((await send("{ invalid body }", options)).status, 401);
  }
  const original = JSON.stringify([quickBooksCloudEvent()]);
  assert.equal((await send(original + " ", { signedBody: original })).status, 401);
  assert.deepEqual(events(f.db), before); assert.equal(wakes, 3); assert.equal(f.mock.calls.length, 0);
});

test("malformed or legacy deliveries fail atomically without logging raw payloads or waking workers", async (t) => {
  const f = await fixture(t);
  let wakes = 0; const send = await f.receiver({ wake() { wakes++; } });
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args)); t.mock.method(console, "warn", (...args) => logs.push(args));
  const privateValue = "fixture-secret-token-and-private-customer-body";
  const invalidEvents = [null, {}, quickBooksCloudEvent({ specversion: "0.3" }), quickBooksCloudEvent({ source: "" }),
    quickBooksCloudEvent({ intuitaccountid: "not-a-company" }), quickBooksCloudEvent({ intuitaccountid: 123456789 }),
    quickBooksCloudEvent({ intuitentityid: "not-a-payment" }), quickBooksCloudEvent({ id: "" }), quickBooksCloudEvent({ time: "1" }),
    quickBooksCloudEvent({ time: "2026-09-21" }), quickBooksCloudEvent({ type: "" }), quickBooksCloudEvent({ datacontenttype: {} }),
    quickBooksCloudEvent({ id: "x".repeat(129) })];
  for (const invalid of invalidEvents) {
    assert.equal((await send([quickBooksCloudEvent({ data: { privateValue } }), invalid])).status, 400);
    assert.equal(events(f.db).length, 0);
  }
  const legacy = { eventNotifications: [{ realmId: "123456789", dataChangeEvent: { entities: [{ id: "900", name: "Payment", operation: "Create", lastUpdated: "2026-09-21T00:00:00Z" }] } }] };
  for (const invalid of [legacy, {}, quickBooksCloudEvent(), null, "", `{${privateValue}`, Array(1001).fill(null)]) {
    assert.equal((await send(invalid)).status, 400);
  }
  assert.equal((await send([quickBooksCloudEvent({ data: { large: "x".repeat(256 * 1024) } })])).status, 413);
  assert.equal(events(f.db).length, 0); assert.equal(wakes, 0);
  assert.ok(!JSON.stringify(logs).includes(privateValue)); assert.equal(f.mock.calls.length, 0);
});

test("a database failure returns 503 and rolls back the whole batch; redelivery persists once", async (t) => {
  const f = await fixture(t);
  let wakes = 0; const send = await f.receiver({ wake() { wakes++; } });
  const payload = [quickBooksCloudEvent({ id: "first" }), quickBooksCloudEvent({ id: "second" })];
  f.db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON integration_webhook_events WHEN NEW.event_sequence='second' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");
  assert.equal((await send(payload)).status, 503); assert.deepEqual(events(f.db), []); assert.equal(wakes, 0);
  f.db.exec("DROP TRIGGER fail_second");
  assert.equal((await send(payload)).status, 200); assert.equal(events(f.db).length, 2); assert.equal(wakes, 1);
  assert.equal((await send(payload)).status, 200); assert.equal(events(f.db).length, 2); assert.equal(wakes, 1);
});

test("a persisted signed delivery survives reopening and startup processes it without another webhook", async (t) => {
  const f = await fixture(t, { connect: true });
  f.mock.setPayments([{ id: "900", allocations: [[f.mock.invoices[0].Id, 450]] }]);
  const send = await f.receiver();
  const input = quickBooksCloudEvent();
  assert.equal((await send([input])).status, 200);
  assert.equal(eventRow(f.db, input.id).status, "PENDING"); assert.deepEqual(receipt(f.db), []);
  f.reopen();
  const worker = f.worker(); worker.start();
  await waitFor(() => eventRow(f.db, input.id)?.status === "PROCESSED");
  assert.equal(receipt(f.db)[0].amount_cents, 45000);
  assert.equal(getCustomerAccountSummary(f.db, "customer").outstandingCents, 65000);
  assert.equal(eventRow(f.db, input.id).attempt_count, 1);
});

test("HTTP acknowledgement does not wait for QuickBooks, and a provider failure retains a retryable durable event", async (t) => {
  const f = await fixture(t, { connect: true });
  f.mock.setPayments([{ id: "900", allocations: [[f.mock.invoices[0].Id, 500]] }]);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const worker = f.worker(), send = await f.receiver(worker);
  f.mock.failNext = { path: "/payment/900", status: 503, wait: blocked };
  const input = quickBooksCloudEvent();
  try {
    assert.equal((await send([input])).status, 200, "Receiver must ACK while the provider request is still blocked");
    await waitFor(() => eventRow(f.db, input.id)?.status === "PROCESSING");
    assert.deepEqual(receipt(f.db), []);
  } finally { release(); }
  await waitFor(() => eventRow(f.db, input.id)?.status === "RETRYABLE");
  let row = eventRow(f.db, input.id);
  assert.ok(row.retry_at > Date.now()); assert.equal(row.attempt_count, 1); assert.equal(row.lease_owner, "");
  worker.stop();
  // Advance only this disposable fixture's retry eligibility, then recover by startup.
  f.db.prepare("UPDATE integration_webhook_events SET retry_at=0 WHERE id=?").run(row.id);
  f.reopen(); f.worker().start();
  await waitFor(() => eventRow(f.db, input.id)?.status === "PROCESSED");
  row = eventRow(f.db, input.id); assert.equal(row.attempt_count, 2);
  assert.equal(receipt(f.db).length, 1); assert.equal(receipt(f.db)[0].amount_cents, 50000);
});
