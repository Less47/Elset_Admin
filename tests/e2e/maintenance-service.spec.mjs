import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { createMaintenancePlan, generateMaintenanceJob } from "../../server-workspace-maintenance.js";
import { getWorkspaceAddons, updateWorkspaceAddons } from "../../server-workspace-addons.js";
import { addJobPhoto, deleteJob } from "../../server-workspace-jobs.js";
import { getMaintenanceServiceReport, updateMaintenanceServiceResult, completeMaintenanceService } from "../../server-workspace-maintenance-service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshotDir = path.join(root, "test-results/maintenance-service");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
const password = "E2E-maintenance-services-123";
let directory, server, url, output = "", sequence = 0, current;
const actor = { id: "fixture-technician", role: "technician", staffId: "demo-staff-admin", name: "Fixture Technician" };
function dbRead(callback) {
  const db = openWorkspaceDb({ dbPath: path.join(directory, "elset-workspace.db") });
  try { return callback(db); } finally { db.close(); }
}
const report = () => dbRead(db => getMaintenanceServiceReport(db, current.job.id));
async function signedImage() { return `data:image/png;base64,${(await sharp(Buffer.from('<svg width="720" height="240"><path d="M20 130 Q100 30 140 120 T300 95 L470 145" fill="none" stroke="black" stroke-width="5"/></svg>')).png().toBuffer()).toString("base64")}`; }
test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-service-e2e-")); fs.mkdirSync(screenshotDir, { recursive: true });
  dbRead(db => importWorkspaceJsonData(db, { ...fixture, jobs: [], maintenancePlans: [] }));
  const listener = net.createServer();
  const port = await new Promise(resolve => listener.listen(0, "127.0.0.1", () => { const port = listener.address().port; listener.close(() => resolve(port)); }));
  url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, ELSET_DATA_DIR: directory, ELSET_WORKSPACE_DB_PATH: path.join(directory, "elset-workspace.db"),
    ELSET_AUTH_DB_PATH: path.join(directory, "auth.db"), NODE_ENV: "test", FLY_APP_NAME: "", PORT: String(port), ELSET_API_PORT: String(port),
    BETTER_AUTH_URL: url, ELSET_FRONTEND_URL: url, SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" };
  const seed = `const {auth,ensureAuthReady}=await import(${JSON.stringify(pathToFileURL(path.join(root,"server-auth.js")).href)});await ensureAuthReady();const c=await auth.$context;for(const role of ['admin','office','technician']){const u=await c.internalAdapter.createUser({email:role+'@maintenance-test.local',emailVerified:true,name:'Service '+role,role,username:'service'+role,displayUsername:'Service '+role,workspaceRole:role,staffId:role==='technician'?'demo-staff-admin':''});await c.internalAdapter.linkAccount({userId:u.id,accountId:u.id,providerId:'credential',password:await c.password.hash(${JSON.stringify(password)})});}`;
  const seeded = spawnSync(process.execPath, ["--input-type=module", "-e", seed], { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
  server = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  await expect.poll(async () => { try { return (await fetch(`${url}/api/auth/me`)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(401);
});
test.beforeEach(async () => {
  const photo = await signedImage();
  current = dbRead(db => {
    const id = `browser-service-${++sequence}`;
    updateWorkspaceAddons(db, { maintenanceChecklists: true });
    const plan = createMaintenancePlan(db, { id, customerId: "demo-customer-arcadia", siteId: "demo-site-front-entry", siteAddress: "10 Example Lane, Sampleton VIC 3000",
      frequency: "six-monthly", nextDueDate: "2026-10-05", defaultTechnicianId: "demo-staff-admin",
      checklist: ["Test basement induction loop", "Inspect boom gate fixings"] });
    const job = generateMaintenanceJob(db, plan.id, { occurrenceKey: plan.nextOccurrence.key, revision: plan.maintenanceRevision, jobId: `${id}-job` }).job;
    addJobPhoto(db, job.id, { id: `${id}-photo`, name: "Safety beam.png", url: photo });
    return { plan, job };
  });
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await info.attach("server-output", { body: output, contentType: "text/plain" }); });
test.afterAll(async () => {
  if (server?.exitCode === null) { server.kill("SIGTERM"); await new Promise(resolve => { server.once("exit", resolve); setTimeout(resolve, 5000); }); }
  const resolved = path.resolve(directory || "");
  if (resolved.startsWith(path.join(os.tmpdir(), "elset-service-e2e-"))) fs.rmSync(resolved, { recursive: true, force: true });
});
async function login(browser, width, role = "admin") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 1024, isMobile: width < 768,
    locale: "en-AU", timezoneId: "Australia/Sydney", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(url); await page.getByPlaceholder("Enter your username").fill(`service${role}`);
  await page.getByPlaceholder("Enter your password").fill(password); await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByPlaceholder("Enter your username")).toHaveCount(0);
  return { context, page };
}
async function capture(page, info, name, target) {
  if (target) await target.scrollIntoViewIfNeeded();
  else await page.evaluate(() => window.scrollTo(0, 0));
  const file = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: !target, animations: "disabled" });
  await info.attach(name, { path: file, contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const width of [390, 820, 1440]) test(`structured plan, technician defect/signature, history/report/email at ${width}px`, async ({ browser }, info) => {
  const admin = await login(browser, width), page = admin.page;
  await page.goto(`${url}/maintenance/${current.plan.id}/edit`);
  await page.getByText("10 standard checks · locked", { exact: true }).click();
  await expect(page.getByLabel("Standard, locked")).toHaveCount(10);
  await expect(page.getByLabel("Additional check 1", { exact: true })).toHaveValue("Test basement induction loop");
  await page.getByRole("button", { name: "Add check", exact: true }).click();
  await page.getByLabel("Additional check 3", { exact: true }).fill("Test fire interface");
  await page.getByRole("button", { name: "Move additional check 3 up", exact: true }).click();
  await expect(page.getByLabel("Additional check 2", { exact: true })).toHaveValue("Test fire interface");
  await page.getByRole("button", { name: "Remove additional check 3", exact: true }).click();
  await capture(page, info, `plan-editor-${width}`);
  await page.getByRole("button", { name: "Save Plan", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/maintenance/${current.plan.id}$`));
  await expect(page.getByText("10 standard checks · 2 additional checks", { exact: true })).toBeVisible();
  expect(report().items.at(-1).text).toBe("Inspect boom gate fixings");

  const tech = await login(browser, width, "technician"), jobPage = tech.page;
  await jobPage.goto(`${url}/jobs/${current.job.id}`);
  await expect(jobPage.getByRole("heading", { name: "Maintenance Checklist", exact: true })).toBeVisible();
  await capture(jobPage, info, `technician-checklist-${width}`);
  await jobPage.getByLabel("Acknowledgement", { exact: true }).selectOption("unavailable");
  await jobPage.getByRole("button", { name: "Complete Service", exact: true }).click();
  await expect(jobPage.getByRole("alert")).toContainText("12 unanswered checks");
  const checks = jobPage.locator("[data-service-result]");
  for (let i = 0; i < 12; i++) {
    const outcome = i === 1 ? "Defect" : i === 11 ? "N/A" : "Completed";
    await checks.nth(i).getByRole("button", { name: new RegExp(`^${outcome}:`) }).click();
    await expect(checks.nth(i).getByRole("button", { name: new RegExp(`^${outcome}:`) })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(jobPage.getByRole("button", { name: "Save defect", exact: true })).toBeDisabled();
  await jobPage.getByLabel("Severity for check 2", { exact: true }).selectOption("action_required");
  await jobPage.getByLabel("Defect description for check 2", { exact: true }).fill("Safety beam housing damaged.");
  await jobPage.getByLabel("Recommended action for check 2", { exact: true }).fill("Replace housing and retest.");
  await jobPage.getByRole("checkbox", { name: "Safety beam.png", exact: true }).check();
  await capture(jobPage, info, `defect-editor-${width}`, jobPage.getByLabel("Defect description for check 2", { exact: true }));
  await jobPage.getByRole("button", { name: "Save defect", exact: true }).click();
  await expect.poll(() => report().defects[0]?.description).toBe("Safety beam housing damaged.");
  await jobPage.getByLabel("Technician notes", { exact: true }).fill("System tested at departure. Defect explained to the representative.");
  await jobPage.getByRole("button", { name: "Save service notes", exact: true }).click();
  await expect.poll(() => report().serviceNotes).toContain("System tested at departure");
  await jobPage.getByLabel("Acknowledgement", { exact: true }).selectOption("signed");
  await jobPage.getByLabel("Representative name", { exact: true }).fill("Alex Site Representative");
  const canvas = jobPage.getByRole("img", { name: "Customer signature drawing area", exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await jobPage.mouse.move(box.x + box.width * .1, box.y + box.height * .6); await jobPage.mouse.down();
  await jobPage.mouse.move(box.x + box.width * .3, box.y + box.height * .2, { steps: 10 });
  await jobPage.mouse.move(box.x + box.width * .65, box.y + box.height * .65, { steps: 15 }); await jobPage.mouse.up();
  await capture(jobPage, info, `signature-${width}`, canvas);
  await jobPage.getByRole("button", { name: "Complete Service", exact: true }).click();
  await expect(jobPage.getByRole("heading", { name: "Maintenance Service Report", exact: true })).toBeVisible();
  expect(report().status).toBe("completed"); expect(report().signatureStatus).toBe("signed"); expect(report().counts.defects).toBe(1); expect(report().counts.na).toBe(1);
  await expect(jobPage.getByRole("combobox", { name: "Update job status", exact: true })).toContainText("Completed");
  await expect(jobPage.getByRole("button", { name: "Email Service Report", exact: true })).toHaveCount(0);
  await expect(jobPage.locator("[data-service-result]")).toHaveCount(0);

  await page.goto(`${url}/maintenance/${current.plan.id}`);
  await expect(page.getByRole("heading", { name: "Service History", exact: true })).toBeVisible();
  const history = page.getByRole("heading", { name: "Service History", exact: true }).locator("xpath=ancestor::section[1]");
  await expect(history).toContainText("Customer signed");
  await capture(page, info, `service-history-${width}`, history);
  await history.getByRole("button", { name: "View Report", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/maintenance-reports/${report().id}$`));
  await page.getByRole("button", { name: "View Report", exact: true }).click();
  await expect(page.locator("[data-maintenance-report-preview]")).toContainText("Safety beam housing damaged.");
  await capture(page, info, `report-preview-${width}`);
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloadEvent; expect(download.suggestedFilename()).toMatch(/^maintenance-service-job-/);
  await page.getByRole("button", { name: "Email Service Report", exact: true }).click();
  const form = page.getByRole("form", { name: "Email service report", exact: true });
  await expect(form.getByLabel("Subject", { exact: true })).toHaveValue(/ELSET Maintenance Service Report/);
  await expect(form.getByLabel("Message", { exact: true })).toHaveValue(/defects requiring attention/);
  await form.getByLabel("To", { exact: true }).fill("second@example.test"); await form.getByRole("button", { name: "Add To recipients", exact: true }).click();
  await form.getByLabel("CC", { exact: true }).fill("office@example.test"); await form.getByRole("button", { name: "Add CC recipients", exact: true }).click();
  await form.getByText("BCC (optional)", { exact: true }).click(); await form.getByLabel("BCC", { exact: true }).fill("private@example.test"); await form.getByRole("button", { name: "Add BCC recipients", exact: true }).click();
  await form.getByLabel("Subject", { exact: true }).fill("Edited service report subject"); await form.getByLabel("Message", { exact: true }).fill("Edited service report message");
  await capture(page, info, `send-composer-${width}`, form);
  let sent;
  await page.route("**/api/maintenance-service-reports/*/send", route => {
    sent = route.request().postDataJSON().email;
    return route.fulfill({ status: 200, json: { ok: true, historySaved: false, acceptedRecipients: [sent.to[0]], rejectedRecipients: [sent.to[1]], unconfirmedRecipients: [...sent.cc, ...sent.bcc],
      warning: "Email was accepted, but its send history could not be saved. Do not resend to recreate history." } });
  });
  await form.getByRole("button", { name: "Send Service Report", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Email accepted" })).toContainText("Do not resend");
  expect(sent.to).toHaveLength(2); expect(sent.cc).toEqual(["office@example.test"]); expect(sent.bcc).toEqual(["private@example.test"]); expect(sent.subject).toBe("Edited service report subject");
  await expect(form).toHaveCount(0);
  await tech.context.close(); await admin.context.close();
});

test("disabled execution stays hidden while completed archived reports remain readable", async ({ browser }) => {
  const db = openWorkspaceDb({ dbPath: path.join(directory, "elset-workspace.db") });
  try {
    let saved = getMaintenanceServiceReport(db, current.job.id);
    for (const item of saved.items) saved = updateMaintenanceServiceResult(db, current.job.id, item.id, { revision: saved.revision, result: "completed" }, actor);
    await completeMaintenanceService(db, current.job.id, { revision: saved.revision, signatureStatus: "declined" }, actor);
    deleteJob(db, current.job.id); updateWorkspaceAddons(db, { maintenanceChecklists: false });
  } finally { db.close(); }
  const admin = await login(browser, 390);
  await admin.page.goto(`${url}/maintenance-reports/${report().id}`);
  await expect(admin.page.getByRole("heading", { name: "Maintenance Service Report", exact: true })).toBeVisible();
  await expect(admin.page.getByRole("button", { name: "Email Service Report", exact: true })).toHaveCount(0);
  await admin.page.getByRole("button", { name: "View Report", exact: true }).click();
  await expect(admin.page.locator("[data-maintenance-report-preview]")).toContainText("Customer declined signature");
  await admin.page.goto(`${url}/maintenance-reports`);
  await expect(admin.page.getByLabel("Completed service reports", { exact: true })).toContainText(`Job #${current.job.jobNumber}`);
  await admin.page.goto(`${url}/maintenance/${current.plan.id}/edit`);
  await expect(admin.page.getByLabel("One item per line")).toBeVisible();
  await expect(admin.page.getByText("10 standard checks · locked", { exact: true })).toHaveCount(0);
  await admin.context.close();
});

test("maintenance add-on details, explicit Save and disable preserve the job snapshot", async ({ browser }, info) => {
  const original = report();
  dbRead(db => updateWorkspaceAddons(db, { maintenanceChecklists: false }));
  const admin = await login(browser, 390), page = admin.page;
  await page.goto(`${url}/settings`);
  await page.locator("[data-settings-navigation]").getByRole("button", { name: "Add-ons", exact: true }).click();
  const card = page.locator('[data-addon="maintenanceChecklists"]');
  const toggle = card.getByRole("switch", { name: "Maintenance Checklists & Reports enabled", exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await card.getByRole("button", { name: "About Maintenance Checklists & Reports", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Maintenance Checklists & Reports", exact: true });
  await expect(details).toContainText("Defect photos");
  await expect(details).toContainText("Service report email history");
  await details.getByRole("button", { name: "Done", exact: true }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(dbRead(db => getWorkspaceAddons(db).maintenanceChecklists)).toBe(false);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  expect(dbRead(db => getWorkspaceAddons(db).maintenanceChecklists)).toBe(true);
  await capture(page, info, "maintenance-addons-390");
  await toggle.click();
  const disable = page.getByRole("dialog", { name: "Disable Maintenance Checklists & Reports?", exact: true });
  await expect(disable).toContainText("preserved");
  await disable.getByRole("button", { name: "Disable", exact: true }).click();
  expect(report().id).toBe(original.id);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  expect(dbRead(db => getWorkspaceAddons(db).maintenanceChecklists)).toBe(false);
  await page.goto(`${url}/jobs/${current.job.id}`);
  await expect(page.getByRole("heading", { name: "Maintenance Checklist", exact: true })).toHaveCount(0);
  expect(report().id).toBe(original.id);
  await admin.context.close();
});
