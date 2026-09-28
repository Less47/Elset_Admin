import fs from "node:fs";
import path from "node:path";
import { normalizeStoredData } from "./server-store.js";
import {
  assertWorkspaceIntegrity, assertWorkspaceSchema, getWorkspaceDataDir,
  getWorkspaceDbPath, openWorkspaceDb, migrateWorkspaceSchema, readWorkspaceSchemaVersion,
} from "./server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

function assertExistingWorkspaceDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Workspace database not found at ${dbPath}. Refusing to start without the SQLite workspace database. Restore a verified SQLite backup before starting the application.`);
  }
}

function validateWorkspaceLocation(env) {
  const storage = getWorkspaceStorageStatus(env);
  if (env.FLY_APP_NAME && path.resolve(storage.dataDir) !== path.resolve("/app/data")) {
    throw new Error(`Fly runtime must use ELSET_DATA_DIR=/app/data. Current value resolves to ${storage.dataDir}.`);
  }
  assertExistingWorkspaceDatabase(storage.dbPath);
  if (env.NODE_ENV === "production" || env.FLY_APP_NAME) {
    if (!fs.statSync(storage.dataDir).isDirectory()) throw new Error(`Persistent workspace data path is not a directory: ${storage.dataDir}`);
    fs.accessSync(storage.dataDir, fs.constants.R_OK | fs.constants.W_OK);
  }
  return storage;
}

export function assertSqliteWorkspaceReady(dbPath) {
  assertExistingWorkspaceDatabase(dbPath);
  const db = openWorkspaceDb({ dbPath, readonly: true, migrate: false, fileMustExist: true });
  try {
    assertWorkspaceIntegrity(db);
    return assertWorkspaceSchema(db);
  } finally { db.close(); }
}

// Readiness is read-only and validates every environment, including development.
export function assertProductionWorkspaceStorageReady(env = process.env) {
  const storage = validateWorkspaceLocation(env);
  assertSqliteWorkspaceReady(storage.dbPath);
  return storage;
}

// Only application startup upgrades existing, supported schemas. It never creates a workspace.
export function initializeWorkspaceStorage(env = process.env, { log = console.info } = {}) {
  const storage = validateWorkspaceLocation(env);
  const db = openWorkspaceDb({ dbPath: storage.dbPath, migrate: false, fileMustExist: true });
  let migrated = false;
  try {
    assertWorkspaceIntegrity(db);
    readWorkspaceSchemaVersion(db);
    migrateWorkspaceSchema(db, { onMigration: ({ fromVersion, toVersion }) => {
      if (!migrated) log(`Workspace database schema: ${fromVersion}`);
      log(`Migrating workspace schema ${fromVersion} -> ${toVersion}`);
      migrated = true;
    } });
  } finally { db.close(); }
  const { schemaVersion } = assertSqliteWorkspaceReady(storage.dbPath);
  if (migrated) log(`Workspace schema migration complete: ${schemaVersion}`);
  return storage;
}

export function getWorkspaceReadinessStatus(env = process.env) {
  try { return { ok: true, storage: assertProductionWorkspaceStorageReady(env) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Workspace storage is not ready." }; }
}

function filterAuthorizedState(data, user) {
  const normalized = normalizeStoredData(data);
  if (!user) return null;

  if (user.role === "technician") {
    const jobs = normalized.jobs;
    const customerIds = new Set(jobs.map((job) => job.customerId));
    return {
      staff: normalized.staff.filter((staffMember) => staffMember.id === user.staffId),
      customers: normalized.customers.filter((customer) => customerIds.has(customer.id)),
      inventoryItems: [],
      maintenancePlans: [],
      jobs,
      deletedJobs: [],
      deletedCustomers: [],
      deletedInvoices: [],
      quoteTemplate: normalized.quoteTemplate,
      invoiceTemplate: normalized.invoiceTemplate,
      settings: normalized.settings,
    };
  }

  return {
    staff: normalized.staff,
    customers: normalized.customers,
    inventoryItems: normalized.inventoryItems,
    maintenancePlans: normalized.maintenancePlans,
    jobs: normalized.jobs,
    deletedJobs: normalized.deletedJobs,
    deletedCustomers: normalized.deletedCustomers,
    deletedInvoices: normalized.deletedInvoices,
    quoteTemplate: normalized.quoteTemplate,
    invoiceTemplate: normalized.invoiceTemplate,
    settings: normalized.settings,
  };
}

export function loadWorkspaceState({ env = process.env } = {}) {
  const dbPath = getWorkspaceDbPath(env);
  assertExistingWorkspaceDatabase(dbPath);
  const db = openWorkspaceDb({ dbPath, readonly: true, migrate: false, fileMustExist: true });
  try { return normalizeStoredData(loadWorkspaceStateFromDb(db)); }
  finally { db.close(); }
}

export function getAuthorizedWorkspaceState(user, { env = process.env } = {}) {
  return filterAuthorizedState(loadWorkspaceState({ env }), user);
}

export function getWorkspaceStorageStatus(env = process.env) {
  const dbPath = getWorkspaceDbPath(env);
  return { dataDir: getWorkspaceDataDir(env), dbPath, sqliteExists: fs.existsSync(dbPath) };
}
