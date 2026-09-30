import { test, expect, chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { normalizeStoredData } from '../../server-store.js';
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";
import { readPdfTextRuns } from "../helpers/pdf-text.js";
import { getDocumentRecipientEmail } from "../../src/lib/quote-template.js";
import { themePresets } from "../../src/lib/theme-presets.js";
import { DOCUMENT_JSON_LIMIT_BYTES } from "../../server-document-json.js";

import { insertJobTree } from "../../server-workspace-jobs.js";
import { updateCustomer } from "../../server-workspace-customers.js";
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
const envelopes = [];
const rejectedAddresses = new Set();
let holdMail = false;
let rejectMail = false;
const pendingMail = [];
function releaseMail() {
  holdMail = false;
  pendingMail.splice(0).forEach((complete) => complete());
}

async function startMailSink() {
  mailServer = net.createServer((socket) => {
    let buffer = "", receiving = false, message = "", envelope = [];
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
              else { messages.push(email); envelopes.push([...envelope]); socket.write("250 captured locally\r\n"); }
            };
            if (holdMail) pendingMail.push(complete);
            else complete();
          }
          else message += line.replace(/^\.\./, ".") + "\r\n";
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 25000000\r\n");
        else if (/^AUTH/.test(line)) socket.write("235 authenticated\r\n");
        else if (/^MAIL FROM:/i.test(line)) { envelope = []; socket.write("250 OK\r\n"); }
        else if (/^RCPT TO:/i.test(line)) {
          const address = line.match(/<([^>]+)>/)?.[1] || "";
          if (rejectedAddresses.has(address.toLowerCase())) socket.write("550 local recipient rejected\r\n");
          else { envelope.push(address); socket.write("250 OK\r\n"); }
        }
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
  customer.contacts = [{ id: "composer-contact-manager", name: "Saved Manager", role: "Manager", email: "manager@example.test" }, { id: "composer-contact-duplicate", name: "Duplicate Customer", email: customer.email.toUpperCase() }];
  fixture.settings.quoteCcEmail = "quote-copy@example.test";
  fixture.settings.invoiceCcEmail = "invoice-copy@example.test";
  fixture.settings.emailSignature = "Regards,\nELSET test office";
  customer.sites[0].ocNumber = "222222";
  customer.address = "1 Primary Site Road, Sampleton VIC 3000";
  customer.sites.unshift({ id: "document-site-a", address: customer.address, ocNumber: "111111" });
  fixture.jobs=[original,{...original,id:NEW_JOB,jobNumber:1200,title:'Document creation test',notes:[],photos:[],quote:null,invoice:null}];
  return fixture;
}
test.beforeAll(async()=>{
  tempDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'elset-document-playwright-'));
  fs.mkdirSync(screenshotDir,{recursive:true});
  const db=openWorkspaceDb({dbPath:path.join(tempDataDir,'elset-workspace.db')});
  try {
    const fixture = documentFixture();
    importWorkspaceJsonData(db, fixture);
    for (const customer of fixture.customers) updateCustomer(db, customer.id, { contacts: customer.contacts });
  } finally { db.close(); }
  await seedLoginAccounts();
  await startMailSink();
  await startServer();
});
test.beforeEach(()=>{
  rejectedAddresses.clear();
  rejectMail = false;
  releaseMail();
  const db=openWorkspaceDb({dbPath:path.join(tempDataDir,'elset-workspace.db')});
  try {
    db.exec("DELETE FROM deleted_invoices");
    db.exec("DELETE FROM price_list_items");
    const clean=normalizeStoredData(documentFixture());
    for(const job of clean.jobs){db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);insertJobTree(db,job);}
  }finally{db.close();}
});

function prepareComposerJob({ noEmail = false, payments } = {}) {
  const job = dbJob(EXISTING_JOB);
  job.billingContact = { id: "composer-billing", name: "Billing Person", role: "Accounts", phone: job.customerPhone, notes: "", email: noEmail ? "" : "billing@example.test" };
  job.requesterContact = { name: "Job Requester", email: "requester@example.test" };
  job.onsiteContact = { name: "Onsite Person", email: "onsite@example.test" };
  if (noEmail) job.customerEmail = "";
  if (payments) job.invoice = { ...job.invoice, payments, paidAmount: 0, paymentStatus: "unpaid" };
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id); insertJobTree(db, job); } finally { db.close(); }
  return dbJob(EXISTING_JOB);
}

for (const [type, width] of [["quote", 1440], ["invoice", 390]]) {
  test(`${type} legacy recipient history renders safely without rewriting saved records`, async ({ browser }) => {
    const fields = ["to", "cc", "bcc", "acceptedRecipients", "rejectedRecipients", "unconfirmedRecipients"];
    const invalidValues = [undefined, null, "", "   ", 42, false, { address: "object@example.test" }, { length: 1, join: "invalid" }, [null, 12, {}]];
    const histories = [
      { id: "legacy-strings", subject: "Legacy strings", toEmail: "unused-fallback@example.test", to: "[old@example.com](mailto:old@example.com)", cc: "[copy@example.com](mailto:copy@example.com)", bcc: "private@example.com", acceptedRecipients: "[old@example.com](mailto:old@example.com)", rejectedRecipients: "copy@example.com", unconfirmedRecipients: "private@example.com" },
      { id: "legacy-email-only", subject: "Legacy To email only", toEmail: "fallback@example.test" },
      { id: "new-arrays", subject: "New arrays", ...Object.fromEntries(fields.map((field) => [field, [` first-${field}@example.test `, `second-${field}@example.test`]])) },
      ...invalidValues.map((value, index) => ({ id: `invalid-${index}`, subject: `Invalid recipients ${index}`, toEmail: "fallback@example.test", ...Object.fromEntries(fields.map((field) => [field, value])) })),
      { id: "no-recipient", subject: "No recorded recipients", to: null },
      { id: "mixed-array", subject: "Mixed recipient array", ...Object.fromEntries(fields.map((field) => [field, [null, {}, "  kept@example.test  ", 42, " "]])) },
    ];
    const job = dbJob(EXISTING_JOB);
    job[type].sentHistory = histories;
    const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
    try { db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id); insertJobTree(db, job); } finally { db.close(); }
    const before = dbJob(EXISTING_JOB);
    const { context, page, writes } = await openWorkspace(browser, { type, width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.getByText(`View sent emails (${histories.length})`, { exact: true }).click();
      const history = page.locator(".document-email-history");
      const record = (subject) => history.locator(":scope > details").filter({ has: page.locator("summary", { hasText: subject }) });
      const fieldText = (entry, label) => entry.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }).locator("..").locator("dd");
      const legacy = record("Legacy strings");
      await legacy.locator("summary").click();
      await expect(fieldText(legacy, "To")).toHaveText(histories[0].to);
      await expect(fieldText(legacy, "CC")).toHaveText(histories[0].cc);
      await expect(fieldText(legacy, "BCC \\(private\\)")).toHaveText(histories[0].bcc);
      await expect(fieldText(legacy, "Accepted")).toHaveText(histories[0].acceptedRecipients);
      await expect(fieldText(legacy, "Rejected")).toHaveText(histories[0].rejectedRecipients);
      await expect(fieldText(legacy, "Unconfirmed")).toHaveText(histories[0].unconfirmedRecipients);
      await expect(fieldText(record("Legacy To email only"), "To")).toHaveText("fallback@example.test");
      for (const [field, label] of fields.map((field, index) => [field, ["To", "CC", "BCC \\(private\\)", "Accepted", "Rejected", "Unconfirmed"][index]])) {
        await expect(fieldText(record("New arrays"), label)).toHaveText(`first-${field}@example.test, second-${field}@example.test`);
        await expect(fieldText(record("Mixed recipient array"), label)).toHaveText("kept@example.test");
      }
      for (let index = 0; index < invalidValues.length; index++) {
        const entry = record(`Invalid recipients ${index}`);
        await expect(fieldText(entry, "To")).toHaveText("fallback@example.test");
        await expect(entry.locator("dt").filter({ hasText: /^(CC|BCC \(private\)|Accepted|Rejected|Unconfirmed)$/ })).toHaveCount(0);
      }
      await expect(fieldText(record("No recorded recipients"), "To")).toHaveText("Not recorded");
      await page.reload();
      await expect(page.locator(".document-email-history")).toBeVisible();
      await page.goto(`${baseUrl}/jobs/${EXISTING_JOB}`);
      await expect(page.locator(".record-workspace")).toBeVisible();
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
      expect(dbJob(EXISTING_JOB)).toEqual(before);
    } finally { await context.close(); }
  });
}

for (const type of ["quote", "invoice"]) for (const width of [1440, 390]) {
  test(`${type} email composer edits recipients and message independently at ${width}px`, async ({ browser }, info) => {
    const before = prepareComposerJob({ payments: [] });
    const settings = readWorkspaceState().settings;
    const customers = readWorkspaceState().customers;
    const { context, page, writes } = await openWorkspace(browser, { type, width, height: width === 390 ? 844 : 1000 });
    try {
      await page.getByRole("button", { name: /^Preview & Send/ }).click();
      const composer = page.getByRole("group", { name: "Email composer", exact: true });
      await expect(composer).toBeVisible();
      const frame = page.getByTitle(type === "quote" ? "Quote PDF preview" : "Invoice PDF preview");
      const pdfUrl = await frame.getAttribute("src");
      const previewRuns = await readPdfTextRuns(Buffer.from(await frame.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer())))));
      await expect(composer.getByLabel("To recipients", { exact: true })).toContainText("billing@example.test");
      await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(`ELSET ${type.toUpperCase()} FOR ${before.jobAddress}`);
      await expect(page.getByLabel("Message", { exact: true })).toContainText("Regards,\nELSET test office");
      const options = await page.getByLabel("Add saved contact to To", { exact: true }).locator("option").allTextContents();
      expect(options).toContain("Job Requester · Requester · requester@example.test");
      expect(options).toContain("Onsite Person · On-site contact · onsite@example.test");
      expect(options).toContain("Saved Manager · Manager · manager@example.test");
      expect(options.filter((text) => text.toLowerCase().includes(before.customerEmail.toLowerCase()))).toHaveLength(1);
      await page.getByLabel("Add saved contact to To", { exact: true }).selectOption("requester@example.test");
      await page.getByLabel("To", { exact: true }).fill("arbitrary@example.test; BILLING@EXAMPLE.TEST");
      await page.getByRole("button", { name: "Add To recipients", exact: true }).click();
      await expect(composer.getByLabel("To recipients", { exact: true }).locator(".document-recipient-chip")).toHaveCount(3);
      await page.getByRole("button", { name: "Remove requester@example.test from To", exact: true }).click();
      await page.getByRole("button", { name: `Remove ${type}-copy@example.test from CC`, exact: true }).click();
      await page.getByLabel("CC", { exact: true }).fill("promote@example.test");
      await page.getByRole("button", { name: "Add CC recipients", exact: true }).click();
      await page.getByLabel("To", { exact: true }).fill("PROMOTE@example.test");
      await page.getByRole("button", { name: "Add To recipients", exact: true }).click();
      await expect(page.getByRole("button", { name: "Remove promote@example.test from CC", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Remove PROMOTE@example.test from To", exact: true }).click();
      await page.getByLabel("CC", { exact: true }).fill("cc-one@example.test, cc-two@example.test, arbitrary@example.test");
      await page.getByRole("button", { name: "Add CC recipients", exact: true }).click();
      await page.getByRole("button", { name: "Remove cc-two@example.test from CC", exact: true }).click();
      await page.getByText("BCC (optional)", { exact: true }).click();
      await page.getByLabel("BCC", { exact: true }).fill("private@example.test, remove-private@example.test");
      await page.getByRole("button", { name: "Add BCC recipients", exact: true }).click();
      await page.getByRole("button", { name: "Remove remove-private@example.test from BCC", exact: true }).click();
      await page.getByLabel("Subject", { exact: true }).fill("Edited per-send subject");
      const body = 'Personal message <script>alert("x")</script> & team\n\nEdited signature';
      await page.getByLabel("Message", { exact: true }).fill(body);
      await expect(frame).toHaveAttribute("src", pdfUrl);
      expect(writes.filter((entry) => entry.path === "/api/quotes/preview-pdf")).toHaveLength(1);
      await expect(page.locator(".document-feedback")).not.toContainText("Unsaved");
      expect(dbJob(EXISTING_JOB)).toEqual(before);
      expect(readWorkspaceState().settings).toEqual(settings);
      expect(readWorkspaceState().customers).toEqual(customers);
      await noModalOrOverflow(page);
      await capture(page, info, `email-composer-${type}-${width}`);
      await page.getByRole("button", { name: /^Confirm & Send/ }).click();
      await expect(page.locator('[data-document-send-status="success"]')).toBeVisible();
      const sent = dbJob(EXISTING_JOB)[type].sentHistory.at(-1);
      expect(sent).toMatchObject({ to: ["billing@example.test", "arbitrary@example.test"], cc: ["cc-one@example.test"], bcc: ["private@example.test"], subject: "Edited per-send subject", message: body, acceptedRecipients: ["billing@example.test", "arbitrary@example.test", "cc-one@example.test", "private@example.test"], rejectedRecipients: [], unconfirmedRecipients: [], replyToEmail: settings.replyToEmail, sentBy: { name: "Mobile Admin" } });
      expect(sent.messageId).toBeTruthy();
      expect(sent.documentSnapshot.items).toEqual(before[type].items);
      expect(sent.documentSnapshot).not.toHaveProperty("email");
      expect(sent.jobSnapshot.billingContact).toEqual(before.billingContact);
      expect(readWorkspaceState().settings).toEqual(settings);
      expect(readWorkspaceState().customers).toEqual(customers);
      const request = writes.find((entry) => entry.path === "/api/documents/send").body;
      expect(request.email.message).toBe(body);
      expect(request.job.billingContact.email).toBe("billing@example.test");
      const raw = messages.at(-1);
      expect(raw).not.toContain("private@example.test");
      expect(raw).not.toMatch(/^Bcc:/im);
      expect(envelopes.at(-1)).toEqual(sent.acceptedRecipients);
      const attachment = raw.split(/\r\n--/).find((part) => part.includes("Content-Type: application/pdf"));
      expect(await readPdfTextRuns(Buffer.from(attachment.slice(attachment.indexOf("\r\n\r\n") + 4).trim(), "base64"))).toEqual(previewRuns);
      await page.reload();
      await page.getByText(/^View sent emails/).click();
      await page.locator(".document-email-history details summary").first().click();
      await expect(page.locator(".document-email-history")).toContainText(body);
      await expect(page.locator(".document-email-history")).toContainText("private@example.test");
      await page.getByRole("button", { name: /^Preview & Send/ }).click();
      await expect(page.getByLabel("Subject", { exact: true })).not.toHaveValue("Edited per-send subject");
      await expect(page.getByLabel("CC recipients", { exact: true })).toContainText(`${type}-copy@example.test`);
    } finally { await context.close(); }
  });
}

test("composer permits manual To without saved email and blocks malformed recipients before sending", async ({ browser }) => {
  const before = prepareComposerJob({ noEmail: true });
  const { context, page, writes } = await openWorkspace(browser, { type: "quote" });
  try {
    await page.getByRole("button", { name: /^Preview & Send/ }).click();
    const send = page.getByRole("button", { name: /^Confirm & Send/ });
    await expect(send).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText("Add at least one To");
    await page.getByLabel("To", { exact: true }).fill("invalid");
    await page.getByRole("button", { name: "Add To recipients", exact: true }).click();
    await expect(send).toBeDisabled();
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("invalid");
    await page.getByLabel("To", { exact: true }).fill("manual@example.test");
    await page.getByLabel("CC", { exact: true }).fill("broken-address");
    await expect(send).toBeDisabled();
    await page.getByLabel("CC", { exact: true }).fill("");
    await page.getByLabel("Subject", { exact: true }).fill("");
    await expect(send).toBeDisabled();
    await page.getByLabel("Subject", { exact: true }).fill("Manual send");
    expect(writes.filter((entry) => entry.path === "/api/documents/send")).toHaveLength(0);
    await send.click();
    await expect(page.locator('[data-document-send-status="success"]')).toContainText("manual@example.test");
    expect(dbJob(EXISTING_JOB).billingContact).toEqual(before.billingContact);
    expect(dbJob(EXISTING_JOB).customerEmail).toBe("");
  } finally { await context.close(); }
});

for (const scenario of ["partial", "cc-only", "bcc-only"]) {
  test(`composer handles ${scenario} SMTP acceptance without unsafe issuance or retry advice`, async ({ browser }) => {
    const before = prepareComposerJob({ payments: [] });
    const { context, page } = await openWorkspace(browser, { type: "invoice" });
    try {
      await page.getByRole("button", { name: /^Preview & Send/ }).click();
      await page.getByLabel("To", { exact: true }).fill("second@example.test");
      await page.getByRole("button", { name: "Add To recipients", exact: true }).click();
      await page.getByText("BCC (optional)", { exact: true }).click();
      await page.getByLabel("BCC", { exact: true }).fill("private@example.test");
      await page.getByRole("button", { name: "Add BCC recipients", exact: true }).click();
      rejectedAddresses.add("second@example.test");
      if (scenario !== "partial") rejectedAddresses.add("billing@example.test");
      if (scenario === "cc-only") rejectedAddresses.add("private@example.test");
      if (scenario === "bcc-only") rejectedAddresses.add("invoice-copy@example.test");
      await page.getByRole("button", { name: /^Confirm & Send/ }).click();
      if (scenario === "partial") {
        const banner = page.locator('[data-document-send-status="success"]');
        await expect(banner).toContainText("Do not resend to everyone");
        await expect(banner).toContainText("second@example.test");
        expect(dbJob(EXISTING_JOB).invoice.sentHistory.at(-1)).toMatchObject({ acceptedRecipients: ["billing@example.test", "invoice-copy@example.test", "private@example.test"], rejectedRecipients: ["second@example.test"] });
        await expect(page.getByRole("button", { name: "Retry Send", exact: true })).toHaveCount(0);
      } else {
        await expect(page.locator('[data-document-send-status="error"]')).toContainText("Copies were accepted");
        await expect(page.locator('[data-document-send-status="error"]')).toContainText(scenario === "cc-only" ? "invoice-copy@example.test" : "private@example.test");
        expect(dbJob(EXISTING_JOB).invoice).toEqual(before.invoice);
        await expect(page.locator("[data-document-preview]")).toBeVisible();
      }
    } finally { await context.close(); }
  });
}

for (const scenario of [{ amount: 550, purpose: "paid-receipt", stamp: "PAID", subject: "PAID INVOICE" }, { amount: 100, purpose: "part-payment-receipt", stamp: "PART PAYMENT", subject: "PART PAYMENT RECEIPT" }]) {
  test(`${scenario.purpose} composer preserves purpose and stamp with edited message`, async ({ browser }) => {
    prepareComposerJob({ payments: [{ id: "receipt-payment", date: "2026-09-01", amount: scenario.amount }] });
    const { context, page, writes } = await openWorkspace(browser, { type: "invoice", width: 390, height: 844 });
    try {
      await page.getByRole("button", { name: /^Preview & Send/ }).click();
      await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(new RegExp(scenario.subject));
      await expect(page.getByLabel("Message", { exact: true })).toContainText("receipt");
      await page.getByLabel("Message", { exact: true }).fill("Thanks for your payment.\nReceipt attached.");
      await page.getByRole("button", { name: /^Confirm & Send/ }).click();
      await expect(page.locator('[data-document-send-status="success"]')).toBeVisible();
      expect(writes.find((entry) => entry.path === "/api/documents/send").body).toMatchObject({ stampText: scenario.stamp, emailPurpose: scenario.purpose });
      expect(dbJob(EXISTING_JOB).invoice.sentHistory.at(-1)).toMatchObject({ stampText: scenario.stamp, emailPurpose: scenario.purpose, message: "Thanks for your payment.\nReceipt attached." });
    } finally { await context.close(); }
  });
}
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
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id); insertJobTree(db, job); } finally { db.close(); }
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
      await capture(page, info, `invoice-delete-sqlite-${scenario.width}`, false);
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
      expect(dbJob(EXISTING_JOB)).toEqual({ ...original, invoice: null, updatedAt: expect.any(String) });
      await expect(page.locator(".data-grid-row:visible, [data-mobile-record-card]").filter({ hasText: "#1001" })).toHaveCount(0);
      const [archive] = readWorkspaceState().deletedInvoices;
      expect(archive.invoice).toEqual(original.invoice);
      await navigateSection(page, "Recycle Bin");
      await page.getByRole("tab", { name: "Invoices", exact: true }).click();
      await expect(page.getByText("INV-1001", { exact: true })).toBeVisible();
      await expect(page.getByText(original.customerName, { exact: true })).toBeVisible();
      await expect(page.getByText("Amount", { exact: true })).toBeVisible();
      await capture(page, info, `invoice-recycle-sqlite-${scenario.width}`, false);
      await page.getByRole("button", { name: "Restore Invoice", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Invoice restored" })).toBeVisible();
      expect(dbJob(EXISTING_JOB).invoice).toEqual(original.invoice);
      expect(readWorkspaceState().deletedInvoices).toEqual([]);
      await navigateSection(page, "Invoices");
      // Restoring an unsent draft does not issue it or add it to the issued-invoice list.
      await expect(page.locator(".data-grid-row:visible, [data-mobile-record-card]").filter({ hasText: "#1001" })).toHaveCount(scenario.sent ? 1 : 0);
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
const save = async (page, type) => {
  await page.getByRole("button", { name: "Save " + (type === "quote" ? "Quote" : "Invoice"), exact: true }).click();
  await expect(editor(page).locator(".document-feedback")).toHaveText("Saved");
};
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
      await expect(page.getByLabel("Item 1 description", { exact: true })).toHaveValue("");
      await expect(page.getByLabel("Item 1 quantity", { exact: true })).toHaveValue("1");
      await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("0");
      await page.getByLabel("Item 1 description", { exact: true }).fill("Motor replacement");
      await page.getByLabel("Item 1 quantity", { exact: true }).fill("2.5");
      await page.getByLabel("Item 1 rate", { exact: true }).fill("120");
      await page.getByRole("button", { name: "Add blank line", exact: true }).click();
      await page.getByLabel("Item 2 description", { exact: true }).fill("Travel");
      await page.getByLabel("Item 2 rate", { exact: true }).fill("50");
      await page.getByRole("button", { name: "Add blank line", exact: true }).click();
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

test("price list management shares editable snapshots across quotes and invoices", async ({ browser }, info) => {
  const { context, page } = await openWorkspace(browser, { jobId: NEW_JOB, type: "quote" });
  async function settings() {
    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("button", { name: "Items & Price List", exact: true }).last().click();
  }
  try {
    const original = dbJob(EXISTING_JOB);
    await settings();
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Add price-list item" });
    await expect(dialog.getByRole("button", { name: "Save item", exact: true })).toBeDisabled();
    await dialog.getByLabel("Name", { exact: true }).fill("Discarded item");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
    await guard.getByRole("button", { name: "Stay", exact: true }).click();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Discarded item");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await guard.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("listitem", { name: "Discarded item", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Labour");
    await dialog.getByLabel("Description", { exact: true }).fill("Gate maintenance labour");
    await dialog.getByLabel("Item code / SKU (optional)").fill("LAB-01");
    await dialog.getByLabel("Category (optional)").fill("Services");
    await dialog.getByLabel("Unit", { exact: true }).selectOption("hour");
    await dialog.getByLabel("Unit price ex GST").fill("145");
    await dialog.getByRole("button", { name: "Save item", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Price-list items" })).toContainText("$145.00");
    await page.getByLabel("Search price list").fill("LAB-01");
    await expect(page.getByRole("listitem", { name: "Labour", exact: true })).toBeVisible();
    await capture(page, info, "price-list-settings-desktop");
    await page.goto(`${baseUrl}/jobs/${NEW_JOB}/quote`);
    await page.getByRole("button", { name: "Remove item 1", exact: true }).click();
    await page.getByRole("button", { name: "Add from price list", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Add from price list", exact: true });
    for (const query of ["Labour", "LAB-01", "maintenance"]) {
      await dialog.getByLabel("Search price list").fill(query);
      await expect(dialog.getByRole("button", { name: "Add Labour", exact: true })).toBeVisible();
    }
    await dialog.getByRole("button", { name: "Add Labour", exact: true }).click();
    await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("145");
    await page.getByLabel("Item 1 rate", { exact: true }).fill("140");
    await page.getByLabel("Item 1 description", { exact: true }).fill("Agreed labour");
    await save(page, "quote");
    const savedQuote = structuredClone(dbJob(NEW_JOB).quote);
    await settings();
    await page.getByRole("listitem", { name: "Labour", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Edit price-list item" });
    await dialog.getByLabel("Unit price ex GST").fill("155");
    await dialog.getByLabel("Name", { exact: true }).fill("Labour revised");
    await dialog.getByRole("button", { name: "Save item", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.goto(`${baseUrl}/jobs/${NEW_JOB}/invoice`);
    await expect(page.getByLabel("Item 1 description", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Remove item 1", exact: true }).click();
    await page.getByRole("button", { name: "Add from price list", exact: true }).click();
    await page.getByRole("button", { name: "Add Labour revised", exact: true }).click();
    await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("155");
    await page.getByRole("button", { name: "Add blank line", exact: true }).click();
    await expect(page.getByLabel("Item 2 description", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Item 2 rate", { exact: true })).toHaveValue("0");
    await page.getByLabel("Item 2 description", { exact: true }).fill("Manual travel");
    await page.getByLabel("Item 2 rate", { exact: true }).fill("10");
    await expect(page.locator("[data-document-total]")).toHaveText("$181.50");
    await save(page, "invoice");
    const savedInvoice = structuredClone(dbJob(NEW_JOB).invoice);
    expect(savedQuote.items[0].priceListItemId).toBe(savedInvoice.items[0].priceListItemId);
    expect(savedInvoice.items[1].priceListItemId).toBeUndefined();
    await settings();
    await page.getByRole("listitem", { name: "Labour revised", exact: true }).getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Item archived" })).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Price-list status").selectOption("archived");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listitem", { name: "Labour revised", exact: true })).toContainText("$155.00");
    await page.goto(`${baseUrl}/jobs/${NEW_JOB}/quote`);
    await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("140");
    await expect(page.getByLabel("Item 1 description", { exact: true })).toHaveValue("Agreed labour");
    await page.getByRole("button", { name: "Add from price list", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("No active items");
    expect(dbJob(NEW_JOB).quote).toEqual(savedQuote);
    expect(dbJob(NEW_JOB).invoice).toEqual(savedInvoice);
    expect(dbJob(EXISTING_JOB)).toEqual(original);
  } finally { await context.close(); }
});

for (const width of [390, 820, 1440]) test(`price-list picker is searchable and reads current values at ${width}px`, async ({ browser }, info) => {
  const { context, page } = await openWorkspace(browser, { width, height: 1000, jobId: NEW_JOB, type: "invoice" });
  try {
    const response = await context.request.post(`${baseUrl}/api/price-list-items`, { data: { name: "Labour", description: "Gate maintenance labour", code: "LAB-01", unit: "hour", unitPrice: 145, taxTreatment: "taxable" } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const { item } = await response.json();
    await page.getByRole("button", { name: "Remove item 1", exact: true }).click();
    await page.getByRole("button", { name: "Add from price list", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add from price list", exact: true });
    await dialog.getByLabel("Search price list").fill("LAB-01");
    await expect(dialog.getByRole("button", { name: "Add Labour", exact: true })).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const box = await dialog.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await capture(page, info, `price-list-picker-${width}`);
    const update = await context.request.patch(`${baseUrl}/api/price-list-items/${item.id}`, { data: { updatedAt: item.updatedAt, unitPrice: 155 } });
    expect(update.ok()).toBeTruthy();
    await dialog.getByRole("button", { name: "Add Labour", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("155");
    await save(page, "invoice");
    await page.reload();
    await expect(page.getByLabel("Item 1 rate", { exact: true })).toHaveValue("155");
    const current = (await update.json()).item;
    await page.getByRole("button", { name: "Add from price list", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Add Labour", exact: true })).toBeVisible();
    expect((await context.request.patch(`${baseUrl}/api/price-list-items/${item.id}`, { data: { updatedAt: current.updatedAt, archived: true } })).ok()).toBeTruthy();
    await dialog.getByRole("button", { name: "Add Labour", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("archived");
    await expect(page.locator("[data-document-item]")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await noModalOrOverflow(page);
  } finally { await context.close(); }
});

test("document workspaces fit all eight requested viewports with usable line items and totals", async ({ browser }, info) => {
  for (const [width, height] of [[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1280,720],[1440,900],[1920,1080]]) {
    for (const type of ["quote", "invoice"]) {
      const { context, page, writes } = await openWorkspace(browser, { width, height, type });
      try {
        await noModalOrOverflow(page);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(type === "quote" ? "Quote" : "Invoice");
        await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
        for (const control of await page.locator(".record-workspace-header button:visible").all()) {
          expect((await control.boundingBox()).height).toBe(44);
        }
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

test("Invoices edit actions keep their origin through refresh and history", async ({ browser }) => {
  for (const width of [390, 1440]) {
    const { context, page } = await openWorkspace(browser, { width, height: 900 });
    try {
      if (width < 1024) {
        await page.getByRole("button", { name: "Back to Job #1001", exact: true }).click();
        await page.getByRole("button", { name: "Back to Service Board", exact: true }).click();
        await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      }
      await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Invoices", exact: true }).click();
      await expect(page).toHaveURL(baseUrl + "/invoices");
      // The invoice list contains issued invoices; creation is covered from Job Details.
      const row = width < 768 ? page.locator(`[data-mobile-record-card][data-record-id="${EXISTING_JOB}"]`) : page.locator(".data-grid-row", { hasText: "Job #1001" });
      await row.getByRole("button", { name: width < 768 ? "Open invoice editor for Job #1001" : "Editor", exact: true }).click();
      await expect(editor(page)).toHaveAttribute("data-document-mode", "edit");
      await save(page, "invoice");
      await page.reload();
      await page.getByRole("button", { name: "Back to Invoices", exact: true }).click();
      await expect(page).toHaveURL(baseUrl + "/invoices");
      await expect(row).toBeVisible();
      await page.goForward();
      await expect(editor(page)).toHaveAttribute("data-document-mode", "edit");
      await page.getByLabel("Work completed", { exact: true }).fill("Sidebar draft");
      if (width < 1024) await page.getByRole("button", { name: "Back to Invoices", exact: true }).click();
      else await page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Customers", exact: true }).click();
      await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard", exact: true }).click();
      await expect(page).toHaveURL(baseUrl + (width < 1024 ? "/invoices" : "/customers"));
      if (width < 1024) await expect(row).toBeVisible();
      else {
        await expect(page.getByRole("button", { name: "New Customer", exact: true })).toBeVisible();
        await page.goBack();
        await expect(editor(page)).toBeVisible();
        await page.getByLabel("Work completed", { exact: true }).fill("Forward draft");
        await page.goForward();
        const prompt = page.getByRole("dialog", { name: "Discard unsaved changes?" });
        await expect(page).toHaveURL(`${baseUrl}/jobs/${EXISTING_JOB}/invoice`);
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

for (const type of ["invoice", "quote"]) test(`${type} unsaved PDF requests stay compact and large PDFs reach the actual renderer`, async ({ browser }) => {
  // SQLite uploads each photo separately, so a job can legitimately accumulate
  // more than 15 MB of data URLs. None of these images belong in a PDF request.
  const state = readWorkspaceState();
  const photoJob = state.jobs.find((job) => job.id === EXISTING_JOB);
  photoJob.photos = Array.from({ length: 3 }, (_, index) => ({
    id: `payload-photo-${index}`, name: `photo-${index}.jpg`,
    url: "data:image/jpeg;base64," + Buffer.alloc(4 * 1024 * 1024).toString("base64"),
  }));
  const db = openWorkspaceDb({ dbPath: path.join(tempDataDir, "elset-workspace.db") });
  try { db.prepare("DELETE FROM jobs WHERE id = ?").run(EXISTING_JOB); insertJobTree(db, photoJob); }
  finally { db.close(); }
  const { context, page, writes } = await openWorkspace(browser, { type });
  try {
    const original = dbJob(EXISTING_JOB);
    const label = type === "invoice" ? "Invoice" : "Quote";
    const draftText = `Unsaved ${type} payload regression`;
    await page.getByLabel(type === "invoice" ? "Work completed" : "Scope / notes", { exact: true }).fill(draftText);
    await page.getByLabel("Item 1 description", { exact: true }).fill("Unsaved line item");
    await page.getByLabel("Item 1 rate", { exact: true }).fill("321");
    const pending = page.waitForResponse((response) => response.url().endsWith("/api/quotes/preview-pdf"));
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    expect((await pending).status()).toBe(200);
    const request = writes.find((entry) => entry.path === "/api/quotes/preview-pdf").body;
    expect(request.document.notes).toBe(draftText);
    expect(request.document.items[0].rate).toBe("321");
    expect(request.job.invoice).toBeUndefined();
    expect(request.job.quote).toBeUndefined();
    expect(request.job.photos).toBeUndefined();
    expect(request.document.sentHistory).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(10_000);
    const legacyBytes = Buffer.byteLength(JSON.stringify({ ...request, job: original, document: { ...original[type], ...request.document, sentHistory: original[type].sentHistory } }));
    expect(legacyBytes).toBeGreaterThan(15 * 1024 * 1024);
    const frame = page.getByTitle(`${label} PDF preview`);
    await expect(frame).toBeVisible();
    const previewPdf = Buffer.from(await frame.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer()))));
    const text = (await readPdfTextRuns(previewPdf)).flat().map((run) => run.text).join(" ");
    expect(text).toContain(draftText);
    expect(text).toContain("Unsaved line item");
    // The viewer/new-tab/download actions all use this generated PDF blob.
    await expect(page.getByRole("link", { name: "Open PDF in a new tab" })).toHaveAttribute("href", await frame.getAttribute("src"));
    const download = await page.request.post(`${baseUrl}/api/quotes/preview-pdf`, { data: request });
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toMatch(/inline; filename=".*\.pdf"/);
    expect(download.headers()["cache-control"]).toBe("no-store");
    const downloadedPdf = await download.body();
    fs.writeFileSync(path.join(screenshotDir, `payload-${type}-download.pdf`), downloadedPdf);
    expect(await readPdfTextRuns(downloadedPdf)).toEqual(await readPdfTextRuns(previewPdf));

    const large = { ...request, document: { ...request.document, items: Array.from({ length: 250 }, (_, index) => ({ description: `LARGE-ITEM-${index} ` + "Detailed installation work and materials. ".repeat(15), qty: 1, rate: 12.5 })) } };
    const largeBytes = Buffer.byteLength(JSON.stringify(large));
    expect(largeBytes).toBeGreaterThan(100 * 1024);
    expect(largeBytes).toBeLessThan(DOCUMENT_JSON_LIMIT_BYTES);
    const response = await page.request.post(`${baseUrl}/api/quotes/preview-pdf`, { data: large });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    const largePdf = await response.body();
    const runs = await readPdfTextRuns(largePdf);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.flat().map((run) => run.text).join(" ")).toContain("LARGE-ITEM-249");
    fs.writeFileSync(path.join(screenshotDir, `payload-${type}-large.pdf`), largePdf);
    const mailCount = messages.length;
    // Exercise the legacy quote alias as well as the current document send path.
    const sendPath = type === "quote" ? "/api/quotes/send" : "/api/documents/send";
    const sent = await page.request.post(`${baseUrl}${sendPath}`, { data: large });
    expect(sent.status()).toBe(200);
    expect((await sent.json()).ok).toBe(true);
    expect(messages).toHaveLength(mailCount + 1);
    const attachment = messages.at(-1).split(/--[^\r\n]+/).find((part) => /Content-Type: application\/pdf/i.test(part));
    expect(attachment).toBeTruthy();
    const attachmentPdf = Buffer.from(attachment.slice(attachment.indexOf("\r\n\r\n") + 4).trim(), "base64");
    expect(await readPdfTextRuns(attachmentPdf)).toEqual(runs);
    expect(dbJob(EXISTING_JOB)).toEqual(original);
    console.log(`${type} payload bytes: legacy with photos=${legacyBytes}, compact=${Buffer.byteLength(JSON.stringify(request))}, large=${largeBytes}; large PDF pages=${runs.length}`);
  } finally { await context.close(); }
});

test("PDF routes reject oversized bodies with safe 413 JSON after authenticating and authorizing", async ({ browser }) => {
  const routes = ["/api/quotes/preview-pdf", "/api/quotes/send", "/api/documents/send"];
  const largeBody = JSON.stringify({ notes: "PRIVATE-PAYLOAD-DO-NOT-LOG" + "x".repeat(DOCUMENT_JSON_LIMIT_BYTES) });
  const mailCount = messages.length;
  for (const username of ["mobileoffice", "mobiletech"]) {
    const { context, page } = await openWorkspace(browser, { type: "invoice", username });
    try {
      const original = readWorkspaceState();
      for (const route of routes) {
        const response = await page.request.post(`${baseUrl}${route}?private=PRIVATE-QUERY-DO-NOT-LOG`, { headers: { "Content-Type": "application/json" }, data: largeBody });
        expect(response.status()).toBe(username === "mobileoffice" ? 413 : 403);
        if (username === "mobileoffice") expect(await response.json()).toEqual({ error: route.endsWith("preview-pdf") ? "PDF preview payload is too large." : "Document email payload is too large." });
      }
      expect(readWorkspaceState()).toEqual(original);
    } finally { await context.close(); }
  }
  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: largeBody });
    expect(response.status).toBe(401);
  }
  expect(messages).toHaveLength(mailCount);
  expect(serverOutput).toContain("[document-json] Request exceeded size limit");
  expect(stripVTControlCharacters(serverOutput)).toContain(`limitBytes: ${DOCUMENT_JSON_LIMIT_BYTES}`);
  expect(serverOutput).not.toContain("PRIVATE-PAYLOAD-DO-NOT-LOG");
  expect(serverOutput).not.toContain("PRIVATE-QUERY-DO-NOT-LOG");
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
      expect(send.body.document.sentHistory).toBeUndefined();
      expect(send.body.job.invoice).toBeUndefined();
      expect(send.body.job.quote).toBeUndefined();
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
