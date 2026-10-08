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

for (const status of ["To Do", "In Progress", "Completed"]) test(`${status}: missing and saved unsent invoices share one pre-send indicator without changing the document`, () => {
  for (const invoice of [null, { items: [{ qty: 1, rate: 100 }], sentHistory: [], dueDate: "2000-01-01" }]) {
    const record = { status, invoice }, before = structuredClone(record);
    assert.deepEqual(indicators(record, "", { id: invoice ? "draft" : "not-invoiced" }).map(entry => [entry.id, entry.label]), [["not-invoiced", "Not invoiced"]]);
    assert.deepEqual(record, before);
  }
});

test("Warranty cards omit the badge while preserving tags, classification and urgency", () => {
  const record = { billingType: "warranty", urgency: "High", quote: { sentHistory: [{}] }, maintenancePlanName: "Annual service" };
  const before = structuredClone(record);
  const entries = indicators(record);
  assert.deepEqual(entries, [
    { id: "quote", label: "Quoted", dotClassName: "bg-cyan-500" },
    { id: "maintenance", label: "Maintenance", dotClassName: "bg-orange-500" },
  ]);
  assert.equal(entries.some(entry => entry.id === "warranty" || entry.type === "warranty"), false);
  assert.deepEqual(record, before);
  assert.equal(getServiceBoardIndicatorLegend("quickbooks").some(entry => entry.id === "warranty"), false);
});

test("shared legend starts with Quote, omits Warranty and ends with the special QuickBooks warning", () => {
  const labels = ["Quote sent", "Not invoiced", "Outstanding invoice", "Invoice overdue", "Invoice paid", "Maintenance"];
  for (const provider of ["quickbooks", "xero", "", undefined]) {
    const legend = getServiceBoardIndicatorLegend(provider);
    assert.deepEqual(legend.map(entry => entry.label), provider === "quickbooks" ? [...labels, "Not in QuickBooks"] : labels);
    assert.equal(legend.some(entry => entry.id === "warranty"), false);
    if (provider === "quickbooks") assert.equal(legend.at(-1).type, "quickbooks-warning");
  }
});

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

for (const [id, label, existing] of [["paid", "Paid", "invoice-paid"], ["outstanding", "Outstanding", "invoice-pending"], ["overdue", "Overdue", "invoice-overdue"]]) {
  test(`QuickBooks warning coexists with ${label}, quote and maintenance indicators`, () => {
    const record = { ...job, invoice: { ...invoice, sentHistory: [{}] }, maintenancePlanName: "Quarterly service", quote: { sentHistory: [{}] } };
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
    assert.deepEqual(Object.keys(record.invoice).sort(), ["dueDate", "dueDateMode", "issueDate", "items", "notes", "paymentManagement", "paymentNotes", "payments", "sentHistory", "type"].sort());
  }
});
