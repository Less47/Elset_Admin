import fs from "fs";
import path from "path";
import readline from "readline/promises";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const CONFIRMATION_PHRASE = "RESET LOCAL ADMIN PASSWORD";

export function loadLocalEnv(root = repoRoot) {
  dotenv.config({ path: path.join(root, ".env"), quiet: true });
}

export function resolveLocalAuthDbPath({
  env = globalThis.process?.env || {},
  root = repoRoot,
} = {}) {
  const dataDir = path.resolve(env.ELSET_DATA_DIR || path.join(root, "data"));
  return path.resolve(env.ELSET_AUTH_DB_PATH || path.join(dataDir, "auth.db"));
}

export function assertSafeLocalResetEnvironment({
  env = globalThis.process?.env || {},
  authDbPath,
} = {}) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() === "production") {
    throw new Error("Refusing to reset a password when NODE_ENV=production.");
  }

  if (String(env.FLY_APP_NAME || "").trim()) {
    throw new Error("Refusing to reset a password while Fly.io environment variables are present.");
  }

  const resolvedPath = path.resolve(authDbPath || "");
  if (resolvedPath === "/app/data/auth.db" || resolvedPath.startsWith("/app/data/")) {
    throw new Error("Refusing to reset a password against the Fly persistent volume path.");
  }
}

export function validatePasswordPair(firstPassword, secondPassword, minPasswordLength) {
  const first = String(firstPassword || "");
  const second = String(secondPassword || "");
  const minLength = Number(minPasswordLength);

  if (!Number.isFinite(minLength) || minLength < 1) {
    throw new Error("Password policy is not available.");
  }

  if (first.length < minLength) {
    throw new Error(`Password must be at least ${minLength} characters.`);
  }

  if (first !== second) {
    throw new Error("The two passwords did not match. No changes were made.");
  }

  return first;
}

async function promptVisible(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function promptHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Password reset must be run from an interactive terminal.");
  }

  return new Promise((resolve, reject) => {
    let password = "";
    const wasRaw = input.isRaw;
    let settled = false;

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");

      if (error) {
        reject(error);
      } else {
        resolve(password);
      }
    };

    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === "\u0003" || char === "\u0004") {
          finish(new Error("Password reset cancelled."));
          return;
        }

        if (char === "\r" || char === "\n") {
          finish();
          return;
        }

        if (char === "\u007f" || char === "\b") {
          password = password.slice(0, -1);
          continue;
        }

        if (char < " ") {
          continue;
        }

        password += char;
      }
    };

    output.write(question);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

export async function runResetLocalAdminPassword({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  loadLocalEnv(repoRoot);

  const authDbPath = resolveLocalAuthDbPath({ env, root: repoRoot });
  assertSafeLocalResetEnvironment({ env, authDbPath });

  if (!fs.existsSync(authDbPath)) {
    throw new Error(`Authentication database not found at ${authDbPath}. No database was created.`);
  }

  output.write("ELSET Admin local admin password reset\n");
  output.write(`Authentication database to modify:\n${authDbPath}\n\n`);
  output.write("This changes only the existing local user \"admin\" and revokes that user's existing sessions.\n");

  const confirmation = await promptVisible(
    `Type ${CONFIRMATION_PHRASE} to continue: `,
    { input, output }
  );

  if (confirmation !== CONFIRMATION_PHRASE) {
    throw new Error("Confirmation phrase did not match. No changes were made.");
  }

  const {
    getAuthDatabasePath,
    getAuthMinimumPasswordLength,
    resetExistingAuthUserPassword,
  } = await import("../server-auth.js");

  const runtimeAuthDbPath = getAuthDatabasePath();
  if (path.resolve(runtimeAuthDbPath) !== path.resolve(authDbPath)) {
    throw new Error(`Resolved auth database changed after loading the auth module: ${runtimeAuthDbPath}`);
  }

  const minPasswordLength = getAuthMinimumPasswordLength();
  const firstPassword = await promptHidden("New password: ", { input, output });
  const secondPassword = await promptHidden("Re-enter new password: ", { input, output });
  const newPassword = validatePasswordPair(firstPassword, secondPassword, minPasswordLength);

  const result = await resetExistingAuthUserPassword({
    username: "admin",
    newPassword,
  });

  output.write(`Password reset complete for existing user "${result.username}".\n`);
  output.write(`Revoked sessions: ${result.revokedSessionCount}\n`);
  output.write(`Authentication database modified: ${result.authDbPath}\n`);

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runResetLocalAdminPassword().catch((error) => {
    console.error(error instanceof Error ? error.message : "Password reset failed.");
    process.exitCode = 1;
  });
}
