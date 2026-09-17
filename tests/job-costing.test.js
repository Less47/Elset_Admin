import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { getWorkspaceAddons, updateWorkspaceAddons } from "../server-workspace-addons.js";
import { getJobCostingSummary, createJobCostEntry, updateJobCostEntry, deleteJobCostEntry } from "../server-workspace-job-costing.js";
import { registerAddonRoutes } from "../server-addon-routes.js";
import { registerJobCostingRoutes } from "../server-job-costing-routes.js";
import { insertInvoiceTree, insertQuoteTree, addInvoicePayment, updateInvoicePayment, deleteInvoicePayment, deleteInvoiceForJob } from "../server-workspace-documents.js";
import { updateWorkspaceSettings, resetWorkspaceSettings } from "../server-workspace-settings.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { createWorkspaceSqliteBackupBundle, materializeWorkspaceSqliteBackup } from "../server-workspace-backup.js";
import { deleteJob, restoreDeletedJob } from "../server-workspace-jobs.js";
import { deleteCustomer } from "../server-workspace-customers.js";
import { applyServiceM8ImportPlanToSqlite } from "../server-workspace-servicem8-import.js";
import { costTotalCents, parseMoneyCents, parseQuantityMicros, summarizeJobCosting } from "../src/lib/job-costing.js";

const day = "2026-09-17";
const sentHistory = [{ id: "sent", sentAt: day, toEmail: "accounts@example.test" }];
const cost = (patch = {}) => ({ category: "materials", description: "Replacement motor", quantity: "2", unitCostCents: 9500, supplier: "Example supplier", costDate: day, notes: "Excluding GST", ...patch });
const invoice = (patch = {}) => ({ type: "invoice", issueDate: day, dueDate: "2026-10-17", items: [{ description: "Service", qty: 1, rate: 5000 }], sentHistory, ...patch });

function setup(t, dbPath = ":memory:") {
  const db = openWorkspaceDb({ dbPath });
  t.after(() => { if (db.open) db.close(); });
  db.exec("INSERT INTO customers(id,name,created_at) VALUES('customer','Example customer','2026-09-17')");
  const insert = db.prepare("INSERT INTO jobs(id,job_number,title,customer_id,job_address,status,created_at,updated_at) VALUES(?,?,'Synthetic job','customer','Same Site','Completed','2026-09-17','2026-09-17')");
  insert.run("job", 1001);
  insert.run("other-job", 1002);
  return db;
}

function enable(db) { updateWorkspaceAddons(db, { jobCosting: true }); }
function entries(db) { return getJobCostingSummary(db, "job").entries; }
function created(db, input = cost()) {
  createJobCostEntry(db, "job", input, { userId: "user-admin" });
  return entries(db).find((entry) => entry.description === input.description);
}

test("cost arithmetic keeps fractional quantities and cent rounding exact", () => {
  assert.equal(parseQuantityMicros("4.5"), 4500000);
  assert.equal(parseMoneyCents("60.00"), 6000);
  assert.equal(costTotalCents("4.5", 6000), 27000);
  assert.equal(costTotalCents("2", 9500), 19000);
  assert.equal(costTotalCents("0.333333", 5), 2);
  assert.equal(costTotalCents("0.1", 10), 1);
  for (const input of ["-1", "1.0000001", "NaN", "Infinity", "1e4", "1,000", null, {}, true]) assert.throws(() => parseQuantityMicros(input), String(input));
  for (const input of ["-0.01", "12.345", "NaN", "Infinity", "1e4", "1,000", {}, true]) assert.throws(() => parseMoneyCents(input), String(input));
  assert.throws(() => costTotalCents("9007199254", Number.MAX_SAFE_INTEGER));
});

test("empty and quote-only jobs have zero revenue and safe zero-revenue margin", (t) => {
  const db = setup(t); enable(db);
  let result = getJobCostingSummary(db, "job");
  assert.equal(result.revenueCents, 0);
  assert.equal(result.grossProfitCents, 0);
  assert.equal(result.marginPercent, null);
  assert.equal(result.varianceCents, null);
  insertQuoteTree(db, "job", { type: "quote", status: "accepted", items: [{ qty: 1, rate: 10000 }], sentHistory });
  result = getJobCostingSummary(db, "job");
  assert.equal(result.quotedCents, 1000000);
  assert.equal(result.revenueCents, 0);
  assert.equal(result.invoicedCents, 0);
  created(db, cost({ quantity: "1", unitCostCents: 27000 }));
  result = getJobCostingSummary(db, "job");
  assert.equal(result.grossProfitCents, -27000);
  assert.equal(result.marginPercent, null);
  assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity|undefined/);
});

test("invoice revenue, ex-GST costs and profit are independent of cash receipts", (t) => {
  const db = setup(t); enable(db);
  insertQuoteTree(db, "job", { type: "quote", items: [{ qty: 1, rate: 4800 }] });
  insertInvoiceTree(db, "job", invoice());
  created(db, cost({ quantity: "2", unitCostCents: 100000 }));
  created(db, cost({ category: "labour", description: "Internal technician labour", quantity: "4.5", unitCostCents: 6000 }));
  created(db, cost({ category: "travel", description: "Travel", quantity: "1", unitCostCents: 73000 }));
  let result = getJobCostingSummary(db, "job");
  assert.equal(result.revenueCents, 500000);
  assert.equal(result.invoicedCents, 500000);
  assert.equal(result.quotedCents, 480000);
  assert.equal(result.varianceCents, 20000);
  assert.equal(result.totalCostCents, 300000);
  assert.equal(result.grossProfitCents, 200000);
  assert.equal(result.marginPercent, 40);
  assert.equal(result.outstandingCents, 550000, "Receivable includes the invoice's GST");
  assert.equal(result.paidCents, 0);
  assert.equal(result.categories.find((entry) => entry.key === "materials").totalCostCents, 200000);
  assert.equal(result.categories.find((entry) => entry.key === "labour").totalCostCents, 27000);
  addInvoicePayment(db, "job", { id: "partial", amount: 1000, date: day });
  result = getJobCostingSummary(db, "job");
  assert.equal(result.paidCents, 100000);
  assert.equal(result.outstandingCents, 450000);
  assert.equal(result.grossProfitCents, 200000);
  const paymentId = db.prepare("SELECT id FROM payments").get().id;
  updateInvoicePayment(db, "job", paymentId, { amount: 5500 });
  result = getJobCostingSummary(db, "job");
  assert.equal(result.revenueCents, 500000, "Paid invoices remain revenue");
  assert.equal(result.outstandingCents, 0);
  assert.equal(result.marginPercent, 40);
  deleteInvoicePayment(db, "job", paymentId);
  assert.equal(getJobCostingSummary(db, "job").paidCents, 0);
});

test("unissued drafts, inactive documents and other jobs never contribute", (t) => {
  const db = setup(t); enable(db);
  insertInvoiceTree(db, "job", invoice({ sentHistory: [], dueDate: "2000-01-01" }));
  insertQuoteTree(db, "job", { type: "quote", items: [{ qty: 1, rate: 10000 }], sentHistory });
  insertInvoiceTree(db, "other-job", invoice());
  createJobCostEntry(db, "other-job", cost(), { userId: "user-admin" });
  let result = getJobCostingSummary(db, "job");
  assert.equal(result.revenueCents, 0, "Overdue drafts and quote send history do not issue an invoice");
  assert.equal(result.totalCostCents, 0);
  addInvoicePayment(db, "job", { id: "deposit", amount: 5, date: day });
  assert.equal(getJobCostingSummary(db, "job").revenueCents, 500000, "Paid deposits establish invoice eligibility");
  for (const metadata of [{ status: "void" }, { invoiceStatus: "cancelled" }, { voidedAt: day }, { deleted: true }]) {
    db.prepare("UPDATE invoices SET extra_json=? WHERE job_id='job'").run(JSON.stringify(metadata));
    result = getJobCostingSummary(db, "job");
    assert.equal(result.revenueCents, 0);
    assert.equal(result.paidCents, 0);
  }
  db.exec("UPDATE invoices SET extra_json='{}' WHERE job_id='job'");
  deleteInvoicePayment(db, "job", db.prepare("SELECT id FROM payments WHERE invoice_id=(SELECT id FROM invoices WHERE job_id='job')").get().id);
  deleteInvoiceForJob(db, "job", { confirmSent: true });
  assert.equal(getJobCostingSummary(db, "job").revenueCents, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM deleted_invoices").get().n, 1);
});

test("multiple invoice projections aggregate once for the exact job, including fully paid invoices", () => {
  const first = { invoiceId: "first", jobId: "job", metadata: {}, sentCount: 1, subtotalCents: 10000, totalCents: 11000, paidCents: 1000, balanceCents: 10000 };
  const second = { invoiceId: "second", jobId: "job", metadata: {}, sentCount: 1, subtotalCents: 20000, totalCents: 22000, paidCents: 22000, balanceCents: 0 };
  const result = summarizeJobCosting({ jobId: "job", invoices: [first, second, { ...first }, { ...first, invoiceId: "other", jobId: "other-job" }], quotes: [], entries: [] });
  assert.equal(result.revenueCents, 30000);
  assert.equal(result.invoiceCount, 2);
  assert.equal(result.paidCents, 23000);
  assert.equal(result.outstandingCents, 10000);
});

test("SQL costing summary aggregates multiple invoices for one job and excludes another job", (t) => {
  const db = setup(t); enable(db);
  insertInvoiceTree(db, "job", invoice({ items: [{ qty: 1, rate: 100 }], payments: [{ id: "first-payment", amount: 30, date: day }] }));
  insertInvoiceTree(db, "other-job", invoice({ items: [{ qty: 1, rate: 99999 }], payments: [{ id: "other-payment", amount: 999, date: day }] }));
  // The current invoice editor enforces one invoice per job. Connection-local
  // views exercise a future plural source without altering production tables.
  db.exec(`
    CREATE TEMP VIEW invoices AS
      SELECT id, job_id, type, extra_json FROM main.invoices
      UNION ALL SELECT 'second-invoice', 'job', 'invoice', '{}';
    CREATE TEMP VIEW invoice_line_items AS
      SELECT invoice_id, position, quantity_micros, rate_cents FROM main.invoice_line_items
      UNION ALL SELECT 'second-invoice', 1, 1000000, 20000;
    CREATE TEMP VIEW payments AS
      SELECT invoice_id, amount_cents FROM main.payments
      UNION ALL SELECT 'second-invoice', 22000;
  `);
  const result = getJobCostingSummary(db, "job");
  assert.equal(result.invoiceCount, 2);
  assert.equal(result.revenueCents, 30000);
  assert.equal(result.invoicedCents, 30000);
  assert.equal(result.paidCents, 25000);
  assert.equal(result.outstandingCents, 8000);
  assert.equal(result.grossProfitCents, 30000);
  assert.equal(result.marginPercent, 100);
  assert.equal(db.prepare("SELECT count(*) n FROM main.invoices WHERE job_id='job'").get().n, 1);
});

test("invoice line rounding uses existing financial calculations before costing aggregation", (t) => {
  const db = setup(t); enable(db);
  insertInvoiceTree(db, "job", invoice({ items: [{ qty: "0.333333", rate: "0.05" }, { qty: "0.333333", rate: "0.05" }] }));
  assert.equal(getJobCostingSummary(db, "job").revenueCents, 4);
});

test("cost edits and deletion recalculate category and profit without mutating job or documents", (t) => {
  const db = setup(t); enable(db); insertInvoiceTree(db, "job", invoice());
  const jobBefore = db.prepare("SELECT * FROM jobs WHERE id='job'").get();
  const invoiceBefore = db.prepare("SELECT * FROM invoices").all();
  const entry = created(db);
  assert.equal(entry.createdBy, "user-admin");
  assert.equal(entry.totalCostCents, 19000);
  updateJobCostEntry(db, "job", entry.id, { category: "labour", quantity: "4.5", unitCostCents: 6000 }, { userId: "user-office" });
  const result = getJobCostingSummary(db, "job");
  assert.equal(result.totalCostCents, 27000);
  assert.equal(result.entries[0].id, entry.id);
  assert.equal(result.entries[0].createdBy, "user-admin");
  assert.equal(result.categories.find((category) => category.key === "materials").totalCostCents, 0);
  assert.equal(result.grossProfitCents, 473000);
  deleteJobCostEntry(db, "job", entry.id);
  assert.equal(getJobCostingSummary(db, "job").totalCostCents, 0);
  assert.deepEqual(db.prepare("SELECT * FROM jobs WHERE id='job'").get(), jobBefore);
  assert.deepEqual(db.prepare("SELECT * FROM invoices").all(), invoiceBefore);
});

test("cost validation rejects unsafe money, unsupported adjustments, bad dates, protected fields and cross-job IDs", (t) => {
  const db = setup(t); enable(db); const entry = created(db);
  for (const patch of [
    { category: "Materials" }, { description: " " }, { quantity: "-1" }, { quantity: "Infinity" },
    { quantity: "1.0000001" }, { unitCostCents: -1 }, { unitCostCents: 1.5 }, { unitCostCents: "100" },
    { unitCostCents: Number.MAX_SAFE_INTEGER + 1 }, { costDate: "2026-02-30" }, { totalCostCents: 1 },
    { jobId: "other-job" }, { createdBy: "spoof" }, { id: "spoof" },
  ]) {
    const before = entries(db);
    assert.throws(() => createJobCostEntry(db, "job", cost(patch)), JSON.stringify(patch));
    assert.throws(() => updateJobCostEntry(db, "job", entry.id, patch), JSON.stringify(patch));
    assert.deepEqual(entries(db), before);
  }
  assert.throws(() => createJobCostEntry(db, "missing-job", cost()), /not found/i);
  assert.throws(() => getJobCostingSummary(db, "missing-job"), /not found/i);
  assert.throws(() => updateJobCostEntry(db, "other-job", entry.id, { quantity: "9" }), /not found/i);
  assert.throws(() => deleteJobCostEntry(db, "other-job", entry.id), /not found/i);
  assert.equal(entries(db)[0].quantity, "2");
});

test("a cost write rolls back when its aggregate would exceed safe integer cents", (t) => {
  const db = setup(t); enable(db);
  created(db, cost({ quantity: "1", unitCostCents: Number.MAX_SAFE_INTEGER }));
  const before = entries(db);
  assert.throws(() => createJobCostEntry(db, "job", cost({ quantity: "1", unitCostCents: 1 })), /safely/);
  assert.deepEqual(entries(db), before);
});

test("add-ons default disabled, preserve cost rows through disable and survive unrelated settings resets", (t) => {
  const db = setup(t);
  assert.deepEqual(getWorkspaceAddons(db), { xero: false, jobCosting: false });
  assert.throws(() => getJobCostingSummary(db, "job"), /disabled/i);
  enable(db); const entry = created(db);
  const before = entries(db);
  updateWorkspaceSettings(db, { companyName: "Shared company", customPreference: "keep" });
  resetWorkspaceSettings(db, "preferences");
  assert.equal(getWorkspaceAddons(db).jobCosting, true);
  assert.throws(() => updateWorkspaceSettings(db, { addons: { jobCosting: false } }), /Add-ons settings endpoint/);
  updateWorkspaceAddons(db, { jobCosting: false });
  for (const operation of [
    () => getJobCostingSummary(db, "job"), () => createJobCostEntry(db, "job", cost()),
    () => updateJobCostEntry(db, "job", entry.id, { quantity: "9" }), () => deleteJobCostEntry(db, "job", entry.id),
  ]) assert.throws(operation, /disabled/i);
  enable(db);
  assert.deepEqual(entries(db), before);
  for (const patch of [{ unknown: true }, { jobCosting: "true" }, { jobCosting: null }, [], null]) assert.throws(() => updateWorkspaceAddons(db, patch));
  assert.equal(getWorkspaceAddons(db).jobCosting, true);
});

test("legacy workspace projection preserves add-on settings without exposing cost payloads", (t) => {
  const db = setup(t); enable(db); created(db);
  const state = loadWorkspaceStateFromDb(db);
  const target = openWorkspaceDb({ dbPath: ":memory:" }); t.after(() => target.close());
  importWorkspaceJsonData(target, state);
  assert.deepEqual(getWorkspaceAddons(target), getWorkspaceAddons(db));
  assert.equal(state.jobs.find((job) => job.id === "job").jobCostEntries, undefined);
  assert.equal(state.jobCostEntries, undefined);
});

test("authoritative SQLite backup and restore retain enabled state and all cost rows", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-costing-backup-"));
  const source = setup(t, path.join(dir, "elset-workspace.db"));
  enable(source); created(source);
  const summary = getJobCostingSummary(source, "job");
  const bundle = await createWorkspaceSqliteBackupBundle({ env: { ELSET_DATA_DIR: dir } });
  const materialized = materializeWorkspaceSqliteBackup(bundle, path.join(dir, "restored"));
  const restored = openWorkspaceDb({ dbPath: materialized.tempDbPath });
  try {
    assert.deepEqual(getWorkspaceAddons(restored), { xero: false, jobCosting: true });
    assert.deepEqual(getJobCostingSummary(restored, "job"), summary);
  } finally {
    restored.close(); source.close();
    assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "elset-costing-backup-")));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const removeCustomer of [false, true]) test(`costs survive ${removeCustomer ? "customer cascade" : "job"} archive and restoration while disabled`, (t) => {
  const db = setup(t); enable(db); created(db);
  const before = entries(db);
  updateWorkspaceAddons(db, { jobCosting: false });
  if (removeCustomer) deleteCustomer(db, "customer");
  else deleteJob(db, "job");
  assert.equal(db.prepare("SELECT count(*) n FROM job_cost_entries WHERE job_id='job'").get().n, 0);
  assert.ok(db.prepare("SELECT extra_json FROM deleted_records WHERE kind='job' AND record_id='job'").get().extra_json.includes(before[0].id));
  restoreDeletedJob(db, "job");
  enable(db);
  assert.deepEqual(entries(db), before);
});

test("ServiceM8 replacement preserves local costs and a failed replacement rolls back both trees", (t) => {
  const db = setup(t); enable(db); created(db);
  const before = entries(db);
  updateWorkspaceAddons(db, { jobCosting: false });
  const originalJob = loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === "job");
  const plan = { importedAt: day, customers: [], jobs: [{ action: "update", record: { ...originalJob, title: "Updated ServiceM8 job", externalRefs: { serviceM8: { editDate: "2026-09-18", importedAt: "2026-09-18", jobUuid: "synthetic" } } } }] };
  const result = applyServiceM8ImportPlanToSqlite(db, plan);
  assert.equal(result.summary.apply.jobs.updated, 1);
  assert.equal(db.prepare("SELECT title FROM jobs WHERE id='job'").get().title, "Updated ServiceM8 job");
  enable(db); assert.deepEqual(entries(db), before);
  const jobAfter = db.prepare("SELECT * FROM jobs WHERE id='job'").get();
  const broken = { ...plan, jobs: [{ ...plan.jobs[0], record: { ...plan.jobs[0].record, title: "Broken update", externalRefs: { serviceM8: { editDate: "2026-09-19", importedAt: "2026-09-19" } }, invoice: invoice({ items: [{ qty: "invalid", rate: 1 }] }) } }] };
  assert.throws(() => applyServiceM8ImportPlanToSqlite(db, broken), /quantity must be a valid number/);
  assert.deepEqual(entries(db), before);
  assert.deepEqual(db.prepare("SELECT * FROM jobs WHERE id='job'").get(), jobAfter);
});

async function startServer(t, env) {
  const app = express(); app.use(express.json());
  const options = { env,
    requireAuth(req, res, next) {
      if (!req.headers["x-test-role"]) return res.status(401).json({ error: "Authentication required" });
      req.user = { id: req.headers["x-test-user"] || "user-admin", role: req.headers["x-test-role"], staffId: "tech" }; next();
    },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Forbidden" }),
  };
  registerAddonRoutes(app, options); registerJobCostingRoutes(app, options);
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return async (route, { role = "admin", method = "GET", body, user = "user-admin" } = {}) => {
    const response = await fetch(url + route, { method, headers: { "Content-Type": "application/json", ...(role ? { "x-test-role": role, "x-test-user": user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
  };
}

test("authenticated targeted APIs share persisted enablement and enforce roles, feature gating and job ownership", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-job-costing-"));
  const db = setup(t, path.join(dir, "elset-workspace.db"));
  t.after(() => { if (db.open) db.close(); assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "elset-job-costing-"))); fs.rmSync(dir, { recursive: true, force: true }); });
  const request = await startServer(t, { ELSET_DATA_DIR: dir, ELSET_WORKSPACE_STORAGE: "sqlite" });
  const route = "/api/jobs/job/costing";
  assert.equal((await request(route, { role: "" })).status, 401);
  assert.equal((await request("/api/settings/addons", { role: "" })).status, 401);
  assert.equal((await request(route)).body.code, "ADDON_DISABLED");
  const initial = await request("/api/settings/addons");
  assert.deepEqual(initial.body.result, { xero: false, jobCosting: false });
  assert.match(initial.cache, /no-store/);
  assert.equal((await request("/api/settings/addons", { method: "PATCH", role: "technician", body: { jobCosting: true } })).status, 403);
  assert.equal((await request("/api/settings/addons", { method: "PATCH", body: { jobCosting: true } })).status, 200);
  assert.equal((await request("/api/settings/addons", { role: "office", user: "second-session" })).body.result.jobCosting, true);
  for (const [method, pathSuffix, body] of [["GET", "/costing"], ["POST", "/costs", cost()], ["PATCH", "/costs/missing", { quantity: "3" }], ["DELETE", "/costs/missing"]]) {
    assert.equal((await request("/api/jobs/job" + pathSuffix, { method, role: "technician", body })).status, 403);
  }
  let response = await request("/api/jobs/job/costs", { method: "POST", role: "office", user: "office-user", body: cost() });
  assert.equal(response.status, 200, response.body.error);
  const entry = response.body.result.entries[0]; assert.equal(entry.createdBy, "office-user");
  assert.equal((await request("/api/jobs/missing/costs", { method: "POST", body: cost() })).status, 404);
  for (const method of ["PATCH", "DELETE"]) assert.equal((await request(`/api/jobs/other-job/costs/${entry.id}`, { method, ...(method === "PATCH" ? { body: { quantity: "9" } } : {}) })).status, 404);
  assert.equal((await request(`/api/jobs/job/costs/${entry.id}`, { method: "PATCH", body: { quantity: "4.5", unitCostCents: 6000 } })).body.result.totalCostCents, 27000);
  assert.equal((await request("/api/settings/addons", { method: "PATCH", role: "office", body: { jobCosting: false } })).status, 200);
  for (const [method, pathSuffix, body] of [["GET", "/costing"], ["POST", "/costs", cost()], ["PATCH", `/costs/${entry.id}`, { quantity: "3" }], ["DELETE", `/costs/${entry.id}`]]) {
    response = await request("/api/jobs/job" + pathSuffix, { method, body });
    assert.equal(response.status, 403); assert.equal(response.body.code, "ADDON_DISABLED");
  }
  assert.equal(db.prepare("SELECT count(*) n FROM job_cost_entries").get().n, 1);
  await request("/api/settings/addons", { method: "PATCH", body: { jobCosting: true } });
  assert.equal((await request(route)).body.result.totalCostCents, 27000);
  assert.equal((await request(`/api/jobs/job/costs/${entry.id}`, { method: "DELETE" })).body.result.totalCostCents, 0);
});
