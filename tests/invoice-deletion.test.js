import assert from "node:assert/strict";
import test from "node:test";
import { deleteJsonInvoice, restoreJsonInvoice } from "../server-invoice-archive.js";
import { invoiceDeletionRestriction, invoiceHasBeenSent } from "../src/lib/invoice-deletion.js";

const invoice = { items: [{ id: "item", description: "Service", qty: 1, rate: 200 }], payments: [], sentHistory: [] };
const state = () => ({ jobs: [{ id: "job", jobNumber: 241, invoice: structuredClone(invoice), quote: { notes: "Keep" }, customerId: "customer", customerName: "Customer", notes: ["Keep"] }], customers: [{ id: "customer" }], deletedInvoices: [] });

test("JSON invoice archive keeps a full recoverable snapshot without mutating input or related records", () => {
  const before = state(), copy = structuredClone(before);
  const deleted = deleteJsonInvoice(before, "job", { deletedBy: "office" });
  assert.deepEqual(before, copy);
  assert.equal(deleted.state.jobs[0].invoice, null);
  assert.deepEqual(deleted.state.jobs[0].quote, before.jobs[0].quote);
  assert.deepEqual(deleted.state.customers, before.customers);
  const archive = deleted.state.deletedInvoices[0];
  assert.equal(archive.invoiceNumber, "INV-0241");
  assert.equal(archive.deletedBy, "office");
  assert.deepEqual(archive.invoice, invoice);
  const restored = restoreJsonInvoice(deleted.state, archive.id);
  assert.deepEqual(restored.state.jobs[0].invoice, invoice);
  assert.equal(restored.state.deletedInvoices.length, 0);
  assert.notEqual(restored.state.jobs[0].invoiceArchiveRevision, deleted.state.jobs[0].invoiceArchiveRevision);
  assert.throws(() => restoreJsonInvoice({ ...deleted.state, jobs: [] }, archive.id), /Restore the linked job/);
  assert.throws(() => restoreJsonInvoice({ ...deleted.state, jobs: before.jobs }, archive.id), /already has an invoice/);
  assert.throws(() => restoreJsonInvoice(deleted.state, "missing"), /not found/);
});

test("JSON deletion requires explicit sent confirmation and blocks payments and receipt history", () => {
  const original = state();
  original.jobs[0].invoice.sentHistory = [{ id: "sent", sentAt: "2026-01-01", documentSnapshot: invoice }];
  assert.equal(invoiceHasBeenSent(original.jobs[0].invoice), true);
  assert.throws(() => deleteJsonInvoice(original, "job"), (error) => error.statusCode === 409 && error.code === "INVOICE_ALREADY_SENT");
  assert.equal(deleteJsonInvoice(original, "job", { confirmSent: true }).state.deletedInvoices[0].invoice.sentHistory.length, 1);
  for (const change of [
    { payments: [{ amount: 0 }] }, { payments: [{ amount: 100 }] }, { paidAmount: 100 }, { paymentStatus: "Paid" },
    { sentHistory: [{ emailPurpose: "paid-receipt" }] }, { sentHistory: [{ stampText: "PART PAYMENT" }] },
    { sentHistory: [{ documentSnapshot: { payments: [{ amount: 30 }] } }] },
  ]) {
    const candidate = state();
    Object.assign(candidate.jobs[0].invoice, change);
    assert.throws(() => deleteJsonInvoice(candidate, "job", { confirmSent: true }), /payment/i);
    assert.ok(candidate.jobs[0].invoice);
    assert.deepEqual(candidate.deletedInvoices, []);
  }
  assert.equal(invoiceDeletionRestriction({ sentHistory: [null] }), "");
});
