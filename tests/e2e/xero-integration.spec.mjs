import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";
import { insertJobTree } from "../../server-workspace-jobs.js";
import { normalizeStoredData } from "../../server-store.js";
import { themePresets } from "../../src/lib/theme-presets.js";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(root, "test-results/xero-v2");
const password = "Costing-fixture-login-123";
let dataDir, baseUrl, server, serverOutput = "";
const sessions = {};
function withDb(callback) {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try { return callback(db); } finally { db.close(); }
}
function fixture() {
  const data = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
  const job = data.jobs[0];
  data.maintenancePlans = [];
  data.jobs = [
    ["costing-job", 7101, 5000, 4800, 1000, true],
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-xero-e2e-"));
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
    ELSET_TEST_XERO: "1", XERO_WEBHOOK_KEY: "xero-e2e-signature-only", XERO_CLIENT_ID: "fixture-client", XERO_CLIENT_SECRET: "fixture-secret", XERO_REDIRECT_URI: `http://localhost:${port}/api/integrations/xero/callback`, ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"), SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(root, "server-auth.js")).href)});
    await ensureAuthReady(); const context = await auth.$context;
    for (const role of ['admin','office','technician']) {
      const user = await context.internalAdapter.createUser({ email: role+'@costing.example.test', emailVerified: true, name: 'Costing '+role, role, username: 'costing'+role, displayUsername: 'Costing '+role, workspaceRole: role, staffId: '' });
      await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password: await context.password.hash(${JSON.stringify(password)}) });
    }
  `], { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (seed.status !== 0) throw new Error(`Fixture login setup failed: ${seed.stdout}\n${seed.stderr}`);
  server = spawn(process.execPath, ["tests/fixtures/xero-server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
  await request.post(`${baseUrl}/__xero-fixture`, { data: { reset: true } });
  withDb((db) => {
  for (const table of ["integration_webhook_events", "integration_external_payments", "integration_invoice_payment_sync", "integration_operations", "integration_locks", "integration_oauth_states", "integration_sync_log", "integration_entity_mappings", "workspace_integrations"]) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare("DELETE FROM jobs").run();
  for (const job of normalizeStoredData(fixture()).jobs) insertJobTree(db, job);
  db.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES('addons',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
    .run(JSON.stringify({ jobCosting: false, xero: false }), new Date().toISOString());
  });
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await info.attach("server-output", { body: serverOutput, contentType: "text/plain" }); });
test.afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => { const timer = setTimeout(resolve, 5000); server.once("exit", () => { clearTimeout(timer); resolve(); }); });
  }
  const target = path.resolve(dataDir || ".");
  if (target.startsWith(path.join(os.tmpdir(), "elset-xero-e2e-"))) fs.rmSync(target, { recursive: true, force: true });
});

async function open(browser, { role = "admin", width = 1440, preset, path: target = "/settings?accounting=xero" } = {}) {
  const context = await browser.newContext({ storageState: sessions[role], viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  if (preset) await page.route("**/api/user-preferences", async (route) => {
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ response, json: { ...body, preferences: { ...body.preferences, ...preset.values } } });
  });
  await page.goto(`${baseUrl}${target}`);
  return { context, page };
}
const card = (page) => page.getByRole("region", { name: "Xero invoice sync" });
async function api(context, endpoint, data = {}) {
  const response = await context.request.post(`${baseUrl}/api/integrations/xero/${endpoint}`, { data, headers: { "X-Accounting-Request": "1" } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).result;
}
async function connectApi(context) {
  expect((await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { xero: true } })).ok()).toBeTruthy();
  const { url } = await api(context, "connect");
  const state = new URL(url).searchParams.get("state");
  const callback = await context.request.get(`${baseUrl}/api/integrations/xero/callback?state=${encodeURIComponent(state)}&code=fixture`, { maxRedirects: 0 });
  expect(callback.status()).toBe(303);
  expect(callback.headers().location).toContain("result=connected");
  const configuration = await context.request.patch(`${baseUrl}/api/integrations/xero/config`, { data: { salesAccountId: "sales-id", taxMappings: { taxable: "OUTPUT" } }, headers: { "X-Accounting-Request": "1" } });
  expect(configuration.ok(), await configuration.text()).toBeTruthy();
}
async function capture(page, info, name, locator) {
  const screenshot = path.join(screenshots, `${name}.png`);
  if (locator) {
    await locator.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
    await locator.screenshot({ path: screenshot, animations: "disabled" });
  }
  else await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await info.attach(name, { path: screenshot, contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const role of ["admin", "office"]) test(`${role} sees only a support message for missing infrastructure and can connect after operator recovery`, async ({ browser }, info) => {
  const { context, page } = await open(browser, { role });
  try {
    await page.getByRole("switch", { name: "Xero enabled" }).click();
    const connection = page.getByLabel("Xero connection", { exact: true });
    const connectButton = connection.getByRole("button", { name: "Connect to Xero", exact: true });
    await expect(connectButton).toBeEnabled();
    for (const name of ["ACCOUNTING_INTEGRATION_ENCRYPTION_KEY", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI"]) {
      await context.request.post(`${baseUrl}/__xero-fixture`, { data: { reset: true, missingConfiguration: name } });
      await page.reload();
      await expect(connectButton).toBeDisabled();
      await expect(connection).toContainText("Xero integration is temporarily unavailable. Please contact support.");
      await expect(page.locator("body")).not.toContainText(/ACCOUNTING_INTEGRATION|XERO_CLIENT|XERO_REDIRECT|encryption key|hexadecimal|administrator must configure/i);
      await expect(connection.getByRole("textbox")).toHaveCount(0);
      const status = await (await context.request.get(`${baseUrl}/api/integrations/xero/status`)).json();
      expect(status.result.serverConfigured).toBe(false);
      expect(JSON.stringify(status)).not.toMatch(/ACCOUNTING_INTEGRATION|XERO_CLIENT|XERO_REDIRECT|encryption|hexadecimal|fixture-secret/i);
      const rejected = await context.request.post(`${baseUrl}/api/integrations/xero/connect`, { data: {}, headers: { "X-Accounting-Request": "1" } });
      expect(rejected.status()).toBe(503);
      expect((await rejected.json()).error).toBe("Accounting integration is temporarily unavailable. Please contact support.");
      await expect.poll(() => serverOutput.includes(`missing ${name}`)).toBe(true);
    }
    expect(serverOutput).not.toContain("fixture-secret");
    await capture(page, info, `xero-unavailable-${role}`, page.locator('[data-addon="xero"]'));
    await context.request.post(`${baseUrl}/__xero-fixture`, { data: { reset: true } });
    await page.reload();
    await expect(connectButton).toBeEnabled();
    await expect(connection).not.toContainText("temporarily unavailable");
    await page.route("https://login.xero.com/**", (route) => {
      const state = new URL(route.request().url()).searchParams.get("state");
      return route.fulfill({ contentType: "text/html", body: `<a href="${baseUrl}/api/integrations/xero/callback?state=${state}&code=fixture">Approve Demo Company</a>` });
    });
    await connectButton.click();
    await page.getByRole("link", { name: "Approve Demo Company" }).click();
    await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("enable, mocked consent callback, configuration, health check, manual sync, update and disconnect", async ({ browser }, info) => {
  const { context, page } = await open(browser);
  try {
    await expect(page.getByRole("heading", { name: "Add-ons", exact: true })).toBeVisible();
    await page.getByRole("switch", { name: "Xero enabled" }).click();
    await expect(page.getByRole("button", { name: "Connect to Xero", exact: true })).toBeEnabled();
    await page.route("https://login.xero.com/**", (route) => {
      const state = new URL(route.request().url()).searchParams.get("state");
      return route.fulfill({ contentType: "text/html", body: `<a href="${baseUrl}/api/integrations/xero/callback?state=${state}&code=fixture">Approve Demo Company</a>` });
    });
    await page.getByRole("button", { name: "Connect to Xero", exact: true }).click();
    await page.getByRole("link", { name: "Approve Demo Company" }).click();
    await expect(page).toHaveURL(/\/settings\?accounting=xero&result=connected/);
    const connection = page.getByLabel("Xero connection", { exact: true });
    await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
    await connection.getByRole("button", { name: "Configure", exact: true }).click();
    await page.getByLabel("Sales account", { exact: true }).selectOption("sales-id");
    await page.getByLabel("Taxable sales (10% GST)", { exact: true }).selectOption("OUTPUT");
    await page.getByRole("button", { name: "Save Xero configuration" }).click();
    await expect(connection).toContainText("Xero configuration saved.");
    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(connection).toContainText("Connection verified");
    let remote = await (await context.request.post(`${baseUrl}/__xero-fixture`, { data: {} })).json();
    expect(remote.contacts).toHaveLength(0); expect(remote.invoices).toHaveLength(0);
    await capture(page, info, "xero-settings-configured", page.locator('[data-addon="xero"]'));
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to Xero" }).click();
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    await expect(card(page)).toContainText("Xero invoice: INV-7101");
    await page.getByLabel("Item 1 rate", { exact: true }).fill("5100");
    await expect(card(page).getByRole("button", { name: "Update Xero" })).toBeDisabled();
    await page.getByRole("button", { name: /^Save Invoice$/i }).first().click();
    await expect(card(page).getByRole("button", { name: "Update Xero" })).toBeEnabled();
    await card(page).getByRole("button", { name: "Update Xero" }).click();
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    remote = await (await context.request.post(`${baseUrl}/__xero-fixture`, { data: {} })).json();
    expect(remote.contacts).toHaveLength(1); expect(remote.invoices).toHaveLength(1); expect(remote.invoices[0].SubTotal).toBe(5100);
    await capture(page, info, "xero-invoice-synced", card(page));
    await page.goto(`${baseUrl}/settings?accounting=xero`);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Disconnect Xero?" });
    await expect(dialog).toContainText("mapping history will be preserved");
    await dialog.getByRole("button", { name: "Disconnect Xero", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(connection).toContainText("Not connected");
    expect(withDb((db) => db.prepare("SELECT encrypted_refresh_token FROM workspace_integrations").get().encrypted_refresh_token)).toBeNull();
    expect(withDb((db) => db.prepare("SELECT count(*) n FROM integration_entity_mappings").get().n)).toBe(2);
  } finally { await context.close(); }
});

test("invoice controls follow enablement and eligibility; lost-response retry reconciles without duplicate", async ({ browser }) => {
  const { context, page } = await open(browser, { path: "/jobs/costing-job/invoice" });
  try {
    await expect(card(page)).toHaveCount(0);
    await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { xero: true } });
    await page.reload(); await expect(card(page)).toContainText("Xero not connected");
    await expect(card(page).getByRole("button", { name: "Send to Xero" })).toHaveCount(0);
    await connectApi(context);
    await page.goto(`${baseUrl}/jobs/draft-job/invoice`);
    await expect(card(page)).toContainText("Only sent invoices or invoices with recorded payments");
    await expect(card(page).getByRole("button", { name: "Send to Xero" })).toHaveCount(0);
    await page.goto(`${baseUrl}/jobs/costing-job/quote`); await expect(card(page)).toHaveCount(0);
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    const originalJob = withDb(loadWorkspaceStateFromDb).jobs.find((job) => job.id === "costing-job");
    await context.request.post(`${baseUrl}/__xero-fixture`, { data: { loseNextInvoiceResponse: true } });
    await card(page).getByRole("button", { name: "Send to Xero" }).click();
    await expect(card(page).getByRole("alert")).toContainText("did not confirm");
    await card(page).getByRole("button", { name: "Retry Xero sync" }).click();
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    const remote = await (await context.request.post(`${baseUrl}/__xero-fixture`, { data: {} })).json();
    expect(remote.invoices).toHaveLength(1); expect(remote.contacts).toHaveLength(1);
    expect(withDb(loadWorkspaceStateFromDb).jobs.find((job) => job.id === "costing-job")).toEqual({ ...originalJob, invoice: { ...originalJob.invoice, paymentManagement: "xero" } });
    await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { xero: false } });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(card(page)).toHaveCount(0);
    expect(withDb((db) => db.prepare("SELECT status FROM workspace_integrations").get().status)).toBe("CONNECTED");
  } finally { await context.close(); }
});

test("protected accounting state and renewal errors offer safe recovery without changing invoice data", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await connectApi(context); await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to Xero" }).click();
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    await context.request.post(`${baseUrl}/__xero-fixture`, { data: { paid: true } });
    await card(page).getByRole("button", { name: "Update Xero" }).click();
    await expect(card(page).getByRole("alert")).toContainText("protected accounting state");
    await context.request.post(`${baseUrl}/__xero-fixture`, { data: { failNext: { path: "/connections", status: 403 } } });
    await card(page).getByRole("button", { name: "Retry Xero sync" }).click();
    await expect(card(page)).toContainText("Reconnect Xero");
    await expect(card(page).getByRole("button", { name: "Retry Xero sync" })).toHaveCount(0);
    await page.goto(`${baseUrl}/settings?accounting=xero`);
    await expect(page.getByRole("button", { name: "Reconnect Xero", exact: true })).toBeEnabled();
  } finally { await context.close(); }
});

test("technicians cannot configure or sync Xero and OAuth callback cancellation is clear", async ({ browser }) => {
  const tech = await open(browser, { role: "technician" });
  try {
    expect((await tech.context.request.get(`${baseUrl}/api/integrations/xero/status`)).status()).toBe(403);
    expect((await tech.context.request.post(`${baseUrl}/api/jobs/costing-job/invoice/integrations/xero/sync`, { data: {}, headers: { "X-Accounting-Request": "1" } })).status()).toBe(403);
    await expect(tech.page.getByRole("switch", { name: "Xero enabled" })).toHaveCount(0);
  } finally { await tech.context.close(); }
  const { context, page } = await open(browser);
  try {
    await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { xero: true } });
    const { url } = await api(context, "connect");
    await page.goto(`${baseUrl}/api/integrations/xero/callback?state=${new URL(url).searchParams.get("state")}&error=access_denied`);
    await expect(page.getByLabel("Xero connection", { exact: true })).toContainText("connection was cancelled");
  } finally { await context.close(); }
});

test("office users share the connection, sync is disabled while saving, and failed health checks show reconnect immediately", async ({ browser }) => {
  const admin = await open(browser), office = await open(browser, { role: "office" });
  let release;
  try {
    await connectApi(admin.context);
    await office.page.reload();
    await expect(office.page.getByLabel("Xero connection", { exact: true }).getByText("Connected", { exact: true })).toBeVisible();
    await office.page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    const responseGate = new Promise((resolve) => { release = resolve; });
    await office.page.route("**/api/jobs/costing-job/invoice/integrations/xero/sync", async (route) => {
      await responseGate;
      await route.continue();
    });
    await card(office.page).getByRole("button", { name: "Send to Xero" }).click();
    await expect(card(office.page).getByRole("button")).toBeDisabled();
    await expect(office.page.getByRole("button", { name: /^Save Invoice$/i }).first()).toBeDisabled();
    release();
    await expect(card(office.page).getByRole("status")).toHaveText("Synced");
    await expect(card(office.page).getByRole("button", { name: "Update Xero" })).toBeEnabled();
    await admin.page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await expect(card(admin.page).getByRole("status")).toHaveText("Synced");
    await office.page.goto(`${baseUrl}/settings?accounting=xero`);
    await office.context.request.post(`${baseUrl}/__xero-fixture`, { data: { failNext: { path: "/connections", status: 403 } } });
    await office.page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(office.page.getByRole("button", { name: "Reconnect Xero", exact: true })).toBeEnabled();
    await expect(office.page.getByRole("button", { name: "Test connection", exact: true })).toHaveCount(0);
  } finally { release?.(); await admin.context.close(); await office.context.close(); }
});

test("payment permissions update through OAuth preserves tenant, mappings and configuration", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await connectApi(context);
    await page.goto(`${baseUrl}/jobs/other-job/invoice`);
    await card(page).getByRole("button", { name: "Send to Xero" }).click();
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    const before = withDb((db) => ({ mapping: db.prepare("SELECT * FROM integration_entity_mappings ORDER BY id").all(), config: db.prepare("SELECT config_json,external_tenant_id FROM workspace_integrations").get() }));
    withDb((db) => db.prepare("UPDATE workspace_integrations SET granted_scopes=?").run(JSON.stringify(["offline_access", "accounting.contacts", "accounting.invoices", "accounting.settings.read"])));
    await page.goto(`${baseUrl}/settings?accounting=xero`);
    const settings = page.getByLabel("Xero connection", { exact: true });
    await expect(settings).toContainText("Additional Xero permission required");
    await page.route("https://login.xero.com/**", (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("scope")).toContain("accounting.payments.read");
      expect(url.searchParams.get("scope")).not.toMatch(/accounting\.transactions|accounting\.payments(?:\s|$)/);
      return route.fulfill({ contentType: "text/html", body: `<a href="${baseUrl}/api/integrations/xero/callback?state=${url.searchParams.get("state")}&code=fixture">Approve payments</a>` });
    });
    await settings.getByRole("button", { name: "Update Xero Permissions", exact: true }).click();
    await page.getByRole("link", { name: "Approve payments" }).click();
    await expect(settings).toContainText("Payment synchronisation: Connected");
    expect(withDb((db) => ({ mapping: db.prepare("SELECT * FROM integration_entity_mappings ORDER BY id").all(), config: db.prepare("SELECT config_json,external_tenant_id FROM workspace_integrations").get() }))).toEqual(before);
  } finally { await context.close(); }
});

test("partial, full, reversed and conflicting Xero payments update invoice and customer account", async ({ browser }, info) => {
  const { context, page } = await open(browser, { width: 390, preset: themePresets.find((preset) => preset.id === "midnight-signal") });
  try {
    await connectApi(context);
    withDb((db) => db.prepare("UPDATE invoice_line_items SET rate_cents=100000 WHERE invoice_id=(SELECT id FROM invoices WHERE job_id='other-job')").run());
    await page.goto(`${baseUrl}/jobs/other-job/invoice`);
    await card(page).getByRole("button", { name: "Send to Xero" }).click();
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    const balance = page.locator(".document-detail").filter({ has: page.getByText("Balance", { exact: true }) });
    for (const [entries, expected] of [[[["one", 500]], "$600.00"], [[["one", 500], ["two", 600]], "$0.00"], [[["one", 500, "DELETED"], ["two", 600]], "$500.00"]]) {
      await context.request.post(`${baseUrl}/__xero-fixture`, { data: { payments: entries } });
      await card(page).getByRole("button", { name: "Sync from Xero" }).click();
      await expect(balance).toContainText(expected);
      if (expected === "$0.00") await expect(page.locator(".document-detail").filter({ has: page.getByText("Status", { exact: true }) })).toContainText("Paid");
      await expect(card(page)).toContainText("Payment sync: Up to date");
      const customerId = withDb((db) => db.prepare("SELECT customer_id FROM jobs WHERE id='other-job'").get().customer_id);
      const account = await (await context.request.get(`${baseUrl}/api/customers/${customerId}/account-summary`)).json();
      if (expected === "$0.00") expect(account.invoices.some((invoice) => invoice.jobId === "other-job")).toBe(false);
      else expect(account.invoices.find((invoice) => invoice.jobId === "other-job").balanceCents).toBe(expected === "$600.00" ? 60000 : 50000);
    }
    const count = withDb((db) => db.prepare("SELECT count(*) n FROM integration_sync_log WHERE entity_type='invoice-payment'").get().n);
    await card(page).getByRole("button", { name: "Sync from Xero" }).click();
    await expect(card(page).getByRole("button", { name: "Sync from Xero" })).toBeEnabled();
    expect(withDb((db) => db.prepare("SELECT count(*) n FROM integration_sync_log WHERE entity_type='invoice-payment'").get().n)).toBe(count);
    await context.request.post(`${baseUrl}/__xero-fixture`, { data: { invoicePatch: { Status: "VOIDED" } } });
    await card(page).getByRole("button", { name: "Sync from Xero" }).click();
    await expect(card(page)).toContainText("Payment sync: Review required");
    await expect(balance).toContainText("$500.00");
    await capture(page, info, "midnight-payment-review-mobile", card(page));
    await page.goto(`${baseUrl}/jobs/costing-job/invoice`);
    await card(page).getByRole("button", { name: "Send to Xero" }).click();
    await expect(card(page).getByRole("status")).toHaveText("Synced");
    await card(page).getByRole("button", { name: "Sync from Xero" }).click();
    await expect(card(page)).toContainText("Existing manual payments require accounting review");
    await expect(page.locator(".document-payment")).toContainText("Historical manual payment");
  } finally { await context.close(); }
});

test("actual server preserves raw webhook bytes, refreshes clean invoices and protects unsaved drafts", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await connectApi(context); await page.goto(`${baseUrl}/jobs/other-job/invoice`);
    await card(page).getByRole("button", { name: "Send to Xero" }).click(); await expect(card(page).getByRole("status")).toHaveText("Synced");
    const mock = await (await context.request.post(`${baseUrl}/__xero-fixture`, { data: { payments: [["webhook-payment", 500]] } })).json();
    const raw = JSON.stringify({ events: [{ eventType: "UPDATE", eventCategory: "INVOICE", resourceId: mock.invoices[0].InvoiceID, tenantId: "tenant-demo", tenantType: "ORGANISATION", eventDateUtc: "2026-09-18T00:00:00Z" }], firstEventSequence: 1, lastEventSequence: 1, entropy: "demo" }, null, 3);
    const signature = crypto.createHmac("sha256", "xero-e2e-signature-only").update(raw).digest("base64");
    const response = await fetch(`${baseUrl}/api/integrations/xero/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-xero-signature": signature }, body: raw });
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toBeNull();
    await expect.poll(() => withDb((db) => db.prepare("SELECT status FROM integration_webhook_events").get().status)).toBe("PROCESSED");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".document-payment")).toContainText("Xero payment");
    await expect(card(page)).toContainText("Payment sync: Up to date");
    await page.getByLabel("Item 1 rate", { exact: true }).fill("99001");
    await context.request.post(`${baseUrl}/__xero-fixture`, { data: { payments: [["webhook-payment", 700]] } });
    const second = JSON.stringify({ ...JSON.parse(raw), firstEventSequence: 2, lastEventSequence: 2 });
    const secondSignature = crypto.createHmac("sha256", "xero-e2e-signature-only").update(second).digest("base64");
    expect((await fetch(`${baseUrl}/api/integrations/xero/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-xero-signature": secondSignature }, body: second })).status).toBe(200);
    await expect.poll(() => withDb((db) => db.prepare("SELECT count(*) n FROM integration_webhook_events WHERE status='PROCESSED'").get().n)).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(card(page).getByRole("button", { name: "Sync from Xero" })).toBeDisabled();
    await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("99001");
    await expect(page.locator(".document-payment")).toContainText("$500.00");
    await page.getByLabel("Item 1 rate", { exact: true }).fill("99000");
    await expect(card(page).getByRole("button", { name: "Sync from Xero" })).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".document-payment")).toContainText("$700.00");
  } finally { await context.close(); }
});

for (const width of [390, 820, 1440]) for (const preset of themePresets) {
  test(`${preset.label}: Xero settings and payment reconciliation fit ${width}px`, async ({ browser }, info) => {
    const { context, page } = await open(browser, { width, preset });
    try {
      await connectApi(context); await page.reload();
      await page.getByRole("button", { name: "Configure", exact: true }).click();
      await expect(page.getByLabel("Sales account", { exact: true })).toHaveValue("sales-id");
      await capture(page, info, `${preset.id}-settings-${width}`, page.locator('[data-addon="xero"]'));
      withDb((db) => db.prepare("UPDATE invoice_line_items SET rate_cents=100000 WHERE invoice_id=(SELECT id FROM invoices WHERE job_id='other-job')").run());
      await page.goto(`${baseUrl}/jobs/other-job/invoice`);
      await card(page).getByRole("button", { name: "Send to Xero" }).click();
      await expect(card(page).getByRole("status")).toHaveText("Synced");
      await expect(page.getByRole("button", { name: "Add Payment", exact: true })).toHaveCount(0);
      await context.request.post(`${baseUrl}/__xero-fixture`, { data: { payments: [["payment-one", 500]] } });
      await card(page).getByRole("button", { name: "Sync from Xero", exact: true }).click();
      await expect(card(page)).toContainText("Payment sync: Up to date");
      await expect(page.locator(".document-payment")).toContainText("Xero payment");
      await expect(page.locator(".document-payment input, .document-payment button")).toHaveCount(0);
      await expect(page.locator(".document-detail").filter({ has: page.getByText("Balance", { exact: true }) })).toContainText("$600.00");
      await capture(page, info, `${preset.id}-invoice-${width}`, card(page));
      await capture(page, info, `${preset.id}-payments-${width}`, page.locator('section[aria-labelledby="document-payments-title"]'));
    } finally { await context.close(); }
  });
}
