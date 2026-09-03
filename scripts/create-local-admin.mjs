import path from "path";
import { fileURLToPath } from "url";
import {
  assertSafeLocalAuthEnvironment,
  loadLocalEnv,
  promptHidden,
  promptVisible,
  resolveLocalAuthDbPath,
  validatePasswordPair,
} from "./local-auth-cli-helpers.mjs";

export {
  resolveLocalAuthDbPath,
  validatePasswordPair,
} from "./local-auth-cli-helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const CONFIRMATION_PHRASE = "CREATE LOCAL ADMIN";

export function assertSafeLocalCreateEnvironment({
  env = globalThis.process?.env || {},
  authDbPath,
} = {}) {
  assertSafeLocalAuthEnvironment({
    env,
    authDbPath,
    operation: "create a local admin",
  });
}

export async function runCreateLocalAdmin({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  loadLocalEnv(repoRoot);

  const authDbPath = resolveLocalAuthDbPath({ env, root: repoRoot });
  assertSafeLocalCreateEnvironment({ env, authDbPath });

  output.write("ELSET Admin local admin bootstrap\n");
  output.write(`Authentication database to modify:\n${authDbPath}\n\n`);
  output.write("This command creates the initial local admin only when the authentication database has no users.\n");

  const confirmation = await promptVisible(
    `Type ${CONFIRMATION_PHRASE} to continue: `,
    { input, output }
  );

  if (confirmation !== CONFIRMATION_PHRASE) {
    throw new Error("Confirmation phrase did not match. No changes were made.");
  }

  const {
    createInitialAdminAuthUser,
    getAuthDatabasePath,
    getAuthMinimumPasswordLength,
    getAuthUserCount,
  } = await import("../server-auth.js");

  const runtimeAuthDbPath = getAuthDatabasePath();
  if (path.resolve(runtimeAuthDbPath) !== path.resolve(authDbPath)) {
    throw new Error(`Resolved auth database changed after loading the auth module: ${runtimeAuthDbPath}`);
  }

  const userCount = await getAuthUserCount();
  output.write(`Current Better Auth user count: ${userCount}\n`);

  if (userCount !== 0) {
    throw new Error(
      `Bootstrap refused because the authentication database already contains ${userCount} user${userCount === 1 ? "" : "s"}. `
      + "Use the existing account-management flow or npm run reset:local-admin-password instead. No account was created."
    );
  }

  const minPasswordLength = getAuthMinimumPasswordLength();
  const firstPassword = await promptHidden("Password: ", { input, output });
  const secondPassword = await promptHidden("Re-enter password: ", { input, output });
  const password = validatePasswordPair(firstPassword, secondPassword, minPasswordLength);

  const result = await createInitialAdminAuthUser({ password });

  output.write(`Local admin created for username "${result.username}".\n`);
  output.write(`Authentication database modified: ${result.authDbPath}\n`);

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCreateLocalAdmin().catch((error) => {
    console.error(error instanceof Error ? error.message : "Local admin creation failed.");
    process.exitCode = 1;
  });
}
