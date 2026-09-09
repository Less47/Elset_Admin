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
      ELSET_WORKSPACE_STORAGE: "sqlite",
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
    ELSET_WORKSPACE_STORAGE: "sqlite",
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
  await expect(page.locator('[data-customer-section]')).toHaveCount(4);
  const boxes = {};
  for (const name of ["details", "sites", "contacts", "jobs"]) boxes[name] = await page.locator(`[data-customer-section="${name}"]`).boundingBox();
  expect(boxes.details.x).toBeCloseTo(boxes.contacts.x, 0);
  expect(boxes.sites.x).toBeCloseTo(boxes.jobs.x, 0);
  expect(boxes.details.y).toBeCloseTo(boxes.sites.y, 0);
  expect(boxes.contacts.y - boxes.details.y - boxes.details.height).toBeCloseTo(12, 0);
  expect(boxes.jobs.y - boxes.sites.y - boxes.sites.height).toBeCloseTo(12, 0);
  expect(boxes.sites.x - boxes.details.x - boxes.details.width).toBeCloseTo(12, 0);
  expect(boxes.details.width / boxes.sites.width).toBeCloseTo(2 / 3, 2);
  await expect(page.locator('[data-customer-section="details"]').getByRole("button", { name: "Delete Customer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Destructive customer actions" }).getByRole("button", { name: "Delete Customer", exact: true })).toBeVisible();
  const header = await page.locator('.record-workspace-header').boundingBox();
  const grid = await page.locator('.customer-workspace-grid').boundingBox();
  expect(grid.x).toBeCloseTo(header.x, 0);
  expect(grid.x + grid.width).toBeCloseTo(header.x + header.width, 0);
  const danger = await page.locator('[data-customer-danger-zone]').boundingBox();
  expect(danger.y - grid.y - grid.height).toBeCloseTo(12, 0);
  await expect(page.locator('.customer-section-panel')).toHaveCount(4);
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
  for (const style of styles) expect(style).toEqual(styles[0]);
  expect(styles[0].border).toMatch(/^1px solid/);
  expect(styles[0].radius).toBe("8px");
  expect(styles[0].headerHeight).toBe(44);
  expect(styles[0].titleInsideHeader).toBe(true);
  expect(styles[0].bodyPadding).toBe("12px");
  await expect(page.locator('[data-customer-section="sites"] .customer-section-header').getByRole("button", { name: "Add Site", exact: true })).toBeVisible();
  await expect(page.locator('.customer-section-header .customer-section-count')).toHaveCount(3);
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
  await page.locator('[title="Double-click to open customer profile"]', { hasText: unrelatedCustomerName }).getByRole("button", { name: "Open", exact: true }).click();
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
  await page.reload();
  await page.getByRole("button", { name: "Edit Customer", exact: true }).click();
  await page.getByLabel("Customer / company name").fill("");
  await expect(page.getByRole("button", { name: "Save Customer", exact: true })).toBeEnabled();
  await page.getByLabel("Customer / company name").fill("Workspace Customer Updated");
  await page.getByRole("button", { name: "Add Contact", exact: true }).click();
  const contact = page.getByRole("region", { name: "Contact 1", exact: true });
  await contact.getByLabel("Name", { exact: true }).fill("Billing Person");
  await contact.getByLabel("Email", { exact: true }).fill("billing@example.test");
  await contact.getByLabel("Role", { exact: true }).fill("Accounts");
  await contact.getByRole("button", { name: "Use For Billing", exact: true }).click();
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
  await field.fill(original);
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
      if (width >= 1024) await page.getByRole("button", { name: "Create Customer", exact: true }).scrollIntoViewIfNeeded();
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
  // The existing Site API also materializes account/site fallback contacts.
  for (const contact of before.contacts) expect(after.contacts).toContainEqual(contact);
  expect(after.sites.filter((site) => site.id !== saved.id)).toEqual(before.sites);
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
      for (const [label, section, records] of [["Sites", "sites", 8], ["Contacts", "contacts", 13], ["Job History", "jobs", 16]]) {
        await showCustomerSection(page, label);
        const content = page.locator(`[data-customer-section="${section}"]`);
        await expect(content.locator('[data-mobile-record-card]')).toHaveCount(kind === "many" ? records : 0);
        await noModalOrOverflow(page);
        if (kind === "many") {
          const finalRecord = content.locator('[data-mobile-record-card]').last();
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
