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

import { openUserPreferencesDb, getUserUiPreferences } from "../../server-user-ui-preferences.js";
import { updateWorkspaceSettings } from "../../server-workspace-settings.js";
import {
  defaultWorkspaceSettings as defaultThemeSettings,
  workspacePreferenceSettingKeys as preferenceSettingKeys,
  workspaceUiSettingKeys as uiSettingKeys,
} from "../../server-workspace-setting-keys.js";
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

function writeWorkspaceSettings(settings) {
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try {
    updateWorkspaceSettings(db, settings);
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

async function startServer(existingPort) {
  const port = existingPort || await getFreePort();
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
let migrationEvidence;
test.beforeAll(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-theme-playwright-"));
  fs.mkdirSync(screenshotDir, { recursive: true });
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { importWorkspaceJsonData(db, JSON.parse(fs.readFileSync(fixturePath, "utf8"))); } finally { db.close(); }
  originalRecords = recordsOnly(readWorkspaceState());
  await seedLoginAccounts();
  const authBefore = openUserPreferencesDb({ env: { ELSET_DATA_DIR: tempDataDir } });
  try {
    migrationEvidence = {
      tables: authBefore.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all(),
      users: authBefore.prepare('SELECT id, username FROM "user" ORDER BY id').all(),
    };
    expect(migrationEvidence.tables.some((table) => table.name === "user_ui_preferences")).toBe(false);
  } finally { authBefore.close(); }
  await startServer();
});
test.beforeEach(() => {
  const preferences = openUserPreferencesDb({ env: { ELSET_DATA_DIR: tempDataDir } });
  try { preferences.exec("DELETE FROM user_ui_preferences"); } finally { preferences.close(); }
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

async function openSettings(browser, width = 1440, height = 900, tab = "UI Settings", username = "mobileadmin") {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1280, isMobile: width < 768, locale: "en-AU", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByPlaceholder("Enter your username").fill(username);
  await page.getByPlaceholder("Enter your password").fill(accountPassword);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await navigate(page, "Settings", width);
  await page.locator(".floating-page-toolbar").getByRole("button", { name: tab, exact: true }).click();
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
const preferenceStatus = (page) => page.getByRole("status", { name: "Preferences save status" });
const preferenceInput = (page, key) => page.locator(`[data-setting-key="${key}"]`);
const selectRange = (input, start, end = start) => input.evaluate((element, range) => {
  element.focus();
  element.setSelectionRange(range.start, range.end);
}, { start, end });
const selection = (input) => input.evaluate((element) => ({
  active: document.activeElement === element,
  end: element.selectionEnd,
  start: element.selectionStart,
}));
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
function readPersonalSettings(username = "mobileadmin") {
  const db = openUserPreferencesDb({ env: { ELSET_DATA_DIR: tempDataDir } });
  try {
    const user = db.prepare('SELECT id FROM "user" WHERE username = ?').get(username);
    return getUserUiPreferences(db, user.id, () => readWorkspaceState().settings);
  } finally { db.close(); }
}
function assertTargeted(writes, count) {
  expect(writes).toHaveLength(count);
  for (const write of writes) {
    expect(write.path).toBe("/api/user-preferences");
    expect(write.method).toBe("PATCH");
    expect(Object.keys(write.body).every((key) => uiSettingKeys.includes(key))).toBe(true);
  }
}

async function delayedSettings(page, transform = (payload) => payload, endpoint = "/api/settings") {
  const requests = [];
  let active = 0;
  let maximum = 0;
  await page.route("**" + endpoint, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    active++;
    maximum = Math.max(maximum, active);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const body = route.request().postDataJSON();
    requests.push({ patch: endpoint === "/api/settings" ? body.settings : body, release });
    await gate;
    const response = await route.fetch();
    await route.fulfill({ response, json: transform(await response.json()) });
    active--;
  });
  return { requests, maximum: () => maximum };
}

const delayedPersonalSettings = (page, transform) => delayedSettings(page, transform, "/api/user-preferences");

function restoreOriginalPreferences() {
  writeWorkspaceSettings(Object.fromEntries(
    preferenceSettingKeys.map((key) => [key, originalRecords.preferences[key] ?? defaultThemeSettings[key]])
  ));
}

test("preference drafts preserve textarea selection, DOM identity, and latest values through a stale two-second save", async ({ browser }) => {
  const initial = {
    bankAccountName: "ELSET Account",
    bankAccountNumber: "123456789",
    bankBsb: "033505",
    defaultSenderEmail: "admin@elset.com.au",
    emailSignature: "ELSET PTY LTD\n0422662095\nadmin@elset.com.au\nElset.com.au",
  };
  writeWorkspaceSettings(initial);
  const { context, page, writes, dialogs } = await openSettings(browser, 1440, 900, "Preferences");
  const delayed = await delayedSettings(page, (payload) => ({
    ...payload,
    result: {
      ...payload.result,
      settings: { ...payload.result.settings, bankBsb: "000000", emailSignature: "STALE SERVER RESPONSE" },
    },
    state: {
      ...payload.state,
      settings: { ...payload.state.settings, bankBsb: "000000", emailSignature: "STALE SERVER RESPONSE" },
    },
  }));

  try {
    const signature = preferenceInput(page, "emailSignature");
    await signature.evaluate((element) => { window.__elsetPreferenceTextarea = element; });

    const firstSelectionStart = initial.emailSignature.indexOf("PTY");
    await selectRange(signature, firstSelectionStart, firstSelectionStart + 3);
    await signature.pressSequentially("TEST");
    const firstSignature = initial.emailSignature.replace("PTY", "TEST");
    await expect(signature).toHaveValue(firstSignature);
    expect(await selection(signature)).toEqual({ active: true, start: firstSelectionStart + 4, end: firstSelectionStart + 4 });
    expect(await signature.evaluate((element) => element === window.__elsetPreferenceTextarea)).toBe(true);
    expect(writes).toHaveLength(0);

    await expect.poll(() => delayed.requests.length).toBe(1);
    expect(delayed.requests[0].patch).toEqual({ emailSignature: firstSignature });

    const phoneSelectionStart = firstSignature.indexOf("266");
    await selectRange(signature, phoneSelectionStart, phoneSelectionStart + 3);
    await signature.pressSequentially("777");
    const secondSignature = firstSignature.replace("266", "777");
    await expect(signature).toHaveValue(secondSignature);

    const bsb = preferenceInput(page, "bankBsb");
    await selectRange(bsb, 3);
    await bsb.pressSequentially("12");
    await expect(bsb).toHaveValue("03312505");
    expect(await selection(bsb)).toEqual({ active: true, start: 5, end: 5 });

    const accountNumber = preferenceInput(page, "bankAccountNumber");
    await selectRange(accountNumber, 4);
    await accountNumber.pressSequentially("00");
    await expect(accountNumber).toHaveValue("12340056789");

    const accountName = preferenceInput(page, "bankAccountName");
    await selectRange(accountName, 5);
    await accountName.pressSequentially(" TEST");
    await expect(accountName).toHaveValue("ELSET TEST Account");

    const sender = preferenceInput(page, "defaultSenderEmail");
    await selectRange(sender, 0, 5);
    await sender.pressSequentially("office");
    await expect(sender).toHaveValue("office@elset.com.au");

    await expect(signature).toHaveValue(secondSignature);
    const emailInsertionStart = secondSignature.indexOf("@elset.com.au");
    await selectRange(signature, emailInsertionStart);
    await signature.pressSequentially("+test");
    const finalSignature = `${secondSignature.slice(0, emailInsertionStart)}+test${secondSignature.slice(emailInsertionStart)}`;
    const finalCaret = emailInsertionStart + 5;
    await expect(signature).toHaveValue(finalSignature);
    expect(await selection(signature)).toEqual({ active: true, start: finalCaret, end: finalCaret });

    await page.waitForTimeout(2_100);
    expect(delayed.requests).toHaveLength(1);
    expect(delayed.maximum()).toBe(1);
    await expect(signature).toHaveValue(finalSignature);
    expect(await selection(signature)).toEqual({ active: true, start: finalCaret, end: finalCaret });

    delayed.requests[0].release();
    await expect.poll(() => delayed.requests.length).toBe(2);
    await expect(signature).toHaveValue(finalSignature);
    expect(await signature.evaluate((element) => element === window.__elsetPreferenceTextarea)).toBe(true);
    expect(await selection(signature)).toEqual({ active: true, start: finalCaret, end: finalCaret });
    expect(delayed.requests[1].patch).toMatchObject({
      bankAccountName: "ELSET TEST Account",
      bankAccountNumber: "12340056789",
      bankBsb: "03312505",
      defaultSenderEmail: "office@elset.com.au",
      emailSignature: finalSignature,
    });
    delayed.requests[1].release();
    await expect(preferenceStatus(page)).toHaveText("Saved");
    expect(delayed.maximum()).toBe(1);
    expect(writes).toHaveLength(2);
    expect(writes.every((write) => write.path === "/api/settings" && write.method === "PATCH")).toBe(true);
    expect(writes.some((write) => write.path === "/api/app-state")).toBe(false);
    expect(dialogs).toEqual([]);

    await page.reload();
    await navigate(page, "Settings", 1440);
    await page.locator(".floating-page-toolbar").getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(preferenceInput(page, "emailSignature")).toHaveValue(finalSignature);
    await expect(preferenceInput(page, "bankBsb")).toHaveValue("03312505");
    await expect(preferenceInput(page, "bankAccountNumber")).toHaveValue("12340056789");
    await expect(preferenceInput(page, "bankAccountName")).toHaveValue("ELSET TEST Account");
    await expect(preferenceInput(page, "defaultSenderEmail")).toHaveValue("office@elset.com.au");
  } finally {
    for (const request of delayed.requests) request.release();
    await context.close();
    restoreOriginalPreferences();
  }
});

test("twenty rapid preference characters update immediately and produce one targeted request", async ({ browser }) => {
  writeWorkspaceSettings({ bankAccountName: "ELSET" });
  const { context, page, writes, dialogs } = await openSettings(browser, 1440, 900, "Preferences");
  try {
    const accountName = preferenceInput(page, "bankAccountName");
    const typed = "abcdefghijklmnopqrst";
    await selectRange(accountName, 5);
    await accountName.pressSequentially(typed);
    await expect(accountName).toHaveValue(`ELSET${typed}`);
    expect(await selection(accountName)).toEqual({ active: true, start: 25, end: 25 });
    expect(writes).toHaveLength(0);
    await expect(preferenceStatus(page)).toHaveText("Saved");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      path: "/api/settings",
      method: "PATCH",
      body: { settings: { bankAccountName: `ELSET${typed}` } },
    });
    expect(dialogs).toEqual([]);
  } finally {
    await context.close();
    restoreOriginalPreferences();
  }
});

for (const latency of [500, 1_000, 2_000]) {
  test(`preference typing and caret stay responsive through ${latency}ms settings latency`, async ({ browser }) => {
    writeWorkspaceSettings({ bankBsb: "033505" });
    const { context, page, writes } = await openSettings(browser, 1440, 900, "Preferences");
    let activeRequests = 0;
    let maximumRequests = 0;
    await page.route("**/api/settings", async (route) => {
      activeRequests++;
      maximumRequests = Math.max(maximumRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, latency));
      const response = await route.fetch();
      await route.fulfill({ response });
      activeRequests--;
    });
    try {
      const bsb = preferenceInput(page, "bankBsb");
      await bsb.evaluate((element) => { window.__elsetPreferenceBsb = element; });
      await selectRange(bsb, 3);
      await bsb.pressSequentially("1");
      await expect(bsb).toHaveValue("0331505");
      expect(await selection(bsb)).toEqual({ active: true, start: 4, end: 4 });
      await expect.poll(() => writes.length).toBe(1);
      await bsb.pressSequentially("2");
      await expect(bsb).toHaveValue("03312505");
      expect(await selection(bsb)).toEqual({ active: true, start: 5, end: 5 });
      await expect(preferenceStatus(page)).toHaveText("Saved", { timeout: latency * 2 + 5_000 });
      await expect(bsb).toHaveValue("03312505");
      expect(await bsb.evaluate((element) => element === window.__elsetPreferenceBsb)).toBe(true);
      expect(maximumRequests).toBe(1);
      expect(writes).toHaveLength(2);
    } finally {
      await context.close();
      restoreOriginalPreferences();
    }
  });
}

test("a failed preference save keeps the draft, focus, and selection until retry succeeds", async ({ browser }) => {
  writeWorkspaceSettings({ bankBsb: "033505" });
  const { context, page, writes, dialogs } = await openSettings(browser, 1440, 900, "Preferences");
  let attempts = 0;
  await page.route("**/api/settings", async (route) => {
    if (++attempts === 1) {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "No healthy instances found" });
    } else {
      await route.continue();
    }
  });
  try {
    const bsb = preferenceInput(page, "bankBsb");
    await bsb.evaluate((element) => { window.__elsetPreferenceBsb = element; });
    await selectRange(bsb, 3);
    await bsb.pressSequentially("12");
    await expect(bsb).toHaveValue("03312505");
    await expect(preferenceStatus(page)).toContainText("Preference changes could not be saved.");
    await expect(bsb).toHaveValue("03312505");
    expect(await bsb.evaluate((element) => element === window.__elsetPreferenceBsb)).toBe(true);
    expect(await selection(bsb)).toEqual({ active: true, start: 5, end: 5 });
    expect(attempts).toBe(1);
    expect(dialogs).toEqual([]);
    await preferenceStatus(page).getByRole("button", { name: "Retry", exact: true }).click();
    await expect(preferenceStatus(page)).toHaveText("Saved");
    expect(attempts).toBe(2);
    expect(writes).toHaveLength(2);
    expect(readWorkspaceState().settings.bankBsb).toBe("03312505");
  } finally {
    await context.close();
    restoreOriginalPreferences();
  }
});

test("ten rapid selections update immediately, coalesce, and stay latest through delayed acknowledgements", async ({ browser }) => {
  const { context, page, writes, dialogs } = await openSettings(browser);
  const companyName = readWorkspaceState().settings.companyName;
  const delayed = await delayedPersonalSettings(page, (payload) => ({ ...payload, preferences: { ...payload.preferences, actionColor: "#000000" }, state: { jobs: [], settings: { companyName: "Stale response company" } } }));
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
    expect(readPersonalSettings().actionColor).toBe("#225509");
    await page.locator(".floating-page-toolbar").getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(page.getByPlaceholder("Elset", { exact: true })).toHaveValue(companyName);
    await page.reload();
    await assertPrimary(page, "#225509");
    assertTargeted(writes, 2);
    expect(dialogs).toEqual([]);
  } finally { await context.close(); }
});

for (const failure of [
  { status: 503, body: "No healthy instances found", contentType: "text/plain", message: "Personal preferences could not be saved or loaded." },
  { status: 409, body: JSON.stringify({ error: "Workspace settings conflict." }), contentType: "application/json", message: "Workspace settings conflict." },
]) {
  test(`${failure.status} save failure keeps the theme, shows one inline error, and retries the latest patch`, async ({ browser }) => {
    const { context, page, writes, dialogs } = await openSettings(browser);
    let attempts = 0;
    await page.route("**/api/user-preferences", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
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
      expect(readPersonalSettings().actionColor).toBe(defaultUi.actionColor);
      await status(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshotDir, `theme-error-${failure.status}.png`) });
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(status(page)).toHaveText("Saved");
      expect(readPersonalSettings().actionColor).toBe("#445509");
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
    const delayed = await delayedPersonalSettings(page);
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
      await expect.poll(() => readPersonalSettings().actionColor).toBe("#778899");
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
    expect(writes[0].body).toEqual({ actionColor: "#AABBCC" });
    await hex.pressSequentially("def");
    await expect(hex).toHaveValue("#abcdef");
    await assertPrimary(page, "#ABCDEF");
    await hex.blur();
    await expect(hex).toHaveValue("#ABCDEF");
    await expect(status(page)).toHaveText("Saved");
    assertTargeted(writes, 2);
    expect(writes[1].body).toEqual({ actionColor: "#ABCDEF" });
    await hex.fill("not a colour");
    await hex.blur();
    await expect(hex).toHaveValue("#ABCDEF");
    expect(readPersonalSettings().actionColor).toBe("#ABCDEF");
  } finally { await context.close(); }
});

test("presets and reset share the colour queue and only change UI settings", async ({ browser }) => {
  const { context, page, writes } = await openSettings(browser);
  const delayed = await delayedPersonalSettings(page);
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
    const final = readPersonalSettings();
    expect(Object.fromEntries(uiSettingKeys.map((key) => [key, final[key]]))).toEqual(defaultUi);
  } finally { await context.close(); }
});

test("existing auth accounts migrate additively without changing Better Auth tables or workspace records", async () => {
  const db = openUserPreferencesDb({ env: { ELSET_DATA_DIR: tempDataDir } });
  try {
    for (const table of migrationEvidence.tables) expect(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table.name).sql).toBe(table.sql);
    expect(db.prepare('SELECT id, username FROM "user" ORDER BY id').all()).toEqual(migrationEvidence.users);
    expect(db.prepare("SELECT count(*) AS n FROM elset_account_schema_migrations WHERE version=1").get().n).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM user_ui_preferences").get().n).toBe(0);
  } finally { db.close(); }
});

test("two simultaneous accounts keep separate appearance across a fresh browser, refresh and server restart", async ({ browser }) => {
  const a = await openSettings(browser);
  const b = await openSettings(browser, 1440, 900, "UI Settings", "mobileoffice");
  let device;
  const original = readWorkspaceState();
  try {
    await colourInput(a.page).fill("#ff8800");
    await expect(status(a.page)).toHaveText("Saved");
    await assertPrimary(b.page, defaultUi.actionColor);
    await colourInput(b.page).fill("#0077ff");
    await expect(status(b.page)).toHaveText("Saved");
    await assertPrimary(a.page, "#FF8800");
    await a.page.getByRole("combobox", { name: "Content density", exact: true }).click();
    await a.page.getByRole("option", { name: "Compact", exact: true }).click();
    await expect(status(a.page)).toHaveText("Saved");
    device = await openSettings(browser);
    await assertPrimary(device.page, "#FF8800");
    await expect(device.page.getByRole("combobox", { name: "Content density", exact: true })).toHaveText("Compact");
    await expect(b.page.getByRole("combobox", { name: "Content density", exact: true })).toHaveText("Comfortable");
    await Promise.all([a.page.reload(), b.page.reload()]);
    await assertPrimary(a.page, "#FF8800");
    await assertPrimary(b.page, "#0077FF");
    const port = Number(new URL(baseUrl).port);
    await stopServer();
    await startServer(port);
    await Promise.all([a.page.reload(), b.page.reload()]);
    await assertPrimary(a.page, "#FF8800");
    await assertPrimary(b.page, "#0077FF");
    expect(readWorkspaceState()).toEqual(original);
    await a.page.screenshot({ path: path.join(screenshotDir, "personal-user-a-orange.png") });
    await b.page.screenshot({ path: path.join(screenshotDir, "personal-user-b-blue.png") });

    // Company settings still travel through the existing shared API and UI.
    await navigate(a.page, "Settings", 1440);
    await a.page.locator(".floating-page-toolbar").getByRole("button", { name: "Preferences", exact: true }).click();
    await preferenceInput(a.page, "companyName").fill("Shared Company Regression");
    await expect(preferenceStatus(a.page)).toHaveText("Saved");
    await b.page.reload();
    await navigate(b.page, "Settings", 1440);
    await b.page.locator(".floating-page-toolbar").getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(preferenceInput(b.page, "companyName")).toHaveValue("Shared Company Regression");
    await assertPrimary(b.page, "#0077FF");
  } finally {
    await Promise.all([a.context.close(), b.context.close(), device?.context.close()]);
    restoreOriginalPreferences();
  }
});

test("sign out resets appearance before another account loads and pending choices never leak", async ({ browser }) => {
  const b = await openSettings(browser, 1440, 900, "UI Settings", "mobileoffice");
  await colourInput(b.page).fill("#0077ff");
  await expect(status(b.page)).toHaveText("Saved");
  await b.context.close();
  const a = await openSettings(browser);
  let release;
  try {
    await colourInput(a.page).fill("#ff8800");
    await expect(status(a.page)).toHaveText("Saved");
    await setColours(a.page, ["#AA5577"]);
    await a.page.getByRole("button", { name: "Sign Out", exact: true }).click();
    await expect(a.page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await assertPrimary(a.page, defaultUi.actionColor);
    const gate = new Promise((resolve) => { release = resolve; });
    let loadingB = false;
    await a.page.route("**/api/user-preferences", async (route) => {
      if (route.request().method() === "GET") { loadingB = true; await gate; }
      await route.continue();
    });
    await a.page.getByPlaceholder("Enter your username").fill("mobileoffice");
    await a.page.getByPlaceholder("Enter your password").fill(accountPassword);
    await a.page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect.poll(() => loadingB).toBe(true);
    await assertPrimary(a.page, defaultUi.actionColor);
    release();
    await assertPrimary(a.page, "#0077FF");
    await a.page.waitForTimeout(600);
    expect(readPersonalSettings("mobileoffice").actionColor).toBe("#0077FF");
  } finally { release?.(); await a.context.close(); }
});

test("Customer, Site and Service Board display choices follow only their account", async ({ browser }) => {
  const a = await openSettings(browser);
  let b;
  try {
    await navigate(a.page, "Customers", 1440);
    await a.page.getByRole("group", { name: "Customer view", exact: true }).getByRole("button", { name: "Grid view", exact: true }).click();
    await navigate(a.page, "Sites", 1440);
    await a.page.getByRole("group", { name: "Site view", exact: true }).getByRole("button", { name: "Grid view", exact: true }).click();
    await navigate(a.page, "Service Board", 1440);
    await a.page.getByRole("button", { name: "To Do Grid view", exact: true }).click();
    await a.page.getByRole("button", { name: "In Progress Compact view", exact: true }).click();
    await a.page.getByRole("combobox", { name: "To Do sort order", exact: true }).click();
    await a.page.getByRole("option", { name: "Oldest", exact: true }).click();
    await a.page.getByRole("button", { name: "Hide Completed", exact: true }).click();
    await a.page.getByText("Show tag info", { exact: true }).locator("..").getByRole("checkbox").check();
    await expect.poll(() => readPersonalSettings()).toMatchObject({ customerView: "grid", siteView: "grid", boardToDoView: "grid", boardInProgressView: "compact", boardToDoSort: "oldest", boardHiddenColumns: ["Completed"], boardShowTagLabels: true });
    await a.page.reload();
    await expect(a.page.getByRole("button", { name: "To Do Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(a.page.locator('[data-service-board-status="Completed"]')).toHaveCount(0);
    await navigate(a.page, "Customers", 1440);
    await expect(a.page.getByRole("group", { name: "Customer view", exact: true }).getByRole("button", { name: "Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
    await navigate(a.page, "Sites", 1440);
    await expect(a.page.getByRole("group", { name: "Site view", exact: true }).getByRole("button", { name: "Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
    b = await openSettings(browser, 1440, 900, "UI Settings", "mobileoffice");
    await navigate(b.page, "Service Board", 1440);
    await expect(b.page.getByRole("button", { name: "To Do List view", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(b.page.locator('[data-service-board-status="Completed"]')).toBeVisible();
    expect(readPersonalSettings("mobileoffice").customerView).toBe("list");
  } finally { await a.context.close(); await b?.context.close(); }
});

test("twenty rapid personal selections stay responsive, use one narrow write and leave health and workspace intact", async ({ browser }) => {
  const a = await openSettings(browser);
  const before = readWorkspaceState();
  try {
    await setColours(a.page, Array.from({ length: 20 }, (_, i) => `#AA00${i.toString(16).padStart(2, "0")}`));
    await assertPrimary(a.page, "#AA0013");
    const started = Date.now();
    const health = await a.page.request.get(baseUrl + "/api/health");
    expect(health.status()).toBe(200);
    const healthMs = Date.now() - started;
    expect(healthMs).toBeLessThan(2000);
    await expect(status(a.page)).toHaveText("Saved");
    assertTargeted(a.writes, 1);
    expect(a.writes[0].body).toEqual({ actionColor: "#AA0013" });
    expect(readPersonalSettings().actionColor).toBe("#AA0013");
    expect(readWorkspaceState()).toEqual(before);
    const id = (await (await a.page.request.get(baseUrl + "/api/auth/me")).json()).user.id;
    const db = openUserPreferencesDb({ env: { ELSET_DATA_DIR: tempDataDir } });
    try { expect(db.prepare("SELECT count(*) AS n FROM user_ui_preferences WHERE user_id=?").get(id).n).toBe(1); } finally { db.close(); }
    fs.writeFileSync(path.join(screenshotDir, "personal-stress-results.json"), JSON.stringify({ clicks: 20, writes: a.writes.length, healthMs, finalColour: readPersonalSettings().actionColor }, null, 2));
  } finally { await a.context.close(); }
});

test("real sessions reject unauthenticated and spoofed preference access; technicians can change only personal UI", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const tech = await openSettings(browser, 390, 844, "UI Settings", "mobiletech");
  try {
    expect((await anonymous.request.get(baseUrl + "/api/user-preferences")).status()).toBe(401);
    expect((await anonymous.request.patch(baseUrl + "/api/user-preferences", { data: { actionColor: "#fff" } })).status()).toBe(401);
    expect((await tech.page.request.patch(baseUrl + "/api/user-preferences", { data: { userId: "mobileadmin", actionColor: "#fff" } })).status()).toBe(400);
    expect((await tech.page.request.get(baseUrl + "/api/user-preferences?userId=mobileadmin")).status()).toBe(400);
    await expect(tech.page.locator("[data-settings-navigation]").getByRole("button")).toHaveCount(1);
    await expect(tech.page.getByText("Company Details", { exact: true })).toHaveCount(0);
    await colourInput(tech.page).fill("#336699");
    await expect(status(tech.page)).toHaveText("Saved");
    expect(readPersonalSettings("mobiletech").actionColor).toBe("#336699");
    expect(readPersonalSettings().actionColor).toBe(defaultUi.actionColor);
    expect((await tech.page.request.patch(baseUrl + "/api/settings", { data: { settings: { companyName: "Forbidden" } } })).status()).toBe(403);
    await tech.page.screenshot({ path: path.join(screenshotDir, "personal-technician-mobile.png") });
  } finally { await anonymous.close(); await tech.context.close(); }
});

test("a preference load failure uses the legacy fallback and can retry without losing the account", async ({ browser }) => {
  const a = await openSettings(browser);
  try {
    await colourInput(a.page).fill("#cc5500");
    await expect(status(a.page)).toHaveText("Saved");
    let fail = true;
    await a.page.route("**/api/user-preferences", (route) => fail && route.request().method() === "GET"
      ? route.fulfill({ status: 503, json: { error: "Synthetic preference load failure" } }) : route.continue());
    await a.page.reload();
    await expect(a.page.getByRole("alert")).toContainText("Synthetic preference load failure");
    await assertPrimary(a.page, defaultUi.actionColor);
    fail = false;
    await a.page.getByRole("button", { name: "Retry personal preferences", exact: true }).click();
    await assertPrimary(a.page, "#CC5500");
    await expect(a.page.getByRole("alert")).toHaveCount(0);
  } finally { await a.context.close(); }
});
