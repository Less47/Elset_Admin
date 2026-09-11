import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser/index.js";
import { generateDocumentPdf } from "./quote-pdf.js";
import { ADMIN_EMAIL, buildDocumentEmail, getDocumentRecipientEmail, normalizeInvoiceTemplate, normalizeQuoteTemplate } from "./src/lib/quote-template.js";
import { documentSendErrorMessage } from "./src/lib/document-send-status.js";

export class DocumentEmailError extends Error {
  constructor(type, code) {
    super(documentSendErrorMessage(type, code));
    this.code = code;
  }
}

export async function submitDocumentEmail({ job, document, template, type, stampText, emailSettings, emailPurpose, defaultFromEmail, transportConfig }, {
  generatePdf = generateDocumentPdf,
  createTransport = nodemailer.createTransport,
} = {}) {
  let attachment;
  try {
    attachment = await generatePdf({
      job, document, template: type === "invoice" ? normalizeInvoiceTemplate(template) : normalizeQuoteTemplate(template),
      type, stampText,
    });
  } catch {
    throw new DocumentEmailError(type, "ATTACHMENT_FAILED");
  }

  const recipientEmail = getDocumentRecipientEmail(job);
  const fromEmail = emailSettings?.fromEmail || defaultFromEmail || ADMIN_EMAIL;
  let info;
  let subject;
  try {
    const email = buildDocumentEmail({ job, type, emailSettings, emailPurpose });
    subject = email.subject;
    info = await createTransport(transportConfig).sendMail({
      from: fromEmail, to: recipientEmail,
      replyTo: emailSettings?.replyToEmail || fromEmail,
      cc: emailSettings?.ccEmail || undefined,
      subject, text: email.body, html: email.htmlBody,
      attachments: [{ filename: attachment.filename, content: Buffer.from(attachment.bytes), contentType: "application/pdf" }],
    });
  } catch {
    // Provider errors may contain SMTP credentials or internal server details.
    throw new DocumentEmailError(type, "SEND_FAILED");
  }

  // SMTP can resolve successfully when only a CC address was accepted.
  const intended = addressparser(recipientEmail, { flatten: true }).map((entry) => entry.address).filter(Boolean);
  const accepted = new Set((info?.accepted || []).map((entry) => String(entry?.address || entry).toLowerCase()));
  const acceptedRecipients = intended.filter((address) => accepted.has(address.toLowerCase()));
  if (!acceptedRecipients.length) throw new DocumentEmailError(type, "RECIPIENT_REJECTED");

  return {
    ok: true, messageId: info.messageId, sentAt: new Date().toISOString(), fromEmail, subject,
    recipientEmail: acceptedRecipients.length === intended.length ? recipientEmail : acceptedRecipients.join(", "),
    ...(acceptedRecipients.length < intended.length ? { warning: "Some requested recipients were not accepted by the email service. Check the recipient addresses before sending again." } : {}),
  };
}
