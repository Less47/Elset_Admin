function updateMarker(entry, group, cluster = false) {
  entry.jobs = group.jobs;
  const allCompleted = group.jobs.every((job) => job.status === "Completed");
  const urgent = group.jobs.some((job) => job.urgency === "High" && job.status !== "Completed");
  const single = group.jobs[0];
  entry.marker.title = group.jobs.length === 1 ? `#${single.jobNumber || ""} ${single.title || "Job"}`
    : `${group.jobs.length} jobs at ${cluster ? "nearby locations" : "this location"}`;
  entry.pin.className = `google-test-pin ${cluster ? "google-test-cluster" : allCompleted ? "is-completed" : urgent ? "is-urgent" : ""}`;
  entry.pin.textContent = group.jobs.length > 1 ? String(group.jobs.length) : "";
}

export function createGoogleMarkerManager({ map, AdvancedMarkerElement, MarkerClusterer, SuperClusterAlgorithm, onSelect, makePin = () => document.createElement("span") }) {
  const entries = new Map();
  const jobsByMarker = new Map();
  let needsRedraw = false;
  let lastVisibleSignature = "";
  const baseAlgorithm = new SuperClusterAlgorithm({ radius: 60, maxZoom: 16 });
  function makeEntry(group, cluster = false) {
    const marker = new AdvancedMarkerElement({ position: group.position, gmpClickable: true });
    const pin = makePin();
    marker.append(pin);
    const entry = { marker, pin, jobs: group.jobs, active: false };
    updateMarker(entry, group, cluster);
    return entry;
  }
  const clusterJobs = (cluster) => cluster.markers.flatMap((marker) => jobsByMarker.get(marker) || []);
  const clusterer = new MarkerClusterer({ map, markers: [],
    algorithm: { calculate: (input) => {
      const result = baseAlgorithm.calculate(input);
      const changed = result.changed || needsRedraw;
      needsRedraw = false;
      return { ...result, changed };
    } },
    renderer: { render: (cluster) => makeEntry({ position: cluster.position, jobs: clusterJobs(cluster) }, true).marker },
    onClusterClick: (_event, cluster) => {
      onSelect(clusterJobs(cluster), cluster.position, true);
      if (cluster.bounds) map.fitBounds(cluster.bounds, { top: 140, right: 48, bottom: 100, left: 48 });
    },
  });

  return {
    sync(allGroups, visibleGroups) {
      const present = new Set(allGroups.map((group) => group.key));
      const visible = new Map(visibleGroups.map((group) => [group.key, group]));
      const removed = [], added = [];
      for (const [key, entry] of entries) {
        if (!visible.has(key) && entry.active) { removed.push(entry.marker); entry.active = false; }
        if (!present.has(key)) {
          entry.listener.remove();
          jobsByMarker.delete(entry.marker);
          entries.delete(key);
        }
      }
      for (const group of visibleGroups) {
        let entry = entries.get(group.key);
        if (!entry) {
          entry = makeEntry(group);
          entry.listener = entry.marker.addListener("click", () => onSelect(entry.jobs, entry.marker.position, false));
          entries.set(group.key, entry);
        } else updateMarker(entry, group);
        jobsByMarker.set(entry.marker, group.jobs);
        if (!entry.active) { added.push(entry.marker); entry.active = true; }
      }
      const signature = JSON.stringify(visibleGroups.map((group) => [group.key, group.jobs.map((job) => [job.id, job.status, job.urgency, job.title, job.jobNumber])]));
      needsRedraw ||= signature !== lastVisibleSignature;
      lastVisibleSignature = signature;
      if (removed.length) clusterer.removeMarkers(removed, true);
      if (added.length) clusterer.addMarkers(added, true);
      if (needsRedraw || removed.length || added.length) clusterer.render();
    },
    dispose() {
      entries.forEach((entry) => { entry.listener.remove(); entry.marker.map = null; });
      clusterer.clearMarkers(true);
      clusterer.setMap(null);
      entries.clear();
      jobsByMarker.clear();
    },
  };
}
