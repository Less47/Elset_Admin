import { test, expect } from "@playwright/test";
import { createServer, loadEnv } from "vite";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { themePresets } from "../../src/lib/theme-presets.js";
import { readSavedPosition } from "../../src/components/map/google-map-data.js";
import { indexCustomerSites, resolveJobSiteLocation } from "../../src/lib/site-location.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshotDir = path.join(root, "test-results/google-map-promotion");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
const live = process.env.ELSET_GOOGLE_MAPS_LIVE_TEST === "1";
const configuredKey = loadEnv("development", root, "VITE_").VITE_GOOGLE_MAPS_API_KEY || "";
let server, missingKeyServer, baseUrl, missingKeyUrl;

test.use({ trace: "off", video: "off" }); // Network traces would contain the browser API key.

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test.beforeAll(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  server = await createServer({ root, cacheDir: "node_modules/.vite-map-route-tests", server: { host: "localhost", port: await freePort(), strictPort: true }, logLevel: "error" });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0].replace(/\/$/, "");
  const previous = process.env.VITE_GOOGLE_MAPS_API_KEY;
  process.env.VITE_GOOGLE_MAPS_API_KEY = "";
  try {
    missingKeyServer = await createServer({ root, cacheDir: "node_modules/.vite-google-missing-key", server: { host: "localhost", port: await freePort(), strictPort: true }, logLevel: "error" });
    await missingKeyServer.listen();
    missingKeyUrl = missingKeyServer.resolvedUrls.local[0].replace(/\/$/, "");
  } finally {
    if (previous === undefined) delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    else process.env.VITE_GOOGLE_MAPS_API_KEY = previous;
  }
});
test.afterAll(async () => { await missingKeyServer?.close(); await server?.close(); });

function saveFixtureCoordinates(state, results) {
  for (const job of state.jobs) {
    const customer = state.customers.find((entry) => entry.id === job.customerId);
    let site = customer.sites.find((entry) => entry.address === job.jobAddress);
    if (!site) {
      site = { ...customer.sites[0], id: `saved-${customer.id}-${customer.sites.length}`, address: job.jobAddress };
      customer.sites.push(site);
    }
    const position = readSavedPosition(results.find((entry) => entry.jobId === job.id)?.location);
    Object.assign(site, { latitude: position?.lat ?? null, longitude: position?.lng ?? null });
  }
}

function savedResults(state, override = null) {
  const index = indexCustomerSites(state.customers);
  return state.jobs.map((job) => {
    const resolved = resolveJobSiteLocation(job, index);
    const location = override ? override.find((entry) => entry.jobId === job.id)?.location : resolved.position;
    return { jobId: job.id, siteId: resolved.site?.id || null, location, reason: !resolved.site ? "site-not-found" : !location ? "site-missing-coordinates" : null };
  });
}

test("live production-shaped dataset shows 204 unmapped then 175 after only linked Sites receive coordinates", async ({ page }) => {
  test.skip(!live || !configuredKey, "Requires live Maps JavaScript API");
  const state = structuredClone(fixture);
  const customer = state.customers[0];
  customer.sites = Array.from({ length: 161 }, (_, index) => ({ id: `audit-site-${index}`, address: `Fixture Site ${index}, Melbourne VIC` }));
  const template = state.jobs[0];
  state.jobs = Array.from({ length: 204 }, (_, index) => ({ ...template, id: `audit-job-${index}`, jobNumber: 9000 + index,
    jobAddress: index < 175 ? customer.sites[index % 122].address : `Unlinked fixture address ${index % 24}` }));
  const calls = await mockWorkspace(page, state);
  await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await expect(page.locator(".google-test-status")).toContainText("204 jobs · 0 mapped · 204 missing location");
  await expect(page.locator(".google-test-status")).toContainText("29 without a matching saved Site");
  await expect(page.locator(".google-test-pin")).toHaveCount(0);
  const beforeJobs = JSON.stringify(state.jobs);
  // Simulate a future approved backfill. Only the authoritative Site records change.
  customer.sites.slice(0, 122).forEach((site, index) => Object.assign(site, { latitude: -37.8136 + (index % 3) * 0.0001, longitude: 144.9631 + (index % 3) * 0.0001 }));
  await page.getByRole("button", { name: "Refresh coordinates", exact: true }).click();
  await expect(page.locator(".google-test-status")).toContainText("204 jobs · 175 mapped · 29 missing location");
  await expect(page.locator(".google-test-cluster")).toHaveText("175");
  await page.locator(".google-test-cluster").click();
  await expect(page.getByRole("complementary", { name: "Map job details" }).locator("article")).toHaveCount(175);
  expect(JSON.stringify(state.jobs)).toBe(beforeJobs);
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  expect(calls.some((call) => call.includes("geocode"))).toBe(false);
});

test("live Google uses the explicitly linked Site for a multi-site customer even when the Job address is stale", async ({ page }) => {
  test.skip(!live || !configuredKey, "Requires live Maps JavaScript API");
  const state = markerFixture();
  const site = state.customers[0].sites.find((entry) => entry.address === "Nearby fixture Site");
  state.jobs = [{ ...state.jobs[0], siteId: site.id }];
  await mockWorkspace(page, state);
  await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-center", "-37.814000,144.964000");
  await page.locator(".google-test-pin").click();
  const panel = page.getByRole("complementary", { name: "Map job details" });
  await expect(panel).toContainText("Nearby fixture Site");
  const url = new URL(await panel.getByRole("link", { name: /^Navigate to/ }).getAttribute("href"));
  expect(url.searchParams.get("destination")).toBe("-37.814,144.964");
  await panel.getByRole("button", { name: "Open Site", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sites/${site.id}$`));
});

function markerFixture() {
  const state = structuredClone(fixture);
  const source = { ...state.jobs[0], quote: null, invoice: null };
  state.jobs = [
    { ...source, id: "google-one", jobNumber: 7001, title: "Google test first job", latitude: -37.8136, longitude: 144.9631 },
    { ...source, id: "google-two", jobNumber: 7002, title: "Google test second job", location: { lat: -37.8136, lon: 144.9631 }, urgency: "High", status: "Completed" },
    { ...source, id: "google-nearby", jobAddress: "Nearby fixture Site", jobNumber: 7003, title: "Google test nearby job", lat: -37.814, lng: 144.964 },
    { ...source, id: "google-missing", jobAddress: "Missing fixture Site", jobNumber: 7004, title: "Google test missing coordinates" },
  ];
  saveFixtureCoordinates(state, state.jobs.map((job) => ({ jobId: job.id, location: readSavedPosition(job) })));
  for (const job of state.jobs) for (const key of ["latitude", "longitude", "lat", "lng", "location"]) delete job[key];
  return state;
}

async function mockWorkspace(page, state = markerFixture(), preferences = {}, coordinateResults = null) {
  const calls = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    // Google uses /maps/api/, so only intercept the local application API.
    if (!pathname.startsWith("/api/")) return route.continue();
    calls.push(`${request.method()} ${pathname}`);
    const json = pathname === "/api/auth/me" ? { user: { id: "google-test-user", name: "Map Test", role: "admin" } }
      : pathname === "/api/app-state" ? { state, storageMode: "sqlite" }
        : pathname === "/api/map/locations" ? { source: "saved-site-coordinates", results: savedResults(state, coordinateResults) }
        : pathname === "/api/user-preferences" ? { preferences }
          : pathname === "/api/admin/user-accounts" ? { users: [] }
            : null;
    if (json && request.method() === "GET") return route.fulfill({ json });
    return route.fulfill({ status: 418, json: { error: "Unexpected test API call" } });
  });
  return calls;
}

async function capture(page, name) {
  const canvas = page.locator('[data-google-map-canvas][data-map-ready="true"]');
  if (await canvas.count()) {
    // Let the provider's zoom/resize animation settle before visual QA.
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => [...document.querySelectorAll("[data-google-map-canvas] img")]
      .filter((image) => image.getBoundingClientRect().width >= 128)
      .every((image) => image.complete && image.naturalWidth > 0));
    const details = page.getByRole("complementary", { name: "Map job details" });
    if (await details.isVisible()) {
      const panel = await details.boundingBox();
      const status = await page.locator(".google-test-status").boundingBox();
      expect(panel.y + panel.height).toBeLessThan(status.y);
      const zoom = await page.getByRole("button", { name: "Zoom in", exact: true }).boundingBox();
      if (zoom && panel.x + panel.width > zoom.x) expect(panel.y + panel.height).toBeLessThan(zoom.y);
    }
    const filters = page.locator(".google-map-filter-sheet");
    if (await filters.isVisible()) {
      const sheet = await filters.boundingBox();
      const zoom = await page.getByRole("button", { name: "Zoom in", exact: true }).boundingBox();
      expect(sheet.y + sheet.height).toBeLessThan(zoom.y);
      await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
      expect(await page.getByRole("button", { name: "Zoom in", exact: true }).evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
  }
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}

test("missing key has a clear message without requesting Google or geocoding", async ({ page }) => {
  const calls = await mockWorkspace(page);
  const googleRequests = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname === "maps.googleapis.com") googleRequests.push(true); });
  await page.goto(`${missingKeyUrl}/map`);
  await expect(page.getByRole("alert")).toContainText("Add VITE_GOOGLE_MAPS_API_KEY to .env.local");
  await expect(page.locator("[data-google-map-workspace]")).toBeVisible();
  expect(googleRequests).toHaveLength(0);
  expect(calls.some((call) => /\/api\/map\/(config|geocode)/.test(call))).toBe(false);
  await capture(page, "missing-key-1440x900.png");
});

test("blocked Google request reports an error and leaves navigation usable", async ({ page }) => {
  test.skip(!configuredKey, "Local development key is not configured");
  await mockWorkspace(page);
  await page.route("https://maps.googleapis.com/maps/api/js?**", (route) => route.abort());
  await page.goto(`${baseUrl}/map`);
  await expect(page.getByRole("alert")).toContainText("Google Maps could not load");
  await page.getByRole("button", { name: "Sites", exact: true }).click();
  await expect(page.locator("[data-google-map-workspace]")).toHaveCount(0);
});

test("Google authentication failure is explained even after the loader starts", async ({ page }) => {
  test.skip(!configuredKey, "Local development key is not configured");
  await mockWorkspace(page);
  await page.route("https://maps.googleapis.com/maps/api/js?**", (route) => route.fulfill({ contentType: "text/javascript", body: "window.gm_authFailure();" }));
  await page.goto(`${baseUrl}/map`);
  await expect(page.getByRole("alert")).toContainText("Google Maps rejected this request");
  await capture(page, "google-auth-error-1440x900.png");
});

test("live Google renders Melbourne, clusters all jobs, filters and opens records", async ({ page }) => {
  test.skip(!live || !configuredKey, "Set ELSET_GOOGLE_MAPS_LIVE_TEST=1 with a configured development key");
  const calls = await mockWorkspace(page);
  let keyLogged = false;
  const errors = [];
  const serviceRequests = [];
  page.on("console", (message) => { if (configuredKey && message.text().includes(configuredKey)) keyLogged = true; });
  page.on("pageerror", (error) => errors.push(error.name));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith("googleapis.com") && /geocod|directions|routes|places/i.test(url.pathname)) serviceRequests.push(url.pathname);
  });
  await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
  const canvas = page.locator("[data-google-map-canvas]");
  await expect(canvas).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-map-zoom", "13");
  await expect(page.locator(".google-test-status")).toContainText("4 jobs · 3 mapped");
  await expect(page.locator(".google-test-cluster")).toBeVisible();
  await expect(page.locator(".google-test-cluster")).toHaveText("3");
  await capture(page, "google-melbourne-cluster-1440x900.png");
  await page.locator(".google-test-cluster").click();
  await expect(page.getByRole("complementary", { name: "Map job details" })).toContainText("Google test first job");
  await expect(page.getByRole("complementary", { name: "Map job details" }).locator("article")).toHaveCount(3);
  await capture(page, "google-cluster-details-1440x900.png");
  await canvas.evaluate((element) => { window.retainedMapRoot = element.firstElementChild; });
  await page.getByRole("button", { name: "Open Job", exact: true }).first().click();
  await expect(page).toHaveURL(/\/jobs\/google-one$/);
  await page.goBack();
  await expect(canvas).toHaveAttribute("data-map-ready", "true");
  await expect(page).toHaveURL(/\/map$/);
  expect(await canvas.evaluate((element) => element.firstElementChild === window.retainedMapRoot)).toBe(true);
  await page.getByRole("combobox", { name: "Site type", exact: true }).click();
  await page.getByRole("option", { name: "Commercial", exact: true }).click();
  await expect(page.locator(".google-test-status")).toContainText("0 jobs · 0 mapped");
  await page.getByRole("combobox", { name: "Site type", exact: true }).click();
  await page.getByRole("option", { name: "Residential", exact: true }).click();
  await expect(page.locator(".google-test-status")).toContainText("4 jobs · 3 mapped");
  await page.getByRole("combobox", { name: "Customer type", exact: true }).click();
  await page.getByRole("option", { name: "Not set", exact: true }).click();
  await expect(page.locator(".google-test-status")).toContainText("0 jobs · 0 mapped");
  await page.getByRole("combobox", { name: "Customer type", exact: true }).click();
  await page.getByRole("option", { name: "Strata", exact: true }).click();
  await page.getByRole("combobox", { name: "Jobs", exact: true }).click();
  await page.getByRole("option", { name: "Urgent", exact: true }).click();
  await expect(page.locator(".google-test-status")).toContainText("1 job · 1 mapped");
  await page.locator(".google-test-pin").click();
  await expect(page.getByRole("complementary", { name: "Map job details" })).toContainText("Completed");
  await page.getByRole("button", { name: "Open Site", exact: true }).click();
  await expect(page).toHaveURL(/\/customers\/demo-customer-arcadia\/sites\/demo-site-front-entry$/);
  await page.goBack();
  await expect(canvas).toHaveAttribute("data-map-ready", "true");
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole("combobox", { name: "Jobs", exact: true })).toHaveText("Urgent");
  expect(await canvas.evaluate((element) => element.firstElementChild === window.retainedMapRoot)).toBe(true);
  await page.getByRole("textbox", { name: "Search map jobs" }).fill("not a matching job");
  await expect(page.locator(".google-test-status")).toContainText("0 jobs · 0 mapped");
  await expect(page.locator(".google-test-pin")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search map jobs" }).fill("");
  for (const [width, height] of [[820, 1180], [390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    if (width === 390) {
      await page.getByRole("button", { name: /Filters/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(page, "google-mobile-filters-390x844.png");
      await page.getByRole("button", { name: "Close filters", exact: true }).click();
    }
    const bounds = await canvas.boundingBox();
    expect(bounds.height).toBeGreaterThan(height * 0.7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, `google-workspace-${width}x${height}.png`);
  }
  expect(calls.some((call) => /\/api\/map\/(config|geocode)/.test(call))).toBe(false);
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  expect(serviceRequests).toHaveLength(0);
  expect(errors).toHaveLength(0);
  expect(keyLogged).toBe(false);
});

test("live Google shows address-only jobs as unmapped and themes its controls", async ({ page }) => {
  test.skip(!live || !configuredKey, "Requires the configured live Google test");
  await mockWorkspace(page, fixture, themePresets.find((preset) => preset.id === "midnight-signal").values);
  await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await expect(page.locator(".google-test-status")).toContainText("1 missing location");
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-center", "-37.813600,144.963100");
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-zoom", "10");
  await expect(page.locator(".google-test-pin")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await capture(page, "google-no-saved-coordinates-1440x900.png");
});

function parityFixture(denseCount = 0) {
  const state = structuredClone(fixture);
  const addresses = ["10 Example Lane, Melbourne VIC", "20 Example Road, Richmond VIC", "30 Example Street, Fitzroy VIC",
    "40 Example Road, Box Hill VIC", "50 Example Road, Werribee VIC", "Unresolved test address"];
  const positions = [{ lat: -37.8136, lon: 144.9631 }, { lat: -37.818, lon: 144.998 }, { lat: -37.797, lon: 144.978 },
    { lat: -37.819, lon: 145.124 }, { lat: -37.90, lon: 144.66 }, null];
  const source = { ...state.jobs[0], quote: null, invoice: null };
  state.customers[0].address = addresses[0];
  state.customers[0].sites = addresses.slice(0, 2).map((address, index) => ({ ...state.customers[0].sites[0], id: `parity-site-${index}`, address, siteType: "residential" }));
  state.customers.push({ ...structuredClone(state.customers[0]), id: "parity-business", name: "Riverside Example Business", customerType: "business", address: addresses[2],
    sites: addresses.slice(2).map((address, index) => ({ ...state.customers[0].sites[0], id: `parity-site-${index + 2}`, address, siteType: "commercial" })) });
  state.jobs = Array.from({ length: denseCount || 12 }, (_, index) => {
    const siteIndex = index < 4 ? 0 : index < 8 ? 1 : Math.min(index - 6, 5);
    const customer = state.customers[index < 8 ? 0 : 1];
    return { ...source, id: `parity-${index}`, jobNumber: 8001 + index, title: `Parity gate service ${index + 1}`,
      customerId: customer.id, customerName: customer.name, jobAddress: denseCount ? `Dense test site ${index % 12}, Melbourne VIC` : addresses[siteIndex],
      status: index % 3 === 0 ? "Completed" : "To Do", urgency: index % 2 === 0 ? "High" : "Medium" };
  });
  const results = state.jobs.map((job, index) => ({ jobId: job.id, location: denseCount
    ? { lat: -37.8136 + (index % 12) * 0.0001, lon: 144.9631 + (index % 12) * 0.0001 }
    : positions[addresses.indexOf(job.jobAddress)] }));
  saveFixtureCoordinates(state, results);
  return { state, results };
}

test("live Google preserves record coverage for all search and keyboard filter states", async ({ page }) => {
  test.skip(!live || !configuredKey, "Requires live Maps JavaScript API");
  const { state, results } = parityFixture();
  const calls = await mockWorkspace(page, state, {}, results);
  await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true");
  const cases = [
    { name: "default", count: 11 },
    { name: "job-number", search: "8001", count: 1 },
    { name: "customer", search: "Arcadia Example", count: 8 },
    { name: "address", search: "Box Hill", count: 1 },
    { name: "title", search: "Parity gate service 5", count: 1 },
    { name: "completed", jobFilter: "Completed", count: 4 },
    { name: "incomplete", jobFilter: "Incomplete", count: 7 },
    { name: "urgent", jobFilter: "Urgent", count: 6 },
    { name: "site-type", siteType: "Commercial", count: 3 },
    { name: "customer-type", customerType: "Strata", count: 8 },
    { name: "not-set", siteType: "Not set", count: 0 },
    { name: "no-coordinates", search: "Unresolved test address", count: 0 },
  ];
  for (const scenario of cases) {
    await page.getByRole("textbox", { name: "Search map jobs" }).fill(scenario.search || "");
    for (const [label, option] of [["Jobs", scenario.jobFilter || "All Jobs"], ["Site type", scenario.siteType || "All site types"], ["Customer type", scenario.customerType || "All customer types"]]) {
      const trigger = page.getByRole("combobox", { name: label, exact: true });
      await trigger.press("Space");
      const item = page.getByRole("option", { name: option, exact: true });
      await expect(item).toBeVisible();
      await item.press("Enter");
      await expect(trigger).toHaveText(option);
    }
    await expect(page.locator(".google-test-status")).toHaveAttribute("data-eligible-count", String(scenario.count));
    await expect(page.locator(".google-test-status")).toHaveAttribute("data-site-coordinate-count", String(scenario.count));
  }
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  expect(calls.some((call) => /\/api\/map\/(config|geocode)/.test(call))).toBe(false);
});

test("live dense clusters expose every job, retain viewport, and work with touch and dark theme", async ({ browser }) => {
  test.skip(!live || !configuredKey, "Requires live Maps JavaScript API");
  const { state, results } = parityFixture(240);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await mockWorkspace(page, state, themePresets.find((preset) => preset.id === "midnight-signal").values, results);
    await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
    const canvas = page.locator("[data-google-map-canvas]");
    await expect(canvas).toHaveAttribute("data-map-ready", "true");
    await expect(canvas).toHaveAttribute("data-map-zoom", "13");
    await expect(page.locator(".google-test-cluster")).toHaveText("240");
    await page.locator(".google-test-cluster").tap();
    const details = page.getByRole("complementary", { name: "Map job details" });
    await expect(details.locator("article")).toHaveCount(240);
    await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
    await expect(details).toHaveCSS("background-color", "rgb(22, 34, 53)");
    await capture(page, "parity-dense-dark-details-390x844.png");
    await details.locator("article").last().scrollIntoViewIfNeeded();
    await expect(details.locator("article").last().getByRole("button", { name: "Open Job", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close map details" }).tap();
    const zoomBefore = Number(await canvas.getAttribute("data-map-zoom"));
    await page.getByRole("button", { name: "Zoom out", exact: true }).tap();
    await expect.poll(async () => Number(await canvas.getAttribute("data-map-zoom"))).toBeLessThan(zoomBefore);
    // A real touch gesture must pan the Google map without moving the page.
    const client = await context.newCDPSession(page);
    const before = await canvas.getAttribute("data-map-center");
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 400 }] });
    for (let x = 210; x <= 290; x += 20) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: 450 }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(canvas).not.toHaveAttribute("data-map-center", before);
    const panned = await canvas.getAttribute("data-map-center");
    await page.getByRole("textbox", { name: "Search map jobs" }).tap();
    await expect(canvas).toHaveAttribute("data-map-center", panned);
    await page.getByRole("button", { name: /^Filters/ }).tap();
    await page.getByRole("dialog").getByRole("combobox", { name: "Jobs", exact: true }).click();
    await page.getByRole("option", { name: "Completed", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).tap();
    await expect(page.locator(".google-test-status")).toHaveAttribute("data-eligible-count", "80");
    await capture(page, "parity-dense-dark-filtered-390x844.png");
    for (const [width, height] of [[820, 1180], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      expect((await canvas.boundingBox()).height).toBeGreaterThan(height * 0.7);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await capture(page, `parity-dense-dark-${width}x${height}.png`);
    }
  } finally { await context.close(); }
});

test("live Site refresh reads persisted coordinates without geocoding or changing records", async ({ page }) => {
  test.skip(!live || !configuredKey, "Requires live Maps JavaScript API");
  const { state, results } = parityFixture();
  const before = JSON.stringify(state);
  const calls = await mockWorkspace(page, state);
  let warmed = false;
  await page.route("**/api/map/locations", (route) => route.fulfill({ json: { source: "saved-site-coordinates",
    results: savedResults(state, warmed ? results : state.jobs.map((job) => ({ jobId: job.id, location: null }))),
  } }));
  await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true");
  await expect(page.locator(".google-test-status")).toHaveAttribute("data-eligible-count", "0");
  await expect(page.locator(".google-test-status")).toContainText("12 missing location");
  warmed = true; // Simulates a completed Site coordinate backfill, with no Job writes.
  await page.getByRole("button", { name: "Refresh coordinates", exact: true }).click();
  await expect(page.locator(".google-test-status")).toHaveAttribute("data-eligible-count", "11");
  await expect(page.locator(".google-test-status")).toHaveAttribute("data-site-coordinate-count", "11");
  expect(calls.some((call) => call.includes("/api/map/geocode"))).toBe(false);
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  expect(JSON.stringify(state)).toBe(before);
});

test("live primary route supports the sidebar, direct load and refresh", async ({ page }) => {
  test.skip(!live || !configuredKey, "Requires live Maps JavaScript API");
  const calls = await mockWorkspace(page);
  const loadedModules = [];
  page.on("request", (request) => loadedModules.push(new URL(request.url()).pathname));
  const origin = process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl;
  await page.goto(origin);
  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByRole("button", { name: "Map", exact: true })).toHaveCount(1);
  await sidebar.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true");
  await expect(page.locator(".google-test-status")).toContainText("4 jobs · 3 mapped");
  await expect(page.locator("[data-map-canvas]")).toHaveCount(0);
  await expect(page.locator('script[src*="maps.googleapis.com/maps/api/js"]')).toHaveCount(1);
  await expect(page.getByText(/Google Maps test|Google test ·/)).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(`${origin}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true");
  await expect(page.locator(".google-test-status")).toHaveAttribute("data-eligible-count", "3");
  expect(calls.some((call) => /\/api\/map\/(config|geocode)/.test(call))).toBe(false);
  expect(loadedModules.some((pathname) => /JobsMapManager|\/leaflet[./]/i.test(pathname))).toBe(false);
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
});

for (const themeId of ["elset", "evergreen-ledger", "midnight-signal"]) {
  test(`live primary Map preserves ${themeId} overlays on desktop and mobile`, async ({ browser }) => {
    test.skip(!live || !configuredKey, "Requires live Maps JavaScript API");
    const { state, results } = parityFixture();
    const preset = themePresets.find((theme) => theme.id === themeId);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    try {
      await mockWorkspace(page, state, preset.values, results);
      await page.goto(`${process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl}/map`);
      const canvas = page.locator("[data-google-map-canvas]");
      await expect(canvas).toHaveAttribute("data-map-ready", "true");
      await expect(page.locator("html")).toHaveAttribute("data-theme-mode", themeId === "midnight-signal" ? "dark" : "light");
      await expect(page.locator(".google-test-status")).toHaveAttribute("data-eligible-count", "11");
      await capture(page, `primary-${themeId}-1440x900.png`);
      await page.locator(".google-test-pin").filter({ hasText: /^4$/ }).first().click();
      const details = page.getByRole("complementary", { name: "Map job details" });
      await expect(details.locator("article")).toHaveCount(4);
      const hex = preset.values.dialogSurface.slice(1);
      const color = `rgb(${[0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
      await expect(details).toHaveCSS("background-color", color);
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, `primary-${themeId}-details-390x844.png`);
      await page.getByRole("button", { name: "Close map details" }).tap();
      await page.getByRole("button", { name: /^Filters/ }).tap();
      await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
      await capture(page, `primary-${themeId}-filters-390x844.png`);
      await page.getByRole("button", { name: "Done", exact: true }).tap();
      await expect(canvas).toHaveAttribute("data-map-ready", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
}

test("live production build serves Google at the only map route", async ({ browser }) => {
  test.skip(!live || !configuredKey, "Requires a build and live Maps JavaScript API");
  const origin = process.env.ELSET_GOOGLE_MAPS_TEST_URL || baseUrl;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const assets = [];
  try {
    // Serve the built frontend at the key's already allowed local referrer.
    // App APIs remain isolated fixtures; Google network requests stay live.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) return route.fallback();
      const relative = url.pathname.startsWith("/assets/") ? url.pathname.slice(1) : "index.html";
      const file = path.resolve(root, "dist", relative);
      if (!file.startsWith(path.resolve(root, "dist") + path.sep)) return route.abort();
      const contentType = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2" }[path.extname(file)] || "application/octet-stream";
      assets.push(relative);
      return route.fulfill({ contentType, body: fs.readFileSync(file) });
    });
    const calls = await mockWorkspace(page);
    await page.goto(`${origin}/map`);
    await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true");
    await expect(page.locator(".google-test-status")).toHaveAttribute("data-eligible-count", "3");
    expect(assets.some((asset) => asset.includes("GoogleJobsMap"))).toBe(true);
    expect(assets.some((asset) => asset.includes("JobsMapManager"))).toBe(false);
    expect(calls.some((call) => /\/api\/map\/(config|geocode)/.test(call))).toBe(false);
    await capture(page, "production-primary-1440x900.png");
  } finally { await context.close(); }
});

for (const retiredPath of ["/map/legacy", "/map/google-test"]) test("retired map route is unavailable: " + retiredPath, async ({ page }) => {
  const calls = await mockWorkspace(page);
  let googleRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).hostname.endsWith("googleapis.com")) googleRequests++; });
  await page.addInitScript(() => history.replaceState({ elsetWorkspace: { section: "map", sourceSection: "map" } }, "", location.href));
  await page.goto(baseUrl + retiredPath);
  await expect(page.getByRole("navigation", { name: "Application" }).getByRole("button", { name: "Service Board", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-google-map-canvas], [data-map-canvas]")).toHaveCount(0);
  await expect(page).toHaveURL(baseUrl + retiredPath);
  expect(googleRequests).toBe(0);
  expect(calls.some((call) => /\/api\/map\//.test(call))).toBe(false);
});
