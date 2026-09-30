import crypto from "node:crypto";
import { contactRoles, isLegacyAccountContact } from "./src/lib/contact-model.js";

const text = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export function contactJson(value, fallback = {}) { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } }

export class WorkspaceContactError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = "WorkspaceContactError"; this.statusCode = statusCode; }
}

function assertRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceContactError("Contact or assignment must be an object.");
}

function checkRelationships(db) {
  if (db.pragma("foreign_key_check").length) throw new WorkspaceContactError("Contact relationship validation failed.", 500);
}

function write(db, operation) {
  return db.transaction(() => {
    const result = operation();
    checkRelationships(db);
    db.prepare("UPDATE workspace_info SET updated_at = ? WHERE id = 1").run(now());
    return result;
  }).immediate();
}

export function readContacts(db) {
  return db.prepare("SELECT * FROM contacts ORDER BY lower(name), id").all().map((row) => ({
    ...object(contactJson(row.extra_json)), id: row.id, name: row.name, phone: row.phone, email: row.email,
    position: row.position, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export function readContactLinks(db, type) {
  const customer = type === "customer";
  return db.prepare(`SELECT * FROM ${customer ? "customer_contact_links" : "site_contact_links"} ORDER BY is_primary DESC, contact_id`).all().map((row) => ({
    ...object(contactJson(row.extra_json)), [customer ? "customerId" : "siteId"]: row[customer ? "customer_id" : "site_id"],
    contactId: row.contact_id, roles: contactRoles(contactJson(row.roles_json, [])), isPrimary: Boolean(row.is_primary),
    ...(customer ? { isBilling: Boolean(row.is_billing) } : {}), createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

const contactKeys = new Set(["id", "contactId", "name", "phone", "email", "position", "notes", "createdAt", "updatedAt", "extra", "roles", "rolesText", "role", "kind", "customerId", "siteId", "site_id", "isPrimary", "isBilling", "isDirect", "sites"]);
const assignmentKeys = new Set(["contactId", "customerId", "siteId", "roles", "rolesText", "isPrimary", "isBilling", "createdAt", "updatedAt", "extra", "contact"]);
export function storeContact(db, input, { preserveExisting = false, allowBlank = false } = {}) {
  assertRecord(input);
  const id = text(input.id) || crypto.randomUUID();
  if (id.length > 180) throw new WorkspaceContactError("Contact ID is too long.");
  const existing = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  if (existing && preserveExisting) return id;
  const base = existing ? { ...contactJson(existing.extra_json), name: existing.name, phone: existing.phone, email: existing.email, position: existing.position, notes: existing.notes } : {};
  const fields = { ...base, ...input };
  if (!allowBlank && ![fields.name, fields.phone, fields.email, fields.position, fields.notes].some((value) => text(value))) throw new WorkspaceContactError("Enter a contact name, phone, email, position or notes.");
  const extra = Object.fromEntries(Object.entries({ ...object(contactJson(existing?.extra_json)), ...object(input.extra), ...input }).filter(([key]) => !contactKeys.has(key)));
  const timestamp = now();
  db.prepare(`INSERT INTO contacts (id,name,phone,email,position,notes,created_at,updated_at,extra_json) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,email=excluded.email,position=excluded.position,notes=excluded.notes,updated_at=excluded.updated_at,extra_json=excluded.extra_json`)
    .run(id, text(fields.name), text(fields.phone), text(fields.email), text(fields.position), text(fields.notes), existing?.created_at || text(input.createdAt) || timestamp, text(input.updatedAt) || timestamp, JSON.stringify(extra));
  return id;
}

function requireContact(db, id) {
  if (!db.prepare("SELECT id FROM contacts WHERE id=?").get(id)) throw new WorkspaceContactError("Contact not found.", 404);
}

function requireOwner(db, type, ownerId, customerId) {
  const row = db.prepare(`SELECT * FROM ${type === "customer" ? "customers" : "sites"} WHERE id=?`).get(ownerId);
  if (!row || (type === "site" && customerId !== undefined && row.customer_id !== customerId)) throw new WorkspaceContactError(`${type === "customer" ? "Customer" : "Site"} not found.`, 404);
}

export function storeContactLink(db, type, ownerId, assignment) {
  assertRecord(assignment);
  for (const flag of ["isPrimary", "isBilling"]) {
    if (assignment[flag] !== undefined && typeof assignment[flag] !== "boolean") throw new WorkspaceContactError(`${flag} must be a boolean.`);
  }
  if (assignment.roles !== undefined && (!Array.isArray(assignment.roles) || assignment.roles.some((role) => typeof role !== "string"))) throw new WorkspaceContactError("Roles must be a list of names.");
  const customer = type === "customer", table = customer ? "customer_contact_links" : "site_contact_links", key = customer ? "customer_id" : "site_id";
  const id = text(assignment.contactId);
  requireContact(db, id);
  const previous = db.prepare(`SELECT * FROM ${table} WHERE ${key}=? AND contact_id=?`).get(ownerId, id);
  const primary = assignment.isPrimary === undefined ? Boolean(previous?.is_primary) : Boolean(assignment.isPrimary);
  const billing = assignment.isBilling === undefined ? Boolean(previous?.is_billing) : Boolean(assignment.isBilling);
  const timestamp = now();
  if (primary) db.prepare(`UPDATE ${table} SET is_primary=0, updated_at=? WHERE ${key}=? AND is_primary=1 AND contact_id<>?`).run(timestamp, ownerId, id);
  const extra = { ...object(contactJson(previous?.extra_json)), ...object(assignment.extra), ...Object.fromEntries(Object.entries(assignment).filter(([field]) => !assignmentKeys.has(field))) };
  db.prepare(`INSERT INTO ${table} (${key},contact_id,roles_json,is_primary,${customer ? "is_billing," : ""}created_at,updated_at,extra_json)
    VALUES (?,?,?,?,${customer ? "?," : ""}?,?,?) ON CONFLICT(${key},contact_id) DO UPDATE SET roles_json=excluded.roles_json,is_primary=excluded.is_primary,${customer ? "is_billing=excluded.is_billing," : ""}updated_at=excluded.updated_at,extra_json=excluded.extra_json`)
    .run(ownerId, id, JSON.stringify(contactRoles(assignment.roles ?? contactJson(previous?.roles_json, []))), Number(primary), ...(customer ? [Number(billing)] : []), previous?.created_at || text(assignment.createdAt) || timestamp, text(assignment.updatedAt) || timestamp, JSON.stringify(extra));
}

export function createContact(db, input) {
  return write(db, () => {
    if (input?.id && db.prepare("SELECT id FROM contacts WHERE id=?").get(text(input.id))) throw new WorkspaceContactError("Contact already exists.", 409);
    const id = storeContact(db, input); return readContacts(db).find((contact) => contact.id === id);
  });
}
export function updateContact(db, contactId, input) {
  assertRecord(input);
  return write(db, () => { requireContact(db, contactId); storeContact(db, { ...input, id: contactId, updatedAt: now() }); return readContacts(db).find((contact) => contact.id === contactId); });
}
export function deleteContact(db, contactId) {
  return write(db, () => {
    requireContact(db, contactId);
    if (db.prepare("SELECT 1 FROM customer_contact_links WHERE contact_id=? UNION ALL SELECT 1 FROM site_contact_links WHERE contact_id=? LIMIT 1").get(contactId, contactId)) throw new WorkspaceContactError("Remove this contact's customer and site assignments before deleting it.", 409);
    db.prepare("DELETE FROM contacts WHERE id=?").run(contactId); return { contactId };
  });
}
export function linkContact(db, type, ownerId, contactId, input, customerId) {
  assertRecord(input);
  return write(db, () => { requireOwner(db, type, ownerId, customerId); storeContactLink(db, type, ownerId, { ...input, contactId, updatedAt: now() }); return { contactId, [type === "customer" ? "customerId" : "siteId"]: ownerId }; });
}
export function unlinkContact(db, type, ownerId, contactId, customerId) {
  return write(db, () => {
    requireOwner(db, type, ownerId, customerId);
    db.prepare(`DELETE FROM ${type === "customer" ? "customer_contact_links" : "site_contact_links"} WHERE ${type === "customer" ? "customer_id" : "site_id"}=? AND contact_id=?`).run(ownerId, contactId);
    return { contactId };
  });
}

// This boundary alone translates pre-15 records. Identity is ONLY the stable ID;
// names, phone numbers and email addresses never merge people.
export function importCustomerContactRelationships(db, customer, { preserveExisting = true, replace = true } = {}) {
  const records = Array.isArray(customer.contacts) ? customer.contacts : [];
  const customerAssignments = Array.isArray(customer.contactAssignments) ? customer.contactAssignments : null;
  const sites = customer.sites || [];
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const pendingSites = new Map(sites.map((site) => [site.id, []]));
  const direct = [];
  function persist(contact, fallbackId) {
    if (isLegacyAccountContact(contact, customer)) return null;
    return storeContact(db, { ...contact, id: contact.id || fallbackId }, { preserveExisting, allowBlank: true });
  }
  if (customerAssignments) {
    for (const assignment of customerAssignments) {
      const seed = assignment.contact || records.find((contact) => contact.id === assignment.contactId);
      const contactId = seed ? storeContact(db, { ...seed, id: assignment.contactId || seed.id, ...(assignment.contact && !preserveExisting ? { updatedAt: now() } : {}) }, { preserveExisting: assignment.contact ? preserveExisting : true, allowBlank: !assignment.contact }) : assignment.contactId;
      direct.push({ ...assignment, contactId });
    }
  } else {
    records.forEach((contact, index) => {
      const contactId = persist(contact, `${customer.id}-legacy-contact-${index}`);
      if (!contactId) return;
      const siteId = contact.siteId || contact.site_id;
      const assignment = { contactId, roles: contactRoles(contact.roles || contact.role), isPrimary: Boolean(contact.isPrimary) || /^(primary|primary contact)$/i.test(contact.role || ""), isBilling: Boolean(contact.isBilling) || customer.billingContactId === contactId };
      if (siteById.has(siteId)) pendingSites.get(siteId).push({ ...assignment, isPrimary: Boolean(contact.isPrimary) || contact.kind === "site-primary" });
      if (!siteById.has(siteId) || (!/^site/i.test(contact.kind || "") && !/^site contact$/i.test(contact.role || "")) || assignment.isBilling) direct.push(assignment);
    });
    const billingId = text(customer.billingContactId);
    if (billingId && db.prepare("SELECT id FROM contacts WHERE id=?").get(billingId)) {
      const assignment = direct.find((entry) => entry.contactId === billingId);
      if (assignment) assignment.isBilling = true;
      else direct.push({ contactId: billingId, roles: [], isPrimary: false, isBilling: true });
    }
  }
  if (replace) db.prepare("DELETE FROM customer_contact_links WHERE customer_id=?").run(customer.id);
  for (const assignment of direct) storeContactLink(db, "customer", customer.id, { ...assignment, ...(!preserveExisting ? { updatedAt: now() } : {}) });
  for (const site of sites) {
    const explicit = Array.isArray(site.contactAssignments);
    const assignments = explicit ? site.contactAssignments.map((assignment) => ({ ...assignment })) : pendingSites.get(site.id);
    if (explicit) {
      for (const assignment of assignments) {
        const seed = assignment.contact || (site.contacts || []).find((contact) => contact.id === assignment.contactId) || records.find((contact) => contact.id === assignment.contactId);
        if (seed) assignment.contactId = storeContact(db, { ...seed, id: assignment.contactId || seed.id, ...(assignment.contact && !preserveExisting ? { updatedAt: now() } : {}) }, { preserveExisting: assignment.contact ? preserveExisting : true, allowBlank: !assignment.contact });
      }
    } else {
      const legacy = { ...object(site.extra), ...site };
      let meaningful = [legacy.contactName, legacy.contactPhone, legacy.contactEmail].some((value) => text(value));
      let contactId = text(legacy.contactId);
      if (isLegacyAccountContact({ id: contactId, name: legacy.contactName, phone: legacy.contactPhone, email: legacy.contactEmail }, customer)) {
        // Old pickers could assign the account placeholder to a site. Its details
        // remain on the account and in the retained legacy columns, not as a person.
        contactId = ""; meaningful = false;
      }
      if (contactId && !db.prepare("SELECT id FROM contacts WHERE id=?").get(contactId) && !meaningful) contactId = "";
      if (meaningful || contactId) {
        contactId ||= [`${site.id}:primary-contact`, `${site.id}-site-contact`].find((id) => db.prepare("SELECT id FROM contacts WHERE id=?").get(id)) || `${site.id}-site-contact`;
        storeContact(db, { id: contactId, name: legacy.contactName, phone: legacy.contactPhone, email: legacy.contactEmail, createdAt: site.createdAt }, { preserveExisting: true, allowBlank: true });
        for (const assignment of assignments) assignment.isPrimary = false;
        const previous = assignments.find((assignment) => assignment.contactId === contactId);
        if (previous) previous.isPrimary = true;
        else assignments.push({ contactId, roles: ["Site contact"], isPrimary: true });
      } else if (assignments.length === 1) assignments[0].isPrimary = true;
    }
    if (replace) db.prepare("DELETE FROM site_contact_links WHERE site_id=?").run(site.id);
    for (const assignment of assignments) storeContactLink(db, "site", site.id, { ...assignment, ...(!preserveExisting ? { updatedAt: now() } : {}) });
  }
}

// Run after all owners during legacy migration/import: old site_id values could
// reference another customer's site. Preserve those memberships without granting
// ordinary owner-edit APIs permission to modify another customer's sites.
export function importLegacyCrossCustomerSiteContacts(db, customers) {
  for (const customer of customers) {
    if (Array.isArray(customer.contactAssignments)) continue;
    for (const [index, contact] of (customer.contacts || []).entries()) {
      const siteId = contact.siteId || contact.site_id;
      const site = siteId && db.prepare("SELECT customer_id FROM sites WHERE id=?").get(siteId);
      if (!site || site.customer_id === customer.id || isLegacyAccountContact(contact, customer)) continue;
      const primary = !db.prepare("SELECT 1 FROM site_contact_links WHERE site_id=? AND is_primary=1").get(siteId);
      const contactId = contact.id || `${customer.id}-legacy-contact-${index}`;
      storeContactLink(db, "site", siteId, { contactId, roles: contactRoles(contact.roles || contact.role), isPrimary: primary });
      if ((/^site/i.test(contact.kind || "") || /^site contact$/i.test(contact.role || "")) && !contact.isBilling && customer.billingContactId !== contact.id) {
        db.prepare("DELETE FROM customer_contact_links WHERE customer_id=? AND contact_id=?").run(customer.id, contactId);
      }
    }
  }
}
