import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspacePath } from "../src/hooks/useWorkspaceNavigation.js";

test("document workspace routes identify the job and type and retain their navigation origin", () => {
  for (const documentType of ["quote", "invoice"]) {
    const route = parseWorkspacePath(`/jobs/job%20with%20spaces/${documentType}`, { sourceSection: "invoices", returnPath: "/", historyIndex: 4 });
    assert.equal(route.type, "document");
    assert.equal(route.jobId, "job with spaces");
    assert.equal(route.documentType, documentType);
    assert.equal(route.returnPath, "/");
    assert.equal(route.sourceSection, "invoices");
    assert.equal(route.historyIndex, 4);
  }
});

test("document routes coexist with Create Job, Job Details and section history", () => {
  assert.equal(parseWorkspacePath("/jobs/new").type, "create-job");
  assert.equal(parseWorkspacePath("/jobs/example").type, "job-details");
  assert.equal(parseWorkspacePath("/jobs/example/unsupported").type, "section");
  assert.equal(parseWorkspacePath("/", { section: "invoices" }).section, "invoices");
  assert.equal(parseWorkspacePath("/jobs/example/invoice").returnPath, null);
});

test("customer and site workspaces resolve directly without modal selection state", () => {
  assert.equal(parseWorkspacePath("/customers").section, "customers");
  assert.equal(parseWorkspacePath("/customers/new").type, "create-customer");
  const customer = parseWorkspacePath("/customers/customer%20one", { returnPath: "/jobs/example", tab: "contacts", historyIndex: 3 });
  assert.equal(customer.type, "customer-details");
  assert.equal(customer.customerId, "customer one");
  assert.equal(customer.returnPath, "/jobs/example");
  assert.equal(customer.tab, "contacts");
  assert.equal(customer.historyIndex, 3);
  assert.equal(parseWorkspacePath("/customers/customer-one/edit").type, "edit-customer");
  assert.equal(parseWorkspacePath("/customers/customer-one/sites/new").type, "create-site");
  for (const [suffix, type] of [["", "site-details"], ["/edit", "edit-site"]]) {
    const site = parseWorkspacePath(`/customers/customer-one/sites/10%20Road%2FUnit%202${suffix}`);
    assert.equal(site.type, type);
    assert.equal(site.siteKey, "10 Road/Unit 2");
    assert.equal(site.customerId, "customer-one");
    assert.equal(site.sourceSection, "customers");
  }
  assert.doesNotThrow(() => parseWorkspacePath("/customers/%invalid"));
});
