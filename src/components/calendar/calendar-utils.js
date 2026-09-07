import { statuses } from "../../lib/job-status.js";

export const queueStatuses = statuses.filter((status) => status !== "Completed");
export const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function formatCalendarDate(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!isCalendarDate(value)) return "Unscheduled";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-AU", options);
}

export function filterQueueJobs(jobs, { search = "", urgency = "all", schedule = "all" } = {}) {
  const query = search.trim().toLowerCase();
  return jobs.filter((job) => {
    if (!queueStatuses.includes(job.status)) return false;
    if (urgency !== "all" && job.urgency !== urgency) return false;
    if (schedule === "scheduled" && !job.scheduledDate) return false;
    if (schedule === "unscheduled" && job.scheduledDate) return false;
    return [job.jobNumber, job.customerName, job.title, job.description, job.jobAddress, job.scheduledDate, job.assignedTechnicianName]
      .join(" ").toLowerCase().includes(query);
  });
}

export function groupCalendarJobs(jobs, dateKey) {
  const days = new Map();
  for (const job of jobs) {
    const key = dateKey(job.scheduledDate);
    if (!key) continue;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(job);
  }
  for (const dayJobs of days.values()) {
    dayJobs.sort((a, b) => statuses.indexOf(a.status) - statuses.indexOf(b.status)
      || (a.jobNumber || 0) - (b.jobNumber || 0)
      || String(a.id).localeCompare(String(b.id)));
  }
  return days;
}
