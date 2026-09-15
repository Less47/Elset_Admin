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
import { themePresets } from "../../src/lib/theme-presets.js";
import { invoiceToday } from "../../src/lib/invoice-account.js";
import { insertInvoiceTree } from "../../server-workspace-documents.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(repoRoot, "test-results/customer-account");
const password = "Account-fixture-login-123";
let dataDir, baseUrl, server, storageState;
let serverOutput = "";

function workspaceFixture() {
  const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "fixtures/demo-workspace.json"), "utf8"));
  const template = fixture.jobs[0], customer = fixture.customers[0];
  const today = invoiceToday();
  const date = (offset) => { const value = new Date(`${today}T12:00:00`); value.setDate(value.getDate() + offset); return invoiceToday(value); };
  fixture.customers = ["account-a", "account-b", "account-zero"].map((id) => ({ ...customer, id, name: id === "account-a" ? "Account Example Customer" : id === "account-b" ? "Other Invoice Customer" : "Quote Only Customer", sites: [], siteAccessNotes: [], contacts: [] }));
  fixture.maintenancePlans = [];
  fixture.jobs = [
    ["account-a", 3001, 1000, 400, -24, true], ["account-a", 3002, 200, 0, -2, true],
    ["account-a", 3003, 300, 0, 7, true], ["account-a", 3004, 100, 110, 7, true],
    ["account-a", 3005, 9999, 0, -10, false], ["account-a", 3006, null],
    ["account-b", 9001, 9999, 0, 7, true], ["account-zero", 8001, null],
  ].map(([customerId, jobNumber, rate, paid, due, sent]) => ({ ...template, id: `account-job-${jobNumber}`, customerId,
    customerName: fixture.customers.find((entry) => entry.id === customerId).name, jobNumber, status: "To Do", title: `Account service ${jobNumber}`,
    jobAddress: `Site ${jobNumber}`, notes: [], photos: [], maintenancePlanId: "", createdAt: today, updatedAt: today,
    quote: { type: "quote", status: "accepted", issueDate: today, items: [{ qty: 1, rate: 99999 }], sentHistory: [] },
    invoice: rate === null ? null : { type: "invoice", issueDate: date(-30), dueDate: date(due), items: [{ description: "Gate service", qty: 1, rate }],
      sentHistory: sent ? [{ id: `sent-${jobNumber}`, sentAt: today, toEmail: "accounts@example.test" }] : [],
      payments: paid ? [{ id: `payment-${jobNumber}`, amount: paid, date: today }] : [] },
  }));
  return fixture;
}

function readWorkspace() {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db"), readonly: true, migrate: false });
  try { return loadWorkspaceStateFromDb(db); } finally { db.close(); }
}

test.beforeAll(async ({ browser }) => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-customer-account-"));
  fs.mkdirSync(screenshots, { recursive: true });
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try { importWorkspaceJsonData(db, workspaceFixture()); } finally { db.close(); }
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney",
    ELSET_DATA_DIR: dataDir, ELSET_AUTH_DB_PATH: path.join(dataDir, "auth.db"),
    ELSET_WORKSPACE_DB_PATH: path.join(dataDir, "elset-workspace.db"), ELSET_WORKSPACE_STORAGE: "sqlite",
    BETTER_AUTH_URL: baseUrl, ELSET_FRONTEND_URL: baseUrl, ELSET_API_PORT: String(port), PORT: String(port), SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, "server-auth.js")).href)});
    await ensureAuthReady();
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({ email: "account@auth.elset.local", emailVerified: true, name: "Account Test", role: "admin", username: "accounttest", displayUsername: "Account Test", workspaceRole: "admin", staffId: "" });
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
    await page.getByPlaceholder("Enter your username").fill("accounttest");
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
  if (target.startsWith(path.join(os.tmpdir(), "elset-customer-account-"))) fs.rmSync(target, { recursive: true, force: true });
});

async function openAccount(browser, { width = 1440, height = 900, preset, customerId = "account-a" } = {}) {
  const context = await browser.newContext({ storageState, viewport: { width, height }, locale: "en-AU", timezoneId: "Australia/Sydney", reducedMotion: "reduce" });
  const page = await context.newPage();
  if (preset) await page.route("**/api/user-preferences", async (route) => {
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ response, json: { ...body, preferences: { ...body.preferences, ...preset.values } } });
  });
  await page.goto(`${baseUrl}/customers/${customerId}`);
  if (width < 1024) await page.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(page.locator("[data-account-balance]")).toBeVisible();
  return { context, page, account: page.locator('[data-customer-section="account"]') };
}

test("invoice-only account totals, dates, ordering, navigation and customer filter survive refresh and Back", async ({ browser }) => {
  const { context, page, account } = await openAccount(browser);
  try {
    await expect(account.locator("[data-account-balance]")).toHaveText("$1,250.00");
    await expect(account).toContainText("3 unpaid invoices · 2 overdue");
    await expect(account).toContainText("Oldest overdue: 24 days");
    await expect(account.getByRole("button", { name: /^Open invoice/ })).toHaveCount(3);
    await expect(account.getByRole("button", { name: /^Open invoice/ }).first()).toHaveAttribute("aria-label", "Open invoice INV-3001");
    await expect(account).toContainText("$1,100.00 total · $400.00 paid");
    await account.getByRole("button", { name: "Open invoice INV-3001", exact: true }).click();
    await expect(page).toHaveURL(`${baseUrl}/jobs/account-job-3001/invoice`);
    await expect(page.getByRole("button", { name: "Save Invoice", exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Back to Customer Profile", exact: true }).click();
    await expect(account.locator("[data-account-balance]")).toHaveText("$1,250.00");
    await account.getByRole("button", { name: "View all invoices", exact: true }).click();
    await expect(page).toHaveURL(`${baseUrl}/invoices?customerId=account-a`);
    await expect(page.locator("[data-invoice-customer-filter]")).toContainText("Account Example Customer");
    await expect(page.locator(".data-grid-row:visible")).toHaveCount(5);
    await expect(page.locator(".data-grid-row:visible").filter({ hasText: "Other Invoice Customer" })).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".data-grid-row:visible")).toHaveCount(5);
    await page.goBack();
    await expect(page).toHaveURL(`${baseUrl}/customers/account-a`);
    await page.goForward();
    await expect(page.locator("[data-invoice-customer-filter]")).toBeVisible();
    await page.getByRole("button", { name: "Clear customer filter", exact: true }).click();
    await expect(page).toHaveURL(`${baseUrl}/invoices`);
    await expect(page.locator(".data-grid-row:visible")).toHaveCount(8);
  } finally { await context.close(); }
});

test("payment edits in the existing editor immediately refresh the account after returning", async ({ browser }) => {
  const { context, page, account } = await openAccount(browser);
  try {
    await account.getByRole("button", { name: "Open invoice INV-3001", exact: true }).click();
    await page.getByLabel("Payment 1 amount", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Save Invoice", exact: true }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    await page.getByRole("button", { name: "Back to Customer Profile", exact: true }).click();
    await expect(account.locator("[data-account-balance]")).toHaveText("$1,150.00");
    await account.getByRole("button", { name: "Open invoice INV-3001", exact: true }).click();
    await page.getByLabel("Payment 1 amount", { exact: true }).fill("400");
    await page.getByRole("button", { name: "Save Invoice", exact: true }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  } finally { await context.close(); }
});

test("zero and failure states never show quote values or a false zero, and retry recovers", async ({ browser }) => {
  const { context, page, account } = await openAccount(browser, { customerId: "account-zero" });
  try {
    await expect(account.locator("[data-account-balance]")).toHaveText("$0.00");
    await expect(account).toContainText("Account up to date");
    await page.route("**/api/customers/account-zero/account-summary?*", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(account.getByRole("alert")).toContainText("Account balance unavailable");
    await expect(account.locator("[data-account-balance]")).toHaveCount(0);
    await page.unroute("**/api/customers/account-zero/account-summary?*");
    await account.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(account.locator("[data-account-balance]")).toHaveText("$0.00");
  } finally { await context.close(); }
});

test("focus discovers a newly issued invoice from another session and opens the existing editor", async ({ browser }) => {
  const { context, page, account } = await openAccount(browser, { customerId: "account-zero" });
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db"), migrate: false });
  try {
    await expect(account.locator("[data-account-balance]")).toHaveText("$0.00");
    insertInvoiceTree(db, "account-job-8001", {
      type: "invoice", issueDate: invoiceToday(), dueDate: invoiceToday(),
      items: [{ description: "Newly invoiced service", qty: 1, rate: 100 }],
      sentHistory: [{ id: "external-sent", sentAt: invoiceToday(), toEmail: "accounts@example.test" }],
      payments: [{ id: "external-payment", amount: 30, date: invoiceToday() }],
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(account.locator("[data-account-balance]")).toHaveText("$80.00");
    await expect(account).toContainText("1 unpaid invoice");
    await expect(account).not.toContainText("overdue");
    await account.getByRole("button", { name: "Open invoice INV-8001", exact: true }).click();
    await expect(page).toHaveURL(`${baseUrl}/jobs/account-job-8001/invoice`);
    await expect(page.getByLabel("Payment 1 amount", { exact: true })).toHaveValue("30");
    await page.getByRole("button", { name: "Back to Customer Profile", exact: true }).click();
    await expect(account.locator("[data-account-balance]")).toHaveText("$80.00");
    db.prepare("DELETE FROM invoices WHERE job_id = ?").run("account-job-8001");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(account.locator("[data-account-balance]")).toHaveText("$0.00");
  } finally {
    db.prepare("DELETE FROM invoices WHERE job_id = ?").run("account-job-8001");
    db.close();
    await context.close();
  }
});

test("account remains compact and legible across all themes on desktop, tablet and mobile", async ({ browser }, info) => {
  const before = readWorkspace();
  for (const preset of themePresets) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
      const { context, page, account } = await openAccount(browser, { ...viewport, preset });
      try {
        await expect(account.locator("[data-account-balance]")).toHaveText("$1,250.00");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        const box = await account.boundingBox();
        expect(box.height).toBeLessThan(600);
        if (viewport.width >= 1024) {
          const sites = await page.locator('[data-customer-section="sites"]').boundingBox();
          const jobs = await page.locator('[data-customer-section="jobs"]').boundingBox();
          expect(box.y + box.height).toBeLessThan(sites.y);
          expect(box.y).toBeLessThan(300);
          expect(box.y + box.height).toBeLessThan(jobs.y);
        } else {
          await expect(page.getByRole("tab", { name: "Account", exact: true })).toHaveAttribute("aria-selected", "true");
          await page.reload();
          await expect(account.locator("[data-account-balance]")).toBeVisible();
        }
        await page.evaluate(() => document.fonts.ready);
        const name = `${preset.id}-${viewport.width}x${viewport.height}`;
        const body = await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: viewport.width >= 1024 });
        await info.attach(name, { body, contentType: "image/png" });
      } finally { await context.close(); }
    }
  }
  expect(readWorkspace()).toEqual(before);
});
