import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getWorkspaceDataDir, getWorkspaceDbPath } from "../server-workspace-db.js";
import { backupSqliteDatabase, validateWorkspaceBackupDatabaseFile, writeChecksumSidecar } from "../server-workspace-backup.js";

function parseArgs(argv) {
  const options = {
    dataDir: "",
    db: "",
    output: "",
    includeAuth: false,
    includeFiles: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") {
      options.dataDir = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--db") {
      options.db = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--output") {
      options.output = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--include-auth") {
      options.includeAuth = true;
    } else if (arg === "--include-files") {
      options.includeFiles = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run backup:workspace -- [--data-dir path] [--db path] [--output path] [--include-auth] [--include-files]

Creates a local SQLite workspace backup. This command never connects to Fly.io.
`.trim());
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function copyRuntimeFiles(dataDir, backupDir) {
  const runtimeDirs = ["uploads", "generated-documents"];
  const copied = [];

  for (const dirName of runtimeDirs) {
    const sourceDir = path.join(dataDir, dirName);
    if (!fs.existsSync(sourceDir)) continue;

    const destinationDir = path.join(backupDir, dirName);
    fs.cpSync(sourceDir, destinationDir, { recursive: true });
    copied.push(dirName);
  }

  return copied;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const dataDir = path.resolve(options.dataDir || getWorkspaceDataDir(process.env));
  const sourceDbPath = path.resolve(options.db || getWorkspaceDbPath({ ...process.env, ELSET_DATA_DIR: dataDir }));
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Workspace SQLite database does not exist: ${sourceDbPath}`);
  }

  const backupRoot = path.resolve(options.output || path.join(dataDir, "backups"));
  const backupDir = path.join(backupRoot, `workspace-sqlite-${timestampSlug()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const workspaceBackupPath = path.join(backupDir, path.basename(sourceDbPath));
  await backupSqliteDatabase(sourceDbPath, workspaceBackupPath);
  const workspaceChecksum = writeChecksumSidecar(workspaceBackupPath);
  const validation = validateWorkspaceBackupDatabaseFile(workspaceBackupPath);

  const copiedFiles = options.includeFiles ? copyRuntimeFiles(dataDir, backupDir) : [];
  let authBackup = null;

  if (options.includeAuth) {
    const authDbPath = path.resolve(process.env.ELSET_AUTH_DB_PATH || path.join(dataDir, "auth.db"));
    if (!fs.existsSync(authDbPath)) throw new Error(`Requested authentication database does not exist: ${authDbPath}`);
    const authBackupPath = path.join(backupDir, path.basename(authDbPath));
    await backupSqliteDatabase(authDbPath, authBackupPath);
    const authDb = new Database(authBackupPath, { readonly: true, fileMustExist: true });
    try {
      if (authDb.pragma("integrity_check").some(row => Object.values(row)[0] !== "ok") || authDb.pragma("foreign_key_check").length) {
        throw new Error("Authentication backup validation failed.");
      }
    } finally { authDb.close(); }
    authBackup = {
      path: authBackupPath,
      sha256: writeChecksumSidecar(authBackupPath),
    };
  }

  const metadata = {
    format: "elset-workspace-sqlite-backup-v1",
    createdAt: new Date().toISOString(),
    sourceDbPath,
    workspace: {
      path: workspaceBackupPath,
      sha256: workspaceChecksum,
      schemaVersion: validation.schemaVersion,
      summary: validation.summary,
    },
    auth: authBackup,
    copiedRuntimeDirs: copiedFiles,
  };

  fs.writeFileSync(path.join(backupDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  console.log(`Workspace backup created: ${backupDir}`);
  console.log(`Workspace DB SHA-256: ${workspaceChecksum}`);
  console.log(`Customers: ${validation.summary.counts.customers}`);
  console.log(`Jobs: ${validation.summary.counts.jobs}`);
  console.log(`Invoices: ${validation.summary.counts.invoices}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
