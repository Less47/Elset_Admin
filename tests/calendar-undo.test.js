import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateWorkspaceSchema } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { scheduleJob, correctCompletedMaintenanceJobSchedule, updateJobDetails, changeJobStatus, previewDayReschedule, rescheduleDayJobs } from "../server-workspace-jobs.js";
import { createMaintenancePlan, scheduleMaintenancePlan, generateMaintenanceJob, getMaintenanceOccurrences, updateMaintenancePlan } from "../server-workspace-maintenance.js";
import { calendarUndoRequest } from "../src/components/calendar/calendar-undo.js";

function withDb(run) {
  const db = new Database(":memory:"); db.pragma("foreign_keys = ON"); migrateWorkspaceSchema(db);
  const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
  const original = fixture.jobs[0];
  importWorkspaceJsonData(db, { ...fixture, maintenancePlans: [], jobs: [original, { ...original, id: "second", jobNumber: 9999, notes: [], photos: [], quote: null, invoice: null }] });
  const plan = createMaintenancePlan(db, { id: "undo-plan", customerId: original.customerId, siteId: fixture.customers[0].sites[0].id, siteAddress: fixture.customers[0].sites[0].address,
    nextDueDate: "2030-09-15", frequency: "quarterly", planName: "Undo visits" });
  try { return run(db, original.id, plan.id); } finally { db.close(); }
}
const state = (db) => loadWorkspaceStateFromDb(db);
const job = (db, id) => state(db).jobs.find((entry) => entry.id === id);
const plan = (db) => state(db).maintenancePlans.find((entry) => entry.id === "undo-plan");
const visits = (db) => getMaintenanceOccurrences(db, "2030-01-01", "2031-12-31");
const dates = (db) => visits(db).map(({ key, date }) => ({ key, date }));
function otherJobFields(record) {
  const fields = { ...record };
  delete fields.scheduledDate; delete fields.updatedAt;
  return fields;
}
function moveVisit(db, occurrence, nextDueDate) {
  return scheduleMaintenancePlan(db, occurrence.planId, { occurrenceKey: occurrence.key, revision: occurrence.revision, nextDueDate, scope: "occurrence" }, { returnChange: true }).change;
}
function reverse(db, entry) {
  const { body } = calendarUndoRequest(entry);
  if (entry.type === "day-reschedule") return rescheduleDayJobs(db, body);
  if (entry.type === "maintenance-occurrence-reschedule") return scheduleMaintenancePlan(db, entry.planId, { ...body, scope: "occurrence" });
  if (entry.type === "completed-maintenance-reschedule") return correctCompletedMaintenanceJobSchedule(db, entry.entityId, body);
  return scheduleJob(db, entry.entityId, body.scheduledDate, body);
}

test("job inverse writes restore dates in reverse order and preserve newer status, notes and commercial data", () => withDb((db, id) => {
  scheduleJob(db, id, "2030-09-15");
  const first = scheduleJob(db, id, "2030-09-16", { expectedScheduledDate: "2030-09-15", returnChange: true }).change;
  const second = scheduleJob(db, id, "2030-09-17", { expectedScheduledDate: "2030-09-16", returnChange: true }).change;
  updateJobDetails(db, id, { description: "New office edit", assignedTechnicianId: "", status: "In Progress", serviceBoardNote: "New note" });
  const latest = otherJobFields(job(db, id));
  assert.deepEqual(Object.keys(calendarUndoRequest(first).body).sort(), ["expectedScheduledDate", "scheduledDate"]);
  reverse(db, second); assert.equal(job(db, id).scheduledDate, "2030-09-16");
  reverse(db, first); assert.equal(job(db, id).scheduledDate, "2030-09-15");
  assert.deepEqual(otherJobFields(job(db, id)), latest);
  const removal = scheduleJob(db, id, "", { expectedScheduledDate: "2030-09-15", returnChange: true }).change;
  reverse(db, removal); assert.equal(job(db, id).scheduledDate, "2030-09-15");
}));

test("stale and invalid job inverses never overwrite the authoritative schedule", () => withDb((db, id) => {
  const entry = scheduleJob(db, id, "2030-09-16", { returnChange: true }).change;
  scheduleJob(db, id, "2030-09-18");
  const before = state(db);
  assert.throws(() => reverse(db, entry), (error) => error.statusCode === 409);
  assert.throws(() => scheduleJob(db, id, "2030-09-15", { expectedScheduledDate: null }), /valid calendar date/);
  assert.deepEqual(state(db), before);
}));

test("bulk inverse uses date guards, preserves unrelated edits, and reports only stale jobs as conflicts", () => withDb((db, id) => {
  for (const key of [id, "second"]) { updateJobDetails(db, key, { status: "To Do" }); scheduleJob(db, key, "2030-09-15"); }
  const selected = previewDayReschedule(db, "2030-09-15").jobs.map(({ job, revision }) => ({ id: job.id, revision }));
  const result = rescheduleDayJobs(db, { sourceDate: "2030-09-15", scheduledDate: "2030-09-16", jobs: selected });
  const entry = { type: "day-reschedule", before: { scheduledDate: "2030-09-15" }, after: { scheduledDate: "2030-09-16" }, jobs: result.succeeded };
  updateJobDetails(db, id, { status: "Completed", serviceBoardNote: "Keep this newer note" });
  const latest = otherJobFields(job(db, id));
  scheduleJob(db, "second", "2030-09-18");
  const undone = reverse(db, entry);
  assert.deepEqual(undone.succeeded.map(({ id }) => id), [id]);
  assert.deepEqual(undone.failed.map(({ id }) => id), ["second"]);
  assert.equal(job(db, id).scheduledDate, "2030-09-15");
  assert.deepEqual(otherJobFields(job(db, id)), latest);
  assert.equal(job(db, "second").scheduledDate, "2030-09-18");
}));

test("occurrence inverses restore sparse overrides and retain all moves without changing recurrence or other visits", () => withDb((db) => {
  const originalDates = dates(db), recurrence = plan(db).recurrence;
  const a = moveVisit(db, visits(db)[0], "2030-09-16");
  const b = moveVisit(db, visits(db)[1], "2030-12-20");
  const c = moveVisit(db, visits(db)[0], "2030-09-19");
  updateMaintenancePlan(db, "undo-plan", { notes: "New plan notes", revision: plan(db).maintenanceRevision });
  for (const entry of [c, b, a]) reverse(db, entry);
  assert.deepEqual(dates(db), originalDates);
  assert.deepEqual(plan(db).recurrence, recurrence);
  assert.equal(plan(db).notes, "New plan notes");
  const exceptions = plan(db).occurrenceExceptions;
  assert.equal(exceptions.length, 2);
  assert.ok(exceptions.every((entry) => entry.overrideDate === ""));
  const moves = exceptions.find((entry) => entry.key === a.occurrenceKey).snapshot.occurrenceMoves;
  assert.deepEqual(moves.map(({ from, to }) => [from, to]), [["2030-09-15", "2030-09-16"], ["2030-09-16", "2030-09-19"], ["2030-09-19", "2030-09-16"], ["2030-09-16", "2030-09-15"]]);
}));

test("occurrence inverse refuses a stale date, replaced recurrence and newly generated work", () => {
  for (const change of ["date", "recurrence", "generation"]) withDb((db) => {
    const entry = moveVisit(db, visits(db)[0], "2030-09-16");
    const current = visits(db)[0];
    if (change === "date") moveVisit(db, current, "2030-09-18");
    if (change === "recurrence") scheduleMaintenancePlan(db, "undo-plan", { occurrenceKey: current.key, revision: current.revision, nextDueDate: "2030-09-18", scope: "schedule" });
    if (change === "generation") generateMaintenanceJob(db, "undo-plan", { occurrenceKey: current.key, revision: current.revision });
    const before = state(db);
    assert.throws(() => reverse(db, entry), (error) => error.statusCode === 409, change);
    assert.deepEqual(state(db), before);
  });
});

test("a generated occurrence moved into the past can return without changing its job or future visits", () => withDb((db) => {
  const occurrence = visits(db)[0];
  const generated = generateMaintenanceJob(db, "undo-plan", { occurrenceKey: occurrence.key, revision: occurrence.revision });
  const originalDates = dates(db), originalJob = job(db, generated.job.id);
  const entry = moveVisit(db, visits(db)[0], "2000-01-01");
  reverse(db, entry);
  assert.deepEqual(dates(db), originalDates);
  assert.deepEqual(job(db, generated.job.id), originalJob);
}));

test("completed correction inverse restores independently scheduled job and occurrence dates with completion intact", () => withDb((db) => {
  const occurrence = visits(db)[0];
  const generated = generateMaintenanceJob(db, "undo-plan", { occurrenceKey: occurrence.key, revision: occurrence.revision });
  changeJobStatus(db, generated.job.id, "Completed");
  scheduleJob(db, generated.job.id, "2030-09-14");
  const original = job(db, generated.job.id);
  const originalPlanRow = db.prepare("SELECT * FROM maintenance_plans WHERE id = 'undo-plan'").get();
  const originalDates = dates(db);
  const entry = correctCompletedMaintenanceJobSchedule(db, original.id, { completedMaintenanceCorrection: true, expectedScheduledDate: "2030-09-14", scheduledDate: "2030-09-16" }, { returnChange: true }).change;
  reverse(db, entry);
  assert.equal(job(db, original.id).scheduledDate, "2030-09-14");
  assert.deepEqual(otherJobFields(job(db, original.id)), otherJobFields(original));
  assert.deepEqual(dates(db), originalDates);
  assert.deepEqual(db.prepare("SELECT * FROM maintenance_plans WHERE id = 'undo-plan'").get(), originalPlanRow);
  const exception = plan(db).occurrenceExceptions.find((entry) => entry.key === occurrence.key);
  assert.equal(exception.snapshot.scheduleCorrections.length, 2);
  assert.equal(exception.overrideDate, "");
}));

test("database failure during completed inverse rolls back both the date and appended history", () => withDb((db) => {
  const occurrence = visits(db)[0];
  const generated = generateMaintenanceJob(db, "undo-plan", { occurrenceKey: occurrence.key, revision: occurrence.revision });
  changeJobStatus(db, generated.job.id, "Completed");
  const entry = correctCompletedMaintenanceJobSchedule(db, generated.job.id, { completedMaintenanceCorrection: true, expectedScheduledDate: "2030-09-15", scheduledDate: "2030-09-16" }, { returnChange: true }).change;
  const before = state(db);
  db.exec("CREATE TEMP TRIGGER fail_inverse BEFORE UPDATE OF scheduled_date ON jobs BEGIN SELECT RAISE(ABORT, 'Synthetic inverse failure'); END");
  assert.throws(() => reverse(db, entry), /Synthetic inverse failure/);
  assert.deepEqual(state(db), before);
  db.exec("DROP TRIGGER fail_inverse");
  reverse(db, entry);
  assert.equal(job(db, generated.job.id).scheduledDate, "2030-09-15");
}));
