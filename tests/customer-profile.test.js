import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { customerPostalFields, applyPrimarySiteUpdate } from "../src/lib/customer-profile.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { createCustomer, updateCustomer, updateCustomerSite } from "../server-workspace-customers.js";

test("postal addresses follow the main address by default and preserve separate PO Boxes", () => {
  assert.deepEqual(customerPostalFields({ address: "10 Main St" }), { postalAddressSameAsPrimary: true, postalAddress: "10 Main St" });
  assert.equal(customerPostalFields({ address: "20 Main St", postalAddress: "10 Main St", postalAddressSameAsPrimary: true }).postalAddress, "20 Main St");
  assert.deepEqual(customerPostalFields({ address: "10 Main St", postalAddress: "PO Box 20", postalAddressSameAsPrimary: false }), { postalAddressSameAsPrimary: false, postalAddress: "PO Box 20" });
  assert.equal(customerPostalFields({ address: "10 Main St", postalAddress: "PO Box 20" }).postalAddressSameAsPrimary, false);
});

test("editing a primary site preserves site data, clears stale coordinates and rejects stale or duplicate addresses", () => {
  const customer = { address: "10 Main St", sites: [
    { id: "primary", address: "10 Main St", latitude: -37, longitude: 145, suburb: "Old", assets: [{ id: "gate" }], notes: "Keep", contactId: "contact" },
    { id: "other", address: "20 Main St" },
  ] };
  const changed = applyPrimarySiteUpdate(customer, { id: "primary", expectedAddress: "10 Main St", address: "30 Main St", ocNumber: "PS123" });
  assert.equal(customer.address, "10 Main St");
  assert.deepEqual(changed.sites[0].assets, customer.sites[0].assets);
  assert.equal(changed.sites[0].contactId, "contact");
  assert.equal(changed.sites[0].latitude, null);
  assert.equal(changed.sites[0].suburb, "");
  assert.equal(changed.sites[1], customer.sites[1]);
  assert.throws(() => applyPrimarySiteUpdate(customer, { expectedAddress: "Old address", address: "30 Main St" }), /changed/);
  assert.throws(() => applyPrimarySiteUpdate(customer, { id: "other", address: "30 Main St" }), /changed/);
  assert.throws(() => applyPrimarySiteUpdate(customer, { address: "20 Main St" }), /already uses/);
  assert.throws(() => applyPrimarySiteUpdate(customer, { address: " " }), /required/);
});

test("customer and primary-site edits persist atomically with postal and linked records", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-customer-profile-"));
  const dbPath = path.join(directory, "workspace.db");
  let db = openWorkspaceDb({ dbPath });
  try {
    const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
    const source = fixture.customers[0], site = source.sites[0];
    fixture.maintenancePlans = [{ id: "profile-contract", customerId: source.id, siteId: site.id, siteAddress: site.address,
      planName: "Primary service", frequency: "quarterly", nextDueDate: "2026-10-01", active: true }];
    importWorkspaceJsonData(db, fixture);
    const before = loadWorkspaceStateFromDb(db);
    const updated = updateCustomer(db, source.id, { name: "Updated name", postalAddressSameAsPrimary: false, postalAddress: "PO Box 42",
      primarySite: { id: site.id, expectedAddress: source.address, address: "55 Updated Road", ocNumber: "PS123" } });
    assert.equal(updated.address, "55 Updated Road");
    assert.equal(updated.postalAddress, "PO Box 42");
    assert.equal(updated.primarySite, undefined);
    assert.deepEqual(updated.sites[0].assets, before.customers[0].sites[0].assets);
    const after = loadWorkspaceStateFromDb(db);
    assert.equal(after.maintenancePlans[0].siteAddress, "55 Updated Road");
    assert.equal(after.maintenancePlans[0].siteId, site.id);
    for (const job of before.jobs) {
      const saved = after.jobs.find((entry) => entry.id === job.id);
      assert.deepEqual(saved.invoice, job.invoice);
      if (job.customerId === source.id && job.jobAddress === source.address) assert.equal(saved.jobAddress, "55 Updated Road");
    }
    assert.throws(() => updateCustomer(db, source.id, { name: "Must not save", primarySite: { id: site.id, address: "" } }), /required/);
    assert.deepEqual(loadWorkspaceStateFromDb(db), after);
    updateCustomer(db, source.id, { postalAddressSameAsPrimary: true });
    updateCustomerSite(db, source.id, site.id, { address: "66 Updated Road" });
    const fresh = createCustomer(db, { name: "New customer", address: "1 Main Road" });
    assert.equal(fresh.postalAddress, "1 Main Road");
    db.close();
    db = openWorkspaceDb({ dbPath, migrate: false });
    const reloaded = loadWorkspaceStateFromDb(db).customers.find((entry) => entry.id === source.id);
    assert.equal(reloaded.postalAddressSameAsPrimary, true);
    assert.equal(reloaded.postalAddress, "66 Updated Road");
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
