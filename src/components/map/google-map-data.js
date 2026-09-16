export { readSavedPosition } from "../../lib/site-location.js";

export function groupJobsByPosition(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    if (!job.position) continue;
    const key = `${job.position.lat},${job.position.lng}`;
    if (!groups.has(key)) groups.set(key, { key, position: job.position, jobs: [] });
    groups.get(key).jobs.push(job);
  }
  return [...groups.values()];
}

export { matchesMapFilters } from "./map-filters.js";

// Interaction stacks only: every job still gets its own marker at its saved
// coordinates. About one metre of tolerance catches near-identical Site pins.
// Neighbour buckets avoid an all-pairs scan and fixed representatives prevent
// a chain of nearby jobs from growing into a geographically broad group.
export function markerStacksByJob(jobs) {
  const tolerance = 0.00001;
  const buckets = new Map();
  const stacks = new Map();
  for (const job of [...jobs].filter((job) => job.position).sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const { lat, lng } = job.position;
    const x = Math.floor(lat / tolerance), y = Math.floor(lng / tolerance);
    let stack;
    for (let dx = -1; dx <= 1 && !stack; dx++) for (let dy = -1; dy <= 1 && !stack; dy++) {
      stack = buckets.get(`${x + dx}:${y + dy}`)?.find((candidate) =>
        Math.hypot(lat - candidate[0].position.lat, lng - candidate[0].position.lng) <= tolerance);
    }
    if (!stack) {
      stack = [];
      const key = `${x}:${y}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(stack);
    }
    stack.push(job);
    stacks.set(job.id, stack);
  }
  return stacks;
}
