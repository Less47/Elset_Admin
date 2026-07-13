import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");
const adminPassword = "E2E-admin-pass-123";
const createdCustomerName = "E2E Original Customer";
const editedCustomerName = "E2E Renamed Customer";
const unrelatedCustomerName = "Arcadia Example Apartments";
const createdSiteAddress = "42 E2E Test Road, Flowtown VIC 3999";
const editedSiteAddress = "44 E2E Test Road, Flowtown VIC 3999";

let tempDataDir = "";
let baseUrl = "";
let serverProcess = null;
let serverOutput = "";

function readFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
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
  } finally {
    db.close();
  }
}

async function seedAdminLogin() {
  process.env.ELSET_DATA_DIR = tempDataDir;
  process.env.ELSET_AUTH_DB_PATH = path.join(tempDataDir, "auth.db");
  process.env.ELSET_WORKSPACE_STORAGE = "sqlite";
  process.env.NODE_ENV = "test";

  const { auth, ensureAuthReady } = await import(`../../server-auth.js?e2e=${Date.now()}`);
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
  const password = await context.password.hash(adminPassword);
  await context.internalAdapter.linkAccount({
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password,
  });
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

async function login(page) {
  await page.goto(baseUrl);
  await page.getByPlaceholder("Enter your username").fill("admin");
  await page.getByPlaceholder("Enter your password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: "Customers" })).toBeVisible();
}

async function openCustomers(page) {
  await page.getByRole("button", { name: "Customers" }).click();
  await expect(page.getByRole("button", { name: "New Customer" })).toBeVisible();
}

async function openSites(page) {
  await page.getByRole("button", { name: "Sites" }).click();
  await expect(page.getByRole("button", { name: "New Site" })).toBeVisible();
}

async function openRecycleBin(page) {
  await page.getByRole("button", { name: "Recycle Bin" }).click();
  await expect(page.getByRole("tab", { name: "Deleted Customers" })).toBeVisible();
}

async function openCustomerProfile(page, customerName) {
  await openCustomers(page);
  await page.getByPlaceholder("Search customers...").fill(customerName);
  const row = page.locator(".data-grid-row", { hasText: customerName }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Open/ }).click();
  await expect(page.getByRole("dialog")).toContainText(customerName);
}

function customerRows(page, customerName) {
  return page.locator(".data-grid-row", { hasText: customerName });
}

async function createCustomer(page) {
  await openCustomers(page);
  await page.getByRole("button", { name: "New Customer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Create Customer");
  await dialog.locator("input").nth(0).fill(createdCustomerName);
  await dialog.locator("input").nth(1).fill("e2e.customer@example.test");
  await dialog.locator("input").nth(2).fill("0400 111 222");
  await dialog.getByPlaceholder("Search the customer's main address").fill("1 E2E Customer Street, Flowtown VIC 3999");
  await dialog.getByPlaceholder("Optional client order/control number").fill("OC-E2E-CUSTOMER");
  await dialog.getByRole("button", { name: "Create Customer" }).click();
  await expect(page.getByRole("dialog")).toContainText(createdCustomerName);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function editCustomer(page) {
  await openCustomerProfile(page, createdCustomerName);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Edit Customer" }).click();
  await dialog.locator("input").nth(0).fill(editedCustomerName);
  await dialog.locator("input").nth(1).fill("e2e.updated@example.test");
  await dialog.locator("input").nth(2).fill("0400 333 444");
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(dialog).toContainText(editedCustomerName);
  await page.getByRole("button", { name: "Close" }).click();
}

async function deleteCustomer(page) {
  await openCustomerProfile(page, editedCustomerName);
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.getByRole("dialog").getByRole("button", { name: "Delete Customer" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function restoreCustomer(page) {
  await openRecycleBin(page);
  await page.getByRole("tab", { name: "Deleted Customers" }).click();
  await expect(page.getByText(editedCustomerName)).toBeVisible();
  await page.getByRole("button", { name: "Restore Customer" }).click();
  await expect(page.getByText(editedCustomerName)).toBeHidden();
}

async function createSite(page) {
  await openSites(page);
  await page.getByRole("button", { name: "New Site" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Create New Site");
  await dialog.getByPlaceholder("Search name, email, phone, or address...").fill(editedCustomerName);
  const customerButton = dialog.getByRole("button", { name: new RegExp(editedCustomerName) });
  await customerButton.click();
  await dialog.getByRole("button", { name: "Continue" }).click();

  const siteDialog = page.getByRole("dialog");
  await expect(siteDialog).toContainText("New Site");
  await siteDialog.getByPlaceholder("Search this site address").fill(createdSiteAddress);
  await siteDialog.getByPlaceholder("Optional client order/control number").fill("OC-E2E-SITE");
  await siteDialog.getByPlaceholder("Gate code, parking, access windows, call-on-arrival details...").fill("Use synthetic keypad 1234.");
  await siteDialog.getByPlaceholder("General context, layout, project details, recurring issues...").fill("Synthetic site notes.");
  await siteDialog.getByRole("button", { name: "Save Site Profile" }).click();
  await expect(siteDialog).toContainText(createdSiteAddress);
  await page.getByRole("button", { name: "Close" }).click();
}

async function openSiteProfile(page, address) {
  await openSites(page);
  await page.getByPlaceholder("Search customer, site, address, notes, or gate/project details...").fill(address);
  const row = page.locator(".data-grid-row", { hasText: address }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Open/ }).click();
  await expect(page.getByRole("dialog")).toContainText(address);
}

function siteRows(page, address) {
  return page.locator(".data-grid-row", { hasText: address });
}

async function editSite(page) {
  await openSiteProfile(page, createdSiteAddress);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Edit Site Profile" }).click();
  await dialog.getByPlaceholder("Search this site address").fill(editedSiteAddress);
  await dialog.getByPlaceholder("Gate code, parking, access windows, call-on-arrival details...").fill("Updated synthetic keypad 5678.");
  await dialog.getByRole("button", { name: "Save Site Profile" }).click();
  await expect(dialog).toContainText(editedSiteAddress);
  await page.getByRole("button", { name: "Close" }).click();
}

async function deleteSite(page) {
  await openSiteProfile(page, editedSiteAddress);
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.getByRole("dialog").getByRole("button", { name: "Remove Saved Profile" }).click();
  await expect(page.getByRole("dialog")).toContainText("New Site");
  await page.getByRole("button", { name: "Close" }).click();
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

test("SQLite customer workflow persists through browser refreshes", async ({ page }) => {
  await login(page);

  const baselineState = readWorkspaceState();
  const unrelatedCustomer = baselineState.customers.find((customer) => customer.name === unrelatedCustomerName);
  expect(unrelatedCustomer).toBeTruthy();
  expect(baselineState.jobs).toHaveLength(1);
  expect(baselineState.inventoryItems).toHaveLength(1);

  await createCustomer(page);
  await page.reload();
  await openCustomers(page);
  await expect(customerRows(page, createdCustomerName).first()).toBeVisible();

  await editCustomer(page);
  await page.reload();
  await openCustomers(page);
  await expect(customerRows(page, editedCustomerName).first()).toBeVisible();
  await expect(customerRows(page, createdCustomerName)).toHaveCount(0);

  await deleteCustomer(page);
  await openRecycleBin(page);
  await page.getByRole("tab", { name: "Deleted Customers" }).click();
  await expect(page.getByText(editedCustomerName)).toBeVisible();

  await restoreCustomer(page);
  await page.reload();
  await openCustomers(page);
  await expect(customerRows(page, editedCustomerName).first()).toBeVisible();

  await createSite(page);
  await page.reload();
  await openSites(page);
  await page.getByPlaceholder("Search customer, site, address, notes, or gate/project details...").fill(createdSiteAddress);
  await expect(siteRows(page, createdSiteAddress).first()).toBeVisible();

  await editSite(page);
  await deleteSite(page);
  await openSites(page);
  await page.getByPlaceholder("Search customer, site, address, notes, or gate/project details...").fill(editedSiteAddress);
  await expect(siteRows(page, editedSiteAddress)).toHaveCount(0);

  const finalState = readWorkspaceState();
  const finalCustomer = finalState.customers.find((customer) => customer.name === editedCustomerName);
  const finalUnrelatedCustomer = finalState.customers.find((customer) => customer.id === unrelatedCustomer.id);
  expect(finalCustomer).toBeTruthy();
  expect(finalCustomer.email).toBe("e2e.updated@example.test");
  expect(finalCustomer.sites.some((site) => site.address === editedSiteAddress)).toBe(false);
  expect(finalState.deletedCustomers.some((record) => record.customer.name === editedCustomerName)).toBe(false);
  expect(finalUnrelatedCustomer).toMatchObject({
    name: unrelatedCustomer.name,
    email: unrelatedCustomer.email,
    address: unrelatedCustomer.address,
  });
  expect(finalState.jobs).toHaveLength(baselineState.jobs.length);
  expect(finalState.inventoryItems).toHaveLength(baselineState.inventoryItems.length);
  expect(finalState.jobs[0]).toMatchObject({
    id: baselineState.jobs[0].id,
    customerId: baselineState.jobs[0].customerId,
    title: baselineState.jobs[0].title,
  });
});
