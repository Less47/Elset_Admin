import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { migrateWorkspaceSchema } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { createMaintenancePlan, scheduleMaintenancePlan, generateMaintenanceJob, completeMaintenanceCycle, deleteMaintenancePlan, restoreDeletedMaintenancePlan, updateMaintenancePlan, getMaintenanceOccurrences } from "../server-workspace-maintenance.js";
import { changeJobStatus, deleteJob, restoreDeletedJob, scheduleJob } from "../server-workspace-jobs.js";
import { advanceMaintenanceDate, expandMaintenanceOccurrences } from "../src/lib/maintenance-recurrence.js";

const planInput = { id: "recurring-plan", customerId: "demo-customer-arcadia", siteId: "demo-site-front-entry", planName: "5 Connor St", siteAddress: "5 Connor Street, Brighton East", frequency: "six-monthly", nextDueDate: "2027-03-09", checklist: ["Inspect gate", "Test safety edge"], estimatedDurationHours: 2, contractPrice: 350 };
function withDb(callback) {
  const db = new Database(":memory:"); db.pragma("foreign_keys = ON"); migrateWorkspaceSchema(db);
  const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
  importWorkspaceJsonData(db, { ...fixture, maintenancePlans: [] });
  createMaintenancePlan(db, planInput);
  try { return callback(db); } finally { db.close(); }
}
const plan = (db) => loadWorkspaceStateFromDb(db).maintenancePlans.find((entry) => entry.id === planInput.id);
const range = (db, from = "2027-01-01", to = "2028-12-31") => getMaintenanceOccurrences(db, from, to).filter((entry) => entry.planId === planInput.id);
const move = (db, occurrence, nextDueDate, scope = "occurrence") => scheduleMaintenancePlan(db, planInput.id, { occurrenceKey: occurrence.key, revision: occurrence.revision, nextDueDate, scope });
const generate = (db, occurrence) => generateMaintenanceJob(db, planInput.id, { occurrenceKey: occurrence.key, revision: occurrence.revision });

test("six-monthly range expansion is automatic, bounded and does not insert jobs or occurrence rows", () => withDb((db) => {
  const before = db.prepare("SELECT count(*) n FROM jobs").get().n;
  assert.deepEqual(range(db).map((entry) => entry.date), ["2027-03-09", "2027-09-09", "2028-03-09", "2028-09-09"]);
  assert.deepEqual(range(db, "2027-09-01", "2027-09-30").map((entry) => entry.date), ["2027-09-09"]);
  assert.equal(db.prepare("SELECT count(*) n FROM jobs").get().n, before);
  assert.equal(db.prepare("SELECT count(*) n FROM maintenance_occurrence_exceptions").get().n, 0);
  assert.throws(() => range(db, "2027-01-01", "2037-01-01"), /at most two years/);
  assert.throws(() => range(db, "2027-02-30", "2027-03-10"), /valid maintenance range/);
}));

test("single occurrence uses a stable key, survives reload, and leaves future cadence unchanged", () => withDb((db) => {
  const september = range(db)[1];
  move(db, september, "2027-09-16");
  const dates = range(db);
  assert.deepEqual(dates.map((entry) => entry.date), ["2027-03-09", "2027-09-16", "2028-03-09", "2028-09-09"]);
  assert.equal(dates[1].key, september.key);
  assert.equal(plan(db).recurrence.segments[0].anchorDate, "2027-03-09");
  assert.equal(db.prepare("SELECT count(*) n FROM maintenance_occurrence_exceptions").get().n, 1);
  // Moving into a completely different range must still be loaded there.
  move(db, dates[1], "2027-10-03");
  assert.equal(range(db, "2027-09-01", "2027-09-30").length, 0);
  assert.equal(range(db, "2027-10-01", "2027-10-31")[0].key, september.key);
  assert.equal(db.prepare("SELECT count(*) n FROM maintenance_occurrence_exceptions").get().n, 1);
}));

test("schedule cutovers preserve earlier visits and the selected key across repeated edits", () => withDb((db) => {
  const september = range(db)[1];
  move(db, september, "2027-09-16", "schedule");
  assert.deepEqual(range(db).map((entry) => entry.date), ["2027-03-09", "2027-09-16", "2028-03-16", "2028-09-16"]);
  assert.equal(range(db)[1].key, september.key);
  move(db, range(db)[1], "2027-09-20", "schedule");
  assert.deepEqual(range(db).map((entry) => entry.date), ["2027-03-09", "2027-09-20", "2028-03-20", "2028-09-20"]);
  move(db, range(db)[1], "2027-09-22");
  assert.deepEqual(range(db).map((entry) => entry.date), ["2027-03-09", "2027-09-22", "2028-03-20", "2028-09-20"]);
}));

test("next due follows effective dates and skips only generated/completed visits, even out of order", () => withDb((db) => {
  move(db, range(db)[0], "2027-03-16");
  assert.equal(plan(db).nextDueDate, "2027-03-16");
  generate(db, range(db)[1]);
  assert.equal(plan(db).nextDueDate, "2027-03-16");
  generate(db, range(db)[0]);
  assert.equal(plan(db).nextDueDate, "2028-03-09");
  completeMaintenanceCycle(db, planInput.id, { occurrenceKey: range(db)[2].key, revision: range(db)[2].revision, completedAt: "2028-03-10T01:00:00Z", advanceRecurrence: true });
  assert.equal(plan(db).nextDueDate, "2028-09-09");
}));

test("generation is idempotent by occurrence, retains checklist and recurrence, and jobs move independently", () => withDb((db) => {
  const occurrence = range(db)[0];
  const result = generate(db, occurrence);
  const duplicate = generate(db, occurrence);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.id, result.job.id);
  assert.match(result.job.description, /Inspect gate/);
  assert.match(result.job.description, /Test safety edge/);
  assert.equal(result.job.maintenanceOccurrenceKey, occurrence.key);
  assert.equal(result.job.scheduledDate, "2027-03-09");
  scheduleJob(db, result.job.id, "2027-03-21");
  assert.equal(range(db)[0].date, "2027-03-09");
  assert.equal(range(db)[0].jobScheduledDate, "2027-03-21");
  assert.equal(plan(db).nextDueDate, "2027-09-09");
  changeJobStatus(db, result.job.id, "Completed");
  assert.ok(range(db)[0].completedAt);
  assert.throws(() => move(db, range(db)[0], "2027-03-22"), /Historical or completed/);
  assert.equal(generate(db, occurrence).job.id, result.job.id);
}));

test("future schedule changes retain already generated future work and completed history", () => withDb((db) => {
  const generated = generate(db, range(db)[2]);
  changeJobStatus(db, generated.job.id, "Completed");
  const jobBefore = loadWorkspaceStateFromDb(db).jobs.find((entry) => entry.id === generated.job.id);
  move(db, range(db)[1], "2027-09-16", "schedule");
  assert.deepEqual(loadWorkspaceStateFromDb(db).jobs.find((entry) => entry.id === generated.job.id), jobBefore);
  assert.equal(range(db).find((entry) => entry.jobId === generated.job.id).date, "2028-03-09");
  assert.equal(range(db).some((entry) => entry.date === "2028-03-16"), false, "the generated cycle must not get a second visit");
  assert.ok(range(db).some((entry) => entry.date === "2028-09-16"));
}));

test("stale updates, missing choice and same-date drops leave the database untouched", () => withDb((db) => {
  const initial = range(db)[0];
  assert.throws(() => move(db, initial, "2027-03-16", ""), /Choose This occurrence/);
  const before = plan(db);
  move(db, initial, initial.date);
  assert.deepEqual(plan(db), before);
  move(db, initial, "2027-03-16");
  assert.throws(() => move(db, initial, "2027-03-20"), /has changed/);
  assert.throws(() => generate(db, initial), /has changed/);
  assert.equal(range(db)[0].date, "2027-03-16");
  assert.equal(db.prepare("SELECT count(*) n FROM maintenance_occurrence_exceptions").get().n, 1);
}));

test("inactive and deleted plans stop future expansion; archive restore keeps exceptions and linked jobs", () => withDb((db) => {
  move(db, range(db)[0], "2027-03-16");
  const generated = generate(db, range(db)[0]);
  updateMaintenancePlan(db, planInput.id, { active: false });
  assert.equal(range(db).length, 0);
  assert.throws(() => generateMaintenanceJob(db, planInput.id), /Activate/);
  updateMaintenancePlan(db, planInput.id, { active: true });
  deleteMaintenancePlan(db, planInput.id);
  assert.equal(range(db).length, 0);
  restoreDeletedMaintenancePlan(db, planInput.id);
  assert.equal(range(db)[0].date, "2027-03-16");
  assert.equal(range(db)[0].jobId, generated.job.id);
}));

test("SQLite export/import retains schedule segments, exceptions and generation identity", () => withDb((db) => {
  move(db, range(db)[1], "2027-09-16", "schedule");
  move(db, range(db)[0], "2027-03-20");
  generate(db, range(db)[0]);
  const copy = new Database(":memory:"); copy.pragma("foreign_keys = ON");
  try {
    importWorkspaceJsonData(copy, loadWorkspaceStateFromDb(db));
    assert.deepEqual(range(copy).map(({ key, date, jobId }) => ({ key, date, jobId })), range(db).map(({ key, date, jobId }) => ({ key, date, jobId })));
    assert.equal(plan(copy).nextDueDate, "2027-09-16");
    deleteMaintenancePlan(db, planInput.id);
    restoreDeletedMaintenancePlan(db, planInput.id);
    assert.deepEqual(range(db).map(({ key, date, jobId }) => ({ key, date, jobId })), range(copy).map(({ key, date, jobId }) => ({ key, date, jobId })));
    assert.equal(db.prepare("SELECT next_due_date FROM maintenance_plans WHERE id = ?").get(planInput.id).next_due_date, "2027-09-16");
  } finally { copy.close(); }
}));

test("month-end, February, leap year, and distant range expansion preserve sequential rollover", () => {
  assert.equal(advanceMaintenanceDate("2027-01-31", "monthly"), "2027-03-03");
  assert.equal(advanceMaintenanceDate("2028-01-31", "monthly"), "2028-03-02");
  assert.equal(advanceMaintenanceDate("2028-02-29", "annual"), "2029-03-01");
  assert.equal(advanceMaintenanceDate("9999-12-31", "annual"), "");
  assert.deepEqual(expandMaintenanceOccurrences({ ...planInput, frequency: "annual", nextDueDate: "9999-12-31" }, "9999-12-01", "9999-12-31").map((entry) => entry.date), ["9999-12-31"]);
  for (const frequency of ["monthly", "quarterly", "six-monthly", "annual"]) {
    for (const anchor of ["2027-01-31", "2028-02-29", "2027-08-31", "2027-12-31"]) {
      let date = anchor; const expected = [];
      while (date < "2101-01-01") { if (date >= "2100-01-01") expected.push(date); date = advanceMaintenanceDate(date, frequency); }
      const actual = expandMaintenanceOccurrences({ ...planInput, frequency, nextDueDate: anchor }, "2100-01-01", "2100-12-31").map((entry) => entry.date);
      assert.deepEqual(actual, expected);
    }
  }
});

test("date-only recurrence is identical in Sydney, Los Angeles and UTC", () => {
  const moduleUrl = new URL("../src/lib/maintenance-recurrence.js", import.meta.url).href;
  for (const TZ of ["Australia/Sydney", "America/Los_Angeles", "UTC"]) {
    const script = `import { expandMaintenanceOccurrences } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(expandMaintenanceOccurrences(${JSON.stringify(planInput)}, '2027-01-01', '2028-12-31').map(e => e.date)));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["2027-03-09", "2027-09-09", "2028-03-09", "2028-09-09"]);
  }
});

test("archiving and restoring a generated job preserves its reserved cycle and stable link", () => withDb((db) => {
  const occurrence = range(db)[0];
  const generated = generate(db, occurrence);
  deleteJob(db, generated.job.id);
  assert.equal(plan(db).nextDueDate, "2027-09-09");
  assert.equal(range(db)[0].generated, true);
  assert.equal(range(db)[0].jobId, "");
  assert.throws(() => generate(db, range(db)[0]), /archived/);
  restoreDeletedJob(db, generated.job.id);
  assert.equal(range(db)[0].jobId, generated.job.id);
  changeJobStatus(db, generated.job.id, "Completed");
  assert.ok(range(db)[0].completedAt);
}));

test("a protected future generated occurrence can be deliberately moved without moving its job", () => withDb((db) => {
  const generated = generate(db, range(db)[2]);
  move(db, range(db)[1], "2027-09-16", "schedule");
  const protectedVisit = range(db).find((entry) => entry.jobId === generated.job.id);
  move(db, protectedVisit, "2028-03-20", "schedule");
  assert.equal(range(db).find((entry) => entry.jobId === generated.job.id).date, "2028-03-20");
  assert.ok(range(db).some((entry) => entry.date === "2028-09-20"));
  assert.equal(loadWorkspaceStateFromDb(db).jobs.find((entry) => entry.id === generated.job.id).scheduledDate, "2028-03-09");
}));

test("a failed date transaction rolls back the exception, anchor, revision and next due", () => withDb((db) => {
  const before = plan(db);
  db.exec("CREATE TRIGGER fail_maintenance_update BEFORE UPDATE ON maintenance_plans BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END");
  assert.throws(() => move(db, range(db)[0], "2027-03-16"), /Synthetic write failure/);
  assert.deepEqual(plan(db), before);
  assert.equal(db.prepare("SELECT count(*) n FROM maintenance_occurrence_exceptions").get().n, 0);
}));

test("migration from v4 is additive and idempotent with existing plans and jobs", () => withDb((db) => {
  const plansBefore = db.prepare("SELECT * FROM maintenance_plans").all();
  const jobsBefore = db.prepare("SELECT * FROM jobs").all();
  db.exec("DROP TABLE maintenance_occurrence_exceptions; DELETE FROM workspace_schema_migrations WHERE version = 5; UPDATE workspace_info SET schema_version = 4; PRAGMA user_version = 4;");
  migrateWorkspaceSchema(db); migrateWorkspaceSchema(db);
  assert.deepEqual(db.prepare("SELECT * FROM maintenance_plans").all(), plansBefore);
  assert.deepEqual(db.prepare("SELECT * FROM jobs").all(), jobsBefore);
  assert.equal(db.prepare("SELECT count(*) n FROM workspace_schema_migrations WHERE version = 5").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM maintenance_occurrence_exceptions").get().n, 0);
}));
