import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDocumentTemplateContext,
  buildTemplateWithBusinessDetails,
  defaultInvoiceTemplate,
  defaultQuoteTemplate,
  documentBusinessDetailKeys,
  documentTemplatePlaceholders,
  fillTemplateText,
  formatDocumentDate,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "../src/lib/quote-template.js";

const originalQuoteIntro =
  "Thank you for the opportunity to quote for {{jobTitle}} for {{customerName}}. The quoted work is outlined below.";
const originalQuoteTerms =
  "This quote is valid for 14 days from {{issueDate}}. Please reply to {{companyEmail}} if you would like us to proceed.";
const previousQuoteTerms =
  "This quote is valid for 30 days from {{issueDate}}. {{quoteReplyInstructions}}";
const originalInvoiceIntro =
  "Please find your invoice for {{jobTitle}} for {{customerName}}. The completed work and charges are outlined below.";
const originalInvoiceTerms =
  "Payment is due within 7 days of {{issueDate}}. Please contact {{companyEmail}} if you have any questions about this invoice.";
const previousInvoiceTerms =
  "We accept payment by Direct Credit, cheque, or cash.\n\nDirect Credit:\n{{bankDetails}}\n\nCheques can be made payable to {{companyName}}. Cash payments are accepted by arrangement.";

test("professional quote and invoice defaults retain the structured business fields", () => {
  assert.deepEqual(normalizeQuoteTemplate(), defaultQuoteTemplate);
  assert.deepEqual(normalizeInvoiceTemplate(), defaultInvoiceTemplate);

  assert.equal(defaultQuoteTemplate.quoteHeading, "Quote");
  assert.equal(defaultQuoteTemplate.notesHeading, "Scope of Work");
  assert.equal(defaultQuoteTemplate.termsHeading, "Quote Validity");
  assert.equal(
    defaultQuoteTemplate.termsText,
    "This quote is valid until {{quoteValidUntilDisplay}}. {{quoteReplyInstructions}}"
  );

  assert.equal(defaultInvoiceTemplate.quoteHeading, "Tax Invoice");
  assert.equal(defaultInvoiceTemplate.introText, "");
  assert.equal(defaultInvoiceTemplate.notesHeading, "Work Completed");
  assert.equal(defaultInvoiceTemplate.termsHeading, "How to Pay");
  assert.equal(defaultInvoiceTemplate.termsText, "We accept payment by: Direct Credit / Cheque / Cash");

  for (const key of documentBusinessDetailKeys) {
    assert.ok(Object.hasOwn(defaultQuoteTemplate, key), `quote default is missing ${key}`);
    assert.ok(Object.hasOwn(defaultInvoiceTemplate, key), `invoice default is missing ${key}`);
  }

  for (const placeholder of [
    "{{documentReference}}",
    "{{paid}}",
    "{{balanceDue}}",
    "{{dueDate}}",
    "{{dueDateDisplay}}",
    "{{issueDateDisplay}}",
    "{{quoteValidUntilDisplay}}",
  ]) {
    assert.ok(documentTemplatePlaceholders.includes(placeholder), `${placeholder} should be available`);
  }
});

test("normalization migrates exact legacy stock strings to the professional defaults", () => {
  const quote = normalizeQuoteTemplate({
    quoteHeading: "Service Quote",
    introText: originalQuoteIntro,
    notesHeading: "",
    termsHeading: "Terms & Next Steps",
    termsText: previousQuoteTerms,
    footerText: "Thank you for choosing {{companyName}}.",
  });

  assert.equal(quote.quoteHeading, defaultQuoteTemplate.quoteHeading);
  assert.equal(quote.introText, defaultQuoteTemplate.introText);
  assert.equal(quote.notesHeading, defaultQuoteTemplate.notesHeading);
  assert.equal(quote.termsHeading, defaultQuoteTemplate.termsHeading);
  assert.equal(quote.termsText, defaultQuoteTemplate.termsText);
  assert.equal(quote.footerText, defaultQuoteTemplate.footerText);
  assert.equal(normalizeQuoteTemplate({ termsText: originalQuoteTerms }).termsText, defaultQuoteTemplate.termsText);

  const invoice = normalizeInvoiceTemplate({
    quoteHeading: "Service Invoice",
    introText: originalInvoiceIntro,
    notesHeading: "Work Completed",
    termsHeading: "Payment Terms",
    termsText: previousInvoiceTerms,
  });

  assert.equal(invoice.quoteHeading, defaultInvoiceTemplate.quoteHeading);
  assert.equal(invoice.introText, defaultInvoiceTemplate.introText);
  assert.equal(invoice.notesHeading, defaultInvoiceTemplate.notesHeading);
  assert.equal(invoice.termsHeading, defaultInvoiceTemplate.termsHeading);
  assert.equal(invoice.termsText, defaultInvoiceTemplate.termsText);
  assert.equal(normalizeInvoiceTemplate({ termsText: originalInvoiceTerms }).termsText, defaultInvoiceTemplate.termsText);
});

test("normalization leaves customized template values unchanged", () => {
  const customizedQuote = {
    quoteHeading: "Service Quote ",
    introText: `${originalQuoteIntro} Please ask about scheduling.`,
    notesHeading: "Scope Notes ",
    termsHeading: "Our Terms & Next Steps",
    termsText: `${previousQuoteTerms} Prices include delivery.`,
    footerText: "Thank you for choosing our local team.",
  };
  const customizedInvoice = {
    quoteHeading: "Commercial Invoice",
    introText: "Please review the completed works below.",
    notesHeading: "Completed Works",
    termsHeading: "Payment Options",
    termsText: `${previousInvoiceTerms}\nCard payments are also available.`,
    footerText: "Custom invoice footer.",
  };

  for (const [key, value] of Object.entries(customizedQuote)) {
    assert.equal(normalizeQuoteTemplate(customizedQuote)[key], value);
  }
  for (const [key, value] of Object.entries(customizedInvoice)) {
    assert.equal(normalizeInvoiceTemplate(customizedInvoice)[key], value);
  }
});

test("business settings overlay template content without discarding editable template fields", () => {
  const template = {
    ...defaultInvoiceTemplate,
    quoteHeading: "Custom Tax Document",
    termsText: "Custom payment instructions.",
    companyName: "Stale Template Business",
    companyEmail: "stale@example.test",
    bankBsb: "000-000",
  };
  const businessDetails = {
    companyName: "  ELSET Settings Pty Ltd  ",
    companyAbn: " 93 686 524 621 ",
    companyAcn: " 686 524 621 ",
    companyEmail: " accounts@example.test ",
    companyPhone: " 03 9000 0000 ",
    companyAddress: " 7 Mohr Street\nTullamarine VIC 3043 ",
    bankAccountName: " ELSET PTY LTD ",
    bankBsb: " 033-505 ",
    bankAccountNumber: " 243033 ",
  };
  const overlaid = buildTemplateWithBusinessDetails(template, businessDetails, "invoice");

  assert.equal(overlaid.quoteHeading, "Custom Tax Document");
  assert.equal(overlaid.termsText, "Custom payment instructions.");
  assert.equal(overlaid.companyName, "ELSET Settings Pty Ltd");
  assert.equal(overlaid.companyAbn, "93 686 524 621");
  assert.equal(overlaid.companyAcn, "686 524 621");
  assert.equal(overlaid.companyEmail, "accounts@example.test");
  assert.equal(overlaid.companyPhone, "03 9000 0000");
  assert.equal(overlaid.companyAddress, "7 Mohr Street\nTullamarine VIC 3043");
  assert.equal(overlaid.bankAccountName, "ELSET PTY LTD");
  assert.equal(overlaid.bankBsb, "033-505");
  assert.equal(overlaid.bankAccountNumber, "243033");
  assert.equal(template.companyName, "Stale Template Business");
});

test("invoice context exposes business, customer, GST, payment, balance, and due-date values", () => {
  const context = buildDocumentTemplateContext({
    type: "invoice",
    job: {
      id: "job-invoice-35",
      jobNumber: 35,
      customerName: "Colour Earth Wrought Ironworks",
      customerEmail: "customer@example.test",
      billingContact: {
        name: "Jeff Riggo",
        email: " billing@example.test ",
      },
      title: "Gate automation",
      description: "Supply and installation of gate automation.",
      jobAddress: "12 E Circuit\nSunshine West VIC 3020",
    },
    document: {
      issueDate: "2025-09-16",
      dueDate: "2025-09-23",
      items: [
        { qty: 2, rate: 1000 },
        { qty: 0.5, rate: 500 },
      ],
      payments: [
        { amount: 1000 },
        { amount: "475" },
        { amount: -50 },
        { amount: "not-a-number" },
      ],
    },
    template: {
      ...defaultInvoiceTemplate,
      companyName: "ELSET PTY LTD",
      companyAbn: "93 686 524 621",
      companyAcn: "686 524 621",
      companyEmail: "admin@elset.com.au",
      companyPhone: "03 9000 0000",
      companyAddress: "7 Mohr Street\nTullamarine VIC 3043",
      bankAccountName: "ELSET PTY LTD",
      bankBsb: "033-505",
      bankAccountNumber: "243033",
    },
  });

  assert.equal(context.companyName, "ELSET PTY LTD");
  assert.equal(context.companyAbn, "93 686 524 621");
  assert.equal(context.companyAcn, "686 524 621");
  assert.equal(context.companyEmail, "admin@elset.com.au");
  assert.equal(context.companyPhone, "03 9000 0000");
  assert.equal(context.companyAddress, "7 Mohr Street\nTullamarine VIC 3043");
  assert.equal(context.bankAccountName, "ELSET PTY LTD");
  assert.equal(context.bankBsb, "033-505");
  assert.equal(context.bankAccountNumber, "243033");
  assert.equal(
    context.bankDetails,
    "Account name: ELSET PTY LTD\nBSB: 033-505\nAccount number: 243033"
  );
  assert.equal(context.customerName, "Colour Earth Wrought Ironworks");
  assert.equal(context.customerEmail, "billing@example.test");
  assert.equal(context.jobTitle, "Gate automation");
  assert.equal(context.jobDescription, "Supply and installation of gate automation.");
  assert.equal(context.jobAddress, "12 E Circuit\nSunshine West VIC 3020");
  assert.equal(context.documentReference, "INV-0035");
  assert.equal(context.quoteReference, "INV-0035");
  assert.equal(context.issueDate, "2025-09-16");
  assert.equal(context.issueDateDisplay, "16th September 2025");
  assert.equal(context.dueDate, "2025-09-23");
  assert.equal(context.dueDateDisplay, "23rd September 2025");
  assert.equal(context.quoteValidUntil, "");
  assert.equal(context.quoteValidUntilDisplay, "");
  assert.equal(context.subtotal, "$2,250.00");
  assert.equal(context.gst, "$225.00");
  assert.equal(context.total, "$2,475.00");
  assert.equal(context.paid, "$1,475.00");
  assert.equal(context.balanceDue, "$1,000.00");
});

test("quote context derives a deterministic 30-day validity date without mutating raw dates", () => {
  const quote = {
    issueDate: "2024-02-01",
    items: [{ qty: 1, rate: 100 }],
  };
  const originalQuote = JSON.parse(JSON.stringify(quote));
  const context = buildDocumentTemplateContext({
    type: "quote",
    job: {
      id: "quote-job",
      jobNumber: 7,
      customerName: "Quote Customer",
      description: "Inspect and automate the existing swing gate.",
    },
    document: quote,
    template: {
      ...defaultQuoteTemplate,
      companyEmail: "quotes@example.test",
      companyPhone: "0400 000 007",
    },
  });

  assert.deepEqual(quote, originalQuote);
  assert.equal(context.documentReference, "QT-0007");
  assert.equal(context.issueDate, "2024-02-01");
  assert.equal(context.issueDateDisplay, "1st February 2024");
  assert.equal(context.quoteValidUntil, "2024-03-02");
  assert.equal(context.quoteValidUntilDisplay, "2nd March 2024");
  assert.equal(context.dueDate, "");
  assert.equal(context.dueDateDisplay, "");
  assert.equal(context.subtotal, "$100.00");
  assert.equal(context.gst, "$10.00");
  assert.equal(context.total, "$110.00");
  assert.equal(context.paid, "$0.00");
  assert.equal(context.balanceDue, "$110.00");
  assert.equal(
    context.quoteReplyInstructions,
    "Please reply to quotes@example.test or call 0400 000 007 if you would like us to proceed."
  );
  assert.equal(
    fillTemplateText(defaultQuoteTemplate.termsText, context),
    "This quote is valid until 2nd March 2024. Please reply to quotes@example.test or call 0400 000 007 if you would like us to proceed."
  );
});

test("empty optional values remain safe and date display rejects invalid calendar dates", () => {
  const context = buildDocumentTemplateContext({
    type: "invoice",
    job: { id: "" },
    document: {
      issueDate: "",
      dueDate: "",
      items: [],
      payments: [],
    },
    template: {
      ...defaultInvoiceTemplate,
      companyName: "",
      companyAbn: "",
      companyAcn: "",
      companyEmail: "",
      companyPhone: "",
      companyAddress: "",
      bankAccountName: "",
      bankBsb: "",
      bankAccountNumber: "",
    },
  });

  assert.equal(context.companyName, "");
  assert.equal(context.companyEmail, "");
  assert.equal(context.companyPhone, "");
  assert.equal(context.bankDetails, "Bank details available on request.");
  assert.equal(context.customerName, "");
  assert.equal(context.customerEmail, "");
  assert.equal(context.jobTitle, "");
  assert.equal(context.jobDescription, "");
  assert.equal(context.jobAddress, "");
  assert.equal(context.issueDate, "");
  assert.equal(context.issueDateDisplay, "");
  assert.equal(context.dueDate, "");
  assert.equal(context.dueDateDisplay, "");
  assert.equal(context.quoteReplyInstructions, "");
  assert.equal(context.subtotal, "$0.00");
  assert.equal(context.gst, "$0.00");
  assert.equal(context.total, "$0.00");
  assert.equal(context.paid, "$0.00");
  assert.equal(context.balanceDue, "$0.00");
  assert.equal(formatDocumentDate("2025-02-29"), "");
  assert.equal(formatDocumentDate("not-a-date"), "");
});

test("placeholder filling resolves document payment and date fields and removes unknown values", () => {
  const context = {
    documentReference: "INV-0035",
    paid: "$6,100.00",
    balanceDue: "$6,000.00",
    dueDate: "2025-09-23",
    dueDateDisplay: "23rd September 2025",
    zeroValue: 0,
  };

  assert.equal(
    fillTemplateText(
      "{{ documentReference }} | paid {{paid}} | due {{balanceDue}} by {{dueDateDisplay}} ({{dueDate}}) | {{missing}} | {{zeroValue}}",
      context
    ),
    "INV-0035 | paid $6,100.00 | due $6,000.00 by 23rd September 2025 (2025-09-23) |  | 0"
  );
  assert.equal(fillTemplateText("", context), "");
});
