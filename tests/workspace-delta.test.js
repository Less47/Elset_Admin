import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import Database from "better-sqlite3";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb, getJobById, getCustomerById, getMaintenancePlanById } from "../server-workspace-state.js";
import { createJobRouter } from "../server-job-routes.js";
import { createCustomerRouter } from "../server-customer-routes.js";
import { createDocumentRouter } from "../server-document-routes.js";
import { applyWorkspaceDelta } from "../src/hooks/workspace-delta.js";
import { requestWorkspaceUpdate } from "../src/hooks/workspace-customer-api.js";
import { getAuthorizedWorkspaceState } from "../server-workspace-storage.js";

test("ordinary job, invoice, customer and shared contact routes never read the full workspace", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-delta-"));
  const env = { ELSET_DATA_DIR: dir };
  const db = openWorkspaceDb({ dbPath: path.join(dir, "elset-workspace.db") });
  const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
  fixture.customers.push({ id: "unrelated", name: "Unrelated", sites: [{ id: "other-site", address: "Other street" }] });
  fixture.customers.push({ id: "third", name: "Third account", sites: [] });
  fixture.jobs.push({ ...fixture.jobs[0], id: "unrelated-job", jobNumber: 2000, customerId: "unrelated", notes: [], photos: [], quote: null, invoice: null });
  importWorkspaceJsonData(db, fixture);
  const app = express(); app.use(express.json());
  let workerWakes = 0;
  app.locals.accountingInboxWorker = { wake: () => { workerWakes++; } };
  const options = { env, requireAuth: (req, _res, next) => { req.user = { role: "admin" }; next(); } };
  for (const router of [createJobRouter, createCustomerRouter, createDocumentRouter]) app.use(router(options));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const prepare = Database.prototype.prepare;
  let guard = false, checkedQueries = 0;
  Database.prototype.prepare = function (sql) {
    if (guard) {
      checkedQueries++;
      assert.doesNotMatch(sql, /SELECT \* FROM (?:staff|customers|jobs|maintenance_plans|inventory_items|deleted_records|deleted_invoices)(?: ORDER BY[^;]*)?$/i, "full collection query during mutation");
    }
    return prepare.call(this, sql);
  };
  t.after(() => { Database.prototype.prepare = prepare; });
  guard = true;
  assert.throws(() => loadWorkspaceStateFromDb(db), /full collection query/, "the sentinel detects a full state load");
  guard = false;
  let client = getAuthorizedWorkspaceState({ role: "admin" }, { env });
  const request = async (url, method, body) => {
    guard = true;
    let response, payload;
    try {
      response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      payload = await response.json();
    } finally { guard = false; }
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.state, undefined);
    assert.ok(payload.delta);
    assert.ok(JSON.stringify(payload).length < 16000);
    client = applyWorkspaceDelta(client, payload.delta);
    const fresh = getAuthorizedWorkspaceState({ role: "admin" }, { env });
    for (const key of Object.keys(fresh)) {
      const sort = value => Array.isArray(value) ? [...value].sort((a, b) => a.id.localeCompare(b.id)) : value;
      assert.deepEqual(sort(client[key]), sort(fresh[key]), key);
    }
    return payload;
  };
  const job = await request("/api/jobs/demo-job-1001", "PATCH", { title: "Only this job" });
  assert.deepEqual(Object.keys(job.delta), ["jobs"]);
  assert.deepEqual(job.delta.jobs.upsert.map(record => record.id), ["demo-job-1001"]);
  const invoice = await request("/api/jobs/demo-job-1001/invoice", "PATCH", { notes: "Only this invoice" });
  assert.deepEqual(Object.keys(invoice.delta), ["jobs"]);
  await request("/api/jobs/demo-job-1001/invoice/payments", "POST", { id: "delta-payment", amount: 10, date: "2026-10-01" });
  await request("/api/jobs/demo-job-1001/invoice/payments/delta-payment", "PATCH", { amount: 12 });
  await request("/api/jobs/demo-job-1001/invoice/payments/delta-payment", "DELETE");
  assert.equal(workerWakes, 3, "payment mutations still wake the accounting inbox worker");
  const customer = await request("/api/customers/demo-customer-arcadia", "PATCH", { name: "Changed customer" });
  assert.ok(!customer.delta.customers.upsert.some(record => record.id === "unrelated"));
  assert.ok(!customer.delta.jobs.upsert.some(record => record.id === "unrelated-job"));
  await request("/api/contacts", "POST", { id: "shared", name: "Shared person" });
  await request("/api/customers/demo-customer-arcadia/contacts/shared", "PUT", { isBilling: true });
  await request("/api/customers/unrelated/sites/other-site/contacts/shared", "PUT", { isPrimary: true });
  await request("/api/contacts", "POST", { id: "indirect", name: "Another person" });
  await request("/api/customers/unrelated/contacts/indirect", "PUT", {});
  await request("/api/customers/third/contacts/indirect", "PUT", {});
  const contact = await request("/api/contacts/shared", "PATCH", { name: "Authoritative contact" });
  assert.deepEqual(contact.delta.customers.upsert.map(record => record.id).sort(), ["demo-customer-arcadia", "unrelated"]);
  assert.deepEqual(Object.keys(contact.delta).sort(), ["contacts", "customers"]);
  assert.deepEqual(contact.delta.contacts.upsert.map(record => record.id), ["shared"], "do not expand through unrelated shared contacts");
  const account = await request("/api/customers/demo-customer-arcadia", "PATCH", { phone: "0400123456" });
  assert.ok(!account.delta.jobs.upsert.some(record => record.id === "unrelated-job"), "a shared contact must not pull in another customer's jobs");
  await request("/api/customers/demo-customer-arcadia/contacts/shared", "DELETE");
  await request("/api/customers/unrelated/sites/other-site/contacts/shared", "DELETE");
  const deleted = await request("/api/contacts/shared", "DELETE");
  assert.deepEqual(deleted.delta.contacts.removeIds, ["shared"]);
  assert.ok(checkedQueries > 50);

  const full = loadWorkspaceStateFromDb(db);
  assert.deepEqual(getJobById(db, full.jobs[0].id), full.jobs[0]);
  assert.deepEqual(getCustomerById(db, full.customers[0].id), full.customers[0]);
  for (const plan of full.maintenancePlans) assert.deepEqual(getMaintenancePlanById(db, plan.id), plan);
});

test("functional deltas preserve unrelated records, replace authoritative fields and handle archives", () => {
  const a = { id: "a", title: "Old", obsolete: true }, b = { id: "b", title: "Other" };
  const original = { jobs: [a, b], customers: [{ id: "c" }], deletedJobs: [], maintenancePlans: [] };
  const newer = applyWorkspaceDelta(original, { jobs: { upsert: [{ id: "b", title: "Other saved first" }] } });
  const saved = applyWorkspaceDelta(newer, { jobs: { upsert: [{ id: "a", title: "Server title" }] } });
  assert.equal(saved.jobs.find(job => job.id === "b"), newer.jobs.find(job => job.id === "b"));
  assert.equal(saved.customers, original.customers);
  assert.equal(saved.jobs.find(job => job.id === "a").obsolete, undefined);
  const archived = applyWorkspaceDelta(saved, { jobs: { removeIds: ["a"] }, deletedJobs: { upsert: [{ job: saved.jobs[0], deletedAt: "today" }] } });
  const restored = applyWorkspaceDelta(archived, { jobs: { upsert: [{ id: "a", title: "Restored" }] }, deletedJobs: { removeIds: ["a"] }, maintenancePlans: { upsert: [{ id: "plan", lastGeneratedJobId: "a" }] } });
  assert.equal(restored.jobs.length, 2);
  assert.equal(restored.deletedJobs.length, 0);
  assert.equal(restored.maintenancePlans[0].lastGeneratedJobId, "a");
  assert.equal(original.jobs[0], a);
});

test("successful deltas do not resync; uncertain writes can recover without repeating the mutation", async () => {
  for (const failure of ["network", "server", "malformed", "validation", "success"]) {
    const calls = [], recoveries = [];
    const authoritative = { jobs: [{ id: "saved" }] };
    const fetchWithAuth = async (url, options) => {
      calls.push([url, options.method]);
      if (url === "/api/app-state") return { ok: true, json: async () => ({ state: authoritative }) };
      if (failure === "network") throw new Error("Acknowledgement lost");
      return { ok: failure === "success" || failure === "malformed", status: failure === "validation" ? 400 : failure === "server" ? 503 : 200,
        json: async () => failure === "success" ? { ok: true, result: { id: "saved" }, delta: { jobs: { upsert: authoritative.jobs } } } : { error: "Save failed" } };
    };
    const operation = requestWorkspaceUpdate({ fetchWithAuth, path: "/api/jobs/saved", method: "PATCH", body: { title: "Saved" }, onRecovery: state => recoveries.push(state) });
    if (failure === "success") assert.ok((await operation).delta);
    else await assert.rejects(operation);
    const uncertain = ["network", "server", "malformed"].includes(failure);
    assert.equal(calls.length, uncertain ? 2 : 1);
    assert.deepEqual(recoveries, uncertain ? [authoritative] : []);
    if (uncertain) assert.deepEqual(calls[1], ["/api/app-state", "GET"]);
  }
});
