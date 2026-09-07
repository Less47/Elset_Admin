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

import { updateWorkspaceSettings } from "../../server-workspace-settings.js";
import { defaultWorkspaceSettings as defaultThemeSettings, workspaceUiSettingKeys as uiSettingKeys } from "../../server-workspace-setting-keys.js";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "fixtures/demo-workspace.json");
const screenshotDir = path.join(repoRoot, "test-results/theme");
const accountPassword = "E2E-theme-pass-123";
let tempDataDir = "";
let baseUrl = "";
let serverProcess = null;
let serverOutput = "";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(`${url}/api/auth/me`);
      if (response.status === 401 || response.ok) return;
    } catch {
      // Keep polling while the isolated server starts.
    }

    if (serverProcess?.exitCode !== null) {
      throw new Error(`Theme test server exited before it was ready.\n${serverOutput}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for the theme test server.\n${serverOutput}`);
}

function readWorkspaceState() {
  const db = openWorkspaceDb({
    dbPath: path.join(tempDataDir, "elset-workspace.db"),
    readonly: true,
    migrate: false,
  });
  try {
    return loadWorkspaceStateFromDb(db);
  } finally {
    db.close();
  }
}

async function seedLoginAccounts() {
  const authDbPath = path.join(tempDataDir, "auth.db");
  const serverAuthUrl = `${pathToFileURL(path.join(repoRoot, "server-auth.js")).href}?mobile-e2e=${Date.now()}`;
  const accounts = [
    { username: "mobileadmin", email: "mobile.admin@auth.elset.local", name: "Mobile Admin", role: "admin" },
    { username: "mobileoffice", email: "mobile.office@auth.elset.local", name: "Mobile Office", role: "office" },
    { username: "mobiletech", email: "mobile.tech@auth.elset.local", name: "Mobile Technician", role: "technician" },
  ];
  const seedScript = `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(serverAuthUrl)});
    await ensureAuthReady();
    const context = await auth.$context;
    const accounts = ${JSON.stringify(accounts)};
    for (const account of accounts) {
      const user = await context.internalAdapter.createUser({
        email: account.email,
        emailVerified: true,
        name: account.name,
        role: account.role,
        username: account.username,
        displayUsername: account.name,
        workspaceRole: account.role,
        staffId: "",
      });
      const password = await context.password.hash(${JSON.stringify(accountPassword)});
      await context.internalAdapter.linkAccount({
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password,
      });
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", seedScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ELSET_AUTH_DB_PATH: authDbPath,
      ELSET_DATA_DIR: tempDataDir,
      ELSET_WORKSPACE_DB_PATH: path.join(tempDataDir, "elset-workspace.db"),
      ELSET_WORKSPACE_STORAGE: "sqlite",
      FLY_APP_NAME: "",
      NODE_ENV: "test",
      TZ: "Australia/Sydney",
    },
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to seed theme test logins.\n${result.stdout || ""}${result.stderr || ""}`);
  }
}

async function startServer() {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    BETTER_AUTH_URL: baseUrl,
    ELSET_API_PORT: String(port),
    ELSET_AUTH_DB_PATH: path.join(tempDataDir, "auth.db"),
    ELSET_DATA_DIR: tempDataDir,
    ELSET_WORKSPACE_DB_PATH: path.join(tempDataDir, "elset-workspace.db"),
    ELSET_FRONTEND_URL: baseUrl,
    ELSET_WORKSPACE_STORAGE: "sqlite",
    FLY_APP_NAME: "",
    NODE_ENV: "test",
    PORT: String(port),
    TZ: "Australia/Sydney",
  };
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  serverProcess.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer(baseUrl);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (serverProcess?.exitCode === null) serverProcess.kill("SIGKILL");
      resolve();
    }, 5_000);
    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

const defaultUi = Object.fromEntries(uiSettingKeys.map((key) => [key, defaultThemeSettings[key]]));
let originalRecords;
test.beforeAll(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-theme-playwright-"));
  fs.mkdirSync(screenshotDir, { recursive: true });
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { importWorkspaceJsonData(db, JSON.parse(fs.readFileSync(fixturePath, "utf8"))); } finally { db.close(); }
  originalRecords = recordsOnly(readWorkspaceState());
  await seedLoginAccounts();
  await startServer();
});
test.beforeEach(() => {
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { updateWorkspaceSettings(db, defaultUi); } finally { db.close(); }
});
test.afterEach(async ({}, info) => {
  expect(recordsOnly(readWorkspaceState())).toEqual(originalRecords);
  if (info.status !== info.expectedStatus) await info.attach("theme-server-output", { body: serverOutput, contentType: "text/plain" });
});
test.afterAll(async () => {
  await stopServer();
  const target = path.resolve(tempDataDir);
  if (target.startsWith(path.join(os.tmpdir(), "elset-theme-playwright-"))) fs.rmSync(target, { recursive: true, force: true });
});

function recordsOnly(state) {
  return {
    ...Object.fromEntries(["jobs", "customers", "staff", "inventoryItems", "maintenancePlans", "deletedJobs", "deletedCustomers", "quoteTemplate", "invoiceTemplate"].map((key) => [key, state[key]])),
    preferences: Object.fromEntries(Object.entries(state.settings).filter(([key]) => !uiSettingKeys.includes(key))),
  };
}

async function navigate(page, label, width) {
  if (width < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: label, exact: true }).click();
}

async function openSettings(browser, width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1280, isMobile: width < 768, locale: "en-AU", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByPlaceholder("Enter your username").fill("mobileadmin");
  await page.getByPlaceholder("Enter your password").fill(accountPassword);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await navigate(page, "Settings", width);
  await page.locator(".floating-page-toolbar").getByRole("button", { name: "UI Settings", exact: true }).click();
  const writes = [];
  const dialogs = [];
  page.on("request", (request) => {
    if (["PATCH", "PUT", "POST", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.startsWith("/api/")) {
      writes.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() });
    }
  });
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  return { context, page, writes, dialogs };
}
const status = (page) => page.getByRole("status", { name: "Theme save status" });
const colourInput = (page) => page.getByLabel("Primary action colour", { exact: true });
function setColours(page, values) {
  // Native picker automation can take >400ms between calls in WebKit. Dispatch
  // the input burst in the browser to exercise actual rapid-change behaviour.
  return colourInput(page).evaluate((input, colours) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (const colour of colours) {
      setter.call(input, colour);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);
}
const primary = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"));
const assertPrimary = (page, value) => expect.poll(() => primary(page)).toBe(value);
function assertTargeted(writes, count) {
  expect(writes).toHaveLength(count);
  for (const write of writes) {
    expect(write.path).toBe("/api/settings");
    expect(write.method).toBe("PATCH");
    expect(Object.keys(write.body)).toEqual(["settings"]);
    expect(Object.keys(write.body.settings).every((key) => uiSettingKeys.includes(key))).toBe(true);
  }
}

async function delayedSettings(page, transform = (payload) => payload) {
  const requests = [];
  let active = 0;
  let maximum = 0;
  await page.route("**/api/settings", async (route) => {
    active++;
    maximum = Math.max(maximum, active);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    requests.push({ patch: route.request().postDataJSON().settings, release });
    await gate;
    const response = await route.fetch();
    await route.fulfill({ response, json: transform(await response.json()) });
    active--;
  });
  return { requests, maximum: () => maximum };
}

test("ten rapid selections update immediately, coalesce, and stay latest through delayed acknowledgements", async ({ browser }) => {
  const { context, page, writes, dialogs } = await openSettings(browser);
  const companyName = readWorkspaceState().settings.companyName;
  const delayed = await delayedSettings(page, (payload) => ({ ...payload, state: { ...payload.state, jobs: [], settings: { ...payload.state.settings, companyName: "Stale response company" } } }));
  try {
    await colourInput(page).fill("#112233");
    await assertPrimary(page, "#112233");
    expect(delayed.requests).toHaveLength(0);
    await expect.poll(() => delayed.requests.length).toBe(1);
    for (let i = 0; i < 10; i++) {
      await colourInput(page).fill(`#22550${i}`);
      await assertPrimary(page, `#22550${i}`);
    }
    await page.getByLabel("Page header colour", { exact: true }).fill("#334455");
    await page.waitForTimeout(550);
    expect(delayed.requests).toHaveLength(1);
    await expect(colourInput(page)).toBeEnabled();
    await expect(status(page)).toHaveText("Saving…");
    delayed.requests[0].release();
    await expect.poll(() => delayed.requests.length).toBe(2);
    await assertPrimary(page, "#225509");
    expect(delayed.requests[1].patch).toEqual({ actionColor: "#225509", heroSurface: "#334455" });
    delayed.requests[1].release();
    await expect(status(page)).toHaveText("Saved");
    expect(delayed.maximum()).toBe(1);
    expect(readWorkspaceState().settings.actionColor).toBe("#225509");
    await page.locator(".floating-page-toolbar").getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(page.getByPlaceholder("Elset", { exact: true })).toHaveValue(companyName);
    await page.reload();
    await assertPrimary(page, "#225509");
    assertTargeted(writes, 2);
    expect(dialogs).toEqual([]);
  } finally { await context.close(); }
});

for (const failure of [
  { status: 503, body: "No healthy instances found", contentType: "text/plain", message: "Theme change could not be saved." },
  { status: 409, body: JSON.stringify({ error: "Workspace settings conflict." }), contentType: "application/json", message: "Workspace settings conflict." },
]) {
  test(`${failure.status} save failure keeps the theme, shows one inline error, and retries the latest patch`, async ({ browser }) => {
    const { context, page, writes, dialogs } = await openSettings(browser);
    let attempts = 0;
    await page.route("**/api/settings", async (route) => {
      if (++attempts === 1) await route.fulfill(failure);
      else await route.continue();
    });
    try {
      await setColours(page, Array.from({ length: 10 }, (_, i) => `#44550${i}`));
      await expect(status(page)).toContainText(failure.message);
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(1);
      await assertPrimary(page, "#445509");
      await expect(colourInput(page)).toBeEnabled();
      await page.waitForTimeout(550);
      expect(attempts).toBe(1);
      expect(readWorkspaceState().settings.actionColor).toBe(defaultUi.actionColor);
      await status(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshotDir, `theme-error-${failure.status}.png`) });
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(status(page)).toHaveText("Saved");
      expect(readWorkspaceState().settings.actionColor).toBe("#445509");
      await page.reload();
      await assertPrimary(page, "#445509");
      assertTargeted(writes, 2);
      expect(dialogs).toEqual([]);
    } finally { await context.close(); }
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
  test(`pending theme saves survive immediate navigation and reload at ${viewport.width}px`, async ({ browser }) => {
    const { context, page, writes, dialogs } = await openSettings(browser, viewport.width, viewport.height);
    const delayed = await delayedSettings(page);
    try {
      await assertPrimary(page, defaultUi.actionColor);
      // Dispatch real input events without scrolling the distant controls; this
      // lets navigation unmount Settings inside the 400ms debounce on mobile.
      await setColours(page, ["#778899"]);
      await assertPrimary(page, "#778899");
      await navigate(page, "Service Board", viewport.width);
      await expect(colourInput(page)).toHaveCount(0);
      await expect.poll(() => delayed.requests.length).toBe(1);
      await assertPrimary(page, "#778899");
      delayed.requests[0].release();
      await expect.poll(() => readWorkspaceState().settings.actionColor).toBe("#778899");
      await navigate(page, "Settings", viewport.width);
      await expect(status(page)).toHaveText("Saved");
      await colourInput(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshotDir, `theme-${viewport.width}.png`) });
      const sizes = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
      await page.reload();
      await assertPrimary(page, "#778899");
      assertTargeted(writes, 1);
      expect(dialogs).toEqual([]);
    } finally { await context.close(); }
  });
}

test("hex drafts stay editable and never send invalid colours", async ({ browser }) => {
  const { context, page, writes } = await openSettings(browser);
  try {
    const hex = page.getByLabel("Primary action hex", { exact: true });
    await hex.fill("#1");
    await page.waitForTimeout(500);
    expect(writes).toHaveLength(0);
    await assertPrimary(page, defaultUi.actionColor);
    await hex.fill("#abc");
    await assertPrimary(page, "#AABBCC");
    await expect(hex).toHaveValue("#abc");
    await expect(status(page)).toHaveText("Saved");
    assertTargeted(writes, 1);
    expect(writes[0].body.settings).toEqual({ actionColor: "#AABBCC" });
    await hex.pressSequentially("def");
    await expect(hex).toHaveValue("#abcdef");
    await assertPrimary(page, "#ABCDEF");
    await hex.blur();
    await expect(hex).toHaveValue("#ABCDEF");
    await expect(status(page)).toHaveText("Saved");
    assertTargeted(writes, 2);
    expect(writes[1].body.settings).toEqual({ actionColor: "#ABCDEF" });
    await hex.fill("not a colour");
    await hex.blur();
    await expect(hex).toHaveValue("#ABCDEF");
    expect(readWorkspaceState().settings.actionColor).toBe("#ABCDEF");
  } finally { await context.close(); }
});

test("presets and reset share the colour queue and only change UI settings", async ({ browser }) => {
  const { context, page, writes } = await openSettings(browser);
  const delayed = await delayedSettings(page);
  try {
    await page.getByRole("button", { name: /^Copper Dawn/ }).click();
    await assertPrimary(page, "#E6632B");
    await expect.poll(() => delayed.requests.length).toBe(1);
    await page.getByRole("button", { name: "Reset UI", exact: true }).click();
    await assertPrimary(page, defaultUi.actionColor);
    await page.waitForTimeout(500);
    expect(delayed.requests).toHaveLength(1);
    delayed.requests[0].release();
    await expect.poll(() => delayed.requests.length).toBe(2);
    await assertPrimary(page, defaultUi.actionColor);
    delayed.requests[1].release();
    await expect(status(page)).toHaveText("Saved");
    expect(delayed.maximum()).toBe(1);
    assertTargeted(writes, 2);
    const final = readWorkspaceState().settings;
    expect(Object.fromEntries(uiSettingKeys.map((key) => [key, final[key]]))).toEqual(defaultUi);
  } finally { await context.close(); }
});
