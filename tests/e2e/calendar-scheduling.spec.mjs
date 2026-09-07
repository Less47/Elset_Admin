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

import { scheduleJob, updateJobDetails } from "../../server-workspace-jobs.js";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "fixtures/demo-workspace.json");
const screenshotDir = path.join(repoRoot, "test-results/calendar");
const accountPassword = "E2E-calendar-pass-123";
let tempDataDir = "";
let baseUrl = "";
let serverProcess = null;
let serverOutput = "";

function calendarFixture() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const original = { ...fixture.jobs[0], notes: [], photos: [], quote: null, invoice: null };
  fixture.jobs = [
    { ...original, id: "calendar-todo", jobNumber: 212, customerName: "Massimo Test", title: "Gate repair", jobAddress: "12 Sample Road, Carlton VIC 3053", status: "To Do", urgency: "High", scheduledDate: "" },
    { ...original, id: "calendar-progress", jobNumber: 205, customerName: "MBCM St Kilda", title: "Shutter automation", jobAddress: "31 Charnwood Road, St Kilda", status: "In Progress", urgency: "Medium", assignedTechnicianId: "demo-staff-admin", assignedTechnicianName: "Jordan Vale", scheduledDate: "2026-09-15" },
    { ...original, id: "calendar-completed", jobNumber: 179, customerName: "Natasha Popovic", title: "Completed electrical work", status: "Completed", scheduledDate: "2026-09-15" },
    ...Array.from({ length: 5 }, (_, i) => ({ ...original, id: "calendar-crowded-" + i, jobNumber: 300 + i, customerName: i ? "Scheduled customer " + i : "LongCustomer".repeat(20), title: "Routine gate service", status: "To Do", assignedTechnicianId: "demo-staff-admin", assignedTechnicianName: "Jordan Vale", scheduledDate: "2026-09-15" })),
    ...Array.from({ length: 8 }, (_, i) => ({ ...original, id: "calendar-queue-" + i, jobNumber: 400 + i, customerName: "Queue customer " + i, title: "Inspect automation", status: i % 2 ? "In Progress" : "To Do", scheduledDate: "" })),
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


test.beforeAll(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-calendar-playwright-"));
  fs.mkdirSync(screenshotDir, { recursive: true });
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { importWorkspaceJsonData(db, calendarFixture()); } finally { db.close(); }
  await seedLoginAccounts();
  await startServer();
});
test.beforeEach(() => {
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { for (const job of calendarFixture().jobs) scheduleJob(db, job.id, job.scheduledDate); } finally { db.close(); }
});
test.afterAll(async () => {
  await stopServer();
  const target = path.resolve(tempDataDir);
  if (target.startsWith(path.join(os.tmpdir(), "elset-calendar-playwright-"))) fs.rmSync(target, { recursive: true, force: true });
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await info.attach("calendar-server-output", { body: serverOutput, contentType: "text/plain" });
});

async function openCalendar(browser, width = 1440, height = 900, timezoneId = "Australia/Sydney") {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1280, isMobile: width < 768, locale: "en-AU", timezoneId, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.setFixedTime("2026-09-07T02:00:00Z");
  await page.goto(baseUrl);
  await page.getByPlaceholder("Enter your username").fill("mobileadmin");
  await page.getByPlaceholder("Enter your password").fill(accountPassword);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  if (width < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator("[data-calendar-month]")).toHaveText("September 2026");
  const writes = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.startsWith("/api/")) writes.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() });
  });
  return { context, page, writes };
}
const day = (page, key) => page.locator('[data-calendar-date="' + key + '"]');
const calendarJob = (page, date, id) => day(page, date).locator('[data-calendar-job="' + id + '"]');
const queueJob = (page, id) => page.locator('[data-calendar-queue]:visible [data-calendar-queue-job="' + id + '"]');
const dbJob = (id) => readWorkspaceState().jobs.find((job) => job.id === id);
function unchangedFields(job) { const { scheduledDate, updatedAt, ...rest } = job; return rest; }
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
}
async function screenshot(page, info, name) {
  await page.waitForTimeout(250);
  const target = path.join(screenshotDir, name + ".png");
  await page.screenshot({ path: target, animations: "disabled" });
  await info.attach(name, { path: target, contentType: "image/png" });
}
async function chooseQueueDate(page, id, date) {
  await queueJob(page, id).getByRole("button", { name: /^(Schedule|Reschedule)$/, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: /^(Schedule|Reschedule) Job/ });
  await sheet.getByLabel("Scheduled date", { exact: true }).fill(date);
  await sheet.getByRole("button", { name: "Save date", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => dbJob(id).scheduledDate).toBe(date);
}

test("Calendar navigation, queue filters, crowded days and Job Details preserve context", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    await expect(page.locator(".calendar-mini-pane")).toBeVisible();
    await expect(page.locator("[data-mini-month]")).toHaveText("September 2026");
    await expect(page.locator("[data-calendar-date]")).toHaveCount(42);
    await expect(queueJob(page, "calendar-todo")).toBeVisible();
    await expect(queueJob(page, "calendar-progress")).toBeVisible();
    await expect(queueJob(page, "calendar-completed")).toHaveCount(0);
    await expect(day(page, "2026-09-15").locator("[data-calendar-job]")).toHaveCount(2);
    const more = day(page, "2026-09-15").getByRole("button", { name: "+ 5 more", exact: true });
    await expect(more).toBeVisible();
    await screenshot(page, info, "desktop-calendar-1440x900");
    await more.click();
    const dayPanel = page.getByRole("dialog", { name: /15 September/ });
    await expect(dayPanel.locator("[data-calendar-queue-job]")).toHaveCount(7);
    await screenshot(page, info, "desktop-populated-day");
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    const search = page.getByRole("searchbox", { name: "Search scheduling queue" });
    await search.fill("Charnwood");
    await expect(page.locator("[data-calendar-queue-job]")).toHaveCount(1);
    await expect(queueJob(page, "calendar-progress")).toBeVisible();
    await search.fill("212");
    await page.getByRole("button", { name: "Queue filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Queue filters", exact: true });
    await filters.getByRole("combobox", { name: "Urgency", exact: true }).click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await filters.getByRole("button", { name: "Done", exact: true }).click();
    await expect(queueJob(page, "calendar-todo")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator("[data-calendar-month]")).toHaveText("October 2026");
    await expect(page.locator("[data-mini-month]")).toHaveText("October 2026");
    await expect(search).toHaveValue("212");
    await expect(page.getByRole("button", { name: "Queue filters, 1 active" })).toBeVisible();
    await page.getByRole("button", { name: "Previous month in date navigator" }).click();
    await expect(page.locator("[data-calendar-month]")).toHaveText("September 2026");
    await page.locator('[data-mini-date="2026-08-31"]').click();
    await expect(page.locator("[data-calendar-month]")).toHaveText("August 2026");
    await expect(day(page, "2026-08-31")).toHaveAttribute("data-selected", "true");
    await queueJob(page, "calendar-todo").getByRole("button", { name: /^Open Job/ }).click();
    await expect(page).toHaveURL(/\/jobs\/calendar-todo$/);
    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    await expect(page.locator("[data-calendar-month]")).toHaveText("August 2026");
    await expect(search).toHaveValue("212");
    await expect(page.getByRole("button", { name: "Queue filters, 1 active" })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(day(page, "2026-09-07").getByRole("button")).toHaveAttribute("aria-current", "date");
    await expect(page.locator('[data-mini-date="2026-09-07"]')).toHaveAttribute("aria-current", "date");
    await day(page, "2026-09-15").locator("[data-calendar-job]").first().click();
    await expect(page).toHaveURL(/\/jobs\/calendar-crowded-/);
    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    await noOverflow(page);
    expect(writes).toEqual([]);
  } finally { await context.close(); }
});

test("mouse dragging schedules, reschedules and unschedules using only the date endpoint", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser);
  const original = dbJob("calendar-todo");
  try {
    await queueJob(page, "calendar-todo").dragTo(day(page, "2026-09-09"));
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("2026-09-09");
    await expect(day(page, "2026-09-09").locator('[data-calendar-job="calendar-todo"]')).toBeVisible();
    await day(page, "2026-09-09").locator('[data-calendar-job="calendar-todo"]').dragTo(day(page, "2026-09-11"));
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("2026-09-11");
    await expect(day(page, "2026-09-09").locator('[data-calendar-job="calendar-todo"]')).toHaveCount(0);
    await screenshot(page, info, "desktop-rescheduled-job");
    await day(page, "2026-09-11").locator('[data-calendar-job="calendar-todo"]').dragTo(page.locator("[data-calendar-unscheduled]"));
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("");
    expect(unchangedFields(dbJob("calendar-todo"))).toEqual(unchangedFields(original));
    expect(writes).toEqual(["2026-09-09", "2026-09-11", ""].map((scheduledDate) => ({ path: "/api/jobs/calendar-todo/schedule", method: "PATCH", body: { scheduledDate } })));
  } finally { await context.close(); }
});

test("existing calendar chips support same-date drops, shared dates and persistent rescheduling", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser);
  const first = "calendar-crowded-0";
  const second = "calendar-crowded-1";
  const originalJobs = readWorkspaceState().jobs;
  try {
    expect(dbJob(first).assignedTechnicianId).toBe("demo-staff-admin");
    await expect(calendarJob(page, "2026-09-15", first)).toHaveAttribute("draggable", "true");
    await calendarJob(page, "2026-09-15", first).dragTo(day(page, "2026-09-17"));
    await expect.poll(() => dbJob(first).scheduledDate).toBe("2026-09-17");
    await expect(calendarJob(page, "2026-09-15", first)).toHaveCount(0);
    await expect(calendarJob(page, "2026-09-17", first)).toHaveCount(1);
    const afterFirstMove = dbJob(first);
    await calendarJob(page, "2026-09-17", first).dragTo(day(page, "2026-09-17"));
    expect(writes).toHaveLength(1);
    expect(dbJob(first)).toEqual(afterFirstMove);
    await calendarJob(page, "2026-09-15", second).dragTo(day(page, "2026-09-17"));
    await expect.poll(() => dbJob(second).scheduledDate).toBe("2026-09-17");
    await expect(day(page, "2026-09-17").locator("[data-calendar-job]")).toHaveCount(2);
    expect(await day(page, "2026-09-17").locator("[data-calendar-job]").evaluateAll((elements) => elements.map((element) => element.dataset.calendarJob))).toEqual([first, second]);
    await screenshot(page, info, "reschedule-shared-date");
    const neighbour = dbJob(second);
    await calendarJob(page, "2026-09-17", first).dragTo(day(page, "2026-09-18"));
    await expect.poll(() => dbJob(first).scheduledDate).toBe("2026-09-18");
    await expect(day(page, "2026-09-17").locator("[data-calendar-job]")).toHaveCount(1);
    await expect(calendarJob(page, "2026-09-18", first)).toHaveCount(1);
    expect(dbJob(second)).toEqual(neighbour);
    for (const original of originalJobs) {
      if ([first, second].includes(original.id)) expect(unchangedFields(dbJob(original.id))).toEqual(unchangedFields(original));
      else expect(dbJob(original.id)).toEqual(original);
    }
    await page.reload();
    await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(calendarJob(page, "2026-09-18", first)).toHaveCount(1);
    await expect(calendarJob(page, "2026-09-17", first)).toHaveCount(0);
    await expect(calendarJob(page, "2026-09-17", second)).toHaveCount(1);
    expect(writes).toEqual([[first, "2026-09-17"], [second, "2026-09-17"], [first, "2026-09-18"]].map(([id, scheduledDate]) => ({ path: `/api/jobs/${id}/schedule`, method: "PATCH", body: { scheduledDate } })));
  } finally { await context.close(); }
});

test("adjacent-month calendar drops preserve their date across refresh and timezones", async ({ browser }, info) => {
  for (const [index, timezone] of ["Australia/Sydney", "Pacific/Honolulu"].entries()) {
    const { context, page, writes } = await openCalendar(browser, 1440, 900, timezone);
    const id = `calendar-crowded-${index}`;
    const original = dbJob(id);
    try {
      await calendarJob(page, "2026-09-15", id).dragTo(day(page, "2026-10-01"));
      await expect.poll(() => dbJob(id).scheduledDate).toBe("2026-10-01");
      await expect(page.locator("[data-calendar-month]")).toHaveText("September 2026");
      await expect(calendarJob(page, "2026-09-15", id)).toHaveCount(0);
      await expect(calendarJob(page, "2026-10-01", id)).toHaveCount(1);
      expect(unchangedFields(dbJob(id))).toEqual(unchangedFields(original));
      await page.reload();
      await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
      await expect(calendarJob(page, "2026-10-01", id)).toHaveCount(1);
      await expect(queueJob(page, id)).toContainText("1 Oct 2026");
      expect(writes).toEqual([{ path: `/api/jobs/${id}/schedule`, method: "PATCH", body: { scheduledDate: "2026-10-01" } }]);
      if (index === 0) await screenshot(page, info, "reschedule-adjacent-month");
    } finally { await context.close(); }
  }
});

for (const responseStatus of [500, 409]) {
  test(`existing-chip rescheduling rolls back after API ${responseStatus}`, async ({ browser }) => {
    const { context, page, writes } = await openCalendar(browser);
    const id = "calendar-crowded-0";
    const originalJobs = readWorkspaceState().jobs;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const message = responseStatus === 409 ? "This job changed elsewhere. Refresh and try again." : "Unable to reschedule this job. Try again.";
    try {
      await page.route(`**/api/jobs/${id}/schedule`, async (route) => {
        await gate;
        await route.fulfill({ status: responseStatus, json: { error: message } });
      });
      await calendarJob(page, "2026-09-15", id).dragTo(day(page, "2026-09-17"));
      await expect(calendarJob(page, "2026-09-15", id)).toHaveCount(0);
      await expect(calendarJob(page, "2026-09-17", id)).toHaveCount(1);
      expect(dbJob(id).scheduledDate).toBe("2026-09-15");
      release();
      await expect(page.getByRole("alert")).toHaveText(new RegExp(message.replaceAll(".", "\\.")));
      await expect(calendarJob(page, "2026-09-17", id)).toHaveCount(0);
      await expect(calendarJob(page, "2026-09-15", id)).toHaveCount(1);
      expect(readWorkspaceState().jobs).toEqual(originalJobs);
      expect(writes).toEqual([{ path: `/api/jobs/${id}/schedule`, method: "PATCH", body: { scheduledDate: "2026-09-17" } }]);
    } finally { release(); await context.close(); }
  });
}

test("unschedule drop restores the original calendar job when the API fails", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  const id = "calendar-crowded-0";
  const originalJobs = readWorkspaceState().jobs;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await page.route(`**/api/jobs/${id}/schedule`, async (route) => {
      await gate;
      await route.fulfill({ status: 500, json: { error: "Unable to remove the scheduled date." } });
    });
    await calendarJob(page, "2026-09-15", id).dragTo(page.locator("[data-calendar-unscheduled]"));
    await expect(calendarJob(page, "2026-09-15", id)).toHaveCount(0);
    await expect(queueJob(page, id)).toContainText("Unscheduled");
    expect(dbJob(id).scheduledDate).toBe("2026-09-15");
    release();
    await expect(page.getByRole("alert")).toContainText("Unable to remove the scheduled date");
    await expect(calendarJob(page, "2026-09-15", id)).toHaveCount(1);
    expect(readWorkspaceState().jobs).toEqual(originalJobs);
    expect(writes).toEqual([{ path: `/api/jobs/${id}/schedule`, method: "PATCH", body: { scheduledDate: "" } }]);
  } finally { release(); await context.close(); }
});

test("a pending date-only reschedule preserves newer edits from another session", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  const id = "calendar-crowded-0";
  const original = dbJob(id);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await page.route(`**/api/jobs/${id}/schedule`, async (route) => { await gate; await route.continue(); });
    await calendarJob(page, "2026-09-15", id).dragTo(day(page, "2026-09-17"));
    await expect(calendarJob(page, "2026-09-17", id)).toHaveCount(1);
    const externalEdit = await context.request.patch(`${baseUrl}/api/jobs/${id}`, { data: { title: "Edited in another session", urgency: "High" } });
    expect(externalEdit.ok()).toBe(true);
    const latestJob = dbJob(id);
    expect(latestJob.scheduledDate).toBe("2026-09-15");
    expect(latestJob.title).toBe("Edited in another session");
    release();
    await expect.poll(() => dbJob(id).scheduledDate).toBe("2026-09-17");
    await expect(queueJob(page, id)).toContainText("Edited in another session");
    expect(unchangedFields(dbJob(id))).toEqual(unchangedFields(latestJob));
    expect(writes).toEqual([{ path: `/api/jobs/${id}/schedule`, method: "PATCH", body: { scheduledDate: "2026-09-17" } }]);
  } finally {
    release();
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try { updateJobDetails(db, id, { title: original.title, urgency: original.urgency }); } finally { db.close(); }
    await context.close();
  }
});

test("Reschedule chooses any date from the queue or a completed job's day sheet", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser);
  const original = dbJob("calendar-progress");
  const completed = dbJob("calendar-completed");
  try {
    await queueJob(page, original.id).getByRole("button", { name: "Reschedule", exact: true }).click();
    let sheet = page.getByRole("dialog", { name: "Reschedule Job #205", exact: true });
    await expect(sheet.getByLabel("Scheduled date", { exact: true })).toHaveValue("2026-09-15");
    await sheet.getByLabel("Scheduled date", { exact: true }).fill("2027-05-20");
    await screenshot(page, info, "reschedule-date-chooser");
    await sheet.getByRole("button", { name: "Save date", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeHidden();
    await expect.poll(() => dbJob(original.id).scheduledDate).toBe("2027-05-20");
    expect(unchangedFields(dbJob(original.id))).toEqual(unchangedFields(original));
    await day(page, "2026-09-15").getByRole("button").first().click();
    const dayPanel = page.getByRole("dialog", { name: /15 September/ });
    await dayPanel.locator('[data-calendar-queue-job="calendar-completed"]').getByRole("button", { name: "Reschedule", exact: true }).click();
    sheet = page.getByRole("dialog", { name: "Reschedule Job #179", exact: true });
    await sheet.getByLabel("Scheduled date", { exact: true }).fill("2027-05-21");
    await sheet.getByRole("button", { name: "Save date", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(() => dbJob(completed.id).scheduledDate).toBe("2027-05-21");
    expect(unchangedFields(dbJob(completed.id))).toEqual(unchangedFields(completed));
    await page.reload();
    await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(queueJob(page, original.id)).toContainText("20 May 2027");
    expect(dbJob(completed.id).scheduledDate).toBe("2027-05-21");
    expect(writes).toHaveLength(2);
  } finally { await context.close(); }
});

test("failed scheduling restores the original date after an optimistic preview", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  const original = dbJob("calendar-progress");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await page.route("**/api/jobs/calendar-progress/schedule", async (route) => {
      await gate;
      await route.fulfill({ status: 500, json: { error: "Synthetic scheduling failure. Try again." } });
    });
    await queueJob(page, "calendar-progress").dragTo(day(page, "2026-09-17"));
    await expect(day(page, "2026-09-17").locator('[data-calendar-job="calendar-progress"]')).toBeVisible();
    expect(dbJob("calendar-progress").scheduledDate).toBe("2026-09-15");
    await expect(queueJob(page, "calendar-progress").getByRole("button", { name: "Reschedule", exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole("alert")).toContainText("Synthetic scheduling failure");
    await expect(day(page, "2026-09-17").locator('[data-calendar-job="calendar-progress"]')).toHaveCount(0);
    await expect(queueJob(page, "calendar-progress")).toContainText("15 Sept 2026");
    expect(dbJob("calendar-progress")).toEqual(original);
    expect(writes).toHaveLength(1);
  } finally { release(); await context.close(); }
});

test("iPad touch supports deliberate dragging, cancellation and ordinary queue scrolling", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser, 1024, 768);
  const original = dbJob("calendar-todo");
  const cdp = await context.newCDPSession(page);
  async function touch(type, point) {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [] });
  }
  async function begin(source, target) {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const start = await source.boundingBox();
    const end = await target.boundingBox();
    const from = { x: start.x + Math.min(50, start.width / 2), y: start.y + 20 };
    await touch("touchStart", from);
    await page.waitForTimeout(220);
    await touch("touchMove", { x: from.x - 12, y: from.y });
    await touch("touchMove", { x: end.x + end.width / 2, y: end.y + 20 });
  }
  try {
    const source = queueJob(page, "calendar-todo");
    await begin(source, day(page, "2026-09-09"));
    await expect(day(page, "2026-09-09")).toHaveAttribute("data-drop-active", "true");
    expect(writes).toHaveLength(0);
    await screenshot(page, info, "ipad-touch-drop-target");
    await touch("touchEnd");
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("2026-09-09");
    expect(dbJob("calendar-todo").status).toBe("To Do");
    const chip = day(page, "2026-09-09").locator('[data-calendar-job="calendar-todo"]');
    await begin(chip, day(page, "2026-09-10"));
    await expect(day(page, "2026-09-10")).toHaveAttribute("data-drop-active", "true");
    await chip.dispatchEvent("pointercancel", { pointerType: "touch" });
    await touch("touchCancel");
    await expect(page.locator(".calendar-drag-preview")).toHaveCount(0);
    expect(dbJob("calendar-todo").scheduledDate).toBe("2026-09-09");
    expect(writes).toHaveLength(1);
    await begin(chip, day(page, "2026-09-10"));
    await touch("touchEnd");
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("2026-09-10");
    expect(dbJob("calendar-todo").status).toBe("To Do");
    expect(unchangedFields(dbJob("calendar-todo"))).toEqual(unchangedFields(original));
    await expect(calendarJob(page, "2026-09-09", "calendar-todo")).toHaveCount(0);
    await expect(calendarJob(page, "2026-09-10", "calendar-todo")).toHaveCount(1);
    await source.scrollIntoViewIfNeeded();
    const box = await source.boundingBox();
    await touch("touchStart", { x: box.x + 35, y: box.y + 50 });
    await touch("touchMove", { x: box.x + 35, y: box.y - 100 });
    await touch("touchEnd");
    await expect.poll(() => page.locator(".calendar-queue-list").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(writes).toHaveLength(2);
    await noOverflow(page);
    await page.reload();
    await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(calendarJob(page, "2026-09-10", "calendar-todo")).toHaveCount(1);
  } finally { await context.close(); }
});

test("responsive Calendar matrix keeps scheduling usable in eight layouts", async ({ browser }, info) => {
  const viewports = [[390, 844], [768, 1024], [820, 1180], [1024, 768], [1180, 820], [1280, 720], [1440, 900], [1920, 1080]];
  for (const [index, [width, height]] of viewports.entries()) {
    const { context, page, writes } = await openCalendar(browser, width, height);
    try {
      await noOverflow(page);
      const columns = await page.locator(".calendar-layout").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(width >= 1180 ? 3 : width === 1024 ? 2 : 1);
      if (width >= 1180) await expect(page.locator(".calendar-mini-pane")).toBeVisible();
      else {
        await page.getByRole("button", { name: "Dates", exact: true }).click();
        await expect(page.locator(".calendar-mini-expanded")).toBeVisible();
        if (width === 390) {
          const navigator = page.locator(".calendar-mini-expanded");
          await navigator.locator('[data-mini-date="2026-09-07"]').focus();
          await page.keyboard.press("ArrowRight");
          await expect(navigator.locator('[data-mini-date="2026-09-08"]')).toBeFocused();
          await expect(day(page, "2026-09-08")).toHaveAttribute("data-selected", "true");
          await navigator.getByRole("button", { name: "Go to today in date navigator" }).click();
        }
        await page.getByRole("button", { name: "Dates", exact: true }).click();
      }
      await screenshot(page, info, `calendar-${width}x${height}`);
      if (width === 390) {
        const populatedDate = day(page, "2026-09-15").getByRole("button").first();
        await populatedDate.click();
        const dayPanel = page.getByRole("dialog", { name: /15 September/ });
        await expect(dayPanel.locator("[data-calendar-queue-job]")).toHaveCount(7);
        await page.keyboard.press("Escape");
        await expect(populatedDate).toBeFocused();
      }
      if (width < 1024) {
        await page.getByRole("button", { name: /^Jobs / }).click();
        await expect(page.getByRole("dialog", { name: "Scheduling jobs", exact: true })).toBeVisible();
        await screenshot(page, info, `queue-${width}x${height}`);
      }
      await queueJob(page, "calendar-progress").getByRole("button", { name: "Reschedule", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Reschedule Job #205", exact: true });
      const date = `2026-09-${20 + index}`;
      await sheet.getByLabel("Scheduled date", { exact: true }).fill(date);
      if (width === 390) await screenshot(page, info, "mobile-schedule-action");
      await sheet.getByRole("button", { name: "Save date", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(sheet).toBeHidden();
      await expect.poll(() => dbJob("calendar-progress").scheduledDate).toBe(date);
      expect(dbJob("calendar-progress").status).toBe("In Progress");
      expect(dbJob("calendar-progress").assignedTechnicianId).toBe("demo-staff-admin");
      if (width < 1024) await expect(page.getByRole("button", { name: /^Jobs / })).toBeFocused();
      expect(writes).toHaveLength(1);
      expect(writes[0].body).toEqual({ scheduledDate: date });
      await noOverflow(page);
    } finally { await context.close(); }
  }
});

test("date selection and accessible removal persist without timezone shifts", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser, 1440, 900, "Pacific/Honolulu");
  try {
    await chooseQueueDate(page, "calendar-todo", "2026-09-15");
    await page.reload();
    await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(queueJob(page, "calendar-todo")).toContainText("15 Sept 2026");
    expect(dbJob("calendar-todo").scheduledDate).toBe("2026-09-15");
    await queueJob(page, "calendar-todo").getByRole("button", { name: "Remove scheduled date for Job #212", exact: true }).click();
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("");
    expect(dbJob("calendar-todo").status).toBe("To Do");
    expect(writes.filter((request) => request.path === "/api/app-state")).toHaveLength(0);
  } finally { await context.close(); }
});

test("mobile queue filters retain focus and failed removal remains visible in the drawer", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser, 390, 844);
  const original = dbJob("calendar-progress");
  try {
    await page.getByRole("button", { name: /^Jobs / }).click();
    await page.getByRole("button", { name: "Queue filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Queue filters", exact: true });
    await filters.getByRole("combobox", { name: "Scheduled", exact: true }).click();
    await page.getByRole("option", { name: "Scheduled", exact: true }).click();
    await filters.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Queue filters, 1 active" })).toBeFocused();
    await expect(queueJob(page, "calendar-todo")).toHaveCount(0);
    await expect(queueJob(page, "calendar-completed")).toHaveCount(0);
    await expect(queueJob(page, "calendar-progress")).toBeVisible();
    await page.route("**/api/jobs/calendar-progress/schedule", (route) => route.fulfill({ status: 500, json: { error: "Unable to remove the date. Try again." } }));
    await queueJob(page, "calendar-progress").getByRole("button", { name: "Remove scheduled date for Job #205" }).click();
    const drawer = page.getByRole("dialog", { name: "Scheduling jobs", exact: true });
    await expect(drawer.getByRole("alert")).toContainText("Unable to remove the date");
    await expect(drawer.getByRole("alert")).toBeInViewport();
    await expect(queueJob(page, "calendar-progress")).toContainText("15 Sept 2026");
    expect(dbJob("calendar-progress")).toEqual(original);
    expect(writes).toEqual([{ path: "/api/jobs/calendar-progress/schedule", method: "PATCH", body: { scheduledDate: "" } }]);
    await noOverflow(page);
  } finally { await context.close(); }
});
