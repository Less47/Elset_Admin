import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { installGoogleMapsStub } from "./helpers/google-maps-stub.mjs";
import { themePresets } from "../../src/lib/theme-presets.js";
import { indexCustomerSites, resolveJobSiteLocation } from "../../src/lib/site-location.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
let server, origin;
test.use({ trace: "off", video: "off" });
test.beforeAll(async () => {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  server = await createServer({ root, cacheDir: "node_modules/.vite-map-markers-tests", logLevel: "error",
    define: { "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify("map-test-placeholder"),
      "import.meta.env.VITE_GOOGLE_MAPS_MAP_ID": JSON.stringify("elset-map-style-test") },
    server: { host: "localhost", port } });
  await server.listen(); origin = server.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => server?.close());

function mapFixture(count = 6, mapped = 5) {
  const state = structuredClone(fixture);
  const customer = state.customers[0];
  customer.sites = Array.from({ length: count }, (_, i) => ({ id: `map-site-${i}`, address: `Map Site ${i}, Melbourne`, siteType: "residential",
    latitude: i < mapped ? -37.8 - i * 0.001 : null, longitude: i < mapped ? 144.9 + i * 0.001 : null }));
  state.jobs = Array.from({ length: count }, (_, i) => ({ ...state.jobs[0], id: `map-job-${i}`, jobNumber: 278 + i,
    title: `Map fixture job ${i}`, siteId: customer.sites[i === 1 ? 0 : i].id, jobAddress: customer.sites[i === 1 ? 0 : i].address,
    status: ["To Do", "In Progress", "Completed", "Paused"][i % 4] }));
  return state;
}
async function open(page, { live = false, state = mapFixture() } = {}) {
  const before = JSON.stringify(state);
  await page.addInitScript((state) => { window.mapFixture = state; }, state);
  if (!live) await installGoogleMapsStub(page);
  const index = indexCustomerSites(state.customers);
  const calls = [];
  await page.route("**/api/map/locations", (route) => {
    calls.push(route.request().method());
    return route.fulfill({ json: { source: "saved-site-coordinates", results: state.jobs.map((job) => {
      const resolved = resolveJobSiteLocation(job, index);
      return { jobId: job.id, siteId: resolved.site.id, location: resolved.position, reason: resolved.reason };
    }) } });
  });
  await page.goto(`${live ? process.env.ELSET_GOOGLE_MAPS_TEST_URL || "http://localhost:5173" : origin}/tests/e2e/fixtures/google-map-harness.html`);
  const canvas = page.locator("[data-google-map-canvas]");
  await expect(canvas).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-map-zoom", "13");
  return { canvas, calls, before };
}

test("individual markers show status colours, stack selection, titles and unchanged counts", async ({ page }) => {
  const { calls, before } = await open(page);
  await expect(page.locator(".google-test-pin")).toHaveCount(5);
  expect(await page.locator("gmp-advanced-marker").first().evaluate((marker) => marker.map.get("mapId"))).toBe("elset-map-style-test");
  await expect(page.locator(".google-test-cluster")).toHaveCount(0);
  await expect(page.locator(".google-test-status")).toContainText("6 jobs · 5 mapped · 1 missing location");
  for (const [tone, color] of [["warning", "rgb(245, 183, 0)"], ["info", "rgb(15, 144, 205)"], ["success", "rgb(20, 148, 71)"], ["unknown", "rgb(100, 116, 139)"]]) {
    const pin = page.locator(`.google-test-pin[data-tone="${tone}"]`).first();
    await expect(pin.locator(".google-job-dot")).toHaveCSS("background-color", color);
    await expect(pin).toHaveCSS("width", "44px");
    await expect(pin.locator(".google-job-dot")).toHaveCSS("width", "18px");
  }
  await expect(page.getByRole("list", { name: "Job marker status legend" })).toContainText("Other / not set");
  const first = page.locator('[data-job-id="map-job-0"]').locator("..");
  await expect(first).toHaveAttribute("title", /Job #278.*To Do/);
  await first.press("Enter");
  const panel = page.getByRole("complementary", { name: "Map job details" });
  await expect(panel).toContainText("Map fixture job 0");
  const href = new URL(await panel.getByRole("link", { name: /^Navigate to/ }).getAttribute("href"));
  expect(href.searchParams.get("destination")).toBe("-37.8,144.9");
  await panel.getByRole("button", { name: "Open Job", exact: true }).click();
  expect(await page.evaluate(() => window.mapAction)).toEqual(["job", "map-job-0"]);
  await panel.getByRole("button", { name: "Open Site", exact: true }).click();
  expect((await page.evaluate(() => window.mapAction)).at(-1)).toBe("map-site-0");
  await page.getByRole("button", { name: "Next job here", exact: true }).click();
  await expect(panel).toContainText("Map fixture job 1");
  await expect(page.locator('[data-job-id="map-job-1"]')).toHaveAttribute("data-selected", "true");
  await page.locator('[data-job-id="map-job-2"]').locator("..").dispatchEvent("mouseenter");
  const z = await page.locator("gmp-advanced-marker").evaluateAll((markers) => markers.map((m) => m.zIndex));
  expect(z[1]).toBeGreaterThan(z[2]); expect(z[2]).toBeGreaterThan(z[0]);
  expect(await page.locator("gmp-advanced-marker").evaluateAll((markers) => markers.every((m) => m.collisionBehavior === "REQUIRED"))).toBe(true);
  await page.getByRole("textbox", { name: "Search map jobs" }).fill("Map fixture job 3");
  await expect(page.locator(".google-test-pin")).toHaveCount(1);
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".google-test-pin")).toHaveAttribute("data-tone", "unknown");
  expect(calls.every((method) => method === "GET")).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.mapFixture))).toBe(before);
});

test("hundreds of mapped jobs reuse markers through filters and unrelated changes", async ({ page }) => {
  await open(page, { state: mapFixture(206, 152) });
  await expect(page.locator(".google-test-pin")).toHaveCount(152);
  await expect(page.locator(".google-test-status")).toContainText("206 jobs · 152 mapped · 54 missing location");
  const initial = await page.evaluate(() => ({ markers: window.mapAudit.markers.length, maps: window.mapAudit.maps.length }));
  for (const search of ["job 10", "", "not a job", ""]) {
    await page.getByRole("textbox", { name: "Search map jobs" }).fill(search);
    await expect(page.locator(".google-test-pin")).toHaveCount(search === "" ? 152 : search === "job 10" ? 11 : 0);
  }
  await page.getByLabel("Test appearance").selectOption("copper-dawn");
  await page.mouse.move(500, 400);
  expect(await page.evaluate(() => ({ markers: window.mapAudit.markers.length, maps: window.mapAudit.maps.length }))).toEqual(initial);
});

for (const live of [false, true]) test(`${live ? "live Google" : "contract"} theme switching retains viewport, filters, selection and cleans up old maps`, async ({ page }) => {
  test.skip(live && process.env.ELSET_GOOGLE_MAPS_LIVE_TEST !== "1", "Live Maps needs the allowed localhost referrer");
  const { canvas } = await open(page, { live });
  await page.getByRole("textbox", { name: "Search map jobs" }).fill("Map fixture");
  await page.locator('[data-job-id="map-job-0"]').locator("..").press("Enter");
  await expect(canvas).toHaveAttribute("data-map-zoom", "14");
  await canvas.evaluate((node) => {
    const map = node.querySelector("gmp-advanced-marker").map;
    map.setCenter({ lat: -37.82, lng: 144.95 }); map.setZoom(12);
    window.previousMaps = [map]; window.previousMarkers = [...node.querySelectorAll("gmp-advanced-marker")];
  });
  await expect(canvas).toHaveAttribute("data-map-center", "-37.820000,144.950000");
  const midnight = themePresets.find(preset => preset.id === 'midnight-signal');
  for (const preset of [midnight, ...themePresets, midnight, themePresets[0]]) {
    const dark = preset.id === "midnight-signal";
    await page.getByLabel("Test appearance").selectOption(preset.id);
    await expect(canvas).toHaveAttribute("data-map-scheme", dark ? "dark" : "light");
    await expect(canvas).toHaveAttribute("data-map-ready", "true");
    await expect(page.locator(".google-test-pin")).toHaveCount(5);
    await expect(canvas).toHaveAttribute("data-map-center", "-37.820000,144.950000");
    await expect(canvas).toHaveAttribute("data-map-zoom", "12");
    await expect(page.getByRole("textbox", { name: "Search map jobs" })).toHaveValue("Map fixture");
    await expect(page.getByRole("complementary", { name: "Map job details" })).toContainText("Map fixture job 0");
    await expect(page.locator('[data-job-id="map-job-0"]')).toHaveAttribute("data-selected", "true");
    expect(await canvas.evaluate((node) => node.querySelector("gmp-advanced-marker").map.get("colorScheme"))).toBe(dark ? "DARK" : "LIGHT");
    const lifecycle = await canvas.evaluate((node) => {
      const current = node.querySelector("gmp-advanced-marker").map;
      const previous = window.previousMaps.at(-1);
      const changed = current !== previous;
      const detached = !changed || window.previousMarkers.every((marker) => marker.map == null);
      window.previousMaps.push(current); window.previousMarkers = [...node.querySelectorAll("gmp-advanced-marker")];
      return { changed, detached, previousScheme: previous.get("colorScheme") };
    });
    expect(lifecycle.detached).toBe(true);
    expect(lifecycle.changed).toBe(lifecycle.previousScheme !== (dark ? "DARK" : "LIGHT"));
  }
  if (!live) expect(await page.evaluate(() => window.mapAudit.maps.slice(0, -1).every((map) => map.disposed && map.listeners.size === 0))).toBe(true);
});
