import crypto from "crypto";
import { applyCustomerContactUpdates, importCustomerContactRelationships } from "./server-workspace-contacts.js";
import { applyPrimarySiteUpdate, customerPostalFields } from "./src/lib/customer-profile.js";
import {
  archiveMaintenancePlansForCustomer,
  restoreMaintenancePlansForCustomer,
} from "./server-workspace-maintenance.js";
import { getCustomerById, readWorkspaceRecords } from "./server-workspace-state.js";
import { siteAddressMetadata, updatedSiteAddressMetadata } from "./src/lib/site-location.js";
import { archiveJobCostEntries } from "./server-workspace-job-costing.js";

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
  "contactAssignments",
  "billingContactId",
  "externalRefs",
  "createdAt",
  "updatedAt",
]);
const siteKnownKeys = new Set([
  "extra",
  "_inferredProfile",
  "id",
  "label",
  "address",
  "siteType",
  "accessNotes",
  "notes",
  "contactName",
  "contactPhone",
  "contactEmail",
  "contactId",
  "contacts",
  "contactAssignments",
  "assets",
  "createdAt",
  "updatedAt",
  "ocNumber",
]);
const assetKnownKeys = new Set(["id", "name", "type", "location", "model", "notes", "createdAt", "updatedAt"]);
const accessNoteKnownKeys = new Set(["id", "address", "notes", "updatedAt"]);
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

export function normalizeSiteRecord(site, fallbackAddress = "") {
  if (!site || typeof site !== "object" || Array.isArray(site)) return null;
  if (site.contactAssignments !== undefined && !Array.isArray(site.contactAssignments)) throw new WorkspaceCustomerError("Site contacts must be a list.");
  const address = normalizeSiteAddress(site.address || fallbackAddress);
  if (!address) return null;

  return {
    ...siteAddressMetadata(site),
    id: trimText(site.id) || crypto.randomUUID(),
    label: trimText(site.label),
    address,
    siteType: normalizeOption(site.siteType, siteTypeValues),
    accessNotes: trimText(site.accessNotes),
    notes: trimText(site.notes),
    contactName: trimText(site.contactName),
    contactPhone: trimText(site.contactPhone),
    contactEmail: trimText(site.contactEmail ?? site.extra?.contactEmail),
    contactId: trimText(site.contactId ?? site.extra?.contactId),
    ...(Array.isArray(site.contactAssignments) ? { contactAssignments: site.contactAssignments, contacts: site.contacts || [] } : {}),
    ocNumber: trimText(site.ocNumber),
    createdAt: trimText(site.createdAt) || nowIso(),
    updatedAt: trimText(site.updatedAt || site.createdAt) || nowIso(),
    assets: normalizeAssets(site.assets),
    extra: { ...(site.extra || {}), ...pickExtra(site, siteKnownKeys), ...siteAddressMetadata(site) },
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

export function normalizeCustomerInput(input, existingCustomer = null) {
  assertPlainObject(input);
  if (input.contactAssignments !== undefined && !Array.isArray(input.contactAssignments)) throw new WorkspaceCustomerError("Customer contacts must be a list.");
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

  if (Array.isArray(input.contacts) && input.contactAssignments === undefined && existingCustomer) delete source.contactAssignments;

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
    extra: { ...pickExtra(source, customerKnownKeys), ...customerPostalFields(source) },
  };
  customer.contacts = Array.isArray(source.contacts) ? source.contacts : [];
  customer.billingContactId = source.billingContactId || "";
  if (Array.isArray(source.contactAssignments)) customer.contactAssignments = source.contactAssignments;

  return customer;
}

function ensureCustomerExists(db, customerId) {
  const row = db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId);
  if (!row) {
    throw new WorkspaceCustomerError("Customer not found.", 404);
  }
}

function getCustomerState(db, customerId) {
  return getCustomerById(db, customerId);
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

function replaceCustomerSites(db, customer) {
  const ids = new Set(customer.sites.map((site) => site.id));
  for (const row of db.prepare("SELECT id FROM sites WHERE customer_id=?").all(customer.id)) {
    if (!ids.has(row.id)) {
      db.prepare("DELETE FROM workspace_media WHERE owner_type='site' AND owner_id=?").run(row.id);
      db.prepare("DELETE FROM sites WHERE id=? AND customer_id=?").run(row.id, customer.id);
    }
  }
  const insertSite = db.prepare(`
    INSERT INTO sites (
      id, customer_id, label, address, site_type, access_notes, notes, contact_name, contact_phone,
      oc_number, created_at, updated_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label,address=excluded.address,site_type=excluded.site_type,
      access_notes=excluded.access_notes,notes=excluded.notes,oc_number=excluded.oc_number,
      updated_at=excluded.updated_at,extra_json=excluded.extra_json
  `);
  const insertAsset = db.prepare(`
    INSERT INTO site_assets (id, site_id, name, type, location, model, notes, created_at, updated_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  customer.sites.forEach((site) => {
    const existing = db.prepare("SELECT customer_id FROM sites WHERE id=?").get(site.id);
    if (existing && existing.customer_id !== customer.id) throw new WorkspaceCustomerError("Site belongs to another customer.", 409);
    insertSite.run(
      site.id,
      customer.id,
      site.label,
      site.address,
      site.siteType,
      site.accessNotes,
      site.notes,
      "", // Compatibility columns are no longer written; existing values remain intact.
      "",
      site.ocNumber,
      site.createdAt,
      site.updatedAt,
      objectJson(site.extra)
    );

    db.prepare("DELETE FROM site_assets WHERE site_id=?").run(site.id);
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

export function insertOrReplaceCustomer(db, customer, { preserveContacts = false } = {}) {
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
  importCustomerContactRelationships(db, customer, { preserveExisting: preserveContacts });
  insertServiceM8Ref(db, "customer", customer.id, customer.externalRefs);
}

export function syncJobCustomerSnapshots(db, customer, updatedAt = nowIso()) {
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
    const { primarySite, contactUpdates, ...customerFields } = input;
    applyCustomerContactUpdates(db, customerId, contactUpdates, input.contactAssignments);
    const nextCustomer = primarySite === undefined ? existingCustomer : applyPrimarySiteUpdate(existingCustomer, primarySite);
    const customer = normalizeCustomerInput({ ...customerFields, id: customerId }, nextCustomer);
    if (!trimText(customer.name)) {
      throw new WorkspaceCustomerError("Customer name is required.");
    }
    insertOrReplaceCustomer(db, customer);
    syncJobCustomerSnapshots(db, customer, customer.updatedAt);
    if (primarySite !== undefined) syncAddressReferences(db, customerId, existingCustomer.address, customer.address, customer.updatedAt);
    touchWorkspaceInfo(db, customer.updatedAt);
    runForeignKeyCheck(db);
    return getCustomerState(db, customer.id);
  })();
}

export function deleteCustomer(db, customerIdInput) {
  const customerId = normalizeId(customerIdInput, "Customer ID");

  return db.transaction(() => {
    ensureCustomerExists(db, customerId);
    const state = readWorkspaceRecords(db, { customers: [customerId], jobs: db.prepare("SELECT id FROM jobs WHERE customer_id = ?").all(customerId).map(row => row.id) });
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
      archiveJobCostEntries(db, job.id);
    });

    const deletedMaintenancePlanCount = archiveMaintenancePlansForCustomer(db, customerId, deletedAt);
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
      deletedMaintenancePlanCount,
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
    insertOrReplaceCustomer(db, customer, { preserveContacts: true });
    restoreMaintenancePlansForCustomer(db, customerId);
    syncJobCustomerSnapshots(db, customer, customer.updatedAt);
    db.prepare("DELETE FROM deleted_records WHERE kind = 'customer' AND record_id = ?").run(customerId);
    touchWorkspaceInfo(db, customer.updatedAt);
    runForeignKeyCheck(db);
    return getCustomerState(db, customerId);
  })();
}

export function emptyDeletedCustomers(db) {
  return db.transaction(() => {
    for (const row of db.prepare("SELECT payload_json FROM deleted_records WHERE kind='customer'").all()) {
      for (const site of parseJson(row.payload_json, {})?.sites || []) {
        if (!db.prepare("SELECT 1 FROM sites WHERE id=?").get(site.id)) db.prepare("DELETE FROM workspace_media WHERE owner_type='site' AND owner_id=?").run(site.id);
      }
    }
    const result = db.prepare("DELETE FROM deleted_records WHERE kind = 'customer'").run();
    const updatedAt = nowIso();
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      deletedCustomerCount: result.changes,
    };
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

    const nextSite = normalizeSiteRecord({ ...existingSite, ...input, ...updatedSiteAddressMetadata(existingSite, input), id: siteId, createdAt: existingSite.createdAt });
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

    db.prepare("DELETE FROM workspace_media WHERE owner_type='site' AND owner_id=?").run(siteId);
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
