import assert from "node:assert/strict";
import test from "node:test";
import {
  isSqliteWorkspaceMode,
  requestCustomerWorkspaceUpdate,
  requestDocumentWorkspaceUpdate,
  requestWorkspaceUpdate,
} from "../src/hooks/workspace-customer-api.js";

test("detects SQLite workspace mode explicitly", () => {
  assert.equal(isSqliteWorkspaceMode("sqlite"), true);
  assert.equal(isSqliteWorkspaceMode(" SQLite "), true);
  assert.equal(isSqliteWorkspaceMode("json"), false);
  assert.equal(isSqliteWorkspaceMode(""), false);
});

test("customer API helper sends record-specific JSON requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: { id: "customer-1", name: "Example Customer" },
        state: { customers: [{ id: "customer-1", name: "Example Customer" }] },
      }),
    };
  };

  const payload = await requestCustomerWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/customers",
    method: "POST",
    body: { customer: { id: "customer-1", name: "Example Customer" } },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/customers");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    customer: { id: "customer-1", name: "Example Customer" },
  });
  assert.equal(payload.result.id, "customer-1");
});

test("workspace API helper sends job-specific JSON requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: { id: "job-1", status: "In Progress" },
        state: { jobs: [{ id: "job-1", status: "In Progress" }] },
      }),
    };
  };

  const payload = await requestWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/jobs/job-1/status",
    method: "PATCH",
    body: { status: "In Progress" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/jobs/job-1/status");
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), { status: "In Progress" });
  assert.equal(payload.result.status, "In Progress");
});

test("document API helper sends quote and invoice record-specific requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          invoiceId: "job-1:invoice",
          financials: { subtotal: 100, gst: 10, total: 110, paid: 0, balance: 110 },
          status: { id: "draft", label: "Draft" },
        },
        state: {
          jobs: [
            {
              id: "job-1",
              invoice: {
                issueDate: "2026-02-01",
                dueDate: "2026-02-08",
                items: [{ id: "line-1", qty: 1, rate: 100 }],
                payments: [],
              },
            },
          ],
        },
      }),
    };
  };

  const payload = await requestDocumentWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/jobs/job-1/invoice",
    method: "PUT",
    body: {
      invoice: {
        issueDate: "2026-02-01",
        dueDate: "2026-02-08",
        items: [{ id: "line-1", qty: 1, rate: 100 }],
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/jobs/job-1/invoice");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    invoice: {
      issueDate: "2026-02-01",
      dueDate: "2026-02-08",
      items: [{ id: "line-1", qty: 1, rate: 100 }],
    },
  });
  assert.equal(payload.result.financials.total, 110);
  assert.equal(payload.result.status.id, "draft");
});

test("document API helper sends stable payment IDs for retry-safe payment creation", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          paymentId: "payment-stable-1",
          financials: { total: 110, paid: 50, balance: 60 },
          status: { id: "deposit-paid", label: "Deposit Paid" },
        },
        state: {
          jobs: [
            {
              id: "job-1",
              invoice: {
                payments: [{ id: "payment-stable-1", amount: 50 }],
              },
            },
          ],
        },
      }),
    };
  };

  const payload = await requestDocumentWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/jobs/job-1/invoice/payments",
    method: "POST",
    body: {
      payment: {
        id: "payment-stable-1",
        amount: 50,
        date: "2026-02-03",
      },
    },
  });

  assert.equal(calls[0].path, "/api/jobs/job-1/invoice/payments");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    payment: {
      id: "payment-stable-1",
      amount: 50,
      date: "2026-02-03",
    },
  });
  assert.equal(payload.result.paymentId, "payment-stable-1");
});

test("customer API helper rejects failed requests with server error text", async () => {
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "Customer name is required." }),
  });

  await assert.rejects(
    () => requestCustomerWorkspaceUpdate({
      fetchWithAuth,
      path: "/api/customers",
      method: "POST",
      body: { customer: { name: "" } },
    }),
    /Customer name is required/
  );
});

test("document API helper rejects failed document requests with server error text", async () => {
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "Payment amount must be greater than zero." }),
  });

  await assert.rejects(
    () => requestDocumentWorkspaceUpdate({
      fetchWithAuth,
      path: "/api/jobs/job-1/invoice/payments",
      method: "POST",
      body: { payment: { id: "payment-1", amount: 0 } },
    }),
    /Payment amount must be greater than zero/
  );
});

test("customer API helper requires the authorised app state response", async () => {
  const fetchWithAuth = async () => ({
    ok: true,
    json: async () => ({ ok: true, result: { id: "customer-1" } }),
  });

  await assert.rejects(
    () => requestCustomerWorkspaceUpdate({
      fetchWithAuth,
      path: "/api/customers/customer-1",
      method: "PATCH",
      body: { customer: { name: "Updated Customer" } },
      errorMessage: "Unable to save the customer.",
    }),
    /Unable to save the customer/
  );
});
