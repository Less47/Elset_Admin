import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openWorkspaceDb, WORKSPACE_SCHEMA_VERSION } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { createCustomer, createCustomerSite, updateCustomerSite } from "../server-workspace-customers.js";
import { createWorkspaceSqliteBackupBundle, materializeWorkspaceSqliteBackup } from "../server-workspace-backup.js";

function fixture() {
  const data = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
  const customer = data.customers[0], site = customer.sites[0], asset = site.assets[0];
  data.maintenancePlans = [{ id: "equipment-plan", customerId: customer.id, customerName: customer.name,
    siteId: site.id, siteAddress: site.address, assetId: asset.id, planName: "Equipment service",
    frequency: "yearly", nextDueDate: "2027-01-01", checklist: ["Inspect equipment"] }];
  return data;
}

function seed(db) {
  const data = fixture();
  importWorkspaceJsonData(db, data);
  db.prepare("UPDATE jobs SET extra_json = json_set(extra_json, '$.gateId', ?, '$.projectId', ?) WHERE id = ?")
    .run("legacy-gate-reference", "legacy-project-reference", data.jobs[0].id);
}

test("Site creation and field-only editing preserve equipment, Maintenance links and historical Job metadata", () => {
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  try {
    seed(db);
    const before = loadWorkspaceStateFromDb(db), customer = before.customers[0], site = customer.sites[0];
    const assets = db.prepare("SELECT * FROM site_assets ORDER BY id").all();
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) db.exec(`CREATE TRIGGER forbid_asset_${operation.toLowerCase()}
      BEFORE ${operation} ON site_assets BEGIN SELECT RAISE(ABORT, 'Site information must not write asset records'); END;`);
    const created = createCustomerSite(db, customer.id, { id: "site-without-assets", address: "25 Synthetic Site Street", notes: "Site-level notes" });
    assert.deepEqual(created.assets, []);
    const edited = updateCustomerSite(db, customer.id, site.id, { ocNumber: "SITE-EDIT", notes: "Edited Site information" });
    assert.equal(edited.ocNumber, "SITE-EDIT");
    assert.deepEqual(edited.assets, site.assets);
    assert.deepEqual(db.prepare("SELECT * FROM site_assets ORDER BY id").all(), assets);
    const after = loadWorkspaceStateFromDb(db);
    assert.deepEqual(after.maintenancePlans, before.maintenancePlans);
    assert.deepEqual(after.jobs, before.jobs);
    assert.equal(after.jobs[0].gateId, "legacy-gate-reference");
    assert.equal(after.jobs[0].projectId, "legacy-project-reference");
    assert.equal(db.pragma("user_version", { simple: true }), WORKSPACE_SCHEMA_VERSION);
  } finally { db.close(); }
});

test("SQLite backup and restore keep legacy equipment and Job references without a schema change", async () => {
  const tempBase = fs.realpathSync(os.tmpdir()), prefix = "elset-site-assets-preservation-";
  const root = fs.mkdtempSync(path.join(tempBase, prefix));
  const db = openWorkspaceDb({ dbPath: path.join(root, "elset-workspace.db") });
  try {
    seed(db);
    const before = loadWorkspaceStateFromDb(db);
    const bundle = await createWorkspaceSqliteBackupBundle({ env: { ELSET_DATA_DIR: root } });
    assert.equal(bundle.metadata.workspace.schemaVersion, WORKSPACE_SCHEMA_VERSION);
    const restored = materializeWorkspaceSqliteBackup(bundle, path.join(root, "restored"));
    const copy = openWorkspaceDb({ dbPath: restored.tempDbPath, readonly: true, migrate: false });
    try {
      const after = loadWorkspaceStateFromDb(copy);
      assert.deepEqual(after.customers, before.customers);
      assert.deepEqual(after.jobs, before.jobs);
      assert.deepEqual(after.maintenancePlans, before.maintenancePlans);
      assert.equal(copy.pragma("user_version", { simple: true }), WORKSPACE_SCHEMA_VERSION);
    } finally { copy.close(); }
  } finally {
    db.close();
    const target = path.resolve(root);
    assert.equal(path.dirname(target), tempBase);
    assert.ok(path.basename(target).startsWith(prefix));
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("separate Assets saves retain equipment identity and metadata, Maintenance links and other Sites", () => {
  const db = openWorkspaceDb({ dbPath: ":memory:" });
  try {
    seed(db);
    createCustomerSite(db, fixture().customers[0].id, { id: "other-equipment-site", address: "Other equipment address", assets: [{ id: "other-site-equipment", name: "Other Site motor" }] });
    const before = loadWorkspaceStateFromDb(db), customer = before.customers[0], site = customer.sites[0], asset = site.assets[0];
    db.prepare("UPDATE site_assets SET extra_json = json_set(extra_json, '$.serialNumber', ?) WHERE id = ?").run("LEGACY-SERIAL", asset.id);
    const otherAssets = db.prepare("SELECT * FROM site_assets WHERE site_id != ? ORDER BY id").all(site.id);
    const saved = updateCustomerSite(db, customer.id, site.id, { assets: [{ id: asset.id, name: "Updated equipment", notes: "Equipment-only edit" },
      { id: "new-equipment", name: "New motor" }] });
    const retained = saved.assets.find((entry) => entry.id === asset.id);
    assert.equal(retained.name, "Updated equipment");
    assert.equal(retained.serialNumber, "LEGACY-SERIAL");
    assert.equal(retained.createdAt, asset.createdAt);
    assert.equal(retained.model, asset.model);
    assert.equal(saved.address, site.address);
    assert.equal(saved.notes, site.notes);
    assert.deepEqual(db.prepare("SELECT * FROM site_assets WHERE site_id != ? ORDER BY id").all(site.id), otherAssets);
    assert.deepEqual(loadWorkspaceStateFromDb(db).maintenancePlans, before.maintenancePlans);
    assert.deepEqual(loadWorkspaceStateFromDb(db).jobs, before.jobs);
    const wrongOwner = createCustomer(db, { id: "other-equipment-owner", name: "Other equipment owner" });
    assert.throws(() => updateCustomerSite(db, wrongOwner.id, site.id, { assets: [] }), /Site not found/);
    updateCustomerSite(db, customer.id, site.id, { assets: saved.assets.filter((entry) => entry.id !== "new-equipment") });
    assert.equal(loadWorkspaceStateFromDb(db).customers.find((entry) => entry.id === customer.id).sites.find((entry) => entry.id === site.id).assets.length, 1);
  } finally { db.close(); }
});
