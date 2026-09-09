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
