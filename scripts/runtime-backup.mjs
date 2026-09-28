// Self-contained so backup:fly can execute this helper on the currently deployed
// machine without installing new code or importing auth (which starts services).
export async function createRuntimeSnapshot({ moduleDir, dataDir, outputDir, workspaceDbPath, authDbPath, source = {} }) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { createRequire } = await import("node:module");
  const require = createRequire(path.join(moduleDir, "package.json"));
  const Database = require("better-sqlite3");
  const { createWorkspaceSqliteBackup, backupSqliteDatabase, validateWorkspaceBackupDatabaseFile, writeChecksumSidecar, sha256File } =
    await import(pathToFileURL(path.join(moduleDir, "server-workspace-backup.js")));
  if (fs.existsSync(outputDir)) throw new Error("Snapshot destination already exists.");
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const backup = await createWorkspaceSqliteBackup({
    sourceDbPath: workspaceDbPath || path.join(dataDir, "elset-workspace.db"), outputRoot: outputDir,
    backupName: "snapshot", includeSourcePath: false,
  });
  // Also support the currently deployed backup helper, whose output may retain
  // WAL mode. Change only the snapshots, then recompute their checksums.
  function makeStandalone(filename) {
    const copy = new Database(filename, { fileMustExist: true });
    try { copy.pragma("journal_mode = DELETE"); } finally { copy.close(); }
  }
  makeStandalone(backup.workspaceBackupPath);
  const workspaceSha256 = writeChecksumSidecar(backup.workspaceBackupPath);
  const workspaceValidation = validateWorkspaceBackupDatabaseFile(backup.workspaceBackupPath, { expectedSha256: workspaceSha256 });
  const authPath = path.join(backup.backupDir, "auth.db");
  await backupSqliteDatabase(authDbPath || path.join(dataDir, "auth.db"), authPath);
  makeStandalone(authPath);
  const auth = new Database(authPath, { readonly: true, fileMustExist: true });
  let authSummary;
  try {
    const integrity = auth.pragma("integrity_check");
    if (integrity.some(row => Object.values(row)[0] !== "ok") || auth.pragma("foreign_key_check").length) {
      throw new Error("Authentication snapshot integrity/relationship validation failed.");
    }
    authSummary = Object.fromEntries(["user", "account", "session", "verification"].map(table =>
      [table, auth.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count]));
  } finally { auth.close(); }
  const copiedRuntimeDirs = [];
  function copyDirectory(from, to) {
    if (!fs.lstatSync(from).isDirectory()) throw new Error("Runtime backup paths must be ordinary directories.");
    fs.mkdirSync(to, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const sourcePath = path.join(from, entry.name), targetPath = path.join(to, entry.name);
      if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
      else if (entry.isFile()) fs.copyFileSync(sourcePath, targetPath);
      else throw new Error("Runtime backup cannot follow symbolic links or special files.");
    }
  }
  for (const name of ["uploads", "generated-documents"]) {
    const from = path.join(dataDir, name);
    if (fs.existsSync(from)) { copyDirectory(from, path.join(backup.backupDir, name)); copiedRuntimeDirs.push(name); }
  }
  const metadata = {
    ...backup.metadata, source,
    workspace: { path: "elset-workspace.db", sha256: workspaceSha256, sizeBytes: workspaceValidation.sizeBytes,
      schemaVersion: workspaceValidation.schemaVersion, summary: workspaceValidation.summary },
    auth: {
      path: "auth.db", sizeBytes: fs.statSync(authPath).size,
      sha256: writeChecksumSidecar(authPath), integrity: "ok", counts: authSummary,
    }, copiedRuntimeDirs,
    consistency: "Each database is an independent SQLite online backup. External files are copied after database snapshots; pause application writes for a coordinated recovery point.",
  };
  const metadataPath = path.join(backup.backupDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  writeChecksumSidecar(metadataPath);
  const files = [];
  function inventory(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name, absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) inventory(absolute, `${relative}/`);
      else files.push({ path: relative, sizeBytes: fs.statSync(absolute).size, sha256: sha256File(absolute) });
    }
  }
  inventory(backup.backupDir);
  const manifestPath = path.join(backup.backupDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ format: "elset-runtime-snapshot-v1", files }, null, 2));
  writeChecksumSidecar(manifestPath);
  return { snapshotDir: backup.backupDir, metadata };
}
