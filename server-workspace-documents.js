import crypto from "crypto";
import {
  decimalToScaledInteger,
  gstCentsFromSubtotal,
  lineTotalCentsFromScaled,
  moneyToCents,
} from "./server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const QUANTITY_SCALE = 1_000_000;

export class WorkspaceDocumentError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceDocumentError";
    this.statusCode = statusCode;
  }
}

const documentKnownKeys = new Set([
  "id",
  "type",
  "issueDate",
  "dueDate",
  "notes",
  "paymentNotes",
  "items",
  "payments",
  "sentHistory",
  "createdAt",
  "updatedAt",
  "subtotal",
  "gst",
  "total",
  "paid",
  "paidAmount",
  "balance",
  "balanceDue",
  "status",
  "paymentStatus",
  "paidAt",
]);
const lineItemKnownKeys = new Set(["id", "description", "qty", "quantity", "rate", "unitPrice", "total"]);
const paymentKnownKeys = new Set(["id", "amount", "date", "paidAt", "method", "reference", "notes", "createdAt"]);
const historyKnownKeys = new Set([
  "id",
  "sentAt",
  "createdAt",
  "fromEmail",
  "toEmail",
  "toName",
  "messageId",
  "stampText",
  "emailPurpose",
  "jobSnapshot",
  "documentSnapshot",
  "templateSnapshot",
]);

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

function nullableJson(value) {
  return value === null || value === undefined ? null : json(value);
}

function assertPlainObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceDocumentError(`${label} must be an object.`);
  }
}

function normalizeId(value, label = "ID") {
  const id = trimText(value);
  if (!id) throw new WorkspaceDocumentError(`${label} is required.`);
  if (id.length > 180) throw new WorkspaceDocumentError(`${label} is too long.`);
  return id;
}

function normalizeOptionalId(value, label = "ID") {
  const id = trimText(value);
  if (!id) return "";
  if (id.length > 180) throw new WorkspaceDocumentError(`${label} is too long.`);
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

function normalizeDateInput(value, label, { defaultValue = "", allowEmpty = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (!allowEmpty && !defaultValue) throw new WorkspaceDocumentError(`${label} is required.`);
    return defaultValue;
  }
  const normalized = toDateInputValue(value);
  if (!normalized) throw new WorkspaceDocumentError(`${label} is invalid.`);
  return normalized;
}

function addDaysToDateInput(value, days) {
  const normalized = toDateInputValue(value) || toDateInputValue(new Date());
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function isDecimalInput(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return /^-?\d+(?:\.\d+)?$/.test(trimText(value));
}

function normalizeDecimalText(value, label) {
  if (!isDecimalInput(value)) throw new WorkspaceDocumentError(`${label} must be a valid number.`);
  return typeof value === "number" ? String(value) : trimText(value);
}

function quantityToMicros(value, label) {
  const normalized = normalizeDecimalText(value, label);
  let micros = 0;
  try {
    micros = decimalToScaledInteger(normalized, QUANTITY_SCALE);
  } catch (error) {
    throw new WorkspaceDocumentError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
  if (micros <= 0) throw new WorkspaceDocumentError(`${label} must be greater than zero.`);
  return micros;
}

function moneyToSafeCents(value, label, { positive = false } = {}) {
  const normalized = normalizeDecimalText(value, label);
  let cents = 0;
  try {
    cents = moneyToCents(normalized);
  } catch (error) {
    throw new WorkspaceDocumentError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
  if (positive && cents <= 0) throw new WorkspaceDocumentError(`${label} must be greater than zero.`);
  if (!positive && cents < 0) throw new WorkspaceDocumentError(`${label} cannot be negative.`);
  return cents;
}

function centsToMoney(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function normalizeLineItems(items, parentId, label = "Line items") {
  if (!Array.isArray(items) || items.length === 0) {
    throw new WorkspaceDocumentError(`${label} are required.`);
  }
  if (items.length > 300) throw new WorkspaceDocumentError(`${label} contains too many items.`);

  return items.map((item, index) => {
    assertPlainObject(item, "Line item");
    const quantitySource = item.qty ?? item.quantity ?? 0;
    const rateSource = item.rate ?? item.unitPrice ?? 0;
    const qtyText = normalizeDecimalText(quantitySource, "Line item quantity");
    return {
      id: normalizeOptionalId(item.id, "Line item ID") || `${parentId}:line:${index + 1}`,
      position: index + 1,
      description: trimText(item.description),
      qtyText,
      quantityMicros: quantityToMicros(quantitySource, "Line item quantity"),
      rateCents: moneyToSafeCents(rateSource, "Line item rate"),
      extra: pickExtra(item, lineItemKnownKeys),
    };
  });
}

function normalizePayment(input, invoiceId, { existing = null, requireId = true } = {}) {
  assertPlainObject(input, "Payment");
  const id = normalizeOptionalId(input.id ?? existing?.id, "Payment ID") || (requireId ? "" : crypto.randomUUID());
  if (!id) throw new WorkspaceDocumentError("Payment ID is required.");
  const amountSource = Object.prototype.hasOwnProperty.call(input, "amount")
    ? input.amount
    : centsToMoney(existing?.amount_cents || 0);
  const dateSource = Object.prototype.hasOwnProperty.call(input, "date")
    ? input.date
    : input.paidAt ?? existing?.date ?? nowIso();
  const createdAt = trimText(input.createdAt ?? existing?.created_at) || nowIso();

  return {
    id,
    invoiceId,
    amountCents: moneyToSafeCents(amountSource, "Payment amount", { positive: true }),
    date: normalizeDateInput(dateSource, "Payment date", { defaultValue: toDateInputValue(new Date()) }),
    method: trimText(input.method ?? existing?.method),
    reference: trimText(input.reference ?? existing?.reference),
    notes: trimText(input.notes ?? existing?.notes),
    createdAt,
    extra: pickExtra(input, paymentKnownKeys),
  };
}

function documentSubtotalFromRows(rows) {
  return rows.reduce((sum, row) => sum + lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents), 0);
}

function getQuoteRows(db, quoteId) {
  return db.prepare("SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY position").all(quoteId);
}

function getInvoiceRows(db, invoiceId) {
  return db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY position").all(invoiceId);
}

function getPaymentRows(db, invoiceId) {
  return db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY date, created_at").all(invoiceId);
}

function paymentTotalCents(rows) {
  return rows.reduce((sum, row) => sum + Math.max(Number(row.amount_cents || 0), 0), 0);
}

function getQuoteFinancials(db, quoteId) {
  const subtotalCents = documentSubtotalFromRows(getQuoteRows(db, quoteId));
  const gstCents = gstCentsFromSubtotal(subtotalCents);
  return {
    subtotalCents,
    gstCents,
    totalCents: subtotalCents + gstCents,
  };
}

function getInvoiceFinancials(db, invoiceId) {
  const subtotalCents = documentSubtotalFromRows(getInvoiceRows(db, invoiceId));
  const gstCents = gstCentsFromSubtotal(subtotalCents);
  const totalCents = subtotalCents + gstCents;
  const paidCents = paymentTotalCents(getPaymentRows(db, invoiceId));
  return {
    subtotalCents,
    gstCents,
    totalCents,
    paidCents,
    balanceCents: Math.max(totalCents - paidCents, 0),
    overpaidCents: Math.max(paidCents - totalCents, 0),
  };
}

function moneySummary(financials) {
  return Object.fromEntries(
    Object.entries(financials).map(([key, value]) => [
      key.replace(/Cents$/, ""),
      centsToMoney(value),
    ])
  );
}

function getInvoiceStatusSummary(db, invoiceRow) {
  if (!invoiceRow) {
    return { id: "not-invoiced", label: "Not invoiced", rank: 0 };
  }
  const financials = getInvoiceFinancials(db, invoiceRow.id);
  if (financials.totalCents > 0 && financials.balanceCents <= 0) {
    return { id: "paid", label: "Paid", rank: 6 };
  }
  const today = toDateInputValue(new Date());
  if (financials.balanceCents > 0 && invoiceRow.due_date && invoiceRow.due_date < today) {
    return { id: "overdue", label: "Overdue", rank: 1 };
  }
  const paymentCount = getPaymentRows(db, invoiceRow.id).length;
  if (financials.paidCents > 0) {
    return paymentCount <= 1
      ? { id: "deposit-paid", label: "Deposit Paid", rank: 4 }
      : { id: "partially-paid", label: "Partially Paid", rank: 5 };
  }
  const sentCount = db.prepare(`
    SELECT COUNT(*) AS count
      FROM document_send_history
     WHERE document_kind = 'invoice'
       AND invoice_id = ?
  `).get(invoiceRow.id).count;
  if (sentCount > 0) {
    return { id: "unpaid", label: "Unpaid", rank: 3 };
  }
  return { id: "draft", label: "Draft", rank: 2 };
}

function ensureJobExists(db, jobId) {
  const row = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
  if (!row) throw new WorkspaceDocumentError("Job not found.", 404);
}

function getQuoteRowForJob(db, jobId) {
  return db.prepare("SELECT * FROM quotes WHERE job_id = ?").get(jobId) || null;
}

function getInvoiceRowForJob(db, jobId) {
  return db.prepare("SELECT * FROM invoices WHERE job_id = ?").get(jobId) || null;
}

function ensurePaymentBelongsToInvoice(db, invoiceId, paymentId) {
  const row = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!row || row.invoice_id !== invoiceId) {
    throw new WorkspaceDocumentError("Payment not found.", 404);
  }
  return row;
}

function ensureDocumentIdAvailable(db, table, id, jobId, label) {
  const row = db.prepare(`SELECT job_id FROM ${table} WHERE id = ?`).get(id);
  if (row && row.job_id !== jobId) {
    throw new WorkspaceDocumentError(`${label} ID is already used by another job.`, 409);
  }
}

function updateJobTouchedAt(db, jobId, updatedAt) {
  db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(updatedAt, jobId);
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, 1, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(updatedAt, updatedAt);
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new WorkspaceDocumentError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function getJobState(db, jobId) {
  return loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === jobId) || null;
}

function getQuoteResult(db, jobId, extra = {}) {
  const quoteRow = getQuoteRowForJob(db, jobId);
  const job = getJobState(db, jobId);
  if (!quoteRow || !job?.quote) return { jobId, quote: null, ...extra };
  const financials = getQuoteFinancials(db, quoteRow.id);
  return {
    jobId,
    quoteId: quoteRow.id,
    quote: job.quote,
    financials: moneySummary(financials),
    financialsCents: financials,
    ...extra,
  };
}

function getInvoiceResult(db, jobId, extra = {}) {
  const invoiceRow = getInvoiceRowForJob(db, jobId);
  const job = getJobState(db, jobId);
  if (!invoiceRow || !job?.invoice) return { jobId, invoice: null, ...extra };
  const financials = getInvoiceFinancials(db, invoiceRow.id);
  return {
    jobId,
    invoiceId: invoiceRow.id,
    invoice: job.invoice,
    financials: moneySummary(financials),
    financialsCents: financials,
    status: getInvoiceStatusSummary(db, invoiceRow),
    ...extra,
  };
}

function insertLineItems(db, table, parentColumn, parentId, lineItems) {
  const statement = db.prepare(`
    INSERT INTO ${table} (id, ${parentColumn}, position, description, qty_text, quantity_micros, rate_cents, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  lineItems.forEach((item) => {
    statement.run(
      item.id,
      parentId,
      item.position,
      item.description,
      item.qtyText,
      item.quantityMicros,
      item.rateCents,
      objectJson(item.extra)
    );
  });
}

function insertSendHistory(db, kind, documentId, jobId, sentHistory) {
  if (!Array.isArray(sentHistory) || sentHistory.length === 0) return;
  const statement = db.prepare(`
    INSERT INTO document_send_history (
      id, source_id, document_kind, quote_id, invoice_id, job_id, sent_at, from_email, to_email, to_name,
      message_id, stamp_text, email_purpose, job_snapshot_json, document_snapshot_json, template_snapshot_json, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  sentHistory.forEach((entry, index) => {
    assertPlainObject(entry, "Sent document history");
    const sourceId = trimText(entry.id);
    const stableId = `${kind}:${documentId}:sent:${sourceId || index + 1}`;
    statement.run(
      stableId,
      sourceId,
      kind,
      kind === "quote" ? documentId : null,
      kind === "invoice" ? documentId : null,
      jobId,
      trimText(entry.sentAt || entry.createdAt || nowIso()),
      trimText(entry.fromEmail),
      trimText(entry.toEmail),
      trimText(entry.toName),
      trimText(entry.messageId),
      trimText(entry.stampText),
      trimText(entry.emailPurpose),
      nullableJson(entry.jobSnapshot),
      nullableJson(entry.documentSnapshot),
      nullableJson(entry.templateSnapshot),
      objectJson(pickExtra(entry, historyKnownKeys))
    );
  });
}

function writeQuoteTree(db, jobId, input, { existingRow = null, includeSentHistory = false } = {}) {
  assertPlainObject(input, "Quote");
  const quoteId = existingRow?.id || normalizeOptionalId(input.id, "Quote ID") || `${jobId}:quote`;
  ensureDocumentIdAvailable(db, "quotes", quoteId, jobId, "Quote");
  const now = nowIso();
  const issueDate = normalizeDateInput(input.issueDate, "Quote issue date", {
    defaultValue: toDateInputValue(new Date()),
  });
  const lineItems = normalizeLineItems(input.items, quoteId, "Quote line items");

  db.prepare(`
    INSERT INTO quotes (id, job_id, type, issue_date, notes, created_at, updated_at, extra_json)
    VALUES (?, ?, 'quote', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      job_id = excluded.job_id,
      type = excluded.type,
      issue_date = excluded.issue_date,
      notes = excluded.notes,
      updated_at = excluded.updated_at,
      extra_json = excluded.extra_json
  `).run(
    quoteId,
    jobId,
    issueDate,
    trimText(input.notes),
    existingRow?.created_at || trimText(input.createdAt) || now,
    now,
    objectJson(pickExtra(input, documentKnownKeys))
  );
  db.prepare("DELETE FROM quote_line_items WHERE quote_id = ?").run(quoteId);
  insertLineItems(db, "quote_line_items", "quote_id", quoteId, lineItems);

  if (includeSentHistory) {
    db.prepare("DELETE FROM document_send_history WHERE document_kind = 'quote' AND quote_id = ?").run(quoteId);
    insertSendHistory(db, "quote", quoteId, jobId, input.sentHistory || []);
  }

  return quoteId;
}

function writeInvoiceTree(
  db,
  jobId,
  input,
  { existingRow = null, includePayments = false, includeSentHistory = false } = {}
) {
  assertPlainObject(input, "Invoice");
  const invoiceId = existingRow?.id || normalizeOptionalId(input.id, "Invoice ID") || `${jobId}:invoice`;
  ensureDocumentIdAvailable(db, "invoices", invoiceId, jobId, "Invoice");
  const now = nowIso();
  const issueDate = normalizeDateInput(input.issueDate, "Invoice issue date", {
    defaultValue: toDateInputValue(new Date()),
  });
  const dueDate = normalizeDateInput(input.dueDate, "Invoice due date", {
    defaultValue: addDaysToDateInput(issueDate, 7),
  });
  const lineItems = normalizeLineItems(input.items, invoiceId, "Invoice line items");

  db.prepare(`
    INSERT INTO invoices (id, job_id, type, issue_date, due_date, notes, payment_notes, created_at, updated_at, extra_json)
    VALUES (?, ?, 'invoice', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      job_id = excluded.job_id,
      type = excluded.type,
      issue_date = excluded.issue_date,
      due_date = excluded.due_date,
      notes = excluded.notes,
      payment_notes = excluded.payment_notes,
      updated_at = excluded.updated_at,
      extra_json = excluded.extra_json
  `).run(
    invoiceId,
    jobId,
    issueDate,
    dueDate,
    trimText(input.notes),
    trimText(input.paymentNotes),
    existingRow?.created_at || trimText(input.createdAt) || now,
    now,
    objectJson(pickExtra(input, documentKnownKeys))
  );
  db.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ?").run(invoiceId);
  insertLineItems(db, "invoice_line_items", "invoice_id", invoiceId, lineItems);

  if (includePayments) {
    db.prepare("DELETE FROM payments WHERE invoice_id = ?").run(invoiceId);
    const paymentStatement = db.prepare(`
      INSERT INTO payments (id, invoice_id, amount_cents, date, method, reference, notes, created_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (Array.isArray(input.payments) ? input.payments : []).forEach((paymentInput) => {
      const payment = normalizePayment(paymentInput, invoiceId, { requireId: false });
      paymentStatement.run(
        payment.id,
        invoiceId,
        payment.amountCents,
        payment.date,
        payment.method,
        payment.reference,
        payment.notes,
        payment.createdAt,
        objectJson(payment.extra)
      );
    });
  }

  if (includeSentHistory) {
    db.prepare("DELETE FROM document_send_history WHERE document_kind = 'invoice' AND invoice_id = ?").run(invoiceId);
    insertSendHistory(db, "invoice", invoiceId, jobId, input.sentHistory || []);
  }

  return invoiceId;
}

export function insertQuoteTree(db, jobIdInput, input) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  return writeQuoteTree(db, jobId, input, { includeSentHistory: true });
}

export function insertInvoiceTree(db, jobIdInput, input) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  return writeInvoiceTree(db, jobId, input, { includePayments: true, includeSentHistory: true });
}

export function replaceQuoteForJob(db, jobIdInput, input) {
  assertPlainObject(input, "Quote");
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const existingRow = getQuoteRowForJob(db, jobId);
    const quoteId = writeQuoteTree(db, jobId, input, { existingRow });
    const updatedAt = nowIso();
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getQuoteResult(db, jobId, { quoteId });
  })();
}

export function deleteQuoteForJob(db, jobIdInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const quoteRow = getQuoteRowForJob(db, jobId);
    if (!quoteRow) throw new WorkspaceDocumentError("Quote not found.", 404);
    db.prepare("DELETE FROM quotes WHERE id = ?").run(quoteRow.id);
    const updatedAt = nowIso();
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return { jobId, quoteId: quoteRow.id };
  })();
}

export function replaceInvoiceForJob(db, jobIdInput, input) {
  assertPlainObject(input, "Invoice");
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const existingRow = getInvoiceRowForJob(db, jobId);
    const invoiceId = writeInvoiceTree(db, jobId, input, { existingRow });
    const updatedAt = nowIso();
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getInvoiceResult(db, jobId, { invoiceId });
  })();
}

export function updateInvoiceForJob(db, jobIdInput, input) {
  assertPlainObject(input, "Invoice update");
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const invoiceRow = getInvoiceRowForJob(db, jobId);
    if (!invoiceRow) throw new WorkspaceDocumentError("Invoice not found.", 404);
    const assignments = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(input, "issueDate")) {
      assignments.push("issue_date = ?");
      values.push(normalizeDateInput(input.issueDate, "Invoice issue date"));
    }
    if (Object.prototype.hasOwnProperty.call(input, "dueDate")) {
      assignments.push("due_date = ?");
      values.push(normalizeDateInput(input.dueDate, "Invoice due date"));
    }
    if (Object.prototype.hasOwnProperty.call(input, "notes")) {
      assignments.push("notes = ?");
      values.push(trimText(input.notes));
    }
    if (Object.prototype.hasOwnProperty.call(input, "paymentNotes")) {
      assignments.push("payment_notes = ?");
      values.push(trimText(input.paymentNotes));
    }

    const updatedAt = nowIso();
    if (assignments.length > 0) {
      assignments.push("updated_at = ?");
      values.push(updatedAt, invoiceRow.id);
      db.prepare(`UPDATE invoices SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
    }
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getInvoiceResult(db, jobId);
  })();
}

export function deleteInvoiceForJob(db, jobIdInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const invoiceRow = getInvoiceRowForJob(db, jobId);
    if (!invoiceRow) throw new WorkspaceDocumentError("Invoice not found.", 404);
    db.prepare("DELETE FROM invoices WHERE id = ?").run(invoiceRow.id);
    const updatedAt = nowIso();
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return { jobId, invoiceId: invoiceRow.id };
  })();
}

export function addInvoicePayment(db, jobIdInput, input) {
  assertPlainObject(input, "Payment");
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const invoiceRow = getInvoiceRowForJob(db, jobId);
    if (!invoiceRow) throw new WorkspaceDocumentError("Invoice not found.", 404);
    const paymentId = normalizeId(input.id, "Payment ID");
    const existingPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
    if (existingPayment) {
      if (existingPayment.invoice_id !== invoiceRow.id) {
        throw new WorkspaceDocumentError("Payment ID is already used by another invoice.", 409);
      }
      const result = getInvoiceResult(db, jobId, {
        paymentId,
        duplicate: true,
      });
      return {
        ...result,
        payment: result.invoice?.payments?.find((payment) => payment.id === paymentId) || null,
      };
    }

    const payment = normalizePayment(input, invoiceRow.id, { requireId: true });
    db.prepare(`
      INSERT INTO payments (id, invoice_id, amount_cents, date, method, reference, notes, created_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.id,
      invoiceRow.id,
      payment.amountCents,
      payment.date,
      payment.method,
      payment.reference,
      payment.notes,
      payment.createdAt,
      objectJson(payment.extra)
    );
    const updatedAt = nowIso();
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getInvoiceResult(db, jobId, { paymentId: payment.id });
  })();
}

export function updateInvoicePayment(db, jobIdInput, paymentIdInput, input) {
  assertPlainObject(input, "Payment");
  const jobId = normalizeId(jobIdInput, "Job ID");
  const paymentId = normalizeId(paymentIdInput, "Payment ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const invoiceRow = getInvoiceRowForJob(db, jobId);
    if (!invoiceRow) throw new WorkspaceDocumentError("Invoice not found.", 404);
    const existing = ensurePaymentBelongsToInvoice(db, invoiceRow.id, paymentId);
    const payment = normalizePayment({ ...input, id: paymentId }, invoiceRow.id, { existing, requireId: true });
    db.prepare(`
      UPDATE payments
         SET amount_cents = ?,
             date = ?,
             method = ?,
             reference = ?,
             notes = ?,
             extra_json = ?
       WHERE id = ?
         AND invoice_id = ?
    `).run(
      payment.amountCents,
      payment.date,
      payment.method,
      payment.reference,
      payment.notes,
      objectJson(payment.extra),
      payment.id,
      invoiceRow.id
    );
    const updatedAt = nowIso();
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getInvoiceResult(db, jobId, { paymentId });
  })();
}

export function deleteInvoicePayment(db, jobIdInput, paymentIdInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  const paymentId = normalizeId(paymentIdInput, "Payment ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const invoiceRow = getInvoiceRowForJob(db, jobId);
    if (!invoiceRow) throw new WorkspaceDocumentError("Invoice not found.", 404);
    const result = db.prepare("DELETE FROM payments WHERE invoice_id = ? AND id = ?").run(invoiceRow.id, paymentId);
    if (result.changes === 0) throw new WorkspaceDocumentError("Payment not found.", 404);
    const updatedAt = nowIso();
    updateJobTouchedAt(db, jobId, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getInvoiceResult(db, jobId, { paymentId });
  })();
}
