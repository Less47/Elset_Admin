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
const adminPassword = "E2E-admin-pass-123";
const createdCustomerName = "E2E Original Customer";
const editedCustomerName = "E2E Renamed Customer";
const unrelatedCustomerName = "Arcadia Example Apartments";
const createdSiteAddress = "42 E2E Test Road, Flowtown VIC 3999";
const editedSiteAddress = "44 E2E Test Road, Flowtown VIC 3999";
const fixtureCustomerId = "demo-customer-arcadia";
const fixtureSiteAddress = "10 Example Lane, Sampleton VIC 3000";
const fixtureJobId = "demo-job-1001";
const jobOriginalTitle = "E2E Core Job Original";
const jobEditedTitle = "E2E Core Job Updated";
const jobOriginalDescription = "Synthetic browser-created gate service job.";
const jobEditedDescription = "Updated synthetic browser-created gate service job.";
const jobScheduledDate = "2026-03-17";
const jobNoteText = "E2E synthetic job note for SQLite persistence.";
const jobPhotoName = "e2e-job-photo.png";
const controlCustomerId = "e2e-control-customer-job-flow";
const controlSiteId = "e2e-control-site-job-flow";
const controlSiteAddress = "77 Control Circuit, Sampleton VIC 3001";
const controlJobId = "e2e-control-job-flow";
const controlJobTitle = "E2E Control Job";

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

async function login(page) {
  await page.goto(baseUrl);
  await page.getByPlaceholder("Enter your username").fill("admin");
  await page.getByPlaceholder("Enter your password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: "Customers" })).toBeVisible();
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

async function openServiceBoard(page) {
  await page.getByRole("button", { name: "Service Board" }).click();
  await expect(page.getByRole("button", { name: "New Job" })).toBeVisible();
}

async function openJobHistory(page) {
  await page.getByRole("button", { name: "Job History" }).click();
  await expect(page.getByPlaceholder("Search job, customer, address, or status...")).toBeVisible();
}

function activeJobByTitle(title) {
  return readWorkspaceState().jobs.find((job) => job.title === title) || null;
}

function activeJobById(jobId) {
  return readWorkspaceState().jobs.find((job) => job.id === jobId) || null;
}

function deletedJobById(jobId) {
  return readWorkspaceState().deletedJobs.find((record) => record.job.id === jobId) || null;
}

async function waitForActiveJob(jobId, predicate = () => true) {
  let matchingJob = null;
  await expect.poll(() => {
    matchingJob = activeJobById(jobId);
    return Boolean(matchingJob && predicate(matchingJob));
  }).toBe(true);
  return matchingJob;
}

async function waitForActiveJobByTitle(title, predicate = () => true) {
  let matchingJob = null;
  await expect.poll(() => {
    matchingJob = activeJobByTitle(title);
    return Boolean(matchingJob && predicate(matchingJob));
  }).toBe(true);
  return matchingJob;
}

async function waitForDeletedJob(jobId) {
  let deletedRecord = null;
  await expect.poll(() => {
    deletedRecord = deletedJobById(jobId);
    return Boolean(deletedRecord);
  }).toBe(true);
  return deletedRecord;
}

async function openJobFromHistory(page, title) {
  await openJobHistory(page);
  await page.getByPlaceholder("Search job, customer, address, or status...").fill(title);
  const row = page.locator(".data-grid-row", { hasText: title }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Open/ }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: title }).first();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeOpenDialog(page) {
  const closeButton = page.getByRole("button", { name: "Close" }).last();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await expect(page.getByRole("dialog")).toBeHidden();
    return;
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function seedUnrelatedControlRecords(page) {
  const existingState = readWorkspaceState();
  const existingCustomer = existingState.customers.find((customer) => customer.id === controlCustomerId);
  const existingJob = existingState.jobs.find((job) => job.id === controlJobId);
  if (existingCustomer && existingJob) {
    return { customer: existingCustomer, job: existingJob };
  }

  await apiJson(page, "POST", "/api/customers", {
    customer: {
      id: controlCustomerId,
      name: "E2E Control Customer",
      email: "control.customer@example.test",
      phone: "0400 555 666",
      address: controlSiteAddress,
      customerType: "commercial",
      sites: [
        {
          id: controlSiteId,
          label: "Control Site",
          address: controlSiteAddress,
          siteType: "commercial",
          accessNotes: "Synthetic control access notes.",
          notes: "Synthetic control site profile.",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  });

  await apiJson(page, "POST", "/api/jobs", {
    customerMode: "existing",
    customer: { id: controlCustomerId },
    job: {
      id: controlJobId,
      title: controlJobTitle,
      description: "Synthetic control job that should not be changed by the tested workflow.",
      urgency: "Low",
      scheduledDate: "2026-02-02",
      jobAddress: controlSiteAddress,
      ocNumber: "OC-E2E-CONTROL",
    },
  });

  const state = readWorkspaceState();
  return {
    customer: state.customers.find((customer) => customer.id === controlCustomerId),
    job: state.jobs.find((job) => job.id === controlJobId),
  };
}

async function createExistingCustomerJob(page) {
  await openServiceBoard(page);
  await page.getByRole("button", { name: "New Job" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Create New Job");

  await dialog.getByPlaceholder("Search name, email, phone, or address...").fill(unrelatedCustomerName);
  await dialog.getByRole("button", { name: new RegExp(unrelatedCustomerName) }).first().click();
  const siteButton = dialog.locator("button", { hasText: "10 Example Lane" }).first();
  await expect(siteButton).toBeVisible();
  await siteButton.click();
  await dialog.getByPlaceholder("e.g. Swing gate motor replacement").fill(jobOriginalTitle);
  await dialog.locator("textarea").first().fill(jobOriginalDescription);
  await dialog.getByPlaceholder("Optional invoice reference").fill("OC-E2E-JOB");
  await dialog.getByRole("button", { name: "Create Job" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  return waitForActiveJobByTitle(jobOriginalTitle, (job) =>
    job.customerId === fixtureCustomerId &&
    job.jobAddress === fixtureSiteAddress
  );
}

async function editJobDetailsAndSchedule(page, jobId) {
  const dialog = await openJobFromHistory(page, jobOriginalTitle);
  await dialog.getByRole("button", { name: "Edit Job" }).click();

  const editDialog = page.getByRole("dialog").filter({ hasText: /Edit Job #/ }).first();
  await expect(editDialog).toBeVisible();
  await editDialog.locator("input").first().fill(jobEditedTitle);
  await editDialog.locator("textarea").first().fill(jobEditedDescription);
  await editDialog.locator('input[type="date"]').first().fill(jobScheduledDate);
  await editDialog.getByPlaceholder("Optional invoice reference").fill("OC-E2E-JOB-EDITED");
  await editDialog.getByRole("button", { name: "Save Changes" }).click();

  await waitForActiveJob(jobId, (job) =>
    job.title === jobEditedTitle &&
    job.description === jobEditedDescription &&
    job.scheduledDate === jobScheduledDate &&
    job.ocNumber === "OC-E2E-JOB-EDITED"
  );
  await expect(page.getByRole("dialog").filter({ hasText: jobEditedTitle }).first()).toBeVisible();
  await closeOpenDialog(page);
}

async function changeJobStatusFromDetails(page, jobId, title, status) {
  const dialog = await openJobFromHistory(page, title);
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: status, exact: true }).click();
  await waitForActiveJob(jobId, (job) => job.status === status);
  await closeOpenDialog(page);
}

async function addAndRemoveTomorrowPlan(page, job) {
  await openServiceBoard(page);
  await page.getByPlaceholder("Search jobs, customer, address...").fill(jobEditedTitle);
  await page.getByRole("button", { name: `Add Job #${job.jobNumber} to tomorrow` }).click();
  const plannedJob = await waitForActiveJob(job.id, (entry) =>
    Boolean(entry.serviceBoardTomorrowDate) &&
    entry.scheduledDate === entry.serviceBoardTomorrowDate
  );

  await page.reload();
  await expect(page.getByRole("button", { name: "Customers" })).toBeVisible();
  await openServiceBoard(page);
  await page.getByRole("button", { name: /Tomorrow/ }).first().click();
  const panel = page.locator("aside", { hasText: jobEditedTitle });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: /^Remove$/ }).click();
  await waitForActiveJob(job.id, (entry) =>
    !entry.serviceBoardTomorrowDate &&
    !entry.serviceBoardTomorrowOrder &&
    !entry.scheduledDate
  );
  await page.getByLabel("Close tomorrow panel").click();
  return plannedJob.serviceBoardTomorrowDate;
}

async function addJobNoteAndPhotoMetadata(page, jobId) {
  const dialog = await openJobFromHistory(page, jobEditedTitle);
  await dialog.getByPlaceholder("Add site notes, faults found, parts needed...").fill(jobNoteText);
  await dialog.getByRole("button", { name: "Add Note" }).click();
  await waitForActiveJob(jobId, (job) => job.notes.some((note) => note.text === jobNoteText));
  await expect(dialog.getByText(jobNoteText)).toBeVisible();

  const photoPath = path.join(tempDataDir, jobPhotoName);
  fs.writeFileSync(
    photoPath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
  );
  await dialog.locator("#photo-upload").setInputFiles(photoPath);
  await waitForActiveJob(jobId, (job) => job.photos.some((photo) => photo.name === jobPhotoName));
  await expect(dialog.getByText(jobPhotoName)).toBeVisible();

  page.once("dialog", async (confirmDialog) => {
    await confirmDialog.accept();
  });
  await dialog.getByRole("button", { name: `Delete ${jobPhotoName}` }).click();
  await waitForActiveJob(jobId, (job) => !job.photos.some((photo) => photo.name === jobPhotoName));
  await closeOpenDialog(page);
}

async function deleteAndRestoreJob(page, jobId) {
  const dialog = await openJobFromHistory(page, jobEditedTitle);
  page.once("dialog", async (confirmDialog) => {
    await confirmDialog.accept();
  });
  await dialog.getByRole("button", { name: "Delete Job" }).click();
  await waitForDeletedJob(jobId);

  await openRecycleBin(page);
  await page.getByRole("tab", { name: "Deleted Jobs" }).click();
  await expect(page.getByText(jobEditedTitle)).toBeVisible();
  await page.getByRole("button", { name: "Restore Job" }).click();
  await waitForActiveJob(jobId, (job) => job.title === jobEditedTitle);
  await expect(page.getByText(jobEditedTitle)).toBeHidden();
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

test("SQLite startup and ordinary navigation do not broad-save app state", async ({ page }) => {
  const tracker = trackBroadWorkspacePuts(page);
  try {
    await login(page);
    await openCustomers(page);
    await openSites(page);
    await openJobHistory(page);
    await openServiceBoard(page);
    await tracker.expectNone("no PUT /api/app-state during startup or navigation");
  } finally {
    tracker.stop();
  }
});

test("SQLite customer workflow persists through browser refreshes", async ({ page }) => {
  const tracker = trackBroadWorkspacePuts(page);
  try {
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

    await tracker.expectNone("no PUT /api/app-state during SQLite customer workflow");

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
  } finally {
    tracker.stop();
  }
});

test("SQLite core job workflow persists through browser refreshes", async ({ page }) => {
  const tracker = trackBroadWorkspacePuts(page);
  try {
    await login(page);

    const controlRecords = await seedUnrelatedControlRecords(page);
    expect(controlRecords.customer).toBeTruthy();
    expect(controlRecords.job).toBeTruthy();

    const baselineState = readWorkspaceState();
    const fixtureJob = baselineState.jobs.find((job) => job.id === fixtureJobId);
    const controlCustomer = baselineState.customers.find((customer) => customer.id === controlCustomerId);
    const controlJob = baselineState.jobs.find((job) => job.id === controlJobId);
    expect(fixtureJob).toBeTruthy();
    expect(controlCustomer).toBeTruthy();
    expect(controlJob).toBeTruthy();

    const createdJob = await createExistingCustomerJob(page);
    expect(createdJob).toMatchObject({
      title: jobOriginalTitle,
      customerId: fixtureCustomerId,
      customerName: unrelatedCustomerName,
      jobAddress: fixtureSiteAddress,
      status: "To Do",
    });

    await page.reload();
    await expect(page.getByRole("button", { name: "Customers" })).toBeVisible();
    let dialog = await openJobFromHistory(page, jobOriginalTitle);
    await expect(dialog).toContainText(jobOriginalDescription);
    await closeOpenDialog(page);

    await editJobDetailsAndSchedule(page, createdJob.id);
    await changeJobStatusFromDetails(page, createdJob.id, jobEditedTitle, "In Progress");
    await changeJobStatusFromDetails(page, createdJob.id, jobEditedTitle, "To Do");

    const scheduledJob = await waitForActiveJob(createdJob.id, (job) =>
      job.status === "To Do" &&
      job.scheduledDate === jobScheduledDate
    );
    expect(scheduledJob.scheduledDate).toBe(jobScheduledDate);

    const tomorrowDate = await addAndRemoveTomorrowPlan(page, scheduledJob);
    expect(tomorrowDate).toBeTruthy();
    await addJobNoteAndPhotoMetadata(page, createdJob.id);

    await deleteAndRestoreJob(page, createdJob.id);
    await page.reload();
    await expect(page.getByRole("button", { name: "Customers" })).toBeVisible();
    dialog = await openJobFromHistory(page, jobEditedTitle);
    await expect(dialog).toContainText(jobEditedDescription);
    await expect(dialog).toContainText(jobNoteText);
    await closeOpenDialog(page);

    await tracker.expectNone("no PUT /api/app-state during SQLite job workflow");

    const finalState = readWorkspaceState();
    const finalJob = finalState.jobs.find((job) => job.id === createdJob.id);
    expect(finalJob).toMatchObject({
      id: createdJob.id,
      title: jobEditedTitle,
      description: jobEditedDescription,
      status: "To Do",
      customerId: fixtureCustomerId,
      customerName: unrelatedCustomerName,
      jobAddress: fixtureSiteAddress,
      ocNumber: "OC-E2E-JOB-EDITED",
      scheduledDate: "",
      serviceBoardTomorrowDate: "",
    });
    expect(finalJob.notes.some((note) => note.text === jobNoteText)).toBe(true);
    expect(finalJob.photos.some((photo) => photo.name === jobPhotoName)).toBe(false);
    expect(finalState.deletedJobs.some((record) => record.job.id === createdJob.id)).toBe(false);

    const finalControlCustomer = finalState.customers.find((customer) => customer.id === controlCustomerId);
    const finalControlJob = finalState.jobs.find((job) => job.id === controlJobId);
    const finalFixtureJob = finalState.jobs.find((job) => job.id === fixtureJobId);
    expect(finalControlCustomer).toMatchObject({
      id: controlCustomer.id,
      name: controlCustomer.name,
      email: controlCustomer.email,
      phone: controlCustomer.phone,
      address: controlCustomer.address,
    });
    expect(finalControlCustomer.sites[0]).toMatchObject({
      id: controlSiteId,
      address: controlSiteAddress,
      accessNotes: "Synthetic control access notes.",
    });
    expect(finalControlJob).toMatchObject({
      id: controlJob.id,
      jobNumber: controlJob.jobNumber,
      title: controlJob.title,
      description: controlJob.description,
      status: controlJob.status,
      scheduledDate: controlJob.scheduledDate,
      customerId: controlJob.customerId,
      jobAddress: controlJob.jobAddress,
      ocNumber: controlJob.ocNumber,
    });
    expect(finalFixtureJob).toMatchObject({
      id: fixtureJob.id,
      jobNumber: fixtureJob.jobNumber,
      title: fixtureJob.title,
      status: fixtureJob.status,
      scheduledDate: fixtureJob.scheduledDate,
      customerId: fixtureJob.customerId,
      jobAddress: fixtureJob.jobAddress,
    });
  } finally {
    tracker.stop();
  }
});
