import path from "path";
import readline from "readline/promises";
import dotenv from "dotenv";

export function loadLocalEnv(root = process.cwd()) {
  dotenv.config({ path: path.join(root, ".env"), quiet: true });
}

export function resolveLocalAuthDbPath({
  env = globalThis.process?.env || {},
  root = process.cwd(),
} = {}) {
  const dataDir = path.resolve(env.ELSET_DATA_DIR || path.join(root, "data"));
  return path.resolve(env.ELSET_AUTH_DB_PATH || path.join(dataDir, "auth.db"));
}

function isFlyPersistentVolumePath(candidatePath) {
  const normalizedPath = path.resolve(candidatePath || "").replace(/\\/g, "/").toLowerCase();
  const pathWithoutWindowsDrive = normalizedPath.replace(/^[a-z]:/i, "");
  return pathWithoutWindowsDrive === "/app/data"
    || pathWithoutWindowsDrive.startsWith("/app/data/");
}

export function assertSafeLocalAuthEnvironment({
  env = globalThis.process?.env || {},
  authDbPath,
  operation = "modify local authentication",
} = {}) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() === "production") {
    throw new Error(`Refusing to ${operation} when NODE_ENV=production.`);
  }

  if (Object.prototype.hasOwnProperty.call(env, "FLY_APP_NAME")) {
    throw new Error(`Refusing to ${operation} while Fly.io environment variables are present.`);
  }

  if (isFlyPersistentVolumePath(authDbPath)) {
    throw new Error(`Refusing to ${operation} against the Fly persistent volume path.`);
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

export async function promptVisible(question, {
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function promptHidden(question, {
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("This command must be run from an interactive terminal.");
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
          finish(new Error("Operation cancelled."));
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
