import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentEmailDraft, documentContactSuggestions, normalizeDocumentEmail, parseEmailRecipients, resolveDocumentEmailDraft } from "../src/lib/document-email.js";
import { buildDocumentEmail } from "../src/lib/quote-template.js";
import { normalizeStoredData } from "../server-store.js";

test("mailbox parsing handles named lists and preserves all malformed entries", () => {
  assert.deepEqual(parseEmailRecipients('"Accounts, Team" <Accounts@example.test>; other+tag@example.test, accounts@EXAMPLE.test'), { addresses: ["Accounts@example.test", "other+tag@example.test"], invalid: [] });
  for (const bad of ["missing-at", "x@@example.test", "a..b@example.test", "x@-example.test", "x@example..test", "first@example.test second@example.test", "Name <x@example.test", '"Name <x@example.test>', "x@example.test\r\nBcc: bad@example.test", "x@example.test junk", "<x@example.test> junk", "Name <x@example.test> <extra@example.test>"]) {
    assert.ok(parseEmailRecipients(["valid@example.test", bad]).invalid.length, bad);
  }
  assert.ok(parseEmailRecipients([{ address: "x@example.test" }]).invalid.length);
});

test("normalization trims and deduplicates within and across fields with To priority", () => {
  const input = { to: [" To@example.test ", "to@EXAMPLE.test"], cc: ["to@example.test", "copy@example.test"], bcc: ["COPY@example.test", "private@example.test"], subject: "Custom subject", message: "Line 1\n\nLine 2" };
  const before = structuredClone(input);
  const result = normalizeDocumentEmail(input);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.email, { to: ["To@example.test"], cc: ["copy@example.test"], bcc: ["private@example.test"], subject: input.subject, message: input.message });
  assert.deepEqual(input, before);
});

test("validation requires To, rejects bad CC/BCC and header injection without discarding them", () => {
  const { errors } = normalizeDocumentEmail({ to: [], cc: "invalid", bcc: "also-invalid", subject: "Subject\r\nBcc: hidden@example.test", message: "Text" });
  assert.deepEqual(Object.keys(errors), ["cc", "bcc", "to", "subject"]);
  assert.ok(normalizeDocumentEmail({ to: ["good@example.test", "bad"], subject: "Subject", message: "" }).errors.to);
  assert.ok(normalizeDocumentEmail({ to: ["good@example.test"], subject: " ", message: {} }).errors.message);
});

for (const [type, emailPurpose] of [["quote", ""], ["invoice", ""], ["invoice", "paid-receipt"], ["invoice", "part-payment-receipt"]]) {
  test(`${type} ${emailPurpose || "document"} defaults retain templates, signature and recipient precedence`, () => {
    const args = { type, emailPurpose, job: { customerName: "Customer", customerEmail: "fallback@example.test", billingContact: { name: "Billing", email: "billing@example.test" }, jobAddress: "1 Test Street" }, emailSettings: { ccEmail: "copy@example.test; second@example.test", signature: "Regards,\nOffice" } };
    const before = structuredClone(args);
    const draft = createDocumentEmailDraft(args);
    assert.deepEqual(draft.to, ["billing@example.test"]);
    assert.deepEqual(draft.cc, ["copy@example.test", "second@example.test"]);
    assert.deepEqual(draft.bcc, []);
    assert.equal(draft.subject, buildDocumentEmail(args).subject);
    assert.equal(draft.message, buildDocumentEmail(args).body);
    draft.to.push("added@example.test");
    draft.message = "Edited";
    assert.deepEqual(args, before);
    assert.deepEqual(createDocumentEmailDraft({ ...args, job: { ...args.job, billingContact: { email: "  " } } }).to, ["fallback@example.test"]);
  });
}

test("pending recipient text is included in sending and malformed saved defaults remain editable", () => {
  const draft = createDocumentEmailDraft({ job: { customerEmail: "invalid" }, emailSettings: { ccEmail: "copy@example.test" } });
  assert.deepEqual(draft.to, ["invalid"]);
  assert.ok(resolveDocumentEmailDraft(draft).errors.to);
  const result = resolveDocumentEmailDraft({ ...draft, to: [], toInput: "new@example.test", ccInput: "copy@example.test", bccInput: "private@example.test" });
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.email.to, ["new@example.test"]);
  assert.deepEqual(result.email.cc, ["copy@example.test"]);
  assert.deepEqual(result.email.bcc, ["private@example.test"]);
  assert.equal(result.email.toInput, undefined);
});

test("saved contact suggestions are relevant, labelled and deduplicated without changing records", () => {
  const job = { billingContact: { name: "Bill", email: "billing@example.test" }, requesterContact: { name: "Requester", email: "request@example.test" }, onsiteContact: { name: "Site", email: "site@example.test" }, customerEmail: "customer@example.test" };
  const customer = { name: "Customer", email: "customer@example.test", contacts: [{ name: "Duplicate", email: "BILLING@example.test" }, { name: "Other", role: "Manager", email: "manager@example.test" }, { email: "bad" }] };
  const before = structuredClone({ job, customer });
  assert.deepEqual(documentContactSuggestions(job, customer), [
    { name: "Bill", role: "Billing contact", email: "billing@example.test" },
    { name: "Customer", role: "Customer", email: "customer@example.test" },
    { name: "Requester", role: "Requester", email: "request@example.test" },
    { name: "Site", role: "On-site contact", email: "site@example.test" },
    { name: "Other", role: "Manager", email: "manager@example.test" },
  ]);
  assert.deepEqual({ job, customer }, before);
});

test("workspace state normalization retains existing job contact snapshots for email defaults", () => {
  const job = { id: "contact-job", customerEmail: "fallback@example.test", billingContact: { name: "Billing", email: "billing@example.test" }, requesterContact: { name: "Requester", email: "request@example.test" }, onsiteContact: { name: "Site", email: "site@example.test" } };
  const normalized = normalizeStoredData({ jobs: [job] }).jobs[0];
  for (const field of ["billingContact", "requesterContact", "onsiteContact"]) assert.deepEqual(normalized[field], job[field]);
  assert.deepEqual(createDocumentEmailDraft({ job: normalized }).to, ["billing@example.test"]);
});
