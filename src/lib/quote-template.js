export const ADMIN_EMAIL = "admin@elset.com.au";

export const documentTemplatePlaceholders = [
  "{{companyName}}",
  "{{companyAbn}}",
  "{{companyAcn}}",
  "{{companyEmail}}",
  "{{companyPhone}}",
  "{{companyAddress}}",
  "{{bankAccountName}}",
  "{{bankBsb}}",
  "{{bankAccountNumber}}",
  "{{bankDetails}}",
  "{{customerName}}",
  "{{customerEmail}}",
  "{{jobTitle}}",
  "{{jobDescription}}",
  "{{jobAddress}}",
  "{{issueDate}}",
  "{{issueDateDisplay}}",
  "{{dueDate}}",
  "{{dueDateDisplay}}",
  "{{quoteValidUntil}}",
  "{{quoteValidUntilDisplay}}",
  "{{quoteReplyInstructions}}",
  "{{quoteReference}}",
  "{{documentReference}}",
  "{{subtotal}}",
  "{{gst}}",
  "{{paid}}",
  "{{balanceDue}}",
  "{{total}}",
];

export const quoteTemplatePlaceholders = documentTemplatePlaceholders;

export const documentBusinessDetailKeys = [
  "companyName",
  "companyAbn",
  "companyAcn",
  "companyEmail",
  "companyPhone",
  "companyAddress",
  "bankAccountName",
  "bankBsb",
  "bankAccountNumber",
];

export const defaultQuoteTemplate = {
  companyName: "Elset",
  companyAbn: "",
  companyAcn: "",
  companyEmail: ADMIN_EMAIL,
  companyPhone: "",
  companyAddress: "",
  bankAccountName: "ELSET PTY LTD",
  bankBsb: "",
  bankAccountNumber: "",
  accentColor: "#0f172a",
  quoteHeading: "Quote",
  introText: "{{jobDescription}}",
  notesHeading: "Scope of Work",
  termsHeading: "Quote Validity",
  termsText:
    "This quote is valid until {{quoteValidUntilDisplay}}. {{quoteReplyInstructions}}",
  footerText: "",
};

export const defaultInvoiceTemplate = {
  companyName: "Elset",
  companyAbn: "",
  companyAcn: "",
  companyEmail: ADMIN_EMAIL,
  companyPhone: "",
  companyAddress: "",
  bankAccountName: "ELSET PTY LTD",
  bankBsb: "",
  bankAccountNumber: "",
  accentColor: "#0f172a",
  quoteHeading: "Tax Invoice",
  introText: "",
  notesHeading: "Work Completed",
  termsHeading: "How to Pay",
  termsText: "We accept payment by: Direct Credit / Cheque / Cash",
  footerText: "Thank you for choosing {{companyName}}.",
};

const legacyTemplateStockValues = {
  quote: {
    quoteHeading: ["Service Quote"],
    introText: [
      "Thank you for the opportunity to quote for {{jobTitle}} for {{customerName}}. The quoted work is outlined below.",
    ],
    notesHeading: ["Scope Notes", ""],
    termsHeading: ["Terms & Next Steps"],
    termsText: [
      "This quote is valid for 14 days from {{issueDate}}. Please reply to {{companyEmail}} if you would like us to proceed.",
      "This quote is valid for 30 days from {{issueDate}}. {{quoteReplyInstructions}}",
    ],
    footerText: ["Thank you for choosing {{companyName}}."],
  },
  invoice: {
    quoteHeading: ["Service Invoice"],
    introText: [
      "Please find your invoice for {{jobTitle}} for {{customerName}}. The completed work and charges are outlined below.",
    ],
    termsHeading: ["Payment Terms"],
    termsText: [
      "Payment is due within 7 days of {{issueDate}}. Please contact {{companyEmail}} if you have any questions about this invoice.",
      "We accept payment by Direct Credit, cheque, or cash.\n\nDirect Credit:\n{{bankDetails}}\n\nCheques can be made payable to {{companyName}}. Cash payments are accepted by arrangement.",
    ],
  },
};

const documentTemplateDefaults = {
  quote: defaultQuoteTemplate,
  invoice: defaultInvoiceTemplate,
};

export function normalizeDocumentTemplate(template, type = "quote") {
  const defaults = documentTemplateDefaults[type] || defaultQuoteTemplate;
  const normalized = {
    ...defaults,
    ...(template || {}),
  };
  const legacyStockValues = legacyTemplateStockValues[type] || {};

  for (const [key, values] of Object.entries(legacyStockValues)) {
    if (values.includes(normalized[key])) {
      normalized[key] = defaults[key];
    }
  }

  return normalized;
}

export function getDocumentBusinessDetails(source = {}) {
  return documentBusinessDetailKeys.reduce((details, key) => {
    details[key] = String(source?.[key] ?? "").trim();
    return details;
  }, {});
}

export function buildTemplateWithBusinessDetails(template, businessDetails = {}, type = "quote") {
  return normalizeDocumentTemplate({
    ...template,
    ...getDocumentBusinessDetails(businessDetails),
  }, type);
}

export function normalizeQuoteTemplate(template) {
  return normalizeDocumentTemplate(template, "quote");
}

export function normalizeInvoiceTemplate(template) {
  return normalizeDocumentTemplate(template, "invoice");
}

export function calculateDocTotal(items = []) {
  return items.reduce((sum, item) => {
    const qty = Number(item.qty || 0);
    const rate = Number(item.rate || 0);
    return sum + qty * rate;
  }, 0);
}

export const GST_RATE = 0.1;

export function roundCurrency(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
}

export function calculateInvoiceSubtotal(items = []) {
  return roundCurrency(calculateDocTotal(items));
}

export function calculateInvoiceGst(items = []) {
  return roundCurrency(calculateInvoiceSubtotal(items) * GST_RATE);
}

export function calculateInvoiceTotal(items = []) {
  return roundCurrency(calculateInvoiceSubtotal(items) + calculateInvoiceGst(items));
}

export function calculateQuoteSubtotal(items = []) {
  return calculateInvoiceSubtotal(items);
}

export function calculateQuoteGst(items = []) {
  return calculateInvoiceGst(items);
}

export function calculateQuoteTotal(items = []) {
  return calculateInvoiceTotal(items);
}

export function calculateInvoicePaidAmount(payments = []) {
  return roundCurrency(
    (Array.isArray(payments) ? payments : []).reduce((sum, payment) => {
      const amount = Number(payment?.amount || 0);
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
    }, 0)
  );
}

export function calculateInvoiceBalanceDue(items = [], payments = []) {
  return Math.max(roundCurrency(calculateInvoiceTotal(items) - calculateInvoicePaidAmount(payments)), 0);
}

export function money(n) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Number(n || 0));
}

export function buildDocumentReference(job, type = "quote") {
  const prefix = type === "invoice" ? "INV" : "QT";
  const jobNumber = Number.isInteger(Number(job?.jobNumber)) && Number(job.jobNumber) > 0 ? Number(job.jobNumber) : null;
  if (jobNumber) return `${prefix}-${String(jobNumber).padStart(4, "0")}`;
  return `${prefix}-${String(job?.id || "draft").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;
}

export function buildQuoteReference(job) {
  return buildDocumentReference(job, "quote");
}

const documentDateMonths = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseDocumentDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== monthIndex
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function getOrdinalSuffix(day) {
  const lastTwoDigits = day % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  if (day % 10 === 3) return "rd";
  return "th";
}

export function formatDocumentDate(value) {
  const date = parseDocumentDateInput(value);
  if (!date) return "";

  const day = date.getUTCDate();
  return `${day}${getOrdinalSuffix(day)} ${documentDateMonths[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function addDaysToDateInput(value, days) {
  const date = parseDocumentDateInput(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildDocumentTemplateContext({ job, document, template, type = "quote" }) {
  const normalizedTemplate = normalizeDocumentTemplate(template, type);
  const reference = buildDocumentReference(job, type);
  const issueDate = document?.issueDate || "";
  const dueDate = type === "invoice" ? document?.dueDate || "" : "";
  const quoteValidUntil = type === "quote" ? addDaysToDateInput(issueDate, 30) : "";
  const hasGst = type === "invoice" || type === "quote";
  const subtotal = hasGst ? calculateQuoteSubtotal(document?.items || []) : calculateDocTotal(document?.items || []);
  const gst = hasGst ? calculateQuoteGst(document?.items || []) : 0;
  const total = hasGst ? calculateQuoteTotal(document?.items || []) : subtotal;
  const paid = type === "invoice" ? calculateInvoicePaidAmount(document?.payments || []) : 0;
  const balanceDue = type === "invoice" ? calculateInvoiceBalanceDue(document?.items || [], document?.payments || []) : total;
  const quoteContactMethods = [
    normalizedTemplate.companyEmail ? `reply to ${normalizedTemplate.companyEmail}` : "",
    normalizedTemplate.companyPhone ? `call ${normalizedTemplate.companyPhone}` : "",
  ].filter(Boolean);
  const bankDetailLines = [
    normalizedTemplate.bankAccountName ? `Account name: ${normalizedTemplate.bankAccountName}` : "",
    normalizedTemplate.bankBsb ? `BSB: ${normalizedTemplate.bankBsb}` : "",
    normalizedTemplate.bankAccountNumber ? `Account number: ${normalizedTemplate.bankAccountNumber}` : "",
  ].filter(Boolean);

  return {
    companyName: normalizedTemplate.companyName,
    companyAbn: normalizedTemplate.companyAbn || "",
    companyAcn: normalizedTemplate.companyAcn || "",
    companyEmail: normalizedTemplate.companyEmail || "",
    companyPhone: normalizedTemplate.companyPhone || "",
    companyAddress: normalizedTemplate.companyAddress || "",
    bankAccountName: normalizedTemplate.bankAccountName || "",
    bankBsb: normalizedTemplate.bankBsb || "",
    bankAccountNumber: normalizedTemplate.bankAccountNumber || "",
    bankDetails: bankDetailLines.length > 0 ? bankDetailLines.join("\n") : "Bank details available on request.",
    customerName: job?.customerName || "",
    customerEmail: getDocumentRecipientEmail(job),
    jobTitle: job?.title || "",
    jobDescription: job?.description || "",
    jobAddress: job?.jobAddress || "",
    issueDate,
    issueDateDisplay: formatDocumentDate(issueDate),
    dueDate,
    dueDateDisplay: formatDocumentDate(dueDate),
    quoteValidUntil,
    quoteValidUntilDisplay: formatDocumentDate(quoteValidUntil),
    quoteReplyInstructions: quoteContactMethods.length > 0
      ? `Please ${quoteContactMethods.join(" or ")} if you would like us to proceed.`
      : "",
    quoteReference: reference,
    documentReference: reference,
    subtotal: money(subtotal),
    gst: money(gst),
    paid: money(paid),
    balanceDue: money(balanceDue),
    total: money(total),
  };
}

export function buildQuoteTemplateContext({ job, quote, template }) {
  return buildDocumentTemplateContext({
    job,
    document: quote,
    template,
    type: "quote",
  });
}

export function getDocumentRecipientEmail(job) {
  return String(job?.billingContact?.email || job?.customerEmail || "").trim();
}

export function getDocumentRecipientName(job) {
  return String(job?.billingContact?.name || job?.customerName || "").trim() || "Customer";
}

export function fillTemplateText(text, context) {
  return String(text || "").replace(/{{\s*(\w+)\s*}}/g, (_, key) => context[key] ?? "");
}

export function buildDocumentEmail({ job, type = "quote", emailSettings = {}, emailPurpose = "" }) {
  const customerName = getDocumentRecipientName(job);
  const siteAddress = job?.jobAddress || "Site Address";
  const normalizedPurpose = String(emailPurpose || "").trim();
  const isPartPaymentReceipt = normalizedPurpose === "part-payment-receipt";
  const isPaidReceipt = normalizedPurpose === "paid-receipt";
  const documentLabel = isPartPaymentReceipt
    ? "PART PAYMENT RECEIPT"
    : isPaidReceipt
      ? "PAID INVOICE"
      : type === "invoice" ? "INVOICE" : "QUOTE";
  const bodyLabel = isPartPaymentReceipt
    ? "part payment receipt"
    : isPaidReceipt
      ? "paid invoice receipt"
      : type === "invoice" ? "invoice" : "quote";
  const signature = emailSettings?.signature || "Regards, ELSET PTY LD";
  const subject = `ELSET ${documentLabel} FOR ${siteAddress}`;
  const body = [
    `Dear ${customerName},`,
    `Attached to this email is your ${bodyLabel} for ${siteAddress}`,
    "",
    signature,
  ].join("\n");
  const htmlBody = [
    `<p>Dear ${customerName},</p>`,
    `<p>Attached to this email is your ${bodyLabel} for ${siteAddress}</p>`,
    `<p>${signature}</p>`,
  ].join("");

  return { subject, body, htmlBody };
}

export function buildQuoteEmail({ job }) {
  return buildDocumentEmail({ job, type: "quote" });
}

export function buildInvoiceEmail({ job }) {
  return buildDocumentEmail({ job, type: "invoice" });
}
