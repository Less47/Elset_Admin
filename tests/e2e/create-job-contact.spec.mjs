import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let server;
let baseUrl;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false, root: repoRoot, appType: "custom", logLevel: "error", plugins: [react()],
    resolve: { alias: { "@": path.join(repoRoot, "src") } },
    server: { host: "127.0.0.1", port: 0 },
  });
  server.middlewares.use("/__contact-regression", async (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(await server.transformIndexHtml("/__contact-regression", '<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/create-job-contact.jsx"></script></body></html>'));
  });
  await server.listen();
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
});
test.afterAll(async () => { await server?.close(); });

const siteEditor = (page) => page.locator("#create-job-site .contact-snapshot-editor");
async function openSiteContact(page, { newCustomer = false } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ json: { results: [] } }));
  await page.goto(`${baseUrl}/__contact-regression`);
  if (newCustomer) {
    await page.getByRole("button", { name: "Add New Customer", exact: true }).click();
    await page.getByLabel("Customer or company name").fill("New Contact Customer");
  } else {
    await page.getByRole("textbox", { name: "Search customers" }).fill("Contact Regression");
    await page.locator('[aria-label="Customer search results"] button').click();
    await page.getByRole("button", { name: "Add site", exact: true }).click();
  }
  await page.getByLabel(newCustomer ? "Primary site address" : "Site address", { exact: true }).fill("2 New Street, Melbourne VIC 3000");
  await expect(siteEditor(page)).toBeVisible();
  return siteEditor(page);
}

test("Site Contact accepts real spacebar presses, editable role-first drafts and full names", async ({ page }) => {
  const editor = await openSiteContact(page, { newCustomer: true });
  const name = editor.getByLabel("Name", { exact: true });
  const role = editor.getByLabel("Role", { exact: true });
  await role.fill("");
  await expect(role).toHaveValue("");
  await role.pressSequentially("Building Manager");
  for (const fullName of ["John Smith", "Mary Jane Brown", "A B Services", "A  B Services"]) {
    await name.fill("");
    await name.pressSequentially(fullName);
    await expect(name).toHaveValue(fullName);
    await expect(name).toBeFocused();
    await expect(role).toHaveValue("Building Manager");
  }
  await name.fill("John");
  await name.press("Space");
  await expect(name).toHaveValue("John ");
  await name.pressSequentially("Smith");
  await expect(name).toHaveValue("John Smith");
});

test("Site Contact keyboard selection populates new values and preserves edited roles on refresh", async ({ page }) => {
  const editor = await openSiteContact(page);
  const picker = editor.getByRole("combobox", { name: "Saved customer contact" });
  await picker.focus();
  await picker.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("John Smith");
  await expect(editor.getByLabel("Role", { exact: true })).toHaveValue("Caretaker");
  await editor.getByLabel("Role", { exact: true }).fill("");
  await editor.getByLabel("Role", { exact: true }).pressSequentially("Site Manager");
  await page.getByLabel("Job title").fill("Unrelated draft edit");
  await page.getByRole("button", { name: "Refresh customer records" }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("John Smith");
  await expect(editor.getByLabel("Role", { exact: true })).toHaveValue("Site Manager");
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("2 New Street, Melbourne VIC 3000");
  await picker.click();
  await page.getByRole("option", { name: "Mary Jane Brown - Reception", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Mary Jane Brown");
  await expect(editor.getByLabel("Role", { exact: true })).toHaveValue("Reception");
  await picker.focus();
  await picker.press("ArrowUp");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Mary Jane Brown");
  await expect(editor.getByLabel("Role", { exact: true })).toHaveValue("Reception");
});

test("Create Job submits the latest Site Contact name and job-specific role without editing the master contact", async ({ page }) => {
  const editor = await openSiteContact(page);
  await editor.getByRole("combobox", { name: "Saved customer contact" }).click();
  await page.getByRole("option", { name: "John Smith - Caretaker", exact: true }).click();
  await editor.getByLabel("Role", { exact: true }).fill(" Site Manager ");
  await editor.getByLabel("Name", { exact: true }).fill(" Mary  Jane Brown ");
  await page.getByLabel("Job title").fill("Contact snapshot job");
  await page.getByLabel("Description of work").fill("Keep the edited contact snapshot.");
  await page.getByRole("button", { name: "Create Job", exact: true }).click();
  const payload = JSON.parse(await page.getByLabel("Created Job payload").textContent());
  expect(payload.job.onsiteContact).toMatchObject({ name: "Mary  Jane Brown", role: "Site Manager" });
  expect(payload.job.onsiteContact.id).not.toBe("contact-a");
  expect(payload.siteInput.contactId).toBe("");
  expect(payload.siteInput.contactRole).toBeUndefined();
  expect(payload.customer.contacts.find((contact) => contact.id === "contact-a")).toMatchObject({ name: "John Smith", role: "Caretaker" });
});

test("Create Job accepts a new free-text contact and retains an explicit on-site contact override", async ({ page }) => {
  const editor = await openSiteContact(page, { newCustomer: true });
  await editor.getByLabel("Name", { exact: true }).pressSequentially("John Smith");
  await editor.getByLabel("Role", { exact: true }).fill("Building Manager");
  await page.getByLabel("Job title").fill("New contact job");
  await page.getByLabel("Description of work").fill("Keep the new contact details.");
  await page.getByRole("button", { name: "Create Job", exact: true }).click();
  const payload = JSON.parse(await page.getByLabel("Created Job payload").textContent());
  expect(payload.job.onsiteContact).toMatchObject({ name: "John Smith", role: "Building Manager" });
  await page.getByText("Job contacts (optional)", { exact: true }).click();
  const override = page.locator(".contact-snapshot-editor").filter({ has: page.getByText("On-site contact", { exact: true }) });
  await override.getByLabel("Name", { exact: true }).pressSequentially("Other Contact");
  await override.getByLabel("Role", { exact: true }).fill("Technician");
  await page.getByRole("button", { name: "Create Job", exact: true }).click();
  expect(JSON.parse(await page.getByLabel("Created Job payload").textContent()).job.onsiteContact).toMatchObject({ name: "Other Contact", role: "Technician" });
});
