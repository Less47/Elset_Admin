import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentPdfPayload } from "../src/lib/document-pdf-payload.js";
import { buildDocumentEmail, defaultInvoiceTemplate, defaultQuoteTemplate, documentTemplatePlaceholders } from "../src/lib/quote-template.js";
import { buildDocumentPresentationModel, generateDocumentPdf } from "../quote-pdf.js";
import { readPdfTextRuns } from "./helpers/pdf-text.js";

for (const type of ["invoice", "quote"]) {
  test(`${type} projection preserves renderer output and email while removing duplicated history and images`, async () => {
    const template = {
      ...(type === "invoice" ? defaultInvoiceTemplate : defaultQuoteTemplate),
      companyName: "Snapshot company", companyEmail: "office@example.test",
      companyAddress: "1 Snapshot Street", companyPhone: "03 1234 5678",
      companyAbn: "12345", companyAcn: "67890", bankAccountName: "Snapshot account",
      bankBsb: "123456", bankAccountNumber: "987654",
      termsText: documentTemplatePlaceholders.join(" / "),
      logoDataUrl: "data:image/png;base64," + "A".repeat(1600 * 1024),
    };
    const history = Array.from({ length: 5 }, (_, index) => ({ id: `sent-${index}`, templateSnapshot: template }));
    const document = {
      issueDate: "2026-09-01", dueDate: "2026-09-08", notes: "Unsaved work description",
      items: [{ id: "line", description: "Unsaved item", qty: 2, rate: 125, attachment: template.logoDataUrl }],
      payments: [{ id: "payment", amount: 75, date: "2026-09-02", notes: "Private payment note" }],
      sentHistory: history,
    };
    const job = {
      id: "snapshot-job", jobNumber: 1234, title: "Snapshot title", description: "Snapshot description",
      customerName: "Snapshot customer", customerEmail: "fallback@example.test", jobAddress: "2 Snapshot Avenue",
      ocNumber: "CLIENT-REF", billingContact: { name: "Snapshot accounts", email: "billing@example.test", phone: "unused" },
      siteSnapshot: { id: "historical-site", address: "Old site", ocNumber: "HISTORICAL-OC" },
      invoice: document, quote: document, photos: [template.logoDataUrl], notes: history,
    };
    const input = { job, document, template, documentType: type, stampText: "PART PAYMENT", emailPurpose: "part-payment-receipt", emailSettings: { fromEmail: "from@example.test", replyToEmail: "reply@example.test", ccEmail: "copy@example.test", signature: "Test signature" } };
    const before = JSON.stringify(input);
    const payload = buildDocumentPdfPayload(input);
    assert.ok(Buffer.byteLength(before) > 15 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 5000);
    assert.equal(JSON.stringify(input), before, "Building a request must not change source records/snapshots");
    assert.equal(payload.job.invoice, undefined);
    assert.equal(payload.job.quote, undefined);
    assert.equal(payload.document.sentHistory, undefined);
    assert.equal(payload.template.logoDataUrl, undefined);
    assert.equal(payload.document.items[0].attachment, undefined);
    assert.equal(payload.job.siteSnapshot.ocNumber, "HISTORICAL-OC");
    assert.deepEqual(buildDocumentPresentationModel({ ...payload, type }), buildDocumentPresentationModel({ ...input, type }));
    assert.deepEqual(buildDocumentEmail({ ...payload, type }), buildDocumentEmail({ ...input, type }));
    const originalPdf = await generateDocumentPdf({ ...input, type });
    const compactPdf = await generateDocumentPdf({ ...payload, type });
    assert.equal(compactPdf.filename, originalPdf.filename);
    // Compare text AND positions/font sizes on every page, including totals.
    assert.deepEqual(await readPdfTextRuns(compactPdf.bytes), await readPdfTextRuns(originalPdf.bytes));
  });
}

test("legacy sent copies do not gain live site data and explicit missing sites stay missing", () => {
  const base = { job: { id: "legacy" }, document: { items: [] }, documentType: "invoice" };
  assert.equal(Object.hasOwn(buildDocumentPdfPayload(base).job, "siteSnapshot"), false);
  assert.equal(buildDocumentPdfPayload({ ...base, job: { ...base.job, siteSnapshot: null } }).job.siteSnapshot, null);
});
