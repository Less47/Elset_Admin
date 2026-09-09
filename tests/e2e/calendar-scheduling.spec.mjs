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

import { insertJobTree, scheduleJob, updateJobDetails } from "../../server-workspace-jobs.js";
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
  const detailed = { ...original, notes: fixture.jobs[0].notes, quote: fixture.jobs[0].quote, invoice: fixture.jobs[0].invoice, scheduledTime: "10:30", importedScheduling: { startTime: "10:30", notes: "Preserve imported time metadata" } };
  fixture.jobs = [
    { ...original, id: "calendar-todo", jobNumber: 212, customerName: "Massimo Test", title: "Gate repair", jobAddress: "12 Sample Road, Carlton VIC 3053", status: "To Do", urgency: "High", scheduledDate: "" },
    { ...original, id: "calendar-progress", jobNumber: 205, customerName: "MBCM St Kilda", title: "Shutter automation", jobAddress: "31 Charnwood Road, St Kilda", status: "In Progress", urgency: "Medium", assignedTechnicianId: "demo-staff-admin", assignedTechnicianName: "Jordan Vale", scheduledDate: "2026-09-15" },
    { ...original, id: "calendar-completed", jobNumber: 179, customerName: "Natasha Popovic", title: "Completed electrical work", status: "Completed", scheduledDate: "2026-09-15" },
    ...Array.from({ length: 5 }, (_, i) => ({ ...(i ? original : detailed), id: "calendar-crowded-" + i, jobNumber: 300 + i, customerName: i ? "Scheduled customer " + i : "LongCustomer".repeat(20), title: "Routine gate service", status: "To Do", assignedTechnicianId: "demo-staff-admin", assignedTechnicianName: "Jordan Vale", scheduledDate: "2026-09-15" })),
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
  try {
    importWorkspaceJsonData(db, calendarFixture());
    // Seed arbitrary imported metadata in addition to the normal time field so
    // date-only writes are checked against unrelated data in SQLite's extra field.
    const { scheduledTime, importedScheduling } = calendarFixture().jobs.find((job) => job.id === "calendar-crowded-0");
    db.prepare("UPDATE jobs SET extra_json = ? WHERE id = ?").run(JSON.stringify({ scheduledTime, importedScheduling }), "calendar-crowded-0");
  } finally { db.close(); }
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
  // Finish the navigation drawer's exit before tests enable animations or send
  // raw coordinate taps (which do not perform Playwright actionability checks).
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked", "1");
  const writes = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.startsWith("/api/")) writes.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() });
  });
  return { context, page, writes };
}
const day = (page, key) => page.locator('[data-calendar-date="' + key + '"]');
const calendarJob = (page, date, id) => day(page, date).locator('[data-calendar-job="' + id + '"]');
const queueJob = (page, id) => page.locator('[data-calendar-queue]:visible [data-calendar-queue-job="' + id + '"]');
const dayDetails = (page, name = /September/) => page.locator("[data-calendar-day-inspector]").and(page.getByRole("region", { name })).or(page.getByRole("dialog", { name }));
const dayJobCards = "[data-calendar-inspector-job], [data-calendar-queue-job]";
const inspectorJob = (page, id) => page.locator(`[data-calendar-inspector-job="${id}"]`);
const dbJob = (id) => readWorkspaceState().jobs.find((job) => job.id === id);
function unchangedFields(job) { const { scheduledDate, updatedAt, ...rest } = job; return rest; }
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
}
async function expectCompactMobileToolbar(page) {
  const month = page.locator("[data-calendar-month]");
  const previous = page.getByRole("button", { name: "Previous month", exact: true });
  const today = page.getByRole("button", { name: "Today", exact: true });
  const next = page.getByRole("button", { name: "Next month", exact: true });
  const jobs = page.getByRole("button", { name: /^Jobs \d+$/ });
  await expect(page.getByRole("button", { name: "Dates", exact: true })).toHaveCount(0);
  await expect(page.locator(".calendar-mini-expanded")).toHaveCount(0);
  for (const control of [month, previous, today, next, jobs]) await expect(control).toBeVisible();
  const boxes = await Promise.all([month, previous, today, next, jobs].map((control) => control.boundingBox()));
  const centers = boxes.map((box) => box.y + box.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
  for (let index = 0; index < boxes.length - 1; index += 1) {
    expect(boxes[index].x + boxes[index].width).toBeLessThanOrEqual(boxes[index + 1].x + 1);
  }
  const toolbarBox = await page.locator("[data-calendar-toolbar]").boundingBox();
  expect(toolbarBox.height).toBeLessThanOrEqual(54);
  await noOverflow(page);
}
async function screenshot(page, info, name) {
  await page.waitForTimeout(250);
  const target = path.join(screenshotDir, name + (name.startsWith("bulk-") && info.project.name === "webkit" ? "-webkit" : "") + ".png");
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

async function clickDateArea(page, date, area = "center", touch = false) {
  const cell = day(page, date);
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  const points = {
    center: [box.width / 2, box.height / 2],
    number: [12, 11],
    // Dense event stacks can occupy the old 4px inset. Target the actual bottom
    // padding so this helper activates the date rather than the overflow row.
    bottom: [box.width / 2, box.height - 1.5],
    "top-left": [3, 3],
    "right-padding": [box.width - 4, box.height * 0.7],
    "right-border": [box.width - 1.5, box.height * 0.7],
  };
  const [x, y] = points[area];
  if (touch) await page.touchscreen.tap(box.x + x, box.y + y);
  else await page.mouse.click(box.x + x, box.y + y);
}

function prepareBulkDay() {
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try {
    for (const id of ["calendar-queue-0", "calendar-queue-1"]) scheduleJob(db, id, "2026-09-15");
    for (const id of ["calendar-todo", "calendar-queue-2"]) scheduleJob(db, id, "2026-09-16");
  } finally { db.close(); }
}

async function openBulkDay(page, date = "2026-09-15") {
  await day(page, date).locator(".calendar-day-open").click({ position: { x: 12, y: 12 } });
  await page.getByRole("button", { name: "Reschedule day", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Reschedule jobs", exact: true });
  await expect(panel.getByRole("checkbox", { name: /^Select all/ })).toBeVisible();
  return panel;
}

for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [1440, 900]]) {
  test(`bulk day selection, workload and eight-job persistence at ${width}x${height}`, async ({ browser }, info) => {
    prepareBulkDay();
    const originals = readWorkspaceState().jobs;
    const { context, page, writes } = await openCalendar(browser, width, height, width === 1440 ? "Pacific/Honolulu" : "Australia/Sydney");
    try {
      await day(page, "2026-09-15").locator(".calendar-day-open").click({ position: { x: 12, y: 12 } });
      await expect(page.getByRole("button", { name: "Reschedule day", exact: true })).toBeVisible();
      await screenshot(page, info, `bulk-normal-${width}x${height}`);
      await page.getByRole("button", { name: "Reschedule day", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Reschedule jobs", exact: true });
      const all = panel.getByRole("checkbox", { name: "Select all 8", exact: true });
      await expect(all).toBeChecked();
      await expect(panel.getByRole("checkbox")).toHaveCount(9);
      await expect(panel.getByRole("checkbox", { name: "Select Job #179", exact: true })).toHaveCount(0);
      await expect(panel.getByLabel("Move selected jobs to", { exact: true })).toHaveValue("");
      await expect(panel.getByRole("button", { name: "Move 8 jobs", exact: true })).toBeDisabled();
      await screenshot(page, info, `bulk-selection-${width}x${height}`);
      const individual = panel.getByRole("checkbox", { name: "Select Job #205", exact: true });
      await individual.focus();
      await page.keyboard.press("Space");
      await expect(individual).not.toBeChecked();
      await expect(all).toHaveAttribute("aria-checked", "mixed");
      await expect(panel.getByRole("button", { name: "Move 7 jobs", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "Clear all", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Move 0 jobs", exact: true })).toBeDisabled();
      await all.check();
      await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(9);
      const dateInput = panel.getByLabel("Move selected jobs to", { exact: true });
      await dateInput.fill("2026-09-15");
      await expect(panel.getByRole("button", { name: "Move 8 jobs", exact: true })).toBeDisabled();
      await expect(panel).toContainText("Choose a different date");
      await dateInput.fill("2026-09-16");
      await dateInput.focus();
      await expect(panel).toContainText("Wednesday 16 September 2026");
      await screenshot(page, info, `bulk-destination-${width}x${height}`);
      const workload = panel.getByRole("region", { name: "Destination workload" });
      await workload.scrollIntoViewIfNeeded();
      await expect(workload.locator("dd")).toHaveText(["2 jobs", "8 jobs", "10 jobs"]);
      await screenshot(page, info, `bulk-workload-${width}x${height}`);
      await noOverflow(page);
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await panel.getByRole("button", { name: "Move 8 jobs", exact: true }).click();
      const source = dayDetails(page, /15 September/);
      await expect(source).toContainText("8 jobs moved to Wednesday 16 September.");
      await expect(source).toContainText(/1 (scheduled )?job/);
      await expect(source.getByRole("button", { name: "Reschedule day", exact: true })).toHaveCount(0);
      await expect(source).toContainText("No active jobs available to reschedule.");
      await screenshot(page, info, `bulk-success-${width}x${height}`);
      const active = originals.filter((job) => job.scheduledDate === "2026-09-15" && job.status !== "Completed");
      for (const original of active) {
        expect(dbJob(original.id).scheduledDate).toBe("2026-09-16");
        expect(unchangedFields(dbJob(original.id))).toEqual(unchangedFields(original));
      }
      expect(dbJob("calendar-completed").scheduledDate).toBe("2026-09-15");
      await source.getByRole("button", { name: "Close calendar panel" }).click();
      await expect(day(page, "2026-09-16").locator(".calendar-day-open")).toHaveAttribute("aria-label", /10 jobs$/);
      await page.reload();
      if (width < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
      await expect(day(page, "2026-09-16").locator(".calendar-day-open")).toHaveAttribute("aria-label", /10 jobs$/);
      await expect(day(page, "2026-09-15").locator(".calendar-day-open")).toHaveAttribute("aria-label", /1 job$/);
      expect(writes).toHaveLength(1);
      expect(writes[0].path).toBe("/api/jobs/reschedule-day");
      expect(writes[0].body.jobs).toHaveLength(8);
      expect(Object.keys(writes[0].body).sort()).toEqual(["jobs", "scheduledDate", "sourceDate"]);
    } finally { await context.close(); }
  });
}

test("bulk day splitting, empty-day eligibility and focus transitions", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    await day(page, "2026-09-08").locator(".calendar-day-open").click();
    await expect(dayDetails(page)).toContainText("No active jobs available to reschedule.");
    await expect(page.getByRole("button", { name: "Reschedule day", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Close calendar panel" }).click();
    let panel = await openBulkDay(page);
    await expect(panel.getByRole("heading", { name: "Reschedule jobs", exact: true })).toBeFocused();
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dayDetails(page, /15 September/).getByRole("heading", { name: /15 September/ })).toBeFocused();
    await page.getByRole("button", { name: "Reschedule day", exact: true }).click();
    panel = page.getByRole("dialog", { name: "Reschedule jobs", exact: true });
    await panel.getByRole("checkbox", { name: "Select Job #205", exact: true }).uncheck();
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-16");
    await panel.getByRole("button", { name: "Move 5 jobs", exact: true }).click();
    await expect(dayDetails(page, /15 September/)).toContainText(/2 (scheduled )?jobs/);
    await page.getByRole("button", { name: "Reschedule day", exact: true }).click();
    panel = page.getByRole("dialog", { name: "Reschedule jobs", exact: true });
    await expect(panel.getByRole("checkbox", { name: "Select all 1", exact: true })).toBeChecked();
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-17");
    await panel.getByRole("button", { name: "Move 1 job", exact: true }).click();
    await expect.poll(() => dbJob("calendar-progress").scheduledDate).toBe("2026-09-17");
    expect(readWorkspaceState().jobs.filter((job) => job.scheduledDate === "2026-09-16")).toHaveLength(5);
    expect(writes.map(({ path }) => path)).toEqual(["/api/jobs/reschedule-day", "/api/jobs/reschedule-day"]);
  } finally { await context.close(); }
});

test("bulk day partial conflict reports exact outcomes and requires review before retry", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  const original = dbJob("calendar-progress");
  try {
    let panel = await openBulkDay(page);
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try { updateJobDetails(db, original.id, { title: "Edited elsewhere during selection" }); } finally { db.close(); }
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-16");
    await panel.getByRole("button", { name: "Move 6 jobs", exact: true }).click();
    await expect(panel.locator("[data-bulk-result]")).toContainText("5 of 6 jobs moved.");
    await expect(panel.getByRole("list", { name: "Jobs not moved" })).toContainText("Job #205");
    await expect(panel.getByRole("list", { name: "Jobs not moved" })).toContainText("changed elsewhere");
    expect(dbJob(original.id).scheduledDate).toBe("2026-09-15");
    expect(dbJob(original.id).title).toBe("Edited elsewhere during selection");
    await panel.getByRole("button", { name: "Review failed jobs", exact: true }).click();
    panel = page.getByRole("dialog", { name: "Reschedule jobs", exact: true });
    await expect(panel.getByRole("checkbox", { name: "Select all 1", exact: true })).toBeChecked();
    await expect(panel).toContainText("Edited elsewhere during selection");
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-17");
    await panel.getByRole("button", { name: "Move 1 job", exact: true }).click();
    await expect.poll(() => dbJob(original.id).scheduledDate).toBe("2026-09-17");
    expect(writes).toHaveLength(2);
  } finally {
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try { updateJobDetails(db, original.id, { title: original.title }); } finally { db.close(); }
    await context.close();
  }
});

test("bulk day Undo restores dates, expires and refuses concurrent edits", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  const original = dbJob("calendar-progress");
  try {
    let panel = await openBulkDay(page);
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-16");
    await panel.getByRole("button", { name: "Move 6 jobs", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-bulk-notice]")).toContainText("6 of 6 jobs restored");
    expect(dbJob(original.id).scheduledDate).toBe("2026-09-15");
    expect(unchangedFields(dbJob(original.id))).toEqual(unchangedFields(original));
    await page.getByRole("button", { name: "Reschedule day", exact: true }).click();
    panel = page.getByRole("dialog", { name: "Reschedule jobs", exact: true });
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-16");
    await panel.getByRole("button", { name: "Move 6 jobs", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try { updateJobDetails(db, original.id, { title: "Edited after move" }); } finally { db.close(); }
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-bulk-notice]")).toContainText("5 of 6 jobs restored");
    await expect(page.getByRole("list", { name: "Jobs not restored" })).toContainText("Job #205");
    expect(dbJob(original.id).scheduledDate).toBe("2026-09-16");
    expect(dbJob(original.id).title).toBe("Edited after move");
    await page.getByRole("button", { name: "Reschedule day", exact: true }).click();
    panel = page.getByRole("dialog", { name: "Reschedule jobs", exact: true });
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-17");
    await panel.getByRole("button", { name: "Move 5 jobs", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await page.clock.runFor(15_001);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
    expect(writes.filter((request) => request.path === "/api/app-state")).toHaveLength(0);
  } finally {
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try { updateJobDetails(db, original.id, { title: original.title }); } finally { db.close(); }
    await context.close();
  }
});

test("bulk day lost response reconciles through review without claiming success or duplicating the move", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    const panel = await openBulkDay(page);
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-16");
    await page.route("**/api/jobs/reschedule-day", async (route) => {
      await route.fetch();
      await route.abort("failed");
    });
    await panel.getByRole("button", { name: "Move 6 jobs", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Unable to confirm the move. Review the day");
    await expect(page.locator("[data-bulk-notice]")).toHaveCount(0);
    expect(dbJob("calendar-progress").scheduledDate).toBe("2026-09-16");
    await panel.getByRole("button", { name: "Review day", exact: true }).click();
    await expect(panel).toContainText("No active jobs available to reschedule.");
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dayDetails(page, /15 September/)).toContainText(/1 (scheduled )?job/);
    expect(writes).toHaveLength(1);
  } finally { await context.close(); }
});

test("bulk day pending save disables duplicate submissions and sheet dismissal", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser, 390, 844);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    const panel = await openBulkDay(page);
    await panel.getByLabel("Move selected jobs to", { exact: true }).fill("2026-09-16");
    await page.route("**/api/jobs/reschedule-day", async (route) => { await gate; await route.continue(); });
    await panel.getByRole("button", { name: "Move 6 jobs", exact: true }).tap();
    await expect(panel.getByRole("button", { name: "Moving jobs\u2026", exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Close calendar panel", exact: true })).toBeDisabled();
    await expect(panel.getByRole("checkbox", { name: "Select all 6", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    expect(dbJob("calendar-progress").scheduledDate).toBe("2026-09-15");
    release();
    await expect(dayDetails(page, /15 September/)).toContainText("6 jobs moved to Wednesday 16 September.");
    expect(writes).toHaveLength(1);
  } finally { release(); await context.close(); }
});

test("bulk day cancelled preview cannot overwrite a later single-job reschedule", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let snapshotReady;
  const snapshot = new Promise((resolve) => { snapshotReady = resolve; });
  try {
    await page.route("**/api/jobs/reschedule-day?*", async (route) => {
      const response = await route.fetch();
      snapshotReady();
      await gate;
      await route.fulfill({ response });
    });
    await day(page, "2026-09-15").locator(".calendar-day-open").click({ position: { x: 12, y: 12 } });
    await page.getByRole("button", { name: "Reschedule day", exact: true }).click();
    await snapshot;
    await page.getByRole("button", { name: "Close calendar panel", exact: true }).click();
    await chooseQueueDate(page, "calendar-progress", "2026-09-17");
    const previewFinished = page.waitForResponse((response) => response.url().includes("/api/jobs/reschedule-day?"));
    release();
    await previewFinished;
    await expect(calendarJob(page, "2026-09-17", "calendar-progress")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(day(page, "2026-09-15").locator(".calendar-day-open")).toHaveAttribute("aria-label", /6 jobs$/);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("/api/jobs/calendar-progress/schedule");
  } finally { release(); await context.close(); }
});

for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1280, 720], [1440, 900]]) {
  test(`date-cell single activation covers whitespace, close/reopen and keyboard at ${width}x${height}`, async ({ browser }, info) => {
    const { context, page, writes } = await openCalendar(browser, width, height);
    const touch = width < 1280;
    const inline = await page.locator(".calendar-mini-pane").isVisible();
    const miniBox = inline ? await page.locator(".calendar-mini-pane > .calendar-mini").boundingBox() : null;
    const originalMain = await page.locator(".calendar-main").boundingBox();
    const originalQueue = await page.locator(".calendar-queue-pane").boundingBox();
    try {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (const area of ["center", "bottom", "number", "top-left", "right-padding", "right-border"]) {
        await clickDateArea(page, "2026-09-08", area, touch);
        const panel = dayDetails(page, /8 September/);
        await expect(panel).toBeVisible();
        await expect(panel).toContainText("No jobs scheduled.");
        await expect(day(page, "2026-09-08")).toHaveAttribute("data-selected", "true");
        await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
        if (touch) await panel.getByRole("button", { name: "Close calendar panel" }).tap();
        else await panel.getByRole("button", { name: "Close calendar panel" }).click();
        await expect(dayDetails(page)).toHaveCount(0);
        expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe("auto");
        expect(await day(page, "2026-09-08").evaluate((cell) => cell.closest('[inert], [aria-hidden="true"]'))).toBeNull();
      }
      await clickDateArea(page, "2026-09-06", "bottom", touch);
      await expect(dayDetails(page, /6 September/)).toBeVisible();
      const visibleSwitchDate = width >= 768 ? "2026-09-11" : "2026-09-08";
      await clickDateArea(page, visibleSwitchDate, "bottom", touch);
      await expect(dayDetails(page, new RegExp(`${Number(visibleSwitchDate.slice(-2))} September`))).toBeVisible();
      await expect(dayDetails(page)).toHaveCount(1);
      if (inline) await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Close calendar panel" }).click();
      // The next, different date works on the very next gesture after close.
      for (const date of ["2026-09-05", "2026-09-08", "2026-09-12"]) {
        await clickDateArea(page, date, "bottom", touch);
        await expect(dayDetails(page)).toContainText("No jobs scheduled.");
        await expect(day(page, date)).toHaveAttribute("data-selected", "true");
        await page.getByRole("button", { name: "Close calendar panel" }).click();
      }
      await clickDateArea(page, "2026-09-15", "bottom", touch);
      const populated = dayDetails(page, /15 September/);
      await expect(populated.locator(dayJobCards)).toHaveCount(7);
      if (width >= 1024 && width > height) {
        await populated.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const [panelBox, workspaceBox, mainBox, navigationBox, queueBox] = await Promise.all([
          populated.boundingBox(),
          page.locator("[data-calendar-workspace]").boundingBox(),
          page.locator("[data-calendar-main]").boundingBox(),
          page.getByRole("navigation", { name: "Application" }).boundingBox(),
          page.locator(".calendar-queue-pane").boundingBox(),
        ]);
        expect(panelBox.x).toBeGreaterThanOrEqual(workspaceBox.x - 1);
        expect(panelBox.x).toBeLessThanOrEqual(workspaceBox.x + 1);
        expect(panelBox.x).toBeGreaterThanOrEqual(navigationBox.x + navigationBox.width);
        if (inline) {
          expect(panelBox.width).toBe(miniBox.width);
          expect(mainBox).toEqual(originalMain);
          expect(queueBox).toEqual(originalQueue);
          await expect(page.locator(".calendar-day-panel")).toHaveCount(0);
        } else {
          expect(panelBox.width).toBeGreaterThanOrEqual(287);
          expect(panelBox.width).toBeLessThanOrEqual(381);
        }
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(queueBox.x + 1);
        expect(mainBox.x + mainBox.width - (panelBox.x + panelBox.width)).toBeGreaterThan(100);
        const queueSearch = page.locator(".calendar-queue-pane").getByRole("searchbox", { name: "Search scheduling queue" });
        await queueSearch.fill("Charnwood");
        await expect(queueJob(page, "calendar-progress")).toBeVisible();
        await expect(populated).toBeVisible();
        await queueSearch.fill("");
      }
      await screenshot(page, info, `date-cell-panel-${browser.browserType().name()}-${width}x${height}`);
      if (inline) {
        await populated.getByRole("button", { name: "Close calendar panel" }).click();
        await expect(page.locator(".calendar-mini-pane > .calendar-mini")).toBeVisible();
        expect(await page.locator(".calendar-main").boundingBox()).toEqual(originalMain);
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(day(page, "2026-09-15").getByRole("button").first()).toBeFocused();
      const keyboardDate = day(page, "2026-09-07").getByRole("button").first();
      await expect(keyboardDate).toHaveAttribute("aria-current", "date");
      for (const key of ["Enter", "Space"]) {
        await keyboardDate.focus();
        await page.keyboard.press(key);
        await expect(dayDetails(page, /7 September/)).toBeVisible();
        await expect(keyboardDate).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Escape");
        await expect(keyboardDate).toBeFocused();
      }
      await noOverflow(page);
      expect(writes).toEqual([]);
    } finally { await context.close(); }
  });
}

test("date-cell direct switching updates the open panel and job chips keep their own action", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    await clickDateArea(page, "2026-09-05", "bottom");
    const sheet = dayDetails(page);
    await expect(sheet.getByRole("heading")).toHaveAccessibleName("Saturday 5 September");
    for (const date of ["2026-09-09", "2026-09-11", "2026-09-12", "2026-09-10"]) {
      await clickDateArea(page, date, "bottom");
      await expect(day(page, date)).toHaveAttribute("data-selected", "true");
      await expect(dayDetails(page)).toHaveCount(1);
      await expect(sheet.getByRole("heading")).toHaveAccessibleName(new RegExp(`${Number(date.slice(-2))} September`));
      expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe("auto");
    }
    const lastDate = day(page, "2026-09-12").getByRole("button").first();
    await lastDate.focus();
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("heading")).toHaveAccessibleName("Saturday 12 September");
    // The visible job chip is a sibling of the date button, never nested in it.
    await calendarJob(page, "2026-09-15", "calendar-crowded-0").click();
    await expect(page).toHaveURL(/\/jobs\/calendar-crowded-0$/);
    await expect(page.locator(".calendar-sheet")).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    await clickDateArea(page, "2026-09-06", "center");
    await expect(dayDetails(page, /6 September/)).toBeVisible();
    expect(writes).toEqual([]);
  } finally { await context.close(); }
});

test("date-cell activation ignores drag-generated clicks but accepts the next mouse gesture immediately", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    const chip = calendarJob(page, "2026-09-15", "calendar-crowded-0");
    await chip.dragTo(day(page, "2026-09-09"));
    await expect.poll(() => dbJob("calendar-crowded-0").scheduledDate).toBe("2026-09-09");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // A compatibility click after dropping has no new pointerdown.
    await day(page, "2026-09-09").getByRole("button").first().dispatchEvent("click", { detail: 1 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await clickDateArea(page, "2026-09-08", "bottom");
    await expect(dayDetails(page, /8 September/)).toBeVisible();
    await page.keyboard.press("Escape");
    await calendarJob(page, "2026-09-09", "calendar-crowded-0").click();
    await expect(page).toHaveURL(/\/jobs\/calendar-crowded-0$/);
    await expect(page.locator(".calendar-sheet")).toHaveCount(0);
    expect(writes).toHaveLength(1);
  } finally { await context.close(); }
});

test("date-cell touch activation recovers immediately after drop, pointercancel, touchcancel and Escape", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser, 1024, 768);
  const cdp = await context.newCDPSession(page);
  const id = "calendar-crowded-0";
  async function touch(type, point) {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [] });
  }
  async function begin(source, date) {
    await source.scrollIntoViewIfNeeded();
    const start = await source.boundingBox();
    const end = await day(page, date).boundingBox();
    const from = { x: start.x + start.width / 2, y: start.y + 20 };
    await touch("touchStart", from);
    await page.waitForTimeout(220);
    await touch("touchMove", { x: from.x - 12, y: from.y });
    await touch("touchMove", { x: end.x + end.width / 2, y: end.y + 20 });
    await expect(day(page, date)).toHaveAttribute("data-drop-active", "true");
  }
  async function tapAfterDrag() {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".calendar-drag-preview, [data-drop-active]")).toHaveCount(0);
    const dateButton = day(page, "2026-09-08").getByRole("button").first();
    await dateButton.dispatchEvent("mousedown", { detail: 1 });
    await dateButton.dispatchEvent("click", { detail: 1 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await clickDateArea(page, "2026-09-08", "bottom", true);
    await expect(dayDetails(page, /8 September/)).toBeVisible();
    await page.getByRole("button", { name: "Close calendar panel" }).tap();
  }
  try {
    await begin(calendarJob(page, "2026-09-15", id), "2026-09-09");
    await touch("touchEnd");
    await expect.poll(() => dbJob(id).scheduledDate).toBe("2026-09-09");
    await tapAfterDrag();
    for (const cancellation of ["pointercancel", "touchcancel", "Escape"]) {
      const chip = calendarJob(page, "2026-09-09", id);
      await begin(chip, "2026-09-10");
      if (cancellation === "pointercancel") await chip.dispatchEvent("pointercancel", { pointerType: "touch" });
      if (cancellation === "Escape") await page.keyboard.press("Escape");
      await touch("touchCancel");
      await tapAfterDrag();
      expect(dbJob(id).scheduledDate).toBe("2026-09-09");
    }
    expect(writes).toEqual([{ path: `/api/jobs/${id}/schedule`, method: "PATCH", body: { scheduledDate: "2026-09-09" } }]);
    await noOverflow(page);
  } finally { await context.close(); }
});

test("Calendar navigation, queue filters, crowded days and Job Details preserve context", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    await expect(page.locator(".calendar-mini-pane")).toBeVisible();
    await expect(page.locator("[data-mini-month]")).toHaveText("September 2026");
    await expect(page.locator("[data-calendar-date]")).toHaveCount(42);
    await expect(queueJob(page, "calendar-todo")).toBeVisible();
    await expect(queueJob(page, "calendar-progress")).toBeVisible();
    await expect(queueJob(page, "calendar-completed")).toHaveCount(0);
    await expect(day(page, "2026-09-15").locator("[data-calendar-job]")).toHaveCount(5);
    const more = day(page, "2026-09-15").getByRole("button", { name: "+ 2 more", exact: true });
    await expect(more).toBeVisible();
    await screenshot(page, info, "desktop-calendar-1440x900");
    await more.click();
    const dayPanel = dayDetails(page, /15 September/);
    await expect(dayPanel.locator(dayJobCards)).toHaveCount(7);
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
    await page.getByRole("button", { name: "Next month", exact: true }).click();
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
    await clickDateArea(page, "2026-09-05", "bottom");
    const dayPanel = dayDetails(page, /5 September/);
    await expect(dayPanel).toBeVisible();
    await queueJob(page, "calendar-todo").dragTo(day(page, "2026-09-09"));
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("2026-09-09");
    await expect(day(page, "2026-09-09").locator('[data-calendar-job="calendar-todo"]')).toBeVisible();
    await expect(dayPanel).toBeVisible();
    await day(page, "2026-09-09").locator('[data-calendar-job="calendar-todo"]').dragTo(day(page, "2026-09-11"));
    await expect.poll(() => dbJob("calendar-todo").scheduledDate).toBe("2026-09-11");
    await expect(day(page, "2026-09-09").locator('[data-calendar-job="calendar-todo"]')).toHaveCount(0);
    await expect(dayPanel).toBeVisible();
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
    await day(page, "2026-09-15").getByRole("button").first().click({ position: { x: 12, y: 11 } });
    const dayPanel = dayDetails(page, /15 September/);
    await dayPanel.locator('[data-calendar-inspector-job="calendar-completed"], [data-calendar-queue-job="calendar-completed"]').getByRole("button", { name: /^Reschedule( Job #179)?$/ }).click();
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

test("Day Inspector replaces only the mini column across desktop, tablet and phone layouts", async ({ browser }, info) => {
  for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1180, 820], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
    const { context, page, writes } = await openCalendar(browser, width, height);
    try {
      const inline = await page.locator(".calendar-mini-pane").isVisible();
      const mainBefore = await page.locator(".calendar-main").boundingBox();
      const queueBefore = await page.locator(".calendar-queue-pane").boundingBox();
      const columnBefore = await page.locator(".calendar-mini-pane").boundingBox();
      const miniBefore = inline ? await page.locator(".calendar-mini-pane > .calendar-mini").boundingBox() : null;
      await clickDateArea(page, "2026-09-15", "number", width < 1280);
      const details = dayDetails(page, /15 September/);
      await expect(details.locator(dayJobCards)).toHaveCount(7);
      expect(await page.locator(".calendar-main").boundingBox()).toEqual(mainBefore);
      expect(await page.locator(".calendar-queue-pane").boundingBox()).toEqual(queueBefore);
      if (inline) {
        const inspector = page.locator("[data-calendar-day-inspector]");
        await expect(inspector).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.locator('[data-slot="dialog-overlay"], .calendar-day-panel')).toHaveCount(0);
        await expect(page.locator(".calendar-mini-pane > .calendar-mini")).toHaveCount(0);
        const inspectorBox = await inspector.boundingBox();
        expect(inspectorBox.x).toBe(miniBefore.x);
        expect(inspectorBox.width).toBe(miniBefore.width);
        expect(inspectorBox.x + inspectorBox.width).toBeLessThanOrEqual(mainBefore.x);
        const compact = await inspectorJob(page, "calendar-crowded-0").evaluate((element) => {
          const customer = element.querySelector(".calendar-inspector-customer");
          return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, overflow: element.scrollWidth > element.clientWidth, ellipsis: getComputedStyle(customer).textOverflow, nowrap: getComputedStyle(customer).whiteSpace, truncated: customer.scrollWidth > customer.clientWidth };
        });
        expect(compact.overflow).toBe(false);
        expect(compact.height).toBeLessThanOrEqual(width < 1280 ? 102 : 90);
        expect(compact.ellipsis).toBe("ellipsis");
        expect(compact.nowrap).toBe("nowrap");
        expect(compact.truncated).toBe(true);
        const action = await inspectorJob(page, "calendar-crowded-0").getByRole("button", { name: "Reschedule Job #300" }).boundingBox();
        const bulk = await inspector.getByRole("button", { name: "Reschedule day", exact: true }).boundingBox();
        expect(action.height).toBe(width < 1280 ? 40 : 28);
        expect(bulk.height).toBe(width < 1280 ? 40 : 30);
        await expect(inspectorJob(page, "calendar-crowded-0").locator("[data-inspector-time]")).toContainText("10:30");
        await expect(inspectorJob(page, "calendar-crowded-1").locator("[data-inspector-time]")).toHaveCount(0);
        fs.writeFileSync(path.join(screenshotDir, `inspector-${width}x${height}.json`), JSON.stringify({ columnBefore, miniBefore, inspectorBox, mainBefore, mainOpen: await page.locator(".calendar-main").boundingBox(), queueBefore, queueOpen: await page.locator(".calendar-queue-pane").boundingBox(), compact, actionHeight: action.height, bulkHeight: bulk.height }, null, 2));
      } else {
        await expect(page.locator("[data-calendar-day-inspector]")).toHaveCount(0);
        await expect(details).toHaveAttribute("role", "dialog");
      }
      await screenshot(page, info, `inspector-${width}x${height}`);
      if (width < 768) {
        await page.getByRole("button", { name: "Close calendar panel" }).click();
        await expect(details).toHaveCount(0);
      }
      await clickDateArea(page, "2026-09-11", "number", width < 1280);
      await expect(dayDetails(page, /11 September/)).toContainText("No jobs scheduled.");
      await page.getByRole("button", { name: "Close calendar panel" }).click();
      await expect(dayDetails(page)).toHaveCount(0);
      await expect(page.locator("[data-calendar-month]")).toHaveText("September 2026");
      if (inline) {
        await expect(page.locator('.calendar-mini-pane [data-mini-date="2026-09-11"]')).toHaveAttribute("aria-pressed", "true");
        expect(await page.locator(".calendar-main").boundingBox()).toEqual(mainBefore);
        await page.getByRole("button", { name: "Next month in date navigator" }).click();
        await clickDateArea(page, "2026-10-11", "number");
        await expect(dayDetails(page, /11 October/)).toBeVisible();
        await page.getByRole("button", { name: "Close calendar panel" }).click();
        await expect(page.locator("[data-mini-month]")).toHaveText("October 2026");
        if (width === 1440) {
          await clickDateArea(page, "2026-10-11", "number");
          await page.setViewportSize({ width: 1024, height: 768 });
          await expect(page.locator("[data-calendar-day-inspector]")).toHaveCount(0);
          await expect(page.getByRole("dialog", { name: /11 October/ })).toBeVisible();
          await page.setViewportSize({ width, height });
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(page.locator("[data-calendar-day-inspector]")).toHaveAttribute("data-inspector-date", "2026-10-11");
          await page.keyboard.press("Escape");
          await expect(page.locator("[data-mini-month]")).toHaveText("October 2026");
          await expect(day(page, "2026-10-11").locator(".calendar-day-open")).toBeFocused();
        }
      }
      if (width < 768) await expectCompactMobileToolbar(page);
      await noOverflow(page);
      expect(writes).toEqual([]);
    } finally { await context.close(); }
  }
});

test("Day Inspector drags redistribute the source day with date-only persistence", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    await clickDateArea(page, "2026-09-15", "number");
    const inspector = page.locator("[data-calendar-day-inspector]");
    const original = dbJob("calendar-crowded-0");
    expect(original.scheduledTime).toBe("10:30");
    expect(original.notes.length).toBeGreaterThan(0);
    expect(original.quote).not.toBeNull();
    expect(original.invoice).not.toBeNull();
    await inspectorJob(page, original.id).locator(".calendar-inspector-grip").dragTo(day(page, "2026-09-15"));
    expect(writes).toEqual([]);
    expect(dbJob(original.id)).toEqual(original);
    const moves = [[original.id, "2026-09-16"], ["calendar-progress", "2026-09-17"], ["calendar-completed", "2026-09-18"]];
    for (const [index, [id, destination]] of moves.entries()) {
      const before = dbJob(id);
      await inspectorJob(page, id).locator(".calendar-inspector-grip").dragTo(day(page, destination));
      await expect.poll(() => dbJob(id).scheduledDate).toBe(destination);
      expect(unchangedFields(dbJob(id))).toEqual(unchangedFields(before));
      await expect(inspector).toHaveAttribute("data-inspector-date", "2026-09-15");
      await expect(inspector.locator("[data-calendar-inspector-job]")).toHaveCount(6 - index);
      await expect(inspector.getByRole("status")).toHaveText(`${6 - index} jobs`);
      await expect(inspectorJob(page, id)).toHaveCount(0);
      await expect(calendarJob(page, "2026-09-15", id)).toHaveCount(0);
      await expect(calendarJob(page, destination, id)).toHaveCount(1);
    }
    expect(writes).toEqual(moves.map(([id, scheduledDate]) => ({ path: `/api/jobs/${id}/schedule`, method: "PATCH", body: { scheduledDate } })));
    await screenshot(page, info, "inspector-redistributed");
    await page.reload();
    await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Calendar", exact: true }).click();
    for (const [id, destination] of moves) await expect(calendarJob(page, destination, id)).toHaveCount(1);
    expect(unchangedFields(dbJob(original.id))).toEqual(unchangedFields(original));
    await clickDateArea(page, "2026-09-15", "number");
    await expect(inspector.locator("[data-calendar-inspector-job]")).toHaveCount(4);
  } finally { await context.close(); }
});

for (const status of [500, 409]) {
  test(`Day Inspector restores the source after API ${status} without duplicates`, async ({ browser }, info) => {
    const { context, page, writes } = await openCalendar(browser);
    const id = "calendar-crowded-0", before = dbJob(id);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    try {
      await page.route(`**/api/jobs/${id}/schedule`, async (route) => {
        await gate;
        await route.fulfill({ status, json: { error: "Inspector move failed; original date restored." } });
      });
      await clickDateArea(page, "2026-09-15", "number");
      const inspector = page.locator("[data-calendar-day-inspector]");
      await inspectorJob(page, id).dragTo(day(page, "2026-09-18"));
      await expect(inspector.locator("[data-calendar-inspector-job]")).toHaveCount(6);
      await expect(calendarJob(page, "2026-09-18", id)).toBeVisible();
      await expect(inspectorJob(page, "calendar-crowded-1")).toHaveAttribute("draggable", "false");
      await expect(inspector.getByRole("button", { name: "Reschedule Job #301" })).toBeDisabled();
      expect(dbJob(id)).toEqual(before);
      release();
      await expect(page.getByRole("alert")).toContainText("Inspector move failed");
      await expect(inspector.locator("[data-calendar-inspector-job]")).toHaveCount(7);
      await expect(inspectorJob(page, id)).toHaveCount(1);
      await expect(calendarJob(page, "2026-09-15", id)).toHaveCount(1);
      await expect(calendarJob(page, "2026-09-18", id)).toHaveCount(0);
      await expect(inspector).toHaveAttribute("data-inspector-date", "2026-09-15");
      expect(dbJob(id)).toEqual(before);
      expect(writes).toHaveLength(1);
      if (status === 500) await screenshot(page, info, "inspector-rollback");
    } finally { release(); await context.close(); }
  });
}

test("Day Inspector keyboard rescheduling and job clicks coexist with bulk actions", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    await clickDateArea(page, "2026-09-15", "number");
    const inspector = page.locator("[data-calendar-day-inspector]");
    const before = dbJob("calendar-crowded-0");
    await inspector.getByRole("button", { name: "Reschedule Job #300" }).focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Reschedule Job #300", exact: true });
    await sheet.getByLabel("Scheduled date", { exact: true }).fill("2026-09-19");
    await sheet.getByRole("button", { name: "Save date", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeHidden();
    await expect(inspector).toHaveAttribute("data-inspector-date", "2026-09-15");
    await expect(inspector.getByRole("heading")).toBeFocused();
    await expect(inspector.locator("[data-calendar-inspector-job]")).toHaveCount(6);
    expect(dbJob(before.id).scheduledDate).toBe("2026-09-19");
    expect(unchangedFields(dbJob(before.id))).toEqual(unchangedFields(before));
    await inspector.getByRole("button", { name: "Reschedule Job #301" }).click();
    await page.keyboard.press("Escape");
    await expect(inspector.getByRole("heading")).toBeFocused();
    await expect(inspector.getByRole("button", { name: "Reschedule day", exact: true })).toBeVisible();
    await inspector.getByRole("button", { name: "Reschedule day", exact: true }).click();
    await page.getByRole("dialog", { name: "Reschedule jobs", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(inspector.getByRole("heading")).toBeFocused();
    await inspectorJob(page, "calendar-crowded-1").getByRole("button", { name: /^Open Job/ }).click();
    await expect(page).toHaveURL(/\/jobs\/calendar-crowded-1$/);
    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    await expect(page.locator(".calendar-mini-pane > .calendar-mini")).toBeVisible();
    expect(writes).toEqual([{ path: "/api/jobs/calendar-crowded-0/schedule", method: "PATCH", body: { scheduledDate: "2026-09-19" } }]);
  } finally { await context.close(); }
});

test("Day Inspector touch scrolling, dragging and cancellation keep a long source day usable", async ({ browser }, info) => {
  const base = dbJob("calendar-crowded-1");
  const extraJobs = Array.from({ length: 13 }, (_, index) => ({ ...base, id: `inspector-extra-${index}`, jobNumber: 500 + index }));
  function updateExtraJobs(remove = false) {
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try {
      for (const job of extraJobs) {
        if (remove) db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id);
        else insertJobTree(db, job);
      }
    } finally { db.close(); }
  }
  updateExtraJobs();
  const { context, page, writes } = await openCalendar(browser, 1180, 820);
  try {
    await clickDateArea(page, "2026-09-15", "number", true);
    const inspector = page.locator("[data-calendar-day-inspector]");
    await expect(inspector.locator("[data-calendar-inspector-job]")).toHaveCount(20);
    const headerBefore = await inspector.locator("header").boundingBox();
    const footerBefore = await inspector.locator("footer").boundingBox();
    const cdp = await context.newCDPSession(page);
    const touch = (type, point) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
    const list = await inspector.locator(".calendar-inspector-jobs").boundingBox();
    const from = { x: list.x + list.width / 2, y: list.y + 300 };
    await touch("touchStart", from);
    await touch("touchMove", { x: from.x, y: from.y - 100 });
    await touch("touchMove", { x: from.x, y: from.y - 200 });
    await touch("touchEnd");
    await expect.poll(() => inspector.locator(".calendar-inspector-jobs").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await inspector.locator("header").boundingBox()).toEqual(headerBefore);
    expect(await inspector.locator("footer").boundingBox()).toEqual(footerBefore);
    expect(writes).toEqual([]);
    await expect(page.locator(".calendar-drag-preview")).toHaveCount(0);
    await inspector.locator(".calendar-inspector-jobs").evaluate((element) => { element.scrollTop = 0; });
    async function beginDrag(id, destination) {
      const grip = inspectorJob(page, id).locator(".calendar-inspector-grip");
      await grip.scrollIntoViewIfNeeded();
      const start = await grip.boundingBox(), end = await day(page, destination).boundingBox();
      const point = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
      await touch("touchStart", point);
      await page.waitForTimeout(220);
      await touch("touchMove", { x: point.x + 12, y: point.y });
      await touch("touchMove", { x: end.x + end.width / 2, y: end.y + 10 });
      await expect(day(page, destination)).toHaveAttribute("data-drop-active", "true");
    }
    const original = dbJob("calendar-crowded-0");
    await beginDrag(original.id, "2026-09-17");
    await screenshot(page, info, "inspector-touch-drop-target");
    await touch("touchEnd");
    await expect.poll(() => dbJob(original.id).scheduledDate).toBe("2026-09-17");
    await expect(inspector.locator("[data-calendar-inspector-job]")).toHaveCount(19);
    expect(unchangedFields(dbJob(original.id))).toEqual(unchangedFields(original));
    await beginDrag("calendar-crowded-1", "2026-09-18");
    await page.keyboard.press("Escape");
    await touch("touchCancel");
    await expect(page.locator(".calendar-drag-preview, [data-drop-active]")).toHaveCount(0);
    await expect(inspector).toHaveAttribute("data-inspector-date", "2026-09-15");
    expect(dbJob("calendar-crowded-1").scheduledDate).toBe("2026-09-15");
    await inspector.locator(".calendar-inspector-jobs").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(inspector.getByRole("button", { name: "Reschedule day", exact: true })).toBeInViewport();
    await expect(inspectorJob(page, "inspector-extra-12")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(820);
    await screenshot(page, info, "inspector-long-day-scroll");
    expect(writes).toEqual([{ path: "/api/jobs/calendar-crowded-0/schedule", method: "PATCH", body: { scheduledDate: "2026-09-17" } }]);
  } finally { await context.close(); updateExtraJobs(true); }
});

test("Calendar density fits five jobs, expands with height and keeps all columns flush", async ({ browser }, info) => {
  const { context, page, writes } = await openCalendar(browser);
  try {
    // Resize the same calendar both ways to exercise capacity recalculation.
    for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator(".calendar-workspace")).toHaveCSS("height", `${height}px`);
      const crowded = day(page, "2026-09-15");
      await expect(crowded.locator(".calendar-job-chip")).toHaveCount(width === 1920 ? 7 : 5);
      const measured = await page.evaluate(() => {
        const box = (selector) => {
          const element = document.querySelector(selector), rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, padding: style.padding, border: style.borderWidth, radius: style.borderRadius, fontSize: style.fontSize };
        };
        const cell = document.querySelector('[data-calendar-date="2026-09-15"]');
        const chips = [...cell.querySelectorAll(".calendar-job-chip")];
        const first = chips[0];
        return {
          workspace: box(".calendar-workspace"), mini: box(".calendar-mini-pane"), main: box(".calendar-main"), queue: box(".calendar-queue-pane"), toolbar: box(".calendar-toolbar"), grid: box(".calendar-month-grid"), cell: box('[data-calendar-date="2026-09-15"]'), chip: box(".calendar-job-chip"), number: box('[data-calendar-date="2026-09-15"] .calendar-day-number'),
          gap: getComputedStyle(document.querySelector(".calendar-layout")).gap,
          navigationRight: document.querySelector('aside').getBoundingClientRect().right,
          scrollHeight: document.documentElement.scrollHeight,
          visibleChips: chips.length,
          truncated: first.scrollWidth > first.clientWidth && getComputedStyle(first).whiteSpace === "nowrap" && getComputedStyle(first).textOverflow === "ellipsis",
          rows: [...cell.querySelectorAll(".calendar-job-chip, .calendar-more")].map((element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
          }),
        };
      });
      expect(measured.gap).toBe("0px");
      expect(measured.workspace.x).toBe(measured.navigationRight);
      expect(measured.workspace.y).toBe(0);
      expect(measured.workspace.right).toBe(width);
      expect(measured.workspace.bottom).toBe(height);
      expect(measured.scrollHeight).toBe(height);
      expect(measured.mini.right).toBe(measured.main.x);
      expect(measured.main.right).toBe(measured.queue.x);
      expect(measured.toolbar.bottom).toBe(measured.main.y);
      expect(measured.main.bottom).toBe(height);
      expect(measured.main.border).toBe("0px");
      expect(measured.main.radius).toBe("0px");
      expect(measured.cell.border).toBe("0px 1px 1px 0px");
      expect(measured.chip.height).toBe(16);
      expect(measured.number.fontSize).toBe("11px");
      expect(measured.number.y - measured.cell.y).toBe(3);
      expect(measured.number.x - measured.cell.x).toBe(5);
      expect(measured.truncated).toBe(true);
      for (const [index, row] of measured.rows.entries()) {
        expect(row.hit).toBe(true);
        expect(row.bottom).toBeLessThanOrEqual(Math.min(measured.cell.bottom, height));
        if (index) expect(row.top).toBeGreaterThan(measured.rows[index - 1].bottom);
      }
      await noOverflow(page);
      fs.writeFileSync(path.join(screenshotDir, `density-${width}x${height}.json`), JSON.stringify(measured, null, 2));
      await screenshot(page, info, `density-${width}x${height}`);
      if (height <= 768) {
        const lastDate = page.locator(".calendar-day-open").last();
        await lastDate.scrollIntoViewIfNeeded();
        await expect(lastDate).toBeInViewport({ ratio: 1 });
        expect(await page.locator(".calendar-main").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        expect((await page.locator(".calendar-weekdays").boundingBox()).y).toBe(measured.main.y);
        await page.locator(".calendar-main").evaluate((element) => { element.scrollTop = 0; });
      }
    }
    // A month change replaces the first observed cell; subsequent resizes must
    // still update capacity and expose the complete crowded day when it fits.
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await page.getByRole("button", { name: "Previous month", exact: true }).click();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(day(page, "2026-09-15").locator(".calendar-job-chip")).toHaveCount(7);
    expect(writes).toEqual([]);
  } finally { await context.close(); }
});

test("mobile Calendar toolbar stays in one row from 320px through 430px", async ({ browser }) => {
  const { context, page, writes } = await openCalendar(browser, 430, 932);
  try {
    for (const [width, height] of [[430, 932], [390, 844], [360, 800], [320, 720]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator("[data-calendar-month]")).toHaveText("September 2026");
      await expectCompactMobileToolbar(page);
    }
    expect(writes).toEqual([]);
  } finally { await context.close(); }
});

test("responsive Calendar matrix keeps scheduling usable in ten layouts", async ({ browser }, info) => {
  const viewports = [[390, 844], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1180, 820], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]];
  for (const [index, [width, height]] of viewports.entries()) {
    const { context, page, writes } = await openCalendar(browser, width, height);
    try {
      await noOverflow(page);
      const columns = await page.locator(".calendar-layout").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(width >= 1180 ? 3 : width === 1024 ? 2 : 1);
      if (width >= 1180) await expect(page.locator(".calendar-mini-pane")).toBeVisible();
      else if (width >= 768) {
        await page.getByRole("button", { name: "Dates", exact: true }).click();
        await expect(page.locator(".calendar-mini-expanded")).toBeVisible();
        if (width === 768) {
          const navigator = page.locator(".calendar-mini-expanded");
          await navigator.locator('[data-mini-date="2026-09-07"]').focus();
          await page.keyboard.press("ArrowRight");
          await expect(navigator.locator('[data-mini-date="2026-09-08"]')).toBeFocused();
          await expect(day(page, "2026-09-08")).toHaveAttribute("data-selected", "true");
          await navigator.getByRole("button", { name: "Go to today in date navigator" }).click();
        }
        await page.getByRole("button", { name: "Dates", exact: true }).click();
      } else {
        await expectCompactMobileToolbar(page);
      }
      await screenshot(page, info, `calendar-${width}x${height}`);
      if (width === 390) {
        const populatedDate = day(page, "2026-09-15").getByRole("button").first();
        await populatedDate.click({ position: { x: 20, y: 20 } });
        const dayPanel = dayDetails(page, /15 September/);
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
