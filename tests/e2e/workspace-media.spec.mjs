import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import sharp from "sharp";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";
import { createWorkspaceMediaRouter } from "../../server-workspace-media-routes.js";
import { createStaffRouter } from "../../server-staff-routes.js";
import { createJobRouter } from "../../server-job-routes.js";
import { processMediaImage, saveOwnerPhoto } from "../../server-workspace-media.js";
import { addJobPhoto } from "../../server-workspace-jobs.js";

const root = path.resolve(import.meta.dirname, "../..");
const screenshotDir = path.join(root, "test-results/media-visual");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
let vite, api, baseUrl, apiUrl, directory, db, png, env = {}, site, customer, staff, testRole = "admin";
const admin = { id: "media-browser-test", name: "Photo Tester", role: "admin" };

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-media-browser-"));
  fs.mkdirSync(screenshotDir, { recursive: true });
  png = await sharp(Buffer.from('<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="#dce8ed"/><rect x="65" y="145" width="670" height="320" fill="#374e5b"/><path d="M140 160v285m100-285v285m100-285v285m100-285v285m100-285v285m100-285v285" stroke="#aec4cf" stroke-width="12"/><rect x="350" y="480" width="100" height="45" fill="#397e75"/></svg>')).png().toBuffer();
  const app = express();
  const requireAuth = (req, _res, next) => { req.user = { ...admin, role: testRole, staffId: staff?.id }; next(); };
  const requireRole = roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  app.use(createWorkspaceMediaRouter({ requireAuth, requireRole, env }));
  app.use(express.json());
  app.use(createStaffRouter({ requireAuth, requireRole, env }));
  app.use(createJobRouter({ requireAuth, requireRole, env }));
  app.get("/api/app-state", (_req, res) => res.json({ state: loadWorkspaceStateFromDb(db) }));
  app.get("/api/auth/me", (_req, res) => res.json({ user: { ...admin, role: testRole, staffId: staff?.id } }));
  app.get("/api/user-preferences", (_req, res) => res.json({ preferences: {} }));
  app.get("/api/admin/user-accounts", (_req, res) => res.json({ users: [] }));
  app.get("/api/jobs/:id/maintenance-service", (_req, res) => res.json({ enabled: false, report: null }));
  api = app.listen(0, "127.0.0.1");
  await new Promise(resolve => api.once("listening", resolve));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  vite = await createServer({ root, cacheDir: "node_modules/.vite-media-tests", server: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error" });
  await vite.listen(); baseUrl = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => {
  await vite?.close(); await new Promise(resolve => api.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});
test.beforeEach(async ({ context }, info) => {
  testRole = "admin";
  env.ELSET_DATA_DIR = path.join(directory, String(info.testId).replace(/[^a-zA-Z0-9]/g, ""));
  fs.mkdirSync(env.ELSET_DATA_DIR, { recursive: true });
  db = openWorkspaceDb({ dbPath: path.join(env.ELSET_DATA_DIR, "elset-workspace.db") });
  const state = structuredClone(fixture);
  customer = state.customers.find(entry => entry.id === state.jobs[0].customerId); site = customer.sites[0]; staff = state.staff[0];
  const job = { ...state.jobs[0], id: "gallery-job", jobNumber: 1543, siteId: site.id, assignedTechnicianId: staff.id, assignedTechnicianName: staff.name, scheduledDate: "2026-10-05", title: "Gate photo history", notes: [], photos: [], quote: null, invoice: null, maintenancePlanId: "" };
  state.jobs = [job, { ...job, id: "unlinked-job", siteId: "", jobNumber: 1492, title: "Address-only Job excluded" }];
  importWorkspaceJsonData(db, state);
  addJobPhoto(db, job.id, { id: "job-photo", name: "Job gate photo.png", url: `data:image/png;base64,${png.toString("base64")}` });
  addJobPhoto(db, "unlinked-job", { id: "unlinked-photo", name: "Unlinked hidden photo.png", url: `data:image/png;base64,${png.toString("base64")}` });
  saveOwnerPhoto(db, admin, "site", site.id, await processMediaImage(png, "image/png", "site", "Site overview.png"), "Site overview.png");
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: apiUrl + url.pathname + url.search }) });
  });
});
test.afterEach(() => { db.close(); });

const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const uploadFile = () => ({ name: "Profile.png", mimeType: "image/png", buffer: png });
async function openStaff(page) {
  await page.goto(baseUrl);
  await expect(page.getByText("Gate photo history", { exact: true }).first()).toBeVisible();
  const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole("button", { name: "Staff", exact: true }).click();
}

for (const width of [390, 820, 1440]) test(`media controls, gallery and viewer at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openStaff(page);
  await expect(page.getByText(staff.name, { exact: true }).first()).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `staff-list-fallback-${width}.png`), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: /^Edit$|^Edit staff member/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Upload Profile Photo" })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, `staff-profile-fallback-${width}.png`), fullPage: true, animations: "disabled" });
  await dialog.getByLabel("Choose profile photo").setInputFiles(uploadFile());
  await expect(dialog.getByRole("button", { name: "Change Profile Photo" })).toBeEnabled();
  await expect(dialog.locator("img")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `staff-profile-photo-${width}.png`), fullPage: true, animations: "disabled" });
  const firstId = db.prepare("SELECT id FROM workspace_media WHERE owner_type='staff'").get().id;
  await dialog.getByLabel("Choose profile photo").setInputFiles({ ...uploadFile(), name: "Changed.png" });
  await expect.poll(() => db.prepare("SELECT id FROM workspace_media WHERE owner_type='staff'").get().id).not.toBe(firstId);
  await expect(dialog.getByRole("button", { name: "Change Profile Photo" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-slot="avatar-image"]').first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, `staff-list-photo-${width}.png`), fullPage: true, animations: "disabled" });
  await page.reload(); await expect(page.locator('[data-slot="avatar-image"]').first()).toBeVisible();

  const sitePath = `${baseUrl}/customers/${customer.id}/sites/${site.id}`;
  await page.goto(sitePath); await page.getByRole("tab", { name: "Photos", exact: true }).click();
  const gallery = page.getByRole("region", { name: "Site Photos", exact: true });
  await expect(gallery.getByRole("button", { name: "View Site overview.png" })).toBeVisible();
  await expect(gallery.getByRole("button", { name: "View Job gate photo.png" })).toBeVisible();
  await expect(gallery.getByText("Unlinked hidden photo.png")).toHaveCount(0);
  for (const img of await gallery.locator("img").all()) { await expect(img).toHaveAttribute("loading", "lazy"); await expect(img).toHaveAttribute("src", /thumbnail$/); }
  await gallery.getByLabel("Choose Site photos").setInputFiles([{ ...uploadFile(), name: "Gate overview.png" }, { ...uploadFile(), name: "Cabinet.png" }]);
  await expect(gallery.getByText("2 photos uploaded.")).toBeVisible();
  await expect(gallery.locator("article")).toHaveCount(4);
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `site-gallery-${width}.png`), fullPage: true, animations: "disabled" });
  await gallery.getByRole("button", { name: "View Gate overview.png" }).click();
  await expect(dialog.locator("img")).toHaveAttribute("src", /image$/);
  await dialog.getByLabel("Caption (optional)").fill("Main vehicle gate");
  await dialog.getByRole("button", { name: "Save Caption" }).click();
  await expect(dialog.getByRole("heading", { name: "Main vehicle gate" })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: path.join(screenshotDir, `site-viewer-${width}.png`), fullPage: true, animations: "disabled" });
  page.once("dialog", popup => popup.accept());
  await dialog.getByRole("button", { name: "Remove Site Photo" }).click();
  await expect(dialog).toHaveCount(0); await expect(gallery.locator("article")).toHaveCount(3);
  await gallery.getByRole("button", { name: "Job Photos", exact: true }).click();
  await expect(gallery.locator("article")).toHaveCount(1);
  await expect.poll(() => gallery.locator("img").evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(screenshotDir, `job-photo-history-${width}.png`), fullPage: true, animations: "disabled" });
  await gallery.getByRole("button", { name: "View Job gate photo.png" }).click();
  await expect(dialog.getByRole("button", { name: "Remove Site Photo" })).toHaveCount(0);
  await expect(dialog.getByText("Job #1543", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Open Job", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/gallery-job$/);
  await expect(page.locator('[data-slot="avatar-image"]').first()).toBeVisible();
  await noOverflow(page);

  await openStaff(page); await page.getByRole("button", { name: /^Edit$|^Edit staff member/ }).first().click();
  await dialog.getByRole("button", { name: "Remove Profile Photo" }).click();
  await expect(dialog.getByRole("button", { name: "Upload Profile Photo" })).toBeEnabled();
  await expect(dialog.locator("img")).toHaveCount(0);
});

test("missing gallery images show a fallback and incremental loading avoids originals", async ({ page }) => {
  const processed = await processMediaImage(png, "image/png", "site", "x.png");
  for (let i = 0; i < 31; i++) saveOwnerPhoto(db, admin, "site", site.id, processed, `Reference ${i}.png`);
  db.prepare("UPDATE job_attachments SET url='https://example.test/unavailable.png' WHERE id='job-photo'").run();
  const originalRequests = [];
  page.on("request", req => { if (/\/api\/(media|sites)\/.+\/image$/.test(req.url())) originalRequests.push(req.url()); });
  await page.goto(`${baseUrl}/customers/${customer.id}/sites/${site.id}`);
  await page.getByRole("tab", { name: "Photos", exact: true }).click();
  const gallery = page.getByRole("region", { name: "Site Photos", exact: true });
  await expect(gallery.locator("article")).toHaveCount(30);
  expect(originalRequests).toEqual([]);
  await gallery.getByRole("button", { name: "Load more photos" }).click();
  await expect(gallery.locator("article")).toHaveCount(33);
  await gallery.getByRole("button", { name: "Job Photos", exact: true }).click();
  await expect(gallery.getByText("Image unavailable")).toBeVisible();
  await gallery.getByRole("button", { name: "View Job gate photo.png" }).click();
  await expect(page.getByRole("dialog").getByText("Image unavailable")).toBeVisible();
});

test("unavailable Staff image falls back to initials in list and profile", async ({ page, context }) => {
  const photo = saveOwnerPhoto(db, admin, "staff", staff.id, await processMediaImage(png, "image/png", "staff", "x.png"), "x.png");
  await context.route(`**${photo.thumbnailUrl}`, route => route.fulfill({ status: 404, json: { error: "Image missing" } }));
  await openStaff(page);
  await expect(page.locator('[data-slot="avatar-fallback"]').first()).toHaveText("JV");
  await expect(page.locator('[data-slot="avatar-image"]')).toHaveCount(0);
  await page.getByRole("button", { name: /^Edit$|^Edit staff member/ }).first().click();
  await expect(page.getByRole("dialog").locator('[data-slot="avatar-fallback"]')).toHaveText("JV");
});

test("Technician can view linked Site history from Job without Site mutation controls", async ({ page }) => {
  testRole = "technician";
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(`${baseUrl}/jobs/gallery-job`);
  await page.getByRole("tab", { name: "Notes & photos", exact: true }).click();
  const gallery = page.getByRole("region", { name: "Site Photos", exact: true });
  await expect(gallery.getByRole("button", { name: "View Site overview.png" })).toBeVisible();
  await expect(gallery.getByRole("button", { name: "Upload Site Photos" })).toHaveCount(0);
  await gallery.getByRole("button", { name: "View Site overview.png" }).click();
  await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Remove Site Photo" })).toHaveCount(0);
  await noOverflow(page);
});
