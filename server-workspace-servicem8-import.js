import {
  insertOrReplaceCustomer,
  normalizeCustomerInput,
  syncJobCustomerSnapshots,
} from "./server-workspace-customers.js";
import { insertJobTree } from "./server-workspace-jobs.js";
import { WORKSPACE_SCHEMA_VERSION } from "./server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const MAX_IMPORT_CUSTOMERS = 5000;
const MAX_IMPORT_JOBS = 15000;
const MAX_NESTED_RECORDS = 75000;
const statusValues = new Set(["To Do", "In Progress", "Completed"]);

export class ServiceM8SqliteImportError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ServiceM8SqliteImportError";
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

function parseTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeId(value, label) {
  const id = trimText(value);
  if (!id) throw new ServiceM8SqliteImportError(`${label} is required.`);
  if (id.length > 180) throw new ServiceM8SqliteImportError(`${label} is too long.`);
  return id;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceM8SqliteImportError(`${label} must be an object.`);
  }
}

function getServiceM8Ref(record) {
  return record?.externalRefs?.serviceM8 && typeof record.externalRefs.serviceM8 === "object"
    ? record.externalRefs.serviceM8
    : {};
}

function getServiceEditDate(record) {
  return trimText(getServiceM8Ref(record).editDate);
}

function getServiceImportedAt(record) {
  return trimText(getServiceM8Ref(record).importedAt);
}

function stripVolatileImportFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripVolatileImportFields);
  }

  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce((next, key) => {
      if (key === "createdAt" || key === "updatedAt") return next;
      if (key === "externalRefs") {
        const externalRefs = stripVolatileImportFields(value[key]);
        if (externalRefs && typeof externalRefs === "object" && externalRefs.serviceM8) {
          const serviceM8 = { ...externalRefs.serviceM8 };
          delete serviceM8.importedAt;
          externalRefs.serviceM8 = serviceM8;
        }
        next[key] = externalRefs;
        return next;
      }
      next[key] = stripVolatileImportFields(value[key]);
      return next;
    }, {});
}

function hasMeaningfulDifference(existingRecord, incomingRecord) {
  return JSON.stringify(stripVolatileImportFields(existingRecord)) !== JSON.stringify(stripVolatileImportFields(incomingRecord));
}

function createEmptyApplySummary() {
  const recordCounts = () => ({
    created: 0,
    updated: 0,
    skipped: 0,
    conflicted: 0,
    failed: 0,
  });

  return {
    customers: recordCounts(),
    jobs: recordCounts(),
    documents: {
      quotesCreated: 0,
      quotesUpdated: 0,
      invoicesCreated: 0,
      invoicesUpdated: 0,
      paymentsCreated: 0,
      paymentsUpdated: 0,
      sentHistoryCreated: 0,
      sentHistoryUpdated: 0,
      skipped: 0,
    },
    warnings: [],
    dryRun: false,
  };
}

function nestedRecordCountForJob(job) {
  return (
    (Array.isArray(job.notes) ? job.notes.length : 0)
    + (Array.isArray(job.photos) ? job.photos.length : 0)
    + (Array.isArray(job.quote?.items) ? job.quote.items.length : 0)
    + (Array.isArray(job.quote?.sentHistory) ? job.quote.sentHistory.length : 0)
    + (Array.isArray(job.invoice?.items) ? job.invoice.items.length : 0)
    + (Array.isArray(job.invoice?.payments) ? job.invoice.payments.length : 0)
    + (Array.isArray(job.invoice?.sentHistory) ? job.invoice.sentHistory.length : 0)
  );
}

function nestedRecordCountForCustomer(customer) {
  return (Array.isArray(customer.sites) ? customer.sites : []).reduce(
    (total, site) => total + 1 + (Array.isArray(site.assets) ? site.assets.length : 0),
    Array.isArray(customer.siteAccessNotes) ? customer.siteAccessNotes.length : 0
  );
}

function assertUniqueIds(records, label) {
  const seen = new Set();
  for (const record of records || []) {
    if (!record?.id) continue;
    const id = trimText(record.id);
    if (!id) continue;
    if (seen.has(id)) {
      throw new ServiceM8SqliteImportError(`${label} contains duplicate ID ${id}.`);
    }
    seen.add(id);
  }
}

function validateDocumentTree(document, label) {
  if (!document) return;
  assertPlainObject(document, label);
  if (!Array.isArray(document.items) || document.items.length === 0) {
    throw new ServiceM8SqliteImportError(`${label} must include at least one line item.`);
  }
  if (document.items.length > 300) {
    throw new ServiceM8SqliteImportError(`${label} contains too many line items.`);
  }
  assertUniqueIds(document.items, `${label} line items`);
  if (document.payments) assertUniqueIds(document.payments, `${label} payments`);
  if (document.sentHistory) assertUniqueIds(document.sentHistory, `${label} sent history`);
}

export function validateServiceM8ImportPlan(plan) {
  assertPlainObject(plan, "ServiceM8 import plan");
  if (!Array.isArray(plan.customers)) {
    throw new ServiceM8SqliteImportError("ServiceM8 import plan must include customers.");
  }
  if (!Array.isArray(plan.jobs)) {
    throw new ServiceM8SqliteImportError("ServiceM8 import plan must include jobs.");
  }
  if (plan.customers.length > MAX_IMPORT_CUSTOMERS) {
    throw new ServiceM8SqliteImportError(`ServiceM8 import contains too many customers (${plan.customers.length}).`);
  }
  if (plan.jobs.length > MAX_IMPORT_JOBS) {
    throw new ServiceM8SqliteImportError(`ServiceM8 import contains too many jobs (${plan.jobs.length}).`);
  }

  let nestedRecordCount = 0;
  const customerIds = new Set();
  const jobIds = new Set();

  plan.customers.forEach((customerPlan, index) => {
    assertPlainObject(customerPlan, `ServiceM8 customer import ${index + 1}`);
    assertPlainObject(customerPlan.record, `ServiceM8 customer record ${index + 1}`);
    const customerId = normalizeId(customerPlan.record.id, "Customer ID");
    if (customerIds.has(customerId)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 import contains duplicate customer ID ${customerId}.`);
    }
    customerIds.add(customerId);
    if (!trimText(customerPlan.record.name)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 customer ${customerId} is missing a name.`);
    }
    nestedRecordCount += nestedRecordCountForCustomer(customerPlan.record);
  });

  plan.jobs.forEach((jobPlan, index) => {
    assertPlainObject(jobPlan, `ServiceM8 job import ${index + 1}`);
    assertPlainObject(jobPlan.record, `ServiceM8 job record ${index + 1}`);
    const jobId = normalizeId(jobPlan.record.id, "Job ID");
    if (jobIds.has(jobId)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 import contains duplicate job ID ${jobId}.`);
    }
    jobIds.add(jobId);
    if (!trimText(jobPlan.record.customerId)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 job ${jobId} is missing a customer relationship.`);
    }
    if (!trimText(jobPlan.record.title)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 job ${jobId} is missing a title.`);
    }
    if (!statusValues.has(trimText(jobPlan.record.status))) {
      throw new ServiceM8SqliteImportError(`ServiceM8 job ${jobId} has an invalid status.`);
    }
    validateDocumentTree(jobPlan.record.quote, `ServiceM8 quote for job ${jobId}`);
    validateDocumentTree(jobPlan.record.invoice, `ServiceM8 invoice for job ${jobId}`);
    nestedRecordCount += nestedRecordCountForJob(jobPlan.record);
  });

  if (nestedRecordCount > MAX_NESTED_RECORDS) {
    throw new ServiceM8SqliteImportError(`ServiceM8 import contains too many nested records (${nestedRecordCount}).`);
  }

  return {
    customerIds,
    jobIds,
    nestedRecordCount,
  };
}

function validateDatabaseRelationships(db, plan) {
  const plannedCustomerIds = new Set(plan.customers.map((entry) => trimText(entry.record?.id)).filter(Boolean));
  const activeCustomerIds = new Set(db.prepare("SELECT id FROM customers").all().map((row) => row.id));
  const activeStaffIds = new Set(db.prepare("SELECT id FROM staff").all().map((row) => row.id));
  const activeMaintenancePlanIds = new Set(db.prepare("SELECT id FROM maintenance_plans").all().map((row) => row.id));

  for (const jobPlan of plan.jobs) {
    const job = jobPlan.record;
    const customerId = trimText(job.customerId);
    if (!plannedCustomerIds.has(customerId) && !activeCustomerIds.has(customerId)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 job ${job.id} references missing customer ${customerId}.`);
    }
    const staffId = trimText(job.assignedTechnicianId);
    if (staffId && !activeStaffIds.has(staffId)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 job ${job.id} references missing staff member ${staffId}.`);
    }
    const maintenancePlanId = trimText(job.maintenancePlanId);
    if (maintenancePlanId && !activeMaintenancePlanIds.has(maintenancePlanId)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 job ${job.id} references missing maintenance plan ${maintenancePlanId}.`);
    }
  }
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new ServiceM8SqliteImportError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, ?, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET
      schema_version = excluded.schema_version,
      updated_at = excluded.updated_at
  `).run(WORKSPACE_SCHEMA_VERSION, updatedAt, updatedAt);
}

function deletedRecordExists(db, kind, recordId) {
  return Boolean(db.prepare("SELECT id FROM deleted_records WHERE kind = ? AND record_id = ? LIMIT 1").get(kind, recordId));
}

function getActiveCustomerById(state, customerId) {
  return (state.customers || []).find((customer) => customer.id === customerId) || null;
}

function getActiveJobById(state, jobId) {
  return (state.jobs || []).find((job) => job.id === jobId) || null;
}

function classifyIncomingChange(existingRecord, incomingRecord) {
  if (!existingRecord) return "write";
  const incomingEditMs = parseTimestamp(getServiceEditDate(incomingRecord));
  const existingEditMs = parseTimestamp(getServiceEditDate(existingRecord));
  const localUpdatedMs = parseTimestamp(existingRecord.updatedAt || existingRecord.createdAt);
  const meaningfulDifference = hasMeaningfulDifference(existingRecord, incomingRecord);

  if (incomingEditMs && existingEditMs && incomingEditMs <= existingEditMs) {
    return meaningfulDifference && localUpdatedMs > incomingEditMs ? "conflict" : "skip";
  }

  if (incomingEditMs && localUpdatedMs > incomingEditMs && meaningfulDifference) {
    return "conflict";
  }

  const importedAtMs = parseTimestamp(getServiceImportedAt(incomingRecord));
  if (!incomingEditMs && importedAtMs && localUpdatedMs > importedAtMs && meaningfulDifference) {
    return "conflict";
  }

  return "write";
}

function resolveJobNumber(db, job) {
  const preferred = Number(job.jobNumber);
  if (Number.isInteger(preferred) && preferred > 0) {
    const existing = db.prepare("SELECT id FROM jobs WHERE job_number = ? AND id <> ?").get(preferred, job.id);
    if (!existing) return preferred;
  }

  const row = db.prepare("SELECT COALESCE(MAX(job_number), 0) + 1 AS next_number FROM jobs").get();
  return Number(row?.next_number || 1);
}

function getExistingDocumentSnapshot(db, jobId) {
  const quote = db.prepare("SELECT id FROM quotes WHERE job_id = ?").get(jobId) || null;
  const invoice = db.prepare("SELECT id FROM invoices WHERE job_id = ?").get(jobId) || null;
  const payments = invoice
    ? new Set(db.prepare("SELECT id FROM payments WHERE invoice_id = ?").all(invoice.id).map((row) => row.id))
    : new Set();
  const quoteHistory = quote
    ? new Set(db.prepare("SELECT id FROM document_send_history WHERE document_kind = 'quote' AND quote_id = ?").all(quote.id).map((row) => row.id))
    : new Set();
  const invoiceHistory = invoice
    ? new Set(db.prepare("SELECT id FROM document_send_history WHERE document_kind = 'invoice' AND invoice_id = ?").all(invoice.id).map((row) => row.id))
    : new Set();

  return {
    quoteId: quote?.id || "",
    invoiceId: invoice?.id || "",
    payments,
    quoteHistory,
    invoiceHistory,
  };
}

function getSentHistoryStableId(kind, documentId, entry, index) {
  const sourceId = trimText(entry?.id);
  return `${kind}:${documentId}:sent:${sourceId || index + 1}`;
}

function countDocumentChanges(summary, job, existingDocuments) {
  if (job.quote) {
    if (existingDocuments.quoteId) summary.documents.quotesUpdated += 1;
    else summary.documents.quotesCreated += 1;

    const quoteId = existingDocuments.quoteId || trimText(job.quote.id) || `${job.id}:quote`;
    (Array.isArray(job.quote.sentHistory) ? job.quote.sentHistory : []).forEach((entry, index) => {
      const stableId = getSentHistoryStableId("quote", quoteId, entry, index);
      if (existingDocuments.quoteHistory.has(stableId)) summary.documents.sentHistoryUpdated += 1;
      else summary.documents.sentHistoryCreated += 1;
    });
  }

  if (job.invoice) {
    if (existingDocuments.invoiceId) summary.documents.invoicesUpdated += 1;
    else summary.documents.invoicesCreated += 1;

    const invoiceId = existingDocuments.invoiceId || trimText(job.invoice.id) || `${job.id}:invoice`;
    (Array.isArray(job.invoice.payments) ? job.invoice.payments : []).forEach((payment) => {
      if (payment?.id && existingDocuments.payments.has(payment.id)) summary.documents.paymentsUpdated += 1;
      else summary.documents.paymentsCreated += 1;
    });
    (Array.isArray(job.invoice.sentHistory) ? job.invoice.sentHistory : []).forEach((entry, index) => {
      const stableId = getSentHistoryStableId("invoice", invoiceId, entry, index);
      if (existingDocuments.invoiceHistory.has(stableId)) summary.documents.sentHistoryUpdated += 1;
      else summary.documents.sentHistoryCreated += 1;
    });
  }
}

function upsertServiceM8Ref(db, entityType, entityId, externalRefs) {
  db.prepare("DELETE FROM service_m8_refs WHERE entity_type = ? AND entity_id = ?").run(entityType, entityId);
  const serviceM8 = getServiceM8Ref({ externalRefs });
  if (!serviceM8 || Object.keys(serviceM8).length === 0) return;
  db.prepare(`
    INSERT INTO service_m8_refs (id, entity_type, entity_id, service_m8_uuid, generated_job_id, imported_at, edit_date, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      service_m8_uuid = excluded.service_m8_uuid,
      generated_job_id = excluded.generated_job_id,
      imported_at = excluded.imported_at,
      edit_date = excluded.edit_date,
      raw_json = excluded.raw_json
  `).run(
    `${entityType}:${entityId}:serviceM8`,
    entityType,
    entityId,
    trimText(serviceM8.companyUuid || serviceM8.jobUuid || serviceM8.uuid),
    trimText(serviceM8.generatedJobId),
    trimText(serviceM8.importedAt),
    trimText(serviceM8.editDate),
    objectJson(serviceM8)
  );
}

function deleteJobBeforeImport(db, jobId) {
  db.prepare("DELETE FROM service_m8_refs WHERE entity_type = 'job' AND entity_id = ?").run(jobId);
  db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
}

function applyCustomerPlans(db, plan, state, summary) {
  plan.customers.forEach((customerPlan) => {
    const customerId = normalizeId(customerPlan.record.id, "Customer ID");
    const existingCustomer = getActiveCustomerById(state, customerId);

    if (!existingCustomer && deletedRecordExists(db, "customer", customerId)) {
      summary.customers.conflicted += 1;
      summary.warnings.push(`Customer ${customerPlan.name || customerId} is in the recycle bin, so the ServiceM8 import skipped it.`);
      return;
    }

    const incomingCustomer = normalizeCustomerInput(customerPlan.record, existingCustomer);
    const classification = classifyIncomingChange(existingCustomer, incomingCustomer);
    if (classification === "skip") {
      summary.customers.skipped += 1;
      return;
    }
    if (classification === "conflict") {
      summary.customers.conflicted += 1;
      summary.warnings.push(`Customer ${incomingCustomer.name || customerId} has newer local edits than the ServiceM8 source record and was not overwritten.`);
      return;
    }

    insertOrReplaceCustomer(db, incomingCustomer);
    syncJobCustomerSnapshots(db, incomingCustomer, incomingCustomer.updatedAt);
    if (existingCustomer) summary.customers.updated += 1;
    else summary.customers.created += 1;
  });
}

function applyJobPlans(db, plan, state, summary) {
  plan.jobs.forEach((jobPlan) => {
    const jobId = normalizeId(jobPlan.record.id, "Job ID");
    const existingJob = getActiveJobById(state, jobId);

    if (!existingJob && deletedRecordExists(db, "job", jobId)) {
      summary.jobs.conflicted += 1;
      summary.warnings.push(`Job ${jobPlan.generatedJobId || jobId} is in the recycle bin, so the ServiceM8 import skipped it.`);
      return;
    }

    const classification = classifyIncomingChange(existingJob, jobPlan.record);
    if (classification === "skip") {
      summary.jobs.skipped += 1;
      summary.documents.skipped += Number(Boolean(jobPlan.record.quote)) + Number(Boolean(jobPlan.record.invoice));
      return;
    }
    if (classification === "conflict") {
      summary.jobs.conflicted += 1;
      summary.warnings.push(`Job ${jobPlan.generatedJobId || jobId} has newer local edits than the ServiceM8 source record and was not overwritten.`);
      return;
    }

    const customerExists = db.prepare("SELECT id FROM customers WHERE id = ?").get(jobPlan.record.customerId);
    if (!customerExists) {
      summary.jobs.conflicted += 1;
      summary.warnings.push(`Job ${jobPlan.generatedJobId || jobId} was skipped because its customer is not active in the workspace.`);
      return;
    }

    const assignedTechnicianId = trimText(jobPlan.record.assignedTechnicianId);
    if (assignedTechnicianId && !db.prepare("SELECT id FROM staff WHERE id = ?").get(assignedTechnicianId)) {
      throw new ServiceM8SqliteImportError(`ServiceM8 job ${jobId} references missing staff member ${assignedTechnicianId}.`);
    }

    const existingDocuments = getExistingDocumentSnapshot(db, jobId);
    const job = {
      ...jobPlan.record,
      id: jobId,
      jobNumber: resolveJobNumber(db, jobPlan.record),
      title: trimText(jobPlan.record.title) || "Imported ServiceM8 job",
      description: trimText(jobPlan.record.description),
      urgency: trimText(jobPlan.record.urgency) || "Medium",
      status: statusValues.has(trimText(jobPlan.record.status)) ? trimText(jobPlan.record.status) : "To Do",
      scheduledDate: trimText(jobPlan.record.scheduledDate),
      assignedTechnicianId,
      assignedTechnicianName: trimText(jobPlan.record.assignedTechnicianName),
      customerId: trimText(jobPlan.record.customerId),
      customerName: trimText(jobPlan.record.customerName),
      customerEmail: trimText(jobPlan.record.customerEmail),
      customerPhone: trimText(jobPlan.record.customerPhone),
      jobAddress: trimText(jobPlan.record.jobAddress),
      ocNumber: trimText(jobPlan.record.ocNumber),
      maintenancePlanId: trimText(jobPlan.record.maintenancePlanId),
      maintenancePlanName: trimText(jobPlan.record.maintenancePlanName),
      maintenanceDueDate: trimText(jobPlan.record.maintenanceDueDate),
      serviceBoardTomorrowDate: trimText(jobPlan.record.serviceBoardTomorrowDate),
      serviceBoardTomorrowOrder: jobPlan.record.serviceBoardTomorrowOrder ?? null,
      createdAt: trimText(jobPlan.record.createdAt) || nowIso(),
      updatedAt: trimText(jobPlan.record.updatedAt) || nowIso(),
      notes: Array.isArray(jobPlan.record.notes) ? jobPlan.record.notes : [],
      photos: Array.isArray(jobPlan.record.photos) ? jobPlan.record.photos : [],
      quote: jobPlan.record.quote || null,
      invoice: jobPlan.record.invoice || null,
      externalRefs: jobPlan.record.externalRefs && typeof jobPlan.record.externalRefs === "object" && !Array.isArray(jobPlan.record.externalRefs)
        ? jobPlan.record.externalRefs
        : {},
      extra: {},
    };

    deleteJobBeforeImport(db, jobId);
    insertJobTree(db, job);
    upsertServiceM8Ref(db, "job", job.id, job.externalRefs);
    countDocumentChanges(summary, job, existingDocuments);
    if (existingJob) summary.jobs.updated += 1;
    else summary.jobs.created += 1;
  });
}

function buildReturnedSummary(plan, applySummary) {
  return {
    ...(plan.summary || {}),
    apply: applySummary,
    warnings: [
      ...((plan.summary && Array.isArray(plan.summary.warnings)) ? plan.summary.warnings : []),
      ...applySummary.warnings,
    ],
  };
}

export function applyServiceM8ImportPlanToSqlite(db, plan, { dryRun = false } = {}) {
  validateServiceM8ImportPlan(plan);
  validateDatabaseRelationships(db, plan);

  const applySummary = createEmptyApplySummary();
  applySummary.dryRun = Boolean(dryRun);
  const rollback = new Error("SERVICE_M8_IMPORT_DRY_RUN_ROLLBACK");

  const transaction = db.transaction(() => {
    const state = loadWorkspaceStateFromDb(db);
    applyCustomerPlans(db, plan, state, applySummary);
    const refreshedState = loadWorkspaceStateFromDb(db);
    applyJobPlans(db, plan, refreshedState, applySummary);
    touchWorkspaceInfo(db, nowIso());
    runForeignKeyCheck(db);

    if (dryRun) {
      throw rollback;
    }
  });

  try {
    transaction();
  } catch (error) {
    if (error !== rollback) throw error;
  }

  return {
    ok: true,
    importedAt: trimText(plan.importedAt) || nowIso(),
    dryRun: Boolean(dryRun),
    summary: buildReturnedSummary(plan, applySummary),
  };
}
