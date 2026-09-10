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
import { createMaintenancePlan } from "../../server-workspace-maintenance.js";
import { updateCustomer } from "../../server-workspace-customers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(root, "test-results/maintenance");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
fixture.customers[0].sites.push(...[
  ["maintenance-site-connor", "5 Connor Street, Brighton East"],
  ["maintenance-site-bay", "11 Bay Street, Brighton"],
  ["maintenance-site-dendy", "18 Dendy Street, Brighton"],
  ["maintenance-site-martin", "20 Martin Street, Brighton"],
].map(([id, address]) => ({ id, address })));
fixture.customers.push(
  { id: "northside", name: "Northside Apartments", address: "14 Sesame St, Caroline Springs VIC 3023", email: "north-office@example.test", phone: "0400 111 222", contacts: [{ name: "Adrian", email: "adrian@example.test", phone: "0400 555 123" }], sites: [{ id: "sesame", address: "14 Sesame St, Caroline Springs VIC 3023", streetAddress: "14 Sesame St", suburb: "Caroline Springs" }] },
  { id: "north-commercial", name: "Northside Commercial", address: "14 Park View Rd, Northside VIC 3000", sites: [{ id: "park", address: "14 Park View Rd, Northside VIC 3000" }, { id: "industrial", address: "82 Industrial Ave, Westfield VIC 3000", addressLine1: "82 Industrial Ave", locality: "Westfield" }] },
  { id: "no-sites", name: "Customer Without Sites", address: "", sites: [] },
);
const password = "E2E-maintenance-pass-123";
let tempDir, url, server, serverOutput = "";
const basePlan = { id: "calendar-plan", planName: "5 Connor St", customerId: "demo-customer-arcadia", siteId: "maintenance-site-connor", siteAddress: "5 Connor Street, Brighton East", frequency: "six-monthly", nextDueDate: "2027-03-09", estimatedDurationHours: 2, contractPrice: 350, contractPriceSet: true, checklist: ["Inspect gate hinges", "Test safety edges", "Check motor and controls", "Lubricate moving parts", "Record operational readings"], notes: "Use the pedestrian gate for access." };
function withDb(callback) {
  const db = openWorkspaceDb({ dbPath: path.join(tempDir, "elset-workspace.db") });
  try { return callback(db); } finally { db.close(); }
}
const state = () => withDb(loadWorkspaceStateFromDb);
const savedPlan = () => state().maintenancePlans.find((entry) => entry.id === basePlan.id);
const exceptionCount = () => withDb((db) => db.prepare("SELECT count(*) n FROM maintenance_occurrence_exceptions").get().n);

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-maintenance-e2e-"));
  fs.mkdirSync(screenshots, { recursive: true });
  withDb((db) => {
    importWorkspaceJsonData(db, { ...fixture, maintenancePlans: [], jobs: [] });
    // Seed real contact rows through the existing customer writer: the legacy
    // importer only puts site-primary contacts into the relational table.
    updateCustomer(db, "northside", { contacts: fixture.customers.find((entry) => entry.id === "northside").contacts });
  });
  const listener = net.createServer();
  const port = await new Promise((resolve) => listener.listen(0, "127.0.0.1", () => { const port = listener.address().port; listener.close(() => resolve(port)); }));
  url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, ELSET_DATA_DIR: tempDir, ELSET_WORKSPACE_DB_PATH: path.join(tempDir, "elset-workspace.db"), ELSET_AUTH_DB_PATH: path.join(tempDir, "auth.db"), ELSET_WORKSPACE_STORAGE: "sqlite", NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney", PORT: String(port), ELSET_API_PORT: String(port), BETTER_AUTH_URL: url, ELSET_FRONTEND_URL: url };
  const seed = `const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(root, "server-auth.js")).href)}); await ensureAuthReady(); const context = await auth.$context; const user = await context.internalAdapter.createUser({ email: 'maintenance.admin@auth.elset.local', emailVerified: true, name: 'Maintenance Test Admin', role: 'admin', username: 'maintenanceadmin', displayUsername: 'Maintenance Test Admin', workspaceRole: 'admin', staffId: '' }); const password = await context.password.hash(${JSON.stringify(password)}); await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password });`;
  const seeded = spawnSync(process.execPath, ["--input-type=module", "-e", seed], { cwd: root, env, encoding: "utf8" });
  if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
  server = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; }); server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await expect.poll(async () => { try { return (await fetch(`${url}/api/auth/me`)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(401);
});
test.beforeEach(() => withDb((db) => {
  db.prepare("DELETE FROM maintenance_plans").run(); db.prepare("DELETE FROM jobs").run();
  // A billing address alone must not masquerade as a persisted Site record.
  db.prepare("UPDATE customers SET address = '25 Billing Office Road, Melbourne VIC 3000' WHERE id = 'no-sites'").run();
  createMaintenancePlan(db, basePlan);
  createMaintenancePlan(db, { ...basePlan, id: "no-price-plan", siteId: "maintenance-site-bay", planName: "11 Bay St", siteAddress: "11 Bay Street, Brighton", nextDueDate: "2027-09-22", contractPrice: 0, contractPriceSet: false });
  createMaintenancePlan(db, { ...basePlan, id: "due-plan", siteId: "maintenance-site-dendy", planName: "18 Dendy St", siteAddress: "18 Dendy Street, Brighton", nextDueDate: "2027-08-29", frequency: "quarterly", estimatedDurationHours: 1.5, contractPrice: 220 });
}));
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await info.attach("server-output", { body: serverOutput, contentType: "text/plain" }); });
test.afterAll(async () => {
  if (server?.exitCode === null) { server.kill("SIGTERM"); await new Promise((resolve) => { server.once("exit", resolve); setTimeout(resolve, 5000); }); }
  const target = path.resolve(tempDir || "");
  if (target.startsWith(path.join(os.tmpdir(), "elset-maintenance-e2e-"))) fs.rmSync(target, { recursive: true, force: true });
});

async function open(browser, width = 1440, height = 900, section = "Calendar", timezoneId = "Australia/Sydney") {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1280, isMobile: width < 768, locale: "en-AU", timezoneId, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.setFixedTime("2027-09-01T02:00:00Z");
  await page.goto(url);
  await page.getByPlaceholder("Enter your username").fill("maintenanceadmin");
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  if (width < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: section, exact: true }).click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  const writes = [];
  page.on("request", (request) => { if (["PATCH", "POST", "DELETE"].includes(request.method()) && request.url().includes("/api/maintenance")) writes.push(request); });
  return { page, context, writes };
}
const day = (page, date) => page.locator(`[data-calendar-date="${date}"]`);
const chip = (page, date) => day(page, date).locator('[data-calendar-maintenance^="calendar-plan:"]:visible');
async function capture(page, info, name) {
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true, animations: "disabled" });
  await info.attach(name, { path: path.join(screenshots, `${name}.png`), contentType: "image/png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
async function propose(page, date) {
  await chip(page, "2027-09-09").click();
  const sheet = page.getByRole("dialog", { name: "Scheduled maintenance", exact: true });
  await sheet.getByLabel("Maintenance date", { exact: true }).fill(date);
  await sheet.getByRole("button", { name: "Change date", exact: true }).last().click();
  return page.getByRole("dialog", { name: "Change maintenance date", exact: true });
}

async function selectRecord(page, label, query, name) {
  await page.getByRole("combobox", { name: label, exact: true }).fill(query);
  await page.getByRole("option", { name }).click();
}

async function captureForm(page, info, name) {
  const folder = path.join(root, "test-results/maintenance-form");
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true, animations: "disabled" });
  await info.attach(name, { path: target, contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  for (const picker of await page.locator(".maintenance-picker-results:visible").all()) {
    const box = await picker.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(box.height).toBeLessThanOrEqual(285);
  }
}

test("customer/site pickers support keyboard, contact search, customer changes and the no-site workflow", async ({ browser }) => {
  const { page, context, writes } = await open(browser, 1440, 900, "Maintenance");
  await page.getByRole("button", { name: "Add Maintenance Plan", exact: true }).click();
  const customer = page.getByRole("combobox", { name: "Customer", exact: true });
  const site = page.getByRole("combobox", { name: "Site", exact: true });
  await customer.fill("North");
  await expect(page.getByRole("listbox", { name: "Customer results" }).getByRole("option")).toHaveCount(2);
  await customer.press("ArrowDown"); await customer.press("Enter");
  await expect(customer).toHaveValue("Northside Apartments");
  await expect(site).toHaveValue("14 Sesame St, Caroline Springs VIC 3023");
  await expect(page.locator(".maintenance-plan-preview")).toContainText("14 Sesame St CAROLINE SPRINGS");
  await page.getByLabel("Next due date", { exact: true }).fill("2027-11-21");
  await selectRecord(page, "Customer", "Commercial", /Northside Commercial/);
  await expect(site).toHaveValue("");
  await expect(page.getByRole("button", { name: "Create Plan", exact: true })).toBeDisabled();
  await selectRecord(page, "Site", "Industrial", /82 Industrial Ave/);
  await expect(page.locator(".maintenance-plan-preview")).toContainText("82 Industrial Ave WESTFIELD");
  await expect(page.getByLabel("Next due date", { exact: true })).toHaveValue("2027-11-21");
  await selectRecord(page, "Site", "Park", /14 Park View Rd/);
  await expect(page.locator(".maintenance-plan-preview")).toContainText("14 Park View Rd NORTHSIDE");
  for (const query of ["Adrian", "north-office@example.test", "0400 555 123"]) {
    await customer.fill(query); await expect(page.getByRole("option", { name: /Northside Apartments/ })).toBeVisible();
    await customer.press("Escape"); await expect(customer).toHaveAttribute("aria-expanded", "false");
  }
  await customer.fill("North"); await customer.press("ArrowUp"); await customer.press("Enter");
  await expect(customer).toHaveValue("Northside Commercial");
  await expect(site).toHaveValue("");
  await selectRecord(page, "Customer", "Without", /Customer Without Sites/);
  await expect(page.getByText("No sites found for this customer.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Plan", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Add Site", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/customers\/no-sites\/sites\/new$/);
  await context.close();
});

test("legacy labels load in dashboard, edit and Calendar without changing six-month or annual dates", async ({ browser }) => {
  withDb((db) => {
    db.prepare("UPDATE maintenance_plans SET frequency = '6 Monthly' WHERE id = 'calendar-plan'").run();
    const plan = savedPlan();
    db.prepare("UPDATE maintenance_plans SET extra_json = ? WHERE id = 'calendar-plan'").run(JSON.stringify({ ...JSON.parse(db.prepare("SELECT extra_json FROM maintenance_plans WHERE id = 'calendar-plan'").get().extra_json), recurrence: { segments: plan.recurrence.segments.map((entry) => ({ ...entry, frequency: "6 Monthly" })) } }));
    createMaintenancePlan(db, { ...basePlan, id: "annual-plan", siteId: "maintenance-site-bay", frequency: "Annually" });
    db.prepare("UPDATE maintenance_plans SET frequency = 'Yearly' WHERE id = 'annual-plan'").run();
  });
  const { page, context, writes } = await open(browser, 1440, 900, "Maintenance");
  const card = page.locator('[data-maintenance-plan="calendar-plan"]');
  await expect(card).toContainText("Biannually");
  await expect(page.locator('[data-maintenance-plan="annual-plan"]')).toContainText("Annually");
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Customer", exact: true })).toHaveValue("Arcadia Example Apartments");
  await expect(page.getByRole("combobox", { name: "Site", exact: true })).toHaveValue("5 Connor Street, Brighton East");
  await expect(page.getByRole("combobox", { name: "Frequency", exact: true })).toHaveValue("six-monthly");
  await expect(page.locator(".maintenance-plan-preview")).toContainText("5 Connor Street BRIGHTON EAST");
  const before = await (await page.request.get(`${url}/api/maintenance-occurrences?from=2027-01-01&to=2028-12-31`)).json();
  expect(before.occurrences.filter((entry) => entry.planId === "calendar-plan").map((entry) => entry.date)).toEqual(["2027-03-09", "2027-09-09", "2028-03-09", "2028-09-09"]);
  expect(before.occurrences.filter((entry) => entry.planId === "annual-plan").map((entry) => entry.date)).toEqual(["2027-03-09", "2028-03-09"]);
  expect(writes).toHaveLength(0);
  await page.goto(`${url}/maintenance`);
  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(chip(page, "2027-09-09")).toHaveAttribute("title", /Biannually/);
  await chip(page, "2027-09-09").click();
  await expect(page.getByRole("dialog", { name: "Scheduled maintenance", exact: true })).toContainText("Biannually");
  await context.close();
});

for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 768], [820, 1180], [390, 844]]) {
  test(`maintenance form ${width}x${height}: compact customer search, canonical create and edit persistence`, async ({ browser }, info) => {
    const { page, context, writes } = await open(browser, width, height, "Maintenance");
    await page.getByRole("button", { name: "Add Maintenance Plan", exact: true }).click();
    await expect(page.getByLabel("Plan name", { exact: true })).toHaveCount(0);
    const customer = page.getByRole("combobox", { name: "Customer", exact: true });
    await customer.fill("North");
    await captureForm(page, info, `customer-search-${width}x${height}`);
    const option = page.getByRole("option", { name: /Northside Apartments/ });
    if (width < 1280) await option.tap(); else await option.click();
    await expect(page.getByRole("combobox", { name: "Site", exact: true })).toHaveValue("14 Sesame St, Caroline Springs VIC 3023");
    await expect(page.locator(".maintenance-plan-preview")).toContainText("14 Sesame St CAROLINE SPRINGS");
    const frequency = page.getByRole("combobox", { name: "Frequency", exact: true });
    await expect(frequency.locator("option")).toHaveText(["Monthly", "Quarterly", "Biannually", "Annually"]);
    await frequency.selectOption("six-monthly");
    await page.getByLabel("Next due date", { exact: true }).fill("2027-03-09");
    await captureForm(page, info, `add-plan-${width}x${height}`);
    await page.getByRole("button", { name: "Create Plan", exact: true }).click();
    await expect(page.locator("[data-maintenance-detail]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "14 Sesame St CAROLINE SPRINGS", exact: true })).toBeVisible();
    await expect(page.locator('[data-maintenance-detail] [data-contract-price="missing"]')).toContainText("Not set");
    const saved = state().maintenancePlans.find((entry) => entry.siteId === "sesame");
    expect(saved.customerId).toBe("northside"); expect(saved.frequency).toBe("six-monthly");
    expect(saved.nextDueDate).toBe("2027-03-09");
    expect(writes.filter((request) => request.method() === "POST")).toHaveLength(1);
    await page.getByRole("button", { name: "Edit Plan", exact: true }).click();
    await page.reload();
    await expect(customer).toHaveValue("Northside Apartments");
    await expect(frequency).toHaveValue("six-monthly");
    await captureForm(page, info, `edit-plan-${width}x${height}`);
    await selectRecord(page, "Customer", "Commercial", /Northside Commercial/);
    await selectRecord(page, "Site", "Industrial", /82 Industrial Ave/);
    await page.getByRole("button", { name: "Save Plan", exact: true }).click();
    await expect(page.locator("[data-maintenance-detail]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "82 Industrial Ave WESTFIELD", exact: true })).toBeVisible();
    const updated = state().maintenancePlans.find((entry) => entry.id === saved.id);
    expect(updated.siteId).toBe("industrial"); expect(updated.customerId).toBe("north-commercial");
    expect(updated.nextDueDate).toBe("2027-03-09"); expect(updated.recurrence).toEqual(saved.recurrence);
    await context.close();
  });
}

test("compact dashboard, missing price, routed details and edit-date confirmation", async ({ browser }, info) => {
  const { page, context, writes } = await open(browser, 1440, 900, "Maintenance");
  await expect(page.locator("[data-maintenance-dashboard]")).toBeVisible();
  await expect(page.getByText("Active Maintenance Jobs", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Checklist", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent Activity", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-maintenance-plan="no-price-plan"] [data-contract-price="missing"]')).toContainText("Not set");
  expect((await page.locator('[data-maintenance-plan="calendar-plan"]').boundingBox()).height).toBeLessThan(260);
  await capture(page, info, "maintenance-dashboard-desktop");
  await page.locator('[data-maintenance-plan="calendar-plan"]').getByRole("button", { name: "Open Plan" }).click();
  await expect(page).toHaveURL(/\/maintenance\/calendar-plan$/);
  await expect(page.getByRole("heading", { name: "Checklist", exact: true })).toBeVisible();
  await expect(page.getByText("Record operational readings", { exact: true })).toBeVisible();
  await capture(page, info, "maintenance-plan-detail-desktop");
  await page.reload(); await expect(page.getByText("Record operational readings", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Plan", exact: true }).click();
  await page.getByLabel("Next due date", { exact: true }).fill("2027-03-16");
  await page.getByRole("button", { name: "Save Plan", exact: true }).click();
  const choice = page.getByRole("dialog", { name: "Change maintenance date", exact: true });
  await expect(choice).toBeVisible(); expect(writes.length).toBe(0);
  await choice.getByRole("button", { name: "This occurrence only", exact: true }).click();
  await expect(page).toHaveURL(/\/maintenance\/calendar-plan$/);
  expect(savedPlan().nextDueDate).toBe("2027-03-16");
  expect(savedPlan().recurrence.segments[0].anchorDate).toBe("2027-03-09");
  await context.close();
});

test("Add Plan creates automatic calendar dates; zero price, due exceptions and inactive status persist", async ({ browser }) => {
  const { page, context } = await open(browser, 1440, 900, "Maintenance");
  await page.getByRole("button", { name: "Add Maintenance Plan", exact: true }).click();
  await expect(page).toHaveURL(/\/maintenance\/new$/);
  await page.getByRole("combobox", { name: "Customer", exact: true }).fill("Arcadia");
  await page.getByRole("option", { name: /Arcadia Example Apartments/ }).click();
  await page.getByRole("combobox", { name: "Site", exact: true }).fill("Martin");
  await page.getByRole("option", { name: /20 Martin Street/ }).click();
  await page.getByLabel("Next due date", { exact: true }).fill("2027-09-05");
  await page.getByLabel("Contract price", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Create Plan", exact: true }).click();
  await expect(page.locator("[data-maintenance-detail]")).toBeVisible();
  await expect(page.locator('[data-maintenance-detail] [data-contract-price="set"]')).toContainText("$0.00");
  const id = state().maintenancePlans.find((entry) => entry.siteId === "maintenance-site-martin").id;
  const readDates = async () => (await (await page.request.get(`${url}/api/maintenance-occurrences?from=2027-09-01&to=2027-09-30`)).json()).occurrences.filter((entry) => entry.planId === id).map((entry) => entry.date);
  expect(await readDates()).toEqual(["2027-09-05"]); expect(state().jobs.length).toBe(0);
  await page.getByRole("button", { name: "Edit Plan", exact: true }).click();
  await page.getByLabel("Next due date", { exact: true }).fill("2027-09-16");
  await page.getByRole("button", { name: "Save Plan", exact: true }).click();
  await page.getByRole("dialog", { name: "Change maintenance date", exact: true }).getByRole("button", { name: "This occurrence only", exact: true }).click();
  await expect(page.locator("[data-maintenance-detail]")).toBeVisible();
  expect(await readDates()).toEqual(["2027-09-16"]);
  await page.goto(`${url}/maintenance`);
  await expect(page.locator(`[data-maintenance-plan="${id}"]`)).toContainText("16/09/2027");
  await expect(page.getByRole("complementary", { name: "Due Queue" }).getByText("20 Martin Street BRIGHTON", { exact: true })).toHaveCount(0);
  await page.locator(`[data-maintenance-plan="${id}"]`).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("inactive");
  await page.getByRole("button", { name: "Save Plan", exact: true }).click();
  await expect(page.locator("[data-maintenance-detail]")).toBeVisible();
  expect(await readDates()).toEqual([]);
  await context.close();
});

test("automatic recurrence, mouse drag, cancel, same-date no-op and persisted single occurrence", async ({ browser }, info) => {
  const { page, context, writes } = await open(browser);
  await expect(chip(page, "2027-09-09")).toBeVisible(); expect(state().jobs.length).toBe(0);
  await chip(page, "2027-09-09").dragTo(day(page, "2027-09-16"));
  const choice = page.getByRole("dialog", { name: "Change maintenance date", exact: true });
  await expect(choice).toBeVisible(); expect(writes.length).toBe(0); expect(exceptionCount()).toBe(0);
  await capture(page, info, "maintenance-recurring-date-choice");
  await choice.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(chip(page, "2027-09-09")).toBeVisible(); expect(writes.length).toBe(0);
  await chip(page, "2027-09-09").dragTo(day(page, "2027-09-09"));
  await expect(choice).toBeHidden(); expect(writes.length).toBe(0);
  await chip(page, "2027-09-09").dragTo(day(page, "2027-09-16"));
  await choice.getByRole("button", { name: "This occurrence only", exact: true }).click();
  await expect(choice).toBeHidden(); await expect(chip(page, "2027-09-16")).toBeVisible();
  await page.reload(); await expect(chip(page, "2027-09-16")).toBeVisible(); await expect(chip(page, "2027-09-09")).toHaveCount(0);
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(chip(page, "2027-09-16")).toBeVisible(); expect(exceptionCount()).toBe(1);
  await capture(page, info, "maintenance-calendar-desktop");
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(chip(page, "2028-03-09")).toBeVisible();
  await context.close();
});

test("schedule choice updates future cadence while retaining earlier months", async ({ browser }) => {
  const { page, context } = await open(browser);
  const choice = await propose(page, "2027-09-16");
  await choice.getByRole("button", { name: "Change maintenance schedule", exact: true }).click();
  await expect(choice).toBeHidden(); await expect(chip(page, "2027-09-16")).toBeVisible();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(chip(page, "2028-03-16")).toBeVisible();
  for (let i = 0; i < 12; i++) await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(chip(page, "2027-03-09")).toBeVisible();
  await context.close();
});

test("failed maintenance write restores the original date and shows a compact error", async ({ browser }) => {
  const { page, context } = await open(browser);
  await page.route("**/api/maintenance-plans/calendar-plan/occurrences", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This maintenance plan has changed. Refresh and try again." }) }));
  const choice = await propose(page, "2027-09-16");
  await choice.getByRole("button", { name: "This occurrence only", exact: true }).click();
  await expect(choice).toBeHidden();
  await expect(page.getByRole("alert").first()).toContainText("has changed");
  await page.getByRole("dialog", { name: "Scheduled maintenance", exact: true }).getByRole("button", { name: "Close calendar panel", exact: true }).click();
  await expect(chip(page, "2027-09-09")).toBeVisible(); expect(exceptionCount()).toBe(0);
  await context.close();
});

test("day inspector generates one linked job, preserves the maintenance chip, and opens the job", async ({ browser }, info) => {
  const { page, context } = await open(browser, 1920, 1080);
  await expect(chip(page, "2027-09-09")).toBeVisible();
  await day(page, "2027-09-09").locator(".calendar-day-open").click({ position: { x: 3, y: 3 } });
  const inspector = page.locator("[data-calendar-day-inspector]");
  await expect(inspector).toBeVisible();
  await inspector.getByRole("button", { name: "Generate Job", exact: true }).click();
  await expect(inspector.getByRole("button", { name: "Open Job", exact: true })).toBeVisible();
  await expect(chip(page, "2027-09-09")).toContainText("Job #");
  await expect(day(page, "2027-09-09").locator("[data-calendar-job]")).toHaveCount(0);
  expect(state().jobs.length).toBe(1); expect(state().jobs[0].description).toContain("Record operational readings");
  expect(state().jobs[0].description).toContain("Frequency: Biannually");
  await capture(page, info, "maintenance-calendar-inspector-linked-job");
  await inspector.getByRole("button", { name: "Open Job", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\//);
  await context.close();
});

for (const [name, width, height] of [["phone", 390, 844], ["tablet", 1024, 768]]) {
  test(`${name}: maintenance remains visible, uses the calendar sheet, and date choice persists`, async ({ browser }, info) => {
    const { page, context } = await open(browser, width, height);
    await expect(chip(page, "2027-09-09")).toBeVisible();
    await capture(page, info, `maintenance-calendar-${name}`);
    const choice = await propose(page, "2027-09-16");
    await capture(page, info, `maintenance-date-choice-${name}`);
    await choice.getByRole("button", { name: "This occurrence only", exact: true }).click();
    await expect(choice).toBeHidden(); await expect(chip(page, "2027-09-16")).toBeVisible();
    await page.goto(`${url}/maintenance`);
    await expect(page.locator("[data-maintenance-dashboard]")).toBeVisible();
    await expect(page.locator('[data-maintenance-plan="no-price-plan"] [data-contract-price="missing"]')).toContainText("Not set");
    await capture(page, info, `maintenance-dashboard-${name}`);
    await page.locator('[data-maintenance-plan="calendar-plan"]').getByRole("button", { name: "Open Plan" }).click();
    await expect(page.getByText("Record operational readings", { exact: true })).toBeVisible();
    await capture(page, info, `maintenance-plan-detail-${name}`);
    await context.close();
  });
}
