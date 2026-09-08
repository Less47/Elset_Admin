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
import { getBuildMetadata } from "../../scripts/build-metadata.mjs";

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
  "service-board-desktop-1280x720.png",
  "service-board-desktop-1440x900.png",
  "service-board-desktop-1920x1080.png",
  "service-board-before-job-open-390x844.png",
  "service-board-after-job-back-390x844.png",
  "create-job-mobile-customer-search-390x844.png",
  "create-job-mobile-selected-customer-390x844.png",
  "create-job-mobile-details-390x844.png",
  "create-job-ipad-820x1180.png",
  "create-job-desktop-1280x720.png",
  "create-job-desktop-1440x900.png",
  "create-job-desktop-1920x1080.png",
  "job-details-mobile-overview-390x844.png",
  "job-details-mobile-documents-390x844.png",
  "job-details-ipad-overview-820x1180.png",
  "job-details-desktop-overview-1280x720.png",
  "job-details-desktop-overview-1440x900.png",
  "job-details-desktop-overview-1920x1080.png",
  "responsive-customers-mobile-390x844.png",
  "responsive-customers-filter-sheet-mobile-390x844.png",
  "responsive-sites-mobile-390x844.png",
  "responsive-job-history-mobile-390x844.png",
  "responsive-job-history-filter-sheet-mobile-390x844.png",
  "responsive-invoices-mobile-390x844.png",
  "responsive-maintenance-mobile-390x844.png",
  "responsive-inventory-mobile-390x844.png",
  "responsive-customers-tablet-820x1180.png",
  "responsive-job-history-tablet-820x1180.png",
  "responsive-customers-desktop-1280x720.png",
  "responsive-sites-desktop-1280x720.png",
  "responsive-job-history-desktop-1440x900.png",
  "standard-controls-customers-1440x900.png",
  "standard-controls-sites-1440x900.png",
  "standard-controls-job-history-1440x900.png",
  "standard-controls-invoices-1440x900.png",
  "standard-controls-customers-1024x768.png",
  "standard-controls-sites-1024x768.png",
  "standard-controls-job-history-1024x768.png",
  "standard-controls-invoices-1024x768.png",
  "standard-controls-customers-820x1180.png",
  "standard-controls-sites-820x1180.png",
  "standard-controls-job-history-820x1180.png",
  "standard-controls-invoices-820x1180.png",
  "standard-controls-customers-390x844.png",
  "standard-controls-sites-390x844.png",
  "standard-controls-job-history-390x844.png",
  "standard-controls-invoices-390x844.png",
  "standard-controls-maintenance-1440x900.png",
  "standard-controls-staff-1440x900.png",
  "standard-controls-parts-inventory-1440x900.png",
  "fullscreen-map-workspace-390x844.png",
  "fullscreen-map-workspace-820x1180.png",
  "fullscreen-map-workspace-1024x768.png",
  "fullscreen-map-workspace-1440x900.png",
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

async function assertDesktopBoardSpacing(page) {
  const toolbar = page.locator("[data-service-board-toolbar]");
  const columns = page.locator("[data-service-board-status]");
  const toolbarBox = await toolbar.boundingBox();
  const columnBoxes = await columns.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top };
  }));

  expect(toolbarBox).not.toBeNull();
  expect(columnBoxes).toHaveLength(3);
  const columnTop = Math.min(...columnBoxes.map((box) => box.top));
  const toolbarBottom = toolbarBox.y + toolbarBox.height;
  expect(columnTop - toolbarBottom).toBeGreaterThanOrEqual(14);
  expect(columnTop - toolbarBottom).toBeLessThanOrEqual(18);
  expect(Math.max(...columnBoxes.map((box) => box.top)) - columnTop).toBeLessThanOrEqual(1);
}

async function assertRecordWorkspaceTop(page, desktop) {
  const expectedHeaderTop = desktop ? 16 : 0;
  await expect.poll(async () => {
    const headerTop = await page.locator(".record-workspace-header").evaluate((header) => header.getBoundingClientRect().top);
    return Math.abs(headerTop - expectedHeaderTop);
  }).toBeLessThanOrEqual(1);
  const metrics = await page.locator(".record-workspace").evaluate((workspace) => {
    const header = workspace.querySelector(".record-workspace-header");
    const content = header?.nextElementSibling;
    const firstContent = content?.firstElementChild;
    const headerRect = header?.getBoundingClientRect();
    const firstContentRect = firstContent?.getBoundingClientRect();
    const headerInner = header?.firstElementChild;
    return {
      headerTop: headerRect?.top,
      headerBottom: headerRect?.bottom,
      firstContentTop: firstContentRect?.top,
      headerPaddingTop: headerInner ? Number.parseFloat(getComputedStyle(headerInner).paddingTop) : 0,
    };
  });

  expect(metrics.headerTop).toBeGreaterThanOrEqual(expectedHeaderTop - 1);
  expect(metrics.headerTop).toBeLessThanOrEqual(expectedHeaderTop + 1);
  if (desktop) {
    expect(metrics.firstContentTop - metrics.headerBottom).toBeGreaterThanOrEqual(15);
    expect(metrics.firstContentTop - metrics.headerBottom).toBeLessThanOrEqual(17);
  }
  return metrics;
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
  await page.waitForTimeout(350);
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await testInfo.attach(label, { path: screenshotPath, contentType: "image/png" });
}

async function chooseSelectOption(page, label, option) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function navigateToWorkspaceSection(page, label, width) {
  if (width < 1024) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    const navigation = page.getByRole("dialog", { name: "Application navigation" }).getByRole("navigation", { name: "Application" });
    await navigation.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Application navigation" })).toHaveCount(0);
    return;
  }

  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: label, exact: true }).click();
}

async function mockMapServices(page) {
  await page.route("**/__map-test-tiles/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
        <rect width="256" height="256" fill="#dcecf0"/>
        <path d="M-20 74 C52 30 126 128 276 62 M-14 212 C76 154 174 220 278 142" fill="none" stroke="#f8fafc" stroke-width="18"/>
        <path d="M82 -20 C112 62 78 140 148 276 M222 -18 C184 62 232 132 192 274" fill="none" stroke="#c3d9de" stroke-width="5"/>
        <path d="M-20 74 C52 30 126 128 276 62 M-14 212 C76 154 174 220 278 142" fill="none" stroke="#afc9cf" stroke-width="2"/>
        <circle cx="196" cy="42" r="28" fill="#c8e0cf"/>
      </svg>`,
    });
  });
  await page.route("**/api/map/config", async (route) => {
    const tileUrl = `${baseUrl}/__map-test-tiles/{z}/{x}/{y}.svg`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        tiles: { url: tileUrl, retinaUrl: tileUrl, attribution: "ELSET test map", maxZoom: 20 },
      }),
    });
  });
  await page.route("**/api/map/geocode", async (route) => {
    const addresses = route.request().postDataJSON()?.addresses || [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        results: addresses.map((address, index) => ({
          address,
          location: { lat: -37.8136 + index * 0.012, lon: 144.9631 + index * 0.012 },
        })),
      }),
    });
  });
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

test("build indicator identifies desktop and mobile assets without obstructing navigation", async ({ browser }, testInfo) => {
  const metadata = getBuildMetadata();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720, compact: true },
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 820, height: 1180 },
  ]) {
    const mobile = viewport.width < 1024;
    const context = await browser.newContext(mobile
      ? mobileContextOptions(viewport.width, viewport.height)
      : desktopContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    try {
      if (viewport.compact) {
        const fixture = readAugmentedFixture();
        fixture.settings.sidebarWidth = "icon-only";
        await page.route("**/api/app-state", (route) => route.request().method() === "GET"
          ? route.fulfill({ json: { state: fixture, storageMode: "sqlite" } })
          : route.continue());
      }
      if (viewport.width === 375) {
        const devtools = await context.newCDPSession(page);
        await devtools.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: 24, right: 8, bottom: 20, left: 8 },
        });
      }
      await loginAs(page, "mobileadmin", mobile);
      if (mobile) await page.getByRole("button", { name: "Open navigation" }).click();
      const surface = mobile ? page.getByRole("dialog", { name: "Application navigation" }) : page.locator("aside");
      const indicator = surface.locator("[data-build-indicator]");
      await indicator.scrollIntoViewIfNeeded();
      await expect(indicator).toBeInViewport();
      await expect(indicator.getByText("ELSET Admin", { exact: true })).toBeVisible();
      await expect(indicator.getByText(`v${metadata.version}`, { exact: true })).toBeVisible();
      await expect(indicator.getByText(metadata.commit, { exact: true })).toBeVisible();
      expect(await indicator.locator("button, a").count()).toBe(0);
      expect(await indicator.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

      const navigation = surface.getByRole("navigation", { name: "Application" });
      const recycleBin = navigation.getByRole("button", { name: "Recycle Bin", exact: true });
      await recycleBin.scrollIntoViewIfNeeded();
      await expect(recycleBin).toBeInViewport();
      const recycleBox = await recycleBin.boundingBox();
      const indicatorBox = await indicator.boundingBox();
      expect(recycleBox.y + recycleBox.height).toBeLessThanOrEqual(indicatorBox.y);
      await expect(surface.getByRole("button", { name: /Sign out/i })).toBeInViewport();
      if (viewport.width === 375) {
        await expect(indicator.locator("../..")).toHaveCSS("padding-bottom", "32px");
        expect(indicatorBox.y + indicatorBox.height).toBeLessThanOrEqual(viewport.height - 20);
      }
      await capture(page, testInfo, `build-indicator-${viewport.width}x${viewport.height}.png`, "build indicator and navigation");
      await recycleBin.click();
      await expect(page.getByRole("tab", { name: "Deleted Jobs" })).toBeVisible();
      if (mobile) await expect(surface).toBeHidden();
      await navigateToWorkspaceSection(page, "Service Board", viewport.width);
      await assertNoHorizontalOverflow(page);

      if (viewport.width === 390) {
        const trigger = page.getByRole("button", { name: "Open navigation" });
        await trigger.click();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await trigger.click();
        await surface.getByRole("button", { name: "Sign out" }).click();
        await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
      }
    } finally {
      await context.close();
    }
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
    await expect(tabs.getByRole("tab", { name: /Tomorrow/ })).toHaveCount(0);
    const tomorrowButton = page.getByRole("button", { name: "Tomorrow, 1 planned job" });
    await expect(tomorrowButton).toBeVisible();
    const addJobButton = page.getByRole("button", { name: "Add job", exact: true });
    await expect(addJobButton).toBeVisible();
    await expect(addJobButton).toHaveCSS("position", "fixed");
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
    await expect(page).toHaveURL(new RegExp(`/jobs/${plannedJobId}$`));
    await expect(page.getByRole("heading", { name: "Mobile In Progress Job", level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Mobile In Progress Job" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Service Board" }).click();
    await expect(page).toHaveURL(baseUrl + "/");
    await expect(tabs.getByRole("tab", { name: /In Progress\s+1/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: new RegExp(`Open Job #${plannedJobNumber}`) })).toBeFocused();

    await tomorrowButton.click();
    await expect(page.locator('[data-mobile-board-view="Tomorrow"]')).toContainText("Mobile In Progress Job");
    await expect(page.locator("[data-desktop-tomorrow-tab]")).toHaveCount(0);
    await search.fill("no matching planned job");
    await expect(page.getByRole("button", { name: "Tomorrow, 1 planned job" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-mobile-board-view="Tomorrow"]')).toContainText("Mobile In Progress Job");
    await page.getByRole("button", { name: "Clear job search" }).click();
    const removeTomorrowResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api/jobs/${plannedJobId}/tomorrow`
    );
    await page.getByRole("button", { name: `Remove Job #${plannedJobNumber} from tomorrow` }).click();
    await removeTomorrowResponse;
    await expect(page.getByRole("button", { name: "Tomorrow, 0 planned jobs" })).toBeVisible();

    await tabs.getByRole("tab", { name: /In Progress\s+1/ }).click();
    const addTomorrowResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `/api/jobs/${plannedJobId}/tomorrow`
    );
    await page.getByRole("button", { name: `Add Job #${plannedJobNumber} to tomorrow` }).click();
    await addTomorrowResponse;
    await expect(page.getByRole("button", { name: "Tomorrow, 1 planned job" })).toBeVisible();

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
        await expect(page.locator(".mobile-safe-workspace")).toHaveCSS("padding-left", "20px");
        const filterTrigger = page.locator('button[aria-label^="Open board filters"]');
        await filterTrigger.click();
        const filters = page.getByRole("dialog", { name: "Board filters" });
        await expect(filters.locator('[data-slot="dialog-body"]')).toHaveCSS("padding-bottom", "32px");
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
        await expect(page).toHaveURL(/\/jobs\/demo-job-1001$/);
        await expect(page.getByRole("heading", { name: "Synthetic gate service", level: 1 })).toBeVisible();
        await expect(page.getByRole("dialog", { name: "Synthetic gate service" })).toHaveCount(0);
        await capture(page, testInfo, "mobile-job-details-412x915.png", "mobile job details");
        await page.getByRole("button", { name: "Back to Service Board" }).click();
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

test("mobile page controls keep records primary and preserve live filter state", async ({ browser }, testInfo) => {
  const width = 390;
  const context = await browser.newContext(mobileContextOptions(width, 844));
  const page = await context.newPage();
  try {
    await loginAs(page, "mobileadmin");

    await navigateToWorkspaceSection(page, "Customers", width);
    const customerControls = page.locator("[data-responsive-page-controls]");
    await expect(customerControls).toBeVisible();
    await expect(customerControls.getByLabel("Search customers")).toBeVisible();
    await expect(customerControls.getByLabel("Sort customers")).toBeVisible();
    await expect(customerControls.getByRole("button", { name: "List view" })).toBeVisible();
    await expect(customerControls.getByRole("button", { name: "Grid view" })).toBeVisible();
    await expect(customerControls.getByRole("button", { name: "New Customer" })).toBeVisible();
    await expect(page.locator("[data-result-summary]")).toContainText(/customers?$/);
    await capture(page, testInfo, "responsive-customers-mobile-390x844.png", "Customers compact mobile controls");

    const customerFilterButton = customerControls.locator('button[aria-haspopup="dialog"]');
    await customerFilterButton.click();
    let filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters.getByRole("combobox", { name: "Record filter" })).toBeVisible();
    await expect(filters.getByRole("combobox", { name: "Created" })).toBeVisible();
    await expect(filters.getByRole("combobox", { name: "Customer type" })).toBeVisible();
    await chooseSelectOption(page, "Record filter", "With jobs");
    await expect(customerFilterButton).toHaveAttribute("data-active-count", "1");
    await capture(page, testInfo, "responsive-customers-filter-sheet-mobile-390x844.png", "Customers mobile filter sheet");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(customerFilterButton).toBeFocused();
    await expect(customerControls.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
    await customerControls.getByRole("button", { name: "Filters, 1 active" }).click();
    filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters.getByRole("combobox", { name: "Record filter" })).toContainText("With jobs");
    await chooseSelectOption(page, "Customer type", "Homeowner");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-result-summary]")).toHaveText("0 customers");
    await expect(customerFilterButton).toHaveAttribute("data-active-count", "2");
    await customerFilterButton.click();
    filters = page.getByRole("dialog", { name: "Filters" });
    await filters.getByRole("button", { name: "Reset" }).click();
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(customerControls.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
    await expect(page.locator("[data-result-summary]")).toHaveText("1 customer");
    await customerControls.getByLabel("Search customers").fill("synthetic");
    await expect(customerControls.getByRole("button", { name: "Clear search customers" })).toBeVisible();
    await customerControls.getByRole("button", { name: "Clear search customers" }).click();
    await customerControls.getByRole("button", { name: "Grid view" }).click();
    await expect(customerControls.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");

    await navigateToWorkspaceSection(page, "Sites", width);
    const siteControls = page.locator("[data-responsive-page-controls]");
    await expect(siteControls.getByLabel("Search sites")).toBeVisible();
    await expect(siteControls.getByLabel("Sort sites")).toBeVisible();
    await expect(siteControls.getByRole("button", { name: "New Site" })).toBeVisible();
    await capture(page, testInfo, "responsive-sites-mobile-390x844.png", "Sites compact mobile controls");
    await siteControls.getByRole("button", { name: "Filters", exact: true }).click();
    filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters.getByRole("combobox", { name: "Site type" })).toBeVisible();
    await chooseSelectOption(page, "Site type", "Not set");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(siteControls.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
    await expect(page.locator("[data-result-summary]")).toHaveText("0 sites");
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Job History", width);
    const historyControls = page.locator("[data-responsive-page-controls]");
    await expect(historyControls.getByLabel("Search job history")).toBeVisible();
    await expect(historyControls.getByLabel("Sort job history")).toBeVisible();
    await capture(page, testInfo, "responsive-job-history-mobile-390x844.png", "Job History compact mobile controls");
    const historyFilterButton = historyControls.locator('button[aria-haspopup="dialog"]');
    await historyFilterButton.click();
    filters = page.getByRole("dialog", { name: "Filters" });
    for (const label of ["Status", "Urgency", "Documents", "Quick range", "Created from", "Created to"]) {
      await expect(filters.getByLabel(label, { exact: true })).toBeVisible();
    }
    await chooseSelectOption(page, "Status", "Completed");
    await filters.getByLabel("Created from", { exact: true }).fill("2026-01-01");
    await expect(historyFilterButton).toHaveAttribute("data-active-count", "2");
    await capture(page, testInfo, "responsive-job-history-filter-sheet-mobile-390x844.png", "Job History mobile filter sheet");
    await page.keyboard.press("Escape");
    await expect(historyFilterButton).toBeFocused();
    await expect(historyControls.getByRole("button", { name: "Filters, 2 active" })).toBeVisible();
    await expect(page.locator("[data-result-summary]")).toHaveText("1 job · 0 open");
    await historyControls.getByRole("button", { name: "Filters, 2 active" }).click();
    filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters.getByRole("combobox", { name: "Status" })).toContainText("Completed");
    await expect(filters.getByLabel("Created from", { exact: true })).toHaveValue("2026-01-01");
    await filters.getByRole("button", { name: "Reset" }).click();
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-result-summary]")).toHaveText("4 jobs · 3 open");
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Invoices", width);
    const invoiceControls = page.locator("[data-responsive-page-controls]");
    await expect(invoiceControls.getByLabel("Search invoices")).toBeVisible();
    await expect(invoiceControls.getByLabel("Sort invoices")).toBeVisible();
    await capture(page, testInfo, "responsive-invoices-mobile-390x844.png", "Invoices compact mobile controls");
    await invoiceControls.getByRole("button", { name: "Filters", exact: true }).click();
    filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters.getByRole("combobox", { name: "Time range" })).toBeVisible();
    await expect(filters.getByRole("combobox", { name: "Status filter" })).toBeVisible();
    await chooseSelectOption(page, "Status filter", "Overdue");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-result-summary]")).toHaveText("1 invoice · 1 billing record");
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Maintenance", width);
    const maintenanceControls = page.locator("[data-responsive-page-controls]");
    await expect(maintenanceControls.getByLabel("Search maintenance plans")).toBeVisible();
    await expect(maintenanceControls.getByRole("button", { name: "Add Maintenance Plan" })).toBeVisible();
    await capture(page, testInfo, "responsive-maintenance-mobile-390x844.png", "Maintenance compact mobile controls");
    await maintenanceControls.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Filters" }).getByRole("combobox", { name: "Status" })).toBeVisible();
    await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Done" }).click();
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Staff", width);
    const staffControls = page.locator("[data-responsive-page-controls]");
    await expect(staffControls.getByLabel("Search staff")).toBeVisible();
    await expect(staffControls.getByLabel("Sort staff")).toBeVisible();
    await expect(staffControls.getByRole("button", { name: "Add Staff" })).toBeVisible();
    await expect(staffControls.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Parts Inventory", width);
    const inventoryControls = page.locator("[data-responsive-page-controls]");
    await expect(inventoryControls.getByLabel("Search parts inventory")).toBeVisible();
    await expect(inventoryControls.getByLabel("Sort parts inventory")).toBeVisible();
    await expect(inventoryControls.getByRole("button", { name: "Add Part" })).toBeVisible();
    await capture(page, testInfo, "responsive-inventory-mobile-390x844.png", "Parts Inventory compact mobile controls");
    await inventoryControls.getByRole("button", { name: "Filters", exact: true }).click();
    filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters.getByRole("combobox", { name: "Stock filter" })).toBeVisible();
    await chooseSelectOption(page, "Stock filter", "Needs reorder");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-result-summary]")).toHaveText("0 parts");
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Map", width);
    const mapControls = page.locator("[data-responsive-page-controls]");
    await expect(mapControls.getByLabel("Search map jobs")).toBeVisible();
    await mapControls.getByRole("button", { name: "Filters", exact: true }).click();
    filters = page.getByRole("dialog", { name: "Filters" });
    for (const label of ["Jobs", "Site type", "Customer type"]) {
      await expect(filters.getByRole("combobox", { name: label, exact: true })).toBeVisible();
    }
    await filters.getByRole("button", { name: "Done" }).click();

    await navigateToWorkspaceSection(page, "Calendar", width);
    await expect(page.getByRole("button", { name: "Previous" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
    await expect(page.locator("[data-responsive-page-controls]")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Statistics", width);
    await expect(page.locator("[data-responsive-page-controls]")).toHaveCount(0);
    await expect(page.getByText("Job Status Breakdown", { exact: true })).toBeVisible();

    await navigateToWorkspaceSection(page, "Settings", width);
    const settingsToolbar = page.locator(".floating-page-toolbar");
    for (const label of ["Preferences", "Document Templates", "UI Settings", "Data Backup"]) {
      await expect(settingsToolbar.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(settingsToolbar.locator("[data-settings-navigation]")).toHaveCSS("flex-wrap", "nowrap");
    await assertNoHorizontalOverflow(page);

    await navigateToWorkspaceSection(page, "Recycle Bin", width);
    await expect(page.getByRole("tab", { name: "Deleted Jobs" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Deleted Customers" })).toBeVisible();
    await expect(page.locator("[data-responsive-page-controls]")).toHaveCount(0);

    await navigateToWorkspaceSection(page, "Service Board", width);
    await expect(page.locator("[data-service-board-status]")).toHaveCount(1);
    await expect(page.locator('button[aria-label^="Open board filters"]')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});

test("Map search and all secondary filters remain functional without stealing map interaction", async ({ browser }) => {
  const width = 390;
  const context = await browser.newContext(mobileContextOptions(width, 844));
  const page = await context.newPage();
  try {
    await mockMapServices(page);
    await loginAs(page, "mobileadmin");
    await navigateToWorkspaceSection(page, "Map", width);

    const map = page.locator("[data-map-canvas]");
    const controls = page.locator("[data-responsive-page-controls]");
    await expect(map).toHaveAttribute("data-map-ready", "true");
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(4);
    await expect(controls.locator("[data-result-summary]")).toHaveText("4 jobs · 4 mapped");

    const mapStateBeforeControlClick = await map.evaluate((element) => ({
      center: element.dataset.mapCenter,
      zoom: element.dataset.mapZoom,
    }));
    await controls.getByLabel("Search map jobs").click();
    expect(await map.evaluate((element) => ({
      center: element.dataset.mapCenter,
      zoom: element.dataset.mapZoom,
    }))).toEqual(mapStateBeforeControlClick);

    await controls.getByLabel("Search map jobs").fill("Completed mobile regression job");
    await expect(controls.locator("[data-result-summary]")).toHaveText("1 job · 1 mapped");
    await controls.getByRole("button", { name: "Clear search map jobs" }).click();
    await expect(controls.locator("[data-result-summary]")).toHaveText("4 jobs · 4 mapped");

    const openFilters = async () => {
      await controls.getByRole("button", { name: /^Filters/ }).click();
      return page.getByRole("dialog", { name: "Filters" });
    };

    let filters = await openFilters();
    await chooseSelectOption(page, "Jobs", "Completed");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(controls.locator("[data-result-summary]")).toHaveText("1 job · 1 mapped");

    filters = await openFilters();
    await filters.getByRole("button", { name: "Reset" }).click();
    await chooseSelectOption(page, "Site type", "Not set");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(controls.locator("[data-result-summary]")).toHaveText("0 jobs · 0 mapped");

    filters = await openFilters();
    await filters.getByRole("button", { name: "Reset" }).click();
    await chooseSelectOption(page, "Customer type", "Strata");
    await filters.getByRole("button", { name: "Done" }).click();
    await expect(controls.locator("[data-result-summary]")).toHaveText("4 jobs · 4 mapped");

    const zoomBefore = Number(await map.getAttribute("data-map-zoom"));
    await page.locator(".leaflet-control-zoom-in").click();
    await expect.poll(async () => Number(await map.getAttribute("data-map-zoom"))).toBe(zoomBefore + 1);
    await page.locator(".leaflet-marker-icon span").last().click();
    await expect(page.getByRole("button", { name: "Job Details" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});

test("Map fills the application workspace across the responsive viewport matrix", async ({ browser }, testInfo) => {
  const screenshotSizes = new Set(["390x844", "820x1180", "1024x768", "1440x900"]);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    const mobile = viewport.width < 1024;
    const context = await browser.newContext(mobile
      ? mobileContextOptions(viewport.width, viewport.height)
      : desktopContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    try {
      await mockMapServices(page);
      await loginAs(page, "mobileadmin", mobile);
      await navigateToWorkspaceSection(page, "Map", viewport.width);
      if (mobile) {
        await expect.poll(() => page.evaluate(() => document.body.hasAttribute("data-scroll-locked"))).toBe(false);
      }

      const map = page.locator("[data-map-canvas]");
      await expect(map).toHaveAttribute("data-map-ready", "true");
      await expect(page.locator(".leaflet-marker-icon")).toHaveCount(4);

      const metrics = await page.evaluate((desktop) => {
        const mapElement = document.querySelector("[data-map-canvas]");
        const controls = document.querySelector("[data-map-controls]")?.getClientRects().length
          ? document.querySelector("[data-map-controls]")
          : document.querySelector("[data-responsive-page-controls]");
        const zoom = document.querySelector(".leaflet-control-zoom");
        const aside = document.querySelector("aside");
        const mobileHeader = document.querySelector(".mobile-workspace-navigation header");
        const rect = (element) => element ? element.getBoundingClientRect().toJSON() : null;
        return {
          map: rect(mapElement),
          controls: rect(controls),
          zoom: rect(zoom),
          navigationEdge: desktop ? rect(aside)?.right : rect(mobileHeader)?.bottom,
          bodyScrollHeight: document.body.scrollHeight,
          documentScrollHeight: document.documentElement.scrollHeight,
        };
      }, !mobile);

      expect(metrics.map.right).toBeCloseTo(viewport.width, 0);
      expect(metrics.map.bottom).toBeCloseTo(viewport.height, 0);
      if (mobile) {
        expect(metrics.map.left).toBeCloseTo(0, 0);
        expect(metrics.map.top).toBeCloseTo(metrics.navigationEdge, 0);
      } else {
        expect(metrics.map.top).toBeCloseTo(0, 0);
        expect(metrics.map.left).toBeCloseTo(metrics.navigationEdge, 0);
      }
      expect(metrics.controls.left).toBeGreaterThan(metrics.map.left);
      expect(metrics.controls.right).toBeLessThan(metrics.map.right);
      expect(metrics.controls.left + metrics.controls.width / 2).toBeCloseTo(
        metrics.map.left + metrics.map.width / 2,
        0
      );
      expect(metrics.controls.height).toBeLessThan(metrics.map.height * 0.25);
      const controlsOverlapZoom = !(
        metrics.controls.right <= metrics.zoom.left
        || metrics.controls.left >= metrics.zoom.right
        || metrics.controls.bottom <= metrics.zoom.top
        || metrics.controls.top >= metrics.zoom.bottom
      );
      expect(controlsOverlapZoom).toBe(false);
      expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(viewport.height);
      expect(metrics.documentScrollHeight).toBeLessThanOrEqual(viewport.height);
      await assertNoHorizontalOverflow(page);

      const sizeKey = `${viewport.width}x${viewport.height}`;
      if (screenshotSizes.has(sizeKey)) {
        await capture(page, testInfo, `fullscreen-map-workspace-${sizeKey}.png`, `Full workspace Map ${sizeKey}`);
      }
      if (viewport.width === 1440) {
        await chooseSelectOption(page, "Job filter", "Completed");
        await chooseSelectOption(page, "Site type", "Residential");
        await chooseSelectOption(page, "Customer type", "Strata");
        await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
      }
    } finally {
      await context.close();
    }
  }
});

test("responsive page-control matrix keeps tablet hybrid and desktop-rich layouts", async ({ browser }, testInfo) => {
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext(mobileContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    try {
      await loginAs(page, "mobileadmin", viewport.width < 1024);
      await navigateToWorkspaceSection(page, "Customers", viewport.width);

      const compactControls = page.locator("[data-responsive-page-controls]");
      if (viewport.width < 1280) {
        await expect(compactControls).toBeVisible();
        await expect(compactControls.getByLabel("Search customers")).toBeVisible();
        await expect(compactControls.getByRole("button", { name: /^Filters/ })).toBeVisible();
      } else {
        await expect(compactControls).toBeHidden();
        await expect(page.getByText("Record filter", { exact: true })).toBeVisible();
        await expect(page.getByText("Customer type", { exact: true })).toBeVisible();
      }

      if (viewport.width === 820) {
        await capture(page, testInfo, "responsive-customers-tablet-820x1180.png", "Customers tablet controls");
      }
      if (viewport.width === 1280) {
        await capture(page, testInfo, "responsive-customers-desktop-1280x720.png", "Customers desktop controls");
      }
      await assertNoHorizontalOverflow(page);

      await navigateToWorkspaceSection(page, "Job History", viewport.width);
      if (viewport.width < 1280) {
        await expect(page.locator("[data-responsive-page-controls]").getByLabel("Search job history")).toBeVisible();
        await expect(page.getByText("Quick range", { exact: true })).toBeHidden();
      } else {
        await expect(page.getByText("Quick range", { exact: true })).toBeVisible();
        await expect(page.getByText("Created from", { exact: true })).toBeVisible();
      }
      if (viewport.width === 820) {
        await capture(page, testInfo, "responsive-job-history-tablet-820x1180.png", "Job History tablet controls");
      }
      if (viewport.width === 1440) {
        await capture(page, testInfo, "responsive-job-history-desktop-1440x900.png", "Job History desktop controls");
      }
      await assertNoHorizontalOverflow(page);

      if (viewport.width === 1280) {
        await navigateToWorkspaceSection(page, "Sites", viewport.width);
        await expect(page.getByText("Site type", { exact: true })).toBeVisible();
        await capture(page, testInfo, "responsive-sites-desktop-1280x720.png", "Sites desktop controls");
        await assertNoHorizontalOverflow(page);
      }
    } finally {
      await context.close();
    }
  }
});

test("standardized page controls stay aligned, accessible, and overflow-free at required viewports", async ({ browser }, testInfo) => {
  const pageSpecs = [
    {
      section: "Customers",
      slug: "customers",
      compactSearchLabel: "Search customers",
      desktopSearchLabel: "Search customers",
      desktopFilters: ["Sort by", "Record filter", "Created", "Customer type"],
      action: "New Customer",
      hasViewToggle: true,
    },
    {
      section: "Sites",
      slug: "sites",
      compactSearchLabel: "Search sites",
      desktopSearchLabel: "Search sites",
      desktopFilters: ["Sort by", "Site type"],
      action: "New Site",
      hasViewToggle: true,
    },
    {
      section: "Job History",
      slug: "job-history",
      compactSearchLabel: "Search job history",
      desktopSearchLabel: "Search job history",
      desktopFilters: ["Sort by", "Status", "Urgency", "Documents", "Quick range", "Created from", "Created to"],
    },
    {
      section: "Invoices",
      slug: "invoices",
      compactSearchLabel: "Search invoices",
      desktopSearchLabel: "Search billing records",
      desktopFilters: ["Time range", "Status filter", "Sort by"],
    },
  ];

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext(mobileContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    try {
      await loginAs(page, "mobileadmin", viewport.width < 1024);

      for (const pageSpec of pageSpecs) {
        await navigateToWorkspaceSection(page, pageSpec.section, viewport.width);
        const desktopControls = page.locator("[data-desktop-page-controls]");
        const compactControls = page.locator("[data-responsive-page-controls]");

        if (viewport.width >= 1280) {
          await expect(desktopControls).toBeVisible();
          await expect(compactControls).toBeHidden();
          await expect(desktopControls.getByLabel(pageSpec.desktopSearchLabel)).toBeVisible();

          for (const filterLabel of pageSpec.desktopFilters) {
            await expect(desktopControls.getByText(filterLabel, { exact: true })).toBeVisible();
          }

          const metrics = await desktopControls.evaluate((toolbar) => {
            const search = toolbar.querySelector(".page-controls__search");
            const left = toolbar.querySelector(".page-controls__left");
            const right = toolbar.querySelector(".page-controls__right");
            const fields = left ? [...left.children].filter((element) => element.classList.contains("page-controls__field")) : [];
            const visualControls = fields.map((field) => field.querySelector('input, button[role="combobox"], [role="group"]'));
            const fieldControls = [...toolbar.querySelectorAll('.page-controls__field input, .page-controls__field button[role="combobox"]')];
            const rect = (element) => element?.getBoundingClientRect().toJSON() || null;
            const fieldRects = fields.map(rect);
            const visualControlRects = visualControls.map(rect);
            const sameRowGaps = visualControlRects.slice(1).flatMap((current, index) => {
              const previous = visualControlRects[index];
              return previous && current && Math.abs(previous.top - current.top) < 1
                ? [current.left - previous.right]
                : [];
            });
            return {
              toolbar: rect(toolbar),
              search: rect(search),
              leftGap: left ? getComputedStyle(left).gap : null,
              right: rect(right),
              fieldContainment: visualControlRects.map((control, index) => ({
                left: control && fieldRects[index] ? control.left - fieldRects[index].left : null,
                right: control && fieldRects[index] ? fieldRects[index].right - control.right : null,
              })),
              fieldControlHeights: fieldControls.map((element) => element.getBoundingClientRect().height),
              sameRowGaps,
            };
          });

          expect(metrics.search?.width).toBe(320);
          expect(metrics.leftGap).toBe("10px");
          expect(metrics.fieldControlHeights.length).toBeGreaterThan(0);
          for (const height of metrics.fieldControlHeights) expect(height).toBe(40);
          for (const containment of metrics.fieldContainment) {
            expect(containment.left).not.toBeNull();
            expect(containment.right).not.toBeNull();
            expect(containment.left).toBeGreaterThanOrEqual(-0.5);
            expect(containment.right).toBeGreaterThanOrEqual(-0.5);
          }
          for (const gap of metrics.sameRowGaps) {
            expect(gap).toBeGreaterThanOrEqual(9.5);
            expect(gap).toBeLessThanOrEqual(10.5);
          }

          if (pageSpec.action) {
            const action = desktopControls.getByRole("button", { name: pageSpec.action });
            await expect(action).toBeVisible();
            const actionBox = await action.boundingBox();
            expect(metrics.right).not.toBeNull();
            expect(metrics.toolbar.right - metrics.right.right).toBeLessThanOrEqual(17);
            expect(actionBox.height).toBe(40);
          } else {
            expect(metrics.right).toBeNull();
          }

          if (pageSpec.hasViewToggle) {
            const listButton = desktopControls.getByRole("button", { name: "List view" });
            const gridButton = desktopControls.getByRole("button", { name: "Grid view" });
            const viewGroup = desktopControls.getByRole("group", { name: pageSpec.section === "Customers" ? "Customer view" : "Site view" });
            await expect(listButton).toHaveAttribute("title", "List view");
            await expect(gridButton).toHaveAttribute("title", "Grid view");
            await expect(listButton).toHaveAttribute("aria-pressed", "true");
            await expect(viewGroup).toHaveCSS("border-top-width", "0px");
            await expect(viewGroup).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
            for (const button of [listButton, gridButton]) {
              await expect(button).toHaveCSS("border-top-width", "1px");
              const box = await button.boundingBox();
              expect(box.width).toBeGreaterThanOrEqual(36);
              expect(box.width).toBeLessThanOrEqual(40);
              expect(box.height).toBeGreaterThanOrEqual(36);
              expect(box.height).toBeLessThanOrEqual(40);
            }
          }
        } else {
          await expect(compactControls).toBeVisible();
          await expect(desktopControls).toBeHidden();
          await expect(compactControls.getByLabel(pageSpec.compactSearchLabel)).toBeVisible();
          await expect(compactControls.getByRole("button", { name: /^Filters/ })).toBeVisible();
        }

        await assertNoHorizontalOverflow(page);
        const sizeKey = `${viewport.width}x${viewport.height}`;
        await capture(
          page,
          testInfo,
          `standard-controls-${pageSpec.slug}-${sizeKey}.png`,
          `${pageSpec.section} standardized controls ${sizeKey}`
        );

        if (viewport.width === 1440 && pageSpec.section === "Customers") {
          const search = desktopControls.getByLabel("Search customers");
          await search.fill("no matching customer record");
          await expect(page.getByText("No customers found", { exact: true })).toBeVisible();
          await desktopControls.getByRole("button", { name: "Clear search", exact: true }).click();

          const sort = desktopControls.getByRole("combobox", { name: "Sort by" });
          await sort.click();
          await page.getByRole("option", { name: "Alphabetical Z-A" }).click();
          await expect(sort).toContainText("Alphabetical Z-A");

          const recordFilter = desktopControls.getByRole("combobox", { name: "Record filter" });
          await recordFilter.click();
          await page.getByRole("option", { name: "With jobs", exact: true }).click();
          await expect(recordFilter).toContainText("With jobs");

          const gridButton = desktopControls.getByRole("button", { name: "Grid view" });
          const listButton = desktopControls.getByRole("button", { name: "List view" });
          await gridButton.click();
          await expect(gridButton).toHaveAttribute("aria-pressed", "true");
          await listButton.click();
          await expect(listButton).toHaveAttribute("aria-pressed", "true");

          await desktopControls.getByRole("button", { name: "New Customer" }).click();
          await expect(page.getByRole("dialog", { name: "Create Customer" })).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog", { name: "Create Customer" })).toHaveCount(0);
        }
      }

      if (viewport.width === 1440) {
        for (const pageSpec of [
          {
            section: "Maintenance",
            slug: "maintenance",
            searchLabel: "Search maintenance plans",
            filters: ["Filter", "Sort by"],
            action: "Add Maintenance Plan",
          },
          {
            section: "Staff",
            slug: "staff",
            searchLabel: "Search staff",
            filters: ["Sort by"],
            action: "Add Staff",
          },
          {
            section: "Parts Inventory",
            slug: "parts-inventory",
            searchLabel: "Search parts inventory",
            filters: ["Stock filter", "Sort by"],
            action: "Add Part",
          },
        ]) {
          await navigateToWorkspaceSection(page, pageSpec.section, viewport.width);
          const desktopControls = page.locator("[data-desktop-page-controls]");
          await expect(desktopControls).toBeVisible();
          await expect(desktopControls.getByLabel(pageSpec.searchLabel)).toBeVisible();
          for (const filterLabel of pageSpec.filters) {
            await expect(desktopControls.getByText(filterLabel, { exact: true })).toBeVisible();
          }
          await expect(desktopControls.getByRole("button", { name: pageSpec.action })).toBeVisible();
          await assertNoHorizontalOverflow(page);
          await capture(
            page,
            testInfo,
            `standard-controls-${pageSpec.slug}-1440x900.png`,
            `${pageSpec.section} standardized desktop controls`
          );
        }
      }
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

        await page.getByRole("button", { name: /Open Job #1001/ }).click();
        await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
        await expect(page.getByRole("tab", { name: "Documents" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Edit job details/i })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Delete job/i })).toHaveCount(0);
        await expect(page.getByRole("combobox", { name: "Update job status" })).toBeVisible();
        await page.getByRole("button", { name: "Back to Service Board" }).click();

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
    { width: 1920, height: 1080 },
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
      await assertDesktopBoardSpacing(page);

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

      const boardScreenshotName = `service-board-desktop-${viewport.width}x${viewport.height}.png`;
      await capture(page, testInfo, boardScreenshotName, `Service Board desktop ${viewport.width}x${viewport.height}`);
      if (viewport.width === 1440) await capture(page, testInfo, "desktop-board-1440x900.png", "desktop board regression");
      await assertNoHorizontalOverflow(page);
      expect(broadPuts.requests).toEqual([]);
    } finally {
      broadPuts.stop();
      await context.close();
    }
  }
});

test("Service Board cards respect column padding across tablet, desktop, and mobile widths", async ({ browser }, testInfo) => {
  const measurements = [];
  const viewports = [
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ];

  async function checkContainment(page, viewport, scenario, viewMode = "List") {
    const columns = page.locator("[data-service-board-status]");
    await expect(columns).toHaveCount(viewport.width < 1024 ? 1 : 3);
    const metrics = await columns.evaluateAll((elements) => elements.map((column) => {
      const mobile = column.hasAttribute("data-mobile-board-view");
      const content = mobile ? column : column.querySelector(':scope > [data-slot="card-content"]');
      const list = mobile ? column.querySelector(":scope > .grid") : content.firstElementChild;
      const contentRect = content.getBoundingClientRect();
      const style = getComputedStyle(content);
      const left = contentRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right = contentRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      const rect = column.getBoundingClientRect();
      const cards = Array.from(list.children).map((wrapper) => {
        const card = mobile ? wrapper : wrapper.querySelector('[data-slot="card"]');
        const cardRect = card.getBoundingClientRect();
        const cardStyle = getComputedStyle(card);
        const body = card.querySelector('[data-slot="card-content"]');
        return {
          left: cardRect.left,
          right: cardRect.right,
          width: cardRect.width,
          boxSizing: cardStyle.boxSizing,
          margins: [parseFloat(cardStyle.marginLeft), parseFloat(cardStyle.marginRight)],
          overflowingChildren: body ? Array.from(body.querySelectorAll("*"))
            .filter((child) => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflowX === "visible")
            .map((child) => ({ text: child.textContent.slice(0, 60), className: child.getAttribute("class") })) : [],
        };
      });
      return { status: column.dataset.serviceBoardStatus, top: rect.top, columnRight: rect.right, left, right, cards };
    }));
    measurements.push({ viewport, scenario, viewMode, columns: metrics });
    for (const column of metrics) {
      expect(column.columnRight).toBeLessThanOrEqual(viewport.width + 1);
      expect(column.top).toBeCloseTo(metrics[0].top, 0);
      expect(column.cards.length).toBeGreaterThan(0);
      for (const card of column.cards) {
        expect(card.boxSizing).toBe("border-box");
        expect(card.margins).toEqual([0, 0]);
        expect(card.left).toBeGreaterThanOrEqual(column.left - 1);
        expect(card.right).toBeLessThanOrEqual(column.right + 1);
        expect(card.overflowingChildren, `${viewport.width} ${scenario} ${viewMode} ${column.status}`).toEqual([]);
        if (viewMode !== "Grid") {
          expect(card.left).toBeCloseTo(column.left, 0);
          expect(card.right).toBeCloseTo(column.right, 0);
        }
      }
    }
    await assertNoHorizontalOverflow(page);
  }

  for (const viewport of viewports) {
    const context = await browser.newContext(viewport.width <= 1180
      ? mobileContextOptions(viewport.width, viewport.height)
      : desktopContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    let fixture = readAugmentedFixture();
    // Keep long-text stress data isolated from the shared workflow fixtures and APIs.
    await page.route("**/api/app-state", (route) => route.request().method() === "GET"
      ? route.fulfill({ json: { state: fixture, storageMode: "sqlite" } })
      : route.continue());
    try {
      await loginAs(page, "mobileadmin", viewport.width < 1024);
      await page.locator(viewport.width < 1024 ? "[data-mobile-job-id]" : '[draggable="true"]').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await checkContainment(page, viewport, "normal");
      if (viewport.width === 820 || viewport.width === 1024) {
        await capture(page, testInfo, `service-board-containment-after-${viewport.width}x${viewport.height}.png`, "Service Board card containment");
      }
      if (viewport.width < 1024) {
        await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Move Job #1002", exact: true })).toBeVisible();
        continue;
      }

      const longToken = "ServiceM8UnbrokenReference".repeat(8);
      fixture = {
        ...fixture,
        jobs: fixture.jobs.map((job) => ({
          ...job,
          customerName: `Customer${longToken}`,
          title: `Job${longToken}`,
          description: `ServiceM8 notes: ${longToken}`,
          jobAddress: `33 ${longToken}, Caroline Springs VIC 3023, Australia`,
          scheduledDate: "",
          urgency: "Medium",
          maintenancePlanName: "Containment test",
          invoice: { ...fixture.jobs[0].invoice, items: [{ id: "wide-amount", qty: 1, rate: 1234567890.12 }] },
        })),
      };
      await page.reload();
      await page.locator('[draggable="true"]').first().waitFor();
      await page.getByText("Show tag info", { exact: true }).locator("..").getByRole("checkbox").check();
      for (const viewMode of ["List", "Compact", "Grid"]) {
        for (const status of ["To Do", "In Progress", "Completed"]) {
          await page.getByRole("button", { name: `${status} ${viewMode} view`, exact: true }).click();
        }
        await checkContainment(page, viewport, "long text and large amounts", viewMode);
        if (viewMode === "Compact") {
          for (const status of ["To Do", "In Progress", "Completed"]) {
            await page.locator(`[data-service-board-status="${status}"] [draggable="true"] button[aria-expanded="false"]`).first().click();
          }
          await checkContainment(page, viewport, "expanded compact", viewMode);
          await expect(page.locator("[data-service-board-status]").getByRole("button", { name: "View Job", exact: true })).toHaveCount(3);
        }
      }
      await page.getByRole("button", { name: "Show only To Do", exact: true }).click();
      const focusedCards = page.locator('[data-service-board-status="To Do"] [draggable="true"]');
      await expect(focusedCards).toHaveCount(2);
      await page.getByRole("button", { name: "Show all columns", exact: true }).click();
      await expect(page.locator("[data-service-board-status]")).toHaveCount(3);
    } finally {
      await context.close();
    }
  }
  await testInfo.attach("card-containment-measurements", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});

test("visual density preserves touch targets, focus, and card gutters at every responsive size", async ({ browser }) => {
  for (const viewport of [
    { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 412, height: 915 },
    { width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1024, height: 768 },
    { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
  ]) {
    const mobile = viewport.width < 1024;
    const context = await browser.newContext(mobile
      ? mobileContextOptions(viewport.width, viewport.height)
      : desktopContextOptions(viewport.width, viewport.height));
    const page = await context.newPage();
    try {
      await loginAs(page, "mobileadmin", mobile);
      const firstCard = page.locator(mobile ? "[data-mobile-job-id]" : '[draggable="true"] > [data-slot="card"]').first();
      await expect(firstCard).toHaveCSS("border-top-width", "1px");
      if (!mobile) {
        // Explicit column gutters must override the shared panel padding token.
        await expect(page.locator('[data-service-board-status] > [data-slot="card-content"]').first()).toHaveCSS("padding-left", "12px");
        await expect(firstCard).toHaveCSS("padding-top", "0px");
        await expect(firstCard.locator(':scope > [data-slot="card-content"]')).toHaveCSS("padding-top", "12px");
        const wrapper = firstCard.locator("..");
        const arrow = wrapper.locator(".service-board-tomorrow-action");
        if (await arrow.count()) {
          const arrowBox = await arrow.boundingBox();
          const amountBox = await firstCard.locator('[title$=" value"]').first().boundingBox();
          if (amountBox) expect(arrowBox.y + arrowBox.height).toBeLessThanOrEqual(amountBox.y);
        }
      }
      await assertNoHorizontalOverflow(page);
      await navigateToWorkspaceSection(page, "Customers", viewport.width);
      const controls = page.locator(viewport.width < 1280 ? "[data-responsive-page-controls]" : ".floating-page-toolbar:visible").first();
      const search = controls.locator("input").first();
      await expect(search).toHaveCSS("border-top-width", "1px");
      await expect(page.locator('.data-card > [data-slot="card-content"]')).toHaveCSS("padding-left", "0px");
      if (mobile) {
        const targets = await controls.locator('button, input').evaluateAll((elements) => elements
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => ({ name: element.getAttribute("aria-label") || element.textContent, height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })));
        for (const target of targets) {
          expect(target.height, `${viewport.width}: ${target.name}`).toBeGreaterThanOrEqual(44);
          expect(target.width, `${viewport.width}: ${target.name}`).toBeGreaterThanOrEqual(44);
        }
        const filters = controls.locator('button[aria-haspopup="dialog"]');
        await filters.click();
        const sheet = page.getByRole("dialog", { name: "Filters", exact: true });
        await expect(sheet).toHaveCSS("border-top-width", "1px");
        await expect(sheet.locator('[data-slot="dialog-body"]')).toHaveCSS("padding-left", viewport.width < 640 ? "12px" : "14px");
        await page.keyboard.press("Escape");
        await expect(filters).toBeFocused();
      }
      await search.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(search).toBeFocused();
      expect(await search.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("3px");
      await assertNoHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  }
});

test("Create Job is a guarded page workflow using the existing record API", async ({ browser }, testInfo) => {
  const context = await browser.newContext(mobileContextOptions(390, 844));
  const page = await context.newPage();
  const broadPuts = trackBroadWorkspacePuts(page);
  try {
    await loginAs(page, "mobileadmin");
    await capture(page, testInfo, "service-board-before-job-open-390x844.png", "Service Board before Create Job");

    await page.getByRole("button", { name: "Add job", exact: true }).click();
    await expect(page).toHaveURL(baseUrl + "/jobs/new");
    await expect(page.getByRole("heading", { name: "Create Job", level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Create New Job" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create Job", exact: true })).toBeDisabled();

    const customerSearch = page.getByRole("textbox", { name: "Search customers" });
    await expect(page.locator('[aria-label="Customer search results"]')).toHaveCount(0);
    await expect(page.getByText("Enter at least 2 characters to search.", { exact: true })).toBeVisible();
    await customerSearch.fill("A");
    await expect(page.locator('[aria-label="Customer search results"]')).toHaveCount(0);
    await customerSearch.fill("Arcadia");
    await expect(page.locator('[aria-label="Customer search results"] button')).toHaveCount(1);
    await capture(page, testInfo, "create-job-mobile-customer-search-390x844.png", "Create Job customer search");

    await page.locator('[aria-label="Customer search results"] button').click();
    await expect(page.getByRole("button", { name: "Change customer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change site" })).toBeVisible();
    await expect(page.locator(".record-workspace").getByText("Arcadia Example Apartments", { exact: true }).first()).toBeVisible();
    await capture(page, testInfo, "create-job-mobile-selected-customer-390x844.png", "Create Job selected customer");

    await page.getByLabel("Job title").fill("Page workspace service visit");
    await page.getByLabel("Description of work").fill("Verify the responsive page workflow and existing create API.");
    await page.getByLabel("Scheduled date").fill("2026-09-10");
    await chooseSelectOption(page, "Assigned technician", "Jordan Vale · Office Manager");
    await chooseSelectOption(page, "Urgency", "High");
    await page.locator("#create-job-details").scrollIntoViewIfNeeded();
    await capture(page, testInfo, "create-job-mobile-details-390x844.png", "Create Job details");
    await expect(page.getByRole("button", { name: "Create Job", exact: true })).toBeEnabled();
    await assertNoHorizontalOverflow(page);

    const createRequestPromise = page.waitForRequest((request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/api/jobs"
    );
    const createResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/jobs"
    );
    await page.getByRole("button", { name: "Create Job", exact: true }).click();
    const createRequest = await createRequestPromise;
    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBe(true);
    expect(createRequest.postDataJSON()).toMatchObject({
      customerMode: "existing",
      customer: { id: "demo-customer-arcadia" },
      job: {
        title: "Page workspace service visit",
        urgency: "High",
        scheduledDate: "2026-09-10",
        assignedTechnicianId: "demo-staff-admin",
        assignedTechnicianName: "Jordan Vale",
      },
    });

    await expect(page).toHaveURL(/\/jobs\/[a-f0-9-]+$/);
    await expect(page.getByRole("heading", { name: "Page workspace service visit", level: 1 })).toBeVisible();
    await expect.poll(() => readWorkspaceState().jobs.find((job) => job.title === "Page workspace service visit")?.assignedTechnicianName).toBe("Jordan Vale");
    await page.getByRole("button", { name: "Back to Service Board" }).click();
    await expect(page).toHaveURL(baseUrl + "/");
    await capture(page, testInfo, "service-board-after-job-back-390x844.png", "Service Board after job Back");
    expect(broadPuts.requests).toEqual([]);
  } finally {
    broadPuts.stop();
    await context.close();
  }
});

test("Create Job preserves nested customer and site work and confirms discarding it", async ({ browser }) => {
  const context = await browser.newContext(mobileContextOptions(375, 667));
  const page = await context.newPage();
  try {
    await loginAs(page, "mobileadmin");
    await page.getByRole("button", { name: "Add job", exact: true }).click();
    await page.getByRole("button", { name: "Add New Customer", exact: true }).click();
    await page.getByLabel("Customer or company name").fill("Nested workflow customer");
    await page.getByLabel("Primary site address").fill("44 Test Street, Melbourne VIC 3000");
    await page.getByLabel("Job title").fill("Nested customer job");
    await page.getByLabel("Description of work").fill("State remains on the page while adding a customer and site.");
    await expect(page.getByRole("button", { name: "Create Job", exact: true })).toBeEnabled();

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel("Customer or company name")).toHaveValue("Nested workflow customer");
    await expect(page.getByLabel("Job title")).toHaveValue("Nested customer job");

    await page.evaluate(() => window.history.back());
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "Discard" }).click();
    await expect(page).toHaveURL(baseUrl + "/");

    await page.getByRole("button", { name: "Add job", exact: true }).click();
    await page.getByRole("textbox", { name: "Search customers" }).fill("Arcadia");
    await page.locator('[aria-label="Customer search results"] button').click();
    await page.getByRole("button", { name: "Add site" }).click();
    await page.getByLabel("Site address").fill("88 New Site Road, Richmond VIC 3121");
    await expect(page.getByLabel("Site address")).toHaveValue("88 New Site Road, Richmond VIC 3121");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard" }).click();

    await page.getByRole("button", { name: "Add job", exact: true }).click();
    await page.getByRole("button", { name: "Add New Customer", exact: true }).click();
    await page.getByLabel("Customer or company name").fill("Created inside job workspace");
    await page.getByLabel("Primary site address").fill("44 Test Street, Melbourne VIC 3000");
    await page.getByLabel("Job title").fill("New customer workspace job");
    await page.getByLabel("Description of work").fill("Create the customer, site, and job through the existing atomic job API.");
    const newCustomerResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/jobs"
    );
    await page.getByRole("button", { name: "Create Job", exact: true }).click();
    expect((await newCustomerResponse).ok()).toBe(true);
    await expect.poll(() => readWorkspaceState().customers.some((customer) => customer.name === "Created inside job workspace")).toBe(true);
    await expect.poll(() => readWorkspaceState().jobs.some((job) => job.title === "New customer workspace job")).toBe(true);
    await page.getByRole("button", { name: "Back to Service Board" }).click();

    await page.getByRole("button", { name: "Add job", exact: true }).click();
    await page.getByRole("textbox", { name: "Search customers" }).fill("Arcadia");
    await page.locator('[aria-label="Customer search results"] button').click();
    await page.getByRole("button", { name: "Add site" }).click();
    await page.getByLabel("Site address").fill("88 New Site Road, Richmond VIC 3121");
    await page.getByLabel("Job title").fill("New site workspace job");
    await page.getByLabel("Description of work").fill("Persist a new site while creating a job for an existing customer.");
    const newSiteResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/jobs"
    );
    await page.getByRole("button", { name: "Create Job", exact: true }).click();
    expect((await newSiteResponse).ok()).toBe(true);
    await expect.poll(() => readWorkspaceState().customers
      .find((customer) => customer.id === "demo-customer-arcadia")
      ?.sites.some((site) => site.address === "88 New Site Road, Richmond VIC 3121")).toBe(true);
    await page.getByRole("button", { name: "Back to Service Board" }).click();
  } finally {
    await context.close();
  }
});

test("Create Job reports API failures and prevents duplicate submission", async ({ browser }) => {
  const context = await browser.newContext(mobileContextOptions(412, 915));
  const page = await context.newPage();
  let createRequestCount = 0;
  page.on("dialog", (dialog) => dialog.dismiss());
  try {
    await loginAs(page, "mobileadmin");
    await page.route("**/api/jobs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      createRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetic create failure" }) });
    });
    await page.getByRole("button", { name: "Add job", exact: true }).click();
    await page.getByRole("textbox", { name: "Search customers" }).fill("Arcadia");
    await page.locator('[aria-label="Customer search results"] button').click();
    await page.getByLabel("Job title").fill("Failing create request");
    await page.getByLabel("Description of work").fill("Exercise the inline error state.");
    const createButton = page.getByRole("button", { name: "Create Job", exact: true });
    await createButton.click({ clickCount: 2 });
    await expect(page.getByRole("alert")).toContainText("could not be created");
    expect(createRequestCount).toBe(1);
    await expect(page).toHaveURL(baseUrl + "/jobs/new");
  } finally {
    await context.close();
  }
});

test("Job Details uses accessible tabs and preserves editing, status, and schedule APIs", async ({ browser }, testInfo) => {
  const context = await browser.newContext(mobileContextOptions(390, 844));
  const page = await context.newPage();
  const broadPuts = trackBroadWorkspacePuts(page);
  try {
    await loginAs(page, "mobileadmin");
    await capture(page, testInfo, "service-board-before-job-open-390x844.png", "Service Board before opening a job");
    await page.getByRole("button", { name: /Open Job #1001/ }).click();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
    await expect(page.getByRole("heading", { name: "Synthetic gate service", level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Synthetic gate service" })).toHaveCount(0);
    await capture(page, testInfo, "job-details-mobile-overview-390x844.png", "Job Details mobile Overview");
    await assertNoHorizontalOverflow(page);

    const tablist = page.getByRole("tablist", { name: "Job details sections" });
    const overviewTab = tablist.getByRole("tab", { name: "Overview" });
    const scheduleTab = tablist.getByRole("tab", { name: "Schedule" });
    for (const tabName of ["Overview", "Schedule", "Documents", "Notes & photos"]) {
      await expect(tablist.getByRole("tab", { name: tabName })).toBeVisible();
    }
    const tablistDimensions = await tablist.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(tablistDimensions.scrollWidth).toBeLessThanOrEqual(tablistDimensions.clientWidth + 1);
    await expect(page.getByText("Supplier Manuals", { exact: true })).toHaveCount(0);
    const customerProfileButton = page.getByRole("button", { name: "Open customer profile" });
    await customerProfileButton.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "job-details-mobile-overview-actions-390x844.png", "Job Details mobile Overview actions");
    await tablist.scrollIntoViewIfNeeded();
    await overviewTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(scheduleTab).toBeFocused();
    await expect(scheduleTab).toHaveAttribute("aria-selected", "true");

    await page.getByLabel("Scheduled date").fill("2026-09-14");
    await chooseSelectOption(page, "Assigned technician", "Jordan Vale · Office Manager");
    await chooseSelectOption(page, "Urgency", "High");
    const scheduleRequestPromise = page.waitForRequest((request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname === "/api/jobs/demo-job-1001"
    );
    await page.getByRole("button", { name: "Save schedule" }).click();
    expect((await scheduleRequestPromise).postDataJSON()).toEqual({
      job: {
        scheduledDate: "2026-09-14",
        urgency: "High",
        assignedTechnicianId: "demo-staff-admin",
        assignedTechnicianName: "Jordan Vale",
      },
    });
    await expect.poll(() => readWorkspaceState().jobs.find((job) => job.id === "demo-job-1001")?.scheduledDate).toBe("2026-09-14");

    const statusRequestPromise = page.waitForRequest((request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname === "/api/jobs/demo-job-1001/status"
    );
    await chooseSelectOption(page, "Update job status", "In Progress");
    expect((await statusRequestPromise).postDataJSON()).toEqual({ status: "In Progress" });
    await waitForJobStatus("demo-job-1001", "In Progress");

    await tablist.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Job title").fill("Synthetic gate service updated");
    const detailUpdateRequest = page.waitForRequest((request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname === "/api/jobs/demo-job-1001"
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await detailUpdateRequest).postDataJSON()).toMatchObject({ job: { title: "Synthetic gate service updated" } });
    await expect(page.getByRole("heading", { name: "Synthetic gate service updated", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Job title").fill("Synthetic gate service");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Synthetic gate service", level: 1 })).toBeVisible();

    await tablist.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByRole("button", { name: "Open Quote Editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Invoice Editor" })).toBeVisible();
    await capture(page, testInfo, "job-details-mobile-documents-390x844.png", "Job Details mobile Documents");

    await tablist.getByRole("tab", { name: "Notes & photos" }).click();
    await capture(page, testInfo, "job-details-mobile-notes-390x844.png", "Job Details mobile Notes and photos");
    const emptyPhotoState = page.getByText("No photos uploaded yet.", { exact: true });
    await emptyPhotoState.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "job-details-mobile-empty-photos-390x844.png", "Job Details mobile empty photos");
    await page.getByLabel("New note").fill("Responsive page note");
    const noteRequestPromise = page.waitForRequest((request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/api/jobs/demo-job-1001/notes"
    );
    await page.getByRole("button", { name: "Add note" }).click();
    await noteRequestPromise;
    await expect(page.getByText("Responsive page note", { exact: true })).toBeVisible();

    await chooseSelectOption(page, "Update job status", "To Do");
    await waitForJobStatus("demo-job-1001", "To Do");
    await tablist.getByRole("tab", { name: "Schedule" }).click();
    await page.getByLabel("Scheduled date").fill("2026-01-15");
    await chooseSelectOption(page, "Assigned technician", "Unassigned");
    await chooseSelectOption(page, "Urgency", "Medium");
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect.poll(() => readWorkspaceState().jobs.find((job) => job.id === "demo-job-1001")?.scheduledDate).toBe("2026-01-15");

    await page.getByRole("button", { name: "Back to Service Board" }).click();
    await expect(page).toHaveURL(baseUrl + "/");
    await capture(page, testInfo, "service-board-after-job-back-390x844.png", "Service Board after Job Details Back");
    expect(broadPuts.requests).toEqual([]);
  } finally {
    broadPuts.stop();
    await context.close();
  }
});

test("history, invoices, customer, and site entry points open the same Job Details page", async ({ browser }) => {
  const context = await browser.newContext(desktopContextOptions(1280, 900));
  const page = await context.newPage();
  try {
    await loginAs(page, "mobileadmin", false);

    await page.locator('[draggable="true"]', { hasText: "Synthetic gate service" }).first().dblclick();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
    await page.getByRole("button", { name: "Customers", exact: true }).click();
    await expect(page).toHaveURL(baseUrl + "/");
    await expect(page.locator(".record-workspace")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Customers", exact: true })).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: "Job History", exact: true }).click();
    const historyRow = page.locator('[title="Double-click to open job"]', { hasText: "Job #1001" });
    await historyRow.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
    await page.getByRole("button", { name: "Back to Job History" }).click();
    await expect(page.getByRole("button", { name: "Job History", exact: true })).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: "Invoices", exact: true }).click();
    await page.locator(".data-grid-row", { hasText: "Job #1001" }).getByRole("button", { name: "Job", exact: true }).click();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
    await page.getByRole("button", { name: "Back to Invoices" }).click();
    await expect(page.getByRole("button", { name: "Invoices", exact: true })).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: "Customers", exact: true }).click();
    const customerRow = page.locator('[title="Double-click to open customer profile"]', { hasText: "Arcadia Example Apartments" });
    await customerRow.getByRole("button", { name: "Open", exact: true }).click();
    const customerDialog = page.getByRole("dialog", { name: "Arcadia Example Apartments" });
    await customerDialog.getByRole("button", { name: /Job #1001/ }).click();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
    await expect(customerDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Customers" }).click();

    await page.getByRole("button", { name: "Sites", exact: true }).click();
    const siteRow = page.locator('[title="Double-click to open site profile"]', { hasText: "10 Example Lane, Sampleton VIC 3000" });
    await siteRow.getByRole("button", { name: "Open", exact: true }).click();
    const siteDialog = page.getByRole("dialog", { name: "10 Example Lane, Sampleton VIC 3000" });
    await siteDialog.getByRole("button", { name: /Job #1001/ }).click();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
    await expect(siteDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Sites" }).click();

    await page.goto(baseUrl + "/jobs/demo-job-1001");
    await expect(page.getByRole("heading", { name: "Synthetic gate service", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Back to Service Board" }).click();
    await expect(page).toHaveURL(baseUrl + "/");
  } finally {
    await context.close();
  }
});

test("desktop sidebar navigation closes Job Details and preserves its unsaved-change guard", async ({ browser }) => {
  const context = await browser.newContext(desktopContextOptions(1440, 900));
  const page = await context.newPage();
  try {
    await loginAs(page, "mobileadmin", false);
    await page.locator('[draggable="true"]', { hasText: "Synthetic gate service" }).first().dblclick();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Job title").fill("Unsaved sidebar navigation check");
    await page.getByRole("button", { name: "Customers", exact: true }).click();

    const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
    await expect(page.getByLabel("Job title")).toHaveValue("Unsaved sidebar navigation check");

    await page.getByRole("button", { name: "Customers", exact: true }).click();
    await discardDialog.getByRole("button", { name: "Discard" }).click();
    await expect(page).toHaveURL(baseUrl + "/");
    await expect(page.locator(".record-workspace")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Customers", exact: true })).toHaveAttribute("aria-current", "page");
  } finally {
    await context.close();
  }
});

test("Create Job and Job Details use tablet and desktop workspace layouts", async ({ browser }, testInfo) => {
  for (const viewport of [
    { width: 390, height: 844, mobile: true },
    { width: 768, height: 1024, mobile: true },
    { width: 820, height: 1180, mobile: true },
    { width: 1024, height: 768, mobile: false },
    { width: 1280, height: 720, mobile: false },
    { width: 1440, height: 900, mobile: false },
    { width: 1920, height: 1080, mobile: false },
  ]) {
    const context = await browser.newContext(
      viewport.mobile ? mobileContextOptions(viewport.width, viewport.height) : desktopContextOptions(viewport.width, viewport.height)
    );
    const page = await context.newPage();
    try {
      if (viewport.width === 390) {
        const devtools = await context.newCDPSession(page);
        await devtools.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: 24, right: 8, bottom: 20, left: 8 },
        });
      }
      await loginAs(page, "mobileadmin", viewport.mobile);
      const newJobButton = viewport.mobile
        ? page.getByRole("button", { name: "Add job", exact: true })
        : page.getByRole("button", { name: "New Job", exact: true });
      await newJobButton.click();
      await expect(page).toHaveURL(baseUrl + "/jobs/new");
      await expect(page.getByRole("dialog", { name: "Create New Job" })).toHaveCount(0);
      const createWorkspaceMetrics = await assertRecordWorkspaceTop(page, !viewport.mobile);
      if (viewport.width === 390) expect(createWorkspaceMetrics.headerPaddingTop).toBeGreaterThanOrEqual(32);
      await assertNoHorizontalOverflow(page);
      if (viewport.width === 820) await capture(page, testInfo, "create-job-ipad-820x1180.png", "Create Job iPad portrait");
      if (!viewport.mobile && [1280, 1440, 1920].includes(viewport.width)) {
        await capture(page, testInfo, `create-job-desktop-${viewport.width}x${viewport.height}.png`, `Create Job desktop ${viewport.width}x${viewport.height}`);
      }
      await page.getByRole("button", { name: "Back to Service Board" }).click();

      if (viewport.mobile) {
        await page.getByRole("button", { name: /Open Job #1001/ }).click();
      } else {
        await page.locator('[draggable="true"]', { hasText: "Synthetic gate service" }).first().dblclick();
      }
      await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
      await expect(page.getByRole("heading", { name: "Synthetic gate service", level: 1 })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Synthetic gate service" })).toHaveCount(0);
      const detailsWorkspaceMetrics = await assertRecordWorkspaceTop(page, !viewport.mobile);
      if (viewport.width === 390) expect(detailsWorkspaceMetrics.headerPaddingTop).toBeGreaterThanOrEqual(32);
      await assertNoHorizontalOverflow(page);
      if (viewport.width === 820) await capture(page, testInfo, "job-details-ipad-overview-820x1180.png", "Job Details iPad Overview");
      if (!viewport.mobile && [1280, 1440, 1920].includes(viewport.width)) {
        await capture(page, testInfo, `job-details-desktop-overview-${viewport.width}x${viewport.height}.png`, `Job Details desktop ${viewport.width}x${viewport.height}`);
      }
      await page.getByRole("button", { name: "Back to Service Board" }).click();
    } finally {
      await context.close();
    }
  }
});
