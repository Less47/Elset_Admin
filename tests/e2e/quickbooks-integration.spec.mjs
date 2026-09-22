import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { insertJobTree } from "../../server-workspace-jobs.js";
import { normalizeStoredData } from "../../server-store.js";
import { themePresets } from "../../src/lib/theme-presets.js";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { quickBooksCloudEvent } from "../helpers/quickbooks-webhooks.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(root, "test-results/quickbooks-v3");
const password = "Costing-fixture-login-123";
let dataDir, baseUrl, server, serverOutput = "";
const sessions = {};
function withDb(callback, options = {}) {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db"), ...options });
  try { return callback(db); } finally { db.close(); }
}
function fixture() {
  const data = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
  const job = data.jobs[0];
  data.maintenancePlans = [];
  data.jobs = [
    ["costing-job", 7101, 1000, 4800, 0, true],
    ["quote-only", 7102, null, 10000, 0, false],
    ["other-job", 7103, 99000, 99000, 0, true],
    ["draft-job", 7104, 9000, 9000, 0, false],
  ].map(([id, jobNumber, rate, quoted, paid, sent]) => ({
    ...job, id, jobNumber, title: `Costing example ${jobNumber}`, description: `Service work ${jobNumber}`,
    status: "Completed", maintenancePlanId: "", notes: [], photos: [],
    quote: { type: "quote", issueDate: "2026-09-14", items: [{ description: "Quoted work", qty: 1, rate: quoted }], sentHistory: [] },
    invoice: rate === null ? null : { type: "invoice", issueDate: "2026-09-16", dueDate: "2026-09-30", items: [{ description: "Invoiced work", qty: 1, rate }],
      sentHistory: sent ? [{ id: `sent-${id}`, sentAt: "2026-09-16T01:00:00.000Z", toEmail: "fixture@example.test" }] : [],
      payments: paid ? [{ id: `payment-${id}`, date: "2026-09-17", amount: paid }] : [] },
  }));
  return data;
}

test.beforeAll(async ({ browser }) => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-quickbooks-e2e-"));
  fs.mkdirSync(screenshots, { recursive: true });
  withDb((db) => importWorkspaceJsonData(db, fixture()));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney",
    ELSET_DATA_DIR: dataDir, ELSET_AUTH_DB_PATH: path.join(dataDir, "auth.db"),
    ELSET_WORKSPACE_DB_PATH: path.join(dataDir, "elset-workspace.db"), ELSET_WORKSPACE_STORAGE: "sqlite",
    BETTER_AUTH_URL: baseUrl, ELSET_FRONTEND_URL: baseUrl, ELSET_API_PORT: String(port), PORT: String(port),
    ELSET_TEST_QUICKBOOKS: "1", QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: "quickbooks-e2e-signature-only", QUICKBOOKS_CLIENT_ID: "fixture-client", QUICKBOOKS_CLIENT_SECRET: "fixture-secret", QUICKBOOKS_REDIRECT_URI: `http://localhost:${port}/api/integrations/quickbooks/callback`, ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"), SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(root, "server-auth.js")).href)});
    await ensureAuthReady(); const context = await auth.$context;
    for (const role of ['admin','office','technician']) {
      const user = await context.internalAdapter.createUser({ email: role+'@costing.example.test', emailVerified: true, name: 'Costing '+role, role, username: 'costing'+role, displayUsername: 'Costing '+role, workspaceRole: role, staffId: '' });
      await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password: await context.password.hash(${JSON.stringify(password)}) });
    }
  `], { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (seed.status !== 0) throw new Error(`Fixture login setup failed: ${seed.stdout}\n${seed.stderr}`);
  server = spawn(process.execPath, ["tests/fixtures/quickbooks-server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { return (await fetch(`${baseUrl}/api/auth/me`)).status; } catch { return 0; }
  }, { timeout: 30000 }).toBe(401);
  for (const role of ["admin", "office", "technician"]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); await page.goto(baseUrl);
      await page.getByPlaceholder("Enter your username").fill(`costing${role}`);
      await page.getByPlaceholder("Enter your password").fill(password);
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible();
      sessions[role] = await context.storageState();
    } finally { await context.close(); }
  }
});
test.beforeEach(async ({ request }) => {
  await request.post(`${baseUrl}/__quickbooks-fixture`, { data: { reset: true } });
  withDb((db) => {
  for (const table of ["integration_webhook_events", "integration_external_payments", "integration_invoice_payment_sync", "integration_operations", "integration_locks", "integration_oauth_states", "integration_sync_log", "integration_entity_mappings", "workspace_integrations"]) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare("DELETE FROM jobs").run();
  for (const job of normalizeStoredData(fixture()).jobs) insertJobTree(db, job);
  db.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES('addons',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
    .run(JSON.stringify({ jobCosting: false, xero: false, quickbooks: false }), new Date().toISOString());
  });
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await info.attach("server-output", { body: serverOutput, contentType: "text/plain" }); });
test.afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => { const timer = setTimeout(resolve, 5000); server.once("exit", () => { clearTimeout(timer); resolve(); }); });
  }
  const target = path.resolve(dataDir || ".");
  if (target.startsWith(path.join(os.tmpdir(), "elset-quickbooks-e2e-"))) fs.rmSync(target, { recursive: true, force: true });
});

async function open(browser, { role = "admin", width = 1440, preset, path: target = "/settings?accounting=quickbooks" } = {}) {
  const context = await browser.newContext({ storageState: sessions[role], viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  if (preset) await page.route("**/api/user-preferences", async (route) => {
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ response, json: { ...body, preferences: { ...body.preferences, ...preset.values } } });
  });
  await page.goto(`${baseUrl}${target}`);
  return { context, page };
}
const card = (page) => page.getByRole("region", { name: "QuickBooks invoice sync" });
async function connectApi(context, { realmId = "123456789", configure = true } = {}) {
  expect((await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { quickbooks: true } })).ok()).toBeTruthy();
  const response = await context.request.post(`${baseUrl}/api/integrations/quickbooks/connect`, { data: {}, headers: { "X-Accounting-Request": "1" } });
  expect(response.ok()).toBeTruthy();
  const state = new URL((await response.json()).result.url).searchParams.get("state");
  // Native fetch sends no browser cookies; auth.db must authorize the initiator.
  const callback = await fetch(`${baseUrl}/api/integrations/quickbooks/callback?${new URLSearchParams({ state, code: "fixture", realmId })}`, { redirect: "manual" });
  expect(callback.status).toBe(302); expect(callback.headers.get("location")).toContain("result=connected");
  expect(callback.headers.get("set-cookie")).toBeNull(); expect(await callback.text()).toBe("");
  if (!configure) return;
  const configured = await context.request.patch(`${baseUrl}/api/integrations/quickbooks/config`, { data: { itemId: "20", taxMappings: { taxable: "30" } }, headers: { "X-Accounting-Request": "1" } });
  expect(configured.ok(), await configured.text()).toBeTruthy();
}
async function capture(page, info, name, locator) {
  const screenshot = path.join(screenshots, `${name}.png`);
  await locator.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  await locator.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach(name, { path: screenshot, contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function syncPayments(context, page, payments) {
  await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: { payments } });
  await card(page).getByRole("button", { name: "Sync from QuickBooks", exact: true }).click();
  await expect(card(page)).toContainText("Payment sync: Up to date");
}
for (const width of [390, 820, 1440]) test(`searchable sales items and explicit ELSET Services creation/reuse at ${width}px`, async ({ browser }, info) => {
  const { context, page } = await open(browser, { width });
  try {
    await connectApi(context, { configure: false });
    const items = Array.from({ length: 600 }, (_, index) => ({ Id: String(index + 1000), Name: `Part ${index}`, Sku: `SKU-${index}`, Type: "NonInventory", Active: true, IncomeAccountRef: { value: "11" } }));
    items[599] = { ...items[599], Name: "Batteries", FullyQualifiedName: "Electrical:Batteries", Sku: "BAT-SOLAR" };
    items.push({ Id: "20", Name: "Maintenance", Type: "Service", Active: true, IncomeAccountRef: { value: "10" } },
      { Id: "21", Name: "Hidden inventory", Type: "Inventory", Active: true, IncomeAccountRef: { value: "10" } },
      { Id: "22", Name: "Hidden inactive", Type: "Service", Active: false, IncomeAccountRef: { value: "10" } });
    await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: { items, accounts: [
      { Id: "10", Name: "Service Income", AccountType: "Income", Active: true },
      { Id: "11", Name: "Product Sales", AccountType: "Income", Active: true },
      { Id: "12", Name: "Unrelated expense", AccountType: "Expense", Active: true },
    ] } });
    await page.reload();
    const connection = page.getByLabel("QuickBooks connection", { exact: true });
    await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection).toContainText("Your ELSET descriptions, quantities and prices are still sent separately.");
    await connection.getByRole("button", { name: "Use existing QuickBooks item", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose QuickBooks sales item" });
    const search = picker.getByRole("textbox", { name: "Search QuickBooks sales items" });
    await expect(picker.getByRole("status")).toContainText("601 matching items · Showing 100");
    await expect(picker.getByRole("listitem")).toHaveCount(100);
    await picker.getByRole("button", { name: "Show more items" }).click();
    await expect(picker.getByRole("listitem")).toHaveCount(200);
    for (const query of ["Batteries", "Electrical:Batteries", "BAT-SOLAR"]) {
      await search.fill(query); await expect(picker.getByRole("listitem")).toHaveCount(1);
      await expect(picker.getByRole("listitem")).toContainText("Non-inventory · Product Sales");
    }
    await capture(page, info, `sales-item-picker-${width}`, picker);
    for (const query of ["NonInventory", "Non-inventory", "Product Sales"]) {
      await search.fill(query); await expect(picker.getByRole("status")).toContainText("600 matching items");
    }
    await search.fill("Service Income"); await expect(picker.getByRole("listitem")).toHaveCount(1); await expect(picker.getByRole("listitem")).toContainText("Maintenance");
    await search.fill("Hidden"); await expect(picker.getByRole("listitem")).toHaveCount(0);
    await search.fill("BAT-SOLAR"); await picker.getByRole("button", { name: "Use Electrical:Batteries", exact: true }).press("Enter");
    await connection.getByLabel("Default QuickBooks GST code", { exact: true }).selectOption("30");
    await connection.getByRole("button", { name: "Save QuickBooks configuration" }).click();
    await expect(connection).toContainText("QuickBooks configuration saved.");
    await page.reload(); await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.locator('[data-quickbooks-selected-item="1599"]')).toContainText("Batteries");
    await connection.getByRole("button", { name: 'Create "ELSET Services" in QuickBooks', exact: true }).click();
    const create = page.getByRole("dialog");
    await expect(create.getByRole("button", { name: "Create sales item", exact: true })).toBeDisabled();
    await expect(create.getByLabel("Income account for ELSET Services")).toHaveValue("");
    await expect(create.getByRole("option", { name: "Unrelated expense" })).toHaveCount(0);
    await create.getByLabel("Income account for ELSET Services").selectOption("10");
    await capture(page, info, `sales-item-create-${width}`, create);
    await create.getByRole("button", { name: "Create sales item", exact: true }).click();
    await expect(create).toHaveCount(0);
    await expect(connection).toContainText("Created ELSET Services · Service Income");
    await expect(connection.getByLabel("Default QuickBooks GST code")).toHaveValue("30");
    const beforeSave = await context.request.get(`${baseUrl}/api/integrations/quickbooks/status`);
    expect((await beforeSave.json()).result.config.itemId).toBe("1599");
    await connection.getByRole("button", { name: "Save QuickBooks configuration" }).click();
    await expect(connection).toContainText("QuickBooks configuration saved.");
    await connection.getByRole("button", { name: 'Use "ELSET Services"', exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Use existing ELSET Services", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(connection).toContainText("Reused existing ELSET Services · Service Income");
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    const remote = await (await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: {} })).json();
    expect(remote.items.filter(item => item.Name === "ELSET Services")).toHaveLength(1);
    expect(remote.calls.filter(call => call.method === "POST" && new URL(call.url).pathname.endsWith("/item"))).toHaveLength(1);
    expect(remote.invoices[0].Line[0].Description).toBe("Invoiced work");
    expect(remote.invoices[0].Line[0].SalesItemLineDetail.ItemRef.value).toBe(remote.items.find(item => item.Name === "ELSET Services").Id);
    expect(remote.invoices[0].TxnTaxDetail.TotalTax).toBe(100);
  } finally { await context.close(); }
});

test("QuickBooks consent, configuration, invoice, partial/full receipts, correction and disconnect", async ({ browser }, info) => {
  const { context, page } = await open(browser);
  try {
    await page.getByRole("switch", { name: "QuickBooks Online enabled" }).click();
    await expect(page.getByRole("switch", { name: "Xero enabled" })).toBeDisabled();
    await page.route("https://appcenter.intuit.com/**", (route) => {
      const state = new URL(route.request().url()).searchParams.get("state");
      return route.fulfill({ contentType: "text/html", body: `<a href="${baseUrl}/api/integrations/quickbooks/callback?state=${state}&code=fixture&realmId=123456789">Approve Sandbox</a>` });
    });
    await page.getByRole("button", { name: "Connect to QuickBooks", exact: true }).click(); await page.getByRole("link", { name: "Approve Sandbox" }).click();
    await expect(page).toHaveURL(/accounting=quickbooks&result=connected/);
    const connection = page.getByLabel("QuickBooks connection", { exact: true });
    await expect(connection.getByText("Connected", { exact: true })).toBeVisible(); await expect(connection).toContainText("Sandbox — test company");
    await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await page.getByRole("button", { name: "Use existing QuickBooks item", exact: true }).click();
    await page.getByRole("button", { name: "Use Service", exact: true }).click();
    await connection.getByLabel("Default QuickBooks GST code", { exact: true }).selectOption("30");
    await page.getByRole("button", { name: "Save QuickBooks configuration" }).click(); await expect(connection).toContainText("QuickBooks configuration saved.");
    await page.reload(); await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.getByLabel("Default QuickBooks GST code", { exact: true })).toHaveValue("30");
    await connection.getByRole("button", { name: "Test connection" }).click(); await expect(connection).toContainText("Connection verified");
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    await card(page).getByRole("button", { name: "Update QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    for (const [payments, balance] of [[[["900", 500]], "$600.00"], [[["900", 500], ["901", 600]], "$0.00"], [[["900", 450]], "$650.00"]]) {
      await syncPayments(context, page, payments);
      await expect(page.locator(".document-detail").filter({ has: page.getByText("Balance", { exact: true }) })).toContainText(balance);
    }
    await expect(page.getByRole("button", { name: "Add Payment", exact: true })).toHaveCount(0);
    await expect(page.locator(".document-payment input, .document-payment button")).toHaveCount(0);
    const remote = await (await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: {} })).json();
    expect(remote.customers).toHaveLength(1); expect(remote.invoices).toHaveLength(1); expect(remote.invoices[0].TotalAmt).toBe(1100);
    await capture(page, info, "quickbooks-invoice-reconciled", card(page));
    await page.goto(`${baseUrl}/settings?accounting=quickbooks`);
    await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect QuickBooks", exact: true }).click(); await expect(connection).toContainText("Not connected");
    expect(withDb((db) => db.prepare("SELECT encrypted_refresh_token FROM workspace_integrations WHERE provider='quickbooks'").get().encrypted_refresh_token)).toBeNull();
    expect(withDb((db) => db.prepare("SELECT count(*) n FROM integration_entity_mappings").get().n)).toBe(2);
  } finally { await context.close(); }
});
for (const width of [390, 1440]) test(`QuickBooks reconnect switches US to AU after named confirmation at ${width}px`, async ({ browser }, info) => {
  const { context, page } = await open(browser, { width });
  try {
    await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: { country: "US", currency: "USD", companyName: "Fixture US company" } });
    await connectApi(context, { configure: false });
    withDb((db) => db.prepare("UPDATE workspace_integrations SET config_json=? WHERE provider='quickbooks'").run(JSON.stringify({ itemId: "us-item", taxMappings: { taxable: "us-tax" } })));
    await page.reload();
    const connection = page.getByLabel("QuickBooks connection", { exact: true });
    await expect(connection).toContainText("Connected organisation: Fixture US company");
    await expect(connection.getByRole("button", { name: "Use organisation" })).toHaveCount(0);
    await expect(connection.locator("#quickbooks-organisation")).toHaveCount(0);
    await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: { realm: "987654321", country: "AU", currency: "AUD", companyName: "Fixture AU new company", tokenSuffix: "-au" } });
    await page.route("https://appcenter.intuit.com/**", (route) => {
      const state = new URL(route.request().url()).searchParams.get("state");
      return route.fulfill({ contentType: "text/html", body: `<a href="${baseUrl}/api/integrations/quickbooks/callback?state=${state}&code=fixture&realmId=987654321">Approve AU company</a>` });
    });
    await connection.getByRole("button", { name: "Reconnect QuickBooks", exact: true }).click();
    await page.getByRole("link", { name: "Approve AU company" }).click();
    await expect(page).toHaveURL(/result=confirm-company/);
    const dialog = page.getByRole("dialog", { name: "Switch QuickBooks company?" });
    await expect(dialog).toContainText("Current: Fixture US company"); await expect(dialog).toContainText("New: Fixture AU new company");
    await expect(dialog).toContainText("AU / AUD");
    await capture(page, info, `reconnect-confirm-${width}`, dialog);
    await page.reload(); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(connection).toContainText("Connected organisation: Fixture US company");
    await connection.getByRole("button", { name: "Reconnect QuickBooks", exact: true }).click();
    await page.getByRole("link", { name: "Approve AU company" }).click();
    await dialog.getByRole("button", { name: "Switch company", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(connection).toContainText("Connected organisation: Fixture AU new company");
    await expect(connection).toContainText("987654321 · AU · AUD"); await expect(connection).not.toContainText("Fixture US company");
    await expect(connection).toContainText("Configure this company's default sales item and GST code");
    await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.getByRole("group", { name: "Default QuickBooks sales item" })).toContainText("No default sales item selected.");
    await expect(connection.getByLabel("Default QuickBooks GST code", { exact: true })).toHaveValue("");
    await capture(page, info, `reconnect-active-au-${width}`, connection);
    await connection.getByRole("button", { name: "Use existing QuickBooks item", exact: true }).click();
    await page.getByRole("button", { name: "Use Service", exact: true }).click();
    await connection.getByLabel("Default QuickBooks GST code", { exact: true }).selectOption("30");
    await connection.getByRole("button", { name: "Save QuickBooks configuration" }).click();
    await expect(connection).toContainText("QuickBooks configuration saved.");
    await page.reload(); await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.locator('[data-quickbooks-selected-item="20"]')).toContainText("Service income");
    await expect(connection).not.toContainText("Fixture US company");
  } finally { await context.close(); }
});

for (const width of [390, 1440]) test(`tax configuration explains US company, disabled GST and missing codes at ${width}px`, async ({ browser }, info) => {
  const { context, page } = await open(browser, { width });
  try {
    await connectApi(context);
    for (const [scenario, message] of [["real-us", "US tax settings and USD"], ["disabled", "GST is not enabled"], ["empty", "No active QuickBooks GST tax codes were found"]]) {
      await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: { reset: true, taxScenario: scenario } });
      await page.reload();
      const connection = page.getByLabel("QuickBooks connection", { exact: true });
      await connection.getByRole("button", { name: "Configure", exact: true }).click();
      await expect(connection.getByRole("alert")).toContainText(message);
      await expect(connection.locator('[data-quickbooks-selected-item="20"]')).toContainText("Service income");
      await expect(connection.getByLabel("Default QuickBooks GST code", { exact: true })).toBeDisabled();
      if (scenario !== "disabled") await expect(connection.getByLabel("Default QuickBooks GST code", { exact: true })).toHaveValue("");
      if (scenario === "real-us") await expect(connection).toContainText("Company ID: 123456789 · US · USD");
      await expect(page.getByRole("button", { name: "Save QuickBooks configuration" })).toBeDisabled();
      await capture(page, info, `quickbooks-tax-${scenario}-${width}`, page.locator('[data-addon="quickbooks"]'));
    }
  } finally { await context.close(); }
});

test("real server processes signed CloudEvents and protects unsaved invoices and technician access", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await connectApi(context); await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: { payments: [["900", 500]] } });
    const raw = JSON.stringify([quickBooksCloudEvent({ id: "event-fixture", type: "qbo.payment.updated.v1" })], null, 3);
    const signature = crypto.createHmac("sha256", "quickbooks-e2e-signature-only").update(raw).digest("base64");
    const response = await fetch(`${baseUrl}/api/integrations/quickbooks/webhook`, { method: "POST", headers: { "Content-Type": "application/cloudevents+json", "intuit-signature": signature }, body: raw });
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toBeNull();
    await expect.poll(() => withDb((db) => db.prepare("SELECT status FROM integration_webhook_events").get().status, { readonly: true, migrate: false })).toBe("PROCESSED");
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(page.locator(".document-payment")).toContainText("QuickBooks payment");
    await page.getByLabel("Item 1 rate", { exact: true }).fill("1001"); await expect(card(page).getByRole("button", { name: "Sync from QuickBooks" })).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("1001");
    const technician = await browser.newContext({ storageState: sessions.technician });
    try { expect((await technician.request.get(`${baseUrl}/api/integrations/quickbooks/status`)).status()).toBe(403); } finally { await technician.close(); }
  } finally { await context.close(); }
});
test("cookie-free callback rechecks the real initiating role, ban, session expiry and revocation", async ({ browser }) => {
  const { context } = await open(browser);
  const authDb = new Database(path.join(dataDir, "auth.db"));
  try {
    await connectApi(context);
    const user = authDb.prepare('SELECT * FROM "user" WHERE username=?').get("costingadmin");
    const session = authDb.prepare('SELECT * FROM "session" WHERE userId=? ORDER BY expiresAt DESC LIMIT 1').get(user.id);
    const previous = withDb((db) => db.prepare("SELECT encrypted_access_token,last_error_at FROM workspace_integrations WHERE provider='quickbooks'").get());
    for (const kind of ["role", "ban", "expiry", "revoked"]) {
      const response = await context.request.post(`${baseUrl}/api/integrations/quickbooks/connect`, { data: {}, headers: { "X-Accounting-Request": "1" } });
      expect(response.ok()).toBeTruthy(); const state = new URL((await response.json()).result.url).searchParams.get("state");
      try {
        if (kind === "role") authDb.prepare('UPDATE "user" SET workspaceRole=? WHERE id=?').run("technician", user.id);
        if (kind === "ban") authDb.prepare('UPDATE "user" SET banned=1,banExpires=NULL WHERE id=?').run(user.id);
        if (kind === "expiry") authDb.prepare('UPDATE "session" SET expiresAt=0 WHERE id=?').run(session.id);
        if (kind === "revoked") authDb.prepare('DELETE FROM "session" WHERE id=?').run(session.id);
        const result = await fetch(`${baseUrl}/api/integrations/quickbooks/callback?${new URLSearchParams({ state, code: "should-not-exchange", realmId: "123456789" })}`, { redirect: "manual" });
        expect(result.status).toBe(302); expect(result.headers.get("location")).toContain("result=failed"); expect(result.headers.get("set-cookie")).toBeNull();
      } finally {
        authDb.prepare('UPDATE "user" SET workspaceRole=?,banned=?,banExpires=? WHERE id=?').run(user.workspaceRole, user.banned, user.banExpires, user.id);
        authDb.prepare('DELETE FROM "session" WHERE id=?').run(session.id);
        const columns = Object.keys(session);
        authDb.prepare(`INSERT INTO "session" (${columns.map((key) => `"${key}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(session));
      }
      expect(withDb((db) => db.prepare("SELECT encrypted_access_token,last_error_at FROM workspace_integrations WHERE provider='quickbooks'").get())).toEqual(previous);
    }
  } finally { authDb.close(); await context.close(); }
});

for (const width of [390, 820, 1440]) for (const preset of themePresets) {
  test(`${preset.label}: QuickBooks settings and receipts fit ${width}px`, async ({ browser }, info) => {
    const { context, page } = await open(browser, { width, preset });
    try {
      await connectApi(context); await page.reload();
      await page.getByLabel("QuickBooks connection", { exact: true }).getByRole("button", { name: "Configure", exact: true }).click();
      await expect(page.locator('[data-quickbooks-selected-item="20"]')).toContainText("Service income");
      await capture(page, info, `${preset.id}-settings-${width}`, page.locator('[data-addon="quickbooks"]'));
      await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
      await card(page).getByRole("button", { name: "Send to QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
      await syncPayments(context, page, [["900", 500]]);
      await expect(page.locator(".document-payment")).toContainText("QuickBooks payment"); await expect(page.locator(".document-payment input, .document-payment button")).toHaveCount(0);
      await capture(page, info, `${preset.id}-invoice-${width}`, card(page));
      await capture(page, info, `${preset.id}-payments-${width}`, page.locator('section[aria-labelledby="document-payments-title"]'));
    } finally { await context.close(); }
  });
}
