import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { openWorkspaceDb, migrateWorkspaceSchema, assertWorkspaceSchema } from "../server-workspace-db.js";
import { createJob, updateJobDetails, deleteJob, restoreDeletedJob } from "../server-workspace-jobs.js";
import { insertInvoiceTree, replaceInvoiceForJob, insertQuoteTree, deleteInvoiceForJob, restoreDeletedInvoice } from "../server-workspace-documents.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { normalizeStoredData } from "../server-store.js";
import { createWorkspaceSqliteBackupBundle, materializeWorkspaceSqliteBackup } from "../server-workspace-backup.js";
import { applyServiceM8ImportPlanToSqlite } from "../server-workspace-servicem8-import.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { createJobCostEntry, getJobCostingSummary } from "../server-workspace-job-costing.js";
import { AccountingService } from "../server-accounting-service.js";
import { readAccountingInvoice } from "../server-accounting-workspace.js";
import { safeAccountingError } from "../server-accounting-errors.js";
import { createJobRouter } from "../server-job-routes.js";
import { createDocumentRouter } from "../server-document-routes.js";
import { COST_CATEGORIES } from "../src/lib/job-costing.js";
import { normalizeBillingType, normalizeWarrantyReason, matchesJobBillingFilter } from "../src/lib/job-billing.js";
import { buildJobCardIndicators, getServiceBoardIndicatorLegend } from "../src/components/service-board/service-board-utils.js";
import { invoiceConversionDraft } from "../src/lib/quote-to-invoice.js";
import { buildSemanticTheme, contrastRatio } from "../src/lib/theme-tokens.js";
import { removeBillingSchemaForLegacyFixture } from "./helpers/workspace-billing-schema.js";
import { createMaintenancePlan, getMaintenanceOccurrences, generateMaintenanceJob } from "../server-workspace-maintenance.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
const invoice = { type: "invoice", items: [{ description: "Synthetic service", qty: 1, rate: 120 }], payments: [{ id: "receipt", amount: 10, date: "2026-10-06" }] };
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-billing-test-"));
  const db = openWorkspaceDb({ dbPath: path.join(directory, "elset-workspace.db") });
  const data = structuredClone(fixture);
  data.jobs = [{ ...data.jobs[0], quote: null, invoice: null, notes: [], photos: [], maintenancePlanId: "" }];
  importWorkspaceJsonData(db, data);
  t.after(() => { if (db.open) db.close(); assert.equal(path.dirname(path.resolve(directory)), os.tmpdir()); assert.ok(path.basename(directory).startsWith("elset-billing-test-")); fs.rmSync(directory, { recursive: true, force: true }); });
  const jobId = data.jobs[0].id;
  return { db, directory, jobId, customerId: data.jobs[0].customerId, job: () => loadWorkspaceStateFromDb(db).jobs.find(job => job.id === jobId) };
}
function snapshot(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}
function mapping(db, id, provider = "quickbooks") {
  const workspace = db.prepare("SELECT workspace_id FROM integration_workspace").get().workspace_id;
  db.prepare("INSERT INTO integration_entity_mappings(id,workspace_id,provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id,created_at,updated_at) VALUES(?,?,?,'synthetic','invoice',?,'external','fixture','fixture')").run(`map-${provider}-${id}`, workspace, provider, id);
}

test("legacy and new Jobs normalize to Billable with an optional empty reason", t => {
  const f = setup(t);
  assert.equal(f.job().billingType, "billable"); assert.equal(f.job().warrantyReason, "");
  assert.equal(normalizeStoredData(fixture).jobs[0].billingType, "billable");
  const job = createJob(f.db, { customer: { id: f.customerId }, job: { title: "Ordinary work", description: "Synthetic", jobAddress: f.job().jobAddress } });
  assert.equal(job.billingType, "billable"); assert.equal(job.warrantyReason, "");
});

test("create/edit persist Warranty, trimmed reason and toggling retains reason and quote", t => {
  const f = setup(t);
  const job = createJob(f.db, { customer: { id: f.customerId }, job: { title: "Callback", description: "Synthetic", jobAddress: f.job().jobAddress, billingType: "warranty", warrantyReason: "  Installation warranty  " } });
  assert.equal(job.billingType, "warranty"); assert.equal(job.warrantyReason, "Installation warranty");
  insertQuoteTree(f.db, f.jobId, { type: "quote", items: invoice.items });
  const quote = f.job().quote;
  updateJobDetails(f.db, f.jobId, { billingType: "warranty", warrantyReason: " Parts warranty " });
  assert.deepEqual(f.job().quote, quote);
  updateJobDetails(f.db, f.jobId, { billingType: "billable" });
  assert.equal(f.job().warrantyReason, "Parts warranty");
  replaceInvoiceForJob(f.db, f.jobId, invoice);
  assert.ok(f.job().invoice);
});

for (const value of [null, "", "Warranty", "internal", "goodwill", {}, true]) test(`invalid Billing Type ${JSON.stringify(value)} rejects without mutation`, t => {
  const f = setup(t), before = snapshot(f.db);
  assert.throws(() => updateJobDetails(f.db, f.jobId, { billingType: value, title: "Must roll back" }), /Billing Type/);
  assert.deepEqual(snapshot(f.db), before);
  assert.throws(() => normalizeBillingType(value), /Billing Type/);
});
for (const value of [null, 7, {}, "x".repeat(241), "unsafe\u0000text"]) test(`invalid Warranty Reason ${typeof value} rejects atomically (${String(value).length})`, t => {
  const f = setup(t), before = snapshot(f.db);
  assert.throws(() => updateJobDetails(f.db, f.jobId, { billingType: "warranty", warrantyReason: value }), /Warranty Reason/);
  assert.deepEqual(snapshot(f.db), before);
  assert.throws(() => normalizeWarrantyReason(value), /Warranty Reason/);
});

test("existing invoice, receipts and both provider mappings block classification without accounting mutation", t => {
  const f = setup(t); insertInvoiceTree(f.db, f.jobId, invoice);
  const id = f.db.prepare("SELECT id FROM invoices WHERE job_id=?").get(f.jobId).id; mapping(f.db, id); mapping(f.db, id, "xero");
  // Separate providers use distinct rows even though the synthetic external IDs match.
  const before = snapshot(f.db);
  assert.throws(() => updateJobDetails(f.db, f.jobId, { billingType: "warranty" }), /already has an invoice or accounting ownership/);
  assert.deepEqual(snapshot(f.db), before);
});
for (const archived of [false, true]) test(`accounting ownership blocks Warranty with ${archived ? "archived custom" : "default"} invoice ID`, t => {
  const f = setup(t);
  let id = `${f.jobId}:invoice`;
  if (archived) {
    insertInvoiceTree(f.db, f.jobId, { ...invoice, payments: [], id: "historical-custom-invoice" }); id = f.db.prepare("SELECT id FROM invoices WHERE job_id=?").get(f.jobId).id;
    deleteInvoiceForJob(f.db, f.jobId);
  }
  mapping(f.db, id);
  const before = snapshot(f.db);
  assert.throws(() => updateJobDetails(f.db, f.jobId, { billingType: "warranty" }), /accounting ownership/);
  assert.deepEqual(snapshot(f.db), before);
  assert.throws(() => f.db.prepare("UPDATE jobs SET billing_type='warranty' WHERE id=?").run(f.jobId), /mapping/);
});

test("every invoice write and archived invoice restoration are blocked while Warranty", t => {
  const f = setup(t); insertInvoiceTree(f.db, f.jobId, { ...invoice, payments: [] }); deleteInvoiceForJob(f.db, f.jobId);
  const archive = f.db.prepare("SELECT id FROM deleted_invoices WHERE job_id=?").get(f.jobId).id;
  updateJobDetails(f.db, f.jobId, { billingType: "warranty" });
  const before = snapshot(f.db);
  for (const operation of [() => insertInvoiceTree(f.db, f.jobId, invoice), () => replaceInvoiceForJob(f.db, f.jobId, invoice, { createOnly: true }), () => restoreDeletedInvoice(f.db, archive)]) {
    assert.throws(operation, /Warranty job.*non-billable/); assert.deepEqual(snapshot(f.db), before);
  }
  assert.throws(() => f.db.prepare("INSERT INTO invoices(id,job_id,created_at,updated_at) VALUES('direct',?,'fixture','fixture')").run(f.jobId), /Warranty job cannot be invoiced/);
  updateJobDetails(f.db, f.jobId, { billingType: "billable" }); restoreDeletedInvoice(f.db, archive);
  assert.ok(f.job().invoice);
});

test("stale Quote to Invoice transfer is ignored while Warranty and restored when Billable", () => {
  const job = { id: "job", billingType: "warranty", quote: { items: invoice.items } };
  const state = { quoteInvoiceDraft: { jobId: job.id, document: invoice } };
  assert.equal(invoiceConversionDraft(job, "invoice", state), null);
  assert.deepEqual(invoiceConversionDraft({ ...job, billingType: "billable" }, "invoice", state), invoice);
});

for (const provider of ["quickbooks", "xero"]) test(`${provider} rejects Warranty before provider access, locks, logs or accounting mutation`, async t => {
  const f = setup(t); updateJobDetails(f.db, f.jobId, { billingType: "warranty" });
  const service = new AccountingService(f.db, { provider: { id: provider, name: provider, requiredScopes: [], createInvoice() { assert.fail("Provider must not run"); } } });
  const before = snapshot(f.db);
  assert.throws(() => service.syncInvoice(f.jobId), error => error.code === "WARRANTY_NON_BILLABLE" && safeAccountingError(error).statusCode === 409);
  assert.throws(() => readAccountingInvoice(f.db, f.jobId), /Warranty job/);
  assert.deepEqual(snapshot(f.db), before);
});

test("Warranty Job Costing supports every category, unchanged arithmetic and archive restore", t => {
  const f = setup(t); updateWorkspaceAddons(f.db, { jobCosting: true });
  updateJobDetails(f.db, f.jobId, { billingType: "warranty", warrantyReason: "Manufacturer warranty" });
  for (const { key } of COST_CATEGORIES) createJobCostEntry(f.db, f.jobId, { category: key, description: key, quantity: "1.5", unitCostCents: 100, costDate: "2026-10-06" });
  const summary = getJobCostingSummary(f.db, f.jobId);
  assert.equal(summary.entries.length, 7); assert.equal(summary.totalCostCents, 1050); assert.equal(summary.revenueCents, 0);
  deleteJob(f.db, f.jobId); restoreDeletedJob(f.db, f.jobId);
  assert.equal(f.job().billingType, "warranty"); assert.equal(f.job().warrantyReason, "Manufacturer warranty");
  assert.deepEqual(getJobCostingSummary(f.db, f.jobId).entries, summary.entries);
});

test("SQLite backup, materialization and JSON import preserve billing fields; old JSON defaults safely", async t => {
  const f = setup(t); updateJobDetails(f.db, f.jobId, { billingType: "warranty", warrantyReason: "Callback under warranty" });
  const bundle = await createWorkspaceSqliteBackupBundle({ env: { ELSET_DATA_DIR: f.directory } });
  assert.equal(bundle.metadata.workspace.schemaVersion, 18);
  const materialized = materializeWorkspaceSqliteBackup(bundle, path.join(f.directory, "restore"));
  const restored = openWorkspaceDb({ dbPath: materialized.tempDbPath });
  try { assert.deepEqual(loadWorkspaceStateFromDb(restored).jobs, loadWorkspaceStateFromDb(f.db).jobs); } finally { restored.close(); }
  const target = openWorkspaceDb({ dbPath: ":memory:" }); t.after(() => target.close());
  importWorkspaceJsonData(target, loadWorkspaceStateFromDb(f.db));
  assert.deepEqual(loadWorkspaceStateFromDb(target).jobs, loadWorkspaceStateFromDb(f.db).jobs);
});

test("schema 17 -> 18 is additive, atomic, idempotent and preserves invoices, payments and mappings", t => {
  const f = setup(t); insertInvoiceTree(f.db, f.jobId, invoice); mapping(f.db, f.db.prepare("SELECT id FROM invoices WHERE job_id=?").get(f.jobId).id);
  removeBillingSchemaForLegacyFixture(f.db); f.db.exec("UPDATE workspace_info SET schema_version=17; PRAGMA user_version=17;");
  const before = snapshot(f.db);
  f.db.exec("CREATE TRIGGER fail_billing BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version=18 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  assert.throws(() => migrateWorkspaceSchema(f.db), /17 -> 18 failed/);
  assert.deepEqual(snapshot(f.db), before); assert.equal(f.db.pragma("user_version", { simple: true }), 17);
  f.db.exec("DROP TRIGGER fail_billing"); migrateWorkspaceSchema(f.db);
  assert.deepEqual(assertWorkspaceSchema(f.db), { schemaVersion: 18 });
  const after = snapshot(f.db);
  for (const table of Object.keys(before)) if (!["workspace_info", "workspace_schema_migrations", "jobs"].includes(table)) assert.deepEqual(after[table], before[table], table);
  assert.deepEqual(after.jobs, before.jobs.map(row => ({ ...row, billing_type: "billable", warranty_reason: "" })));
  migrateWorkspaceSchema(f.db); assert.deepEqual(snapshot(f.db), after);
  assert.equal(f.db.pragma("integrity_check", { simple: true }), "ok"); assert.deepEqual(f.db.pragma("foreign_key_check"), []);
});

test("ServiceM8 retains local Warranty/reason and costs, skips incoming invoice without replacing Job", t => {
  const f = setup(t); updateJobDetails(f.db, f.jobId, { billingType: "warranty", warrantyReason: "Installation warranty" });
  const original = f.job();
  const plan = { importedAt: "2026-11-01", customers: [], jobs: [{ action: "update", record: { ...original, billingType: "billable", warrantyReason: "", title: "Imported update", externalRefs: { serviceM8: { editDate: "2026-11-01", importedAt: "2026-11-01" } } } }] };
  assert.equal(applyServiceM8ImportPlanToSqlite(f.db, plan).summary.apply.jobs.updated, 1);
  assert.equal(f.job().billingType, "warranty"); assert.equal(f.job().warrantyReason, original.warrantyReason);
  const before = snapshot(f.db);
  plan.jobs[0].record.invoice = invoice;
  const result = applyServiceM8ImportPlanToSqlite(f.db, plan);
  assert.equal(result.summary.apply.jobs.conflicted, 1); assert.match(result.summary.apply.warnings[0], /Warranty/);
  assert.deepEqual(snapshot(f.db).jobs, before.jobs); assert.deepEqual(snapshot(f.db).invoices, before.invoices);
});

test("board Warranty cards retain quote/maintenance without a Warranty badge or invoice/QuickBooks warnings", () => {
  const job = { billingType: "warranty", status: "Completed", quote: { sentHistory: [{}] }, maintenancePlanName: "Annual service" };
  assert.deepEqual(buildJobCardIndicators({ job, invoiceStatus: { id: "not-invoiced" }, accountingProvider: "quickbooks" }).map(item => item.id), ["quote", "maintenance"]);
  const billable = { ...job, billingType: "billable", invoice: {} };
  assert.ok(buildJobCardIndicators({ job: billable, invoiceStatus: { id: "draft" }, accountingProvider: "quickbooks" }).some(item => item.id === "quickbooks-unsynced"));
  assert.equal(getServiceBoardIndicatorLegend("quickbooks").some(item => item.id === "warranty"), false);
  assert.equal(matchesJobBillingFilter(job, "all"), true); assert.equal(matchesJobBillingFilter(job, "billable"), false);
  assert.equal(matchesJobBillingFilter(job, "warranty"), true); assert.equal(matchesJobBillingFilter({}, "billable"), true);
});

test("invalid imported classification and Warranty invoice import roll back the entire workspace", t => {
  const f = setup(t);
  for (const patch of [{ billingType: "internal" }, { billingType: null }, { billingType: "warranty", invoice }]) {
    const target = openWorkspaceDb({ dbPath: ":memory:" });
    try {
      const data = loadWorkspaceStateFromDb(f.db); Object.assign(data.jobs[0], patch);
      const before = snapshot(target); assert.throws(() => importWorkspaceJsonData(target, data), /Billing Type|Warranty job/);
      assert.deepEqual(snapshot(target), before);
    } finally { target.close(); }
  }
});

for (const billingType of [undefined, "warranty"]) test(`maintenance-generated Job defaults or accepts explicit ${billingType || "Billable"}`, t => {
  const f = setup(t);
  const site = loadWorkspaceStateFromDb(f.db).customers.find(customer => customer.id === f.customerId).sites[0];
  const plan = createMaintenancePlan(f.db, { id: "billing-plan", planName: "Annual gate service", customerId: f.customerId, siteId: site.id, frequency: "yearly", nextDueDate: "2027-01-05", active: true });
  const occurrence = getMaintenanceOccurrences(f.db, "2027-01-01", "2027-01-31").find(item => item.planId === plan.id);
  const { job } = generateMaintenanceJob(f.db, plan.id, { occurrenceKey: occurrence.key, revision: occurrence.revision, billingType, warrantyReason: billingType ? "Installation warranty" : undefined });
  assert.equal(job.billingType, billingType || "billable"); assert.equal(job.warrantyReason, billingType ? "Installation warranty" : "");
});

for (const surface of ["#EAF7FB", "#F1DECD", "#DFEADA", "#101826", "#EFDBE3", "#EEE1C3", "#F4F7F9", "#F9FBFC"]) test(`Warranty text contrast is accessible on ${surface}`, () => {
  const { vars } = buildSemanticTheme({ dataViewSurface: surface, dataViewAccent: "#5F87A5", borderColor: "#72828E", dialogSurface: surface, actionColor: "#175B6E", pageBackgroundStart: surface, pageBackgroundEnd: surface, heroSurface: surface, sidebarSurface: surface, sidebarActive: surface });
  for (const prefix of ["", "dialog-"]) assert.ok(contrastRatio(vars[`--${prefix}billing-warranty`], vars[`--${prefix}billing-warranty-surface`]) >= 4.5);
});

test("API enforces roles, validation, invoice safety and returns canonical billing fields", async t => {
  const f = setup(t), app = express(); app.use(express.json());
  const options = { env: { ELSET_DATA_DIR: f.directory }, requireAuth: (req, _res, next) => { req.user = { id: "synthetic", role: req.get("X-Test-Role") || "admin" }; next(); }, requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403) };
  app.use(createJobRouter(options)); app.use(createDocumentRouter(options));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (method, endpoint, body, role = "admin") => fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { method, headers: { "Content-Type": "application/json", "X-Test-Role": role }, body: JSON.stringify(body) });
  const endpoint = `/api/jobs/${f.jobId}`;
  assert.equal((await call("PATCH", endpoint, { billingType: "warranty" }, "technician")).status, 403);
  assert.equal((await call("PATCH", endpoint, { billingType: "internal" })).status, 400);
  assert.equal((await call("PATCH", endpoint, { billingType: "warranty", warrantyReason: "Office callback" }, "office")).status, 200);
  assert.equal(f.job().warrantyReason, "Office callback");
  const blocked = await call("PUT", endpoint + "/invoice", { invoice, createOnly: true });
  assert.equal(blocked.status, 409); assert.match((await blocked.json()).error, /Change Billing Type to Billable/);
  assert.equal((await call("PUT", endpoint + "/quote", { quote: { type: "quote", items: invoice.items } })).status, 200);
  assert.equal((await call("PATCH", endpoint, { billingType: "billable" })).status, 200);
  assert.equal((await call("PUT", endpoint + "/invoice", { invoice })).status, 200);
  assert.equal((await call("PATCH", endpoint, { billingType: "warranty" })).status, 409);
});
