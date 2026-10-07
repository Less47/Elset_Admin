import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";
import { createJobRouter } from "../../server-job-routes.js";
import { createDocumentRouter } from "../../server-document-routes.js";
import { createJobCostingRouter } from "../../server-job-costing-routes.js";
import { updateWorkspaceAddons } from "../../server-workspace-addons.js";
import { createAddonRouter } from "../../server-addon-routes.js";
import { insertJobTree } from "../../server-workspace-jobs.js";
import { themePresets } from "../../src/lib/theme-presets.js";
import { contrastRatio } from "../../src/lib/theme-tokens.js";
import { getBuildMetadata } from "../../scripts/build-metadata.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const screenshots = path.join(root, "test-results/warranty-badge-removal");
const refinementScreenshots = path.join(root, "test-results/legend-warranty-refinement");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
let vite, api, baseUrl, apiUrl, directory, db, customer, preferences = {}, testRole = "admin";
const env = {}, user = { id: "warranty-browser-test", name: "Billing Tester", role: "admin" };

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-billing-browser-"));
  fs.mkdirSync(screenshots, { recursive: true });
  fs.mkdirSync(refinementScreenshots, { recursive: true });
  const app = express(); app.use(express.json());
  const requireAuth = (req, _res, next) => { req.user = { ...user, role: testRole }; next(); };
  const requireRole = roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  app.use(createJobRouter({ requireAuth, requireRole, env }));
  app.use(createDocumentRouter({ requireAuth, requireRole, env }));
  app.use(createJobCostingRouter({ requireAuth, requireRole, env }));
  app.use(createAddonRouter({ requireAuth, requireRole, env }));
  app.get("/api/app-state", (_req, res) => res.json({ state: loadWorkspaceStateFromDb(db) }));
  app.get("/api/auth/me", (_req, res) => res.json({ user: { ...user, role: testRole } }));
  app.get("/api/user-preferences", (_req, res) => res.json({ preferences }));
  app.patch("/api/user-preferences", (req, res) => { preferences = { ...preferences, ...req.body }; res.json({ preferences }); });
  app.get("/api/admin/user-accounts", (_req, res) => res.json({ users: [] }));
  app.get("/api/jobs/:id/maintenance-service", (_req, res) => res.json({ enabled: false, report: null }));
  app.get("/api/maps/config", (_req, res) => res.json({ enabled: false }));
  app.get("/api/accounting/:provider/status", (_req, res) => res.json({ enabled: true, status: "DISCONNECTED" }));
  api = app.listen(0, "127.0.0.1"); await new Promise(resolve => api.once("listening", resolve));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  vite = await createServer({
    root, configFile: false, envFile: false, plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": path.join(root, "src") } },
    define: { __ELSET_BUILD__: JSON.stringify(getBuildMetadata({ env: {} })) },
    cacheDir: "node_modules/.vite-billing-tests", server: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error",
  });
  await vite.listen(); baseUrl = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => {
  await vite?.close(); await new Promise(resolve => api.close(resolve));
  expect(path.dirname(path.resolve(directory))).toBe(os.tmpdir()); expect(path.basename(directory)).toMatch(/^elset-billing-browser-/);
  fs.rmSync(directory, { recursive: true, force: true });
});
test.beforeEach(async ({ context }, info) => {
  testRole = "admin"; preferences = {};
  env.ELSET_DATA_DIR = path.join(directory, String(info.testId).replace(/[^a-zA-Z0-9]/g, ""));
  fs.mkdirSync(env.ELSET_DATA_DIR, { recursive: true });
  db = openWorkspaceDb({ dbPath: path.join(env.ELSET_DATA_DIR, "elset-workspace.db") });
  const state = structuredClone(fixture); customer = state.customers.find(entry => entry.id === state.jobs[0].customerId);
  const job = { ...state.jobs[0], id: "warranty", jobNumber: 1543, status: "To Do", title: "Warranty gate callback", billingType: "warranty", warrantyReason: "Installation warranty", urgency: "High", serviceBoardNote: "Waiting on parts", maintenancePlanId: "", maintenancePlanName: "Annual service", notes: [], photos: [], invoice: null,
    quote: { type: "quote", items: [{ description: "Synthetic work", qty: 1, rate: 120 }], sentHistory: [{ id: "sent", sentAt: "2026-10-06", toEmail: "fixture@example.test" }] } };
  state.jobs = [job, { ...job, id: "completed-warranty", jobNumber: 1544, status: "Completed", title: "Completed warranty callback", quote: null },
    { ...job, id: "billable", jobNumber: 1545, billingType: "billable", warrantyReason: "", urgency: "Low", title: "Ordinary billable work", maintenancePlanName: "", invoice: { type: "invoice", items: job.quote.items }, quote: null }];
  importWorkspaceJsonData(db, state); updateWorkspaceAddons(db, { quickbooks: true, jobCosting: true });
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: apiUrl + url.pathname + url.search }) });
  });
});
test.afterEach(() => db.close());

const card = page => page.locator('[data-service-board-job-id="warranty"], [data-mobile-job-id="warranty"]');
const select = async (page, name, value) => { await page.getByRole("combobox", { name, exact: true }).click(); await page.getByRole("option", { name: value, exact: true }).click(); };
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const shot = async (page, name, width) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(screenshots, `${name}-${width}.png`), fullPage: true, animations: "disabled" }); };
async function filters(page, width) { await page.getByRole("button", { name: width < 768 ? /^Open board filters/ : /^Filters/ }).click(); }
async function closeFilters(page, width) { if (width < 768) await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); else await page.keyboard.press("Escape"); }

for (const width of [390, 820, 1440]) test(`Warranty board, indicators, modes, legend and combined filters at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.goto(baseUrl);
  await expect(card(page)).toBeVisible();
  const modes = width < 768 ? ["Mobile"] : ["List", "Compact", "Grid"];
  for (const mode of modes) {
    if (mode !== "Mobile") await page.getByRole("button", { name: `To Do ${mode} view`, exact: true }).click();
    await expect(card(page).locator(".warranty-job-card").or(card(page).filter({ has: page.locator(":scope.warranty-job-card") })).first()).toBeVisible();
    await expect(card(page).locator('[data-service-board-indicator="warranty"]')).toHaveCount(0);
    await expect(card(page).getByText("WARRANTY", { exact: true })).toHaveCount(0);
    if (mode === "Grid") await expect(card(page).getByText("High", { exact: true })).toHaveCount(0);
    else await expect(card(page).getByText("High", { exact: true })).toBeVisible();
    await expect(card(page).getByTitle("Quoted", { exact: true })).toBeVisible();
    await expect(card(page).getByTitle("Maintenance", { exact: true })).toBeVisible();
    await expect(card(page).getByLabel("Job note: Waiting on parts", { exact: true })).toBeVisible();
    await expect(card(page).locator('[data-service-board-indicator="quickbooks-unsynced"]')).toHaveCount(0);
    await expect(page.locator('[data-service-board-job-id="billable"], [data-mobile-job-id="billable"]').locator('[data-service-board-indicator="quickbooks-unsynced"]')).toBeVisible();
    if (mode === "Grid") {
      const geometry = await card(page).locator("[data-job-card-indicators]").evaluate(el => ({ position: getComputedStyle(el).position, top: getComputedStyle(el).top, outside: el.parentElement.parentElement === el.closest("[data-service-board-job-id]") }));
      expect(geometry.position).toBe("absolute"); expect(geometry.top).toBe("0px");
    }
    await noOverflow(page); await shot(page, `board-${mode.toLowerCase()}`, width);
  }
  await filters(page, width);
  const legend = page.locator("[data-service-board-legend]");
  await expect(page.getByText("Legend", { exact: true })).toHaveCount(0);
  await expect(legend.getByText("Warranty", { exact: true })).toHaveCount(0);
  await expect(legend.locator(":scope > li > span:last-child")).toHaveText(["Quote sent", "Outstanding invoice", "Invoice paid", "Invoice needs attention", "Maintenance", "Not in QuickBooks"]);
  await select(page, "Billing Type filter", "Warranty"); await shot(page, "board-filter", width); await closeFilters(page, width);
  await expect(page.locator('[data-service-board-job-id="billable"], [data-mobile-job-id="billable"]')).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search jobs", exact: true }).fill("Installation warranty"); await expect(card(page)).toBeVisible();
  await page.getByRole("textbox", { name: "Search jobs", exact: true }).fill("absent reason"); await expect(card(page)).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search jobs", exact: true }).fill("");
  await filters(page, width); await select(page, "Billing Type filter", "Billable"); await closeFilters(page, width);
  await expect(card(page)).toHaveCount(0);
  await filters(page, width); await select(page, "Billing Type filter", "All");
  await page.getByRole("checkbox", { name: "High urgency only", exact: true }).check(); await closeFilters(page, width);
  await expect(card(page)).toBeVisible(); await expect(page.locator('[data-service-board-job-id="billable"], [data-mobile-job-id="billable"]')).toHaveCount(0);
  if (width < 768) {
    await page.getByRole("button", { name: "Move Job #1543", exact: true }).click();
    await page.getByRole("button", { name: "Move to In Progress", exact: true }).click();
    await page.getByRole("tab", { name: /^In Progress / }).click();
  } else {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    try {
      await transfer.evaluate(data => data.setData("jobId", "warranty"));
      const target = page.locator('[data-service-board-status="In Progress"]');
      await card(page).dispatchEvent("dragstart", { dataTransfer: transfer });
      await target.dispatchEvent("dragover", { dataTransfer: transfer });
      await target.dispatchEvent("drop", { dataTransfer: transfer });
    } finally { await transfer.dispose(); }
  }
  await expect.poll(() => db.prepare("SELECT status FROM jobs WHERE id='warranty'").get().status).toBe("In Progress");
  await expect(card(page).locator('[data-service-board-indicator="warranty"]')).toHaveCount(0);
  await expect(card(page).locator(".warranty-job-card").or(card(page).filter({ has: page.locator(":scope.warranty-job-card") })).first()).toBeVisible();
  expect(db.prepare("SELECT billing_type,warranty_reason FROM jobs WHERE id='warranty'").get()).toEqual({ billing_type: "warranty", warranty_reason: "Installation warranty" });
  await expect(page.getByRole("button", { name: /tomorrow/i })).toHaveCount(0);
  await expect(card(page).getByLabel("Planned for tomorrow", { exact: true })).toHaveCount(0);
  await noOverflow(page); await shot(page, "board-status-move", width);
});

for (const width of [390, 820, 1440]) test(`Create, edit, Warranty documents, costing and history at ${width}px`, async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.setViewportSize({ width, height: 1000 }); await page.goto(baseUrl + "/jobs/new");
  await expect(page.getByRole("combobox", { name: "Billing Type", exact: true })).toHaveText("Billable");
  await page.getByRole("textbox", { name: "Search customers", exact: true }).fill(customer.name);
  await page.locator('[aria-label="Customer search results"] button').first().click();
  await page.getByLabel("Job title", { exact: true }).fill("Created warranty callback");
  await page.getByLabel("Description of work", { exact: true }).fill("Inspect the synthetic gate under warranty.");
  await select(page, "Billing Type", "Warranty");
  await page.getByLabel(/Warranty Reason/).fill("Manufacturer warranty");
  await select(page, "Billing Type", "Billable"); await expect(page.getByLabel(/Warranty Reason/)).toHaveCount(0);
  await select(page, "Billing Type", "Warranty"); await expect(page.getByLabel(/Warranty Reason/)).toHaveValue("Manufacturer warranty");
  await noOverflow(page); await shot(page, "create", width);
  await page.getByRole("button", { name: "Create Job", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Created warranty callback", exact: true })).toBeVisible();
  const created = db.prepare("SELECT * FROM jobs WHERE title='Created warranty callback'").get(); expect(created.billing_type).toBe("warranty"); expect(created.warranty_reason).toBe("Manufacturer warranty");
  await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await page.getByLabel(/Warranty Reason/).fill("Parts warranty");
  await noOverflow(page); await shot(page, "edit", width);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => db.prepare("SELECT warranty_reason FROM jobs WHERE id=?").get(created.id).warranty_reason).toBe("Parts warranty");
  await expect(page.getByRole("combobox", { name: "Billing Type", exact: true })).toHaveCount(0);
  await page.goto(baseUrl + "/jobs/warranty"); await expect(page.getByRole("heading", { name: "Warranty gate callback", exact: true })).toBeVisible(); await noOverflow(page); await shot(page, "details", width);
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(page.getByText(/Warranty job.*non-billable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Invoice Editor", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send to Invoice", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Quote Editor", exact: true })).toBeVisible();
  await noOverflow(page); await shot(page, "documents", width);
  await page.getByRole("tab", { name: "Costing", exact: true }).click();
  await page.getByTestId("job-costing").getByRole("button", { name: "Add Cost", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Description *", { exact: true }).fill("Warranty replacement part");
  await dialog.getByLabel("Unit cost (ex GST)", { exact: true }).fill("65.00"); await dialog.getByRole("button", { name: "Save cost", exact: true }).click();
  await expect(page.getByText("Warranty replacement part", { exact: true }).filter({ visible: true })).toBeVisible();
  expect(db.prepare("SELECT sum(total_cost_cents) total FROM job_cost_entries WHERE job_id='warranty'").get().total).toBe(6500);
  await noOverflow(page); await shot(page, "costing", width);
  await page.goto(baseUrl + "/jobs/warranty/invoice"); await expect(page.getByText(/Change Billing Type to Billable/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
  await page.goto(baseUrl);
  await expect(card(page)).toBeVisible();
  if (width < 1024) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Job History", exact: true }).click();
  await expect(page.getByText("Warranty · non-billable", { exact: true }).first()).toBeVisible();
  await noOverflow(page); await shot(page, "history", width);
});

test("Billable invoice blocks Warranty edit and reclassification restores normal quote conversion", async ({ page }) => {
  await page.goto(baseUrl + "/jobs/billable"); await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await select(page, "Billing Type", "Warranty"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText(/already has an invoice or accounting ownership/)).toBeVisible(); expect(db.prepare("SELECT billing_type FROM jobs WHERE id='billable'").get().billing_type).toBe("billable");
  await page.goto(baseUrl + "/jobs/warranty"); await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await select(page, "Billing Type", "Billable"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => db.prepare("SELECT billing_type FROM jobs WHERE id='warranty'").get().billing_type).toBe("billable");
  await page.getByRole("tab", { name: "Documents", exact: true }).click(); await expect(page.getByRole("button", { name: "Send to Invoice", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Invoice Editor", exact: true })).toBeVisible();
});

test("Technician keeps field access without Billing Type edit permissions", async ({ page }) => {
  testRole = "technician"; await page.goto(baseUrl + "/jobs/warranty");
  await expect(page.getByText("Installation warranty", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit job details", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Billing Type", exact: true })).toHaveCount(0);
});

for (const theme of themePresets) test(`Warranty card contrast and stable indicators in ${theme.label}`, async ({ page }) => {
  preferences = { ...theme.values }; await page.goto(baseUrl); await expect(card(page)).toBeVisible();
  const colors = await card(page).evaluate(element => {
    const surface = element.querySelector(".warranty-job-card") || element;
    const style = getComputedStyle(surface), text = getComputedStyle(element.querySelector(".text-foreground"));
    const hex = color => { const ctx = document.createElement("canvas").getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return "#" + [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, "0")).join(""); };
    return [hex(style.backgroundColor), hex(text.color)];
  });
  expect(contrastRatio(...colors)).toBeGreaterThanOrEqual(4.5);
  await expect(card(page).locator(".warranty-job-card").or(card(page).filter({ has: page.locator(":scope.warranty-job-card") })).first()).toBeVisible();
  await expect(card(page).locator('[data-service-board-indicator="warranty"]')).toHaveCount(0);
  await expect(card(page).getByText("WARRANTY", { exact: true })).toHaveCount(0);
  await expect(card(page).getByText("High", { exact: true })).toBeVisible();
  await expect(card(page).getByTitle("Quoted", { exact: true })).toBeVisible();
  await expect(card(page).getByTitle("Maintenance", { exact: true })).toBeVisible();
  await shot(page, `theme-${theme.id}`, 1440);
});

const legendLabels = ["Quote sent", "Outstanding invoice", "Invoice paid", "Invoice needs attention", "Maintenance"];
async function assertLegend(page, provider) {
  const legend = page.getByRole("list", { name: "Job indicators", exact: true });
  await expect(legend).toBeVisible();
  await expect(legend.locator(":scope > li > span:last-child")).toHaveText(provider === "quickbooks" ? [...legendLabels, "Not in QuickBooks"] : legendLabels);
  await expect(page.getByText("Legend", { exact: true })).toHaveCount(0);
  await expect(legend.getByText("Warranty", { exact: true })).toHaveCount(0);
  const warning = legend.locator('[data-service-board-indicator="quickbooks-unsynced"]');
  if (provider === "quickbooks") {
    await expect(warning).toHaveAttribute("data-indicator-expanded", "false");
    await expect(warning).toHaveCSS("width", "18px");
    await expect(warning).toHaveCSS("height", "18px");
    await expect(warning.locator("[data-quickbooks-warning-centre]")).toHaveText("!");
    await expect(warning.locator("[data-quickbooks-warning-centre]")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  } else await expect(warning).toHaveCount(0);
  return legend;
}

async function assertWarrantyTextContrast(target) {
  const samples = await target.evaluate(element => {
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    const rgba = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const blend = (front, back) => front.slice(0, 3).map((channel, i) => channel * front[3] / 255 + back[i] * (1 - front[3] / 255));
    const hex = channels => "#" + channels.slice(0, 3).map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("");
    const samples = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent.trim()) continue;
      const owner = text.parentElement, box = owner.getBoundingClientRect();
      if (!box.width || !box.height || owner.closest('[aria-hidden="true"]')) continue;
      const ancestors = []; for (let node = owner; node; node = node.parentElement) ancestors.unshift(node);
      let background = [255, 255, 255];
      for (const node of ancestors) background = blend(rgba(getComputedStyle(node).backgroundColor), background);
      const foreground = blend(rgba(getComputedStyle(owner).color), background);
      samples.push({ text: text.textContent.trim(), foreground: hex(foreground), background: hex(background) });
    }
    return samples;
  });
  expect(samples.length).toBeGreaterThanOrEqual(3);
  for (const sample of samples) expect(contrastRatio(sample.foreground, sample.background), sample.text).toBeGreaterThanOrEqual(4.5);
}

for (const themeId of ["elset", "midnight-signal"]) for (const provider of ["quickbooks", ""]) {
  test(`Warranty comparisons across all statuses and view modes in ${themeId}, accounting ${provider || "disabled"}`, async ({ page }) => {
    preferences = { ...themePresets.find(theme => theme.id === themeId).values };
    updateWorkspaceAddons(db, { quickbooks: provider === "quickbooks", xero: false });
    const state = loadWorkspaceStateFromDb(db), warranty = state.jobs.find(job => job.id === "warranty"), billable = state.jobs.find(job => job.id === "billable");
    for (const [base, id, jobNumber, status, title] of [
      [warranty, "warranty-progress", 1546, "In Progress", "Warranty progress callback"],
      [billable, "billable-progress", 1547, "In Progress", "Ordinary progress work"],
      [billable, "billable-completed", 1548, "Completed", "Ordinary completed work"],
    ]) insertJobTree(db, { ...base, id, jobNumber, status, title, invoice: null, quote: null, notes: [], photos: [] });
    const before = db.prepare("SELECT * FROM jobs ORDER BY id").all();
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(baseUrl);
    await assertLegend(page, provider);
    const selectors = {
      "To Do": ["warranty", "billable"],
      "In Progress": ["warranty-progress", "billable-progress"],
      Completed: ["completed-warranty", "billable-completed"],
    };
    for (const view of ["List", "Grid", "Compact"]) {
      for (const status of Object.keys(selectors)) await page.getByRole("button", { name: `${status} ${view} view`, exact: true }).click();
      const surfaces = [];
      for (const [status, [warrantyId, billableId]] of Object.entries(selectors)) {
        const column = page.locator(`[data-service-board-status="${status}"]`);
        const warrantyCard = column.locator(`[data-service-board-job-id="${warrantyId}"]`);
        const billableCard = column.locator(`[data-service-board-job-id="${billableId}"]`);
        await expect(warrantyCard).toBeVisible(); await expect(billableCard).toBeVisible();
        await expect(warrantyCard.locator(".warranty-job-card")).toHaveCount(1);
        await expect(billableCard.locator(".warranty-job-card")).toHaveCount(0);
        const surface = warrantyCard.locator(".warranty-job-card");
        await expect(surface).toHaveCSS("border-top-width", "1px");
        const background = await surface.evaluate(element => getComputedStyle(element).backgroundColor);
        const ordinaryBackground = await billableCard.locator('[data-slot="card"]').evaluate(element => getComputedStyle(element).backgroundColor);
        expect(background).not.toBe(ordinaryBackground); surfaces.push(background);
        await assertWarrantyTextContrast(warrantyCard);
        await expect(warrantyCard.getByText("WARRANTY", { exact: true })).toHaveCount(0);
        await expect(warrantyCard.locator('[data-service-board-indicator="warranty"]')).toHaveCount(0);
      }
      expect(new Set(surfaces).size).toBe(1);
      await noOverflow(page);
      await page.screenshot({ path: path.join(refinementScreenshots, `${themeId}-${provider || "disabled"}-${view.toLowerCase()}.png`), fullPage: true, animations: "disabled" });
    }
    expect(db.prepare("SELECT * FROM jobs ORDER BY id").all()).toEqual(before);
    await expect(page.locator("[data-tomorrow-job-id]")).toHaveCount(0);
  });
}

for (const width of [320, 390]) for (const provider of ["quickbooks", "xero", ""]) {
  test(`mobile legend starts with indicators and wraps cleanly at ${width}px with ${provider || "disabled accounting"}`, async ({ page }) => {
    updateWorkspaceAddons(db, { quickbooks: provider === "quickbooks", xero: provider === "xero" });
    await page.setViewportSize({ width, height: 900 }); await page.goto(baseUrl); await expect(card(page)).toBeVisible();
    await filters(page, width);
    const legend = await assertLegend(page, provider);
    const wrapped = await legend.getByRole("listitem").evaluateAll(items => items.at(-1).getBoundingClientRect().top > items[0].getBoundingClientRect().top);
    expect(wrapped).toBe(true);
    await noOverflow(page);
    await page.screenshot({ path: path.join(refinementScreenshots, `mobile-${width}-${provider || "disabled"}.png`), animations: "disabled" });
  });
}
