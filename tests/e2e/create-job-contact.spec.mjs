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


const siteEditor = (page) => page.locator('#create-job-site [aria-label="Site contact management"]');
async function openSiteContact(page, { newCustomer = false } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ json: { results: [] } }));
  await page.goto(baseUrl + "/__contact-regression");
  if (newCustomer) {
    await page.getByRole("button", { name: "Add New Customer", exact: true }).click();
    await page.getByLabel("Customer or company name").fill("New Contact Customer");
  } else {
    await page.getByRole("textbox", { name: "Search customers" }).fill("Contact Regression");
    await page.locator('[aria-label="Customer search results"] button').click();
    await page.getByRole("button", { name: "Add site", exact: true }).click();
  }
  await page.getByLabel(newCustomer ? "Primary site address" : "Site address", { exact: true }).fill("2 New Street, Melbourne VIC 3000");
  await siteEditor(page).getByRole("button", { name: "Add Contact", exact: true }).click();
  return siteEditor(page);
}
async function newPerson(editor) {
  await editor.getByRole("button", { name: "New contact", exact: true }).click();
  await editor.getByRole("checkbox", { name: "Primary contact" }).check();
}
async function submit(page) {
  await page.getByLabel("Job title").fill("Contact snapshot job");
  await page.getByLabel("Description of work").fill("Keep the latest contact details.");
  await page.getByRole("button", { name: "Create Job", exact: true }).click();
  return JSON.parse(await page.getByLabel("Created Job payload").textContent());
}
test("new site contact accepts real spacebar presses, positions and custom roles", async ({ page }) => {
  const editor = await openSiteContact(page, { newCustomer: true }); await newPerson(editor);
  await editor.getByLabel("Position", { exact: true }).pressSequentially("Facilities Manager");
  const name = editor.getByLabel("Name", { exact: true });
  for (const fullName of ["John Smith", "Mary Jane Brown", "A B Services", "A  B Services"]) {
    await name.fill(""); await name.pressSequentially(fullName); await expect(name).toHaveValue(fullName); await expect(name).toBeFocused();
  }
  await name.fill("John"); await name.press("Space"); await expect(name).toHaveValue("John "); await name.pressSequentially("Smith");
  await editor.getByLabel("Roles at this site").pressSequentially("Caretaker, Building Manager");
  const payload = await submit(page);
  expect(payload.siteInput.contactAssignments[0].roles).toEqual(["Caretaker", "Building Manager"]);
  expect(payload.job.onsiteContact).toMatchObject({ name: "John Smith", position: "Facilities Manager", role: "Caretaker, Building Manager" });
});
test("existing site contact can be selected by keyboard without duplicating its identity and survives a refresh", async ({ page }) => {
  const editor = await openSiteContact(page);
  const search = editor.getByRole("combobox", { name: "Search contacts" });
  await search.fill("John"); await search.press("ArrowDown"); await search.press("Enter");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("John Smith");
  await editor.getByLabel("Roles at this site").fill("Site Manager");
  await editor.getByRole("checkbox", { name: "Primary contact" }).check();
  await page.getByRole("button", { name: "Refresh customer records" }).click();
  await expect(editor.getByLabel("Roles at this site")).toHaveValue("Site Manager");
  const payload = await submit(page);
  expect(payload.siteInput.contactAssignments[0]).toMatchObject({ contactId: "contact-a", roles: ["Site Manager"], isPrimary: true });
  expect(payload.siteInput.contactAssignments[0].contact).toBeUndefined();
  expect(payload.job.onsiteContact).toMatchObject({ id: "contact-a", name: "John Smith", role: "Site Manager" });
});
test("editing a job contact creates a custom snapshot and leaves the site assignment unchanged", async ({ page }) => {
  const editor = await openSiteContact(page);
  await editor.getByRole("combobox", { name: "Search contacts" }).click();
  await editor.getByRole("option", { name: /John Smith/ }).click();
  await editor.getByRole("checkbox", { name: "Primary contact" }).check();
  await page.getByText("Job contacts (optional)", { exact: true }).click();
  const onsite = page.getByRole("region", { name: "On-site contact", exact: true });
  await onsite.getByRole("combobox").click(); await page.getByRole("option", { name: /John Smith/ }).click();
  await onsite.getByLabel("Name", { exact: true }).fill(" Mary  Jane Brown ");
  await onsite.getByLabel("Role", { exact: true }).fill("Temporary access contact");
  const payload = await submit(page);
  expect(payload.job.onsiteContact).toMatchObject({ name: "Mary  Jane Brown", role: "Temporary access contact" });
  expect(payload.job.onsiteContact.id).not.toBe("contact-a");
  expect(payload.siteInput.contactAssignments[0].contactId).toBe("contact-a");
  expect(payload.customer.contacts.find((contact) => contact.id === "contact-a").name).toBe("John Smith");
});
test("new site can have no contacts and requester stays independently selectable", async ({ page }) => {
  const editor = await openSiteContact(page, { newCustomer: true }); await editor.getByRole("button", { name: "Cancel adding" }).click();
  await page.getByText("Job contacts (optional)", { exact: true }).click();
  await page.getByRole("region", { name: "Requester", exact: true }).getByLabel("Name", { exact: true }).fill("Independent Requester");
  const payload = await submit(page); expect(payload.siteInput.contactAssignments).toEqual([]); expect(payload.job.onsiteContact).toBeNull();
  expect(payload.job.requesterContact.name).toBe("Independent Requester");
});
