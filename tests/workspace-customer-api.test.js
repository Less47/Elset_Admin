import assert from "node:assert/strict";
import test from "node:test";
import {
  isSqliteWorkspaceMode,
  requestCustomerWorkspaceUpdate,
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
