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
