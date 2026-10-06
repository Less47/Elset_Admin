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
import { updateCustomer } from "../../server-workspace-customers.js";
import { createJob } from "../../server-workspace-jobs.js";
import { themePresets } from "../../src/lib/theme-presets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");
const adminPassword = "E2E-admin-pass-123";
const unrelatedCustomerName = "Arcadia Example Apartments";
const fixtureCustomerId = "demo-customer-arcadia";
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

  serverProcess = spawn(process.execPath, ["--import", "./tests/fixtures/servicem8-fetch-stub.mjs", "server.js"], {
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
  await expect.poll(async () => (await page.request.get(baseUrl + "/api/auth/me")).status()).toBe(200);
}

function trackBroadWorkspacePuts(page) {
  const requests = [];
  const onRequest = (request) => {
    try {
      const requestUrl = new URL(request.url());
      const base = new URL(baseUrl);
      if (
        request.method() === "PUT" &&
        requestUrl.origin === base.origin &&
        requestUrl.pathname === "/api/app-state"
      ) {
        requests.push({
          method: request.method(),
          url: request.url(),
        });
      }
    } catch {
      // Ignore non-standard URLs from browser internals.
    }
  };

  page.on("request", onRequest);
  return {
    requests,
    stop: () => page.off("request", onRequest),
    async expectNone(label) {
      await page.waitForTimeout(750);
      expect(requests, label).toHaveLength(0);
    },
  };
}

async function apiJson(page, method, pathname, data = undefined) {
  const response = await page.request.fetch(`${baseUrl}${pathname}`, {
    method,
    data,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok()) {
    throw new Error(`${method} ${pathname} failed: ${payload?.error || response.statusText()}`);
  }
  return payload;
}

test.beforeAll(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-playwright-sqlite-"));
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

const customerPath = `/customers/${fixtureCustomerId}`;

test("React Router loads and refreshes every workspace URL directly", async ({ page }) => {
  await login(page, { pathname: "/customers" });
  await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
  await apiJson(page, "POST", "/api/maintenance-plans", { plan: {
    id: "router-smoke-plan", customerId: fixtureCustomerId, siteId: "demo-site-front-entry",
    frequency: "quarterly", nextDueDate: "2027-01-15", active: true,
  } });
  const sitePath = `${customerPath}/sites/demo-site-front-entry`;
  const pages = [
    ["/", "[data-service-board-status]"], ["/customers", '[aria-label="New Customer"]'],
    ["/customers/new", ".record-workspace"], [customerPath, ".record-workspace"],
    [customerPath + "/edit", ".record-workspace"], [customerPath + "/sites/new", ".record-workspace"],
    [sitePath, ".record-workspace"], [sitePath + "/edit", ".record-workspace"],
    ["/jobs/new", ".record-workspace"], ["/jobs/demo-job-1001", ".record-workspace"],
    ["/jobs/demo-job-1001/quote", '[data-document-workspace="quote"]'],
    ["/jobs/demo-job-1001/invoice", '[data-document-workspace="invoice"]'],
    ["/maintenance", "[data-maintenance-dashboard]"], ["/maintenance/new", "[data-maintenance-editor]"],
    ["/maintenance/router-smoke-plan", ".record-workspace"],
    ["/maintenance/router-smoke-plan/edit", "[data-maintenance-editor]"],
    ["/invoices", '[data-desktop-record-results]'],
    [`/invoices?customerId=${fixtureCustomerId}`, "[data-invoice-customer-filter]"],
    ["/map", "[data-google-map-workspace]"], ["/settings", ".floating-page-toolbar"],
  ];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [pathname, selector] of pages) await test.step(pathname, async () => {
    await page.goto(baseUrl + pathname);
    if (pathname === "/customers") await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
    else await expect(page.locator(selector).first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(baseUrl + pathname);
    if (pathname === "/customers") await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
    else await expect(page.locator(selector).first()).toBeVisible();
    await expect(page.getByText(/This (job|customer|site) could not be found|maintenance plan was not found/)).toHaveCount(0);
  });
  expect(errors).toEqual([]);
  await apiJson(page, "DELETE", "/api/maintenance-plans/router-smoke-plan");
});

test("React Router restores Service Board scroll and focus through Job and Invoice Back/Forward", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const job = page.getByRole("button", { name: /^Open Job #5006\b/ });
  await job.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(100);
  await job.click();
  await expect(page).toHaveURL(baseUrl + "/jobs/layout-job-6");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: "Open Invoice Editor", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/jobs/layout-job-6/invoice");
  await page.getByRole("button", { name: "Back to Job #5006", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/jobs/layout-job-6");
  await page.getByRole("button", { name: "Back to Service Board", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/");
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - scrollY)).toBeLessThan(20);
  await expect(job).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(baseUrl + "/jobs/layout-job-6");
  await page.goForward();
  await expect(page).toHaveURL(baseUrl + "/jobs/layout-job-6/invoice");
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(baseUrl + "/");
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - scrollY)).toBeLessThan(20);
});

test("React Router preserves sections sharing the root URL through refresh and history", async ({ page }) => {
  await login(page);
  const nav = page.getByRole("navigation", { name: "Application", exact: true });
  for (const label of ["Sites", "Calendar", "Job History", "Staff", "Parts Inventory", "Reports & Analytics", "Recycle Bin"]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(baseUrl + (label === "Reports & Analytics" ? "/statistics" : "/"));
    await page.reload();
    await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await page.goBack();
  await expect(nav.getByRole("button", { name: "Reports & Analytics", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(nav.getByRole("button", { name: "Recycle Bin", exact: true })).toHaveAttribute("aria-current", "page");
});

test("React Router direct record fallbacks and technician restrictions remain enforced", async ({ page }) => {
  await login(page, { username: "technician", pathname: "/jobs/new" });
  await expect(page.getByText("You do not have permission to create jobs.")).toBeVisible();
  for (const pathname of ["/customers/new", customerPath, `${customerPath}/sites/demo-site-front-entry/edit`, "/maintenance/new", "/maintenance/router-smoke-plan/edit", "/jobs/demo-job-1001/quote", "/jobs/demo-job-1001/invoice"]) {
    await page.goto(baseUrl + pathname);
    await expect(page.getByText(/You do not have permission/)).toBeVisible();
  }
  await page.goto(baseUrl + "/jobs/demo-job-1001");
  await page.getByRole("button", { name: "Back to Service Board", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/");
});

test("React Router direct nested pages use deterministic Back destinations", async ({ page }) => {
  await login(page, { pathname: customerPath });
  await expect(page.locator(".record-workspace")).toBeVisible();
  const sitePath = `${customerPath}/sites/demo-site-front-entry`;
  for (const [from, to, label] of [
    [sitePath + "/edit", sitePath, "Site Profile"], [sitePath, customerPath, "Customer Profile"],
    [customerPath + "/sites/new", customerPath, "Customer Profile"],
    [customerPath + "/edit", customerPath, "Customer Profile"], [customerPath, "/customers", "Customers"],
    ["/jobs/demo-job-1001/invoice", "/jobs/demo-job-1001", "Job #1001"],
    ["/jobs/demo-job-1001", "/", "Service Board"], ["/jobs/new", "/", "Service Board"],
    ["/maintenance/new", "/maintenance", "Maintenance"],
  ]) {
    await page.goto(baseUrl + from);
    await page.getByRole("button", { name: `Back to ${label}`, exact: true }).click();
    await expect(page).toHaveURL(baseUrl + to);
  }
});

test("short secondary pages do not scroll and their header remains edge to edge while long pages scroll", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390) await login(page, { pathname: `/customers/${emptyCustomerId}` });
    else await page.goto(`${baseUrl}/customers/${emptyCustomerId}`);
    await expect(page.locator(".record-workspace h1")).toHaveText("Empty sections customer");
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    const header = page.locator(".record-workspace-header");
    const before = await header.boundingBox();
    expect(before.y).toBe(0);
    expect(before.x + before.width).toBeCloseTo(width, 0);
    expect(await header.evaluate(el => getComputedStyle(el).borderRadius)).toBe("0px");
    await page.goto(`${baseUrl}/customers/${denseCustomerId}`);
    if (width < 1024) await page.getByRole("tab", { name: /^Job History/ }).click();
    await page.evaluate(() => scrollTo(0, 800));
    expect((await header.boundingBox()).y).toBe(0);
  }
});
const screenshots = path.join(repoRoot, "test-results/customer-section-consistency/screenshots");

async function showCustomerSection(page, label) {
  if (page.viewportSize().width < 1024) await page.getByRole("tab", { name: new RegExp("^" + label) }).click();
  else await expect(page.getByRole("tab")).toHaveCount(0);
  const section = { Overview: "details", Sites: "sites", Contacts: "contacts", "Job History": "jobs" }[label];
  await expect(page.locator(`[data-customer-section="${section}"]`)).toBeVisible();
}

async function checkCustomerGrid(page) {
  await expect(page.locator(".customer-workspace-grid")).toBeVisible();
  await expect(page.getByRole("tab", { includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("tabpanel", { includeHidden: true })).toHaveCount(0);
  await expect(page.locator('[data-customer-section]')).toHaveCount(6);
  const boxes = {};
  await expect(page.locator('[data-account-balance]')).toBeVisible();
  for (const name of ["details", "sites", "contacts", "account", "maintenance", "jobs"]) boxes[name] = await page.locator(`[data-customer-section="${name}"]`).boundingBox();
  expect(boxes.details.x).toBeCloseTo(boxes.contacts.x, 0);
  expect(boxes.sites.x).toBeCloseTo(boxes.jobs.x, 0);
  expect(boxes.details.y).toBeCloseTo(boxes.account.y, 0);
  expect(boxes.contacts.y - boxes.details.y - boxes.details.height).toBeCloseTo(12, 0);
  expect(boxes.sites.y - boxes.account.y - boxes.account.height).toBeCloseTo(12, 0);
  expect(boxes.maintenance.y - boxes.sites.y - boxes.sites.height).toBeCloseTo(12, 0);
  expect(boxes.jobs.y - boxes.maintenance.y - boxes.maintenance.height).toBeCloseTo(12, 0);
  expect(boxes.sites.x - boxes.details.x - boxes.details.width).toBeCloseTo(12, 0);
  expect(boxes.details.width / boxes.sites.width).toBeCloseTo(2 / 3, 2);
  await expect(page.locator('[data-customer-section="details"]').getByRole("button", { name: "Delete Customer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Destructive customer actions" }).getByRole("button", { name: "Delete Customer", exact: true })).toBeVisible();
  const header = await page.locator('.record-workspace-header').boundingBox();
  const grid = await page.locator('.customer-workspace-grid').boundingBox();
  expect(header.y).toBe(0);
  expect(grid.x).toBeGreaterThan(header.x);
  expect(grid.x + grid.width).toBeLessThan(header.x + header.width);
  expect(header.x + header.width).toBeCloseTo(page.viewportSize().width, 0);
  const danger = await page.locator('[data-customer-danger-zone]').boundingBox();
  expect(danger.y - grid.y - grid.height).toBeCloseTo(12, 0);
  await expect(page.locator('.customer-section-panel')).toHaveCount(6);
  const styles = await page.locator('.customer-section-panel').evaluateAll((panels) => panels.map((panel) => {
    const style = getComputedStyle(panel);
    const header = panel.querySelector('.customer-section-header');
    return {
      background: style.backgroundColor, border: style.border, radius: style.borderRadius,
      headerPadding: getComputedStyle(header).padding, headerHeight: header.getBoundingClientRect().height,
      bodyPadding: getComputedStyle(panel.querySelector('.customer-section-body')).padding,
      titleInsideHeader: header.contains(panel.querySelector('h2')),
    };
  }));
  for (const style of styles) { expect(style.border).toBe(styles[0].border); expect(style.background).toBe(styles[0].background); expect(style.titleInsideHeader).toBe(true); }
  expect(styles[0].border).toMatch(/^1px solid/);
  expect(styles[0].radius).toBe("8px");
  expect(styles[0].headerHeight).toBe(44);
  expect(styles[0].titleInsideHeader).toBe(true);
  expect(styles[0].bodyPadding).toBe("10px 12px");
  await expect(page.locator('[data-customer-section="sites"] .customer-section-header').getByRole("button", { name: "Add Site", exact: true })).toBeVisible();
  await expect(page.locator('.customer-section-header .customer-section-count')).toHaveCount(3);
  await expect(page.locator('[data-customer-section="jobs"] [data-customer-job-stats]')).toContainText('total jobs');
  await expect(page.locator('[data-customer-section="details"]')).not.toContainText('total jobs');
  const recordStyles = await page.locator('.customer-section-panel [data-mobile-record-card]').evaluateAll((records) => records.map((record) => {
    const style = getComputedStyle(record);
    return { border: style.borderLeftWidth, radius: style.borderRadius, background: style.backgroundColor, shadow: style.boxShadow };
  }));
  for (const style of recordStyles) expect(style).toEqual({ border: "0px", radius: "0px", background: "rgba(0, 0, 0, 0)", shadow: "none" });
  await expect(page.locator('.record-workspace-header').getByRole("button", { name: "Edit Customer", exact: true })).toBeVisible();
  const scrollers = await page.locator('[data-customer-workspace] *').evaluateAll((elements) => elements.filter((element) =>
    /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1).length);
  expect(scrollers).toBe(0);
  await noModalOrOverflow(page);
  return boxes;
}

async function noModalOrOverflow(page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  const width = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, root: document.querySelector("#root").scrollWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport + 1);
  expect(width.root).toBeLessThanOrEqual(width.viewport + 1);
  const workspace = await page.locator(".record-workspace").evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
  expect(workspace.content).toBeLessThanOrEqual(workspace.width + 1);
}

async function captureWorkspace(page, info, name) {
  fs.mkdirSync(screenshots, { recursive: true });
  const filename = path.join(screenshots, name + ".png");
  await page.screenshot({ path: filename, animations: "disabled" });
  await info.attach(name, { path: filename, contentType: "image/png" });
}

test("Customer pages support list entry, tabs, refresh and browser Back/Forward", async ({ page }) => {
  await login(page, { pathname: "/customers" });
  await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
  await page.getByRole('group', { name: `Open profile for ${unrelatedCustomerName}`, exact: true }).dblclick();
  await expect(page).toHaveURL(baseUrl + customerPath);
  await noModalOrOverflow(page);
  await page.reload();
  await expect(page.locator(".record-workspace h1")).toHaveText(unrelatedCustomerName);
  for (const tab of ["Sites", "Contacts", "Job History", "Overview"]) {
    await showCustomerSection(page, tab);
  }
  await page.getByRole("button", { name: "Edit Customer", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + customerPath + "/edit");
  await page.reload();
  await expect(page.getByLabel("Customer / company name")).toHaveValue(unrelatedCustomerName);
  await page.goBack();
  await expect(page).toHaveURL(baseUrl + customerPath);
  await page.goBack();
  await expect(page).toHaveURL(baseUrl + "/customers");
  await page.goForward();
  await expect(page).toHaveURL(baseUrl + customerPath);
  await page.goForward();
  await expect(page).toHaveURL(baseUrl + customerPath + "/edit");
  await noModalOrOverflow(page);
});

test("Customer create and edit persist account, contact and primary Site ownership", async ({ page }) => {
  const tracker = trackBroadWorkspacePuts(page);
  const updates = [];
  page.on("request", (request) => { if (request.method() === "PATCH" && /\/api\/customers\/[^/]+$/.test(new URL(request.url()).pathname)) updates.push(request.postDataJSON()); });
  await login(page, { pathname: "/customers" });
  await page.getByRole("button", { name: "New Customer", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/customers/new");
  await expect(page.getByRole("button", { name: "Create Customer", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Postal address is the same as the main address" })).toBeChecked();
  await expect(page.getByLabel("Postal address", { exact: true })).toHaveCount(0);
  await page.getByLabel("Customer / company name").fill("Workspace Customer");
  await page.getByLabel("Account email").fill("workspace@example.test");
  await page.getByLabel("Account phone").fill("0400 123 456");
  await page.getByRole("combobox", { name: "Customer type", exact: true }).click();
  await page.getByRole("option", { name: "Business", exact: true }).click();
  await page.getByLabel("Address", { exact: true }).fill("28 Synthetic Road, Testville VIC 3999");
  await page.getByLabel("Primary site type").click();
  await page.getByRole("option", { name: "Commercial", exact: true }).click();
  await page.getByLabel("OC number", { exact: true }).fill("PS-WORKSPACE");
  await page.getByRole("button", { name: "Create Customer", exact: true }).click();
  await expect(page.locator(".record-workspace h1")).toHaveText("Workspace Customer");
  const created = readWorkspaceState().customers.find((customer) => customer.name === "Workspace Customer");
  expect(created.sites[0]).toMatchObject({ address: "28 Synthetic Road, Testville VIC 3999", siteType: "commercial", ocNumber: "PS-WORKSPACE" });
  expect(created.primaryOcNumber).toBeUndefined();
  expect(created.ocNumber).toBeUndefined();
  expect(created.postalAddressSameAsPrimary).toBe(true);
  expect(created.postalAddress).toBe(created.address);
  await page.reload();
  await page.getByRole("button", { name: "Edit Customer", exact: true }).click();
  await page.getByLabel("Customer / company name").fill("");
  await expect(page.getByRole("button", { name: "Save Customer", exact: true })).toBeEnabled();
  await page.getByLabel("Customer / company name").fill("Workspace Customer Updated");
  await page.getByRole("button", { name: "Add Contact", exact: true }).click();
  await page.getByRole("button", { name: "New contact", exact: true }).click();
  const contact = page.locator('[aria-label="Customer contact management"] section').last();
  await contact.getByLabel("Name", { exact: true }).fill("Billing Person");
  await contact.getByLabel("Email", { exact: true }).fill("billing@example.test");
  await contact.getByLabel("Roles at this customer", { exact: true }).fill("Accounts");
  await contact.getByRole("checkbox", { name: "Billing contact", exact: true }).check();
  await page.getByRole("button", { name: "Save Customer", exact: true }).click();
  await expect(page.locator(".record-workspace h1")).toHaveText("Workspace Customer Updated");
  await page.reload();
  const saved = readWorkspaceState().customers.find((customer) => customer.id === created.id);
  expect(saved.sites).toEqual(created.sites);
  expect(saved.address).toBe(created.address);
  expect(saved.contacts.find((entry) => entry.id === saved.billingContactId)).toMatchObject({ name: "Billing Person", email: "billing@example.test", role: "Accounts" });
  expect(updates).toHaveLength(1);
  expect(updates[0].customer.sites).toBeUndefined();
  expect(updates[0].customer.address).toBeUndefined();
  await showCustomerSection(page, "Contacts");
  await expect(page.locator('[data-customer-section="contacts"]')).toContainText("Billing Person");
  await expect(page.locator('[data-customer-section="contacts"]')).toContainText("Billing");
  await page.getByRole("button", { name: "Back to Customers", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/customers");
  await tracker.expectNone("Customer page writes stay record-specific");
  tracker.stop();
});

test("Customer and Site links return to their origin and retain the selected tab", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await login(page, { pathname: customerPath });
  await page.getByRole("tab", { name: /^Sites/ }).click();
  await page.getByRole("button", { name: "Open Site Profile", exact: true }).first().click();
  await expect(page).toHaveURL(/\/customers\/[^/]+\/sites\/[^/]+$/);
  const siteUrl = page.url();
  await page.reload();
  await noModalOrOverflow(page);
  await page.getByRole("tab", { name: /^Job History/ }).click();
  await page.getByRole("button", { name: "Open Job #1001", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
  await page.getByRole("button", { name: "Back to Site Profile", exact: true }).click();
  await expect(page).toHaveURL(siteUrl);
  await expect(page.getByRole("tab", { name: /^Job History/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Back to Customer Profile", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + customerPath);
  await expect(page.getByRole("tab", { name: /^Sites/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /^Job History/ }).click();
  await page.getByRole("button", { name: "Open Job #1001", exact: true }).click();
  await page.getByRole("button", { name: "Open customer profile", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + customerPath);
  await page.getByRole("button", { name: "Back to Job #1001", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
});

test("Customer dirty forms guard Cancel, browser Back and reload without losing edits", async ({ page }) => {
  await login(page, { pathname: "/customers" });
  await page.getByRole("button", { name: "New Customer", exact: true }).click();
  const field = page.getByLabel("Customer / company name");
  await field.fill("Unsaved Customer");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await prompt.getByRole("button", { name: "Keep editing" }).click();
  await expect(field).toHaveValue("Unsaved Customer");
  await page.goBack();
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(baseUrl + "/customers/new");
  const unload = page.waitForEvent("dialog");
  const reload = page.reload().catch(() => null);
  const dialog = await unload;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reload;
  await expect(field).toHaveValue("Unsaved Customer");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await prompt.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/customers");
  await page.goForward();
  await expect(field).toHaveValue("");
  await page.goto(baseUrl + customerPath + "/edit");
  const original = await field.inputValue();
  await field.fill(original + " change");
  await page.getByRole("button", { name: "Back to Customer Profile", exact: true }).click();
  await prompt.getByRole("button", { name: "Keep editing" }).click();
  await expect(prompt).toHaveCount(0);
  await field.fill(original);
  await expect(field).toHaveValue(original);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + customerPath);
  await expect(prompt).toHaveCount(0);
});

test("Customer save errors retain the draft and delete requires the existing confirmation", async ({ page }) => {
  await login(page, { pathname: customerPath + "/edit" });
  await page.getByLabel("Customer / company name").fill("Unpersisted Customer");
  await page.route("**/api/customers/" + fixtureCustomerId, (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 409, json: { error: "Synthetic update conflict" } }) : route.continue());
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Save Customer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await expect(page.getByLabel("Customer / company name")).toHaveValue("Unpersisted Customer");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  const { result } = await apiJson(page, "POST", "/api/customers", { customer: { name: "Delete Confirmation Customer" } });
  await page.goto(baseUrl + "/customers/" + result.id);
  const confirmation = page.waitForEvent("dialog");
  const deleteClick = page.getByRole("button", { name: "Delete Customer", exact: true }).click();
  const cancelDialog = await confirmation;
  expect(cancelDialog.message()).toContain("Delete Confirmation Customer");
  await cancelDialog.dismiss();
  await deleteClick;
  await page.reload();
  await expect(page.locator(".record-workspace h1")).toHaveText("Delete Confirmation Customer");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Customer", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + "/customers");
  expect(readWorkspaceState().customers.some((entry) => entry.id === result.id)).toBe(false);
});

for (const width of [1440, 390]) {
  test(`postal address, editable primary site and linked maintenance contracts at ${width}px`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const page = await context.newPage();
    const id = `profile-features-${width}`, siteId = `${id}-primary`, otherSiteId = `${id}-other`;
    const mainAddress = "101 Main Road, Example VIC 3000", newAddress = "102 Main Road, Example VIC 3000";
    try {
      await login(page, { pathname: "/customers" });
      await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
      await apiJson(page, "POST", "/api/customers", { customer: { id, name: `Profile features ${width}`, address: mainAddress,
        sites: [{ id: siteId, address: mainAddress, siteType: "commercial", ocNumber: "PS-ORIGINAL", assets: [{ id: `${id}-gate`, name: "Existing gate" }] },
          { id: otherSiteId, address: "201 Other Road, Example VIC 3000" }] } });
      for (const [key, active, contractSite] of [["active", true, siteId], ["inactive", false, siteId], ["other", true, otherSiteId]]) {
        await apiJson(page, "POST", "/api/maintenance-plans", { plan: { id: `${id}-${key}`, customerId: id, siteId: contractSite,
          frequency: "quarterly", nextDueDate: "2026-12-01", active, contractPrice: 125, contractPriceSet: true, estimatedDurationHours: 1, checklist: ["Inspect gate"] } });
      }
      await page.goto(`${baseUrl}/customers/${id}/edit`);
      await expect(page.getByLabel("Address", { exact: true })).toHaveValue(mainAddress);
      await expect(page.getByRole("checkbox", { name: "Postal address is the same as the main address" })).toBeChecked();
      await page.getByRole("checkbox", { name: "Postal address is the same as the main address" }).uncheck();
      await page.getByLabel("Postal address", { exact: true }).fill("PO Box 42, Example VIC 3000");
      await page.getByLabel("Address", { exact: true }).fill(newAddress);
      await page.getByLabel("OC number", { exact: true }).fill("PS-UPDATED");
      await page.getByRole("button", { name: "Save Customer", exact: true }).click();
      await expect(page).toHaveURL(`${baseUrl}/customers/${id}`);
      await page.reload();
      const saved = readWorkspaceState().customers.find((customer) => customer.id === id);
      expect(saved).toMatchObject({ address: newAddress, postalAddressSameAsPrimary: false, postalAddress: "PO Box 42, Example VIC 3000" });
      expect(saved.sites.find((site) => site.id === siteId)).toMatchObject({ address: newAddress, ocNumber: "PS-UPDATED", assets: [{ id: `${id}-gate`, name: "Existing gate" }] });
      if (width < 1024) await page.getByRole("tab", { name: /^Maintenance/ }).click();
      await expect(page.locator("[data-profile-maintenance]")).toHaveCount(3);
      await expect(page.locator(`[data-profile-maintenance="${id}-inactive"]`)).toContainText("Inactive");
      await noModalOrOverflow(page);
      await captureWorkspace(page, info, `customer-contracts-${width}`);
      await page.locator(`[data-profile-maintenance="${id}-active"]`).getByRole("button", { name: "Open contract" }).click();
      await expect(page).toHaveURL(`${baseUrl}/maintenance/${id}-active`);
      await page.goto(`${baseUrl}/customers/${id}/sites/${siteId}`);
      await page.getByRole("tab", { name: /^Maintenance/ }).click();
      await expect(page.locator("[data-profile-maintenance]")).toHaveCount(2);
      await expect(page.locator(`[data-profile-maintenance="${id}-other"]`)).toHaveCount(0);
      await noModalOrOverflow(page);
      await captureWorkspace(page, info, `site-contracts-${width}`);
      await page.goto(`${baseUrl}/customers/${id}/edit`);
      await expect(page.getByRole("checkbox", { name: "Postal address is the same as the main address" })).not.toBeChecked();
      await expect(page.getByLabel("Postal address", { exact: true })).toHaveValue("PO Box 42, Example VIC 3000");
      await page.getByRole("checkbox", { name: "Postal address is the same as the main address" }).check();
      await page.getByRole("button", { name: "Save Customer", exact: true }).click();
      await expect(page).toHaveURL(`${baseUrl}/customers/${id}`);
      expect(readWorkspaceState().customers.find((customer) => customer.id === id).postalAddress).toBe(newAddress);
    } finally { await context.close(); }
  });
}

test("Customer and Site pages fill desktop, tablet and phone workspaces", async ({ browser }, info) => {
  for (const [width, height] of [[390,844], [430,932], [768,1024], [820,1180], [1024,768], [1280,720], [1440,900], [1920,1080]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1024, isMobile: width < 768 });
    const page = await context.newPage();
    const tracker = trackBroadWorkspacePuts(page);
    try {
      await login(page, { pathname: customerPath });
      await expect(page.locator(".record-workspace h1")).toHaveText(unrelatedCustomerName);
      if (width >= 1024) await expect(page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Customers", exact: true })).toHaveAttribute("aria-current", "page");
      await page.evaluate(() => document.fonts.ready);
      await noModalOrOverflow(page);
      await captureWorkspace(page, info, `profile-${width}x${height}`);
      for (const label of ["Sites", "Contacts", "Job History"]) {
        await showCustomerSection(page, label);
        await noModalOrOverflow(page);
        if (width < 1024) {
          await expect(page.locator('.customer-section-panel')).toHaveCount(0);
          await expect(page.locator('[data-customer-danger-zone]')).toHaveCount(0);
          await expect(page.getByRole("tabpanel")).toHaveCount(1);
          await expect(page.locator('[data-customer-section]')).toHaveCount(1);
          await captureWorkspace(page, info, `${label.toLowerCase().replace(" ", "-")}-${width}x${height}`);
        }
      }
      if (width >= 1024) await checkCustomerGrid(page);
      await showCustomerSection(page, "Sites");
      await page.getByRole("button", { name: "Open Site Profile", exact: true }).first().click();
      await noModalOrOverflow(page);
      await captureWorkspace(page, info, `site-profile-${width}x${height}`);
      await page.getByRole("button", { name: "Edit Site Profile", exact: true }).click();
      await expect(page).toHaveURL(/\/sites\/[^/]+\/edit$/);
      await page.reload();
      await expect(page.getByRole("button", { name: "Save Site Profile", exact: true })).toBeVisible();
      await noModalOrOverflow(page);
      await captureWorkspace(page, info, `site-edit-${width}x${height}`);
      await page.goto(baseUrl + customerPath + "/edit");
      await expect(page.getByLabel("Customer / company name")).toHaveValue(unrelatedCustomerName);
      await noModalOrOverflow(page);
      if (width >= 1024) await page.getByRole("button", { name: "Save Customer", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Save Customer", exact: true })).toBeInViewport();
      await page.evaluate(() => window.scrollTo(0, 0));
      await captureWorkspace(page, info, `edit-${width}x${height}`);
      await page.goto(baseUrl + "/customers/new");
      await noModalOrOverflow(page);
      await page.getByRole("button", { name: "Create Customer", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Create Customer", exact: true })).toBeInViewport();
      await page.evaluate(() => window.scrollTo(0, 0));
      await captureWorkspace(page, info, `create-${width}x${height}`);
      expect(tracker.requests).toEqual([]);
    } finally { tracker.stop(); await context.close(); }
  }
});

test("Site creation, assets, editing and dirty guards keep records and history intact", async ({ page }) => {
  const tracker = trackBroadWorkspacePuts(page);
  await login(page, { pathname: customerPath });
  const before = readWorkspaceState().customers.find((entry) => entry.id === fixtureCustomerId);
  await showCustomerSection(page, "Sites");
  await page.getByRole("button", { name: "Add Site", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + customerPath + "/sites/new");
  await expect(page.getByRole("button", { name: "Save Site Profile", exact: true })).toBeDisabled();
  await page.getByPlaceholder("Search this site address").fill("30 Synthetic Avenue, Testville VIC 3999");
  await page.getByPlaceholder("e.g. PS123456").fill("OC-SITE-WORKSPACE");
  await page.getByRole("tab", { name: /^Gates/ }).click();
  await page.getByPlaceholder("Name", { exact: true }).fill("Synthetic entry gate");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByPlaceholder("Name", { exact: true })).toHaveValue("Synthetic entry gate");
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Add the gate or project before saving");
  await page.getByRole("button", { name: "Add Gate / Project", exact: true }).click();
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  const siteUrl = page.url();
  await page.reload();
  await page.getByRole("tab", { name: /^Gates/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Synthetic entry gate");
  await page.getByRole("button", { name: "Edit Site Profile", exact: true }).click();
  await expect(page).toHaveURL(siteUrl + "/edit");
  await page.reload();
  await page.getByPlaceholder("Search this site address").fill("32 Synthetic Avenue, Testville VIC 3999");
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page).toHaveURL(siteUrl);
  await page.reload();
  await expect(page.locator(".record-workspace h1")).toHaveText("32 Synthetic Avenue, Testville VIC 3999");
  await page.getByRole("button", { name: "Back to Customer Profile", exact: true }).click();
  await expect(page).toHaveURL(baseUrl + customerPath);
  await showCustomerSection(page, "Sites");
  const after = readWorkspaceState().customers.find((entry) => entry.id === fixtureCustomerId);
  const saved = after.sites.find((site) => site.address.startsWith("32 Synthetic"));
  expect(saved).toMatchObject({ ocNumber: "OC-SITE-WORKSPACE", assets: [expect.objectContaining({ name: "Synthetic entry gate" })] });
  expect(after.address).toBe(before.address);
  // Owner saves refresh assignment write times; person/site details and the
  // relationship IDs, roles, flags and creation times must stay unchanged.
  for (const contact of before.contacts) expect(after.contacts).toContainEqual(contact);
  const stableSites = (sites) => sites.map((site) => ({ ...site, contactAssignments: site.contactAssignments.map((assignment) => ({ ...assignment, updatedAt: null })) }));
  expect(stableSites(after.sites.filter((site) => site.id !== saved.id))).toEqual(stableSites(before.sites));
  await tracker.expectNone("Site pages use record-specific writes");
  tracker.stop();
});

test("Customer deep links retain authorization and missing records show a normal page", async ({ browser }) => {
  for (const username of ["office", "technician"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, { username, pathname: customerPath + "/edit" });
      if (username === "office") await expect(page.getByLabel("Customer / company name")).toHaveValue(unrelatedCustomerName);
      else {
        await expect(page.getByText("You do not have permission to view customer records.")).toBeVisible();
        await expect(page.getByLabel("Customer / company name")).toHaveCount(0);
        const response = await page.request.patch(baseUrl + "/api/customers/" + fixtureCustomerId, { data: { customer: { name: "Unauthorized" } } });
        expect(response.status()).toBe(403);
      }
      await noModalOrOverflow(page);
    } finally { await context.close(); }
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, { pathname: "/customers/missing-customer" });
    await expect(page.getByText("This customer could not be found.")).toBeVisible();
    await page.getByRole("button", { name: "Back to Customers", exact: true }).click();
    await expect(page).toHaveURL(baseUrl + "/customers");
    await page.goto(baseUrl + customerPath + "/sites/missing-site");
    await expect(page.getByText("This site could not be found.")).toBeVisible();
    await page.getByRole("button", { name: "Back to Customer Profile", exact: true }).click();
    await expect(page).toHaveURL(baseUrl + customerPath);
  } finally { await context.close(); }
});

test("Customer layout switches without losing mobile tabs, history or keyboard access", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, { pathname: customerPath });
  const sitesTab = page.getByRole("tab", { name: /^Sites/ });
  await sitesTab.focus();
  await page.keyboard.press("Enter");
  await expect(sitesTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Contacts/ })).toHaveAttribute("aria-selected", "true");
  const savedState = await page.evaluate(() => history.state);
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkCustomerGrid(page);
  expect(await page.evaluate(() => history.state)).toEqual(savedState);
  await page.getByRole("list", { name: "Customer sites", exact: true }).getByRole("listitem")
    .filter({ hasText: "10 Example Lane, Sampleton VIC 3000" }).getByRole("button", { name: "Open Site Profile", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sites\/[^/]+$/);
  await page.goBack();
  await checkCustomerGrid(page);
  await page.getByRole("button", { name: "Open Job #1001", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(baseUrl + "/jobs/demo-job-1001");
  await page.goBack();
  await page.reload();
  await checkCustomerGrid(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByRole("tab", { name: /^Contacts/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(page.locator('[data-customer-section]')).toHaveCount(1);
  await page.setViewportSize({ width: 1024, height: 768 });
  await checkCustomerGrid(page);
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(page.getByRole("tab", { name: /^Contacts/ })).toHaveAttribute("aria-selected", "true");
});

test("Customer layout handles empty sections, long text and many uncapped records at all sizes", async ({ page }, info) => {
  await login(page, { pathname: `/customers/${denseCustomerId}` });
  const before = readWorkspaceState();
  const writes = [];
  page.on("request", (request) => { if (/\/api\//.test(request.url()) && ["PUT", "PATCH", "POST", "DELETE"].includes(request.method())) writes.push(request.url()); });
  for (const [width, height] of [[390,844], [430,932], [768,1024], [820,1180], [1024,768], [1280,720], [1440,900], [1920,1080]]) {
    await page.setViewportSize({ width, height });
    for (const [kind, customerId] of [["many", denseCustomerId], ["empty", emptyCustomerId]]) {
      await page.goto(baseUrl + `/customers/${customerId}`);
      await expect(page.locator('[data-customer-workspace]')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (width >= 1024) {
        const boxes = await checkCustomerGrid(page);
        if (kind === "many") expect(boxes.contacts.y).toBeLessThan(boxes.jobs.y);
        else for (const name of ["sites", "contacts", "jobs"]) expect(boxes[name].height).toBeLessThan(150);
      }
      await captureWorkspace(page, info, `${kind}-${width}x${height}`);
      for (const [label, section, records] of [["Sites", "sites", 8], ["Contacts", "contacts", 12], ["Job History", "jobs", 16]]) {
        await showCustomerSection(page, label);
        const content = page.locator(`[data-customer-section="${section}"]`);
        await expect(content.locator(section === "contacts" ? '[data-contact-id]' : '[data-mobile-record-card]')).toHaveCount(kind === "many" ? records : 0);
        await noModalOrOverflow(page);
        if (kind === "many") {
          const finalRecord = content.locator(section === "contacts" ? '[data-contact-id]' : '[data-mobile-record-card]').last();
          await finalRecord.scrollIntoViewIfNeeded();
          await expect(finalRecord).toBeInViewport();
        } else await expect(content).toContainText(/No (sites|contacts|jobs)/);
      }
      if (kind === "many") await captureWorkspace(page, info, `many-bottom-${width}x${height}`);
    }
  }
  expect(writes).toEqual([]);
  expect(readWorkspaceState()).toEqual(before);
});

const siteContactLinks = (customer) => customer.sites.map((site) => ({ id: site.id, assignments: site.contactAssignments.map(({ contactId, roles, isPrimary }) => ({ contactId, roles, isPrimary })) }));

for (const width of [390, 820, 1440]) test(`Customer editor shows Site-only identities and keeps assignment drafts separate at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await login(page, { pathname: "/customers" });
  const id = `site-editor-${width}`, person = `${id}-person`, duplicate = `${id}-duplicate`, phone1 = `${id}-phone-one`, phone2 = `${id}-phone-two`;
  const identities = [
    { id: person, name: "Alex Example", phone: "0418330319", email: "north@example.test", position: "North caretaker" },
    { id: duplicate, name: "Alex Example", phone: "0418330319", email: "south@example.test", position: "South caretaker" },
    { id: phone1, name: "", phone: "0418330319", notes: "North phone-only identity" },
    { id: phone2, name: "", phone: "0418330319", notes: "South phone-only identity" },
  ];
  for (const contact of identities) await apiJson(page, "POST", "/api/contacts", contact);
  await apiJson(page, "POST", "/api/customers", { id, name: `Site-only editor ${width}`, email: "accounts@example.test", phone: "0400 000 001", contactAssignments: [],
    sites: [
      { id: `${id}-north`, label: `Main site ${"LongSiteNameWithoutSpaces".repeat(10)}`, address: "10 Synthetic Street", contactAssignments: [
        { contactId: person, roles: ["Caretaker"], isPrimary: true }, { contactId: phone1, roles: ["Site contact"] },
      ] },
      { id: `${id}-south`, label: "South entrance", address: "20 Synthetic Street", contactAssignments: [
        { contactId: person, roles: ["Building Manager"] }, { contactId: duplicate, roles: ["Site contact"], isPrimary: true }, { contactId: phone2, roles: ["Site contact"] },
      ] },
    ] });
  await apiJson(page, "POST", "/api/customers", { id: `${id}-other`, name: `Other contact owner ${width}`, contactAssignments: [{ contactId: person, isBilling: true }] });
  const dbPath = path.join(tempDataDir, "elset-workspace.db"), db = openWorkspaceDb({ dbPath });
  let job;
  try { job = createJob(db, { customer: { id }, job: { title: `Saved contact snapshot ${width}`, jobAddress: "10 Synthetic Street", requesterContact: { id: person, name: "Alex Example", phone: "0418330319" } } }); }
  finally { db.close(); }
  const jobJson = () => { const recordDb = openWorkspaceDb({ dbPath, readonly: true, migrate: false }); try { return JSON.stringify(recordDb.prepare("SELECT requester_contact_json, onsite_contact_json, billing_contact_json, extra_json FROM jobs WHERE id=?").get(job.id)); } finally { recordDb.close(); } };
  const before = readWorkspaceState(), customer = before.customers.find((entry) => entry.id === id), snapshot = jobJson();
  const expectedIds = identities.map((contact) => contact.id).sort(), writes = [];
  page.on("request", (request) => { if (request.method() === "PATCH" && new URL(request.url()).pathname === `/api/customers/${id}`) writes.push(request.postDataJSON().customer); });
  const editor = page.locator('[aria-label="Customer contact management"]');
  const row = contactId => editor.locator(`[data-contact-id="${contactId}"]`);
  const profile = page.locator('[data-customer-section="contacts"]');
  const visual = async name => { await noModalOrOverflow(page); fs.mkdirSync(path.join(repoRoot, "test-results/customer-site-contacts"), { recursive: true }); await page.screenshot({ path: path.join(repoRoot, `test-results/customer-site-contacts/${name}-${width}.png`), fullPage: true }); };
  if (width === 820) await page.route("**/api/app-state", async route => {
    const response = await route.fetch(), payload = await response.json(); payload.state.contacts = [];
    await route.fulfill({ response, json: payload });
  });

  await page.goto(`${baseUrl}/customers/${id}`); await showCustomerSection(page, "Contacts");
  await expect(profile.locator("[data-contact-id]")).toHaveCount(4);
  expect((await profile.locator("[data-contact-id]").evaluateAll(elements => elements.map(element => element.dataset.contactId))).sort()).toEqual(expectedIds);
  await page.getByRole("button", { name: "Edit Customer", exact: true }).click();
  await expect(editor.locator("section[data-contact-id]")).toHaveCount(4);
  expect((await editor.locator("section[data-contact-id]").evaluateAll(elements => elements.map(element => element.dataset.contactId))).sort()).toEqual(expectedIds);
  await expect(editor.getByText("No contacts assigned.", { exact: true })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Remove from customer", exact: true })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Assign to customer", exact: true })).toHaveCount(4);
  await expect(editor.getByLabel("Roles at this customer", { exact: true })).toHaveCount(0);
  await expect(row(person)).toContainText("Site-only contact"); await expect(row(person).getByLabel("Assigned sites")).toContainText("Caretaker");
  await expect(row(person).getByLabel("Assigned sites")).toContainText("Primary"); await expect(row(person).getByLabel("Assigned sites")).toContainText("South entrance");
  await expect(row(duplicate)).toContainText("South caretaker"); await expect(row(phone1)).toContainText("0418330319"); await expect(row(phone2)).toContainText("0418330319");
  await visual("site-only");
  await row(person).getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(row(person)).toContainText("Changes to this person's details appear everywhere they are assigned. Saved job contacts stay unchanged.");
  await page.getByRole("button", { name: "Save Customer", exact: true }).click(); await expect(page.locator(".record-workspace h1")).toHaveText(customer.name);
  expect(writes.at(-1).contactAssignments).toEqual([]); expect(writes.at(-1)).not.toHaveProperty("contactUpdates"); expect(writes.at(-1)).not.toHaveProperty("sites");
  let saved = readWorkspaceState(); expect(saved.contacts).toEqual(before.contacts);
  expect(siteContactLinks(saved.customers.find((entry) => entry.id === id))).toEqual(siteContactLinks(customer)); expect(jobJson()).toBe(snapshot);

  await page.goto(`${baseUrl}/customers/${id}/edit`); await row(person).getByRole("button", { name: "Edit details", exact: true }).click();
  for (const [label, value] of [["Name", "Alex Updated"], ["Position", "Operations Director"], ["Phone", "0400 999 888"], ["Email", "updated@example.test"], ["Notes", "Updated shared identity"]]) await row(person).getByLabel(label, { exact: true }).fill(value);
  expect(readWorkspaceState().contacts).toEqual(before.contacts); expect(writes).toHaveLength(1);
  await noModalOrOverflow(page); await page.getByRole("button", { name: "Save Customer", exact: true }).click(); await expect(page.locator(".record-workspace h1")).toHaveText(customer.name);
  expect(writes.at(-1).contactAssignments).toEqual([]); expect(writes.at(-1).contactUpdates).toHaveLength(1);
  expect(Object.keys(writes.at(-1).contactUpdates[0]).sort()).toEqual(["id", "name", "position", "phone", "email", "notes"].sort());
  saved = readWorkspaceState(); expect(saved.contacts).toHaveLength(before.contacts.length);
  expect(saved.contacts.find((contact) => contact.id === person)).toMatchObject({ name: "Alex Updated", position: "Operations Director", phone: "0400 999 888", email: "updated@example.test", notes: "Updated shared identity" });
  expect(saved.contacts.find((contact) => contact.id === duplicate)).toEqual(before.contacts.find((contact) => contact.id === duplicate));
  expect(saved.customers.find((entry) => entry.id === `${id}-other`).contacts[0].name).toBe("Alex Updated");
  expect(saved.customers.find((entry) => entry.id === id).contactAssignments).toEqual([]); expect(jobJson()).toBe(snapshot);
  await showCustomerSection(page, "Contacts"); await expect(profile.locator(`[data-contact-id="${person}"]`)).toContainText("Alex Updated");

  await page.goto(`${baseUrl}/customers/${id}/edit`); await row(person).getByRole("button", { name: "Assign to customer", exact: true }).click();
  await expect(row(person)).toHaveCount(1); await expect(row(person)).toContainText("Customer contact"); await expect(row(person).getByLabel("Assigned sites")).toContainText("South entrance");
  await row(person).getByLabel("Roles at this customer", { exact: true }).fill("Property Manager");
  await row(person).getByRole("checkbox", { name: "Primary contact", exact: true }).check(); await row(person).getByRole("checkbox", { name: "Billing contact", exact: true }).check();
  await visual("customer-and-sites");
  await page.getByRole("button", { name: "Save Customer", exact: true }).click(); await expect(page.locator(".record-workspace h1")).toHaveText(customer.name);
  expect(writes.at(-1).contactAssignments.map(assignment => assignment.contactId)).toEqual([person]);
  saved = readWorkspaceState(); const assigned = saved.customers.find((entry) => entry.id === id);
  expect(assigned.contactAssignments).toHaveLength(1); expect(assigned.contactAssignments[0]).toMatchObject({ contactId: person, roles: ["Property Manager"], isPrimary: true, isBilling: true });
  expect(siteContactLinks(assigned)).toEqual(siteContactLinks(customer)); expect(saved.contacts).toHaveLength(before.contacts.length); expect(jobJson()).toBe(snapshot);
  await showCustomerSection(page, "Contacts"); await expect(profile.locator(`[data-contact-id="${person}"]`)).toContainText("Customer contact");
  for (const label of ["Primary", "Billing", "Property Manager"]) await expect(profile.locator(`[data-contact-id="${person}"]`)).toContainText(label);
  await page.goto(`${baseUrl}/customers/${id}/edit`); await row(person).getByRole("button", { name: "Remove from customer", exact: true }).click();
  await expect(row(person)).toHaveCount(1); await expect(row(person)).toContainText("Site-only contact"); await expect(row(person).getByRole("button", { name: "Assign to customer", exact: true })).toBeVisible();
  await expect(row(person).getByLabel("Roles at this customer", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save Customer", exact: true }).click(); await expect(page.locator(".record-workspace h1")).toHaveText(customer.name);
  saved = readWorkspaceState(); const removed = saved.customers.find((entry) => entry.id === id);
  expect(removed.contactAssignments).toEqual([]); expect(siteContactLinks(removed)).toEqual(siteContactLinks(customer)); expect(removed.email).toBe(customer.email); expect(removed.phone).toBe(customer.phone);
  expect(saved.contacts).toHaveLength(before.contacts.length); expect(identities.every(contact => saved.contacts.some(entry => entry.id === contact.id))).toBe(true); expect(jobJson()).toBe(snapshot);
});

test("empty Customer editor and direct-only contact drafts retain existing identity/save behaviour", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 }); await login(page, { pathname: "/customers" });
  const id = "direct-editor-customer", person = "direct-editor-person";
  await apiJson(page, "POST", "/api/contacts", { id: person, name: "Direct Editor Person", phone: "Original phone" });
  await apiJson(page, "POST", "/api/customers", { id, name: "Direct editor customer", contactAssignments: [], sites: [] });
  const editor = page.locator('[aria-label="Customer contact management"]'), row = editor.locator(`[data-contact-id="${person}"]`);
  const addPerson = async () => { await editor.getByRole("button", { name: "Add Contact", exact: true }).click(); await editor.getByRole("combobox", { name: "Search contacts", exact: true }).fill("Direct Editor Person"); await editor.getByRole("option", { name: /Direct Editor Person/ }).click(); };
  await page.goto(`${baseUrl}/customers/${id}/edit`); await expect(editor.getByText("No contacts assigned.", { exact: true })).toBeVisible();
  await addPerson(); await row.getByLabel("Phone", { exact: true }).fill("Cancelled draft"); await row.getByRole("button", { name: "Remove from customer", exact: true }).click();
  await expect(editor.getByText("No contacts assigned.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save Customer", exact: true }).click(); await expect(page.locator(".record-workspace h1")).toHaveText("Direct editor customer");
  expect(readWorkspaceState().contacts.find(contact => contact.id === person).phone).toBe("Original phone");
  await page.goto(`${baseUrl}/customers/${id}/edit`); await addPerson(); await row.getByLabel("Phone", { exact: true }).fill("Saved phone");
  await row.getByLabel("Roles at this customer", { exact: true }).fill("Property Manager"); await row.getByRole("checkbox", { name: "Primary contact", exact: true }).check(); await row.getByRole("checkbox", { name: "Billing contact", exact: true }).check();
  await noModalOrOverflow(page); await page.getByRole("button", { name: "Save Customer", exact: true }).click(); await expect(page.locator(".record-workspace h1")).toHaveText("Direct editor customer");
  await showCustomerSection(page, "Contacts"); const profile = page.locator('[data-customer-section="contacts"]');
  for (const label of ["Customer contact", "Primary", "Billing", "Property Manager", "Saved phone"]) await expect(profile).toContainText(label);
  await page.goto(`${baseUrl}/customers/${id}/edit`); await row.getByRole("button", { name: "Remove from customer", exact: true }).click(); await page.getByRole("button", { name: "Save Customer", exact: true }).click();
  await expect(page.locator(".record-workspace h1")).toHaveText("Direct editor customer"); expect(readWorkspaceState().contacts.some(contact => contact.id === person)).toBe(true);
  expect(readWorkspaceState().customers.find(customer => customer.id === id).contactAssignments).toEqual([]);
});

for (const width of [1440, 390]) test(`shared contact management works at ${width}px without overflow or losing site-only contacts`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await login(page, { pathname: "/customers" });
  const id = `contact-ui-${width}`, site1 = `${id}-one`, site2 = `${id}-two`, person = `${id}-shared`, siteOnly = `${id}-site-only`;
  await apiJson(page, "POST", "/api/contacts", { id: person, name: `Shared Person ${width}`, position: "Facilities Manager", phone: "0400 111 222", email: "shared@example.test" });
  await apiJson(page, "POST", "/api/contacts", { id: siteOnly, name: "Site Only Person", email: "siteonly@example.test" });
  await apiJson(page, "POST", "/api/customers", { customer: { id, name: `Contact UI ${width}`, email: "account@example.test",
    contactAssignments: [{ contactId: person, roles: ["Property Manager"], isPrimary: true, isBilling: true }],
    sites: [{ id: site1, label: "North entrance", address: "10 Contact St", contactAssignments: [{ contactId: person, roles: ["Caretaker"], isPrimary: true }, { contactId: siteOnly, roles: ["Emergency access"] }] }, { id: site2, label: "South entrance", address: "20 Contact St", contactAssignments: [] }] } });
  await page.goto(`${baseUrl}/customers/${id}`); await showCustomerSection(page, "Contacts");
  const display = page.locator('[data-customer-section="contacts"]');
  for (const label of ["Shared Person", "Facilities Manager", "Property Manager", "Primary", "Billing", "Site-only contact", "North entrance"]) await expect(display).toContainText(label);
  await page.getByRole("button", { name: "Edit Customer", exact: true }).click();
  const editor = page.locator('[aria-label="Customer contact management"]');
  await editor.locator(`[data-contact-id="${person}"]`).getByRole("button", { name: "Edit details" }).click();
  await editor.getByLabel("Phone", { exact: true }).fill("0400 999 888");
  await editor.getByRole("button", { name: "Add Contact", exact: true }).click();
  await editor.getByRole("button", { name: "New contact", exact: true }).click();
  const added = editor.locator("section").filter({ has: page.getByLabel("Name", { exact: true }) });
  await added.getByLabel("Name", { exact: true }).fill(`New Person ${width}`);
  await added.getByLabel("Position", { exact: true }).fill("Operations Director");
  await added.getByLabel("Email", { exact: true }).fill(`new-${width}@example.test`);
  await added.getByLabel("Notes", { exact: true }).fill("Call before attending");
  await added.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(added.getByLabel("Roles at this customer")).toHaveValue("Accounts");
  await added.getByLabel("Roles at this customer").fill("Accounts, Custom role " + "LongRole".repeat(12));
  await added.getByRole("checkbox", { name: "Primary contact", exact: true }).check();
  await added.getByRole("checkbox", { name: "Billing contact", exact: true }).check();
  await expect(editor.getByRole("checkbox", { name: "Primary contact", exact: true }).first()).not.toBeChecked();
  await noModalOrOverflow(page);
  await page.getByRole("button", { name: "Save Customer", exact: true }).click();
  await expect(page.locator(".record-workspace h1")).toHaveText(`Contact UI ${width}`);
  let saved = readWorkspaceState();
  const created = saved.contacts.filter((contact) => contact.name === `New Person ${width}`); expect(created).toHaveLength(1);
  expect(saved.customers.find((customer) => customer.id === id).contacts.filter((contact) => contact.isBilling)).toHaveLength(2);
  expect(saved.contacts.find((contact) => contact.id === person).phone).toBe("0400 999 888");

  await page.goto(`${baseUrl}/customers/${id}/sites/${site2}/edit`);
  await page.getByRole("tab", { name: /^Contacts/ }).click();
  const siteEditor = page.locator('[aria-label="Site contact management"]');
  await siteEditor.getByRole("button", { name: "Add Contact", exact: true }).click();
  await siteEditor.getByLabel("Search contacts").fill("Facilities Manager");
  await siteEditor.getByRole("option", { name: new RegExp(`Shared Person ${width}`) }).click();
  await siteEditor.getByRole("checkbox", { name: "Primary contact" }).check();
  await siteEditor.getByRole("button", { name: "Building Manager", exact: true }).click();
  await expect(siteEditor.getByLabel("Roles at this site")).toHaveValue("Building Manager");
  await noModalOrOverflow(page);
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  saved = readWorkspaceState(); expect(saved.contacts.filter((contact) => contact.id === person)).toHaveLength(1);
  expect(saved.customers.find((customer) => customer.id === id).sites.find((site) => site.id === site2).contacts[0]).toMatchObject({ id: person, phone: "0400 999 888", isPrimary: true });

  await page.goto(`${baseUrl}/customers/${id}/edit`);
  await page.locator('[aria-label="Customer contact management"] section').filter({ hasText: "Shared Person" }).getByRole("button", { name: "Remove from customer" }).click();
  await page.getByRole("button", { name: "Save Customer", exact: true }).click();
  await expect(page.locator(".record-workspace h1")).toHaveText(`Contact UI ${width}`);
  await showCustomerSection(page, "Contacts");
  const shared = page.locator(`[data-contact-id="${person}"]`);
  for (const label of ["Site-only contact", "North entrance", "South entrance", "Caretaker", "Building Manager"]) await expect(shared).toContainText(label);
  await noModalOrOverflow(page);
  await page.screenshot({ path: info.outputPath(`contacts-${width}.png`), fullPage: true });
});

test("job contact selectors group current customer/site/billing records and keep saved snapshots after later edits", async ({ page }) => {
  await login(page, { pathname: "/customers" });
  const person = "job-contact-primary", secondary = "job-contact-secondary", onsite = "job-contact-site";
  for (const [id, name, email] of [[person, "Primary Billing", "primary@example.test"], [secondary, "Second Billing", "second@example.test"], [onsite, "Site Supervisor", "supervisor@example.test"]]) await apiJson(page, "POST", "/api/contacts", { id, name, email, position: "Manager", phone: "123" });
  await apiJson(page, "POST", "/api/customers", { id: "job-contact-customer", name: "Contact Job Customer", email: "account@example.test",
    contactAssignments: [{ contactId: secondary, isBilling: true }, { contactId: person, isPrimary: true, isBilling: true }],
    sites: [{ id: "job-contact-site-one", address: "40 Snapshot Street", contactAssignments: [{ contactId: onsite, isPrimary: true, roles: ["Caretaker"] }] }] });
  await page.goto(`${baseUrl}/jobs/new`);
  await page.getByRole("textbox", { name: "Search customers" }).fill("Contact Job Customer");
  await page.locator('[aria-label="Customer search results"] button').click();
  await page.getByText("Job contacts (optional)", { exact: true }).click();
  await expect(page.getByRole("region", { name: "On-site contact", exact: true }).getByLabel("Name", { exact: true })).toHaveValue("Site Supervisor");
  await expect(page.getByRole("region", { name: "Billing contact", exact: true }).getByLabel("Name", { exact: true })).toHaveValue("Primary Billing");
  const requester = page.getByRole("region", { name: "Requester", exact: true }); await expect(requester.getByLabel("Name", { exact: true })).toHaveValue("");
  await requester.getByRole("combobox").click(); await page.getByRole("option", { name: "Second Billing", exact: true }).click();
  const billing = page.getByRole("region", { name: "Billing contact", exact: true });
  await billing.getByRole("combobox").focus(); await billing.getByRole("combobox").press("ArrowDown");
  await expect(page.getByRole("group", { name: "Billing contacts", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Job title").fill("Contact snapshot browser job"); await page.getByLabel("Description of work").fill("Historical contact snapshot coverage.");
  await page.getByRole("button", { name: "Create Job", exact: true }).click();
  await expect(page.locator(".record-workspace h1")).toHaveText("Contact snapshot browser job");
  const job = readWorkspaceState().jobs.find((entry) => entry.title === "Contact snapshot browser job");
  expect(job.requesterContact.id).toBe(secondary); expect(job.onsiteContact.id).toBe(onsite); expect(job.billingContact.id).toBe(person);
  await apiJson(page, "PATCH", `/api/contacts/${onsite}`, { phone: "999", position: "Director" });
  await page.reload(); expect(readWorkspaceState().jobs.find((entry) => entry.id === job.id).onsiteContact).toEqual(job.onsiteContact);
  const next = await apiJson(page, "POST", "/api/jobs", { customer: { id: "job-contact-customer" }, job: { title: "Updated new job", jobAddress: "40 Snapshot Street" } });
  expect(next.result.onsiteContact).toMatchObject({ phone: "999", position: "Director" });
});

for (const width of [1440, 390]) test(`Create Job separates saved sites from previous addresses and explicitly adds a site at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await login(page);
  const id = `site-ownership-${width}`, savedAddress = `${width} Saved St`, previousAddress = `${width} Previous St`;
  const person = `${id}-person`, billing = `${id}-billing`;
  const supervisorName = `Site Ownership Supervisor ${width}`;
  for (const [contactId, name] of [[person, supervisorName], [billing, "Ownership Billing"]]) {
    await apiJson(page, "POST", "/api/contacts", { id: contactId, name });
  }
  await apiJson(page, "POST", "/api/customers", { id, name: `Site Ownership ${width}`,
    contactAssignments: [{ contactId: billing, isBilling: true, isPrimary: true }],
    sites: [{ id: `${id}-saved`, address: savedAddress, contactAssignments: [{ contactId: person, isPrimary: true, roles: ["Caretaker"] }] }] });
  await apiJson(page, "POST", "/api/customers", { id: `${id}-foreign`, name: "Other address owner", sites: [{ address: previousAddress }] });
  const history = await apiJson(page, "POST", "/api/jobs", { customer: { id }, job: { title: "Historical site fixture", jobAddress: savedAddress } });
  await apiJson(page, "PATCH", `/api/jobs/${history.result.id}`, { jobAddress: previousAddress });
  const rejected = await page.request.post(`${baseUrl}/api/jobs`, { data: { customer: { id }, job: { title: "Unowned address", jobAddress: previousAddress } } });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error).toBe("Selected site does not belong to the customer.");
  const openCreate = async () => {
    await page.goto(`${baseUrl}/jobs/new`);
    await page.getByRole("textbox", { name: "Search customers" }).fill(`Site Ownership ${width}`);
    await page.locator('[aria-label="Customer search results"] button').click();
    await page.getByRole("button", { name: "Change site", exact: true }).click();
  };
  const save = async (title) => {
    await page.getByLabel("Job title").fill(title);
    await page.getByLabel("Description of work").fill("Create Job site ownership regression.");
    await page.getByRole("button", { name: "Create Job", exact: true }).click();
    await expect(page.locator(".record-workspace h1")).toHaveText(title);
    return readWorkspaceState().jobs.find((job) => job.title === title);
  };
  await openCreate();
  const saved = page.locator('[aria-label="Saved sites"]');
  await expect(saved.getByRole("button")).toHaveCount(1);
  await expect(saved).not.toContainText(previousAddress);
  await expect(page.getByRole("region", { name: "Previous job addresses" })).toContainText(previousAddress);
  await noModalOrOverflow(page);
  await page.screenshot({ path: test.info().outputPath(`create-job-sites-${width}.png`), fullPage: true });
  await saved.getByRole("button", { name: new RegExp(savedAddress) }).click();
  const savedJob = await save(`Saved site regression ${width}`);
  expect(savedJob.jobAddress).toBe(savedAddress);
  expect(savedJob.onsiteContact.id).toBe(person);
  expect(savedJob.billingContact.id).toBe(billing);
  expect(savedJob.requesterContact).toBeNull();
  await openCreate();
  await page.getByRole("button", { name: `Add as Site: ${previousAddress}`, exact: true }).click();
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue(previousAddress);
  await expect(page.getByText("This site will be added to the customer when you create the job.")).toBeVisible();
  await page.getByText("Job contacts (optional)", { exact: true }).click();
  await expect(page.getByRole("region", { name: "On-site contact", exact: true }).getByLabel("Name", { exact: true })).toHaveValue("");
  const editor = page.locator('#create-job-site [aria-label="Site contact management"]');
  await editor.getByRole("button", { name: "Add Contact", exact: true }).click();
  await editor.getByRole("combobox", { name: "Search contacts" }).fill(supervisorName);
  await editor.getByRole("option", { name: new RegExp(supervisorName) }).click();
  await editor.getByRole("checkbox", { name: "Primary contact" }).check();
  const requester = page.getByRole("region", { name: "Requester", exact: true });
  await requester.getByRole("combobox").click();
  await page.getByRole("option", { name: "Ownership Billing - Primary", exact: true }).click();
  const addedJob = await save(`Added previous site regression ${width}`);
  expect(addedJob.jobAddress).toBe(previousAddress);
  expect(addedJob.onsiteContact.id).toBe(person);
  expect(addedJob.billingContact.id).toBe(billing);
  expect(addedJob.requesterContact.id).toBe(billing);
  const customer = readWorkspaceState().customers.find((entry) => entry.id === id);
  expect(customer.sites).toHaveLength(2);
  expect(customer.sites.find((site) => site.address === previousAddress).contactAssignments[0]).toMatchObject({ contactId: person, isPrimary: true });
  await openCreate();
  await expect(saved).toContainText(previousAddress);
  await expect(page.getByRole("region", { name: "Previous job addresses" })).toHaveCount(0);
});

test("Create Job labels an inferred primary address separately and saves it without creating a site", async ({ page }) => {
  await login(page);
  const id = "inferred-primary-regression", address = "25 Primary Only St";
  await apiJson(page, "POST", "/api/customers", { id, name: "Inferred Primary Regression", address });
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db"), migrate: false });
  try { db.prepare("DELETE FROM sites WHERE customer_id=?").run(id); } finally { db.close(); }
  await page.goto(`${baseUrl}/jobs/new`);
  await page.getByRole("textbox", { name: "Search customers" }).fill("Inferred Primary Regression");
  await page.locator('[aria-label="Customer search results"] button').click();
  await expect(page.locator("#create-job-site")).toContainText("Customer primary address");
  await page.getByRole("button", { name: "Change site", exact: true }).click();
  await expect(page.locator('[aria-label="Saved sites"] button')).toHaveCount(0);
  await page.locator('[aria-label="Customer primary address"]').getByRole("button", { name: address }).click();
  await page.getByLabel("Job title").fill("Primary address regression");
  await page.getByLabel("Description of work").fill("Primary address without a persisted site.");
  await page.getByRole("button", { name: "Create Job", exact: true }).click();
  await expect(page.locator(".record-workspace h1")).toHaveText("Primary address regression");
  expect(readWorkspaceState().customers.find((customer) => customer.id === id).sites).toHaveLength(0);
  expect(readWorkspaceState().jobs.find((job) => job.title === "Primary address regression").jobAddress).toBe(address);
});

test("ServiceM8 preview and import retain primary, secondary and site-only contacts through the Settings screen", async ({ page }) => {
  await login(page, { pathname: "/settings" });
  await page.getByRole("button", { name: "Data Backup", exact: true }).last().click();
  await page.getByPlaceholder("Paste your ServiceM8 API key").fill("synthetic-key-never-sent-to-provider");
  await page.getByRole("button", { name: "Preview Import", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import Previewed Data", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Import Previewed Data", exact: true }).click();
  await expect(page.getByText("ServiceM8 import complete. The shared workspace has been updated.", { exact: true })).toBeVisible();
  const state = readWorkspaceState();
  expect(state.contacts.filter((contact) => contact.externalRefs?.serviceM8)).toHaveLength(3);
  const secondary = state.contacts.find((contact) => contact.id === "servicem8-contact-browser-secondary");
  expect(secondary.position).toBe("Facilities Manager");
  const customer = state.customers.find((entry) => entry.id === "servicem8-company-svc-company-alpha");
  expect(customer.contacts).toHaveLength(2);
  expect(customer.sites.find((site) => site.id === "servicem8-site-svc-site-alpha").contacts[0].name).toBe("Riley Example");
  await page.goto(`${baseUrl}/customers/${customer.id}`); await showCustomerSection(page, "Contacts");
  await expect(page.locator('[data-customer-section="contacts"]')).toContainText("Site-only contact");
});

test("download and confirmed restore preserve contacts and assignments through the Settings screen", async ({ page }, info) => {
  await login(page, { pathname: "/settings" });
  await apiJson(page, "POST", "/api/contacts", { id: "backup-browser-person", name: "Backup Person", position: "Director", phone: "123" });
  await apiJson(page, "POST", "/api/customers", { id: "backup-browser-customer", name: "Backup Contact Customer", contactAssignments: [{ contactId: "backup-browser-person", isPrimary: true, isBilling: true }], sites: [{ id: "backup-browser-site", address: "90 Backup St", contactAssignments: [{ contactId: "backup-browser-person", isPrimary: true, roles: ["Caretaker"] }] }] });
  await page.getByRole("button", { name: "Data Backup", exact: true }).last().click();
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Download Backup", exact: true }).click();
  const downloaded = await pending; const backupPath = info.outputPath("contact-backup.json"); await downloaded.saveAs(backupPath);
  const payload = JSON.parse(fs.readFileSync(backupPath, "utf8")); expect(payload.metadata.workspace.schemaVersion).toBe(18);
  expect(payload.metadata.workspace.summary.counts.contacts).toBeGreaterThan(0);
  const before = readWorkspaceState();
  await apiJson(page, "PATCH", "/api/contacts/backup-browser-person", { phone: "changed after backup" });
  await page.locator('input[type="file"]').setInputFiles(backupPath);
  await page.getByRole("button", { name: "Restore Backup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm Backup Restore" });
  await dialog.getByPlaceholder("Re-enter your password").fill(adminPassword);
  await dialog.getByRole("button", { name: "Confirm Restore", exact: true }).click();
  await expect(page.getByText("Backup restored", { exact: true })).toBeVisible();
  const after = readWorkspaceState(); expect(after.contacts).toEqual(before.contacts);
  expect(after.customers.find((customer) => customer.id === "backup-browser-customer")).toEqual(before.customers.find((customer) => customer.id === "backup-browser-customer"));
  await page.reload(); await expect(page.getByRole("button", { name: "Sign In", exact: true })).toHaveCount(0);
});

for (const [width, presetId] of [[1440, "elset"], [1440, "midnight-signal"], [390, "elset"], [390, "midnight-signal"], [820, "elset"], [1024, "elset"], [1280, "elset"]]) {
  test(`customer create/edit layout, header saves and contact autocomplete at ${width}px in ${presetId}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const preset = themePresets.find((entry) => entry.id === presetId);
    await page.route("**/api/user-preferences", async (route) => {
      const response = await route.fetch(); const payload = await response.json();
      await route.fulfill({ response, json: { ...payload, preferences: { ...payload.preferences, ...preset.values } } });
    });
    await login(page, { pathname: "/customers" });
    const key = `refined-${width}-${presetId}`, contactId = `${key}-person`;
    const person = { id: contactId, name: `Dropdown Person ${key}`, email: `${key}@example.test`, phone: `0400${width}987`, position: `Manager ${key}` };
    await apiJson(page, "POST", "/api/contacts", person);
    await apiJson(page, "POST", "/api/customers", { customer: { id: key, name: key, address: "10 Layout St", sites: [{ id: `${key}-site`, address: "10 Layout St" }], contactAssignments: [] } });

    for (const editing of [false, true]) {
      const mode = editing ? "edit" : "new", customerName = `${mode} ${key}`;
      await page.goto(`${baseUrl}/customers/${editing ? `${key}/edit` : "new"}`);
      await expect(page.getByRole("heading", { name: editing ? "Edit Customer" : "New Customer", exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"))).toBe(preset.values.actionColor);
      const form = page.getByRole("form", { name: editing ? "Edit Customer" : "Create Customer", exact: true });
      const details = form.locator('[data-customer-form-column="details"]');
      const contactsColumn = form.locator('[data-customer-form-column="contacts"]');
      const primarySite = details.locator("section").filter({ has: page.getByRole("heading", { name: "Primary site", exact: true }) });
      await expect(details.getByRole("heading", { name: "Customer details", exact: true })).toBeVisible();
      await expect(contactsColumn.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
      const left = await details.boundingBox(), right = await contactsColumn.boundingBox();
      if (width >= 1280) {
        expect(right.x).toBeGreaterThan(left.x + left.width);
        expect(right.y).toBeCloseTo(left.y, 0);
        expect(left.width / right.width).toBeCloseTo(1.5, 1);
      } else {
        expect(right.x).toBeCloseTo(left.x, 0);
        expect(right.y).toBeGreaterThan(left.y + left.height);
      }
      await expect(form.getByRole("heading", { name: "Postal address", exact: true })).toHaveCount(0);
      await primarySite.getByRole("checkbox", { name: "Postal address is the same as the main address" }).uncheck();
      await primarySite.getByLabel("Postal address", { exact: true }).fill("PO Box 42, Layout VIC 3000");
      await page.getByLabel("Customer / company name").fill(customerName);
      const save = page.getByRole("button", { name: editing ? "Save Customer" : "Create Customer", exact: true });
      await expect(save).toHaveCount(1);
      await expect(page.locator(".record-workspace-header").getByRole("button", { name: editing ? "Save Customer" : "Create Customer", exact: true })).toBeVisible();
      expect(await save.evaluate((button) => button.form?.id)).toBe(await form.getAttribute("id"));
      expect((await save.boundingBox()).height).toBe(44);
      await expect(form.locator("footer, .record-workspace-action-bar")).toHaveCount(0);

      const editor = contactsColumn.locator('[aria-label="Customer contact management"]');
      await editor.getByRole("button", { name: "Add Contact", exact: true }).click();
      const methods = editor.getByRole("group", { name: "Add contact method" });
      await expect(methods.getByRole("button")).toHaveCount(2);
      await expect(methods.getByRole("button", { name: "Existing contact", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(methods.getByRole("button", { name: "Cancel adding" })).toHaveCount(0);
      const search = editor.getByRole("combobox", { name: "Search contacts" });
      await expect(search).toHaveAttribute("aria-expanded", "false");
      await expect(editor.getByRole("listbox")).toHaveCount(0);
      expect((await editor.getByRole("button", { name: "Cancel adding" }).boundingBox()).y).toBeGreaterThan((await search.boundingBox()).y);
      for (const query of [person.name, person.email, person.phone, person.position]) {
        await search.fill(query);
        await expect(search).toHaveValue(query);
        await expect(editor.getByRole("option", { name: new RegExp(person.name) })).toBeVisible();
      }
      await search.press("Escape"); await expect(editor.getByRole("listbox")).toHaveCount(0);
      await expect(search).toHaveValue(person.position);
      await search.click(); await search.press("Tab"); await expect(editor.getByRole("listbox")).toHaveCount(0);
      await search.fill("No matching fixture person"); await expect(editor.getByRole("status")).toHaveText("No matching contacts.");
      await search.press("Enter"); await expect(form).toBeVisible();
      await search.fill(person.email); await search.press("ArrowDown");
      await expect(editor.getByRole("option", { selected: true })).toContainText(person.name);
      await expect(search).toHaveAttribute("aria-activedescendant", await editor.getByRole("option", { selected: true }).getAttribute("id"));
      await search.press("Enter");
      await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(person.name);
      await expect(editor.getByRole("listbox")).toHaveCount(0);
      await editor.getByRole("button", { name: "Close details", exact: true }).click();
      await editor.getByRole("button", { name: "Add Contact", exact: true }).click();
      await editor.getByRole("button", { name: "New contact", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Create new contact", exact: true })).toHaveCount(0);
      const added = editor.locator("section").last();
      await expect(added.getByLabel("Name", { exact: true })).toBeFocused();
      await added.getByLabel("Name", { exact: true }).fill(`New Person ${customerName}`);
      await added.getByLabel("Position", { exact: true }).fill("Facilities Manager");
      await added.getByLabel("Roles at this customer").fill("Accounts, Property Manager");
      await added.getByRole("checkbox", { name: "Billing contact", exact: true }).check();
      await noModalOrOverflow(page);
      await expect(save).toBeInViewport();
      expect((await page.locator(".record-workspace-header").boundingBox()).y).toBe(0);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`${mode}-${width}-${presetId}.png`), fullPage: true });
      await save.focus(); await save.press("Enter");
      await expect(page.locator(".record-workspace h1")).toHaveText(customerName);
      const saved = readWorkspaceState().customers.find((customer) => customer.name === customerName);
      expect(saved.postalAddress).toBe("PO Box 42, Layout VIC 3000");
      expect(saved.contactAssignments).toHaveLength(2);
      expect(saved.contactAssignments.some((assignment) => assignment.contactId === contactId)).toBe(true);
      expect(saved.contacts.find((contact) => contact.name === `New Person ${customerName}`)).toMatchObject({ position: "Facilities Manager", roles: ["Accounts", "Property Manager"], isBilling: true });
      if (editing) expect(saved.sites[0].id).toBe(`${key}-site`);
    }
  });
}
