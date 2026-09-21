import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const password = "Legal-fixture-login-123";
const privateMarker = "PRIVATE LEGAL TEST CUSTOMER";
const documents = [
  ["terms", "ELSET Terms of Service and Software Licence"],
  ["privacy", "ELSET Privacy Policy"],
];
let dataDir, baseUrl, server;
let serverOutput = "";

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-legal-e2e-"));
  const db = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  try {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
    fixture.customers[0].name = privateMarker;
    importWorkspaceJsonData(db, fixture);
  } finally { db.close(); }
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney",
    ELSET_DATA_DIR: dataDir, ELSET_AUTH_DB_PATH: path.join(dataDir, "auth.db"),
    ELSET_WORKSPACE_DB_PATH: path.join(dataDir, "elset-workspace.db"), ELSET_WORKSPACE_STORAGE: "sqlite",
    BETTER_AUTH_URL: baseUrl, BETTER_AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
    ELSET_FRONTEND_URL: baseUrl, ELSET_API_PORT: String(port), PORT: String(port), ELSET_DISABLE_STATIC: "false",
    QUICKBOOKS_CLIENT_ID: "", QUICKBOOKS_CLIENT_SECRET: "", XERO_CLIENT_ID: "", XERO_CLIENT_SECRET: "",
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
  };
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import(${JSON.stringify(pathToFileURL(path.join(root, "server-auth.js")).href)});
    await ensureAuthReady();
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({ email: 'legal@example.test', emailVerified: true,
      name: 'Legal fixture', role: 'admin', username: 'legaladmin', displayUsername: 'Legal fixture', workspaceRole: 'admin', staffId: '' });
    await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password: await context.password.hash(${JSON.stringify(password)}) });
  `], { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (seed.status !== 0) throw new Error(`Fixture login setup failed: ${seed.stdout}\n${seed.stderr}`);
  server = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { return (await fetch(`${baseUrl}/api/auth/me`)).status; } catch { return 0; }
  }, { timeout: 30000 }).toBe(401);
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await info.attach("server-output", { body: serverOutput, contentType: "text/plain" });
});
test.afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      server.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  const target = path.resolve(dataDir || ".");
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith("elset-legal-e2e-")) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

for (const width of [320, 390, 1440]) {
  for (const [slug, title] of documents) {
    test(`${slug} is public and responsive at ${width}px`, async ({ page, context }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const apiRequests = [];
      const pageErrors = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const response = await page.goto(`${baseUrl}/legal/${slug}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/html");
      await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole("navigation", { name: "Application", exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Staff Login", exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(privateMarker);
      expect(await context.cookies()).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath(`${slug}-${width}-top.png`) });
      await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Business details and contact" }).click();
      await expect(page.getByRole("heading", { name: "Business details and contact" })).toBeInViewport();
      const contact = page.getByRole("region", { name: "Business details and contact", exact: true });
      await expect(contact).toContainText("ELSET AUTOMATION");
      await expect(contact).toContainText("93 686 524 621");
      await expect(contact).toContainText("686 652 621");
      await expect(contact).toContainText("7 Mohr St, Tullamarine, VIC 3043");
      await expect(contact).toContainText("ELSET administration — admin@elset.com.au");
      await expect(page.locator("body")).not.toContainText("[REPLACE:");
      await expect(page.locator("body")).not.toContainText("Business details pending");
      await page.screenshot({ path: info.outputPath(`${slug}-${width}-contact.png`) });
      await page.reload();
      await expect(page.getByRole("heading", { name: "Business details and contact" })).toBeVisible();
      expect(apiRequests).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
}

test("public links, trailing slashes and reloads work without an auth service", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto(`${baseUrl}/legal/terms/?review=1`);
  await expect(page.getByRole("heading", { name: documents[0][1], exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Legal pages" }).getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page).toHaveURL(`${baseUrl}/legal/privacy`);
  await expect(page.getByRole("heading", { name: documents[1][1], exact: true })).toBeVisible();
  await page.goto(`${baseUrl}/legal/privacy/`);
  await page.reload();
  await expect(page.getByRole("heading", { name: documents[1][1], exact: true })).toBeVisible();
});

test("other application routes and private APIs still require authentication", async ({ page, request }) => {
  for (const route of ["/", "/customers", "/settings", "/jobs/private-test/invoice", "/legal/terms/private", "/legal/unknown"]) {
    await page.goto(`${baseUrl}${route}`);
    await expect(page.getByRole("heading", { name: "Staff Login", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Application", exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(privateMarker);
  }
  for (const route of ["/api/auth/me", "/api/app-state", "/api/customers/private-test/account-summary", "/api/user-preferences", "/api/integrations/quickbooks/status"]) {
    const response = await request.get(`${baseUrl}${route}`);
    expect(response.status(), route).toBe(401);
    expect(await response.text()).not.toContain(privateMarker);
  }
});

test("login links, invalid credentials, valid login, session restoration and logout still work", async ({ page, context }, info) => {
  await page.goto(baseUrl);
  await expect(page.getByRole("heading", { name: "Staff Login", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("login-legal-links.png") });
  for (const [slug, title] of documents) {
    await page.getByRole("navigation", { name: "Legal", exact: true }).getByRole("link", { name: slug === "terms" ? "Terms" : "Privacy", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Staff Login", exact: true })).toBeVisible();
  }
  await page.getByPlaceholder("Enter your username").fill("legaladmin");
  await page.getByPlaceholder("Enter your password").fill("Incorrect-password-123");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Staff Login", exact: true })).toBeVisible();
  expect((await context.request.get(`${baseUrl}/api/auth/me`)).status()).toBe(401);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Application", exact: true })).toBeVisible();
  const state = await context.request.get(`${baseUrl}/api/app-state`);
  expect(state.status()).toBe(200);
  expect(await state.text()).toContain(privateMarker);
  for (const [slug, title] of documents) {
    await page.goto(`${baseUrl}/legal/${slug}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Application", exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(privateMarker);
  }
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Application", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Application", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff Login", exact: true })).toBeVisible();
  expect((await context.request.get(`${baseUrl}/api/app-state`)).status()).toBe(401);
});
