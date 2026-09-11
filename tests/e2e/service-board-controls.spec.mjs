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
import Database from "better-sqlite3";
import { insertJobTree } from "../../server-workspace-jobs.js";
import { normalizeStoredData } from "../../server-store.js";
import { themePresets } from "../../src/lib/theme-presets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(repoRoot, "test-results/service-board-controls");
const password = "Board-controls-local-test-123";
const viewports = [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 720 },
  { width: 1024, height: 768 }, { width: 820, height: 1180 }, { width: 390, height: 844 },
];
let dataDir, baseUrl, server, storageState;
let serverOutput = "";

function workspaceFixture() {
  const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "fixtures/demo-workspace.json"), "utf8"));
  const original = fixture.jobs[0];
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86400000));
  const makeJob = (id, jobNumber, status, index) => ({
    ...original, id, jobNumber, status, title: status + " service " + index + (status === "Completed" && index <= 8 ? " Needle" : ""),
    description: "Service Board controls fixture", urgency: index <= 70 ? "High" : "Low", scheduledDate: "2026-09-15",
    createdAt: new Date(Date.UTC(2026, 0, index)).toISOString(), updatedAt: new Date(Date.UTC(2026, 6, 176-index)).toISOString(),
    notes: [], photos: [], quote: null, invoice: null, maintenancePlanId: "", maintenancePlanName: "",
    serviceBoardTomorrowDate: status === "To Do" ? tomorrow : "", serviceBoardTomorrowOrder: index,
  });
  fixture.jobs = [
    ...Array.from({ length: 175 }, (_, index) => makeJob("completed-" + (index+1), 2001+index, "Completed", index+1)).reverse(),
    ...Array.from({ length: 30 }, (_, index) => makeJob("todo-" + (index+1), 3001+index, "To Do", index+1)),
    ...Array.from({ length: 30 }, (_, index) => makeJob("progress-" + (index+1), 4001+index, "In Progress", index+1)),
    { ...makeJob("old-job", 50, "To Do", 1), title: "Old job created years ago", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z", serviceBoardTomorrowDate: "", serviceBoardTomorrowOrder: null },
  ];
  return normalizeStoredData(fixture);
}

function readWorkspace() {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db"), readonly: true, migrate: false });
  try { return loadWorkspaceStateFromDb(db); } finally { db.close(); }
}

test.beforeAll(async ({ browser }) => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-board-controls-"));
  fs.mkdirSync(screenshots, { recursive: true });
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try { importWorkspaceJsonData(db, workspaceFixture()); } finally { db.close(); }
  const portProbe = net.createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney",
    ELSET_DATA_DIR: dataDir, ELSET_AUTH_DB_PATH: path.join(dataDir, "auth.db"),
    ELSET_WORKSPACE_DB_PATH: path.join(dataDir, "elset-workspace.db"), ELSET_WORKSPACE_STORAGE: "sqlite",
    BETTER_AUTH_URL: baseUrl, ELSET_FRONTEND_URL: baseUrl, ELSET_API_PORT: String(port), PORT: String(port),
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
  };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, "server-auth.js")).href)});
    await ensureAuthReady();
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({
      email: "board.controls@auth.elset.local", emailVerified: true, name: "Board Controls Test", role: "admin",
      username: "boardcontrols", displayUsername: "Board Controls Test", workspaceRole: "admin", staffId: "",
    });
    await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: await context.password.hash(${JSON.stringify(password)}) });
  `], { cwd: repoRoot, env, encoding: "utf8" });
  if (seed.status !== 0) throw new Error(`Test login setup failed: ${seed.stdout}\n${seed.stderr}`);
  server = spawn(process.execPath, ["server.js"], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { return (await fetch(`${baseUrl}/api/auth/me`)).status; } catch { return 0; }
  }, { timeout: 30000 }).toBe(401);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(baseUrl);
    await page.getByPlaceholder("Enter your username").fill("boardcontrols");
    await page.getByPlaceholder("Enter your password").fill(password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible();
    storageState = await context.storageState();
  } finally { await context.close(); }
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 5000);
      server.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  const target = path.resolve(dataDir || ".");
  if (target.startsWith(path.join(os.tmpdir(), "elset-board-controls-"))) fs.rmSync(target, { recursive: true, force: true });
});

test.beforeEach(() => {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try { db.transaction(() => { db.exec("DELETE FROM jobs"); for (const job of workspaceFixture().jobs) insertJobTree(db, job); })(); }
  finally { db.close(); }
  const authDb = new Database(path.join(dataDir, "auth.db"));
  try { authDb.exec("DELETE FROM user_ui_preferences"); } finally { authDb.close(); }
});

async function openBoard(browser, viewport = viewports[1], preset) {
  const context = await browser.newContext({ storageState, viewport, hasTouch: viewport.width < 1280, isMobile: viewport.width < 768, locale: "en-AU", reducedMotion: "reduce" });
  const page = await context.newPage();
  if (preset) await page.route("**/api/user-preferences", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, preferences: { ...body.preferences, ...preset.values } } });
  });
  const writes = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push({ path: url.pathname, method: request.method() });
  });
  await page.goto(baseUrl);
  await expect(page.locator("[data-service-board-status]")).toHaveCount(viewport.width < 768 ? 1 : 3);
  if (viewport.width < 768) await page.getByRole("tab", { name: /^Completed / }).click();
  await expect(cards(page)).toHaveCount(25);
  if (preset) await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"))).toBe(preset.values.actionColor);
  return { context, page, writes };
}
const column = (page, status = "Completed") => page.locator(`[data-service-board-status="${status}"]`);
const cards = (page, status) => column(page, status).locator('[draggable="true"], [data-mobile-job-id]');
const more = (page) => column(page).getByRole("button", { name: /^Show \d+ more completed jobs$/ });
const latest = (count, maximum = 2175) => Array.from({ length: count }, (_, index) => maximum - index);
async function expectOrder(page, numbers) {
  await expect.poll(() => cards(page).evaluateAll((elements) => elements.map((element) => Number(element.innerText.match(/#(\d+)/)?.[1])))).toEqual(numbers);
}
async function expectCount(page, count) {
  if (page.viewportSize().width < 768) await expect(page.getByRole("tab", { name: new RegExp(`^Completed ${count}$`) })).toBeVisible();
  else await expect(column(page).getByLabel("Completed matching jobs", { exact: true })).toHaveText(String(count));
}
async function chooseSort(page, label, status = "Completed") {
  await page.getByRole("combobox", { name: page.viewportSize().width < 768 ? `Sort ${status} jobs` : `${status} sort order`, exact: true }).click();
  await expect(page.getByRole("option")).toHaveText(["Recent", "Oldest", "Urgency", "Customer", "Scheduled", "Highest Value"]);
  await page.getByRole("option", { name: label, exact: true }).click();
}
async function highUrgency(page, checked) {
  if (page.viewportSize().width < 768) {
    await page.getByRole("button", { name: /^Open board filters/ }).click();
    const dialog = page.getByRole("dialog", { name: "Board filters", exact: true });
    await dialog.getByRole("checkbox", { name: /^High urgency only/ }).setChecked(checked);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  } else await page.getByText("High urgency only", { exact: true }).locator("..").getByRole("checkbox").setChecked(checked);
}
async function capture(page, info, name) {
  await page.evaluate(() => document.fonts.ready);
  const image = await page.screenshot({ path: path.join(screenshots, `${name}.png`), animations: "disabled" });
  await info.attach(name, { body: image, contentType: "image/png" });
}
async function assertLayout(page, viewport) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: /^(Hide (To Do|In Progress|Completed)|Show only |Show all columns|Show Columns$)/ })).toHaveCount(0);
  if (viewport.width < 768) {
    await expect(page.getByRole("region", { name: "Mobile Service Board" })).toBeVisible();
    await expect(page.locator("[data-service-board-status]")).toHaveCount(1);
    return;
  }
  const geometry = await page.locator("[data-service-board-status]").evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    const header = element.querySelector("[data-service-board-column-header]");
    const title = header.querySelector('[data-slot="card-title"]').getBoundingClientRect();
    const sort = header.querySelector('[role="combobox"]').getBoundingClientRect();
    const views = header.querySelector('[role="group"]').getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, titleTop: title.top, sortTop: sort.top, sortRight: sort.right, viewsTop: views.top, viewsRight: views.right };
  }));
  expect(geometry).toHaveLength(3);
  for (const [index, box] of geometry.entries()) {
    expect(Math.abs(box.top - geometry[0].top)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.titleTop - box.sortTop)).toBeLessThanOrEqual(1);
    expect(box.sortRight).toBeLessThanOrEqual(box.right);
    expect(box.viewsRight).toBeLessThanOrEqual(box.right);
    if (index) expect(box.left).toBeGreaterThan(geometry[index - 1].right);
    if (viewport.width >= 1440) expect(Math.abs(box.viewsTop - box.sortTop)).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole("button", { name: "Full Screen", exact: true })).toBeVisible();
}

for (const viewport of viewports) test(`Service Board controls and initial 25 Completed jobs at ${viewport.width}x${viewport.height}`, async ({ browser }, info) => {
  const before = readWorkspace();
  const { page, context, writes } = await openBoard(browser, viewport);
  try {
    await expectCount(page, 175);
    await expectOrder(page, latest(25));
    await expect(more(page)).toHaveCount(1);
    if (viewport.width >= 768) {
      await expect(cards(page, "To Do")).toHaveCount(31);
      await expect(cards(page, "In Progress")).toHaveCount(30);
    }
    await assertLayout(page, viewport);
    await capture(page, info, `initial-${viewport.width}x${viewport.height}`);
    await more(page).scrollIntoViewIfNeeded();
    await capture(page, info, `show-more-${viewport.width}x${viewport.height}`);
    expect(writes).toEqual([]);
    expect(readWorkspace()).toEqual(before);
  } finally { await context.close(); }
});

for (const viewport of [viewports[1], viewports[5]]) test(`Completed expands in keyboard-accessible batches then hides Show more at ${viewport.width}px`, async ({ browser }) => {
  const { page, context, writes } = await openBoard(browser, viewport);
  try {
    for (const count of [50, 75, 100, 125, 150, 175]) {
      await more(page).focus();
      await more(page).press("Enter");
      await expect(cards(page)).toHaveCount(count);
      await expectCount(page, 175);
      await expectOrder(page, latest(count));
    }
    await expect(more(page)).toHaveCount(0);
    expect(writes).toEqual([]);
  } finally { await context.close(); }
});

for (const viewport of [viewports[1], viewports[5]]) test(`Completed resets on search, urgency and sort changes at ${viewport.width}px`, async ({ browser }) => {
  const { page, context, writes } = await openBoard(browser, viewport);
  try {
    await more(page).click();
    await expect(cards(page)).toHaveCount(50);
    await page.getByPlaceholder(/^Search jobs/).fill("Needle");
    await expect(cards(page)).toHaveCount(8);
    await expectCount(page, 8);
    await expect(more(page)).toHaveCount(0);
    await expectOrder(page, latest(8, 2008));
    await page.getByPlaceholder(/^Search jobs/).fill("");
    await expect(cards(page)).toHaveCount(25);
    await more(page).click();
    await highUrgency(page, true);
    await expect(cards(page)).toHaveCount(25);
    await expectCount(page, 70);
    await expectOrder(page, latest(25, 2070));
    await more(page).click();
    await expect(cards(page)).toHaveCount(50);
    await expect(more(page)).toHaveText("Show 20 more");
    await more(page).click();
    await expect(cards(page)).toHaveCount(70);
    await expect(more(page)).toHaveCount(0);
    await highUrgency(page, false);
    await expect(cards(page)).toHaveCount(25);
    for (const label of ["Oldest", "Urgency", "Customer", "Scheduled", "Highest Value", "Recent"]) {
      await more(page).click();
      await expect(cards(page)).toHaveCount(50);
      await chooseSort(page, label);
      await expect(cards(page)).toHaveCount(25);
      if (label === "Oldest") await expectOrder(page, Array.from({ length: 25 }, (_, index) => 2001 + index));
      if (label === "Recent") await expectOrder(page, latest(25));
    }
    if (viewport.width >= 768) {
      await more(page).click();
      await chooseSort(page, "Oldest", "To Do");
      await expect(cards(page)).toHaveCount(50);
      await page.getByRole("button", { name: "Completed Grid view", exact: true }).click();
      await expect(cards(page)).toHaveCount(50);
      await page.getByRole("button", { name: "Completed Compact view", exact: true }).click();
      await expect(cards(page)).toHaveCount(50);
    }
    expect(writes.filter((entry) => entry.path !== "/api/user-preferences")).toEqual([]);
  } finally { await context.close(); }
});

test("dragging an old job into Completed keeps creation order and the current visible limit", async ({ browser }) => {
  const { page, context, writes } = await openBoard(browser);
  try {
    await more(page).click();
    const before = readWorkspace();
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    try {
      await transfer.evaluate((value) => value.setData("jobId", "old-job"));
      const source = cards(page, "To Do").filter({ hasText: "#50" });
      await source.dispatchEvent("dragstart", { dataTransfer: transfer });
      const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/api/jobs/old-job/status"));
      await column(page).dispatchEvent("dragover", { dataTransfer: transfer });
      await column(page).dispatchEvent("drop", { dataTransfer: transfer });
      expect((await saved).ok()).toBe(true);
    } finally { await transfer.dispose(); }
    await expectCount(page, 176);
    await expectOrder(page, latest(50));
    expect(writes).toEqual([{ path: "/api/jobs/old-job/status", method: "PATCH" }]);
    expect(readWorkspace().jobs.find((job) => job.id === "old-job")).toEqual({ ...before.jobs.find((job) => job.id === "old-job"), status: "Completed", updatedAt: expect.any(String) });
    await chooseSort(page, "Oldest");
    await expectOrder(page, [50, ...Array.from({ length: 24 }, (_, index) => 2001 + index)]);
    const noteResponse = await page.request.post(`${baseUrl}/api/jobs/completed-1/notes`, { data: { id: "activity-note", text: "New activity on an old job", author: "Test" } });
    expect(noteResponse.ok()).toBe(true);
    const sortSaved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/api/user-preferences") && response.request().postDataJSON()?.boardCompletedSort === "recent");
    await chooseSort(page, "Recent");
    expect((await sortSaved).ok()).toBe(true);
    await page.reload();
    await expectOrder(page, latest(25));
  } finally { await context.close(); }
});

test("retired hidden-column preferences cannot hide columns, while page Full Screen and Tomorrow remain available", async ({ browser }) => {
  const authDb = new Database(path.join(dataDir, "auth.db"));
  try {
    authDb.prepare("INSERT INTO user_ui_preferences (user_id, preferences_json, created_at, updated_at) SELECT id, ?, '2026-01-01', '2026-01-01' FROM user").run(JSON.stringify({ boardHiddenColumns: ["To Do", "In Progress", "Completed"] }));
  } finally { authDb.close(); }
  const { page, context } = await openBoard(browser);
  try {
    await expect(page.locator("[data-service-board-status]")).toHaveCount(3);
    const response = await page.request.get(`${baseUrl}/api/user-preferences`);
    expect(Object.hasOwn((await response.json()).preferences, "boardHiddenColumns")).toBe(false);
    await page.getByRole("button", { name: "Full Screen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Exit Full Screen", exact: true })).toBeVisible();
    await expect(page.locator("[data-service-board-status]")).toHaveCount(3);
    await expect(cards(page)).toHaveCount(25);
    await page.getByRole("button", { name: "Exit Full Screen", exact: true }).click();
    await page.setViewportSize(viewports[5]);
    await page.getByRole("button", { name: "Tomorrow, 30 planned jobs", exact: true }).click();
    await expect(page.locator('[data-mobile-board-view="Tomorrow"] [data-mobile-job-id]')).toHaveCount(30);
    await expect(page.getByRole("button", { name: /^Show \d+ more completed jobs$/ })).toHaveCount(0);
  } finally { await context.close(); }
});

for (const preset of themePresets) test(`Service Board controls and pagination follow ${preset.label}`, async ({ browser }, info) => {
  for (const viewport of [viewports[1], viewports[5]]) {
    const { page, context } = await openBoard(browser, viewport, preset);
    try {
      await expectCount(page, 175);
      await assertLayout(page, viewport);
      await capture(page, info, `theme-${preset.id}-${viewport.width}`);
      await more(page).scrollIntoViewIfNeeded();
      await expect(more(page)).toBeVisible();
      const colors = await more(page).evaluate((element) => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
      expect(colors.color).not.toBe(colors.background);
      await capture(page, info, `theme-more-${preset.id}-${viewport.width}`);
      await more(page).click();
      await expect(cards(page)).toHaveCount(50);
    } finally { await context.close(); }
  }
});
