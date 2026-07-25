import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveAuthorizedWorkspaceState } from "../server-workspace-storage.js";
import {
  shouldAttemptBroadWorkspaceAutosave,
  shouldRunRecycleBinClientPrune,
} from "../src/hooks/workspace-autosave.js";
import { getSupportedInvoiceUpdateKeys } from "../src/hooks/workspace-invoice-updates.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-autosave-audit-"));
}

test("SQLite mode never schedules broad workspace autosave for converted workflow state changes", () => {
  const convertedWorkflowStates = [
    { label: "customers/sites/assets/access-notes", state: { customers: [{ id: "customer-1" }] } },
    { label: "jobs/notes/photos/scheduling/status", state: { jobs: [{ id: "job-1", status: "In Progress" }] } },
    { label: "quotes/invoices/payments/sent-history", state: { jobs: [{ id: "job-1", invoice: { payments: [{ id: "payment-1" }] } }] } },
    { label: "maintenance plans", state: { maintenancePlans: [{ id: "maintenance-1" }] } },
    { label: "inventory", state: { inventoryItems: [{ id: "inventory-1" }] } },
    { label: "staff", state: { staff: [{ id: "staff-1" }] } },
    { label: "business settings and templates", state: { settings: { companyName: "Synthetic Co" } } },
    { label: "ServiceM8 imports", state: { customers: [{ id: "servicem8-customer-1" }], jobs: [{ id: "servicem8-job-1" }] } },
    { label: "workspace restoration", state: { customers: [{ id: "restored-customer-1" }] } },
  ];

  for (const workflow of convertedWorkflowStates) {
    const serializedState = JSON.stringify(workflow.state);
    assert.equal(
      shouldAttemptBroadWorkspaceAutosave({
        authStatus: "authenticated",
        hasLoadedServerState: true,
        workspaceStorageMode: "sqlite",
        serializedState,
        lastSyncedState: "{}",
      }),
      false,
      workflow.label
    );
  }
});

test("applying authorised server state does not schedule a recursive broad save", () => {
  const returnedServerState = {
    customers: [{ id: "customer-1", name: "Synthetic Customer" }],
    jobs: [{ id: "job-1", status: "To Do" }],
  };
  const serializedState = JSON.stringify(returnedServerState);

  assert.equal(
    shouldAttemptBroadWorkspaceAutosave({
      authStatus: "authenticated",
      hasLoadedServerState: true,
      workspaceStorageMode: "json",
      serializedState,
      lastSyncedState: serializedState,
    }),
    false
  );
});

test("record-specific request failures do not enable a broad autosave fallback", () => {
  const visibleStateAfterFailure = JSON.stringify({
    customers: [{ id: "customer-1", name: "Still Server State" }],
  });

  assert.equal(
    shouldAttemptBroadWorkspaceAutosave({
      authStatus: "authenticated",
      hasLoadedServerState: true,
      workspaceStorageMode: "sqlite",
      serializedState: visibleStateAfterFailure,
      lastSyncedState: JSON.stringify({ customers: [] }),
    }),
    false
  );
});

test("JSON mode keeps the existing broad save path for changed workspace state", () => {
  assert.equal(
    shouldAttemptBroadWorkspaceAutosave({
      authStatus: "authenticated",
      hasLoadedServerState: true,
      workspaceStorageMode: "json",
      serializedState: JSON.stringify({ customers: [{ id: "customer-1" }] }),
      lastSyncedState: JSON.stringify({ customers: [] }),
    }),
    true
  );
});

test("application startup and ordinary navigation do not broad-save before loaded state changes", () => {
  assert.equal(
    shouldAttemptBroadWorkspaceAutosave({
      authStatus: "checking",
      hasLoadedServerState: false,
      workspaceStorageMode: "json",
      serializedState: JSON.stringify({}),
      lastSyncedState: "",
    }),
    false
  );
  assert.equal(
    shouldAttemptBroadWorkspaceAutosave({
      authStatus: "authenticated",
      hasLoadedServerState: true,
      workspaceStorageMode: "json",
      serializedState: JSON.stringify({ customers: [] }),
      lastSyncedState: JSON.stringify({ customers: [] }),
    }),
    false
  );
});

test("SQLite mode does not locally prune recycle-bin records through autosave", () => {
  assert.equal(shouldRunRecycleBinClientPrune({ authStatus: "authenticated", workspaceStorageMode: "sqlite" }), false);
  assert.equal(shouldRunRecycleBinClientPrune({ authStatus: "authenticated", workspaceStorageMode: "json" }), true);
  assert.equal(shouldRunRecycleBinClientPrune({ authStatus: "logged_out", workspaceStorageMode: "json" }), false);
});

test("server broad workspace writes remain rejected in SQLite mode", () => {
  const tempDir = makeTempDir();
  try {
    assert.throws(
      () => saveAuthorizedWorkspaceState(
        { role: "admin" },
        { customers: [{ id: "customer-1", name: "Synthetic Customer" }] },
        {
          env: {
            ELSET_DATA_DIR: tempDir,
            ELSET_WORKSPACE_STORAGE: "sqlite",
          },
        }
      ),
      /Broad workspace saves are disabled in SQLite mode/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("unsupported SQLite invoice mutations are identifiable before local state changes", () => {
  assert.deepEqual(
    getSupportedInvoiceUpdateKeys({
      dueDate: "2026-04-01",
      notes: "Synthetic invoice note",
    }),
    ["dueDate", "notes"]
  );
  assert.deepEqual(
    getSupportedInvoiceUpdateKeys({
      status: "paid",
      total: 123,
      sentHistory: [],
    }),
    []
  );
});
