import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { withDocumentSiteSnapshot } from "../src/lib/document-site-snapshot.js";
import { readPdfTextRuns } from "./helpers/pdf-text.js";
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
  ocNumber: "OC-INVOICE-35",
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
  assert.equal(model.ocNumber, "OC-INVOICE-35");
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
      ocNumber: "OC-QUOTE-42",
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
  assert.equal(model.ocNumber, "OC-QUOTE-42");
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

  const modelWithoutOcNumber = buildDocumentPresentationModel({
    job: { id: "quote-without-oc", jobNumber: 43, ocNumber: "   " },
    document: { type: "quote", issueDate: "2025-09-16", items: [] },
    template: defaultQuoteTemplate,
    type: "quote",
  });
  assert.equal(modelWithoutOcNumber.ocNumber, "");
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

const siteCustomers = [{
  id: "multi-site-customer",
  address: "1 Primary Street, Melbourne VIC 3000",
  sites: [
    { id: "site-a", address: "1 Primary Street, Melbourne VIC 3000", ocNumber: "111111" },
    { id: "site-b", address: invoiceJob.jobAddress, ocNumber: "222222" },
  ],
}];
const siteJob = { ...invoiceJob, customerId: "multi-site-customer" };
const invoiceInput = (job) => ({
  job, document: invoiceDocument, template: { ...defaultInvoiceTemplate, ...businessDetails }, type: "invoice",
});

test("invoice derives OC from the Job's Site B and keeps the client reference separate", async () => {
  const job = withDocumentSiteSnapshot({ ...siteJob, jobAddress: `  ${siteJob.jobAddress.toUpperCase()}  ` }, siteCustomers, "invoice");
  assert.equal(job.siteSnapshot.id, "site-b");
  const model = buildDocumentPresentationModel(invoiceInput(job));
  assert.equal(model.customerLines.at(-1), "OC: 222222");
  assert.equal(model.ocNumber, invoiceJob.ocNumber);
  const pages = await readPdfTextRuns((await generateDocumentPdf(invoiceInput(job))).bytes);
  const runs = pages[0];
  const ocIndex = runs.findIndex((run) => run.text === "OC: 222222");
  assert.ok(ocIndex > 0);
  const address = runs[ocIndex - 1];
  const oc = runs[ocIndex];
  assert.match(address.text, /SUNSHINE WEST VIC 3020/);
  assert.equal(oc.x, address.x);
  assert.equal(oc.font, address.font);
  assert.equal(oc.size, address.size);
  assert.ok(Math.abs(address.y - oc.y - 12.3) < 0.01);
  assert.ok(!runs.some((run) => run.text.includes("111111")));
  assert.ok(runs.some((run) => run.text === `Client reference: ${invoiceJob.ocNumber}`));
});

test("missing, null, empty and whitespace Site OC leave PDF content and spacing unchanged", async () => {
  const baseline = await readPdfTextRuns((await generateDocumentPdf(invoiceInput(siteJob))).bytes);
  for (const ocNumber of [undefined, null, "", " \t\n "]) {
    const customers = structuredClone(siteCustomers);
    customers[0].sites[1].ocNumber = ocNumber;
    const job = withDocumentSiteSnapshot(siteJob, customers, "invoice");
    const pages = await readPdfTextRuns((await generateDocumentPdf(invoiceInput(job))).bytes);
    assert.deepEqual(pages, baseline);
    assert.ok(!pages.flat().some((run) => /^OC:/.test(run.text)));
  }
  for (const job of [{ ...siteJob, customerId: "missing" }, { ...siteJob, jobAddress: "Unlinked address" }, { ...siteJob, jobAddress: "" }]) {
    assert.equal(withDocumentSiteSnapshot(job, siteCustomers, "invoice").siteSnapshot, null);
  }
});

test("OC labels preserve stored prefixes and quotes exclude Site OC", () => {
  for (const [value, expected] of [[" PS804335L ", "OC: PS804335L"], ["123456", "OC: 123456"], ["OC12345", "OC: OC12345"], ["OC: 12345", "OC: 12345"]]) {
    const job = { ...siteJob, siteSnapshot: { ocNumber: value } };
    assert.equal(buildDocumentPresentationModel(invoiceInput(job)).customerLines.at(-1), expected);
    assert.ok(!buildDocumentPresentationModel({ ...invoiceInput(job), type: "quote" }).customerLines.includes(expected));
  }
  assert.equal(withDocumentSiteSnapshot(siteJob, siteCustomers, "quote"), siteJob);
});

test("sent Site snapshots retain their OC after Site edits, while fresh invoices use current data", () => {
  const customers = structuredClone(siteCustomers);
  const sentJob = withDocumentSiteSnapshot(siteJob, customers, "invoice");
  customers[0].sites[1].ocNumber = "UPDATED";
  assert.equal(buildDocumentPresentationModel(invoiceInput(sentJob)).customerLines.at(-1), "OC: 222222");
  const currentJob = withDocumentSiteSnapshot(siteJob, customers, "invoice");
  assert.equal(buildDocumentPresentationModel(invoiceInput(currentJob)).customerLines.at(-1), "OC: UPDATED");
  assert.ok(!buildDocumentPresentationModel(invoiceInput(siteJob)).customerLines.some((line) => /^OC:/.test(line)));
});

test("long Site OC wraps within the recipient column and paginates without losing content", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const baseline = (await readPdfTextRuns((await generateDocumentPdf(invoiceInput(siteJob))).bytes))[0];
  for (const ocNumber of ["PS1234567890".repeat(22), "PROPERTY-REFERENCE ".repeat(250).trim()]) {
    const job = { ...siteJob, siteSnapshot: { ocNumber } };
    const pages = await readPdfTextRuns((await generateDocumentPdf(invoiceInput(job))).bytes);
    if (ocNumber.length > 1000) assert.ok(pages.length > 1);
    const ocRuns = pages.flat().filter((run) => run.x === DOCUMENT_LAYOUT.margin + 84 && run.size === 10.1).slice(4);
    assert.ok(ocRuns.length > 1);
    assert.match(ocRuns[0].text, /^OC: \S+/);
    assert.equal(ocRuns.map((run) => run.text).join("").replace(/\s/g, ""), `OC:${ocNumber}`.replace(/\s/g, ""));
    for (const run of ocRuns) {
      assert.ok(font.widthOfTextAtSize(run.text, run.size) <= 310.01);
      assert.ok(run.y >= 54 && run.y < DOCUMENT_LAYOUT.pageHeight - 80);
    }
    const metadata = (runs) => runs.filter((run) => run.y > 600 && (run.text.startsWith("Tax Invoice #") || run.text === "16th September 2025"));
    assert.deepEqual(metadata(pages[0]), metadata(baseline));
    const content = pages.flat().map((run) => run.text).join("\n");
    for (const label of ["WORK COMPLETED:", "DESCRIPTION", "TOTAL PRICE", "BALANCE DUE:", "$6,000.00"]) assert.ok(content.includes(label), label);
    for (const page of pages) {
      const lastOc = page.filter((run) => ocRuns.includes(run)).at(-1);
      const work = page.find((run) => run.text === "WORK COMPLETED:");
      if (lastOc && work) assert.ok(work.y < lastOc.y - 12.3);
    }
  }
});
