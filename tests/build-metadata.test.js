import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";
import { getBuildMetadata } from "../scripts/build-metadata.mjs";
import { deployFly } from "../scripts/deploy-fly.mjs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const sha = "a31f82e123456789012345678901234567890123456";
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
  assert.deepEqual(metadata, { version, commit: "a31f82e" });
});

test("a validated build argument works without Git and takes precedence", () => {
  assert.deepEqual(getBuildMetadata({
    env: { ELSET_BUILD_SHA: ` ${sha.toUpperCase()} `, ELSET_REQUIRE_BUILD_SHA: "true" },
    readGit: () => assert.fail("An explicit revision should not invoke Git"),
  }), { version, commit: "a31f82e" });
});

test("missing Git metadata has a safe local fallback", () => {
  assert.deepEqual(getBuildMetadata({ env: {}, readGit: noGit }), { version, commit: "local" });
  assert.deepEqual(getBuildMetadata({ env: {}, readGit: () => "" }), { version, commit: "local" });
});

test("invalid revision values cannot leak environment values or error details", () => {
  for (const invalid of ["", "private-token-do-not-expose", "/private/build/path", "a31f82e<script>", "abcdef", "f".repeat(65)]) {
    assert.deepEqual(getBuildMetadata({
      env: { ELSET_BUILD_SHA: invalid, SMTP_PASS: "private-smtp-password", BETTER_AUTH_SECRET: "private-auth-secret" },
      readGit: noGit,
    }), { version, commit: "local" });
  }
  assert.equal(getBuildMetadata({ env: { ELSET_BUILD_SHA: "invalid" }, readGit: () => sha }).commit, "a31f82e");
});

test("public build metadata contains only version and commit", () => {
  const env = { ELSET_BUILD_SHA: sha, FLY_API_TOKEN: "private-fly-token", SMTP_PASS: "private-password", BUILD_PATH: "/private/path" };
  const metadata = getBuildMetadata({ env, readGit: noGit });
  assert.deepEqual(Object.keys(metadata), ["version", "commit"]);
  assert.deepEqual(metadata, { version, commit: "a31f82e" });
});

test("Vite defines only the public metadata object", async () => {
  const { config } = await loadConfigFromFile({ command: "build", mode: "test" }, fileURLToPath(new URL("../vite.config.js", import.meta.url)));
  assert.deepEqual(Object.keys(config.define), ["__ELSET_BUILD__"]);
  const metadata = JSON.parse(config.define.__ELSET_BUILD__);
  assert.equal(metadata.version, version);
  assert.match(metadata.commit, /^(?:[a-f0-9]{7}|local)$/);
  assert.deepEqual(Object.keys(metadata), ["version", "commit"]);
});

test("production images reject a missing or malformed build argument", () => {
  for (const value of [undefined, "", "invalid"]) {
    assert.throws(() => getBuildMetadata({
      env: { ELSET_REQUIRE_BUILD_SHA: "true", ELSET_BUILD_SHA: value },
      readGit: noGit,
    }), /Production image builds require ELSET_BUILD_SHA/);
  }
});

test("Fly deployment automatically forwards the source SHA as a build argument", () => {
  let calls = 0;
  const exitCode = deployFly({
    args: ["-a", "elset-admin", "--remote-only"],
    env: {},
    readGit: () => sha,
    run(command, args, options) {
      calls += 1;
      assert.equal(command, "flyctl");
      assert.deepEqual(args, ["deploy", "-a", "elset-admin", "--remote-only", "--build-arg", "ELSET_BUILD_SHA=a31f82e"]);
      assert.equal(options.stdio, "inherit");
      assert.equal(options.windowsHide, true);
      return { status: 17 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(exitCode, 17);
});

test("an unidentified revision never starts a Fly deployment", () => {
  assert.throws(() => deployFly({
    env: {},
    readGit: noGit,
    run: () => assert.fail("Fly must not be invoked"),
  }), /Cannot identify the source commit/);
});

test("Fly launcher errors and interrupted runs are reported as failures", () => {
  assert.throws(() => deployFly({
    env: { ELSET_BUILD_SHA: sha },
    run: () => ({ error: new Error("flyctl is not installed") }),
  }), /flyctl is not installed/);
  assert.equal(deployFly({ env: { ELSET_BUILD_SHA: sha }, run: () => ({ status: null }) }), 1);
});
