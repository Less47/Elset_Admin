import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getCustomerById, getJobById, getMaintenancePlanById, readWorkspaceRecords } from "./server-workspace-state.js";
import { getWorkspaceAddons, requireWorkspaceAddon } from "./server-workspace-addons.js";
import { readWorkspaceLogo } from "./server-workspace-logo.js";
import { changeJobStatus } from "./server-workspace-jobs.js";
import { maintenanceChecklistItems, maintenanceReportCounts, MAINTENANCE_RESULTS, MAINTENANCE_SEVERITIES } from "./src/lib/maintenance-checklist.js";
import { isMaintenanceDate } from "./src/lib/maintenance-recurrence.js";

export class MaintenanceServiceError extends Error {
  constructor(message, statusCode = 400, details = {}) { super(message); this.statusCode = statusCode; Object.assign(this, details); }
}
const now = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
function boundedText(value, label, max, required = false) {
  if (typeof value !== "string" || value.length > max || value.includes("\0") || (required && !value.trim())) {
    throw new MaintenanceServiceError(`${label} ${required ? "is required and " : ""}must be text of up to ${max} characters.`);
  }
  return value.trim();
}
export function assertMaintenanceServiceAccess(db, jobId, user, { commercial = false, historical = false } = {}) {
  // The existing workspace policy exposes all active jobs to technicians, including
  // unassigned jobs. Archived report access is restricted to business managers.
  if (!user || !["admin", "office", ...(commercial ? [] : ["technician"])].includes(user.role)) {
    throw new MaintenanceServiceError("You do not have permission to access this service report.", 403);
  }
  const job = getJobById(db, jobId);
  if (!job && (!historical || user.role === "technician")) throw new MaintenanceServiceError("Job not found.", 404);
  return job;
}

export function getMaintenanceServiceReport(db, jobId, { reportId } = {}) {
  const row = reportId ? db.prepare("SELECT * FROM maintenance_service_reports WHERE id=?").get(reportId)
    : db.prepare("SELECT * FROM maintenance_service_reports WHERE job_id=?").get(jobId);
  if (!row) return null;
  const items = db.prepare("SELECT * FROM maintenance_service_checklist_results WHERE report_id=? ORDER BY position").all(row.id)
    .map(item => ({ id: item.id, sourceItemId: item.source_item_id, sourceKey: item.source_key,
      standard: Boolean(item.standard), position: item.position, text: item.text, result: item.result, notes: item.notes }));
  const defects = db.prepare("SELECT * FROM maintenance_service_defects WHERE report_id=? ORDER BY created_at,id").all(row.id)
    .map(defect => ({ id: defect.id, resultId: defect.checklist_result_id, severity: defect.severity,
      description: defect.description, recommendedAction: defect.recommended_action, photoRefs: parse(defect.photo_refs_json, []),
      createdBy: defect.created_by, createdAt: defect.created_at, updatedAt: defect.updated_at }));
  const photoIds = new Set(defects.flatMap(defect => defect.photoRefs));
  const photos = db.prepare("SELECT id,name,url FROM job_attachments WHERE job_id=? AND kind='photo'").all(row.job_id)
    .filter(photo => photoIds.has(photo.id));
  const report = { id: row.id, planId: row.maintenance_plan_id, jobId: row.job_id,
    serviceDate: row.service_date, technicianId: row.technician_id, technicianName: row.technician_name,
    status: row.status, serviceNotes: row.service_notes, signatureStatus: row.signature_status,
    representativeName: row.customer_representative_name, signatureData: row.customer_signature_data,
    signedAt: row.signed_at, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
    revision: row.revision, snapshot: parse(row.snapshot_json), items, defects, photos,
    sentHistory: db.prepare("SELECT id,payload_json FROM maintenance_service_send_history WHERE report_id=? ORDER BY sent_at DESC,id").all(row.id)
      .map(send => ({ ...parse(send.payload_json), id: send.id })),
  };
  return { ...report, counts: maintenanceReportCounts(report) };
}

export function getMaintenanceServiceHistory(db, planId) {
  return db.prepare(`SELECT id,job_id,service_date,technician_name,status,signature_status,completed_at,
      json_extract(snapshot_json,'$.jobNumber') AS job_number,json_extract(snapshot_json,'$.planName') AS plan_name,
      json_extract(snapshot_json,'$.siteAddress') AS site_address,json_extract(snapshot_json,'$.customerName') AS customer_name,
      (SELECT count(*) FROM maintenance_service_defects d WHERE d.report_id=maintenance_service_reports.id) AS defect_count
    FROM maintenance_service_reports WHERE status='completed' ${planId ? "AND maintenance_plan_id=?" : ""} ORDER BY service_date DESC,completed_at DESC`).all(...(planId ? [planId] : []))
    .map(row => ({ id: row.id, jobId: row.job_id, serviceDate: row.service_date, technicianName: row.technician_name,
      status: row.status, signatureStatus: row.signature_status, completedAt: row.completed_at,
      jobNumber: row.job_number, planName: row.plan_name, siteAddress: row.site_address, customerName: row.customer_name,
      defectCount: row.defect_count }));
}

export function initializeMaintenanceService(db, jobId) {
  requireWorkspaceAddon(db, "maintenanceChecklists");
  return db.transaction(() => {
    const existing = getMaintenanceServiceReport(db, jobId);
    if (existing) return existing;
    const job = getJobById(db, jobId);
    if (!job) throw new MaintenanceServiceError("Job not found.", 404);
    const plan = getMaintenancePlanById(db, job.maintenancePlanId);
    if (!plan) throw new MaintenanceServiceError("This job is not linked to an active maintenance plan.", 409);
    const customer = getCustomerById(db, job.customerId);
    const site = customer?.sites?.find(site => job.siteId ? site.id === job.siteId : site.address === job.jobAddress);
    const snapshot = { version: 1, jobNumber: job.jobNumber, customerId: job.customerId, customerName: job.customerName,
      customerEmail: job.customerEmail, siteAddress: job.jobAddress, siteId: site?.id || job.siteId || "",
      clientReference: job.ocNumber || site?.ocNumber || "", planName: plan.planName,
      contactName: job.onsiteContact?.name || customer?.primaryContact?.name || job.customerName,
      billingContact: job.billingContact, onsiteContact: job.onsiteContact, requesterContact: job.requesterContact,
      initializedAt: now(), templateRevision: plan.maintenanceRevision || 0 };
    const reportId = crypto.randomUUID(), timestamp = now();
    db.prepare(`INSERT INTO maintenance_service_reports(id,maintenance_plan_id,job_id,service_date,created_at,updated_at,snapshot_json)
      VALUES(?,?,?,?,?,?,?)`).run(reportId, plan.id, jobId, job.scheduledDate || timestamp.slice(0, 10), timestamp, timestamp, JSON.stringify(snapshot));
    const insert = db.prepare(`INSERT INTO maintenance_service_checklist_results(id,report_id,source_item_id,source_key,standard,position,text)
      VALUES(?,?,?,?,?,?,?)`);
    maintenanceChecklistItems(plan.checklistItems || plan.checklist, plan.id).forEach(item => {
      insert.run(crypto.randomUUID(), reportId, item.id, item.key, Number(item.standard), item.position, item.text);
    });
    touch(db, timestamp);
    return getMaintenanceServiceReport(db, jobId);
  }).immediate();
}

function draftForMutation(db, jobId, revision) {
  requireWorkspaceAddon(db, "maintenanceChecklists");
  const report = getMaintenanceServiceReport(db, jobId);
  if (!report) throw new MaintenanceServiceError("Open the maintenance checklist first.", 404);
  if (report.status !== "draft") throw new MaintenanceServiceError("Completed service reports are read-only.", 409, { code: "REPORT_COMPLETED" });
  if (!Number.isInteger(revision) || revision !== report.revision) {
    throw new MaintenanceServiceError("This checklist has changed. Reload it before saving your changes.", 409, { code: "STALE_REPORT", currentRevision: report.revision });
  }
  return report;
}
function touch(db, timestamp = now()) { db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(timestamp); }
function advance(db, reportId) {
  const timestamp = now();
  db.prepare("UPDATE maintenance_service_reports SET revision=revision+1,updated_at=? WHERE id=?").run(timestamp, reportId);
  touch(db, timestamp);
}

function saveDefect(db, report, resultId, input, user) {
  if (!Object.hasOwn(MAINTENANCE_SEVERITIES, input?.severity)) throw new MaintenanceServiceError("Select a valid defect severity.", 400, { fieldErrors: { severity: "Select a severity." } });
  const description = boundedText(input.description, "Defect description", 8000, true);
  const action = boundedText(input.recommendedAction ?? "", "Recommended action", 8000);
  const refs = input.photoRefs ?? [];
  if (!Array.isArray(refs) || refs.length > 12 || refs.some(id => typeof id !== "string" || id.length > 180) || new Set(refs).size !== refs.length) {
    throw new MaintenanceServiceError("Select up to 12 distinct job photos.");
  }
  const old = db.prepare("SELECT * FROM maintenance_service_defects WHERE checklist_result_id=? AND report_id=?").get(resultId, report.id);
  const oldRefs = parse(old?.photo_refs_json || "[]", []);
  for (const photoId of refs) {
    const photo = db.prepare("SELECT id FROM job_attachments WHERE id=? AND job_id=? AND kind='photo'").get(photoId, report.jobId);
    if (!photo && !oldRefs.includes(photoId)) throw new MaintenanceServiceError("A selected photo does not belong to this job or was deleted.");
  }
  const timestamp = now();
  db.prepare(`INSERT INTO maintenance_service_defects(id,report_id,checklist_result_id,severity,description,recommended_action,photo_refs_json,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(checklist_result_id) DO UPDATE SET severity=excluded.severity,description=excluded.description,
    recommended_action=excluded.recommended_action,photo_refs_json=excluded.photo_refs_json,updated_at=excluded.updated_at`)
    .run(old?.id || crypto.randomUUID(), report.id, resultId, input.severity, description, action, JSON.stringify(refs), user.id, old?.created_at || timestamp, timestamp);
}

export function updateMaintenanceServiceResult(db, jobId, resultId, input, user) {
  return db.transaction(() => {
    const report = draftForMutation(db, jobId, input?.revision);
    if (!report.items.some(item => item.id === resultId)) throw new MaintenanceServiceError("Checklist item not found.", 404);
    if (input?.result !== null && !Object.hasOwn(MAINTENANCE_RESULTS, input?.result)) throw new MaintenanceServiceError("Select Completed, Defect or N/A, or clear the answer.");
    const notes = boundedText(input.notes ?? report.items.find(item => item.id === resultId).notes, "Item notes", 2000);
    if (input.result === "defect" && input.defect) saveDefect(db, report, resultId, input.defect, user);
    else if (input.result !== "defect") db.prepare("DELETE FROM maintenance_service_defects WHERE report_id=? AND checklist_result_id=?").run(report.id, resultId);
    db.prepare("UPDATE maintenance_service_checklist_results SET result=?,notes=? WHERE report_id=? AND id=?").run(input.result, notes, report.id, resultId);
    advance(db, report.id);
    return getMaintenanceServiceReport(db, jobId);
  }).immediate();
}

export function updateMaintenanceServiceDefect(db, jobId, resultId, input, user) {
  return updateMaintenanceServiceResult(db, jobId, resultId, { revision: input?.revision, result: "defect", defect: input }, user);
}

export function completeUnansweredMaintenanceChecks(db, jobId, input) {
  return db.transaction(() => {
    const report = draftForMutation(db, jobId, input?.revision);
    // Guard the report revision inside the write transaction and update only
    // unanswered results. Deliberate outcomes, notes and defects stay intact.
    const updated = db.prepare(`UPDATE maintenance_service_checklist_results SET result='completed'
      WHERE report_id=? AND result IS NULL`).run(report.id);
    if (updated.changes) advance(db, report.id);
    return updated.changes ? getMaintenanceServiceReport(db, jobId) : report;
  }).immediate();
}

export function updateMaintenanceServiceNotes(db, jobId, input) {
  return db.transaction(() => {
    const report = draftForMutation(db, jobId, input?.revision);
    const notes = boundedText(input.serviceNotes, "Technician notes", 20000);
    const date = input.serviceDate ?? report.serviceDate;
    if (!isMaintenanceDate(date)) throw new MaintenanceServiceError("Enter a valid service date.");
    db.prepare("UPDATE maintenance_service_reports SET service_notes=?,service_date=? WHERE id=?").run(notes, date, report.id);
    advance(db, report.id);
    return getMaintenanceServiceReport(db, jobId);
  }).immediate();
}

function snapshotBranding(db) {
  const state = readWorkspaceRecords(db, { quoteTemplate: true, settings: true });
  const template = state.quoteTemplate || {};
  const logoId = parse(db.prepare("SELECT value_json FROM settings WHERE key='workspaceLogo'").get()?.value_json || "null", null)?.id;
  const logo = logoId ? readWorkspaceLogo(db, logoId) : null;
  const fallback = fileURLToPath(new URL("./public/elset-logo.png", import.meta.url));
  const bytes = logo?.bytes || (fs.existsSync(fallback) ? fs.readFileSync(fallback) : null);
  return { companyName: template.companyName || "ELSET PTY LTD", abn: template.companyAbn || "", email: template.companyEmail || "",
    phone: template.companyPhone || "", address: template.companyAddress || "",
    logo: bytes ? `data:${logo?.mimeType || "image/png"};base64,${bytes.toString("base64")}` : "" };
}

export async function completeMaintenanceService(db, jobId, input, user, { returnChange = false } = {}) {
  draftForMutation(db, jobId, input?.revision);
  return db.transaction(() => {
    const report = draftForMutation(db, jobId, input.revision);
    const unanswered = report.items.filter(item => !item.result);
    const invalidDefects = report.items.filter(item => item.result === "defect" && !report.defects.some(defect => defect.resultId === item.id));
    if (!report.items.length) throw new MaintenanceServiceError("This visit has no checklist items. Add checks to the plan before generating the next visit; this empty snapshot cannot be completed.", 400);
    if (unanswered.length || invalidDefects.length) throw new MaintenanceServiceError(
      `${unanswered.length} unanswered ${unanswered.length === 1 ? "check" : "checks"}; ${invalidDefects.length} ${invalidDefects.length === 1 ? "defect needs" : "defects need"} a description and severity.`,
      400, { unansweredItems: unanswered.map(item => ({ id: item.id, text: item.text })), invalidDefectItems: invalidDefects.map(item => ({ id: item.id, text: item.text })) });
    const timestamp = now();
    const staffId = user.staffId || "";
    const staffName = staffId ? db.prepare("SELECT name FROM staff WHERE id=?").get(staffId)?.name : "";
    const notes = input.serviceNotes === undefined ? report.serviceNotes : boundedText(input.serviceNotes, "Technician notes", 20000);
    const serviceDate = input.serviceDate ?? report.serviceDate;
    if (!isMaintenanceDate(serviceDate)) throw new MaintenanceServiceError("Enter a valid service date.");
    const snapshot = { ...report.snapshot, branding: snapshotBranding(db), completedBy: { id: user.id, name: user.name || user.username || "" } };
    // Released schema 16 requires a nonempty legacy signature_status on completion.
    // Use its existing neutral fallback solely for storage compatibility; ignore
    // acknowledgement input and preserve any already-stored legacy fields.
    db.prepare(`UPDATE maintenance_service_reports SET status='completed',service_date=?,service_notes=?,
      signature_status=CASE WHEN signature_status='' THEN 'unavailable' ELSE signature_status END,
      completed_at=?,technician_id=?,technician_name=?,
      updated_at=?,revision=revision+1,snapshot_json=? WHERE id=?`)
      .run(serviceDate, notes, timestamp,
        staffId || user.id, staffName || user.name || user.username || "Technician", timestamp, JSON.stringify(snapshot), report.id);
    // Reuse the ordinary job completion path inside the same transaction. This
    // also records occurrence completion and the plan's last-completed date.
    const jobChange = changeJobStatus(db, jobId, "Completed", { returnDelta: true, expectedStatus: input.expectedJobStatus });
    touch(db, timestamp);
    const completed = getMaintenanceServiceReport(db, jobId);
    return returnChange ? { report: completed, jobChange } : completed;
  }).immediate();
}

export function maintenanceServiceAvailable(db) { return getWorkspaceAddons(db).maintenanceChecklists; }

export function persistMaintenanceServiceSend(db, reportId, send, user) {
  return db.transaction(() => {
    const id = crypto.randomUUID();
    const payload = { ...send, sentBy: { id: user.id, name: user.name || user.username || "" } };
    db.prepare("INSERT INTO maintenance_service_send_history(id,report_id,sent_at,sender_id,payload_json) VALUES(?,?,?,?,?)")
      .run(id, reportId, send.sentAt, user.id, JSON.stringify(payload));
    touch(db);
    return { id, ...payload };
  }).immediate();
}
