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

import { insertJobTree } from "../../server-workspace-jobs.js";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "fixtures/demo-workspace.json");
const screenshotDir = path.join(repoRoot, "test-results/document-workspaces");
const accountPassword = "E2E-document-pass-123";
let tempDataDir = "";
let baseUrl = "";
let serverProcess = null;
let serverOutput = "";
let mailServer, mailPort;
const messages = [];

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
          if (line === ".") { messages.push(message); message = ""; receiving = false; socket.write("250 captured locally\r\n"); }
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
  fixture.jobs=[original,{...original,id:NEW_JOB,jobNumber:1200,title:'Document creation test',notes:[],photos:[],quote:null,invoice:null}];
  return fixture;
}
test.beforeAll(async()=>{
  tempDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'elset-document-playwright-'));
  fs.mkdirSync(screenshotDir,{recursive:true});
  const db=openWorkspaceDb({dbPath:path.join(tempDataDir,'elset-workspace.db')});
  try { importWorkspaceJsonData(db,documentFixture()); } finally { db.close(); }
  await seedLoginAccounts();
  await startMailSink();
  await startServer();
});
test.beforeEach(()=>{
  const db=openWorkspaceDb({dbPath:path.join(tempDataDir,'elset-workspace.db')});
  try {
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
async function openWorkspace(browser, {width=1440,height=900,jobId=EXISTING_JOB,type='quote',username='mobileadmin'}={}) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1280,isMobile:width<768,locale:'en-AU',timezoneId:'Australia/Sydney',reducedMotion:'reduce'});
  const page=await context.newPage();
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
const save=async(page,type)=>{await page.getByRole('button',{name:'Save '+(type==='quote'?'Quote':'Invoice'),exact:true}).click();await expect(editor(page).locator('.document-feedback')).toHaveText('Saved');};
async function noModalOrOverflow(page){
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>getComputedStyle(document.body).pointerEvents)).not.toBe('none');
}
async function capture(page,info,name){
  const body=await page.screenshot({path:path.join(screenshotDir,name+'.png'),fullPage:true});
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
      await page.getByRole("button", { name: /^Confirm & Send/ }).click();
      await expect(editor(page).locator(".document-feedback")).toContainText("sent with PDF attachment");
      expect(messages).toHaveLength(mailCount + 1);
      const email = messages.at(-1);
      expect(email).toContain("Content-Type: application/pdf");
      const attachment = email.split(/\r\n--/).find((part) => part.includes("Content-Type: application/pdf"));
      const pdf = Buffer.from(attachment.slice(attachment.indexOf("\r\n\r\n") + 4).trim(), "base64");
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
      fs.writeFileSync(path.join(screenshotDir, `${type}-email-attachment.pdf`), pdf);
      expect(dbJob(EXISTING_JOB)[type].sentHistory).toHaveLength(before.sentHistory.length + 1);
      if (type === "invoice") expect(dbJob(EXISTING_JOB).invoice.payments).toEqual(before.payments);
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
