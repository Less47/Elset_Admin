import assert from "node:assert/strict";
import test from "node:test";
import { isInvoicedRow, matchesInvoiceJobStatus } from "../src/lib/invoice-filters.js";
import { statuses } from "../src/lib/job-status.js";

test("invoice list includes sent and paid invoices but excludes new jobs, unsent drafts and void invoices", () => {
  const row = (invoice, paidAmount = 0) => ({ job: { invoice }, invoice, paymentSummary: { paidAmount } });
  assert.equal(isInvoicedRow(row(null)), false);
  assert.equal(isInvoicedRow(row({ sentHistory: [], dueDate: "2000-01-01" })), false);
  assert.equal(isInvoicedRow(row({ sentHistory: [{ id: "sent" }] })), true);
  assert.equal(isInvoicedRow(row({ sentHistory: [] }, 20)), true);
  assert.equal(isInvoicedRow(row({ sentHistory: [], status: "void" }, 20)), false);
});

test("job status filtering retains orphan and missing-status invoices only under All", () => {
  const orphan = { invoice: { id: "legacy-invoice" }, job: null };
  const missingStatus = { invoice: { id: "missing-status-invoice" }, job: { id: "legacy-job" } };
  const rows = [...statuses.map((status) => ({ invoice: { id: status }, job: { status } })), orphan, missingStatus];
  assert.deepEqual(rows.filter((row) => matchesInvoiceJobStatus(row, "all")), rows);
  for (const status of statuses) {
    const result = rows.filter((row) => matchesInvoiceJobStatus(row, status));
    assert.equal(result.length, 1);
    assert.equal(result[0].job.status, status);
    assert.ok(!result.includes(orphan) && !result.includes(missingStatus));
  }
});

test("job status filtering includes invoice candidates and preserves row contents and order", () => {
  const rows = [
    { invoice: { id: "invoice-a", items: [{ qty: 2, rate: 25 }], payments: [{ amount: 10 }] }, job: { status: "Completed" } },
    { invoice: null, job: { status: "To Do" } },
    { invoice: null, job: { status: "Completed" } },
  ];
  const before = structuredClone(rows);
  const result = rows.filter((row) => matchesInvoiceJobStatus(row, "Completed"));
  assert.deepEqual(result, [rows[0], rows[2]]);
  assert.equal(result[0], rows[0]);
  assert.deepEqual(rows, before);
});
