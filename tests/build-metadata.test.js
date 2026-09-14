import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";
import { getBuildMetadata } from "../scripts/build-metadata.mjs";
import { deployFly } from "../scripts/deploy-fly.mjs";
import { formatBuildTime } from "../src/lib/build-info.js";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const sha = "a31f82e123456789012345678901234567890123456";
const buildTime = "2026-09-10T05:42:00.000Z";
const localMetadata = { version, commit: "local", sha: "", buildTime: "" };
const googleMapsApiKey = "maps-build-test-fixture-not-a-real-key";
const noGit = () => { throw new Error("Git is unavailable at a private filesystem path"); };

test("build metadata reads the package version and current Git revision", () => {
  const metadata = getBuildMetadata({
    env: {},
    readGit(command, args, options) {
      assert.equal(command, "git");
      assert.deepEqual(args, ["rev-parse", "--verify", "HEAD"]);
      assert.equal(options.timeout, 2000);
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
      return `${sha}\n`;
    },
  });
  assert.deepEqual(metadata, { version, commit: "a31f82e", sha, buildTime: "" });
});

test("a validated build argument works without Git and takes precedence", () => {
  assert.deepEqual(getBuildMetadata({
    env: { ELSET_BUILD_SHA: ` ${sha.toUpperCase()} `, ELSET_BUILD_TIME: buildTime, ELSET_REQUIRE_BUILD_SHA: "true" },
    readGit: () => assert.fail("An explicit revision should not invoke Git"),
  }), { version, commit: "a31f82e", sha, buildTime });
});

test("missing Git metadata has a safe local fallback", () => {
  assert.deepEqual(getBuildMetadata({ env: {}, readGit: noGit }), localMetadata);
  assert.deepEqual(getBuildMetadata({ env: {}, readGit: () => "" }), localMetadata);
});

test("invalid revision values cannot leak environment values or error details", () => {
  for (const invalid of ["", "private-token-do-not-expose", "/private/build/path", "a31f82e<script>", "abcdef", "f".repeat(65)]) {
    assert.deepEqual(getBuildMetadata({
      env: { ELSET_BUILD_SHA: invalid, SMTP_PASS: "private-smtp-password", BETTER_AUTH_SECRET: "private-auth-secret" },
      readGit: noGit,
    }), localMetadata);
  }
  assert.equal(getBuildMetadata({ env: { ELSET_BUILD_SHA: "invalid" }, readGit: () => sha }).commit, "a31f82e");
});

test("public build metadata contains only version, short/full SHA and build time", () => {
  const env = { ELSET_BUILD_SHA: sha, ELSET_BUILD_TIME: buildTime, VITE_GOOGLE_MAPS_API_KEY: googleMapsApiKey, FLY_API_TOKEN: "private-fly-token", SMTP_PASS: "private-password", BUILD_PATH: "/private/path" };
  const metadata = getBuildMetadata({ env, readGit: noGit });
  assert.deepEqual(Object.keys(metadata), ["version", "commit", "sha", "buildTime"]);
  assert.deepEqual(metadata, { version, commit: "a31f82e", sha, buildTime });
});

test("Vite defines only the public metadata object", async () => {
  const { config } = await loadConfigFromFile({ command: "build", mode: "test" }, fileURLToPath(new URL("../vite.config.js", import.meta.url)));
  assert.deepEqual(Object.keys(config.define), ["__ELSET_BUILD__"]);
  const metadata = JSON.parse(config.define.__ELSET_BUILD__);
  assert.equal(metadata.version, version);
  assert.match(metadata.commit, /^(?:[a-f0-9]{7}|local)$/);
  assert.deepEqual(Object.keys(metadata), ["version", "commit", "sha", "buildTime"]);
});

test("production images reject a missing or malformed build argument", () => {
  for (const value of [undefined, "", "invalid"]) {
    assert.throws(() => getBuildMetadata({
      env: { ELSET_REQUIRE_BUILD_SHA: "true", ELSET_BUILD_SHA: value },
      readGit: noGit,
    }), /Production image builds require ELSET_BUILD_SHA/);
  }
});

test("Fly deployment forwards the Google key, full source SHA and one fresh UTC timestamp as separate arguments", () => {
  let calls = 0;
  let clockReads = 0;
  const exitCode = deployFly({
    args: ["-a", "elset-admin", "--remote-only"],
    env: { VITE_GOOGLE_MAPS_API_KEY: ` ${googleMapsApiKey} `, ELSET_BUILD_TIME: "2000-01-01T00:00:00.000Z" },
    readGit: () => sha,
    now: () => { clockReads += 1; return new Date(buildTime); },
    run(command, args, options) {
      calls += 1;
      assert.equal(command, "flyctl");
      assert.deepEqual(args, ["deploy", "-a", "elset-admin", "--remote-only", "--build-arg", `ELSET_BUILD_SHA=${sha}`, "--build-arg", `ELSET_BUILD_TIME=${buildTime}`, "--build-arg", `VITE_GOOGLE_MAPS_API_KEY=${googleMapsApiKey}`]);
      assert.equal(options.shell, undefined);
      assert.equal(options.stdio, "inherit");
      assert.equal(options.windowsHide, true);
      return { status: 17 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(clockReads, 1);
  assert.equal(exitCode, 17);
});

test("an unidentified revision never starts a Fly deployment", () => {
  assert.throws(() => deployFly({
    env: { VITE_GOOGLE_MAPS_API_KEY: googleMapsApiKey },
    readGit: noGit,
    run: () => assert.fail("Fly must not be invoked"),
  }), /Cannot identify the source commit/);
});

test("Fly launcher errors and interrupted runs are reported as failures", () => {
  assert.throws(() => deployFly({
    env: { ELSET_BUILD_SHA: sha, VITE_GOOGLE_MAPS_API_KEY: googleMapsApiKey },
    run: () => ({ error: new Error("flyctl is not installed") }),
  }), /flyctl is not installed/);
  assert.equal(deployFly({ env: { ELSET_BUILD_SHA: sha, VITE_GOOGLE_MAPS_API_KEY: googleMapsApiKey }, run: () => ({ status: null }) }), 1);
});

test("production images require a valid unambiguous UTC build time", () => {
  for (const invalid of [undefined, "", "not-a-date", "10 Sep 2026 3:42 PM", "2026-09-10T05:42:00", "2026-09-10T15:42:00+10:00", "2026-02-30T05:42:00Z", "2026-09-10T25:00:00Z"]) {
    assert.throws(() => getBuildMetadata({
      env: { ELSET_REQUIRE_BUILD_SHA: "true", ELSET_BUILD_SHA: sha, ELSET_BUILD_TIME: invalid },
      readGit: noGit,
    }), /Production image builds require ELSET_BUILD_TIME/);
    assert.equal(getBuildMetadata({ env: { ELSET_BUILD_TIME: invalid }, readGit: noGit }).buildTime, "");
  }
  assert.equal(getBuildMetadata({ env: { ELSET_BUILD_TIME: " 2026-09-10T05:42:00Z " }, readGit: noGit }).buildTime, buildTime);
});

test("redeploying the same commit uses a new timestamp without modifying the package version", () => {
  const deployments = [];
  for (const time of [buildTime, "2026-09-11T06:43:00.000Z"]) {
    deployFly({ env: { ELSET_BUILD_SHA: sha, VITE_GOOGLE_MAPS_API_KEY: googleMapsApiKey }, now: () => new Date(time), run: (_command, args) => { deployments.push(args); return { status: 0 }; } });
  }
  assert.equal(deployments[0][2], deployments[1][2]);
  assert.notEqual(deployments[0][4], deployments[1][4]);
  assert.equal(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, version);
});

test("build time formatting uses the injected instant and the display locale/timezone", () => {
  assert.deepEqual(formatBuildTime(buildTime, { locale: "en-AU", timeZone: "Australia/Sydney" }), { date: "10 Sept 2026", time: "3:42 pm" });
  assert.deepEqual(formatBuildTime(buildTime, { locale: "en-AU", timeZone: "Australia/Sydney", compact: true }), { date: "10/09/26", time: "3:42 pm" });
  assert.deepEqual(formatBuildTime(buildTime, { locale: "en-US", timeZone: "UTC" }), { date: "Sep 10, 2026", time: "5:42 AM" });
  assert.equal(formatBuildTime(""), null);
  assert.equal(formatBuildTime("invalid"), null);
});

test("missing or blank Google key fails before reading metadata or invoking Fly", () => {
  for (const value of [undefined, "", "   \t\n"]) {
    assert.throws(() => deployFly({
      env: { VITE_GOOGLE_MAPS_API_KEY: value },
      now: () => assert.fail("Missing-key validation must happen first"),
      readGit: () => assert.fail("Git must not be invoked"),
      run: () => assert.fail("Fly must not be invoked"),
    }), /VITE_GOOGLE_MAPS_API_KEY is required for production Google Maps builds/);
  }
});

test("CLI reports a missing Google key with a nonzero exit without deploying", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/deploy-fly.mjs", import.meta.url))], {
    env: { ...process.env, VITE_GOOGLE_MAPS_API_KEY: "" }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^VITE_GOOGLE_MAPS_API_KEY is required for production Google Maps builds\./);
});

test("CLI keeps normal output without logging its key or interpreting shell characters", () => {
  // Replace the built-in runner before the real CLI imports it. Fly cannot run.
  const preload = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    childProcess.spawnSync = (command, args, options) => {
      if (command !== "flyctl" || options.shell || !args.includes("VITE_GOOGLE_MAPS_API_KEY=" + process.env.VITE_GOOGLE_MAPS_API_KEY)) {
        throw new Error("Unexpected deployment invocation");
      }
      console.log("Simulated Fly build completed");
      return { status: 0 };
    };
    syncBuiltinESMExports();
  `;
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, fileURLToPath(new URL("../scripts/deploy-fly.mjs", import.meta.url))], {
    env: { ...process.env, ELSET_BUILD_SHA: sha, VITE_GOOGLE_MAPS_API_KEY: `${googleMapsApiKey} & $(not-a-command) "quoted"` },
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "Simulated Fly build completed");
  assert.equal(result.stderr, "");
  assert.equal(`${result.stdout}${result.stderr}`.includes(googleMapsApiKey), false);
});

test("Docker makes the Google build argument available before the SHA-required Vite build", () => {
  const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ARG ELSET_BUILD_SHA\r?\nARG ELSET_BUILD_TIME\r?\nARG VITE_GOOGLE_MAPS_API_KEY\r?\nENV VITE_GOOGLE_MAPS_API_KEY=\$VITE_GOOGLE_MAPS_API_KEY\r?\nRUN ELSET_REQUIRE_BUILD_SHA=true npm run build/);
  assert.equal(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts["deploy:fly"], "node scripts/deploy-fly.mjs");
});

test("production Vite build embeds the supplied Google argument and preserves SHA/time without logging the key", () => {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const outDir = path.join(repoRoot, "test-results/google-maps-build-env");
  let buildEnv;
  deployFly({
    env: { ELSET_BUILD_SHA: sha, VITE_GOOGLE_MAPS_API_KEY: googleMapsApiKey },
    now: () => new Date(buildTime),
    run(_command, args) {
      buildEnv = Object.fromEntries(args.flatMap((arg, index) => arg === "--build-arg" ? [args[index + 1].split(/=(.*)/s).slice(0, 2)] : []));
      return { status: 0 };
    },
  });
  const result = spawnSync(process.execPath, [path.join(repoRoot, "node_modules/vite/bin/vite.js"), "build", "--outDir", outDir], {
    cwd: repoRoot,
    env: { ...process.env, ...buildEnv, ELSET_REQUIRE_BUILD_SHA: "true", FLY_API_TOKEN: "non-public-build-test-token" },
    encoding: "utf8", windowsHide: true, timeout: 60_000,
  });
  assert.equal(result.status, 0, "The production Vite build must succeed");
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes(googleMapsApiKey), false);
  const assets = path.join(outDir, "assets");
  const bundle = fs.readdirSync(assets).filter((name) => name.endsWith(".js")).map((name) => fs.readFileSync(path.join(assets, name), "utf8")).join("\n");
  assert.equal(bundle.includes(googleMapsApiKey), true, "The browser bundle must contain the supplied test key");
  assert.equal(bundle.includes(sha), true);
  assert.equal(bundle.includes(buildTime), true);
  assert.equal(bundle.includes("non-public-build-test-token"), false);
});
