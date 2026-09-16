import { jobMapSymbol } from "../../lib/job-status.js";
import { markerStacksByJob } from "./google-map-data.js";

export function createGoogleMarkerManager({ map, AdvancedMarkerElement, CollisionBehavior, onSelect, makePin = () => document.createElement("span") }) {
  const entries = new Map();
  let stacks = new Map();
  let selectedId = null;
  function setEmphasis(entry) {
    const selected = entry.job.id === selectedId;
    entry.marker.zIndex = selected ? 100002 : entry.hovered || entry.focused ? 100001 : 1;
    entry.pin.dataset.selected = String(selected);
  }
  function setSelected(id) {
    const previous = entries.get(selectedId);
    selectedId = id;
    if (previous) setEmphasis(previous);
    const next = entries.get(id);
    if (next) setEmphasis(next);
  }
  function select(job, cycling = false) {
    setSelected(job.id);
    onSelect(job, cycling);
  }
  function cycle(id, direction = 1) {
    const stack = stacks.get(id);
    if (!stack?.length) return;
    const index = stack.findIndex((job) => job.id === id);
    select(stack[(index + direction + stack.length) % stack.length], true);
  }
  function makeEntry(job) {
    const marker = new AdvancedMarkerElement({ position: job.position, gmpClickable: true,
      anchorLeft: "-50%", anchorTop: "-50%", collisionBehavior: CollisionBehavior.REQUIRED });
    const pin = makePin();
    pin.className = "google-test-pin";
    pin.dataset.jobId = job.id;
    const dot = makePin();
    dot.className = "google-job-dot";
    dot.setAttribute("aria-hidden", "true");
    pin.append(dot);
    marker.append(pin);
    const entry = { marker, pin, dot, job, active: false, events: [] };
    const listen = (event, callback) => {
      marker.addEventListener(event, callback);
      entry.events.push([event, callback]);
    };
    listen("gmp-click", () => {
      const stack = stacks.get(entry.job.id);
      if (stack?.length > 1 && stack.some((job) => job.id === selectedId)) cycle(selectedId);
      else select(entry.job);
    });
    for (const [event, field, value] of [["mouseenter", "hovered", true], ["mouseleave", "hovered", false],
      ["focusin", "focused", true], ["focusout", "focused", false]]) {
      listen(event, () => { entry[field] = value; setEmphasis(entry); });
    }
    return entry;
  }
  function remove(entry) {
    entry.events.forEach(([event, callback]) => entry.marker.removeEventListener(event, callback));
    entry.marker.map = null;
  }
  return {
    sync(allJobs, visibleJobs, nextStacks = markerStacksByJob(visibleJobs)) {
      stacks = nextStacks;
      const present = new Set(allJobs.filter((job) => job.position).map((job) => job.id));
      const visible = new Set(visibleJobs.map((job) => job.id));
      for (const [id, entry] of entries) {
        if (!present.has(id)) { remove(entry); entries.delete(id); }
        else if (!visible.has(id) && entry.active) {
          entry.marker.map = null;
          entry.active = false;
          entry.hovered = entry.focused = false;
        }
      }
      for (const job of visibleJobs) {
        if (!job.position) continue;
        let entry = entries.get(job.id);
        if (!entry) { entry = makeEntry(job); entries.set(job.id, entry); }
        const { lat, lng } = entry.job.position;
        if (lat !== job.position.lat || lng !== job.position.lng) entry.marker.position = job.position;
        entry.job = job;
        const { tone, glyph } = jobMapSymbol(job.status);
        const title = `Job #${job.jobNumber || "—"} – ${job.status || "Status not set"} – ${job.customerName || "Customer not set"} – ${job.title || "Job"}`
          + ((stacks.get(job.id)?.length || 0) > 1 ? ". Tap again for the next job here." : "");
        if (entry.marker.title !== title) entry.marker.title = title;
        if (entry.pin.dataset.tone !== tone) { entry.pin.dataset.tone = tone; entry.dot.textContent = glyph; }
        setEmphasis(entry);
        if (!entry.active) { entry.marker.map = map; entry.active = true; }
      }
    },
    setSelected,
    cycle,
    dispose() { entries.forEach(remove); entries.clear(); stacks = new Map(); },
  };
}
