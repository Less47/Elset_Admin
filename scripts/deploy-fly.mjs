import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getBuildMetadata } from "./build-metadata.mjs";

export function deployFly({ args = [], env = process.env, readGit, run = spawnSync, now = () => new Date() } = {}) {
  // Capture the deployment start once. Never reuse a timestamp from a previous build.
  const { sha, buildTime } = getBuildMetadata({ env: { ...env, ELSET_BUILD_TIME: now().toISOString() }, readGit });
  if (!sha) {
    throw new Error("Cannot identify the source commit. Deploy from a Git checkout or set ELSET_BUILD_SHA to the source revision in CI.");
  }

  const result = run("flyctl", ["deploy", ...args, "--build-arg", `ELSET_BUILD_SHA=${sha}`, "--build-arg", `ELSET_BUILD_TIME=${buildTime}`], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = deployFly({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
