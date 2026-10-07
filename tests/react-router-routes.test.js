import assert from "node:assert/strict";
import test from "node:test";
import { matchRoutes } from "react-router";
import { workspaceRoutes } from "../src/routes.js";
import { recordLinkState } from "../src/lib/record-link-state.js";

const cases = [
  ["/", "home"], ["/customers", "customers"], ["/customers/new", "create-customer"],
  ["/customers/customer%20one", "customer-details", { customerId: "customer one" }],
  ["/customers/c/edit", "edit-customer"], ["/customers/c/sites/new", "legacy-create-site"],
  ["/sites", "sites"], ["/sites/new", "create-site"], ["/sites/new?customerId=c", "create-site"],
  ["/customers/c/sites/10%20Road%2FUnit%202", "site-details", { customerId: "c", siteId: "10 Road/Unit 2" }],
  ["/customers/c/sites/s/edit", "edit-site"], ["/jobs/new", "create-job"],
  ["/jobs/j", "job-details", { jobId: "j" }], ["/jobs/j/quote", "quote"], ["/jobs/j/invoice", "invoice"],
  ["/maintenance", "maintenance"], ["/maintenance/new", "create-maintenance"],
  ["/maintenance/p", "maintenance-details", { planId: "p" }], ["/maintenance/p/edit", "edit-maintenance"],
  ["/invoices", "invoices"], ["/invoices?customerId=c", "invoices"], ["/map", "map"], ["/settings", "settings"],
  ["/map/legacy", "fallback"], ["/map/google-test", "fallback"], ["/jobs/j/unsupported", "fallback"],
];
for (const [url, id, params] of cases) test(`React Router matches ${url}`, () => {
  const match = matchRoutes(workspaceRoutes, url).at(-1);
  assert.equal(match.route.id, id);
  if (params) assert.deepEqual(match.params, params);
});

test("record return state retains invoice queries and the source section", () => {
  const location = { pathname: "/invoices", search: "?customerId=one%2Ftwo", state: null };
  const matched = matchRoutes(workspaceRoutes, location).at(-1);
  assert.deepEqual(recordLinkState(location, { ...matched, handle: matched.route.handle }), {
    sourceSection: "invoices", returnTo: { path: "/invoices?customerId=one%2Ftwo", label: "Invoices" },
  });
});

test("Site creation has one page route and the Sites list has its own return destination", () => {
  const location = { pathname: "/sites", search: "", state: null };
  const matched = matchRoutes(workspaceRoutes, location).at(-1);
  assert.deepEqual(recordLinkState(location, { ...matched, handle: matched.route.handle }), {
    sourceSection: "sites", returnTo: { path: "/sites", label: "Sites" },
  });
  const createRoute = matchRoutes(workspaceRoutes, "/sites/new?customerId=one%2Ftwo").at(-1);
  assert.equal(createRoute.route.handle.record, true);
  assert.equal(workspaceRoutes.flatMap((route) => route.children || []).filter((route) => route.id === "create-site").length, 1);
});

test("nested document links return to the Job while retaining its Map origin", () => {
  const location = { pathname: "/jobs/job-one", search: "", state: { sourceSection: "map" } };
  const matched = matchRoutes(workspaceRoutes, location).at(-1);
  assert.deepEqual(recordLinkState(location, { ...matched, handle: matched.route.handle }, [{ id: "job-one", jobNumber: 123 }]), {
    sourceSection: "map", returnTo: { path: "/jobs/job-one", label: "Job #123" },
  });
});
