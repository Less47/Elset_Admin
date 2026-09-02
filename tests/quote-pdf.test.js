import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  DOCUMENT_LAYOUT,
  buildDocumentPresentationModel,
  formatDocumentDate,
  generateDocumentPdf,
} from "../quote-pdf.js";
import {
  defaultInvoiceTemplate,
  defaultQuoteTemplate,
} from "../src/lib/quote-template.js";

const businessDetails = {
  companyName: "ELSET PTY LTD",
  companyAbn: "93 686 524 621",
  companyAcn: "",
  companyEmail: "admin@elset.com.au",
  companyPhone: "03 9000 0000",
  companyAddress: "7 Mohr Street, Tullamarine VIC 3043",
  bankAccountName: "ELSET PTY LTD",
  bankBsb: "033 505",
  bankAccountNumber: "243 033",
};

const invoiceJob = {
  id: "job-invoice-35",
  jobNumber: 35,
  title: "Gate automation installation",
  description: "Install underground swing gate automation at the completed site.",
  customerName: "Colour Earth Wrought Ironworks",
  customerEmail: "accounts@example.test",
  jobAddress: "12 E Circuit, Sunshine West VIC 3020",
  billingContact: {
    name: "Riggo Jeff",
    email: "accounts@example.test",
  },
};

const invoiceDocument = {
  type: "invoice",
  issueDate: "2025-09-16",
  dueDate: "2025-09-23",
  notes: [
    "Supply and installation of double underground swing gate automation.",
    "Supply and installation of single underground garage door swing gate automation system.",
  ].join("\n"),
  items: [
    {
      id: "line-double",
      description: "Supply and installation of double underground swing gate automation.\nDEA Ghost 100",
      qty: 1,
      rate: 6500,
    },
    {
      id: "line-single",
      description: "Supply and installation of single underground garage door swing gate automation system.",
      qty: 1,
      rate: 4500,
    },
  ],
  payments: [
    { id: "deposit", amount: 6100, date: "2025-09-17" },
  ],
};

test("document dates use stable Australian ordinal formatting", () => {
  assert.equal(formatDocumentDate("2025-09-01"), "1st September 2025");
  assert.equal(formatDocumentDate("2025-09-02"), "2nd September 2025");
  assert.equal(formatDocumentDate("2025-09-03"), "3rd September 2025");
  assert.equal(formatDocumentDate("2025-09-11"), "11th September 2025");
  assert.equal(formatDocumentDate("2025-09-23"), "23rd September 2025");
  assert.equal(formatDocumentDate("not-a-date"), "not-a-date");
});

test("invoice presentation matches the ELSET commercial hierarchy and existing financial logic", () => {
  const model = buildDocumentPresentationModel({
    job: invoiceJob,
    document: invoiceDocument,
    template: { ...defaultInvoiceTemplate, ...businessDetails },
    type: "invoice",
  });

  assert.equal(model.layout, DOCUMENT_LAYOUT);
  assert.equal(model.layout.format, "A4 portrait");
  assert.equal(model.layout.pageBackground, "#FFFFFF");
  assert.equal(model.layout.outerBorder, false);
  assert.equal(model.layout.tableCellBorders, false);
  assert.equal(model.title, "Tax Invoice");
  assert.equal(model.reference, "INV-0035");
  assert.equal(model.issueDateDisplay, "16th September 2025");
  assert.deepEqual(model.customerLines, [
    "Riggo Jeff",
    "Colour Earth Wrought Ironworks",
    "12 E Circuit",
    "Sunshine West VIC 3020",
  ]);
  assert.equal(model.work.heading, "Work Completed");
  assert.equal(model.work.text, invoiceDocument.notes);
  assert.deepEqual(model.table.headers, ["Description", "Qty", "Unit Price", "Total Price"]);
  assert.equal(model.financials.subtotal, 11000);
  assert.equal(model.financials.gst, 1100);
  assert.equal(model.financials.total, 12100);
  assert.equal(model.financials.paid, 6100);
  assert.equal(model.financials.balanceDue, 6000);
  assert.deepEqual(model.financials.rows.map(({ label }) => label), [
    "Subtotal",
    "GST",
    "Total",
    "Paid",
    "Balance Due",
  ]);
  assert.equal(model.business.address, businessDetails.companyAddress);
  assert.equal(model.business.abn, businessDetails.companyAbn);
  assert.equal(model.terms.heading, "How to Pay");
  assert.deepEqual(model.payment.bankRows, [
    { label: "Name", value: "ELSET PTY LTD" },
    { label: "BSB", value: "033 505" },
    { label: "Account Number", value: "243 033" },
  ]);
  assert.equal(model.payment.remittanceEmail, "admin@elset.com.au");
  assert.equal(model.payment.summaryReference, "Tax Invoice # INV-0035");
  assert.equal(model.payment.summaryDue, "$6,000.00 due by 23rd September 2025");
  assert.deepEqual(model.sections, [
    "header",
    "customer",
    "work-completed",
    "line-items",
    "totals",
    "payment",
    "footer",
  ]);
});

test("quote presentation uses scope and validity while excluding invoice payment sections", () => {
  const model = buildDocumentPresentationModel({
    job: {
      id: "quote-job",
      jobNumber: 42,
      title: "Gate safety upgrade",
      description: "Inspect the automation and replace the safety sensor.",
      customerName: "Sample Customer",
      jobAddress: "",
      billingContact: { name: "Sample Customer" },
    },
    document: {
      type: "quote",
      issueDate: "2025-09-16",
      notes: "Pricing includes the listed labour and parts only.",
      items: [{ id: "quote-line", description: "Safety sensor pair", qty: 2, rate: 240 }],
    },
    template: {
      ...defaultQuoteTemplate,
      ...businessDetails,
      companyAbn: "",
      companyPhone: "",
      introText: "{{jobDescription}}",
    },
    type: "quote",
  });

  assert.equal(model.title, "Quote");
  assert.equal(model.reference, "QT-0042");
  assert.deepEqual(model.customerLines, ["Sample Customer"]);
  assert.equal(model.work.heading, "Scope of Work");
  assert.match(model.work.text, /Inspect the automation/);
  assert.match(model.work.text, /Pricing includes/);
  assert.equal(model.quoteValidUntil, "2025-10-16");
  assert.equal(model.quoteValidUntilDisplay, "16th October 2025");
  assert.equal(model.quoteSummary.validity, "Valid until 16th October 2025");
  assert.equal(model.payment, null);
  assert.equal(model.business.abn, "");
  assert.equal(model.business.phone, "");
  assert.deepEqual(model.financials.rows.map(({ label }) => label), ["Subtotal", "GST", "Total"]);
  assert.ok(!model.financials.rows.some(({ label }) => /paid|balance/i.test(label)));
  assert.deepEqual(model.sections, [
    "header",
    "customer",
    "scope",
    "line-items",
    "totals",
    "terms",
    "footer",
  ]);
});

test("invoice PDF generation produces a valid sharp-text A4 document and receipt variant", async () => {
  const result = await generateDocumentPdf({
    job: invoiceJob,
    document: invoiceDocument,
    template: { ...defaultInvoiceTemplate, ...businessDetails },
    type: "invoice",
    stampText: "PART PAYMENT",
  });

  assert.equal(result.filename, "INV-0035.pdf");
  assert.equal(Buffer.from(result.bytes).subarray(0, 4).toString("ascii"), "%PDF");
  const pdf = await PDFDocument.load(result.bytes);
  assert.equal(pdf.getTitle(), "Tax Invoice INV-0035");
  assert.ok(pdf.getPageCount() >= 1);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - DOCUMENT_LAYOUT.pageWidth) < 0.01);
    assert.ok(Math.abs(page.getHeight() - DOCUMENT_LAYOUT.pageHeight) < 0.01);
  }
});

test("long quote content paginates into valid A4 continuation pages", async () => {
  const items = Array.from({ length: 72 }, (_, index) => ({
    id: `long-line-${index}`,
    description: `Line ${index + 1}: supply, install, configure, and test gate automation equipment with a naturally wrapping service description.`,
    qty: index % 3 === 0 ? 1.5 : 1,
    rate: 125 + index,
  }));
  const result = await generateDocumentPdf({
    job: {
      ...invoiceJob,
      id: "long-quote-job",
      jobNumber: 88,
      description: "A multi-stage commercial gate automation upgrade.",
    },
    document: {
      type: "quote",
      issueDate: "2025-09-16",
      notes: "Complete the staged works in consultation with the site manager.",
      items,
    },
    template: { ...defaultQuoteTemplate, ...businessDetails },
    type: "quote",
  });

  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(pdf.getPageCount() > 1);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - DOCUMENT_LAYOUT.pageWidth) < 0.01);
    assert.ok(Math.abs(page.getHeight() - DOCUMENT_LAYOUT.pageHeight) < 0.01);
  }
});
