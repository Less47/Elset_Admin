import { contactJson, importCustomerContactRelationships, importLegacyCrossCustomerSiteContacts, storeContact } from "./server-workspace-contacts.js";
import { isLegacyAccountContact } from "./src/lib/contact-model.js";

export const contactSchemaSql = `
  CREATE TABLE contacts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    position TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, extra_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE customer_contact_links (
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
    roles_json TEXT NOT NULL DEFAULT '[]', is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    is_billing INTEGER NOT NULL DEFAULT 0 CHECK (is_billing IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, extra_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (customer_id,contact_id)
  );
  CREATE UNIQUE INDEX customer_contact_one_primary ON customer_contact_links(customer_id) WHERE is_primary=1;
  CREATE INDEX customer_contact_by_contact ON customer_contact_links(contact_id);
  CREATE TABLE site_contact_links (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
    roles_json TEXT NOT NULL DEFAULT '[]', is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, extra_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (site_id,contact_id)
  );
  CREATE UNIQUE INDEX site_contact_one_primary ON site_contact_links(site_id) WHERE is_primary=1;
  CREATE INDEX site_contact_by_contact ON site_contact_links(contact_id);
  UPDATE workspace_info SET schema_version=15 WHERE id=1;
`;

export function migrateLegacyContacts(db) {
  const customers = [];
  for (const row of db.prepare("SELECT * FROM customers ORDER BY id").all()) {
    const contacts = db.prepare("SELECT * FROM customer_contacts WHERE customer_id=? ORDER BY id").all(row.id).map((contact) => ({
      ...contactJson(contact.extra_json), id: contact.id, name: contact.name, phone: contact.phone, email: contact.email,
      role: contact.role, notes: contact.notes, kind: contact.kind, siteId: contact.site_id, createdAt: row.created_at,
    }));
    const extra = contactJson(row.extra_json);
    // Older importers left named contacts in customer extra_json instead of the legacy table.
    for (const contact of Array.isArray(extra.contacts) ? extra.contacts : []) {
      if (!contact.id || !contacts.some((entry) => entry.id === contact.id)) contacts.push(contact);
    }
    const sites = db.prepare("SELECT * FROM sites WHERE customer_id=? ORDER BY id").all(row.id).map((site) => ({
      ...contactJson(site.extra_json), id: site.id, address: site.address, contactName: site.contact_name,
      contactPhone: site.contact_phone, createdAt: site.created_at || row.created_at,
    }));
    // Stale JSON projections are not authoritative in a schema-14 database.
    for (const site of sites) delete site.contactAssignments;
    customers.push({ ...extra, id: row.id, name: row.name, email: row.email, phone: row.phone, contacts, sites, contactAssignments: undefined });
  }
  // Seed every identity first: a site's contactId can refer to another customer's contact.
  for (const customer of customers) customer.contacts.forEach((contact, index) => {
    if (!isLegacyAccountContact(contact, customer)) storeContact(db, { ...contact, id: contact.id || `${customer.id}-legacy-contact-${index}` }, { preserveExisting: true, allowBlank: true });
  });
  for (const customer of customers) importCustomerContactRelationships(db, customer);
  importLegacyCrossCustomerSiteContacts(db, customers);
}
