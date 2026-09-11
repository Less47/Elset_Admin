import { test, expect, chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeStoredData } from '../../server-store.js';
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";
import { readPdfTextRuns } from "../helpers/pdf-text.js";
import { getDocumentRecipientEmail } from "../../src/lib/quote-template.js";
import { themePresets } from "../../src/lib/theme-presets.js";

import { insertJobTree } from "../../server-workspace-jobs.js";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "fixtures/demo-workspace.json");
const screenshotDir = path.join(repoRoot, "test-results/document-workspaces");
const accountPassword = "E2E-document-pass-123";
const storageMode = process.env.ELSET_DOCUMENT_E2E_STORAGE || "sqlite";
let tempDataDir = "";
let baseUrl = "";
let serverProcess = null;
let serverOutput = "";
let mailServer, mailPort;
const messages = [];
let holdMail = false;
let rejectMail = false;
const pendingMail = [];
function releaseMail() {
  holdMail = false;
  pendingMail.splice(0).forEach((complete) => complete());
}

async function startMailSink() {
  mailServer = net.createServer((socket) => {
    let buffer = "", receiving = false, message = "";
    socket.write("220 localhost test mail sink\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (receiving) {
          if (line === ".") {
            const email = message;
            message = ""; receiving = false;
            const complete = () => {
              if (rejectMail) socket.write("550 PRIVATE provider rejection details\r\n");
              else { messages.push(email); socket.write("250 captured locally\r\n"); }
            };
            if (holdMail) pendingMail.push(complete);
            else complete();
          }
          else message += line.replace(/^\.\./, ".") + "\r\n";
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 25000000\r\n");
        else if (/^AUTH/.test(line)) socket.write("235 authenticated\r\n");
        else if (line === "DATA") { receiving = true; socket.write("354 end with dot\r\n"); }
        else if (line === "QUIT") { socket.end("221 goodbye\r\n"); }
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise((resolve) => mailServer.listen(0, "127.0.0.1", resolve));
  mailPort = mailServer.address().port;
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
  if (storageMode === "json") return normalizeStoredData(JSON.parse(fs.readFileSync(path.join(tempDataDir, "app-data.json"), "utf8")));
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
      ELSET_WORKSPACE_STORAGE: storageMode,
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
    ELSET_WORKSPACE_STORAGE: storageMode,
    FLY_APP_NAME: "",
    NODE_ENV: "test",
    PORT: String(port),
    TZ: "Australia/Sydney",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(mailPort),
    SMTP_SECURE: "false",
    SMTP_USER: "local-document-test",
    SMTP_PASS: "local-document-test",
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



const EXISTING_JOB = 'demo-job-1001';
const NEW_JOB = 'document-new';
function documentFixture() {
  const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
  const original=fixture.jobs.find(job=>job.id===EXISTING_JOB);
  const customer = fixture.customers.find((entry) => entry.id === original.customerId);
  customer.sites[0].ocNumber = "222222";
  customer.address = "1 Primary Site Road, Sampleton VIC 3000";
  customer.sites.unshift({ id: "document-site-a", address: customer.address, ocNumber: "111111" });
  fixture.jobs=[original,{...original,id:NEW_JOB,jobNumber:1200,title:'Document creation test',notes:[],photos:[],quote:null,invoice:null}];
  return fixture;
}
test.beforeAll(async()=>{
  tempDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'elset-document-playwright-'));
  fs.mkdirSync(screenshotDir,{recursive:true});
  if (storageMode === "json") fs.writeFileSync(path.join(tempDataDir, "app-data.json"), JSON.stringify(normalizeStoredData(documentFixture())));
  else {
    const db=openWorkspaceDb({dbPath:path.join(tempDataDir,'elset-workspace.db')});
    try { importWorkspaceJsonData(db,documentFixture()); } finally { db.close(); }
  }
  await seedLoginAccounts();
  await startMailSink();
  await startServer();
});
test.beforeEach(()=>{
  rejectMail = false;
  releaseMail();
  if (storageMode === "json") { fs.writeFileSync(path.join(tempDataDir, "app-data.json"), JSON.stringify(normalizeStoredData(documentFixture()))); return; }
  const db=openWorkspaceDb({dbPath:path.join(tempDataDir,'elset-workspace.db')});
  try {
    db.exec("DELETE FROM deleted_invoices");
    const clean=normalizeStoredData(documentFixture());
    for(const job of clean.jobs){db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);insertJobTree(db,job);}
  }finally{db.close();}
});
test.afterAll(async()=>{
  await stopServer();
  await new Promise((resolve) => mailServer.close(resolve));
  const target=path.resolve(tempDataDir);
  if(target.startsWith(path.join(os.tmpdir(),'elset-document-playwright-')))fs.rmSync(target,{recursive:true,force:true});
});
async function openWorkspace(browser, {width=1440,height=900,jobId=EXISTING_JOB,type='quote',username='mobileadmin',preset=null}={}) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1280,isMobile:width<768,locale:'en-AU',timezoneId:'Australia/Sydney',reducedMotion:'reduce'});
  const page=await context.newPage();
  if (preset) await page.route("**/api/user-preferences", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, preferences: { ...payload.preferences, ...preset.values } } });
  });
  const writes=[];
  page.on('request',req=>{const url=new URL(req.url()); if(url.pathname.startsWith('/api/')&&['POST','PUT','PATCH','DELETE'].includes(req.method())&&!url.pathname.startsWith('/api/auth/'))writes.push({path:url.pathname,method:req.method(),body:req.postDataJSON()});});
  await page.goto(baseUrl+'/jobs/'+jobId+'/'+type);
  await page.getByPlaceholder('Enter your username').fill(username);
  await page.getByPlaceholder('Enter your password').fill(accountPassword);
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.locator('.record-workspace')).toBeVisible();
  return {context,page,writes};
}
const editor=page=>page.locator('[data-document-workspace]');
const dbJob=id=>readWorkspaceState().jobs.find(job=>job.id===id);
function prepareDeletionInvoice({ sent = false, receipt = false, payments = [] } = {}) {
  const state = readWorkspaceState();
  const job = state.jobs.find((entry) => entry.id === EXISTING_JOB);
  job.invoice = { ...job.invoice, payments, paidAmount: 0, paymentStatus: "unpaid", sentHistory: sent || receipt ? [{ id: "delete-sent", sentAt: "2026-09-01T00:00:00.000Z", toEmail: job.customerEmail, subject: "Original invoice", messageId: "local-original", emailPurpose: receipt ? "paid-receipt" : "invoice", documentSnapshot: { items: job.invoice.items, payments: [] }, jobSnapshot: { id: job.id, title: job.title, siteSnapshot: { ocNumber: "222222" } }, templateSnapshot: { companyName: "Original Company" } }] : [] };
  if (storageMode === "json") fs.writeFileSync(path.join(tempDataDir, "app-data.json"), JSON.stringify(normalizeStoredData(state)));
  else {
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try { db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id); insertJobTree(db, job); } finally { db.close(); }
  }
  return dbJob(EXISTING_JOB);
}
async function navigateSection(page, label) {
  if (page.viewportSize().width < 1024) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: label, exact: true }).click();
}

for (const scenario of [{ width: 1440, height: 900, sent: false, username: "mobileadmin" }, { width: 390, height: 844, sent: true, username: "mobileoffice" }]) {
  test(`invoice deletion ${scenario.sent ? "sent mobile office" : "unsent desktop admin"} cancels, deletes once and restores`, async ({ browser }, info) => {
    const original = prepareDeletionInvoice(scenario);
    const { page, context, writes } = await openWorkspace(browser, { ...scenario, type: "invoice" });
    try {
      await page.getByRole("button", { name: "Delete Invoice", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: scenario.sent ? "Delete sent invoice?" : "Delete invoice?", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      if (scenario.sent) await expect(dialog).toContainText("Deleting it will not remove the customer's copy.");
      else await expect(dialog).not.toContainText("already been sent");
      await capture(page, info, `invoice-delete-${storageMode}-${scenario.width}`, false);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(dbJob(EXISTING_JOB)).toEqual(original);
      expect(writes).toEqual([]);
      await page.getByLabel("Work completed", { exact: true }).fill("Unsaved edits to discard");
      await page.getByRole("button", { name: "Delete Invoice", exact: true }).click();
      await expect(dialog).toContainText("Unsaved edits will be discarded.");
      await dialog.getByRole("button", { name: scenario.sent ? "Delete Sent Invoice" : "Delete Invoice", exact: true }).evaluate((button) => { button.click(); button.click(); });
      await expect(page.getByRole("status").filter({ hasText: "Invoice moved to Recycle Bin" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: scenario.width < 1280 ? "Search invoices" : "Search billing records", exact: true })).toBeVisible();
      await noModalOrOverflow(page);
      expect(writes.filter((entry) => entry.method === "DELETE")).toHaveLength(1);
      expect(dbJob(EXISTING_JOB)).toEqual({ ...original, invoice: null, updatedAt: expect.any(String), ...(storageMode === "json" ? { invoiceArchiveRevision: expect.any(String) } : {}) });
      await expect(page.locator(".data-grid-row:visible, [data-mobile-record-card]").filter({ hasText: "#1001" })).toHaveCount(0);
      const [archive] = readWorkspaceState().deletedInvoices;
      expect(archive.invoice).toEqual(original.invoice);
      await navigateSection(page, "Recycle Bin");
      await page.getByRole("tab", { name: "Invoices", exact: true }).click();
      await expect(page.getByText("INV-1001", { exact: true })).toBeVisible();
      await expect(page.getByText(original.customerName, { exact: true })).toBeVisible();
      await expect(page.getByText("Amount", { exact: true })).toBeVisible();
      await capture(page, info, `invoice-recycle-${storageMode}-${scenario.width}`, false);
      await page.getByRole("button", { name: "Restore Invoice", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Invoice restored" })).toBeVisible();
      expect(dbJob(EXISTING_JOB).invoice).toEqual(original.invoice);
      expect(readWorkspaceState().deletedInvoices).toEqual([]);
      await navigateSection(page, "Invoices");
      await expect(page.locator(".data-grid-row:visible, [data-mobile-record-card]").filter({ hasText: "#1001" })).toHaveCount(1);
    } finally { await context.close(); }
  });
}

test("invoice deletion pending and failed requests keep the editor open and allow retry", async ({ browser }) => {
  const original = prepareDeletionInvoice();
  const { page, context, writes } = await openWorkspace(browser, { type: "invoice" });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route(`**/api/jobs/${EXISTING_JOB}/invoice`, async (route) => {
    if (route.request().method() !== "DELETE" || ++attempts > 1) return route.continue();
    await pending;
    await route.fulfill({ status: 500, json: { error: "PRIVATE database credentials" } });
  });
  try {
    await page.getByRole("button", { name: "Delete Invoice", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Delete Invoice", exact: true }).evaluate((button) => { button.click(); button.click(); });
    await expect(dialog.getByRole("button", { name: "Deleting...", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(writes.filter((entry) => entry.method === "DELETE")).toHaveLength(1);
    release();
    await expect(dialog.getByRole("alert")).toContainText("Unable to update the invoice. Please try again.");
    await expect(dialog).not.toContainText("PRIVATE");
    expect(dbJob(EXISTING_JOB)).toEqual(original);
    await expect(page).toHaveURL(`${baseUrl}/jobs/${EXISTING_JOB}/invoice`);
    await dialog.getByRole("button", { name: "Delete Invoice", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Invoice moved to Recycle Bin" })).toBeVisible();
    expect(writes.filter((entry) => entry.method === "DELETE")).toHaveLength(2);
  } finally { release(); await context.close(); }
});

for (const receipt of [false, true]) test(`invoice deletion blocks ${receipt ? "receipt history" : "recorded payments"} in editor and API`, async ({ browser }) => {
  const original = prepareDeletionInvoice({ receipt, payments: receipt ? [] : [{ id: "deposit", amount: 20, date: "2026-09-01" }] });
  const { page, context } = await openWorkspace(browser, { type: "invoice" });
  try {
    await expect(page.getByRole("button", { name: "Delete Invoice", exact: true })).toBeDisabled();
    await expect(page.locator("#document-delete-help")).toContainText(receipt ? "payment receipt history" : "recorded payments");
    const response = await page.request.delete(`${baseUrl}/api/jobs/${EXISTING_JOB}/invoice`, { data: { confirmSent: true } });
    expect(response.status()).toBe(409);
    expect(dbJob(EXISTING_JOB)).toEqual(original);
    expect(readWorkspaceState().deletedInvoices).toEqual([]);
  } finally { await context.close(); }
});

test("invoice deletion upgrades confirmation when send history changes while the dialog is open", async ({ browser }) => {
  prepareDeletionInvoice();
  const { page, context } = await openWorkspace(browser, { type: "invoice" });
  try {
    await page.getByRole("button", { name: "Delete Invoice", exact: true }).click();
    const original = prepareDeletionInvoice({ sent: true });
    await page.getByRole("dialog").getByRole("button", { name: "Delete Invoice", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete sent invoice?", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Deleting it will not remove the customer's copy.");
    expect(dbJob(EXISTING_JOB)).toEqual(original);
    await dialog.getByRole("button", { name: "Delete Sent Invoice", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Invoice moved to Recycle Bin" })).toBeVisible();
    expect(readWorkspaceState().deletedInvoices[0].invoice.sentHistory).toEqual(original.invoice.sentHistory);
  } finally { await context.close(); }
});

test("invoice deletion is unavailable to technicians and unauthenticated requests", async ({ browser }) => {
  prepareDeletionInvoice();
  const { page, context } = await openWorkspace(browser, { type: "invoice", username: "mobiletech" });
  try {
    await expect(page.getByText("You do not have permission to edit this document.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Invoice", exact: true })).toHaveCount(0);
    expect((await page.request.delete(`${baseUrl}/api/jobs/${EXISTING_JOB}/invoice`)).status()).toBe(403);
    expect((await page.request.post(`${baseUrl}/api/deleted-invoices/missing/restore`)).status()).toBe(403);
    const stateResponse = await page.request.get(`${baseUrl}/api/app-state`);
    expect((await stateResponse.json()).state.deletedInvoices).toEqual([]);
    expect((await fetch(`${baseUrl}/api/jobs/${EXISTING_JOB}/invoice`, { method: "DELETE" })).status).toBe(401);
    expect(readWorkspaceState().deletedInvoices).toEqual([]);
  } finally { await context.close(); }
});

if (storageMode === "json") test("invoice deletion and recovery resist stale JSON autosaves", async ({ browser }) => {
  prepareDeletionInvoice();
  const { page, context } = await openWorkspace(browser, { type: "invoice" });
  try {
    const before = await (await page.request.get(`${baseUrl}/api/app-state`)).json();
    const deletion = await (await page.request.delete(`${baseUrl}/api/jobs/${EXISTING_JOB}/invoice`)).json();
    expect(deletion.ok).toBe(true);
    const staleSave = await page.request.put(`${baseUrl}/api/app-state`, { data: before.state });
    expect(staleSave.ok()).toBe(true);
    expect(dbJob(EXISTING_JOB).invoice).toBeNull();
    expect(readWorkspaceState().deletedInvoices).toHaveLength(1);
    const restored = await page.request.post(`${baseUrl}/api/deleted-invoices/${deletion.result.archiveId}/restore`);
    expect(restored.ok()).toBe(true);
    await page.request.put(`${baseUrl}/api/app-state`, { data: deletion.state });
    expect(dbJob(EXISTING_JOB).invoice).not.toBeNull();
    expect(readWorkspaceState().deletedInvoices).toEqual([]);
  } finally { await context.close(); }
});

for (const preset of themePresets) test(`invoice deletion dialog follows ${preset.label} on desktop and mobile`, async ({ browser }, info) => {
  prepareDeletionInvoice({ sent: true });
  for (const width of [1440, 390]) {
    const { page, context } = await openWorkspace(browser, { type: "invoice", width, height: width === 390 ? 844 : 900, preset });
    try {
      await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"))).toBe(preset.values.actionColor);
      await page.getByRole("button", { name: "Delete Invoice", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete sent invoice?", exact: true });
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(15);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 15);
      expect(bounds.height).toBeLessThan(400);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const colors = await dialog.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
      expect(colors.background).not.toBe(colors.color);
      await capture(page, info, `invoice-delete-theme-${preset.id}-${width}`, false);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally { await context.close(); }
  }
});
const save=async(page,type)=>{await page.getByRole('button',{name:'Save '+(type==='quote'?'Quote':'Invoice'),exact:true}).click();await expect(editor(page).locator('.document-feedback')).toHaveText('Saved');};
async function noModalOrOverflow(page){
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>getComputedStyle(document.body).pointerEvents)).not.toBe('none');
}
async function capture(page,info,name,fullPage=true){
  const body=await page.screenshot({path:path.join(screenshotDir,name+'.png'),fullPage});
  await info.attach(name,{body,contentType:'image/png'});
}

for (const type of ["quote", "invoice"]) {
  const label = type === "quote" ? "Quote" : "Invoice";
  test(`new ${type} uses a page, saves exact totals and reloads without duplicate records`, async ({ browser }, info) => {
    const { context, page, writes } = await openWorkspace(browser, { jobId: NEW_JOB, type });
    try {
      await expect(page.getByRole("heading", { name: `New ${label}`, exact: true })).toBeVisible();
      await noModalOrOverflow(page);
      expect(dbJob(NEW_JOB)[type]).toBeNull();
      expect(writes).toEqual([]);
      await page.getByLabel("Item 1 description", { exact: true }).fill("Motor replacement");
      await page.getByLabel("Item 1 quantity", { exact: true }).fill("2.5");
      await page.getByLabel("Item 1 rate", { exact: true }).fill("120");
      await page.getByRole("button", { name: "Add Item", exact: true }).click();
      await page.getByLabel("Item 2 description", { exact: true }).fill("Travel");
      await page.getByLabel("Item 2 rate", { exact: true }).fill("50");
      await page.getByRole("button", { name: "Add Item", exact: true }).click();
      await page.getByRole("button", { name: "Remove item 3", exact: true }).click();
      await expect(page.locator("[data-document-subtotal]")).toHaveText("$350.00");
      await expect(page.locator("[data-document-gst]")).toHaveText("$35.00");
      await expect(page.locator("[data-document-total]")).toHaveText("$385.00");
      await page.getByLabel(type === "quote" ? "Scope / notes" : "Work completed", { exact: true }).fill("Saved document workspace notes");
      await save(page, type);
      await expect(editor(page)).toHaveAttribute("data-document-mode", "edit");
      await expect(page.getByRole("heading", { name: `${label} ${type === "quote" ? "QT" : "INV"}-1200`, exact: true })).toBeVisible();
      expect(writes.map(({ path, method }) => ({ path, method }))).toEqual([{ path: `/api/jobs/${NEW_JOB}/${type}`, method: "PUT" }]);
      const saved = dbJob(NEW_JOB)[type];
      expect(saved.items).toHaveLength(2);
      expect(saved.notes).toBe("Saved document workspace notes");
      await page.reload();
      await expect(page.getByLabel("Item 1 description", { exact: true })).toHaveValue("Motor replacement");
      await expect(page.locator("[data-document-total]")).toHaveText("$385.00");
      const pdfResponse = page.waitForResponse((r) => r.url().endsWith("/api/quotes/preview-pdf"));
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      const response = await pdfResponse;
      expect(response.status()).toBe(200);
      const frame = page.getByTitle(`${label} PDF preview`);
      await expect(frame).toBeVisible();
      // Inspect the exact blob handed to the viewer; Chromium may omit PDF
      // bodies from its network instrumentation when its PDF viewer takes over.
      const pdf = Buffer.from(await frame.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer()))));
      fs.writeFileSync(path.join(screenshotDir, `new-${type}-preview.pdf`), pdf);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
      const recipientText = (await readPdfTextRuns(pdf)).flat().map((run) => run.text);
      expect(recipientText.includes("OC: 222222")).toBe(type === "invoice");
      expect(recipientText.includes("OC: 111111")).toBe(false);
      await expect(page.getByRole("heading", { name: `Preview ${label}`, exact: true })).toBeVisible();
      await noModalOrOverflow(page);
      await capture(page, info, `${type}-preview-1440x900`);
      await page.getByRole("button", { name: `Back to ${label} editor`, exact: true }).click();
      await page.getByRole("button", { name: "Back to Job #1200", exact: true }).click();
      await expect(page).toHaveURL(`${baseUrl}/jobs/${NEW_JOB}`);
      expect(dbJob(NEW_JOB)[type]).toEqual(saved);
    } finally { await context.close(); }
  });

  test(`existing ${type} preserves record fields, payments and sent history on edit`, async ({ browser }) => {
    const before = dbJob(EXISTING_JOB);
    const { context, page, writes } = await openWorkspace(browser, { type });
    try {
      await expect(page.getByLabel("Issue date", { exact: true })).toHaveValue(before[type].issueDate);
      await expect(page.getByLabel("Item 1 description", { exact: true })).toHaveValue(before[type].items[0].description);
      const notes = type === "quote" ? "Scope / notes" : "Work completed";
      await page.getByLabel(notes, { exact: true }).fill("Edited through full page");
      await save(page, type);
      const after = dbJob(EXISTING_JOB);
      expect(after[type].notes).toBe("Edited through full page");
      expect({ ...after[type], notes: before[type].notes }).toEqual(before[type]);
      const unrelated = (job) => { const { [type]: document, updatedAt, ...rest } = job; return rest; };
      expect(unrelated(after)).toEqual(unrelated(before));
      expect(writes.map((write) => write.path)).toEqual([`/api/jobs/${EXISTING_JOB}/${type}`]);
      await page.reload();
      await expect(page.getByLabel(notes, { exact: true })).toHaveValue("Edited through full page");
      await noModalOrOverflow(page);
    } finally { await context.close(); }
  });
}

test("document workspaces fit all eight requested viewports with usable line items and totals", async ({ browser }, info) => {
  for (const [width, height] of [[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1280,720],[1440,900],[1920,1080]]) {
    for (const type of ["quote", "invoice"]) {
      const { context, page, writes } = await openWorkspace(browser, { width, height, type });
      try {
        await noModalOrOverflow(page);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(type === "quote" ? "Quote" : "Invoice");
        await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
        for (const field of ["Item 1 description", "Item 1 quantity", "Item 1 rate"]) {
          const input = page.getByLabel(field, { exact: true });
          const bounds = await input.boundingBox();
          expect(bounds.width).toBeGreaterThan(40);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        }
        const row = await page.locator("[data-document-item]").first().boundingBox();
        if (width >= 768) expect(row.height).toBeLessThanOrEqual(width < 1280 ? 60 : 50);
        await page.locator("[data-document-total]").scrollIntoViewIfNeeded();
        await expect(page.locator("[data-document-total]")).toBeInViewport();
        await expect(page.getByRole("button", { name: /^Save (Quote|Invoice)$/, exact: true })).toBeInViewport();
        await page.evaluate(() => window.scrollTo(0, 0));
        await capture(page, info, `${type}-${width}x${height}`);
        expect(writes).toEqual([]);
      } finally { await context.close(); }
    }
  }
});

test("job entry points, Back, Forward and dirty-draft navigation preserve real history on desktop and mobile", async ({ browser }) => {
  for (const width of [390, 1440]) {
    const { context, page } = await openWorkspace(browser, { width, height: 900, jobId: NEW_JOB });
    try {
      await page.getByRole("button", { name: "Back to Job #1200", exact: true }).click();
      await page.getByRole("tab", { name: "Documents", exact: true }).click();
      for (const type of ["quote", "invoice"]) {
        await page.getByRole("button", { name: `Open ${type === "quote" ? "Quote" : "Invoice"} Editor`, exact: true }).click();
        await expect(page).toHaveURL(`${baseUrl}/jobs/${NEW_JOB}/${type}`);
        await noModalOrOverflow(page);
        await page.goBack();
        await expect(page).toHaveURL(`${baseUrl}/jobs/${NEW_JOB}`);
        await page.goForward();
        await expect(editor(page)).toHaveAttribute("data-document-workspace", type);
        const field = page.getByLabel(type === "quote" ? "Scope / notes" : "Work completed", { exact: true });
        await field.fill("Do not lose this draft");
        await page.goBack();
        const prompt = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
        await expect(prompt).toBeVisible();
        await expect(page).toHaveURL(`${baseUrl}/jobs/${NEW_JOB}/${type}`);
        await prompt.getByRole("button", { name: "Keep editing", exact: true }).click();
        await expect(field).toHaveValue("Do not lose this draft");
        await page.goBack();
        await prompt.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(page).toHaveURL(`${baseUrl}/jobs/${NEW_JOB}`);
        await page.goForward();
        await expect(field).toHaveValue("");
        await page.getByRole("button", { name: "Back to Job #1200", exact: true }).click();
        await page.getByRole("tab", { name: "Documents", exact: true }).click();
      }
    } finally { await context.close(); }
  }
});

test("Invoices create and edit actions keep their origin through refresh and history", async ({ browser }) => {
  for (const width of [390, 1440]) {
    const { context, page } = await openWorkspace(browser, { width, height: 900 });
    try {
      if (width < 1024) {
        await page.getByRole("button", { name: "Back to Job #1001", exact: true }).click();
        await page.getByRole("button", { name: "Back to Service Board", exact: true }).click();
        await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      }
      await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Invoices", exact: true }).click();
      await expect(page).toHaveURL(baseUrl + "/");
      const row = width < 768 ? page.locator(`[data-mobile-record-card][data-record-id="${NEW_JOB}"]`) : page.locator(".data-grid-row", { hasText: "Job #1200" });
      const exists = Boolean(dbJob(NEW_JOB).invoice);
      await row.getByRole("button", { name: width < 768 ? `${exists ? "Open invoice editor" : "Create invoice"} for Job #1200` : exists ? "Editor" : "Create", exact: true }).click();
      await expect(editor(page)).toHaveAttribute("data-document-mode", exists ? "edit" : "create");
      await save(page, "invoice");
      await page.reload();
      await page.getByRole("button", { name: "Back to Invoices", exact: true }).click();
      await expect(page).toHaveURL(baseUrl + "/");
      await expect(row).toBeVisible();
      await page.goForward();
      await expect(editor(page)).toHaveAttribute("data-document-mode", "edit");
      await page.getByLabel("Work completed", { exact: true }).fill("Sidebar draft");
      if (width < 1024) await page.getByRole("button", { name: "Back to Invoices", exact: true }).click();
      else await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Customers", exact: true }).click();
      await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard", exact: true }).click();
      await expect(page).toHaveURL(baseUrl + (width < 1024 ? "/" : "/customers"));
      if (width < 1024) await expect(row).toBeVisible();
      else {
        await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
        await page.goBack();
        await expect(editor(page)).toBeVisible();
        await page.getByLabel("Work completed", { exact: true }).fill("Forward draft");
        await page.goForward();
        const prompt = page.getByRole("dialog", { name: "Discard unsaved changes?" });
        await expect(page).toHaveURL(`${baseUrl}/jobs/${NEW_JOB}/invoice`);
        await prompt.getByRole("button", { name: "Keep editing", exact: true }).click();
        await expect(page.getByLabel("Work completed", { exact: true })).toHaveValue("Forward draft");
        await page.goForward();
        await prompt.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
      }
    } finally { await context.close(); }
  }
});

test("failed and pending saves retain the draft and prevent duplicate document writes", async ({ browser }) => {
  const { context, page, writes } = await openWorkspace(browser, { type: "invoice" });
  const before = dbJob(EXISTING_JOB).invoice;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await page.route(`**/api/jobs/${EXISTING_JOB}/invoice`, async (route) => { await gate; await route.fulfill({ status: 409, json: { error: "Synthetic document conflict" } }); });
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Work completed", { exact: true }).fill("Keep after failure");
    await page.getByRole("button", { name: "Save Invoice", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Work completed", { exact: true })).toBeDisabled();
    expect(dbJob(EXISTING_JOB).invoice).toEqual(before);
    release();
    await expect(page.getByRole("alert")).toContainText("Your changes are still here");
    await expect(page.getByLabel("Work completed", { exact: true })).toHaveValue("Keep after failure");
    expect(writes).toHaveLength(1);
    expect(dbJob(EXISTING_JOB).invoice).toEqual(before);
    await page.unroute(`**/api/jobs/${EXISTING_JOB}/invoice`);
    await save(page, "invoice");
  } finally { release(); await context.close(); }
});

test("quote and invoice sends use actual server PDFs captured only by the local mail sink", async ({ browser }) => {
  for (const type of ["quote", "invoice"]) {
    const { context, page, writes } = await openWorkspace(browser, { type });
    try {
      const before = dbJob(EXISTING_JOB)[type];
      const mailCount = messages.length;
      await page.getByRole("button", { name: /^Preview & Send/ }).click();
      await expect(page.locator("[data-document-preview]")).toBeVisible();
      const frame = page.getByTitle(`${type === "invoice" ? "Invoice" : "Quote"} PDF preview`);
      const previewPdf = Buffer.from(await frame.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer()))));
      const previewRuns = await readPdfTextRuns(previewPdf);
      expect(previewRuns.flat().some((run) => run.text === "OC: 222222")).toBe(type === "invoice");
      expect(previewRuns.flat().some((run) => run.text === "OC: 111111")).toBe(false);
      await page.getByRole("button", { name: /^Confirm & Send/ }).click();
      await expect(page.locator('[data-document-send-status="success"]')).toContainText(`${type === "invoice" ? "Invoice" : "Quote"} emailed successfully to:`);
      await expect(page.locator('[data-document-send-status="success"]')).toContainText(getDocumentRecipientEmail(dbJob(EXISTING_JOB)));
      await expect(page.locator("[data-document-preview]")).toHaveCount(0);
      expect(messages).toHaveLength(mailCount + 1);
      const email = messages.at(-1);
      expect(email).toContain("Content-Type: application/pdf");
      const attachment = email.split(/\r\n--/).find((part) => part.includes("Content-Type: application/pdf"));
      const pdf = Buffer.from(attachment.slice(attachment.indexOf("\r\n\r\n") + 4).trim(), "base64");
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
      expect(await readPdfTextRuns(pdf)).toEqual(previewRuns);
      fs.writeFileSync(path.join(screenshotDir, `${type}-email-attachment.pdf`), pdf);
      expect(dbJob(EXISTING_JOB)[type].sentHistory).toHaveLength(before.sentHistory.length + 1);
      if (type === "invoice") {
        expect(dbJob(EXISTING_JOB).invoice.payments).toEqual(before.payments);
        expect(dbJob(EXISTING_JOB).invoice.sentHistory.at(-1).jobSnapshot.siteSnapshot).toMatchObject({ id: "demo-site-front-entry", ocNumber: "222222" });
      }
      expect(writes.some((write) => write.path === "/api/app-state")).toBe(false);
      const send = writes.find((write) => write.path === "/api/documents/send");
      expect(send.body.documentType).toBe(type);
      expect(send.body.job.id).toBe(EXISTING_JOB);
      expect(send.body.template).toBeTruthy();
      await page.reload();
      await expect(editor(page).getByRole("button", { name: type === "quote" ? "Open Quote" : "Open Invoice", exact: true })).toBeVisible();
    } finally { await context.close(); }
  }
});

for (const type of ["quote", "invoice"]) {
  for (const width of [1440, 390]) {
    test(`${type} sending waits for the provider, blocks duplicate clicks and confirms recipient at ${width}px`, async ({ browser }, info) => {
      const { context, page, writes } = await openWorkspace(browser, { type, width, height: width === 390 ? 844 : 900 });
      const before = dbJob(EXISTING_JOB)[type];
      const mailCount = messages.length;
      let responses = 0;
      page.on("response", (response) => { if (response.url().endsWith("/api/documents/send")) responses++; });
      try {
        await page.getByRole("button", { name: /^Preview & Send/ }).click();
        await expect(page.locator("[data-document-preview]")).toBeVisible();
        holdMail = true;
        // Two synchronous DOM clicks exercise the guard before React can rerender.
        await page.getByRole("button", { name: /^Confirm & Send/ }).evaluate((button) => { button.click(); button.click(); });
        await expect(page.getByRole("button", { name: "Sending...", exact: true })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Sending...", exact: true })).toHaveAttribute("aria-busy", "true");
        await expect(page.locator('[data-document-send-status="sending"]')).toContainText(`Sending ${type}...`);
        await expect.poll(() => pendingMail.length).toBe(1);
        await page.waitForTimeout(750);
        expect(responses).toBe(0);
        expect(messages).toHaveLength(mailCount);
        expect(dbJob(EXISTING_JOB)[type]).toEqual(before);
        expect(writes.filter((write) => write.path === "/api/documents/send")).toHaveLength(1);
        await expect(page.locator("[data-document-preview]")).toBeVisible();
        await noModalOrOverflow(page);
        await capture(page, info, `${type}-sending-${width}`, false);
        releaseMail();
        const banner = page.locator('[data-document-send-status="success"]');
        await expect(banner).toContainText(`${type === "invoice" ? "Invoice" : "Quote"} emailed successfully to:`);
        await expect(banner).toContainText(getDocumentRecipientEmail(dbJob(EXISTING_JOB)));
        await expect(banner).toHaveAttribute("role", "status");
        await expect(banner).toBeInViewport();
        await expect(page.locator("[data-document-preview]")).toHaveCount(0);
        expect(responses).toBe(1);
        expect(messages).toHaveLength(mailCount + 1);
        expect(dbJob(EXISTING_JOB)[type].sentHistory).toHaveLength(before.sentHistory.length + 1);
        // The persistent confirmation must remain visible even when the draft is edited.
        await page.getByLabel(type === "quote" ? "Scope / notes" : "Work completed", { exact: true }).fill("Next draft edit");
        await expect(banner).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0));
        await noModalOrOverflow(page);
        await capture(page, info, `${type}-sent-${width}`, false);
      } finally { releaseMail(); await context.close(); }
    });
  }

  test(`${type} provider failure keeps the preview and supports retry without exposing raw errors`, async ({ browser }, info) => {
    const width = type === "quote" ? 390 : 1440;
    const { context, page, writes } = await openWorkspace(browser, { type, width, height: 844 });
    const before = dbJob(EXISTING_JOB)[type];
    const mailCount = messages.length;
    const dialogs = [];
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    try {
      await page.getByRole("button", { name: /^Preview & Send/ }).click();
      rejectMail = true;
      await page.getByRole("button", { name: /^Confirm & Send/ }).click();
      const banner = page.locator('[data-document-send-status="error"]');
      await expect(banner).toHaveAttribute("role", "alert");
      await expect(banner).toContainText(`${type === "invoice" ? "Invoice" : "Quote"} could not be sent. Please try again.`);
      await expect(banner).not.toContainText("PRIVATE");
      await expect(banner).toBeInViewport();
      await expect(page.locator("[data-document-preview]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry Send", exact: true })).toBeEnabled();
      expect(dbJob(EXISTING_JOB)[type]).toEqual(before);
      expect(messages).toHaveLength(mailCount);
      expect(dialogs).toEqual([]);
      await noModalOrOverflow(page);
      await capture(page, info, `${type}-failed-${width}`, false);
      rejectMail = false;
      await page.getByRole("button", { name: "Retry Send", exact: true }).click();
      await expect(page.locator('[data-document-send-status="success"]')).toBeVisible();
      await expect(page.locator("[data-document-preview]")).toHaveCount(0);
      expect(messages).toHaveLength(mailCount + 1);
      expect(writes.filter((write) => write.path === "/api/documents/send")).toHaveLength(2);
      expect(dbJob(EXISTING_JOB)[type].sentHistory).toHaveLength(before.sentHistory.length + 1);
    } finally { rejectMail = false; await context.close(); }
  });

  test(`${type} attachment generation failure keeps the preview and never sends or logs success`, async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, { type });
    const before = dbJob(EXISTING_JOB)[type];
    const mailCount = messages.length;
    try {
      await page.getByRole("button", { name: /^Preview & Send/ }).click();
      await page.route("**/api/documents/send", async (route) => {
        const body = route.request().postDataJSON();
        // Force the actual PDF renderer's unsupported-character failure only at send time.
        body.document.notes = "Unsupported font character: \u{1F600}";
        await route.continue({ postData: JSON.stringify(body) });
      });
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/documents/send"));
      await page.getByRole("button", { name: /^Confirm & Send/ }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(500);
      expect((await response.json()).code).toBe("ATTACHMENT_FAILED");
      await expect(page.locator('[data-document-send-status="error"]')).toContainText(`Could not prepare ${type} attachment.`);
      await expect(page.locator("[data-document-preview]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry Send", exact: true })).toBeEnabled();
      await expect(page.locator('[data-document-send-status="success"]')).toHaveCount(0);
      expect(messages).toHaveLength(mailCount);
      expect(dbJob(EXISTING_JOB)[type]).toEqual(before);
    } finally { await context.close(); }
  });
}

test("an HTTP success without explicit send confirmation never closes the preview or logs success", async ({ browser }) => {
  const { context, page } = await openWorkspace(browser);
  const before = dbJob(EXISTING_JOB).quote;
  try {
    await page.route("**/api/documents/send", (route) => route.fulfill({ status: 200, json: {} }));
    await page.getByRole("button", { name: /^Preview & Send/ }).click();
    await page.getByRole("button", { name: /^Confirm & Send/ }).click();
    await expect(page.locator('[data-document-send-status="error"]')).toContainText("Could not confirm whether the quote was sent. Check before retrying.");
    await expect(page.locator("[data-document-preview]")).toBeVisible();
    expect(dbJob(EXISTING_JOB).quote).toEqual(before);
  } finally { await context.close(); }
});

test("accepted invoice email with failed history persistence shows success plus a warning without a resend prompt", async ({ browser }) => {
  const { context, page } = await openWorkspace(browser, { type: "invoice" });
  const before = dbJob(EXISTING_JOB).invoice;
  const mailCount = messages.length;
  const dialogs = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  try {
    await page.route(`**/api/jobs/${EXISTING_JOB}/invoice/sent-history`, (route) => route.fulfill({ status: 500, json: { error: "PRIVATE database details" } }));
    await page.getByRole("button", { name: /^Preview & Send/ }).click();
    await page.getByRole("button", { name: /^Confirm & Send/ }).click();
    const banner = page.locator('[data-document-send-status="success"]');
    await expect(banner).toContainText("Invoice emailed successfully to:");
    await expect(banner).toContainText("The email was sent, but the send record could not be saved. Do not resend just to update the history.");
    await expect(banner).not.toContainText("PRIVATE");
    await expect(page.locator("[data-document-preview]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry Send", exact: true })).toHaveCount(0);
    expect(dialogs).toEqual([]);
    expect(messages).toHaveLength(mailCount + 1);
    expect(dbJob(EXISTING_JOB).invoice.sentHistory).toEqual(before.sentHistory);
  } finally { await context.close(); }
});

test("invoice previews use current Site OC while old sent copies keep their saved Site data", async ({ browser }) => {
  const { context, page, writes } = await openWorkspace(browser, { type: "invoice" });
  const before = dbJob(EXISTING_JOB);
  try {
    // Save a historical send using the existing JSON snapshot columns, without sending mail.
    const saved = await page.request.post(`${baseUrl}/api/jobs/${EXISTING_JOB}/invoice/sent-history`, { data: { history: {
      id: "site-oc-sent-copy", sentAt: "2026-01-02T00:00:00Z", toEmail: "accounts@example.test",
      jobSnapshot: { ...before, siteSnapshot: { id: "demo-site-front-entry", address: before.jobAddress, ocNumber: "OLD-SITE-OC" } },
      documentSnapshot: before.invoice,
    } } });
    expect(saved.ok()).toBe(true);
    await page.reload();
    await expect(editor(page)).toBeVisible();
    const sentResponse = page.waitForResponse((response) => response.url().endsWith("/api/quotes/preview-pdf"));
    await page.getByRole("button", { name: "Open Invoice", exact: true }).click();
    const sent = await sentResponse;
    expect(sent.status()).toBe(200);
    const sentRequest = sent.request().postDataJSON();
    expect(sentRequest.job.siteSnapshot.ocNumber).toBe("OLD-SITE-OC");
    const copy = await page.request.post(`${baseUrl}/api/quotes/preview-pdf`, { data: sentRequest });
    expect((await readPdfTextRuns(await copy.body())).flat().some((run) => run.text === "OC: OLD-SITE-OC")).toBe(true);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator("[data-document-preview]")).toBeVisible();
    expect(writes.filter((write) => write.path === "/api/quotes/preview-pdf").at(-1).body.job.siteSnapshot.ocNumber).toBe("222222");

    // A legacy send did not record a Site OC, so reopening it must not add today's value.
    await page.getByRole("button", { name: "Back to Invoice editor", exact: true }).click();
    const legacy = await page.request.post(`${baseUrl}/api/jobs/${EXISTING_JOB}/invoice/sent-history`, { data: { history: {
      id: "legacy-no-site-snapshot", sentAt: "2026-01-03T00:00:00Z", toEmail: "accounts@example.test",
      jobSnapshot: before, documentSnapshot: before.invoice,
    } } });
    expect(legacy.ok()).toBe(true);
    await page.reload();
    await expect(editor(page)).toBeVisible();
    const legacyResponse = page.waitForResponse((response) => response.url().endsWith("/api/quotes/preview-pdf"));
    await page.getByRole("button", { name: "Open Invoice", exact: true }).click();
    const legacyRequest = (await legacyResponse).request().postDataJSON();
    expect(legacyRequest.job.siteSnapshot).toBeUndefined();
    const legacyCopy = await page.request.post(`${baseUrl}/api/quotes/preview-pdf`, { data: legacyRequest });
    expect((await readPdfTextRuns(await legacyCopy.body())).flat().some((run) => /^OC:/.test(run.text))).toBe(false);
  } finally { await context.close(); }
});

test("document deep links retain auth and office permissions and reject missing records", async ({ browser }) => {
  for (const username of ["mobileoffice", "mobiletech"]) {
    const { context, page, writes } = await openWorkspace(browser, { type: "invoice", username });
    try {
      if (username === "mobileoffice") await expect(editor(page)).toBeVisible();
      else {
        await expect(page.getByText("You do not have permission to edit this document.")).toBeVisible();
        await expect(editor(page)).toHaveCount(0);
        const response = await page.request.put(`${baseUrl}/api/jobs/${EXISTING_JOB}/invoice`, { data: { invoice: {} } });
        expect(response.status()).toBe(403);
      }
      expect(writes).toEqual([]);
    } finally { await context.close(); }
  }
  const { context, page } = await openWorkspace(browser, { jobId: "missing-document-job" });
  try { await expect(page.getByText("This job could not be found.")).toBeVisible(); await expect(editor(page)).toHaveCount(0); }
  finally { await context.close(); }
});

test("reload and sign-out protect unsaved document edits and reverting the edit clears the warning", async ({ browser }) => {
  const { context, page } = await openWorkspace(browser);
  try {
    const field = page.getByLabel("Scope / notes", { exact: true });
    const original = await field.inputValue();
    await field.fill("Unsaved before reload");
    const dialogPromise = page.waitForEvent("dialog");
    const reloadPromise = page.reload().catch(() => null);
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await reloadPromise;
    await expect(field).toHaveValue("Unsaved before reload");
    await page.getByRole("button", { name: "Sign Out", exact: true }).click();
    const prompt = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await prompt.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(field).toHaveValue("Unsaved before reload");
    await field.fill(original);
    const quantity = page.getByLabel("Item 1 quantity", { exact: true });
    await quantity.fill(await quantity.inputValue());
    const rate = page.getByLabel("Item 1 rate", { exact: true });
    await rate.fill(await rate.inputValue());
    await page.getByRole("button", { name: "Back to Job #1001", exact: true }).click();
    await expect(page).toHaveURL(`${baseUrl}/jobs/${EXISTING_JOB}`);
    await expect(prompt).toHaveCount(0);
  } finally { await context.close(); }
});

test("phone receipt preview keeps the draft and send actions within the page", async ({}, info) => {
  // Full Chromium includes the built-in PDF viewer, unlike headless shell.
  const pdfBrowser = await chromium.launch({ channel: "chromium" });
  const { context, page } = await openWorkspace(pdfBrowser, { width: 390, height: 844, type: "invoice" });
  try {
    await page.getByLabel("Work completed", { exact: true }).fill("Receipt preview draft");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Preview Part Payment Receipt", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm & Send Part Payment Receipt", exact: true })).toBeInViewport();
    await noModalOrOverflow(page);
    const frame = page.getByTitle("Invoice PDF preview");
    await expect(frame).toBeVisible();
    // Allow the browser-owned viewer to finish painting before visual review.
    await page.waitForTimeout(2000);
    await capture(page, info, "invoice-preview-390x844");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);
    await capture(page, info, "invoice-preview-full-chromium-1440x900");
    await page.getByRole("button", { name: "Back to Invoice editor", exact: true }).click();
    await expect(page.getByLabel("Work completed", { exact: true })).toHaveValue("Receipt preview draft");
    expect(dbJob(EXISTING_JOB).invoice.notes).not.toBe("Receipt preview draft");
  } finally { await context.close(); await pdfBrowser.close(); }
});

test("invoice payment controls retain their separate record APIs and payment calculations", async ({ browser }) => {
  const { context, page, writes } = await openWorkspace(browser, { type: "invoice" });
  try {
    const original = dbJob(EXISTING_JOB).invoice;
    await page.getByLabel("Payment 1 amount", { exact: true }).fill("300");
    await page.getByRole("button", { name: "Add Payment", exact: true }).click();
    await page.getByLabel("Payment 2 amount", { exact: true }).fill("50");
    await page.getByLabel("Payment 2 method", { exact: true }).fill("EFT");
    await page.getByLabel("Payment 2 reference", { exact: true }).fill("WORKSPACE-TEST");
    await page.getByLabel("Payment 2 notes", { exact: true }).fill("Local synthetic payment");
    await save(page, "invoice");
    expect(dbJob(EXISTING_JOB).invoice.payments.map((payment) => payment.amount)).toEqual([300, 50]);
    expect(dbJob(EXISTING_JOB).invoice.items).toEqual(original.items);
    await expect(page.getByRole("region", { name: "Document summary" })).toContainText("$350.00");
    await expect(page.getByRole("region", { name: "Document summary" })).toContainText("$200.00");
    expect(writes.some((write) => write.method === "PATCH" && write.path.includes("/payments/"))).toBe(true);
    expect(writes.some((write) => write.method === "POST" && write.path.endsWith("/payments"))).toBe(true);
    await page.reload();
    await expect(page.getByLabel("Payment 2 reference", { exact: true })).toHaveValue("WORKSPACE-TEST");
    await page.getByRole("button", { name: "Remove payment 2", exact: true }).click();
    await save(page, "invoice");
    expect(dbJob(EXISTING_JOB).invoice.payments).toHaveLength(1);
    expect(writes.some((write) => write.method === "DELETE" && write.path.includes("/payments/"))).toBe(true);
    expect(writes.some((write) => write.path === "/api/app-state")).toBe(false);
  } finally { await context.close(); }
});
