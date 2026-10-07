import { readRows, mergeIds } from "./server-workspace-query.js";
import { isWorkspaceSecretSettingKey } from "./server-workspace-setting-keys.js";
import { WORKSPACE_BRANDING_ASSETS, workspaceBrandingUrl } from "./src/lib/workspace-logo.js";
import { effectiveMaintenancePlan } from "./src/lib/maintenance-recurrence.js";
import { readMaintenanceExceptions } from "./server-maintenance-occurrence-store.js";
import { maintenancePlanIdentity } from "./src/lib/maintenance-plan.js";
import { readContacts, readContactLinks } from "./server-workspace-contacts.js";
import { getCustomerDirectContacts, getSiteContacts } from "./src/lib/contact-model.js";

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mergeExtra(base, extraJson) {
  const extra = parseJson(extraJson, {});
  return {
    ...(extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {}),
    ...base,
  };
}

function centsToMoney(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function scaledToNumber(textValue, scaledValue) {
  const fromText = Number(textValue);
  if (Number.isFinite(fromText)) return fromText;
  return Number((Number(scaledValue || 0) / 1_000_000).toFixed(6));
}

function rowsByKey(rows, key) {
  return rows.reduce((map, row) => {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
    return map;
  }, new Map());
}

function mapDocumentTemplate(row) {
  if (!row) return null;
  return mergeExtra({
    companyName: row.company_name,
    companyAbn: row.company_abn,
    companyAcn: row.company_acn,
    companyEmail: row.company_email,
    companyPhone: row.company_phone,
    companyAddress: row.company_address,
    bankAccountName: row.bank_account_name,
    bankBsb: row.bank_bsb,
    bankAccountNumber: row.bank_account_number,
    accentColor: row.accent_color,
    quoteHeading: row.quote_heading,
    introText: row.intro_text,
    notesHeading: row.notes_heading,
    termsHeading: row.terms_heading,
    termsText: row.terms_text,
    footerText: row.footer_text,
  }, row.extra_json);
}

function mapLineItem(row) {
  return mergeExtra({
    id: row.id,
    description: row.description,
    qty: scaledToNumber(row.qty_text, row.quantity_micros),
    rate: centsToMoney(row.rate_cents),
  }, row.extra_json);
}

function mapSendHistory(row) {
  return mergeExtra({
    id: row.source_id || row.id,
    sentAt: row.sent_at,
    fromEmail: row.from_email,
    toEmail: row.to_email,
    toName: row.to_name,
    messageId: row.message_id,
    stampText: row.stamp_text,
    emailPurpose: row.email_purpose,
    jobSnapshot: parseJson(row.job_snapshot_json, null),
    documentSnapshot: parseJson(row.document_snapshot_json, null),
    templateSnapshot: parseJson(row.template_snapshot_json, null),
  }, row.extra_json);
}

function mapInvoicePayment(row) {
  return { ...mergeExtra({
    id: row.id,
    amount: centsToMoney(row.amount_cents),
    date: row.date,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
  }, row.extra_json), source: row.source || "manual" };
}

function mapQuote(row, lineItemsByQuoteId, sendHistoryByQuoteId) {
  return mergeExtra({
    type: row.type || "quote",
    issueDate: row.issue_date,
    notes: row.notes,
    items: (lineItemsByQuoteId.get(row.id) || []).map(mapLineItem),
    sentHistory: (sendHistoryByQuoteId.get(row.id) || []).map(mapSendHistory),
  }, row.extra_json);
}

function mapInvoice(row, lineItemsByInvoiceId, paymentsByInvoiceId, sendHistoryByInvoiceId) {
  return mergeExtra({
    type: row.type || "invoice",
    issueDate: row.issue_date,
    dueDate: row.due_date,
    notes: row.notes,
    paymentNotes: row.payment_notes,
    items: (lineItemsByInvoiceId.get(row.id) || []).map(mapLineItem),
    payments: (paymentsByInvoiceId.get(row.id) || []).map(mapInvoicePayment),
    sentHistory: (sendHistoryByInvoiceId.get(row.id) || []).map(mapSendHistory),
  }, row.extra_json);
}

// Full loads and targeted reads share exactly the same record projection.
export function loadWorkspaceStateFromDb(db) {
  return readWorkspaceRecords(db, Object.fromEntries([
    "staff", "customers", "contacts", "jobs", "inventoryItems", "maintenancePlans",
    "deletedJobs", "deletedCustomers", "deletedInvoices", "settings", "quoteTemplate", "invoiceTemplate", "meta",
  ].map(key => [key, true])));
}

export function readWorkspaceRecords(db, selection) {
  const maintenanceRows = readRows(db, "maintenance_plans", selection.maintenancePlans, { order: "next_due_date, lower(plan_name)" });
  const planIds = maintenanceRows.map(row => row.id);
  const linkedJobs = readRows(db, "jobs", planIds, { column: "maintenance_plan_id" });
  const jobRows = readRows(db, "jobs", mergeIds(selection.jobs, linkedJobs.map(row => row.id)), { order: "COALESCE(job_number, 0) DESC, created_at DESC" });
  const jobIds = jobRows.map(row => row.id);
  const customerRows = readRows(db, "customers", mergeIds(selection.customers, maintenanceRows.map(row => row.customer_id)), { order: "lower(name), created_at" });
  const customerIds = customerRows.map(row => row.id);
  const siteRows = readRows(db, "sites", customerIds, { column: "customer_id", order: "customer_id, created_at, lower(label), lower(address)" });
  const siteIds = siteRows.map(row => row.id);
  const directLinks = readContactLinks(db, "customer", customerIds);
  const locationLinks = readContactLinks(db, "site", siteIds);
  const contacts = readContacts(db, mergeIds(selection.contacts, [...directLinks, ...locationLinks].map(link => link.contactId)));
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const customerLinks = rowsByKey(directLinks, "customerId");
  const siteLinks = rowsByKey(locationLinks, "siteId");
  const siteContacts = new Map([...siteLinks].map(([id, contactAssignments]) => [id, getSiteContacts({ contactAssignments }, contactsById)]));
  const sitePrimaries = new Map([...siteContacts].map(([id, records]) => [id, records.find((contact) => contact.isPrimary)]));
  const customerContacts = new Map([...customerLinks].map(([id, contactAssignments]) => [id, getCustomerDirectContacts({ contactAssignments }, contactsById)]));
  const assetRows = readRows(db, "site_assets", siteIds, { column: "site_id", order: "site_id, lower(name)" });
  const accessNoteRows = readRows(db, "site_access_notes", customerIds, { column: "customer_id", order: "customer_id, updated_at" });
  const inventoryRows = readRows(db, "inventory_items", selection.inventoryItems, { order: "lower(name), created_at" });
  const staffRows = readRows(db, "staff", selection.staff, { order: "lower(name), created_at" });
  const checklistRows = readRows(db, "maintenance_checklist_items", planIds, { column: "maintenance_plan_id", order: "maintenance_plan_id, position" });
  const noteRows = readRows(db, "job_notes", jobIds, { column: "job_id", order: "job_id, created_at" });
  const attachmentRows = readRows(db, "job_attachments", jobIds, { column: "job_id", order: "job_id, created_at" });
  const quoteRows = readRows(db, "quotes", jobIds, { column: "job_id", order: "job_id" });
  const quoteItemRows = readRows(db, "quote_line_items", quoteRows.map(row => row.id), { column: "quote_id", order: "quote_id, position" });
  const invoiceRows = readRows(db, "invoices", jobIds, { column: "job_id", order: "job_id" });
  const invoiceIds = invoiceRows.map(row => row.id);
  const invoiceItemRows = readRows(db, "invoice_line_items", invoiceIds, { column: "invoice_id", order: "invoice_id, position" });
  const paymentRows = readRows(db, "payments", invoiceIds, { column: "invoice_id", order: "invoice_id, date, created_at" });
  const sendHistoryRows = readRows(db, "document_send_history", jobIds, { column: "job_id", order: "job_id, sent_at" });
  const accountingInvoices = new Map(readRows(db, "integration_entity_mappings", invoiceIds, { column: "local_entity_id", order: "created_at DESC" })
    .filter(row => row.local_entity_type === "invoice").map(row => [row.local_entity_id, row.provider]));
  const deletedRows = [
    ...readRows(db, "deleted_records", selection.deletedJobs, { column: "record_id", order: "deleted_at DESC" }).filter(row => row.kind === "job"),
    ...readRows(db, "deleted_records", selection.deletedCustomers, { column: "record_id", order: "deleted_at DESC" }).filter(row => row.kind === "customer"),
  ];
  const settingsRows = readRows(db, "settings", selection.settings, { column: "key", order: "key" });
  const templateRows = readRows(db, "document_templates", [selection.quoteTemplate && "quote", selection.invoiceTemplate && "invoice"].filter(Boolean), { column: "type", order: "type" });
  const info = selection.meta ? db.prepare("SELECT * FROM workspace_info WHERE id = 1").get() : null;

  const assetsBySiteId = rowsByKey(assetRows, "site_id");
  const sitesByCustomerId = rowsByKey(siteRows, "customer_id");
  const accessNotesByCustomerId = rowsByKey(accessNoteRows, "customer_id");
  const checklistByPlanId = rowsByKey(checklistRows, "maintenance_plan_id");
  const notesByJobId = rowsByKey(noteRows, "job_id");
  const attachmentsByJobId = rowsByKey(attachmentRows, "job_id");
  const quotesByJobId = new Map(quoteRows.map((row) => [row.job_id, row]));
  const quoteItemsByQuoteId = rowsByKey(quoteItemRows, "quote_id");
  const invoicesByJobId = new Map(invoiceRows.map((row) => [row.job_id, row]));
  const invoiceItemsByInvoiceId = rowsByKey(invoiceItemRows, "invoice_id");
  const paymentsByInvoiceId = rowsByKey(paymentRows, "invoice_id");
  const quoteSendHistoryByQuoteId = rowsByKey(
    sendHistoryRows.filter((row) => row.document_kind === "quote"),
    "quote_id"
  );
  const invoiceSendHistoryByInvoiceId = rowsByKey(
    sendHistoryRows.filter((row) => row.document_kind === "invoice"),
    "invoice_id"
  );

  const settings = settingsRows.reduce((nextSettings, row) => {
    if (isWorkspaceSecretSettingKey(row.key)) return nextSettings;
    const branding = Object.entries(WORKSPACE_BRANDING_ASSETS).find(([, asset]) => asset.key === row.key);
    if (branding) {
      const [kind, { urlKey }] = branding;
      nextSettings[urlKey] = workspaceBrandingUrl(kind, parseJson(row.value_json, null)?.id);
      return nextSettings;
    }
    nextSettings[row.key] = parseJson(row.value_json, null);
    return nextSettings;
  }, {});

  const templatesByType = new Map(templateRows.map((row) => [row.type, row]));

  const avatarOwnerIds = [...new Set([...staffRows.map(row => row.id), ...jobRows.map(row => row.assigned_technician_id)].filter(Boolean))];
  const avatarRows = avatarOwnerIds.length && db.prepare("SELECT 1 FROM sqlite_schema WHERE name='workspace_media' AND type='table'").get() ? db.prepare("SELECT id,owner_id FROM workspace_media WHERE owner_type='staff' AND owner_id IN (SELECT value FROM json_each(?))").all(JSON.stringify(avatarOwnerIds)) : [];
  const avatarIds = new Map(avatarRows.map(row => [row.owner_id, row.id]));
  const staff = staffRows.map((row) => ({ ...mergeExtra({
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  }, row.extra_json), avatarMediaId: avatarIds.get(row.id) || null, avatarUrl: avatarIds.has(row.id) ? `/api/media/${encodeURIComponent(avatarIds.get(row.id))}/thumbnail` : "" }));

  const customers = customerRows.map((row) => mergeExtra({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    customerType: row.customer_type,
    address: row.address,
    sites: (sitesByCustomerId.get(row.id) || []).map((siteRow) => mergeExtra({
      id: siteRow.id,
      label: siteRow.label,
      address: siteRow.address,
      siteType: siteRow.site_type,
      accessNotes: siteRow.access_notes,
      notes: siteRow.notes,
      contactAssignments: siteLinks.get(siteRow.id) || [],
      contacts: siteContacts.get(siteRow.id) || [],
      contactId: sitePrimaries.get(siteRow.id)?.id || "",
      contactName: sitePrimaries.get(siteRow.id)?.name || "",
      contactPhone: sitePrimaries.get(siteRow.id)?.phone || "",
      contactEmail: sitePrimaries.get(siteRow.id)?.email || "",
      ocNumber: siteRow.oc_number,
      assets: (assetsBySiteId.get(siteRow.id) || []).map((assetRow) => mergeExtra({
        id: assetRow.id,
        name: assetRow.name,
        type: assetRow.type,
        location: assetRow.location,
        model: assetRow.model,
        notes: assetRow.notes,
        createdAt: assetRow.created_at || undefined,
        updatedAt: assetRow.updated_at || undefined,
      }, assetRow.extra_json)),
      createdAt: siteRow.created_at || undefined,
      updatedAt: siteRow.updated_at || undefined,
    }, siteRow.extra_json)),
    siteAccessNotes: (accessNotesByCustomerId.get(row.id) || []).map((noteRow) => mergeExtra({
      id: noteRow.id,
      address: noteRow.address,
      notes: noteRow.notes,
      updatedAt: noteRow.updated_at || undefined,
    }, noteRow.extra_json)),
    contactAssignments: customerLinks.get(row.id) || [],
    contacts: customerContacts.get(row.id) || [],
    billingContactId: (customerContacts.get(row.id) || []).find((contact) => contact.isBilling)?.id || ((row.email || row.phone) ? `${row.id}-primary-contact` : ""),
    externalRefs: parseJson(row.external_refs_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  }, row.extra_json));

  const inventoryItems = inventoryRows.map((row) => mergeExtra({
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    supplier: row.supplier,
    location: row.location,
    quantity: scaledToNumber(row.quantity_text, row.quantity_micros),
    reorderLevel: scaledToNumber(row.reorder_level_text, row.reorder_level_micros),
    unitCost: centsToMoney(row.unit_cost_cents),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }, row.extra_json));

  const maintenancePlans = maintenanceRows.map((row) => mergeExtra({
    id: row.id,
    planName: row.plan_name,
    customerId: row.customer_id,
    siteAddress: row.site_address,
    frequency: row.frequency,
    nextDueDate: row.next_due_date,
    defaultTechnicianId: row.default_technician_id || "",
    estimatedDurationHours: row.estimated_duration_hours,
    contractPrice: centsToMoney(row.contract_price_cents),
    checklist: (checklistByPlanId.get(row.id) || []).map((item) => item.text),
    checklistItems: (checklistByPlanId.get(row.id) || []).map((item) => mergeExtra({ id: item.id, text: item.text, position: item.position }, item.extra_json)),
    notes: row.notes,
    lastGeneratedAt: row.last_generated_at,
    lastGeneratedJobId: row.last_generated_job_id,
    lastCompletedAt: row.last_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  }, row.extra_json));

  const jobs = jobRows.map((row) => {
    const quoteRow = quotesByJobId.get(row.id);
    const invoiceRow = invoicesByJobId.get(row.id);

    return mergeExtra({
      id: row.id,
      jobNumber: row.job_number,
      title: row.title,
      description: row.description,
      urgency: row.urgency,
      status: row.status,
      scheduledDate: row.scheduled_date,
      assignedTechnicianId: row.assigned_technician_id || "",
      siteId: row.site_id || "",
      billingType: row.billing_type || "billable",
      warrantyReason: row.warranty_reason || "",
      assignedTechnicianName: row.assigned_technician_name,
      assignedTechnicianAvatarUrl: avatarIds.has(row.assigned_technician_id) ? `/api/media/${encodeURIComponent(avatarIds.get(row.assigned_technician_id))}/thumbnail` : "",
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      jobAddress: row.job_address,
      ocNumber: row.oc_number,
      requesterContact: parseJson(row.requester_contact_json, null),
      onsiteContact: parseJson(row.onsite_contact_json, null),
      billingContact: parseJson(row.billing_contact_json, null),
      maintenancePlanId: row.maintenance_plan_id || "",
      maintenancePlanName: row.maintenance_plan_name,
      maintenanceDueDate: row.maintenance_due_date,
      serviceBoardNote: row.service_board_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      notes: (notesByJobId.get(row.id) || []).map((noteRow) => mergeExtra({
        id: noteRow.id,
        author: noteRow.author,
        text: noteRow.text,
        createdAt: noteRow.created_at,
      }, noteRow.extra_json)),
      photos: (attachmentsByJobId.get(row.id) || []).map((attachmentRow) => mergeExtra({
        id: attachmentRow.id,
        name: attachmentRow.name,
        url: attachmentRow.url,
        path: attachmentRow.path,
        kind: attachmentRow.kind,
        mimeType: attachmentRow.mime_type,
        sizeBytes: attachmentRow.size_bytes,
        createdAt: attachmentRow.created_at || undefined,
      }, attachmentRow.extra_json)),
      quote: quoteRow ? mapQuote(quoteRow, quoteItemsByQuoteId, quoteSendHistoryByQuoteId) : null,
      invoice: invoiceRow ? { ...mapInvoice(invoiceRow, invoiceItemsByInvoiceId, paymentsByInvoiceId, invoiceSendHistoryByInvoiceId), paymentManagement: accountingInvoices.get(invoiceRow.id) || "manual" } : null,
      externalRefs: parseJson(row.external_refs_json, {}),
    }, row.extra_json);
  });

  const exceptions = readMaintenanceExceptions(db, { planIds, jobIds });
  const exceptionByJob = new Map(exceptions.filter((entry) => entry.jobId).map((entry) => [entry.jobId, entry]));
  for (const job of jobs) {
    const occurrence = exceptionByJob.get(job.id);
    if (occurrence) job.maintenanceOccurrenceKey = occurrence.key;
  }
  return {
    meta: parseJson(info?.meta_json, {
      initializedAt: info?.created_at || new Date().toISOString(),
      updatedAt: info?.updated_at || new Date().toISOString(),
    }),
    staff,
    customers,
    contacts,
    jobs,
    deletedJobs: deletedRows
      .filter((row) => row.kind === "job")
      .map((row) => ({ deletedAt: row.deleted_at, job: parseJson(row.payload_json, {}) })),
    deletedCustomers: deletedRows
      .filter((row) => row.kind === "customer")
      .map((row) => ({ deletedAt: row.deleted_at, customer: parseJson(row.payload_json, {}) })),
    deletedInvoices: readRows(db, "deleted_invoices", selection.deletedInvoices, { order: "deleted_at DESC" })
      .map((row) => ({ ...parseJson(row.payload_json, {}), id: row.id, invoiceId: row.invoice_id, jobId: row.job_id, deletedAt: row.deleted_at })),
    quoteTemplate: mapDocumentTemplate(templatesByType.get("quote")) || {},
    invoiceTemplate: mapDocumentTemplate(templatesByType.get("invoice")) || {},
    settings,
    inventoryItems,
    maintenancePlans: maintenancePlans.map((plan) => effectiveMaintenancePlan({ ...maintenancePlanIdentity(plan, customers),
      occurrenceExceptions: exceptions.filter((entry) => entry.planId === plan.id) }, jobs)),
    users: [],
    sessions: [],
  };
}

export function getJobById(db, id) {
  return readWorkspaceRecords(db, { jobs: [id] }).jobs[0] || null;
}

export function getCustomerById(db, id) {
  return readWorkspaceRecords(db, { customers: [id] }).customers[0] || null;
}

export function getMaintenancePlanById(db, id) {
  return readWorkspaceRecords(db, { maintenancePlans: [id] }).maintenancePlans[0] || null;
}

export function getJobsForMaintenancePlan(db, id) {
  return readWorkspaceRecords(db, { jobs: readRows(db, "jobs", [id], { column: "maintenance_plan_id" }).map(row => row.id) }).jobs;
}
