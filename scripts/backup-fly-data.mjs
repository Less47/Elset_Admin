import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { createRuntimeSnapshot } from "./runtime-backup.mjs";
import { sha256File, validateWorkspaceBackupDatabaseFile, writeChecksumSidecar } from "../server-workspace-backup.js";

export function selectBackupMachine(machines, requestedId = "") {
  const candidates = machines.filter(machine => machine.state === "started"
    && machine.config?.mounts?.some(mount => mount.path === "/app/data"));
  const selected = requestedId ? candidates.find(machine => machine.id === requestedId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!selected) throw new Error("Select exactly one started Machine with the /app/data volume using --machine=<id>.");
  return selected;
}

export function remoteNodeCommand(code) {
  // Only base64 reaches command parsing; no user values become shell code.
  const encoded = Buffer.from(code).toString("base64");
  return `node --input-type=module -e 'await eval(Buffer.from("${encoded}","base64").toString())'`;
}

export function validateDownloadedSnapshot(snapshotDir) {
  const manifestPath = path.join(snapshotDir, "manifest.json");
  const expectedHash = fs.readFileSync(`${manifestPath}.sha256`, "utf8").trim().split(/\s+/)[0];
  if (sha256File(manifestPath) !== expectedHash) throw new Error("Snapshot manifest checksum mismatch.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== "elset-runtime-snapshot-v1" || !Array.isArray(manifest.files)) throw new Error("Invalid snapshot manifest.");
  const seen = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== "string" || !file.path || file.path.includes("\\") || file.path.includes(":")
      || path.posix.isAbsolute(file.path) || file.path.split("/").some(part => !part || part === "." || part === "..")
      || seen.has(file.path)) throw new Error("Unsafe or duplicate snapshot path.");
    seen.add(file.path);
    let current = snapshotDir;
    for (const part of file.path.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Snapshot contains a symbolic link.");
    }
    if (!fs.statSync(current).isFile() || fs.statSync(current).size !== file.sizeBytes || sha256File(current) !== file.sha256) {
      throw new Error(`Snapshot file validation failed: ${file.path}`);
    }
  }
  for (const required of ["elset-workspace.db", "auth.db", "metadata.json"]) {
    if (!seen.has(required)) throw new Error(`Snapshot is missing ${required}.`);
  }
  function checkInventory(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) checkInventory(path.join(directory, entry.name), `${relative}/`);
      else if (!entry.isFile() || (!seen.has(relative) && !["manifest.json", "manifest.json.sha256"].includes(relative))) {
        throw new Error("Snapshot contains an unlisted or special file.");
      }
    }
  }
  checkInventory(snapshotDir);
  const metadata = JSON.parse(fs.readFileSync(path.join(snapshotDir, "metadata.json"), "utf8"));
  const workspace = validateWorkspaceBackupDatabaseFile(path.join(snapshotDir, "elset-workspace.db"), {
    expectedSha256: metadata.workspace?.sha256, expectedSummary: metadata.workspace?.summary,
  });
  const authPath = path.join(snapshotDir, "auth.db");
  if (sha256File(authPath) !== metadata.auth?.sha256) throw new Error("Authentication snapshot checksum mismatch.");
  const auth = new Database(authPath, { readonly: true, fileMustExist: true });
  try {
    if (auth.pragma("integrity_check").some(row => Object.values(row)[0] !== "ok") || auth.pragma("foreign_key_check").length) {
      throw new Error("Authentication snapshot integrity/relationship validation failed.");
    }
    for (const table of ["user", "account", "session", "verification"]) {
      if (auth.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count !== metadata.auth.counts?.[table]) {
        throw new Error("Authentication snapshot summary mismatch.");
      }
    }
  } finally { auth.close(); }
  return { ok: true, workspace: workspace.summary, auth: metadata.auth.counts, copiedRuntimeDirs: metadata.copiedRuntimeDirs };
}

export async function backupFlyData({ appName = process.env.FLY_APP || "elset-admin", machineId = "", outputRoot = "backups",
  run = (command, args) => execFileSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 }),
  log = console.log,
} = {}) {
  const machine = selectBackupMachine(JSON.parse(await run("flyctl", ["machines", "list", "-a", appName, "--json"])), machineId);
  const id = crypto.randomUUID();
  const remoteRoot = `/tmp/elset-fly-backup-${id}`;
  const backupDir = path.resolve(outputRoot, `fly-${new Date().toISOString().replace(/[:.]/g, "-")}-${id.slice(0, 8)}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const snapshotDir = path.join(backupDir, "snapshot");
  const common = ["-a", appName, "--machine", machine.id, "--quiet"];
  const config = { moduleDir: "/app", dataDir: "/app/data", outputDir: remoteRoot,
    source: { type: "fly-snapshot", app: appName, machine: machine.id, image: machine.config?.image || "" } };
  try {
    log(`Creating SQLite snapshots on Machine ${machine.id}...`);
    await run("flyctl", ["ssh", "console", ...common, "--command", remoteNodeCommand(
      `(${createRuntimeSnapshot.toString()})({ ...${JSON.stringify(config)}, workspaceDbPath: process.env.ELSET_WORKSPACE_DB_PATH || '/app/data/elset-workspace.db', authDbPath: process.env.ELSET_AUTH_DB_PATH || '/app/data/auth.db' })`
    )]);
    await run("flyctl", ["ssh", "sftp", "get", ...common, "--recursive", `${remoteRoot}/snapshot`, snapshotDir]);
    const validation = validateDownloadedSnapshot(snapshotDir);
    const validationPath = path.join(backupDir, "validation.json");
    fs.writeFileSync(validationPath, JSON.stringify(validation, null, 2));
    writeChecksumSidecar(validationPath);
    const archivePath = `${backupDir}.tar.gz`;
    await run("tar", ["-czf", archivePath, "-C", path.dirname(backupDir), path.basename(backupDir)]);
    const checksum = writeChecksumSidecar(archivePath);
    log(`Validated backup: ${backupDir}\nArchive: ${archivePath}\nSHA-256: ${checksum}`);
    log(JSON.stringify(validation, null, 2));
    return { backupDir, archivePath, checksum, validation };
  } finally {
    // Only this exact generated temporary path is removed, never /app/data.
    const cleanup = `import('node:fs').then(fs => fs.rmSync(${JSON.stringify(remoteRoot)}, { recursive: true, force: true }))`;
    try { await run("flyctl", ["ssh", "console", ...common, "--command", remoteNodeCommand(cleanup)]); }
    catch { log(`Temporary snapshot cleanup failed. Remove only ${remoteRoot} on Machine ${machine.id}.`); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("npm run backup:fly -- [--machine=<id>] [--app=<name>] [--output=<directory>]\nCreates validated workspace/auth SQLite snapshots and includes uploads/generated-documents. Does not copy live WAL/SHM files or restore any data.");
  } else {
    const unknown = args.find(arg => !/^--(?:machine|app|output)=.+/.test(arg));
    if (unknown) { console.error(`Unknown argument: ${unknown}`); process.exitCode = 1; }
    else {
      const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
      backupFlyData({ appName: option("app"), machineId: option("machine"), outputRoot: option("output") })
        .catch(() => { console.error("Fly backup failed; no validated backup was reported. Check Fly access, volume availability and local output. Partial files are retained for diagnosis."); process.exitCode = 1; });
    }
  }
}
