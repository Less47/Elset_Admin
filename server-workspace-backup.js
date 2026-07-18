import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import {
  WORKSPACE_DB_FILENAME,
  WORKSPACE_SCHEMA_VERSION,
  getWorkspaceDataDir,
  getWorkspaceDbPath,
} from "./server-workspace-db.js";
import { summarizeWorkspaceDb } from "./server-workspace-importer.js";

export const SQLITE_WORKSPACE_BACKUP_FORMAT = "elset-workspace-sqlite-backup-v1";
export const MAX_SQLITE_BACKUP_DB_BYTES = 200 * 1024 * 1024;
export const MAX_SQLITE_BACKUP_PAYLOAD_BYTES = 275 * 1024 * 1024;

const expectedWorkspaceTables = [
  "workspace_schema_migrations",
  "workspace_info",
  "settings",
  "document_templates",
  "staff",
  "customers",
  "customer_contacts",
  "sites",
  "site_assets",
  "site_access_notes",
  "maintenance_plans",
  "maintenance_checklist_items",
  "jobs",
  "job_notes",
  "job_attachments",
  "quotes",
  "quote_line_items",
  "invoices",
  "invoice_line_items",
  "payments",
  "document_send_history",
  "inventory_items",
  "deleted_records",
  "service_m8_refs",
  "deleted_maintenance_plans",
  "deleted_inventory_items",
  "deleted_staff_members",
];

const authTableNames = new Set([
  "account",
  "apikey",
  "invitation",
  "jwks",
  "member",
  "oauth_access_token",
  "organization",
  "passkey",
  "rate_limit",
  "session",
  "two_factor",
  "user",
  "verification",
]);

function nowIso() {
  return new Date().toISOString();
}

export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function writeChecksumSidecar(filePath) {
  const checksum = sha256File(filePath);
  fs.writeFileSync(`${filePath}.sha256`, `${checksum}  ${path.basename(filePath)}\n`, "utf8");
  return checksum;
}

function assertPlainObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function safeRelativeBackupPath(inputPath) {
  const value = String(inputPath || "").trim();
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || path.isAbsolute(normalized) || normalized.includes("..")) {
    throw new Error("The workspace backup contains an unsafe file path.");
  }
  if (normalized !== WORKSPACE_DB_FILENAME) {
    throw new Error(`The workspace backup contains an unexpected file: ${value || "(blank)"}.`);
  }
  return normalized;
}

function assertAllowedBundleFiles(files) {
  const fileNames = files.map((file) => safeRelativeBackupPath(file.path || file.name));
  const uniqueFileNames = new Set(fileNames);
  if (uniqueFileNames.size !== files.length) {
    throw new Error("The workspace backup contains duplicate files.");
  }
  if (!uniqueFileNames.has(WORKSPACE_DB_FILENAME)) {
    throw new Error("The workspace backup is missing the SQLite database file.");
  }
}

function getTableNames(db) {
  return new Set(
    db.prepare(`
      SELECT name
        FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
    `).all().map((row) => row.name)
  );
}

function compareSummaryObjects(expected, actual) {
  const errors = [];
  const expectedCounts = expected?.counts && typeof expected.counts === "object" ? expected.counts : {};
  const actualCounts = actual?.counts && typeof actual.counts === "object" ? actual.counts : {};
  const expectedFinancials = expected?.financials && typeof expected.financials === "object" ? expected.financials : {};
  const actualFinancials = actual?.financials && typeof actual.financials === "object" ? actual.financials : {};

  for (const [key, expectedValue] of Object.entries(expectedCounts)) {
    if (Number(expectedValue) !== Number(actualCounts[key])) {
      errors.push(`Count mismatch for ${key}: metadata=${expectedValue}, sqlite=${actualCounts[key]}`);
    }
  }

  for (const [key, expectedValue] of Object.entries(expectedFinancials)) {
    if (Number(expectedValue) !== Number(actualFinancials[key])) {
      errors.push(`Financial mismatch for ${key}: metadata=${expectedValue}, sqlite=${actualFinancials[key]}`);
    }
  }

  return errors;
}

export async function backupSqliteDatabase(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Workspace SQLite database does not exist: ${sourcePath}`);
  }

  fs.rmSync(destinationPath, { force: true });
  const db = new Database(sourcePath, { readonly: true });
  try {
    await db.backup(destinationPath);
  } finally {
    db.close();
  }
}

export function validateWorkspaceBackupDatabaseFile(backupPath, { expectedSummary = null, expectedSha256 = "" } = {}) {
  if (!fs.existsSync(backupPath)) {
    throw new Error("The workspace backup is missing the SQLite database file.");
  }

  const stat = fs.statSync(backupPath);
  if (!stat.isFile()) {
    throw new Error("The workspace backup database entry is not a file.");
  }
  if (stat.size <= 0) {
    throw new Error("The workspace backup database is empty.");
  }
  if (stat.size > MAX_SQLITE_BACKUP_DB_BYTES) {
    throw new Error("The workspace backup database is too large to restore safely.");
  }

  const actualSha256 = sha256File(backupPath);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error("The workspace backup checksum does not match the database file.");
  }

  const db = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");
    const integrityRows = db.pragma("integrity_check");
    const integrityErrors = integrityRows
      .map((row) => String(Object.values(row)[0] || ""))
      .filter((value) => value && value.toLowerCase() !== "ok");
    if (integrityErrors.length > 0) {
      throw new Error(`SQLite integrity check failed: ${integrityErrors.join("; ")}`);
    }

    const schemaVersion = Number(db.pragma("user_version", { simple: true }) || 0);
    if (schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported workspace schema version ${schemaVersion || "(none)"}. Expected ${WORKSPACE_SCHEMA_VERSION}.`
      );
    }

    const tableNames = getTableNames(db);
    const missingTables = expectedWorkspaceTables.filter((tableName) => !tableNames.has(tableName));
    if (missingTables.length > 0) {
      throw new Error(`The workspace backup is missing required tables: ${missingTables.join(", ")}.`);
    }

    const authTables = [...tableNames].filter((tableName) => authTableNames.has(tableName));
    if (authTables.length > 0) {
      throw new Error(`The workspace backup database contains authentication tables: ${authTables.join(", ")}.`);
    }

    const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length > 0) {
      throw new Error(`Workspace backup relationship validation failed: ${JSON.stringify(foreignKeyErrors)}`);
    }

    const summary = summarizeWorkspaceDb(db);
    const summaryErrors = expectedSummary ? compareSummaryObjects(expectedSummary, summary) : [];
    if (summaryErrors.length > 0) {
      throw new Error(`Workspace backup summary validation failed:\n${summaryErrors.join("\n")}`);
    }

    return {
      ok: true,
      schemaVersion,
      sha256: actualSha256,
      sizeBytes: stat.size,
      summary,
    };
  } finally {
    db.close();
  }
}

export async function createWorkspaceSqliteBackup({
  env = globalThis.process?.env || {},
  sourceDbPath = getWorkspaceDbPath(env),
  outputRoot = path.join(getWorkspaceDataDir(env), "backups"),
  backupName = `workspace-sqlite-${timestampSlug()}`,
  includeSourcePath = true,
} = {}) {
  const backupDir = path.resolve(outputRoot, backupName);
  fs.mkdirSync(backupDir, { recursive: true });

  const workspaceBackupPath = path.join(backupDir, WORKSPACE_DB_FILENAME);
  await backupSqliteDatabase(sourceDbPath, workspaceBackupPath);
  const workspaceSha256 = writeChecksumSidecar(workspaceBackupPath);
  const validation = validateWorkspaceBackupDatabaseFile(workspaceBackupPath, { expectedSha256: workspaceSha256 });

  const metadata = {
    format: SQLITE_WORKSPACE_BACKUP_FORMAT,
    createdAt: nowIso(),
    ...(includeSourcePath ? { sourceDbPath: path.resolve(sourceDbPath) } : {}),
    workspace: {
      path: WORKSPACE_DB_FILENAME,
      sha256: workspaceSha256,
      sizeBytes: validation.sizeBytes,
      schemaVersion: validation.schemaVersion,
      summary: validation.summary,
    },
    auth: null,
    copiedRuntimeDirs: [],
  };

  fs.writeFileSync(path.join(backupDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  return {
    backupDir,
    workspaceBackupPath,
    metadata,
    validation,
  };
}

export async function createWorkspaceSqliteBackupBundle({
  env = globalThis.process?.env || {},
  exportedBy = null,
} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elset-workspace-backup-"));
  try {
    const backup = await createWorkspaceSqliteBackup({
      env,
      outputRoot: tempRoot,
      backupName: "workspace-sqlite-bundle",
      includeSourcePath: false,
    });
    const databaseBuffer = fs.readFileSync(backup.workspaceBackupPath);
    const metadata = {
      ...backup.metadata,
      createdAt: backup.metadata.createdAt,
      source: {
        type: "api-download",
      },
    };

    return {
      backup: {
        format: SQLITE_WORKSPACE_BACKUP_FORMAT,
        exportedAt: nowIso(),
        exportedBy: exportedBy
          ? {
              id: exportedBy.id || "",
              username: exportedBy.username || "",
              role: exportedBy.role || "",
            }
          : null,
        storageMode: "sqlite",
      },
      metadata,
      files: [
        {
          path: WORKSPACE_DB_FILENAME,
          sha256: backup.validation.sha256,
          sizeBytes: databaseBuffer.length,
          contentBase64: databaseBuffer.toString("base64"),
        },
      ],
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function getBackupFormat(backupInput) {
  return String(backupInput?.backup?.format || backupInput?.format || backupInput?.metadata?.format || "").trim();
}

function normalizeBundleFiles(filesInput) {
  if (Array.isArray(filesInput)) {
    return filesInput;
  }

  if (filesInput && typeof filesInput === "object") {
    return Object.entries(filesInput).map(([filePath, file]) => ({
      ...(file && typeof file === "object" ? file : {}),
      path: filePath,
    }));
  }

  return [];
}

export function materializeWorkspaceSqliteBackup(backupInput, tempDir) {
  assertPlainObject(backupInput, "The uploaded backup must be a JSON object.");

  const format = getBackupFormat(backupInput);
  if (format !== SQLITE_WORKSPACE_BACKUP_FORMAT) {
    throw new Error("This backup file is not a supported SQLite workspace backup.");
  }

  const metadata = backupInput.metadata;
  assertPlainObject(metadata, "The SQLite workspace backup is missing metadata.");
  if (metadata.format !== SQLITE_WORKSPACE_BACKUP_FORMAT) {
    throw new Error("The SQLite workspace backup metadata uses an unsupported format.");
  }
  if (!metadata.workspace || typeof metadata.workspace !== "object" || Array.isArray(metadata.workspace)) {
    throw new Error("The SQLite workspace backup metadata is missing workspace details.");
  }
  if (metadata.workspace.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported workspace schema version ${metadata.workspace.schemaVersion || "(none)"}. `
      + `Expected ${WORKSPACE_SCHEMA_VERSION}.`
    );
  }
  if (!metadata.workspace.summary || typeof metadata.workspace.summary !== "object") {
    throw new Error("The SQLite workspace backup metadata is missing the workspace summary.");
  }

  const files = normalizeBundleFiles(backupInput.files);
  assertAllowedBundleFiles(files);

  const databaseEntry = files.find((file) => safeRelativeBackupPath(file.path || file.name) === WORKSPACE_DB_FILENAME);
  if (!databaseEntry?.contentBase64 || typeof databaseEntry.contentBase64 !== "string") {
    throw new Error("The SQLite workspace backup is missing embedded database contents.");
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(backupInput), "utf8");
  if (payloadSize > MAX_SQLITE_BACKUP_PAYLOAD_BYTES) {
    throw new Error("The SQLite workspace backup payload is too large to restore safely.");
  }

  const declaredSizeBytes = Number(databaseEntry.sizeBytes || metadata.workspace.sizeBytes || 0);
  if (declaredSizeBytes > MAX_SQLITE_BACKUP_DB_BYTES) {
    throw new Error("The SQLite workspace backup database is too large to restore safely.");
  }

  const databaseBuffer = Buffer.from(databaseEntry.contentBase64, "base64");
  if (databaseBuffer.length <= 0) {
    throw new Error("The SQLite workspace backup database is empty.");
  }
  if (databaseBuffer.length > MAX_SQLITE_BACKUP_DB_BYTES) {
    throw new Error("The SQLite workspace backup database is too large to restore safely.");
  }

  const expectedSha256 = String(databaseEntry.sha256 || metadata.workspace.sha256 || "").trim();
  const actualSha256 = sha256Buffer(databaseBuffer);
  if (!expectedSha256 || actualSha256 !== expectedSha256) {
    throw new Error("The SQLite workspace backup checksum does not match the embedded database.");
  }

  if (Number(databaseEntry.sizeBytes || metadata.workspace.sizeBytes || databaseBuffer.length) !== databaseBuffer.length) {
    throw new Error("The SQLite workspace backup database size does not match its metadata.");
  }

  fs.mkdirSync(tempDir, { recursive: true });
  const tempDbPath = path.join(tempDir, WORKSPACE_DB_FILENAME);
  fs.writeFileSync(tempDbPath, databaseBuffer);
  const validation = validateWorkspaceBackupDatabaseFile(tempDbPath, {
    expectedSummary: metadata.workspace.summary,
    expectedSha256,
  });

  return {
    tempDbPath,
    metadata,
    validation,
  };
}

export function validateWorkspaceSqliteBackupPayload(backupInput) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-workspace-restore-validate-"));
  try {
    const materialized = materializeWorkspaceSqliteBackup(backupInput, tempDir);
    return {
      ok: true,
      dryRun: true,
      schemaVersion: materialized.validation.schemaVersion,
      summary: materialized.validation.summary,
      sha256: materialized.validation.sha256,
      sizeBytes: materialized.validation.sizeBytes,
      metadata: materialized.metadata,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
