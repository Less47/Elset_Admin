import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleMarkerManager } from "../src/components/map/google-marker-manager.js";
import { groupJobsByPosition } from "../src/components/map/google-map-data.js";

test("marker reconciliation preserves instances through filters and updates group contents and counts", () => {
  const markers = [], clusterers = [], selections = [];
  class Marker {
    constructor(options) { Object.assign(this, options); markers.push(this); }
    append(pin) { this.pin = pin; }
    addListener(_event, callback) { this.click = callback; return { remove: () => { this.removed = true; } }; }
  }
  class Clusterer {
    constructor(options) { Object.assign(this, options); this.markers = []; this.renders = 0; clusterers.push(this); }
    addMarkers(markers) { this.markers.push(...markers); }
    removeMarkers(markers) { this.markers = this.markers.filter((marker) => !markers.includes(marker)); }
    clearMarkers() { this.markers = []; }
    setMap(map) { this.map = map; }
    render() { this.renders++; this.algorithm.calculate({}); }
  }
  class Algorithm { calculate() { return { clusters: [], changed: false }; } }
  const jobs = [{ id: "a", position: { lat: -37.8, lng: 145 }, title: "First", status: "To Do" },
    { id: "b", position: { lat: -37.8, lng: 145 }, title: "Second", status: "Completed" },
    { id: "c", position: { lat: -37.9, lng: 145.1 }, title: "Third", status: "To Do" }];
  const all = groupJobsByPosition(jobs);
  const manager = createGoogleMarkerManager({ map: {}, AdvancedMarkerElement: Marker, MarkerClusterer: Clusterer, SuperClusterAlgorithm: Algorithm,
    onSelect: (selected) => selections.push(selected.map((job) => job.id)), makePin: () => ({}) });
  manager.sync(all, all);
  assert.equal(markers.length, 2);
  assert.equal(clusterers.length, 1);
  const renderCount = clusterers[0].renders;
  manager.sync(all, all);
  assert.equal(clusterers[0].renders, renderCount);
  manager.sync(all, groupJobsByPosition([jobs[1]]));
  assert.equal(markers.length, 2);
  assert.equal(markers[0].pin.textContent, "");
  assert.match(markers[0].pin.className, /is-completed/);
  markers[0].click();
  assert.deepEqual(selections.at(-1), ["b"]);
  manager.sync(all, all);
  assert.equal(markers.length, 2);
  assert.equal(markers[0].pin.textContent, "2");
  markers[0].click();
  assert.deepEqual(selections.at(-1), ["a", "b"]);
  const clusterMarker = clusterers[0].renderer.render({ position: jobs[0].position, markers: [markers[0], markers[1]] });
  assert.equal(clusterMarker.pin.textContent, "3");
  manager.sync(groupJobsByPosition([jobs[2]]), groupJobsByPosition([jobs[2]]));
  assert.equal(markers[0].removed, true);
  manager.dispose();
  assert.equal(clusterers[0].map, null);
  assert.equal(markers[1].removed, true);
});
