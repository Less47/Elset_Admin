import express from "express";
import { openWorkspaceDb, getWorkspaceDbPath } from "./server-workspace-db.js";
import { invoiceFinancialsFromRows } from "./server-workspace-documents.js";
import { getWorkspaceAddons } from "./server-workspace-addons.js";
import { isCustomerAccountInvoice, invoiceToday } from "./src/lib/invoice-account.js";
import { summarizeJobCosting } from "./src/lib/job-costing.js";
import { buildDocumentReference } from "./src/lib/quote-template.js";

function group(rows, key) {
  const map = new Map();
  for (const row of rows) { if (!map.has(row[key])) map.set(row[key], []); map.get(row[key]).push(row); }
  return map;
}

// One read transaction, a fixed number of queries, no documents/photos/workspace
// projection, no integrations and no writes. Monetary arithmetic stays canonical.
export function readReportingFinancials(db) {
  return db.transaction(() => {
    const items = group(db.prepare("SELECT invoice_id, quantity_micros, rate_cents FROM invoice_line_items ORDER BY invoice_id, position").all(), "invoice_id");
    const payments = group(db.prepare("SELECT id, invoice_id, amount_cents, date, method, reference FROM payments ORDER BY date, id").all(), "invoice_id");
    const sent = new Map(db.prepare("SELECT invoice_id, COUNT(*) AS count FROM document_send_history WHERE document_kind = 'invoice' GROUP BY invoice_id").all().map(row => [row.invoice_id, row.count]));
    const raw = db.prepare("SELECT i.id, i.job_id, i.issue_date, i.due_date, i.extra_json, j.customer_id, j.job_number FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE i.type = 'invoice'").all().map(row => {
      const lines = items.get(row.id) || [], paid = payments.get(row.id) || [];
      return { invoiceId: row.id, jobId: row.job_id, customerId: row.customer_id,
        invoiceNumber: buildDocumentReference({ id: row.job_id, jobNumber: row.job_number }, "invoice"),
        issueDate: row.issue_date, dueDate: row.due_date, metadata: JSON.parse(row.extra_json || "{}"),
        valid: lines.length > 0 && lines.every(line => Number.isSafeInteger(line.quantity_micros) && line.quantity_micros > 0 && Number.isSafeInteger(line.rate_cents) && line.rate_cents >= 0),
        sentCount: sent.get(row.id) || 0, paymentCount: paid.length, ...invoiceFinancialsFromRows(lines, paid) };
    });
    const invoices = raw.filter(isCustomerAccountInvoice).map(record => { const row = { ...record }; delete row.metadata; return row; });
    const receipts = invoices.flatMap(invoice => (payments.get(invoice.invoiceId) || []).map(row => ({
      id: row.id, invoiceId: invoice.invoiceId, jobId: invoice.jobId, customerId: invoice.customerId,
      invoiceNumber: invoice.invoiceNumber, date: row.date, amountCents: row.amount_cents, method: row.method, reference: row.reference,
    })));
    const costingEnabled = getWorkspaceAddons(db).jobCosting;
    const costing = [];
    if (costingEnabled) {
      const entries = group(db.prepare("SELECT c.id, c.job_id AS jobId, c.category, c.description, c.cost_date AS costDate, c.total_cost_cents AS totalCostCents FROM job_cost_entries c JOIN jobs j ON j.id = c.job_id ORDER BY c.cost_date, c.id").all(), "jobId");
      const byJob = group(raw, "jobId");
      // Invoice-only jobs already have their cents in the financial projection.
      // Send costing details only where real cost entries exist.
      for (const jobId of entries.keys()) {
        const summary = summarizeJobCosting({ jobId, invoices: byJob.get(jobId) || [], entries: entries.get(jobId) });
        costing.push({ jobId, revenueCents: summary.revenueCents, totalCostCents: summary.totalCostCents,
          grossProfitCents: summary.grossProfitCents, marginPercent: summary.marginPercent,
          categories: summary.categories.filter(category => category.totalCostCents > 0), entries: summary.entries });
      }
    }
    // The legacy client workspace normalizer clears assignment fields. Reports
    // read their stored values directly without changing that editing workflow.
    const jobAssignments = db.prepare("SELECT id AS jobId, assigned_technician_id AS assignedTechnicianId, assigned_technician_name AS assignedTechnicianName FROM jobs").all();
    return { asOfDate: invoiceToday(), invoices, payments: receipts, costingEnabled, costing, jobAssignments };
  })();
}

export function createReportingRouter({ requireAuth, requireRole, env = process.env } = {}) {
  const router = express.Router();
  router.get("/api/reports/financials", requireAuth, requireRole(["admin", "office"]), (_req, res) => {
    let db;
    res.setHeader("Cache-Control", "no-store");
    try {
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), readonly: true, migrate: false, fileMustExist: true });
      res.json({ ok: true, result: readReportingFinancials(db) });
    } catch { res.status(500).json({ error: "Unable to load reporting data. Try refreshing reports." }); }
    finally { db?.close(); }
  });
  return router;
}
