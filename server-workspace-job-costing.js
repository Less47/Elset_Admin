import crypto from "crypto";
import { invoiceFinancialsFromRows } from "./server-workspace-documents.js";
import { requireWorkspaceAddon } from "./server-workspace-addons.js";
import { COST_CATEGORIES, costTotalCents, formatCostQuantity, parseQuantityMicros, summarizeJobCosting } from "./src/lib/job-costing.js";
import { invoiceDate } from "./src/lib/invoice-account.js";

export class WorkspaceJobCostingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceJobCostingError";
    this.statusCode = statusCode;
  }
}

const allowedFields = new Set(["category", "description", "quantity", "unitCostCents", "supplier", "costDate", "notes"]);
const categoryKeys = new Set(COST_CATEGORIES.map((category) => category.key));

function jobIdForRequest(db, jobId) {
  if (typeof jobId !== "string" || !jobId.trim() || jobId.length > 180) throw new WorkspaceJobCostingError("Job ID is invalid.");
  if (!db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId)) throw new WorkspaceJobCostingError("Job not found.", 404);
  return jobId;
}

function entryFromRow(row) {
  return {
    id: row.id, jobId: row.job_id, category: row.category, description: row.description,
    quantity: formatCostQuantity(row.quantity_micros), quantityMicros: row.quantity_micros,
    unitCostCents: row.unit_cost_cents, totalCostCents: row.total_cost_cents,
    supplier: row.supplier, costDate: row.cost_date, notes: row.notes,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function readSummary(db, jobId) {
  const invoices = db.prepare("SELECT * FROM invoices WHERE job_id = ? AND type = 'invoice' ORDER BY id").all(jobId).map((row) => ({
    invoiceId: row.id, jobId: row.job_id, metadata: JSON.parse(row.extra_json || "{}"),
    sentCount: db.prepare("SELECT COUNT(*) AS count FROM document_send_history WHERE invoice_id = ? AND document_kind = 'invoice'").get(row.id).count,
    ...invoiceFinancialsFromRows(
      db.prepare("SELECT quantity_micros, rate_cents FROM invoice_line_items WHERE invoice_id = ? ORDER BY position").all(row.id),
      db.prepare("SELECT amount_cents FROM payments WHERE invoice_id = ?").all(row.id),
    ),
  }));
  const quotes = db.prepare("SELECT id, job_id FROM quotes WHERE job_id = ? AND type = 'quote' ORDER BY id").all(jobId).map((row) => ({
    quoteId: row.id, jobId: row.job_id,
    subtotalCents: invoiceFinancialsFromRows(db.prepare("SELECT quantity_micros, rate_cents FROM quote_line_items WHERE quote_id = ? ORDER BY position").all(row.id), []).subtotalCents,
  }));
  const entries = db.prepare("SELECT * FROM job_cost_entries WHERE job_id = ? ORDER BY cost_date DESC, created_at DESC, id").all(jobId).map(entryFromRow);
  return summarizeJobCosting({ jobId, invoices, quotes, entries });
}

export function getJobCostingSummary(db, jobId) {
  return db.transaction(() => {
    requireWorkspaceAddon(db, "jobCosting");
    return readSummary(db, jobIdForRequest(db, jobId));
  })();
}

function normalizeText(value, label, maxLength, { required = false } = {}) {
  if (typeof value !== "string") throw new WorkspaceJobCostingError(`${label} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > maxLength || result.includes("\0")) throw new WorkspaceJobCostingError(`${label} is invalid${maxLength ? ` (maximum ${maxLength} characters)` : ""}.`);
  return result;
}

function normalizeEntry(input, existing = null) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length) throw new WorkspaceJobCostingError("Cost entry must be a non-empty object.");
  if (Object.keys(input).some((key) => !allowedFields.has(key))) throw new WorkspaceJobCostingError("Cost entry contains unsupported fields.");
  const entry = { category: "", description: "", quantity: "1", unitCostCents: 0, supplier: "", costDate: "", notes: "", ...existing, ...input };
  if (!categoryKeys.has(entry.category)) throw new WorkspaceJobCostingError("Cost category is invalid.");
  entry.description = normalizeText(entry.description, "Description", 500, { required: true });
  entry.supplier = normalizeText(entry.supplier, "Supplier", 200);
  entry.notes = normalizeText(entry.notes, "Notes", 4000);
  if (typeof entry.costDate !== "string" || (entry.costDate && !invoiceDate(entry.costDate))) throw new WorkspaceJobCostingError("Cost date is invalid.");
  if (!Number.isSafeInteger(entry.unitCostCents) || entry.unitCostCents < 0) throw new WorkspaceJobCostingError("Unit cost must be non-negative integer cents.");
  try {
    entry.quantityMicros = parseQuantityMicros(entry.quantity);
    entry.totalCostCents = costTotalCents(entry.quantity, entry.unitCostCents);
  } catch (error) { throw new WorkspaceJobCostingError(error.message); }
  return entry;
}

function touchWorkspace(db, updatedAt) {
  db.prepare("UPDATE workspace_info SET updated_at = ? WHERE id = 1").run(updatedAt);
}

export function createJobCostEntry(db, jobId, input, { userId = "" } = {}) {
  return db.transaction(() => {
    requireWorkspaceAddon(db, "jobCosting");
    jobIdForRequest(db, jobId);
    const entry = normalizeEntry(input);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO job_cost_entries
      (id, job_id, category, description, quantity_micros, unit_cost_cents, total_cost_cents, supplier, cost_date, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), jobId, entry.category, entry.description, entry.quantityMicros, entry.unitCostCents, entry.totalCostCents,
        entry.supplier, entry.costDate, entry.notes, String(userId || ""), now, now);
    touchWorkspace(db, now);
    return readSummary(db, jobId);
  })();
}

function getEntry(db, jobId, costId) {
  if (typeof costId !== "string" || !costId || costId.length > 180) throw new WorkspaceJobCostingError("Cost entry ID is invalid.");
  const row = db.prepare("SELECT * FROM job_cost_entries WHERE id = ? AND job_id = ?").get(costId, jobId);
  if (!row) throw new WorkspaceJobCostingError("Cost entry not found for this job.", 404);
  return entryFromRow(row);
}

export function updateJobCostEntry(db, jobId, costId, input) {
  return db.transaction(() => {
    requireWorkspaceAddon(db, "jobCosting");
    jobIdForRequest(db, jobId);
    const entry = normalizeEntry(input, getEntry(db, jobId, costId));
    const now = new Date().toISOString();
    db.prepare(`UPDATE job_cost_entries SET category = ?, description = ?, quantity_micros = ?, unit_cost_cents = ?,
      total_cost_cents = ?, supplier = ?, cost_date = ?, notes = ?, updated_at = ? WHERE id = ? AND job_id = ?`)
      .run(entry.category, entry.description, entry.quantityMicros, entry.unitCostCents, entry.totalCostCents,
        entry.supplier, entry.costDate, entry.notes, now, costId, jobId);
    touchWorkspace(db, now);
    return readSummary(db, jobId);
  })();
}

export function deleteJobCostEntry(db, jobId, costId) {
  return db.transaction(() => {
    requireWorkspaceAddon(db, "jobCosting");
    jobIdForRequest(db, jobId);
    getEntry(db, jobId, costId);
    db.prepare("DELETE FROM job_cost_entries WHERE id = ? AND job_id = ?").run(costId, jobId);
    touchWorkspace(db, new Date().toISOString());
    return readSummary(db, jobId);
  })();
}

// Keep costs with the existing deleted-job archive without exposing them in
// ordinary Job payloads or making archive/restore depend on add-on availability.
export function archiveJobCostEntries(db, jobId) {
  const entries = snapshotJobCostEntries(db, jobId);
  if (!entries.length) return;
  const archive = db.prepare("SELECT extra_json FROM deleted_records WHERE kind = 'job' AND record_id = ?").get(jobId);
  if (!archive) throw new WorkspaceJobCostingError("Job archive is missing.", 409);
  const extra = JSON.parse(archive.extra_json || "{}");
  db.prepare("UPDATE deleted_records SET extra_json = ? WHERE kind = 'job' AND record_id = ?")
    .run(JSON.stringify({ ...extra, jobCostEntries: entries }), jobId);
}

export function restoreJobCostEntries(db, jobId) {
  const archive = db.prepare("SELECT extra_json FROM deleted_records WHERE kind = 'job' AND record_id = ?").get(jobId);
  const entries = JSON.parse(archive?.extra_json || "{}").jobCostEntries || [];
  restoreJobCostSnapshot(db, jobId, entries);
}

export function snapshotJobCostEntries(db, jobId) {
  return db.prepare("SELECT * FROM job_cost_entries WHERE job_id = ? ORDER BY id").all(jobId);
}

export function restoreJobCostSnapshot(db, jobId, entries) {
  const insert = db.prepare(`INSERT INTO job_cost_entries
    (id, job_id, category, description, quantity_micros, unit_cost_cents, total_cost_cents, supplier, cost_date, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of entries) {
    if (row.job_id !== jobId) throw new WorkspaceJobCostingError("Archived costs belong to a different job.", 409);
    insert.run(row.id, jobId, row.category, row.description, row.quantity_micros, row.unit_cost_cents,
      row.total_cost_cents, row.supplier, row.cost_date, row.notes, row.created_by, row.created_at, row.updated_at);
  }
}
