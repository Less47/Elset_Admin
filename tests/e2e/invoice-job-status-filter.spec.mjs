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
import { statuses } from "../../src/lib/job-status.js";
import { themePresets } from "../../src/lib/theme-presets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(repoRoot, "test-results/invoice-job-status");
const password = "Invoice-filter-local-test-123";
const viewports = [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 720 },
  { width: 1024, height: 768 }, { width: 820, height: 1180 }, { width: 390, height: 844 },
];
let dataDir, baseUrl, server, storageState;
let serverOutput = "";

function workspaceFixture() {
  const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "fixtures/demo-workspace.json"), "utf8"));
  const original = fixture.jobs[0];
  const today = new Date().toISOString().slice(0, 10);
  const cases = [
    ["Completed", "Alpha completed service", "unpaid", 200],
    ["In Progress", "Alpha ongoing service", "unpaid", 100],
    ["To Do", "Pending service", "unpaid", 300],
    ["Completed", "Paid service", "paid", 400],
    ["Completed", "Invoice candidate", "not-invoiced", 0],
    ["In Progress", "Draft service", "draft", 500],
    ["Completed", "Older invoice", "unpaid", 700],
  ];
  fixture.jobs = cases.map(([status, title, invoiceStatus, rate], index) => ({
    ...original, id: `invoice-filter-${index + 1}`, jobNumber: 2001 + index,
    status, title, quote: null, notes: [], photos: [], createdAt: `${today}T00:00:00.000Z`,
    invoice: invoiceStatus === "not-invoiced" ? null : {
      type: "invoice", issueDate: index === 6 ? "2000-01-01" : today, dueDate: `2099-01-0${index + 1}`,
      notes: "Invoice filter fixture", paymentNotes: "", items: [{ id: `item-${index}`, description: "Service", qty: 1, rate }],
      sentHistory: invoiceStatus === "draft" ? [] : [{ id: `sent-${index}`, sentAt: `${today}T00:00:00.000Z` }],
      payments: invoiceStatus === "paid" ? [{ id: `payment-${index}`, amount: 440, date: today, reference: "BANK-REF-C", method: "Bank transfer" }] : [],
    },
  }));
  return fixture;
}

function readWorkspace() {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db"), readonly: true, migrate: false });
  try { return loadWorkspaceStateFromDb(db); } finally { db.close(); }
}

test.beforeAll(async ({ browser }) => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-invoice-filter-"));
  fs.mkdirSync(screenshots, { recursive: true });
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try { importWorkspaceJsonData(db, workspaceFixture()); } finally { db.close(); }
  const portProbe = net.createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney",
    ELSET_DATA_DIR: dataDir, ELSET_AUTH_DB_PATH: path.join(dataDir, "auth.db"),
    ELSET_WORKSPACE_DB_PATH: path.join(dataDir, "elset-workspace.db"), ELSET_WORKSPACE_STORAGE: "sqlite",
    BETTER_AUTH_URL: baseUrl, ELSET_FRONTEND_URL: baseUrl, ELSET_API_PORT: String(port), PORT: String(port),
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
  };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, "server-auth.js")).href)});
    await ensureAuthReady();
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({
      email: "invoice.filter@auth.elset.local", emailVerified: true, name: "Invoice Filter Test", role: "admin",
      username: "invoicefilter", displayUsername: "Invoice Filter Test", workspaceRole: "admin", staffId: "",
    });
    await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: await context.password.hash(${JSON.stringify(password)}) });
  `], { cwd: repoRoot, env, encoding: "utf8" });
  if (seed.status !== 0) throw new Error(`Test login setup failed: ${seed.stdout}\n${seed.stderr}`);
  server = spawn(process.execPath, ["server.js"], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { return (await fetch(`${baseUrl}/api/auth/me`)).status; } catch { return 0; }
  }, { timeout: 30000 }).toBe(401);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(baseUrl);
    await page.getByPlaceholder("Enter your username").fill("invoicefilter");
    await page.getByPlaceholder("Enter your password").fill(password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible();
    storageState = await context.storageState();
  } finally { await context.close(); }
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 5000);
      server.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  const target = path.resolve(dataDir || ".");
  if (target.startsWith(path.join(os.tmpdir(), "elset-invoice-filter-"))) fs.rmSync(target, { recursive: true, force: true });
});

async function openInvoices(browser, viewport = viewports[1], preset) {
  const context = await browser.newContext({ storageState, viewport, hasTouch: viewport.width < 1280, isMobile: viewport.width < 768, locale: "en-AU", reducedMotion: "reduce" });
  const page = await context.newPage();
  if (preset) {
    // Supply a personal theme response in this test context without writing shared settings.
    await page.route("**/api/user-preferences", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, preferences: { ...body.preferences, ...preset.values } } });
    });
  }
  const requests = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push({ path: new URL(request.url()).pathname, method: request.method() }); });
  await page.goto(baseUrl);
  if (viewport.width < 1024) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Invoices", exact: true }).click();
  await expect(page.locator(".data-grid-row:visible, [data-mobile-record-card]")).toHaveCount(7);
  if (preset) await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"))).toBe(preset.values.actionColor);
  requests.length = 0;
  return { context, page, requests };
}

const rows = (page) => page.locator(".data-grid-row:visible, [data-mobile-record-card]");
async function jobNumbers(page) {
  return rows(page).evaluateAll((elements) => elements.map((element) => Number(element.innerText.match(/#(\d+)/)?.[1])));
}
async function expectJobs(page, expected, { ordered = false } = {}) {
  await expect.poll(async () => {
    const actual = await jobNumbers(page);
    return ordered ? actual : actual.sort((a, b) => a - b);
  }).toEqual(ordered ? expected : [...expected].sort((a, b) => a - b));
}
async function showFilters(page, width) {
  if (width >= 1280) return page.locator("[data-desktop-page-controls]");
  await page.getByRole("button", { name: /^Filters/ }).click();
  return page.getByRole("dialog", { name: "Filters", exact: true });
}
async function choose(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function capture(page, info, name) {
  const body = await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
  await info.attach(name, { body, contentType: "image/png" });
}

test("Job Status composes with invoice status, search, dates and existing sorts without requests or record changes", async ({ browser }) => {
  const before = readWorkspace();
  const { context, page, requests } = await openInvoices(browser);
  try {
    await expect(page.getByRole("combobox", { name: "Job Status", exact: true })).toHaveText("All Job Statuses");
    await choose(page, "Job Status", "Completed");
    await expectJobs(page, [2001, 2004, 2005, 2007]);
    await choose(page, "Status filter", "Unpaid");
    await expectJobs(page, [2001, 2007]);
    await choose(page, "Sort by", "Highest value");
    await expectJobs(page, [2007, 2001], { ordered: true });
    await choose(page, "Sort by", "Due date");
    await expectJobs(page, [2001, 2007], { ordered: true });
    await page.getByRole("textbox", { name: "Search billing records", exact: true }).fill("Alpha");
    await expectJobs(page, [2001]);
    await choose(page, "Job Status", "In Progress");
    await expectJobs(page, [2002]);
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await choose(page, "Status filter", "All jobs");
    await expectJobs(page, [2002, 2006]);
    await choose(page, "Job Status", "To Do");
    await expectJobs(page, [2003]);
    await choose(page, "Job Status", "Completed");
    await choose(page, "Time range", "Past week");
    await expectJobs(page, [2001, 2004, 2005]);
    await page.getByRole("textbox", { name: "Search billing records", exact: true }).fill("BANK-REF-C");
    await expectJobs(page, [2004]);
    await choose(page, "Job Status", "In Progress");
    await expect(page.getByText("No billing records found", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    expect(readWorkspace()).toEqual(before);
  } finally { await context.close(); }
});

test("mobile reset clears Job Status and invoice filters, preserves sort/search and restores focus", async ({ browser }) => {
  const { context, page, requests } = await openInvoices(browser, viewports[5]);
  try {
    await page.getByRole("textbox", { name: "Search invoices", exact: true }).fill("Alpha");
    await page.getByRole("combobox", { name: /^Sort invoices/ }).click();
    await page.getByRole("option", { name: "Newest job", exact: true }).click();
    let sheet = await showFilters(page, 390);
    await choose(page, "Job Status", "Completed");
    await choose(page, "Status filter", "Unpaid");
    await choose(page, "Time range", "Past week");
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expectJobs(page, [2001]);
    await expect(page.getByRole("button", { name: "Filters, 3 active", exact: true })).toBeFocused();
    sheet = await showFilters(page, 390);
    await expect(sheet.getByRole("combobox", { name: "Job Status", exact: true })).toHaveText("Completed");
    await sheet.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(sheet.getByRole("combobox", { name: "Job Status", exact: true })).toHaveText("All Job Statuses");
    await expect(sheet.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expectJobs(page, [2002, 2001], { ordered: true });
    await expect(page.getByRole("textbox", { name: "Search invoices", exact: true })).toHaveValue("Alpha");
    await expect(page.getByRole("combobox", { name: /^Sort invoices/ })).toContainText("Newest job");
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Clear search invoices", exact: true }).click();
    await expectJobs(page, [2007, 2006, 2005, 2004, 2003, 2002, 2001], { ordered: true });
    expect(requests).toEqual([]);
  } finally { await context.close(); }
});

for (const viewport of viewports) {
  test(`Job Status uses the existing controls and keyboard selection at ${viewport.width}x${viewport.height}`, async ({ browser }, info) => {
    const { context, page, requests } = await openInvoices(browser, viewport);
    try {
      const controls = await showFilters(page, viewport.width);
      const picker = controls.getByRole("combobox", { name: "Job Status", exact: true });
      await expect(picker).toHaveText("All Job Statuses");
      if (viewport.width >= 1280) {
        const positions = await controls.locator('input, button[role="combobox"]').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
        expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
      }
      await picker.focus();
      await picker.press("ArrowDown");
      await expect(page.getByRole("option")).toHaveText(["All Job Statuses", ...statuses]);
      await expect(page.getByRole("option", { name: "All Job Statuses", exact: true })).toBeFocused();
      await page.keyboard.press("End");
      await expect(page.getByRole("option", { name: "Completed", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(picker).toHaveText("Completed");
      await expect(picker).toBeFocused();
      await noOverflow(page);
      await capture(page, info, `filter-${viewport.width}x${viewport.height}`);
      if (viewport.width < 1280) await controls.getByRole("button", { name: "Done", exact: true }).click();
      await expectJobs(page, [2001, 2004, 2005, 2007]);
      await noOverflow(page);
      await capture(page, info, `results-${viewport.width}x${viewport.height}`);
      expect(requests).toEqual([]);
    } finally { await context.close(); }
  });
}

for (const preset of themePresets) {
  test(`Job Status control and options follow ${preset.label} on desktop and mobile`, async ({ browser }, info) => {
    for (const viewport of [viewports[1], viewports[5]]) {
      const { context, page } = await openInvoices(browser, viewport, preset);
      try {
        const controls = await showFilters(page, viewport.width);
        const picker = controls.getByRole("combobox", { name: "Job Status", exact: true });
        const colors = await picker.evaluate((element) => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
        expect(colors.text).not.toBe(colors.background);
        await picker.click();
        await expect(page.getByRole("option")).toHaveText(["All Job Statuses", ...statuses]);
        await expect(page.getByRole("listbox")).toBeInViewport();
        await noOverflow(page);
        await capture(page, info, `theme-${preset.id}-${viewport.width}`);
        await page.getByRole("option", { name: "In Progress", exact: true }).click();
        if (viewport.width < 1280) await controls.getByRole("button", { name: "Done", exact: true }).click();
        await expectJobs(page, [2002, 2006]);
      } finally { await context.close(); }
    }
  });
}
