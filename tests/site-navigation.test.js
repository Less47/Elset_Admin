import test from "node:test";
import assert from "node:assert/strict";
import { getNavigationLinks, isApplePlatform, jobNavigationDestination } from "../src/lib/site-navigation.js";

const site = { address: "14 Sesame Street, Caroline Springs VIC 3023", streetAddress: "14 Sesame Street", suburb: "Caroline Springs", state: "VIC", postcode: "3023", latitude: -37.7305, longitude: 144.7428 };
const windows = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32" };
const apple = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel" };

test("Apple devices including desktop-mode iPad prefer Apple; Android, Windows and unknown use Google", () => {
  for (const device of [apple, { userAgent: "iPhone", platform: "iPhone" }, { userAgent: "iPad" }, { ...apple, maxTouchPoints: 5 }, { userAgentData: { platform: "macOS" } }]) {
    assert.equal(isApplePlatform(device), true);
    const links = getNavigationLinks(site, device);
    assert.equal(new URL(links.href).origin, "https://maps.apple.com");
    assert.equal(new URL(links.href).searchParams.get("daddr"), "-37.7305,144.7428");
    assert.equal(new URL(links.fallbackHref).searchParams.get("destination"), "-37.7305,144.7428");
  }
  for (const device of [windows, { userAgent: "Mozilla/5.0 (Linux; Android 15)", platform: "Linux armv8l" }, {}, null]) {
    assert.equal(isApplePlatform(device), false);
    const links = getNavigationLinks(site, device);
    const url = new URL(links.href);
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.pathname, "/maps/dir/");
    assert.equal(url.searchParams.get("api"), "1");
    assert.equal(url.searchParams.get("dir_action"), "navigate");
    assert.equal(links.fallbackHref, null);
  }
});

test("complete coordinates win over all address text, including zero, boundaries and numeric strings", () => {
  for (const [latitude, longitude, expected] of [[0, 0, "0,0"], [-90, 180, "-90,180"], [90, -180, "90,-180"], [" -37.7305 ", "144.7428", "-37.7305,144.7428"]]) {
    const url = new URL(getNavigationLinks({ ...site, latitude, longitude }, windows).href);
    assert.equal(url.searchParams.get("destination"), expected);
  }
});

test("partial or invalid coordinates fall back to structured Site address", () => {
  for (const pair of [{ latitude: null }, { longitude: undefined }, { latitude: "" }, { latitude: false }, { latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: -181 }, { latitude: "invalid" }]) {
    const url = new URL(getNavigationLinks({ ...site, address: "Old formatted address", ...pair }, windows).href);
    assert.equal(url.searchParams.get("destination"), "14 Sesame Street, Caroline Springs VIC 3023");
  }
});

test("structured field aliases precede the formatted fallback; a region alone does not", () => {
  const links = getNavigationLinks({ addressLine1: " 14 Sesame Street ", locality: "Caroline Springs", state: "VIC", postcode: "3023", address: "Formatted fallback" }, apple);
  assert.equal(new URL(links.href).searchParams.get("daddr"), site.address);
  const fallback = getNavigationLinks({ suburb: "Caroline Springs", state: "VIC", address: site.address }, windows);
  assert.equal(new URL(fallback.href).searchParams.get("destination"), site.address);
});

test("formatted address and coordinates-only records can navigate; a label alone cannot", () => {
  assert.equal(new URL(getNavigationLinks({ address: site.address }, apple).href).searchParams.get("daddr"), site.address);
  const coords = getNavigationLinks({ latitude: site.latitude, longitude: site.longitude }, windows);
  assert.equal(coords.label, "-37.7305,144.7428");
  for (const destination of [undefined, null, {}, { address: "  " }, { label: "Front gate" }, { latitude: 2 }, { state: "VIC", postcode: "3023" }]) {
    assert.equal(getNavigationLinks(destination, windows), null);
  }
});

test("untrusted address and label characters cannot inject URL parameters, origins or schemes", () => {
  const address = "Unit 2 / O'Brien & Sons #4, Café Street?x=1&api=2";
  for (const device of [apple, windows]) {
    const links = getNavigationLinks({ address, label: "javascript:alert(1)" }, device);
    const url = new URL(links.href);
    assert.equal(url.searchParams.get(isApplePlatform(device) ? "daddr" : "destination"), address);
    assert.equal(url.searchParams.has("x"), false);
    assert.equal(url.hash, "");
    assert.equal(/\s/.test(links.href), false);
    assert.equal(url.protocol, "https:");
    const malicious = new URL(getNavigationLinks({ address: "javascript:alert(1)" }, device).href);
    assert.equal(malicious.protocol, "https:");
  }
});

test("Job Details uses Site coordinates, respects cleared coordinates, and never changes its inputs", () => {
  const job = { jobAddress: site.address, latitude: -38, longitude: 145 };
  const before = structuredClone({ job, site });
  const destination = jobNavigationDestination(job, site);
  assert.equal(new URL(getNavigationLinks(destination, windows).href).searchParams.get("destination"), "-37.7305,144.7428");
  const cleared = jobNavigationDestination(job, { ...site, latitude: null, longitude: null });
  assert.equal(new URL(getNavigationLinks(cleared, windows).href).searchParams.get("destination"), site.address);
  const unmatched = jobNavigationDestination(job, null);
  assert.equal(new URL(getNavigationLinks(unmatched, windows).href).searchParams.get("destination"), "-38,145");
  assert.deepEqual({ job, site }, before);
});

test("Map navigation uses the resolved pin position, including existing cached coordinates", () => {
  const pin = { lat: -37.8, lng: 144.9 };
  const destination = jobNavigationDestination({ jobAddress: site.address }, { address: site.address }, pin);
  assert.equal(new URL(getNavigationLinks(destination, windows).href).searchParams.get("destination"), "-37.8,144.9");
});
