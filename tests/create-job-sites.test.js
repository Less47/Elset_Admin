import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { openWorkspaceDb, WORKSPACE_SCHEMA_VERSION } from "../server-workspace-db.js";
import { createCustomer } from "../server-workspace-customers.js";
import { createJob, updateJobDetails } from "../server-workspace-jobs.js";
import { getCustomerById } from "../server-workspace-state.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { buildCreateJobSiteOptions, findJobsWithoutOwnedSite } from "../src/lib/create-job-sites.js";
import { auditJobSiteOwnership } from "../scripts/audit-job-site-ownership.mjs";

function setup(t) {
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  t.after(() => db.close());
  createCustomer(db, { id: "a", name: "Customer A", address: "1 Primary St", sites: [{ id: "saved", address: "2 Saved St" }] });
  createCustomer(db, { id: "b", name: "Customer B", sites: [{ id: "foreign", address: "3 Other St" }, { id: "foreign-same", address: "4 Historical St" }] });
  return db;
}

const jobInput = (address, extra = {}) => ({ customer: { id: "a" }, job: { title: "Ownership regression", jobAddress: address }, ...extra });

test("Create Job distinguishes persisted rows from inferred profiles and previous job addresses", () => {
  const customer = { id: "a", address: "1 Primary St", sites: [
    { id: "saved", address: "2 Saved St", contactAssignments: [{ contactId: "person", isPrimary: true }] },
    { id: "generated-primary", address: "1 Primary St", _inferredProfile: true },
    { id: "generated-legacy", address: "4 Historical St", _inferredProfile: true },
    { address: "5 Unsaved St" },
  ] };
  const jobs = [" 4  Historical ST ", "4 historical st", "2 SAVED st", "1 Primary St"].map((jobAddress) => ({ customerId: "a", jobAddress }));
  jobs.push({ customerId: "b", jobAddress: "Foreign history" });
  const before = structuredClone({ customer, jobs });
  const options = buildCreateJobSiteOptions(customer, jobs);
  assert.deepEqual(options.savedSites, [customer.sites[0]]);
  assert.equal(options.primarySite.address, customer.address);
  assert.deepEqual(options.previousJobAddresses, ["4 Historical ST"]);
  assert.deepEqual({ customer, jobs }, before);
  customer.sites.push({ id: "persisted-primary", address: customer.address });
  assert.equal(buildCreateJobSiteOptions(customer).primarySite, null);
});

test("saved sites and the primary address work with exact case/whitespace normalization and preserve schema", (t) => {
  const db = setup(t);
  // A primary address is explicitly allowed even without a sites row.
  db.prepare("DELETE FROM sites WHERE customer_id='a' AND address='1 Primary St'").run();
  const schema = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
  const migrations = db.prepare("SELECT * FROM workspace_schema_migrations ORDER BY version").all();
  const sites = db.prepare("SELECT * FROM sites ORDER BY id").all();
  for (const address of [" 2  SAVED St ", "1 Primary St"]) {
    const job = createJob(db, jobInput(address));
    assert.equal(job.customerId, "a");
  }
  assert.equal(WORKSPACE_SCHEMA_VERSION, 18);
  assert.deepEqual(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), schema);
  assert.deepEqual(db.prepare("SELECT * FROM workspace_schema_migrations ORDER BY version").all(), migrations);
  assert.deepEqual(db.prepare("SELECT * FROM sites ORDER BY id").all(), sites);
});

test("historical-only and foreign sites cannot bypass ownership, even for customers without site rows", (t) => {
  const db = setup(t);
  const historical = createJob(db, jobInput("2 Saved St"));
  updateJobDetails(db, historical.id, { jobAddress: "4 Historical St" });
  const before = db.prepare("SELECT * FROM jobs ORDER BY id").all();
  for (const address of ["4 Historical St", "3 Other St", "Unit 2, 15 Smith Street"]) {
    assert.throws(() => createJob(db, jobInput(address)), /Selected site does not belong/);
  }
  // Client-supplied customer.sites and foreign IDs do not grant ownership.
  assert.throws(() => createJob(db, jobInput("4 Historical St", { customer: { id: "a", sites: [{ id: "foreign-same", address: "4 Historical St" }] } })), /Selected site does not belong/);
  assert.throws(() => createJob(db, jobInput("3 Other St", { siteInput: { id: "foreign", address: "3 Other St" } })), /another customer/);
  db.prepare("DELETE FROM sites WHERE customer_id='a'").run();
  assert.throws(() => createJob(db, jobInput("4 Historical St")), /Selected site does not belong/);
  assert.deepEqual(db.prepare("SELECT * FROM jobs ORDER BY id").all(), before);
  assert.equal(createJob(db, jobInput("1 Primary St")).jobAddress, "1 Primary St");
});

test("explicit Add as Site persists the site before the job and rolls both back on a mismatched address", (t) => {
  const db = setup(t);
  assert.throws(() => createJob(db, jobInput("4 Historical St", { siteInput: { id: "wrong", address: "5 Wrong St" } })), /Selected site does not belong/);
  assert.equal(db.prepare("SELECT id FROM sites WHERE id='wrong'").get(), undefined);
  const created = createJob(db, jobInput("4 Historical St", { siteInput: { id: "added", address: "4 Historical St" } }));
  assert.equal(created.jobAddress, "4 Historical St");
  assert.equal(db.prepare("SELECT customer_id FROM sites WHERE id='added'").get().customer_id, "a");
  assert.equal(db.prepare("SELECT customer_id FROM sites WHERE id='foreign-same'").get().customer_id, "b");
  assert.ok(buildCreateJobSiteOptions(getCustomerById(db, "a")).savedSites.some((site) => site.id === "added"));
  assert.equal(createJob(db, jobInput("4 Historical St")).jobAddress, "4 Historical St");
});

test("read-only diagnostic detects four unowned job addresses without fuzzy matching or data changes", (t) => {
  const db = setup(t);
  const addresses = ["2 SAVED St", "1  Primary St", "4 Historical St", "3 Other St", "2/15 Smith St", "Unit 2, 15 Smith Street"];
  createJob(db, jobInput("2/15 Smith St", { siteInput: { id: "unit", address: "2/15 Smith St" } }));
  for (const address of addresses) {
    const job = createJob(db, jobInput("2 Saved St"));
    updateJobDetails(db, job.id, { jobAddress: address });
  }
  const blank = createJob(db, jobInput("2 Saved St"));
  db.prepare("UPDATE jobs SET job_address='' WHERE id=?").run(blank.id);
  const before = db.serialize();
  const report = auditJobSiteOwnership(db);
  assert.equal(report.jobsChecked, 8);
  assert.equal(report.unmatchedJobCount, 4);
  assert.deepEqual(report.unmatchedJobs.map((job) => job.jobAddress).sort(), ["", "3 Other St", "4 Historical St", "Unit 2, 15 Smith Street"]);
  assert.deepEqual(db.serialize(), before);
  assert.throws(() => createJob(db, jobInput("Unit 2, 15 Smith Street")), /Selected site does not belong/);
});

test("demo fixture ownership diagnostic reports its baseline without mutation", (t) => {
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  t.after(() => db.close());
  const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
  importWorkspaceJsonData(db, fixture);
  const report = auditJobSiteOwnership(db);
  t.diagnostic(`Demo fixture: ${report.unmatchedJobCount} unmatched of ${report.jobsChecked} jobs.`);
  assert.deepEqual(report.unmatchedJobs, findJobsWithoutOwnedSite(fixture.customers, fixture.jobs));
  assert.equal(report.unmatchedJobCount, 0);
});
