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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");
const screenshotDir = path.join(repoRoot, "test-results", "mobile-service-board");
const screenshotNames = [
  "mobile-navigation-open-390x844.png",
  "mobile-to-do-390x844.png",
  "mobile-in-progress-390x844.png",
  "mobile-filters-375x667.png",
  "mobile-job-details-412x915.png",
  "desktop-board-1440x900.png",
];
const accountPassword = "E2E-mobile-pass-123";
const plannedJobId = "mobile-job-progress";
const plannedJobNumber = 1003;

let tempDataDir = "";
let baseUrl = "";
let serverProcess = null;
let serverOutput = "";

function dateKeyInSydney(daysFromToday = 0) {
  const date = new Date(Date.now() + daysFromToday * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readAugmentedFixture() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const sourceJob = fixture.jobs[0];
  const tomorrowDate = dateKeyInSydney(1);
  const baseJob = {
    ...sourceJob,
    quote: null,
    invoice: null,
    notes: [],
    photos: [],
    externalRefs: {},
    assignedTechnicianId: "",
    assignedTechnicianName: "",
    maintenancePlanId: "",
    maintenancePlanName: "",
    maintenanceDueDate: "",
  };

  fixture.jobs = [
    sourceJob,
    {
      ...baseJob,
      id: "mobile-job-high-priority",
      jobNumber: 1002,
      title: "Urgent safety edge repair",
      description: "A deliberately long secondary description that must stay collapsed on a phone-sized card.",
      urgency: "High",
      status: "To Do",
      scheduledDate: "2026-09-03",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      quote: {
        type: "quote",
        issueDate: "2026-02-01",
        notes: "Synthetic mobile quote.",
        items: [{ id: "mobile-quote-line", description: "Safety edge", qty: 1, rate: 181.5 }],
        sentHistory: [{ id: "mobile-quote-sent", sentAt: "2026-02-01T01:00:00.000Z" }],
      },
    },
    {
      ...baseJob,
      id: plannedJobId,
      jobNumber: plannedJobNumber,
      title: "Mobile In Progress Job",
      description: "Service the swing gate and verify all safety inputs.",
      urgency: "High",
      status: "In Progress",
      scheduledDate: tomorrowDate,
      serviceBoardTomorrowDate: tomorrowDate,
      serviceBoardTomorrowOrder: 0,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
    {
      ...baseJob,
      id: "mobile-job-completed",
      jobNumber: 1004,
      title: "Completed mobile regression job",
      description: "Synthetic completed record.",
      urgency: "Medium",
      status: "Completed",
      scheduledDate: "2026-01-30",
      createdAt: "2026-01-30T00:00:00.000Z",
      updatedAt: "2026-01-30T04:00:00.000Z",
    },
  ];

  return fixture;
}

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
      throw new Error(`Mobile test server exited before it was ready.\n${serverOutput}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for the mobile test server.\n${serverOutput}`);
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

async function seedWorkspaceDatabase() {
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try {
    importWorkspaceJsonData(db, readAugmentedFixture());
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
    throw new Error(`Failed to seed mobile test logins.\n${result.stdout || ""}${result.stderr || ""}`);
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

function mobileContextOptions(width, height) {
  return {
    viewport: { width, height },
    hasTouch: true,
    isMobile: width < 768,
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  };
}

function desktopContextOptions(width, height) {
  return {
    viewport: { width, height },
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  };
}

async function loginAs(page, username, mobile = true) {
  await page.goto(baseUrl);
  await page.getByPlaceholder("Enter your username").fill(username);
  await page.getByPlaceholder("Enter your password").fill(accountPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  if (mobile) {
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "Customers", exact: true })).toBeVisible();
  }
}

function trackBroadWorkspacePuts(page) {
  const requests = [];
  const listener = (request) => {
    const url = new URL(request.url());
    if (request.method() === "PUT" && url.origin === new URL(baseUrl).origin && url.pathname === "/api/app-state") {
      requests.push(request.url());
    }
  };
  page.on("request", listener);
  return {
    requests,
    stop: () => page.off("request", listener),
  };
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth + 1);
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth + 1);
}

async function waitForJobStatus(jobId, status) {
  await expect.poll(() => readWorkspaceState().jobs.find((job) => job.id === jobId)?.status).toBe(status);
}

async function dragJobToStatus(page, source, jobId, status) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dataTransfer.evaluate((transfer, id) => transfer.setData("jobId", id), jobId);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/jobs/${jobId}/status`
  );

  try {
    await source.dispatchEvent("dragstart", { dataTransfer });
    const target = page.locator(`[data-service-board-status="${status}"]`);
    await target.dispatchEvent("dragover", { dataTransfer });
    await target.dispatchEvent("drop", { dataTransfer });
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
  } finally {
    await dataTransfer.dispose();
  }
}

async function capture(page, testInfo, filename, label) {
  const screenshotPath = path.join(screenshotDir, filename);
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await testInfo.attach(label, { path: screenshotPath, contentType: "image/png" });
}

test.beforeAll(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-mobile-playwright-"));
  fs.mkdirSync(screenshotDir, { recursive: true });
  for (const filename of screenshotNames) {
    fs.rmSync(path.join(screenshotDir, filename), { force: true });
  }
  await seedWorkspaceDatabase();
  await seedLoginAccounts();
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  if (tempDataDir) fs.rmSync(tempDataDir, { recursive: true, force: true });
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && serverOutput) {
    await testInfo.attach("server-output", { body: serverOutput, contentType: "text/plain" });
  }
});

test("mobile navigation and one-status Service Board support the core workflow", async ({ browser }, testInfo) => {
  const context = await browser.newContext(mobileContextOptions(390, 844));
  const page = await context.newPage();
  const broadPuts = trackBroadWorkspacePuts(page);
  try {
    await loginAs(page, "mobileadmin");

    const hamburger = page.getByRole("button", { name: "Open navigation" });
    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "Application navigation" });
    const navigation = drawer.getByRole("navigation", { name: "Application" });
    await expect(drawer).toBeVisible();
    for (const label of [
      "Service Board", "Customers", "Sites", "Map", "Calendar", "Job History", "Invoices",
      "Maintenance", "Staff", "Parts Inventory", "Statistics", "Settings", "Recycle Bin",
    ]) {
      await expect(navigation.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(navigation.getByRole("button", { name: "Service Board", exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.body.hasAttribute("data-scroll-locked") || getComputedStyle(document.body).overflow === "hidden")).toBe(true);
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await capture(page, testInfo, "mobile-navigation-open-390x844.png", "mobile navigation open");

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(hamburger).toBeFocused();

    await hamburger.click();
    await navigation.getByRole("button", { name: "Customers", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page.locator(".mobile-workspace-navigation header")).toContainText("Customers");

    await hamburger.click();
    await navigation.getByRole("button", { name: "Service Board", exact: true }).click();
    await expect(page.locator(".mobile-workspace-navigation header")).toContainText("Service Board");

    await hamburger.click();
    const drawerBounds = await drawer.boundingBox();
    const viewportSize = page.viewportSize();
    await page.locator('[data-slot="dialog-overlay"]').click({
      position: {
        x: Math.min(viewportSize.width - 2, Math.ceil(drawerBounds.x + drawerBounds.width + 8)),
        y: Math.floor(viewportSize.height / 2),
      },
    });
    await expect(drawer).toBeHidden();
    await expect(hamburger).toBeFocused();

    const tabs = page.getByRole("tablist", { name: "Board status" });
    await expect(tabs.getByRole("tab", { name: /To Do\s+2/ })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab", { name: /In Progress\s+1/ })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: /Completed\s+1/ })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: /Tomorrow\s+1/ })).toBeVisible();
    await expect(page.locator("[data-service-board-status]")).toHaveCount(1);
    await expect(page.locator('[data-service-board-status="To Do"] .mobile-job-card')).toHaveCount(2);

    const toDoTab = tabs.getByRole("tab", { name: /To Do\s+2/ });
    const inProgressTab = tabs.getByRole("tab", { name: /In Progress\s+1/ });
    await toDoTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(inProgressTab).toBeFocused();
    await expect(inProgressTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(toDoTab).toBeFocused();
    await expect(toDoTab).toHaveAttribute("aria-selected", "true");

    const summaryCard = page.locator('[data-mobile-job-id="demo-job-1001"]');
    await expect(summaryCard).toContainText("Job #1001");
    await expect(summaryCard).toContainText("Arcadia Example Apartments");
    await expect(summaryCard).toContainText("Synthetic gate service");
    await expect(summaryCard).toContainText("10 Example Lane, Sampleton");
    await expect(summaryCard).toContainText("15/01/2026");
    await expect(summaryCard).toContainText("$550.00");
    await expect(summaryCard).toContainText("Medium");
    await expect(page.getByRole("button", { name: /Open Job #1001.*\$550\.00.*Medium urgency/ })).toBeVisible();

    const search = page.getByRole("textbox", { name: "Search jobs" });
    await search.fill("1002");
    await expect(page.locator('[data-service-board-status="To Do"] .mobile-job-card')).toHaveCount(1);
    await expect(page.locator('[data-mobile-job-id="mobile-job-high-priority"]')).toBeVisible();
    await page.getByRole("button", { name: "Clear job search" }).click();
    await expect(page.locator('[data-service-board-status="To Do"] .mobile-job-card')).toHaveCount(2);
    await capture(page, testInfo, "mobile-to-do-390x844.png", "mobile To Do list");

    await tabs.getByRole("tab", { name: /In Progress\s+1/ }).click();
    await expect(page.locator('[data-service-board-status="In Progress"]')).toBeVisible();
    await expect(page.locator('[data-service-board-status="To Do"]')).toHaveCount(0);
    await capture(page, testInfo, "mobile-in-progress-390x844.png", "mobile In Progress list");

    await page.getByRole("button", { name: new RegExp(`Open Job #${plannedJobNumber}`) }).click();
    await expect(page.getByRole("dialog", { name: "Mobile In Progress Job" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tabs.getByRole("tab", { name: /In Progress\s+1/ })).toHaveAttribute("aria-selected", "true");

    await tabs.getByRole("tab", { name: /Tomorrow\s+1/ }).click();
    await expect(page.locator('[data-mobile-board-view="Tomorrow"]')).toContainText("Mobile In Progress Job");
    await expect(page.locator("[data-desktop-tomorrow-tab]")).toHaveCount(0);
    await search.fill("no matching planned job");
    await expect(tabs.getByRole("tab", { name: /Tomorrow\s+1/ })).toBeVisible();
    await expect(page.locator('[data-mobile-board-view="Tomorrow"]')).toContainText("Mobile In Progress Job");
    await page.getByRole("button", { name: "Clear job search" }).click();
    const removeTomorrowResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api/jobs/${plannedJobId}/tomorrow`
    );
    await page.getByRole("button", { name: `Remove Job #${plannedJobNumber} from tomorrow` }).click();
    await removeTomorrowResponse;
    await expect(tabs.getByRole("tab", { name: /Tomorrow\s+0/ })).toBeVisible();

    await tabs.getByRole("tab", { name: /In Progress\s+1/ }).click();
    const addTomorrowResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `/api/jobs/${plannedJobId}/tomorrow`
    );
    await page.getByRole("button", { name: `Add Job #${plannedJobNumber} to tomorrow` }).click();
    await addTomorrowResponse;
    await expect(tabs.getByRole("tab", { name: /Tomorrow\s+1/ })).toBeVisible();

    const moveTrigger = page.getByRole("button", { name: `Move Job #${plannedJobNumber}` });
    await moveTrigger.click();
    const moveSheet = page.getByRole("dialog", { name: `Move Job #${plannedJobNumber}` });
    await expect(moveSheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(moveSheet).toBeHidden();
    await expect(moveTrigger).toBeFocused();
    await moveTrigger.click();
    const moveRequest = page.waitForRequest((request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname === `/api/jobs/${plannedJobId}/status`
    );
    await moveSheet.getByRole("button", { name: "Move to To Do" }).click();
    const request = await moveRequest;
    expect(request.postDataJSON()).toEqual({ status: "To Do" });
    await waitForJobStatus(plannedJobId, "To Do");
    await expect(tabs.getByRole("tab", { name: /To Do\s+3/ })).toHaveAttribute("aria-selected", "true");
    const movedTrigger = page.getByRole("button", { name: `Move Job #${plannedJobNumber}` });
    await expect(movedTrigger).toBeFocused();
    await expect(page.getByRole("status")).toContainText(`Job #${plannedJobNumber} moved to To Do.`);

    await movedTrigger.click();
    await page.getByRole("dialog", { name: `Move Job #${plannedJobNumber}` }).getByRole("button", { name: "Move to In Progress" }).click();
    await waitForJobStatus(plannedJobId, "In Progress");

    await assertNoHorizontalOverflow(page);
    expect(broadPuts.requests).toEqual([]);
  } finally {
    broadPuts.stop();
    await context.close();
  }
});

test("mobile and tablet viewport matrix keeps filters, details, and overflow usable", async ({ browser }, testInfo) => {
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
  ]) {
    const context = await browser.newContext(mobileContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    try {
      if (viewport.width === 375) {
        const devtools = await context.newCDPSession(page);
        await devtools.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: 24, right: 8, bottom: 20, left: 8 },
        });
      }
      await loginAs(page, "mobileadmin");
      await expect(page.locator("[data-service-board-status]")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();

      if (viewport.width === 375) {
        await expect(page.locator(".mobile-workspace-navigation header")).toHaveCSS("padding-top", "24px");
        await expect(page.locator(".mobile-safe-workspace")).toHaveCSS("padding-left", "24px");
        const filterTrigger = page.locator('button[aria-label^="Open board filters"]');
        await filterTrigger.click();
        const filters = page.getByRole("dialog", { name: "Board filters" });
        await expect(filters.locator('[data-slot="dialog-body"]')).toHaveCSS("padding-bottom", "36px");
        await filters.getByLabel("High urgency only").click();
        await capture(page, testInfo, "mobile-filters-375x667.png", "mobile filter sheet");
        await filters.getByRole("button", { name: "Close" }).click();
        await expect(filterTrigger).toBeFocused();
        await expect(page.getByRole("button", { name: /Open board filters, 1 active/ })).toBeVisible();
        await expect(page.locator('[data-service-board-status="To Do"] .mobile-job-card')).toHaveCount(1);
        await expect(page.locator('[data-mobile-job-id="mobile-job-high-priority"]')).toBeVisible();
        await filterTrigger.click();
        await expect(page.getByRole("dialog", { name: "Board filters" }).getByLabel("High urgency only")).toBeChecked();
        await page.getByRole("dialog", { name: "Board filters" }).getByRole("button", { name: "Clear all" }).click();
        await page.getByRole("dialog", { name: "Board filters" }).getByRole("button", { name: "Close" }).click();
        await expect(filterTrigger).toBeFocused();
        await expect(page.locator('[data-service-board-status="To Do"] .mobile-job-card')).toHaveCount(2);
      }

      if (viewport.width === 412) {
        await page.getByRole("button", { name: /Open Job #1001/ }).click();
        await expect(page.getByRole("dialog", { name: "Synthetic gate service" })).toBeVisible();
        await capture(page, testInfo, "mobile-job-details-412x915.png", "mobile job details");
        await page.keyboard.press("Escape");
      }

      if (viewport.width === 768) {
        const hamburger = page.getByRole("button", { name: "Open navigation" });
        await hamburger.click();
        await expect(page.getByRole("dialog", { name: "Application navigation" })).toBeVisible();
        await page.setViewportSize({ width: 1024, height: 768 });
        await expect(page.getByRole("dialog", { name: "Application navigation" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
        await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible();
        await expect.poll(() => page.evaluate(() => ({
          locked: document.body.hasAttribute("data-scroll-locked"),
          overflow: getComputedStyle(document.body).overflow,
        }))).toEqual({ locked: false, overflow: "visible" });
        await page.setViewportSize({ width: 768, height: 1024 });
        await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
        await expect(page.getByRole("dialog", { name: "Application navigation" })).toHaveCount(0);
      }

      await assertNoHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  }
});

test("mobile navigation and actions retain admin, office, and technician permissions", async ({ browser }) => {
  const expectedBusinessItems = 13;
  for (const account of [
    { username: "mobileoffice", canManage: true },
    { username: "mobiletech", canManage: false },
  ]) {
    const context = await browser.newContext(mobileContextOptions(390, 844));
    const page = await context.newPage();
    try {
      await loginAs(page, account.username);
      await page.getByRole("button", { name: "Open navigation" }).click();
      const navigation = page.getByRole("navigation", { name: "Application" });
      await expect(navigation.locator("button")).toHaveCount(account.canManage ? expectedBusinessItems : 1);
      await expect(navigation.getByRole("button", { name: "Service Board", exact: true })).toBeVisible();
      if (account.canManage) {
        await expect(navigation.getByRole("button", { name: "Customers", exact: true })).toBeVisible();
      } else {
        await expect(navigation.getByRole("button", { name: "Customers", exact: true })).toHaveCount(0);
      }
      await page.keyboard.press("Escape");

      if (account.canManage) {
        await expect(page.getByRole("button", { name: "Add job", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /Add Job #1001 to tomorrow/ })).toBeVisible();
      } else {
        await expect(page.getByRole("button", { name: "Add job", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Add Job #1001 to tomorrow/ })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Move Job #1001" })).toBeVisible();

        const moveToProgressResponse = page.waitForResponse((response) =>
          response.request().method() === "PATCH"
            && new URL(response.url()).pathname === "/api/jobs/demo-job-1001/status"
        );
        await page.getByRole("button", { name: "Move Job #1001" }).click();
        await page.getByRole("dialog", { name: "Move Job #1001" }).getByRole("button", { name: "Move to In Progress" }).click();
        expect((await moveToProgressResponse).ok()).toBe(true);
        await waitForJobStatus("demo-job-1001", "In Progress");

        const restoreResponse = page.waitForResponse((response) =>
          response.request().method() === "PATCH"
            && new URL(response.url()).pathname === "/api/jobs/demo-job-1001/status"
        );
        await page.getByRole("button", { name: "Move Job #1001" }).click();
        await page.getByRole("dialog", { name: "Move Job #1001" }).getByRole("button", { name: "Move to To Do" }).click();
        expect((await restoreResponse).ok()).toBe(true);
        await waitForJobStatus("demo-job-1001", "To Do");
      }
    } finally {
      await context.close();
    }
  }
});

test("desktop view retains three columns, drag and drop, controls, and Tomorrow panel", async ({ browser }, testInfo) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext(desktopContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    const broadPuts = trackBroadWorkspacePuts(page);
    try {
      await loginAs(page, "mobileadmin", false);
      await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
      await expect(page.locator("[data-service-board-status]")).toHaveCount(3);
      await expect(page.locator("[data-desktop-tomorrow-tab]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Full Screen" })).toBeVisible();
      await expect(page.getByText("Legend", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "To Do Grid view" }).click();
      await expect(page.getByRole("button", { name: "To Do Grid view" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "To Do List view" }).click();
      await expect(page.getByRole("button", { name: "To Do List view" })).toHaveAttribute("aria-pressed", "true");

      await page.locator("[data-desktop-tomorrow-tab]").click();
      await expect(page.getByRole("button", { name: "Close tomorrow panel" })).toBeVisible();
      await page.getByRole("button", { name: "Close tomorrow panel" }).click();

      if (viewport.width === 1280) {
        await page.getByRole("button", { name: "Full Screen" }).click();
        await expect(page.getByRole("button", { name: "Exit Full Screen" })).toBeVisible();
        await expect(page.locator("[data-service-board-status]")).toHaveCount(3);
        await page.getByRole("button", { name: "Exit Full Screen" }).click();
        await expect(page.getByRole("button", { name: "Full Screen" })).toBeVisible();
      }

      const source = page.locator('[draggable="true"]', { hasText: "Mobile In Progress Job" }).first();
      await expect(source).toHaveAttribute("draggable", "true");
      if (viewport.width === 1280) {
        await dragJobToStatus(page, source, plannedJobId, "To Do");
        await waitForJobStatus(plannedJobId, "To Do");
        const movedSource = page.locator('[draggable="true"]', { hasText: "Mobile In Progress Job" }).first();
        await dragJobToStatus(page, movedSource, plannedJobId, "In Progress");
        await waitForJobStatus(plannedJobId, "In Progress");
      }

      if (viewport.width === 1440) {
        await capture(page, testInfo, "desktop-board-1440x900.png", "desktop board regression");
      }
      await assertNoHorizontalOverflow(page);
      expect(broadPuts.requests).toEqual([]);
    } finally {
      broadPuts.stop();
      await context.close();
    }
  }
});
