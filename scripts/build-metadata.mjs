import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function shortSha(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{7,64}$/i.test(candidate) ? candidate.slice(0, 7).toLowerCase() : "";
}

// This is the entire public metadata allowlist. Never serialize the environment.
export function getBuildMetadata({ env = process.env, readGit = execFileSync } = {}) {
  const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  let commit = shortSha(env.ELSET_BUILD_SHA);

  if (env.ELSET_REQUIRE_BUILD_SHA === "true" && !commit) {
    throw new Error("Production image builds require ELSET_BUILD_SHA. Use npm run deploy:fly or pass the Git SHA as a Docker build argument.");
  }

  if (!commit) {
    try {
      commit = shortSha(readGit("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 2000,
        windowsHide: true,
      }));
    } catch {
      // Source archives and machines without Git can still run the application.
    }
  }

  return { version, commit: commit || "local" };
}
