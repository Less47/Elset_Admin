import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { initializeWorkspaceStorage, getWorkspaceReadinessStatus, loadWorkspaceState } from "../server-workspace-storage.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
function setup(t, { workspace = true, legacy = true, mode } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-sqlite-only-"));
  const dbPath = path.join(dir, "elset-workspace.db"), jsonPath = path.join(dir, "app-data.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (workspace) { const db = openWorkspaceDb({ dbPath }); try { importWorkspaceJsonData(db, fixture); } finally { db.close(); } }
  if (legacy) fs.writeFileSync(jsonPath, JSON.stringify({ ...fixture, settings: { companyName: "Historical JSON must be ignored" } }));
  const env = { ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", ELSET_DATA_DIR: dir,
    ELSET_WORKSPACE_DB_PATH: dbPath, ELSET_AUTH_DB_PATH: path.join(dir, "auth.db"), BETTER_AUTH_SECRET: "synthetic-runtime-test-secret-123456789",
    // Deliberately hostile retired configuration: it must never select JSON.
    ELSET_WORKSPACE_STORAGE: mode || "json" };
  return { dir, dbPath, jsonPath, env };
}

test("valid SQLite initializes and reads while historical JSON and retired mode selection are ignored", t => {
  const f = setup(t);
  const before = fs.readFileSync(f.jsonPath);
  assert.equal(initializeWorkspaceStorage(f.env).dbPath, f.dbPath);
  assert.equal(getWorkspaceReadinessStatus(f.env).ok, true);
  assert.equal(loadWorkspaceState({ env: f.env }).settings.companyName, fixture.settings.companyName);
  assert.deepEqual(fs.readFileSync(f.jsonPath), before);
});

for (const legacy of [false, true]) test(`missing SQLite refuses startup/readiness/read, even with JSON present=${legacy}`, t => {
  const f = setup(t, { workspace: false, legacy });
  for (const nodeEnv of ["development", "test", "production"]) {
    const env = { ...f.env, NODE_ENV: nodeEnv };
    assert.throws(() => initializeWorkspaceStorage(env), /Refusing to start without the SQLite workspace database/);
    assert.equal(getWorkspaceReadinessStatus(env).ok, false);
    assert.throws(() => loadWorkspaceState({ env }), /Workspace database not found/);
  }
  const result = spawnSync(process.execPath, ["server.js"], { cwd: repo, env: f.env, encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Workspace database not found/);
  assert.doesNotMatch(result.stdout, /listening/);
  assert.equal(fs.existsSync(f.dbPath), false);
  assert.equal(fs.existsSync(f.jsonPath), legacy);
});

for (const kind of ["corrupt", "empty", "future-schema", "missing-table"]) test(`startup and readiness fail closed for ${kind} SQLite`, t => {
  const f = setup(t, { workspace: !["corrupt", "empty"].includes(kind) });
  if (kind === "corrupt") fs.writeFileSync(f.dbPath, "not a SQLite database");
  else {
    const db = new Database(f.dbPath);
    if (kind === "future-schema") db.pragma("user_version = 9999");
    if (kind === "missing-table") db.exec("DROP TABLE job_notes");
    db.close();
  }
  assert.throws(() => initializeWorkspaceStorage(f.env));
  assert.equal(getWorkspaceReadinessStatus(f.env).ok, false);
});

test("running server uses SQLite APIs, rejects broad/JSON restores, and leaves historical JSON and auth untouched by workspace restore", async t => {
  const f = setup(t);
  const seed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { auth, ensureAuthReady } = await import('./server-auth.js');
    await ensureAuthReady();
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({ email: 'runtime@example.test', emailVerified: true,
      name: 'Runtime Test', username: 'runtimeadmin', displayUsername: 'Runtime Test', role: 'admin', workspaceRole: 'admin', staffId: '' });
    await context.internalAdapter.linkAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password: await context.password.hash('Synthetic-test-123') });
  `], { cwd: repo, env: f.env, encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.equal(seed.status, 0, seed.stderr);
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], { cwd: repo, env: { ...f.env, ELSET_API_PORT: String(port), PORT: String(port), BETTER_AUTH_URL: base, ELSET_FRONTEND_URL: base }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  try {
    let ready = false;
    for (let i = 0; i < 150 && child.exitCode === null; i++) {
      try { ready = (await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) })).ok; } catch { /* Starting. */ }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, output);
    const login = await fetch(base + "/api/auth/sign-in/username", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ username: "runtimeadmin", password: "Synthetic-test-123" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const request = async (route, method = "GET", body) => {
      const response = await fetch(base + route, { method, headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    };
    const beforeJson = fs.readFileSync(f.jsonPath);
    const initial = await request("/api/app-state");
    assert.equal(initial.response.status, 200);
    assert.equal(initial.payload.storageMode, undefined);
    assert.equal(initial.payload.state.customers.length, 1);
    const backup = await request("/api/admin/data-backup");
    assert.equal(backup.response.status, 200);
    assert.equal(backup.payload.backup.format, "elset-workspace-sqlite-backup-v1");
    assert.equal((await request("/api/settings", "PATCH", { settings: { companyName: "Targeted SQLite write" } })).response.status, 200);
    assert.equal(loadWorkspaceState({ env: f.env }).settings.companyName, "Targeted SQLite write");
    assert.equal((await request("/api/app-state", "PUT", initial.payload.state)).response.status, 404);
    assert.equal((await request("/api/admin/data-backup/restore", "POST", { backupData: fixture, restorePassword: "Synthetic-test-123" })).response.status, 404);
    const restoreBody = { backupData: backup.payload, restorePassword: "Synthetic-test-123", dryRun: true };
    assert.equal((await request("/api/admin/workspace-restore", "POST", restoreBody)).response.status, 200);
    assert.equal((await request("/api/admin/workspace-restore", "POST", { ...restoreBody, backupData: fixture })).response.status, 400);
    const authRows = () => {
      const db = new Database(f.env.ELSET_AUTH_DB_PATH, { readonly: true });
      try { return ["user", "account", "session"].map(table => db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()); }
      finally { db.close(); }
    };
    const authBefore = authRows();
    assert.equal((await request("/api/admin/workspace-restore", "POST", { ...restoreBody, dryRun: false })).response.status, 200);
    assert.deepEqual(authRows(), authBefore);
    assert.equal(loadWorkspaceState({ env: f.env }).settings.companyName, fixture.settings.companyName);
    assert.deepEqual(fs.readFileSync(f.jsonPath), beforeJson);
    assert.equal((await request("/api/auth/me")).response.status, 200);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
  }
});
