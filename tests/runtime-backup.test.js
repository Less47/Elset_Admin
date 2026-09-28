import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { createRuntimeSnapshot } from "../scripts/runtime-backup.mjs";
import { backupFlyData, selectBackupMachine, validateDownloadedSnapshot } from "../scripts/backup-fly-data.mjs";
import { writeChecksumSidecar } from "../server-workspace-backup.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "elset-runtime-backup-"));
  const dataDir = path.join(root, "data"); fs.mkdirSync(dataDir);
  const workspace = openWorkspaceDb({ dbPath: path.join(dataDir, "elset-workspace.db") });
  importWorkspaceJsonData(workspace, JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8")));
  workspace.pragma("wal_autocheckpoint = 0");
  workspace.prepare("UPDATE customers SET name=?").run("Committed WAL customer");
  const auth = new Database(path.join(dataDir, "auth.db"));
  auth.pragma("journal_mode = WAL"); auth.pragma("wal_autocheckpoint = 0");
  auth.exec('CREATE TABLE user(id TEXT PRIMARY KEY); CREATE TABLE account(id TEXT PRIMARY KEY, userId TEXT REFERENCES user(id), password TEXT); CREATE TABLE session(id TEXT PRIMARY KEY); CREATE TABLE verification(id TEXT PRIMARY KEY);');
  auth.prepare('INSERT INTO user VALUES (?)').run("synthetic-user");
  auth.prepare('INSERT INTO account VALUES (?,?,?)').run("synthetic-account", "synthetic-user", "do-not-print-password-hash");
  fs.mkdirSync(path.join(dataDir, "uploads"));
  fs.writeFileSync(path.join(dataDir, "uploads", "synthetic.txt"), "Synthetic external attachment");
  t.after(() => { workspace.close(); auth.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dataDir, workspace, auth };
}

test("runtime snapshot includes committed WAL data in independent recoverable workspace/auth databases and checksums external files", async t => {
  const f = fixture(t);
  const result = await createRuntimeSnapshot({ moduleDir: repo, dataDir: f.dataDir, outputDir: path.join(f.root, "backup") });
  const validation = validateDownloadedSnapshot(result.snapshotDir);
  assert.equal(validation.ok, true); assert.equal(validation.auth.user, 1);
  assert.deepEqual(validation.copiedRuntimeDirs, ["uploads"]);
  assert.equal(fs.existsSync(path.join(result.snapshotDir, "auth.db-wal")), false);
  const snapshot = new Database(path.join(result.snapshotDir, "elset-workspace.db"), { readonly: true });
  try { assert.equal(snapshot.prepare("SELECT name FROM customers").get().name, "Committed WAL customer"); }
  finally { snapshot.close(); }
  assert.equal(f.auth.prepare("SELECT password FROM account").get().password, "do-not-print-password-hash");
  fs.appendFileSync(path.join(result.snapshotDir, "uploads", "synthetic.txt"), "corruption");
  assert.throws(() => validateDownloadedSnapshot(result.snapshotDir), /validation failed/);
});

test("backup fails when auth is missing and never recreates it", async t => {
  const f = fixture(t), missing = path.join(f.dataDir, "missing-auth.db");
  await assert.rejects(createRuntimeSnapshot({ moduleDir: repo, dataDir: f.dataDir, authDbPath: missing, outputDir: path.join(f.root, "missing") }), /does not exist/);
  assert.equal(fs.existsSync(missing), false);
});

test("download validation rejects unsafe paths and altered manifest data", async t => {
  const f = fixture(t);
  const { snapshotDir } = await createRuntimeSnapshot({ moduleDir: repo, dataDir: f.dataDir, outputDir: path.join(f.root, "paths") });
  const manifest = path.join(snapshotDir, "manifest.json");
  const payload = JSON.parse(fs.readFileSync(manifest, "utf8"));
  payload.files.push({ path: "../outside", sizeBytes: 0, sha256: "" });
  fs.writeFileSync(manifest, JSON.stringify(payload));
  assert.throws(() => validateDownloadedSnapshot(snapshotDir), /manifest checksum mismatch/);
  writeChecksumSidecar(manifest);
  assert.throws(() => validateDownloadedSnapshot(snapshotDir), /Unsafe or duplicate/);
});

test("Fly backup pins snapshot, download and cleanup to one mounted machine and validates before creating an archive", async t => {
  const f = fixture(t), calls = [], logs = [];
  const machine = { id: "synthetic-machine", state: "started", config: { mounts: [{ path: "/app/data" }], image: "synthetic-image" } };
  assert.throws(() => selectBackupMachine([machine, { ...machine, id: "other" }]), /Select exactly one/);
  assert.throws(() => selectBackupMachine([{ ...machine, state: "stopped" }], machine.id), /Select exactly one/);
  assert.equal(selectBackupMachine([machine], machine.id).id, machine.id);
  const localRemote = path.join(f.root, "remote");
  const run = async (command, args) => {
    calls.push({ command, args });
    if (command === "tar") return execFileSync(command, args, { encoding: "utf8", windowsHide: true });
    if (args[0] === "machines") return JSON.stringify([machine]);
    assert.equal(args[args.indexOf("--machine") + 1], machine.id);
    if (args.includes("console")) {
      const remote = args[args.indexOf("--command") + 1];
      const code = Buffer.from(remote.match(/Buffer.from\("([^"]+)"/)[1], "base64").toString();
      if (code.startsWith("import('node:fs')")) { assert.match(code, /\/tmp\/elset-fly-backup-/); assert.doesNotMatch(code, /\/app\/data/); return ""; }
      const localCode = code.replace('"moduleDir":"/app"', `"moduleDir":${JSON.stringify(repo)}`)
        .replace('"dataDir":"/app/data"', `"dataDir":${JSON.stringify(f.dataDir)}`)
        .replace(/"outputDir":"[^"]+"/, `"outputDir":${JSON.stringify(localRemote)}`)
        .replace("process.env.ELSET_WORKSPACE_DB_PATH || '/app/data/elset-workspace.db'", JSON.stringify(path.join(f.dataDir, "elset-workspace.db")))
        .replace("process.env.ELSET_AUTH_DB_PATH || '/app/data/auth.db'", JSON.stringify(path.join(f.dataDir, "auth.db")));
      await new Function(`return ${localCode}`)();
      return "";
    }
    assert.ok(args.includes("--recursive"));
    fs.cpSync(path.join(localRemote, "snapshot"), args.at(-1), { recursive: true });
    return "";
  };
  const result = await backupFlyData({ appName: "synthetic-app", outputRoot: path.join(f.root, "download"), run, log: value => logs.push(value) });
  assert.equal(result.validation.ok, true); assert.ok(fs.statSync(result.archivePath).size > 0);
  assert.match(fs.readFileSync(`${result.archivePath}.sha256`, "utf8"), new RegExp(result.checksum));
  assert.doesNotMatch(logs.join("\n"), /do-not-print-password-hash/);
  assert.equal(calls.filter(call => call.args.includes("console")).length, 2);
});
