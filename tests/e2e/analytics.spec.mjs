import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { analyticsFixture, seedAnalyticsCosts } from "../fixtures/analytics-workspace.js";
import { themePresets } from "../../src/lib/theme-presets.js";
import { REPORTS } from "../../src/lib/analytics-reports.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(root, "test-results/analytics");
const password = "Analytics-fixture-123";
const tabs = ["Overview", "Financial", "Jobs", "Customers", "Maintenance", "Profitability", "Reports"];
const sessions = {};
let dataDir, baseUrl, server, logs = "";

test.beforeAll(async ({ browser }) => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-analytics-e2e-")); fs.mkdirSync(screenshots, { recursive: true });
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try { importWorkspaceJsonData(db, analyticsFixture()); seedAnalyticsCosts(db); } finally { db.close(); }
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney", ELSET_DATA_DIR: dataDir, ELSET_AUTH_DB_PATH: path.join(dataDir, "auth.db"), ELSET_WORKSPACE_DB_PATH: path.join(dataDir, "elset-workspace.db"), BETTER_AUTH_URL: baseUrl, ELSET_FRONTEND_URL: baseUrl, PORT: String(port), ELSET_API_PORT: String(port), SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(root, "server-auth.js")).href)});
    await ensureAuthReady(); const context = await auth.$context;
    for (const role of ['admin','office','technician']) {
      const user = await context.internalAdapter.createUser({ email: role+'@analytics.example.test', emailVerified: true, name: 'Reports '+role, role, username: 'reports'+role, displayUsername: 'Reports '+role, workspaceRole: role, staffId: '' });
      await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password: await context.password.hash(${JSON.stringify(password)}) });
    }
  `], { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (seed.status !== 0) throw new Error(seed.stderr);
  server = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); server.stdout.on("data", c => { logs += c; }); server.stderr.on("data", c => { logs += c; });
  await expect.poll(async () => { if (server.exitCode !== null) throw new Error(logs); try { return (await fetch(`${baseUrl}/api/auth/me`)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(401);
  for (const role of ["admin", "office", "technician"]) {
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(baseUrl);
    await page.getByPlaceholder("Enter your username").fill(`reports${role}`); await page.getByPlaceholder("Enter your password").fill(password); await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible(); sessions[role] = await context.storageState(); await context.close();
  }
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await info.attach("server-output", { body: logs, contentType: "text/plain" }); });
test.afterAll(async () => {
  if (server?.exitCode === null) { server.kill("SIGTERM"); await new Promise(resolve => { const timer = setTimeout(resolve, 5000); server.once("exit", () => { clearTimeout(timer); resolve(); }); }); }
  const resolved = path.resolve(dataDir || "."); if (resolved.startsWith(path.join(os.tmpdir(), "elset-analytics-e2e-"))) fs.rmSync(resolved, { recursive: true, force: true });
});
async function open(browser, { width = 1366, height = 768, dark = false, role = "admin", query = "", before } = {}) {
  const context = await browser.newContext({ storageState: sessions[role], viewport: { width, height }, locale: "en-AU", timezoneId: "Australia/Sydney", reducedMotion: "reduce" });
  const page = await context.newPage(); await page.clock.setFixedTime(new Date("2026-10-01T02:00:00Z"));
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/user-preferences", async route => { const response = await route.fetch(), body = await response.json(); await route.fulfill({ response, json: { ...body, preferences: { ...body.preferences, ...themePresets[dark ? 1 : 0].values, roundedEdges: !dark } } }); });
  if (before) await before(page);
  await page.goto(`${baseUrl}/statistics?range=Custom+range&from=2026-09-01&to=2026-09-30${query}`);
  await expect(page.locator("[data-analytics] h1")).toHaveText("Reports & Analytics"); await expect(page.getByRole("tabpanel")).toBeVisible();
  return { page, context, errors };
}
async function noOverflow(page) { expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1); }
async function capture(page, name) { await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true }); }

for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844]]) for (const dark of [false, true]) test(`all tabs full bleed ${width}x${height} ${dark ? "dark" : "light"}`, async ({ browser }) => {
  const { page, context, errors } = await open(browser, { width, height, dark });
  try {
    for (const tab of tabs) {
      await page.getByRole("tab", { name: tab, exact: true }).click(); await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByLabel("From date", { exact: true })).toHaveValue("2026-09-01"); await noOverflow(page);
      expect(await page.locator(".analytics-body").evaluate(el => ["paddingLeft", "paddingRight", "paddingTop"].map(key => getComputedStyle(el)[key]))).toEqual(["0px", "0px", "0px"]);
      if (tab !== "Reports") {
        const geometry = await page.locator(".analytics-grid").evaluateAll(nodes => nodes.map(el => ({ gap: getComputedStyle(el).gap, columns: getComputedStyle(el).gridTemplateColumns.split(" ").length, radius: getComputedStyle(el).borderRadius })));
        expect(geometry.every(g => g.gap === "0px" && g.radius === "0px")).toBe(true); if (width === 390) expect(geometry.every(g => g.columns === 1)).toBe(true);
        await expect(page.locator(".analytics-kpis")).toHaveCSS("gap", "0px");
      }
      await capture(page, `${width}-${dark ? "dark" : "light"}-${tab.toLowerCase()}`);
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("date/compare/filter query survives tabs and refresh; finance totals reconcile", async ({ browser }) => {
  const { page, context } = await open(browser);
  try {
    await expect(page.locator('[data-metric="Total invoiced"] dd')).toHaveText("$3,630.00"); await expect(page.locator('[data-metric="Payments received"] dd')).toHaveText("$3,310.00"); await expect(page.locator('[data-metric="Outstanding"] dd')).toHaveText("$660.00");
    await page.getByLabel("Compare previous period").click(); await expect(page.getByLabel("Compare previous period")).toBeChecked(); await expect(page.locator('[data-metric="Total invoiced"]')).toContainText("+560.0% vs previous period");
    await page.getByRole("button", { name: /^Filters/ }).click(); const dialog = page.getByRole("dialog", { name: "Analytics filters" }); await dialog.getByLabel("Customer", { exact: true }).selectOption("c0"); await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator('[data-metric="Total invoiced"] dd')).toHaveText("$1,100.00"); await page.getByRole("tab", { name: "Financial", exact: true }).click(); await expect(page.locator('[data-metric="Received"] dd')).toHaveText("$990.00");
    await page.reload(); await expect(page.getByRole("tab", { name: "Financial", exact: true })).toHaveAttribute("aria-selected", "true"); await expect(page.getByLabel("Compare previous period")).toBeChecked(); await expect(page.locator('[data-metric="Outstanding"] dd')).toHaveText("$440.00");
    await page.getByLabel("To date").fill("2026-08-01"); await expect(page.getByRole("alert")).toContainText("valid date range"); await expect(page.getByRole("tabpanel")).toHaveCount(0);
  } finally { await context.close(); }
});

test("one financial request supplies tabs; no chart performs a write or full resync", async ({ browser }) => {
  const requests = []; const { page, context } = await open(browser, { before: page => page.on("request", req => requests.push({ url: req.url(), method: req.method() })) });
  try {
    for (const tab of tabs) await page.getByRole("tab", { name: tab, exact: true }).click();
    expect(requests.filter(r => r.url.includes("/api/reports/financials"))).toHaveLength(1); expect(requests.filter(r => r.url.includes("/api/app-state"))).toHaveLength(1);
    expect(requests.filter(r => r.url.includes("/api/reports/")).every(r => r.method === "GET")).toBe(true);
    const refreshed = page.waitForResponse("**/api/reports/financials"); await page.getByRole("button", { name: "Refresh reports" }).click(); await refreshed;
    expect(requests.filter(r => r.url.includes("/api/reports/financials"))).toHaveLength(2);
  } finally { await context.close(); }
});

test("saved technician assignments survive legacy client normalization in workload reports", async ({ browser }) => {
  const { page, context } = await open(browser, { query: "&tab=reports&report=technician&technician=tech-a" });
  try {
    const table = page.getByRole("region", { name: "Technician Workload table", exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(4); await expect(table).toContainText("Alex Technician"); await expect(table).not.toContainText("Unassigned");
  } finally { await context.close(); }
});

test("returning from a job refreshes costing without losing report dates", async ({ browser }) => {
  const { page, context } = await open(browser, { query: "&tab=reports&report=profitability" });
  try {
    await page.getByRole("region", { name: "Job Profitability table", exact: true }).getByRole("link", { name: /Reporting partial/ }).click(); await expect(page).toHaveURL(/\/jobs\/partial$/);
    const changed = await context.request.patch(`${baseUrl}/api/jobs/partial/costs/cost-0`, { data: { unitCostCents: 20000 } }); expect(changed.ok()).toBe(true);
    await page.goBack(); const row = page.getByRole("region", { name: "Job Profitability table", exact: true }).getByRole("row").filter({ hasText: "Reporting partial" });
    await expect(row).toContainText("$800.00"); await expect(page.getByLabel("From date", { exact: true })).toHaveValue("2026-09-01");
  } finally { await context.request.patch(`${baseUrl}/api/jobs/partial/costs/cost-0`, { data: { unitCostCents: 10000 } }); await context.close(); }
});

test("19 reports render relevant filters; CSV downloads the filtered dataset", async ({ browser }) => {
  const { page, context } = await open(browser, { query: "&tab=reports" });
  try {
    for (const report of REPORTS) { await page.getByRole("navigation", { name: "Report catalogue" }).getByRole("button", { name: report.name, exact: true }).click(); await expect(page.locator(".analytics-report-header h2")).toHaveText(report.name); await expect(page.getByRole("region", { name: `${report.name} table`, exact: true })).toBeVisible(); }
    await page.getByRole("navigation", { name: "Report catalogue" }).getByRole("button", { name: "Sales Report", exact: true }).click();
    await page.getByRole("button", { name: /^Filters/ }).click(); const dialog = page.getByRole("dialog", { name: "Analytics filters" }); await dialog.getByLabel("Customer", { exact: true }).selectOption("c0"); await dialog.getByLabel("Site", { exact: true }).selectOption("s0"); await dialog.getByRole("button", { name: "Done", exact: true }).click();
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export CSV", exact: true }).click(); const file = await download; expect(file.suggestedFilename()).toBe("sales-report_2026-09-01_2026-09-30.csv"); const csv = fs.readFileSync(await file.path(), "utf8"); expect(csv).toContain("Alpha Engineering"); expect(csv).not.toContain("Beta Engineering"); expect(csv).toContain("1100.00");
    await page.getByRole("navigation", { name: "Report catalogue" }).getByRole("button", { name: "Customer Lifetime Value", exact: true }).click(); await page.getByRole("button", { name: /^Filters/ }).click(); await expect(dialog.getByLabel("Job status", { exact: true })).toHaveCount(0); await expect(dialog.getByLabel("Technician", { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test("report rows drill into existing invoice/customer/job/maintenance routes and return", async ({ browser }) => {
  const { page, context } = await open(browser, { query: "&tab=reports" });
  try {
    for (const [report, url] of [["Sales Report", /\/jobs\/.*\/invoice/], ["Customer Lifetime Value", /\/customers\/c/], ["Jobs Report", /\/jobs\/[^/]+$/], ["Overdue Maintenance", /\/maintenance\/plan-a$/]]) {
      await page.getByRole("navigation", { name: "Report catalogue" }).getByRole("button", { name: report, exact: true }).click(); await page.getByRole("region", { name: `${report} table`, exact: true }).getByRole("link").first().click(); await expect(page).toHaveURL(url); await page.goBack(); await expect(page.locator(".analytics-report-header h2")).toHaveText(report);
    }
  } finally { await context.close(); }
});

test("overdue KPI and maintenance groups open existing filtered workspaces", async ({ browser }) => {
  const { page, context } = await open(browser);
  try {
    await page.locator('[data-metric="Overdue invoices"] button').click(); await expect(page).toHaveURL(/\/invoices\?status=overdue/); await expect(page.locator('[data-page-body]')).toContainText("Reporting partial"); await page.goBack();
    await page.getByRole("tab", { name: "Maintenance", exact: true }).click(); await page.locator('[data-metric="Overdue plans"] button').click(); await expect(page).toHaveURL(/\/maintenance\?filter=overdue/); await expect(page.locator('[data-maintenance-plan="plan-a"]:visible')).toBeVisible(); await expect(page.locator('[data-maintenance-plan="plan-b"]:visible')).toHaveCount(0);
  } finally { await context.close(); }
});

test("chart points narrow report dates and job pipeline bars open filtered history", async ({ browser }) => {
  const { page, context } = await open(browser);
  try {
    await page.locator('section[aria-label="Invoiced & received"] .recharts-wrapper').click({ position: { x: 200, y: 110 } });
    await expect(page.locator(".analytics-report-header h2")).toHaveText("Sales Report");
    const query = new URL(page.url()).searchParams; expect(query.get("from")).toBe(query.get("to"));
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.locator('section[aria-label="Job pipeline"] .recharts-bar-rectangle').first().click();
    await expect(page.getByRole("navigation", { name: "Application", exact: true }).getByRole("button", { name: "Job History", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-page-body] .data-grid-row:visible')).toHaveCount(3);
  } finally { await context.close(); }
});

test("sticky chrome, chart tooltip and filter dialog layer correctly", async ({ browser }) => {
  const { page, context } = await open(browser, { height: 768 });
  try {
    await page.evaluate(() => window.scrollTo(0, 260)); const bounds = await page.locator(".analytics-chrome").boundingBox(); expect(bounds.y).toBeCloseTo(0, 0); await expect(page.getByRole("tablist")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0)); const chart = page.locator('[aria-label="Invoiced & received"] .recharts-wrapper').first(); await chart.hover({ position: { x: 200, y: 110 } }); await expect(page.locator(".analytics-tooltip").first()).toBeVisible();
    expect(await page.locator(".recharts-tooltip-wrapper").first().evaluate(el => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(30);
    await page.getByRole("button", { name: /^Filters/ }).click(); await expect(page.getByRole("dialog", { name: "Analytics filters" })).toBeVisible(); await page.getByRole("dialog").getByLabel("Customer", { exact: true }).selectOption("c1"); await page.getByRole("button", { name: "Done", exact: true }).click(); await expect(page.locator('[data-metric="Total invoiced"] dd')).toHaveText("$2,200.00");
  } finally { await context.close(); }
});

test("print layout shows report context and full table without navigation", async ({ browser }) => {
  const { page, context } = await open(browser, { query: "&tab=reports&report=lifetime", width: 1920, height: 1080 });
  try {
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; }); await page.getByRole("button", { name: "Print / Save as PDF" }).click(); expect(await page.evaluate(() => window.__printed)).toBe(true);
    await page.emulateMedia({ media: "print" }); await expect(page.locator(".analytics-chrome")).toBeHidden(); await expect(page.getByRole("navigation", { name: "Report catalogue" })).toBeHidden(); await expect(page.locator(".analytics-table-scroll")).toHaveCSS("max-height", "none");
    await expect(page.locator(".analytics-report-header")).toContainText("Lifetime totals"); await noOverflow(page); await capture(page, "print-lifetime"); await page.pdf({ path: path.join(screenshots, "lifetime-report.pdf"), preferCSSPageSize: true, printBackground: true });
  } finally { await context.close(); }
});

test("report API respects commercial roles and hides disabled costing", async ({ browser, request }) => {
  expect((await request.get(`${baseUrl}/api/reports/financials`)).status()).toBe(401);
  for (const role of ["office", "technician"]) { const context = await browser.newContext({ storageState: sessions[role] }); expect((await context.request.get(`${baseUrl}/api/reports/financials`)).status()).toBe(role === "office" ? 200 : 403); await context.close(); }
  const { page, context } = await open(browser, { before: page => page.route("**/api/reports/financials", async route => { const response = await route.fetch(), payload = await response.json(); await route.fulfill({ response, json: { ...payload, result: { ...payload.result, costingEnabled: false, costing: [] } } }); }) });
  try { await page.getByRole("tab", { name: "Profitability", exact: true }).click(); await expect(page.getByRole("heading", { name: "Job Costing is disabled" })).toBeVisible(); await expect(page.locator(".analytics-kpis")).toHaveCount(0); } finally { await context.close(); }
});

test("failed report read exposes retry without displaying invented zero financials", async ({ browser }) => {
  let failed = true;
  const recoveryContext = await browser.newContext({ storageState: sessions.admin }); const recoveryPage = await recoveryContext.newPage();
  try {
    await recoveryPage.route("**/api/reports/financials", route => failed ? route.fulfill({ status: 503, json: { error: "Reporting temporarily unavailable" } }) : route.continue()); await recoveryPage.goto(`${baseUrl}/statistics`);
    await expect(recoveryPage.getByRole("alert")).toContainText("Reporting temporarily unavailable"); await expect(recoveryPage.locator(".analytics-kpis")).toHaveCount(0); failed = false; await recoveryPage.getByRole("button", { name: "Retry", exact: true }).click(); await expect(recoveryPage.getByRole("tabpanel")).toBeVisible();
  } finally { await recoveryContext.close(); }
});
