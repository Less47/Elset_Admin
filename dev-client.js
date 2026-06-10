import { execFileSync, spawn } from "child_process";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPort = Number(process.env.ELSET_FRONTEND_PORT || 5173);
const repoRoot = __dirname;
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function getListeningPids(port) {
  if (process.platform === "win32") {
    const output = runCommand("powershell", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
    ]);

    return Array.from(new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => Number(line))
        .filter((pid) => Number.isInteger(pid) && pid > 0)
    ));
  }

  const output = runCommand("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => Number(line))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function getProcessCommandLine(pid) {
  if (!Number.isFinite(pid)) return "";

  if (process.platform === "win32") {
    return runCommand("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ]);
  }

  return runCommand("ps", ["-p", String(pid), "-o", "command="]);
}

function normalizeForMatch(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function isRepoViteProcess(commandLine) {
  const normalizedCommandLine = normalizeForMatch(commandLine);
  const normalizedRepoRoot = normalizeForMatch(repoRoot);

  return normalizedCommandLine.includes("/vite/bin/vite.js")
    && normalizedCommandLine.includes(normalizedRepoRoot);
}

function isPortListening(port) {
  return getListeningPids(port).length > 0;
}

async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function stopExistingRepoVite(port) {
  const pids = getListeningPids(port);
  if (pids.length === 0) return;

  const staleVitePids = [];

  for (const pid of pids) {
    const commandLine = getProcessCommandLine(pid);
    if (!isRepoViteProcess(commandLine)) {
      console.error(`Port ${port} is already in use by another process.`);
      console.error(`PID ${pid}: ${commandLine || "Unknown command line"}`);
      process.exit(1);
    }

    staleVitePids.push(pid);
  }

  for (const pid of staleVitePids) {
    console.log(`Stopping stale Vite process on port ${port} (PID ${pid})...`);

    try {
      process.kill(pid);
    } catch {
      // Ignore race conditions if the process exits before we signal it.
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isPortListening(port)) return;
    await wait(250);
  }

  for (const pid of staleVitePids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore race conditions if the process exits before we signal it.
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isPortListening(port)) return;
    await wait(250);
  }

  console.error(`Port ${port} is still in use after stopping the previous Vite process.`);
  process.exit(1);
}

async function start() {
  await stopExistingRepoVite(frontendPort);

  const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : "Unable to start Vite.");
    process.exit(1);
  });
}

start();
