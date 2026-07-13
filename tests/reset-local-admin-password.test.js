import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertSafeLocalResetEnvironment,
  resolveLocalAuthDbPath,
  validatePasswordPair,
} from "../scripts/reset-local-admin-password.mjs";

test("local admin reset resolves the default auth database path", () => {
  const root = path.join("tmp", "elset-test-root");
  assert.equal(
    resolveLocalAuthDbPath({ env: {}, root }),
    path.resolve(root, "data", "auth.db")
  );
});

test("local admin reset honours explicit auth database path", () => {
  const explicitPath = path.join("tmp", "custom-auth.db");
  assert.equal(
    resolveLocalAuthDbPath({ env: { ELSET_AUTH_DB_PATH: explicitPath }, root: "/unused" }),
    path.resolve(explicitPath)
  );
});

test("local admin reset refuses production and Fly environments", () => {
  assert.throws(
    () => assertSafeLocalResetEnvironment({ env: { NODE_ENV: "production" }, authDbPath: "/tmp/auth.db" }),
    /NODE_ENV=production/
  );
  assert.throws(
    () => assertSafeLocalResetEnvironment({ env: { FLY_APP_NAME: "elset-admin" }, authDbPath: "/tmp/auth.db" }),
    /Fly\.io/
  );
  assert.throws(
    () => assertSafeLocalResetEnvironment({ env: {}, authDbPath: "/app/data/auth.db" }),
    /Fly persistent volume/
  );
});

test("local admin reset validates matching passwords and minimum length", () => {
  assert.equal(validatePasswordPair("secret1", "secret1", 6), "secret1");
  assert.throws(
    () => validatePasswordPair("short", "short", 6),
    /at least 6 characters/
  );
  assert.throws(
    () => validatePasswordPair("secret1", "secret2", 6),
    /did not match/
  );
});
