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
  "{{quoteValidUntil}}",
  "{{quoteReplyInstructions}}",
  "{{quoteReference}}",
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
  quoteHeading: "Service Quote",
  introText: "{{jobDescription}}",
  notesHeading: "",
  termsHeading: "Quote Validity",
  termsText:
    "This quote is valid for 30 days from {{issueDate}}. {{quoteReplyInstructions}}",
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
  quoteHeading: "Service Invoice",
  introText:
    "Please find your invoice for {{jobTitle}} for {{customerName}}. The completed work and charges are outlined below.",
  notesHeading: "Work Completed",
  termsHeading: "How to Pay",
  termsText:
    "We accept payment by Direct Credit, cheque, or cash.\n\nDirect Credit:\n{{bankDetails}}\n\nCheques can be made payable to {{companyName}}. Cash payments are accepted by arrangement.",
  footerText: "Thank you for choosing {{companyName}}.",
};

const legacyTemplateDefaults = {
  quote: {
    introText:
      "Thank you for the opportunity to quote for {{jobTitle}} for {{customerName}}. The quoted work is outlined below.",
    notesHeading: "Scope Notes",
    termsHeading: "Terms & Next Steps",
    termsText:
      "This quote is valid for 14 days from {{issueDate}}. Please reply to {{companyEmail}} if you would like us to proceed.",
    footerText: "Thank you for choosing {{companyName}}.",
  },
  invoice: {
    termsHeading: "Payment Terms",
    termsText:
      "Payment is due within 7 days of {{issueDate}}. Please contact {{companyEmail}} if you have any questions about this invoice.",
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
  const legacyDefaults = legacyTemplateDefaults[type] || {};

  for (const [key, value] of Object.entries(legacyDefaults)) {
    if (normalized[key] === value) {
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

function addDaysToDateInput(value, days) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildDocumentTemplateContext({ job, document, template, type = "quote" }) {
  const normalizedTemplate = normalizeDocumentTemplate(template, type);
  const reference = buildDocumentReference(job, type);
  const issueDate = document?.issueDate || "";
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
    companyEmail: normalizedTemplate.companyEmail || ADMIN_EMAIL,
    companyPhone: normalizedTemplate.companyPhone || "",
    companyAddress: normalizedTemplate.companyAddress || "",
    bankAccountName: normalizedTemplate.bankAccountName || "",
    bankBsb: normalizedTemplate.bankBsb || "",
    bankAccountNumber: normalizedTemplate.bankAccountNumber || "",
    bankDetails: bankDetailLines.length > 0 ? bankDetailLines.join("\n") : "Bank details available on request.",
    customerName: job?.customerName || "",
    customerEmail: job?.customerEmail || "",
    jobTitle: job?.title || "",
    jobDescription: job?.description || "",
    jobAddress: job?.jobAddress || "",
    issueDate,
    quoteValidUntil: addDaysToDateInput(issueDate, 30),
    quoteReplyInstructions: quoteContactMethods.length > 0
      ? `Please ${quoteContactMethods.join(" or ")} if you would like us to proceed.`
      : "",
    quoteReference: reference,
    documentReference: reference,
    total: money(calculateDocTotal(document?.items || [])),
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

export function fillTemplateText(text, context) {
  return String(text || "").replace(/{{\s*(\w+)\s*}}/g, (_, key) => context[key] ?? "");
}

export function buildDocumentEmail({ job, type = "quote", emailSettings = {}, emailPurpose = "" }) {
  const customerName = job?.customerName || "Customer";
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
