import crypto from "crypto";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const customerTypeValues = new Set(["homeowner", "strata", "property-manager", "builder", "business", "government", "other", ""]);
const siteTypeValues = new Set(["residential", "commercial", "industrial", "mixed-use", "other", ""]);

export class WorkspaceCustomerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceCustomerError";
    this.statusCode = statusCode;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function assertPlainObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceCustomerError(`${label} must be an object.`);
  }
}

function normalizeId(value, label = "ID") {
  const id = String(value || "").trim();
  if (!id) {
    throw new WorkspaceCustomerError(`${label} is required.`);
  }
  if (id.length > 180) {
    throw new WorkspaceCustomerError(`${label} is too long.`);
  }
  return id;
}

function text(value) {
  return String(value ?? "");
}

function trimText(value) {
  return text(value).trim();
}

function normalizeOption(value, allowedValues) {
  const normalized = trimText(value);
  return allowedValues.has(normalized) ? normalized : "";
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
    if (!knownKeys.has(key)) {
      extra[key] = value;
    }
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
  "contactName",
  "contactPhone",
  "assets",
  "createdAt",
  "updatedAt",
  "ocNumber",
]);
const assetKnownKeys = new Set(["id", "name", "type", "location", "model", "notes", "createdAt", "updatedAt"]);
const accessNoteKnownKeys = new Set(["id", "address", "notes", "updatedAt"]);
const contactKnownKeys = new Set(["id", "kind", "name", "phone", "email", "role", "notes", "siteId"]);

function normalizeContactRecord(contact, fallback = {}) {
  if (!contact && !fallback) return null;
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
    contactName: trimText(site.contactName),
    contactPhone: trimText(site.contactPhone),
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
    if (!normalized) return null;
    const signature = contactSignature(normalized);
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
      return existingById;
    }
    const existing = contacts.find((entry) => contactSignature(entry) === signature);
    if (existing) return existing;
    contacts.push(normalized);
    return normalized;
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
    const contactEmail = trimText(site.extra?.contactEmail);
    const contactId = trimText(site.extra?.contactId);
    if (!site.contactName && !site.contactPhone && !contactEmail) return;
    addContact({
      id: contactId || `${site.id}-site-contact`,
      siteId: site.id,
      name: site.contactName,
      role: "Site contact",
      phone: site.contactPhone,
      email: contactEmail,
    });
  });

  return contacts.sort((a, b) => (a.name || a.email || a.phone).localeCompare(b.name || b.email || b.phone));
}

function normalizeCustomerInput(input, existingCustomer = null) {
  assertPlainObject(input);
  const now = nowIso();
  const source = {
    ...(existingCustomer || {}),
    ...input,
  };

  if (input.primarySiteType || input.primaryOcNumber) {
    const primaryAddress = normalizeSiteAddress(source.address);
    if (primaryAddress && !Array.isArray(input.sites)) {
      source.sites = [
        {
          id: crypto.randomUUID(),
          address: primaryAddress,
          siteType: input.primarySiteType,
          ocNumber: input.primaryOcNumber,
          createdAt: now,
          updatedAt: now,
        },
      ];
    }
  }

  const customerId = trimText(source.id) || crypto.randomUUID();
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
    id: customerId,
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
    updatedAt: trimText(source.updatedAt) || now,
    extra: pickExtra(source, customerKnownKeys),
  };
  customer.contacts = normalizeContacts({ ...source, ...customer }, sites);

  return customer;
}

function ensureCustomerExists(db, customerId) {
  const row = db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId);
  if (!row) {
    throw new WorkspaceCustomerError("Customer not found.", 404);
  }
}

function getCustomerState(db, customerId) {
  return loadWorkspaceStateFromDb(db).customers.find((customer) => customer.id === customerId) || null;
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new WorkspaceCustomerError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, 1, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(updatedAt, updatedAt);
}

function insertServiceM8Ref(db, entityType, entityId, externalRefs) {
  db.prepare("DELETE FROM service_m8_refs WHERE entity_type = ? AND entity_id = ?").run(entityType, entityId);
  const serviceM8 = externalRefs?.serviceM8;
  if (!serviceM8 || typeof serviceM8 !== "object") return;
  db.prepare(`
    INSERT INTO service_m8_refs (id, entity_type, entity_id, service_m8_uuid, generated_job_id, imported_at, edit_date, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
      objectJson(site.extra)
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
  insertServiceM8Ref(db, "customer", customer.id, customer.externalRefs);
}

function syncJobCustomerSnapshots(db, customer, updatedAt = nowIso()) {
  db.prepare(`
    UPDATE jobs
       SET customer_name = ?,
           customer_email = ?,
           customer_phone = ?,
           updated_at = ?
     WHERE customer_id = ?
  `).run(customer.name, customer.email, customer.phone, updatedAt, customer.id);
}

function syncAddressReferences(db, customerId, previousAddress, nextAddress, updatedAt = nowIso()) {
  const oldAddress = normalizeSiteAddress(previousAddress);
  const newAddress = normalizeSiteAddress(nextAddress);
  if (!oldAddress || !newAddress || oldAddress.toLowerCase() === newAddress.toLowerCase()) return;

  db.prepare(`
    UPDATE jobs
       SET job_address = ?,
           updated_at = ?
     WHERE customer_id = ?
       AND lower(job_address) = lower(?)
  `).run(newAddress, updatedAt, customerId, oldAddress);
  db.prepare(`
    UPDATE maintenance_plans
       SET site_address = ?,
           updated_at = ?
     WHERE customer_id = ?
       AND lower(site_address) = lower(?)
  `).run(newAddress, updatedAt, customerId, oldAddress);
}

export function createCustomer(db, input) {
  const customer = normalizeCustomerInput(input);
  if (!trimText(input?.name)) {
    throw new WorkspaceCustomerError("Customer name is required.");
  }

  return db.transaction(() => {
    const existing = db.prepare("SELECT id FROM customers WHERE id = ?").get(customer.id);
    if (existing) {
      throw new WorkspaceCustomerError("A customer with that ID already exists.", 409);
    }
    insertOrReplaceCustomer(db, customer);
    touchWorkspaceInfo(db, customer.updatedAt);
    runForeignKeyCheck(db);
    return getCustomerState(db, customer.id);
  })();
}

export function updateCustomer(db, customerIdInput, input) {
  assertPlainObject(input);
  const customerId = normalizeId(customerIdInput, "Customer ID");

  return db.transaction(() => {
    ensureCustomerExists(db, customerId);
    const existingCustomer = getCustomerState(db, customerId);
    const customer = normalizeCustomerInput({ ...input, id: customerId }, existingCustomer);
    if (!trimText(customer.name)) {
      throw new WorkspaceCustomerError("Customer name is required.");
    }
    insertOrReplaceCustomer(db, customer);
    syncJobCustomerSnapshots(db, customer, customer.updatedAt);
    touchWorkspaceInfo(db, customer.updatedAt);
    runForeignKeyCheck(db);
    return getCustomerState(db, customer.id);
  })();
}

export function deleteCustomer(db, customerIdInput) {
  const customerId = normalizeId(customerIdInput, "Customer ID");

  return db.transaction(() => {
    ensureCustomerExists(db, customerId);
    const state = loadWorkspaceStateFromDb(db);
    const customer = state.customers.find((entry) => entry.id === customerId);
    const relatedJobs = state.jobs.filter((job) => job.customerId === customerId);
    const deletedAt = nowIso();

    db.prepare(`
      INSERT OR REPLACE INTO deleted_records (id, kind, record_id, deleted_at, payload_json, extra_json)
      VALUES (?, 'customer', ?, ?, ?, '{}')
    `).run(`deleted-customer:${customerId}`, customerId, deletedAt, json(customer));

    const insertDeletedJob = db.prepare(`
      INSERT OR REPLACE INTO deleted_records (id, kind, record_id, deleted_at, payload_json, extra_json)
      VALUES (?, 'job', ?, ?, ?, '{}')
    `);
    relatedJobs.forEach((job) => {
      insertDeletedJob.run(`deleted-job:${job.id}`, job.id, deletedAt, json(job));
    });

    db.prepare("DELETE FROM maintenance_plans WHERE customer_id = ?").run(customerId);
    db.prepare("DELETE FROM jobs WHERE customer_id = ?").run(customerId);
    db.prepare("DELETE FROM service_m8_refs WHERE entity_type = 'customer' AND entity_id = ?").run(customerId);
    db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);

    touchWorkspaceInfo(db, deletedAt);
    runForeignKeyCheck(db);
    return {
      deletedAt,
      customerId,
      deletedJobCount: relatedJobs.length,
    };
  })();
}

export function restoreCustomer(db, customerIdInput) {
  const customerId = normalizeId(customerIdInput, "Customer ID");

  return db.transaction(() => {
    const existing = db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId);
    if (existing) {
      throw new WorkspaceCustomerError("Customer already exists.", 409);
    }

    const deletedRecord = db.prepare(`
      SELECT payload_json
        FROM deleted_records
       WHERE kind = 'customer'
         AND record_id = ?
       LIMIT 1
    `).get(customerId);
    if (!deletedRecord) {
      throw new WorkspaceCustomerError("Deleted customer not found.", 404);
    }

    const restoredPayload = parseJson(deletedRecord.payload_json, null);
    const customer = normalizeCustomerInput({ ...(restoredPayload || {}), id: customerId });
    insertOrReplaceCustomer(db, customer);
    syncJobCustomerSnapshots(db, customer, customer.updatedAt);
    db.prepare("DELETE FROM deleted_records WHERE kind = 'customer' AND record_id = ?").run(customerId);
    touchWorkspaceInfo(db, customer.updatedAt);
    runForeignKeyCheck(db);
    return getCustomerState(db, customerId);
  })();
}

export function createCustomerSite(db, customerIdInput, input) {
  assertPlainObject(input, "Site");
  const customerId = normalizeId(customerIdInput, "Customer ID");

  return db.transaction(() => {
    ensureCustomerExists(db, customerId);
    const customer = getCustomerState(db, customerId);
    const nextSite = normalizeSiteRecord(input);
    if (!nextSite) {
      throw new WorkspaceCustomerError("Site address is required.");
    }

    const duplicate = (customer.sites || []).find((site) =>
      site.id === nextSite.id || normalizeSiteAddress(site.address).toLowerCase() === nextSite.address.toLowerCase()
    );
    if (duplicate) {
      throw new WorkspaceCustomerError("A site with that ID or address already exists for this customer.", 409);
    }

    const nextCustomer = normalizeCustomerInput({
      ...customer,
      sites: [...(customer.sites || []), nextSite],
      siteAccessNotes: customer.siteAccessNotes || [],
      updatedAt: nextSite.updatedAt,
    });
    insertOrReplaceCustomer(db, nextCustomer);
    touchWorkspaceInfo(db, nextSite.updatedAt);
    runForeignKeyCheck(db);
    return getCustomerState(db, customerId).sites.find((site) => site.id === nextSite.id) || null;
  })();
}

export function updateCustomerSite(db, customerIdInput, siteIdInput, input) {
  assertPlainObject(input, "Site");
  const customerId = normalizeId(customerIdInput, "Customer ID");
  const siteId = normalizeId(siteIdInput, "Site ID");

  return db.transaction(() => {
    ensureCustomerExists(db, customerId);
    const customer = getCustomerState(db, customerId);
    const existingSite = (customer.sites || []).find((site) => site.id === siteId);
    if (!existingSite) {
      throw new WorkspaceCustomerError("Site not found.", 404);
    }

    const nextSite = normalizeSiteRecord({ ...existingSite, ...input, id: siteId, createdAt: existingSite.createdAt });
    if (!nextSite) {
      throw new WorkspaceCustomerError("Site address is required.");
    }
    const addressConflict = (customer.sites || []).find((site) =>
      site.id !== siteId && normalizeSiteAddress(site.address).toLowerCase() === nextSite.address.toLowerCase()
    );
    if (addressConflict) {
      throw new WorkspaceCustomerError("Another site already uses that address.", 409);
    }

    const previousAddress = normalizeSiteAddress(input.previousAddress || existingSite.address);
    const customerAddress = normalizeSiteAddress(customer.address);
    const nextCustomerAddress = customerAddress.toLowerCase() === previousAddress.toLowerCase()
      ? nextSite.address
      : customer.address;
    const nextCustomer = normalizeCustomerInput({
      ...customer,
      address: nextCustomerAddress,
      sites: (customer.sites || []).map((site) => (site.id === siteId ? nextSite : site)),
      siteAccessNotes: (customer.siteAccessNotes || []).map((note) => (
        normalizeSiteAddress(note.address).toLowerCase() === previousAddress.toLowerCase()
          ? { ...note, address: nextSite.address, notes: nextSite.accessNotes || note.notes, updatedAt: nextSite.updatedAt }
          : note
      )),
      updatedAt: nextSite.updatedAt,
    });
    insertOrReplaceCustomer(db, nextCustomer);
    syncAddressReferences(db, customerId, previousAddress, nextSite.address, nextSite.updatedAt);
    touchWorkspaceInfo(db, nextSite.updatedAt);
    runForeignKeyCheck(db);
    return getCustomerState(db, customerId).sites.find((site) => site.id === siteId) || null;
  })();
}

export function deleteCustomerSite(db, customerIdInput, siteIdInput) {
  const customerId = normalizeId(customerIdInput, "Customer ID");
  const siteId = normalizeId(siteIdInput, "Site ID");

  return db.transaction(() => {
    ensureCustomerExists(db, customerId);
    const customer = getCustomerState(db, customerId);
    const existingSite = (customer.sites || []).find((site) => site.id === siteId);
    if (!existingSite) {
      throw new WorkspaceCustomerError("Site not found.", 404);
    }

    db.prepare("DELETE FROM sites WHERE customer_id = ? AND id = ?").run(customerId, siteId);
    db.prepare("DELETE FROM site_access_notes WHERE customer_id = ? AND lower(address) = lower(?)").run(customerId, existingSite.address);
    touchWorkspaceInfo(db);
    runForeignKeyCheck(db);
    return {
      customerId,
      siteId,
    };
  })();
}
