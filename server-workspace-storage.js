import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getAuthorizedAppState as getAuthorizedJsonAppState,
  loadData,
  normalizeStoredData,
  saveAuthorizedAppState as saveAuthorizedJsonAppState,
  saveData,
} from "./server-store.js";
import {
  WORKSPACE_SCHEMA_VERSION,
  getWorkspaceDataDir,
  getWorkspaceDbPath,
  openWorkspaceDb,
} from "./server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getJsonDataPath(env = globalThis.process?.env || {}) {
  return path.join(getWorkspaceDataDir(env), "app-data.json");
}

function countJsonBusinessRecords(data) {
  return (
    (Array.isArray(data?.staff) ? data.staff.length : 0)
    + (Array.isArray(data?.customers) ? data.customers.length : 0)
    + (Array.isArray(data?.jobs) ? data.jobs.length : 0)
    + (Array.isArray(data?.inventoryItems) ? data.inventoryItems.length : 0)
    + (Array.isArray(data?.maintenancePlans) ? data.maintenancePlans.length : 0)
    + (Array.isArray(data?.deletedJobs) ? data.deletedJobs.length : 0)
    + (Array.isArray(data?.deletedCustomers) ? data.deletedCustomers.length : 0)
  );
}

function hasNonEmptyJsonWorkspace(jsonPath) {
  if (!fs.existsSync(jsonPath)) return false;

  try {
    const contents = fs.readFileSync(jsonPath, "utf8");
    if (!contents.trim()) return false;
    return countJsonBusinessRecords(JSON.parse(contents)) > 0;
  } catch {
    return true;
  }
}

function isProductionRuntime(env = globalThis.process?.env || {}) {
  return env.NODE_ENV === "production" || Boolean(env.FLY_APP_NAME);
}

function assertFlyDataDir(env, dataDir) {
  if (!env.FLY_APP_NAME) return;

  const expectedFlyDataDir = path.resolve("/app/data");
  if (path.resolve(dataDir) !== expectedFlyDataDir) {
    throw new Error(
      `Fly runtime must use ELSET_DATA_DIR=${expectedFlyDataDir}. Current value resolves to ${dataDir}.`
    );
  }
}

function assertExistingWritableDirectory(directoryPath, label) {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`${label} does not exist at ${directoryPath}. Confirm the persistent volume is mounted before starting.`);
  }

  const stats = fs.statSync(directoryPath);
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory at ${directoryPath}.`);
  }

  fs.accessSync(directoryPath, fs.constants.R_OK | fs.constants.W_OK);
}

function assertSqliteWorkspaceReady(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `SQLite workspace database does not exist at ${dbPath}. Run npm run migrate:workspace during the planned maintenance window.`
    );
  }

  const db = openWorkspaceDb({ dbPath, readonly: true, migrate: false });
  try {
    const integrityRows = db.pragma("integrity_check");
    const integrityFailures = integrityRows
      .map((row) => String(Object.values(row)[0] || ""))
      .filter((value) => value.toLowerCase() !== "ok");

    if (integrityFailures.length) {
      throw new Error(`SQLite workspace integrity check failed: ${integrityFailures.join("; ")}`);
    }

    const foreignKeyFailures = db.pragma("foreign_key_check");
    if (foreignKeyFailures.length) {
      throw new Error(`SQLite workspace foreign-key check failed with ${foreignKeyFailures.length} issue(s).`);
    }

    const info = db.prepare("SELECT schema_version FROM workspace_info WHERE id = 1").get();
    const schemaVersion = Number(info?.schema_version || 0);
    if (schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
      throw new Error(
        `SQLite workspace schema version ${schemaVersion || "unknown"} is not compatible with required version `
        + `${WORKSPACE_SCHEMA_VERSION}.`
      );
    }

    return { schemaVersion };
  } finally {
    db.close();
  }
}

export function getWorkspaceStorageMode(env = globalThis.process?.env || {}) {
  const explicitMode = String(env.ELSET_WORKSPACE_STORAGE || "").trim().toLowerCase();
  if (explicitMode === "json" || explicitMode === "sqlite") {
    return explicitMode;
  }

  const dbPath = getWorkspaceDbPath(env);
  if (fs.existsSync(dbPath)) {
    return "sqlite";
  }

  const jsonPath = getJsonDataPath(env);
  if (isProductionRuntime(env) && hasNonEmptyJsonWorkspace(jsonPath)) {
    throw new Error(
      `SQLite workspace migration required. Found existing JSON workspace at ${jsonPath}, `
      + `but no SQLite workspace database at ${dbPath}. Run npm run migrate:workspace after taking a verified backup, `
      + "or set ELSET_WORKSPACE_STORAGE=json temporarily for the documented rollback mode."
    );
  }

  return "json";
}

export function assertProductionWorkspaceStorageReady(env = globalThis.process?.env || {}) {
  const dataDir = getWorkspaceDataDir(env);
  const dbPath = getWorkspaceDbPath(env);
  const jsonPath = getJsonDataPath(env);
  const explicitMode = String(env.ELSET_WORKSPACE_STORAGE || "").trim().toLowerCase();

  if (!isProductionRuntime(env)) {
    return getWorkspaceStorageStatus(env);
  }

  assertFlyDataDir(env, dataDir);
  assertExistingWritableDirectory(dataDir, "Persistent workspace data directory");

  if (explicitMode === "json") {
    if (!hasNonEmptyJsonWorkspace(jsonPath)) {
      throw new Error(
        `Production JSON rollback mode requires an existing non-empty workspace JSON file at ${jsonPath}.`
      );
    }
    return getWorkspaceStorageStatus(env);
  }

  if (explicitMode === "sqlite") {
    assertSqliteWorkspaceReady(dbPath);
    return getWorkspaceStorageStatus(env);
  }

  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new Error(
      `Production workspace storage is not initialized. Expected SQLite workspace database at ${dbPath}.`
    );
  }

  assertSqliteWorkspaceReady(dbPath);
  return getWorkspaceStorageStatus(env);
}

export function getWorkspaceReadinessStatus(env = globalThis.process?.env || {}) {
  try {
    const storage = assertProductionWorkspaceStorageReady(env);
    return {
      ok: true,
      storage,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Workspace storage is not ready.",
    };
  }
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
    quoteTemplate: normalized.quoteTemplate,
    invoiceTemplate: normalized.invoiceTemplate,
    settings: normalized.settings,
  };
}

export function loadWorkspaceState({ env = globalThis.process?.env || {} } = {}) {
  const mode = getWorkspaceStorageMode(env);
  if (mode === "json") {
    return loadData();
  }

  const db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), readonly: true, migrate: false });
  try {
    return normalizeStoredData(loadWorkspaceStateFromDb(db));
  } finally {
    db.close();
  }
}

export function getAuthorizedWorkspaceState(user, { env = globalThis.process?.env || {} } = {}) {
  const mode = getWorkspaceStorageMode(env);
  if (mode === "json") {
    return getAuthorizedJsonAppState(user);
  }

  return filterAuthorizedState(loadWorkspaceState({ env }), user);
}

export function saveAuthorizedWorkspaceState(user, incomingState, { env = globalThis.process?.env || {} } = {}) {
  const mode = getWorkspaceStorageMode(env);
  if (mode === "json") {
    return saveAuthorizedJsonAppState(user, incomingState);
  }

  throw new Error("Broad workspace saves are disabled in SQLite mode. Use record-specific workspace endpoints.");
}

export function saveWorkspaceState(nextData, { env = globalThis.process?.env || {} } = {}) {
  const mode = getWorkspaceStorageMode(env);
  if (mode === "json") {
    return saveData(nextData);
  }

  throw new Error("Broad workspace replacement is disabled in SQLite mode.");
}

export function getWorkspaceStorageStatus(env = globalThis.process?.env || {}) {
  const dataDir = getWorkspaceDataDir(env);
  const dbPath = getWorkspaceDbPath(env);
  const jsonPath = getJsonDataPath(env);
  return {
    mode: getWorkspaceStorageMode(env),
    dataDir,
    dbPath,
    jsonPath,
    sqliteExists: fs.existsSync(dbPath),
    jsonExists: fs.existsSync(jsonPath),
    jsonHasBusinessRecords: hasNonEmptyJsonWorkspace(jsonPath),
    rollbackMode: "Set ELSET_WORKSPACE_STORAGE=json to temporarily use the legacy JSON store.",
  };
}
