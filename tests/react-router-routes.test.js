import assert from "node:assert/strict";
import test from "node:test";
import { matchRoutes } from "react-router";
import { workspaceRoutes } from "../src/routes.js";

const cases = [
  ["/", "home"], ["/customers", "customers"], ["/customers/new", "create-customer"],
  ["/customers/customer%20one", "customer-details", { customerId: "customer one" }],
  ["/customers/c/edit", "edit-customer"], ["/customers/c/sites/new", "create-site"],
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
