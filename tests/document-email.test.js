import assert from "node:assert/strict";
import test from "node:test";
import { DocumentEmailError, submitDocumentEmail } from "../server-document-email.js";
import { documentSendErrorMessage } from "../src/lib/document-send-status.js";
import { sendDocumentAndPersistHistory } from "../src/hooks/document-send-workflow.js";

const recipient = "accounts@example.test";
const attachment = { filename: "document.pdf", bytes: Buffer.from("unchanged PDF bytes") };
const input = (type) => ({
  type, job: { id: "job-email-test", jobNumber: 123, title: "Gate service", customerName: "Example", customerEmail: "fallback@example.test", billingContact: { name: "Accounts", email: recipient } },
  document: { items: [{ description: "Service", qty: 1, rate: 10 }] },
  template: {}, stampText: "", emailPurpose: "",
  emailSettings: { fromEmail: "sender@example.test", replyToEmail: "reply@example.test", ccEmail: "copy@example.test" },
  transportConfig: { host: "local-test" },
});
const dependencies = (sendMail, generatePdf = async () => attachment) => ({ generatePdf, createTransport: () => ({ sendMail }) });

for (const type of ["quote", "invoice"]) {
  test(`${type} waits for provider acceptance and preserves attachment and addressing`, async () => {
    let accept;
    let submitted;
    let finished = false;
    const response = new Promise((resolve) => { accept = resolve; });
    const sending = submitDocumentEmail(input(type), dependencies((email) => { submitted = email; return response; }));
    sending.then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    assert.deepEqual(submitted.to, [recipient]);
    assert.equal(submitted.from, "sender@example.test");
    assert.equal(submitted.replyTo, "reply@example.test");
    assert.deepEqual(submitted.cc, ["copy@example.test"]);
    assert.deepEqual(submitted.attachments, [{ filename: attachment.filename, content: attachment.bytes, contentType: "application/pdf" }]);
    accept({ accepted: [recipient], messageId: "accepted-message" });
    const result = await sending;
    assert.equal(result.ok, true);
    assert.equal(result.recipientEmail, recipient);
    assert.equal(result.messageId, "accepted-message");
    assert.ok(result.sentAt);
  });

  test(`${type} attachment failure stops before mail submission`, async () => {
    await assert.rejects(submitDocumentEmail(input(type), dependencies(
      () => assert.fail("Must not send without a PDF"),
      async () => { throw new Error("Private renderer path and stack"); },
    )), (error) => error instanceof DocumentEmailError && error.code === "ATTACHMENT_FAILED" && error.message === `Could not prepare ${type} attachment. Please try again.`);
  });

  test(`${type} provider rejection, authentication failure and timeout produce safe failures`, async () => {
    for (const code of ["EENVELOPE", "EAUTH", "ETIMEDOUT", "ECONNECTION"]) {
      await assert.rejects(submitDocumentEmail(input(type), dependencies(async () => {
        throw Object.assign(new Error("PRIVATE smtp credentials and internal host"), { code });
      })), (error) => error.code === "SEND_FAILED" && error.message === documentSendErrorMessage(type, "SEND_FAILED") && !error.message.includes("PRIVATE"));
    }
  });

  test(`${type} does not report success when only CC or no recipient was accepted`, async () => {
    for (const accepted of [["copy@example.test"], [], undefined]) {
      await assert.rejects(submitDocumentEmail(input(type), dependencies(async () => ({ accepted, rejected: [recipient] }))), (error) => error.code === "RECIPIENT_REJECTED");
    }
  });
}

test("provider acceptance matches named addresses case insensitively", async () => {
  const args = input("quote");
  args.job.billingContact.email = '"Example Accounts" <accounts@example.test>';
  const result = await submitDocumentEmail(args, dependencies(async () => ({ accepted: [{ address: "ACCOUNTS@EXAMPLE.TEST" }] })));
  assert.equal(result.ok, true);
  assert.equal(result.recipientEmail, "accounts@example.test");
});

test("partial recipient acceptance identifies only accepted recipients and warns against blind resend", async () => {
  const args = input("invoice");
  args.job.billingContact.email = "first@example.test, second@example.test";
  const result = await submitDocumentEmail(args, dependencies(async () => ({ accepted: ["first@example.test", "copy@example.test"] })));
  assert.equal(result.ok, true);
  assert.equal(result.recipientEmail, "first@example.test");
  assert.match(result.warning, /Some requested recipients were not accepted/);
});

test("unknown server codes never expose internal error details", () => {
  assert.equal(documentSendErrorMessage("invoice", "PRIVATE secret"), "Invoice could not be sent. Please try again.");
});

const composed = () => ({ to: ["first@example.test", "second@example.test"], cc: ["copy@example.test"], bcc: ["private@example.test"], subject: "Per-send subject", message: 'Hello <script>alert("x")</script> & team\n\nThanks,\nOffice' });

for (const type of ["quote", "invoice"]) {
  test(`${type} sends explicit To/CC/BCC, edited subject and safely escaped multiline body without changing PDF inputs`, async () => {
    const args = { ...input(type), email: composed() };
    const before = structuredClone(args);
    let submitted, pdfInput;
    const result = await submitDocumentEmail(args, dependencies(async (email) => {
      submitted = email;
      return { accepted: [...args.email.to, ...args.email.cc, ...args.email.bcc], rejected: [], messageId: "local-id" };
    }, async (payload) => { pdfInput = payload; return attachment; }));
    for (const key of ["to", "cc", "bcc", "subject"]) assert.deepEqual(submitted[key], args.email[key]);
    assert.equal(submitted.text, args.email.message);
    assert.equal(submitted.html, '<div>Hello &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; team<br /><br />Thanks,<br />Office</div>');
    assert.equal(submitted.html.includes("private@example.test"), false);
    assert.equal(submitted.text.includes("private@example.test"), false);
    assert.equal(pdfInput.email, undefined);
    assert.deepEqual(pdfInput.job, args.job);
    assert.deepEqual(pdfInput.document, args.document);
    assert.deepEqual(submitted.attachments[0].content, attachment.bytes);
    assert.deepEqual(args, before);
    assert.deepEqual(result.acceptedRecipients, [...args.email.to, ...args.email.cc, ...args.email.bcc]);
    assert.deepEqual(result.rejectedRecipients, []);
    assert.equal(result.warning, undefined);
    assert.equal(result.message, args.email.message);
    assert.equal(result.replyToEmail, args.emailSettings.replyToEmail);
  });
}

for (const scenario of [
  { name: "partial To", accepted: ["first@example.test", "copy@example.test", "private@example.test"], rejected: ["second@example.test"], success: true },
  { name: "rejected CC and BCC", accepted: ["first@example.test", "second@example.test"], rejected: ["copy@example.test", "private@example.test"], success: true },
  { name: "unconfirmed recipient", accepted: ["first@example.test"], rejected: [], success: true },
  { name: "CC only", accepted: ["copy@example.test"], rejected: ["first@example.test", "second@example.test", "private@example.test"] },
  { name: "BCC only", accepted: ["private@example.test"], rejected: ["first@example.test", "second@example.test", "copy@example.test"] },
  { name: "no acceptance", accepted: [], rejected: ["first@example.test", "second@example.test", "copy@example.test", "private@example.test"] },
  { name: "no provider confirmation", accepted: undefined, rejected: undefined },
]) {
  test(`${scenario.name} reports exact delivery and only persists issuance after To acceptance`, async () => {
    let saved = false;
    const args = { ...input("invoice"), email: composed() };
    const workflow = await sendDocumentAndPersistHistory({
      sendEmail: () => submitDocumentEmail(args, dependencies(async () => scenario)),
      buildHistoryEntry: (payload) => payload,
      persistHistory: async () => { saved = true; return true; },
    });
    assert.equal(saved, Boolean(scenario.success));
    assert.equal(workflow.status, scenario.success ? "sent" : "failed");
    const delivery = workflow.payload || workflow.delivery;
    assert.deepEqual(delivery.acceptedRecipients, scenario.accepted || []);
    assert.deepEqual(delivery.rejectedRecipients, scenario.rejected || []);
    if (scenario.success) assert.match(workflow.payload.warning, /Do not resend to everyone/);
    else assert.equal(workflow.code, scenario.accepted ? "RECIPIENT_REJECTED" : "SEND_UNCONFIRMED");
  });
}

test("invalid recipients, missing To and injected headers stop before PDF or SMTP", async () => {
  for (const email of [{ ...composed(), to: [] }, { ...composed(), cc: ["bad"] }, { ...composed(), bcc: ["bad"] }, { ...composed(), subject: "Subject\nBcc: secret@example.test" }, null]) {
    await assert.rejects(submitDocumentEmail({ ...input("quote"), email }, dependencies(() => assert.fail("No SMTP"), () => assert.fail("No PDF"))), (error) => error.code === "INVALID_EMAIL" && Object.keys(error.fieldErrors).length > 0);
  }
});

test("explicit recipients work without saved email and empty CC overrides Settings", async () => {
  const args = { ...input("invoice"), job: { customerName: "Manual recipient" }, email: { ...composed(), cc: [], bcc: [] } };
  let submitted;
  await submitDocumentEmail(args, dependencies(async (mail) => { submitted = mail; return { accepted: args.email.to }; }));
  assert.equal(submitted.cc, undefined);
  assert.equal(submitted.bcc, undefined);
  assert.deepEqual(submitted.to, args.email.to);
});

for (const emailPurpose of ["paid-receipt", "part-payment-receipt"]) {
  test(`${emailPurpose} retains default text and stamp while safely encoding template values`, async () => {
    const args = { ...input("invoice"), emailPurpose, stampText: emailPurpose === "paid-receipt" ? "PAID" : "PART PAYMENT" };
    args.emailSettings.signature = "Office <img src=x onerror=alert(1)>\nNext line";
    let submitted, pdfInput;
    const result = await submitDocumentEmail(args, dependencies(async (mail) => { submitted = mail; return { accepted: [recipient, "copy@example.test"] }; }, async (payload) => { pdfInput = payload; return attachment; }));
    assert.match(result.subject, emailPurpose === "paid-receipt" ? /PAID INVOICE/ : /PART PAYMENT RECEIPT/);
    assert.match(submitted.text, /receipt/);
    assert.match(submitted.html, /&lt;img/);
    assert.equal(submitted.html.includes("<img"), false);
    assert.equal(pdfInput.stampText, args.stampText);
  });
}
