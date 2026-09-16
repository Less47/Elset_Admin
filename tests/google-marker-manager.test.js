import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleMarkerManager } from "../src/components/map/google-marker-manager.js";
import { markerStacksByJob } from "../src/components/map/google-map-data.js";
import { jobMapSymbol, statuses } from "../src/lib/job-status.js";
import { buildSemanticTheme, contrastRatio } from "../src/lib/theme-tokens.js";
import { themePresets } from "../src/lib/theme-presets.js";

function setup() {
  const markers = [], selections = [];
  class Marker extends EventTarget {
    constructor(options) { super(); Object.assign(this, options); this.handlers = new Set(); markers.push(this); }
    append(pin) { this.pin = pin; }
    addEventListener(name, fn) { super.addEventListener(name, fn); this.handlers.add(fn); }
    removeEventListener(name, fn) { super.removeEventListener(name, fn); this.handlers.delete(fn); }
  }
  const map = {};
  const manager = createGoogleMarkerManager({ map, AdvancedMarkerElement: Marker, CollisionBehavior: { REQUIRED: "REQUIRED" },
    onSelect: (job, cycling) => selections.push({ job, cycling }),
    makePin: () => ({ dataset: {}, append(dot) { this.dot = dot; }, setAttribute() {} }) });
  return { markers, selections, map, manager };
}
const jobs = [{ id: "a", position: { lat: -37.8, lng: 145 }, title: "First", jobNumber: 278, customerName: "Example", status: "To Do" },
  { id: "b", position: { lat: -37.8, lng: 145 }, title: "Second", status: "Completed" },
  { id: "c", position: { lat: -37.9, lng: 145.1 }, title: "Third", status: "In Progress" }];

test("each mapped job has a REQUIRED marker; filters reuse instances and remove hidden jobs", () => {
  const { markers, map, manager } = setup();
  const all = [...jobs, { id: "missing", position: null }];
  manager.sync(all, all);
  assert.equal(markers.length, 3);
  assert.ok(markers.every((marker) => marker.map === map && marker.collisionBehavior === "REQUIRED"));
  assert.match(markers[0].title, /Job #278.*To Do.*Example/);
  assert.deepEqual(markers.map((marker) => marker.position), jobs.map((job) => job.position));
  manager.sync(all, [jobs[1]]);
  assert.deepEqual(markers.map((marker) => Boolean(marker.map)), [false, true, false]);
  manager.sync(all, jobs);
  assert.equal(markers.length, 3);
  const updated = jobs.map((job) => job.id === "a" ? { ...job, status: "In Progress", position: { lat: -38, lng: 146 } } : job);
  manager.sync(updated, updated);
  assert.equal(markers[0].pin.dataset.tone, "info");
  assert.deepEqual(markers[0].position, updated[0].position);
  manager.sync(updated.slice(1), updated.slice(1));
  assert.equal(markers[0].map, null);
  assert.equal(markers[0].handlers.size, 0);
  manager.dispose();
  assert.ok(markers.every((marker) => marker.map === null && marker.handlers.size === 0));
});

test("overlap clicks cycle deterministically; selected stays above hovered and focused markers", () => {
  const { markers, selections, map, manager } = setup();
  manager.sync(jobs, jobs);
  markers[0].dispatchEvent(new Event("gmp-click"));
  assert.equal(selections.at(-1).job.id, "a");
  markers[1].dispatchEvent(new Event("mouseenter"));
  assert.ok(markers[0].zIndex > markers[1].zIndex && markers[1].zIndex > markers[2].zIndex);
  markers[0].dispatchEvent(new Event("gmp-click"));
  assert.equal(selections.at(-1).job.id, "b");
  assert.equal(selections.at(-1).cycling, true);
  assert.ok(markers[1].zIndex > markers[0].zIndex);
  manager.cycle("b");
  assert.equal(selections.at(-1).job.id, "a");
  manager.setSelected(null);
  markers[1].dispatchEvent(new Event("mouseleave"));
  markers[2].dispatchEvent(new Event("focusin"));
  assert.ok(markers[2].zIndex > markers[0].zIndex);
  assert.ok(markers.every((marker) => marker.map === map));
  manager.sync(jobs, [jobs[0]]);
  markers[0].dispatchEvent(new Event("gmp-click"));
  assert.equal(selections.at(-1).job.id, "a");
  manager.dispose();
});

test("near-exact stacks cross bucket boundaries, are stable and never move saved positions", () => {
  const all = [...jobs, { id: "d", position: { lat: -37.8000005, lng: 145.0000005 } }];
  const before = structuredClone(all);
  const stacks = markerStacksByJob(all);
  assert.deepEqual(stacks.get("a").map((job) => job.id), ["a", "b", "d"]);
  assert.equal(stacks.get("c").length, 1);
  assert.deepEqual(markerStacksByJob([...all].reverse()).get("a"), stacks.get("a"));
  assert.deepEqual(all, before);
});

test("all authoritative statuses have saturated map colours and intentional unknown fallback", () => {
  assert.deepEqual(statuses.map((status) => jobMapSymbol(status).tone), ["warning", "info", "success"]);
  for (const status of [undefined, "", "Cancelled", "completed", "toString", "__proto__"]) assert.equal(jobMapSymbol(status).tone, "unknown");
  for (const theme of themePresets) {
    const { vars } = buildSemanticTheme(theme.values);
    assert.equal(vars["--map-marker-warning"], "#F5B700");
    assert.equal(vars["--map-marker-info"], "#0F90CD");
    assert.equal(vars["--map-marker-success"], "#149447");
    for (const tone of ["warning", "info", "success", "unknown"]) {
      assert.ok(contrastRatio(vars[`--map-marker-${tone}`], tone === "unknown" ? "#FFFFFF" : "#07111F") >= 4.5, tone);
    }
  }
});

test("hundreds of jobs reconcile without marker churn during repeated filters or selection", () => {
  const { manager, markers } = setup();
  const all = Array.from({ length: 500 }, (_, i) => ({ ...jobs[i % 3], id: `job-${i}` }));
  manager.sync(all, all);
  for (let i = 0; i < 20; i++) {
    manager.sync(all, all.filter((_, index) => index % 2 === i % 2));
    manager.setSelected(`job-${i}`);
  }
  manager.sync(all, all);
  assert.equal(markers.length, 500);
  assert.equal(markers.filter((marker) => marker.map).length, 500);
  manager.dispose();
});
