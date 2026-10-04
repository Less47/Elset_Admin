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
    ELSET_WORKSPACE_DB_PATH: path.join(dataDir, "elset-workspace.db"),
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
  db.prepare("DELETE FROM price_list_items").run();
  for (const table of ["integration_payment_outbox", "integration_webhook_events", "integration_external_payments", "integration_invoice_payment_sync", "integration_operations", "integration_locks", "integration_oauth_states", "integration_sync_log", "integration_entity_mappings", "workspace_integrations"]) db.prepare(`DELETE FROM ${table}`).run();
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
  await card(page).getByRole("button", { name: "Sync with QuickBooks", exact: true }).click();
  await expect(card(page)).toContainText("Payment sync: Up to date");
}

for (const width of [390, 1440]) test(`authoritative QuickBooks invoice reconciliation removes the board warning without reload at ${width}px`, async ({ browser }, info) => {
  const { context, page } = await open(browser, { width, path: "/" });
  try {
    await connectApi(context);
    // Load the newly enabled add-on once; all subsequent navigation stays in the SPA.
    await page.reload();
    if (width < 768) await page.getByRole("tab", { name: /^Completed / }).click();
    const boardJob = () => page.locator('[data-service-board-job-id="costing-job"], [data-mobile-job-id="costing-job"]');
    const warning = () => boardJob().getByRole("img", { name: "Not in QuickBooks", exact: true });
    await expect(warning()).toBeVisible();
    await expect(page.locator('[data-service-board-job-id="quote-only"], [data-mobile-job-id="quote-only"]').getByRole("img", { name: "Not in QuickBooks" })).toHaveCount(0);
    await capture(page, info, `board-before-qb-sync-${width}`, boardJob());
    const marker = await page.evaluate(() => { window.__boardSyncSession = Math.random(); return window.__boardSyncSession; });
    if (width < 768) await boardJob().getByRole("button", { name: /^Open Job #7101/ }).click();
    else await boardJob().dblclick();
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await page.getByRole("button", { name: "Open Invoice Editor", exact: true }).click();
    const synced = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/jobs/costing-job/invoice/integrations/quickbooks/sync");
    await card(page).getByRole("button", { name: "Send to QuickBooks", exact: true }).click();
    expect((await (await synced).json()).result.invoice.paymentManagement).toBe("quickbooks");
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    const mapping = withDb(db => db.prepare("SELECT * FROM integration_entity_mappings WHERE local_entity_type='invoice' AND local_entity_id=(SELECT id FROM invoices WHERE job_id='costing-job')").get());
    expect(mapping.provider).toBe("quickbooks");
    await page.getByRole("button", { name: "Back to Job #7101", exact: true }).click();
    await page.getByRole("button", { name: "Back to Service Board", exact: true }).click();
    if (width < 768) await page.getByRole("tab", { name: /^Completed / }).click();
    await expect(boardJob()).toBeVisible();
    await expect(warning()).toHaveCount(0);
    expect(await page.evaluate(() => window.__boardSyncSession)).toBe(marker);
    await capture(page, info, `board-after-qb-sync-${width}`, boardJob());
    const persisted = withDb(db => db.prepare("SELECT extra_json FROM invoices WHERE job_id='costing-job'").get());
    expect(JSON.parse(persisted.extra_json)).toEqual({});
    // Even a failed later update keeps the invoice mapping, so the warning stays absent.
    if (width < 768) await boardJob().getByRole("button", { name: /^Open Job #7101/ }).click();
    else await boardJob().dblclick();
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await page.getByRole("button", { name: "Open Invoice Editor", exact: true }).click();
    await page.route("**/api/jobs/costing-job/invoice/integrations/quickbooks/sync", route => route.fulfill({ status: 503, json: { error: "Synthetic later update failure" } }));
    await card(page).getByRole("button", { name: "Update QuickBooks", exact: true }).click();
    await expect(card(page)).toContainText("Synthetic later update failure");
    await page.getByRole("button", { name: "Back to Job #7101", exact: true }).click();
    await page.getByRole("button", { name: "Back to Service Board", exact: true }).click();
    if (width < 768) await page.getByRole("tab", { name: /^Completed / }).click();
    await expect(warning()).toHaveCount(0);
    expect(await page.evaluate(() => window.__boardSyncSession)).toBe(marker);
  } finally { await context.close(); }
});
test("explicit settings retain provider configuration drafts through status, failure, and guarded commands", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await connectApi(context, { configure: false });
    await page.reload();
    const connection = page.getByLabel("QuickBooks connection", { exact: true });
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.getByLabel("Default QuickBooks GST code")).toBeVisible();
    await expect(save).toBeDisabled();
    const writes = [];
    page.on("request", request => { if (["PATCH", "POST", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
    await connection.getByRole("button", { name: "Use existing QuickBooks item", exact: true }).click();
    await page.getByRole("button", { name: "Use Service", exact: true }).click();
    await connection.getByLabel("Default QuickBooks GST code").selectOption("30");
    await page.waitForTimeout(500);
    expect(writes).toEqual([]);
    await expect(save).toBeEnabled();
    await page.getByRole("dialog", { name: "QuickBooks Online", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "About QuickBooks Online", exact: true }).click();
    await expect(connection.getByLabel("Default QuickBooks GST code")).toHaveValue("30");
    await expect(connection.locator('[data-quickbooks-selected-item="20"]')).toBeVisible();
    await connection.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(connection).toContainText("Connection verified");
    await expect(save).toBeEnabled();
    await connection.getByRole("button", { name: "Reconnect QuickBooks", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Stay", exact: true }).click();
    expect(writes).toEqual(["/api/integrations/quickbooks/test"]);
    await page.route("**/api/integrations/quickbooks/config", route => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Synthetic configuration failure" } }) : route.continue());
    await save.click();
    await expect(page.getByRole("alert").first()).toContainText("Synthetic configuration failure");
    await expect(save).toBeEnabled();
    await expect(connection.getByLabel("Default QuickBooks GST code")).toHaveValue("30");
    await page.unroute("**/api/integrations/quickbooks/config");
    await save.click();
    await expect(save).toBeDisabled();
    await expect(connection).toContainText("QuickBooks configuration saved.");
    expect((await (await context.request.get(baseUrl + "/api/integrations/quickbooks/status")).json()).result.config).toMatchObject({ itemId: "20", taxMappings: { taxable: "30" } });
    // A destructive command stays independent, but cannot silently drop another draft.
    await page.getByRole("dialog", { name: "QuickBooks Online", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("switch", { name: "Job Costing enabled" }).click();
    await page.getByRole("button", { name: "About QuickBooks Online", exact: true }).click();
    await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("dialog", { name: "Disconnect QuickBooks?", exact: true }).getByRole("button", { name: "Disconnect QuickBooks", exact: true }).click();
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(connection).toContainText("Not connected");
    expect((await (await context.request.get(baseUrl + "/api/settings/addons")).json()).result.jobCosting).toBe(false);
    expect(writes.filter(path => path.endsWith("/config"))).toHaveLength(2);
    expect(writes.filter(path => path.endsWith("/disconnect"))).toHaveLength(1);
    expect(writes.filter(path => path === "/api/settings/addons")).toHaveLength(0);
  } finally { await context.close(); }
});
for (const width of [390, 1440]) test(`price-list mapping state and fallback wording preserve invoice snapshots at ${width}px`, async ({ browser }, info) => {
  const { context, page } = await open(browser, { width });
  try {
    await connectApi(context);
    await page.reload();
    const connection = page.getByLabel("QuickBooks connection", { exact: true });
    await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.getByRole("group", { name: "Fallback QuickBooks sales item" })).toContainText("Used for ad-hoc invoice lines that are not linked to an ELSET Price List item.");
    const created = await context.request.post(`${baseUrl}/api/price-list-items`, { data: { name: "Labour", description: "Current catalog description", unitPrice: 999, unit: "hour" } });
    expect(created.ok()).toBeTruthy(); const { item } = await created.json();
    withDb(db => db.prepare("UPDATE invoice_line_items SET extra_json=? WHERE invoice_id=(SELECT id FROM invoices WHERE job_id='costing-job')").run(JSON.stringify({ priceListItemId: item.id })));
    await page.getByRole("dialog", { name: "QuickBooks Online", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Items & Price List", exact: true }).last().click();
    await expect(page.getByRole("listitem", { name: "Labour", exact: true })).toContainText("Not mapped — will create/match on first sync");
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    const remote = await (await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: {} })).json();
    const labour = remote.items.filter(row => row.Name === "Labour"); expect(labour).toHaveLength(1);
    expect(remote.invoices[0].Line[0].SalesItemLineDetail.ItemRef.value).toBe(labour[0].Id);
    expect(remote.invoices[0].Line[0].Description).toBe("Invoiced work"); expect(remote.invoices[0].Line[0].SalesItemLineDetail.UnitPrice).toBe(1000);
    expect(remote.calls.some(call => /\/send(?:\?|$)/.test(call.url))).toBe(false);
    await page.goto(`${baseUrl}/settings`); await page.getByRole("button", { name: "Items & Price List", exact: true }).last().click();
    await expect(page.getByRole("listitem", { name: "Labour", exact: true })).toContainText("QuickBooks item: Labour · Mapped");
    await capture(page, info, `price-list-quickbooks-mapped-${width}`, page.getByRole("list", { name: "Price-list items" }));
    expect((await context.request.patch(`${baseUrl}/api/price-list-items/${item.id}`, { data: { updatedAt: item.updatedAt, name: "Renamed labour", description: "Later words", unitPrice: 1 } })).ok()).toBeTruthy();
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`); await card(page).getByRole("button", { name: "Update QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    const rerun = await (await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: {} })).json();
    expect(rerun.items.filter(row => row.Name === "Labour")).toHaveLength(1); expect(rerun.invoices[0].TotalAmt).toBe(1100);
  } finally { await context.close(); }
});
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
    await expect(connection).toContainText("Line descriptions, quantities and prices are sent separately.");
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
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(connection).toContainText("QuickBooks configuration saved.");
    await page.reload(); await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.locator('[data-quickbooks-selected-item="1599"]')).toContainText("Batteries");
    await connection.getByRole("button", { name: 'Create "ELSET Services" in QuickBooks', exact: true }).click();
    const create = page.getByRole("dialog", { name: 'Create "ELSET Services" in QuickBooks', exact: true });
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
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(connection).toContainText("QuickBooks configuration saved.");
    await connection.getByRole("button", { name: 'Use "ELSET Services"', exact: true }).click();
    const reuse = page.getByRole("dialog", { name: 'Use "ELSET Services"', exact: true });
    await reuse.getByRole("button", { name: "Use existing ELSET Services", exact: true }).click();
    await expect(reuse).toHaveCount(0);
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
    await page.getByRole("dialog", { name: "QuickBooks Online", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("switch", { name: "QuickBooks Online enabled" }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await expect(page.getByRole("switch", { name: "Xero enabled" })).toBeDisabled();
    await page.getByRole("button", { name: "About QuickBooks Online", exact: true }).click();
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
    await page.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(connection).toContainText("QuickBooks configuration saved.");
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
    await expect(page.getByRole("button", { name: "Add Payment", exact: true })).toBeVisible();
    await expect(page.getByLabel("Payment 1 amount", { exact: true })).toHaveValue("450");
    const remote = await (await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: {} })).json();
    expect(remote.customers).toHaveLength(1); expect(remote.invoices).toHaveLength(1); expect(remote.invoices[0].TotalAmt).toBe(1100);
    await capture(page, info, "quickbooks-invoice-reconciled", card(page));
    await page.goto(`${baseUrl}/settings?accounting=quickbooks`);
    await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("dialog", { name: "Disconnect QuickBooks?", exact: true }).getByRole("button", { name: "Disconnect QuickBooks", exact: true }).click(); await expect(connection).toContainText("Not connected");
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
    await expect(connection).toContainText("Configure this company's fallback sales item and GST code");
    await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await expect(connection.getByRole("group", { name: "Fallback QuickBooks sales item" })).toContainText("No fallback sales item selected.");
    await expect(connection.getByLabel("Default QuickBooks GST code", { exact: true })).toHaveValue("");
    await capture(page, info, `reconnect-active-au-${width}`, connection);
    await connection.getByRole("button", { name: "Use existing QuickBooks item", exact: true }).click();
    await page.getByRole("button", { name: "Use Service", exact: true }).click();
    await connection.getByLabel("Default QuickBooks GST code", { exact: true }).selectOption("30");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
      await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
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
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(page.getByLabel("Payment 1 amount", { exact: true })).toHaveValue("500");
    await page.getByLabel("Item 1 rate", { exact: true }).fill("1001"); await expect(card(page).getByRole("button", { name: "Sync with QuickBooks" })).toBeDisabled();
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
      await expect(page.getByText("Payments can be entered in ELSET or QuickBooks and sync automatically.", { exact: false })).toBeVisible();
      await capture(page, info, `${preset.id}-settings-${width}`, page.locator('[data-addon="quickbooks"]'));
      await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
      await card(page).getByRole("button", { name: "Send to QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
      await syncPayments(context, page, [["900", 500]]);
      await expect(page.getByLabel("Payment 1 amount", { exact: true })).toHaveValue("500");
      await capture(page, info, `${preset.id}-invoice-${width}`, card(page));
      await capture(page, info, `${preset.id}-payments-${width}`, page.locator('section[aria-labelledby="document-payments-title"]'));
    } finally { await context.close(); }
  });
}

for (const [width, mapped, role] of [[1440, true, "admin"], [390, false, "office"]]) test(`automatic ELSET payment CRUD ${mapped ? "mapped" : "with dependencies"} at ${width}px`, async ({ browser }) => {
  const { context, page } = await open(browser, { width, role });
  try {
    await connectApi(context);
    if (mapped) expect((await context.request.post(`${baseUrl}/api/jobs/costing-job/invoice/integrations/quickbooks/sync`, { headers: { "X-Accounting-Request": "1" }, data: {} })).ok()).toBeTruthy();
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    const accountingActions = [];
    page.on("request", request => { if (request.method() === "POST" && /\/integrations\/quickbooks\/sync/.test(request.url())) accountingActions.push(request.url()); });
    await expect(page.getByText("Payments sync automatically with QuickBooks.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add Payment", exact: true }).click();
    await page.getByLabel("Payment 1 amount", { exact: true }).fill("500");
    await page.getByLabel("Payment 1 date", { exact: true }).fill("2026-09-18");
    const save = async () => { await page.getByRole("button", { name: "Save Invoice", exact: true }).filter({ visible: true }).click(); await expect(page.locator(".document-feedback")).toHaveText("Saved"); };
    await save();
    const remote = async () => (await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: {} })).json();
    await expect.poll(async () => (await remote()).payments?.[0]?.TotalAmt).toBe(500);
    const id = (await remote()).payments[0].Id;
    await page.getByLabel("Payment 1 amount", { exact: true }).fill("600");
    await page.getByLabel("Payment 1 date", { exact: true }).fill("2026-09-20"); await save();
    await expect.poll(async () => (await remote()).payments[0]?.TotalAmt).toBe(600);
    const updated = await remote(); expect(updated.payments).toHaveLength(1); expect(updated.payments[0].Id).toBe(id); expect(updated.payments[0].TxnDate).toBe("2026-09-20");
    expect(updated.invoices[0].Balance).toBe(500);
    await page.getByRole("button", { name: "Remove payment 1", exact: true }).click(); await save();
    await expect.poll(async () => (await remote()).payments.length).toBe(0);
    expect((await remote()).invoices[0].Balance).toBe(1100);
    expect(accountingActions).toEqual([]);
    await expect(card(page).getByRole("button", { name: "Sync with QuickBooks", exact: true })).toBeVisible();
    expect(updated.calls.some(call => /\/send(?:\?|$)/.test(call.url))).toBe(false);
    expect(withDb(db => db.prepare("SELECT count(*) n FROM payments").get().n)).toBe(0);
  } finally { await context.close(); }
});

test("webhook changing a payment behind a dirty form rejects the stale edit and preserves both draft and provider receipt", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await connectApi(context); await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to QuickBooks" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    await syncPayments(context, page, [["900", 500]]);
    await page.getByLabel("Payment 1 amount", { exact: true }).fill("600");
    await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: { payments: [["900", 450]] } });
    const raw = JSON.stringify([quickBooksCloudEvent({ id: "dirty-payment-event", type: "qbo.payment.updated.v1" })]);
    const signature = crypto.createHmac("sha256", "quickbooks-e2e-signature-only").update(raw).digest("base64");
    expect((await context.request.post(`${baseUrl}/api/integrations/quickbooks/webhook`, { data: raw, headers: { "Content-Type": "application/cloudevents+json", "intuit-signature": signature } })).ok()).toBeTruthy();
    await expect.poll(() => withDb(db => db.prepare("SELECT amount_cents FROM payments").get()?.amount_cents)).toBe(45000);
    const saved = page.waitForResponse(response => response.request().method() === "PATCH" && /\/payments\//.test(response.url()));
    await page.getByRole("button", { name: "Save Invoice", exact: true }).filter({ visible: true }).click();
    expect((await saved).status()).toBe(409);
    await expect(page.getByLabel("Payment 1 amount", { exact: true })).toHaveValue("600");
    expect(withDb(db => db.prepare("SELECT amount_cents FROM payments").get().amount_cents)).toBe(45000);
    expect(withDb(db => db.prepare("SELECT count(*) n FROM integration_payment_outbox").get().n)).toBe(0);
  } finally { await context.close(); }
});

test("reenabling the QuickBooks add-on automatically resumes payments entered while it was disabled", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await connectApi(context);
    expect((await context.request.post(`${baseUrl}/api/jobs/costing-job/invoice/integrations/quickbooks/sync`, { headers: { "X-Accounting-Request": "1" }, data: {} })).ok()).toBeTruthy();
    expect((await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { quickbooks: false } })).ok()).toBeTruthy();
    expect((await context.request.post(`${baseUrl}/api/jobs/costing-job/invoice/payments`, { data: { id: "paused-local", amount: 500, date: "2026-09-18" } })).ok()).toBeTruthy();
    await expect.poll(() => withDb(db => db.prepare("SELECT status FROM integration_payment_outbox WHERE local_payment_id='paused-local'").get()?.status)).toBe("PAUSED");
    expect((await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { quickbooks: true } })).ok()).toBeTruthy();
    await expect.poll(() => withDb(db => db.prepare("SELECT status FROM integration_payment_outbox WHERE local_payment_id='paused-local'").get()?.status)).toBe("SYNCED");
    const remote = await (await context.request.post(`${baseUrl}/__quickbooks-fixture`, { data: {} })).json();
    expect(remote.payments).toHaveLength(1); expect(remote.invoices[0].Balance).toBe(600);
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`); await expect(page.getByLabel("Payment 1 amount", { exact: true })).toHaveValue("500");
  } finally { await context.close(); }
});
