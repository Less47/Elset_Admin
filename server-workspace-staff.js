import crypto from "crypto";
import { WORKSPACE_SCHEMA_VERSION } from "./server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const staffKnownKeys = new Set([
  "id",
  "name",
  "role",
  "email",
  "phone",
  "createdAt",
  "updatedAt",
]);

export class WorkspaceStaffError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceStaffError";
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
    throw new WorkspaceStaffError(`${label} must be an object.`);
  }
}

function normalizeId(value, label = "ID") {
  const id = trimText(value);
  if (!id) throw new WorkspaceStaffError(`${label} is required.`);
  if (id.length > 180) throw new WorkspaceStaffError(`${label} is too long.`);
  return id;
}

function normalizeOptionalId(value, label = "ID") {
  const id = trimText(value);
  if (!id) return "";
  if (id.length > 180) throw new WorkspaceStaffError(`${label} is too long.`);
  return id;
}

function pickExtra(record, knownKeys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const extra = {};
  for (const [key, value] of Object.entries(record)) {
    if (!knownKeys.has(key)) extra[key] = value;
  }
  return extra;
}

function normalizeEmail(value) {
  const email = trimText(value);
  if (!email) return "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new WorkspaceStaffError("Staff email address is invalid.");
  }
  return email;
}

function normalizeRole(value) {
  const role = trimText(value) || "Staff";
  if (role.length > 120) throw new WorkspaceStaffError("Staff role is too long.");
  if ([...role].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new WorkspaceStaffError("Staff role is invalid.");
  }
  return role;
}

function normalizePhone(value) {
  const phone = trimText(value);
  if (phone.length > 80) throw new WorkspaceStaffError("Staff phone number is too long.");
  return phone;
}

function normalizeStaffInput(input, existing = null) {
  assertPlainObject(input, "Staff member");
  const requestedId = normalizeOptionalId(input.id, "Staff member ID");
  if (existing && requestedId && requestedId !== existing.id) {
    throw new WorkspaceStaffError("Staff member ID cannot be changed.");
  }

  const source = {
    ...(existing || {}),
    ...input,
    id: existing?.id || requestedId || crypto.randomUUID(),
  };
  const now = nowIso();
  const name = trimText(source.name);
  if (!name) throw new WorkspaceStaffError("Staff member name is required.");
  if (name.length > 160) throw new WorkspaceStaffError("Staff member name is too long.");

  return {
    id: normalizeId(source.id, "Staff member ID"),
    name,
    role: normalizeRole(source.role),
    email: normalizeEmail(source.email),
    phone: normalizePhone(source.phone),
    createdAt: trimText(existing?.createdAt || source.createdAt) || now,
    updatedAt: now,
    extra: pickExtra(source, staffKnownKeys),
  };
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, ?, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET
      schema_version = max(workspace_info.schema_version, excluded.schema_version),
      updated_at = excluded.updated_at
  `).run(WORKSPACE_SCHEMA_VERSION, updatedAt, updatedAt);
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new WorkspaceStaffError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function getStaffMemberState(db, staffId) {
  return loadWorkspaceStateFromDb(db).staff.find((staffMember) => staffMember.id === staffId) || null;
}

function ensureStaffMemberExists(db, staffId) {
  const row = db.prepare("SELECT id FROM staff WHERE id = ?").get(staffId);
  if (!row) throw new WorkspaceStaffError("Staff member not found.", 404);
}

function insertStaffMember(db, staffMember) {
  db.prepare(`
    INSERT INTO staff (id, name, role, email, phone, created_at, updated_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    staffMember.id,
    staffMember.name,
    staffMember.role,
    staffMember.email,
    staffMember.phone,
    staffMember.createdAt,
    staffMember.updatedAt,
    objectJson(staffMember.extra)
  );
}

function updateStaffMemberRow(db, staffMember) {
  db.prepare(`
    UPDATE staff
       SET name = ?,
           role = ?,
           email = ?,
           phone = ?,
           updated_at = ?,
           extra_json = ?
     WHERE id = ?
  `).run(
    staffMember.name,
    staffMember.role,
    staffMember.email,
    staffMember.phone,
    staffMember.updatedAt,
    objectJson(staffMember.extra),
    staffMember.id
  );
}

function getAssignedJobIds(db, staffId) {
  return db.prepare(`
    SELECT id
      FROM jobs
     WHERE assigned_technician_id = ?
     ORDER BY created_at
  `).all(staffId).map((row) => row.id);
}

function getMaintenancePlanIds(db, staffId) {
  return db.prepare(`
    SELECT id
      FROM maintenance_plans
     WHERE default_technician_id = ?
     ORDER BY created_at
  `).all(staffId).map((row) => row.id);
}

function restoreJobAssignments(db, staffId, jobIds) {
  const statement = db.prepare(`
    UPDATE jobs
       SET assigned_technician_id = ?
     WHERE id = ?
       AND (assigned_technician_id IS NULL OR assigned_technician_id = '')
  `);
  for (const jobId of jobIds) {
    statement.run(staffId, jobId);
  }
}

function restoreMaintenanceTechnicianLinks(db, staffId, planIds) {
  const statement = db.prepare(`
    UPDATE maintenance_plans
       SET default_technician_id = ?
     WHERE id = ?
       AND (default_technician_id IS NULL OR default_technician_id = '')
  `);
  for (const planId of planIds) {
    statement.run(staffId, planId);
  }
}

export function createStaffMember(db, input) {
  const staffMember = normalizeStaffInput(input);

  return db.transaction(() => {
    if (db.prepare("SELECT id FROM staff WHERE id = ?").get(staffMember.id)) {
      throw new WorkspaceStaffError("A staff member with that ID already exists.", 409);
    }
    insertStaffMember(db, staffMember);
    touchWorkspaceInfo(db, staffMember.updatedAt);
    runForeignKeyCheck(db);
    return getStaffMemberState(db, staffMember.id);
  })();
}

export function updateStaffMember(db, staffIdInput, input) {
  assertPlainObject(input, "Staff member");
  const staffId = normalizeId(staffIdInput, "Staff member ID");

  return db.transaction(() => {
    const existing = getStaffMemberState(db, staffId);
    if (!existing) throw new WorkspaceStaffError("Staff member not found.", 404);
    const staffMember = normalizeStaffInput(input, existing);
    updateStaffMemberRow(db, staffMember);
    touchWorkspaceInfo(db, staffMember.updatedAt);
    runForeignKeyCheck(db);
    return getStaffMemberState(db, staffMember.id);
  })();
}

export function deleteStaffMember(db, staffIdInput) {
  const staffId = normalizeId(staffIdInput, "Staff member ID");

  return db.transaction(() => {
    ensureStaffMemberExists(db, staffId);
    const staffMember = getStaffMemberState(db, staffId);
    const assignedJobIds = getAssignedJobIds(db, staffId);
    const maintenancePlanIds = getMaintenancePlanIds(db, staffId);
    const deletedAt = nowIso();

    db.prepare(`
      INSERT INTO deleted_staff_members (
        id, staff_id, deleted_at, payload_json, assigned_job_ids_json, maintenance_plan_ids_json, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, '{}')
    `).run(
      `deleted-staff-member:${staffId}`,
      staffId,
      deletedAt,
      json(staffMember),
      json(assignedJobIds),
      json(maintenancePlanIds)
    );

    db.prepare("DELETE FROM staff WHERE id = ?").run(staffId);
    touchWorkspaceInfo(db, deletedAt);
    runForeignKeyCheck(db);
    return {
      staffId,
      deletedAt,
      assignedJobCount: assignedJobIds.length,
      maintenancePlanCount: maintenancePlanIds.length,
    };
  })();
}

export function restoreDeletedStaffMember(db, staffIdInput) {
  const staffId = normalizeId(staffIdInput, "Staff member ID");

  return db.transaction(() => {
    if (db.prepare("SELECT id FROM staff WHERE id = ?").get(staffId)) {
      throw new WorkspaceStaffError("Staff member already exists.", 409);
    }

    const row = db.prepare(`
      SELECT *
        FROM deleted_staff_members
       WHERE staff_id = ?
       ORDER BY deleted_at DESC
       LIMIT 1
    `).get(staffId);
    if (!row) throw new WorkspaceStaffError("Deleted staff member not found.", 404);

    const payload = parseJson(row.payload_json, null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new WorkspaceStaffError("Deleted staff member payload is invalid.", 500);
    }

    const staffMember = normalizeStaffInput({ ...payload, id: staffId });
    insertStaffMember(db, staffMember);
    restoreJobAssignments(db, staffId, parseJson(row.assigned_job_ids_json, []));
    restoreMaintenanceTechnicianLinks(db, staffId, parseJson(row.maintenance_plan_ids_json, []));
    db.prepare("DELETE FROM deleted_staff_members WHERE id = ?").run(row.id);
    touchWorkspaceInfo(db, staffMember.updatedAt);
    runForeignKeyCheck(db);
    return getStaffMemberState(db, staffMember.id);
  })();
}
