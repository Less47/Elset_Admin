import crypto from "crypto";
import { normalizeStoredData } from "./server-store.js";
import {
  WORKSPACE_SCHEMA_VERSION,
  migrateWorkspaceSchema,
} from "./server-workspace-db.js";

export const WORKSPACE_IMPORTER_VERSION = "workspace-json-importer-v1";
const QUANTITY_SCALE = 1_000_000;

function nowIso() {
  return new Date().toISOString();
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

function text(value) {
  return String(value ?? "");
}

function nullableText(value) {
  const normalized = text(value).trim();
  return normalized || null;
}

function pickExtra(record, knownKeys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const extra = {};
  for (const [key, value] of Object.entries(record)) {
    if (!knownKeys.has(key)) {
      extra[key] = value;
    }
  }
  return extra;
}

function decimalParts(value) {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!match) return { sign: 1n, whole: "0", fraction: "" };
  return {
    sign: match[1] ? -1n : 1n,
    whole: match[2] || "0",
    fraction: match[3] || "",
  };
}

export function decimalToScaledInteger(value, scale) {
  const { sign, whole, fraction } = decimalParts(value);
  const scaleBigInt = BigInt(scale);
  const scaleDigits = String(scale).length - 1;
  const wholeUnits = BigInt(whole || "0") * scaleBigInt;
  const normalizedFraction = fraction.padEnd(scaleDigits + 1, "0");
  const kept = normalizedFraction.slice(0, scaleDigits) || "0";
  const nextDigit = Number(normalizedFraction[scaleDigits] || "0");
  const roundedFraction = BigInt(kept) + (nextDigit >= 5 ? 1n : 0n);
  const result = sign * (wholeUnits + roundedFraction);
  const asNumber = Number(result);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`Decimal value is too large to store safely: ${value}`);
  }
  return asNumber;
}

export function moneyToCents(value) {
  return decimalToScaledInteger(value, 100);
}

export function lineTotalCentsFromScaled(quantityMicros, rateCents) {
  const numerator = BigInt(quantityMicros) * BigInt(rateCents);
  const half = BigInt(Math.floor(QUANTITY_SCALE / 2));
  const rounded = numerator >= 0n
    ? (numerator + half) / BigInt(QUANTITY_SCALE)
    : (numerator - half) / BigInt(QUANTITY_SCALE);
  const asNumber = Number(rounded);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Line item total is too large to store safely.");
  }
  return asNumber;
}

export function documentSubtotalCents(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const quantityMicros = decimalToScaledInteger(item?.qty ?? 0, QUANTITY_SCALE);
    const rateCents = moneyToCents(item?.rate ?? 0);
    return sum + lineTotalCentsFromScaled(quantityMicros, rateCents);
  }, 0);
}

export function gstCentsFromSubtotal(subtotalCents) {
  return Math.round(Number(subtotalCents || 0) / 10);
}

export function documentTotalCents(items = []) {
  const subtotalCents = documentSubtotalCents(items);
  return subtotalCents + gstCentsFromSubtotal(subtotalCents);
}

function paymentsTotalCents(payments = []) {
  return (Array.isArray(payments) ? payments : []).reduce((sum, payment) => (
    sum + Math.max(moneyToCents(payment?.amount ?? 0), 0)
  ), 0);
}

function getDocumentBalanceCents(invoice) {
  if (!invoice) return 0;
  return Math.max(documentTotalCents(invoice.items || []) - paymentsTotalCents(invoice.payments || []), 0);
}

function sourceCounts(data) {
  const customers = Array.isArray(data.customers) ? data.customers : [];
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const maintenancePlans = Array.isArray(data.maintenancePlans) ? data.maintenancePlans : [];

  return {
    staff: (data.staff || []).length,
    customers: customers.length,
    customerSites: customers.reduce((sum, customer) => sum + (customer.sites || []).length, 0),
    customerSiteAssets: customers.reduce(
      (sum, customer) => sum + (customer.sites || []).reduce((siteSum, site) => siteSum + (site.assets || []).length, 0),
      0
    ),
    customerAccessNotes: customers.reduce((sum, customer) => sum + (customer.siteAccessNotes || []).length, 0),
    jobs: jobs.length,
    jobNotes: jobs.reduce((sum, job) => sum + (job.notes || []).length, 0),
    jobAttachments: jobs.reduce((sum, job) => sum + (job.photos || []).length, 0),
    quotes: jobs.filter((job) => job.quote).length,
    quoteLineItems: jobs.reduce((sum, job) => sum + (job.quote?.items || []).length, 0),
    invoices: jobs.filter((job) => job.invoice).length,
    invoiceLineItems: jobs.reduce((sum, job) => sum + (job.invoice?.items || []).length, 0),
    payments: jobs.reduce((sum, job) => sum + (job.invoice?.payments || []).length, 0),
    quoteSentHistory: jobs.reduce((sum, job) => sum + (job.quote?.sentHistory || []).length, 0),
    invoiceSentHistory: jobs.reduce((sum, job) => sum + (job.invoice?.sentHistory || []).length, 0),
    inventoryItems: (data.inventoryItems || []).length,
    maintenancePlans: maintenancePlans.length,
    maintenanceChecklistItems: maintenancePlans.reduce((sum, plan) => sum + (plan.checklist || []).length, 0),
    deletedJobs: (data.deletedJobs || []).length,
    deletedCustomers: (data.deletedCustomers || []).length,
  };
}

function sourceFinancials(data) {
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return {
    quoteTotalsCents: jobs.reduce((sum, job) => sum + (job.quote ? documentTotalCents(job.quote.items || []) : 0), 0),
    invoiceTotalsCents: jobs.reduce((sum, job) => sum + (job.invoice ? documentTotalCents(job.invoice.items || []) : 0), 0),
    paymentTotalsCents: jobs.reduce((sum, job) => sum + paymentsTotalCents(job.invoice?.payments || []), 0),
    outstandingBalanceCents: jobs.reduce((sum, job) => sum + getDocumentBalanceCents(job.invoice), 0),
  };
}

export function summarizeWorkspaceData(data) {
  const normalized = normalizeStoredData(data);
  return {
    counts: sourceCounts(normalized),
    financials: sourceFinancials(normalized),
  };
}

function countTable(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function sumDocumentLines(db, tableName, foreignKeyName) {
  return db.prepare(`SELECT quantity_micros, rate_cents FROM ${tableName} ORDER BY ${foreignKeyName}, position`).all()
    .reduce((sum, row) => sum + lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents), 0);
}

function groupDocumentTotals(db, documentTable, lineTable, documentIdColumn) {
  const documents = db.prepare(`SELECT id FROM ${documentTable}`).all();
  const lineStatement = db.prepare(`SELECT quantity_micros, rate_cents FROM ${lineTable} WHERE ${documentIdColumn} = ?`);

  return documents.reduce((sum, document) => {
    const subtotal = lineStatement.all(document.id).reduce(
      (lineSum, row) => lineSum + lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents),
      0
    );
    return sum + subtotal + gstCentsFromSubtotal(subtotal);
  }, 0);
}

export function summarizeWorkspaceDb(db) {
  const invoiceTotalsById = new Map();
  const invoices = db.prepare("SELECT id FROM invoices").all();
  const invoiceLines = db.prepare("SELECT quantity_micros, rate_cents FROM invoice_line_items WHERE invoice_id = ?");
  const invoicePayments = db.prepare("SELECT amount_cents FROM payments WHERE invoice_id = ?");

  for (const invoice of invoices) {
    const subtotalCents = invoiceLines.all(invoice.id).reduce(
      (sum, row) => sum + lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents),
      0
    );
    const totalCents = subtotalCents + gstCentsFromSubtotal(subtotalCents);
    const paidCents = invoicePayments.all(invoice.id).reduce((sum, row) => sum + Math.max(Number(row.amount_cents || 0), 0), 0);
    invoiceTotalsById.set(invoice.id, {
      totalCents,
      paidCents,
      balanceCents: Math.max(totalCents - paidCents, 0),
    });
  }

  return {
    counts: {
      staff: countTable(db, "staff"),
      customers: countTable(db, "customers"),
      customerSites: countTable(db, "sites"),
      customerSiteAssets: countTable(db, "site_assets"),
      customerAccessNotes: countTable(db, "site_access_notes"),
      jobs: countTable(db, "jobs"),
      jobNotes: countTable(db, "job_notes"),
      jobAttachments: countTable(db, "job_attachments"),
      quotes: countTable(db, "quotes"),
      quoteLineItems: countTable(db, "quote_line_items"),
      invoices: countTable(db, "invoices"),
      invoiceLineItems: countTable(db, "invoice_line_items"),
      payments: countTable(db, "payments"),
      quoteSentHistory: db.prepare("SELECT COUNT(*) AS count FROM document_send_history WHERE document_kind = 'quote'").get().count,
      invoiceSentHistory: db.prepare("SELECT COUNT(*) AS count FROM document_send_history WHERE document_kind = 'invoice'").get().count,
      inventoryItems: countTable(db, "inventory_items"),
      maintenancePlans: countTable(db, "maintenance_plans"),
      maintenanceChecklistItems: countTable(db, "maintenance_checklist_items"),
      deletedJobs: db.prepare("SELECT COUNT(*) AS count FROM deleted_records WHERE kind = 'job'").get().count,
      deletedCustomers: db.prepare("SELECT COUNT(*) AS count FROM deleted_records WHERE kind = 'customer'").get().count,
    },
    financials: {
      quoteTotalsCents: groupDocumentTotals(db, "quotes", "quote_line_items", "quote_id"),
      invoiceTotalsCents: [...invoiceTotalsById.values()].reduce((sum, invoice) => sum + invoice.totalCents, 0),
      paymentTotalsCents: [...invoiceTotalsById.values()].reduce((sum, invoice) => sum + invoice.paidCents, 0),
      outstandingBalanceCents: [...invoiceTotalsById.values()].reduce((sum, invoice) => sum + invoice.balanceCents, 0),
      quoteSubtotalCents: sumDocumentLines(db, "quote_line_items", "quote_id"),
      invoiceSubtotalCents: sumDocumentLines(db, "invoice_line_items", "invoice_id"),
    },
  };
}

function compareSummaries(sourceSummary, dbSummary) {
  const errors = [];

  for (const [key, sourceValue] of Object.entries(sourceSummary.counts)) {
    const dbValue = dbSummary.counts[key];
    if (sourceValue !== dbValue) {
      errors.push(`Count mismatch for ${key}: source=${sourceValue}, sqlite=${dbValue}`);
    }
  }

  for (const [key, sourceValue] of Object.entries(sourceSummary.financials)) {
    const dbValue = dbSummary.financials[key];
    if (sourceValue !== dbValue) {
      errors.push(`Financial mismatch for ${key}: source=${sourceValue}, sqlite=${dbValue}`);
    }
  }

  return errors;
}

function getNonEmptyEntityTables(db) {
  const tableNames = [
    "staff",
    "customers",
    "sites",
    "site_assets",
    "jobs",
    "job_notes",
    "job_attachments",
    "quotes",
    "quote_line_items",
    "invoices",
    "invoice_line_items",
    "payments",
    "maintenance_plans",
    "inventory_items",
    "deleted_records",
  ];

  return tableNames
    .map((tableName) => ({ tableName, count: countTable(db, tableName) }))
    .filter((entry) => entry.count > 0);
}

function validateSourceRelationships(data) {
  const errors = [];
  const customerIds = new Set((data.customers || []).map((customer) => customer.id));
  const staffIds = new Set((data.staff || []).map((staffMember) => staffMember.id));
  const maintenancePlanIds = new Set((data.maintenancePlans || []).map((plan) => plan.id));

  for (const job of data.jobs || []) {
    if (!customerIds.has(job.customerId)) {
      errors.push(`Job ${job.id} references missing customer ${job.customerId || "(blank)"}.`);
    }
    if (job.assignedTechnicianId && !staffIds.has(job.assignedTechnicianId)) {
      errors.push(`Job ${job.id} references missing staff member ${job.assignedTechnicianId}.`);
    }
    if (job.maintenancePlanId && !maintenancePlanIds.has(job.maintenancePlanId)) {
      errors.push(`Job ${job.id} references missing maintenance plan ${job.maintenancePlanId}.`);
    }
  }

  for (const plan of data.maintenancePlans || []) {
    if (!customerIds.has(plan.customerId)) {
      errors.push(`Maintenance plan ${plan.id} references missing customer ${plan.customerId || "(blank)"}.`);
    }
    if (plan.defaultTechnicianId && !staffIds.has(plan.defaultTechnicianId)) {
      errors.push(`Maintenance plan ${plan.id} references missing staff member ${plan.defaultTechnicianId}.`);
    }
  }

  return errors;
}

function runForeignKeyCheck(db) {
  return db.prepare("PRAGMA foreign_key_check").all().map((row) => (
    `${row.table || "unknown table"} row ${row.rowid || "?"} references missing ${row.parent || "parent table"}`
  ));
}

function buildInsertStatements(db) {
  return {
    workspaceInfo: db.prepare(`
      INSERT INTO workspace_info (
        id, schema_version, created_at, updated_at, imported_at, source_json_sha256, importer_version, meta_json
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `),
    setting: db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
    `),
    template: db.prepare(`
      INSERT INTO document_templates (
        type, company_name, company_abn, company_acn, company_email, company_phone, company_address,
        bank_account_name, bank_bsb, bank_account_number, accent_color, quote_heading, intro_text,
        notes_heading, terms_heading, terms_text, footer_text, extra_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    staff: db.prepare(`
      INSERT INTO staff (id, name, role, email, phone, created_at, updated_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    customer: db.prepare(`
      INSERT INTO customers (
        id, name, email, phone, customer_type, address, created_at, updated_at, external_refs_json, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    customerContact: db.prepare(`
      INSERT INTO customer_contacts (id, customer_id, site_id, kind, name, phone, email, role, notes, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    site: db.prepare(`
      INSERT INTO sites (
        id, customer_id, label, address, site_type, access_notes, notes, contact_name, contact_phone,
        oc_number, created_at, updated_at, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    siteAsset: db.prepare(`
      INSERT INTO site_assets (id, site_id, name, type, location, model, notes, created_at, updated_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    siteAccessNote: db.prepare(`
      INSERT INTO site_access_notes (id, customer_id, address, notes, updated_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    maintenancePlan: db.prepare(`
      INSERT INTO maintenance_plans (
        id, customer_id, plan_name, site_address, frequency, next_due_date, default_technician_id,
        estimated_duration_hours, contract_price_cents, notes, last_generated_at, last_generated_job_id,
        last_completed_at, created_at, updated_at, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    maintenanceChecklistItem: db.prepare(`
      INSERT INTO maintenance_checklist_items (id, maintenance_plan_id, position, text, extra_json)
      VALUES (?, ?, ?, ?, ?)
    `),
    job: db.prepare(`
      INSERT INTO jobs (
        id, job_number, title, description, urgency, status, scheduled_date, assigned_technician_id,
        assigned_technician_name, customer_id, customer_name, customer_email, customer_phone, job_address,
        oc_number, requester_contact_json, onsite_contact_json, billing_contact_json, maintenance_plan_id,
        maintenance_plan_name, maintenance_due_date, service_board_tomorrow_date, service_board_tomorrow_order,
        created_at, updated_at, external_refs_json, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    jobNote: db.prepare(`
      INSERT INTO job_notes (id, job_id, author, text, created_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    jobAttachment: db.prepare(`
      INSERT INTO job_attachments (id, job_id, kind, name, url, path, mime_type, size_bytes, created_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    quote: db.prepare(`
      INSERT INTO quotes (id, job_id, type, issue_date, notes, created_at, updated_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    quoteLineItem: db.prepare(`
      INSERT INTO quote_line_items (id, quote_id, position, description, qty_text, quantity_micros, rate_cents, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    invoice: db.prepare(`
      INSERT INTO invoices (id, job_id, type, issue_date, due_date, notes, payment_notes, created_at, updated_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    invoiceLineItem: db.prepare(`
      INSERT INTO invoice_line_items (id, invoice_id, position, description, qty_text, quantity_micros, rate_cents, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    payment: db.prepare(`
      INSERT INTO payments (id, invoice_id, amount_cents, date, method, reference, notes, created_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    documentSendHistory: db.prepare(`
      INSERT INTO document_send_history (
        id, source_id, document_kind, quote_id, invoice_id, job_id, sent_at, from_email, to_email, to_name,
        message_id, stamp_text, email_purpose, job_snapshot_json, document_snapshot_json, template_snapshot_json, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    inventoryItem: db.prepare(`
      INSERT INTO inventory_items (
        id, name, sku, category, supplier, location, quantity_text, quantity_micros, reorder_level_text,
        reorder_level_micros, unit_cost_cents, notes, created_at, updated_at, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deletedRecord: db.prepare(`
      INSERT INTO deleted_records (id, kind, record_id, deleted_at, payload_json, extra_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    serviceM8Ref: db.prepare(`
      INSERT INTO service_m8_refs (id, entity_type, entity_id, service_m8_uuid, generated_job_id, imported_at, edit_date, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };
}

const templateKeys = new Set([
  "companyName", "companyAbn", "companyAcn", "companyEmail", "companyPhone", "companyAddress",
  "bankAccountName", "bankBsb", "bankAccountNumber", "accentColor", "quoteHeading", "introText",
  "notesHeading", "termsHeading", "termsText", "footerText",
]);
const staffKeys = new Set(["id", "name", "role", "email", "phone", "createdAt", "updatedAt"]);
const customerKeys = new Set(["id", "name", "email", "phone", "customerType", "address", "sites", "siteAccessNotes", "externalRefs", "createdAt", "updatedAt"]);
const siteKeys = new Set(["id", "label", "address", "siteType", "accessNotes", "notes", "contactName", "contactPhone", "assets", "createdAt", "updatedAt", "ocNumber"]);
const assetKeys = new Set(["id", "name", "type", "location", "model", "notes", "createdAt", "updatedAt"]);
const accessNoteKeys = new Set(["id", "address", "notes", "updatedAt"]);
const maintenanceKeys = new Set([
  "id", "planName", "customerId", "siteAddress", "frequency", "nextDueDate", "defaultTechnicianId",
  "estimatedDurationHours", "contractPrice", "checklist", "notes", "lastGeneratedAt", "lastGeneratedJobId",
  "lastCompletedAt", "createdAt", "updatedAt",
]);
const jobKeys = new Set([
  "id", "jobNumber", "title", "description", "urgency", "status", "scheduledDate", "assignedTechnicianId",
  "assignedTechnicianName", "customerId", "customerName", "customerEmail", "customerPhone", "jobAddress",
  "ocNumber", "requesterContact", "onsiteContact", "billingContact", "maintenancePlanId", "maintenancePlanName",
  "maintenanceDueDate", "serviceBoardTomorrowDate", "serviceBoardTomorrowOrder", "createdAt", "updatedAt",
  "notes", "photos", "quote", "invoice", "externalRefs",
]);
const noteKeys = new Set(["id", "author", "text", "createdAt"]);
const attachmentKeys = new Set(["id", "name", "url", "path", "mimeType", "mime_type", "sizeBytes", "size_bytes", "createdAt", "kind"]);
const documentKeys = new Set(["id", "type", "issueDate", "dueDate", "notes", "paymentNotes", "items", "payments", "sentHistory", "createdAt", "updatedAt"]);
const lineItemKeys = new Set(["id", "description", "qty", "rate"]);
const paymentKeys = new Set(["id", "amount", "date", "method", "reference", "notes", "createdAt"]);
const historyKeys = new Set([
  "id", "sentAt", "fromEmail", "toEmail", "toName", "messageId", "stampText", "emailPurpose",
  "jobSnapshot", "documentSnapshot", "templateSnapshot",
]);
const inventoryKeys = new Set([
  "id", "name", "sku", "category", "supplier", "location", "quantity", "reorderLevel",
  "unitCost", "notes", "createdAt", "updatedAt",
]);

function insertTemplate(statements, type, template, updatedAt) {
  statements.template.run(
    type,
    text(template.companyName),
    text(template.companyAbn),
    text(template.companyAcn),
    text(template.companyEmail),
    text(template.companyPhone),
    text(template.companyAddress),
    text(template.bankAccountName),
    text(template.bankBsb),
    text(template.bankAccountNumber),
    text(template.accentColor),
    text(template.quoteHeading),
    text(template.introText),
    text(template.notesHeading),
    text(template.termsHeading),
    text(template.termsText),
    text(template.footerText),
    objectJson(pickExtra(template, templateKeys)),
    updatedAt
  );
}

function insertServiceM8Ref(statements, entityType, entityId, externalRefs) {
  const serviceM8 = externalRefs?.serviceM8;
  if (!serviceM8 || typeof serviceM8 !== "object") return;
  const serviceM8Uuid = text(serviceM8.companyUuid || serviceM8.jobUuid || serviceM8.uuid);
  const generatedJobId = text(serviceM8.generatedJobId);
  const importedAt = text(serviceM8.importedAt);
  const editDate = text(serviceM8.editDate);
  const refId = `${entityType}:${entityId}:serviceM8`;

  statements.serviceM8Ref.run(
    refId,
    entityType,
    entityId,
    serviceM8Uuid,
    generatedJobId,
    importedAt,
    editDate,
    objectJson(serviceM8)
  );
}

function insertLineItems(statement, parentId, items) {
  (items || []).forEach((item, index) => {
    const qtyText = text(item.qty ?? 0);
    statement.run(
      item.id || `${parentId}:line:${index + 1}`,
      parentId,
      index + 1,
      text(item.description),
      qtyText,
      decimalToScaledInteger(item.qty ?? 0, QUANTITY_SCALE),
      moneyToCents(item.rate ?? 0),
      objectJson(pickExtra(item, lineItemKeys))
    );
  });
}

function insertSendHistory(statements, kind, documentId, jobId, sentHistory) {
  (sentHistory || []).forEach((entry, index) => {
    const sourceId = text(entry.id);
    const stableId = `${kind}:${documentId}:sent:${sourceId || index + 1}`;
    statements.documentSendHistory.run(
      stableId,
      sourceId,
      kind,
      kind === "quote" ? documentId : null,
      kind === "invoice" ? documentId : null,
      jobId,
      text(entry.sentAt || entry.createdAt || nowIso()),
      text(entry.fromEmail),
      text(entry.toEmail),
      text(entry.toName),
      text(entry.messageId),
      text(entry.stampText),
      text(entry.emailPurpose),
      nullableJson(entry.jobSnapshot),
      nullableJson(entry.documentSnapshot),
      nullableJson(entry.templateSnapshot),
      objectJson(pickExtra(entry, historyKeys))
    );
  });
}

function insertWorkspaceData(db, data, { sourceJsonSha256 = "" } = {}) {
  const statements = buildInsertStatements(db);
  const importTime = nowIso();
  const meta = data.meta || {};

  statements.workspaceInfo.run(
    WORKSPACE_SCHEMA_VERSION,
    text(meta.initializedAt || importTime),
    text(meta.updatedAt || importTime),
    importTime,
    text(sourceJsonSha256),
    WORKSPACE_IMPORTER_VERSION,
    objectJson(meta)
  );

  for (const [key, value] of Object.entries(data.settings || {})) {
    statements.setting.run(key, json(value), importTime);
  }

  insertTemplate(statements, "quote", data.quoteTemplate || {}, importTime);
  insertTemplate(statements, "invoice", data.invoiceTemplate || {}, importTime);

  for (const staffMember of data.staff || []) {
    statements.staff.run(
      staffMember.id,
      text(staffMember.name),
      text(staffMember.role),
      text(staffMember.email),
      text(staffMember.phone),
      text(staffMember.createdAt || importTime),
      staffMember.updatedAt ? text(staffMember.updatedAt) : null,
      objectJson(pickExtra(staffMember, staffKeys))
    );
  }

  for (const customer of data.customers || []) {
    statements.customer.run(
      customer.id,
      text(customer.name),
      text(customer.email),
      text(customer.phone),
      text(customer.customerType),
      text(customer.address),
      text(customer.createdAt || importTime),
      customer.updatedAt ? text(customer.updatedAt) : null,
      objectJson(customer.externalRefs),
      objectJson(pickExtra(customer, customerKeys))
    );
    insertServiceM8Ref(statements, "customer", customer.id, customer.externalRefs);

    for (const site of customer.sites || []) {
      statements.site.run(
        site.id,
        customer.id,
        text(site.label),
        text(site.address),
        text(site.siteType),
        text(site.accessNotes),
        text(site.notes),
        text(site.contactName),
        text(site.contactPhone),
        text(site.ocNumber),
        site.createdAt ? text(site.createdAt) : null,
        site.updatedAt ? text(site.updatedAt) : null,
        objectJson(pickExtra(site, siteKeys))
      );

      if (site.contactName || site.contactPhone) {
        statements.customerContact.run(
          `${site.id}:primary-contact`,
          customer.id,
          site.id,
          "site-primary",
          text(site.contactName),
          text(site.contactPhone),
          "",
          "",
          "",
          "{}"
        );
      }

      for (const asset of site.assets || []) {
        statements.siteAsset.run(
          asset.id,
          site.id,
          text(asset.name),
          text(asset.type),
          text(asset.location),
          text(asset.model),
          text(asset.notes),
          asset.createdAt ? text(asset.createdAt) : null,
          asset.updatedAt ? text(asset.updatedAt) : null,
          objectJson(pickExtra(asset, assetKeys))
        );
      }
    }

    for (const accessNote of customer.siteAccessNotes || []) {
      statements.siteAccessNote.run(
        accessNote.id,
        customer.id,
        text(accessNote.address),
        text(accessNote.notes),
        accessNote.updatedAt ? text(accessNote.updatedAt) : null,
        objectJson(pickExtra(accessNote, accessNoteKeys))
      );
    }
  }

  for (const item of data.inventoryItems || []) {
    const quantityText = text(item.quantity ?? 0);
    const reorderLevelText = text(item.reorderLevel ?? 0);
    statements.inventoryItem.run(
      item.id,
      text(item.name),
      text(item.sku),
      text(item.category),
      text(item.supplier),
      text(item.location),
      quantityText,
      decimalToScaledInteger(item.quantity ?? 0, QUANTITY_SCALE),
      reorderLevelText,
      decimalToScaledInteger(item.reorderLevel ?? 0, QUANTITY_SCALE),
      moneyToCents(item.unitCost ?? 0),
      text(item.notes),
      text(item.createdAt || importTime),
      text(item.updatedAt || item.createdAt || importTime),
      objectJson(pickExtra(item, inventoryKeys))
    );
  }

  for (const plan of data.maintenancePlans || []) {
    statements.maintenancePlan.run(
      plan.id,
      plan.customerId,
      text(plan.planName),
      text(plan.siteAddress),
      text(plan.frequency),
      text(plan.nextDueDate),
      nullableText(plan.defaultTechnicianId),
      plan.estimatedDurationHours === "" || plan.estimatedDurationHours === null || plan.estimatedDurationHours === undefined
        ? null
        : Number(plan.estimatedDurationHours),
      moneyToCents(plan.contractPrice ?? 0),
      text(plan.notes),
      text(plan.lastGeneratedAt),
      text(plan.lastGeneratedJobId),
      text(plan.lastCompletedAt),
      text(plan.createdAt || importTime),
      plan.updatedAt ? text(plan.updatedAt) : null,
      objectJson(pickExtra(plan, maintenanceKeys))
    );

    (plan.checklist || []).forEach((item, index) => {
      statements.maintenanceChecklistItem.run(
        `${plan.id}:checklist:${index + 1}`,
        plan.id,
        index + 1,
        text(item),
        "{}"
      );
    });
  }

  for (const job of data.jobs || []) {
    statements.job.run(
      job.id,
      Number.isFinite(Number(job.jobNumber)) ? Number(job.jobNumber) : null,
      text(job.title),
      text(job.description),
      text(job.urgency),
      text(job.status),
      text(job.scheduledDate),
      nullableText(job.assignedTechnicianId),
      text(job.assignedTechnicianName),
      job.customerId,
      text(job.customerName),
      text(job.customerEmail),
      text(job.customerPhone),
      text(job.jobAddress),
      text(job.ocNumber),
      nullableJson(job.requesterContact),
      nullableJson(job.onsiteContact),
      nullableJson(job.billingContact),
      nullableText(job.maintenancePlanId),
      text(job.maintenancePlanName),
      text(job.maintenanceDueDate),
      text(job.serviceBoardTomorrowDate),
      job.serviceBoardTomorrowOrder === null || job.serviceBoardTomorrowOrder === undefined || job.serviceBoardTomorrowOrder === ""
        ? null
        : Number(job.serviceBoardTomorrowOrder),
      text(job.createdAt || importTime),
      text(job.updatedAt || job.createdAt || importTime),
      objectJson(job.externalRefs),
      objectJson(pickExtra(job, jobKeys))
    );
    insertServiceM8Ref(statements, "job", job.id, job.externalRefs);

    for (const note of job.notes || []) {
      statements.jobNote.run(
        note.id,
        job.id,
        text(note.author),
        text(note.text),
        text(note.createdAt || importTime),
        objectJson(pickExtra(note, noteKeys))
      );
    }

    for (const photo of job.photos || []) {
      statements.jobAttachment.run(
        photo.id,
        job.id,
        text(photo.kind || "photo"),
        text(photo.name),
        text(photo.url),
        text(photo.path),
        text(photo.mimeType || photo.mime_type),
        photo.sizeBytes || photo.size_bytes || null,
        photo.createdAt ? text(photo.createdAt) : null,
        objectJson(pickExtra(photo, attachmentKeys))
      );
    }

    if (job.quote) {
      const quoteId = job.quote.id || `${job.id}:quote`;
      statements.quote.run(
        quoteId,
        job.id,
        text(job.quote.type || "quote"),
        text(job.quote.issueDate),
        text(job.quote.notes),
        job.quote.createdAt ? text(job.quote.createdAt) : null,
        job.quote.updatedAt ? text(job.quote.updatedAt) : null,
        objectJson(pickExtra(job.quote, documentKeys))
      );
      insertLineItems(statements.quoteLineItem, quoteId, job.quote.items || []);
      insertSendHistory(statements, "quote", quoteId, job.id, job.quote.sentHistory || []);
    }

    if (job.invoice) {
      const invoiceId = job.invoice.id || `${job.id}:invoice`;
      statements.invoice.run(
        invoiceId,
        job.id,
        text(job.invoice.type || "invoice"),
        text(job.invoice.issueDate),
        text(job.invoice.dueDate),
        text(job.invoice.notes),
        text(job.invoice.paymentNotes),
        job.invoice.createdAt ? text(job.invoice.createdAt) : null,
        job.invoice.updatedAt ? text(job.invoice.updatedAt) : null,
        objectJson(pickExtra(job.invoice, documentKeys))
      );
      insertLineItems(statements.invoiceLineItem, invoiceId, job.invoice.items || []);

      for (const payment of job.invoice.payments || []) {
        statements.payment.run(
          payment.id,
          invoiceId,
          moneyToCents(payment.amount ?? 0),
          text(payment.date),
          text(payment.method),
          text(payment.reference),
          text(payment.notes),
          text(payment.createdAt || importTime),
          objectJson(pickExtra(payment, paymentKeys))
        );
      }

      insertSendHistory(statements, "invoice", invoiceId, job.id, job.invoice.sentHistory || []);
    }
  }

  (data.deletedJobs || []).forEach((entry, index) => {
    const recordId = text(entry.job?.id || entry.id);
    statements.deletedRecord.run(
      `deleted-job:${recordId || index + 1}`,
      "job",
      recordId,
      text(entry.deletedAt || importTime),
      json(entry.job || entry),
      objectJson(pickExtra(entry, new Set(["deletedAt", "job"])))
    );
  });

  (data.deletedCustomers || []).forEach((entry, index) => {
    const recordId = text(entry.customer?.id || entry.id);
    statements.deletedRecord.run(
      `deleted-customer:${recordId || index + 1}`,
      "customer",
      recordId,
      text(entry.deletedAt || importTime),
      json(entry.customer || entry),
      objectJson(pickExtra(entry, new Set(["deletedAt", "customer"])))
    );
  });
}

export function importWorkspaceJsonData(db, rawData, {
  sourceJsonSha256 = "",
  allowNonEmpty = false,
} = {}) {
  migrateWorkspaceSchema(db);
  const data = normalizeStoredData(rawData);
  const relationshipErrors = validateSourceRelationships(data);
  if (relationshipErrors.length > 0) {
    throw new Error(`Workspace JSON has relationship errors:\n${relationshipErrors.join("\n")}`);
  }

  const sourceSummary = summarizeWorkspaceData(data);
  const nonEmptyTables = getNonEmptyEntityTables(db);
  if (!allowNonEmpty && nonEmptyTables.length > 0) {
    const summary = nonEmptyTables.map((entry) => `${entry.tableName}=${entry.count}`).join(", ");
    throw new Error(`Workspace database is not empty; refusing duplicate import (${summary}).`);
  }

  const importTransaction = db.transaction(() => {
    insertWorkspaceData(db, data, { sourceJsonSha256 });
  });
  importTransaction();

  const foreignKeyErrors = runForeignKeyCheck(db);
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Workspace SQLite foreign-key validation failed:\n${foreignKeyErrors.join("\n")}`);
  }

  const dbSummary = summarizeWorkspaceDb(db);
  const validationErrors = compareSummaries(sourceSummary, dbSummary);
  if (validationErrors.length > 0) {
    throw new Error(`Workspace SQLite validation failed:\n${validationErrors.join("\n")}`);
  }

  return {
    ok: true,
    importerVersion: WORKSPACE_IMPORTER_VERSION,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    importedAt: nowIso(),
    sourceJsonSha256,
    sourceSummary,
    dbSummary,
  };
}

export function sha256Hex(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}
