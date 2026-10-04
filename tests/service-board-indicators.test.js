import assert from "node:assert/strict";
import test from "node:test";
import { activeAccountingProvider } from "../src/lib/addons.js";
import { normalizeStoredData } from "../server-store.js";
import { buildJobCardIndicators, getServiceBoardIndicatorLegend } from "../src/components/service-board/service-board-utils.js";

const warning = "quickbooks-unsynced";
const invoice = { items: [{ qty: 1, rate: 100 }], paymentManagement: "manual", sentHistory: [], payments: [] };
const job = { status: "To Do", invoice };
const indicators = (record, provider = "quickbooks", status = { id: "draft", label: "Draft Invoice" }) =>
  buildJobCardIndicators({ job: record, accountingProvider: provider, invoiceStatus: status });

for (const [name, record, provider, shown] of [
  ["no invoice", { ...job, invoice: null }, "quickbooks", false],
  ["completed but never invoiced", { status: "Completed" }, "quickbooks", false],
  ["quote only", { quote: { sentHistory: [{ sentAt: "2026-10-05" }] } }, "quickbooks", false],
  ["manual saved invoice", job, "quickbooks", true],
  ["legacy invoice without ownership", { ...job, invoice: { items: [] } }, "quickbooks", true],
  ["QuickBooks mapped invoice", { ...job, invoice: { ...invoice, paymentManagement: "quickbooks" } }, "quickbooks", false],
  ["Xero active", job, "xero", false],
  ["accounting disabled", job, "", false],
  ["Xero mapped invoice after provider switch", { ...job, invoice: { ...invoice, paymentManagement: "xero" } }, "quickbooks", false],
]) test(`QuickBooks Service Board warning: ${name}`, () => {
  const before = structuredClone(record);
  assert.equal(indicators(record, provider).some((entry) => entry.id === warning), shown);
  assert.deepEqual(record, before, "building presentation indicators must not persist or mutate sync state");
});

for (const [id, label, existing] of [["paid", "Paid", "invoice-paid"], ["outstanding", "Outstanding", "invoice-pending"], ["overdue", "Overdue", "invoice-attention"]]) {
  test(`QuickBooks warning coexists with ${label}, quote and maintenance indicators`, () => {
    const record = { ...job, maintenancePlanName: "Quarterly service", quote: { sentHistory: [{}] } };
    assert.deepEqual(indicators(record, "quickbooks", { id, label }).map((entry) => entry.id), ["quote", existing, warning, "maintenance"]);
  });
}

test("mapping alone controls warning across job, email, payment and later sync states", () => {
  for (const paymentManagement of ["manual", "quickbooks"]) {
    for (const status of ["To Do", "In Progress", "Completed"]) {
      for (const syncStatus of ["PENDING", "RETRYABLE", "CONFLICT", "REVIEW_REQUIRED", "SYNCED"]) {
        const record = { ...job, status, invoice: { ...invoice, paymentManagement, sentHistory: [{}], payments: [{ amount: 110 }], paymentSync: { status: syncStatus }, syncStatus } };
        assert.equal(indicators(record, "quickbooks", { id: "paid", label: "Paid" }).some((entry) => entry.id === warning), paymentManagement === "manual");
      }
    }
  }
});

test("active provider helper controls both cards and the shared legend", () => {
  for (const addons of [{}, { quickbooks: false }, { xero: true }, { quickbooks: true }, { quickbooks: true, xero: true }]) {
    const provider = activeAccountingProvider(addons);
    assert.equal(indicators(job, provider).some((entry) => entry.id === warning), provider === "quickbooks");
    assert.equal(getServiceBoardIndicatorLegend(provider).some((entry) => entry.id === warning), provider === "quickbooks");
  }
  const entry = getServiceBoardIndicatorLegend("quickbooks").find((item) => item.id === warning);
  assert.equal(entry.label, "Not in QuickBooks");
  assert.equal(entry.type, "quickbooks-warning");
  assert.equal(entry.dotClassName, undefined, "warning must have its own visual identity");
  assert.deepEqual(indicators(job).find((item) => item.id === warning), entry);
});

test("app-state normalization preserves projected mapping ownership without adding sync booleans", () => {
  for (const owner of ["manual", "quickbooks", "xero"]) {
    const normalized = normalizeStoredData({ jobs: [{ ...job, id: "indicator-job", invoice: { ...invoice, paymentManagement: owner } }] });
    const record = normalized.jobs[0];
    assert.equal(record.invoice.paymentManagement, owner);
    assert.equal(indicators(record).some((entry) => entry.id === warning), owner === "manual");
    assert.deepEqual(Object.keys(record.invoice).sort(), ["dueDate", "issueDate", "items", "notes", "paymentManagement", "paymentNotes", "payments", "sentHistory", "type"].sort());
  }
});
