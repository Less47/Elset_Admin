import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import express from "express";
import { createUserPreferencesRouter } from "../server-user-preferences-routes.js";
import { createSettingsRouter } from "../server-settings-routes.js";
import { openUserPreferencesDb, migrateUserPreferencesSchema, getUserUiPreferences, patchUserUiPreferences } from "../server-user-ui-preferences.js";
import { defaultUserUiPreferences, validateUserUiPreferencePatch, normalizeUserUiPreferences, appearanceSettingKeys } from "../src/lib/user-ui-preferences.js";
import { defaultWorkspaceSettings, workspaceUiSettingKeys } from "../server-workspace-setting-keys.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-user-preferences-"));
  const env = { ELSET_DATA_DIR: dir, ELSET_WORKSPACE_STORAGE: "sqlite" };
  const db = openWorkspaceDb({ dbPath: path.join(dir, "elset-workspace.db") });
  const data = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
  data.settings = { ...data.settings, actionColor: "#123456", companyName: "Shared company" };
  importWorkspaceJsonData(db, data);
  db.close();
  return { dir, env, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("personal schema matches legacy appearance defaults and strictly validates its allowlist", () => {
  assert.deepEqual(appearanceSettingKeys, workspaceUiSettingKeys);
  for (const key of appearanceSettingKeys) assert.equal(defaultUserUiPreferences[key], defaultWorkspaceSettings[key]);
  assert.deepEqual(validateUserUiPreferencePatch({ actionColor: "#abc", contentDensity: "compact" }), { actionColor: "#AABBCC", contentDensity: "compact" });
  for (const input of [null, [], {}, { userId: "B" }, { companyName: "Private company" }, { theme: { accent: "#abc" } },
    { actionColor: "url(evil)" }, { sidebarWidth: "enormous" }, { contentDensity: "dense" }, { customerView: "compact" },
    { boardToDoSort: "unknown" }, { boardShowTagLabels: "true" }, { boardHiddenColumns: ["Completed"] },
    JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: {} }, { prototype: {} }]) {
    assert.throws(() => validateUserUiPreferencePatch(input));
  }
  assert.equal({}.polluted, undefined);
  assert.equal(normalizeUserUiPreferences({ actionColor: "invalid" }).actionColor, defaultUserUiPreferences.actionColor);
});

test("additive account migration leaves an existing auth schema and workspace intact", () => {
  const f = fixture();
  let auth;
  try {
    auth = new Database(path.join(f.dir, "auth.db"));
    auth.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE "session" (id TEXT PRIMARY KEY, userId TEXT);');
    auth.prepare('INSERT INTO "user" VALUES (?, ?)').run("opaque-existing-account", "Existing account");
    const schema = auth.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
    const workspaceBefore = fs.readFileSync(path.join(f.dir, "elset-workspace.db"));
    migrateUserPreferencesSchema(auth);
    migrateUserPreferencesSchema(auth);
    for (const row of schema) assert.equal(auth.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(row.name).sql, row.sql);
    assert.deepEqual(auth.prepare('SELECT * FROM "user"').all(), [{ id: "opaque-existing-account", name: "Existing account" }]);
    assert.equal(auth.prepare("SELECT count(*) AS n FROM elset_account_schema_migrations").get().n, 1);
    assert.equal(auth.prepare("SELECT count(*) AS n FROM user_ui_preferences").get().n, 0);
    assert.deepEqual(fs.readFileSync(path.join(f.dir, "elset-workspace.db")), workspaceBefore);
  } finally { auth?.close(); f.cleanup(); }
});

test("retired column visibility is ignored on read and removed on the next preference save", () => {
  const f = fixture();
  const db = openUserPreferencesDb({ env: f.env, migrate: true });
  try {
    const previous = { ...defaultUserUiPreferences, boardHiddenColumns: ["Completed"], boardToDoView: "grid", boardCompletedSort: "oldest" };
    db.prepare("INSERT INTO user_ui_preferences (user_id, preferences_json, created_at, updated_at) VALUES ('A', ?, '2026-01-01', '2026-01-01')").run(JSON.stringify(previous));
    const current = getUserUiPreferences(db, "A");
    assert.equal(Object.hasOwn(current, "boardHiddenColumns"), false);
    assert.equal(current.boardToDoView, "grid");
    assert.equal(current.boardCompletedSort, "oldest");
    patchUserUiPreferences(db, "A", { boardShowTagLabels: true });
    const stored = JSON.parse(db.prepare("SELECT preferences_json FROM user_ui_preferences WHERE user_id='A'").get().preferences_json);
    assert.deepEqual(stored, { ...current, boardShowTagLabels: true });
  } finally { db.close(); f.cleanup(); }
});

test("fresh users get fallback without a row; partial upserts isolate users and survive a reopened connection", () => {
  const f = fixture();
  let db;
  try {
    db = openUserPreferencesDb({ env: f.env, migrate: true });
    const fallback = () => ({ actionColor: "#123456", companyName: "never stored" });
    assert.equal(getUserUiPreferences(db, "A", fallback).actionColor, "#123456");
    assert.equal(db.prepare("SELECT count(*) AS n FROM user_ui_preferences").get().n, 0);
    patchUserUiPreferences(db, "A", { actionColor: "#ff8800", customerView: "grid" }, fallback);
    patchUserUiPreferences(db, "B", { actionColor: "#0077ff" }, fallback);
    const firstCreated = db.prepare("SELECT created_at FROM user_ui_preferences WHERE user_id='A'").get().created_at;
    patchUserUiPreferences(db, "A", { contentDensity: "compact" }, fallback);
    assert.equal(db.prepare("SELECT count(*) AS n FROM user_ui_preferences").get().n, 2);
    assert.equal(db.prepare("SELECT created_at FROM user_ui_preferences WHERE user_id='A'").get().created_at, firstCreated);
    db.close();
    db = openUserPreferencesDb({ env: f.env });
    assert.equal(getUserUiPreferences(db, "A").actionColor, "#FF8800");
    assert.equal(getUserUiPreferences(db, "A").customerView, "grid");
    assert.equal(getUserUiPreferences(db, "B").actionColor, "#0077FF");
    assert.equal(getUserUiPreferences(db, "B").contentDensity, "comfortable");
    assert.equal(Object.hasOwn(getUserUiPreferences(db, "A"), "companyName"), false);
    const before = getUserUiPreferences(db, "A");
    assert.throws(() => patchUserUiPreferences(db, "A", { actionColor: "#fff", userId: "B" }));
    assert.deepEqual(getUserUiPreferences(db, "A"), before);
    assert.throws(() => patchUserUiPreferences(db, "", { actionColor: "#fff" }), /Authentication/);
  } finally { db?.close(); f.cleanup(); }
});

async function withApi(run, mode = "sqlite") {
  const f = fixture();
  f.env.ELSET_WORKSPACE_STORAGE = mode;
  if (mode === "json") fs.writeFileSync(path.join(f.dir, "app-data.json"), JSON.stringify({ settings: { actionColor: "#654321" } }));
  const app = express();
  app.use(express.json());
  const users = { a: { id: "opaque-user-A", role: "admin" }, b: { id: "opaque-user-B", role: "office" }, tech: { id: "opaque-tech", role: "technician" } };
  const requireAuth = (req, res, next) => {
    req.user = users[req.headers["x-test-session"]];
    return req.user ? next() : res.status(401).json({ error: "Authentication required." });
  };
  app.use(createUserPreferencesRouter({ env: f.env, requireAuth }));
  app.use(createSettingsRouter({ env: f.env, requireAuth, requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const api = async (user, method = "GET", body, pathname = "/api/user-preferences") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, { method,
      headers: { "Content-Type": "application/json", ...(user ? { "x-test-session": user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})), cache: response.headers.get("cache-control") };
  };
  try { await run(api, f); } finally { await new Promise((resolve) => server.close(resolve)); f.cleanup(); }
}

test("preference API authenticates, rejects identity spoofing and exposes only the current account", async () => withApi(async (api) => {
  assert.equal((await api(null)).status, 401);
  assert.equal((await api(null, "PATCH", { actionColor: "#fff" })).status, 401);
  assert.equal((await api("a", "GET", undefined, "/api/user-preferences?userId=opaque-user-B")).status, 400);
  assert.equal((await api("a", "PATCH", { userId: "opaque-user-B", actionColor: "#fff" })).status, 400);
  assert.equal((await api("a", "PATCH", JSON.parse('{"__proto__":{},"actionColor":"#fff"}'))).status, 400);
  assert.equal((await api("a")).body.preferences.actionColor, "#123456");
  await api("a", "PATCH", { actionColor: "#ff8800" });
  assert.equal((await api("b")).body.preferences.actionColor, "#123456");
  await api("b", "PATCH", { actionColor: "#0077ff" });
  assert.equal((await api("a")).body.preferences.actionColor, "#FF8800");
  assert.equal((await api("b")).body.preferences.actionColor, "#0077FF");
  const technician = await api("tech", "PATCH", { sidebarWidth: "compact" });
  assert.equal(technician.status, 200);
  assert.equal(technician.body.preferences.sidebarWidth, "compact");
  assert.equal(technician.cache, "private, no-store");
  assert.deepEqual(Object.keys(technician.body), ["ok", "preferences"]);
}));

test("shared company settings stay shared while global theme writes and reset are rejected", async () => withApi(async (api, f) => {
  const db = openWorkspaceDb({ dbPath: path.join(f.dir, "elset-workspace.db") });
  try {
    const original = loadWorkspaceStateFromDb(db);
    await api("a", "PATCH", { actionColor: "#ff8800" });
    assert.deepEqual(loadWorkspaceStateFromDb(db), original);
    assert.equal((await api("a", "PATCH", { settings: { actionColor: "#fff", companyName: "Must not apply" } }, "/api/settings")).status, 400);
    assert.equal((await api("a", "POST", { group: "ui" }, "/api/settings/reset")).status, 400);
    assert.deepEqual(loadWorkspaceStateFromDb(db), original);
    const shared = await api("a", "PATCH", { settings: { companyName: "Company for everyone" } }, "/api/settings");
    assert.equal(shared.status, 200);
    const b = await api("b", "PATCH", { settings: { companyPhone: "0400 000 000" } }, "/api/settings");
    assert.equal(b.body.state.settings.companyName, "Company for everyone");
    assert.equal(b.body.state.settings.actionColor, "#123456");
    assert.equal((await api("tech", "PATCH", { settings: { companyName: "Forbidden" } }, "/api/settings")).status, 403);
    assert.deepEqual(loadWorkspaceStateFromDb(db).jobs, original.jobs);
  } finally { db.close(); }
}));

test("legacy JSON installations also persist account preferences in the auth database", async () => withApi(async (api, f) => {
  const before = fs.readFileSync(path.join(f.dir, "app-data.json"));
  assert.equal((await api("a")).body.preferences.actionColor, "#654321");
  await api("a", "PATCH", { actionColor: "#abc" });
  assert.equal((await api("a")).body.preferences.actionColor, "#AABBCC");
  assert.equal((await api("b")).body.preferences.actionColor, "#654321");
  assert.deepEqual(fs.readFileSync(path.join(f.dir, "app-data.json")), before);
}, "json"));

test("legacy broad workspace saves preserve the global appearance fallback while sharing company changes", () => {
  const f = fixture();
  try {
    const data = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
    data.settings = { ...data.settings, actionColor: "#123456" };
    fs.writeFileSync(path.join(f.dir, "app-data.json"), JSON.stringify(data));
    const script = `
      import assert from "node:assert/strict";
      const { getAuthorizedAppState, saveAuthorizedAppState } = await import(${JSON.stringify(new URL("../server-store.js", import.meta.url).href)});
      const a = { id: "A", role: "admin" };
      const original = getAuthorizedAppState(a);
      const incoming = structuredClone(original);
      incoming.settings.actionColor = "#FF8800";
      incoming.settings.contentDensity = "compact";
      incoming.settings.companyName = "Shared JSON company";
      saveAuthorizedAppState(a, incoming);
      const b = getAuthorizedAppState({ id: "B", role: "office" });
      assert.equal(b.settings.actionColor, "#123456");
      assert.equal(b.settings.contentDensity, original.settings.contentDensity);
      assert.equal(b.settings.companyName, "Shared JSON company");
      assert.deepEqual(b.jobs, original.jobs);
      assert.deepEqual(b.customers, original.customers);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, ...f.env, ELSET_WORKSPACE_STORAGE: "json", NODE_ENV: "test", FLY_APP_NAME: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { f.cleanup(); }
});
