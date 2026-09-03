import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import {
  assertSafeLocalCreateEnvironment,
  validatePasswordPair,
} from "../scripts/create-local-admin.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const createScriptPath = path.join(repoRoot, "scripts", "create-local-admin.mjs");
const serverAuthUrl = pathToFileURL(path.join(repoRoot, "server-auth.js")).href;
const testPassword = "local-admin-test-password";
const resultPrefix = "__ELSET_TEST_RESULT__";

function createTempDataDir(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "elset-create-local-admin-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  return tempDir;
}

function buildChildEnv(tempDir, overrides = {}) {
  const childEnv = {
    ...process.env,
    NODE_ENV: "test",
    ELSET_DATA_DIR: tempDir,
    ELSET_AUTH_DB_PATH: path.join(tempDir, "auth.db"),
    ELSET_WORKSPACE_STORAGE: "sqlite",
    BETTER_AUTH_SECRET: "local-admin-test-secret-at-least-32-characters",
    ELSET_TEST_SERVER_AUTH_URL: serverAuthUrl,
    ...overrides,
  };

  delete childEnv.FLY_APP_NAME;
  if (Object.prototype.hasOwnProperty.call(overrides, "FLY_APP_NAME")) {
    childEnv.FLY_APP_NAME = overrides.FLY_APP_NAME;
  }

  return childEnv;
}

function runNodeScenario(source, env) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024,
  });

  assert.equal(result.status, 0, `Child process failed.\n${result.stdout || ""}${result.stderr || ""}`);
  const resultLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith(resultPrefix));
  assert.ok(resultLine, `Child process did not emit a result.\n${result.stdout || ""}${result.stderr || ""}`);
  return JSON.parse(resultLine.slice(resultPrefix.length));
}

function runCreateCommand(tempDir, { env = {}, input = "" } = {}) {
  return spawnSync(process.execPath, [createScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: buildChildEnv(tempDir, env),
    input,
    maxBuffer: 1024 * 1024,
  });
}

test("local admin bootstrap refuses production, Fly, and Fly-volume environments", (t) => {
  const tempDir = createTempDataDir(t);
  const authDbPath = path.join(tempDir, "auth.db");

  const productionResult = runCreateCommand(tempDir, {
    env: { NODE_ENV: "production" },
  });
  assert.notEqual(productionResult.status, 0);
  assert.match(productionResult.stderr, /NODE_ENV=production/);
  assert.equal(fs.existsSync(authDbPath), false);

  const flyResult = runCreateCommand(tempDir, {
    env: { FLY_APP_NAME: "elset-admin" },
  });
  assert.notEqual(flyResult.status, 0);
  assert.match(flyResult.stderr, /Fly\.io/);
  assert.equal(fs.existsSync(authDbPath), false);

  const flyVolumeResult = runCreateCommand(tempDir, {
    env: { ELSET_AUTH_DB_PATH: "/app/data/auth.db" },
  });
  assert.notEqual(flyVolumeResult.status, 0);
  assert.match(flyVolumeResult.stderr, /Fly persistent volume/);
  assert.equal(fs.existsSync(authDbPath), false);

  assert.throws(
    () => assertSafeLocalCreateEnvironment({ env: { FLY_APP_NAME: "" }, authDbPath }),
    /Fly\.io/
  );
  assert.throws(
    () => assertSafeLocalCreateEnvironment({ env: {}, authDbPath: "/app/data" }),
    /Fly persistent volume/
  );
  assert.throws(
    () => assertSafeLocalCreateEnvironment({ env: {}, authDbPath: "/app/data/nested/auth.db" }),
    /Fly persistent volume/
  );
});

test("local admin bootstrap shows the auth path and requires exact confirmation before creating it", (t) => {
  const tempDir = createTempDataDir(t);
  const authDbPath = path.join(tempDir, "auth.db");
  const result = runCreateCommand(tempDir, { input: "DO NOT CREATE\n" });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ELSET Admin local admin bootstrap/);
  assert.ok(result.stdout.includes(authDbPath));
  assert.match(result.stdout, /CREATE LOCAL ADMIN/);
  assert.match(result.stderr, /Confirmation phrase did not match/);
  assert.equal(fs.existsSync(authDbPath), false);
});

test("local admin bootstrap validates matching passwords against the application minimum", () => {
  assert.equal(validatePasswordPair("secret1", "secret1", 6), "secret1");
  assert.throws(
    () => validatePasswordPair("short", "short", 6),
    /at least 6 characters/
  );
  assert.throws(
    () => validatePasswordPair("secret1", "secret2", 6),
    /did not match/
  );
  assert.throws(
    () => validatePasswordPair("secret1", "secret1", Number.NaN),
    /Password policy is not available/
  );
});

test("local admin bootstrap creates one valid Better Auth admin when the user count is zero", (t) => {
  const tempDir = createTempDataDir(t);
  const authDbPath = path.join(tempDir, "auth.db");
  const workspaceDataPath = path.join(tempDir, "app-data.json");
  const workspaceSentinel = '{"sentinel":"workspace data must remain unchanged"}\n';
  fs.writeFileSync(workspaceDataPath, workspaceSentinel, "utf8");

  const result = runNodeScenario(`
    const authModule = await import(process.env.ELSET_TEST_SERVER_AUTH_URL);
    const created = await authModule.createInitialAdminAuthUser({
      password: ${JSON.stringify(testPassword)},
    });
    const signIn = await authModule.auth.api.signInUsername({
      body: {
        username: "admin",
        password: ${JSON.stringify(testPassword)},
      },
    });
    const context = await authModule.auth.$context;
    const accounts = await context.internalAdapter.findAccounts(created.id);
    const users = authModule.getManagedUserAccounts([]);
    console.log(${JSON.stringify(resultPrefix)} + JSON.stringify({
      created,
      signInUsername: signIn.user?.username,
      userCount: await authModule.getAuthUserCount(),
      users,
      credentialProviders: accounts.map((account) => account.providerId),
    }));
  `, buildChildEnv(tempDir));

  assert.equal(result.userCount, 1);
  assert.equal(result.signInUsername, "admin");
  assert.equal(result.created.username, "admin");
  assert.equal(result.created.role, "admin");
  assert.equal(result.created.authRole, "admin");
  assert.equal(result.created.email, "admin@auth.elset.local");
  assert.deepEqual(result.credentialProviders, ["credential"]);
  assert.deepEqual(result.users.map((user) => ({
    username: user.username,
    role: user.role,
    authRole: user.authRole,
  })), [{
    username: "admin",
    role: "admin",
    authRole: "admin",
  }]);

  const authDb = new Database(authDbPath, { readonly: true });
  try {
    const userRow = authDb.prepare('SELECT username, role, workspaceRole FROM "user"').get();
    const accountRow = authDb.prepare('SELECT providerId, password FROM "account"').get();
    assert.deepEqual(userRow, {
      username: "admin",
      role: "admin",
      workspaceRole: "admin",
    });
    assert.equal(accountRow.providerId, "credential");
    assert.ok(accountRow.password);
    assert.notEqual(accountRow.password, testPassword);
  } finally {
    authDb.close();
  }

  assert.equal(fs.readFileSync(workspaceDataPath, "utf8"), workspaceSentinel);
});

test("local admin bootstrap refuses when any Better Auth user already exists", (t) => {
  const tempDir = createTempDataDir(t);
  const result = runNodeScenario(`
    const authModule = await import(process.env.ELSET_TEST_SERVER_AUTH_URL);
    await authModule.ensureAuthSchemaReady();
    await authModule.auth.api.createUser({
      body: {
        email: "existing@auth.elset.local",
        password: "existing-password",
        name: "Existing User",
        role: "user",
        data: {
          username: "existing",
          displayUsername: "Existing User",
          workspaceRole: "office",
          staffId: "",
        },
      },
    });

    let errorMessage = "";
    try {
      await authModule.createInitialAdminAuthUser({
        password: ${JSON.stringify(testPassword)},
      });
    } catch (error) {
      errorMessage = error.message;
    }

    console.log(${JSON.stringify(resultPrefix)} + JSON.stringify({
      errorMessage,
      userCount: await authModule.getAuthUserCount(),
      usernames: authModule.getManagedUserAccounts([]).map((user) => user.username),
    }));
  `, buildChildEnv(tempDir));

  assert.match(result.errorMessage, /already contains 1 user/);
  assert.match(result.errorMessage, /account-management flow/);
  assert.match(result.errorMessage, /reset:local-admin-password/);
  assert.equal(result.userCount, 1);
  assert.deepEqual(result.usernames, ["existing"]);
});

test("local admin bootstrap rejects a short password without creating a user", (t) => {
  const tempDir = createTempDataDir(t);
  const result = runNodeScenario(`
    const authModule = await import(process.env.ELSET_TEST_SERVER_AUTH_URL);
    let errorMessage = "";
    try {
      await authModule.createInitialAdminAuthUser({ password: "short" });
    } catch (error) {
      errorMessage = error.message;
    }
    console.log(${JSON.stringify(resultPrefix)} + JSON.stringify({
      errorMessage,
      userCount: await authModule.getAuthUserCount(),
    }));
  `, buildChildEnv(tempDir));

  assert.match(result.errorMessage, /at least 6 characters/);
  assert.equal(result.userCount, 0);
});
