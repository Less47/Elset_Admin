import fs from "fs";
import os from "os";
import path from "path";
import {
  WORKSPACE_DB_FILENAME,
  getWorkspaceDataDir,
  getWorkspaceDbPath,
  openWorkspaceDb,
} from "./server-workspace-db.js";
import {
  createWorkspaceSqliteBackup,
  materializeWorkspaceSqliteBackup,
  timestampSlug,
  validateWorkspaceBackupDatabaseFile,
  validateWorkspaceSqliteBackupPayload,
} from "./server-workspace-backup.js";
import {
  WorkspaceRestoreInProgressError,
  beginWorkspaceRestore,
  endWorkspaceRestore,
} from "./server-workspace-restore-lock.js";

const sqliteSidecarSuffixes = ["-wal", "-shm", "-journal"];

export class WorkspaceRestoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceRestoreError";
    this.statusCode = statusCode;
  }
}

function removeSqliteSidecars(dbPath) {
  for (const suffix of sqliteSidecarSuffixes) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function checkpointWorkspaceDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) return;

  const db = openWorkspaceDb({
    dbPath,
    readonly: false,
    migrate: false,
    allowDuringRestore: true,
  });
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

function copyFileAtomically(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const pendingPath = path.join(
    path.dirname(destinationPath),
    `${path.basename(destinationPath)}.restore-pending-${process.pid}-${Date.now()}`
  );

  try {
    fs.copyFileSync(sourcePath, pendingPath);
    fs.renameSync(pendingPath, destinationPath);
  } finally {
    fs.rmSync(pendingPath, { force: true });
  }
}

function validateActiveWorkspace(dbPath, validation) {
  return validateWorkspaceBackupDatabaseFile(dbPath, {
    expectedSummary: validation?.summary || null,
    expectedSha256: validation?.sha256 || "",
  });
}

function rollbackWorkspaceDatabase({
  targetDbPath,
  rollbackDbPath,
  preRestoreValidation,
}) {
  if (!rollbackDbPath || !fs.existsSync(rollbackDbPath)) {
    throw new Error("A restore failed before a rollback database copy was available.");
  }

  removeSqliteSidecars(targetDbPath);
  copyFileAtomically(rollbackDbPath, targetDbPath);
  removeSqliteSidecars(targetDbPath);
  return validateActiveWorkspace(targetDbPath, preRestoreValidation);
}

export function validateWorkspaceRestorePayload(backupInput) {
  return validateWorkspaceSqliteBackupPayload(backupInput);
}

export async function restoreWorkspaceSqliteBackupPayload(backupInput, {
  env = globalThis.process?.env || {},
  simulateFailureAt = "",
} = {}) {
  let restoreLock = null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-workspace-restore-"));
  let rollbackDbPath = "";
  let preRestoreBackup = null;
  let hasReplacedWorkspace = false;

  try {
    restoreLock = beginWorkspaceRestore();

    const targetDbPath = getWorkspaceDbPath(env);
    const dataDir = getWorkspaceDataDir(env);
    if (!fs.existsSync(targetDbPath)) {
      throw new WorkspaceRestoreError(`Workspace SQLite database does not exist: ${targetDbPath}`, 409);
    }

    const materialized = materializeWorkspaceSqliteBackup(backupInput, tempDir);
    if (simulateFailureAt === "after-validation") {
      throw new Error("Forced restore failure after validation.");
    }

    checkpointWorkspaceDatabase(targetDbPath);
    preRestoreBackup = await createWorkspaceSqliteBackup({
      env,
      sourceDbPath: targetDbPath,
      outputRoot: path.join(dataDir, "backups"),
      backupName: `pre-restore-workspace-sqlite-${timestampSlug()}`,
      includeSourcePath: true,
    });
    if (simulateFailureAt === "after-pre-restore-backup") {
      throw new Error("Forced restore failure after pre-restore backup.");
    }

    rollbackDbPath = path.join(tempDir, `rollback-${WORKSPACE_DB_FILENAME}`);
    fs.copyFileSync(targetDbPath, rollbackDbPath);

    removeSqliteSidecars(targetDbPath);
    copyFileAtomically(materialized.tempDbPath, targetDbPath);
    removeSqliteSidecars(targetDbPath);
    hasReplacedWorkspace = true;
    if (simulateFailureAt === "after-replace") {
      throw new Error("Forced restore failure after database replacement.");
    }

    const restoredValidation = validateActiveWorkspace(targetDbPath, materialized.validation);
    if (simulateFailureAt === "after-verify") {
      throw new Error("Forced restore failure after restored database verification.");
    }

    return {
      ok: true,
      dryRun: false,
      restoredAt: new Date().toISOString(),
      restoredBackup: {
        sha256: restoredValidation.sha256,
        schemaVersion: restoredValidation.schemaVersion,
        summary: restoredValidation.summary,
        sizeBytes: restoredValidation.sizeBytes,
      },
      preRestoreBackup: {
        backupDir: preRestoreBackup.backupDir,
        sha256: preRestoreBackup.validation.sha256,
        schemaVersion: preRestoreBackup.validation.schemaVersion,
        summary: preRestoreBackup.validation.summary,
      },
    };
  } catch (error) {
    if (hasReplacedWorkspace) {
      try {
        rollbackWorkspaceDatabase({
          targetDbPath: getWorkspaceDbPath(env),
          rollbackDbPath,
          preRestoreValidation: preRestoreBackup?.validation || null,
        });
      } catch (rollbackError) {
        const originalMessage = error instanceof Error ? error.message : "Workspace restore failed.";
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : "Rollback verification failed.";
        throw new WorkspaceRestoreError(
          `${originalMessage} Rollback also failed: ${rollbackMessage}`,
          500
        );
      }
    }

    if (error instanceof WorkspaceRestoreError || error instanceof WorkspaceRestoreInProgressError) {
      throw error;
    }

    throw new WorkspaceRestoreError(error instanceof Error ? error.message : "Workspace restore failed.");
  } finally {
    if (restoreLock) {
      endWorkspaceRestore(restoreLock.token);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
