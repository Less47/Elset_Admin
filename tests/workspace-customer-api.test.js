import assert from "node:assert/strict";
import test from "node:test";
import {
  isSqliteWorkspaceMode,
  requestCustomerWorkspaceUpdate,
  requestDocumentWorkspaceUpdate,
  requestInventoryWorkspaceUpdate,
  requestMaintenanceWorkspaceUpdate,
  requestServiceM8ImportUpdate,
  requestSettingsWorkspaceUpdate,
  requestStaffWorkspaceUpdate,
  requestWorkspaceRestoreUpdate,
  requestWorkspaceUpdate,
} from "../src/hooks/workspace-customer-api.js";
import { sendDocumentAndPersistHistory } from "../src/hooks/document-send-workflow.js";

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

test("document API helper sends stable sent-history records", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          sentHistoryId: "sent-history-stable-1",
          quote: {
            sentHistory: [
              {
                id: "sent-history-stable-1",
                subject: "QUOTE for Synthetic job",
              },
            ],
          },
        },
        state: {
          jobs: [
            {
              id: "job-1",
              quote: {
                sentHistory: [
                  {
                    id: "sent-history-stable-1",
                    subject: "QUOTE for Synthetic job",
                  },
                ],
              },
            },
          ],
        },
      }),
    };
  };

  const payload = await requestDocumentWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/jobs/job-1/quote/sent-history",
    method: "POST",
    body: {
      history: {
        id: "sent-history-stable-1",
        sentAt: "2026-02-03T00:00:00.000Z",
        fromEmail: "admin@example.test",
        toEmail: "accounts@example.test",
        toName: "Example Accounts",
        subject: "QUOTE for Synthetic job",
        messageId: "message-1",
        documentSnapshot: { type: "quote" },
      },
    },
  });

  assert.equal(calls[0].path, "/api/jobs/job-1/quote/sent-history");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    history: {
      id: "sent-history-stable-1",
      sentAt: "2026-02-03T00:00:00.000Z",
      fromEmail: "admin@example.test",
      toEmail: "accounts@example.test",
      toName: "Example Accounts",
      subject: "QUOTE for Synthetic job",
      messageId: "message-1",
      documentSnapshot: { type: "quote" },
    },
  });
  assert.equal(payload.result.sentHistoryId, "sent-history-stable-1");
});

test("document send workflow records sent history only after email success", async () => {
  const calls = [];

  const result = await sendDocumentAndPersistHistory({
    sendEmail: async () => ({
      messageId: "message-success",
      sentAt: "2026-02-03T00:00:00.000Z",
    }),
    buildHistoryEntry: (payload) => ({
      id: "sent-history-stable-1",
      messageId: payload.messageId,
      sentAt: payload.sentAt,
    }),
    persistHistory: async ({ historyEntry }) => {
      calls.push(historyEntry);
      return true;
    },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      id: "sent-history-stable-1",
      messageId: "message-success",
      sentAt: "2026-02-03T00:00:00.000Z",
    },
  ]);
});

test("document send workflow skips sent history when email sending fails", async () => {
  const calls = [];
  const errors = [];

  const result = await sendDocumentAndPersistHistory({
    sendEmail: async () => {
      throw new Error("SMTP rejected the message.");
    },
    buildHistoryEntry: () => {
      throw new Error("History should not be built after failed email.");
    },
    persistHistory: async ({ historyEntry }) => {
      calls.push(historyEntry);
      return true;
    },
    onError: (error) => errors.push(error.message),
  });

  assert.equal(result, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, ["SMTP rejected the message."]);
});

test("maintenance API helper sends record-specific plan requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          id: "maintenance-plan-1",
          planName: "Synthetic maintenance plan",
        },
        state: {
          maintenancePlans: [
            {
              id: "maintenance-plan-1",
              planName: "Synthetic maintenance plan",
            },
          ],
        },
      }),
    };
  };

  const payload = await requestMaintenanceWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/maintenance-plans/maintenance-plan-1",
    method: "PATCH",
    body: {
      plan: {
        planName: "Synthetic maintenance plan",
        nextDueDate: "2026-03-01",
      },
    },
  });

  assert.equal(calls[0].path, "/api/maintenance-plans/maintenance-plan-1");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    plan: {
      planName: "Synthetic maintenance plan",
      nextDueDate: "2026-03-01",
    },
  });
  assert.equal(payload.result.id, "maintenance-plan-1");
});

test("maintenance API helper rejects failed requests before state is applied", async () => {
  let appliedState = false;
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "Next service date is invalid.",
      state: {
        maintenancePlans: [
          {
            id: "maintenance-plan-1",
            nextDueDate: "bad-date",
          },
        ],
      },
    }),
  });

  await assert.rejects(
    async () => {
      const payload = await requestMaintenanceWorkspaceUpdate({
        fetchWithAuth,
        path: "/api/maintenance-plans/maintenance-plan-1/schedule",
        method: "PATCH",
        body: { nextDueDate: "bad-date" },
      });
      appliedState = Boolean(payload.state);
    },
    /Next service date is invalid/
  );
  assert.equal(appliedState, false);
});

test("inventory API helper sends record-specific item requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          id: "inventory-item-1",
          name: "Synthetic inventory item",
          quantity: 4,
        },
        state: {
          inventoryItems: [
            {
              id: "inventory-item-1",
              name: "Synthetic inventory item",
              quantity: 4,
            },
          ],
        },
      }),
    };
  };

  const payload = await requestInventoryWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/inventory-items/inventory-item-1",
    method: "PATCH",
    body: {
      item: {
        quantity: 4,
        unitCost: 25,
      },
    },
  });

  assert.equal(calls[0].path, "/api/inventory-items/inventory-item-1");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    item: {
      quantity: 4,
      unitCost: 25,
    },
  });
  assert.equal(payload.result.id, "inventory-item-1");
});

test("inventory API helper rejects failed requests before state is applied", async () => {
  let appliedState = false;
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "Quantity must be a valid number.",
      state: {
        inventoryItems: [
          {
            id: "inventory-item-1",
            quantity: "bad",
          },
        ],
      },
    }),
  });

  await assert.rejects(
    async () => {
      const payload = await requestInventoryWorkspaceUpdate({
        fetchWithAuth,
        path: "/api/inventory-items/inventory-item-1",
        method: "PATCH",
        body: { item: { quantity: "bad" } },
      });
      appliedState = Boolean(payload.state);
    },
    /Quantity must be a valid number/
  );
  assert.equal(appliedState, false);
});

test("staff API helper sends record-specific staff requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          id: "staff-1",
          name: "Synthetic Staff",
        },
        state: {
          staff: [
            {
              id: "staff-1",
              name: "Synthetic Staff",
            },
          ],
        },
      }),
    };
  };

  const payload = await requestStaffWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/staff/staff-1",
    method: "PATCH",
    body: {
      staff: {
        name: "Synthetic Staff",
        role: "Service Technician",
      },
    },
  });

  assert.equal(calls[0].path, "/api/staff/staff-1");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    staff: {
      name: "Synthetic Staff",
      role: "Service Technician",
    },
  });
  assert.equal(payload.result.id, "staff-1");
});

test("staff API helper rejects failed requests before state is applied", async () => {
  let appliedState = false;
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "Staff email address is invalid.",
      state: {
        staff: [
          {
            id: "staff-1",
            email: "bad-email",
          },
        ],
      },
    }),
  });

  await assert.rejects(
    async () => {
      const payload = await requestStaffWorkspaceUpdate({
        fetchWithAuth,
        path: "/api/staff/staff-1",
        method: "PATCH",
        body: { staff: { email: "bad-email" } },
      });
      appliedState = Boolean(payload.state);
    },
    /Staff email address is invalid/
  );
  assert.equal(appliedState, false);
});

test("settings API helper sends record-specific settings requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          updatedKeys: ["companyName"],
        },
        state: {
          settings: {
            companyName: "Synthetic Business",
          },
        },
      }),
    };
  };

  const payload = await requestSettingsWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/settings",
    method: "PATCH",
    body: {
      settings: {
        companyName: "Synthetic Business",
      },
    },
  });

  assert.equal(calls[0].path, "/api/settings");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    settings: {
      companyName: "Synthetic Business",
    },
  });
  assert.deepEqual(payload.result.updatedKeys, ["companyName"]);
});

test("settings API helper sends record-specific document template requests", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          type: "quote",
          template: {
            quoteHeading: "Synthetic Quote",
          },
        },
        state: {
          quoteTemplate: {
            quoteHeading: "Synthetic Quote",
          },
        },
      }),
    };
  };

  const payload = await requestSettingsWorkspaceUpdate({
    fetchWithAuth,
    path: "/api/document-templates/quote",
    method: "PUT",
    body: {
      template: {
        quoteHeading: "Synthetic Quote",
      },
    },
  });

  assert.equal(calls[0].path, "/api/document-templates/quote");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    template: {
      quoteHeading: "Synthetic Quote",
    },
  });
  assert.equal(payload.result.type, "quote");
});

test("settings API helper rejects failed requests before state is applied", async () => {
  let appliedState = false;
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "Company email is invalid.",
      state: {
        settings: {
          companyEmail: "bad-email",
        },
      },
    }),
  });

  await assert.rejects(
    async () => {
      const payload = await requestSettingsWorkspaceUpdate({
        fetchWithAuth,
        path: "/api/settings",
        method: "PATCH",
        body: { settings: { companyEmail: "bad-email" } },
      });
      appliedState = Boolean(payload.state);
    },
    /Company email is invalid/
  );
  assert.equal(appliedState, false);
});

test("ServiceM8 import helper uses the dedicated import endpoint payload", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        importedAt: "2026-02-06T00:00:00.000Z",
        summary: {
          apply: {
            customers: { created: 1, updated: 0, skipped: 0, conflicted: 0, failed: 0 },
            jobs: { created: 1, updated: 0, skipped: 0, conflicted: 0, failed: 0 },
          },
        },
        state: {
          customers: [{ id: "servicem8-company-1", name: "Synthetic ServiceM8 Customer" }],
          jobs: [{ id: "servicem8-job-1", title: "Synthetic ServiceM8 job" }],
        },
      }),
    };
  };

  const payload = await requestServiceM8ImportUpdate({
    fetchWithAuth,
    path: "/api/admin/servicem8-import/apply",
    method: "POST",
    body: {
      apiKey: "synthetic-api-key",
      options: { includePayments: true },
      previewId: "preview-1",
    },
  });

  assert.equal(calls[0].path, "/api/admin/servicem8-import/apply");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    apiKey: "synthetic-api-key",
    options: { includePayments: true },
    previewId: "preview-1",
  });
  assert.equal(payload.summary.apply.customers.created, 1);
});

test("ServiceM8 import helper rejects failed imports before state is applied", async () => {
  let appliedState = false;
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "ServiceM8 jobs response was not a list.",
      state: {
        customers: [{ id: "bad-import" }],
      },
    }),
  });

  await assert.rejects(
    async () => {
      const payload = await requestServiceM8ImportUpdate({
        fetchWithAuth,
        path: "/api/admin/servicem8-import/apply",
        method: "POST",
        body: { apiKey: "synthetic-api-key" },
      });
      appliedState = Boolean(payload.state);
    },
    /ServiceM8 jobs response was not a list/
  );
  assert.equal(appliedState, false);
});

test("workspace restore helper uses the dedicated SQLite restore endpoint payload", async () => {
  const calls = [];
  const fetchWithAuth = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        restore: {
          restoredBackup: {
            summary: {
              counts: { customers: 1 },
            },
          },
        },
        state: {
          customers: [{ id: "restored-customer", name: "Restored Synthetic Customer" }],
        },
      }),
    };
  };

  const payload = await requestWorkspaceRestoreUpdate({
    fetchWithAuth,
    path: "/api/admin/workspace-restore",
    method: "POST",
    body: {
      backupData: { backup: { format: "elset-workspace-sqlite-backup-v1" } },
      restorePassword: "correct-password",
    },
  });

  assert.equal(calls[0].path, "/api/admin/workspace-restore");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    backupData: { backup: { format: "elset-workspace-sqlite-backup-v1" } },
    restorePassword: "correct-password",
  });
  assert.equal(payload.state.customers[0].name, "Restored Synthetic Customer");
});

test("workspace restore helper rejects failed restores before visible state is applied", async () => {
  let appliedState = false;
  const fetchWithAuth = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "The SQLite workspace backup checksum does not match the embedded database.",
      state: {
        customers: [{ id: "tampered-customer" }],
      },
    }),
  });

  await assert.rejects(
    async () => {
      const payload = await requestWorkspaceRestoreUpdate({
        fetchWithAuth,
        path: "/api/admin/workspace-restore",
        method: "POST",
        body: {
          backupData: { backup: { format: "elset-workspace-sqlite-backup-v1" } },
          restorePassword: "correct-password",
        },
      });
      appliedState = Boolean(payload.state);
    },
    /checksum does not match/
  );
  assert.equal(appliedState, false);
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
