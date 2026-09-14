import { test, expect } from "@playwright/test";
import { createServer, loadEnv } from "vite";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { openWorkspaceDb } from "../../server-workspace-db.js";
import { importWorkspaceJsonData } from "../../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../../server-workspace-state.js";
import { createCustomer, createCustomerSite, updateCustomerSite, updateCustomer } from "../../server-workspace-customers.js";
import { themePresets } from "../../src/lib/theme-presets.js";
import { normalizeStoredData } from "../../server-store.js";
import { createJob, updateJobDetails } from "../../server-workspace-jobs.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shots = path.join(root, "test-results/google-places");
const routeShots = path.join(root, "test-results/google-address-route-fix");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
const customerId = fixture.customers[0].id;
const primaryId = fixture.customers[0].sites[0].id;
const selected = { address: "14 Sesame Street, Caroline Springs VIC 3023", streetAddress: "14 Sesame Street", suburb: "Caroline Springs", state: "VIC", postcode: "3023", latitude: -37.7305, longitude: 144.7428 };
let server, baseUrl, missingKeyServer, missingKeyUrl, db;
test.use({ trace: "off", video: "off" });
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
test.beforeAll(async () => {
  fs.mkdirSync(shots, { recursive: true });
  fs.mkdirSync(routeShots, { recursive: true });
  server = await createServer({ root, cacheDir: "node_modules/.vite-places-tests", logLevel: "error",
    define: { "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify("places-test-placeholder") },
    server: { host: "localhost", port: await freePort(), strictPort: true } });
  await server.listen(); baseUrl = server.resolvedUrls.local[0].replace(/\/$/, "");
  missingKeyServer = await createServer({ root, cacheDir: "node_modules/.vite-places-missing-key-tests", logLevel: "error",
    define: { "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify("") },
    server: { host: "localhost", port: await freePort(), strictPort: true } });
  await missingKeyServer.listen(); missingKeyUrl = missingKeyServer.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => { await missingKeyServer?.close(); await server?.close(); });
test.afterEach(() => { db?.close(); db = null; });

async function workspace(page, { mode = "sqlite", midnight = false } = {}) {
  db = openWorkspaceDb({ dbPath: ":memory:" });
  const data = structuredClone(fixture);
  const primary = data.customers[0].sites[0];
  Object.assign(primary, { latitude: -37.8136, longitude: 144.9631, streetAddress: "Existing street", suburb: "South Melbourne", state: "VIC", postcode: "3205" });
  importWorkspaceJsonData(db, data);
  let state = loadWorkspaceStateFromDb(db);
  const calls = [];
  const preferences = midnight ? themePresets.find((theme) => theme.id === "midnight-signal").values : {};
  await page.route("**/api/**", async (route) => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    calls.push(`${req.method()} ${pathname}`);
    if (req.method() === "GET") {
      const json = pathname === "/api/auth/me" ? { user: { id: "places-test", name: "Places Test", role: "admin" } }
        : pathname === "/api/app-state" ? { state, storageMode: mode }
          : pathname === "/api/user-preferences" ? { preferences }
            : pathname === "/api/map/locations" ? { source: "saved-site-coordinates", results: [] }
              : pathname === "/api/admin/user-accounts" ? { users: [] } : null;
      if (json) return route.fulfill({ json });
    }
    if (mode === "json" && req.method() === "PUT" && pathname === "/api/app-state") {
      state = normalizeStoredData(req.postDataJSON());
      return route.fulfill({ json: { ok: true, state } });
    }
    if (mode === "sqlite" && req.method() === "POST" && pathname === "/api/jobs") {
      const result = createJob(db, req.postDataJSON());
      state = loadWorkspaceStateFromDb(db);
      return route.fulfill({ json: { ok: true, result, state } });
    }
    if (mode === "sqlite" && req.method() === "PATCH" && /^\/api\/jobs\/[^/]+$/.test(pathname)) {
      const body = req.postDataJSON();
      const result = updateJobDetails(db, pathname.split("/").at(-1), body.job || body);
      state = loadWorkspaceStateFromDb(db);
      return route.fulfill({ json: { ok: true, result, state } });
    }
    const match = pathname.match(/^\/api\/customers(?:\/([^/]+))?(?:\/sites(?:\/([^/]+))?)?$/);
    if (mode === "sqlite" && match && ["POST", "PATCH"].includes(req.method())) {
      const body = req.postDataJSON();
      const result = pathname.includes("/sites")
        ? match[2] ? updateCustomerSite(db, match[1], match[2], body.site) : createCustomerSite(db, match[1], body.site)
        : match[1] ? updateCustomer(db, match[1], body.customer) : createCustomer(db, body.customer);
      state = loadWorkspaceStateFromDb(db);
      return route.fulfill({ json: { ok: true, result, state } });
    }
    return route.fulfill({ status: 418, json: { error: "Unexpected test API call" } });
  });
  return { calls, state: () => state, refresh: () => { state = loadWorkspaceStateFromDb(db); } };
}

async function mockPlaces(page, { fail = false, detailsDelay = 0, realMap = false } = {}) {
  await page.addInitScript(({ fail, detailsDelay, realMap }) => {
    if (realMap && location.pathname === "/map") return;
    window.placesCalls = { queries: [], details: [], libraries: [], tokens: 0 };
    class AutocompleteSessionToken { constructor() { this.id = ++window.placesCalls.tokens; } }
    const AutocompleteSuggestion = { async fetchAutocompleteSuggestions(request) {
      window.placesCalls.queries.push({ ...request, sessionToken: request.sessionToken.id });
      if (fail) throw new Error("Provider unavailable");
      const isUnit = /unit/i.test(request.input);
      const isGarr = /^33 garr/i.test(request.input);
      const isOther = /brighton/i.test(request.input);
      const suburb = isOther ? "Brighton East" : "Caroline Springs";
      const address = isGarr ? `33 Garrard Street, ${suburb} VIC 3023` : `${isUnit ? "Unit 4/" : ""}14 Sesame Street, ${suburb} VIC 3023`;
      const prediction = { placeId: `${suburb}-${isUnit}`, text: { toString: () => address }, toPlace() {
        return { async fetchFields(options) {
          window.placesCalls.details.push(options);
          if (detailsDelay) await new Promise((resolve) => setTimeout(resolve, detailsDelay));
          this.addressComponents = [["street_number", isGarr ? "33" : "14"], ["route", isGarr ? "Garrard Street" : "Sesame Street"], ["locality", suburb],
            ["administrative_area_level_1", "VIC"], ["postal_code", "3023"], ["country", "AU"], ...(isUnit ? [["subpremise", "4"]] : [])]
            .map(([type, text]) => ({ types: [type], longText: text, shortText: text }));
          this.location = { lat: () => isOther ? -37.91 : -37.7305, lng: () => isOther ? 145.01 : 144.7428 };
        } };
      } };
      return { suggestions: [{ placePrediction: prediction }] };
    } };
    window.google = { maps: { importLibrary: async (library) => {
      window.placesCalls.libraries.push(library);
      return { AutocompleteSessionToken, AutocompleteSuggestion };
    } } };
  }, { fail, detailsDelay, realMap });
}

async function choose(page, query = "14 Sesa", { touch = false } = {}) {
  const input = page.getByRole("combobox", { name: "Address", exact: true });
  await input.fill(query);
  const option = page.getByRole("option").filter({ hasText: "Sesame Street" });
  await expect(option).toBeVisible();
  if (touch) await option.getByRole("button").tap();
  else { await input.press("ArrowDown"); await input.press("Enter"); }
  await expect(page.getByRole("status").filter({ hasText: "Address selected" })).toBeVisible();
}

for (const mode of ["selection", "missing-key", "unavailable"]) test(`Job Details address editor uses Google and preserves Site coordinates: ${mode}`, async ({ page }) => {
  const app = await workspace(page);
  if (mode !== "missing-key") await mockPlaces(page, { fail: mode === "unavailable", detailsDelay: 600 });
  const customersBefore = structuredClone(app.state().customers);
  const job = app.state().jobs[0];
  const origin = mode === "missing-key" ? missingKeyUrl : baseUrl;
  await page.goto(`${origin}/jobs/${job.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Site address", exact: true });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  let address = "Manual fixture job address";
  await input.fill(mode === "selection" ? "14 Sesa" : address);
  if (mode === "selection") {
    await expect(page.getByRole("option")).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(save).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "Address selected" })).toBeVisible();
    address = selected.address;
  } else {
    await expect(page.getByRole("status").filter({ hasText: mode === "missing-key" ? "VITE_GOOGLE_MAPS_API_KEY" : "Google Places address lookup could not be loaded" })).toBeVisible();
  }
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  expect(app.state().jobs.find((entry) => entry.id === job.id).jobAddress).toBe(address);
  expect(app.state().customers).toEqual(customersBefore);
  expect(app.calls.filter((call) => call.startsWith("PATCH "))).toEqual([`PATCH /api/jobs/${job.id}`]);
  expect(app.calls.some((call) => /address\/autocomplete|map\/geocode/.test(call))).toBe(false);
});

for (const mode of ["sqlite", "json"]) test(`Create Customer saves primary Site metadata through ${mode} and survives reload`, async ({ page }) => {
  const app = await workspace(page, { mode }); await mockPlaces(page);
  await page.goto(`${baseUrl}/customers/new`);
  await page.getByLabel("Customer / company name").fill(`Places Customer ${mode}`);
  await choose(page);
  await page.screenshot({ path: path.join(shots, `customer-selected-${mode}.png`), fullPage: true });
  await page.getByRole("button", { name: "Create Customer", exact: true }).click();
  await expect.poll(() => app.state().customers.find((c) => c.name === `Places Customer ${mode}`)?.sites[0]?.latitude).toBe(selected.latitude);
  const customer = app.state().customers.find((c) => c.name === `Places Customer ${mode}`);
  expect(customer.sites[0]).toMatchObject(selected);
  expect(customer.latitude).toBeUndefined();
  expect(app.calls.some((call) => /address\/autocomplete|map\/geocode/.test(call))).toBe(false);
  await page.reload();
  await page.goto(`${baseUrl}/customers/${customer.id}/sites/${customer.sites[0].id}/edit`);
  await expect(page.getByRole("combobox", { name: "Address", exact: true })).toHaveValue(selected.address);
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  expect(app.state().customers.find((c) => c.id === customer.id).sites[0]).toMatchObject(selected);
});

test("Create/Edit Site updates coordinates, retains existing Sites, and invalidates a manual address", async ({ page }) => {
  const app = await workspace(page); await mockPlaces(page);
  const original = structuredClone(app.state().customers.find((c) => c.id === customerId).sites);
  await page.goto(`${baseUrl}/customers/${customerId}/sites/${primaryId}/edit`);
  await expect(page.getByRole("combobox", { name: "Address", exact: true })).toHaveValue(original[0].address);
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  // Existing save semantics materialize a contact ID from the contact snapshot.
  const preserved = ({ updatedAt: _updatedAt, contactId: _contactId, ...fields }) => fields;
  expect(app.state().customers.find((c) => c.id === customerId).sites[0]).toMatchObject(preserved(original[0]));
  expect(await page.evaluate(() => window.placesCalls.queries)).toHaveLength(0);
  await page.goto(`${baseUrl}/customers/${customerId}/sites/new`);
  await choose(page);
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  const site = app.state().customers.find((c) => c.id === customerId).sites.find((s) => s.address === selected.address);
  expect(site).toMatchObject(selected);
  for (const previous of original) expect(app.state().customers.find((c) => c.id === customerId).sites.find((s) => s.id === previous.id)).toMatchObject(preserved(previous));
  await page.reload();
  await page.getByRole("button", { name: "Edit Site Profile", exact: true }).click();
  await choose(page, "14 Brighton");
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  expect(app.state().customers.find((c) => c.id === customerId).sites.find((s) => s.id === site.id)).toMatchObject({ suburb: "Brighton East", latitude: -37.91, longitude: 145.01 });
  await page.screenshot({ path: path.join(shots, "site-edited.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit Site Profile", exact: true }).click();
  await page.getByRole("combobox", { name: "Address", exact: true }).fill("PO Box 41, South Melbourne VIC 3205");
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  expect(app.state().customers.find((c) => c.id === customerId).sites.find((s) => s.id === site.id)).toMatchObject({ latitude: null, longitude: null, suburb: "", address: "PO Box 41, South Melbourne VIC 3205" });
});

test("Google unavailable leaves manual save usable", async ({ page }) => {
  const app = await workspace(page); await mockPlaces(page, { fail: true });
  await page.goto(`${baseUrl}/customers/${customerId}/sites/new`);
  await page.getByRole("combobox", { name: "Address", exact: true }).fill("PO Box 41, South Melbourne VIC 3205");
  await expect(page.getByRole("status").filter({ hasText: "Google Places address lookup could not be loaded" })).toBeVisible();
  await page.screenshot({ path: path.join(shots, "manual-fallback.png"), fullPage: true });
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  expect(app.state().customers.find((c) => c.id === customerId).sites.find((s) => s.address.startsWith("PO Box"))).toMatchObject({ latitude: null, longitude: null });
});

test("keyboard, threshold, debounce, sessions and stale Details responses are safe", async ({ page }) => {
  await workspace(page); await mockPlaces(page, { detailsDelay: 800 });
  await page.goto(`${baseUrl}/customers/new`);
  await page.getByLabel("Customer / company name").fill("Keyboard test");
  const input = page.getByRole("combobox", { name: "Address", exact: true });
  await input.fill("14"); await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.placesCalls.queries.length)).toBe(0);
  await input.press("Space"); await expect(input).toHaveValue("14 ");
  await input.pressSequentially("Sesa", { delay: 15 });
  await expect(page.getByRole("option")).toBeVisible();
  await input.press("ArrowUp"); await expect(page.getByRole("option")).toHaveAttribute("aria-selected", "true");
  await input.press("Escape"); await expect(page.getByRole("option")).toHaveCount(0);
  await input.fill("14 Sesame"); await expect(page.getByRole("option")).toBeVisible();
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Create Customer", exact: true })).toBeDisabled();
  await input.fill("Manual replacement"); await input.press("Escape"); await page.waitForTimeout(900);
  await expect(input).toHaveValue("Manual replacement");
  await expect(page.getByRole("button", { name: "Create Customer", exact: true })).toBeEnabled();
  await choose(page);
  const calls = await page.evaluate(() => window.placesCalls);
  expect(calls.queries).toHaveLength(3);
  expect(new Set(calls.queries.map((query) => query.sessionToken)).size).toBe(3);
  expect(calls.queries.every((q) => q.includedRegionCodes.join() === "au" && q.locationBias.radius === 50000)).toBe(true);
  expect(calls.details).toHaveLength(2);
  expect(calls.details[0].fields).toEqual(["addressComponents", "location"]);
  expect(calls.libraries).toEqual(["places"]);
});

test("mobile touch unit selection and Midnight Signal suggestions fit the viewport", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const app = await workspace(page, { midnight: true }); await mockPlaces(page);
    await page.goto(`${baseUrl}/customers/${customerId}/sites/new`);
    await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
    await page.getByRole("combobox", { name: "Address", exact: true }).fill("Unit 4/14 Sesa");
    await expect(page.getByRole("option")).toBeVisible();
    await page.getByRole("option").scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const colors = await page.locator('[data-google-address-picker] .theme-popup').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    expect(colors.bg).not.toBe("rgb(255, 255, 255)");
    await expect(page.getByText("Google Maps", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(shots, "mobile-midnight-suggestions-390x844.png"), fullPage: true });
    await page.getByRole("option").getByRole("button").tap();
    await expect(page.getByRole("status").filter({ hasText: "Address selected" })).toBeVisible();
    await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
    expect(app.state().customers.find((c) => c.id === customerId).sites.find((s) => s.address.startsWith("Unit 4/"))).toMatchObject({ streetAddress: "Unit 4/14 Sesame Street", suburb: "Caroline Springs", latitude: selected.latitude });
  } finally { await context.close(); }
});

test("live Places selection saves a Site and its job maps without geocoding", async ({ page }) => {
  test.skip(process.env.ELSET_GOOGLE_PLACES_LIVE_TEST !== "1", "Opt in to the configured local Google service");
  const key = loadEnv("development", root, "VITE_").VITE_GOOGLE_MAPS_API_KEY;
  expect(Boolean(key)).toBe(true);
  let keyLogged = false;
  const providerErrors = new Set();
  const diagnostics = [];
  const geocoding = [];
  page.on("console", (message) => {
    if (message.text().includes(key)) keyLogged = true;
    if (["error", "warning"].includes(message.type())) diagnostics.push(message.text().replaceAll(key, "[redacted]").replace(/https?:\/\/\S+/g, "[provider URL]").slice(0, 800));
    const code = message.text().match(/\b(?:[A-Za-z]+NotActivated|RefererNotAllowed|ApiNotActivated|ApiTargetBlocked|InvalidKey|BillingNotEnabled)MapError\b/);
    if (code) providerErrors.add(code[0]);
  });
  page.on("request", (request) => { const url = new URL(request.url()); if (/googleapis\.com$/.test(url.hostname) && /geocod/i.test(url.pathname)) geocoding.push(url.pathname); });
  page.on("response", async (response) => {
    if (response.status() < 400 || !/googleapis\.com$/.test(new URL(response.url()).hostname)) return;
    const body = await response.text().catch(() => "Unreadable provider response");
    diagnostics.push(JSON.stringify({ host: new URL(response.url()).hostname, path: new URL(response.url()).pathname, status: response.status(), body: body.replaceAll(key, "[redacted]").replace(/https?:\/\/\S+/g, "[provider URL]").replace(/projects\/\d+/g, "projects/[redacted]").slice(0, 1500) }));
  });
  const app = await workspace(page);
  const liveUrl = process.env.ELSET_GOOGLE_PLACES_TEST_URL || "http://localhost:5173";
  await page.goto(`${liveUrl}/customers/${customerId}/sites/new`);
  await page.getByRole("combobox", { name: "Address", exact: true }).fill("200 Queen Street Melbourne");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 25000 }).catch(async (error) => {
    await page.screenshot({ path: path.join(shots, "live-google-unavailable.png"), fullPage: true });
    fs.writeFileSync(path.join(shots, "live-diagnostics.json"), JSON.stringify({ diagnostics, providerErrors: [...providerErrors], keyLogged }, null, 2));
    throw error;
  });
  await page.screenshot({ path: path.join(shots, "live-google-suggestions-1440x900.png"), fullPage: true });
  await page.getByRole("option").first().getByRole("button").click();
  await expect(page.getByRole("status").filter({ hasText: "Address selected" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  const site = app.state().customers.find((c) => c.id === customerId).sites.find((s) => /200 Queen/i.test(s.address));
  expect(site).toMatchObject({ streetAddress: "200 Queen Street", suburb: "Melbourne", state: "VIC", postcode: "3000" });
  expect(site.latitude).toBeGreaterThan(-39); expect(site.latitude).toBeLessThan(-37);
  expect(site.longitude).toBeGreaterThan(144); expect(site.longitude).toBeLessThan(146);
  db.prepare("UPDATE jobs SET job_address = ? WHERE id = ?").run(site.address, fixture.jobs[0].id);
  app.refresh();
  await page.goto(`${liveUrl}/map`);
  await expect(page.locator('[data-google-map-canvas]')).toHaveAttribute("data-map-ready", "true", { timeout: 30000 });
  await expect(page.locator('.google-test-status')).toHaveAttribute("data-eligible-count", "1");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(shots, "live-saved-site-map-1440x900.png"), fullPage: true });
  expect(geocoding).toHaveLength(0);
  expect(app.calls.some((call) => /address\/autocomplete|map\/geocode/.test(call))).toBe(false);
  expect(providerErrors.size).toBe(0); expect(keyLogged).toBe(false);
  fs.writeFileSync(path.join(shots, "live-result.json"), JSON.stringify({ address: site.address, streetAddress: site.streetAddress, suburb: site.suburb, state: site.state, postcode: site.postcode, latitude: site.latitude, longitude: site.longitude, geocodingRequests: geocoding.length, keyLogged }, null, 2));
});

test("a saved Places fixture renders on live Google Maps without a geocoding call", async ({ page }) => {
  test.skip(process.env.ELSET_GOOGLE_PLACES_LIVE_TEST !== "1", "Opt in to the configured local Google map");
  const app = await workspace(page); await mockPlaces(page, { realMap: true });
  const liveUrl = process.env.ELSET_GOOGLE_PLACES_TEST_URL || "http://localhost:5173";
  await page.goto(`${liveUrl}/customers/${customerId}/sites/new`);
  await choose(page);
  await page.getByRole("button", { name: "Save Site Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Site Profile", exact: true })).toBeVisible();
  const site = app.state().customers.find((c) => c.id === customerId).sites.find((s) => s.address === selected.address);
  expect(site).toMatchObject(selected);
  db.prepare("UPDATE jobs SET job_address = ? WHERE id = ?").run(site.address, fixture.jobs[0].id); app.refresh();
  await page.goto(`${liveUrl}/map`);
  await expect(page.locator('[data-google-map-canvas]')).toHaveAttribute("data-map-ready", "true", { timeout: 30000 });
  await expect(page.locator('.google-test-status')).toHaveAttribute("data-eligible-count", "1");
  await expect(page.locator('.google-test-pin')).toBeVisible();
  await page.locator('.google-test-pin').click();
  await expect(page.getByRole("complementary", { name: "Map job details" })).toContainText(selected.address);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(shots, "saved-places-fixture-live-map.png"), fullPage: true });
  expect(app.calls.some((call) => /address\/autocomplete|map\/geocode/.test(call))).toBe(false);
});


for (const flow of ['create-customer', 'edit-customer-site-link', 'create-site', 'edit-site']) test('active address route uses Google without a server autocomplete dependency: ' + flow, async ({ page }) => {
  const app = await workspace(page); await mockPlaces(page);
  let legacyRequests = 0;
  await page.route('**/api/address/autocomplete?**', (route) => {
    legacyRequests += 1;
    return route.fulfill({ status: 503, json: { error: 'Retired endpoint must not be called.' } });
  });
  const activeUrl = process.env.ELSET_GOOGLE_PLACES_ACTIVE_URL || baseUrl;
  if (flow === 'create-customer') {
    await page.goto(activeUrl + '/customers');
    await page.getByRole('button', { name: 'New Customer', exact: true }).click();
    await expect(page).toHaveURL(activeUrl + '/customers/new');
  } else if (flow === 'edit-customer-site-link') {
    await page.goto(activeUrl + '/customers/' + customerId + '/edit');
    await expect(page.getByRole('form', { name: 'Edit Customer' })).toBeVisible();
    await expect(page.locator('[data-google-address-picker]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Site Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Site Profile', exact: true }).click();
  } else {
    await page.goto(activeUrl + '/customers/' + customerId + '/sites/' + (flow === 'create-site' ? 'new' : primaryId + '/edit'));
  }
  await expect(page.locator('[data-google-address-picker]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Address', exact: true }).fill('33 garr');
  await expect(page.getByRole('option')).toContainText('33 Garrard Street');
  await expect(page.getByText('Google Maps', { exact: true })).toBeVisible();
  expect(legacyRequests).toBe(0);
  expect(app.calls.some((call) => call.includes('/api/address/autocomplete'))).toBe(false);
  expect(await page.evaluate(() => window.placesCalls.queries.at(-1).input)).toBe('33 garr');
  await page.screenshot({ path: path.join(routeShots, flow + '.png'), fullPage: true });
});

test('missing Google key names the Vite variable and allows Customer and Site manual saves', async ({ page }) => {
  const app = await workspace(page);
  let googleRequests = 0;
  page.on('request', (request) => { if (new URL(request.url()).hostname.endsWith('googleapis.com')) googleRequests += 1; });
  await page.goto(missingKeyUrl + '/customers/new');
  await page.getByLabel('Customer / company name').fill('Missing Google key fixture');
  await page.getByRole('combobox', { name: 'Address', exact: true }).fill('33 garr');
  await expect(page.getByRole('status').filter({ hasText: 'Google address lookup is not configured.' })).toContainText('VITE_GOOGLE_MAPS_API_KEY');
  await page.screenshot({ path: path.join(routeShots, 'missing-google-key.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create Customer', exact: true }).click();
  await expect.poll(() => app.state().customers.some((customer) => customer.name === 'Missing Google key fixture')).toBe(true);
  await page.goto(missingKeyUrl + '/customers/' + customerId + '/sites/new');
  await page.getByRole('combobox', { name: 'Address', exact: true }).fill('Manual Site without a provider');
  await expect(page.getByRole('status').filter({ hasText: 'Google address lookup is not configured.' })).toContainText('VITE_GOOGLE_MAPS_API_KEY');
  await page.getByRole('button', { name: 'Save Site Profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Site Profile', exact: true })).toBeVisible();
  expect(googleRequests).toBe(0);
  expect(app.calls.some((call) => call.includes('/api/address/autocomplete'))).toBe(false);
});

for (const customerMode of ['new', 'existing']) test('embedded Customer/Site creation uses Google: ' + customerMode, async ({ page }) => {
  const app = await workspace(page); await mockPlaces(page);
  let legacyRequests = 0;
  await page.route('**/api/address/autocomplete?**', (route) => {
    legacyRequests += 1;
    return route.fulfill({ status: 503, json: { error: 'Retired endpoint must not be called.' } });
  });
  const activeUrl = process.env.ELSET_GOOGLE_PLACES_ACTIVE_URL || baseUrl;
  await page.goto(activeUrl + '/jobs/new');
  if (customerMode === 'new') await page.getByRole('button', { name: 'Add New Customer', exact: true }).click();
  else {
    await page.getByLabel('Search customers', { exact: true }).fill('Arcadia');
    await page.getByRole('button', { name: /Arcadia Example Apartments/ }).click();
    await page.getByRole('button', { name: 'Change site', exact: true }).click();
    await page.getByRole('button', { name: 'Add a new site', exact: true }).click();
  }
  await page.getByLabel(customerMode === 'new' ? 'Primary site address' : 'Site address', { exact: true }).fill('33 garr');
  try {
    await expect(page.getByRole('option')).toContainText('33 Garrard Street');
    expect(legacyRequests).toBe(0);
  } finally {
    await page.screenshot({ path: path.join(routeShots, 'embedded-' + customerMode + (legacyRequests ? '-before-fix' : '-google') + '.png'), fullPage: true });
  }
  await page.getByRole('option').getByRole('button').click();
  await expect(page.getByRole('status').filter({ hasText: 'Address selected' })).toBeVisible();
  if (customerMode === 'new') await page.getByLabel('Customer or company name', { exact: true }).fill('Embedded Places Customer');
  await page.getByLabel('Job title', { exact: true }).fill('Embedded site fixture');
  await page.getByLabel('Description of work', { exact: true }).fill('Test only: verify Site metadata survives the existing save path.');
  await page.getByRole('button', { name: 'Create Job', exact: true }).click();
  await expect.poll(() => app.state().jobs.some((job) => job.title === 'Embedded site fixture')).toBe(true);
  const savedCustomer = app.state().customers.find((customer) => customerMode === 'new' ? customer.name === 'Embedded Places Customer' : customer.id === customerId);
  expect(savedCustomer.sites.find((site) => site.streetAddress === '33 Garrard Street')).toMatchObject({ suburb: 'Caroline Springs', state: 'VIC', postcode: '3023', latitude: selected.latitude, longitude: selected.longitude });
  expect(legacyRequests).toBe(0);
});

for (const flow of ['Create Customer', 'Create Site', 'Edit Customer Site link', 'Edit Site', 'Embedded New Customer', 'Embedded New Site']) test('live active ' + flow + ' searches 33 garr through Google', async ({ page }) => {
  test.skip(process.env.ELSET_GOOGLE_PLACES_LIVE_TEST !== '1', 'Opt in to the configured local Google service');
  const app = await workspace(page);
  const provider = [];
  page.on('response', async (response) => {
    if (new URL(response.url()).hostname !== 'places.googleapis.com') return;
    const body = await response.text().catch(() => '');
    provider.push({ status: response.status(), serviceDisabled: body.includes('SERVICE_DISABLED') });
  });
  const activeUrl = process.env.ELSET_GOOGLE_PLACES_ACTIVE_URL || 'http://localhost:5173';
  if (flow === 'Create Customer') {
    await page.goto(activeUrl + '/customers');
    await page.getByRole('button', { name: 'New Customer', exact: true }).click();
  } else if (flow === 'Edit Customer Site link') {
    await page.goto(activeUrl + '/customers/' + customerId + '/edit');
    await page.getByRole('button', { name: 'Open Site Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Site Profile', exact: true }).click();
  } else if (flow.startsWith('Embedded')) {
    await page.goto(activeUrl + '/jobs/new');
    if (flow === 'Embedded New Customer') await page.getByRole('button', { name: 'Add New Customer', exact: true }).click();
    else {
      await page.getByLabel('Search customers', { exact: true }).fill('Arcadia');
      await page.getByRole('button', { name: /Arcadia Example Apartments/ }).click();
      await page.getByRole('button', { name: 'Change site', exact: true }).click();
      await page.getByRole('button', { name: 'Add a new site', exact: true }).click();
    }
  } else {
    await page.goto(activeUrl + '/customers/' + customerId + '/sites/' + (flow === 'Create Site' ? 'new' : primaryId + '/edit'));
  }
  await page.locator('[data-google-address-picker] input').fill('33 garr');
  try {
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: path.join(routeShots, 'live-' + flow.replaceAll(' ', '-').toLowerCase() + '-33-garr.png'), fullPage: true });
  } finally {
    fs.writeFileSync(path.join(routeShots, 'live-' + flow.replaceAll(' ', '-').toLowerCase() + '-result.json'), JSON.stringify({ provider, legacyRequests: app.calls.filter((call) => call.includes('/api/address/autocomplete')).length }, null, 2));
  }
  expect(app.calls.some((call) => call.includes('/api/address/autocomplete'))).toBe(false);
});
