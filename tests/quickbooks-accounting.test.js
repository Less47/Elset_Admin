import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { insertInvoiceTree, addInvoicePayment } from "../server-workspace-documents.js";
import { AccountingService } from "../server-accounting-service.js";
import { createAccountingRouter } from "../server-accounting-routes.js";
import { digest, decryptCredential } from "../server-accounting-crypto.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { getCustomerAccountSummary } from "../server-customer-account.js";
import { createQuickBooksMock } from "./helpers/quickbooks-mock.js";
import { quickBooksCloudEvent } from "./helpers/quickbooks-webhooks.js";
import { QuickBooksAccountingProvider } from "../server-accounting-providers/quickbooks.js";
import { quickBooksOAuthDiagnostic } from "../server-quickbooks-oauth.js";
import { processQuickBooksInbox, persistQuickBooksEvents, registerQuickBooksWebhook, verifyQuickBooksSignature } from "../server-quickbooks-webhooks.js";

function fixture(t, { file = false, manual = false, draft = false } = {}) {
  const directory = file ? fs.mkdtempSync(path.join(os.tmpdir(), "quickbooks-v3-")) : "";
  const dbPath = directory ? path.join(directory, "workspace.db") : ":memory:";
  const db = openWorkspaceDb({ dbPath });
  t.after(() => { if (db.open) db.close(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
  db.exec("INSERT INTO customers(id,name,email,address,created_at) VALUES('customer','QUICKBOOKS V3 TEST','billing@example.test','Customer billing address','2026-09-18'); INSERT INTO jobs(id,job_number,title,customer_id,job_address,status,created_at,updated_at) VALUES('job',278,'Work A','customer','Site A','Completed','2026-09-18','2026-09-18'),('job-b',279,'Work B','customer','Site B','Completed','2026-09-18','2026-09-18')");
  const invoice = { issueDate: "2026-09-18", dueDate: "2026-10-18", items: [{ description: "Service", qty: 2, rate: 500 }],
    sentHistory: draft ? [] : [{ id: "sent", sentAt: "2026-09-18", toEmail: "billing@example.test" }],
    payments: manual ? [{ id: "manual", amount: 100, date: "2026-09-18" }] : [] };
  insertInvoiceTree(db, "job", { ...invoice, id: "invoice" }); insertInvoiceTree(db, "job-b", { ...invoice, id: "invoice-b", payments: [] });
  updateWorkspaceAddons(db, { quickbooks: true });
  const mock = createQuickBooksMock();
  const env = { NODE_ENV: "test", ELSET_WORKSPACE_STORAGE: "sqlite", ELSET_WORKSPACE_DB_PATH: dbPath,
    QUICKBOOKS_CLIENT_ID: "fixture-client", QUICKBOOKS_CLIENT_SECRET: "fixture-secret", QUICKBOOKS_REDIRECT_URI: "http://localhost:3101/api/integrations/quickbooks/callback",
    QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: "fixture-verifier", ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  const authorizeOAuthInitiator = async (row) => row.user_id === "admin" && row.session_hash === digest("session");
  const service = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: mock.fetch, authorizeOAuthInitiator });
  return { db, env, mock, service, invoice, authorizeOAuthInitiator };
}
const nonce = async (service) => new URL((await service.connect("admin", "session")).url).searchParams.get("state");
const consent = async (service, realmId = "123456789") => service.callback({ state: await nonce(service), code: "fixture-code", realmId });
async function ready(service) { await consent(service); await service.configure({ itemId: "20", taxMappings: { taxable: "30" } }); }
const paid = (db, id = "invoice") => db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM payments WHERE invoice_id=?").get(id).amount;
const allocations = (mock, values) => mock.setPayments(values.map(([id, amount]) => ({ id, allocations: [[mock.invoices[0].Id, amount]] })));
const event = (mock, { id = crypto.randomUUID(), resource = mock.invoices[0]?.Id, type = "qbo.invoice.updated.v1", realm = mock.realm } = {}) => [quickBooksCloudEvent({ id, type, time: "2026-09-18T01:00:00Z", intuitentityid: resource, intuitaccountid: realm, data: { ignored: "not stored" } })];

test("QuickBooks OAuth accounting-only scope, state digest, cookie-free callback, realm and encrypted tokens", async (t) => {
  const { service, db, env, mock } = fixture(t);
  const url = new URL((await service.connect("admin", "session")).url), state = url.searchParams.get("state");
  assert.equal(url.origin, "https://appcenter.intuit.com"); assert.equal(url.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  const stored = db.prepare("SELECT * FROM integration_oauth_states").get();
  assert.equal(stored.state_hash, digest(state)); assert.equal(stored.provider_environment, "sandbox"); assert.ok(stored.expires_at > Date.now());
  await service.callback({ state, code: "fixture-code", realmId: mock.realm });
  await assert.rejects(service.callback({ state, code: "replay", realmId: mock.realm }), { code: "INVALID_OAUTH_STATE" });
  const row = service.store.integration();
  assert.equal(row.external_tenant_id, mock.realm); assert.equal(row.external_tenant_name, "Fixture AU company"); assert.equal(row.connected_by_user_id, "admin");
  assert.equal(decryptCredential(row.encrypted_refresh_token, service.aad("refresh"), env), "fixture-refresh-0");
  assert.ok(!row.encrypted_access_token.includes("fixture-access")); assert.ok(!JSON.stringify(service.status()).includes("fixture-secret"));
  assert.equal(JSON.parse(row.organisations_json)[0].country, "AU");
});

test("OAuth invalid, expired, revoked-initiator and wrong-browser states cannot exchange or poison health", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service);
  const before = service.store.integration(), state = await nonce(service), calls = mock.calls.length;
  for (const value of ["invalid", state.replace("accounting-connect", "wrong-purpose")]) await assert.rejects(service.callback({ state: value, code: "bad", realmId: mock.realm }), { code: "INVALID_OAUTH_STATE" });
  await assert.rejects(service.callback({ state, code: "bad", realmId: mock.realm }, "someone-else", "session"), { code: "INVALID_OAUTH_STATE" });
  assert.equal(mock.calls.length, calls); assert.equal(service.store.integration().last_error_at, before.last_error_at);
  db.prepare("UPDATE integration_oauth_states SET expires_at=0").run();
  await assert.rejects(service.callback({ state, code: "bad", realmId: mock.realm }), { code: "INVALID_OAUTH_STATE" });
  const revoked = await nonce(service); service.authorizeOAuthInitiator = async () => false;
  await assert.rejects(service.callback({ state: revoked, code: "bad", realmId: mock.realm }), { code: "INVALID_OAUTH_STATE" });
  assert.equal(mock.calls.length, calls);
});

test("realm-scoped CompanyInfo accepts singleton record ID while unauthorized realms are rejected", async (t) => {
  const { service, mock } = fixture(t);
  await assert.rejects(consent(service, "../../elsewhere"), { code: "INVALID_REALM" }); assert.equal(mock.calls.length, 0);
  await assert.rejects(consent(service, "987654321"), { code: "NEEDS_REAUTHORIZATION" });
  assert.equal(service.store.integration(), undefined);
  await ready(service); await assert.rejects(service.chooseOrganisation("987654321", true), { code: "TENANT_UNAVAILABLE" });
  assert.equal(service.store.integration().external_tenant_id, mock.realm);
  assert.notEqual(service.store.integration().external_tenant_id, "1");
  assert.ok(mock.calls.some((call) => new URL(call.url).pathname === `/v3/company/${mock.realm}/companyinfo/${mock.realm}`));
});

test("rotated refresh is atomic and serialized; reconnect preserves identity, mapping and configuration", async (t) => {
  const { service, db, mock, env } = fixture(t); await ready(service); await service.syncInvoice("job");
  const previous = service.store.integration(); service.store.update({ token_expires_at: 0 });
  await service.testConnection(); assert.equal(mock.refreshes, 1);
  assert.equal(decryptCredential(service.store.integration().encrypted_refresh_token, service.aad("refresh"), env), "fixture-refresh-1");
  await service.disconnect(); assert.ok(mock.calls.some((call) => call.url.includes("tokens/revoke")));
  assert.equal(service.store.integration().encrypted_access_token, null); assert.equal(db.prepare("SELECT count(*) n FROM integration_entity_mappings").get().n, 2);
  await consent(service); assert.equal(service.store.integration().config_json, previous.config_json); assert.equal(service.store.integration().connected_at, previous.connected_at);
  await service.syncInvoice("job"); assert.equal(mock.invoices.length, 1);
});

test("same-realm US reauthorization keeps company configuration and historical mappings", async (t) => {
  const { service, mock } = fixture(t);
  Object.assign(mock, { country: "US", currency: "USD", companyName: "Fixture US company" });
  await consent(service);
  service.store.update({ config_json: JSON.stringify({ itemId: "old-item", taxMappings: { taxable: "old-tax" } }) });
  service.store.map(mock.realm, "customer", "customer", "old-customer");
  const previous = service.store.integration(); mock.tokenSuffix = "-reauthorized";
  const result = await consent(service);
  assert.equal(result.externalTenantId, mock.realm); assert.equal(result.pendingCompanySwitch, null);
  assert.equal(service.store.integration().config_json, previous.config_json);
  assert.equal(service.store.mapping(mock.realm, "customer", "customer").external_entity_id, "old-customer");
  assert.notEqual(service.store.integration().encrypted_access_token, previous.encrypted_access_token);
});

test("US to AU consent stages separate credentials; confirmation atomically switches realm and isolates all history", async (t) => {
  const { service, mock, db, env, authorizeOAuthInitiator } = fixture(t);
  await ready(service); await service.syncInvoice("job"); allocations(mock, [["900", 500]]); await service.syncPayments("job");
  Object.assign(mock, { country: "US", currency: "USD", companyName: "Fixture US company" }); await consent(service);
  const previous = service.store.integration(), oldRealm = mock.realm;
  const historyTables = ["integration_entity_mappings", "integration_external_payments", "integration_sync_log", "integration_operations", "payments"];
  const history = Object.fromEntries(historyTables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  const genericSettings = db.prepare("SELECT * FROM settings ORDER BY key").all();
  Object.assign(mock, { realm: "987654321", companyName: "Fixture AU new company", country: "AU", currency: "AUD", tokenSuffix: "-au" });
  mock.customers = []; mock.invoices = []; mock.payments = [];
  const result = await consent(service, mock.realm), proposed = result.pendingCompanySwitch;
  assert.equal(proposed.current.name, "Fixture US company"); assert.equal(proposed.proposed.name, mock.companyName);
  assert.equal(proposed.proposed.country, "AU"); assert.equal(proposed.proposed.currency, "AUD");
  assert.equal(result.externalTenantId, oldRealm); // Until the deliberate, named confirmation.
  for (const key of ["encrypted_access_token", "encrypted_refresh_token", "external_tenant_id", "config_json", "organisations_json", "status"]) assert.equal(service.store.integration()[key], previous[key]);
  assert.ok(!JSON.stringify(result).includes("fixture-access")); assert.ok(!JSON.stringify(result).includes("encryptedCredentials"));
  assert.ok(!service.store.integration().credential_metadata_json.includes("fixture-access-0-au"));
  // The encrypted proposal survives a process/service reload.
  const reloaded = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: mock.fetch, authorizeOAuthInitiator });
  await assert.rejects(reloaded.credentials(), { code: "COMPANY_SWITCH_PENDING" });
  const switched = await reloaded.switchCompany(proposed.id, true), row = reloaded.store.integration();
  assert.equal(switched.externalTenantId, mock.realm); assert.equal(switched.externalTenantName, mock.companyName);
  assert.equal(switched.status, "CONNECTED"); assert.equal(switched.pendingCompanySwitch, null); assert.deepEqual(switched.config, {});
  assert.equal(decryptCredential(row.encrypted_access_token, service.aad("access"), env), "fixture-access-0-au");
  assert.equal(decryptCredential(row.encrypted_refresh_token, service.aad("refresh"), env), "fixture-refresh-0-au");
  assert.equal(JSON.parse(row.organisations_json)[0].id, mock.realm);
  const config = await reloaded.getConfig(); assert.equal(config.organisation.country, "AU"); assert.equal(config.organisation.currency, "AUD");
  assert.equal(config.externalTenantId, mock.realm);
  for (const table of historyTables) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), history[table], table);
  assert.deepEqual(db.prepare("SELECT * FROM settings ORDER BY key").all(), genericSettings);
  assert.equal(reloaded.store.mapping(mock.realm, "customer", "customer"), undefined);
  await assert.rejects(reloaded.syncInvoice("job"), { code: "INVOICE_PROVIDER_CONFLICT" });
  await assert.rejects(reloaded.syncInvoice("job-b"), { code: "ITEM_MAPPING" });
  await reloaded.configure({ itemId: "20", taxMappings: { taxable: "30" } }); await reloaded.syncInvoice("job-b");
  assert.equal(mock.customers.length, 1); assert.equal(mock.invoices.length, 1);
  assert.ok(reloaded.store.mapping(oldRealm, "customer", "customer")); assert.ok(reloaded.store.mapping(mock.realm, "customer", "customer"));
  await assert.rejects(reloaded.switchCompany(proposed.id, true), { code: "COMPANY_SWITCH_EXPIRED" });
});

test("pending company confirmation pauses webhooks without consuming retries or changing active connection health", async (t) => {
  const { service, mock, db, env } = fixture(t); await ready(service); await service.syncInvoice("job");
  const events = event(mock); persistQuickBooksEvents(db, events);
  Object.assign(mock, { realm: "987654321", tokenSuffix: "-new" });
  const pending = (await consent(service, mock.realm)).pendingCompanySwitch;
  const previous = service.store.integration(), calls = mock.calls.length;
  await assert.rejects(service.getConfig(), { code: "COMPANY_SWITCH_PENDING" });
  for (let i = 0; i < 3; i++) await processQuickBooksInbox(db, { env, fetchImpl: mock.fetch });
  assert.equal(mock.calls.length, calls); assert.deepEqual(service.store.integration(), previous);
  const queued = db.prepare("SELECT status,attempt_count FROM integration_webhook_events").get();
  assert.equal(queued.status, "PAUSED"); assert.equal(queued.attempt_count, 1);
  await service.switchCompany(pending.id, false); mock.realm = "123456789";
  await processQuickBooksInbox(db, { env, fetchImpl: mock.fetch });
  assert.equal(db.prepare("SELECT status FROM integration_webhook_events").get().status, "PROCESSED");
});

test("failed QuickBooks exchange, metadata validation or permission grant leaves the old active row intact", async (t) => {
  const { service, mock } = fixture(t); await ready(service);
  for (const failure of [{ path: "/tokens/bearer", status: 400, body: { error: "invalid_grant" } },
    { path: "/companyinfo/", status: 503 }, { path: "/preferences", body: { Preferences: {} }, status: 200 },
    { path: "/tokens/bearer", status: 200, body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: "missing-accounting" } }]) {
    const state = await nonce(service), previous = service.store.integration(); mock.failNext = failure;
    await assert.rejects(service.callback({ state, realmId: mock.realm, code: "fixture" }));
    assert.deepEqual(service.store.integration(), previous);
  }
});

test("switch cancellation, expiry and superseded confirmations cannot change active credentials or realm", async (t) => {
  const { service, mock } = fixture(t); await ready(service); const previous = service.store.integration();
  Object.assign(mock, { realm: "987654321", tokenSuffix: "-new" });
  const first = (await consent(service, mock.realm)).pendingCompanySwitch;
  const second = (await consent(service, mock.realm)).pendingCompanySwitch;
  await assert.rejects(service.switchCompany(first.id, true), { code: "COMPANY_SWITCH_EXPIRED" });
  const metadata = JSON.parse(service.store.integration().credential_metadata_json);
  metadata.pendingCompanySwitch.expiresAt = 0; service.store.update({ credential_metadata_json: JSON.stringify(metadata) });
  await assert.rejects(service.switchCompany(second.id, true), { code: "COMPANY_SWITCH_EXPIRED" });
  const third = (await consent(service, mock.realm)).pendingCompanySwitch;
  await service.switchCompany(third.id, false);
  assert.equal(service.status().pendingCompanySwitch, null);
  for (const key of ["encrypted_access_token", "encrypted_refresh_token", "external_tenant_id", "config_json", "organisations_json", "credential_metadata_json", "status"]) assert.equal(service.store.integration()[key], previous[key]);
});

test("failed switch verification or SQLite realm write rolls back new tokens and retains the old company", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service);
  Object.assign(mock, { realm: "987654321", tokenSuffix: "-new" });
  const proposed = (await consent(service, mock.realm)).pendingCompanySwitch, previous = service.store.integration();
  mock.failNext = { path: "/companyinfo/", status: 403 };
  await assert.rejects(service.switchCompany(proposed.id, true), { code: "NEEDS_REAUTHORIZATION" });
  assert.deepEqual(service.store.integration(), previous);
  db.exec("CREATE TEMP TRIGGER reject_realm BEFORE UPDATE OF external_tenant_id ON workspace_integrations BEGIN SELECT RAISE(ABORT, 'fixture transaction failure'); END");
  await assert.rejects(service.switchCompany(proposed.id, true), { code: "INTEGRATION_ERROR" });
  assert.deepEqual(service.store.integration(), previous);
  db.exec("DROP TRIGGER reject_realm");
  await service.switchCompany(proposed.id, true); assert.equal(service.status().externalTenantId, mock.realm);
});

test("legacy split token and realm state cannot send requests to the old company", async (t) => {
  const { service, mock } = fixture(t); await ready(service);
  service.store.update({ status: "SELECT_ORGANISATION", organisations_json: JSON.stringify([{ id: "987654321", name: "New company" }]) });
  const calls = mock.calls.length;
  await assert.rejects(service.chooseOrganisation("987654321", true), { code: "REALM_MISMATCH" });
  await assert.rejects(service.getConfig(), { code: "REALM_MISMATCH" });
  assert.equal(mock.calls.length, calls);
});

test("QuickBooks callback diagnostics allowlist metadata and are disabled outside local development Sandbox", async (t) => {
  const { env } = fixture(t), lines = [];
  t.mock.method(fs, "mkdirSync", () => {}); t.mock.method(fs, "appendFileSync", (_path, data) => lines.push(JSON.parse(data)));
  const local = { ...env, NODE_ENV: "development" };
  const fields = { callbackRealmId: "123456789", previousRealmId: "987654321", code: "secret-code", accessToken: "secret-access", refreshToken: "secret-refresh",
    company: { name: "Fixture company", country: "AU", currency: "AUD", email: "private-customer@example.test" } };
  quickBooksOAuthDiagnostic(local, "callback_received", fields);
  assert.equal(lines.length, 1); assert.equal(lines[0].callbackRealmId, fields.callbackRealmId);
  assert.deepEqual(Object.keys(lines[0]), ["at", "event", "environment", "callbackRealmId", "previousRealmId", "companyName", "country", "homeCurrency"]);
  assert.ok(!JSON.stringify(lines).includes("secret")); assert.ok(!JSON.stringify(lines).includes("private-customer"));
  for (const patch of [{ QUICKBOOKS_OAUTH_DIAGNOSTICS: "0" }, { NODE_ENV: "test" }, { NODE_ENV: "production" }, { FLY_APP_NAME: "app" },
    { FLY_MACHINE_ID: "machine" }, { QUICKBOOKS_ENVIRONMENT: "production" }, { QUICKBOOKS_REDIRECT_URI: "https://example.test/callback" }]) {
    quickBooksOAuthDiagnostic({ ...local, ...patch }, "callback_received", fields);
  }
  assert.equal(lines.length, 1);
});

test("Sandbox credentials, mappings, state and endpoints cannot be reused in production", async (t) => {
  const { service, db, env, mock, authorizeOAuthInitiator } = fixture(t); await ready(service); const state = await nonce(service);
  const production = new AccountingService(db, { providerId: "quickbooks", env: { ...env, QUICKBOOKS_ENVIRONMENT: "production" }, fetchImpl: mock.fetch, authorizeOAuthInitiator });
  const calls = mock.calls.length;
  await assert.rejects(production.callback({ state, code: "bad", realmId: mock.realm }), { code: "INVALID_OAUTH_STATE" });
  await assert.rejects(production.testConnection(), { code: "ENVIRONMENT_MISMATCH" }); assert.equal(mock.calls.length, calls);
  assert.equal(production.status().serverConfigured, false);
  assert.ok(mock.calls.filter((call) => call.url.includes("/v3/company/")).every((call) => new URL(call.url).hostname === "sandbox-quickbooks.api.intuit.com"));
});

test("configuration requires AU company, matching currency, custom numbers, active service/income account and exact sales GST", async (t) => {
  const { service, mock } = fixture(t); await ready(service);
  for (const [key, value, code] of [["country", "US", "COUNTRY_MISMATCH"], ["currency", "USD", "CURRENCY_MISMATCH"], ["customNumbers", false, "INVOICE_NUMBER_SETTING"]]) {
    const previous = mock[key]; mock[key] = value; await assert.rejects(service.syncInvoice("job"), { code }); mock[key] = previous;
  }
  mock.items[0].Type = "Inventory"; await assert.rejects(service.syncInvoice("job"), { code: "ITEM_MAPPING" }); mock.items[0].Type = "Service";
  mock.accounts[0].Active = false; await assert.rejects(service.syncInvoice("job"), { code: "ITEM_MAPPING" }); mock.accounts[0].Active = true;
  mock.taxRates[0].RateValue = 5; await assert.rejects(service.syncInvoice("job"), { code: "TAX_MAPPING" });
  assert.equal(mock.customers.length, 0); assert.equal(mock.invoices.length, 0);
});

test("real Sandbox tax payload explains the empty GST choice as US/USD rather than a failed TaxCode query", async (t) => {
  const { service, mock } = fixture(t);
  const observed = JSON.parse(fs.readFileSync(new URL("./fixtures/quickbooks-tax-sandbox-us.json", import.meta.url), "utf8"));
  Object.assign(mock, { country: observed.CompanyInfo.Country, currency: observed.Preferences.CurrencyPrefs.HomeCurrency.value,
    usingSalesTax: observed.Preferences.TaxPrefs.UsingSalesTax, taxCodes: observed.TaxCode, taxRates: observed.TaxRate });
  await consent(service);
  const result = await service.getConfig();
  assert.equal(result.organisation.usingSalesTax, true);
  assert.deepEqual(result.taxRates, [{ id: "2", name: "California", rate: 8, rateId: "3" }]);
  assert.equal(result.configurationIssue.code, "COUNTRY_MISMATCH");
  assert.match(result.configurationIssue.message, /US tax settings and USD.*Australian company with AUD/);
  assert.ok(mock.calls.some((call) => new URL(call.url).searchParams.get("query") === "SELECT * FROM TaxCode WHERE Active = true STARTPOSITION 1 MAXRESULTS 1000"));
  await assert.rejects(service.configure({ itemId: "20", taxMappings: { taxable: "2" } }), { code: "COUNTRY_MISMATCH" });
  assert.deepEqual(service.status().config, {}); assert.equal(mock.invoices.length, 0);
});

test("synthetic AU sales TaxCode excludes inactive/purchase-only codes and persists its ID across reload", async (t) => {
  const { service, mock, db, env } = fixture(t);
  mock.taxCodes[0].Name = "Fixture AU sales GST";
  mock.taxCodes.push({ ...structuredClone(mock.taxCodes[0]), Id: "40", Name: "Inactive fixture", Active: false },
    { Id: "41", Name: "Purchases fixture", Active: true, PurchaseTaxRateList: structuredClone(mock.taxCodes[0].SalesTaxRateList) });
  await consent(service);
  const result = await service.getConfig();
  assert.deepEqual(result.taxRates, [{ id: "30", name: "Fixture AU sales GST", rate: 10, rateId: "31" }]);
  assert.equal(result.configurationIssue, null); assert.equal(result.organisation.usingSalesTax, true);
  await service.configure({ itemId: "20", taxMappings: { taxable: "30" } });
  const reloaded = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: mock.fetch });
  assert.equal((await reloaded.getConfig()).config.taxMappings.taxable, "30");
  await reloaded.syncInvoice("job");
  const line = mock.invoices[0].Line[0].SalesItemLineDetail;
  assert.equal(line.TaxCodeRef.value, "30"); assert.notEqual(line.TaxCodeRef.value, "31");
  assert.equal(mock.invoices[0].TxnTaxDetail.TotalTax, 100); assert.equal(mock.invoices[0].TotalAmt, 1100);
});

test("disabled GST blocks configuration while unknown preference is reported without guessing", async (t) => {
  const { service, mock } = fixture(t); mock.usingSalesTax = false; await consent(service);
  const disabled = await service.getConfig();
  assert.equal(disabled.configurationIssue.code, "GST_DISABLED");
  assert.match(disabled.configurationIssue.message, /^GST is not enabled in this QuickBooks company/);
  await assert.rejects(service.configure({ itemId: "20", taxMappings: { taxable: "30" } }), { code: "GST_DISABLED" });
  assert.deepEqual(service.status().config, {});
  mock.usingSalesTax = undefined;
  const unknown = await service.getConfig(); assert.equal(unknown.organisation.usingSalesTax, null); assert.equal(unknown.configurationIssue, null);
});

test("no active matching GST codes gives an actionable error and never manufactures a fallback", async (t) => {
  const { service, mock } = fixture(t); await consent(service);
  for (const codes of [[], [{ ...mock.taxCodes[0], Active: false }]]) {
    mock.taxCodes = codes;
    const result = await service.getConfig();
    assert.deepEqual(result.taxRates, []);
    assert.equal(result.configurationIssue.message, "No active QuickBooks GST tax codes were found. Check GST settings in your QuickBooks company.");
    await assert.rejects(service.configure({ itemId: "20", taxMappings: { taxable: "30" } }), { code: "TAX_MAPPING" });
  }
  assert.deepEqual(service.status().config, {});
});

test("tax diagnostics are opt-in local Sandbox only and omit credentials and unrelated payload fields", async (t) => {
  const { mock, env } = fixture(t);
  mock.taxCodes[0].Description = "private-accounting-canary";
  mock.taxCodes[0].SalesTaxRateList.TaxRateDetail[0].secret = "private-detail-canary";
  const logger = t.mock.method(console, "info", () => {});
  const diagnosticEnv = { ...env, NODE_ENV: "development", QUICKBOOKS_TAX_DIAGNOSTICS: "1" };
  const context = { tenantId: mock.realm, accessToken: "private-access-canary" };
  await new QuickBooksAccountingProvider({ env: diagnosticEnv, fetchImpl: mock.fetch }).getTaxRates(context);
  assert.equal(logger.mock.calls.length, 1);
  const logged = logger.mock.calls[0].arguments.join(" ");
  assert.match(logged, /"taxCodeCount":1/); assert.match(logged, /"id":"30","name":"GST","active":true/);
  assert.match(logged, /"taxRateId":"31"/);
  for (const secret of ["private-accounting-canary", "private-detail-canary", "private-access-canary", env.QUICKBOOKS_CLIENT_SECRET, env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY]) assert.ok(!logged.includes(secret));
  for (const patch of [{ QUICKBOOKS_TAX_DIAGNOSTICS: "" }, { NODE_ENV: "production" }, { NODE_ENV: "test" }, { FLY_APP_NAME: "test-app" },
    { QUICKBOOKS_ENVIRONMENT: "production" }, { QUICKBOOKS_REDIRECT_URI: "https://example.test/callback" }]) {
    await new QuickBooksAccountingProvider({ env: { ...diagnosticEnv, ...patch }, fetchImpl: mock.fetch }).getTaxRates(context);
  }
  assert.equal(logger.mock.calls.length, 1);
});

test("issued invoice maps billing Customer, line item, GST, DocNumber and exact totals; multiple sites reuse customer", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service); await service.syncInvoice("job"); await service.syncInvoice("job"); await service.syncInvoice("job-b");
  assert.equal(mock.customers.length, 1); assert.equal(mock.invoices.length, 2); assert.equal(mock.customers[0].BillAddr.Line1, "Customer billing address");
  const external = mock.invoices[0]; assert.equal(external.CustomerRef.value, mock.customers[0].Id); assert.equal(external.DocNumber, "INV-0278");
  assert.equal(external.Line[0].SalesItemLineDetail.ItemRef.value, "20"); assert.equal(external.Line[0].SalesItemLineDetail.TaxCodeRef.value, "30");
  assert.equal(external.TotalAmt, 1100); assert.equal(external.TxnTaxDetail.TotalTax, 100); assert.equal(external.GlobalTaxCalculation, "TaxExcluded");
  assert.equal(db.prepare("SELECT external_version FROM integration_entity_mappings WHERE local_entity_id='invoice'").get().external_version, "0");
  assert.ok(mock.calls.filter((call) => call.method === "POST" && call.url.includes("/v3/company/")).every((call) => !/payment|send|item|account/.test(new URL(call.url).pathname.split("/").at(-1))));
});

test("draft does not sync; customer collision cannot merge by name or email", async (t) => {
  const f = fixture(t, { draft: true }); await ready(f.service);
  await assert.rejects(f.service.syncInvoice("job"), { code: "INVOICE_INELIGIBLE" }); assert.equal(f.mock.customers.length, 0);
  const g = fixture(t); await ready(g.service); await g.service.syncInvoice("job");
  g.db.prepare("DELETE FROM integration_entity_mappings WHERE local_entity_type='customer'").run(); g.mock.customers[0].Notes = "belongs to someone else";
  await assert.rejects(g.service.syncInvoice("job-b"), { code: "CONTACT_CONFLICT" }); assert.equal(g.mock.customers.length, 1);
});

test("lost create response reconciles one invoice using marker/content/number and durable requestid", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service); mock.loseInvoiceResponse = true;
  await assert.rejects(service.syncInvoice("job"), { code: "PROVIDER_UNAVAILABLE" }); assert.equal(mock.invoices.length, 1);
  await service.syncInvoice("job"); assert.equal(mock.invoices.length, 1);
  assert.equal(db.prepare("SELECT status FROM integration_operations WHERE entity_type='invoice'").get().status, "DONE");
  assert.equal(mock.calls.filter((call) => call.method === "POST" && new URL(call.url).pathname.endsWith("/invoice")).length, 1);
});

test("sparse updates preserve unrelated remote fields and use current SyncToken; stale token refetch never overwrites", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service); await service.syncInvoice("job");
  mock.invoices[0].BillEmail = { Address: "remote@example.test" }; mock.invoices[0].SyncToken = "4";
  db.prepare("UPDATE invoice_line_items SET description=?, rate_cents=? WHERE invoice_id=?").run("Service revised", 55000, "invoice");
  await service.syncInvoice("job"); assert.equal(mock.invoices.length, 1); assert.equal(mock.invoices[0].SyncToken, "5"); assert.equal(mock.invoices[0].BillEmail.Address, "remote@example.test");
  const write = mock.calls.filter((call) => call.body?.Id).at(-1); assert.equal(write.body.sparse, true); assert.equal(write.body.SyncToken, "4");
  db.prepare("UPDATE invoice_line_items SET description=? WHERE invoice_id=?").run("Another revision", "invoice");
  mock.staleNext = true; await assert.rejects(service.syncInvoice("job"), { code: "EXTERNAL_EDIT_CONFLICT" });
  assert.equal(mock.invoices[0].Line[0].Description, "Service revised");
  assert.equal(service.store.operation(mock.realm, "invoice", "invoice").status, "REJECTED");
  await service.syncInvoice("job"); assert.equal(mock.invoices[0].Line[0].Description, "Another revision");
});

test("a tax response mismatch keeps the external ID, returns review and preserves ELSET data", async (t) => {
  const { service, db, mock } = fixture(t); await ready(service);
  const source = db.prepare("SELECT * FROM invoices").all(), lines = db.prepare("SELECT * FROM invoice_line_items").all();
  const create = service.provider.createInvoice.bind(service.provider);
  service.provider.createInvoice = async (...args) => { const row = await create(...args); row.TotalAmt += 0.01; row.TxnTaxDetail.TotalTax += 0.01; return row; };
  await assert.rejects(service.syncInvoice("job"), { code: "ACCOUNTING_REVIEW_REQUIRED" });
  assert.equal(mock.invoices.length, 1); assert.ok(service.invoiceStatus("job").externalId); assert.equal(service.invoiceStatus("job").status, "CONFLICT");
  assert.deepEqual(db.prepare("SELECT * FROM invoices").all(), source); assert.deepEqual(db.prepare("SELECT * FROM invoice_line_items").all(), lines);
});

test("new company consent requires confirmation and preserves old realm mappings", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service); await service.syncInvoice("job");
  const old = db.prepare("SELECT * FROM integration_entity_mappings").all();
  mock.realm = "987654321"; await consent(service, mock.realm);
  assert.equal(service.status().status, "CONNECTED");
  await assert.rejects(service.chooseOrganisation(mock.realm, false), { code: "COMPANY_SWITCH_PENDING" });
  await service.switchCompany(service.status().pendingCompanySwitch.id, true); assert.deepEqual(service.status().config, {});
  await service.configure({ itemId: "20", taxMappings: { taxable: "30" } });
  await assert.rejects(service.syncInvoice("job"), { code: "INVOICE_PROVIDER_CONFLICT" });
  assert.deepEqual(db.prepare("SELECT * FROM integration_entity_mappings").all(), old);
});

test("workspace state cannot cross providers or workspaces; a refresh failure retains ciphertext and needs reconnect", async (t) => {
  const f = fixture(t), g = fixture(t); const state = await nonce(f.service);
  await assert.rejects(g.service.callback({ state, code: "wrong-workspace", realmId: g.mock.realm }), { code: "INVALID_OAUTH_STATE" });
  const xero = new AccountingService(f.db, { env: f.env, fetchImpl: f.mock.fetch, authorizeOAuthInitiator: f.authorizeOAuthInitiator });
  await assert.rejects(xero.callback({ state, code: "wrong-provider" }), { code: "INVALID_OAUTH_STATE" });
  await f.service.callback({ state, code: "good", realmId: f.mock.realm });
  f.service.store.update({ token_expires_at: 0 }); const previous = f.service.store.integration().encrypted_refresh_token;
  f.mock.failNext = { path: "/tokens/bearer", status: 400, body: { error: "invalid_grant", error_description: "private diagnostic" } };
  await assert.rejects(f.service.testConnection(), { code: "NEEDS_REAUTHORIZATION" });
  assert.equal(f.service.store.integration().encrypted_refresh_token, previous); assert.equal(f.service.status().status, "NEEDS_REAUTHORIZATION");
  assert.ok(!JSON.stringify(f.service.status()).includes("private diagnostic"));
});

test("remote managed-field edits, void/deletion and total mismatch stop safely with retained identity", async (t) => {
  const { service, mock } = fixture(t); await ready(service); await service.syncInvoice("job");
  mock.invoices[0].Line[0].Description = "External edit";
  await assert.rejects(service.syncInvoice("job"), { code: "EXTERNAL_EDIT_CONFLICT" });
  mock.invoices[0].TotalAmt = 0; await assert.rejects(service.syncInvoice("job"), { code: "ACCOUNTING_STATE_CONFLICT" });
  mock.invoices.length = 0; await assert.rejects(service.syncInvoice("job"), { code: "EXTERNAL_NOT_FOUND" }); assert.ok(service.invoiceStatus("job").externalId);
});

test("partial, full, multiple, corrected and removed receipts are idempotent normal payment rows", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service); await service.syncInvoice("job");
  allocations(mock, [["900", 500]]); await service.syncPayments("job"); assert.equal(paid(db), 50000);
  assert.equal(getCustomerAccountSummary(db, "customer").outstandingCents, 170000);
  const paymentId = db.prepare("SELECT id FROM payments").get().id;
  await service.syncPayments("job"); assert.equal(db.prepare("SELECT count(*) n FROM payments").get().n, 1);
  allocations(mock, [["900", 500], ["901", 600]]); await service.syncPayments("job"); assert.equal(paid(db), 110000);
  assert.equal(getCustomerAccountSummary(db, "customer").outstandingCents, 110000);
  allocations(mock, [["900", 450], ["901", 600]]); await service.syncPayments("job"); assert.equal(paid(db), 105000);
  assert.equal(db.prepare("SELECT amount_cents FROM payments WHERE id=?").get(paymentId).amount_cents, 45000);
  allocations(mock, [["901", 600]]); await service.syncPayments("job"); assert.equal(paid(db), 60000);
  assert.equal(db.prepare("SELECT status FROM integration_external_payments WHERE external_payment_id='900'").get().status, "REMOVED");
  const projected = loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === "job").invoice;
  assert.equal(projected.paymentManagement, "quickbooks"); assert.equal(projected.payments[0].source, "quickbooks");
  assert.throws(() => addInvoicePayment(db, "job", { amount: 1, date: "2026-09-18" }), { code: "PAYMENTS_MANAGED_EXTERNALLY" });
});

test("one Payment across two invoices imports only each allocation; reallocation commits both atomically", async (t) => {
  const { service, mock, db } = fixture(t); await ready(service); await service.syncInvoice("job"); await service.syncInvoice("job-b");
  const [a, b] = mock.invoices;
  mock.setPayments([{ id: "900", allocations: [[a.Id, 300], [b.Id, 200]], unapplied: 50 }]);
  await service.syncPayments("job"); assert.equal(paid(db), 30000); assert.equal(paid(db, "invoice-b"), 20000);
  assert.equal(db.prepare("SELECT count(*) n FROM integration_external_payments").get().n, 2);
  mock.setPayments([{ id: "900", allocations: [[b.Id, 500]], unapplied: 50 }]);
  await service.syncPayments("job-b"); assert.equal(paid(db), 0); assert.equal(paid(db, "invoice-b"), 50000);
  mock.setPayments([{ id: "900", allocations: [[a.Id, 500]], unapplied: 50 }]);
  db.exec("CREATE TRIGGER fail_qb_payment BEFORE INSERT ON payments WHEN NEW.invoice_id='invoice' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await assert.rejects(service.syncPayments("job-b")); assert.equal(paid(db), 0); assert.equal(paid(db, "invoice-b"), 50000);
});

test("manual history, credit memos and incomplete payment allocations require review without changing balances", async (t) => {
  const f = fixture(t, { manual: true }); await ready(f.service); await f.service.syncInvoice("job"); allocations(f.mock, [["900", 500]]);
  await assert.rejects(f.service.syncPayments("job"), { code: "MANUAL_PAYMENT_CONFLICT" }); assert.equal(paid(f.db), 10000);
  const g = fixture(t); await ready(g.service); await g.service.syncInvoice("job"); allocations(g.mock, [["900", 500]]);
  g.mock.payments[0].Line[0].LinkedTxn.push({ TxnId: "800", TxnType: "CreditMemo" });
  await assert.rejects(g.service.syncPayments("job"), { code: "ACCOUNTING_REVIEW_REQUIRED" }); assert.equal(paid(g.db), 0);
});

test("provider enablement is exclusive and historical invoices cannot be sent to another provider", async (t) => {
  const { service, db } = fixture(t); await ready(service); await service.syncInvoice("job");
  assert.throws(() => updateWorkspaceAddons(db, { xero: true }), { code: "ACCOUNTING_PROVIDER_CONFLICT" });
  updateWorkspaceAddons(db, { quickbooks: false }); updateWorkspaceAddons(db, { xero: true });
  const xero = new AccountingService(db); xero.store.ensureIntegration(); xero.store.update({ external_tenant_id: "xero-company" });
  await assert.rejects(xero.syncInvoice("job"), { code: "INVOICE_PROVIDER_CONFLICT" });
  assert.equal(db.prepare("SELECT count(*) n FROM integration_entity_mappings").get().n, 2);
});

test("CloudEvents persist minimal metadata; Invoice/Payment replay, unknown realm/resource and retries are safe", async (t) => {
  const { service, mock, db, env } = fixture(t); await ready(service); await service.syncInvoice("job"); allocations(mock, [["900", 500]]);
  const payload = event(mock); assert.equal(persistQuickBooksEvents(db, payload), 1); assert.equal(persistQuickBooksEvents(db, payload), 0); assert.equal(paid(db), 0);
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM integration_webhook_events").all()).includes("not stored"));
  await processQuickBooksInbox(db, { env, fetchImpl: mock.fetch }); assert.equal(paid(db), 50000);
  persistQuickBooksEvents(db, event(mock, { realm: "999" })); persistQuickBooksEvents(db, event(mock, { resource: "999" }));
  await processQuickBooksInbox(db, { env, fetchImpl: mock.fetch }); assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events WHERE status='IGNORED'").get().n, 2);
  allocations(mock, []); persistQuickBooksEvents(db, event(mock, { resource: "900", type: "qbo.payment.deleted.v1" }));
  await processQuickBooksInbox(db, { env, fetchImpl: mock.fetch }); assert.equal(paid(db), 0);
  persistQuickBooksEvents(db, event(mock)); mock.failNext = { path: "/invoice/", status: 429, headers: { "Retry-After": "120" } };
  await processQuickBooksInbox(db, { env, fetchImpl: mock.fetch }); assert.ok(db.prepare("SELECT retry_at FROM integration_webhook_events WHERE status='RETRYABLE'").get().retry_at > Date.now());
});

test("public webhook verifies exact raw HMAC bytes, persists before ACK, and never creates auth cookies", async (t) => {
  const { service, mock, db, env } = fixture(t, { file: true }); await ready(service); await service.syncInvoice("job");
  let woke = 0; const app = express(); registerQuickBooksWebhook(app, { env, worker: { wake() { woke++; assert.equal(db.prepare("SELECT count(*) n FROM integration_webhook_events").get().n, 1); } } }); app.use(express.json());
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const body = Buffer.from(JSON.stringify(event(mock), null, 2)), signature = crypto.createHmac("sha256", env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN).update(body).digest("base64");
  assert.equal(verifyQuickBooksSignature(body, signature, env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN), true);
  assert.equal(verifyQuickBooksSignature(Buffer.from(body.toString().trim() + " "), signature, env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN), false);
  const url = `http://127.0.0.1:${server.address().port}/api/integrations/quickbooks/webhook`;
  for (const sig of ["", "x".repeat(43) + "="]) assert.equal((await fetch(url, { method: "POST", body, headers: { "intuit-signature": sig } })).status, 401);
  const response = await fetch(url, { method: "POST", body, headers: { "intuit-signature": signature, "Content-Type": "application/json" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("set-cookie"), null); assert.equal(woke, 1); assert.equal(paid(db), 0);
});

test("HTTP callback is public while connect/config/sync remain protected; redirect contains no code or cookies", async (t) => {
  const { db, env, mock, authorizeOAuthInitiator } = fixture(t, { file: true });
  let authCalls = 0; const app = express(); app.use(express.json());
  app.use(createAccountingRouter({ env, fetchImpl: mock.fetch, authorizeOAuthInitiator,
    requireAuth(req, res, next) { authCalls++; if (!req.get("x-test-user")) return res.status(401).end(); req.user = { id: "admin", role: req.get("x-test-role") || "office" }; req.authSession = { id: "session" }; next(); },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).end() }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/integrations/quickbooks`;
  assert.equal((await fetch(`${base}/connect`, { method: "POST" })).status, 401);
  const connected = await fetch(`${base}/connect`, { method: "POST", headers: { "x-test-user": "admin", "X-Accounting-Request": "1" } });
  const state = new URL((await connected.json()).result.url).searchParams.get("state"), calls = authCalls;
  const result = await fetch(`${base}/callback?${new URLSearchParams({ state, code: "sensitive-code", realmId: mock.realm })}`, { redirect: "manual" });
  assert.equal(result.status, 302); assert.equal(authCalls, calls); assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(result.headers.get("location"), "/settings?accounting=quickbooks&result=connected"); assert.equal(await result.text(), "");
  assert.equal(db.prepare("SELECT external_tenant_id FROM workspace_integrations").get().external_tenant_id, mock.realm);
  const forbidden = await fetch(`${base}/config`, { method: "PATCH", headers: { "x-test-user": "technician", "x-test-role": "technician", "X-Accounting-Request": "1" } }); assert.equal(forbidden.status, 403);
});
