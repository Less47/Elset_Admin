import { test, expect, devices } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { themePresets } from "../../src/lib/theme-presets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = path.join(root, "test-results/site-navigation");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
const address = "14 Sesame Street, Caroline Springs VIC 3023";
const coords = "-37.7305,144.7428";
const live = process.env.ELSET_GOOGLE_MAPS_LIVE_TEST === "1";
let server, baseUrl = process.env.ELSET_NAVIGATION_TEST_URL;
test.use({ trace: "off", video: "off" }); // Real Google scripts include the browser API key.

test.beforeAll(async () => {
  fs.mkdirSync(screenshots, { recursive: true });
  if (baseUrl) return;
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  server = await createServer({ root, cacheDir: "node_modules/.vite-site-navigation-tests", server: { host: "localhost", port, strictPort: true }, logLevel: "error" });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => { await server?.close(); });

function workspace() {
  const state = structuredClone(fixture);
  const customer = state.customers.find((record) => record.id === state.jobs[0].customerId);
  customer.address = address;
  customer.sites = [{ ...customer.sites[0], address, streetAddress: "14 Sesame Street", suburb: "Caroline Springs", state: "VIC", postcode: "3023", latitude: -37.7305, longitude: 144.7428 }];
  state.jobs = [{ ...state.jobs[0], id: "navigation-job", jobAddress: address, title: "Sesame Street gate service", latitude: -38, longitude: 145, quote: null, invoice: null }];
  return { state, site: customer.sites[0], job: state.jobs[0], customer };
}

async function mockWorkspace(context, state, preferences = {}) {
  const calls = [];
  await context.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (!pathname.startsWith("/api/")) return route.continue();
    calls.push(`${route.request().method()} ${pathname}`);
    const json = pathname === "/api/auth/me" ? { user: { id: "navigation-test-user", name: "Navigation Test", role: "admin" } }
      : pathname === "/api/app-state" ? { state, storageMode: "sqlite" }
        : pathname === "/api/map/locations" ? { source: "saved-site-coordinates", results: [] }
          : pathname === "/api/user-preferences" ? { preferences }
            : pathname === "/api/admin/user-accounts" ? { users: [] } : null;
    if (json && route.request().method() === "GET") return route.fulfill({ json });
    return route.fulfill({ status: 418, json: { error: "Unexpected test API request" } });
  });
  // Capture the real anchor's new-tab destination without leaving the test for
  // third-party directions pages or trying to simulate a native installed app.
  await context.route(/^https:\/\/(maps\.apple\.com\/|www\.google\.com\/maps\/dir\/)/, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Directions destination captured</title>" }));
  return calls;
}

const navigationLinks = (scope) => scope.getByRole("link", { name: /^Navigate to / });

async function activate(context, page, link, provider, target, method = "click") {
  const originalUrl = page.url();
  const expectedHost = provider === "Apple Maps" ? "maps.apple.com" : "www.google.com";
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const popupPromise = context.waitForEvent("page");
  if (method === "keyboard") {
    await link.focus();
    await expect(link).toBeFocused();
    expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await link.press("Enter");
  } else if (method === "tap") await link.tap();
  else await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  const url = new URL(popup.url());
  expect(url.hostname).toBe(expectedHost);
  expect(url.searchParams.get(provider === "Apple Maps" ? "daddr" : "destination")).toBe(target);
  if (provider !== "Apple Maps") {
    expect(url.pathname).toBe("/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("dir_action")).toBe("navigate");
  }
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  await expect(page).toHaveURL(originalUrl);
}

async function capture(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true, scale: "css" });
}

function assertReadOnly(calls) {
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  expect(calls.some((call) => /geocode|autocomplete|places/i.test(call))).toBe(false);
}

for (const theme of themePresets) {
  test(`Job Details navigation and keyboard focus: ${theme.label}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" });
    try {
      const { state } = workspace();
      const calls = await mockWorkspace(context, state, theme.values);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/jobs/navigation-job`);
      await expect(navigationLinks(page)).toHaveCount(2);
      await expect(page.locator("html")).toHaveAttribute("data-theme-mode", theme.id === "midnight-signal" ? "dark" : "light");
      await activate(context, page, navigationLinks(page).first(), "Google Maps", coords, "keyboard");
      await capture(page, `job-${theme.id}-desktop`);
      assertReadOnly(calls);
    } finally { await context.close(); }
  });

  test(`live Map Navigate shares one destination for coincident jobs: ${theme.label}`, async ({ browser }) => {
    test.skip(!live, "Requires live Google Maps on an allowed local referrer");
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const { state, job } = workspace();
      state.jobs.push({ ...job, id: "navigation-job-two", title: "Sesame Street safety check" });
      const calls = await mockWorkspace(context, state, theme.values);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/map`);
      await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
      await expect(page.locator(".google-test-status")).toContainText("2 jobs · 2 mapped");
      await expect(page.locator(".google-test-pin")).toHaveCount(2);
      await page.locator(".google-test-pin").last().click();
      const panel = page.getByRole("complementary", { name: "Map job details" });
      await expect(panel.locator("article")).toHaveCount(1);
      await expect(panel.getByRole("button", { name: "Open Job", exact: true })).toHaveCount(1);
      await expect(panel.getByRole("button", { name: "Open Site", exact: true })).toHaveCount(1);
      await expect(navigationLinks(panel)).toHaveCount(1);
      await panel.getByRole("button", { name: "Next job here", exact: true }).click();
      await expect(page.locator('[data-job-id="navigation-job"]')).toHaveAttribute("data-selected", "true");
      await activate(context, page, navigationLinks(panel), "Google Maps", coords);
      await page.waitForTimeout(4000); // Allow map pan/zoom and replacement tiles to settle for the screenshot.
      await capture(page, `map-${theme.id}-desktop`);
      await panel.getByRole("button", { name: "Open Job", exact: true }).first().click();
      await expect(page).toHaveURL(/\/jobs\/navigation-job$/);
      await page.goBack();
      await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true");
      await page.getByRole("complementary", { name: "Map job details" }).getByRole("button", { name: "Open Site", exact: true }).first().click();
      await expect(page).toHaveURL(/\/customers\/[^/]+\/sites\//);
      assertReadOnly(calls);
    } finally { await context.close(); }
  });
}

const platforms = [
  { name: "iphone", options: devices["iPhone 13"], provider: "Apple Maps" },
  { name: "android", options: devices["Pixel 7"], provider: "Google Maps" },
  { name: "ipad-desktop-ua", options: { ...devices["iPad Pro 11"], userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15" }, provider: "Apple Maps" },
  { name: "mac", options: { viewport: { width: 1440, height: 900 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15" }, provider: "Apple Maps" },
];

for (const platform of platforms) {
  test(`Job Details platform preference and explicit browser fallback: ${platform.name}`, async ({ browser }) => {
    const context = await browser.newContext(platform.options);
    try {
      const { state } = workspace();
      const calls = await mockWorkspace(context, state, themePresets.find((theme) => theme.id === "midnight-signal").values);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/jobs/navigation-job`);
      const link = navigationLinks(page).first();
      if (platform.options.hasTouch) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await activate(context, page, link, platform.provider, coords, platform.options.hasTouch ? "tap" : "click");
      if (platform.provider === "Apple Maps") {
        await activate(context, page, page.getByRole("link", { name: /^Use Google Maps instead/ }), "Google Maps", coords);
      }
      await capture(page, `job-${platform.name}`);
      assertReadOnly(calls);
    } finally { await context.close(); }
  });

  test(`live Map pin tap and navigation fallback: ${platform.name}`, async ({ browser }) => {
    test.skip(!live, "Requires live Google Maps on an allowed local referrer");
    const context = await browser.newContext(platform.options);
    try {
      const { state } = workspace();
      const calls = await mockWorkspace(context, state);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/map`);
      await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
      const pin = page.locator(".google-test-pin");
      if (platform.options.hasTouch) await pin.tap();
      else await pin.click();
      const panel = page.getByRole("complementary", { name: "Map job details" });
      const link = navigationLinks(panel);
      if (platform.options.hasTouch && platform.options.viewport.width < 1024) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await activate(context, page, link, platform.provider, coords, platform.options.hasTouch ? "tap" : "click");
      if (platform.provider === "Apple Maps") await activate(context, page, panel.getByRole("link", { name: /^Use Google Maps instead/ }), "Google Maps", coords);
      await page.waitForTimeout(4000);
      await capture(page, `map-${platform.name}`);
      assertReadOnly(calls);
    } finally { await context.close(); }
  });
}

for (const variant of ["structured", "formatted", "coordinates-only", "unavailable"]) {
  test(`Job Details destination fallback: ${variant}`, async ({ page, context }) => {
    const { state, site, job, customer } = workspace();
    if (variant === "structured" || variant === "formatted") {
      site.latitude = null;
      site.longitude = null; // Explicitly clears any old Job coordinates.
      if (variant === "formatted") for (const key of ["streetAddress", "suburb", "state", "postcode"]) delete site[key];
    } else {
      customer.address = "";
      customer.sites = [];
      job.jobAddress = "";
      job.latitude = variant === "coordinates-only" ? -37.7305 : null;
      job.longitude = variant === "coordinates-only" ? 144.7428 : null;
    }
    const calls = await mockWorkspace(context, state);
    await page.goto(`${baseUrl}/jobs/navigation-job`);
    if (variant === "unavailable") {
      await expect(navigationLinks(page)).toHaveCount(0);
      await expect(page.getByText("Navigation unavailable", { exact: true })).toHaveCount(2);
    } else {
      await expect(navigationLinks(page)).toHaveCount(2);
      await activate(context, page, navigationLinks(page).first(), "Google Maps", variant === "coordinates-only" ? coords : address);
    }
    await capture(page, `job-${variant}`);
    assertReadOnly(calls);
  });
}

test("live individual and stacked jobs retain their own Site navigation destination", async ({ page, context }) => {
  test.skip(!live, "Requires live Google Maps on an allowed local referrer");
  const { state, customer, job, site } = workspace();
  customer.sites.push({ ...site, id: "navigation-nearby-site", address: "Nearby fixture address", latitude: -37.7306, longitude: 144.7429 });
  state.jobs.push({ ...job, id: "navigation-job-two" }, { ...job, id: "navigation-nearby", jobAddress: "Nearby fixture address" });
  const calls = await mockWorkspace(context, state);
  await page.goto(`${baseUrl}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await expect(page.locator(".google-test-pin")).toHaveCount(3);
  await page.locator('[data-job-id="navigation-job"]').locator("..").press("Enter");
  const panel = page.getByRole("complementary", { name: "Map job details" });
  await expect(panel.locator("article")).toHaveCount(1);
  await expect(navigationLinks(panel)).toHaveCount(1);
  expect(new URL(await navigationLinks(panel).getAttribute("href")).searchParams.get("destination")).toBe(coords);
  await panel.getByRole("button", { name: "Next job here", exact: true }).click();
  expect(new URL(await navigationLinks(panel).getAttribute("href")).searchParams.get("destination")).toBe(coords);
  const nearbyMarker = page.locator('[data-job-id="navigation-nearby"]').locator("..");
  await nearbyMarker.focus();
  await expect(nearbyMarker).toBeFocused();
  await nearbyMarker.press("Enter");
  await expect(page.locator('[data-job-id="navigation-nearby"]')).toHaveAttribute("data-selected", "true");
  expect(new URL(await navigationLinks(panel).getAttribute("href")).searchParams.get("destination")).toBe("-37.7306,144.7429");
  assertReadOnly(calls);
});

test("live Map leaves a Job without a saved Site unmapped even if the Job has coordinates", async ({ page, context }) => {
  test.skip(!live, "Requires live Google Maps on an allowed local referrer");
  const { state, customer, job } = workspace();
  customer.address = "";
  customer.sites = [];
  job.jobAddress = "";
  job.latitude = -37.7305;
  job.longitude = 144.7428;
  const calls = await mockWorkspace(context, state);
  await page.goto(`${baseUrl}/map`);
  await expect(page.locator("[data-google-map-canvas]")).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await expect(page.locator(".google-test-status")).toContainText("1 job · 0 mapped · 1 missing location");
  await expect(page.locator(".google-test-status")).toContainText("1 without a matching saved Site");
  await expect(page.locator(".google-test-pin")).toHaveCount(0);
  assertReadOnly(calls);
});
