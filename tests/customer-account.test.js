import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { getCustomerAccountSummary } from "../server-customer-account.js";
import { createCustomerRouter } from "../server-customer-routes.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { addInvoicePayment, updateInvoicePayment, deleteInvoicePayment, replaceInvoiceForJob, insertInvoiceTree, insertQuoteTree, deleteInvoiceForJob, updateInvoiceForJob, addDocumentSentHistory } from "../server-workspace-documents.js";
import { invoiceOverdueDays, invoiceStatusFromAmounts } from "../src/lib/invoice-account.js";
import { money } from "../src/lib/quote-template.js";

const today = "2026-09-15";
const sentHistory = [{ id: "sent", sentAt: "2026-09-01", toEmail: "accounts@example.test" }];
const invoice = (options = {}) => ({ type: "invoice", issueDate: "2026-09-01", dueDate: "2026-09-30", items: [{ qty: 1, rate: 100, description: "Synthetic service" }], sentHistory, ...options });
const quote = { type: "quote", status: "accepted", items: [{ qty: 1, rate: 99999 }], sentHistory };

function setup(t, dbPath = ":memory:") {
  const db = openWorkspaceDb({ dbPath });
  t.after(() => { if (db.open) db.close(); });
  db.exec("INSERT INTO customers(id,name,created_at) VALUES('a','Customer A','2026-09-01'),('b','Customer B','2026-09-01')");
  let index = 0;
  const job = ({ id = `job-${++index}`, customerId = "a", status = "Quoted", address = "First Site", quote: quoteInput, invoice: invoiceInput } = {}) => {
    db.prepare("INSERT INTO jobs(id,job_number,title,customer_id,job_address,status,created_at,updated_at) VALUES(?,?,'Synthetic job',?,?,?,'2026-09-01','2026-09-01')").run(id, 1000 + db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, customerId, address, status);
    if (quoteInput) insertQuoteTree(db, id, quoteInput);
    if (invoiceInput) insertInvoiceTree(db, id, invoiceInput);
    return id;
  };
  return { db, job, summary: (customerId = "a") => getCustomerAccountSummary(db, customerId, { today }) };
}

for (const [name, jobs, expected] of [
  ["quoted job only => $0 outstanding", [{ quote }], 0],
  ["accepted quote with no invoice => $0 outstanding", [{ quote, status: "To Do" }], 0],
  ["quote + unpaid invoice => only invoice balance counts", [{ quote, invoice: invoice() }], 11000],
  ["multiple quoted jobs + one invoice => only invoice balance counts", [{ quote }, { quote }, { quote }, { invoice: invoice({ payments: [{ id: "p", amount: 30, date: today }] }) }], 8000],
]) {
  test(`SQLite: ${name}`, (t) => {
    const { job, summary } = setup(t);
    jobs.forEach(job);
    assert.equal(summary().outstandingCents, expected);
  });
}

test("no invoices, fully paid invoices, overpayments and zero-value invoices contribute zero", (t) => {
  const { job, summary } = setup(t);
  assert.equal(summary().outstandingCents, 0);
  job({ invoice: invoice({ payments: [{ id: "paid", amount: 110, date: today }] }) });
  job({ invoice: invoice({ payments: [{ id: "overpaid", amount: 900, date: today }] }) });
  job({ invoice: invoice({ items: [{ qty: 1, rate: 0 }] }) });
  assert.equal(summary().outstandingCents, 0);
  assert.equal(summary().openInvoiceCount, 0);
});

test("multi-site aggregation uses only the invoice's actual Customer, never job status or a same-name customer", (t) => {
  const { db, job, summary } = setup(t);
  db.exec("UPDATE customers SET name='Same name'");
  job({ address: "Site One", status: "Completed", invoice: invoice() });
  job({ address: "Site Two", status: "To Do", invoice: invoice({ items: [{ qty: 1, rate: 1000 }], payments: [{ id: "p1", amount: 200, date: today }, { id: "p2", amount: 400, date: today }] }) });
  job({ customerId: "b", invoice: invoice({ items: [{ qty: 1, rate: 99999 }] }) });
  assert.equal(summary().outstandingCents, 61000);
  assert.equal(summary().openInvoiceCount, 2);
  assert.equal(summary().invoices.find((row) => row.paidCents > 0).balanceCents, 50000);
  assert.equal(summary().invoices.find((row) => row.paidCents > 0).status.id, "partially-paid");
});

test("future and past-due unissued drafts are excluded; quote send history does not issue an invoice", (t) => {
  const { job, summary } = setup(t);
  job({ invoice: invoice({ sentHistory: [], dueDate: "2000-01-01" }), quote });
  job({ invoice: invoice({ sentHistory: [] }) });
  assert.equal(summary().outstandingCents, 0);
  assert.equal(summary().overdueInvoiceCount, 0);
  job({ invoice: invoice({ sentHistory: [], payments: [{ id: "deposit", amount: 10, date: today }] }) });
  assert.equal(summary().outstandingCents, 10000);
  assert.equal(summary().invoices[0].status.id, "deposit-paid");
});

test("overdue sorting, counts and oldest age use a positive balance and a real date before today", (t) => {
  const { db, job, summary } = setup(t);
  const noDate = job({ invoice: invoice() });
  updateInvoiceForJob(db, noDate, { dueDate: "" });
  job({ invoice: invoice({ dueDate: today }) });
  job({ invoice: invoice({ dueDate: "2026-09-14" }) });
  job({ invoice: invoice({ dueDate: "2026-08-22" }) });
  job({ invoice: invoice({ dueDate: "2000-01-01", payments: [{ id: "paid", amount: 110, date: today }] }) });
  const result = summary();
  assert.equal(result.outstandingCents, 44000);
  assert.equal(result.overdueInvoiceCount, 2);
  assert.equal(result.oldestOverdueDays, 24);
  assert.deepEqual(result.invoices.map((row) => row.dueDate), ["2026-08-22", "2026-09-14", today, ""]);
  assert.equal(invoiceOverdueDays(100, "2026-02-30", today), 0);
  assert.equal(invoiceOverdueDays(0, "2026-09-01", today), 0);
  assert.equal(invoiceOverdueDays(100, "2026-10-04", "2026-10-05"), 1);
});

test("deleted archives and explicit legacy void/cancel markers are excluded without altering records", (t) => {
  const { db, job, summary } = setup(t);
  const removed = job({ invoice: invoice() });
  deleteInvoiceForJob(db, removed, { confirmSent: true });
  for (const metadata of [{ status: "void" }, { status: "cancelled" }, { voidedAt: today }, { deleted: true }]) {
    const id = job({ invoice: invoice() });
    db.prepare("UPDATE invoices SET extra_json=? WHERE job_id=?").run(JSON.stringify(metadata), id);
  }
  const before = db.serialize();
  assert.equal(summary().outstandingCents, 0);
  assert.deepEqual(db.serialize(), before);
});

test("line rounding, GST and multiple payments use the exact existing integer-cents calculation", (t) => {
  const { db, job, summary } = setup(t);
  const id = job({ invoice: invoice({ items: [{ qty: "0.333333", rate: "0.05" }, { qty: "0.333333", rate: "0.05" }], payments: [{ id: "one-cent", amount: "0.01", date: today }] }) });
  const authoritative = updateInvoiceForJob(db, id, { notes: "Keep the existing financial calculation" });
  assert.equal(authoritative.financialsCents.totalCents, 4);
  assert.equal(summary().outstandingCents, 3);
  assert.equal(summary().invoices[0].totalCents, authoritative.financialsCents.totalCents);
});

test("creation, edits, issuance, payment recording/edit/removal and deletion refresh derived balances", (t) => {
  const { db, job, summary } = setup(t);
  const id = job({ quote });
  assert.equal(summary().outstandingCents, 0);
  replaceInvoiceForJob(db, id, invoice({ sentHistory: [] }));
  assert.equal(summary().outstandingCents, 0);
  addDocumentSentHistory(db, id, "invoice", sentHistory[0]);
  assert.equal(summary().outstandingCents, 11000);
  addInvoicePayment(db, id, { id: "p", amount: 40, date: today });
  assert.equal(summary().outstandingCents, 7000);
  updateInvoicePayment(db, id, "p", { amount: 60 });
  assert.equal(summary().outstandingCents, 5000);
  deleteInvoicePayment(db, id, "p");
  assert.equal(summary().outstandingCents, 11000);
  replaceInvoiceForJob(db, id, invoice({ items: [{ qty: 1, rate: 200 }] }));
  assert.equal(summary().outstandingCents, 22000);
  deleteInvoiceForJob(db, id, { confirmSent: true });
  assert.equal(summary().outstandingCents, 0);
});

test("summary includes every open balance but only five open invoices in its breakdown", (t) => {
  const { job, summary } = setup(t);
  for (let i = 0; i < 12; i++) job({ invoice: invoice() });
  for (let i = 0; i < 20; i++) job({ invoice: invoice({ payments: [{ id: `paid-${i}`, amount: 110, date: today }] }) });
  assert.equal(summary().outstandingCents, 132000);
  assert.equal(summary().openInvoiceCount, 12);
  assert.equal(summary().invoices.length, 5);
  assert.equal(summary().hasMore, true);
  assert.equal(summary().invoiceCount, 32);
  assert.equal(summary().totalInvoicedCents, 352000);
  assert.equal(summary().totalReceivedCents, 220000);
});

test("invoice status distinguishes absent and fully paid invoices", () => {
  assert.equal(invoiceStatusFromAmounts({ exists: false }).id, "not-invoiced");
  assert.equal(invoiceStatusFromAmounts({ total: 100, balance: 0, paid: 100 }).id, "paid");
});

test("account API is authenticated, role-restricted, customer-scoped, read-only and never returns the workspace", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-account-api-"));
  const dbPath = path.join(directory, "elset-workspace.db");
  const { db, job } = setup(t, dbPath);
  job({ invoice: invoice() }); job({ customerId: "b", invoice: invoice({ items: [{ qty: 1, rate: 9999 }] }) });
  const before = db.serialize();
  const env = { ELSET_WORKSPACE_DB_PATH: dbPath, ELSET_DATA_DIR: directory };
  const app = express();
  app.use(createCustomerRouter({ env,
    requireAuth: (req, res, next) => { if (!req.headers["x-test-role"]) return res.sendStatus(401); req.user = { role: req.headers["x-test-role"] }; next(); },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/customers/`;
  try {
    for (const [role, expected] of [[null, 401], ["technician", 403], ["admin", 200], ["office", 200]]) {
      const response = await fetch(`${base}a/account-summary?today=${today}`, { headers: role ? { "x-test-role": role } : {} });
      assert.equal(response.status, expected);
      if (expected !== 200) continue;
      assert.equal(response.headers.get("cache-control"), "no-store");
      const payload = await response.json();
      assert.equal(payload.outstandingCents, 11000);
      assert.equal(payload.totalInvoicedCents, 11000);
      assert.equal(payload.totalReceivedCents, 0);
      assert.equal(payload.invoiceCount, 1);
      assert.equal(payload.customerId, "a");
      assert.equal(payload.invoices.length, 1);
      assert.equal(payload.state, undefined);
      assert.equal(payload.customers, undefined);
    }
    assert.equal((await fetch(`${base}missing/account-summary`, { headers: { "x-test-role": "admin" } })).status, 404);
    assert.equal((await fetch(`${base}a/account-summary?today=bad`, { headers: { "x-test-role": "admin" } })).status, 400);
    assert.deepEqual(db.serialize(), before);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
});

const lifetimeValues = (summary) => ({
  invoiced: summary.totalInvoicedCents, received: summary.totalReceivedCents,
  outstanding: summary.outstandingCents, invoices: summary.invoiceCount,
});

test(`SQLite: lifetime totals include paid, partial and unpaid invoices across jobs/sites, excluding drafts and quotes`, (t) => {
  const jobs = [
    { id: "paid", customerId: "a", address: "First site", invoice: invoice({ payments: [{ id: "full", amount: 110, date: today }] }) },
    { id: "partial", customerId: "a", address: "Second site", invoice: invoice({ items: [{ qty: 1, rate: 200 }], payments: [{ id: "part", amount: 70, date: today }] }) },
    { id: "unpaid", customerId: "a", address: "Third site", invoice: invoice({ items: [{ qty: 1, rate: 300 }] }) },
    { id: "draft", customerId: "a", invoice: invoice({ sentHistory: [], items: [{ qty: 1, rate: 9999 }] }) },
    { id: "quote", customerId: "a", quote },
    { id: "other", customerId: "b", invoice: invoice({ items: [{ qty: 1, rate: 9999 }] }) },
  ];
  let result;
  const fixture = setup(t);
  jobs.forEach(fixture.job);
  const before = fixture.db.serialize();
  result = fixture.summary();
  assert.deepEqual(fixture.db.serialize(), before);
  assert.deepEqual(lifetimeValues(result), { invoiced: 66000, received: 18000, outstanding: 48000, invoices: 3 });
  assert.equal(result.openInvoiceCount, 2);
  assert.equal(result.invoices.length, 2);
  assert.equal(result.totalInvoicedCents - result.totalReceivedCents, result.outstandingCents);
});

test(`SQLite: no invoices shows all zero lifetime values`, (t) => {
  const result = setup(t).summary();
  assert.deepEqual(lifetimeValues(result), { invoiced: 0, received: 0, outstanding: 0, invoices: 0 });
  assert.equal(money(result.totalInvoicedCents / 100), "$0.00");
});

test(`SQLite: explicit drafts, deleted, archived, invalid and incomplete invoices do not count`, (t) => {
  const excluded = [{ status: "draft" }, { status: "unfinished" }, { deleted: true }, { deletedAt: today }, { status: "void" },
    { archived: true }, { archivedAt: today }, { status: "archived" }, { invalid: true }, { incomplete: true }, { status: "incomplete" }];
  let result;
  const fixture = setup(t);
  excluded.forEach((extra) => {
    const id = fixture.job({ invoice: invoice() });
    fixture.db.prepare("UPDATE invoices SET extra_json=? WHERE job_id=?").run(JSON.stringify(extra), id);
  });
  const removed = fixture.job({ invoice: invoice() });
  deleteInvoiceForJob(fixture.db, removed, { confirmSent: true });
  assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM deleted_invoices").get().n, 1);
  const blank = fixture.job({ invoice: invoice() });
  fixture.db.prepare("DELETE FROM invoice_line_items WHERE invoice_id=(SELECT id FROM invoices WHERE job_id=?)").run(blank);
  const undated = fixture.job({ invoice: invoice() });
  fixture.db.prepare("UPDATE invoices SET issue_date='' WHERE job_id=?").run(undated);
  fixture.job({ invoice: invoice({ items: [{ qty: 1, rate: 0 }] }) });
  result = fixture.summary();
  assert.deepEqual(lifetimeValues(result), { invoiced: 0, received: 0, outstanding: 0, invoices: 0 });
});

test("historical ServiceM8 import counts each current invoice once, ignoring history snapshots and cached totals", (t) => {
  const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url)));
  const customer = fixture.customers[0], template = fixture.jobs[0];
  const historicalInvoice = invoice({ id: "servicem8-historical-invoice", issueDate: "2020-01-01", dueDate: "2020-01-31",
    items: [{ qty: 1, rate: 100 }, { qty: 2, rate: 100 }], total: 999999, balanceDue: 999999,
    payments: [{ id: "historic-payment-1", amount: 100, date: "2020-01-10" }, { id: "historic-payment-2", amount: 230, date: "2020-01-20" }],
    sentHistory: [1, 2].map((id) => ({ id: `historic-sent-${id}`, sentAt: "2020-01-01", toEmail: "accounts@example.test", documentSnapshot: invoice({ items: [{ qty: 1, rate: 99999 }] }) })),
  });
  fixture.customers = [{ ...customer, sites: [], contacts: [], siteAccessNotes: [] }];
  fixture.maintenancePlans = [];
  fixture.jobs = [{ ...template, id: "servicem8-job-historical", customerId: customer.id, jobNumber: 77, notes: [], photos: [], maintenancePlanId: "",
    externalRefs: { servicem8: { uuid: "historic-external-job" } }, invoice: historicalInvoice, quote }];
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  t.after(() => db.close());
  importWorkspaceJsonData(db, fixture);
  const expected = { invoiced: 33000, received: 33000, outstanding: 0, invoices: 1 };
  assert.deepEqual(lifetimeValues(getCustomerAccountSummary(db, customer.id)), expected);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM invoices").get().n, 1);
});

test("lifetime values use current invoice edits and existing per-invoice overpayment balances", (t) => {
  const { db, job, summary } = setup(t);
  const paid = job({ invoice: invoice({ payments: [{ id: "overpayment", amount: 150, date: today }] }) });
  job({ invoice: invoice() });
  assert.deepEqual(lifetimeValues(summary()), { invoiced: 22000, received: 15000, outstanding: 11000, invoices: 2 });
  replaceInvoiceForJob(db, paid, invoice({ items: [{ qty: 1, rate: 200 }] }));
  assert.deepEqual(lifetimeValues(summary()), { invoiced: 33000, received: 15000, outstanding: 18000, invoices: 2 });
  updateInvoicePayment(db, paid, "overpayment", { amount: 220 });
  assert.deepEqual(lifetimeValues(summary()), { invoiced: 33000, received: 22000, outstanding: 11000, invoices: 2 });
});

test("lifetime amounts use existing AUD currency formatting", () => {
  assert.deepEqual([4258000, 3794000, 464000, 0, 1].map((cents) => money(cents / 100)), ["$42,580.00", "$37,940.00", "$4,640.00", "$0.00", "$0.01"]);
});
