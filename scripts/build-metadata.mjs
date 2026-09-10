import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function normalizeSha(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{7,64}$/i.test(candidate) ? candidate.toLowerCase() : "";
}

function normalizeBuildTime(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(candidate)) return "";
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime())) return "";
  const canonical = date.toISOString();
  const normalized = candidate.includes(".") ? candidate : candidate.replace("Z", ".000Z");
  return canonical === normalized ? canonical : "";
}

// This is the entire public metadata allowlist. Never serialize the environment.
export function getBuildMetadata({ env = process.env, readGit = execFileSync } = {}) {
  const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  let sha = normalizeSha(env.ELSET_BUILD_SHA);
  const buildTime = normalizeBuildTime(env.ELSET_BUILD_TIME);

  if (env.ELSET_REQUIRE_BUILD_SHA === "true" && !sha) {
    throw new Error("Production image builds require ELSET_BUILD_SHA. Use npm run deploy:fly or pass the Git SHA as a Docker build argument.");
  }
  if (env.ELSET_REQUIRE_BUILD_SHA === "true" && !buildTime) {
    throw new Error("Production image builds require ELSET_BUILD_TIME as a UTC ISO timestamp. Use npm run deploy:fly or pass the build time as a Docker build argument.");
  }

  if (!sha) {
    try {
      sha = normalizeSha(readGit("git", ["rev-parse", "--verify", "HEAD"], {
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

  return { version, commit: sha ? sha.slice(0, 7) : "local", sha, buildTime };
}
