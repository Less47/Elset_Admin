import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertWorkspaceSchema, getWorkspaceDataDir, getWorkspaceDbPath, openWorkspaceDb } from "../server-workspace-db.js";
import { backfillSiteCoordinates } from "../server-site-location-tools.js";

export const PRODUCTION_DB_PATH = "/app/data/elset-workspace.db";
const usage = "Usage: node scripts/backfill-site-coordinates.mjs --dry-run|--execute [--limit 1-1000] [--retry-failed]";

// Only these authored errors may be printed. Never print provider/SQLite errors.
export class BackfillCommandError extends Error {}

export function parseBackfillArgs(args) {
  let mode, limit = null, retryFailed = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run" || arg === "--execute") {
      if (mode) throw new BackfillCommandError(usage);
      mode = arg;
    } else if (arg === "--limit") {
      const value = args[++index];
      if (limit !== null || !/^[1-9]\d{0,3}$/.test(value || "") || Number(value) > 1000) throw new BackfillCommandError(usage);
      limit = Number(value);
    } else if (arg === "--retry-failed" && !retryFailed) retryFailed = true;
    else throw new BackfillCommandError(usage);
  }
  if (!mode) throw new BackfillCommandError(usage);
  return { apply: mode === "--execute", limit, retryFailed };
}

export function resolveProductionBackfillDb({ env = process.env, output = console.log, platform = process.platform, filesystem = fs } = {}) {
  // Resolve through the running application's helper, never a CLI path or a copy.
  const dbPath = getWorkspaceDbPath(env);
  output(`Resolved workspace DB: ${dbPath}`);
  if (platform !== "linux" || env.FLY_APP_NAME !== "elset-admin" || !env.FLY_MACHINE_ID) {
    throw new BackfillCommandError("Run this command inside the deployed elset-admin Fly application Machine via fly ssh console.");
  }
  if (dbPath !== path.resolve(PRODUCTION_DB_PATH) || getWorkspaceDataDir(env) !== path.resolve("/app/data")) {
    throw new BackfillCommandError(`Refusing: the application resolver must select ${PRODUCTION_DB_PATH} on the persistent volume.`);
  }
  const storage = String(env.ELSET_WORKSPACE_STORAGE || "").trim().toLowerCase();
  if (storage && storage !== "sqlite") throw new BackfillCommandError("Refusing: the application must use SQLite workspace storage.");
  try {
    if (!filesystem.statSync(dbPath).isFile()) throw new Error();
    if (filesystem.realpathSync(dbPath) !== dbPath) throw new Error();
  } catch {
    throw new BackfillCommandError(`Refusing: expected production DB is missing, is not a regular file, or resolves elsewhere. Confirm the existing Fly volume is mounted at /app/data. No database will be created.`);
  }
  output("Verified existing production workspace DB.");
  return dbPath;
}

// Also used with synthetic temporary databases in tests; the CLI always applies
// resolveProductionBackfillDb first and exposes no local-path override.
export function openExistingBackfillDb(dbPath, { apply = false } = {}) {
  let db;
  try {
    // Even execution validates the existing schema on a read-only handle first.
    db = openWorkspaceDb({ dbPath, readonly: true, fileMustExist: true, migrate: false });
    db.pragma("query_only = ON");
    assertWorkspaceSchema(db);
    db.prepare("SELECT id, customer_id, address, extra_json FROM sites LIMIT 0").all();
    if (!apply) return db;
    db.close();
    db = openWorkspaceDb({ dbPath, fileMustExist: true, migrate: false });
    assertWorkspaceSchema(db);
    return db;
  } catch {
    if (db?.open) db.close();
    throw new BackfillCommandError("Refusing: could not open and validate the existing workspace database. Check the mounted file, permissions and deployed schema version. No schema initialization or migration is performed.");
  }
}

export async function backfillSiteCoordinatesCli(args = process.argv.slice(2), { env = process.env, output = console.log } = {}) {
  const options = parseBackfillArgs(args);
  const dbPath = resolveProductionBackfillDb({ env, output });
  if (options.apply && !env.GOOGLE_GEOCODING_API_KEY?.trim()) {
    throw new BackfillCommandError("GOOGLE_GEOCODING_API_KEY is required for --execute. Configure the separate server-side Fly secret.");
  }
  const db = openExistingBackfillDb(dbPath, options);
  try {
    const result = await backfillSiteCoordinates(db, {
      ...options,
      apiKey: env.GOOGLE_GEOCODING_API_KEY,
      onProgress: (progress) => {
        if (progress.phase === "geocoding") output(`Geocoding Site ${progress.processed} of ${progress.selectedSites}...`);
        else output(`Mapped: ${progress.saved}; skipped changed: ${progress.skippedChanged}; failed: ${progress.failed}`);
      },
    });
    output(JSON.stringify({ ...result, remainingEligible: result.eligibleSites - result.processed }, null, 2));
    return result.failed || result.stopped || result.invalidMetadata || result.skippedChanged ? 1 : 0;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await backfillSiteCoordinatesCli(); }
  catch (error) {
    console.error(error instanceof BackfillCommandError ? error.message : "Site coordinate backfill stopped. Database/provider details are suppressed to protect private data. Inspect aggregate progress and rerun --dry-run before continuing.");
    process.exitCode = 1;
  }
}
