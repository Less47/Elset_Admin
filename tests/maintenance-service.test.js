import { removeMediaSchemaForLegacyFixture } from "./helpers/workspace-media-schema.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { openWorkspaceDb, migrateWorkspaceSchema, assertWorkspaceSchema, WORKSPACE_SCHEMA_VERSION } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb, getMaintenancePlanById } from "../server-workspace-state.js";
import { updateWorkspaceAddons, getWorkspaceAddons } from "../server-workspace-addons.js";
import { createMaintenancePlan, updateMaintenancePlan, generateMaintenanceJob, deleteMaintenancePlan } from "../server-workspace-maintenance.js";
import { createJob, changeJobStatus, deleteJob, emptyDeletedJobs, addJobPhoto, deleteJobPhoto } from "../server-workspace-jobs.js";
import { createWorkspaceSqliteBackupBundle, materializeWorkspaceSqliteBackup } from "../server-workspace-backup.js";
import { initializeMaintenanceService, getMaintenanceServiceReport, getMaintenanceServiceHistory, updateMaintenanceServiceResult,
  updateMaintenanceServiceDefect, updateMaintenanceServiceNotes, completeMaintenanceService, completeUnansweredMaintenanceChecks, persistMaintenanceServiceSend } from "../server-workspace-maintenance-service.js";
import { createMaintenanceServiceRouter } from "../server-maintenance-service-routes.js";
import { maintenanceChecklistItems, starterMaintenanceChecklist, DEFAULT_MAINTENANCE_CHECKLIST } from "../src/lib/maintenance-checklist.js";
import { maintenanceServiceEmailDraft } from "../src/lib/maintenance-service-email.js";
import { generateMaintenanceServicePdf } from "../server-maintenance-service-pdf.js";
import { readPdfTextRuns } from "./helpers/pdf-text.js";
import { validateWorkspaceLogo, saveWorkspaceLogo } from "../server-workspace-logo.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
const actor = { id: "service-tech", role: "technician", staffId: "demo-staff-admin", name: "Service Technician" };
const planInput = { id: "service-plan", customerId: "demo-customer-arcadia", siteId: "demo-site-front-entry", siteAddress: "10 Example Lane, Sampleton VIC 3000",
  frequency: "six-monthly", nextDueDate: "2026-10-05", defaultTechnicianId: "demo-staff-admin", checklist: ["Legacy custom inspection"] };
const tables = ["maintenance_service_send_history", "maintenance_service_defects", "maintenance_service_checklist_results", "maintenance_service_reports"];
const signature = async () => `data:image/png;base64,${(await sharp(Buffer.from('<svg width="720" height="240"><path d="M20 130 Q100 30 140 120 T300 95 L470 145" fill="none" stroke="black" stroke-width="5"/></svg>')).png().toBuffer()).toString("base64")}`;
const defectPhoto = async () => `data:image/png;base64,${(await sharp(Buffer.from('<svg width="480" height="220"><rect width="480" height="220" fill="#e8eef0"/><rect x="100" y="20" width="38" height="180" fill="#45565b"/><rect x="128" y="75" width="100" height="48" rx="5" fill="#35474d"/><circle cx="212" cy="99" r="9" fill="#a1c4d2"/><path d="M174 75 L186 92 L177 107 L191 123" fill="none" stroke="#c82e36" stroke-width="5"/><path d="M227 99 H420" stroke="#c82e36" stroke-width="2" stroke-dasharray="8 8"/></svg>')).png().toBuffer()).toString("base64")}`;
const pdfImageCount = async bytes => (await PDFDocument.load(bytes)).context.enumerateIndirectObjects().filter(([, object]) =>
  object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")).length;
function workspace(t, { enabled = true, dbPath = ":memory:", checklist = planInput.checklist } = {}) {
  const db = openWorkspaceDb({ dbPath }); t.after(() => db.close());
  importWorkspaceJsonData(db, { ...fixture, maintenancePlans: [], jobs: [] });
  if (enabled) updateWorkspaceAddons(db, { maintenanceChecklists: true });
  const legacy = createMaintenancePlan(db, { ...planInput, ...(enabled ? { checklist: undefined, checklistItems: [...starterMaintenanceChecklist(planInput.id), ...checklist.map((text, i) => ({ id: "legacy-custom-" + i, text }))] } : { checklist }) });
  const job = generateMaintenanceJob(db, legacy.id, { occurrenceKey: legacy.nextOccurrence.key, revision: legacy.maintenanceRevision, jobId: "service-job" }).job;
  return { db, job, plan: () => getMaintenancePlanById(db, legacy.id), report: () => getMaintenanceServiceReport(db, job.id) };
}
function answerAll(db, jobId, outcome = "completed") {
  let report = getMaintenanceServiceReport(db, jobId);
  for (const item of report.items) report = updateMaintenanceServiceResult(db, jobId, item.id, { revision: report.revision, result: outcome }, actor);
  return report;
}
async function finish(db, jobId, extra = {}) {
  const report = answerAll(db, jobId);
  return completeMaintenanceService(db, jobId, { revision: report.revision, ...extra }, actor);
}

// Fixture for reports completed by the released customer-signature workflow.
async function legacyFinish(db, jobId, status = "signed") {
  const report = getMaintenanceServiceReport(db, jobId), timestamp = "2026-10-05T01:00:00.000Z";
  db.prepare(`UPDATE maintenance_service_reports SET status='completed',signature_status=?,
    customer_representative_name=?,customer_signature_data=?,signed_at=?,completed_at=?,technician_name=? WHERE id=?`)
    .run(status, status === "signed" ? "Legacy Site Representative" : "", status === "signed" ? await signature() : "",
      status === "signed" ? timestamp : "", timestamp, "Legacy Technician", report.id);
  changeJobStatus(db, jobId, "Completed");
  return getMaintenanceServiceReport(db, jobId);
}

test("maintenance add-on defaults off, preserves legacy text and creates no reports while disabled", t => {
  const f = workspace(t, { enabled: false });
  assert.equal(getWorkspaceAddons(f.db).maintenanceChecklists, false);
  assert.deepEqual(f.plan().checklist, ["Legacy custom inspection"]);
  assert.equal(f.report(), null);
  assert.throws(() => initializeMaintenanceService(f.db, f.job.id), error => error.code === "ADDON_DISABLED");
  assert.throws(() => updateMaintenancePlan(f.db, f.plan().id, { checklistItems: [] }), error => error.code === "ADDON_DISABLED");
  const updated = updateMaintenancePlan(f.db, f.plan().id, { checklist: "Retained newline\nSecond check" });
  assert.deepEqual(updated.checklist, ["Retained newline", "Second check"]);
});
test("starter items are defaults only; normalization preserves actual legacy text and identity", () => {
  const items = starterMaintenanceChecklist("plan");
  assert.equal(items.length, 10);
  assert.deepEqual(items.map(item => item.text), DEFAULT_MAINTENANCE_CHECKLIST.map(item => item.text));
  assert.deepEqual(maintenanceChecklistItems(items, "plan"), items);
  const legacy = [DEFAULT_MAINTENANCE_CHECKLIST[0].text, "Inspect custom gate"];
  assert.deepEqual(maintenanceChecklistItems(legacy, "plan").map(item => item.text), legacy);
  assert.deepEqual(maintenanceChecklistItems([], "plan"), []);
});
test("new enabled plans default to ten editable items; explicit empty templates stay empty", t => {
  const f = workspace(t);
  const { checklist: _checklist, id: _id, ...input } = planInput;
  const created = createMaintenancePlan(f.db, input);
  assert.deepEqual(created.checklist, DEFAULT_MAINTENANCE_CHECKLIST.map(item => item.text));
  const empty = createMaintenancePlan(f.db, { ...input, checklistItems: [] });
  assert.equal(empty.checklistItems.length, 0);
  assert.equal(f.db.prepare("PRAGMA user_version").get().user_version, 18);
});
test("enabling an existing 300-item legacy plan adds no defaults or changes during ordinary edits", t => {
  const checklist = Array.from({ length: 300 }, (_, index) => `Legacy check ${index + 1}`);
  const f = workspace(t, { enabled: false, checklist });
  updateWorkspaceAddons(f.db, { maintenanceChecklists: true });
  const original = initializeMaintenanceService(f.db, f.job.id);
  const edited = updateMaintenancePlan(f.db, f.plan().id, { notes: "Plan notes updated" });
  assert.equal(edited.checklistItems.length, 300);
  assert.deepEqual(edited.checklist, checklist);
  assert.deepEqual(f.report().items, original.items);
});
test("old standard metadata is editable: rename every item, reorder, insert anywhere, remove all and rebuild", t => {
  const f = workspace(t), original = f.report();
  const prior = starterMaintenanceChecklist(f.plan().id).map(item => ({ ...item, standard: true }));
  const saved = updateMaintenancePlan(f.db, f.plan().id, { checklistItems: prior });
  const renamed = saved.checklistItems.map((item, i) => ({ ...item, text: `Renamed check ${i + 1}` })).reverse();
  const edited = updateMaintenancePlan(f.db, saved.id, { checklistItems: [{ id: "inserted-first", text: "First custom check" }, ...renamed], revision: saved.maintenanceRevision });
  assert.deepEqual(edited.checklistItems.slice(1).map(item => item.id), prior.map(item => item.id).reverse());
  assert.deepEqual(edited.checklistItems.map(item => item.position), Array.from({ length: 11 }, (_, i) => i + 1));
  assert.equal(edited.checklist[1], "Renamed check 10");
  assert.throws(() => updateMaintenancePlan(f.db, saved.id, { checklistItems: prior, revision: saved.maintenanceRevision }), /has changed/);
  assert.throws(() => updateMaintenancePlan(f.db, saved.id, { checklistItems: "Malformed" }), /must be an array/);
  assert.throws(() => updateMaintenancePlan(f.db, saved.id, { checklistItems: null }), /must be an array/);
  assert.throws(() => updateMaintenancePlan(f.db, saved.id, { checklistItems: [prior[0], prior[0]] }), /unique identities/);
  assert.throws(() => updateMaintenancePlan(f.db, saved.id, { checklistItems: [{ id: "long", text: "x".repeat(2001) }] }), /2000/);
  const removed = updateMaintenancePlan(f.db, saved.id, { checklistItems: [] });
  assert.deepEqual(removed.checklistItems, []);
  updateMaintenancePlan(f.db, saved.id, { notes: "Ordinary edit keeps an empty checklist" });
  assert.deepEqual(f.plan().checklist, []);
  const rebuilt = updateMaintenancePlan(f.db, saved.id, { checklistItems: [{ id: "rebuilt-check", text: "Entirely new checklist" }] });
  assert.deepEqual(rebuilt.checklist, ["Entirely new checklist"]);
  assert.deepEqual(f.report(), original);
});
test("disabling blocks structured checklist writes, preserves template IDs and allows ordinary plan edits", t => {
  const f = workspace(t), original = f.report(), template = f.plan();
  updateWorkspaceAddons(f.db, { maintenanceChecklists: false });
  assert.throws(() => updateMaintenancePlan(f.db, template.id, { checklistItems: [] }), error => error.code === "ADDON_DISABLED");
  const saved = updateMaintenancePlan(f.db, template.id, { notes: "Notes while disabled" });
  assert.deepEqual(saved.checklistItems, template.checklistItems);
  assert.deepEqual(f.report(), original);
});
test("completion rejects an empty visit without changing the released schema or report snapshot", async t => {
  const f = workspace(t);
  const plan = updateMaintenancePlan(f.db, f.plan().id, { checklistItems: [] });
  const job = generateMaintenanceJob(f.db, plan.id, { occurrenceKey: plan.nextOccurrence.key, revision: plan.maintenanceRevision }).job;
  const report = getMaintenanceServiceReport(f.db, job.id);
  assert.deepEqual(report.items, []);
  await assert.rejects(completeMaintenanceService(f.db, job.id, { revision: report.revision, signatureStatus: "unavailable" }, actor), /no checklist items/);
  assert.deepEqual(getMaintenanceServiceReport(f.db, job.id), report);
});
test("generated reports snapshot current items; plan edits affect only future jobs", t => {
  const f = workspace(t);
  const original = f.report(); assert.equal(original.items.length, 11);
  updateMaintenancePlan(f.db, f.plan().id, { checklistItems: [{ id: "future-check", text: "Future inspection" }] });
  assert.deepEqual(f.report().items, original.items);
  const plan = f.plan();
  const next = generateMaintenanceJob(f.db, plan.id, { occurrenceKey: plan.nextOccurrence.key, revision: plan.maintenanceRevision, jobId: "future-job" }).job;
  assert.equal(getMaintenanceServiceReport(f.db, next.id).items.at(-1).text, "Future inspection");
  assert.equal(f.report().items.at(-1).text, "Legacy custom inspection");
});
test("pre-feature job initializes once lazily without changing its later snapshot", t => {
  const f = workspace(t, { enabled: false }); assert.equal(f.report(), null);
  updateWorkspaceAddons(f.db, { maintenanceChecklists: true });
  const report = initializeMaintenanceService(f.db, f.job.id);
  updateMaintenancePlan(f.db, f.plan().id, { checklistItems: [] });
  assert.deepEqual(initializeMaintenanceService(f.db, f.job.id), report);
  assert.equal(f.db.prepare("SELECT count(*) n FROM maintenance_service_reports").get().n, 1);
});
test("completion identifies every unanswered check, validates outcome values and rejects stale writes", async t => {
  const f = workspace(t), initial = f.report();
  await assert.rejects(completeMaintenanceService(f.db, f.job.id, { revision: initial.revision, signatureStatus: "unavailable" }, actor), error => error.unansweredItems.length === 11);
  assert.throws(() => updateMaintenanceServiceResult(f.db, f.job.id, initial.items[0].id, { revision: initial.revision, result: "yes" }, actor), /Completed/);
  const updated = updateMaintenanceServiceResult(f.db, f.job.id, initial.items[0].id, { revision: initial.revision, result: "completed", notes: "Inspected" }, actor);
  assert.equal(updated.items[0].notes, "Inspected");
  assert.throws(() => updateMaintenanceServiceResult(f.db, f.job.id, initial.items[1].id, { revision: initial.revision, result: "na" }, actor), error => error.code === "STALE_REPORT");
  assert.equal(f.report().counts.unanswered, 10);
});
test("unchecking Completed clears the answer and notes survive; clearing defect and N/A updates progress atomically", t => {
  const f = workspace(t);
  let report = f.report(); const item = report.items[0];
  report = updateMaintenanceServiceResult(f.db, f.job.id, item.id, { revision: report.revision, result: "completed", notes: "Inspected" }, actor);
  report = updateMaintenanceServiceResult(f.db, f.job.id, item.id, { revision: report.revision, result: null }, actor);
  assert.equal(report.items[0].result, null); assert.equal(report.items[0].notes, "Inspected");
  assert.equal(report.counts.completed, 0); assert.equal(report.counts.unanswered, 11);
  report = updateMaintenanceServiceDefect(f.db, f.job.id, item.id, { revision: report.revision, severity: "advisory", description: "Wear observed" }, actor);
  assert.equal(report.counts.defects, 1);
  report = updateMaintenanceServiceResult(f.db, f.job.id, item.id, { revision: report.revision, result: null }, actor);
  assert.deepEqual(report.defects, []); assert.equal(report.counts.defects, 0); assert.equal(report.counts.unanswered, 11);
  report = updateMaintenanceServiceResult(f.db, f.job.id, item.id, { revision: report.revision, result: "na" }, actor);
  assert.equal(report.counts.na, 1); assert.equal(report.counts.unanswered, 10);
  report = updateMaintenanceServiceResult(f.db, f.job.id, item.id, { revision: report.revision, result: null }, actor);
  assert.equal(report.counts.na, 0); assert.equal(report.counts.unanswered, 11);
  assert.throws(() => updateMaintenanceServiceResult(f.db, f.job.id, item.id, { revision: report.revision }, actor), /Select Completed/);
});
test("a 12-item visit remains frozen after the template grows to 14; completed history remains unchanged", async t => {
  const f = workspace(t);
  const completed = await finish(f.db, f.job.id);
  let plan = updateMaintenancePlan(f.db, f.plan().id, { checklistItems: [...f.plan().checklistItems, { id: "twelfth", text: "Twelfth check" }] });
  const first = generateMaintenanceJob(f.db, plan.id, { occurrenceKey: plan.nextOccurrence.key, revision: plan.maintenanceRevision }).job;
  const original = getMaintenanceServiceReport(f.db, first.id); assert.equal(original.items.length, 12);
  plan = updateMaintenancePlan(f.db, plan.id, { checklistItems: [...plan.checklistItems, { id: "thirteenth", text: "Thirteenth check" }, { id: "fourteenth", text: "Fourteenth check" }] });
  const second = generateMaintenanceJob(f.db, plan.id, { occurrenceKey: plan.nextOccurrence.key, revision: plan.maintenanceRevision }).job;
  assert.equal(getMaintenanceServiceReport(f.db, second.id).items.length, 14);
  assert.deepEqual(getMaintenanceServiceReport(f.db, first.id), original);
  assert.deepEqual(f.report(), completed);
  assert.equal(getMaintenanceServiceHistory(f.db, plan.id).length, 1);
});
test("Check All completes only unanswered items in one revision, preserving outcomes, notes, defects and snapshot", async t => {
  const f = workspace(t); let report = f.report();
  addJobPhoto(f.db, f.job.id, { id: "bulk-defect-photo", name: "Recorded wear.png", url: await defectPhoto() });
  report = updateMaintenanceServiceResult(f.db, f.job.id, report.items[0].id, { revision: report.revision, result: "completed", notes: "Already inspected" }, actor);
  report = updateMaintenanceServiceDefect(f.db, f.job.id, report.items[1].id, { revision: report.revision, severity: "advisory", description: "Keep this defect", recommendedAction: "Inspect next visit", photoRefs: ["bulk-defect-photo"] }, actor);
  report = updateMaintenanceServiceResult(f.db, f.job.id, report.items[2].id, { revision: report.revision, result: "na", notes: "Does not apply" }, actor);
  report = updateMaintenanceServiceResult(f.db, f.job.id, report.items[3].id, { revision: report.revision, result: null, notes: "Keep draft notes" }, actor);
  const beforePlan = f.plan(), before = report;
  const saved = completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: report.revision });
  assert.equal(saved.revision, before.revision + 1);
  assert.deepEqual(saved.counts, { total: 11, completed: 9, defects: 1, na: 1, unanswered: 0 });
  assert.deepEqual(saved.items.slice(0, 3), before.items.slice(0, 3)); assert.deepEqual(saved.defects, before.defects);
  assert.equal(saved.items[3].notes, "Keep draft notes"); assert.deepEqual(saved.snapshot, before.snapshot);
  assert.equal(saved.status, "draft"); assert.equal(saved.completedAt, ""); assert.deepEqual(f.plan(), beforePlan);
  const workspaceTimestamp = f.db.prepare("SELECT updated_at FROM workspace_info WHERE id=1").get().updated_at;
  assert.deepEqual(completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: saved.revision }), saved);
  assert.equal(f.db.prepare("SELECT updated_at FROM workspace_info WHERE id=1").get().updated_at, workspaceTimestamp);
});
for (const outcome of ["completed", "defect", "na"]) test(`stale Check All cannot overwrite a newer ${outcome} outcome`, t => {
  const f = workspace(t), before = f.report();
  const newer = updateMaintenanceServiceResult(f.db, f.job.id, before.items[0].id, { revision: before.revision, result: outcome,
    ...(outcome === "defect" ? { defect: { severity: "urgent", description: "Concurrent defect" } } : {}) }, actor);
  assert.throws(() => completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: before.revision }), error => error.code === "STALE_REPORT");
  assert.deepEqual(f.report(), newer);
  const saved = completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: newer.revision });
  assert.equal(saved.items[0].result, outcome); assert.deepEqual(saved.defects, newer.defects);
  assert.throws(() => completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: newer.revision }), error => error.code === "STALE_REPORT");
  assert.deepEqual(f.report(), saved);
});
test("Check All rolls back all results if advancing the report revision fails", t => {
  const f = workspace(t), before = f.report();
  f.db.exec("CREATE TRIGGER fail_bulk_revision BEFORE UPDATE OF revision ON maintenance_service_reports BEGIN SELECT RAISE(ABORT,'fixture revision failure'); END");
  assert.throws(() => completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: before.revision }), /fixture revision failure/);
  assert.deepEqual(f.report(), before);
  f.db.exec("DROP TRIGGER fail_bulk_revision");
  assert.equal(completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: before.revision }).counts.unanswered, 0);
});
test("Check All rejects disabled add-ons, missing revisions and locked historical reports", async t => {
  const f = workspace(t), before = f.report();
  assert.throws(() => completeUnansweredMaintenanceChecks(f.db, f.job.id, {}), error => error.code === "STALE_REPORT");
  updateWorkspaceAddons(f.db, { maintenanceChecklists: false });
  assert.throws(() => completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: before.revision }), error => error.code === "ADDON_DISABLED");
  assert.deepEqual(f.report(), before);
  updateWorkspaceAddons(f.db, { maintenanceChecklists: true });
  const answered = completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: before.revision });
  const completed = await completeMaintenanceService(f.db, f.job.id, { revision: answered.revision }, actor);
  assert.throws(() => completeUnansweredMaintenanceChecks(f.db, f.job.id, { revision: completed.revision }), error => error.code === "REPORT_COMPLETED");
  assert.deepEqual(f.report(), completed);
});
test("defects require valid severity and description; photos belong to the job; atomic result/defect updates", async t => {
  const f = workspace(t); let report = answerAll(f.db, f.job.id);
  const item = report.items[0];
  report = updateMaintenanceServiceResult(f.db, f.job.id, item.id, { revision: report.revision, result: "defect" }, actor);
  await assert.rejects(completeMaintenanceService(f.db, f.job.id, { revision: report.revision, signatureStatus: "declined" }, actor), error => error.invalidDefectItems[0].id === item.id);
  for (const invalid of [{ severity: "wrong", description: "Fault" }, { severity: "urgent", description: " " }]) {
    assert.throws(() => updateMaintenanceServiceDefect(f.db, f.job.id, item.id, { ...invalid, revision: report.revision }, actor));
    assert.equal(f.report().revision, report.revision);
  }
  addJobPhoto(f.db, f.job.id, { id: "defect-photo", name: "Safety beam.jpg", url: await signature() });
  const other = createJob(f.db, { customer: { id: "demo-customer-arcadia" }, job: { id: "other-job", title: "Other job", jobAddress: planInput.siteAddress } });
  addJobPhoto(f.db, other.id, { id: "other-job-photo", name: "Other job photo", url: await signature() });
  assert.throws(() => updateMaintenanceServiceDefect(f.db, f.job.id, item.id, { revision: report.revision, severity: "urgent", description: "Fault", photoRefs: ["other-job-photo"] }, actor), /does not belong/);
  report = updateMaintenanceServiceDefect(f.db, f.job.id, item.id, { revision: report.revision, severity: "action_required", description: "Beam damaged", recommendedAction: "Replace beam", photoRefs: ["defect-photo"] }, actor);
  assert.equal(report.defects.length, 1); assert.equal(report.photos.length, 1);
  report = updateMaintenanceServiceDefect(f.db, f.job.id, item.id, { revision: report.revision, severity: "urgent", description: "Updated fault", photoRefs: ["defect-photo"] }, actor);
  assert.equal(report.defects.length, 1);
  deleteJobPhoto(f.db, f.job.id, "defect-photo");
  assert.equal(f.report().photos.length, 0); assert.deepEqual(f.report().defects[0].photoRefs, ["defect-photo"]);
  report = updateMaintenanceServiceDefect(f.db, f.job.id, item.id, { revision: report.revision, severity: "urgent", description: "Updated fault", photoRefs: ["defect-photo"] }, actor);
  const completed = await completeMaintenanceService(f.db, f.job.id, { revision: report.revision, signatureStatus: "unavailable" }, actor);
  assert.equal(completed.counts.defects, 1);
  assert.throws(() => f.db.prepare("UPDATE maintenance_service_defects SET description='tamper' WHERE id=?").run(completed.defects[0].id), /read-only/);
  assert.throws(() => f.db.prepare("DELETE FROM maintenance_service_defects WHERE id=?").run(completed.defects[0].id), /read-only/);
  const { bytes } = await generateMaintenanceServicePdf(completed);
  assert.match((await readPdfTextRuns(bytes)).flat().map(run => run.text).join("\n"), /image unavailable/);
});
for (const status of [undefined, "unavailable", "declined", "signed"]) test(`technician completion without acknowledgement ignores legacy input ${status}, preserves counts and immutable history`, async t => {
  const f = workspace(t); let report = answerAll(f.db, f.job.id);
  report = updateMaintenanceServiceResult(f.db, f.job.id, report.items[0].id, { revision: report.revision, result: "na" }, actor);
  report = updateMaintenanceServiceNotes(f.db, f.job.id, { revision: report.revision, serviceNotes: "Tested at departure", serviceDate: "2026-10-06" });
  const input = { revision: report.revision, ...(status ? { signatureStatus: status, representativeName: "Ignored representative", signatureData: "Ignored invalid signature" } : {}) };
  const completed = await completeMaintenanceService(f.db, f.job.id, input, actor);
  assert.equal(completed.status, "completed"); assert.equal(completed.serviceNotes, "Tested at departure"); assert.equal(completed.counts.na, 1);
  assert.equal(completed.counts.completed, 10); assert.ok(completed.technicianName); assert.ok(completed.completedAt);
  assert.equal(completed.signedAt, ""); assert.equal(completed.signatureData, ""); assert.equal(completed.representativeName, "");
  assert.throws(() => updateMaintenanceServiceNotes(f.db, f.job.id, { revision: completed.revision, serviceNotes: "Tamper" }), /read-only/);
  assert.throws(() => f.db.prepare("UPDATE maintenance_service_checklist_results SET notes='tamper' WHERE id=?").run(report.items[0].id), /read-only/);
  assert.throws(() => f.db.prepare("DELETE FROM maintenance_service_reports WHERE id=?").run(report.id), /preserved/);
  assert.equal(getMaintenanceServiceHistory(f.db, f.plan().id).length, 1);
  assert.equal(getMaintenanceServiceHistory(f.db, f.plan().id)[0].signatureStatus, "unavailable"); // schema 16 storage compatibility only
  assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id=?").get(f.job.id).status, "Completed");
  assert.ok(f.plan().lastCompletedAt);
  assert.ok(f.db.prepare("SELECT completed_at FROM maintenance_occurrence_exceptions WHERE job_id=?").get(f.job.id).completed_at);
  updateWorkspaceAddons(f.db, { maintenanceChecklists: false });
  assert.deepEqual(f.report(), completed); assert.ok((await generateMaintenanceServicePdf(f.report())).bytes.length);
});
test("service/job completion rolls back together on a stale job status or a late job-write failure", async t => {
  const f = workspace(t); let report = answerAll(f.db, f.job.id);
  changeJobStatus(f.db, f.job.id, "In Progress");
  await assert.rejects(completeMaintenanceService(f.db, f.job.id, { revision: report.revision, signatureStatus: "declined", expectedJobStatus: "To Do" }, actor), /status changed/);
  assert.deepEqual(f.report(), report); assert.equal(f.plan().lastCompletedAt, "");
  f.db.exec("CREATE TRIGGER fail_service_job BEFORE UPDATE OF status ON jobs BEGIN SELECT RAISE(ABORT,'fixture job failure'); END");
  await assert.rejects(completeMaintenanceService(f.db, f.job.id, { revision: report.revision, signatureStatus: "declined", expectedJobStatus: "In Progress" }, actor), /fixture job failure/);
  assert.deepEqual(f.report(), report); assert.equal(f.plan().lastCompletedAt, "");
  f.db.exec("DROP TRIGGER fail_service_job");
  report = await completeMaintenanceService(f.db, f.job.id, { revision: report.revision, signatureStatus: "declined", expectedJobStatus: "In Progress" }, actor, { returnChange: true });
  assert.equal(report.jobChange.job.status, "Completed"); assert.ok(report.jobChange.maintenancePlan.lastCompletedAt);
});
for (const status of ["signed", "unavailable", "declined"]) test(`legacy completed ${status} report remains intact and readable while PDF omits acknowledgement`, async t => {
  const f = workspace(t); answerAll(f.db, f.job.id);
  const legacy = await legacyFinish(f.db, f.job.id, status);
  const stored = f.db.prepare("SELECT * FROM maintenance_service_reports WHERE id=?").get(legacy.id);
  updateWorkspaceAddons(f.db, { maintenanceChecklists: false });
  assert.deepEqual(f.report(), legacy); assert.equal(getMaintenanceServiceHistory(f.db, f.plan().id)[0].signatureStatus, status);
  const pdf = await generateMaintenanceServicePdf(legacy);
  const text = (await readPdfTextRuns(pdf.bytes)).flat().map(run => run.text).join("\n");
  assert.doesNotMatch(text, /customer acknowledgement|customer signed|customer unavailable|declined signature|representative|signed:/i);
  const withoutLegacyFields = await generateMaintenanceServicePdf({ ...legacy, signatureStatus: "", representativeName: "", signatureData: "", signedAt: "" });
  assert.equal(await pdfImageCount(pdf.bytes), await pdfImageCount(withoutLegacyFields.bytes));
  assert.match(text, /Legacy Technician/); assert.match(text, /Completed:/);
  assert.deepEqual(f.db.prepare("SELECT * FROM maintenance_service_reports WHERE id=?").get(legacy.id), stored);
  assert.equal(WORKSPACE_SCHEMA_VERSION, 18);
});

test("normal technician report PDF contains completion without customer acknowledgement", async t => {
  const f = workspace(t, { checklist: [] }); const completed = await finish(f.db, f.job.id);
  const generated = await generateMaintenanceServicePdf(completed);
  const text = (await readPdfTextRuns(generated.bytes)).flat().map(run => run.text).join("\n");
  assert.match(text, /Technician completion/i); assert.match(text, /Completed:/);
  assert.doesNotMatch(text, /acknowledgement|representative|signature|signed:/i);
  fs.mkdirSync(new URL("../tmp/pdfs/", import.meta.url), { recursive: true });
  fs.writeFileSync(new URL("../tmp/pdfs/maintenance-service-normal-qa.pdf", import.meta.url), generated.bytes);
});
test("completed reports survive plan archive, job recycle and permanent job removal", async t => {
  const f = workspace(t); const completed = await finish(f.db, f.job.id);
  deleteMaintenancePlan(f.db, f.plan().id); deleteJob(f.db, f.job.id); emptyDeletedJobs(f.db);
  assert.deepEqual(f.report().items, completed.items); assert.equal(f.report().signatureStatus, "unavailable");
  assert.equal(getMaintenanceServiceHistory(f.db, completed.planId).length, 1);
  assert.deepEqual(f.db.pragma("foreign_key_check"), []);
});
test("SQLite backup/restore includes canonical reports, defects, signatures, send history and counts", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-service-backup-"));
  const f = workspace(t, { dbPath: path.join(directory, "elset-workspace.db") });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const image = await signature();
  addJobPhoto(f.db, f.job.id, { id: "backup-defect-photo", name: "Backup photo.png", url: image });
  const draft = answerAll(f.db, f.job.id);
  updateMaintenanceServiceDefect(f.db, f.job.id, draft.items[0].id, { revision: draft.revision, severity: "advisory",
    description: "Recorded defect retained in backup", recommendedAction: "Inspect on the next visit", photoRefs: ["backup-defect-photo"] }, actor);
  const finished = await legacyFinish(f.db, f.job.id);
  assert.ok(finished.signatureData); assert.equal(finished.representativeName, "Legacy Site Representative");
  persistMaintenanceServiceSend(f.db, finished.id, { ...emailInput, ok: true, sentAt: new Date().toISOString(),
    fromEmail: "sender@example.test", replyToEmail: "reply@example.test", messageId: "backup-provider-id",
    acceptedRecipients: emailInput.to, rejectedRecipients: [], unconfirmedRecipients: [], warning: "" }, actor);
  const completed = f.report();
  const bundle = await createWorkspaceSqliteBackupBundle({ env: { ELSET_DATA_DIR: directory } });
  assert.equal(bundle.metadata.workspace.summary.counts.maintenanceServiceReports, 1);
  assert.equal(bundle.metadata.workspace.summary.counts.maintenanceServiceResults, completed.items.length);
  assert.equal(bundle.metadata.workspace.summary.counts.maintenanceServiceDefects, 1);
  assert.equal(bundle.metadata.workspace.summary.counts.maintenanceServiceSends, 1);
  const staged = materializeWorkspaceSqliteBackup(bundle, path.join(directory, "staged"));
  const restored = openWorkspaceDb({ dbPath: staged.tempDbPath, readonly: true, migrate: false });
  try { assert.deepEqual(getMaintenanceServiceReport(restored, f.job.id), completed); } finally { restored.close(); }
});
test("PDF paginates long checklists/defects, embeds branding/photos, omits legacy signatures and keeps historical plan text", async t => {
  const custom = Array.from({ length: 55 }, (_, i) => `Custom inspection ${i + 1} ${"long details ".repeat(8)}`);
  const f = workspace(t, { checklist: custom });
  const logo = await sharp({ create: { width: 300, height: 80, channels: 3, background: "#167451" } }).png().toBuffer();
  saveWorkspaceLogo(f.db, await validateWorkspaceLogo(logo, "image/png"));
  let report = answerAll(f.db, f.job.id);
  addJobPhoto(f.db, f.job.id, { id: "pdf-photo", name: "Recorded beam.png", url: await defectPhoto() });
  report = updateMaintenanceServiceDefect(f.db, f.job.id, report.items[3].id, { revision: report.revision, severity: "action_required", description: "Long defect text. ".repeat(120), recommendedAction: "Replace damaged drive", photoRefs: ["pdf-photo"] }, actor);
  report = updateMaintenanceServiceNotes(f.db, f.job.id, { revision: report.revision, serviceNotes: "Long service notes. ".repeat(120) });
  f.db.prepare(`UPDATE maintenance_service_reports SET signature_status='signed',customer_representative_name=?,
    customer_signature_data=?,signed_at=? WHERE id=?`).run("Legacy Site Representative", await signature(), "2026-10-05T01:00:00.000Z", report.id);
  report = await completeMaintenanceService(f.db, f.job.id, { revision: report.revision }, actor);
  updateMaintenancePlan(f.db, f.plan().id, { checklistItems: [{ id: "later", text: "New plan text must not appear" }] });
  saveWorkspaceLogo(f.db, null);
  const generated = await generateMaintenanceServicePdf(f.report());
  const pages = await readPdfTextRuns(generated.bytes), text = pages.flat().map(run => run.text).join("\n");
  assert.ok(pages.length >= 5); assert.match(text, /MAINTENANCE SERVICE REPORT/); assert.match(text, /PASS/); assert.match(text, /DEFECT/);
  assert.match(text, /Action required/); assert.match(text, /Replace damaged drive/); assert.match(text, /Technician/i);
  assert.doesNotMatch(text, /acknowledgement|Legacy Site Representative|signature|signed:/i);
  assert.match(text, /Custom inspection 55/); assert.doesNotMatch(text, /New plan text/); assert.match(text, /Completed:/);
  assert.ok(report.snapshot.branding.logo); assert.equal((await PDFDocument.load(generated.bytes)).getPageCount(), pages.length);
  for (const page of pages) for (const run of page) assert.ok(run.y >= 24 && run.y <= 810, `Text stays in page bounds: ${run.text}`);
  fs.mkdirSync(new URL("../tmp/pdfs/", import.meta.url), { recursive: true });
  fs.writeFileSync(new URL("../tmp/pdfs/maintenance-service-qa.pdf", import.meta.url), generated.bytes);
});

function legacy15(db) {
  removeMediaSchemaForLegacyFixture(db);
  for (const table of tables) db.exec(`DROP TABLE ${table}`);
  db.exec("DELETE FROM workspace_schema_migrations WHERE version=16; UPDATE workspace_info SET schema_version=15; PRAGMA user_version=15;");
}
test("schema 15 upgrades once to 16, preserving plan/checklist/business rows without backfilling reports", t => {
  const f = workspace(t, { enabled: false }); legacy15(f.db);
  const before = loadWorkspaceStateFromDb(f.db), applied = [];
  migrateWorkspaceSchema(f.db, { onMigration: step => applied.push(step) });
  assert.deepEqual(applied, [{ fromVersion: 15, toVersion: 16 }, { fromVersion: 16, toVersion: 17 }, { fromVersion: 17, toVersion: 18 }]);
  assert.equal(WORKSPACE_SCHEMA_VERSION, 18); assert.deepEqual(assertWorkspaceSchema(f.db), { schemaVersion: 18 });
  assert.deepEqual(loadWorkspaceStateFromDb(f.db), before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM maintenance_service_reports").get().n, 0);
  migrateWorkspaceSchema(f.db, { onMigration: () => assert.fail("Migration repeated") });
  f.db.pragma("user_version=19"); assert.throws(() => migrateWorkspaceSchema(f.db), /refusing to downgrade/);
});
test("schema 15->16 rolls back all DDL, ledger and metadata on failure; trigger assertions fail closed", t => {
  const f = workspace(t, { enabled: false }); legacy15(f.db);
  assert.throws(() => migrateWorkspaceSchema(f.db, { onMigration: () => f.db.exec("CREATE TABLE maintenance_service_defects(id TEXT)") }), /migration 15 -> 16 failed/);
  assert.equal(f.db.pragma("user_version", { simple: true }), 15);
  assert.equal(f.db.prepare("SELECT schema_version FROM workspace_info").get().schema_version, 15);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_schema_migrations").get().n, 15);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name LIKE 'maintenance_service_%'").get().n, 0);
  migrateWorkspaceSchema(f.db); f.db.exec("DROP TRIGGER maintenance_service_report_locked");
  assert.throws(() => assertWorkspaceSchema(f.db), /missing required trigger/);
});

async function apiWorkspace(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-service-api-")), dbPath = path.join(directory, "elset-workspace.db");
  const f = workspace(t, { ...options, dbPath });
  const app = express();
  app.use(createMaintenanceServiceRouter({ env: { ELSET_WORKSPACE_DB_PATH: dbPath },
    requireAuth: (req, _res, next) => { req.user = { ...actor, role: req.headers["x-role"] || "admin" }; next(); },
    requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Forbidden" }),
    ...options.router }));
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  // workspace's close hook was registered first; cleanup runs after it.
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const request = async (suffix = "", body, role = "admin", method = "POST") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/${f.job.id}/maintenance-service${suffix}`, {
      method: body === undefined ? "GET" : method, headers: { "Content-Type": "application/json", "x-role": role }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, payload: response.headers.get("content-type")?.includes("json") ? await response.json() : await response.arrayBuffer() };
  };
  return { ...f, request, baseUrl: `http://127.0.0.1:${server.address().port}` };
}
test("record-specific API respects role visibility, technician execution, stale revision and finite body limits", async t => {
  const f = await apiWorkspace(t);
  const read = await f.request("", undefined, "technician"); assert.equal(read.status, 200); assert.ok(read.payload.report.items.length);
  assert.equal(Object.hasOwn(read.payload, "state"), false); assert.equal(Object.hasOwn(read.payload, "delta"), false);
  assert.equal((await f.request("", undefined, "customer")).status, 403);
  const item = read.payload.report.items[0], revision = read.payload.report.revision;
  assert.equal((await f.request(`/checklist/${item.id}`, { revision, result: "completed" }, "technician", "PATCH")).status, 200);
  assert.equal((await f.request(`/checklist/${item.id}`, { revision, result: "na" }, "office", "PATCH")).status, 409);
  assert.equal((await f.request("/send", { email: {} }, "technician")).status, 403);
  assert.equal((await f.request("", { serviceNotes: "a".repeat(530000) }, "technician", "PATCH")).status, 413);
});
test("disabled API rejects new creation, execution, completion and sends while historical reads/PDF remain available", async t => {
  const f = await apiWorkspace(t); const completed = await finish(f.db, f.job.id);
  updateWorkspaceAddons(f.db, { maintenanceChecklists: false });
  assert.equal((await f.request("", {})).status, 403);
  assert.equal((await f.request(`/checklist/${completed.items[0].id}`, { revision: completed.revision, result: "na" }, "admin", "PATCH")).status, 403);
  assert.equal((await f.request("/complete", { revision: completed.revision, signatureStatus: "declined" })).status, 403);
  assert.equal((await f.request("/check-all", { revision: completed.revision })).status, 403);
  assert.equal((await f.request("/send", { email: maintenanceServiceEmailDraft(completed) })).status, 403);
  assert.equal((await f.request()).payload.report.status, "completed"); assert.equal((await f.request("/report.pdf")).status, 200);
});
test("Check All API is record-specific, role-gated, revision-guarded and unavailable after completion", async t => {
  const f = await apiWorkspace(t); const before = f.report();
  assert.equal((await f.request("/check-all", { revision: before.revision }, "customer")).status, 403);
  assert.equal((await f.request("/check-all", { revision: before.revision, extra: "a".repeat(530000) }, "technician")).status, 413);
  const result = await f.request("/check-all", { revision: before.revision }, "technician");
  assert.equal(result.status, 200); assert.equal(result.payload.report.counts.completed, 11); assert.equal(result.payload.report.revision, before.revision + 1);
  assert.equal(Object.hasOwn(result.payload, "state"), false); assert.equal(Object.hasOwn(result.payload, "delta"), false);
  assert.equal((await f.request("/check-all", { revision: before.revision }, "office")).status, 409);
  const completed = await completeMaintenanceService(f.db, f.job.id, { revision: result.payload.report.revision }, actor);
  const locked = await f.request("/check-all", { revision: completed.revision });
  assert.equal(locked.status, 409); assert.equal(locked.payload.code, "REPORT_COMPLETED"); assert.deepEqual(f.report(), completed);
});
test("report APIs preserve historical manager access after job deletion and restrict archived access for technicians", async t => {
  const f = await apiWorkspace(t); const completed = await finish(f.db, f.job.id);
  deleteMaintenancePlan(f.db, completed.planId); deleteJob(f.db, f.job.id);
  assert.equal((await f.request()).status, 200);
  assert.equal((await f.request("", undefined, "technician")).status, 404);
  const response = await fetch(`${f.baseUrl}/api/maintenance-service-reports/${completed.id}`, { headers: { "x-role": "office" } });
  assert.equal(response.status, 200); assert.equal((await response.json()).report.id, completed.id);
  assert.equal((await fetch(`${f.baseUrl}/api/maintenance-service-reports/${completed.id}/report.pdf`, { headers: { "x-role": "technician" } })).status, 403);
  assert.equal((await fetch(`${f.baseUrl}/api/jobs/unknown-job/maintenance-service`, { headers: { "x-role": "admin" } })).status, 404);
});
test("invalid service email stops before PDF/transport, and default report recipients and body are used", async t => {
  let generated = 0, captured;
  const f = await apiWorkspace(t, { router: { generatePdf: async report => { generated++; return generateMaintenanceServicePdf(report); },
    createTransport: () => ({ sendMail: async mail => { captured = mail; return { accepted: mail.to, messageId: "defaults" }; } }) } });
  const completed = await finish(f.db, f.job.id);
  assert.equal((await f.request("/send", { email: { ...emailInput, to: [], cc: ["only-copy@example.test"] } })).status, 400);
  assert.equal(generated, 0); assert.equal(captured, undefined);
  const result = await f.request("/send", {}, "office"); assert.equal(result.status, 200);
  assert.deepEqual(captured.to, maintenanceServiceEmailDraft(completed).to); assert.match(captured.text, /completed service/);
});

const emailInput = { to: ["first@example.test", "second@example.test"], cc: ["office@example.test"], bcc: ["private@example.test"], subject: "Edited service subject", message: "Edited plain text & message" };
for (const mode of ["all", "partial", "cc-only", "unconfirmed", "history-failed", "provider-failed"]) test(`service report email ${mode}: shared acceptance, exact PDF, privacy and history semantics`, async t => {
  let captured;
  const router = { createTransport: () => ({ sendMail: async mail => {
    captured = mail;
    if (mode === "provider-failed") throw new Error("SMTP password secret-test-value");
    return { messageId: "service-provider-id", accepted: mode === "cc-only" ? emailInput.cc : mode === "unconfirmed" ? [] : mode === "partial" ? [emailInput.to[0], ...emailInput.cc] : [...emailInput.to, ...emailInput.cc, ...emailInput.bcc],
      rejected: mode === "partial" || mode === "cc-only" ? [emailInput.to[1]] : [] };
  } }) };
  if (mode === "history-failed") router.persistSend = () => { throw new Error("History database failure"); };
  const f = await apiWorkspace(t, { router }); const completed = await finish(f.db, f.job.id);
  const defaults = maintenanceServiceEmailDraft(completed); assert.equal(defaults.to[0], completed.snapshot.customerEmail); assert.match(defaults.subject, /Maintenance Service Report/);
  const result = await f.request("/send", { email: emailInput });
  assert.deepEqual(captured.to, emailInput.to); assert.deepEqual(captured.cc, emailInput.cc); assert.deepEqual(captured.bcc, emailInput.bcc);
  assert.equal(captured.subject, emailInput.subject); assert.equal(captured.text, emailInput.message);
  assert.doesNotMatch(captured.html + captured.text, /private@example.test/);
  const generated = await generateMaintenanceServicePdf(completed);
  // pdf-lib writes metadata timestamps, so compare the rendered report contents.
  assert.equal(captured.attachments[0].filename, generated.filename);
  assert.deepEqual(await readPdfTextRuns(captured.attachments[0].content), await readPdfTextRuns(generated.bytes));
  const success = ["all", "partial", "history-failed"].includes(mode);
  assert.equal(result.status, success ? 200 : 500);
  assert.equal(f.report().sentHistory.length, success && mode !== "history-failed" ? 1 : 0);
  if (mode === "history-failed") { assert.equal(result.payload.historySaved, false); assert.match(result.payload.warning, /Do not resend/); }
  if (mode === "partial") { assert.deepEqual(result.payload.rejectedRecipients, [emailInput.to[1]]); assert.deepEqual(result.payload.unconfirmedRecipients, emailInput.bcc); assert.match(result.payload.warning, /Do not resend/); }
  if (mode === "provider-failed") assert.doesNotMatch(JSON.stringify(result.payload), /secret-test-value|SMTP password/);
  if (success && mode !== "history-failed") { const send = f.report().sentHistory[0]; assert.deepEqual(send.bcc, emailInput.bcc); assert.equal(send.messageId, "service-provider-id"); assert.ok(send.sentBy.id); assert.ok(send.sentAt); }
});
