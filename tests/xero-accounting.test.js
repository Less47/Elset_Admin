import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import Database from "better-sqlite3";
import { openWorkspaceDb, migrateWorkspaceSchema, WORKSPACE_SCHEMA_VERSION } from "../server-workspace-db.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { insertInvoiceTree, replaceInvoiceForJob, updateInvoiceForJob, addInvoicePayment } from "../server-workspace-documents.js";
import { AccountingService } from "../server-accounting-service.js";
import { createAccountingRouter } from "../server-accounting-routes.js";
import { decryptCredential, digest } from "../server-accounting-crypto.js";
import { ACCOUNTING_UNAVAILABLE_MESSAGE } from "../server-accounting-errors.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { accountingSchemaSql } from "../server-accounting-schema.js";
import { createXeroMock } from "./helpers/xero-mock.js";

function fixture(t, dbPath = ":memory:") {
  const db = openWorkspaceDb({ dbPath });
  t.after(() => { if (db.open) db.close(); });
  db.exec("INSERT INTO customers(id,name,email,phone,address,created_at) VALUES('customer','Shared Property Manager','billing@example.test','0300000000','Customer postal address','2026-09-17')");
  db.exec("INSERT INTO sites(id,customer_id,label,address) VALUES('site-a','customer','Site A','Site A address'),('site-b','customer','Site B','Site B address')");
  db.exec("INSERT INTO jobs(id,job_number,title,customer_id,job_address,status,created_at,updated_at) VALUES('job',101,'Repair','customer','Site A address','Completed','2026-09-17','2026-09-17'),('job-b',102,'Repair B','customer','Site B address','To Do','2026-09-17','2026-09-17')");
  const invoice = { type: "invoice", issueDate: "2026-09-17", dueDate: "2026-10-17", items: [{ description: "Labour", qty: 1.5, rate: 10.01 }, { description: "Materials", qty: 1, rate: 0.03 }], sentHistory: [{ id: "sent", sentAt: "2026-09-17", toEmail: "billing@example.test" }] };
  insertInvoiceTree(db, "job", invoice);
  insertInvoiceTree(db, "job-b", { ...invoice, sentHistory: [] });
  updateWorkspaceAddons(db, { xero: true });
  const mock = createXeroMock();
  const env = { XERO_CLIENT_ID: "fixture-client", XERO_CLIENT_SECRET: "fixture-client-secret", XERO_REDIRECT_URI: "http://localhost:3101/api/integrations/xero/callback", ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  const service = new AccountingService(db, { env, fetchImpl: mock.fetch });
  return { db, mock, env, service, invoice };
}
async function connect(service) {
  const { url } = await service.connect("admin", "session-a");
  await service.callback({ state: new URL(url).searchParams.get("state"), code: "fixture-code" }, "admin", "session-a");
}
async function ready(service) {
  await connect(service);
  await service.configure({ salesAccountId: "sales-id", taxMappings: { taxable: "OUTPUT" } });
}
const writes = (mock, endpoint) => mock.calls.filter((call) => call.url.includes(endpoint) && ["PUT", "POST"].includes(call.method));

test("OAuth requests exact granular scopes and binds expiring single-use state to user, session and workspace", async (t) => {
  const { service, db, mock } = fixture(t);
  const { url } = await service.connect("admin", "session-a"), parsed = new URL(url), state = parsed.searchParams.get("state");
  assert.equal(parsed.origin, "https://login.xero.com");
  assert.equal(parsed.searchParams.get("scope"), "offline_access accounting.contacts accounting.invoices accounting.settings.read");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://localhost:3101/api/integrations/xero/callback");
  assert.ok(state.length >= 40);
  const stored = db.prepare("SELECT * FROM integration_oauth_states").get();
  assert.equal(stored.state_hash, digest(state)); assert.equal(stored.session_hash, digest("session-a"));
  for (const [nonce, user, session] of [[undefined, "admin", "session-a"], [[state], "admin", "session-a"], ["invalid", "admin", "session-a"], [state, "other", "session-a"], [state, "admin", "session-b"]]) {
    await assert.rejects(service.callback({ state: nonce, code: "code" }, user, session), { code: "INVALID_OAUTH_STATE" });
  }
  assert.equal(mock.calls.length, 0);
  await service.callback({ state, code: "fixture" }, "admin", "session-a");
  await assert.rejects(service.callback({ state, code: "replay" }, "admin", "session-a"), { code: "INVALID_OAUTH_STATE" });
  const next = new URL((await service.connect("admin", "session-a")).url).searchParams.get("state");
  db.prepare("UPDATE integration_oauth_states SET expires_at=0").run();
  await assert.rejects(service.callback({ state: next, code: "expired" }, "admin", "session-a"), { code: "INVALID_OAUTH_STATE" });
  assert.equal(service.status().externalTenantId, "tenant-demo");
});

test("cancelled, missing-code, expired-code and missing-organisation OAuth results fail safely", async (t) => {
  const { service, mock } = fixture(t);
  const nonce = async () => new URL((await service.connect("admin", "session-a")).url).searchParams.get("state");
  await assert.rejects(service.callback({ state: await nonce(), error: "access_denied" }, "admin", "session-a"), { code: "OAUTH_CANCELLED" });
  await assert.rejects(service.callback({ state: await nonce(), error: "invalid_scope", error_description: "never-surface" }, "admin", "session-a"), { code: "OAUTH_PROVIDER_ERROR" });
  await assert.rejects(service.callback({ state: await nonce() }, "admin", "session-a"), { code: "OAUTH_CODE" });
  assert.equal(mock.calls.length, 0);
  mock.failNext = { path: "/connect/token", status: 400, body: { error: "invalid_grant", secret: "never-surface" } };
  await assert.rejects(service.callback({ state: await nonce(), code: "expired" }, "admin", "session-a"), { code: "NEEDS_REAUTHORIZATION" });
  assert.equal(service.status().status, "DISCONNECTED");
  mock.organisations = [];
  await assert.rejects(connect(service), { code: "NO_ORGANISATION" });
  assert.equal(service.status().status, "SELECT_ORGANISATION");
  assert.match(service.status().error, /No eligible/);
  await service.disconnect();
  assert.equal(service.store.integration().encrypted_refresh_token, null);
  assert.match(service.status().error, /No organisation had been selected/);
});

test("credentials are authenticated ciphertext, never in status/projections/logs, and configuration is required", async (t) => {
  const { service, db, env } = fixture(t);
  const originalKey = env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY;
  env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY = "";
  await assert.rejects(service.connect("admin", "session"), { code: "SERVER_CONFIGURATION" });
  assert.equal(db.prepare("SELECT count(*) n FROM integration_oauth_states").get().n, 0);
  env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY = originalKey;
  await connect(service);
  const row = service.store.integration();
  assert.match(row.encrypted_access_token, /^v1\./);
  assert.equal(decryptCredential(row.encrypted_refresh_token, service.aad("refresh"), env), "fixture-refresh-0");
  assert.throws(() => decryptCredential(row.encrypted_access_token, "wrong-workspace", env), { code: "CREDENTIAL_UNAVAILABLE" });
  assert.doesNotMatch(JSON.stringify(row), /fixture-access|fixture-refresh|fixture-client-secret/);
  assert.doesNotMatch(JSON.stringify([service.status(), loadWorkspaceStateFromDb(db), db.prepare("SELECT * FROM integration_sync_log").all()]), /encrypted_access|fixture-access|fixture-refresh|fixture-client-secret/);
});

test("infrastructure failures return generic customer errors and log only operator diagnostics", async (t) => {
  const { service, env, db, mock } = fixture(t), configured = { ...env }, diagnostics = [];
  t.mock.method(console, "error", (...args) => diagnostics.push(args.join(" ")));
  const cases = [
    ...["ACCOUNTING_INTEGRATION_ENCRYPTION_KEY", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI"].map((name) => [name, "", `missing ${name}`]),
    ["ACCOUNTING_INTEGRATION_ENCRYPTION_KEY", "invalid-key-canary", "invalid ACCOUNTING_INTEGRATION_ENCRYPTION_KEY"],
    ["XERO_REDIRECT_URI", "https://user:redirect-secret-canary@example.test/callback?private=value", "invalid XERO_REDIRECT_URI"],
  ];
  for (const [name, value, diagnostic] of cases) {
    Object.assign(env, configured, { [name]: value });
    const status = service.status();
    assert.equal(status.serverConfigured, false);
    assert.equal(status.setupMessage, ACCOUNTING_UNAVAILABLE_MESSAGE);
    await assert.rejects(service.connect("admin", "session-a"), { code: "SERVER_CONFIGURATION", statusCode: 503, message: ACCOUNTING_UNAVAILABLE_MESSAGE });
    assert.ok(diagnostics.at(-1).includes(diagnostic));
    assert.doesNotMatch(JSON.stringify(status), /ACCOUNTING_INTEGRATION|XERO_|encryption|hexadecimal|administrator must|canary/i);
  }
  assert.equal(mock.calls.length, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM integration_oauth_states").get().n, 0);
  for (const value of [...Object.values(configured), "invalid-key-canary", "redirect-secret-canary", "private=value"]) {
    assert.ok(!diagnostics.join("\n").includes(value), "Server diagnostics must not include configuration values");
  }
  Object.assign(env, configured);
  assert.equal(service.status().serverConfigured, true);
  assert.equal(service.status().setupMessage, "");
  await connect(service);
  assert.equal(service.status().status, "CONNECTED");
});

test("decryption failures and previously stored infrastructure errors never ask customers to configure secrets", async (t) => {
  const { service, env, db } = fixture(t), diagnostics = [];
  t.mock.method(console, "error", (...args) => diagnostics.push(args.join(" ")));
  await ready(service);
  const invoiceId = db.prepare("SELECT id FROM invoices WHERE job_id='job'").get().id;
  for (const message of [
    "An administrator must configure a 32-byte accounting encryption key (64 hexadecimal characters).",
    "An administrator must configure the Xero client ID, secret and exact HTTPS callback (HTTP localhost is supported for local testing).",
    "Stored accounting credentials could not be decrypted. Restore the encryption key or reconnect.",
    "missing ACCOUNTING_INTEGRATION_ENCRYPTION_KEY",
  ]) {
    service.store.update({ safe_error_message: message });
    service.store.log("tenant-demo", "invoice", invoiceId, "sync", "FAILED", "", { code: "SERVER_CONFIGURATION", message });
    assert.equal(service.status().error, ACCOUNTING_UNAVAILABLE_MESSAGE);
    assert.equal(service.invoiceStatus("job").error, ACCOUNTING_UNAVAILABLE_MESSAGE);
    assert.equal(service.invoiceStatus("job").connection.error, ACCOUNTING_UNAVAILABLE_MESSAGE);
  }
  const originalKey = env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY;
  env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  await assert.rejects(service.testConnection(), { code: "CREDENTIAL_UNAVAILABLE", message: ACCOUNTING_UNAVAILABLE_MESSAGE });
  assert.equal(service.status().error, ACCOUNTING_UNAVAILABLE_MESSAGE);
  assert.match(diagnostics.at(-1), /unable to decrypt stored accounting credentials/);
  assert.ok(!diagnostics.join("\n").includes(env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY));
  assert.ok(!diagnostics.join("\n").includes(originalKey));
  assert.ok(!diagnostics.join("\n").includes(service.store.integration().encrypted_access_token));
  env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY = originalKey;
  assert.equal((await service.testConnection()).error, "");
});

test("rotating refresh is persisted atomically and concurrent requests cannot use the same token", async (t) => {
  const { service, mock, db, env } = fixture(t); await ready(service);
  service.store.update({ token_expires_at: 0 });
  const other = new AccountingService(db, { env, fetchImpl: mock.fetch });
  const results = await Promise.allSettled([service.testConnection(), other.testConnection()]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.find((item) => item.status === "rejected").reason.code, "INTEGRATION_BUSY");
  assert.equal(mock.refreshes, 1);
  assert.equal(decryptCredential(service.store.integration().encrypted_refresh_token, service.aad("refresh"), env), "fixture-refresh-1");
  await other.testConnection(); assert.equal(mock.refreshes, 1);
  service.store.update({ token_expires_at: 0 });
  mock.failNext = { path: "/connect/token", status: 400, body: { error: "invalid_grant", detail: "fixture-secret-never-log" } };
  await assert.rejects(service.testConnection(), { code: "NEEDS_REAUTHORIZATION" });
  const count = mock.calls.length;
  await assert.rejects(service.testConnection(), { code: "NEEDS_REAUTHORIZATION" });
  assert.equal(mock.calls.length, count);
  assert.equal(service.status().status, "NEEDS_REAUTHORIZATION");
  assert.doesNotMatch(JSON.stringify(service.status()), /fixture-secret/);
});

test("multiple tenants require selection and a different tenant needs confirmation without reusing mappings", async (t) => {
  const { service, mock } = fixture(t);
  mock.organisations.push({ id: "connection-second", tenantId: "tenant-second", tenantName: "Second Demo", tenantType: "ORGANISATION" });
  await connect(service); assert.equal(service.status().status, "SELECT_ORGANISATION");
  await assert.rejects(service.chooseOrganisation("forged-tenant"), { code: "TENANT_UNAVAILABLE" });
  await service.chooseOrganisation("tenant-demo");
  await service.configure({ salesAccountId: "sales-id", taxMappings: { taxable: "OUTPUT" } });
  await service.syncInvoice("job");
  await assert.rejects(service.chooseOrganisation("tenant-second"), { code: "TENANT_CHANGE" });
  await service.chooseOrganisation("tenant-second", true);
  assert.deepEqual(service.status().config, {});
  assert.equal(service.invoiceStatus("job").externalId, "");
  await service.chooseOrganisation("tenant-demo", true);
  assert.ok(service.invoiceStatus("job").externalId);
});

test("account and tax choices are fetched, revenue-only and validated; health checks never create business records", async (t) => {
  const { service, mock } = fixture(t); await connect(service);
  const config = await service.getConfig();
  assert.deepEqual(config.accounts.map((row) => row.id), ["sales-id"]);
  assert.deepEqual(config.taxRates.map((row) => row.id), ["OUTPUT", "EXEMPTOUTPUT"]);
  await assert.rejects(service.configure({ salesAccountId: "bank-id", taxMappings: { taxable: "OUTPUT" } }), { code: "ACCOUNT_MAPPING" });
  await assert.rejects(service.configure({ salesAccountId: "sales-id", taxMappings: { taxable: "EXEMPTOUTPUT" } }), { code: "TAX_MAPPING" });
  await service.testConnection(); assert.equal(mock.contacts.length, 0); assert.equal(mock.invoices.length, 0);
  mock.organisations = [];
  await assert.rejects(service.testConnection(), { code: "NEEDS_REAUTHORIZATION" });
});

test("manual sync preserves numbering, dates, lines and exact GST totals; shared customer Sites reuse one contact", async (t) => {
  const { service, db, mock } = fixture(t); await ready(service);
  const before = JSON.stringify(loadWorkspaceStateFromDb(db));
  const result = await service.syncInvoice("job");
  assert.equal(result.status, "SYNCED");
  const invoice = mock.invoices[0];
  assert.equal(invoice.InvoiceNumber, "INV-0101");
  assert.equal(invoice.Date, "2026-09-17"); assert.equal(invoice.DueDate, "2026-10-17");
  assert.equal(invoice.Type, "ACCREC"); assert.equal(invoice.Status, "AUTHORISED"); assert.equal(invoice.LineAmountTypes, "Exclusive");
  assert.deepEqual(invoice.LineItems.map((line) => [line.Quantity, line.UnitAmount, line.AccountCode, line.TaxType]), [[1.5, 10.01, "410", "OUTPUT"], [1, 0.03, "410", "OUTPUT"]]);
  assert.deepEqual([invoice.SubTotal, invoice.TotalTax, invoice.Total], [15.05, 1.51, 16.56]);
  assert.equal(mock.contacts[0].Addresses[0].AddressLine1, "Customer postal address");
  assert.doesNotMatch(JSON.stringify(mock.contacts), /Site A address|Site B address/);
  assert.equal(JSON.stringify(loadWorkspaceStateFromDb(db)), before);
  await service.syncInvoice("job"); assert.equal(writes(mock, "/Invoices").length, 1);
  await addInvoicePayment(db, "job-b", { id: "payment-b", amount: 1, date: "2026-09-17" });
  await service.syncInvoice("job-b"); assert.equal(mock.contacts.length, 1); assert.equal(mock.invoices.length, 2);
  assert.equal(mock.invoices[1].Contact.ContactID, invoice.Contact.ContactID);
  assert.equal(writes(mock, "/Contacts").length, 1);
});

test("draft/quote/nonexistent and disabled module cannot sync; paid actual eligibility matches existing product", async (t) => {
  const { service, db, mock } = fixture(t); await ready(service);
  await assert.rejects(service.syncInvoice("job-b"), { code: "INVOICE_INELIGIBLE" });
  await assert.rejects(service.syncInvoice("missing"), { code: "INVOICE_NOT_FOUND" });
  db.prepare("UPDATE invoices SET type='quote' WHERE job_id='job-b'").run();
  await assert.rejects(service.syncInvoice("job-b"), { code: "INVOICE_NOT_FOUND" });
  updateWorkspaceAddons(db, { xero: false });
  const count = mock.calls.length;
  await assert.rejects(service.syncInvoice("job"), { code: "ADDON_DISABLED" });
  assert.equal(mock.calls.length, count);
});

test("mapped invoice updates by ID without duplicate and rejects accounting changes and external edits", async (t) => {
  const { service, db, mock, invoice: originalInvoice } = fixture(t); await ready(service); await service.syncInvoice("job");
  const id = mock.invoices[0].InvoiceID;
  replaceInvoiceForJob(db, "job", { ...originalInvoice, notes: "Local note", items: [{ description: "Updated work", qty: 2, rate: 25.12 }] });
  await service.syncInvoice("job");
  assert.equal(mock.invoices.length, 1); assert.equal(mock.invoices[0].InvoiceID, id);
  assert.equal(mock.invoices[0].Total, 55.26);
  assert.ok(writes(mock, `/Invoices/${id}`).length);
  for (const change of [{ AmountPaid: 1 }, { AmountCredited: 1 }, { Status: "VOIDED" }, { Status: "PAID" }, { Payments: [{}] }]) {
    const before = structuredClone(mock.invoices[0]); Object.assign(mock.invoices[0], change);
    await assert.rejects(service.syncInvoice("job"), { code: "ACCOUNTING_STATE_CONFLICT" }); mock.invoices[0] = before;
  }
  const writeCount = writes(mock, "/Invoices").length;
  for (const change of [{ Tracking: [{ TrackingCategoryID: "tracking", TrackingOptionID: "option" }] }, { ItemCode: "inventory" }, { DiscountRate: 5 }, { DiscountAmount: 2 }]) {
    const before = structuredClone(mock.invoices[0]); Object.assign(mock.invoices[0].LineItems[0], change);
    await assert.rejects(service.syncInvoice("job"), { code: "EXTERNAL_EDIT_CONFLICT" }); mock.invoices[0] = before;
  }
  assert.equal(writes(mock, "/Invoices").length, writeCount);
  mock.invoices[0].LineItems[0].Description = "Accountant edit";
  await assert.rejects(service.syncInvoice("job"), { code: "EXTERNAL_EDIT_CONFLICT" });
});

test("rejected writes can be corrected; lost updates reconcile; local changes during sync retain mapping and report conflict", async (t) => {
  const { service, mock, db, invoice } = fixture(t); await ready(service);
  const create = service.provider.createInvoice.bind(service.provider);
  service.provider.createInvoice = async (...args) => {
    mock.failNext = { path: "/Invoices", status: 400, body: { message: "private customer detail" } };
    return create(...args);
  };
  await assert.rejects(service.syncInvoice("job"), { code: "PROVIDER_VALIDATION" });
  assert.equal(service.store.operation("tenant-demo", "invoice", readInvoiceId()).status, "REJECTED");
  assert.doesNotMatch(JSON.stringify(service.status()), /private customer/);
  service.provider.createInvoice = create;
  await service.syncInvoice("job");
  replaceInvoiceForJob(db, "job", { ...invoice, items: [{ description: "Updated", qty: 1, rate: 20 }] });
  const update = service.provider.updateInvoice.bind(service.provider);
  service.provider.updateInvoice = async (...args) => { const result = await update(...args); throw Object.assign(new Error("Response lost"), { result }); };
  await assert.rejects(service.syncInvoice("job"));
  const count = writes(mock, "/Invoices").length;
  service.provider.updateInvoice = update;
  assert.equal((await service.syncInvoice("job")).status, "SYNCED");
  assert.equal(writes(mock, "/Invoices").length, count);
  replaceInvoiceForJob(db, "job", { ...invoice, items: [{ description: "Changed", qty: 1, rate: 30 }] });
  service.provider.updateInvoice = async (...args) => {
    const result = await update(...args);
    replaceInvoiceForJob(db, "job", { ...invoice, items: [{ description: "Concurrent edit", qty: 1, rate: 40 }] });
    return result;
  };
  await assert.rejects(service.syncInvoice("job"), { code: "LOCAL_EDIT_CONFLICT" });
  assert.ok(service.invoiceStatus("job").externalId);
  assert.equal(mock.invoices.length, 1);
  function readInvoiceId() { return db.prepare("SELECT id FROM invoices WHERE job_id='job'").get().id; }
});

test("one application key preserves separate workspace tokens, tenants, configuration, mappings and OAuth state", async (t) => {
  const first = fixture(t), second = fixture(t);
  second.env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY = first.env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY;
  t.mock.method(console, "error", () => {});
  await ready(first.service); await first.service.syncInvoice("job");
  const invoiceId = first.db.prepare("SELECT id FROM invoices WHERE job_id='job'").get().id;
  const mapped = first.service.store.mapping("tenant-demo", "invoice", invoiceId);
  assert.ok(mapped.external_entity_id);
  assert.equal(second.service.store.mapping("tenant-demo", "invoice", invoiceId), undefined);
  assert.equal(second.service.store.latest("tenant-demo", "invoice", invoiceId), undefined);
  const state = new URL((await first.service.connect("admin", "session-a")).url).searchParams.get("state");
  await assert.rejects(second.service.callback({ state, code: "fixture" }, "admin", "session-a"), { code: "INVALID_OAUTH_STATE" });
  assert.equal(second.mock.calls.length, 0);
  second.mock.organisations = [{ id: "connection-second", tenantId: "tenant-second", tenantName: "Second workspace", tenantType: "ORGANISATION" }];
  second.mock.refreshes = 9;
  second.mock.accounts = [{ AccountID: "second-sales-id", Code: "420", Name: "Second sales", Type: "REVENUE", Status: "ACTIVE" }];
  await connect(second.service);
  await second.service.configure({ salesAccountId: "second-sales-id", taxMappings: { taxable: "OUTPUT" } });
  await second.service.syncInvoice("job");
  assert.equal(first.service.status().externalTenantId, "tenant-demo");
  assert.equal(second.service.status().externalTenantId, "tenant-second");
  assert.equal(first.service.status().config.salesAccountId, "sales-id");
  assert.equal(second.service.status().config.salesAccountId, "second-sales-id");
  for (const kind of ["access", "refresh"]) {
    const column = `encrypted_${kind}_token`;
    const firstToken = first.service.store.integration()[column], secondToken = second.service.store.integration()[column];
    assert.notEqual(firstToken, secondToken);
    assert.equal(decryptCredential(firstToken, first.service.aad(kind), first.env), `fixture-${kind}-0`);
    assert.equal(decryptCredential(secondToken, second.service.aad(kind), second.env), `fixture-${kind}-9`);
    assert.throws(() => decryptCredential(firstToken, second.service.aad(kind), second.env), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => decryptCredential(secondToken, first.service.aad(kind), first.env), { code: "CREDENTIAL_UNAVAILABLE" });
  }
  assert.notEqual(first.service.store.mapping("tenant-demo", "customer", "customer").external_entity_id,
    second.service.store.mapping("tenant-second", "customer", "customer").external_entity_id);
  assert.equal(first.service.store.mapping("tenant-second", "customer", "customer"), undefined);
  assert.equal(second.service.store.mapping("tenant-demo", "customer", "customer"), undefined);
});

test("accepted create with lost response is reconciled on Retry even after idempotency expiry", async (t) => {
  const { service, db, mock } = fixture(t); await ready(service);
  mock.loseNextInvoiceResponse = true;
  await assert.rejects(service.syncInvoice("job"), { code: "PROVIDER_UNAVAILABLE" });
  assert.equal(mock.invoices.length, 1); assert.equal(service.invoiceStatus("job").status, "FAILED");
  db.exec("UPDATE integration_operations SET started_at=0");
  const recovered = await service.syncInvoice("job");
  assert.equal(recovered.status, "SYNCED"); assert.equal(mock.invoices.length, 1);
  assert.equal(writes(mock, "/Invoices").length, 1);
  assert.ok(writes(mock, "/Invoices")[0].headers["Idempotency-Key"]);
});

test("number conflicts never merge; uncertain missing results expire closed; rate limits delay all subsequent HTTP", async (t) => {
  const { service, db, mock } = fixture(t); await ready(service);
  mock.invoices.push({ InvoiceID: "unrelated", InvoiceNumber: "INV-0101", Contact: { ContactID: "unrelated" }, LineItems: [] });
  await assert.rejects(service.syncInvoice("job"), { code: "INVOICE_NUMBER_CONFLICT" });
  mock.invoices = [];
  mock.failNext = { path: "/Invoices", throw: true };
  await assert.rejects(service.syncInvoice("job"), { code: "PROVIDER_UNAVAILABLE" });
  mock.failNext = null;
  // Force an ambiguous pending write after the short provider retry window.
  const source = service.invoiceStatus("job");
  const invoiceId = db.prepare("SELECT id FROM invoices WHERE job_id='job'").get().id;
  service.store.prepareOperation("tenant-demo", "invoice", invoiceId, {});
  db.exec("UPDATE integration_operations SET started_at=0");
  await assert.rejects(service.syncInvoice("job"), { code: "AMBIGUOUS_WRITE" });
  assert.equal(mock.invoices.length, 0); assert.equal(source.externalId, "");
  mock.failNext = { path: "/connections", status: 429, headers: { "Retry-After": "60" } };
  await assert.rejects(service.testConnection(), { code: "RATE_LIMITED" });
  const count = mock.calls.length;
  await assert.rejects(service.testConnection(), { code: "RATE_LIMITED" });
  assert.equal(mock.calls.length, count); assert.ok(service.status().retryAt > Date.now());
});

test("same-name/email customers are never merged and mapping constraints block cross-customer reuse", async (t) => {
  const { service, db, mock, invoice } = fixture(t); await ready(service);
  mock.contacts.push({ ContactID: "existing-bookkeeper", Name: "Shared Property Manager", EmailAddress: "billing@example.test", ContactNumber: "other-app", ContactStatus: "ACTIVE" });
  await service.syncInvoice("job");
  assert.equal(mock.contacts.length, 2);
  db.exec("INSERT INTO customers(id,name,email,created_at) VALUES('second','Shared Property Manager','billing@example.test','2026-09-17')");
  db.exec("UPDATE jobs SET customer_id='second' WHERE id='job-b'");
  updateInvoiceForJob(db, "job-b", { ...invoice });
  // Eligibility is made explicit through the existing payment API.
  addInvoicePayment(db, "job-b", { id: "payment-b", amount: 1, date: "2026-09-17" });
  await service.syncInvoice("job-b");
  assert.equal(mock.contacts.length, 3);
  const first = service.store.mapping("tenant-demo", "customer", "customer");
  assert.throws(() => service.store.map("tenant-demo", "customer", "second", first.external_entity_id), { code: "MAPPING_CONFLICT" });
  assert.equal(mock.contacts[0].Name, "Shared Property Manager");
});

test("disconnect removes active credentials and preserves history/config; same-tenant reconnect reuses mappings", async (t) => {
  const { service, db, mock } = fixture(t); await ready(service); await service.syncInvoice("job");
  const id = service.invoiceStatus("job").externalId, config = service.status().config;
  updateWorkspaceAddons(db, { xero: false });
  await service.disconnect();
  assert.equal(service.store.integration().encrypted_access_token, null); assert.equal(service.store.integration().encrypted_refresh_token, null);
  assert.deepEqual(service.status().config, config); assert.equal(service.invoiceStatus("job").externalId, id);
  assert.equal(mock.calls.at(-1).method, "DELETE");
  updateWorkspaceAddons(db, { xero: true }); await connect(service);
  await service.syncInvoice("job"); assert.equal(mock.invoices.length, 1);
});

test("totals mismatch retains external identity but never reports a successful sync", async (t) => {
  const { service, mock } = fixture(t); await ready(service);
  const original = service.provider.createInvoice.bind(service.provider);
  service.provider.createInvoice = async (...args) => { const record = await original(...args); return { ...record, TotalTax: record.TotalTax + 1 }; };
  await assert.rejects(service.syncInvoice("job"), { code: "TOTALS_MISMATCH" });
  const state = service.invoiceStatus("job");
  assert.equal(state.status, "CONFLICT"); assert.ok(state.externalId); assert.equal(state.lastSyncedAt, null);
  assert.equal(mock.invoices.length, 1);
});

test("version 8 to 9 migration is additive, transactional and runs once", (t) => {
  const db = new Database(":memory:"); t.after(() => db.close());
  // Genuine historical v7 DDL plus original v8 DDL, without any v9 objects.
  db.exec(fs.readFileSync(new URL("../fixtures/workspace-schema-v7.sql", import.meta.url), "utf8"));
  const original = fs.readFileSync(new URL("../server-workspace-db.js", import.meta.url), "utf8").match(/version: 8,[\s\S]*?sql: `([\s\S]*?)`/)[1];
  db.exec(original); db.exec("INSERT INTO workspace_schema_migrations VALUES(8,'optional-job-costing','2026-09-17'); PRAGMA user_version=8;");
  db.exec("INSERT INTO customers(id,name,created_at) VALUES('retained','Unchanged','2026-09-17')");
  const before = db.prepare("SELECT * FROM customers").all();
  db.exec("CREATE TABLE integration_operations(collision TEXT)");
  assert.throws(() => migrateWorkspaceSchema(db), /migration 8 -> 9 failed/);
  assert.equal(db.pragma("user_version", { simple: true }), 8);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_integrations'").get(), undefined);
  db.exec("DROP TABLE integration_operations"); migrateWorkspaceSchema(db);
  assert.equal(WORKSPACE_SCHEMA_VERSION, 9); assert.equal(db.pragma("user_version", { simple: true }), 9);
  assert.deepEqual(db.prepare("SELECT * FROM customers").all(), before);
  const identity = db.prepare("SELECT * FROM integration_workspace").get(); migrateWorkspaceSchema(db);
  assert.deepEqual(db.prepare("SELECT * FROM integration_workspace").get(), identity);
  assert.equal(db.prepare("SELECT count(*) n FROM workspace_schema_migrations WHERE version=9").get().n, 1);
  assert.equal((accountingSchemaSql.match(/CREATE TABLE/g) || []).length, 7);
});

test("authenticated routes enforce roles, request origin, server gating and workspace isolation", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xero-routes-"));
  let server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (db.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const { db, env, mock } = fixture(t, path.join(directory, "workspace.db"));
  const routeEnv = { ...env, ELSET_WORKSPACE_STORAGE: "sqlite", ELSET_WORKSPACE_DB_PATH: path.join(directory, "workspace.db") };
  const app = express(); app.use(express.json());
  app.use(createAccountingRouter({ env: routeEnv, fetchImpl: mock.fetch,
    requireAuth: (req, res, next) => { if (!req.get("x-user")) return res.sendStatus(401); req.user = { id: req.get("x-user"), role: req.get("x-role") }; req.authSession = { id: "route-session" }; next(); },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403) }));
  server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (suffix, role = "admin", options = {}) => fetch(`${base}${suffix}`, { ...options, headers: { "x-user": "admin", "x-role": role, "Content-Type": "application/json", "X-Accounting-Request": "1", ...options.headers } });
  assert.equal((await fetch(`${base}/api/integrations/xero/status`)).status, 401);
  assert.equal((await req("/api/integrations/xero/status", "technician")).status, 403);
  assert.equal((await req("/api/jobs/job/invoice/integrations/xero/sync", "technician", { method: "POST", body: "{}" })).status, 403);
  assert.equal((await req("/api/integrations/xero/connect", "office", { method: "POST", body: "{}", headers: { "X-Accounting-Request": "" } })).status, 403);
  assert.equal((await req("/api/integrations/xero/connect", "office", { method: "POST", body: "{}", headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  routeEnv.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY = "";
  t.mock.method(console, "error", () => {});
  const unavailable = await req("/api/integrations/xero/connect", "office", { method: "POST", body: "{}" });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { code: "SERVER_CONFIGURATION", error: ACCOUNTING_UNAVAILABLE_MESSAGE });
  const status = (await (await req("/api/integrations/xero/status")).json()).result;
  assert.equal(status.serverConfigured, false);
  assert.equal(status.setupMessage, ACCOUNTING_UNAVAILABLE_MESSAGE);
  routeEnv.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY = env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY;
  assert.equal((await req("/api/integrations/xero/connect", "office", { method: "POST", body: "{}" })).status, 200);
  updateWorkspaceAddons(db, { xero: false });
  assert.equal((await req("/api/jobs/job/invoice/integrations/xero/sync", "office", { method: "POST", body: "{}" })).status, 403);
  const other = fixture(t);
  assert.notEqual(other.service.store.workspaceId, new AccountingService(db, { env }).store.workspaceId);
  assert.equal(other.service.store.mapping("tenant-demo", "invoice", "missing"), undefined);
});
