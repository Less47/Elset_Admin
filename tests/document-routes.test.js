import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createDocumentRouter } from "../server-document-routes.js";
import { createJobRouter } from "../server-job-routes.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { deleteInvoiceForJob, restoreDeletedInvoice } from "../server-workspace-documents.js";
import { getAuthorizedWorkspaceState } from "../server-workspace-storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");

function readFixture(overrides = {}) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return {
    ...fixture,
    ...overrides,
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-document-routes-"));
}

async function withTempWorkspace(callback, fixture = readFixture()) {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "elset-workspace.db");
  const db = openWorkspaceDb({ dbPath });
  importWorkspaceJsonData(db, fixture);
  db.close();

  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "sqlite",
  };

  try {
    return await callback({ tempDir, dbPath, env });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildApp(env, user = {}) {
  const app = express();
  app.use(express.json());
  const authOptions = {
    env,
    requireAuth: (req, _res, next) => {
      req.user = {
        id: user.id || "test-admin",
        role: user.role || "admin",
        username: user.username || "test-admin",
        name: user.name || "Test Admin",
        staffId: user.staffId || "demo-staff-admin",
      };
      next();
    },
    requireRole: (roles) => (req, res, next) => {
      if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return next();
    },
  };
  app.use(createDocumentRouter(authOptions));
  app.use(createJobRouter(authOptions));
  return app;
}

async function withServer(env, callback, user = {}) {
  const app = buildApp(env, user);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await callback(baseUrl);
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function getDbState(dbPath) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return loadWorkspaceStateFromDb(db);
  } finally {
    db.close();
  }
}

function deletableFixture(history = [], payments = []) {
  const fixture = readFixture();
  const job = fixture.jobs.find((entry) => entry.id === "demo-job-1001");
  job.invoice = { ...job.invoice, paidAmount: 0, paymentStatus: "unpaid", payments, sentHistory: history };
  return fixture;
}

for (const role of ["admin", "office"]) test(`${role} can archive and restore an unpaid invoice without changing linked records`, async () => {
  const history = role === "office" ? [sentHistoryPayload("archive-send", "invoice", { stampText: "", emailPurpose: "invoice" }), sentHistoryPayload("archive-resend", "invoice", { stampText: "", emailPurpose: "invoice" })] : [];
  await withTempWorkspace(async ({ env, dbPath }) => {
    const before = getDbState(dbPath);
    const original = before.jobs.find((job) => job.id === "demo-job-1001");
    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", { method: "DELETE", body: JSON.stringify({ confirmSent: true }) });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      const state = deleted.payload.state;
      const persisted = getDbState(dbPath);
      assert.deepEqual(persisted.jobs.find((job) => job.id === original.id), { ...original, invoice: null, updatedAt: deleted.payload.result.deletedAt });
      assert.deepEqual(persisted.jobs.filter((job) => job.id !== original.id), before.jobs.filter((job) => job.id !== original.id));
      for (const field of ["customers", "staff", "maintenancePlans", "inventoryItems", "deletedJobs", "deletedCustomers"]) assert.deepEqual(persisted[field], before[field], field);
      const [archive] = state.deletedInvoices;
      assert.equal(archive.invoiceNumber, "INV-1001");
      assert.equal(archive.customerName, original.customerName);
      assert.equal(archive.deletedBy, "test-admin");
      assert.deepEqual(archive.invoice, original.invoice);
      assert.deepEqual(getDbState(dbPath).deletedInvoices, state.deletedInvoices);
      const duplicate = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", { method: "DELETE", body: JSON.stringify({ confirmSent: true }) });
      assert.equal(duplicate.response.status, 404);
      assert.equal(getDbState(dbPath).deletedInvoices.length, 1);
      const restored = await requestJson(baseUrl, `/api/deleted-invoices/${archive.id}/restore`, { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.deepEqual(restored.payload.result.invoice, original.invoice);
      assert.equal(restored.payload.state.deletedInvoices.length, 0);
      assert.deepEqual(getDbState(dbPath).jobs.find((job) => job.id === original.id).invoice, original.invoice);
    }, { role });
  }, deletableFixture(history));
});

test("server requires explicit sent confirmation and refuses a truthy string", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => withServer(env, async (baseUrl) => {
    const before = getDbState(dbPath);
    for (const confirmSent of [undefined, false, "true"]) {
      const result = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", { method: "DELETE", body: JSON.stringify({ confirmSent }) });
      assert.equal(result.response.status, 409);
      assert.equal(result.payload.code, "INVOICE_ALREADY_SENT");
      assert.match(result.payload.error, /customer will still have their copy/);
      assert.deepEqual(getDbState(dbPath), before);
    }
  }), deletableFixture([sentHistoryPayload("already-sent", "invoice", { stampText: "", emailPurpose: "invoice" })]));
});

for (const [name, history, payments] of [
  ["partial payment", [], [{ id: "deposit", amount: 10 }]],
  ["full payment", [], [{ id: "full-payment", amount: 99999 }]],
  ["zero payment record", [], [{ id: "zero-payment", amount: 0 }]],
  ["receipt purpose", [sentHistoryPayload("receipt-purpose", "invoice", { stampText: "" })], []],
  ["receipt stamp", [sentHistoryPayload("receipt-stamp", "invoice", { emailPurpose: "" })], []],
  ["historical snapshot payment", [sentHistoryPayload("receipt-snapshot", "invoice", { emailPurpose: "", stampText: "", documentSnapshot: { items: [], payments: [{ id: "old", amount: 10 }] } })], []],
]) test(`invoice deletion blocks ${name} without changing any stored data`, async () => {
  await withTempWorkspace(async ({ env, dbPath }) => withServer(env, async (baseUrl) => {
    if (name === "zero payment record") {
      const db = openWorkspaceDb({ dbPath });
      db.prepare("INSERT INTO payments (id, invoice_id, amount_cents, created_at) SELECT 'zero-payment', id, 0, '2026-01-01' FROM invoices WHERE job_id = 'demo-job-1001'").run();
      db.close();
    }
    const before = getDbState(dbPath);
    const result = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", { method: "DELETE", body: JSON.stringify({ confirmSent: true }) });
    assert.equal(result.response.status, 409);
    assert.match(result.payload.error, /payment/i);
    assert.deepEqual(getDbState(dbPath), before);
  }), deletableFixture(history, payments));
});

test("technicians cannot delete or restore invoices or read invoice archives", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    const db = openWorkspaceDb({ dbPath });
    const archived = deleteInvoiceForJob(db, "demo-job-1001");
    db.close();
    const before = getDbState(dbPath);
    assert.equal(before.deletedInvoices.length, 1);
    assert.deepEqual(getAuthorizedWorkspaceState({ id: "tech", role: "technician" }, { env }).deletedInvoices, []);
    await withServer(env, async (baseUrl) => {
      for (const [url, method] of [["/api/jobs/demo-job-1001/invoice", "DELETE"], [`/api/deleted-invoices/${archived.archiveId}/restore`, "POST"]]) {
        assert.equal((await requestJson(baseUrl, url, { method })).response.status, 403);
      }
      assert.deepEqual(getDbState(dbPath), before);
    }, { role: "technician" });
  }, deletableFixture());
});

test("archive deletion is atomic on database failure and returns a safe error", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    const db = openWorkspaceDb({ dbPath });
    db.exec("CREATE TRIGGER fail_invoice_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'PRIVATE database detail'); END;");
    db.close();
    const before = getDbState(dbPath);
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", { method: "DELETE" });
      assert.equal(result.response.status, 500);
      assert.equal(result.payload.error, "Unable to update the invoice. Please try again.");
      assert.deepEqual(getDbState(dbPath), before);
    });
  }, deletableFixture());
});

test("invoice archive survives export/import and recovery refuses missing jobs or existing invoices", async () => {
  await withTempWorkspace(async ({ dbPath }) => {
    const db = openWorkspaceDb({ dbPath });
    try {
      const original = loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === "demo-job-1001");
      const archived = deleteInvoiceForJob(db, original.id);
      const exported = loadWorkspaceStateFromDb(db);
      await withTempWorkspace(async ({ dbPath: importedPath }) => {
        const imported = openWorkspaceDb({ dbPath: importedPath });
        try {
          assert.deepEqual(loadWorkspaceStateFromDb(imported).deletedInvoices, exported.deletedInvoices);
          restoreDeletedInvoice(imported, archived.archiveId);
          assert.deepEqual(loadWorkspaceStateFromDb(imported).jobs.find((job) => job.id === original.id).invoice, original.invoice);
        } finally { imported.close(); }
      }, exported);
      db.prepare("INSERT INTO invoices (id, job_id, created_at, updated_at) VALUES ('replacement', ?, '2026-01-01', '2026-01-01')").run(original.id);
      assert.throws(() => restoreDeletedInvoice(db, archived.archiveId), /already has an invoice/);
      assert.equal(loadWorkspaceStateFromDb(db).deletedInvoices.length, 1);
      db.prepare("DELETE FROM jobs WHERE id = ?").run(original.id);
      assert.throws(() => restoreDeletedInvoice(db, archived.archiveId), /Restore the linked job/);
      assert.equal(loadWorkspaceStateFromDb(db).deletedInvoices.length, 1);
      assert.throws(() => restoreDeletedInvoice(db, "missing"), /not found/);
    } finally { db.close(); }
  }, deletableFixture());
});

function sentHistoryPayload(id, type = "quote", overrides = {}) {
  return {
    id,
    sentAt: type === "invoice" ? "2026-02-04T00:00:00.000Z" : "2026-02-03T00:00:00.000Z",
    fromEmail: "admin@example.test",
    toEmail: type === "invoice" ? "invoices@example.test" : "quotes@example.test",
    toName: "Synthetic Accounts",
    subject: `ELSET ${type === "invoice" ? "INVOICE" : "QUOTE"} FOR 1 Demo Street`,
    messageId: `${id}-message`,
    stampText: type === "invoice" ? "PART PAYMENT" : "",
    emailPurpose: type === "invoice" ? "part-payment-receipt" : "",
    jobSnapshot: {
      id: "demo-job-1001",
      title: "Synthetic gate repair",
      customerName: "Demo Customer",
    },
    documentSnapshot: {
      type,
      items: [
        {
          id: `${id}-line`,
          description: "Synthetic sent document line",
          qty: 1,
          rate: 100,
        },
      ],
    },
    templateSnapshot: {
      companyName: "ELSET Demo Pty Ltd",
    },
    ...overrides,
  };
}

test("quote routes calculate subtotal, GST, and total on the server", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const saved = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote", {
        method: "PUT",
        body: JSON.stringify({
          id: "client-supplied-quote-id",
          issueDate: "2026-02-01",
          notes: "Updated synthetic quote.",
          total: 1,
          status: "paid",
          items: [
            {
              id: "quote-line-gate",
              description: "Synthetic controller",
              qty: 2,
              rate: 100.1,
            },
            {
              id: "quote-line-labour",
              description: "Synthetic labour",
              qty: 1.5,
              rate: 50,
            },
          ],
        }),
      });

      assert.equal(saved.response.status, 200, saved.payload.error);
      assert.equal(saved.payload.result.financials.subtotal, 275.2);
      assert.equal(saved.payload.result.financials.gst, 27.52);
      assert.equal(saved.payload.result.financials.total, 302.72);
      assert.equal(saved.payload.result.quote.notes, "Updated synthetic quote.");
      assert.equal(saved.payload.result.quote.total, undefined);
      assert.equal(saved.payload.result.quoteId, "demo-job-1001:quote");

      const deleteQuote = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote", { method: "DELETE" });
      assert.equal(deleteQuote.response.status, 200, deleteQuote.payload.error);
      assert.equal(deleteQuote.payload.state.jobs.find((job) => job.id === "demo-job-1001").quote, null);

      const state = getDbState(dbPath);
      assert.equal(state.jobs.find((job) => job.id === "demo-job-1001").quote, null);
    });
  });
});

test("invoice routes calculate totals and payment-driven statuses", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const invoice = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", {
        method: "PUT",
        body: JSON.stringify({
          issueDate: "2026-02-01",
          dueDate: "2999-02-08",
          notes: "Synthetic invoice replacement.",
          paymentNotes: "Synthetic payment terms.",
          total: 1,
          status: "paid",
          items: [
            {
              id: "invoice-line-controller",
              description: "Synthetic controller",
              qty: 1,
              rate: 1000,
            },
          ],
        }),
      });

      assert.equal(invoice.response.status, 200, invoice.payload.error);
      assert.equal(invoice.payload.result.financials.subtotal, 1000);
      assert.equal(invoice.payload.result.financials.gst, 100);
      assert.equal(invoice.payload.result.financials.total, 1100);
      assert.equal(invoice.payload.result.financials.paid, 250);
      assert.equal(invoice.payload.result.financials.balance, 850);
      assert.equal(invoice.payload.result.status.id, "deposit-paid");
      assert.equal(invoice.payload.result.invoice.status, undefined);

      const deleteExistingPayment = await requestJson(
        baseUrl,
        "/api/jobs/demo-job-1001/invoice/payments/demo-payment-1",
        { method: "DELETE" }
      );
      assert.equal(deleteExistingPayment.response.status, 200, deleteExistingPayment.payload.error);
      assert.equal(deleteExistingPayment.payload.result.status.id, "draft");

      const deposit = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/payments", {
        method: "POST",
        body: JSON.stringify({
          id: "payment-deposit",
          amount: 100,
          date: "2026-02-03",
          method: "Synthetic EFT",
          reference: "DEP-1",
        }),
      });
      assert.equal(deposit.response.status, 200, deposit.payload.error);
      assert.equal(deposit.payload.result.financials.paid, 100);
      assert.equal(deposit.payload.result.financials.balance, 1000);
      assert.equal(deposit.payload.result.status.id, "deposit-paid");

      const duplicate = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/payments", {
        method: "POST",
        body: JSON.stringify({
          id: "payment-deposit",
          amount: 100,
          date: "2026-02-03",
        }),
      });
      assert.equal(duplicate.response.status, 200, duplicate.payload.error);
      assert.equal(duplicate.payload.result.duplicate, true);
      assert.equal(duplicate.payload.result.invoice.payments.length, 1);

      const secondPayment = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/payments", {
        method: "POST",
        body: JSON.stringify({
          id: "payment-second",
          amount: 100,
          date: "2026-02-04",
        }),
      });
      assert.equal(secondPayment.response.status, 200, secondPayment.payload.error);
      assert.equal(secondPayment.payload.result.status.id, "partially-paid");

      const finalPayment = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/payments/payment-second", {
        method: "PATCH",
        body: JSON.stringify({
          amount: 1000,
          notes: "Synthetic final payment.",
        }),
      });
      assert.equal(finalPayment.response.status, 200, finalPayment.payload.error);
      assert.equal(finalPayment.payload.result.financials.paid, 1100);
      assert.equal(finalPayment.payload.result.financials.balance, 0);
      assert.equal(finalPayment.payload.result.status.id, "paid");

      const removeFinal = await requestJson(
        baseUrl,
        "/api/jobs/demo-job-1001/invoice/payments/payment-second",
        { method: "DELETE" }
      );
      assert.equal(removeFinal.response.status, 200, removeFinal.payload.error);
      assert.equal(removeFinal.payload.result.status.id, "deposit-paid");

      const overdue = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", {
        method: "PATCH",
        body: JSON.stringify({
          dueDate: "2000-01-01",
          notes: "Overdue synthetic invoice.",
          paymentNotes: "Updated synthetic payment notes.",
        }),
      });
      assert.equal(overdue.response.status, 200, overdue.payload.error);
      assert.equal(overdue.payload.result.status.id, "overdue");
      assert.equal(overdue.payload.result.invoice.paymentNotes, "Updated synthetic payment notes.");

      const deleteInvoice = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", { method: "DELETE" });
      assert.equal(deleteInvoice.response.status, 409);
      assert.match(deleteInvoice.payload.error, /recorded payments/);
      const state = getDbState(dbPath);
      assert.deepEqual(state.jobs.find((job) => job.id === "demo-job-1001").invoice, overdue.payload.result.invoice);
      assert.equal(state.deletedInvoices.length, 0);
    });
  });
});

test("invoice status reports unpaid when sent history exists without payments", async () => {
  const fixture = readFixture();
  fixture.jobs = fixture.jobs.map((job) => (
    job.id === "demo-job-1001"
      ? {
          ...job,
          invoice: {
            ...job.invoice,
            dueDate: "2999-01-01",
            payments: [],
            sentHistory: [
              {
                id: "sent-invoice-demo",
                sentAt: "2026-02-01T00:00:00.000Z",
                toEmail: "accounts@example.test",
              },
            ],
          },
        }
      : job
  ));

  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", {
        method: "PATCH",
        body: JSON.stringify({ notes: "Touched synthetic sent invoice." }),
      });

      assert.equal(result.response.status, 200, result.payload.error);
      assert.equal(result.payload.result.status.id, "unpaid");
      assert.equal(result.payload.result.invoice.sentHistory.length, 1);
    });
  }, fixture);
});

test("quote and invoice sent-history routes persist successful sends with stable IDs", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const quoteHistory = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-quote-route-1", "quote"),
        }),
      });
      assert.equal(quoteHistory.response.status, 200, quoteHistory.payload.error);
      assert.equal(quoteHistory.payload.result.sentHistoryId, "sent-quote-route-1");
      assert.equal(quoteHistory.payload.result.quote.sentHistory.length, 1);
      assert.equal(quoteHistory.payload.result.quote.sentHistory[0].id, "sent-quote-route-1");
      assert.equal(quoteHistory.payload.result.quote.sentHistory[0].subject, "ELSET QUOTE FOR 1 Demo Street");
      assert.equal(quoteHistory.payload.result.quote.sentHistory[0].messageId, "sent-quote-route-1-message");
      assert.equal(quoteHistory.payload.result.quote.sentHistory[0].documentSnapshot.type, "quote");

      const invoiceHistory = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-invoice-route-1", "invoice"),
        }),
      });
      assert.equal(invoiceHistory.response.status, 200, invoiceHistory.payload.error);
      assert.equal(invoiceHistory.payload.result.sentHistoryId, "sent-invoice-route-1");
      assert.equal(invoiceHistory.payload.result.invoice.sentHistory.length, 1);
      assert.equal(invoiceHistory.payload.result.invoice.sentHistory[0].id, "sent-invoice-route-1");
      assert.equal(invoiceHistory.payload.result.invoice.sentHistory[0].subject, "ELSET INVOICE FOR 1 Demo Street");
      assert.equal(invoiceHistory.payload.result.invoice.sentHistory[0].stampText, "PART PAYMENT");
      assert.equal(invoiceHistory.payload.result.invoice.sentHistory[0].emailPurpose, "part-payment-receipt");
      assert.ok(invoiceHistory.payload.result.status.id);

      const state = getDbState(dbPath);
      const job = state.jobs.find((entry) => entry.id === "demo-job-1001");
      assert.equal(job.quote.sentHistory.length, 1);
      assert.equal(job.invoice.sentHistory.length, 1);
      assert.equal(job.quote.sentHistory[0].subject, "ELSET QUOTE FOR 1 Demo Street");
      assert.equal(job.invoice.sentHistory[0].subject, "ELSET INVOICE FOR 1 Demo Street");
    });
  });
});

test("sent-history routes are idempotent for duplicate stable IDs", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const first = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-quote-duplicate", "quote"),
        }),
      });
      assert.equal(first.response.status, 200, first.payload.error);

      const duplicate = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-quote-duplicate", "quote"),
        }),
      });
      assert.equal(duplicate.response.status, 200, duplicate.payload.error);
      assert.equal(duplicate.payload.result.duplicate, true);
      assert.equal(duplicate.payload.result.sentHistoryId, "sent-quote-duplicate");
      assert.equal(duplicate.payload.result.quote.sentHistory.length, 1);
    });
  });
});

test("document routes reject invalid values and stay unavailable in JSON mode", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const missingJob = await requestJson(baseUrl, "/api/jobs/missing-job/quote", {
        method: "PUT",
        body: JSON.stringify({
          issueDate: "2026-01-01",
          items: [{ description: "Missing job", qty: 1, rate: 10 }],
        }),
      });
      assert.equal(missingJob.response.status, 404);

      const invalidQuantity = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote", {
        method: "PUT",
        body: JSON.stringify({
          issueDate: "2026-01-01",
          items: [{ description: "Invalid quantity", qty: -1, rate: 10 }],
        }),
      });
      assert.equal(invalidQuantity.response.status, 400);

      const invalidDate = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice", {
        method: "PATCH",
        body: JSON.stringify({ dueDate: "2026-99-99" }),
      });
      assert.equal(invalidDate.response.status, 400);

      const invalidPayment = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/payments", {
        method: "POST",
        body: JSON.stringify({
          id: "invalid-payment",
          amount: -10,
          date: "2026-01-01",
        }),
      });
      assert.equal(invalidPayment.response.status, 400);

      const missingPaymentId = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/payments", {
        method: "POST",
        body: JSON.stringify({
          amount: 10,
          date: "2026-01-01",
        }),
      });
      assert.equal(missingPaymentId.response.status, 400);

      const missingJobHistory = await requestJson(baseUrl, "/api/jobs/missing-job/quote/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-missing-job", "quote"),
        }),
      });
      assert.equal(missingJobHistory.response.status, 404);

      const deleteQuote = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote", { method: "DELETE" });
      assert.equal(deleteQuote.response.status, 200, deleteQuote.payload.error);
      const missingDocumentHistory = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-missing-document", "quote"),
        }),
      });
      assert.equal(missingDocumentHistory.response.status, 404);

      const missingHistoryId = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: {
            ...sentHistoryPayload("", "invoice"),
            id: "",
          },
        }),
      });
      assert.equal(missingHistoryId.response.status, 400);

      const missingRecipient = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: {
            ...sentHistoryPayload("sent-missing-recipient", "invoice"),
            toEmail: "",
          },
        }),
      });
      assert.equal(missingRecipient.response.status, 400);
    });
  });

  const tempDir = makeTempDir();
  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "json",
  };

  try {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote", {
        method: "PUT",
        body: JSON.stringify({
          issueDate: "2026-01-01",
          items: [{ description: "JSON mode quote", qty: 1, rate: 10 }],
        }),
      });
      assert.equal(result.response.status, 409);

      const sentHistory = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-json-mode", "quote"),
        }),
      });
      assert.equal(sentHistory.response.status, 409);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("document writes roll back when a related line-item insert fails", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote", {
        method: "PUT",
        body: JSON.stringify({
          issueDate: "2026-02-01",
          notes: "This should roll back.",
          items: [
            {
              id: "duplicate-line-id",
              description: "First duplicate line",
              qty: 1,
              rate: 100,
            },
            {
              id: "duplicate-line-id",
              description: "Second duplicate line",
              qty: 1,
              rate: 100,
            },
          ],
        }),
      });

      assert.equal(result.response.status, 500);
      const state = getDbState(dbPath);
      const quote = state.jobs.find((job) => job.id === "demo-job-1001").quote;
      assert.equal(quote.notes, "Synthetic quote.");
      assert.equal(quote.items.length, 1);
      assert.equal(quote.items[0].id, "demo-quote-item-1");
    });
  });
});

test("deleting and restoring a job preserves quotes, invoices, payments, and sent history", async () => {
  const fixture = readFixture();
  fixture.jobs = fixture.jobs.map((job) => (
    job.id === "demo-job-1001"
      ? {
          ...job,
          quote: {
            ...job.quote,
            sentHistory: [
              {
                id: "sent-quote-demo",
                sentAt: "2026-02-01T00:00:00.000Z",
                toEmail: "accounts@example.test",
              },
            ],
          },
          invoice: {
            ...job.invoice,
            sentHistory: [
              {
                id: "sent-invoice-demo",
                sentAt: "2026-02-02T00:00:00.000Z",
                toEmail: "accounts@example.test",
              },
            ],
          },
        }
      : job
  ));

  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/jobs/demo-job-1001", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      assert.equal(deleted.payload.state.deletedJobs[0].job.quote.sentHistory.length, 1);
      assert.equal(deleted.payload.state.deletedJobs[0].job.invoice.payments.length, 1);

      const restored = await requestJson(baseUrl, "/api/jobs/demo-job-1001/restore", { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.equal(restored.payload.result.quote.items[0].id, "demo-quote-item-1");
      assert.equal(restored.payload.result.quote.sentHistory.length, 1);
      assert.equal(restored.payload.result.invoice.items[0].id, "demo-invoice-item-1");
      assert.equal(restored.payload.result.invoice.payments[0].id, "demo-payment-1");
      assert.equal(restored.payload.result.invoice.sentHistory.length, 1);

      const state = getDbState(dbPath);
      const job = state.jobs.find((entry) => entry.id === "demo-job-1001");
      assert.equal(job.quote.sentHistory.length, 1);
      assert.equal(job.invoice.payments.length, 1);
      assert.equal(state.deletedJobs.length, 0);
    });
  }, fixture);
});

test("deleting and restoring a job preserves sent history created through document routes", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const quoteHistory = await requestJson(baseUrl, "/api/jobs/demo-job-1001/quote/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-quote-before-delete", "quote"),
        }),
      });
      assert.equal(quoteHistory.response.status, 200, quoteHistory.payload.error);

      const invoiceHistory = await requestJson(baseUrl, "/api/jobs/demo-job-1001/invoice/sent-history", {
        method: "POST",
        body: JSON.stringify({
          history: sentHistoryPayload("sent-invoice-before-delete", "invoice"),
        }),
      });
      assert.equal(invoiceHistory.response.status, 200, invoiceHistory.payload.error);

      const deleted = await requestJson(baseUrl, "/api/jobs/demo-job-1001", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      assert.equal(deleted.payload.state.deletedJobs[0].job.quote.sentHistory[0].id, "sent-quote-before-delete");
      assert.equal(deleted.payload.state.deletedJobs[0].job.invoice.sentHistory[0].id, "sent-invoice-before-delete");

      const restored = await requestJson(baseUrl, "/api/jobs/demo-job-1001/restore", { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.equal(restored.payload.result.quote.sentHistory[0].id, "sent-quote-before-delete");
      assert.equal(restored.payload.result.quote.sentHistory[0].subject, "ELSET QUOTE FOR 1 Demo Street");
      assert.equal(restored.payload.result.invoice.sentHistory[0].id, "sent-invoice-before-delete");
      assert.equal(restored.payload.result.invoice.sentHistory[0].subject, "ELSET INVOICE FOR 1 Demo Street");

      const state = getDbState(dbPath);
      const job = state.jobs.find((entry) => entry.id === "demo-job-1001");
      assert.equal(job.quote.sentHistory[0].id, "sent-quote-before-delete");
      assert.equal(job.invoice.sentHistory[0].id, "sent-invoice-before-delete");
    });
  });
});
