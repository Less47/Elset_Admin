import { installGoogleMapsStub } from "./helpers/google-maps-stub.mjs";
import { themePresets } from "../../src/lib/theme-presets.js";
import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { updateCustomer } from "../../server-workspace-customers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");
const adminPassword = "E2E-admin-pass-123";
const denseCustomerId = "customer-layout-many";
const emptyCustomerId = "customer-layout-empty";

let tempDataDir = "";
let baseUrl = "";
let serverProcess = null;
let serverOutput = "";

function readFixture() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const sites = Array.from({ length: 8 }, (_, index) => ({
    id: `layout-site-${index}`, label: `Site ${index + 1} with a long operational name ${"LongSiteName".repeat(8)}`,
    address: `${index + 1} ${"LongAddressWithoutSpaces".repeat(8)} Avenue, Synthetic Victoria 3999`,
    siteType: "commercial", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const customer = {
    id: denseCustomerId, name: `Many records ${"LongCustomerName".repeat(8)}`, email: "accounts@layout.example.test", phone: "0400 123 456",
    customerType: "business", address: sites[0].address, sites, createdAt: "2026-01-01T00:00:00.000Z",
  };
  fixture.customers.push(customer, { id: emptyCustomerId, name: "Empty sections customer", sites: [], contacts: [], createdAt: customer.createdAt });
  fixture.jobs.push(...Array.from({ length: 16 }, (_, index) => ({
    ...fixture.jobs[0], id: `layout-job-${index}`, jobNumber: 5000 + index, customerId: denseCustomerId, customerName: customer.name,
    customerEmail: customer.email, customerPhone: customer.phone, jobAddress: sites[index % sites.length].address,
    title: `Job ${index + 1} ${"LongJobTitle".repeat(10)}`, notes: [], photos: [], quote: null, invoice: null,
  })));
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

async function waitForServer(url, logs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(`${url}/api/auth/me`);
      if (response.status === 401 || response.ok) return;
    } catch {
      // Keep polling until the server starts accepting requests.
    }

    if (serverProcess?.exitCode !== null) {
      throw new Error(`Server exited before it was ready.\n${logs()}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for local test server.\n${logs()}`);
}

async function seedWorkspaceDatabase() {
  const db = openWorkspaceDb({
    dbPath: path.join(tempDataDir, "elset-workspace.db"),
  });
  try {
    importWorkspaceJsonData(db, readFixture());
    updateCustomer(db, denseCustomerId, { contacts: Array.from({ length: 12 }, (_, index) => ({
      id: `layout-contact-${index}`, name: `Contact ${index + 1} ${"LongContactName".repeat(6)}`, role: "Site manager",
      phone: "0400 123 456", email: `${"longemail".repeat(16)}${index}@layout.example.test`,
    })) });
  } finally {
    db.close();
  }
}

async function seedAdminLogin() {
  const authDbPath = path.join(tempDataDir, "auth.db");
  const serverAuthUrl = `${pathToFileURL(path.join(repoRoot, "server-auth.js")).href}?e2e=${Date.now()}`;
  const seedScript = `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(serverAuthUrl)});
    await ensureAuthReady();
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({
      email: "admin@auth.elset.local",
      emailVerified: true,
      name: "E2E Admin",
      role: "admin",
      username: "admin",
      displayUsername: "E2E Admin",
      workspaceRole: "admin",
      staffId: "",
    });
    const password = await context.password.hash(${JSON.stringify(adminPassword)});
    await context.internalAdapter.linkAccount({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password,
    });
    for (const role of ["office", "technician"]) {
      const account = await context.internalAdapter.createUser({ email: role + "@auth.elset.local", emailVerified: true, name: "E2E " + role, role, username: role, displayUsername: role, workspaceRole: role, staffId: "" });
      await context.internalAdapter.linkAccount({ userId: account.id, accountId: account.id, providerId: "credential", password });
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", seedScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ELSET_AUTH_DB_PATH: authDbPath,
      ELSET_DATA_DIR: tempDataDir,
      NODE_ENV: "test",
    },
    maxBuffer: 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(`Failed to seed the test admin login.\n${result.stdout || ""}${result.stderr || ""}`);
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
    ELSET_FRONTEND_URL: baseUrl,
    NODE_ENV: "test",
    PORT: String(port),
  };

  delete env.FLY_APP_NAME;

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitForServer(baseUrl, () => serverOutput);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;

  serverProcess.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (serverProcess?.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
      resolve();
    }, 5_000);
    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function login(page, { username = "admin", pathname = "/" } = {}) {
  await page.goto(baseUrl + pathname);
  await page.getByPlaceholder("Enter your username").fill(username);
  await page.getByPlaceholder("Enter your password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toHaveCount(0);
}

test.beforeAll(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-page-chrome-"));
  await seedWorkspaceDatabase();
  await seedAdminLogin();
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  if (tempDataDir) {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && serverOutput) {
    await testInfo.attach("server-output", {
      body: serverOutput,
      contentType: "text/plain",
    });
  }
});

const screenshotDir = path.join(repoRoot, "test-results/page-top-chrome");
const sections = ["Service Board", "Customers", "Sites", "Job History", "Invoices", "Calendar", "Maintenance", "Staff", "Parts Inventory", "Statistics", "Settings", "Recycle Bin"];

async function navigate(page, label, width) {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (width < 1024) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Application navigation" }).getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Application navigation" })).toHaveCount(0);
  } else {
    const link = page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: label, exact: true });
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
  }
}

async function headerBounds(page, selector = "[data-page-top-bar]", fullscreen = false) {
  const header = page.locator(`${selector}:visible`);
  await expect(header).toHaveCount(1);
  const measure = () => page.evaluate((selector) => {
    const element = [...document.querySelectorAll(selector)].find((entry) => entry.getBoundingClientRect().width > 0);
    const rect = element.getBoundingClientRect();
    const sidebar = document.querySelector('aside:has(nav[aria-label="Application"])');
    const navigation = document.querySelector(".mobile-workspace-navigation");
    return {
      x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, height: rect.height,
      sidebarRight: sidebar?.getBoundingClientRect().right || 0,
      navigationBottom: navigation?.getBoundingClientRect().bottom || 0,
      viewportWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      position: getComputedStyle(element).position,
      radius: getComputedStyle(element).borderRadius,
    };
  }, selector);
  // Navigation can replace a previously-visible header between the locator's
  // visibility check and evaluation. Wait for the new layout to settle.
  await expect.poll(async () => {
    const bounds = await measure();
    return Math.abs(bounds.x - (fullscreen ? 0 : bounds.sidebarRight));
  }).toBeLessThanOrEqual(1);
  const bounds = await measure();
  expect(Math.abs(bounds.right - bounds.viewportWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.y - bounds.navigationBottom)).toBeLessThanOrEqual(1);
  expect(bounds.overflow).toBeLessThanOrEqual(1);
  expect(bounds.position).toBe("sticky");
  expect(bounds.radius).toBe("0px");
  return bounds;
}

async function screenshot(page, name) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
}

async function scrollUnderHeader(page, original, selector = "[data-page-top-bar]") {
  // Empty result pages must obey the same scroll contract as long lists. A
  // temporary tail exercises that contract without changing production data.
  await page.locator("[data-page-body]:visible, .record-workspace-body:visible").first().evaluate((body) => {
    const tail = document.createElement("div");
    tail.dataset.layoutTestTail = "";
    tail.style.height = "1600px";
    body.append(tail);
  });
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  const header = page.locator(`${selector}:visible`);
  await expect.poll(async () => (await header.boundingBox()).y).toBeCloseTo(original.y, 0);
  // Hit testing catches content painting above an otherwise-correct rectangle.
  expect(await header.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
  await page.locator("[data-layout-test-tail]").evaluateAll((elements) => elements.forEach((element) => element.remove()));
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function primaryToolbarControls(page, label, width) {
  const header = page.locator("[data-page-top-bar]");
  const toolbar = label === "Service Board" ? header.locator("[data-service-board-primary-controls]") : header;
  const controls = toolbar.locator("input:visible, button:visible");
  const boxes = [];
  const headerBox = await header.boundingBox();
  for (const control of await controls.all()) {
    await expect(control).toHaveAccessibleName(/\S/);
    const box = await control.boundingBox();
    expect(box.height, `${label}: ${await control.getAttribute("aria-label") || await control.textContent()}`).toBe(44);
    expect(box.x).toBeGreaterThanOrEqual(headerBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
    boxes.push(box);
  }
  // Large toolbars have one aligned primary row. Responsive toolbars may wrap.
  if (width >= 1280 && boxes.length) {
    expect(Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y))).toBeLessThanOrEqual(1);
  }
  await expect(header.locator('.page-controls__search .page-controls__label, .page-controls__view-toggle .page-controls__label')).toHaveCount(0);
  if (label === "Service Board" && width >= 1024) {
    expect((await header.getByRole("button", { name: "Edit job notes", exact: true }).boundingBox()).height).toBe(32);
  }
  if (width >= 768 && ["Customers", "Sites"].includes(label)) {
    await expect(header.getByRole("button", { name: "List view", exact: true }).filter({ visible: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "Grid view", exact: true }).filter({ visible: true })).toBeVisible();
    await expect(header.getByRole("group", { name: label === "Customers" ? "Customer view" : "Site view", exact: true }).filter({ visible: true })).toBeVisible();
  }
}

for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844]]) {
  test(`full-width sticky chrome across every page at ${width}x${height}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", hasTouch: width <= 1024 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installGoogleMapsStub(page);
    try {
      await login(page);
      const measurements = {};
      for (const label of sections) {
        await navigate(page, label, width);
        const bounds = await headerBounds(page);
        await primaryToolbarControls(page, label, width);
        if (label === "Customers") {
          const search = page.getByRole("textbox", { name: "Search customers", exact: true });
          await search.fill("Arcadia");
          await primaryToolbarControls(page, label, width);
          await page.getByRole("button", { name: /^Clear search/ }).click();
          await expect(search).toHaveValue("");
        }
        measurements[label] = bounds;
        if (label === "Calendar") {
          await expect(page.locator(".calendar-main")).toBeVisible();
          const body = await page.locator(".calendar-main").boundingBox();
          expect(body.y).toBeCloseTo(bounds.bottom, 0);
          expect(body.y + body.height).toBeCloseTo(height, 0);
          await screenshot(page, `${width}-${label}`);
          await page.locator(".calendar-main").evaluate((element) => { element.scrollTop = 400; });
          await headerBounds(page);
          expect(await page.evaluate(() => window.scrollY)).toBe(0);
        } else {
          const body = await page.locator("[data-page-body]:visible").first().boundingBox();
          expect(body.y).toBeGreaterThanOrEqual(bounds.bottom - 1);
          if (label === "Invoices" && width >= 1280) {
            await expect(page.locator("[data-page-top-bar] .data-stat-grid")).toBeVisible();
          }
          await screenshot(page, `${width}-${label}`);
          await scrollUnderHeader(page, bounds);
        }
      }
      await page.goto(`${baseUrl}/customers/${denseCustomerId}`);
      await expect(page.locator(".record-workspace-header")).toBeVisible();
      const record = await headerBounds(page, ".record-workspace-header");
      for (const control of await page.locator(".record-workspace-header button:visible").all()) {
        expect((await control.boundingBox()).height).toBe(44);
      }
      await screenshot(page, `${width}-Customer Profile`);
      await scrollUnderHeader(page, record, ".record-workspace-header");

      await page.goto(`${baseUrl}/map`);
      await expect(page.locator(".map-workspace-shell")).toBeVisible();
      await expect(page.locator("[data-page-top-bar]:visible")).toHaveCount(0);
      const map = await page.locator(".google-map-test").boundingBox();
      const boundary = width >= 1024 ? (await page.locator("aside").boundingBox()).width : 0;
      const top = width < 1024 ? (await page.locator(".mobile-workspace-navigation").boundingBox()).height : 0;
      expect(map.x).toBeCloseTo(boundary, 0);
      expect(map.y).toBeCloseTo(top, 0);
      expect(map.x + map.width).toBeCloseTo(width, 0);
      expect(map.y + map.height).toBeCloseTo(height, 0);
      expect(await page.locator(".map-workspace-shell").evaluate((element) => getComputedStyle(element).overflow)).toBe("hidden");
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
      await screenshot(page, `${width}-Map`);
      await info.attach("header-bounds", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test("normal and icon-only sidebars, fullscreen board, filters and dialogs retain their layers", async ({ browser }) => {
  for (const sidebarWidth of ["default", "icon-only"]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      if (sidebarWidth === "icon-only") await page.route("**/api/user-preferences", async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        await route.fulfill({ response, json: { ...payload, preferences: { ...payload.preferences, sidebarWidth } } });
      });
      await login(page);
      await headerBounds(page);
      await page.getByRole("button", { name: "Full Screen", exact: true }).click();
      await expect(page.locator('aside:has(nav[aria-label="Application"])')).toHaveCount(0);
      const full = await headerBounds(page, "[data-page-top-bar]", true);
      await primaryToolbarControls(page, "Service Board", 1366);
      await screenshot(page, `fullscreen-${sidebarWidth}`);
      await scrollUnderHeader(page, full);
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Filters", exact: true });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
      await page.getByRole("checkbox").click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
      await page.getByRole("button", { name: "Exit Full Screen", exact: true }).click();
      await headerBounds(page);
      await navigate(page, "Customers", 1366);
      await headerBounds(page);
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Filters", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Done", exact: true }).click();
    } finally { await context.close(); }
  }
});

test("mobile safe areas, navigation, search, status tabs and sort remain usable while scrolled", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 24, left: 8, right: 8, bottom: 20 } });
    await login(page);
    const header = await headerBounds(page);
    expect(header.y).toBeGreaterThanOrEqual(80);
    await screenshot(page, "mobile-safe-area");
    await scrollUnderHeader(page, header);
    await page.getByRole("tab", { name: /^In Progress/ }).click();
    await page.getByRole("textbox", { name: "Search jobs", exact: true }).fill("Job");
    await page.getByRole("button", { name: "Open board filters", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("combobox", { name: "Sort In Progress jobs" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await navigate(page, "Customers", 390);
    await headerBounds(page);
    const search = await page.getByRole("textbox", { name: "Search customers", exact: true }).boundingBox();
    expect(search.x).toBeGreaterThanOrEqual(8);
    expect(search.x + search.width).toBeLessThanOrEqual(382);
  } finally { await context.close(); }
});

test("page chrome follows light and dark theme tokens and square or rounded controls", async ({ browser }) => {
  for (const id of [themePresets[0].id, "midnight-signal"]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await page.route("**/api/user-preferences", async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        await route.fulfill({ response, json: { ...payload, preferences: { ...payload.preferences, ...themePresets.find((preset) => preset.id === id).values, roundedEdges: id === "midnight-signal" } } });
      });
      await login(page);
      await navigate(page, "Customers", 1366);
      await headerBounds(page);
      await expect(page.locator("html")).toHaveAttribute("data-rounded-edges", String(id === "midnight-signal"));
      await primaryToolbarControls(page, "Customers", 1366);
      const colors = await page.locator("[data-page-top-bar]").evaluate((header) => {
        const probe = document.createElement("div");
        probe.style.background = "var(--workspace-hero-bg)";
        probe.style.color = "var(--workspace-hero-text)";
        header.append(probe);
        const actual = getComputedStyle(header), expected = getComputedStyle(probe);
        const result = { bg: actual.backgroundColor, color: actual.color, expectedBg: expected.backgroundColor, expectedColor: expected.color };
        probe.remove();
        return result;
      });
      expect(colors.bg).toBe(colors.expectedBg);
      expect(colors.color).toBe(colors.expectedColor);
      await screenshot(page, `theme-${id}`);
    } finally { await context.close(); }
  }
});

test("Settings appearance preview stays below the measured page header after scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page, { pathname: "/settings" });
  await page.locator("[data-page-top-bar]").getByRole("button", { name: "UI Settings", exact: true }).click();
  const preview = page.locator("[data-workspace-preview-panel]");
  await expect(preview).toBeVisible();
  const header = await headerBounds(page);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(async () => (await preview.boundingBox()).y).toBeCloseTo(header.bottom + 20, 0);
  await headerBounds(page);
  await screenshot(page, "1920-Settings-preview-scrolled");
});
