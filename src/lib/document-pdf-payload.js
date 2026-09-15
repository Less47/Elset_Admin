import { defaultQuoteTemplate } from "./quote-template.js";

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));
}

// Transport only: never use this projection to save documents or sent history.
// These fields are consumed by quote-pdf.js and buildDocumentEmail/template context.
// Keep the supplied editor/sent-copy values; resolving live records by ID would
// lose unsaved edits and change historical copies.
export function buildDocumentPdfPayload({ job, document, template, documentType, stampText = "", emailPurpose, emailSettings }) {
  const pdfJob = pick(job, ["id", "jobNumber", "title", "description", "customerName", "customerEmail", "jobAddress", "ocNumber"]);
  if (job?.billingContact) pdfJob.billingContact = pick(job.billingContact, ["name", "email"]);
  if (job?.siteSnapshot !== undefined) pdfJob.siteSnapshot = job.siteSnapshot === null ? null : pick(job.siteSnapshot, ["ocNumber"]);
  return {
    documentType,
    job: pdfJob,
    document: {
      ...pick(document, ["issueDate", "dueDate", "notes"]),
      items: (document?.items || []).map((item) => pick(item, ["description", "qty", "rate"])),
      payments: (document?.payments || []).map((payment) => pick(payment, ["amount"])),
    },
    // The renderer loads public/elset-logo.png itself. Unknown template fields
    // (including old image data URLs) and history snapshots are not PDF inputs.
    template: pick(template, Object.keys(defaultQuoteTemplate)),
    stampText,
    ...(emailPurpose !== undefined ? { emailPurpose } : {}),
    ...(emailSettings !== undefined ? { emailSettings: pick(emailSettings, ["fromEmail", "replyToEmail", "ccEmail", "signature"]) } : {}),
  };
}
