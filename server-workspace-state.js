import { isWorkspaceSecretSettingKey } from "./server-workspace-setting-keys.js";

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
  return mergeExtra({
    id: row.id,
    amount: centsToMoney(row.amount_cents),
    date: row.date,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
  }, row.extra_json);
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

export function loadWorkspaceStateFromDb(db) {
  const info = db.prepare("SELECT * FROM workspace_info WHERE id = 1").get() || null;
  const settingsRows = db.prepare("SELECT * FROM settings ORDER BY key").all();
  const templateRows = db.prepare("SELECT * FROM document_templates ORDER BY type").all();
  const staffRows = db.prepare("SELECT * FROM staff ORDER BY lower(name), created_at").all();
  const customerRows = db.prepare("SELECT * FROM customers ORDER BY lower(name), created_at").all();
  const contactRows = db.prepare("SELECT * FROM customer_contacts ORDER BY customer_id, lower(name), lower(role)").all();
  const siteRows = db.prepare("SELECT * FROM sites ORDER BY customer_id, created_at, lower(label), lower(address)").all();
  const assetRows = db.prepare("SELECT * FROM site_assets ORDER BY site_id, lower(name)").all();
  const accessNoteRows = db.prepare("SELECT * FROM site_access_notes ORDER BY customer_id, updated_at").all();
  const inventoryRows = db.prepare("SELECT * FROM inventory_items ORDER BY lower(name), created_at").all();
  const maintenanceRows = db.prepare("SELECT * FROM maintenance_plans ORDER BY next_due_date, lower(plan_name)").all();
  const checklistRows = db.prepare("SELECT * FROM maintenance_checklist_items ORDER BY maintenance_plan_id, position").all();
  const jobRows = db.prepare("SELECT * FROM jobs ORDER BY COALESCE(job_number, 0) DESC, created_at DESC").all();
  const noteRows = db.prepare("SELECT * FROM job_notes ORDER BY job_id, created_at").all();
  const attachmentRows = db.prepare("SELECT * FROM job_attachments ORDER BY job_id, created_at").all();
  const quoteRows = db.prepare("SELECT * FROM quotes ORDER BY job_id").all();
  const quoteItemRows = db.prepare("SELECT * FROM quote_line_items ORDER BY quote_id, position").all();
  const invoiceRows = db.prepare("SELECT * FROM invoices ORDER BY job_id").all();
  const invoiceItemRows = db.prepare("SELECT * FROM invoice_line_items ORDER BY invoice_id, position").all();
  const paymentRows = db.prepare("SELECT * FROM payments ORDER BY invoice_id, date, created_at").all();
  const sendHistoryRows = db.prepare("SELECT * FROM document_send_history ORDER BY job_id, sent_at").all();
  const deletedRows = db.prepare("SELECT * FROM deleted_records ORDER BY deleted_at DESC").all();

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
    nextSettings[row.key] = parseJson(row.value_json, null);
    return nextSettings;
  }, {});

  const templatesByType = new Map(templateRows.map((row) => [row.type, row]));
  const contactsByCustomerId = rowsByKey(contactRows, "customer_id");

  const staff = staffRows.map((row) => mergeExtra({
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  }, row.extra_json));

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
      contactName: siteRow.contact_name,
      contactPhone: siteRow.contact_phone,
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
    contacts: (contactsByCustomerId.get(row.id) || []).map((contactRow) => mergeExtra({
      id: contactRow.id,
      kind: contactRow.kind,
      siteId: contactRow.site_id || "",
      name: contactRow.name,
      phone: contactRow.phone,
      email: contactRow.email,
      role: contactRow.role,
      notes: contactRow.notes,
    }, contactRow.extra_json)),
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
      assignedTechnicianName: row.assigned_technician_name,
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
      serviceBoardTomorrowDate: row.service_board_tomorrow_date,
      serviceBoardTomorrowOrder: row.service_board_tomorrow_order,
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
      invoice: invoiceRow ? mapInvoice(invoiceRow, invoiceItemsByInvoiceId, paymentsByInvoiceId, invoiceSendHistoryByInvoiceId) : null,
      externalRefs: parseJson(row.external_refs_json, {}),
    }, row.extra_json);
  });

  return {
    meta: parseJson(info?.meta_json, {
      initializedAt: info?.created_at || new Date().toISOString(),
      updatedAt: info?.updated_at || new Date().toISOString(),
    }),
    staff,
    customers,
    jobs,
    deletedJobs: deletedRows
      .filter((row) => row.kind === "job")
      .map((row) => ({ deletedAt: row.deleted_at, job: parseJson(row.payload_json, {}) })),
    deletedCustomers: deletedRows
      .filter((row) => row.kind === "customer")
      .map((row) => ({ deletedAt: row.deleted_at, customer: parseJson(row.payload_json, {}) })),
    quoteTemplate: mapDocumentTemplate(templatesByType.get("quote")) || {},
    invoiceTemplate: mapDocumentTemplate(templatesByType.get("invoice")) || {},
    settings,
    inventoryItems,
    maintenancePlans,
    users: [],
    sessions: [],
  };
}
