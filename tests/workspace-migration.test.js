import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_SCHEMA_VERSION,
  migrateWorkspaceSchema,
  openWorkspaceDb,
} from "../server-workspace-db.js";
import {
  importWorkspaceJsonData,
  sha256Hex,
  summarizeWorkspaceData,
  summarizeWorkspaceDb,
} from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import {
  getAuthorizedWorkspaceState,
  getWorkspaceStorageMode,
  loadWorkspaceState,
  saveAuthorizedWorkspaceState,
} from "../server-workspace-storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");

function readFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-workspace-test-"));
}

function withTempDb(callback) {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "elset-workspace.db");
  const db = openWorkspaceDb({ dbPath });
  try {
    return callback({ db, dbPath, tempDir });
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("creates a fresh workspace SQLite database with schema metadata", () => {
  withTempDb(({ db }) => {
    migrateWorkspaceSchema(db);
    const migration = db.prepare(`
      SELECT version, name
      FROM workspace_schema_migrations
      ORDER BY version DESC
      LIMIT 1
    `).get();

    assert.equal(migration.version, WORKSPACE_SCHEMA_VERSION);
    assert.equal(migration.name, "inventory-item-archive-records");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  });
});

test("imports the synthetic JSON fixture and validates counts and totals", () => {
  withTempDb(({ db }) => {
    const fixture = readFixture();
    const fixtureContents = fs.readFileSync(fixturePath, "utf8");
    const report = importWorkspaceJsonData(db, fixture, {
      sourceJsonSha256: sha256Hex(fixtureContents),
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.sourceSummary, summarizeWorkspaceData(fixture));
    assert.deepEqual(report.dbSummary, summarizeWorkspaceDb(db));
    assert.equal(report.dbSummary.counts.customers, 1);
    assert.equal(report.dbSummary.counts.customerSites, 1);
    assert.equal(report.dbSummary.counts.customerSiteAssets, 1);
    assert.equal(report.dbSummary.counts.jobs, 1);
    assert.equal(report.dbSummary.counts.quotes, 1);
    assert.equal(report.dbSummary.counts.invoices, 1);
    assert.equal(report.dbSummary.counts.payments, 1);
    assert.equal(report.dbSummary.financials.invoiceTotalsCents, 55_000);
    assert.equal(report.dbSummary.financials.paymentTotalsCents, 25_000);
    assert.equal(report.dbSummary.financials.outstandingBalanceCents, 30_000);
  });
});

test("refuses to import into a non-empty workspace database", () => {
  withTempDb(({ db }) => {
    const fixture = readFixture();
    importWorkspaceJsonData(db, fixture);

    assert.throws(
      () => importWorkspaceJsonData(db, fixture),
      /Workspace database is not empty/
    );
  });
});

test("rejects malformed JSON through the migration command", () => {
  const tempDir = makeTempDir();
  try {
    const badJsonPath = path.join(tempDir, "app-data.json");
    fs.writeFileSync(badJsonPath, "{ bad json", "utf8");
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "migrate-workspace.mjs"),
      "--dry-run",
      "--source",
      badJsonPath,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unable to parse/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejects invalid source relationships before writing records", () => {
  withTempDb(({ db }) => {
    const fixture = readFixture();
    fixture.jobs[0].customerId = "missing-customer";

    assert.throws(
      () => importWorkspaceJsonData(db, fixture),
      /references missing customer/
    );
    assert.equal(summarizeWorkspaceDb(db).counts.jobs, 0);
  });
});

test("rolls back the whole import if a related insert fails", () => {
  withTempDb(({ db }) => {
    const fixture = readFixture();
    fixture.jobs[0].notes.push({
      ...fixture.jobs[0].notes[0],
      text: "Duplicate id should violate the job_notes primary key.",
    });

    assert.throws(
      () => importWorkspaceJsonData(db, fixture),
      /UNIQUE constraint failed/
    );
    assert.equal(summarizeWorkspaceDb(db).counts.customers, 0);
    assert.equal(summarizeWorkspaceDb(db).counts.jobs, 0);
  });
});

test("persists migrated records after the database is closed and reopened", () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "elset-workspace.db");
  try {
    const firstDb = openWorkspaceDb({ dbPath });
    importWorkspaceJsonData(firstDb, readFixture());
    firstDb.close();

    const reopenedDb = openWorkspaceDb({ dbPath });
    const summary = summarizeWorkspaceDb(reopenedDb);
    reopenedDb.close();

    assert.equal(summary.counts.customers, 1);
    assert.equal(summary.counts.jobs, 1);
    assert.equal(summary.counts.invoices, 1);
    assert.equal(summary.financials.outstandingBalanceCents, 30_000);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("assembles migrated SQLite records back into the frontend app-state shape", () => {
  withTempDb(({ db }) => {
    importWorkspaceJsonData(db, readFixture());
    const state = loadWorkspaceStateFromDb(db);

    assert.equal(state.customers.length, 1);
    assert.equal(state.customers[0].sites.length, 1);
    assert.equal(state.customers[0].sites[0].assets.length, 1);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].notes.length, 1);
    assert.equal(state.jobs[0].quote.items.length, 1);
    assert.equal(state.jobs[0].invoice.items.length, 1);
    assert.equal(state.jobs[0].invoice.payments.length, 1);
    assert.equal(state.jobs[0].invoice.payments[0].amount, 250);
    assert.equal(state.settings.companyName, "ELSET Demo Pty Ltd");
    assert.equal(state.quoteTemplate.companyName, "ELSET Demo Pty Ltd");
    assert.equal(state.inventoryItems[0].unitCost, 100);
  });
});

test("loads app state from SQLite when a workspace database exists", () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "elset-workspace.db");
  try {
    const db = openWorkspaceDb({ dbPath });
    importWorkspaceJsonData(db, readFixture());
    db.close();

    const env = { ELSET_DATA_DIR: tempDir };
    assert.equal(getWorkspaceStorageMode(env), "sqlite");
    const state = loadWorkspaceState({ env });
    assert.equal(state.customers.length, 1);
    assert.equal(state.jobs.length, 1);

    const authorizedState = getAuthorizedWorkspaceState({ role: "admin" }, { env });
    assert.equal(authorizedState.customers.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("production storage guard requires explicit migration when non-empty JSON exists without SQLite", () => {
  const tempDir = makeTempDir();
  try {
    fs.copyFileSync(fixturePath, path.join(tempDir, "app-data.json"));

    assert.throws(
      () => getWorkspaceStorageMode({ ELSET_DATA_DIR: tempDir, NODE_ENV: "production" }),
      /SQLite workspace migration required/
    );
    assert.equal(
      getWorkspaceStorageMode({ ELSET_DATA_DIR: tempDir, NODE_ENV: "production", ELSET_WORKSPACE_STORAGE: "json" }),
      "json"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sqlite mode rejects broad workspace writes", () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "elset-workspace.db");
  try {
    const db = openWorkspaceDb({ dbPath });
    importWorkspaceJsonData(db, readFixture());
    db.close();

    assert.throws(
      () => saveAuthorizedWorkspaceState({ role: "admin" }, readFixture(), { env: { ELSET_DATA_DIR: tempDir } }),
      /Broad workspace saves are disabled/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("non-dry migration command creates a JSON backup and SQLite database in a temp data directory", () => {
  const tempDir = makeTempDir();
  try {
    const sourcePath = path.join(tempDir, "app-data.json");
    fs.copyFileSync(fixturePath, sourcePath);

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "migrate-workspace.mjs"),
      "--data-dir",
      tempDir,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Workspace migration completed/);
    assert.ok(fs.existsSync(path.join(tempDir, "elset-workspace.db")));
    assert.ok(fs.readdirSync(path.join(tempDir, "backups")).some((entry) => entry.startsWith("workspace-json-before-sqlite-")));

    const rerun = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "migrate-workspace.mjs"),
      "--data-dir",
      tempDir,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.notEqual(rerun.status, 0);
    assert.match(rerun.stderr, /Workspace database is not empty/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workspace SQLite backup command creates a validated backup with metadata and checksums", () => {
  const tempDir = makeTempDir();
  try {
    const sourcePath = path.join(tempDir, "app-data.json");
    fs.copyFileSync(fixturePath, sourcePath);

    const migrate = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "migrate-workspace.mjs"),
      "--data-dir",
      tempDir,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);

    const backup = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "backup-workspace-sqlite.mjs"),
      "--data-dir",
      tempDir,
      "--include-auth",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(backup.status, 0, backup.stderr);
    assert.match(backup.stdout, /Workspace backup created/);

    const backupsDir = path.join(tempDir, "backups");
    const backupDirName = fs.readdirSync(backupsDir).find((entry) => entry.startsWith("workspace-sqlite-"));
    assert.ok(backupDirName);

    const backupDir = path.join(backupsDir, backupDirName);
    const metadata = JSON.parse(fs.readFileSync(path.join(backupDir, "metadata.json"), "utf8"));
    assert.equal(metadata.format, "elset-workspace-sqlite-backup-v1");
    assert.equal(metadata.workspace.summary.counts.customers, 1);
    assert.ok(fs.existsSync(metadata.workspace.path));
    assert.ok(fs.existsSync(`${metadata.workspace.path}.sha256`));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
