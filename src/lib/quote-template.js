export const ADMIN_EMAIL = "admin@elset.com.au";

export const documentTemplatePlaceholders = [
  "{{companyName}}",
  "{{companyEmail}}",
  "{{customerName}}",
  "{{customerEmail}}",
  "{{jobTitle}}",
  "{{jobAddress}}",
  "{{issueDate}}",
  "{{quoteReference}}",
  "{{total}}",
];

export const quoteTemplatePlaceholders = documentTemplatePlaceholders;

export const defaultQuoteTemplate = {
  companyName: "Elset",
  companyEmail: ADMIN_EMAIL,
  companyPhone: "",
  companyAddress: "",
  accentColor: "#0f172a",
  quoteHeading: "Service Quote",
  introText:
    "Thank you for the opportunity to quote for {{jobTitle}} for {{customerName}}. The quoted work is outlined below.",
  notesHeading: "Scope Notes",
  termsHeading: "Terms & Next Steps",
  termsText:
    "This quote is valid for 14 days from {{issueDate}}. Please reply to {{companyEmail}} if you would like us to proceed.",
  footerText: "Thank you for choosing {{companyName}}.",
};

export const defaultInvoiceTemplate = {
  companyName: "Elset",
  companyEmail: ADMIN_EMAIL,
  companyPhone: "",
  companyAddress: "",
  accentColor: "#0f172a",
  quoteHeading: "Service Invoice",
  introText:
    "Please find your invoice for {{jobTitle}} for {{customerName}}. The completed work and charges are outlined below.",
  notesHeading: "Work Completed",
  termsHeading: "Payment Terms",
  termsText:
    "Payment is due within 7 days of {{issueDate}}. Please contact {{companyEmail}} if you have any questions about this invoice.",
  footerText: "Thank you for choosing {{companyName}}.",
};

const documentTemplateDefaults = {
  quote: defaultQuoteTemplate,
  invoice: defaultInvoiceTemplate,
};

export function normalizeDocumentTemplate(template, type = "quote") {
  const defaults = documentTemplateDefaults[type] || defaultQuoteTemplate;
  return {
    ...defaults,
    ...(template || {}),
  };
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

export function buildDocumentTemplateContext({ job, document, template, type = "quote" }) {
  const normalizedTemplate = normalizeDocumentTemplate(template, type);
  const reference = buildDocumentReference(job, type);

  return {
    companyName: normalizedTemplate.companyName,
    companyEmail: normalizedTemplate.companyEmail || ADMIN_EMAIL,
    customerName: job?.customerName || "",
    customerEmail: job?.customerEmail || "",
    jobTitle: job?.title || "",
    jobAddress: job?.jobAddress || "",
    issueDate: document?.issueDate || "",
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

export function buildDocumentEmail({ job, type = "quote", emailSettings = {} }) {
  const customerName = job?.customerName || "Customer";
  const siteAddress = job?.jobAddress || "Site Address";
  const documentLabel = type === "invoice" ? "INVOICE" : "QUOTE";
  const bodyLabel = type === "invoice" ? "invoice" : "quote";
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
