// Synthetic, temporary SQLite data only. Run before/after changes with the same fixture.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import express from "express";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { getAuthorizedWorkspaceState } from "../server-workspace-storage.js";
import { updateJobDetails } from "../server-workspace-jobs.js";
import { updateCustomer } from "../server-workspace-customers.js";
import { replaceInvoiceForJob } from "../server-workspace-documents.js";
import { createJobRouter } from "../server-job-routes.js";
import { createCustomerRouter } from "../server-customer-routes.js";
import { createDocumentRouter } from "../server-document-routes.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
const clone = (record, suffix) => JSON.parse(JSON.stringify(record), (key, value) => key === "id" ? `${value}-${suffix}` : value);
const sourceJob = fixture.jobs.find(job => job.invoice);
const sourceCustomer = fixture.customers.find(customer => customer.id === sourceJob.customerId);
fixture.customers = Array.from({ length: 500 }, (_, i) => clone(sourceCustomer, i));
fixture.jobs = Array.from({ length: 2000 }, (_, i) => ({ ...clone(sourceJob, i), jobNumber: i + 1, customerId: fixture.customers[i % 500].id, maintenancePlanId: "" }));
fixture.maintenancePlans = [];
fixture.deletedJobs = []; fixture.deletedCustomers = []; fixture.deletedInvoices = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-mutation-benchmark-"));
const env = { ELSET_DATA_DIR: dir };
const db = openWorkspaceDb({ dbPath: path.join(dir, "elset-workspace.db") });
let server;
try {
  importWorkspaceJsonData(db, fixture);
  const app = express(); app.use(express.json());
  const options = { env, requireAuth: (req, res, next) => { req.user = { id: "benchmark", role: "admin" }; next(); } };
  for (const router of [createJobRouter, createCustomerRouter, createDocumentRouter]) app.use(router(options));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const job = fixture.jobs[0], customer = fixture.customers[0];
  const cases = [
    // Different direct/HTTP values ensure every measured save really changes data,
    // including all four job snapshots affected by the customer rename.
    { name: "job", path: `/api/jobs/${job.id}`, method: "PATCH", body: { title: "Benchmark saved title" }, mutate: () => updateJobDetails(db, job.id, { title: "Benchmark database title" }) },
    { name: "invoice", path: `/api/jobs/${job.id}/invoice`, method: "PUT", body: { invoice: { ...job.invoice, notes: "HTTP timing" } }, mutate: () => replaceInvoiceForJob(db, job.id, { ...job.invoice, notes: "Database timing" }) },
    { name: "customer", path: `/api/customers/${customer.id}`, method: "PATCH", body: { name: "Benchmark customer" }, mutate: () => updateCustomer(db, customer.id, { name: "Benchmark database customer" }) },
  ];
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const report = { fixture: { customers: 500, jobs: 2000, invoices: 2000 }, samples: 7, cases: [] };
  for (const entry of cases) {
    const samples = [];
    for (let i = 0; i < 8; i++) {
      let start = performance.now(); const result = entry.mutate(); const mutationMs = performance.now() - start;
      start = performance.now(); const state = getAuthorizedWorkspaceState({ role: "admin" }, { env }); const fullStateMs = performance.now() - start;
      start = performance.now(); const legacyJson = JSON.stringify({ ok: true, result, state }); const fullSerializeMs = performance.now() - start;
      start = performance.now();
      const response = await fetch(`http://127.0.0.1:${server.address().port}${entry.path}`, { method: entry.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry.body) });
      const responseText = await response.text(); const requestMs = performance.now() - start;
      if (!response.ok) throw new Error(responseText);
      const payload = JSON.parse(responseText);
      start = performance.now(); JSON.stringify(payload); const responseSerializeMs = performance.now() - start;
      if (i) samples.push({ mutationMs, fullStateMs, fullSerializeMs, requestMs, responseSerializeMs, legacyBytes: Buffer.byteLength(legacyJson), responseBytes: Buffer.byteLength(responseText) });
    }
    report.cases.push({ name: entry.name, ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, Number(median(samples.map(sample => sample[key])).toFixed(3))])) });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
