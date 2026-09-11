import assert from "node:assert/strict";
import test from "node:test";
import { DocumentEmailError, submitDocumentEmail } from "../server-document-email.js";
import { documentSendErrorMessage } from "../src/lib/document-send-status.js";

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
    assert.equal(submitted.to, recipient);
    assert.equal(submitted.from, "sender@example.test");
    assert.equal(submitted.replyTo, "reply@example.test");
    assert.equal(submitted.cc, "copy@example.test");
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
      await assert.rejects(submitDocumentEmail(input(type), dependencies(async () => ({ accepted }))), (error) => error.code === "RECIPIENT_REJECTED");
    }
  });
}

test("provider acceptance matches named addresses case insensitively", async () => {
  const args = input("quote");
  args.job.billingContact.email = '"Example Accounts" <accounts@example.test>';
  const result = await submitDocumentEmail(args, dependencies(async () => ({ accepted: [{ address: "ACCOUNTS@EXAMPLE.TEST" }] })));
  assert.equal(result.ok, true);
  assert.equal(result.recipientEmail, args.job.billingContact.email);
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
