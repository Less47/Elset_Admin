import addressparser from "nodemailer/lib/addressparser/index.js";
import { buildDocumentEmail, getDocumentRecipientEmail } from "./quote-template.js";

export const recipientFields = ["to", "cc", "bcc"];
const hasHeaderControls = (value) => Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

// Keep every entered mailbox, including malformed ones. Nodemailer's parser is
// deliberately forgiving, so validate its result and the surrounding syntax too.
function mailboxTokens(value) {
  const tokens = [];
  let token = "", quoted = false, escaped = false;
  for (const character of value) {
    if (!quoted && [",", ";"].includes(character)) {
      if (token.trim()) tokens.push(token.trim());
      token = "";
      continue;
    }
    token += character;
    if (escaped) escaped = false;
    else if (quoted && character === "\\") escaped = true;
    else if (character === '"') quoted = !quoted;
  }
  if (token.trim()) tokens.push(token.trim());
  return { tokens, quoted };
}

function validMailbox(address) {
  if (!address || address.length > 254 || /[\s<>(),;:[\]"\\]/.test(address)) return false;
  const parts = address.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length <= 64 && local.split(".").every((part) => /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/i.test(part))
    && domain.includes(".") && domain.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
}

export function parseEmailRecipients(value) {
  const addresses = [], invalid = [], seen = new Set();
  const values = Array.isArray(value) ? value : [value ?? ""];
  for (const input of values) {
    if (typeof input !== "string") { invalid.push("Invalid address value"); continue; }
    const { tokens, quoted } = mailboxTokens(input);
    if (quoted || hasHeaderControls(input)) { invalid.push(input); continue; }
    for (const token of tokens) {
      const parsed = addressparser(token, { flatten: true });
      const address = parsed[0]?.address || "";
      const named = /^(?:"(?:[^"\\]|\\.)*"|[^"<>:;]+)\s*<([^<>]+)>$/.exec(token);
      if (parsed.length !== 1 || !validMailbox(address) || (token !== address && named?.[1]?.trim() !== address)) {
        invalid.push(token);
      } else if (!seen.has(address.toLowerCase())) {
        seen.add(address.toLowerCase());
        addresses.push(address);
      }
    }
  }
  return { addresses, invalid };
}

export function normalizeDocumentEmail(input) {
  const email = {}, errors = {}, seen = new Set();
  for (const field of recipientFields) {
    const parsed = parseEmailRecipients(input?.[field]);
    if (parsed.invalid.length) errors[field] = `Check the ${field.toUpperCase()} addresses. Use complete email addresses separated by commas.`;
    // To takes precedence over CC, then BCC. Never send duplicate copies.
    email[field] = parsed.addresses.filter((address) => {
      const key = address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (!email.to.length && !errors.to) errors.to = "Add at least one To email address.";
  email.subject = typeof input?.subject === "string" ? input.subject : "";
  email.message = typeof input?.message === "string" ? input.message : "";
  if (!email.subject.trim() || email.subject.length > 998 || hasHeaderControls(email.subject)) errors.subject = "Enter a subject on one line (up to 998 characters).";
  if (typeof input?.message !== "string" || email.message.length > 100000 || email.message.includes("\0")) errors.message = "Enter a message of up to 100,000 characters.";
  return { email, errors };
}

export function createDocumentEmailDraft({ job, type, emailSettings, emailPurpose }) {
  const defaults = buildDocumentEmail({ job, type, emailSettings, emailPurpose });
  const initial = { to: getDocumentRecipientEmail(job), cc: emailSettings?.ccEmail || "", bcc: "" };
  const draft = { subject: defaults.subject, message: defaults.body };
  const seen = new Set();
  for (const field of recipientFields) {
    const { addresses, invalid } = parseEmailRecipients(initial[field]);
    draft[field] = [...addresses.filter((address) => {
      if (seen.has(address.toLowerCase())) return false;
      seen.add(address.toLowerCase());
      return true;
    }), ...invalid];
  }
  return draft;
}

export function resolveDocumentEmailDraft(draft) {
  return normalizeDocumentEmail({ ...draft, ...Object.fromEntries(recipientFields.map((field) => [field, [...(draft[field] || []), draft[`${field}Input`] || ""]])) });
}

export function documentContactSuggestions(job, customer) {
  const suggestions = [], seen = new Set();
  const candidates = [
    [job?.billingContact, "Billing contact"],
    [{ name: customer?.name || job?.customerName, email: customer?.email || job?.customerEmail }, "Customer"],
    [job?.requesterContact, "Requester"],
    [job?.onsiteContact, "On-site contact"],
    ...(customer?.contacts || []).map((contact) => [contact, contact.role || "Customer contact"]),
  ];
  for (const [contact, role] of candidates) {
    const { addresses, invalid } = parseEmailRecipients(contact?.email || "");
    if (invalid.length) continue;
    for (const email of addresses) {
      if (seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      suggestions.push({ name: contact?.name || "Contact", role, email });
    }
  }
  return suggestions;
}
