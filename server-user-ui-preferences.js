import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getWorkspaceDataDir, getWorkspaceDbPath } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";
import { appearanceSettingKeys, normalizeUserUiPreferences, validateUserUiPreferencePatch, UserUiPreferenceError } from "./src/lib/user-ui-preferences.js";

const repoDir = path.dirname(fileURLToPath(import.meta.url));
export function getUserPreferencesDbPath(env = process.env) {
  return path.resolve(env.ELSET_AUTH_DB_PATH || path.join(env.ELSET_DATA_DIR || path.join(repoDir, "data"), "auth.db"));
}

// ELSET owns this migration ledger and table. Better Auth's schema/user_version
// are untouched; no foreign key or trigger is added to its managed tables.
export function migrateUserPreferencesSchema(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS elset_account_schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
      );
    `);
    if (db.prepare("SELECT 1 FROM elset_account_schema_migrations WHERE version = 1").get()) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_ui_preferences (
        user_id TEXT PRIMARY KEY NOT NULL,
        preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO elset_account_schema_migrations (version, name, applied_at) VALUES (1, ?, ?)")
      .run("user-ui-preferences", new Date().toISOString());
  }).immediate();
}

export function openUserPreferencesDb({ env = process.env, migrate = false } = {}) {
  const dbPath = getUserPreferencesDbPath(env);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    if (migrate) migrateUserPreferencesSchema(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

export function readLegacyAppearance(env = process.env) {
  if (getWorkspaceStorageMode(env) === "sqlite") {
    const db = new Database(getWorkspaceDbPath(env), { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(`SELECT key, value_json FROM settings WHERE key IN (${appearanceSettingKeys.map(() => "?").join(",")})`).all(...appearanceSettingKeys);
      return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]));
    } finally { db.close(); }
  }
  const filename = path.join(getWorkspaceDataDir(env), "app-data.json");
  return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")).settings || {} : {};
}

function assertUserId(userId) {
  if (typeof userId !== "string" || !userId.trim() || userId.length > 256) {
    throw new UserUiPreferenceError("Authentication required.", 401);
  }
}

export function getUserUiPreferences(db, userId, fallback = () => ({})) {
  assertUserId(userId);
  const row = db.prepare("SELECT preferences_json FROM user_ui_preferences WHERE user_id = ?").get(userId);
  return row ? normalizeUserUiPreferences(JSON.parse(row.preferences_json)) : normalizeUserUiPreferences(fallback());
}

export function patchUserUiPreferences(db, userId, input, fallback = () => ({})) {
  assertUserId(userId);
  const patch = validateUserUiPreferencePatch(input);
  return db.transaction(() => {
    // The first save snapshots the existing appearance; later narrow patches
    // merge against this account's row, never a client's full stale snapshot.
    const preferences = { ...getUserUiPreferences(db, userId, fallback), ...patch };
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO user_ui_preferences (user_id, preferences_json, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
      preferences_json = excluded.preferences_json, updated_at = excluded.updated_at`)
      .run(userId, JSON.stringify(preferences), timestamp, timestamp);
    return preferences;
  }).immediate();
}
