import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import sharp from "sharp";
import { openWorkspaceDb, readWorkspaceSchemaVersion } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";
import { createWorkspaceMediaRouter } from "../../server-workspace-media-routes.js";
import { createStaffRouter } from "../../server-staff-routes.js";
import { createJobRouter } from "../../server-job-routes.js";
import { processMediaImage, saveOwnerPhoto } from "../../server-workspace-media.js";
import { addJobPhoto } from "../../server-workspace-jobs.js";
import { createStaffMember } from "../../server-workspace-staff.js";

const root = path.resolve(import.meta.dirname, "../..");
const screenshotDir = path.join(root, "test-results/media-visual");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
let vite, api, baseUrl, apiUrl, directory, db, png, env = {}, site, customer, staff, testRole = "admin";
const admin = { id: "media-browser-test", name: "Photo Tester", role: "admin" };
let testUser, preferences;
const navigationScreenshots = path.join(root, "test-results/navigation-avatar");

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-media-browser-"));
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(navigationScreenshots, { recursive: true });
  png = await sharp(Buffer.from('<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="#dce8ed"/><rect x="65" y="145" width="670" height="320" fill="#374e5b"/><path d="M140 160v285m100-285v285m100-285v285m100-285v285m100-285v285m100-285v285" stroke="#aec4cf" stroke-width="12"/><rect x="350" y="480" width="100" height="45" fill="#397e75"/></svg>')).png().toBuffer();
  const app = express();
  const requireAuth = (req, _res, next) => { req.user = { ...testUser, role: testRole }; next(); };
  const requireRole = roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  app.use(createWorkspaceMediaRouter({ requireAuth, requireRole, env }));
  app.use(express.json());
  app.use(createStaffRouter({ requireAuth, requireRole, env }));
  app.use(createJobRouter({ requireAuth, requireRole, env }));
  app.get("/api/app-state", (_req, res) => res.json({ state: loadWorkspaceStateFromDb(db) }));
  app.get("/api/auth/me", (_req, res) => res.json({ user: { ...testUser, role: testRole } }));
  app.get("/api/user-preferences", (_req, res) => res.json({ preferences }));
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
  testUser = { ...admin, staffId: staff.id, username: "photo.tester" };
  preferences = {};
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
  await expect(page.getByRole("img", { name: staff.name, exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, `staff-list-photo-${width}.png`), fullPage: true, animations: "disabled" });
  await page.reload(); await expect(page.getByRole("img", { name: staff.name, exact: true }).first()).toBeVisible();

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
  await expect(page.getByRole("img", { name: staff.name, exact: true }).first()).toBeVisible();
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
  await expect(page.locator('.workspace-sidebar-user [data-slot="avatar-fallback"]')).toHaveText("PT");
  await expect(page.getByLabel(`${staff.name} profile photo`, { exact: true }).first().locator('[data-slot="avatar-fallback"]')).toHaveText("JV");
  await expect(page.locator('[data-slot="avatar-image"]')).toHaveCount(0);
  await page.getByRole("button", { name: /^Edit$|^Edit staff member/ }).first().click();
  await expect(page.getByRole("dialog").locator('[data-slot="avatar-fallback"]')).toHaveText("JV");
});

const accountAvatar = page => page.locator('.workspace-sidebar-user .workspace-sidebar-avatar');
async function openNavigationIdentity(page, mobile) {
  if (!mobile) return accountAvatar(page);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Application navigation", exact: true });
  await expect(drawer).toBeVisible();
  await drawer.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  return drawer.locator(".workspace-sidebar-avatar");
}
async function saveNavigationScreenshot(page, name) {
  await noOverflow(page);
  await page.screenshot({ path: path.join(navigationScreenshots, `${name}.png`), animations: "disabled" });
}

test("navigation photo resolves only the linked Staff ID, even when another Staff matches the account name and email", async ({ page }) => {
  const other = { ...staff, id: "same-name-staff", name: admin.name, email: "account@example.test", initials: "PT" };
  createStaffMember(db, other);
  testUser.email = other.email;
  testUser.image = "https://example.test/ignored-auth-photo.png";
  const ownPhoto = saveOwnerPhoto(db, admin, "staff", staff.id, await processMediaImage(png, "image/png", "staff", "Linked.png"), "Linked.png");
  const otherPhoto = saveOwnerPhoto(db, admin, "staff", other.id, await processMediaImage(png, "image/png", "staff", "Other.png"), "Other.png");
  await page.goto(baseUrl);
  const avatar = accountAvatar(page);
  await expect(avatar.locator("img")).toHaveAttribute("src", ownPhoto.thumbnailUrl);
  await expect(avatar.locator("img")).toBeVisible();
  await expect(avatar.locator("img")).not.toHaveAttribute("src", otherPhoto.thumbnailUrl);
  await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveCount(0);
  await expect(avatar).toHaveAttribute("aria-hidden", "true");
  await expect(avatar.locator("img")).toHaveAttribute("alt", "");
  await expect(page.getByRole("button", { name: "Account", exact: true })).toHaveAccessibleName("Account");
});

for (const link of ["linked", "none", "invalid"]) for (const width of [390, 1440]) {
  test(`navigation initials fallback with ${link} Staff reference at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    testUser.name = link === "linked" ? admin.name : staff.name;
    testUser.email = staff.email;
    testUser.username = staff.name;
    testUser.image = `data:image/png;base64,${png.toString("base64")}`;
    if (link !== "linked") {
      testUser.staffId = link === "none" ? "" : "nonexistent-staff";
      saveOwnerPhoto(db, admin, "staff", staff.id, await processMediaImage(png, "image/png", "staff", "Unrelated.png"), "Unrelated.png");
    } else {
      // A legacy Staff initials value must not replace the authenticated name's fallback.
      db.prepare("UPDATE staff SET extra_json=json_set(extra_json, '$.initials', 'XX') WHERE id=?").run(staff.id);
    }
    await page.goto(baseUrl);
    const avatar = await openNavigationIdentity(page, width < 1024);
    await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveText(link === "linked" ? "PT" : "JV");
    await expect(avatar.locator("img")).toHaveCount(0);
    await expect(avatar).toHaveAttribute("aria-hidden", "true");
    if (width < 1024) {
      await expect(page.getByRole("dialog", { name: "Application navigation" })).toContainText(testUser.name);
      await expect(page.getByRole("dialog", { name: "Application navigation" })).toContainText("admin");
      await expect(page.locator(".mobile-workspace-navigation header [data-slot=avatar]")).toHaveCount(0);
    }
    await noOverflow(page);
  });
}

for (const width of [390, 1440]) test(`navigation handles missing Staff image at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 900 });
  const photo = saveOwnerPhoto(db, admin, "staff", staff.id, await processMediaImage(png, "image/png", "staff", "Missing.png"), "Missing.png");
  await context.route(`**${photo.thumbnailUrl}`, route => route.fulfill({ status: 404, json: { error: "Image missing" } }));
  await page.goto(baseUrl);
  const avatar = await openNavigationIdentity(page, width < 1024);
  await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveText("PT");
  await expect(avatar.locator("img")).toHaveCount(0);
});

for (const mode of ["desktop", "compact", "mobile"]) test(`navigation photo upload, change and removal update live in ${mode} mode without layout jumps`, async ({ page }) => {
  const mobile = mode === "mobile";
  await page.setViewportSize({ width: mobile ? 390 : 1440, height: 900 });
  preferences = { sidebarWidth: mode === "compact" ? "icon-only" : "standard" };
  const initialSchema = readWorkspaceSchemaVersion(db);
  const documentRequests = [], stateRequests = [];
  page.on("request", request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url());
    if (new URL(request.url()).pathname === "/api/app-state") stateRequests.push(request.url());
  });
  await openStaff(page);
  const initialStateRequests = stateRequests.length;
  let avatar = await openNavigationIdentity(page, mobile);
  await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveText("PT");
  const fallbackBox = await avatar.boundingBox();
  const account = page.locator(".workspace-sidebar-user");
  const accountBox = mobile ? null : await account.boundingBox();
  const nameBox = mode === "desktop" ? await account.locator(".workspace-sidebar-user-details").boundingBox() : null;
  expect(fallbackBox.width).toBe(32); expect(fallbackBox.height).toBe(32);
  const fallbackStyle = await avatar.evaluate(element => {
    const root = getComputedStyle(element), fallback = getComputedStyle(element.querySelector('[data-slot="avatar-fallback"]'));
    return { background: fallback.backgroundColor === root.backgroundColor, color: fallback.color === root.color, fontSize: fallback.fontSize };
  });
  expect(fallbackStyle).toEqual({ background: true, color: true, fontSize: "11px" });
  await saveNavigationScreenshot(page, `${mode}-initials`);
  if (mobile) await page.keyboard.press("Escape");

  const editor = page.getByRole("dialog", { name: "Edit Staff Member", exact: true });
  const openEditor = async () => page.getByRole("button", { name: /^Edit$|^Edit staff member/ }).first().click();
  await openEditor();
  await editor.getByLabel("Choose profile photo").setInputFiles(uploadFile());
  await expect(editor.getByRole("button", { name: "Change Profile Photo" })).toBeEnabled();
  const firstUrl = await editor.locator("img").getAttribute("src");
  if (!mobile) await expect(avatar.locator("img")).toHaveAttribute("src", firstUrl);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  avatar = await openNavigationIdentity(page, mobile);
  await expect(avatar.locator("img")).toHaveAttribute("src", firstUrl);
  await expect(avatar.locator("img")).toBeVisible();
  await expect(avatar.locator("img")).toHaveCSS("object-fit", "cover");
  expect(await avatar.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThanOrEqual(16);
  expect(await avatar.boundingBox()).toEqual(fallbackBox);
  if (!mobile) expect(await account.boundingBox()).toEqual(accountBox);
  if (nameBox) expect(await account.locator(".workspace-sidebar-user-details").boundingBox()).toEqual(nameBox);
  await saveNavigationScreenshot(page, `${mode}-photo`);
  if (mobile) await page.keyboard.press("Escape");

  await openEditor();
  await editor.getByLabel("Choose profile photo").setInputFiles({ ...uploadFile(), name: "Changed.png" });
  await expect(editor.getByRole("button", { name: "Change Profile Photo" })).toBeEnabled();
  await expect(editor.locator("img")).not.toHaveAttribute("src", firstUrl);
  const changedUrl = await editor.locator("img").getAttribute("src");
  if (!mobile) await expect(avatar.locator("img")).toHaveAttribute("src", changedUrl);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  avatar = await openNavigationIdentity(page, mobile);
  await expect(avatar.locator("img")).toHaveAttribute("src", changedUrl);
  if (mobile) await page.keyboard.press("Escape");

  await openEditor();
  await editor.getByRole("button", { name: "Remove Profile Photo" }).click();
  await expect(editor.getByRole("button", { name: "Upload Profile Photo" })).toBeEnabled();
  await expect(editor.locator('[data-slot="avatar-fallback"]')).toHaveText("JV");
  if (!mobile) await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveText("PT");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  avatar = await openNavigationIdentity(page, mobile);
  await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveText("PT");
  await expect(avatar.locator("img")).toHaveCount(0);
  expect(await avatar.boundingBox()).toEqual(fallbackBox);
  if (!mobile) expect(await account.boundingBox()).toEqual(accountBox);
  expect(documentRequests).toHaveLength(1);
  expect(stateRequests).toHaveLength(initialStateRequests);
  expect(readWorkspaceSchemaVersion(db)).toBe(initialSchema);
  expect(initialSchema).toBe(18);
});

test("compact navigation avatar remains centered with account tooltip and keyboard dialog activation", async ({ page }) => {
  preferences = { sidebarWidth: "icon-only" };
  saveOwnerPhoto(db, admin, "staff", staff.id, await processMediaImage(png, "image/png", "staff", "Account.png"), "Account.png");
  await page.goto(baseUrl);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const account = sidebar.getByRole("button", { name: "Account", exact: true });
  const avatar = accountAvatar(page);
  await expect(avatar.locator("img")).toBeVisible();
  await expect(account.locator(".workspace-sidebar-user-details")).toHaveCount(0);
  const accountBox = await account.boundingBox(), avatarBox = await avatar.boundingBox();
  expect(accountBox.width).toBe(44); expect(accountBox.height).toBe(44);
  expect(avatarBox.x + avatarBox.width / 2).toBe(accountBox.x + accountBox.width / 2);
  expect(avatarBox.y + avatarBox.height / 2).toBe(accountBox.y + accountBox.height / 2);
  await account.hover();
  await expect(page.getByRole("tooltip")).toContainText(`Account · ${admin.name} · admin`);
  await page.keyboard.press("Escape"); await page.mouse.move(500, 500);
  for (const key of ["Enter", "Space"]) {
    await account.focus();
    await expect(account).toHaveCSS("outline-style", "solid");
    await page.keyboard.press(key);
    await expect(page.getByRole("dialog", { name: "Account", exact: true })).toContainText(`Signed in as ${admin.name}.`);
    await expect(page.getByRole("dialog", { name: "Account", exact: true })).toContainText(testUser.username);
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
  }
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
