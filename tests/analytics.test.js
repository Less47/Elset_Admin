import assert from "node:assert/strict";
import test from "node:test";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { readReportingFinancials } from "../server-reporting.js";
import { getCustomerAccountSummary } from "../server-customer-account.js";
import { getJobCostingSummary } from "../server-workspace-job-costing.js";
import { deleteInvoiceForJob, restoreDeletedInvoice } from "../server-workspace-documents.js";
import { deriveAnalytics, presetRange, previousRange, timeBuckets, comparison, createdDate } from "../src/lib/analytics.js";
import { REPORTS, reportTable, exportReportCsv } from "../src/lib/analytics-reports.js";
import { expandMaintenanceOccurrences } from "../src/lib/maintenance-recurrence.js";
import { analyticsFixture, seedAnalyticsCosts } from "./fixtures/analytics-workspace.js";

const range = { from: "2026-09-01", to: "2026-09-30" }, today = "2026-10-01";
function fixture(t) {
  const db = openWorkspaceDb({ dbPath: ":memory:" }); t.after(() => db.close());
  importWorkspaceJsonData(db, analyticsFixture()); seedAnalyticsCosts(db);
  const data = loadWorkspaceStateFromDb(db), financials = readReportingFinancials(db);
  return { db, data, financials, a: deriveAnalytics(data, financials, range, {}, today) };
}
for (const [preset, from, to] of [["Today", "2026-10-01", today], ["This week", "2026-09-28", today], ["This month", today, today], ["Last month", "2026-09-01", "2026-09-30"], ["This quarter", today, today], ["This year", "2026-01-01", today], ["Last 12 months", "2025-10-02", today]]) test(`analytics date preset: ${preset}`, () => assert.deepEqual(presetRange(preset, today), { from, to }));
test("previous period is contiguous, equal length, and handles leap days / DST", () => {
  assert.deepEqual(previousRange(range), { from: "2026-08-02", to: "2026-08-31" });
  assert.deepEqual(previousRange({ from: "2024-03-01", to: "2024-03-01" }), { from: "2024-02-29", to: "2024-02-29" });
  assert.deepEqual(previousRange({ from: "2026-10-03", to: "2026-10-05" }), { from: "2026-09-30", to: "2026-10-02" });
});
test("comparison avoids division by zero and exposes signed changes", () => { assert.equal(comparison(112.4, 100), "+12.4% vs previous period"); assert.match(comparison(1, 0), /^New/); assert.match(comparison(0, 0), /^No change/); assert.match(comparison(50, 100), /^-50.0%/); });
test("date buckets retain gaps and do not collapse long ranges", () => {
  assert.equal(timeBuckets(range).length, 30); assert.equal(timeBuckets({ from: "2026-01-01", to: "2026-12-31" }).length, 12);
  assert.equal(timeBuckets({ from: "2026-01-01", to: "2026-03-31" }).length, 13);
  assert.deepEqual(timeBuckets({ from: "invalid", to: today }), []);
  assert.equal(createdDate("not a date"), "");
});
test("financial totals reuse canonical cents and reconcile to customer accounts", t => {
  const { db, a } = fixture(t);
  assert.equal(a.metrics.invoiced, 363000); assert.equal(a.metrics.received, 331000); assert.equal(a.metrics.outstanding, 66000);
  for (const customer of a.customerRows) { const actual = getCustomerAccountSummary(db, customer.id, { today }); assert.equal(customer.invoiced, actual.totalInvoicedCents); assert.equal(customer.received, actual.totalReceivedCents); assert.equal(customer.outstanding, actual.outstandingCents); assert.equal(customer.invoiceCount, actual.invoiceCount); }
});
test("receipts use payment dates even for earlier invoices; snapshots retain later payments", t => {
  const { a } = fixture(t); assert.equal(a.periodPayments.length, 4); assert(a.periodPayments.some(p => p.jobId === "older")); assert(!a.periodPayments.some(p => p.date === today));
  assert.equal(a.invoices.find(i => i.jobId === "partial").balanceCents, 44000);
  assert.equal(a.buckets.reduce((s, b) => s + b.received, 0), 3310); assert.equal(a.buckets.reduce((s, b) => s + b.invoiced, 0), 3630);
});
test("outstanding reconciles per invoice with overpayments kept separate", t => {
  const { a } = fixture(t); for (const i of a.invoices) assert.equal(i.balanceCents, i.totalCents - i.paidCents + i.overpaidCents);
  assert.equal(a.invoices.find(i => i.jobId === "overpaid").overpaidCents, 1000);
});
test("draft, void, archived invoices and their receipts are excluded", t => {
  const { a, financials } = fixture(t); assert.equal(a.invoices.length, 5); assert.equal(financials.invoices.some(i => ["draft", "void", "archive"].includes(i.jobId)), false);
  assert.equal(a.metrics.overdueCount, 1); assert.equal(a.overdue[0].jobId, "partial");
});
test("aging buckets have exact boundaries and fully paid invoices never age", t => {
  const { data, financials } = fixture(t);
  const days = [0, 1, 30, 31, 60, 61, 90, 91];
  financials.invoices = days.map((day, n) => ({ ...financials.invoices[0], invoiceId: `a${n}`, jobId: "partial", balanceCents: 100, paidCents: 0, dueDate: new Date(Date.parse(today) - day * 86400000).toISOString().slice(0, 10) }));
  const a = deriveAnalytics(data, financials, range, {}, today);
  assert.deepEqual(a.aging.map(b => b.count), [1, 2, 2, 2, 1]); assert.equal(a.aging.reduce((s, b) => s + b.value, 0), 8);
});
test("customer and site filters constrain financials without altering invoice arithmetic", t => {
  const { data, financials } = fixture(t);
  const a = deriveAnalytics(data, financials, range, { customer: "c0", site: "s0" }, today);
  assert.equal(a.metrics.invoiced, 110000); assert.equal(a.metrics.received, 99000); assert.equal(a.metrics.outstanding, 44000);
  assert.equal(deriveAnalytics(data, financials, range, { customer: "c0", site: "s1" }, today).metrics.invoiced, 0);
});
test("customer types and new customer dates are explicit", t => { const { a } = fixture(t); assert.deepEqual(a.customerTypes.map(c => [c.name, c.value]).sort(), [["business", 2], ["homeowner", 1]]); assert.equal(a.metrics.newCustomers, 1); assert.equal(a.metrics.invoicedCustomers, 3); });
test("equal customer values use stable name/id ordering", t => {
  const { data, financials } = fixture(t); financials.invoices = [0, 1].map(n => ({ ...financials.invoices[0], invoiceId: `tie${n}`, jobId: n ? "paid" : "partial", customerId: `c${n}`, totalCents: 100 }));
  assert.deepEqual(deriveAnalytics(data, financials, range, {}, today).topCustomers.slice(0, 2).map(c => c.id), ["c0", "c1"]);
});
test("job status, urgency and assignment distributions reconcile; updates are not completions", t => {
  const { a } = fixture(t); assert.deepEqual(a.statusCounts.map(s => s.value), [3, 3, 3]); assert.equal(a.urgency.reduce((s, b) => s + b.value, 0), 9); assert.equal(a.technicians.reduce((s, b) => s + b.value, 0), 9);
  assert.equal(a.createdJobs.length, 8); assert(!Object.hasOwn(a.metrics, "completionDuration")); assert(a.buckets.every(b => !Object.hasOwn(b, "completed")));
});
test("maintenance next due, contract prices and forecast use recurrence semantics", t => {
  const { a } = fixture(t); assert.equal(a.metrics.activePlans, 2); assert.equal(a.metrics.contract, 60000); assert.equal(a.metrics.overduePlans, 1); assert.equal(a.metrics.due7, 1); assert.equal(a.metrics.due30, 1); assert.equal(a.forecast.length, 12);
  const expected = a.planRows.filter(p => p.active).flatMap(p => expandMaintenanceOccurrences(p, today, "2027-09-30", [], today)).filter(o => !o.completedAt).length;
  assert.equal(a.forecast.reduce((s, b) => s + b.visits, 0), expected);
});
test("maintenance moved occurrences are counted once and completed visits leave forecast", t => {
  const { data, financials } = fixture(t); const p = data.maintenancePlans.find(p => p.id === "plan-b"); const o = expandMaintenanceOccurrences(p, today, "2026-10-31", [], today)[0];
  p.occurrenceExceptions = [{ key: o.key, snapshot: o, overrideDate: "2026-11-02", completedAt: "2026-11-02T01:00:00Z" }];
  const a = deriveAnalytics(data, financials, range, {}, today); assert.equal(a.forecast[0].visits, 0); assert.equal(a.forecast.reduce((s, b) => s + b.visits, 0), 15);
});
test("job profitability is exactly Job Costing, including each supported category", t => {
  const { db, a, financials } = fixture(t); for (const row of financials.costing) { const actual = getJobCostingSummary(db, row.jobId); for (const key of ["revenueCents", "totalCostCents", "grossProfitCents", "marginPercent"]) assert.equal(row[key], actual[key]); }
  assert.equal(a.metrics.costed, 3); assert.equal(a.metrics.revenue, 300000); assert.equal(a.metrics.costs, 330000); assert.equal(a.metrics.profit, -30000); assert.equal(a.metrics.margin, -10);
  assert.equal(a.categoryTotals.length, 7); assert.equal(a.categoryTotals.reduce((s, c) => s + c.value, 0), 3300);
});
test("uncosted invoices are not labelled profitable; zero revenue and losses remain finite", t => {
  const { a } = fixture(t); assert.equal(a.metrics.uncosted, 2); assert.equal(a.costed.find(r => r.id === "unbilled").marginPercent, null); assert.equal(a.costed.find(r => r.id === "paid").marginPercent, -25);
  assert(reportTable("profitability", a).rows.filter(r => !r.hasCosts).every(r => r.marginPercent === null && r.grossProfitCents === null));
  assert(a.buckets.every(b => Number.isFinite(b.profit)));
});
test("all 19 reports expose usable columns, row identities and correct filtered rows", t => {
  const { data, financials } = fixture(t); const a = deriveAnalytics(data, financials, range, { customer: "c0" }, today);
  assert.equal(REPORTS.length, 19); for (const report of REPORTS) { const table = reportTable(report.id, a); assert(table.columns.length); assert(Array.isArray(table.rows)); }
  assert(reportTable("sales", a).rows.every(r => r.customerId === "c0")); assert.equal(reportTable("sales", a).rows.length, 1);
});
test("CSV exports only filtered rows, clean numbers, dates, quoted text and formula-safe strings", t => {
  const { data, financials } = fixture(t); const a = deriveAnalytics(data, financials, range, { customer: "c0" }, today), table = reportTable("sales", a);
  const csv = exportReportCsv(table.columns, table.rows); assert.match(csv, /1100\.00/); assert(!csv.includes("Beta Engineering")); assert.match(csv, /2026-09-04/);
  assert.equal(exportReportCsv([{ key: "text", label: "Text" }, { key: "value", label: "Value", type: "money" }], [{ text: 'hello, "world"\nnext', value: -123 }, { text: "=1+1", value: 0 }]), '\uFEFFText,Value\r\n"hello, ""world""\nnext",-1.23\r\n\'=1+1,0.00\r\n');
});
test("read-only reporting does not rebuild workspace or query per job; disabled costing is withheld", t => {
  const { db } = fixture(t); let count = 0; const prepare = db.prepare.bind(db);
  db.prepare = sql => { count++; assert(!/SELECT \* FROM (jobs|customers|sites|job_attachments)/i.test(sql)); assert(!/^(INSERT|UPDATE|DELETE)/i.test(sql)); return prepare(sql); };
  readReportingFinancials(db); assert(count <= 8, `queries: ${count}`); db.prepare = prepare;
  db.prepare("UPDATE settings SET value_json = ? WHERE key = 'addons'").run(JSON.stringify({ jobCosting: false })); const result = readReportingFinancials(db); assert.equal(result.costingEnabled, false); assert.deepEqual(result.costing, []);
});
test("actual invoice archive and restore leave and re-enter reporting exactly once", t => {
  const { db } = fixture(t);
  const deletion = deleteInvoiceForJob(db, "uncosted", { confirmSent: true });
  assert(!readReportingFinancials(db).invoices.some(i => i.jobId === "uncosted"));
  restoreDeletedInvoice(db, deletion.archiveId);
  assert.equal(readReportingFinancials(db).invoices.filter(i => i.jobId === "uncosted").length, 1);
});
test("same-name technicians stay separate; filters use IDs and real customer types", t => {
  const { data, financials, a } = fixture(t);
  assert.deepEqual(Object.fromEntries(a.technicians.map(row => [row.id, row.value])), { "tech-a": 4, "tech-b": 3, unassigned: 2 });
  const technician = deriveAnalytics(data, financials, range, { technician: "tech-b" }, today);
  assert.equal(technician.jobs.length, 3); assert(technician.jobs.every(j => j.assignedTechnicianId === "tech-b"));
  const type = deriveAnalytics(data, financials, range, { type: "homeowner" }, today);
  assert.equal(type.metrics.customers, 1); assert.equal(type.metrics.invoiced, 33000);
  // Simulate the existing browser normalizer, which drops these fields.
  const normalized = { ...data, jobs: data.jobs.map(job => ({ ...job, assignedTechnicianId: "", assignedTechnicianName: "" })) };
  const restored = deriveAnalytics(normalized, financials, range, { technician: "tech-a" }, today);
  assert.equal(restored.jobs.length, 4); assert.equal(restored.technicians[0].value, 4);
});
test("empty scope yields safe totals, complete time buckets and no artificial profit", t => {
  const { data, financials } = fixture(t); const a = deriveAnalytics(data, financials, range, { customer: "missing" }, today);
  assert.equal(a.metrics.invoiced, 0); assert.equal(a.metrics.margin, null); assert.equal(a.buckets.length, 30); assert.equal(reportTable("sales", a).rows.length, 0);
});
test("maintenance technician filters include plans before any assigned job is generated", t => {
  const { data, financials } = fixture(t); data.maintenancePlans.find(p => p.id === "plan-a").defaultTechnicianId = "tech-b";
  const a = deriveAnalytics(data, financials, range, { technician: "tech-b" }, today);
  assert.equal(a.planRows.length, 1); assert.equal(a.planRows[0].id, "plan-a"); assert.equal(a.metrics.contract, 40000);
});
