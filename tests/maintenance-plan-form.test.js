import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateWorkspaceSchema } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { createMaintenancePlan, updateMaintenancePlan, scheduleMaintenancePlan, getMaintenanceOccurrences } from "../server-workspace-maintenance.js";
import { createCustomerSite, updateCustomerSite } from "../server-workspace-customers.js";
import { maintenanceCustomerSites, maintenancePlanName, canonicalMaintenancePlanInput } from "../src/lib/maintenance-plan.js";
import { getMaintenanceFrequencyMeta, maintenanceFrequencyOptions, normalizeMaintenanceFrequency } from "../src/lib/maintenance-frequency.js";
import { advanceMaintenanceDate, expandMaintenanceOccurrences } from "../src/lib/maintenance-recurrence.js";
import { normalizeStoredData } from "../server-store.js";

const site = { id: "sesame", address: "14 Sesame St, Caroline Springs VIC 3023, Australia", streetAddress: "14 Sesame St", suburb: "Caroline Springs" };
const customers = [
  { id: "north", name: "Northside Apartments", address: site.address, sites: [site], contacts: [{ name: "Adrian", email: "adrian@example.test", phone: "0400 111 222" }] },
  { id: "other", name: "Other Customer", address: "", sites: [{ id: "bay", address: "11 Bay Street, Brighton VIC 3186" }] },
];
const input = { id: "plan", customerId: "north", siteId: "sesame", planName: "Ignore arbitrary client title", siteAddress: "Forged address", frequency: "Biannually", nextDueDate: "2027-03-09", active: true, contractPrice: 0, contractPriceSet: false, estimatedDurationHours: 1, checklist: ["Check safety edges"], notes: "Retain notes" };
function withDb(callback, maintenancePlans = []) {
  const db = new Database(":memory:"); db.pragma("foreign_keys = ON"); migrateWorkspaceSchema(db);
  try { importWorkspaceJsonData(db, { customers, jobs: [], maintenancePlans }); return callback(db); } finally { db.close(); }
}
const read = (db) => loadWorkspaceStateFromDb(db).maintenancePlans.find((entry) => entry.id === "plan");

test("frequency labels and legacy aliases share the existing 1/3/6/12 month keys", () => {
  assert.deepEqual(maintenanceFrequencyOptions.map((entry) => entry.label), ["Monthly", "Quarterly", "Biannually", "Annually"]);
  for (const alias of ["6 Monthly", "six-monthly", "Every 6 Months", "Biannual", "Biannually"]) {
    assert.equal(normalizeMaintenanceFrequency(alias), "six-monthly");
    assert.equal(getMaintenanceFrequencyMeta(alias).intervalMonths, 6);
    assert.equal(advanceMaintenanceDate("2027-03-09", alias), "2027-09-09");
  }
  for (const alias of ["Annual", "Annually", "Yearly", "12 Monthly", "Every 12 Months"]) {
    assert.equal(normalizeMaintenanceFrequency(alias), "annual");
    assert.equal(advanceMaintenanceDate("2027-03-09", alias), "2028-03-09");
  }
  assert.equal(normalizeMaintenanceFrequency("biennial", null), null);
  assert.equal(normalizeMaintenanceFrequency("constructor", null), null);
});

test("canonical naming prefers structured data and safely handles legacy address formats", () => {
  assert.equal(maintenancePlanName(site), "14 Sesame St CAROLINE SPRINGS");
  assert.equal(maintenancePlanName({ addressLine1: " 5 Connor Street ", locality: "Brighton East" }), "5 Connor Street BRIGHTON EAST");
  assert.equal(maintenancePlanName({ addressLine1: "82 Industrial Ave", city: "Westfield" }), "82 Industrial Ave WESTFIELD");
  for (const address of ["14 Sesame St, Caroline Springs VIC 3023, Australia", "14 Sesame St Caroline Springs VIC 3023", "14 Sesame St, Caroline Springs, Victoria 3023, Australia"]) {
    assert.equal(maintenancePlanName({ address }), "14 Sesame St CAROLINE SPRINGS");
  }
  assert.equal(maintenancePlanName({ address: "Unit 3, 1400 Sesame St, Caroline Springs VIC 3023" }), "Unit 3, 1400 Sesame St CAROLINE SPRINGS");
  assert.equal(maintenancePlanName({ address: "Gate entrance near reservoir" }), "Gate entrance near reservoir");
  assert.equal(maintenancePlanName({ address: "14 Sesame St" }), "14 Sesame St");
});

test("create derives authoritative site/name, persists IDs, and preserves unset versus zero", () => withDb((db) => {
  const saved = createMaintenancePlan(db, input);
  assert.equal(saved.planName, "14 Sesame St CAROLINE SPRINGS");
  assert.equal(saved.siteAddress, site.address); assert.equal(saved.siteId, site.id);
  assert.equal(saved.frequency, "six-monthly"); assert.equal(saved.nextDueDate, input.nextDueDate);
  assert.equal(saved.contractPriceSet, false); assert.deepEqual(saved.checklist, input.checklist);
  assert.equal(JSON.parse(db.prepare("SELECT extra_json FROM maintenance_plans WHERE id = 'plan'").get().extra_json).siteId, site.id);
  const updated = updateMaintenancePlan(db, saved.id, { contractPrice: 0, contractPriceSet: true, revision: saved.maintenanceRevision });
  assert.equal(updated.contractPriceSet, true); assert.equal(updated.contractPrice, 0);
}));

test("writes reject missing or cross-customer sites and invalid fields without inserting a plan", () => withDb((db) => {
  for (const patch of [{ siteId: "" }, { siteId: "bay" }, { customerId: "missing" }, { frequency: "biennial" }, { nextDueDate: "2027-02-30" }, { active: "active" }, { estimatedDurationHours: -1 }, { contractPrice: -1 }]) {
    assert.throws(() => createMaintenancePlan(db, { ...input, ...patch }));
    assert.equal(db.prepare("SELECT count(*) n FROM maintenance_plans").get().n, 0);
  }
  const saved = createMaintenancePlan(db, input);
  assert.throws(() => updateMaintenancePlan(db, saved.id, { customerId: "other" }), /Site does not belong/);
  assert.equal(read(db).customerId, "north"); assert.equal(read(db).siteId, "sesame");
}));

test("site selection and later address edits update names without moving the recurrence anchor", () => withDb((db) => {
  const saved = createMaintenancePlan(db, input);
  const before = getMaintenanceOccurrences(db, "2027-01-01", "2028-12-31").map(({ key, date }) => ({ key, date }));
  updateCustomerSite(db, "north", "sesame", { address: "5 Connor Street, Brighton East VIC 3187" });
  assert.equal(read(db).planName, "5 Connor Street BRIGHTON EAST");
  assert.deepEqual(getMaintenanceOccurrences(db, "2027-01-01", "2028-12-31").map(({ key, date }) => ({ key, date })), before);
  const updated = updateMaintenancePlan(db, saved.id, { customerId: "other", siteId: "bay", planName: "Fake", revision: read(db).maintenanceRevision });
  assert.equal(updated.planName, "11 Bay Street BRIGHTON");
  assert.equal(updated.nextDueDate, input.nextDueDate);
  assert.deepEqual(updated.recurrence, saved.recurrence);
}));

test("optional structured address components survive the existing Site create and JSON normalization paths", () => withDb((db) => {
  const added = createCustomerSite(db, "other", { id: "industrial", address: "82 Industrial Ave, Westfield VIC 3000", addressLine1: "82 Industrial Ave", locality: "Westfield", _inferredProfile: true });
  assert.equal(added.addressLine1, "82 Industrial Ave"); assert.equal(added.locality, "Westfield");
  assert.ok(maintenanceCustomerSites(loadWorkspaceStateFromDb(db).customers.find((entry) => entry.id === "other")).some((entry) => entry.id === "industrial"));
  const normalized = normalizeStoredData({ customers, jobs: [], maintenancePlans: [] });
  assert.equal(normalized.customers[0].sites[0].streetAddress, "14 Sesame St");
  assert.equal(normalized.customers[0].sites[0].suburb, "Caroline Springs");
  const billingOnly = normalizeStoredData({ customers: [{ id: "billing-only", address: "25 Billing Office Road, Melbourne VIC 3000", sites: [] }] });
  assert.equal(maintenanceCustomerSites(billingOnly.customers[0]).length, 0);
  assert.equal(maintenanceCustomerSites(normalizeStoredData(billingOnly).customers[0]).length, 0);
  assert.equal(maintenanceCustomerSites(normalized.customers[0])[0].id, "sesame");
}));

test("legacy no-site plans remain editable while arbitrary replacement addresses are rejected", () => withDb((db) => {
  const original = read(db);
  assert.equal(original.frequency, "six-monthly"); assert.equal(original.siteId, "");
  const updated = updateMaintenancePlan(db, original.id, { notes: "Updated legacy note", frequency: "Biannually", revision: original.maintenanceRevision });
  assert.equal(updated.siteAddress, "Old private gate entrance");
  assert.equal(updated.nextDueDate, "2027-03-09"); assert.deepEqual(updated.recurrence, original.recurrence);
  assert.throws(() => updateMaintenancePlan(db, original.id, { siteAddress: "Different unsaved address" }), /Select a valid site/);
}, [{ ...input, siteId: "", siteAddress: "Old private gate entrance", frequency: "6 Monthly", recurrence: { segments: [{ id: "old-series", anchorDate: "2027-03-09", frequency: "6 Monthly" }] } }]));

test("legacy frequency reads preserve stored rows, occurrence keys, single exceptions and future schedule edits", () => withDb((db) => {
  db.prepare("UPDATE maintenance_plans SET frequency = '6 Monthly' WHERE id = 'plan'").run();
  assert.equal(db.prepare("SELECT frequency FROM maintenance_plans WHERE id = 'plan'").get().frequency, "6 Monthly");
  const original = read(db);
  assert.equal(db.prepare("SELECT frequency FROM maintenance_plans WHERE id = 'plan'").get().frequency, "6 Monthly");
  const dates = getMaintenanceOccurrences(db, "2027-01-01", "2028-12-31");
  assert.deepEqual(dates.map((entry) => entry.date), ["2027-03-09", "2027-09-09", "2028-03-09", "2028-09-09"]);
  const moved = scheduleMaintenancePlan(db, "plan", { occurrenceKey: dates[1].key, nextDueDate: "2027-09-16", scope: "occurrence", revision: original.maintenanceRevision });
  assert.deepEqual(getMaintenanceOccurrences(db, "2027-01-01", "2028-12-31").map((entry) => entry.date), ["2027-03-09", "2027-09-16", "2028-03-09", "2028-09-09"]);
  assert.equal(moved.occurrenceExceptions[0].key, dates[1].key);
  const changed = updateMaintenancePlan(db, "plan", { frequency: "Annually", revision: moved.maintenanceRevision, dateChange: { scope: "schedule", occurrenceKey: moved.nextOccurrence.key } });
  assert.equal(changed.nextDueDate, "2027-03-09");
  assert.deepEqual(getMaintenanceOccurrences(db, "2027-01-01", "2028-12-31").map((entry) => entry.date), ["2027-03-09", "2028-03-09"]);
  const annual = { ...original, frequency: "Yearly", recurrence: { segments: [{ id: "annual-series", anchorDate: "2027-03-09", frequency: "Annual" }] } };
  assert.deepEqual(expandMaintenanceOccurrences(annual, "2027-01-01", "2029-12-31").map((entry) => entry.date), ["2027-03-09", "2028-03-09", "2029-03-09"]);
}, [{ ...input, siteAddress: site.address, frequency: "6 Monthly", recurrence: { segments: [{ id: "old-series", anchorDate: "2027-03-09", frequency: "6 Monthly" }] } }]));

test("JSON workspace server saves use the same site/name authority", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-maintenance-form-json-"));
  try {
    const moduleUrl = new URL("../server-store.js", import.meta.url).href;
    const script = `import assert from 'node:assert/strict'; const {saveData,saveAuthorizedAppState}=await import(${JSON.stringify(moduleUrl)}); saveData(${JSON.stringify({ customers, jobs: [], maintenancePlans: [] })}); const result=saveAuthorizedAppState({role:'admin'},{maintenancePlans:[${JSON.stringify(input)}]}); assert.equal(result.maintenancePlans[0].planName,'14 Sesame St CAROLINE SPRINGS'); assert.equal(result.maintenancePlans[0].siteId,'sesame'); assert.throws(()=>saveAuthorizedAppState({role:'admin'},{maintenancePlans:[{...${JSON.stringify(input)},siteId:'bay'}]}),/Site does not belong/);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, ELSET_DATA_DIR: tempDir }, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tempDir, "app-data.json"))).maintenancePlans[0].siteId, "sesame");
  } finally {
    const target = path.resolve(tempDir);
    if (target.startsWith(path.join(os.tmpdir(), "elset-maintenance-form-json-"))) fs.rmSync(target, { recursive: true, force: true });
  }
});

test("customer/site identity changes leave the explicitly chosen date unchanged", () => {
  const next = canonicalMaintenancePlanInput({ ...input, customerId: "other", siteId: "bay", nextDueDate: "2029-05-21" }, null, customers);
  assert.equal(next.nextDueDate, "2029-05-21"); assert.equal(next.planName, "11 Bay Street BRIGHTON");
});
