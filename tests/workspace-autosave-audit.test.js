import assert from "node:assert/strict";
import test from "node:test";
import { getSupportedInvoiceUpdateKeys } from "../src/hooks/workspace-invoice-updates.js";

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
