import crypto from "crypto";
import { moneyToCents } from "./server-workspace-importer.js";
import { createJob } from "./server-workspace-jobs.js";
import { WORKSPACE_SCHEMA_VERSION } from "./server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const maintenanceFrequencyValues = new Set(["monthly", "quarterly", "six-monthly", "annual"]);
const maintenanceFrequencyMonths = {
  monthly: 1,
  quarterly: 3,
  "six-monthly": 6,
  annual: 12,
};

const maintenanceKnownKeys = new Set([
  "id",
  "planName",
  "customerId",
  "siteAddress",
  "siteId",
  "assetId",
  "frequency",
  "nextDueDate",
  "defaultTechnicianId",
  "estimatedDurationHours",
  "contractPrice",
  "checklist",
  "notes",
  "lastGeneratedAt",
  "lastGeneratedJobId",
  "lastCompletedAt",
  "createdAt",
  "updatedAt",
]);

const checklistKnownKeys = new Set(["id", "text", "label", "notes"]);

export class WorkspaceMaintenanceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceMaintenanceError";
    this.statusCode = statusCode;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "");
}

function trimText(value) {
  return text(value).trim();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function objectJson(value) {
  return json(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function assertPlainObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceMaintenanceError(`${label} must be an object.`);
  }
}

function normalizeId(value, label = "ID") {
  const id = trimText(value);
  if (!id) throw new WorkspaceMaintenanceError(`${label} is required.`);
  if (id.length > 180) throw new WorkspaceMaintenanceError(`${label} is too long.`);
  return id;
}

function normalizeOptionalId(value, label = "ID") {
  const id = trimText(value);
  if (!id) return "";
  if (id.length > 180) throw new WorkspaceMaintenanceError(`${label} is too long.`);
  return id;
}

function nullableText(value) {
  const normalized = trimText(value);
  return normalized || null;
}

function normalizeSiteAddress(value) {
  return text(value).replace(/\s+/g, " ").trim();
}

function toDateInputValue(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      return "";
    }
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateInput(value, label, { allowEmpty = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowEmpty) return "";
    throw new WorkspaceMaintenanceError(`${label} is required.`);
  }
  const normalized = toDateInputValue(value);
  if (!normalized) throw new WorkspaceMaintenanceError(`${label} is invalid.`);
  return normalized;
}

function addMonthsToDateInput(value, months) {
  const normalized = toDateInputValue(value);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return toDateInputValue(date);
}

function normalizeFrequency(value) {
  const frequency = trimText(value);
  return maintenanceFrequencyValues.has(frequency) ? frequency : "quarterly";
}

function normalizeNumber(value, label, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new WorkspaceMaintenanceError(`${label} must be a valid number.`);
  if (normalized < 0) throw new WorkspaceMaintenanceError(`${label} cannot be negative.`);
  return normalized;
}

function moneyToSafeCents(value, label) {
  let cents = 0;
  try {
    cents = moneyToCents(value ?? 0);
  } catch (error) {
    throw new WorkspaceMaintenanceError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
  if (cents < 0) throw new WorkspaceMaintenanceError(`${label} cannot be negative.`);
  return cents;
}

function pickExtra(record, knownKeys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const extra = {};
  for (const [key, value] of Object.entries(record)) {
    if (!knownKeys.has(key)) extra[key] = value;
  }
  return extra;
}

function normalizeChecklistItems(items, planId) {
  const source = Array.isArray(items)
    ? items
    : text(items).split(/\r?\n/);

  if (source.length > 300) throw new WorkspaceMaintenanceError("Checklist contains too many items.");

  return source
    .map((item, index) => {
      const isObject = item && typeof item === "object" && !Array.isArray(item);
      const itemText = trimText(isObject ? item.text ?? item.label ?? item.notes : item);
      if (!itemText) return null;
      return {
        id: normalizeOptionalId(isObject ? item.id : "", "Checklist item ID") || `${planId}:checklist:${index + 1}`,
        position: index + 1,
        text: itemText,
        extra: isObject ? pickExtra(item, checklistKnownKeys) : {},
      };
    })
    .filter(Boolean);
}

function ensureCustomerExists(db, customerId) {
  const row = db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId);
  if (!row) throw new WorkspaceMaintenanceError("Customer not found.", 404);
}

function ensureStaffExists(db, staffId) {
  const normalized = trimText(staffId);
  if (!normalized) return;
  const row = db.prepare("SELECT id FROM staff WHERE id = ?").get(normalized);
  if (!row) throw new WorkspaceMaintenanceError("Technician not found.", 404);
}

function validateOptionalSiteAndAsset(db, input, customerId) {
  const siteId = trimText(input?.siteId);
  const assetId = trimText(input?.assetId);

  if (siteId) {
    const site = db.prepare("SELECT id FROM sites WHERE id = ? AND customer_id = ?").get(siteId, customerId);
    if (!site) throw new WorkspaceMaintenanceError("Site not found for this customer.", 404);
  }

  if (assetId) {
    const asset = db.prepare(`
      SELECT site_assets.id, sites.customer_id, site_assets.site_id
        FROM site_assets
        JOIN sites ON sites.id = site_assets.site_id
       WHERE site_assets.id = ?
    `).get(assetId);
    if (!asset || asset.customer_id !== customerId) {
      throw new WorkspaceMaintenanceError("Asset not found for this customer.", 404);
    }
    if (siteId && asset.site_id !== siteId) {
      throw new WorkspaceMaintenanceError("Asset does not belong to the selected site.", 400);
    }
  }
}

function ensureJobReference(db, jobId, planId) {
  const normalized = trimText(jobId);
  if (!normalized) return;
  const row = db.prepare("SELECT id, maintenance_plan_id FROM jobs WHERE id = ?").get(normalized);
  if (!row) throw new WorkspaceMaintenanceError("Linked job not found.", 404);
  if (row.maintenance_plan_id && row.maintenance_plan_id !== planId) {
    throw new WorkspaceMaintenanceError("Linked job belongs to another maintenance plan.", 400);
  }
}

function getPlanState(db, planId) {
  return loadWorkspaceStateFromDb(db).maintenancePlans.find((plan) => plan.id === planId) || null;
}

function normalizeMaintenancePlanInput(input, existing = null) {
  assertPlainObject(input, "Maintenance plan");
  const source = {
    ...(existing || {}),
    ...input,
  };
  const now = nowIso();
  const id = normalizeOptionalId(source.id || existing?.id, "Maintenance plan ID") || crypto.randomUUID();
  const planName = trimText(source.planName) || "Untitled maintenance plan";
  const customerId = normalizeId(source.customerId, "Customer ID");
  const siteAddress = normalizeSiteAddress(source.siteAddress);
  if (!siteAddress) throw new WorkspaceMaintenanceError("Site address is required.");

  return {
    id,
    planName,
    customerId,
    siteAddress,
    frequency: normalizeFrequency(source.frequency),
    nextDueDate: normalizeDateInput(source.nextDueDate, "Next service date", { allowEmpty: false }),
    defaultTechnicianId: trimText(source.defaultTechnicianId),
    estimatedDurationHours: normalizeNumber(source.estimatedDurationHours, "Estimated duration", 0),
    contractPriceCents: moneyToSafeCents(source.contractPrice ?? 0, "Contract price"),
    notes: trimText(source.notes),
    lastGeneratedAt: trimText(source.lastGeneratedAt),
    lastGeneratedJobId: trimText(source.lastGeneratedJobId),
    lastCompletedAt: trimText(source.lastCompletedAt),
    createdAt: trimText(existing?.createdAt || source.createdAt) || now,
    updatedAt: now,
    checklist: normalizeChecklistItems(source.checklist || [], id),
    extra: pickExtra(source, maintenanceKnownKeys),
  };
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, ?, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(WORKSPACE_SCHEMA_VERSION, updatedAt, updatedAt);
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new WorkspaceMaintenanceError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function insertChecklistItems(db, plan) {
  const statement = db.prepare(`
    INSERT INTO maintenance_checklist_items (id, maintenance_plan_id, position, text, extra_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  plan.checklist.forEach((item) => {
    statement.run(item.id, plan.id, item.position, item.text, objectJson(item.extra));
  });
}

function insertOrReplaceMaintenancePlan(db, plan) {
  db.prepare(`
    INSERT INTO maintenance_plans (
      id, customer_id, plan_name, site_address, frequency, next_due_date, default_technician_id,
      estimated_duration_hours, contract_price_cents, notes, last_generated_at, last_generated_job_id,
      last_completed_at, created_at, updated_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      plan_name = excluded.plan_name,
      site_address = excluded.site_address,
      frequency = excluded.frequency,
      next_due_date = excluded.next_due_date,
      default_technician_id = excluded.default_technician_id,
      estimated_duration_hours = excluded.estimated_duration_hours,
      contract_price_cents = excluded.contract_price_cents,
      notes = excluded.notes,
      last_generated_at = excluded.last_generated_at,
      last_generated_job_id = excluded.last_generated_job_id,
      last_completed_at = excluded.last_completed_at,
      updated_at = excluded.updated_at,
      extra_json = excluded.extra_json
  `).run(
    plan.id,
    plan.customerId,
    plan.planName,
    plan.siteAddress,
    plan.frequency,
    plan.nextDueDate,
    nullableText(plan.defaultTechnicianId),
    plan.estimatedDurationHours,
    plan.contractPriceCents,
    plan.notes,
    plan.lastGeneratedAt,
    plan.lastGeneratedJobId,
    plan.lastCompletedAt,
    plan.createdAt,
    plan.updatedAt,
    objectJson(plan.extra)
  );

  db.prepare("DELETE FROM maintenance_checklist_items WHERE maintenance_plan_id = ?").run(plan.id);
  insertChecklistItems(db, plan);
}

function linkedJobIdsForPlan(db, planId) {
  return db.prepare("SELECT id FROM jobs WHERE maintenance_plan_id = ? ORDER BY created_at").all(planId).map((row) => row.id);
}

function archiveMaintenancePlanRow(db, plan, deletedAt = nowIso()) {
  const linkedJobIds = linkedJobIdsForPlan(db, plan.id);
  db.prepare(`
    INSERT OR REPLACE INTO deleted_maintenance_plans (
      id, plan_id, customer_id, deleted_at, payload_json, linked_job_ids_json, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, '{}')
  `).run(
    `deleted-maintenance-plan:${plan.id}`,
    plan.id,
    plan.customerId,
    deletedAt,
    json(plan),
    json(linkedJobIds)
  );
  return linkedJobIds;
}

function restoreMaintenancePlanFromArchiveRow(db, row) {
  const payload = parseJson(row.payload_json, null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WorkspaceMaintenanceError("Deleted maintenance plan payload is invalid.", 500);
  }
  if (db.prepare("SELECT id FROM maintenance_plans WHERE id = ?").get(row.plan_id)) {
    throw new WorkspaceMaintenanceError("Maintenance plan already exists.", 409);
  }
  ensureCustomerExists(db, payload.customerId);
  const plan = normalizeMaintenancePlanInput({ ...payload, id: row.plan_id });
  insertOrReplaceMaintenancePlan(db, plan);

  const linkedJobIds = parseJson(row.linked_job_ids_json, []);
  if (Array.isArray(linkedJobIds) && linkedJobIds.length > 0) {
    const updateJob = db.prepare(`
      UPDATE jobs
         SET maintenance_plan_id = ?,
             maintenance_plan_name = ?,
             updated_at = ?
       WHERE id = ?
         AND (maintenance_plan_id IS NULL OR maintenance_plan_id = '')
    `);
    linkedJobIds.forEach((jobId) => updateJob.run(plan.id, plan.planName, plan.updatedAt, jobId));
  }

  db.prepare("DELETE FROM deleted_maintenance_plans WHERE id = ?").run(row.id);
  return plan;
}

export function createMaintenancePlan(db, input) {
  const plan = normalizeMaintenancePlanInput(input);

  return db.transaction(() => {
    if (db.prepare("SELECT id FROM maintenance_plans WHERE id = ?").get(plan.id)) {
      throw new WorkspaceMaintenanceError("A maintenance plan with that ID already exists.", 409);
    }
    ensureCustomerExists(db, plan.customerId);
    ensureStaffExists(db, plan.defaultTechnicianId);
    validateOptionalSiteAndAsset(db, input, plan.customerId);
    ensureJobReference(db, plan.lastGeneratedJobId, plan.id);
    insertOrReplaceMaintenancePlan(db, plan);
    touchWorkspaceInfo(db, plan.updatedAt);
    runForeignKeyCheck(db);
    return getPlanState(db, plan.id);
  })();
}

export function updateMaintenancePlan(db, planIdInput, input) {
  assertPlainObject(input, "Maintenance plan");
  const planId = normalizeId(planIdInput, "Maintenance plan ID");

  return db.transaction(() => {
    const existing = getPlanState(db, planId);
    if (!existing) throw new WorkspaceMaintenanceError("Maintenance plan not found.", 404);

    const plan = normalizeMaintenancePlanInput({ ...input, id: planId }, existing);
    ensureCustomerExists(db, plan.customerId);
    ensureStaffExists(db, plan.defaultTechnicianId);
    validateOptionalSiteAndAsset(db, input, plan.customerId);
    ensureJobReference(db, plan.lastGeneratedJobId, plan.id);
    insertOrReplaceMaintenancePlan(db, plan);
    touchWorkspaceInfo(db, plan.updatedAt);
    runForeignKeyCheck(db);
    return getPlanState(db, plan.id);
  })();
}

export function scheduleMaintenancePlan(db, planIdInput, nextDueDateInput) {
  const planId = normalizeId(planIdInput, "Maintenance plan ID");
  const nextDueDate = normalizeDateInput(nextDueDateInput, "Next service date", { allowEmpty: false });

  return db.transaction(() => {
    const existing = getPlanState(db, planId);
    if (!existing) throw new WorkspaceMaintenanceError("Maintenance plan not found.", 404);
    const plan = normalizeMaintenancePlanInput({ ...existing, nextDueDate, id: planId }, existing);
    insertOrReplaceMaintenancePlan(db, plan);
    touchWorkspaceInfo(db, plan.updatedAt);
    runForeignKeyCheck(db);
    return getPlanState(db, plan.id);
  })();
}

export function completeMaintenanceCycle(db, planIdInput, input = {}) {
  const planId = normalizeId(planIdInput, "Maintenance plan ID");

  return db.transaction(() => {
    const existing = getPlanState(db, planId);
    if (!existing) throw new WorkspaceMaintenanceError("Maintenance plan not found.", 404);
    const completedAt = trimText(input.completedAt) || nowIso();
    const advanceRecurrence = input.advanceRecurrence === true;
    const nextDueDate = advanceRecurrence
      ? addMonthsToDateInput(existing.nextDueDate || toDateInputValue(completedAt), maintenanceFrequencyMonths[existing.frequency] || 3)
      : existing.nextDueDate;
    const plan = normalizeMaintenancePlanInput({
      ...existing,
      id: planId,
      lastCompletedAt: completedAt,
      nextDueDate,
    }, existing);
    insertOrReplaceMaintenancePlan(db, plan);
    touchWorkspaceInfo(db, plan.updatedAt);
    runForeignKeyCheck(db);
    return getPlanState(db, plan.id);
  })();
}

export function deleteMaintenancePlan(db, planIdInput) {
  const planId = normalizeId(planIdInput, "Maintenance plan ID");

  return db.transaction(() => {
    const plan = getPlanState(db, planId);
    if (!plan) throw new WorkspaceMaintenanceError("Maintenance plan not found.", 404);
    const deletedAt = nowIso();
    const linkedJobIds = archiveMaintenancePlanRow(db, plan, deletedAt);
    db.prepare("DELETE FROM maintenance_plans WHERE id = ?").run(planId);
    touchWorkspaceInfo(db, deletedAt);
    runForeignKeyCheck(db);
    return {
      planId,
      deletedAt,
      linkedJobCount: linkedJobIds.length,
    };
  })();
}

export function restoreDeletedMaintenancePlan(db, planIdInput) {
  const planId = normalizeId(planIdInput, "Maintenance plan ID");

  return db.transaction(() => {
    const row = db.prepare(`
      SELECT *
        FROM deleted_maintenance_plans
       WHERE plan_id = ?
       LIMIT 1
    `).get(planId);
    if (!row) throw new WorkspaceMaintenanceError("Deleted maintenance plan not found.", 404);
    const plan = restoreMaintenancePlanFromArchiveRow(db, row);
    touchWorkspaceInfo(db, plan.updatedAt);
    runForeignKeyCheck(db);
    return getPlanState(db, plan.id);
  })();
}

export function archiveMaintenancePlansForCustomer(db, customerIdInput, deletedAt = nowIso()) {
  const customerId = normalizeId(customerIdInput, "Customer ID");
  const plans = loadWorkspaceStateFromDb(db).maintenancePlans.filter((plan) => plan.customerId === customerId);
  plans.forEach((plan) => archiveMaintenancePlanRow(db, plan, deletedAt));
  return plans.length;
}

export function restoreMaintenancePlansForCustomer(db, customerIdInput) {
  const customerId = normalizeId(customerIdInput, "Customer ID");
  const rows = db.prepare(`
    SELECT *
      FROM deleted_maintenance_plans
     WHERE customer_id = ?
     ORDER BY deleted_at
  `).all(customerId);

  const restored = [];
  rows.forEach((row) => {
    restored.push(restoreMaintenancePlanFromArchiveRow(db, row));
  });
  return restored;
}

export function generateMaintenanceJob(db, planIdInput, input = {}) {
  const planId = normalizeId(planIdInput, "Maintenance plan ID");

  return db.transaction(() => {
    const plan = getPlanState(db, planId);
    if (!plan) throw new WorkspaceMaintenanceError("Maintenance plan not found.", 404);
    ensureCustomerExists(db, plan.customerId);
    ensureStaffExists(db, plan.defaultTechnicianId);

    const state = loadWorkspaceStateFromDb(db);
    const customer = state.customers.find((entry) => entry.id === plan.customerId);
    if (!customer) throw new WorkspaceMaintenanceError("Customer not found.", 404);

    const dueDate = plan.nextDueDate || toDateInputValue(new Date());
    const existingOpenJob = state.jobs.find((job) =>
      job.maintenancePlanId === plan.id
      && job.maintenanceDueDate === dueDate
      && job.status !== "Completed"
    );
    if (existingOpenJob) {
      return {
        plan: getPlanState(db, plan.id),
        job: existingOpenJob,
        duplicate: true,
      };
    }

    const staff = plan.defaultTechnicianId
      ? db.prepare("SELECT name FROM staff WHERE id = ?").get(plan.defaultTechnicianId)
      : null;
    const job = createJob(db, {
      customer: { id: customer.id },
      job: {
        id: normalizeOptionalId(input.jobId, "Job ID") || crypto.randomUUID(),
        title: plan.planName,
        description: buildMaintenanceJobDescription(plan),
        urgency: "Medium",
        status: "To Do",
        scheduledDate: dueDate,
        assignedTechnicianId: plan.defaultTechnicianId,
        assignedTechnicianName: staff?.name || "",
        customerId: customer.id,
        jobAddress: plan.siteAddress || customer.address,
        maintenancePlanId: plan.id,
        maintenancePlanName: plan.planName,
        maintenanceDueDate: dueDate,
      },
    });

    const updatedAt = nowIso();
    const nextDueDate = addMonthsToDateInput(dueDate, maintenanceFrequencyMonths[plan.frequency] || 3);
    db.prepare(`
      UPDATE maintenance_plans
         SET last_generated_at = ?,
             last_generated_job_id = ?,
             next_due_date = ?,
             updated_at = ?
       WHERE id = ?
    `).run(updatedAt, job.id, nextDueDate, updatedAt, plan.id);

    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      plan: getPlanState(db, plan.id),
      job: loadWorkspaceStateFromDb(db).jobs.find((entry) => entry.id === job.id) || job,
    };
  })();
}

function buildMaintenanceJobDescription(plan) {
  const sections = [
    `Recurring maintenance visit for ${plan.planName}.`,
    plan.siteAddress ? `Site: ${plan.siteAddress}` : "",
    `Frequency: ${getMaintenanceFrequencyLabel(plan.frequency)}`,
    plan.notes ? `Plan notes: ${plan.notes}` : "",
    Array.isArray(plan.checklist) && plan.checklist.length > 0
      ? `Checklist:\n${plan.checklist.map((item) => `- ${item}`).join("\n")}`
      : "",
  ];

  return sections.filter(Boolean).join("\n\n");
}

function getMaintenanceFrequencyLabel(frequency) {
  if (frequency === "monthly") return "Monthly";
  if (frequency === "six-monthly") return "6 Monthly";
  if (frequency === "annual") return "Annual";
  return "Quarterly";
}
