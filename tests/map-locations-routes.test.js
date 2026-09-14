import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createMapLocationsRouter } from "../server-map-locations-routes.js";

test("coordinate endpoint resolves authorized saved Sites without geocoding or writes", async () => {
  const app = express();
  const workspace = { customers: [{ id: "customer", address: "Private main office", sites: [
    { id: "main", address: "Private main office", latitude: 1, longitude: 2 },
    { id: "site", address: "Private service address", lat: "-37.8", lon: "145" },
    { id: "missing", address: "Private missing location" },
  ] }], jobs: [
    { id: "one", customerId: "customer", siteId: "site", jobAddress: "Private main office" },
    { id: "two", customerId: "customer", jobAddress: " Private   service address " },
    { id: "missing", customerId: "customer", siteId: "missing", latitude: -35, longitude: 140 },
    { id: "unlinked", customerId: "customer", jobAddress: "Unknown", latitude: -35, longitude: 140 },
  ] };
  const before = structuredClone(workspace);
  app.use(createMapLocationsRouter({
    requireAuth: (req, res, next) => {
      if (!req.headers["x-test-role"]) return res.sendStatus(401);
      req.user = { role: req.headers["x-test-role"] }; next();
    },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
    readWorkspace: (user) => { assert.ok(["admin", "office"].includes(user.role)); return workspace; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/map/locations`;
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/dev/map-locations`)).status, 404);
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { "x-test-role": "technician" } })).status, 403);
    for (const role of ["admin", "office"]) {
      const response = await fetch(url, { headers: { "x-test-role": role } });
      assert.equal(response.headers.get("cache-control"), "no-store");
      const payload = await response.json();
      assert.deepEqual(payload.results, [
        { jobId: "one", siteId: "site", location: { lat: -37.8, lng: 145 }, reason: null },
        { jobId: "two", siteId: "site", location: { lat: -37.8, lng: 145 }, reason: null },
        { jobId: "missing", siteId: "missing", location: null, reason: "site-missing-coordinates" },
        { jobId: "unlinked", siteId: null, location: null, reason: "site-not-found" },
      ]);
      assert.equal(payload.source, "saved-site-coordinates");
      assert.equal(payload.summary.mappedJobs, 2);
      assert.equal(payload.summary.unmappedJobs, 2);
      assert.equal(JSON.stringify(payload).includes("Private"), false);
    }
    assert.deepEqual(workspace, before);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
