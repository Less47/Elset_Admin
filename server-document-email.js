import nodemailer from "nodemailer";
import { generateDocumentPdf } from "./quote-pdf.js";
import { ADMIN_EMAIL, normalizeInvoiceTemplate, normalizeQuoteTemplate, plainTextEmailHtml } from "./src/lib/quote-template.js";
import { createDocumentEmailDraft, normalizeDocumentEmail } from "./src/lib/document-email.js";
import { documentSendErrorMessage } from "./src/lib/document-send-status.js";

export class DocumentEmailError extends Error {
  constructor(type, code, details = {}) {
    super(documentSendErrorMessage(type, code));
    this.code = code;
    Object.assign(this, details);
  }
}

export async function submitDocumentEmail({ job, document, template, type, stampText, emailSettings, emailPurpose, email: overrides, defaultFromEmail, transportConfig }, {
  generatePdf = generateDocumentPdf,
  createTransport = nodemailer.createTransport,
} = {}) {
  const { email, errors } = normalizeDocumentEmail(overrides === undefined
    ? createDocumentEmailDraft({ job, type, emailSettings, emailPurpose }) : overrides);
  if (Object.keys(errors).length) throw new DocumentEmailError(type, "INVALID_EMAIL", { fieldErrors: errors });
  let attachment;
  try {
    attachment = await generatePdf({
      job, document, template: type === "invoice" ? normalizeInvoiceTemplate(template) : normalizeQuoteTemplate(template),
      type, stampText,
    });
  } catch {
    throw new DocumentEmailError(type, "ATTACHMENT_FAILED");
  }

  return submitPdfEmail({ type, email, attachment, emailSettings, defaultFromEmail, transportConfig }, { createTransport });
}

// Shared provider submission and acceptance semantics for document domains.
// Attachment generation belongs to the caller, including maintenance reports.
export async function submitPdfEmail({ type, email: input, attachment, emailSettings, defaultFromEmail, transportConfig }, {
  createTransport = nodemailer.createTransport,
} = {}) {
  const { email, errors } = normalizeDocumentEmail(input);
  if (Object.keys(errors).length) throw new DocumentEmailError(type, "INVALID_EMAIL", { fieldErrors: errors });
  const fromEmail = emailSettings?.fromEmail || defaultFromEmail || ADMIN_EMAIL;
  const replyToEmail = emailSettings?.replyToEmail || fromEmail;
  let info;
  try {
    info = await createTransport(transportConfig).sendMail({
      from: fromEmail, to: email.to,
      replyTo: replyToEmail,
      cc: email.cc.length ? email.cc : undefined,
      bcc: email.bcc.length ? email.bcc : undefined,
      subject: email.subject, text: email.message, html: plainTextEmailHtml(email.message),
      attachments: [{ filename: attachment.filename, content: Buffer.from(attachment.bytes), contentType: "application/pdf" }],
    });
  } catch {
    // Provider errors may contain SMTP credentials or internal server details.
    throw new DocumentEmailError(type, "SEND_FAILED");
  }

  const intended = [...email.to, ...email.cc, ...email.bcc];
  const providerSet = (entries) => new Set((Array.isArray(entries) ? entries : []).map((entry) => String(entry?.address || entry).trim().toLowerCase()));
  const accepted = providerSet(info?.accepted);
  const rejected = providerSet(info?.rejected);
  const delivery = {
    acceptedRecipients: intended.filter((address) => accepted.has(address.toLowerCase())),
    rejectedRecipients: intended.filter((address) => !accepted.has(address.toLowerCase()) && rejected.has(address.toLowerCase())),
    unconfirmedRecipients: intended.filter((address) => !accepted.has(address.toLowerCase()) && !rejected.has(address.toLowerCase())),
  };
  // A copy delivered to CC/BCC does not issue the document to its intended To.
  const acceptedTo = email.to.filter((address) => accepted.has(address.toLowerCase()));
  if (!acceptedTo.length) throw new DocumentEmailError(type, delivery.unconfirmedRecipients.some((address) => email.to.includes(address)) ? "SEND_UNCONFIRMED" : "RECIPIENT_REJECTED", { delivery });

  return {
    ok: true, messageId: info.messageId, sentAt: new Date().toISOString(), fromEmail, replyToEmail,
    ...email, ...delivery, recipientEmail: acceptedTo.join(", "),
    ...(delivery.acceptedRecipients.length < intended.length ? { warning: "Some requested recipients were not accepted or confirmed by the email service. The email was sent to the accepted recipients. Do not resend to everyone." } : {}),
  };
}
