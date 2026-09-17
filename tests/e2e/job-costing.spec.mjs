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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(root, "test-results/job-costing");
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-costing-e2e-"));
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
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(root, "server-auth.js")).href)});
    await ensureAuthReady(); const context = await auth.$context;
    for (const role of ['admin','office','technician']) {
      const user = await context.internalAdapter.createUser({ email: role+'@costing.example.test', emailVerified: true, name: 'Costing '+role, role, username: 'costing'+role, displayUsername: 'Costing '+role, workspaceRole: role, staffId: '' });
      await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password: await context.password.hash(${JSON.stringify(password)}) });
    }
  `], { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (seed.status !== 0) throw new Error(`Fixture login setup failed: ${seed.stdout}\n${seed.stderr}`);
  server = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
test.beforeEach(() => withDb((db) => {
  db.prepare("DELETE FROM jobs").run();
  for (const job of normalizeStoredData(fixture()).jobs) insertJobTree(db, job);
  db.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES('addons',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
    .run(JSON.stringify({ jobCosting: false }), new Date().toISOString());
}));
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await info.attach("server-output", { body: serverOutput, contentType: "text/plain" }); });
test.afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => { const timer = setTimeout(resolve, 5000); server.once("exit", () => { clearTimeout(timer); resolve(); }); });
  }
  const target = path.resolve(dataDir || ".");
  if (target.startsWith(path.join(os.tmpdir(), "elset-costing-e2e-"))) fs.rmSync(target, { recursive: true, force: true });
});

async function open(browser, { role = "admin", width = 1440, height = 1000, preset, jobId = "costing-job", enabled = false, preparePage } = {}) {
  const context = await browser.newContext({ storageState: sessions[role], viewport: { width, height }, locale: "en-AU", timezoneId: "Australia/Sydney", reducedMotion: "reduce" });
  if (enabled) expect((await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { jobCosting: true } })).ok()).toBeTruthy();
  const page = await context.newPage();
  if (preset) await page.route("**/api/user-preferences", async (route) => {
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ response, json: { ...body, preferences: { ...body.preferences, ...preset.values } } });
  });
  if (preparePage) await preparePage(page);
  await page.goto(`${baseUrl}/jobs/${jobId}`);
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
  if (enabled) await page.getByRole("tab", { name: "Costing", exact: true }).click();
  return { context, page };
}
const metric = (page, key) => page.locator(`[data-costing-metric="${key}"]`);
async function settings(page, { expectEnabled = true } = {}) {
  if ((page.viewportSize()?.width || 0) < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("[data-settings-navigation]").getByRole("button", { name: "Add-ons", exact: true }).click();
  if (expectEnabled) await expect(page.getByRole("switch", { name: "Job Costing enabled" })).toBeEnabled();
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function addCost(page, { description = "Safety beams", category = "Materials", quantity = "2", unitCost = "95.00" } = {}) {
  await page.getByRole("button", { name: "Add Cost", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add cost", exact: true });
  await dialog.getByLabel("Category *", { exact: true }).click();
  await page.getByRole("option", { name: category, exact: true }).click();
  await dialog.getByLabel("Description *", { exact: true }).fill(description);
  await dialog.getByLabel("Quantity", { exact: true }).fill(quantity);
  await dialog.getByLabel("Unit cost (ex GST)", { exact: true }).fill(unitCost);
  await dialog.getByRole("button", { name: "Save cost", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function capture(page, info, name) {
  const file = path.join(screenshots, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  await info.attach(name, { path: file, contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("workspace enablement, exact costs, edit/delete and disable preserve records across sessions", async ({ browser }, info) => {
  const beforeJob = withDb(loadWorkspaceStateFromDb).jobs.find((job) => job.id === "costing-job");
  const { context, page } = await open(browser);
  try {
    await expect(page.getByRole("tab", { name: "Costing", exact: true })).toHaveCount(0);
    expect((await context.request.get(`${baseUrl}/api/jobs/costing-job/costing`)).status()).toBe(403);
    await settings(page);
    await page.getByRole("switch", { name: "Job Costing enabled" }).click();
    await expect(page.getByRole("switch", { name: "Job Costing enabled" })).toBeChecked();
    await capture(page, info, "addons-enabled-desktop");
    await page.goto(`${baseUrl}/jobs/costing-job`);
    await page.getByRole("tab", { name: "Costing", exact: true }).click();
    await expect(metric(page, "revenue")).toContainText("$5,000.00");
    await expect(metric(page, "paid")).toContainText("$1,000.00");
    await expect(metric(page, "outstanding")).toContainText("$4,500.00");
    await addCost(page);
    await addCost(page, { category: "Labour", description: "Technician labour", quantity: "4.5", unitCost: "60.00" });
    await expect(metric(page, "total-costs")).toContainText("$460.00");
    await expect(metric(page, "gross-profit")).toContainText("$4,540.00");
    await expect(metric(page, "margin")).toContainText("90.8%");
    await page.getByRole("button", { name: "Edit cost: Safety beams", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit cost", exact: true });
    await edit.getByLabel("Quantity", { exact: true }).fill("3");
    await edit.getByRole("button", { name: "Save cost", exact: true }).click();
    await expect(metric(page, "total-costs")).toContainText("$555.00");
    await page.getByRole("button", { name: "Delete cost: Safety beams", exact: true }).click();
    const remove = page.getByRole("dialog", { name: "Delete cost?", exact: true });
    await remove.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(metric(page, "total-costs")).toContainText("$555.00");
    await page.getByRole("button", { name: "Delete cost: Safety beams", exact: true }).click();
    await remove.getByRole("button", { name: "Delete cost", exact: true }).click();
    await expect(metric(page, "total-costs")).toContainText("$270.00");
    await capture(page, info, "costing-desktop");
    const office = await open(browser, { role: "office" });
    try {
      await office.page.getByRole("tab", { name: "Costing", exact: true }).click();
      await expect(metric(office.page, "total-costs")).toContainText("$270.00");
      await settings(page);
      await page.getByRole("switch", { name: "Job Costing enabled" }).click();
      const disable = page.getByRole("dialog", { name: "Disable Job Costing?", exact: true });
      await expect(disable).toContainText("preserved");
      await disable.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("switch", { name: "Job Costing enabled" })).toBeChecked();
      await page.getByRole("switch", { name: "Job Costing enabled" }).click();
      await disable.getByRole("button", { name: "Disable", exact: true }).click();
      await expect(page.getByRole("switch", { name: "Job Costing enabled" })).not.toBeChecked();
      await office.page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(office.page.getByRole("tab", { name: "Costing", exact: true })).toHaveCount(0);
      await expect(office.page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("data-state", "active");
      expect((await context.request.get(`${baseUrl}/api/jobs/costing-job/costing`)).status()).toBe(403);
      expect(withDb((db) => db.prepare("SELECT COUNT(*) n FROM job_cost_entries").get().n)).toBe(1);
      await page.getByRole("switch", { name: "Job Costing enabled" }).click();
      await expect(page.getByRole("switch", { name: "Job Costing enabled" })).toBeChecked();
      await office.page.reload();
      await office.page.getByRole("tab", { name: "Costing", exact: true }).click();
      await expect(metric(office.page, "total-costs")).toContainText("$270.00");
    } finally { await office.context.close(); }
    expect(withDb(loadWorkspaceStateFromDb).jobs.find((job) => job.id === "costing-job")).toEqual(beforeJob);
  } finally { await context.close(); }
});

test("quote-only and draft invoices never become revenue; zero revenue remains finite", async ({ browser }) => {
  const { context, page } = await open(browser, { enabled: true, jobId: "quote-only" });
  try {
    await expect(metric(page, "quoted")).toContainText("$10,000.00");
    await expect(metric(page, "revenue")).toContainText("$0.00");
    await addCost(page, { description: "Quote-only labour", category: "Labour", quantity: "1", unitCost: "200" });
    await expect(metric(page, "gross-profit")).toContainText("-$200.00");
    await expect(metric(page, "margin")).not.toContainText(/NaN|Infinity|undefined/);
    await page.goto(`${baseUrl}/jobs/draft-job`);
    await page.getByRole("tab", { name: "Costing", exact: true }).click();
    await expect(metric(page, "revenue")).toContainText("$0.00");
    await expect(metric(page, "total-costs")).toContainText("$0.00");
  } finally { await context.close(); }
});

test("technician cannot change workspace modules or view commercial costing", async ({ browser }) => {
  withDb((db) => db.prepare("UPDATE settings SET value_json=? WHERE key='addons'").run(JSON.stringify({ jobCosting: true })));
  const { context, page } = await open(browser, { role: "technician" });
  try {
    await expect(page.getByRole("tab", { name: "Costing", exact: true })).toHaveCount(0);
    expect((await context.request.get(`${baseUrl}/api/jobs/costing-job/costing`)).status()).toBe(403);
    expect((await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { jobCosting: false } })).status()).toBe(403);
    await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("[data-settings-navigation]").getByRole("button", { name: "Add-ons", exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test("failed add-on and cost saves retain the current state and allow retry", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await settings(page);
    await page.route("**/api/settings/addons", (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Temporary add-on save failure" } }) : route.continue());
    await page.getByRole("switch", { name: "Job Costing enabled" }).click();
    await expect(page.getByRole("alert")).toContainText("Temporary add-on save failure");
    await expect(page.getByRole("switch", { name: "Job Costing enabled" })).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "Job Costing enabled" })).toBeEnabled();
    await expect(page.getByRole("switch", { name: "Job Costing enabled" })).toHaveCSS("cursor", "pointer");
    expect((await context.request.get(`${baseUrl}/api/settings/addons`)).ok()).toBeTruthy();
    await page.unroute("**/api/settings/addons");
    await page.getByRole("switch", { name: "Job Costing enabled" }).click();
    await expect(page.getByRole("switch", { name: "Job Costing enabled" })).toBeChecked();
    await page.goto(`${baseUrl}/jobs/costing-job`);
    await page.getByRole("tab", { name: "Costing", exact: true }).click();
    await page.route("**/api/jobs/costing-job/costs", (route) => route.fulfill({ status: 503, json: { error: "Temporary cost save failure" } }));
    await page.getByRole("button", { name: "Add Cost", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add cost", exact: true });
    await dialog.getByLabel("Description *", { exact: true }).fill("Retained draft");
    await dialog.getByLabel("Unit cost (ex GST)", { exact: true }).fill("12.34");
    await dialog.getByRole("button", { name: "Save cost", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Temporary cost save failure");
    await expect(dialog.getByLabel("Description *", { exact: true })).toHaveValue("Retained draft");
    expect(withDb((db) => db.prepare("SELECT count(*) n FROM job_cost_entries").get().n)).toBe(0);
    await page.unroute("**/api/jobs/costing-job/costs");
    await dialog.getByRole("button", { name: "Save cost", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(metric(page, "total-costs")).toContainText("$12.34");
  } finally { await context.close(); }
});

for (const failInitialLoad of [false, true]) {
  test(`add-on initial loading ${failInitialLoad ? "failure" : "success"} restores interaction and cursor`, async ({ browser }) => {
    const responseGate = deferred();
    const { context, page } = await open(browser, { preparePage: (page) => page.route("**/api/settings/addons", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await responseGate.promise;
      return failInitialLoad ? route.fulfill({ status: 503, json: { error: "Temporary add-on load failure" } }) : route.continue();
    }) });
    try {
      await settings(page, { expectEnabled: false });
      const toggle = page.getByRole("switch", { name: "Job Costing enabled" });
      await expect(toggle).toBeDisabled();
      await expect(toggle).toHaveCSS("cursor", "not-allowed");
      await expect(page.getByRole("status")).toContainText("Loading add-ons");
      responseGate.resolve();
      if (failInitialLoad) await expect(page.getByRole("alert")).toContainText("Temporary add-on load failure");
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveCSS("cursor", "pointer");
      await expect(page.getByRole("status")).not.toContainText("Loading add-ons");
      // A failed GET must not require a separate Retry before a valid PATCH.
      await page.unroute("**/api/settings/addons");
      await toggle.click();
      await expect(toggle).toBeChecked();
      expect((await (await context.request.get(`${baseUrl}/api/settings/addons`)).json()).result.jobCosting).toBe(true);
    } finally { responseGate.resolve(); await context.close(); }
  });
}

for (const role of ["admin", "office"]) {
  test(`${role} add-on toggle disables only during saves and persists across refresh and sessions`, async ({ browser }) => {
    const { context, page } = await open(browser, { role });
    const other = await open(browser, { role: role === "admin" ? "office" : "admin" });
    const gates = [];
    try {
      await settings(page);
      await settings(other.page);
      // The disable confirmation temporarily hides the Settings content from the accessibility tree.
      const toggle = page.locator('[data-addon="jobCosting"] [role="switch"]');
      const otherToggle = other.page.getByRole("switch", { name: "Job Costing enabled" });
      for (const enabled of [true, false]) {
        const gate = deferred(); gates.push(gate);
        await page.route("**/api/settings/addons", async (route) => {
          if (route.request().method() === "PATCH") await gate.promise;
          return route.continue();
        });
        await expect(toggle).toBeEnabled();
        await expect(toggle).toHaveCSS("cursor", "pointer");
        await toggle.click();
        if (!enabled) await page.getByRole("dialog").getByRole("button", { name: "Disable", exact: true }).click();
        await expect(toggle).toBeDisabled();
        await expect(toggle).toHaveCSS("cursor", "not-allowed");
        await expect(toggle).toHaveAttribute("aria-checked", String(!enabled));
        await expect(page.locator('[aria-label="Workspace add-ons"] [role="status"]')).toContainText("Saving add-ons");
        gate.resolve();
        await expect(toggle).toBeEnabled();
        await expect(toggle).toHaveCSS("cursor", "pointer");
        await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
        await page.unroute("**/api/settings/addons");
        expect((await (await context.request.get(`${baseUrl}/api/settings/addons`)).json()).result.jobCosting).toBe(enabled);
        await other.page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(otherToggle).toHaveAttribute("aria-checked", String(enabled));
        await page.reload();
        await settings(page);
        await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
        await expect(toggle).toHaveCSS("cursor", "pointer");
      }
    } finally { for (const gate of gates) gate.resolve(); await context.close(); await other.context.close(); }
  });
}

test("failed add-on disable keeps the enabled state and permits an immediate retry", async ({ browser }) => {
  const { context, page } = await open(browser, { enabled: true });
  try {
    await settings(page);
    const toggle = page.getByRole("switch", { name: "Job Costing enabled" });
    await page.route("**/api/settings/addons", (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Temporary disable failure" } }) : route.continue());
    await toggle.click();
    const dialog = page.getByRole("dialog", { name: "Disable Job Costing?", exact: true });
    await dialog.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Temporary disable failure");
    await expect(dialog.getByRole("button", { name: "Disable", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveCSS("cursor", "pointer");
    expect((await (await context.request.get(`${baseUrl}/api/settings/addons`)).json()).result.jobCosting).toBe(true);
    await page.unroute("**/api/settings/addons");
    await toggle.click();
    await dialog.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveCSS("cursor", "pointer");
  } finally { await context.close(); }
});

test("legacy JSON add-on restriction explains its storage requirement beside the switch", async ({ browser }) => {
  const { context, page } = await open(browser, { preparePage: (page) => page.route("**/api/app-state", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), storageMode: "json" } });
  }) });
  try {
    await settings(page, { expectEnabled: false });
    const toggle = page.getByRole("switch", { name: "Job Costing enabled" });
    await expect(page.getByRole("status")).not.toContainText("Loading add-ons");
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveCSS("cursor", "not-allowed");
    await expect(page.getByText("Add-ons require SQLite workspace storage. This workspace is using legacy JSON storage.", { exact: true })).toBeVisible();
    await expect(toggle).toHaveAccessibleDescription(/Add-ons require SQLite workspace storage/);
  } finally { await context.close(); }
});

test("server disabling during an open cost draft blocks the write and hides costing", async ({ browser }) => {
  const { context, page } = await open(browser, { enabled: true });
  try {
    await page.getByRole("button", { name: "Add Cost", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add cost", exact: true });
    await dialog.getByLabel("Description *", { exact: true }).fill("Blocked draft");
    await dialog.getByLabel("Unit cost (ex GST)", { exact: true }).fill("15");
    expect((await context.request.patch(`${baseUrl}/api/settings/addons`, { data: { jobCosting: false } })).ok()).toBeTruthy();
    await dialog.getByRole("button", { name: "Save cost", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Costing", exact: true })).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    expect(withDb((db) => db.prepare("SELECT count(*) n FROM job_cost_entries").get().n)).toBe(0);
  } finally { await context.close(); }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
  for (const preset of themePresets) {
    test(`${preset.label}: costing and cost editor fit ${viewport.width}px`, async ({ browser }, info) => {
      const { context, page } = await open(browser, { ...viewport, preset, enabled: true });
      try {
        await addCost(page, { description: "Replacement safety beams and mounting hardware" });
        await expect(metric(page, "total-costs")).toContainText("$190.00");
        if (viewport.width >= 768) {
          const row = page.getByTestId("job-costing").locator("tbody tr").first();
          const totalCell = await row.locator("td").nth(5).boundingBox();
          const editButton = await row.getByRole("button", { name: /^Edit cost:/ }).boundingBox();
          expect(editButton.x).toBeGreaterThanOrEqual(totalCell.x + totalCell.width);
        }
        await capture(page, info, `${preset.id}-${viewport.width}`);
        await page.getByRole("button", { name: "Add Cost", exact: true }).first().click();
        const dialog = page.getByRole("dialog", { name: "Add cost", exact: true });
        await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("1");
        await dialog.getByLabel("Description *", { exact: true }).fill("Technician labour");
        await dialog.getByLabel("Quantity", { exact: true }).fill("4.5");
        await dialog.getByLabel("Unit cost (ex GST)", { exact: true }).fill("60.00");
        await expect(dialog).toContainText("$270.00");
        if (preset.id === "midnight-signal") await capture(page, info, `midnight-dialog-${viewport.width}`);
        const box = await dialog.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      } finally { await context.close(); }
    });
  }
}
