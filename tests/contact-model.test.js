import { removeMediaSchemaForLegacyFixture } from "./helpers/workspace-media-schema.js";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { openWorkspaceDb, migrateWorkspaceSchema, readWorkspaceSchemaVersion } from "../server-workspace-db.js";
import { createCustomer, updateCustomer, createCustomerSite, updateCustomerSite, deleteCustomer, restoreCustomer, deleteCustomerSite } from "../server-workspace-customers.js";
import { createContact, updateContact, deleteContact, linkContact, unlinkContact, readContacts, storeContact } from "../server-workspace-contacts.js";
import { createCustomerRouter } from "../server-customer-routes.js";
import { createJob } from "../server-workspace-jobs.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { summarizeWorkspaceDb } from "../server-workspace-summary.js";
import { createWorkspaceSqliteBackupBundle, materializeWorkspaceSqliteBackup, sha256Buffer } from "../server-workspace-backup.js";
import { restoreWorkspaceSqliteBackupPayload } from "../server-workspace-restore.js";
import { getCustomerRelatedContacts, getCustomerDirectContacts, getCustomerBillingContacts, getJobContactGroups, getSiteContacts, getSitePrimaryContact } from "../src/lib/contact-model.js";
import { documentContactSuggestions, createDocumentEmailDraft } from "../src/lib/document-email.js";

const demo = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
const timestamp = "2026-01-02T03:04:05.000Z";
const state = (db) => loadWorkspaceStateFromDb(db);
const rows = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
function database(t, dbPath = ":memory:") {
  const db = openWorkspaceDb({ dbPath }); t.after(() => { if (db.open) db.close(); }); return db;
}
function seed(t, dbPath) {
  const db = database(t, dbPath);
  createCustomer(db, { id: "a", name: "Account A", email: "account@example.test", sites: [{ id: "s1", address: "1 Test St" }, { id: "s2", address: "2 Test St" }] });
  createCustomer(db, { id: "b", name: "Account B", sites: [{ id: "s3", address: "3 Test St" }] });
  createContact(db, { id: "p", name: "Sam Example", position: "Facilities Manager", phone: "0400", email: "sam@example.test" });
  createContact(db, { id: "q", name: "Alex Example", email: "alex@example.test" });
  return db;
}
function schema14(db) {
  removeMediaSchemaForLegacyFixture(db);
  db.exec("DROP TABLE maintenance_service_send_history; DROP TABLE maintenance_service_defects; DROP TABLE maintenance_service_checklist_results; DROP TABLE maintenance_service_reports; DROP TABLE site_contact_links; DROP TABLE customer_contact_links; DROP TABLE contacts; DELETE FROM workspace_schema_migrations WHERE version>=15; UPDATE workspace_info SET schema_version=14; PRAGMA user_version=14;");
}
function legacyFixture(t) {
  const db = database(t); importWorkspaceJsonData(db, demo); schema14(db);
  const jobId = db.prepare("SELECT id FROM jobs ORDER BY id LIMIT 1").get().id;
  const snapshot = '{ "name": "Historical Name", "role": "Accounts", "position": "Director", "phone": "OLD", "email": "old@example.test" }';
  db.prepare("UPDATE jobs SET requester_contact_json=?,onsite_contact_json=?,billing_contact_json=?,external_refs_json=? WHERE id=?").run(snapshot, snapshot, snapshot, '{"quickbooks":{"id":"job-mapping"}}', jobId);
  db.prepare("INSERT INTO document_send_history(id,document_kind,job_id,sent_at,to_email,job_snapshot_json,extra_json) VALUES('legacy-history','invoice',?,?,?, ?,?)").run(jobId, timestamp, "old@example.test", snapshot, '{"to":"old@example.test","cc":"legacy-cc@example.test","bcc":["legacy-bcc@example.test"]}');
  const workspaceId = db.prepare("SELECT workspace_id FROM integration_workspace").get().workspace_id;
  db.prepare("INSERT INTO integration_entity_mappings(id,workspace_id,provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id,created_at,updated_at) VALUES('legacy-mapping',?,'quickbooks','synthetic-tenant','job',?,'external-job',?,?)").run(workspaceId, jobId, timestamp, timestamp);
  db.prepare("INSERT INTO customers(id,name,email,phone,created_at,extra_json) VALUES(?,?,?,?,?,?)").run("legacy", "Legacy Account", "account@legacy.test", "0411", timestamp, JSON.stringify({ billingContactId: "named", contacts: [{ id: "json-only", name: "JSON survivor", position: "Director", externalRefs: { serviceM8: { contactUuid: "external-id" } } }] }));
  db.prepare("INSERT INTO customers(id,name,email,created_at,extra_json) VALUES(?,?,?,?,?)").run("z-other", "Other Account", "other@legacy.test", timestamp, JSON.stringify({ billingContactId: "z-other-primary-contact" }));
  db.prepare("INSERT INTO customers(id,name,email,created_at,extra_json) VALUES(?,?,?,?,?)").run("cross-billing", "Shared billing account", "billing@legacy.test", timestamp, JSON.stringify({ billingContactId: "named" }));
  const site = db.prepare("INSERT INTO sites(id,customer_id,address,contact_name,contact_phone,extra_json) VALUES(?,?,?,?,?,?)");
  site.run("legacy-site", "legacy", "10 Legacy St", "Raw Name", "0402", JSON.stringify({ contactId: "named", contactEmail: "raw@legacy.test" }));
  site.run("legacy-site-2", "legacy", "20 Legacy St", "Same Person", "0403", JSON.stringify({ contactId: "named" }));
  site.run("raw-site", "legacy", "30 Legacy St", "Caretaker", "0404", JSON.stringify({ contactEmail: "care@legacy.test" }));
  site.run("email-site", "legacy", "40 Legacy St", "", "", JSON.stringify({ contactEmail: "emailonly@legacy.test" }));
  site.run("empty-site", "legacy", "50 Legacy St", "", "", "{}");
  site.run("cross-site", "legacy", "60 Legacy St", "Obsolete copy", "", JSON.stringify({ contactId: "z-contact" }));
  site.run("account-site", "legacy", "70 Legacy St", "Legacy Account", "0411", JSON.stringify({ contactId: "legacy-primary-contact", contactEmail: "account@legacy.test" }));
  site.run("foreign-owner-site", "legacy", "80 Legacy St", "", "", "{}");
  const insert = db.prepare("INSERT INTO customer_contacts(id,customer_id,site_id,name,phone,email,role,kind,notes,extra_json) VALUES(?,?,?,?,?,?,?,?,?,?)");
  const contacts = [
    ["named", "legacy", "legacy-site", "Named Person", "0400", "named@legacy.test", "Property Manager", "", "Keep notes", { position: "Facilities Manager" }],
    ["same-name", "legacy", null, "Named Person", "0400", "named@legacy.test", "Custom role", "", "Different identity", {}],
    ["site-only", "legacy", "legacy-site", "Secondary Site Person", "0405", "secondary@legacy.test", "Site contact", "site-primary", "", {}],
    ["legacy-primary-contact", "legacy", null, "Legacy Account", "0411", "account@legacy.test", "Primary contact", "", "", {}],
    ["z-contact", "z-other", null, "Shared elsewhere", "0999", "shared@legacy.test", "Custom role", "", "", {}],
    ["cross-owner-contact", "z-other", "foreign-owner-site", "Cross-owner caretaker", "0888", "cross@legacy.test", "Site contact", "site-primary", "", {}],
    ["z-other-primary-contact", "z-other", null, "Other Account", "", "other@legacy.test", "Primary contact", "", "", {}],
  ];
  for (const contact of contacts) insert.run(...contact.slice(0, 9), JSON.stringify(contact[9]));
  return db;
}

test("14 to 15 preserves every original business row, snapshot byte, amount, ID and mapping; migration is idempotent", (t) => {
  const db = legacyFixture(t);
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  const before = Object.fromEntries(tables.map((table) => [table, rows(db, table)]));
  const financials = summarizeWorkspaceDb(db).financials;
  migrateWorkspaceSchema(db);
  assert.equal(readWorkspaceSchemaVersion(db), 18);
  for (const table of tables) if (!["workspace_info", "workspace_schema_migrations"].includes(table)) assert.deepEqual(rows(db, table), table === "jobs" ? before[table].map(row => ({ ...row, site_id: null, billing_type: "billable", warranty_reason: "" })) : before[table], table);
  assert.deepEqual(summarizeWorkspaceDb(db).financials, financials);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  const after = state(db); migrateWorkspaceSchema(db); assert.deepEqual(state(db), after);
});

test("migration preserves named/table/JSON contacts, positions, custom roles and provenance without value deduplication", (t) => {
  const db = legacyFixture(t); migrateWorkspaceSchema(db);
  const contacts = readContacts(db);
  for (const id of ["named", "same-name", "site-only", "json-only", "z-contact"]) assert.ok(contacts.some((contact) => contact.id === id), id);
  assert.equal(contacts.find((contact) => contact.id === "named").position, "Facilities Manager");
  assert.equal(contacts.find((contact) => contact.id === "named").notes, "Keep notes");
  assert.equal(contacts.find((contact) => contact.id === "json-only").externalRefs.serviceM8.contactUuid, "external-id");
  const customer = state(db).customers.find((entry) => entry.id === "legacy");
  assert.deepEqual(customer.contactAssignments.find((entry) => entry.contactId === "named").roles, ["Property Manager"]);
  assert.equal(customer.contactAssignments.find((entry) => entry.contactId === "named").isBilling, true);
  assert.equal(state(db).customers.find((entry) => entry.id === "cross-billing").contactAssignments[0].contactId, "named");
  assert.equal(state(db).customers.find((entry) => entry.id === "cross-billing").contactAssignments[0].isBilling, true);
});

test("migration handles reusable IDs, site-only records, raw name/phone/email, email-only and empty sites", (t) => {
  const db = legacyFixture(t); migrateWorkspaceSchema(db);
  const customer = state(db).customers.find((entry) => entry.id === "legacy");
  const site = (id) => customer.sites.find((entry) => entry.id === id);
  assert.equal(getSitePrimaryContact(site("legacy-site")).id, "named");
  assert.equal(getSitePrimaryContact(site("legacy-site-2")).id, "named");
  assert.equal(getSiteContacts(site("legacy-site")).length, 2);
  assert.ok(!getCustomerDirectContacts(customer).some((entry) => entry.id === "site-only"));
  assert.equal(getSitePrimaryContact(site("raw-site")).email, "care@legacy.test");
  assert.equal(getSitePrimaryContact(site("email-site")).email, "emailonly@legacy.test");
  assert.equal(getSiteContacts(site("empty-site")).length, 0);
  assert.equal(getSiteContacts(site("account-site")).length, 0);
  assert.equal(getSitePrimaryContact(site("cross-site")).name, "Shared elsewhere");
  assert.equal(getSitePrimaryContact(site("foreign-owner-site")).id, "cross-owner-contact");
  assert.ok(!state(db).customers.find((entry) => entry.id === "z-other").contacts.some((entry) => entry.id === "cross-owner-contact"));
});

test("synthetic account records become account fallbacks and preserve both account fields and billing default", (t) => {
  const db = legacyFixture(t); migrateWorkspaceSchema(db);
  const result = state(db); assert.ok(!result.contacts.some((entry) => entry.id === "legacy-primary-contact" || entry.id === "z-other-primary-contact"));
  assert.equal(result.customers.find((entry) => entry.id === "legacy").phone, "0411");
  const other = result.customers.find((entry) => entry.id === "z-other");
  assert.equal(other.email, "other@legacy.test"); assert.equal(other.billingContactId, "z-other-primary-contact");
  assert.equal(getJobContactGroups(other, null, "billing").at(-1).contacts[0].email, other.email);
});

test("late migration failure rolls back schema, relationships and metadata together", (t) => {
  const db = legacyFixture(t);
  db.exec("CREATE TRIGGER fail_contact_migration BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version=15 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(() => migrateWorkspaceSchema(db), /fixture failure/);
  assert.equal(readWorkspaceSchemaVersion(db), 14); assert.ok(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='contacts'").get());
  db.exec("DROP TRIGGER fail_contact_migration"); migrateWorkspaceSchema(db); assert.equal(readWorkspaceSchemaVersion(db), 18);
});

test("one identity can be direct at two customers and assigned to three sites without acquiring ownership", (t) => {
  const db = seed(t);
  for (const id of ["a", "b"]) linkContact(db, "customer", id, "p", { roles: ["Property Manager"], isBilling: true });
  for (const [site, customer] of [["s1", "a"], ["s2", "a"], ["s3", "b"]]) linkContact(db, "site", site, "p", { roles: ["Caretaker"], isPrimary: true }, customer);
  const result = state(db); assert.equal(result.contacts.length, 2);
  assert.equal(result.contacts[0].siteId, undefined); assert.equal(result.contacts[0].customerId, undefined); assert.equal(result.contacts[0].role, undefined);
  const related = getCustomerRelatedContacts(result.customers.find((entry) => entry.id === "a"));
  assert.equal(related[0].sites.length, 2); assert.equal(related[0].isDirect, true);
  assert.equal(related[0].position, "Facilities Manager"); assert.deepEqual(related[0].roles, ["Property Manager"]);
});

test("multiple billing contacts are deterministic, primary replacement is atomic and SQLite prevents two primaries", (t) => {
  const db = seed(t);
  for (const id of ["p", "q"]) linkContact(db, "customer", "a", id, { isBilling: true, isPrimary: true });
  let customer = state(db).customers.find((entry) => entry.id === "a");
  assert.deepEqual(getCustomerBillingContacts(customer).map((entry) => entry.id), ["q", "p"]);
  assert.equal(customer.contactAssignments.filter((entry) => entry.isPrimary).length, 1);
  assert.throws(() => db.prepare("UPDATE customer_contact_links SET is_primary=1 WHERE customer_id='a'").run(), /UNIQUE/);
  for (const id of ["p", "q"]) linkContact(db, "site", "s1", id, { isPrimary: true }, "a");
  customer = state(db).customers.find((entry) => entry.id === "a");
  assert.equal(getSiteContacts(customer.sites[0])[0].id, "q");
  assert.throws(() => db.prepare("UPDATE site_contact_links SET is_primary=1 WHERE site_id='s1'").run(), /UNIQUE/);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("unlinking customer/site retains the person, other assignments, and distinct site-only display", (t) => {
  const db = seed(t); linkContact(db, "customer", "a", "p", {}); linkContact(db, "site", "s1", "p", { isPrimary: true }, "a");
  unlinkContact(db, "customer", "a", "p");
  let customer = state(db).customers.find((entry) => entry.id === "a");
  assert.equal(getCustomerDirectContacts(customer).length, 0);
  assert.equal(getCustomerRelatedContacts(customer)[0].isDirect, false);
  assert.equal(getCustomerRelatedContacts(customer)[0].sites[0].name, "1 Test St");
  assert.throws(() => deleteContact(db, "p"), (error) => error.statusCode === 409);
  unlinkContact(db, "site", "s1", "p", "a");
  assert.equal(readContacts(db).length, 2); deleteContact(db, "p"); assert.equal(readContacts(db).length, 1);
});

test("contact edits update projections but preserve saved job snapshots byte-for-byte; new jobs use current data", (t) => {
  const db = seed(t); linkContact(db, "customer", "a", "p", { isBilling: true }); linkContact(db, "site", "s1", "p", { isPrimary: true }, "a");
  const job = createJob(db, { customer: { id: "a" }, job: { title: "Snapshot", jobAddress: "1 Test St", requesterContact: { name: "Independent requester", position: "Director" } } });
  assert.equal(job.onsiteContact.position, "Facilities Manager"); assert.equal(job.billingContact.email, "sam@example.test");
  const before = rows(db, "jobs"); updateContact(db, "p", { phone: "9999", position: "Operations Director" });
  assert.deepEqual(rows(db, "jobs"), before);
  const customer = state(db).customers.find((entry) => entry.id === "a");
  assert.equal(customer.contacts[0].phone, "9999"); assert.equal(customer.sites[0].contacts[0].phone, "9999");
  const next = createJob(db, { customer: { id: "a" }, job: { title: "New snapshot", jobAddress: "1 Test St" } });
  assert.equal(next.onsiteContact.phone, "9999"); assert.equal(next.onsiteContact.position, "Operations Director"); assert.equal(next.requesterContact, null);
});

const assignmentContent = (assignments) => assignments.map(({ contactId, roles, isPrimary, isBilling }) => ({ contactId, roles, isPrimary, ...(isBilling === undefined ? {} : { isBilling }) }));

test("Customer editor projection includes Site-only identities once and follows draft ownership without mutation", (t) => {
  const db = seed(t); linkContact(db, "site", "s1", "p", { isPrimary: true, roles: ["Caretaker"] }, "a");
  linkContact(db, "site", "s2", "p", { roles: ["Building Manager"] }, "a");
  const customer = state(db).customers.find((entry) => entry.id === "a"), before = structuredClone(customer);
  const related = getCustomerRelatedContacts({ ...customer, contactAssignments: [] });
  assert.equal(related.length, 1); assert.equal(related[0].isDirect, false);
  assert.deepEqual(related[0].sites.map(({ siteId, roles, isPrimary }) => ({ siteId, roles, isPrimary })), [
    { siteId: "s1", roles: ["Caretaker"], isPrimary: true }, { siteId: "s2", roles: ["Building Manager"], isPrimary: false },
  ]);
  const assigned = getCustomerRelatedContacts({ ...customer, contactAssignments: [{ contactId: "p", isPrimary: true, isBilling: true, roles: ["Property Manager"] }] }, state(db).contacts);
  assert.equal(assigned.length, 1); assert.equal(assigned[0].isDirect, true); assert.equal(assigned[0].isBilling, true);
  assert.deepEqual(assigned[0].roles, ["Property Manager"]); assert.equal(assigned[0].sites.length, 2);
  assert.deepEqual(customer, before);
});

test("Customer editor related contacts are empty only without direct or Site links and preserve matching-text IDs", (t) => {
  const db = seed(t);
  assert.deepEqual(getCustomerRelatedContacts(state(db).customers.find((entry) => entry.id === "a")), []);
  createContact(db, { id: "duplicate", name: "Sam Example", phone: "0400", email: "sam@example.test" });
  for (const id of ["p", "duplicate"]) linkContact(db, "site", "s1", id, { roles: ["Caretaker"] }, "a");
  const contacts = getCustomerRelatedContacts(state(db).customers.find((entry) => entry.id === "a"));
  assert.deepEqual(contacts.map((contact) => contact.id).sort(), ["duplicate", "p"]);
  assert.ok(contacts.every((contact) => !contact.isDirect));
  assert.equal(readContacts(db).length, 3);
});

test("saving unchanged direct assignments neither promotes Site-only contacts nor merges identities", (t) => {
  const db = seed(t); linkContact(db, "site", "s1", "p", { isPrimary: true, roles: ["Caretaker"] }, "a");
  const before = state(db), customer = before.customers.find((entry) => entry.id === "a");
  const saved = updateCustomer(db, "a", { name: customer.name, contactAssignments: customer.contactAssignments });
  assert.deepEqual(saved.contactAssignments, []); assert.equal(getCustomerRelatedContacts(saved)[0].isDirect, false);
  assert.deepEqual(saved.sites.map((site) => assignmentContent(site.contactAssignments)), customer.sites.map((site) => assignmentContent(site.contactAssignments)));
  assert.deepEqual(readContacts(db), before.contacts); assert.equal(readWorkspaceSchemaVersion(db), 18);
});

test("Customer save edits a Site-only shared identity without linking it or changing saved Job contact JSON", (t) => {
  const db = seed(t); linkContact(db, "site", "s1", "p", { isPrimary: true, roles: ["Caretaker"] }, "a");
  linkContact(db, "site", "s3", "p", { isPrimary: true }, "b"); linkContact(db, "customer", "b", "p", { isBilling: true });
  const job = createJob(db, { customer: { id: "a" }, job: { title: "Site-only snapshot", jobAddress: "1 Test St" } });
  const contactJson = () => db.prepare("SELECT requester_contact_json, onsite_contact_json, billing_contact_json, extra_json FROM jobs WHERE id=?").get(job.id);
  const beforeJson = contactJson();
  const before = state(db), customer = before.customers.find((entry) => entry.id === "a");
  const details = { id: "p", name: "Sam Updated", position: "Director", phone: "9999", email: "updated@example.test", notes: "Shared notes" };
  const saved = updateCustomer(db, "a", { contactAssignments: [], contactUpdates: [details] });
  assert.deepEqual(saved.contactAssignments, []); assert.equal(saved.contactUpdates, undefined); assert.equal(saved.extra?.contactUpdates, undefined);
  assert.equal(saved.email, customer.email); assert.equal(saved.phone, customer.phone);
  assert.deepEqual(saved.sites.map((site) => assignmentContent(site.contactAssignments)), customer.sites.map((site) => assignmentContent(site.contactAssignments)));
  const after = state(db); assert.equal(after.contacts.length, before.contacts.length);
  for (const [key, value] of Object.entries(details)) assert.equal(after.contacts.find((contact) => contact.id === "p")[key], value);
  assert.equal(after.customers.find((entry) => entry.id === "b").contacts[0].name, details.name);
  assert.equal(after.customers.find((entry) => entry.id === "b").sites[0].contacts[0].phone, details.phone);
  assert.deepEqual(after.contacts.find((contact) => contact.id === "q"), before.contacts.find((contact) => contact.id === "q"));
  assert.deepEqual(contactJson(), beforeJson);
  assert.equal(readWorkspaceSchemaVersion(db), 18);
});

test("explicit Customer assignment and later removal keep Site links and the normalized identity", (t) => {
  const db = seed(t); linkContact(db, "site", "s1", "p", { isPrimary: true, roles: ["Caretaker"] }, "a");
  const before = state(db).customers.find((entry) => entry.id === "a");
  const assigned = updateCustomer(db, "a", { contactAssignments: [{ contactId: "p", roles: ["Property Manager"], isPrimary: true, isBilling: true }] });
  assert.deepEqual(assignmentContent(assigned.contactAssignments), [{ contactId: "p", roles: ["Property Manager"], isPrimary: true, isBilling: true }]);
  assert.equal(getCustomerRelatedContacts(assigned).length, 1);
  const removed = updateCustomer(db, "a", { contactAssignments: [] });
  assert.deepEqual(removed.contactAssignments, []); assert.equal(getCustomerRelatedContacts(removed)[0].isDirect, false);
  assert.deepEqual(assignmentContent(removed.sites[0].contactAssignments), assignmentContent(before.sites[0].contactAssignments));
  assert.equal(readContacts(db).length, 2);
});

test("contact detail batch and Customer assignments roll back together for malformed, missing or unrelated IDs", (t) => {
  const db = seed(t); linkContact(db, "site", "s1", "p", {}, "a");
  const before = state(db);
  for (const contactUpdates of [null, {}, [null], [{ id: "missing", name: "Wrong" }], [{ id: "q", name: "Unrelated" }]]) {
    assert.throws(() => updateCustomer(db, "a", { name: "Changed", contactUpdates })); assert.deepEqual(state(db), before);
  }
  assert.throws(() => updateCustomer(db, "a", { contactUpdates: [{ id: "p", name: "Temporary" }], contactAssignments: [{ contactId: "missing" }] }), /Contact not found/);
  assert.deepEqual(state(db), before);
});

test("Customer contact updates can accompany an explicit existing assignment and a new identity in one save", (t) => {
  const db = seed(t);
  const saved = updateCustomer(db, "a", { contactUpdates: [{ id: "p", phone: "1234" }], contactAssignments: [
    { contactId: "p", isBilling: true }, { contactId: "new", contact: { name: "New Person", notes: "Draft creation" }, isPrimary: true },
  ] });
  assert.equal(saved.contacts.find((contact) => contact.id === "p").phone, "1234");
  assert.equal(saved.contacts.find((contact) => contact.id === "new").notes, "Draft creation");
  assert.equal(readContacts(db).length, 3);
});

test("Customer save removes one Site assignment by ID, preserving other Sites and duplicate identities", (t) => {
  const db = seed(t);
  createContact(db, { id: "duplicate", name: "Sam Example", phone: "0400", email: "sam@example.test" });
  for (const id of ["p", "duplicate", "q"]) linkContact(db, "site", "s1", id, { isPrimary: id === "p" }, "a");
  linkContact(db, "site", "s2", "p", { roles: ["Caretaker"] }, "a");
  const before = readContacts(db), customer = state(db).customers.find((entry) => entry.id === "a");
  // Even stale hydrated Site input cannot restore an explicitly removed link.
  const saved = updateCustomer(db, "a", { sites: customer.sites, contactAssignments: [], siteContactRemovals: [{ siteId: "s1", contactId: "p" }] });
  assert.deepEqual(saved.contactAssignments, []);
  assert.deepEqual(saved.sites.find((site) => site.id === "s1").contactAssignments.map((link) => link.contactId).sort(), ["duplicate", "q"]);
  assert.ok(saved.sites.find((site) => site.id === "s1").contactAssignments.every((link) => !link.isPrimary));
  assert.equal(saved.sites.find((site) => site.id === "s2").contacts[0].id, "p");
  assert.deepEqual(readContacts(db), before);
  assert.equal(saved.siteContactRemovals, undefined);
  assert.equal(JSON.parse(db.prepare("SELECT extra_json FROM customers WHERE id='a'").get().extra_json).siteContactRemovals, undefined);
});

test("Customer and Site removals remain independent and final removal preserves edits, identities and Job snapshots", (t) => {
  const db = seed(t); linkContact(db, "customer", "a", "p", { isPrimary: true, isBilling: true });
  linkContact(db, "site", "s1", "p", { isPrimary: true }, "a");
  const job = createJob(db, { customer: { id: "a" }, job: { title: "Removal snapshot", jobAddress: "1 Test St", requesterContact: { id: "p", name: "Historical person" } } });
  const snapshots = () => db.prepare("SELECT requester_contact_json, onsite_contact_json, billing_contact_json, extra_json FROM jobs WHERE id=?").get(job.id);
  const before = snapshots();
  let saved = updateCustomer(db, "a", { siteContactRemovals: [{ siteId: "s1", contactId: "p" }] });
  assert.equal(saved.contactAssignments[0].contactId, "p"); assert.deepEqual(saved.sites[0].contactAssignments, []);
  linkContact(db, "site", "s1", "p", { isPrimary: true }, "a");
  saved = updateCustomer(db, "a", { contactAssignments: [] });
  assert.equal(saved.sites[0].contactAssignments[0].contactId, "p");
  saved = updateCustomer(db, "a", { contactAssignments: [], contactUpdates: [{ id: "p", phone: "Updated before final removal" }], siteContactRemovals: [{ siteId: "s1", contactId: "p" }] });
  assert.deepEqual(getCustomerRelatedContacts(saved), []);
  assert.equal(readContacts(db).find((contact) => contact.id === "p").phone, "Updated before final removal");
  assert.equal(readContacts(db).length, 2); assert.deepEqual(snapshots(), before);
  assert.equal(readWorkspaceSchemaVersion(db), 18);
  saved = updateCustomer(db, "a", { contactAssignments: [{ contactId: "p" }] });
  assert.equal(saved.contacts[0].id, "p");
});

test("Site removal validation rolls back Customer fields, identity edits and earlier removals together", (t) => {
  const db = seed(t); linkContact(db, "site", "s1", "p", {}, "a"); linkContact(db, "site", "s3", "p", {}, "b");
  const before = state(db);
  for (const siteContactRemovals of [null, {}, [null], [{}], [{ siteId: "s1", contactId: "missing" }],
    [{ siteId: "missing", contactId: "p" }], [{ siteId: "s1", contactId: "p" }, { siteId: "s3", contactId: "p" }]]) {
    assert.throws(() => updateCustomer(db, "a", { name: "Changed", contactUpdates: [{ id: "p", phone: "Changed" }], siteContactRemovals }));
    assert.deepEqual(state(db), before);
  }
});

test("blank legacy Site identities save without derived Customer assignments or identity edits", (t) => {
  const db = seed(t); storeContact(db, { id: "blank" }, { allowBlank: true });
  linkContact(db, "site", "s1", "blank", { isPrimary: true }, "a");
  const before = readContacts(db);
  const saved = updateCustomer(db, "a", { name: "Changed account", contactAssignments: [] });
  assert.deepEqual(saved.contactAssignments, []); assert.equal(saved.sites[0].contacts[0].id, "blank");
  assert.deepEqual(readContacts(db), before);
  assert.throws(() => updateCustomer(db, "a", { contactUpdates: [{ id: "blank", name: "", phone: "", email: "", position: "", notes: "" }] }), /Enter a contact/);
  const assigned = updateCustomer(db, "a", { contactAssignments: [{ contactId: "blank" }] });
  assert.equal(assigned.contacts[0].id, "blank"); assert.deepEqual(readContacts(db), before);
});

test("site edits and inline site creation keep existing assignments and never write legacy contacts", (t) => {
  const db = seed(t); linkContact(db, "site", "s1", "p", { isPrimary: true }, "a");
  updateCustomerSite(db, "a", "s2", { notes: "Updated" });
  createJob(db, { customer: { id: "a" }, siteInput: { id: "s4", address: "4 Test St", contactAssignments: [{ contactId: "p", isPrimary: true }] }, job: { title: "New site", jobAddress: "4 Test St" } });
  assert.deepEqual(rows(db, "site_contact_links").map((entry) => entry.site_id), ["s1", "s4"]);
  assert.equal(rows(db, "customer_contacts").length, 0);
  assert.ok(rows(db, "sites").every((site) => !site.contact_name && !site.contact_phone));
});

test("customer delete/archive/restore reconnects all IDs and preserves edits to a shared person", (t) => {
  const db = seed(t); linkContact(db, "customer", "a", "p", { isBilling: true, isPrimary: true, roles: ["Property Manager"] }); linkContact(db, "customer", "b", "p", {});
  linkContact(db, "site", "s1", "p", { isPrimary: true, roles: ["Caretaker"] }, "a"); linkContact(db, "site", "s2", "q", { isPrimary: true }, "a");
  deleteCustomer(db, "a"); assert.equal(readContacts(db).length, 2); updateContact(db, "p", { phone: "changed after archive" });
  deleteContact(db, "q"); // An unused person can still be recovered from the archived site projection.
  const restored = restoreCustomer(db, "a");
  assert.equal(restored.contacts[0].phone, "changed after archive"); assert.equal(restored.contacts[0].isBilling, true);
  assert.equal(getSitePrimaryContact(restored.sites.find((entry) => entry.id === "s1")).id, "p");
  assert.equal(getSitePrimaryContact(restored.sites.find((entry) => entry.id === "s2")).id, "q");
  deleteCustomerSite(db, "a", "s1"); assert.equal(readContacts(db).length, 2);
});

test("pre-15 recycle-bin payloads restore through the compatibility boundary", (t) => {
  const db = seed(t);
  const payload = { id: "old", name: "Old archive", email: "archive@example.test", contacts: [{ id: "old-person", name: "Archive person", role: "Accounts" }], billingContactId: "old-person", sites: [{ id: "old-site", address: "90 Old St", contactName: "Caretaker", contactEmail: "care@example.test" }] };
  db.prepare("INSERT INTO deleted_records(id,kind,record_id,deleted_at,payload_json) VALUES('old-archive','customer','old',?,?)").run(timestamp, JSON.stringify(payload));
  const restored = restoreCustomer(db, "old"); assert.equal(restored.contacts[0].isBilling, true); assert.equal(restored.sites[0].contacts[0].email, "care@example.test");
});

test("record saves atomically create people/assignments and roll back invalid IDs, flags and foreign customer sites", (t) => {
  const db = seed(t); const before = state(db);
  assert.throws(() => linkContact(db, "site", "s3", "p", {}, "a"), (error) => error.statusCode === 404);
  assert.throws(() => updateCustomer(db, "a", { contactAssignments: [{ contactId: "new", contact: { name: "Temporary" }, isPrimary: true }, { contactId: "missing" }] }), /Contact not found/);
  assert.throws(() => linkContact(db, "customer", "a", "p", { isBilling: "false" }), /boolean/);
  assert.throws(() => linkContact(db, "customer", "a", "p", { roles: "Accounts" }), /list of names/);
  assert.throws(() => updateCustomer(db, "a", { contactAssignments: {} }), /contacts must be a list/i);
  assert.deepEqual(state(db), before);
  const customer = updateCustomer(db, "a", { contactAssignments: [{ contactId: "new", contact: { name: "Created once", position: "Manager" }, isPrimary: true, isBilling: true }] });
  assert.equal(customer.contacts[0].position, "Manager"); assert.equal(readContacts(db).filter((entry) => entry.id === "new").length, 1);
  assert.throws(() => createCustomerSite(db, "a", { id: "s3", address: "Wrong owner" }), /another customer/);
});

test("contact-aware suggestions prioritise multiple billing contacts and relevant sites, dedupe email, and never add recipients", (t) => {
  const db = seed(t); linkContact(db, "customer", "a", "p", { isBilling: true, isPrimary: true }); linkContact(db, "customer", "a", "q", { isBilling: true });
  const duplicate = createContact(db, { id: "dup", name: "Same mailbox", email: "SAM@example.test" }); linkContact(db, "site", "s1", duplicate.id, {}, "a");
  const extra = createContact(db, { id: "site-person", name: "Site person", email: "site@example.test" }); linkContact(db, "site", "s1", extra.id, {}, "a");
  const customer = state(db).customers.find((entry) => entry.id === "a");
  const job = { jobAddress: "1 Test St", customerEmail: customer.email, billingContact: { email: "historical@example.test" } };
  const before = structuredClone({ customer, job });
  const emails = documentContactSuggestions(job, customer).map((entry) => entry.email);
  assert.deepEqual(emails, ["sam@example.test", "alex@example.test", "historical@example.test", "site@example.test", "account@example.test"]);
  assert.deepEqual(createDocumentEmailDraft({ job }).to, ["historical@example.test"]);
  assert.deepEqual(createDocumentEmailDraft({ job }).cc, []); assert.deepEqual({ customer, job }, before);
  const groups = getJobContactGroups(customer, customer.sites[0], "billing"); assert.equal(groups[0].label, "Billing contacts"); assert.equal(groups[0].contacts.length, 2);
});

test("schema-15 JSON export/import preserves unassigned people, all assignments, flags, roles and positions", (t) => {
  const db = seed(t); linkContact(db, "customer", "a", "p", { isPrimary: true, isBilling: true, roles: ["Custom role"], extra: { importNote: "Customer assignment provenance" } }); linkContact(db, "site", "s1", "p", { isPrimary: true, extra: { importNote: "Site assignment provenance" } }, "a");
  const exported = state(db); const restored = database(t); importWorkspaceJsonData(restored, exported);
  assert.deepEqual(readContacts(restored), readContacts(db));
  assert.deepEqual(rows(restored, "customer_contact_links"), rows(db, "customer_contact_links"));
  assert.deepEqual(rows(restored, "site_contact_links"), rows(db, "site_contact_links"));
});

test("JSON import rolls back a contact count mismatch and ignores person ownership in extra metadata", (t) => {
  const db = seed(t);
  updateContact(db, "p", { extra: { siteId: "s3", customerId: "b", role: "Wrong", externalRefs: { serviceM8: { contactUuid: "p" } } } });
  const contact = readContacts(db).find((entry) => entry.id === "p");
  for (const key of ["siteId", "customerId", "role"]) assert.equal(contact[key], undefined);
  assert.equal(contact.externalRefs.serviceM8.contactUuid, "p");
  const exported = state(db); exported.contacts.push({ ...exported.contacts[0] });
  const restored = database(t); const before = state(restored);
  assert.throws(() => importWorkspaceJsonData(restored, exported), /contacts: source=3, sqlite=2/);
  assert.deepEqual(state(restored), before);
});

test("contact APIs enforce permissions, expose canonical state, validate site ownership and reject linked deletion", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-contact-api-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const db = seed(t, path.join(directory, "elset-workspace.db")); db.close();
  const app = express(); app.use(express.json());
  app.use(createCustomerRouter({ env: { ELSET_DATA_DIR: directory }, requireAuth(req, _res, next) { req.user = { role: req.headers["x-role"] || "admin" }; next(); }, requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403) }));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (url, method, body, role = "admin") => fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { "Content-Type": "application/json", "x-role": role }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request("/api/contacts", "POST", { name: "No permission" }, "technician")).status, 403);
  assert.equal((await request("/api/contacts", "POST", { id: "api", name: "API Person", position: "Manager" })).status, 200);
  const assigned = await request("/api/customers/a/contacts/api", "PUT", { isBilling: true }); assert.equal(assigned.status, 200); assert.ok((await assigned.json()).delta.customers.upsert.find((entry) => entry.id === "a").contacts.some((entry) => entry.id === "api"));
  assert.equal((await request("/api/customers/a/sites/s3/contacts/api", "PUT", {})).status, 404);
  assert.equal((await request("/api/customers/a/sites/s1/contacts/api", "PUT", { isPrimary: true })).status, 200);
  assert.equal((await request("/api/customers/b/contacts/api", "PUT", {})).status, 200);
  assert.equal((await request("/api/customers/a", "PATCH", { contactUpdates: [{ id: "api", name: "Denied" }] }, "technician")).status, 403);
  const sharedEdit = await request("/api/customers/a", "PATCH", { contactUpdates: [{ id: "api", name: "Office updated" }] }, "office");
  assert.equal(sharedEdit.status, 200); const delta = (await sharedEdit.json()).delta;
  assert.equal(delta.contacts.upsert.find((contact) => contact.id === "api").name, "Office updated");
  assert.equal(delta.customers.upsert.find((customer) => customer.id === "b").contacts.find((contact) => contact.id === "api").name, "Office updated");
  assert.equal((await request("/api/customers/a/sites/s1/contacts/p", "PUT", { isPrimary: true })).status, 200);
  assert.equal((await request("/api/customers/a/sites/s2/contacts/p", "PUT", {})).status, 200);
  const removal = { siteContactRemovals: [{ siteId: "s1", contactId: "p" }], contactAssignments: [] };
  assert.equal((await request("/api/customers/a", "PATCH", removal, "technician")).status, 403);
  assert.equal((await request("/api/customers/a/sites/s1/contacts/p", "DELETE", undefined, "technician")).status, 403);
  assert.equal((await request("/api/customers/a/sites/s3/contacts/p", "DELETE")).status, 404);
  assert.equal((await request("/api/customers/a", "PATCH", { siteContactRemovals: [{ siteId: "s3", contactId: "p" }] }, "office")).status, 404);
  const unlinked = await request("/api/customers/a", "PATCH", { siteContactRemovals: removal.siteContactRemovals }, "office");
  assert.equal(unlinked.status, 200);
  const removalDelta = (await unlinked.json()).delta;
  assert.ok(!(removalDelta.contacts?.removeIds || []).includes("p"));
  assert.equal(removalDelta.customers.upsert.find((customer) => customer.id === "a").sites.find((site) => site.id === "s2").contacts[0].id, "p");
  assert.deepEqual(removalDelta.customers.upsert.find((customer) => customer.id === "a").sites.find((site) => site.id === "s1").contactAssignments.map((link) => link.contactId), ["api"]);
  assert.equal((await request("/api/customers/b/contacts/api", "DELETE")).status, 200);
  assert.equal((await request("/api/contacts/api", "DELETE")).status, 409);
  assert.equal((await request("/api/contacts/api", "PATCH", { phone: "123" })).status, 200);
  assert.equal((await request("/api/customers/a/contacts/api", "DELETE")).status, 200);
  assert.equal((await request("/api/contacts/api", "DELETE")).status, 409);
  assert.equal((await request("/api/customers/a/sites/s1/contacts/api", "DELETE")).status, 200);
  assert.equal((await request("/api/contacts/api", "DELETE")).status, 200);
});

for (const legacy of [false, true]) test(`${legacy ? "schema-14" : "schema-15"} backup validates in isolation and restores contacts without touching authentication`, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-contact-backup-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, "elset-workspace.db"), db = seed(t, dbPath), env = { ELSET_DATA_DIR: directory };
  linkContact(db, "customer", "a", "p", { isBilling: true, isPrimary: true }); linkContact(db, "site", "s1", "p", { isPrimary: true }, "a");
  const bundle = await createWorkspaceSqliteBackupBundle({ env });
  if (legacy) {
    schema14(db);
    db.prepare("INSERT INTO customer_contacts(id,customer_id,site_id,name,email,role) VALUES('legacy-person','a','s1','Legacy Person','legacy@example.test','Property Manager')").run();
    db.prepare("UPDATE sites SET contact_name='Legacy Person',extra_json=? WHERE id='s1'").run(JSON.stringify({ contactId: "legacy-person" }));
    db.prepare("UPDATE customers SET extra_json=? WHERE id='a'").run(JSON.stringify({ billingContactId: "legacy-person" }));
    bundle.metadata.workspace.schemaVersion = 14; bundle.metadata.workspace.summary = summarizeWorkspaceDb(db);
    db.pragma("wal_checkpoint(TRUNCATE)"); db.pragma("journal_mode=DELETE"); db.close();
    const buffer = fs.readFileSync(dbPath); const entry = bundle.files.find((file) => file.path === "elset-workspace.db");
    entry.contentBase64 = buffer.toString("base64"); entry.sha256 = sha256Buffer(buffer); entry.sizeBytes = buffer.length;
    bundle.metadata.workspace.sha256 = entry.sha256; bundle.metadata.workspace.sizeBytes = buffer.length;
    // Upgrade the separate target before restoring the old uploaded bytes.
    const target = openWorkspaceDb({ dbPath }); target.close();
  } else db.close();
  const uploaded = JSON.stringify(bundle);
  const staged = materializeWorkspaceSqliteBackup(bundle, path.join(directory, "staged")); assert.equal(staged.validation.schemaVersion, 18); assert.equal(JSON.stringify(bundle), uploaded);
  fs.writeFileSync(path.join(directory, "auth.db"), "synthetic-auth-marker");
  await restoreWorkspaceSqliteBackupPayload(bundle, { env });
  const restored = openWorkspaceDb({ dbPath, readonly: true, migrate: false });
  try {
    assert.equal(readWorkspaceSchemaVersion(restored), 18); assert.deepEqual(restored.pragma("foreign_key_check"), []);
    const customer = state(restored).customers.find((entry) => entry.id === "a");
    const expected = legacy ? "legacy-person" : "p";
    assert.equal(customer.contacts[0].id, expected); assert.equal(customer.contacts[0].isBilling, true); assert.equal(customer.sites[0].contacts[0].id, expected);
  } finally { restored.close(); }
  assert.equal(fs.readFileSync(path.join(directory, "auth.db"), "utf8"), "synthetic-auth-marker");
});
