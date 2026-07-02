import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const appName = process.env.FLY_APP || "elset-admin";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.resolve(process.cwd(), "backups");
const backupDir = path.join(backupRoot, `fly-${timestamp}`);
const files = ["app-data.json", "auth.db", "auth.db-wal", "auth.db-shm"];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

function getRemoteFile(fileName) {
  const localPath = path.join(backupDir, fileName);
  run("flyctl", ["ssh", "sftp", "get", "-a", appName, `/app/data/${fileName}`, localPath], { stdio: "inherit" });
}

function getWorkspaceSummary() {
  const dataPath = path.join(backupDir, "app-data.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const count = (value) => (Array.isArray(value) ? value.length : 0);

  return {
    customers: count(data.customers),
    jobs: count(data.jobs),
    staff: count(data.staff),
    inventoryItems: count(data.inventoryItems),
    maintenancePlans: count(data.maintenancePlans),
    deletedJobs: count(data.deletedJobs),
    deletedCustomers: count(data.deletedCustomers),
    updatedAt: data.meta?.updatedAt || null,
  };
}

function createArchive() {
  const archivePath = `${backupDir}.tar.gz`;
  run("tar", ["-czf", archivePath, "-C", backupRoot, path.basename(backupDir)]);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  fs.writeFileSync(`${archivePath}.sha256`, `${hash}  ${path.basename(archivePath)}\n`, "utf8");
  return { archivePath, hash };
}

fs.mkdirSync(backupDir, { recursive: true });

for (const file of files) {
  getRemoteFile(file);
}

const summary = getWorkspaceSummary();
fs.writeFileSync(path.join(backupDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const { archivePath, hash } = createArchive();

console.log(`Backup saved to ${backupDir}`);
console.log(`Archive: ${archivePath}`);
console.log(`SHA-256: ${hash}`);
console.log(JSON.stringify(summary, null, 2));
