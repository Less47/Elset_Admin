// Date-only maintenance domain. Month arithmetic intentionally preserves the
// original setMonth overflow (31 January -> 3 March), applied cycle by cycle.
import { frequencyMonths, normalizeMaintenanceFrequency } from "./maintenance-frequency.js";
export { frequencyMonths } from "./maintenance-frequency.js";

export function isMaintenanceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function advanceMaintenanceDate(value, frequency) {
  if (!isMaintenanceDate(value)) return "";
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + frequencyMonths[normalizeMaintenanceFrequency(frequency)]);
  return date.getUTCFullYear() > 9999 ? "" : date.toISOString().slice(0, 10);
}

export function maintenanceToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatMaintenanceDate(value) {
  if (!value) return "Not set";
  if (isMaintenanceDate(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  return new Date(value).toLocaleDateString("en-AU");
}

export function maintenanceSchedule(plan) {
  return plan.recurrence?.segments?.length ? { ...plan.recurrence, segments: plan.recurrence.segments.map((segment) => ({ ...segment, frequency: normalizeMaintenanceFrequency(segment.frequency) })) } : {
    segments: [{ id: "initial", anchorDate: plan.nextDueDate, frequency: normalizeMaintenanceFrequency(plan.frequency) }],
  };
}

function firstDateInRange(segment, from) {
  let date = segment.anchorDate;
  // All supported month intervals settle any overflow within 48 cycles.
  // Jump only after that prefix, so a distant range never expands decades.
  for (let i = 0; i < 48 && date && date < from; i++) date = advanceMaintenanceDate(date, segment.frequency);
  if (!date) return "";
  if (date < from) {
    const months = (Number(from.slice(0, 4)) - Number(date.slice(0, 4))) * 12 + Number(from.slice(5, 7)) - Number(date.slice(5, 7));
    const interval = frequencyMonths[normalizeMaintenanceFrequency(segment.frequency)];
    const jump = Math.max(0, Math.floor(months / interval) - 1);
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + jump * interval);
    date = value.toISOString().slice(0, 10);
    while (date && date < from) date = advanceMaintenanceDate(date, segment.frequency);
  }
  return date;
}

function baseOccurrence(plan, segment, date) {
  const first = (date === segment.anchorDate ? segment.firstOccurrence : null)
    || segment.protectedOccurrences?.find((entry) => entry.date === date);
  const originalDate = first?.originalDate || date;
  const seriesId = first?.seriesId || segment.id;
  const key = first?.key || `${plan.id}:${seriesId}:${originalDate}`;
  return { key, id: `maintenance:${key}`, kind: "maintenance", planId: plan.id, seriesId, originalDate,
    segmentId: segment.id, baseDate: date, date, frequency: normalizeMaintenanceFrequency(segment.frequency), planName: plan.planName,
    customerId: plan.customerId, siteAddress: plan.siteAddress, revision: plan.maintenanceRevision || 0 };
}

export function expandMaintenanceOccurrences(plan, from, to, jobs = [], today = maintenanceToday()) {
  if (!isMaintenanceDate(from) || !isMaintenanceDate(to) || from > to) return [];
  const schedule = maintenanceSchedule(plan);
  const exceptions = new Map((plan.occurrenceExceptions || []).map((entry) => [entry.key, entry]));
  const linkedJobs = jobs.filter((job) => job.maintenancePlanId === plan.id);
  const results = new Map();
  function add(base, exception = exceptions.get(base.key)) {
    const date = exception?.overrideDate || ((exception?.jobId || exception?.completedAt || exception?.generatedJobId) ? exception.snapshot?.date : "") || base.date;
    if (date < from || date > to) return;
    const job = linkedJobs.find((entry) => entry.id === exception?.jobId || entry.maintenanceOccurrenceKey === base.key)
      || linkedJobs.find((entry) => !entry.maintenanceOccurrenceKey && entry.maintenanceDueDate === base.originalDate);
    if (plan.active === false && date >= today) return;
    const completedAt = exception?.completedAt || (job?.status === "Completed" ? job.updatedAt : "");
    results.set(base.key, { ...base, date, scheduledDate: date, jobId: job?.id || exception?.jobId || "",
      jobNumber: job?.jobNumber, jobStatus: job?.status, jobScheduledDate: job?.scheduledDate || "",
      completedAt, generated: Boolean(job || exception?.jobId || exception?.generatedJobId), generatedJobId: exception?.generatedJobId || job?.id || "",
      locked: Boolean(completedAt || ((job || exception?.generatedJobId) && date < today)), active: plan.active !== false,
      revision: plan.maintenanceRevision || 0 });
  }
  for (const segment of schedule.segments) {
    if (!isMaintenanceDate(segment.anchorDate) || (segment.untilDate && segment.untilDate <= from)) continue;
    for (let date = firstDateInRange(segment, from); date && date <= to && (!segment.untilDate || date < segment.untilDate); date = advanceMaintenanceDate(date, segment.frequency)) {
      add(baseOccurrence(plan, segment, date));
    }
  }
  // Include overrides moved INTO the range, and factual generated/completed
  // occurrences retained after a schedule cutover. Never manufacture jobs.
  for (const exception of exceptions.values()) {
    if (exception.snapshot) add({ ...exception.snapshot, planName: plan.planName, siteAddress: plan.siteAddress, customerId: plan.customerId }, exception);
  }
  // Older jobs have a plan + due date, but no stable occurrence key yet.
  for (const job of linkedJobs) {
    if (!isMaintenanceDate(job.maintenanceDueDate) || [...results.values()].some((entry) => entry.jobId === job.id)) continue;
    if ((plan.occurrenceExceptions || []).some((entry) => entry.jobId === job.id)) continue;
    const base = baseOccurrence(plan, { id: "legacy", frequency: plan.frequency }, job.maintenanceDueDate);
    add(base, { jobId: job.id });
  }
  return [...results.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export function nextMaintenanceOccurrence(plan, jobs = []) {
  const schedule = maintenanceSchedule(plan);
  const candidates = [];
  // Seek only as far as the finite number of acted-on occurrences can require.
  const count = (plan.occurrenceExceptions || []).length + jobs.filter((job) => job.maintenancePlanId === plan.id).length + 2;
  for (const segment of schedule.segments) {
    let date = segment.anchorDate;
    for (let i = 0; i < count && isMaintenanceDate(date) && (!segment.untilDate || date < segment.untilDate); i++) {
      const occurrence = baseOccurrence(plan, segment, date);
      const exception = (plan.occurrenceExceptions || []).find((entry) => entry.key === occurrence.key);
      const job = jobs.find((entry) => entry.maintenancePlanId === plan.id && (entry.id === exception?.jobId || entry.maintenanceOccurrenceKey === occurrence.key || (!entry.maintenanceOccurrenceKey && entry.maintenanceDueDate === occurrence.originalDate)));
      if (!exception?.jobId && !exception?.generatedJobId && !exception?.completedAt && !job) candidates.push({ ...occurrence, date: exception?.overrideDate || date });
      date = advanceMaintenanceDate(date, segment.frequency);
    }
  }
  return candidates.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))[0] || null;
}

export function effectiveMaintenancePlan(plan, jobs = []) {
  const next = nextMaintenanceOccurrence(plan, jobs);
  return { ...plan, frequency: normalizeMaintenanceFrequency(plan.frequency), recurrence: maintenanceSchedule(plan), nextDueDate: next?.date || plan.nextDueDate, nextOccurrence: next,
    maintenanceRevision: plan.maintenanceRevision || 0, active: plan.active !== false,
    contractPriceSet: plan.contractPriceSet ?? Number(plan.contractPrice) > 0 };
}

export function changeMaintenanceSchedule(plan, occurrence, date, frequency = plan.frequency, segmentId) {
  const segments = maintenanceSchedule(plan).segments;
  const selectedIndex = segments.findIndex((segment) => {
    if (segment.id === occurrence.segmentId && occurrence.baseDate >= segment.anchorDate && (!segment.untilDate || occurrence.baseDate < segment.untilDate)) return true;
    if (segment.firstOccurrence?.key === occurrence.key && (!segment.untilDate || segment.anchorDate < segment.untilDate)) return true;
    return segment.id === occurrence.seriesId && occurrence.baseDate >= segment.anchorDate && (!segment.untilDate || occurrence.baseDate < segment.untilDate);
  });
  if (selectedIndex < 0) throw new Error("This occurrence belongs to an earlier schedule. Refresh and select a current occurrence.");
  const protectedKeys = new Map((plan.occurrenceExceptions || []).filter((entry) => entry.key !== occurrence.key && (entry.jobId || entry.completedAt || entry.generatedJobId)).map((entry) => [entry.key, entry]));
  const protectedOccurrences = [];
  // Reserve the corresponding cycle for already generated/completed work.
  // Its factual row and job keep their original date, without a second planned
  // visit appearing beside them after the cadence changes.
  if (protectedKeys.size) {
    const lastDate = [...protectedKeys.values()].reduce((last, entry) => entry.snapshot?.baseDate > last ? entry.snapshot.baseDate : last, occurrence.baseDate);
    const priorProtectedDates = segments.flatMap((segment) => (segment.protectedOccurrences || []).filter((entry) => protectedKeys.has(entry.key)).map((entry) => entry.date));
    const until = priorProtectedDates.reduce((last, value) => value > last ? value : last, lastDate);
    let newDate = date;
    for (const segment of segments.slice(selectedIndex)) {
      for (let oldDate = firstDateInRange(segment, occurrence.baseDate); oldDate && newDate && oldDate <= until && (!segment.untilDate || oldDate < segment.untilDate); oldDate = advanceMaintenanceDate(oldDate, segment.frequency)) {
        const candidate = baseOccurrence(plan, segment, oldDate);
        if (protectedKeys.has(candidate.key)) protectedOccurrences.push({ date: newDate, key: candidate.key, originalDate: candidate.originalDate, seriesId: candidate.seriesId });
        newDate = advanceMaintenanceDate(newDate, frequency);
      }
    }
  }
  return { ...plan, frequency, recurrence: { segments: [
    ...segments.slice(0, selectedIndex),
    { ...segments[selectedIndex], untilDate: occurrence.baseDate },
    { id: segmentId, anchorDate: date, frequency, protectedOccurrences, firstOccurrence: { key: occurrence.key, seriesId: occurrence.seriesId, originalDate: occurrence.originalDate } },
  ] } };
}
