import assert from "node:assert/strict";
import test from "node:test";
import { groupJobsByPosition, matchesMapFilters, readSavedPosition } from "../src/components/map/google-map-data.js";

test("saved positions accept complete coordinate pairs and reject missing or invalid values", () => {
  assert.deepEqual(readSavedPosition({ latitude: "-37.8136", longitude: "144.9631" }), { lat: -37.8136, lng: 144.9631 });
  assert.deepEqual(readSavedPosition({ location: { lat: -37.81, lon: 144.96 } }), { lat: -37.81, lng: 144.96 });
  assert.deepEqual(readSavedPosition({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
  for (const record of [null, {}, { latitude: null, longitude: null }, { lat: "", lon: " " },
    { latitude: 91, longitude: 145 }, { latitude: -38, longitude: 181 }, { lat: true, lon: false },
    { lat: NaN, lon: Infinity }, { latitude: -38, location: { longitude: 145 } }]) {
    assert.equal(readSavedPosition(record), null);
  }
});

test("coincident jobs remain reachable without changing their coordinates", () => {
  const position = { lat: -37.8136, lng: 144.9631 };
  const jobs = [{ id: "one", position }, { id: "two", position }, { id: "missing", position: null },
    { id: "nearby", position: { lat: -37.8137, lng: 144.9631 } }];
  const before = structuredClone(jobs);
  const groups = groupJobsByPosition(jobs);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].jobs.map((job) => job.id), ["one", "two"]);
  assert.deepEqual(jobs, before);
});

test("map filters preserve legacy urgent, completion, type and text semantics", () => {
  const job = { jobNumber: 101, title: "Gate repair", customerName: "Example", description: "Motor", jobAddress: "Melbourne",
    status: "Completed", urgency: "High", siteType: "commercial", customerType: "business",
    siteTypeLabel: "Commercial", customerTypeLabel: "Business" };
  assert.equal(matchesMapFilters(job, { jobFilter: "urgent" }), true);
  assert.equal(matchesMapFilters(job, { jobFilter: "incomplete" }), false);
  assert.equal(matchesMapFilters(job, { jobFilter: "completed", siteTypeFilter: "commercial", customerTypeFilter: "business", search: " motor " }), true);
  assert.equal(matchesMapFilters(job, { siteTypeFilter: "not-set" }), false);
  assert.equal(matchesMapFilters(job, { customerTypeFilter: "residential" }), false);
  assert.equal(matchesMapFilters({}, { siteTypeFilter: "not-set", customerTypeFilter: "not-set" }), true);
  for (const search of ["101", "gate", "example", "melbourne", "commercial", "business"]) assert.equal(matchesMapFilters(job, { search }), true);
  assert.equal(matchesMapFilters(job, { search: "unmatched" }), false);
});
