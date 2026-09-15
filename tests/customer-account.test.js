import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { getCustomerAccountSummary } from "../server-customer-account.js";
import { createCustomerRouter } from "../server-customer-routes.js";
import { addInvoicePayment, updateInvoicePayment, deleteInvoicePayment, replaceInvoiceForJob, insertInvoiceTree, insertQuoteTree, deleteInvoiceForJob, updateInvoiceForJob, addDocumentSentHistory } from "../server-workspace-documents.js";
import { invoiceOverdueDays, invoiceStatusFromAmounts, summarizeJsonCustomerAccount } from "../src/lib/invoice-account.js";

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
  test(`JSON: ${name}`, () => {
    const records = jobs.map((record, index) => ({ ...record, id: `job-${index}`, jobNumber: 1000 + index, customerId: "a" }));
    assert.equal(summarizeJsonCustomerAccount("a", records, { today }).outstandingCents, expected);
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
});

test("JSON legacy paid markers, missing dates and ignored cached totals cannot fabricate balances", () => {
  const jobs = [
    { id: "paid", customerId: "a", invoice: invoice({ payments: [], paymentStatus: "Paid" }) },
    { id: "open", customerId: "a", quote, invoice: invoice({ dueDate: "", total: 99999, balanceDue: 99999 }) },
    { id: "void", customerId: "a", invoice: invoice({ status: "voided" }) },
    { id: "quote-slot", customerId: "a", invoice: quote },
    { id: "other", customerId: "b", invoice: invoice() },
  ];
  const result = summarizeJsonCustomerAccount("a", jobs, { today });
  assert.equal(result.outstandingCents, 11000);
  assert.equal(result.overdueInvoiceCount, 0);
  assert.equal(result.invoices[0].dueDate, "");
  assert.equal(invoiceStatusFromAmounts({ exists: false }).id, "not-invoiced");
  assert.equal(invoiceStatusFromAmounts({ total: 100, balance: 0, paid: 100 }).id, "paid");
});

test("account API is authenticated, role-restricted, customer-scoped, read-only and never returns the workspace", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-account-api-"));
  const dbPath = path.join(directory, "elset-workspace.db");
  const { db, job } = setup(t, dbPath);
  job({ invoice: invoice() }); job({ customerId: "b", invoice: invoice({ items: [{ qty: 1, rate: 9999 }] }) });
  const before = db.serialize();
  const env = { ELSET_WORKSPACE_STORAGE: "sqlite", ELSET_WORKSPACE_DB_PATH: dbPath, ELSET_DATA_DIR: directory };
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
