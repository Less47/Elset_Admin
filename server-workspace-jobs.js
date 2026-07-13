import crypto from "crypto";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const statusValues = new Set(["To Do", "In Progress", "Completed"]);
const urgencyValues = new Set(["Low", "Medium", "High"]);
const customerTypeValues = new Set(["homeowner", "strata", "property-manager", "builder", "business", "government", "other", ""]);
const siteTypeValues = new Set(["residential", "commercial", "industrial", "mixed-use", "other", ""]);

export class WorkspaceJobError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceJobError";
    this.statusCode = statusCode;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function assertPlainObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceJobError(`${label} must be an object.`);
  }
}

function normalizeId(value, label = "ID") {
  const id = String(value || "").trim();
  if (!id) throw new WorkspaceJobError(`${label} is required.`);
  if (id.length > 180) throw new WorkspaceJobError(`${label} is too long.`);
  return id;
}

function text(value) {
  return String(value ?? "");
}

function trimText(value) {
  return text(value).trim();
}

function nullableText(value) {
  const normalized = trimText(value);
  return normalized || null;
}

function normalizeOption(value, allowedValues, fallback = "") {
  const normalized = trimText(value);
  return allowedValues.has(normalized) ? normalized : fallback;
}

function normalizeDateInput(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateInput(value, days) {
  const normalized = normalizeDateInput(value) || normalizeDateInput(new Date());
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return normalizeDateInput(date);
}

function getDefaultTomorrowDate() {
  return addDaysToDateInput(new Date(), 1);
}

function normalizeSiteAddress(address) {
  return text(address).replace(/\s+/g, " ").trim();
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

function pickExtra(record, knownKeys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const extra = {};
  for (const [key, value] of Object.entries(record)) {
    if (!knownKeys.has(key)) extra[key] = value;
  }
  return extra;
}

const customerKnownKeys = new Set([
  "id",
  "name",
  "email",
  "phone",
  "customerType",
  "address",
  "sites",
  "siteAccessNotes",
  "contacts",
  "externalRefs",
  "createdAt",
  "updatedAt",
]);
const siteKnownKeys = new Set([
  "id",
  "label",
  "address",
  "siteType",
  "accessNotes",
  "notes",
  "contactId",
  "contactName",
  "contactPhone",
  "contactEmail",
  "assets",
  "createdAt",
  "updatedAt",
  "ocNumber",
]);
const assetKnownKeys = new Set(["id", "name", "type", "location", "model", "notes", "createdAt", "updatedAt"]);
const accessNoteKnownKeys = new Set(["id", "address", "notes", "updatedAt"]);
const contactKnownKeys = new Set(["id", "kind", "name", "phone", "email", "role", "notes", "siteId"]);
const jobKnownKeys = new Set([
  "id",
  "jobNumber",
  "title",
  "description",
  "urgency",
  "status",
  "scheduledDate",
  "assignedTechnicianId",
  "assignedTechnicianName",
  "customerId",
  "customerName",
  "customerEmail",
  "customerPhone",
  "jobAddress",
  "ocNumber",
  "requesterContact",
  "onsiteContact",
  "billingContact",
  "maintenancePlanId",
  "maintenancePlanName",
  "maintenanceDueDate",
  "serviceBoardTomorrowDate",
  "serviceBoardTomorrowOrder",
  "createdAt",
  "updatedAt",
  "notes",
  "photos",
  "quote",
  "invoice",
  "externalRefs",
]);
const noteKnownKeys = new Set(["id", "author", "text", "createdAt"]);
const attachmentKnownKeys = new Set(["id", "name", "url", "path", "mimeType", "mime_type", "sizeBytes", "size_bytes", "createdAt", "kind"]);

function normalizeContactRecord(contact, fallback = {}) {
  const candidate = {
    ...fallback,
    ...(contact || {}),
  };
  const name = trimText(candidate.name);
  const phone = trimText(candidate.phone);
  const email = trimText(candidate.email);
  const notes = trimText(candidate.notes);
  const role = trimText(candidate.role);
  if (!name && !phone && !email && !notes && !role) return null;

  return {
    id: trimText(candidate.id) || crypto.randomUUID(),
    kind: trimText(candidate.kind),
    name,
    phone,
    email,
    role,
    notes,
    siteId: trimText(candidate.siteId || candidate.site_id),
    extra: pickExtra(candidate, contactKnownKeys),
  };
}

function contactSignature(contact) {
  return [contact.name, contact.role, contact.phone, contact.email, contact.notes].join("|").toLowerCase();
}

function normalizeAssetRecord(asset) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return null;
  return {
    id: trimText(asset.id) || crypto.randomUUID(),
    name: trimText(asset.name) || "Unnamed gate / project",
    type: trimText(asset.type),
    location: trimText(asset.location),
    model: trimText(asset.model),
    notes: trimText(asset.notes),
    createdAt: trimText(asset.createdAt),
    updatedAt: trimText(asset.updatedAt || asset.createdAt) || nowIso(),
    extra: pickExtra(asset, assetKnownKeys),
  };
}

function normalizeAssets(assets) {
  return Array.isArray(assets) ? assets.map(normalizeAssetRecord).filter(Boolean) : [];
}

function normalizeSiteRecord(site, fallbackAddress = "") {
  if (!site || typeof site !== "object" || Array.isArray(site)) return null;
  const address = normalizeSiteAddress(site.address || fallbackAddress);
  if (!address) return null;

  return {
    id: trimText(site.id) || crypto.randomUUID(),
    label: trimText(site.label),
    address,
    siteType: normalizeOption(site.siteType, siteTypeValues),
    accessNotes: trimText(site.accessNotes),
    notes: trimText(site.notes),
    contactId: trimText(site.contactId),
    contactName: trimText(site.contactName),
    contactPhone: trimText(site.contactPhone),
    contactEmail: trimText(site.contactEmail),
    ocNumber: trimText(site.ocNumber),
    createdAt: trimText(site.createdAt) || nowIso(),
    updatedAt: trimText(site.updatedAt || site.createdAt) || nowIso(),
    assets: normalizeAssets(site.assets),
    extra: pickExtra(site, siteKnownKeys),
  };
}

function normalizeSiteAccessNoteRecord(note) {
  if (!note || typeof note !== "object" || Array.isArray(note)) return null;
  const address = normalizeSiteAddress(note.address);
  if (!address) return null;
  return {
    id: trimText(note.id) || crypto.randomUUID(),
    address,
    notes: trimText(note.notes),
    updatedAt: trimText(note.updatedAt || note.createdAt) || nowIso(),
    extra: pickExtra(note, accessNoteKnownKeys),
  };
}

function normalizeSiteAccessNotes(notes, sites) {
  const byAddress = new Map();
  const addNote = (note) => {
    const normalized = normalizeSiteAccessNoteRecord(note);
    if (!normalized) return;
    const key = normalized.address.toLowerCase();
    const existing = byAddress.get(key);
    if (!existing || Date.parse(normalized.updatedAt || "") >= Date.parse(existing.updatedAt || "")) {
      byAddress.set(key, normalized);
    }
  };

  (Array.isArray(notes) ? notes : []).forEach(addNote);
  (Array.isArray(sites) ? sites : [])
    .filter((site) => site.accessNotes)
    .forEach((site) => addNote({
      id: site.id,
      address: site.address,
      notes: site.accessNotes,
      updatedAt: site.updatedAt,
    }));

  return [...byAddress.values()].sort((a, b) => a.address.localeCompare(b.address));
}

function normalizeContacts(customer, sites) {
  const contacts = [];
  const addContact = (contact, fallback = {}) => {
    const normalized = normalizeContactRecord(contact, fallback);
    if (!normalized) return;
    const existingById = contacts.find((entry) => entry.id === normalized.id);
    if (existingById) {
      Object.assign(existingById, {
        ...existingById,
        ...normalized,
        extra: {
          ...(existingById.extra || {}),
          ...(normalized.extra || {}),
        },
      });
      return;
    }
    if (contacts.some((entry) => contactSignature(entry) === contactSignature(normalized))) return;
    contacts.push(normalized);
  };

  (Array.isArray(customer.contacts) ? customer.contacts : []).forEach((contact) => addContact(contact));
  if (customer.email || customer.phone) {
    addContact({
      id: customer.id ? `${customer.id}-primary-contact` : "",
      name: customer.name,
      role: "Primary contact",
      email: customer.email,
      phone: customer.phone,
    });
  }
  (Array.isArray(sites) ? sites : []).forEach((site) => {
    if (!site.contactName && !site.contactPhone && !site.contactEmail) return;
    addContact({
      id: site.contactId || `${site.id}-site-contact`,
      siteId: site.id,
      name: site.contactName,
      role: "Site contact",
      phone: site.contactPhone,
      email: site.contactEmail,
    });
  });

  return contacts.sort((a, b) => (a.name || a.email || a.phone).localeCompare(b.name || b.email || b.phone));
}

function normalizeCustomerRecord(input, fallback = null) {
  assertPlainObject(input, "Customer");
  const now = nowIso();
  const source = {
    ...(fallback || {}),
    ...input,
  };
  const id = trimText(source.id) || crypto.randomUUID();
  const address = normalizeSiteAddress(source.address);
  const sites = [];
  const addSite = (site, fallbackAddress = "") => {
    const normalized = normalizeSiteRecord(site, fallbackAddress);
    if (!normalized) return;
    const existing = sites.find((entry) => entry.id === normalized.id || entry.address.toLowerCase() === normalized.address.toLowerCase());
    if (existing) {
      Object.assign(existing, {
        ...existing,
        ...normalized,
        id: existing.id || normalized.id,
        createdAt: existing.createdAt || normalized.createdAt,
      });
      return;
    }
    sites.push(normalized);
  };

  (Array.isArray(source.sites) ? source.sites : []).forEach((site) => addSite(site));
  if (address && !sites.some((site) => site.address.toLowerCase() === address.toLowerCase())) {
    addSite({ address }, address);
  }

  const customer = {
    id,
    name: trimText(source.name) || "Unnamed customer",
    email: trimText(source.email),
    phone: trimText(source.phone),
    customerType: normalizeOption(source.customerType, customerTypeValues),
    address,
    sites,
    siteAccessNotes: normalizeSiteAccessNotes(source.siteAccessNotes, sites),
    externalRefs: source.externalRefs && typeof source.externalRefs === "object" && !Array.isArray(source.externalRefs)
      ? source.externalRefs
      : {},
    createdAt: trimText(source.createdAt) || now,
    updatedAt: trimText(source.updatedAt || source.createdAt) || now,
    extra: pickExtra(source, customerKnownKeys),
  };
  customer.contacts = normalizeContacts({ ...source, ...customer }, sites);
  return customer;
}

function getCustomerState(db, customerId) {
  return loadWorkspaceStateFromDb(db).customers.find((customer) => customer.id === customerId) || null;
}

function getJobState(db, jobId) {
  return loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === jobId) || null;
}

function ensureJobExists(db, jobId) {
  const row = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
  if (!row) throw new WorkspaceJobError("Job not found.", 404);
}

function ensureStaffExists(db, staffId) {
  if (!staffId) return;
  const row = db.prepare("SELECT id FROM staff WHERE id = ?").get(staffId);
  if (!row) throw new WorkspaceJobError("Assigned staff member not found.", 400);
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new WorkspaceJobError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, 1, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(updatedAt, updatedAt);
}

function replaceCustomerContacts(db, customer) {
  db.prepare("DELETE FROM customer_contacts WHERE customer_id = ?").run(customer.id);
  const insert = db.prepare(`
    INSERT INTO customer_contacts (id, customer_id, site_id, kind, name, phone, email, role, notes, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  customer.contacts.forEach((contact) => {
    insert.run(
      contact.id,
      customer.id,
      contact.siteId || null,
      contact.kind,
      contact.name,
      contact.phone,
      contact.email,
      contact.role,
      contact.notes,
      objectJson(contact.extra)
    );
  });
}

function replaceCustomerSites(db, customer) {
  db.prepare("DELETE FROM sites WHERE customer_id = ?").run(customer.id);
  const insertSite = db.prepare(`
    INSERT INTO sites (
      id, customer_id, label, address, site_type, access_notes, notes, contact_name, contact_phone,
      oc_number, created_at, updated_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAsset = db.prepare(`
    INSERT INTO site_assets (id, site_id, name, type, location, model, notes, created_at, updated_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  customer.sites.forEach((site) => {
    insertSite.run(
      site.id,
      customer.id,
      site.label,
      site.address,
      site.siteType,
      site.accessNotes,
      site.notes,
      site.contactName,
      site.contactPhone,
      site.ocNumber,
      site.createdAt,
      site.updatedAt,
      objectJson({
        ...site.extra,
        ...(site.contactId ? { contactId: site.contactId } : {}),
        ...(site.contactEmail ? { contactEmail: site.contactEmail } : {}),
      })
    );

    site.assets.forEach((asset) => {
      insertAsset.run(
        asset.id,
        site.id,
        asset.name,
        asset.type,
        asset.location,
        asset.model,
        asset.notes,
        asset.createdAt || null,
        asset.updatedAt,
        objectJson(asset.extra)
      );
    });
  });
}

function replaceCustomerAccessNotes(db, customer) {
  db.prepare("DELETE FROM site_access_notes WHERE customer_id = ?").run(customer.id);
  const insert = db.prepare(`
    INSERT INTO site_access_notes (id, customer_id, address, notes, updated_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  customer.siteAccessNotes.forEach((note) => {
    insert.run(note.id, customer.id, note.address, note.notes, note.updatedAt, objectJson(note.extra));
  });
}

function insertOrReplaceCustomer(db, customer) {
  db.prepare(`
    INSERT INTO customers (
      id, name, email, phone, customer_type, address, created_at, updated_at, external_refs_json, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      customer_type = excluded.customer_type,
      address = excluded.address,
      updated_at = excluded.updated_at,
      external_refs_json = excluded.external_refs_json,
      extra_json = excluded.extra_json
  `).run(
    customer.id,
    customer.name,
    customer.email,
    customer.phone,
    customer.customerType,
    customer.address,
    customer.createdAt,
    customer.updatedAt,
    objectJson(customer.externalRefs),
    objectJson(customer.extra)
  );
  replaceCustomerSites(db, customer);
  replaceCustomerAccessNotes(db, customer);
  replaceCustomerContacts(db, customer);
}

function getCustomerBillingContact(customer) {
  const contacts = Array.isArray(customer?.contacts) ? customer.contacts : [];
  return (
    contacts.find((contact) => /billing|account/i.test(`${contact.role || ""} ${contact.kind || ""}`) && (contact.email || contact.phone))
    || contacts.find((contact) => contact.email || contact.phone)
    || (customer?.email || customer?.phone
      ? {
          id: `${customer.id}-primary-contact`,
          name: customer.name,
          role: "Billing contact",
          email: customer.email,
          phone: customer.phone,
        }
      : null)
  );
}

function getCustomerSiteByAddress(customer, address) {
  const normalized = normalizeSiteAddress(address).toLowerCase();
  return (customer?.sites || []).find((site) => normalizeSiteAddress(site.address).toLowerCase() === normalized) || null;
}

function getCustomerSitePrimaryContact(customer, address) {
  const site = getCustomerSiteByAddress(customer, address);
  if (!site) return null;
  const contact = site.contactId
    ? (customer.contacts || []).find((entry) => entry.id === site.contactId)
    : null;
  return contact || (
    site.contactName || site.contactPhone || site.contactEmail
      ? {
          id: site.contactId || `${site.id}-site-contact`,
          name: site.contactName,
          role: "Site contact",
          phone: site.contactPhone,
          email: site.contactEmail,
        }
      : null
  );
}

function normalizeContactSnapshot(contact, fallbackRole) {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) return null;
  const name = trimText(contact.name);
  const phone = trimText(contact.phone);
  const email = trimText(contact.email);
  const role = trimText(contact.role || fallbackRole);
  const notes = trimText(contact.notes);
  const id = trimText(contact.id);
  if (!name && !phone && !email && !notes) return null;
  return {
    id,
    name,
    role,
    phone,
    email,
    notes,
  };
}

function buildContactSnapshot(contact, fallbackRole) {
  return normalizeContactSnapshot(contact, fallbackRole);
}

function allocateJobNumber(db, preferredNumber = null) {
  const preferred = Number(preferredNumber);
  if (Number.isInteger(preferred) && preferred > 0) {
    const existing = db.prepare("SELECT id FROM jobs WHERE job_number = ?").get(preferred);
    if (!existing) return preferred;
  }

  const row = db.prepare("SELECT COALESCE(MAX(job_number), 0) + 1 AS next_number FROM jobs").get();
  return Number(row?.next_number || 1);
}

function getTomorrowPlanningOrder(db, tomorrowDate) {
  const row = db.prepare(`
    SELECT COALESCE(MAX(service_board_tomorrow_order), 0) + 1 AS next_order
      FROM jobs
     WHERE service_board_tomorrow_date = ?
  `).get(tomorrowDate);
  return Number(row?.next_order || 1);
}

function validateExistingSiteForCreate(customer, jobAddress) {
  const normalizedAddress = normalizeSiteAddress(jobAddress);
  if (!normalizedAddress) throw new WorkspaceJobError("Job address is required.");
  if (!Array.isArray(customer.sites) || customer.sites.length === 0) return;
  const matchesSite = customer.sites.some((site) => normalizeSiteAddress(site.address).toLowerCase() === normalizedAddress.toLowerCase());
  const matchesCustomerAddress = normalizeSiteAddress(customer.address).toLowerCase() === normalizedAddress.toLowerCase();
  if (!matchesSite && !matchesCustomerAddress) {
    throw new WorkspaceJobError("Selected site does not belong to the customer.", 400);
  }
}

function addOrReplaceCustomerSite(customer, siteInput, updatedAt = nowIso()) {
  const nextSite = normalizeSiteRecord({ ...siteInput, updatedAt, createdAt: siteInput?.createdAt || updatedAt });
  if (!nextSite) throw new WorkspaceJobError("Site address is required.");
  const existingSite = (customer.sites || []).find((site) =>
    site.id === nextSite.id || normalizeSiteAddress(site.address).toLowerCase() === nextSite.address.toLowerCase()
  );
  if (existingSite) throw new WorkspaceJobError("A site with that ID or address already exists for this customer.", 409);

  return normalizeCustomerRecord({
    ...customer,
    sites: [...(customer.sites || []), nextSite],
    siteAccessNotes: customer.siteAccessNotes || [],
    updatedAt,
  }, customer);
}

function normalizeJobBase(input, customer, {
  existingJob = null,
  jobNumber = null,
  now = nowIso(),
  status = null,
} = {}) {
  assertPlainObject(input, "Job");
  const jobAddress = normalizeSiteAddress(input.jobAddress || existingJob?.jobAddress || customer?.address);
  if (!jobAddress) throw new WorkspaceJobError("Job address is required.");

  const assignedTechnicianId = trimText(input.assignedTechnicianId ?? existingJob?.assignedTechnicianId);
  ensureStaffExists(this?.db, assignedTechnicianId);

  const billingContact = buildContactSnapshot(input.billingContact, "Billing contact")
    || normalizeContactSnapshot(existingJob?.billingContact, "Billing contact")
    || buildContactSnapshot(getCustomerBillingContact(customer), "Billing contact");
  const onsiteContact = buildContactSnapshot(input.onsiteContact, "On-site contact")
    || normalizeContactSnapshot(existingJob?.onsiteContact, "On-site contact")
    || buildContactSnapshot(getCustomerSitePrimaryContact(customer, jobAddress), "On-site contact");
  const requesterContact = Object.prototype.hasOwnProperty.call(input, "requesterContact")
    ? buildContactSnapshot(input.requesterContact, "Requester")
    : normalizeContactSnapshot(existingJob?.requesterContact, "Requester");

  return {
    ...(existingJob || {}),
    ...pickExtra(input, jobKnownKeys),
    id: trimText(input.id || existingJob?.id) || crypto.randomUUID(),
    jobNumber: Number.isInteger(Number(jobNumber ?? existingJob?.jobNumber)) ? Number(jobNumber ?? existingJob?.jobNumber) : null,
    title: trimText(input.title ?? existingJob?.title) || "Untitled job",
    description: trimText(input.description ?? existingJob?.description),
    urgency: normalizeOption(input.urgency ?? existingJob?.urgency, urgencyValues, "Medium"),
    status: normalizeOption(status || input.status || existingJob?.status, statusValues, "To Do"),
    scheduledDate: normalizeDateInput(input.scheduledDate ?? existingJob?.scheduledDate),
    assignedTechnicianId,
    assignedTechnicianName: trimText(input.assignedTechnicianName ?? existingJob?.assignedTechnicianName),
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email || billingContact?.email || "",
    customerPhone: customer.phone || billingContact?.phone || "",
    jobAddress,
    ocNumber: trimText(input.ocNumber ?? existingJob?.ocNumber),
    requesterContact,
    onsiteContact,
    billingContact,
    maintenancePlanId: trimText(input.maintenancePlanId ?? existingJob?.maintenancePlanId),
    maintenancePlanName: trimText(input.maintenancePlanName ?? existingJob?.maintenancePlanName),
    maintenanceDueDate: normalizeDateInput(input.maintenanceDueDate ?? existingJob?.maintenanceDueDate),
    serviceBoardTomorrowDate: normalizeDateInput(input.serviceBoardTomorrowDate ?? existingJob?.serviceBoardTomorrowDate),
    serviceBoardTomorrowOrder:
      input.serviceBoardTomorrowOrder === null || input.serviceBoardTomorrowOrder === undefined
        ? existingJob?.serviceBoardTomorrowOrder ?? null
        : Number(input.serviceBoardTomorrowOrder),
    createdAt: trimText(existingJob?.createdAt || input.createdAt) || now,
    updatedAt: now,
    externalRefs: input.externalRefs && typeof input.externalRefs === "object" && !Array.isArray(input.externalRefs)
      ? input.externalRefs
      : existingJob?.externalRefs || {},
    notes: Array.isArray(existingJob?.notes) ? existingJob.notes : [],
    photos: Array.isArray(existingJob?.photos) ? existingJob.photos : [],
    quote: existingJob?.quote || null,
    invoice: existingJob?.invoice || null,
    extra: pickExtra(input, jobKnownKeys),
  };
}

function normalizeJobBaseWithDb(db, input, customer, options = {}) {
  return normalizeJobBase.call({ db }, input, customer, options);
}

function normalizeNoteInput(input, user = null) {
  assertPlainObject(input, "Note");
  const textValue = trimText(input.text);
  if (!textValue) throw new WorkspaceJobError("Note text is required.");
  return {
    id: trimText(input.id) || crypto.randomUUID(),
    author: trimText(input.author) || trimText(user?.name || user?.username) || "Office",
    text: textValue,
    createdAt: trimText(input.createdAt) || nowIso(),
    extra: pickExtra(input, noteKnownKeys),
  };
}

function normalizePhotoInput(input) {
  assertPlainObject(input, "Photo");
  const name = trimText(input.name);
  const url = trimText(input.url);
  const filePath = trimText(input.path);
  if (!name && !url && !filePath) throw new WorkspaceJobError("Photo metadata must include a name, URL, or path.");
  return {
    id: trimText(input.id) || crypto.randomUUID(),
    kind: trimText(input.kind) || "photo",
    name,
    url,
    path: filePath,
    mimeType: trimText(input.mimeType || input.mime_type),
    sizeBytes: Number.isFinite(Number(input.sizeBytes ?? input.size_bytes)) ? Number(input.sizeBytes ?? input.size_bytes) : null,
    createdAt: trimText(input.createdAt) || nowIso(),
    extra: pickExtra(input, attachmentKnownKeys),
  };
}

function insertJobCore(db, job) {
  db.prepare(`
    INSERT INTO jobs (
      id, job_number, title, description, urgency, status, scheduled_date, assigned_technician_id,
      assigned_technician_name, customer_id, customer_name, customer_email, customer_phone, job_address,
      oc_number, requester_contact_json, onsite_contact_json, billing_contact_json, maintenance_plan_id,
      maintenance_plan_name, maintenance_due_date, service_board_tomorrow_date, service_board_tomorrow_order,
      created_at, updated_at, external_refs_json, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.jobNumber,
    job.title,
    job.description,
    job.urgency,
    job.status,
    job.scheduledDate,
    nullableText(job.assignedTechnicianId),
    job.assignedTechnicianName,
    job.customerId,
    job.customerName,
    job.customerEmail,
    job.customerPhone,
    job.jobAddress,
    job.ocNumber,
    job.requesterContact ? json(job.requesterContact) : null,
    job.onsiteContact ? json(job.onsiteContact) : null,
    job.billingContact ? json(job.billingContact) : null,
    nullableText(job.maintenancePlanId),
    job.maintenancePlanName,
    job.maintenanceDueDate,
    job.serviceBoardTomorrowDate,
    job.serviceBoardTomorrowOrder === null || job.serviceBoardTomorrowOrder === undefined || job.serviceBoardTomorrowOrder === ""
      ? null
      : Number(job.serviceBoardTomorrowOrder),
    job.createdAt,
    job.updatedAt,
    objectJson(job.externalRefs),
    objectJson(job.extra)
  );
}

function insertNote(db, jobId, note) {
  db.prepare(`
    INSERT INTO job_notes (id, job_id, author, text, created_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(note.id, jobId, note.author, note.text, note.createdAt, objectJson(note.extra));
}

function insertPhoto(db, jobId, photo) {
  db.prepare(`
    INSERT INTO job_attachments (id, job_id, kind, name, url, path, mime_type, size_bytes, created_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    photo.id,
    jobId,
    photo.kind,
    photo.name,
    photo.url,
    photo.path,
    photo.mimeType,
    photo.sizeBytes,
    photo.createdAt,
    objectJson(photo.extra)
  );
}

function insertJobTree(db, job) {
  insertJobCore(db, job);
  (Array.isArray(job.notes) ? job.notes : []).forEach((note) => insertNote(db, job.id, normalizeNoteInput(note)));
  (Array.isArray(job.photos) ? job.photos : []).forEach((photo) => insertPhoto(db, job.id, normalizePhotoInput(photo)));
}

function updateJobCore(db, jobId, updates, updatedAt = nowIso()) {
  ensureJobExists(db, jobId);
  const allowedFields = {
    title: "title",
    description: "description",
    urgency: "urgency",
    status: "status",
    scheduledDate: "scheduled_date",
    assignedTechnicianId: "assigned_technician_id",
    assignedTechnicianName: "assigned_technician_name",
    customerName: "customer_name",
    customerEmail: "customer_email",
    customerPhone: "customer_phone",
    jobAddress: "job_address",
    ocNumber: "oc_number",
    requesterContact: "requester_contact_json",
    onsiteContact: "onsite_contact_json",
    billingContact: "billing_contact_json",
    maintenancePlanId: "maintenance_plan_id",
    maintenancePlanName: "maintenance_plan_name",
    maintenanceDueDate: "maintenance_due_date",
    serviceBoardTomorrowDate: "service_board_tomorrow_date",
    serviceBoardTomorrowOrder: "service_board_tomorrow_order",
  };
  const assignments = [];
  const values = [];

  Object.entries(updates).forEach(([key, value]) => {
    const column = allowedFields[key];
    if (!column) return;
    assignments.push(`${column} = ?`);
    if (key.endsWith("Contact")) {
      values.push(value ? json(value) : null);
    } else if (key === "assignedTechnicianId" || key === "maintenancePlanId") {
      values.push(nullableText(value));
    } else if (key === "serviceBoardTomorrowOrder") {
      values.push(value === null || value === undefined || value === "" ? null : Number(value));
    } else {
      values.push(text(value));
    }
  });

  if (assignments.length === 0) return;
  assignments.push("updated_at = ?");
  values.push(updatedAt, jobId);
  db.prepare(`UPDATE jobs SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
}

function syncJobWithCustomer(job, customer) {
  const billingContact = getCustomerBillingContact(customer);
  return {
    ...job,
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email || billingContact?.email || "",
    customerPhone: customer.phone || billingContact?.phone || "",
  };
}

function normalizeDeletedJobPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WorkspaceJobError("Deleted job payload is invalid.", 500);
  }
  return {
    ...payload,
    id: normalizeId(payload.id, "Deleted job ID"),
    jobNumber: Number.isInteger(Number(payload.jobNumber)) && Number(payload.jobNumber) > 0 ? Number(payload.jobNumber) : null,
    title: trimText(payload.title) || "Untitled job",
    description: trimText(payload.description),
    urgency: normalizeOption(payload.urgency, urgencyValues, "Medium"),
    status: normalizeOption(payload.status, statusValues, "To Do"),
    scheduledDate: normalizeDateInput(payload.scheduledDate),
    assignedTechnicianId: trimText(payload.assignedTechnicianId),
    assignedTechnicianName: trimText(payload.assignedTechnicianName),
    customerId: trimText(payload.customerId),
    customerName: trimText(payload.customerName),
    customerEmail: trimText(payload.customerEmail),
    customerPhone: trimText(payload.customerPhone),
    jobAddress: normalizeSiteAddress(payload.jobAddress),
    ocNumber: trimText(payload.ocNumber),
    requesterContact: normalizeContactSnapshot(payload.requesterContact, "Requester"),
    onsiteContact: normalizeContactSnapshot(payload.onsiteContact, "On-site contact"),
    billingContact: normalizeContactSnapshot(payload.billingContact, "Billing contact"),
    maintenancePlanId: trimText(payload.maintenancePlanId),
    maintenancePlanName: trimText(payload.maintenancePlanName),
    maintenanceDueDate: normalizeDateInput(payload.maintenanceDueDate),
    serviceBoardTomorrowDate: normalizeDateInput(payload.serviceBoardTomorrowDate),
    serviceBoardTomorrowOrder: payload.serviceBoardTomorrowOrder === null || payload.serviceBoardTomorrowOrder === undefined
      ? null
      : Number(payload.serviceBoardTomorrowOrder),
    createdAt: trimText(payload.createdAt) || nowIso(),
    updatedAt: nowIso(),
    notes: Array.isArray(payload.notes) ? payload.notes : [],
    photos: Array.isArray(payload.photos) ? payload.photos : [],
    quote: payload.quote || null,
    invoice: payload.invoice || null,
    externalRefs: payload.externalRefs && typeof payload.externalRefs === "object" && !Array.isArray(payload.externalRefs)
      ? payload.externalRefs
      : {},
    extra: pickExtra(payload, jobKnownKeys),
  };
}

function assertDeletedJobHasOnlyCoreRecords(job) {
  if (job.quote || job.invoice) {
    throw new WorkspaceJobError(
      "This deleted job includes quote or invoice records. Restore it after document SQLite writes are implemented.",
      409
    );
  }
}

export function createJob(db, input) {
  assertPlainObject(input);

  return db.transaction(() => {
    const now = nowIso();
    const customerMode = trimText(input.customerMode || "existing");
    const jobInput = input.job && typeof input.job === "object" && !Array.isArray(input.job) ? input.job : input;
    const jobForInsert = { ...jobInput };
    let customer = null;

    if (customerMode === "new") {
      const site = normalizeSiteRecord(input.siteInput);
      if (!site) throw new WorkspaceJobError("A first site address is required for a new customer.");
      if (!normalizeSiteAddress(jobForInsert.jobAddress)) {
        jobForInsert.jobAddress = site.address;
      }
      customer = normalizeCustomerRecord({
        ...(input.customer || {}),
        id: input.customer?.id || crypto.randomUUID(),
        address: site.address,
        sites: [site],
        createdAt: now,
        updatedAt: now,
      });
      if (!trimText(input.customer?.name)) throw new WorkspaceJobError("Customer name is required.");
      if (db.prepare("SELECT id FROM customers WHERE id = ?").get(customer.id)) {
        throw new WorkspaceJobError("A customer with that ID already exists.", 409);
      }
      insertOrReplaceCustomer(db, customer);
    } else {
      const customerId = normalizeId(input.customer?.id || jobInput.customerId, "Customer ID");
      customer = getCustomerState(db, customerId);
      if (!customer) throw new WorkspaceJobError("Customer not found.", 404);
      if (input.siteInput) {
        if (!normalizeSiteAddress(jobForInsert.jobAddress)) {
          jobForInsert.jobAddress = input.siteInput.address;
        }
        customer = addOrReplaceCustomerSite(customer, input.siteInput, now);
        insertOrReplaceCustomer(db, customer);
      } else {
        validateExistingSiteForCreate(customer, jobForInsert.jobAddress || customer.address);
      }
    }

    const normalizedJob = normalizeJobBaseWithDb(db, jobForInsert, customer, {
      jobNumber: allocateJobNumber(db),
      now,
      status: "To Do",
    });
    normalizedJob.notes = [];
    normalizedJob.photos = [];
    normalizedJob.quote = null;
    normalizedJob.invoice = null;

    insertJobCore(db, normalizedJob);
    touchWorkspaceInfo(db, normalizedJob.updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, normalizedJob.id);
  })();
}

export function updateJobDetails(db, jobIdInput, input) {
  assertPlainObject(input, "Job");
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    const existingJob = getJobState(db, jobId);
    if (!existingJob) throw new WorkspaceJobError("Job not found.", 404);
    if (!getCustomerState(db, existingJob.customerId)) throw new WorkspaceJobError("Customer not found.", 404);

    const updates = { ...input };
    if (Object.prototype.hasOwnProperty.call(updates, "status")) {
      updates.status = normalizeOption(updates.status, statusValues, "");
      if (!updates.status) throw new WorkspaceJobError("Job status is invalid.");
    }
    if (Object.prototype.hasOwnProperty.call(updates, "urgency")) {
      updates.urgency = normalizeOption(updates.urgency, urgencyValues, "Medium");
    }
    if (Object.prototype.hasOwnProperty.call(updates, "scheduledDate")) {
      updates.scheduledDate = normalizeDateInput(updates.scheduledDate);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "jobAddress")) {
      updates.jobAddress = normalizeSiteAddress(updates.jobAddress);
      if (!updates.jobAddress) throw new WorkspaceJobError("Job address is required.");
    }
    if (Object.prototype.hasOwnProperty.call(updates, "ocNumber")) {
      updates.ocNumber = trimText(updates.ocNumber);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "assignedTechnicianId")) {
      updates.assignedTechnicianId = trimText(updates.assignedTechnicianId);
      ensureStaffExists(db, updates.assignedTechnicianId);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "requesterContact")) {
      updates.requesterContact = normalizeContactSnapshot(updates.requesterContact, "Requester");
    }
    if (Object.prototype.hasOwnProperty.call(updates, "onsiteContact")) {
      updates.onsiteContact = normalizeContactSnapshot(updates.onsiteContact, "On-site contact");
    }
    if (Object.prototype.hasOwnProperty.call(updates, "billingContact")) {
      updates.billingContact = normalizeContactSnapshot(updates.billingContact, "Billing contact");
    }

    const updatedAt = nowIso();
    updateJobCore(db, jobId, updates, updatedAt);

    if (updates.status === "Completed") {
      clearCompletedTomorrowState(db, existingJob, updatedAt);
    }

    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId);
  })();
}

function clearCompletedTomorrowState(db, job, updatedAt) {
  db.prepare(`
    UPDATE jobs
       SET service_board_tomorrow_date = '',
           service_board_tomorrow_order = NULL,
           updated_at = ?
     WHERE id = ?
  `).run(updatedAt, job.id);
}

export function changeJobStatus(db, jobIdInput, statusInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  const nextStatus = normalizeOption(statusInput, statusValues, "");
  if (!nextStatus) throw new WorkspaceJobError("Job status is invalid.");

  return db.transaction(() => {
    const job = getJobState(db, jobId);
    if (!job) throw new WorkspaceJobError("Job not found.", 404);
    if (job.status === nextStatus) return job;

    const updatedAt = nowIso();
    updateJobCore(db, jobId, { status: nextStatus }, updatedAt);
    if (nextStatus === "Completed") {
      clearCompletedTomorrowState(db, job, updatedAt);
    }
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId);
  })();
}

export function scheduleJob(db, jobIdInput, scheduledDateInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  const scheduledDate = normalizeDateInput(scheduledDateInput);

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const updatedAt = nowIso();
    updateJobCore(db, jobId, { scheduledDate }, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId);
  })();
}

export function planJobForTomorrow(db, jobIdInput, tomorrowDateInput = "") {
  const jobId = normalizeId(jobIdInput, "Job ID");
  const tomorrowDate = normalizeDateInput(tomorrowDateInput) || getDefaultTomorrowDate();

  return db.transaction(() => {
    const job = getJobState(db, jobId);
    if (!job) throw new WorkspaceJobError("Job not found.", 404);
    const updatedAt = nowIso();
    const order = job.serviceBoardTomorrowDate === tomorrowDate && Number.isFinite(Number(job.serviceBoardTomorrowOrder))
      ? Number(job.serviceBoardTomorrowOrder)
      : getTomorrowPlanningOrder(db, tomorrowDate);
    updateJobCore(db, jobId, {
      serviceBoardTomorrowDate: tomorrowDate,
      serviceBoardTomorrowOrder: order,
      scheduledDate: tomorrowDate,
    }, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId);
  })();
}

export function removeJobFromTomorrow(db, jobIdInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const updatedAt = nowIso();
    updateJobCore(db, jobId, {
      serviceBoardTomorrowDate: "",
      serviceBoardTomorrowOrder: null,
      scheduledDate: "",
    }, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId);
  })();
}

export function removeAllJobsFromTomorrow(db, tomorrowDateInput = "") {
  const tomorrowDate = normalizeDateInput(tomorrowDateInput) || getDefaultTomorrowDate();

  return db.transaction(() => {
    const updatedAt = nowIso();
    const result = db.prepare(`
      UPDATE jobs
         SET service_board_tomorrow_date = '',
             service_board_tomorrow_order = NULL,
             scheduled_date = '',
             updated_at = ?
       WHERE service_board_tomorrow_date = ?
    `).run(updatedAt, tomorrowDate);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      tomorrowDate,
      updatedCount: result.changes,
    };
  })();
}

export function deleteJob(db, jobIdInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    const state = loadWorkspaceStateFromDb(db);
    const job = state.jobs.find((entry) => entry.id === jobId);
    if (!job) throw new WorkspaceJobError("Job not found.", 404);

    const deletedAt = nowIso();
    db.prepare(`
      INSERT OR REPLACE INTO deleted_records (id, kind, record_id, deleted_at, payload_json, extra_json)
      VALUES (?, 'job', ?, ?, ?, '{}')
    `).run(`deleted-job:${jobId}`, jobId, deletedAt, json(job));
    db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
    touchWorkspaceInfo(db, deletedAt);
    runForeignKeyCheck(db);
    return {
      deletedAt,
      jobId,
    };
  })();
}

export function restoreDeletedJob(db, jobIdInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");

  return db.transaction(() => {
    const activeJob = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
    if (activeJob) throw new WorkspaceJobError("Job already exists.", 409);

    const row = db.prepare(`
      SELECT payload_json
        FROM deleted_records
       WHERE kind = 'job'
         AND record_id = ?
       LIMIT 1
    `).get(jobId);
    if (!row) throw new WorkspaceJobError("Deleted job not found.", 404);

    let job = normalizeDeletedJobPayload(parseJson(row.payload_json, null));
    assertDeletedJobHasOnlyCoreRecords(job);
    let customer = getCustomerState(db, job.customerId);

    if (!customer) {
      const deletedCustomer = db.prepare(`
        SELECT payload_json
          FROM deleted_records
         WHERE kind = 'customer'
           AND record_id = ?
         LIMIT 1
      `).get(job.customerId);

      if (deletedCustomer) {
        customer = normalizeCustomerRecord(parseJson(deletedCustomer.payload_json, {}));
        insertOrReplaceCustomer(db, customer);
        db.prepare("DELETE FROM deleted_records WHERE kind = 'customer' AND record_id = ?").run(customer.id);
      } else {
        customer = normalizeCustomerRecord({
          id: job.customerId,
          name: job.customerName,
          email: job.customerEmail,
          phone: job.customerPhone,
          address: job.jobAddress,
          sites: job.jobAddress ? [{ address: job.jobAddress }] : [],
          createdAt: job.createdAt,
        });
        insertOrReplaceCustomer(db, customer);
      }
    }

    job = syncJobWithCustomer(job, customer);
    job.jobNumber = allocateJobNumber(db, job.jobNumber);
    job.updatedAt = nowIso();
    ensureStaffExists(db, job.assignedTechnicianId);
    insertJobTree(db, job);
    db.prepare("DELETE FROM deleted_records WHERE kind = 'job' AND record_id = ?").run(jobId);
    touchWorkspaceInfo(db, job.updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId);
  })();
}

export function emptyDeletedJobs(db) {
  return db.transaction(() => {
    const result = db.prepare("DELETE FROM deleted_records WHERE kind = 'job'").run();
    const updatedAt = nowIso();
    touchWorkspaceInfo(db, updatedAt);
    return {
      deletedCount: result.changes,
    };
  })();
}

export function addJobNote(db, jobIdInput, input, user = null) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  const note = normalizeNoteInput(input, user);

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    insertNote(db, jobId, note);
    const updatedAt = note.createdAt || nowIso();
    db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(updatedAt, jobId);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId).notes.find((entry) => entry.id === note.id) || note;
  })();
}

export function addJobPhoto(db, jobIdInput, input) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  const photo = normalizePhotoInput(input);

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    insertPhoto(db, jobId, photo);
    const updatedAt = photo.createdAt || nowIso();
    db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(updatedAt, jobId);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return getJobState(db, jobId).photos.find((entry) => entry.id === photo.id) || photo;
  })();
}

export function deleteJobPhoto(db, jobIdInput, photoIdInput) {
  const jobId = normalizeId(jobIdInput, "Job ID");
  const photoId = normalizeId(photoIdInput, "Photo ID");

  return db.transaction(() => {
    ensureJobExists(db, jobId);
    const result = db.prepare("DELETE FROM job_attachments WHERE job_id = ? AND id = ? AND kind = 'photo'").run(jobId, photoId);
    if (result.changes === 0) throw new WorkspaceJobError("Photo not found.", 404);
    const updatedAt = nowIso();
    db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(updatedAt, jobId);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      jobId,
      photoId,
    };
  })();
}
