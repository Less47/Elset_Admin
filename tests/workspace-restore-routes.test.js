import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import { createCustomerRouter } from "../server-customer-routes.js";
import { createWorkspaceRestoreRouter } from "../server-workspace-restore-routes.js";
import {
  MAX_SQLITE_BACKUP_DB_BYTES,
  SQLITE_WORKSPACE_BACKUP_FORMAT,
  createWorkspaceSqliteBackupBundle,
  sha256Buffer,
} from "../server-workspace-backup.js";
import { WORKSPACE_DB_FILENAME, WORKSPACE_SCHEMA_VERSION, openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData, summarizeWorkspaceDb } from "../server-workspace-importer.js";
import { beginWorkspaceRestore, endWorkspaceRestore } from "../server-workspace-restore-lock.js";
import { restoreWorkspaceSqliteBackupPayload } from "../server-workspace-restore.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");

function makeTempDir(prefix = "elset-workspace-restore-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readFixture({ customerName = "Synthetic Restore Customer", jobTitle = "Synthetic Restore Job" } = {}) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return {
    ...fixture,
    customers: fixture.customers.map((customer, index) => (
      index === 0 ? { ...customer, name: customerName } : customer
    )),
    jobs: fixture.jobs.map((job, index) => (
      index === 0 ? { ...job, title: jobTitle } : job
    )),
  };
}

function importFixtureToDir(dataDir, fixture) {
  const dbPath = path.join(dataDir, WORKSPACE_DB_FILENAME);
  const db = openWorkspaceDb({ dbPath });
  try {
    importWorkspaceJsonData(db, fixture);
  } finally {
    db.close();
  }
  return dbPath;
}

function getDbState(dbPath) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return loadWorkspaceStateFromDb(db);
  } finally {
    db.close();
  }
}

function getDbSummary(dbPath) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return summarizeWorkspaceDb(db);
  } finally {
    db.close();
  }
}

async function createBackupBundleFromFixture(fixture) {
  const tempDir = makeTempDir("elset-workspace-restore-source-");
  const dbPath = importFixtureToDir(tempDir, fixture);
  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "sqlite",
  };

  try {
    const bundle = await createWorkspaceSqliteBackupBundle({ env, exportedBy: { id: "test-admin", role: "admin" } });
    return { bundle, dbPath, tempDir };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function withTempWorkspace(fixture, callback) {
  const tempDir = makeTempDir("elset-workspace-restore-target-");
  const dbPath = importFixtureToDir(tempDir, fixture);
  const authDbPath = path.join(tempDir, "auth.db");
  fs.writeFileSync(authDbPath, "synthetic-auth-database", "utf8");
  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "sqlite",
    ELSET_AUTH_DB_PATH: authDbPath,
  };

  try {
    return await callback({ tempDir, dbPath, authDbPath, env });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildApp(env, user = { role: "admin" }) {
  const app = express();
  app.use(express.json({ limit: "30mb" }));
  const requireAuth = (req, _res, next) => {
    req.user = {
      id: user.id || "test-admin",
      role: user.role || "admin",
      username: user.username || "test-admin",
      name: user.name || "Test Admin",
      staffId: user.staffId || "demo-staff-admin",
    };
    next();
  };
  const requireRole = (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };

  app.use(createWorkspaceRestoreRouter({
    env,
    requireAuth,
    requireRole,
    verifyUserPassword: (_userId, password) => password === "correct-password",
  }));
  app.use(createCustomerRouter({ env, requireAuth, requireRole }));
  return app;
}

async function withServer(env, callback, user) {
  const app = buildApp(env, user);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await callback(baseUrl);
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildBundleFromBuffer(buffer, { summary, schemaVersion = WORKSPACE_SCHEMA_VERSION } = {}) {
  const sha256 = sha256Buffer(buffer);
  return {
    backup: {
      format: SQLITE_WORKSPACE_BACKUP_FORMAT,
      exportedAt: "2026-01-01T00:00:00.000Z",
      storageMode: "sqlite",
    },
    metadata: {
      format: SQLITE_WORKSPACE_BACKUP_FORMAT,
      createdAt: "2026-01-01T00:00:00.000Z",
      workspace: {
        path: WORKSPACE_DB_FILENAME,
        sha256,
        sizeBytes: buffer.length,
        schemaVersion,
        summary,
      },
      auth: null,
      copiedRuntimeDirs: [],
    },
    files: [
      {
        path: WORKSPACE_DB_FILENAME,
        sha256,
        sizeBytes: buffer.length,
        contentBase64: buffer.toString("base64"),
      },
    ],
  };
}

test("POST /api/admin/workspace-restore supports validation-only SQLite restore", async () => {
  const source = await createBackupBundleFromFixture(readFixture({ customerName: "Validated Synthetic Customer" }));
  try {
    await withTempWorkspace(readFixture({ customerName: "Current Synthetic Customer" }), async ({ env, dbPath }) => {
      const before = getDbState(dbPath);

      await withServer(env, async (baseUrl) => {
        const result = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: source.bundle,
            restorePassword: "correct-password",
            dryRun: true,
          }),
        });

        assert.equal(result.response.status, 200, result.payload.error);
        assert.equal(result.payload.dryRun, true);
        assert.equal(result.payload.restore.summary.counts.customers, source.bundle.metadata.workspace.summary.counts.customers);
        assert.equal(Object.prototype.hasOwnProperty.call(result.payload, "state"), false);
      });

      const after = getDbState(dbPath);
      assert.equal(after.customers[0].name, before.customers[0].name);
    });
  } finally {
    fs.rmSync(source.tempDir, { recursive: true, force: true });
  }
});

test("POST /api/admin/workspace-restore restores a verified SQLite backup and creates a pre-restore backup", async () => {
  const sourceFixture = readFixture({ customerName: "Restored Synthetic Customer", jobTitle: "Restored Synthetic Job" });
  const sourceCustomerId = sourceFixture.customers[0].id;
  const source = await createBackupBundleFromFixture(sourceFixture);
  try {
    await withTempWorkspace(readFixture({ customerName: "Original Synthetic Customer" }), async ({ env, dbPath, authDbPath, tempDir }) => {
      await withServer(env, async (baseUrl) => {
        const result = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: source.bundle,
            restorePassword: "correct-password",
          }),
        });

        assert.equal(result.response.status, 200, result.payload.error);
        assert.equal(result.payload.restore.restoredBackup.summary.counts.customers, source.bundle.metadata.workspace.summary.counts.customers);
        assert.equal(result.payload.state.customers.find((customer) => customer.id === sourceCustomerId).name, "Restored Synthetic Customer");
        assert.ok(result.payload.restore.preRestoreBackup.backupDir.startsWith(path.join(tempDir, "backups")));
        assert.ok(fs.existsSync(path.join(result.payload.restore.preRestoreBackup.backupDir, "metadata.json")));
      });

      assert.equal(fs.readFileSync(authDbPath, "utf8"), "synthetic-auth-database");
      assert.deepEqual(getDbSummary(dbPath), source.bundle.metadata.workspace.summary);
    });
  } finally {
    fs.rmSync(source.tempDir, { recursive: true, force: true });
  }
});

test("SQLite restore rejects corrupted checksums, unsupported schemas, missing metadata or files, unexpected files, and oversized backups", async () => {
  const source = await createBackupBundleFromFixture(readFixture());
  try {
    await withTempWorkspace(readFixture({ customerName: "Unchanged Customer" }), async ({ env, dbPath }) => {
      const before = getDbState(dbPath).customers[0].name;

      await withServer(env, async (baseUrl) => {
        const corruptedChecksum = clone(source.bundle);
        corruptedChecksum.files[0].sha256 = "not-the-real-checksum";

        const checksumResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: corruptedChecksum,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(checksumResult.response.status, 400);
        assert.match(checksumResult.payload.error, /checksum/i);

        const unsupportedSchema = clone(source.bundle);
        unsupportedSchema.metadata.workspace.schemaVersion = WORKSPACE_SCHEMA_VERSION + 1;
        const schemaResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: unsupportedSchema,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(schemaResult.response.status, 400);
        assert.match(schemaResult.payload.error, /Unsupported workspace schema version/i);

        const missingDatabase = clone(source.bundle);
        missingDatabase.files = [];
        const missingResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: missingDatabase,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(missingResult.response.status, 400);
        assert.match(missingResult.payload.error, /missing the SQLite database/i);

        const missingMetadata = clone(source.bundle);
        delete missingMetadata.metadata;
        const metadataResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: missingMetadata,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(metadataResult.response.status, 400);
        assert.match(metadataResult.payload.error, /missing metadata/i);

        const unexpectedFile = clone(source.bundle);
        unexpectedFile.files.push({
          path: "auth.db",
          sha256: source.bundle.files[0].sha256,
          sizeBytes: 1,
          contentBase64: "AA==",
        });
        const unexpectedFileResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: unexpectedFile,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(unexpectedFileResult.response.status, 400);
        assert.match(unexpectedFileResult.payload.error, /unexpected file/i);

        const oversized = clone(source.bundle);
        oversized.files[0].sizeBytes = MAX_SQLITE_BACKUP_DB_BYTES + 1;
        const oversizedResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: oversized,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(oversizedResult.response.status, 400);
        assert.match(oversizedResult.payload.error, /too large/i);
      });

      assert.equal(getDbState(dbPath).customers[0].name, before);
    });
  } finally {
    fs.rmSync(source.tempDir, { recursive: true, force: true });
  }
});

test("SQLite restore rejects invalid database integrity and auth tables", async () => {
  const validSource = await createBackupBundleFromFixture(readFixture());
  const authTableDir = makeTempDir("elset-workspace-restore-auth-table-");
  try {
    const summary = validSource.bundle.metadata.workspace.summary;
    const invalidDatabaseBundle = buildBundleFromBuffer(Buffer.from("this is not a sqlite database", "utf8"), { summary });

    const authTableDbPath = importFixtureToDir(authTableDir, readFixture());
    const authDb = new Database(authTableDbPath);
    try {
      authDb.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY)');
      authDb.pragma(`user_version = ${WORKSPACE_SCHEMA_VERSION}`);
    } finally {
      authDb.close();
    }
    const authTableBundle = buildBundleFromBuffer(fs.readFileSync(authTableDbPath), { summary });

    await withTempWorkspace(readFixture({ customerName: "Unchanged Integrity Customer" }), async ({ env, dbPath }) => {
      const before = getDbState(dbPath).customers[0].name;

      await withServer(env, async (baseUrl) => {
        const invalidResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: invalidDatabaseBundle,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(invalidResult.response.status, 400);
        assert.match(invalidResult.payload.error, /database|integrity|malformed/i);

        const authTableResult = await requestJson(baseUrl, "/api/admin/workspace-restore", {
          method: "POST",
          body: JSON.stringify({
            backupData: authTableBundle,
            restorePassword: "correct-password",
          }),
        });
        assert.equal(authTableResult.response.status, 400);
        assert.match(authTableResult.payload.error, /authentication tables/i);
      });

      assert.equal(getDbState(dbPath).customers[0].name, before);
    });
  } finally {
    fs.rmSync(validSource.tempDir, { recursive: true, force: true });
    fs.rmSync(authTableDir, { recursive: true, force: true });
  }
});

test("SQLite workspace restore is admin-only and rejects concurrent restores", async () => {
  const source = await createBackupBundleFromFixture(readFixture());
  try {
    await withTempWorkspace(readFixture(), async ({ env }) => {
      for (const role of ["office", "technician"]) {
        await withServer(env, async (baseUrl) => {
          const result = await requestJson(baseUrl, "/api/admin/workspace-restore", {
            method: "POST",
            body: JSON.stringify({
              backupData: source.bundle,
              restorePassword: "correct-password",
            }),
          });
          assert.equal(result.response.status, 403);
        }, { role });
      }

      const lock = beginWorkspaceRestore();
      try {
        await withServer(env, async (baseUrl) => {
          const result = await requestJson(baseUrl, "/api/admin/workspace-restore", {
            method: "POST",
            body: JSON.stringify({
              backupData: source.bundle,
              restorePassword: "correct-password",
            }),
          });
          assert.equal(result.response.status, 423);
          assert.match(result.payload.error, /restore/i);
        });
      } finally {
        endWorkspaceRestore(lock.token);
      }
    });
  } finally {
    fs.rmSync(source.tempDir, { recursive: true, force: true });
  }
});

test("ordinary SQLite writes are blocked while a restore is in progress", async () => {
  await withTempWorkspace(readFixture(), async ({ env }) => {
    const lock = beginWorkspaceRestore();
    try {
      await withServer(env, async (baseUrl) => {
        const result = await requestJson(baseUrl, "/api/customers", {
          method: "POST",
          body: JSON.stringify({
            customer: {
              id: "blocked-customer",
              name: "Blocked Synthetic Customer",
            },
          }),
        });

        assert.notEqual(result.response.status, 200);
        assert.match(result.payload.error, /restore is in progress/i);
      });
    } finally {
      endWorkspaceRestore(lock.token);
    }
  });
});

test("forced restore failures roll back to the original workspace database", async () => {
  const source = await createBackupBundleFromFixture(readFixture({ customerName: "Rollback Source Customer" }));
  try {
    for (const simulateFailureAt of ["after-replace", "after-verify"]) {
      await withTempWorkspace(readFixture({ customerName: `Rollback Original ${simulateFailureAt}` }), async ({ env, dbPath }) => {
        const before = getDbState(dbPath).customers[0].name;

        await assert.rejects(
          () => restoreWorkspaceSqliteBackupPayload(source.bundle, { env, simulateFailureAt }),
          /Forced restore failure/
        );

        assert.equal(getDbState(dbPath).customers[0].name, before);
      });
    }
  } finally {
    fs.rmSync(source.tempDir, { recursive: true, force: true });
  }
});

test("SQLite restore endpoint is unavailable in JSON workspace mode", async () => {
  const source = await createBackupBundleFromFixture(readFixture());
  const tempDir = makeTempDir("elset-workspace-restore-json-mode-");
  try {
    const env = {
      ELSET_DATA_DIR: tempDir,
      ELSET_WORKSPACE_STORAGE: "json",
    };

    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/admin/workspace-restore", {
        method: "POST",
        body: JSON.stringify({
          backupData: source.bundle,
          restorePassword: "correct-password",
        }),
      });
      assert.equal(result.response.status, 409);
      assert.match(result.payload.error, /SQLite workspace restore endpoint/i);
    });
  } finally {
    fs.rmSync(source.tempDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
