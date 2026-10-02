import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findJobsWithoutOwnedSite } from "../src/lib/create-job-sites.js";

export function auditJobSiteOwnership(db) {
  const customers = db.prepare("SELECT id, address FROM customers ORDER BY id").all();
  const sites = db.prepare("SELECT id, customer_id AS customerId, address FROM sites ORDER BY id").all();
  const byCustomer = new Map(customers.map((customer) => [customer.id, { ...customer, sites: [] }]));
  for (const site of sites) byCustomer.get(site.customerId)?.sites.push(site);
  const jobs = db.prepare("SELECT id, customer_id AS customerId, job_address AS jobAddress FROM jobs ORDER BY id").all();
  const unmatchedJobs = findJobsWithoutOwnedSite([...byCustomer.values()], jobs);
  return { jobsChecked: jobs.length, unmatchedJobCount: unmatchedJobs.length, unmatchedJobs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--db") {
    throw new Error("Usage: node scripts/audit-job-site-ownership.mjs --db <workspace.db> (read-only; no migrations)");
  }
  const db = new Database(path.resolve(process.argv[3]), { readonly: true, fileMustExist: true });
  try { console.log(JSON.stringify(auditJobSiteOwnership(db), null, 2)); }
  finally { db.close(); }
}
