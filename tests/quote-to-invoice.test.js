import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceDraftFromQuote, invoiceConversionDraft } from "../src/lib/quote-to-invoice.js";

const defaults = () => ({ type: "invoice", issueDate: "2026-10-05", dueDate: "2026-10-12", notes: "", paymentNotes: "", payments: [], sentHistory: [], items: [{ id: "blank", description: "", qty: 1, rate: 0 }] });
const quoteFixture = () => ({
  type: "quote", issueDate: "2020-01-01", dueDate: "2020-01-08", notes: "Proposed scope, not completed work",
  items: [
    { id: "quote-labour", description: "Gate labour", qty: "2.5", rate: "145.00", unit: "hour", taxTreatment: "taxable", priceListItemId: "catalog-labour", extra: { tags: ["service"], specification: { model: "M1" } } },
    { id: "quote-travel", description: "Travel", qty: 1, rate: 50 },
  ],
  sentHistory: [{ id: "sent-quote", toEmail: "customer@example.test" }], email: { subject: "Old quote" },
  payments: [{ id: "old-payment", amount: 100 }], paidAmount: 100, paymentStatus: "paid", paymentManagement: "quickbooks", paymentNotes: "Old payment notes",
  accountingMappings: { externalId: "remote" }, externalInvoiceId: "external", providerId: "quickbooks", id: "quote-record",
});

test("conversion copies commercial values and nested metadata with fresh independent line IDs", () => {
  const quote = quoteFixture(), before = structuredClone(quote);
  const invoice = buildInvoiceDraftFromQuote(quote, defaults());
  const second = buildInvoiceDraftFromQuote(quote, defaults());
  invoice.items.forEach((line, index) => {
    assert.deepEqual({ ...line, id: quote.items[index].id }, quote.items[index]);
    assert.notEqual(line.id, quote.items[index].id);
    assert.notEqual(line.id, second.items[index].id);
  });
  assert.equal(new Set(invoice.items.map((line) => line.id)).size, 2);
  invoice.items[0].description = "Edited invoice";
  invoice.items[0].extra.tags.push("invoice");
  invoice.items[0].extra.specification.model = "M2";
  assert.deepEqual(quote, before);
  assert.deepEqual(second.items[0].extra, before.items[0].extra);
});

test("conversion uses supplied new-invoice defaults and copies no quote document state", () => {
  const normal = defaults(), quote = quoteFixture();
  const invoice = buildInvoiceDraftFromQuote(quote, normal);
  assert.deepEqual({ ...invoice, items: normal.items }, normal);
  assert.equal(invoice.issueDate, normal.issueDate);
  assert.equal(invoice.dueDate, normal.dueDate);
  assert.equal(invoice.notes, "");
  assert.equal(invoice.paymentNotes, "");
  assert.deepEqual(invoice.payments, []);
  assert.deepEqual(invoice.sentHistory, []);
  for (const key of ["email", "paidAmount", "paymentStatus", "paymentManagement", "accountingMappings", "externalInvoiceId", "providerId", "id"]) assert.equal(Object.hasOwn(invoice, key), false);
});

test("empty or malformed quote lines retain the normal blank line", () => {
  for (const items of [[], null, undefined, "legacy malformed"]) {
    const normal = defaults();
    assert.deepEqual(buildInvoiceDraftFromQuote({ items }, normal), normal);
  }
});

test("route transfer applies only to this job's unsaved invoice", () => {
  const job = { id: "job-one", quote: quoteFixture(), invoice: null };
  const document = buildInvoiceDraftFromQuote(job.quote, defaults());
  const state = { quoteInvoiceDraft: { jobId: job.id, document } };
  assert.equal(invoiceConversionDraft(job, "invoice", state), document);
  assert.equal(invoiceConversionDraft(job, "quote", state), null);
  assert.equal(invoiceConversionDraft({ ...job, quote: null }, "invoice", state), null);
  assert.equal(invoiceConversionDraft({ ...job, id: "other-job" }, "invoice", state), null);
  assert.equal(invoiceConversionDraft({ ...job, invoice: defaults() }, "invoice", state), null);
  for (const absent of [null, {}, { quoteInvoiceDraft: {} }, { quoteInvoiceDraft: { jobId: job.id, document: { type: "quote", items: [] } } }]) {
    assert.equal(invoiceConversionDraft(job, "invoice", absent), null);
  }
});
