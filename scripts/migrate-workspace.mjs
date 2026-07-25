import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { openWorkspaceDb, getWorkspaceDataDir, getWorkspaceDbPath, migrateWorkspaceSchema } from "../server-workspace-db.js";
import { importWorkspaceJsonData, sha256Hex } from "../server-workspace-importer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const options = {
    dryRun: false,
    source: "",
    db: "",
    dataDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--source") {
      options.source = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--db") {
      options.db = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--data-dir") {
      options.dataDir = argv[index + 1] || "";
      index += 1;
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
  npm run migrate:workspace -- [--dry-run] [--source path/to/app-data.json] [--db path/to/elset-workspace.db] [--data-dir path]

This command never connects to Fly.io and never deletes or renames the source JSON file.
`.trim());
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function createJsonBackup(sourcePath, dataDir) {
  const backupDir = path.join(dataDir, "backups", `workspace-json-before-sqlite-${timestampSlug()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, backupPath);
  const contents = fs.readFileSync(backupPath);
  const checksum = sha256Hex(contents);
  fs.writeFileSync(`${backupPath}.sha256`, `${checksum}  ${path.basename(backupPath)}\n`, "utf8");
  return { backupDir, backupPath, checksum };
}

function formatCents(cents) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(Number(cents || 0));
  return `${sign}$${(absolute / 100).toFixed(2)}`;
}

function printReport(report, { dryRun, sourcePath, dbPath, backup }) {
  const counts = report.dbSummary.counts;
  const financials = report.dbSummary.financials;
  console.log("");
  console.log(dryRun ? "Workspace migration dry run passed." : "Workspace migration completed.");
  console.log(`Source JSON: ${sourcePath}`);
  console.log(`SQLite DB: ${dryRun ? "(temporary in-memory dry run)" : dbPath}`);
  console.log(`Source SHA-256: ${report.sourceJsonSha256}`);
  if (backup) {
    console.log(`Backup copy: ${backup.backupPath}`);
    console.log(`Backup SHA-256: ${backup.checksum}`);
  }
  console.log("");
  console.log("Imported counts:");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("");
  console.log("Financial validation:");
  console.log(`  quote totals: ${formatCents(financials.quoteTotalsCents)}`);
  console.log(`  invoice totals: ${formatCents(financials.invoiceTotalsCents)}`);
  console.log(`  payments: ${formatCents(financials.paymentTotalsCents)}`);
  console.log(`  outstanding balances: ${formatCents(financials.outstandingBalanceCents)}`);
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const dataDir = path.resolve(options.dataDir || getWorkspaceDataDir(process.env));
  const sourcePath = path.resolve(options.source || path.join(dataDir, "app-data.json"));
  const dbPath = path.resolve(options.db || getWorkspaceDbPath({ ...process.env, ELSET_DATA_DIR: dataDir }));

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Workspace JSON file does not exist: ${sourcePath}`);
  }

  const sourceContents = fs.readFileSync(sourcePath, "utf8");
  let rawData;
  try {
    rawData = JSON.parse(sourceContents.charCodeAt(0) === 0xFEFF ? sourceContents.slice(1) : sourceContents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new Error(`Unable to parse ${sourcePath}: ${message}`);
  }

  const sourceJsonSha256 = sha256Hex(sourceContents);

  if (options.dryRun) {
    const db = new Database(":memory:");
    migrateWorkspaceSchema(db);
    const report = importWorkspaceJsonData(db, rawData, { sourceJsonSha256 });
    printReport(report, { dryRun: true, sourcePath, dbPath });
    db.close();
    return;
  }

  const backup = createJsonBackup(sourcePath, dataDir);
  const db = openWorkspaceDb({ dbPath });
  try {
    const report = importWorkspaceJsonData(db, rawData, { sourceJsonSha256 });
    printReport(report, { dryRun: false, sourcePath, dbPath, backup });
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
