export const CALENDAR_UNDO_LIMIT = 10;

// Explicit scheduling requests only; no stale job objects or arbitrary patches.
export function calendarUndoRequest(entry) {
  if (entry.type === "day-reschedule") return {
    path: "/api/jobs/reschedule-day", method: "POST", body: {
      sourceDate: entry.after.scheduledDate, scheduledDate: entry.before.scheduledDate,
      jobs: entry.jobs.map(({ id }) => ({ id, expectedScheduledDate: entry.after.scheduledDate })),
    },
  };
  if (entry.type === "maintenance-occurrence-reschedule") return {
    path: `/api/maintenance-plans/${encodeURIComponent(entry.planId)}/occurrences`, method: "PATCH", body: {
      occurrenceKey: entry.occurrenceKey, nextDueDate: entry.before.date,
      restore: { expectedDate: entry.after.date, scheduleToken: entry.scheduleToken, overrideDate: entry.before.overrideDate },
    },
  };
  if (["job-reschedule", "completed-maintenance-reschedule"].includes(entry.type)) return {
    path: `/api/jobs/${encodeURIComponent(entry.entityId)}/schedule`, method: "PATCH", body: {
      scheduledDate: entry.before.scheduledDate, expectedScheduledDate: entry.after.scheduledDate,
      ...(entry.type === "completed-maintenance-reschedule" ? {
        completedMaintenanceCorrection: true, occurrenceRestore: {
          key: entry.occurrenceKey, expectedDate: entry.after.occurrenceDate,
          date: entry.before.occurrenceDate, overrideDate: entry.before.occurrenceOverrideDate,
        },
      } : {}),
    },
  };
  throw new Error("This Calendar action cannot be undone.");
}

export function calendarUndoProjection(entry) {
  if (!entry) return { jobs: new Map(), occurrence: null };
  return {
    jobs: new Map(entry.type === "day-reschedule" ? entry.jobs.map(({ id }) => [id, entry.before.scheduledDate])
      : entry.entityId ? [[entry.entityId, entry.before.scheduledDate]] : []),
    occurrence: entry.occurrenceKey ? { key: entry.occurrenceKey, date: entry.before.occurrenceDate || entry.before.date } : null,
  };
}
