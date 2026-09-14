import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createMapLocationsRouter } from "../server-map-locations-routes.js";

test("coordinate endpoint uses only authorized job addresses and never resolves cache misses", async () => {
  const app = express();
  const addresses = [];
  const cache = new Map([["10 Example Lane", { lat: -37.8, lon: 145, formatted: "Do not return this" }], ["Invalid", { lat: null, lon: null }]]);
  const before = structuredClone(cache);
  app.use(createMapLocationsRouter({
    requireAuth: (req, res, next) => {
      if (!req.headers["x-test-role"]) return res.sendStatus(401);
      req.user = { role: req.headers["x-test-role"] }; next();
    },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
    readWorkspace: (user) => { assert.ok(["admin", "office"].includes(user.role)); return { jobs: [
      { id: "one", jobAddress: " 10   Example Lane " }, { id: "two", jobAddress: "10 Example Lane" },
      { id: "missing", jobAddress: "Unknown" }, { id: "invalid", jobAddress: "Invalid" }, { id: "blank", jobAddress: "" },
    ] }; },
    getCachedLocation: (address) => { addresses.push(address); return cache.get(address); },
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
        { jobId: "one", location: { lat: -37.8, lon: 145 } }, { jobId: "two", location: { lat: -37.8, lon: 145 } },
        { jobId: "missing", location: null }, { jobId: "invalid", location: null }, { jobId: "blank", location: null },
      ]);
      assert.equal(payload.source, "geoapify-runtime-cache");
    }
    assert.deepEqual(cache, before);
    assert.deepEqual([...new Set(addresses)], ["10 Example Lane", "Unknown", "Invalid"]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
