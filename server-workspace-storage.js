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
import { getWorkspaceDataDir, getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
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
