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
      assert.equal(deleteInvoice.response.status, 200, deleteInvoice.payload.error);
      assert.equal(deleteInvoice.payload.state.jobs.find((job) => job.id === "demo-job-1001").invoice, null);

      const state = getDbState(dbPath);
      assert.equal(state.jobs.find((job) => job.id === "demo-job-1001").invoice, null);
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
