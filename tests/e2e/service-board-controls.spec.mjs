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
import { insertQuoteTree } from "../../server-workspace-documents.js";
import { normalizeStoredData } from "../../server-store.js";
import { themePresets } from "../../src/lib/theme-presets.js";
import { contrastRatio } from "../../src/lib/theme-tokens.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(repoRoot, "test-results/service-board-controls");
const password = "Board-controls-local-test-123";

async function dropJob(page, id, status) {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  try {
    await transfer.evaluate((data, jobId) => data.setData("jobId", jobId), id);
    await page.locator(`[data-service-board-job-id="${id}"]`).dispatchEvent("dragstart", { dataTransfer: transfer });
    await column(page, status).dispatchEvent("dragover", { dataTransfer: transfer });
    await column(page, status).dispatchEvent("drop", { dataTransfer: transfer });
  } finally { await transfer.dispose(); }
}

test("status moves before the response and its acknowledgement preserves a concurrent note edit without refetching", async ({ browser }) => {
  const { context, page } = await openBoard(browser);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await page.waitForLoadState("networkidle");
    const reads = [];
    page.on("request", (request) => { if (request.method() === "GET" && new URL(request.url()).pathname.startsWith("/api/")) reads.push(request.url()); });
    await page.route("**/api/jobs/todo-30/status?response=delta", async (route) => { await gate; await route.continue(); });
    await dropJob(page, "todo-30", "In Progress");
    const target = column(page, "In Progress").locator('[data-service-board-job-id="todo-30"]');
    await expect(target).toBeVisible();
    expect(readWorkspace().jobs.find((job) => job.id === "todo-30").status).toBe("To Do");
    await page.getByRole("button", { name: "Edit job notes" }).click();
    await target.getByText("To Do service 30", { exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Job note for Job #3030" });
    await editor.getByLabel("Job note", { exact: true }).fill("Keep concurrent note");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(target.getByLabel("Job note: Keep concurrent note")).toBeVisible();
    await expect.poll(() => readWorkspace().jobs.find((job) => job.id === "todo-30").serviceBoardNote).toBe("Keep concurrent note");
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/jobs/todo-30/status");
    release();
    const payload = await (await response).json();
    expect(payload.state).toBeUndefined();
    expect(payload.result.job.status).toBe("In Progress");
    await expect(target.getByLabel("Job note: Keep concurrent note")).toBeVisible();
    expect(readWorkspace().jobs.find((job) => job.id === "todo-30").status).toBe("In Progress");
    expect(reads).toEqual([]);
    await expect(column(page).locator("[data-service-board-job-id]")).toHaveCount(25);
  } finally { release(); await context.close(); }
});

for (const width of [1440, 820, 390]) test(`failed status saves restore the card and Tomorrow plan at ${width}px`, async ({ browser }) => {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  db.prepare("UPDATE jobs SET created_at='2099-01-01T00:00:00.000Z' WHERE id='todo-30'").run(); db.close();
  const { context, page } = await openBoard(browser, { width, height: 1180 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const dialogs = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
  try {
    const before = readWorkspace().jobs.find((job) => job.id === "todo-30");
    await page.route("**/api/jobs/todo-30/status?response=delta", async (route) => { await gate; await route.fulfill({ status: 503, json: { error: "Status save unavailable" } }); });
    if (width < 768) {
      await page.getByRole("tab", { name: /^To Do / }).click();
      await page.getByRole("button", { name: "Move Job #3030", exact: true }).click();
      await page.getByRole("button", { name: "Move to Completed", exact: true }).click();
      await expect(page.locator('[data-mobile-job-id="todo-30"]')).toHaveCount(0);
    } else {
      await dropJob(page, "todo-30", "Completed");
      await expect(column(page, "Completed").locator('[data-service-board-job-id="todo-30"]')).toBeVisible();
      await expect(cards(page)).toHaveCount(25);
    }
    expect(readWorkspace().jobs.find((job) => job.id === "todo-30")).toEqual(before);
    release();
    const target = page.locator(width < 768 ? '[data-mobile-job-id="todo-30"]' : '[data-service-board-status="To Do"] [data-service-board-job-id="todo-30"]');
    await expect(target).toBeVisible();
    if (width < 768) await expect(target.getByText("Tomorrow", { exact: true })).toBeVisible();
    else await expect(target.getByLabel("Planned for tomorrow", { exact: true })).toBeVisible();
    await expect.poll(() => dialogs).toEqual(["Status save unavailable"]);
    expect(readWorkspace().jobs.find((job) => job.id === "todo-30")).toEqual(before);
  } finally { release(); await context.close(); }
});

const layoutCases = [
  { id: "todo-30", note: null, rate: null, indicator: false },
  { id: "todo-29", note: "Call", rate: null, indicator: false },
  { id: "todo-28", note: null, rate: 165, indicator: false },
  { id: "todo-27", note: "Waiting parts", rate: 165, indicator: false },
  { id: "todo-26", note: "W".repeat(25), rate: 422.5, indicator: true },
  { id: "todo-25", note: "W".repeat(25), rate: 11223.34, indicator: false },
];

function seedNoteLayoutCases() {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try {
    const originalQuote = JSON.parse(fs.readFileSync(path.join(repoRoot, "fixtures/demo-workspace.json"), "utf8")).jobs[0].quote;
    for (const entry of layoutCases) {
      db.prepare(`UPDATE jobs SET service_board_note = ?, maintenance_plan_name = ?, service_board_tomorrow_date = '',
        customer_name = 'Northside Apartments', title = 'Gate service' WHERE id = ?`).run(entry.note, entry.indicator ? "Scheduled maintenance" : "", entry.id);
      if (entry.rate !== null) insertQuoteTree(db, entry.id, {
        ...originalQuote, id: `layout-quote-${entry.id}`, sentHistory: [],
        items: [{ id: `layout-item-${entry.id}`, description: "Service", qty: 1, rate: entry.rate }],
      });
    }
  } finally { db.close(); }
}

for (const width of [768, 1024, 1440]) test(`note layout handles all pill combinations and indicator spacing at ${width}px`, async ({ browser }, info) => {
  seedNoteLayoutCases();
  const measurements = [];
  for (const preset of themePresets.filter((theme) => ["elset", "midnight-signal"].includes(theme.id))) {
    const { context, page } = await openBoard(browser, { width, height: 1180 }, preset);
    try {
      for (const view of ["Grid", "List", "Compact"]) {
        await page.getByRole("button", { name: `To Do ${view} view`, exact: true }).click();
        for (const entry of layoutCases) {
          const target = page.locator(`[data-service-board-job-id="${entry.id}"]`);
          await expect(target).toHaveAttribute("data-job-card-view", view.toLowerCase());
          await expect(target.locator("..")).toHaveCSS("row-gap", view === "Grid" ? "12px" : "8px");
          await expect(target.locator("[data-service-board-note]")).toHaveCount(entry.note ? 1 : 0);
          if (entry.note) await assertNoteGeometry(page, target);
          const values = await target.evaluate((card) => {
            const box = (element) => {
              if (!element) return null;
              const r = element.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
            };
            const price = card.querySelector("[data-grid-job-value]") || card.querySelector('[title$=" value"]');
            const content = card.querySelector('[data-slot="card-content"]');
            const number = card.querySelector("[data-job-card-number]");
            const customer = card.querySelector("[data-job-card-customer]");
            const arrow = card.querySelector(".service-board-tomorrow-action");
            const textRects = [...card.querySelectorAll("p")].flatMap((p) => {
              const range = document.createRange(); range.selectNodeContents(p);
              const clip = p.getBoundingClientRect();
              return [...range.getClientRects()].map((r) => ({ left: Math.max(r.left, clip.left), right: Math.min(r.right, clip.right), top: Math.max(r.top, clip.top), bottom: Math.min(r.bottom, clip.bottom) }))
                .filter((r) => r.right > r.left && r.bottom > r.top);
            });
            return {
              card: box(card), price: box(price), priceText: price?.textContent.trim(), priceClipped: price ? price.scrollWidth > price.clientWidth : false,
              number: box(number), customer: box(customer), indicator: box(card.querySelector("[data-job-card-indicators]")),
              contentTop: content.getBoundingClientRect().top + parseFloat(getComputedStyle(content).paddingTop),
              bottomPadding: getComputedStyle(card.querySelector('[data-slot="card"]')).paddingBottom,
              rowGap: getComputedStyle(card.parentElement).rowGap, arrow: box(arrow), textRects,
            };
          });
          const label = `${width} ${preset.id} ${view} ${entry.id}`;
          measurements.push({ label, ...values });
          expect(values.priceClipped, label).toBe(false);
          expect(Boolean(values.price), label).toBe(entry.rate !== null);
          if (values.price) {
            expect(values.price.left, label).toBeGreaterThanOrEqual(values.card.left);
            expect(values.price.right, label).toBeLessThanOrEqual(values.card.right);
          }
          if (view === "Grid") {
            expect(values.customer.top - values.number.bottom, label).toBeCloseTo(4, 1);
            expect(values.rowGap).toBe("12px");
            if (values.price) expect((values.price.top + values.price.bottom) / 2, label).toBeCloseTo(values.card.bottom - 6, 1);
          } else {
            await expect(target.getByText("High", { exact: true })).toBeVisible();
            expect(values.rowGap).toBe("8px");
            if (view === "Compact") expect(values.bottomPadding).toBe("8px");
            else if (entry.indicator) {
              await expect(target.getByLabel("Maintenance", { exact: true })).toBeVisible();
              expect(values.indicator).not.toBeNull();
              expect(values.number.top - values.indicator.bottom, label).toBeCloseTo(4, 1);
            } else {
              expect(values.indicator, label).toBeNull();
              expect(values.number.top, label).toBeCloseTo(values.contentTop, 1);
            }
          }
          const intersects = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          expect(intersects(values.price, values.arrow), label).toBeFalsy();
          for (const text of values.textRects) expect(intersects(text, values.arrow), `${label} text/action overlap`).toBeFalsy();
        }
        await capture(page, info, `note-layout-${preset.id}-${width}-${view.toLowerCase()}`);
      }
    } finally { await context.close(); }
  }
  await info.attach("note-layout-measurements", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});

function seedBoardNotes() {
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try {
    db.prepare("UPDATE jobs SET service_board_note = ? WHERE id IN ('completed-175', 'completed-174')").run("Waiting on parts");
    const quote = JSON.parse(fs.readFileSync(path.join(repoRoot, "fixtures/demo-workspace.json"), "utf8")).jobs[0].quote;
    insertQuoteTree(db, "completed-175", quote);
  } finally { db.close(); }
}

const noteCard = (page) => page.locator('[data-service-board-job-id="completed-175"], [data-mobile-job-id="completed-175"]');
const noteDialog = (page) => page.getByRole("dialog", { name: "Job note for Job #2175" });
const noteValue = () => readWorkspace().jobs.find((job) => job.id === "completed-175").serviceBoardNote;
const openNote = (page) => noteCard(page).getByText("Completed service 175", { exact: true }).click();

async function assertNoteGeometry(page, target = noteCard(page)) {
  const result = await target.evaluate((card) => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
    const pill = card.querySelector("[data-service-board-note]");
    const value = card.querySelector("[data-grid-job-value]") || card.querySelector('[title$=" value"]');
    const style = getComputedStyle(pill);
    const canvas = document.createElement("canvas").getContext("2d");
    canvas.font = style.font;
    return { mode: card.dataset.jobCardView || "mobile", card: rect(card), note: rect(pill), price: value ? rect(value) : null, whiteSpace: style.whiteSpace, overflow: style.overflow, textOverflow: style.textOverflow,
      textWidth: pill.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), ellipsisWidth: canvas.measureText("…").width,
      position: style.position, bottom: style.bottom, transform: style.transform,
      priceStyle: value ? { bottom: getComputedStyle(value).bottom, transform: getComputedStyle(value).transform, clipped: value.scrollWidth > value.clientWidth } : null,
      foreground: style.color, background: style.backgroundColor,
      actions: [...card.querySelectorAll("button")].filter((button) => !button.hasAttribute("data-job-card-body") && !(card.matches("[data-mobile-job-id]") && button === card.querySelector("button"))).map(rect),
      others: [...card.parentElement.children].filter((element) => element !== card).map(rect) };
  });
  const center = (rect) => (rect.top + rect.bottom) / 2;
  if (result.mode === "grid") {
    expect(result.note.left).toBeCloseTo(result.card.left, 1);
    expect(center(result.note)).toBeCloseTo(result.card.bottom - 6, 1);
    if (result.price) {
      expect(result.note.top).toBeCloseTo(result.price.top, 1);
      expect(result.note.bottom).toBeCloseTo(result.price.bottom, 1);
      expect(result.bottom).toBe(result.priceStyle.bottom);
      expect(result.transform).toBe(result.priceStyle.transform);
      expect(result.card.right - result.price.right).toBeCloseTo(result.note.left - result.card.left, 1);
    }
  } else if (result.mode === "mobile") {
    expect(result.note.left - result.card.left).toBeLessThanOrEqual(6);
    expect(Math.abs(center(result.note) - result.card.bottom)).toBeLessThanOrEqual(2);
  } else {
    expect(result.position).toBe("static");
    expect(result.note.right - result.note.left).toBeGreaterThanOrEqual(24);
    expect(result.note.top).toBeGreaterThan(result.card.top);
    expect(result.note.bottom).toBeLessThan(result.card.bottom);
    if (result.price) {
      expect(result.price.left - result.note.right).toBeCloseTo(4, 1);
      expect(center(result.note)).toBeCloseTo(center(result.price), 1);
    }
  }
  if (result.price) expect(result.priceStyle.clipped).toBe(false);
  expect(result.textWidth).toBeGreaterThanOrEqual(result.ellipsisWidth - 1);
  expect(result.note.right).toBeLessThan(result.card.right);
  expect(result.note.height).toBeLessThanOrEqual(22);
  expect([result.whiteSpace, result.overflow, result.textOverflow]).toEqual(["nowrap", "hidden", "ellipsis"]);
  const toHex = (rgb) => "#" + rgb.match(/\d+/g).slice(0, 3).map((part) => Number(part).toString(16).padStart(2, "0")).join("");
  expect(contrastRatio(toHex(result.foreground), toHex(result.background))).toBeGreaterThanOrEqual(4.5);
  const [red, green, blue] = result.background.match(/\d+/g).map(Number);
  expect(red).toBeGreaterThan(green); expect(green).toBeGreaterThan(blue); // Orange in every theme.
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  if (result.price) expect(intersects(result.note, result.price)).toBe(false);
  for (const other of [...result.actions, ...result.others]) expect(intersects(result.note, other)).toBe(false);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
  test(`job notes edit, persist, remove and restore normal interactions at ${viewport.width}px`, async ({ browser }, info) => {
    seedBoardNotes();
    const { context, page } = await openBoard(browser, viewport);
    try {
      const mobile = viewport.width < 768;
      if (!mobile) await page.getByRole("button", { name: "Completed Grid view", exact: true }).click();
      const toggle = page.getByRole("button", { name: "Edit job notes", exact: true });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(noteCard(page).getByLabel("Job note: Waiting on parts")).toBeVisible();
      await assertNoteGeometry(page);
      if (!mobile) {
        const besideTagInfo = await toggle.evaluate((button) => button.previousElementSibling?.textContent.includes("Show tag info"));
        expect(besideTagInfo).toBe(true);
      }
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      if (!mobile) await expect(noteCard(page)).toHaveAttribute("draggable", "false");
      await openNote(page);
      await expect(page).not.toHaveURL(/\/jobs\//);
      const input = noteDialog(page).getByLabel("Job note", { exact: true });
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("Waiting on parts");
      await expect(input).toHaveAttribute("maxlength", "25");
      await capture(page, info, `job-note-editor-${viewport.width}`);
      await input.fill("x".repeat(25));
      await expect(noteDialog(page).getByText("25 / 25", { exact: true })).toBeVisible();
      await input.press("End"); await input.pressSequentially("extra");
      await expect(input).toHaveValue("x".repeat(25));
      await input.press("Escape");
      await expect(noteDialog(page)).toHaveCount(0);
      expect(noteValue()).toBe("Waiting on parts");
      await openNote(page);
      await noteDialog(page).getByLabel("Job note", { exact: true }).fill("  Call customer  ");
      await page.keyboard.press("Tab");
      await expect(noteDialog(page).getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
      await expect(noteDialog(page)).toHaveCount(0);
      await expect(noteCard(page).getByLabel("Job note: Call customer")).toBeVisible();
      await expect.poll(noteValue).toBe("Call customer");
      if (!mobile) {
        await noteCard(page).focus(); await page.keyboard.press("Enter");
        await expect(noteDialog(page)).toBeVisible();
        await noteDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByText("Show tag info", { exact: true }).locator("..").getByRole("checkbox").check();
        await expect(noteCard(page).getByLabel("Job note: Call customer")).toBeVisible();
      }
      await capture(page, info, `job-notes-${viewport.width}`);
      await toggle.click();
      if (!mobile) await expect(noteCard(page)).toHaveAttribute("draggable", "true");
      await expect(noteCard(page).getByLabel("Job note: Call customer")).toBeVisible();
      await page.reload();
      if (mobile) await page.getByRole("tab", { name: /^Completed / }).click();
      await expect(noteCard(page).getByLabel("Job note: Call customer")).toBeVisible();
      await toggle.click(); await openNote(page);
      await noteDialog(page).getByRole("button", { name: "Remove note", exact: true }).click();
      await expect(noteCard(page).locator("[data-service-board-note]")).toHaveCount(0);
      await expect.poll(noteValue).toBe(null);
      await toggle.click();
      if (mobile) await openNote(page);
      else await noteCard(page).getByText("Completed service 175", { exact: true }).dblclick();
      await expect(page).toHaveURL(/\/jobs\/completed-175$/);
    } finally { await context.close(); }
  });
}

test("job notes save optimistically, roll back failures and retain the draft for retry", async ({ browser }) => {
  seedBoardNotes();
  const { context, page } = await openBoard(browser);
  try {
    await page.getByRole("button", { name: "Edit job notes" }).click();
    await openNote(page);
    await noteDialog(page).getByLabel("Job note", { exact: true }).fill("Needs approval");
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let body;
    await page.route("**/api/jobs/completed-175/service-board-note", async (route) => {
      body = route.request().postDataJSON();
      await gate;
      await route.fulfill({ status: 503, json: { error: "Test connection failure" } });
    });
    await noteDialog(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(noteDialog(page)).toHaveCount(0);
    await expect(noteCard(page).getByLabel("Job note: Needs approval")).toBeVisible();
    expect(noteValue()).toBe("Waiting on parts");
    release();
    await expect(page.getByRole("alert")).toContainText("Test connection failure");
    await expect(noteCard(page).getByLabel("Job note: Waiting on parts")).toBeVisible();
    expect(body).toEqual({ serviceBoardNote: "Needs approval" });
    await page.unroute("**/api/jobs/completed-175/service-board-note");
    await page.getByRole("button", { name: "Retry note" }).click();
    await expect(noteDialog(page).getByLabel("Job note", { exact: true })).toHaveValue("Needs approval");
    await noteDialog(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(noteValue).toBe("Needs approval");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.route("**/api/jobs/completed-175/service-board-note", (route) => route.fulfill({ status: 503, json: { error: "Removal failed" } }));
    await openNote(page);
    await noteDialog(page).getByRole("button", { name: "Remove note", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Removal failed");
    await expect(noteCard(page).getByLabel("Job note: Needs approval")).toBeVisible();
    await page.unroute("**/api/jobs/completed-175/service-board-note");
    await page.getByRole("button", { name: "Retry note" }).click();
    await expect(noteDialog(page).getByLabel("Job note", { exact: true })).toHaveValue("");
    await noteDialog(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(noteValue).toBe(null);
  } finally { await context.close(); }
});

test("job notes render in every theme and desktop view without overlapping price or adjacent cards", async ({ browser }, info) => {
  seedBoardNotes();
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try { db.prepare("UPDATE jobs SET service_board_note = ? WHERE service_board_note IS NOT NULL").run("W".repeat(25)); } finally { db.close(); }
  for (const preset of themePresets) {
    const { context, page } = await openBoard(browser, { width: 820, height: 1180 }, preset);
    try {
      for (const view of ["Grid", "List", "Compact"]) {
        await page.getByRole("button", { name: `Completed ${view} view`, exact: true }).click();
        await assertNoteGeometry(page);
      }
      await page.getByRole("button", { name: "Edit job notes" }).click();
      await openNote(page);
      await expect(noteDialog(page)).toBeVisible();
      await noteDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(noteCard(page).locator("[data-job-card-body]")).toHaveAttribute("aria-expanded", "false");
      await page.getByRole("button", { name: "Completed Grid view", exact: true }).click();
      await capture(page, info, `job-notes-theme-${preset.id}`);
      await page.setViewportSize({ width: 768, height: 1024 });
      await assertNoteGeometry(page);
      await page.setViewportSize({ width: 320, height: 740 });
      await page.getByRole("tab", { name: /^Completed / }).click();
      await assertNoteGeometry(page);
      await expect(page.getByRole("button", { name: "Edit job notes" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await capture(page, info, `job-notes-theme-mobile-${preset.id}`);
    } finally { await context.close(); }
  }
});

test("job notes do not overwrite another browser's status change", async ({ browser }) => {
  seedBoardNotes();
  const { context, page } = await openBoard(browser);
  try {
    await page.getByRole("button", { name: "Edit job notes" }).click();
    await openNote(page);
    const remote = await browser.newContext({ storageState });
    try {
      expect((await remote.request.patch(`${baseUrl}/api/jobs/completed-175/status`, { data: { status: "In Progress" } })).ok()).toBe(true);
      await noteDialog(page).getByLabel("Job note", { exact: true }).fill("New note after status");
      await noteDialog(page).getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(noteValue).toBe("New note after status");
      expect(readWorkspace().jobs.find((job) => job.id === "completed-175").status).toBe("In Progress");
      const secondPage = await remote.newPage();
      await secondPage.goto(baseUrl);
      await expect(column(secondPage, "In Progress").getByLabel("Job note: New note after status")).toBeVisible();
    } finally { await remote.close(); }
  } finally { await context.close(); }
});

test("job notes leave dedicated Tomorrow and mobile Move controls available", async ({ browser }) => {
  const { context, page } = await openBoard(browser);
  try {
    await page.getByRole("button", { name: "Edit job notes" }).click();
    const source = page.locator('[data-service-board-job-id="progress-30"]');
    await source.getByRole("button", { name: "Add Job #4030 to tomorrow" }).click();
    await expect.poll(() => readWorkspace().jobs.find((job) => job.id === "progress-30").serviceBoardTomorrowDate).not.toBe("");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: /^In Progress / }).click();
    await page.getByRole("button", { name: "Move Job #4030", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("Job note");
  } finally { await context.close(); }
});

for (const width of [1440, 820]) test(`job notes disable and restore ${width === 820 ? "touch" : "mouse"} dragging`, async ({ browser }) => {
  const { context, page, writes } = await openBoard(browser, { width, height: 1180 });
  try {
    const source = page.locator('[data-service-board-job-id="todo-30"]');
    const toggle = page.getByRole("button", { name: "Edit job notes" });
    const drag = async () => {
      if (width === 820) {
        const start = await source.boundingBox(), target = await column(page, "In Progress").boundingBox();
        const cdp = await context.newCDPSession(page);
        try {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x + 25, y: start.y + 65, id: 1 }] });
          await page.waitForTimeout(230); // Real long-press activation threshold is 180ms.
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: target.x + target.width / 2, y: start.y + 65, id: 1 }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } finally { await cdp.detach(); }
      } else {
        const transfer = await page.evaluateHandle(() => new DataTransfer());
        try {
          await transfer.evaluate((value) => value.setData("jobId", "todo-30"));
          await source.dispatchEvent("dragstart", { dataTransfer: transfer });
          await column(page, "In Progress").dispatchEvent("dragover", { dataTransfer: transfer });
          await column(page, "In Progress").dispatchEvent("drop", { dataTransfer: transfer });
        } finally { await transfer.dispose(); }
      }
    };
    await toggle.click(); await drag();
    expect(writes.filter((request) => request.path.endsWith("/status"))).toEqual([]);
    expect(readWorkspace().jobs.find((job) => job.id === "todo-30").status).toBe("To Do");
    await toggle.click();
    await expect(source).toHaveAttribute("draggable", "true");
    await drag();
    await expect.poll(() => readWorkspace().jobs.find((job) => job.id === "todo-30").status).toBe("In Progress");
  } finally { await context.close(); }
});
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
      const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/jobs/old-job/status");
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
