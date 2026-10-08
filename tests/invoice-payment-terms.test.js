import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarMonth, invoiceDueDateMode, invoiceSendDate, invoiceTermsOnFirstSend } from "../src/lib/invoice-payment-terms.js";
import { invoiceOverdueDays, invoiceStatusFromAmounts } from "../src/lib/invoice-account.js";
import { buildJobCardIndicators } from "../src/components/service-board/service-board-utils.js";
import { normalizeStoredData } from "../server-store.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { insertInvoiceTree, replaceInvoiceForJob, addDocumentSentHistory, updateInvoiceForJob } from "../server-workspace-documents.js";
import { getCustomerAccountSummary } from "../server-customer-account.js";
import { readReportingFinancials } from "../server-reporting.js";
import { deriveAnalytics } from "../src/lib/analytics.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { sendDocumentAndPersistHistory } from "../src/hooks/document-send-workflow.js";
import { readAccountingInvoice } from "../server-accounting-workspace.js";

const invoice = (patch = {}) => ({ issueDate: "2026-10-08", dueDate: "2026-11-08", dueDateMode: "auto",
  items: [{ qty: 1, rate: 100, description: "Service" }], payments: [], sentHistory: [], ...patch });
const history = (id = "send-1", sentAt = "2026-10-12T01:00:00Z") => ({ id, sentAt, toEmail: "accounts@example.test" });
function setup(t, document = invoice()) {
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  t.after(() => db.close());
  db.exec("INSERT INTO customers(id,name,created_at) VALUES('customer','Customer','2026-10-08'); INSERT INTO jobs(id,job_number,title,customer_id,job_address,status,created_at,updated_at) VALUES('job',1,'Service','customer','Site','Completed','2026-10-08','2026-10-08')");
  insertInvoiceTree(db, "job", document);
  return { db, current: () => loadWorkspaceStateFromDb(db).jobs[0].invoice,
    send: (entry = history()) => addDocumentSentHistory(db, "job", "invoice", entry) };
}

for (const [from, expected] of [["2026-10-08", "2026-11-08"], ["2027-01-15", "2027-02-15"],
  ["2027-01-31", "2027-02-28"], ["2028-01-31", "2028-02-29"], ["2027-03-31", "2027-04-30"],
  ["2026-12-31", "2027-01-31"], ["2028-02-29", "2028-03-29"]]) {
  test(`one calendar month clamps ${from} to ${expected}`, () => assert.equal(addCalendarMonth(from), expected));
}
test("calendar month rejects invalid input and send dates use the Sydney business day", () => {
  for (const value of ["", "2027-02-29", "2026-04-31", null]) assert.equal(addCalendarMonth(value), "");
  assert.equal(invoiceSendDate("2026-10-11T14:30:00Z"), "2026-10-12");
  assert.equal(invoiceSendDate("2027-01-31"), "2027-01-31");
  assert.equal(invoiceSendDate("invalid"), "");
});
test("automatic drafts display a month provisionally and metadata survives normalization and storage", t => {
  const { db, current } = setup(t);
  assert.equal(current().dueDate, "2026-11-08");
  assert.equal(current().dueDateMode, "auto");
  assert.equal(normalizeStoredData({ jobs: [{ id: "job", invoice: current() }] }).jobs[0].invoice.dueDateMode, "auto");
  assert.equal(replaceInvoiceForJob(db, "job", { issueDate: "2027-01-31", items: invoice().items }).invoice.dueDate, "2026-11-08", "omitted due date preserves a saved invoice");
});
test("first confirmed send persists anchored terms and history together and resends never extend them", t => {
  const { db, current, send } = setup(t);
  const first = send({ ...history(), documentSnapshot: invoice() });
  assert.equal(first.invoice.dueDate, "2026-11-12");
  assert.equal(first.invoice.sentHistory[0].documentSnapshot.dueDate, "2026-11-12");
  assert.equal(first.status.id, "unpaid");
  assert.equal(current().dueDate, "2026-11-12");
  assert.equal(send(history("send-2", "2026-10-20T01:00:00Z")).invoice.dueDate, "2026-11-12");
  assert.equal(send().duplicate, true);
  assert.equal(current().sentHistory.length, 2);
  replaceInvoiceForJob(db, "job", invoice());
  assert.equal(current().dueDate, "2026-11-12", "a stale automatic editor cannot reset the first-send date");
  assert.equal(JSON.parse(db.prepare("SELECT extra_json FROM invoices").get().extra_json).dueDateMode, "auto");
  assert.equal(readAccountingInvoice(db, "job").dueDate, "2026-11-12", "existing provider mappings read the persisted ELSET term");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM integration_entity_mappings").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM integration_payment_outbox").get().count, 0, "customer sends do not queue accounting work");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM integration_operations").get().count, 0);
});
test("history persistence failure rolls back the automatic date without a duplicate email", async t => {
  const { db, current, send } = setup(t);
  db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON document_send_history BEGIN SELECT RAISE(ABORT, 'history unavailable'); END");
  let sends = 0;
  const result = await sendDocumentAndPersistHistory({ sendEmail: async () => { sends++; return { ok: true, sentAt: history().sentAt }; },
    buildHistoryEntry: () => history(), persistHistory: () => send() });
  assert.equal(result.status, "sent");
  assert.equal(result.historySaved, false);
  assert.equal(sends, 1);
  assert.equal(current().dueDate, "2026-11-08");
  assert.equal(current().sentHistory.length, 0);
});
test("failed email leaves terms and history unchanged", async t => {
  const { current, send } = setup(t);
  const before = current();
  const result = await sendDocumentAndPersistHistory({ sendEmail: async () => { throw new Error("rejected"); },
    buildHistoryEntry: () => history(), persistHistory: () => send() });
  assert.equal(result.status, "failed");
  assert.deepEqual(current(), before);
});
for (const [name, document, expected] of [
  ["manual override", invoice({ dueDate: "2027-01-10", dueDateMode: "manual" }), "2027-01-10"],
  ["legacy unsent seven-day default", invoice({ dueDate: "2026-10-15", dueDateMode: undefined }), "2026-11-12"],
  ["legacy custom due date", invoice({ dueDate: "2026-10-16", dueDateMode: undefined }), "2026-10-16"],
  ["legacy sent invoice", invoice({ dueDate: "2026-10-15", dueDateMode: undefined, sentHistory: [history("old", "2026-10-08")] }), "2026-10-15"],
  ["existing paid invoice", invoice({ dueDate: "2026-10-15", payments: [{ id: "paid", amount: 110, date: "2026-10-08" }] }), "2026-10-15"],
]) test(`${name} compatibility on successful send`, t => {
  const { current, send } = setup(t, document);
  assert.equal(send().invoice.dueDate, expected);
  assert.equal(current().dueDate, expected);
});
test("legacy persisted invoices without metadata are classified conservatively without a bulk rewrite", t => {
  const { db, current, send } = setup(t, invoice({ dueDate: "2026-10-15" }));
  db.prepare("UPDATE invoices SET extra_json='{}'").run();
  assert.equal(invoiceDueDateMode(current()), "auto");
  assert.equal(current().dueDate, "2026-10-15");
  assert.equal(send().invoice.dueDate, "2026-11-12");
});
test("PATCH Due date persists a manual override and preserves other metadata", t => {
  const { db, send } = setup(t, invoice({ custom: "preserve" }));
  const changed = updateInvoiceForJob(db, "job", { dueDate: "2027-02-01" });
  assert.equal(changed.invoice.dueDateMode, "manual");
  assert.equal(changed.invoice.custom, "preserve");
  assert.equal(send().invoice.dueDate, "2027-02-01");
});
test("saving an existing manual invoice without term metadata cannot reset its policy", t => {
  const { db, send } = setup(t, invoice({ dueDateMode: "manual", dueDate: "2027-02-01" }));
  replaceInvoiceForJob(db, "job", { issueDate: "2026-10-08", items: invoice().items });
  assert.equal(send().invoice.dueDate, "2027-02-01");
});
test("invoice states and Service Board lifecycle indicators are mutually exclusive", () => {
  for (const [name, patch, id, indicator] of [
    ["no invoice", { exists: false }, "not-invoiced", "not-invoiced"],
    ["old unsent invoice", { sentCount: 0 }, "draft", "not-invoiced"],
    ["sent before due", { sentCount: 1, dueDate: "2026-11-01" }, "unpaid", "invoice-pending"],
    ["due today", { sentCount: 1, dueDate: "2026-10-08" }, "unpaid", "invoice-pending"],
    ["sent overdue", { sentCount: 1 }, "overdue", "invoice-overdue"],
    ["paid", { balance: 0, paid: 110 }, "paid", "invoice-paid"],
    ["overdue partial", { sentCount: 1, paid: 10, balance: 100, paymentCount: 1 }, "overdue", "invoice-overdue"],
    ["unsent deposit", { paid: 10, balance: 100, paymentCount: 1 }, "deposit-paid", "not-invoiced"],
  ]) {
    const status = invoiceStatusFromAmounts({ total: 110, balance: 110, dueDate: "2000-01-01", today: "2026-10-08", ...patch });
    assert.equal(status.id, id, name);
    const job = { status: "Completed", invoice: patch.exists === false ? null : invoice({ sentHistory: patch.sentCount ? [{}] : [] }) };
    const entries = buildJobCardIndicators({ job, invoiceStatus: status });
    assert.deepEqual(entries.map(entry => entry.id), [indicator], name);
  }
  assert.equal(invoiceOverdueDays(110, "2000-01-01", "2026-10-08", 0), 0);
});
test("account, reporting, aging and board agree for unsent deposits and later sent invoices", t => {
  const { db, current, send } = setup(t, invoice({ dueDate: "2000-01-01", payments: [{ id: "deposit", amount: 10, date: "2026-10-08" }] }));
  const summary = () => getCustomerAccountSummary(db, "customer", { today: "2026-10-08" });
  const analytics = () => deriveAnalytics(loadWorkspaceStateFromDb(db), readReportingFinancials(db), { from: "2026-10-01", to: "2026-10-31" }, {}, "2026-10-08");
  assert.equal(summary().overdueInvoiceCount, 0);
  assert.equal(summary().invoices[0].status.id, "deposit-paid");
  assert.equal(analytics().metrics.overdueCount, 0);
  assert.equal(analytics().aging[0].count, 1);
  assert.equal(analytics().invoices[0].overdueDays, 0);
  const before = current();
  assert.equal(invoiceTermsOnFirstSend(before, "invalid"), before);
  send();
  assert.equal(summary().overdueInvoiceCount, 0, "automatic due date anchors to the confirmed date");
  assert.equal(getCustomerAccountSummary(db, "customer", { today: "2026-11-13" }).overdueInvoiceCount, 1);
  const row = readReportingFinancials(db).invoices[0];
  assert.equal(invoiceStatusFromAmounts({ total: row.totalCents, balance: row.balanceCents, paid: row.paidCents,
    paymentCount: row.paymentCount, sentCount: row.sentCount, dueDate: row.dueDate, today: "2026-11-13" }).id, "overdue");
});
