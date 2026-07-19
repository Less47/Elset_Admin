import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Buffer } from "buffer";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { admin, username } from "better-auth/plugins";
import { fileURLToPath } from "url";
import { loadData, saveData } from "./server-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_MIGRATION_VERSION = "better-auth-v1";
const AUTH_MIN_PASSWORD_LENGTH = 6;
const SYNTHETIC_EMAIL_DOMAIN = "auth.elset.local";
const WORKSPACE_ROLE_VALUES = new Set(["admin", "office", "technician"]);
const AUTH_ROLE_VALUES = new Set(["admin", "user"]);
const env = globalThis.process?.env || {};
const DATA_DIR = path.resolve(env.ELSET_DATA_DIR || path.join(__dirname, "data"));
const AUTH_DB_PATH = path.resolve(env.ELSET_AUTH_DB_PATH || path.join(DATA_DIR, "auth.db"));
const DEFAULT_API_PORT = Number(env.ELSET_API_PORT || env.PORT || 3101);
const DEFAULT_FRONTEND_PORT = Number(env.ELSET_FRONTEND_PORT || 5173);

let authReadyPromise = null;

function isProductionRuntime() {
  return env.NODE_ENV === "production" || Boolean(env.FLY_APP_NAME);
}

function assertProductionAuthStorageReady() {
  if (!isProductionRuntime()) return;

  const authDir = path.dirname(AUTH_DB_PATH);
  if (env.FLY_APP_NAME && DATA_DIR !== path.resolve("/app/data")) {
    throw new Error(`Fly runtime must use ELSET_DATA_DIR=/app/data. Current value resolves to ${DATA_DIR}.`);
  }

  if (!fs.existsSync(authDir)) {
    throw new Error(`Persistent authentication data directory does not exist at ${authDir}. Confirm the Fly volume is mounted.`);
  }

  if (!fs.statSync(authDir).isDirectory()) {
    throw new Error(`Persistent authentication data path is not a directory at ${authDir}.`);
  }

  fs.accessSync(authDir, fs.constants.R_OK | fs.constants.W_OK);
}

function ensureAuthDirectory() {
  fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
}

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeWorkspaceRole(role, fallback = "technician") {
  return WORKSPACE_ROLE_VALUES.has(role) ? role : fallback;
}

function normalizeAuthRole(role, fallback = "user") {
  return AUTH_ROLE_VALUES.has(role) ? role : fallback;
}

function deriveWorkspaceRole(userLike) {
  const configuredRole = normalizeOptionalString(userLike?.workspaceRole);
  if (configuredRole && WORKSPACE_ROLE_VALUES.has(configuredRole)) {
    return configuredRole;
  }

  if (userLike?.role === "admin") {
    return "admin";
  }

  return normalizeOptionalString(userLike?.staffId) ? "technician" : "office";
}

function toAuthRole(workspaceRole) {
  return workspaceRole === "admin" ? "admin" : "user";
}

function buildSyntheticEmail(username) {
  const normalizedUsername = normalizeUsername(username) || `user-${crypto.randomUUID()}`;
  return `${normalizedUsername}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function toIsoString(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function hashLegacyPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyLegacyPassword({ hash, password }) {
  if (!hash || typeof hash !== "string" || !hash.includes(":")) return false;
  const [salt, expectedHash] = hash.split(":");
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
  } catch {
    return false;
  }
}

function getDefaultApiUrl() {
  return `http://localhost:${DEFAULT_API_PORT}`;
}

function getDefaultFrontendUrl() {
  return `http://localhost:${DEFAULT_FRONTEND_PORT}`;
}

function getFlyAppUrl() {
  return env.FLY_APP_NAME ? `https://${env.FLY_APP_NAME}.fly.dev` : "";
}

function getTrustedOrigins() {
  const origins = [
    normalizeOptionalString(env.BETTER_AUTH_TRUSTED_ORIGIN),
    normalizeOptionalString(env.ELSET_FRONTEND_URL),
    normalizeOptionalString(env.BETTER_AUTH_URL),
    normalizeOptionalString(getFlyAppUrl()),
    getDefaultFrontendUrl(),
    getDefaultApiUrl(),
  ].filter(Boolean);

  return [...new Set(origins)];
}

assertProductionAuthStorageReady();
ensureAuthDirectory();

const authDb = new Database(AUTH_DB_PATH);
authDb.pragma("journal_mode = WAL");
authDb.pragma("foreign_keys = ON");

export const auth = betterAuth({
  appName: "Elset Admin",
  baseURL: normalizeOptionalString(env.BETTER_AUTH_URL) || normalizeOptionalString(getFlyAppUrl()) || getDefaultApiUrl(),
  trustedOrigins: getTrustedOrigins(),
  database: authDb,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: AUTH_MIN_PASSWORD_LENGTH,
    maxPasswordLength: 128,
    password: {
      hash: async (password) => hashLegacyPassword(password),
      verify: async ({ hash, password }) => verifyLegacyPassword({ hash, password }),
    },
  },
  user: {
    additionalFields: {
      workspaceRole: {
        type: ["admin", "office", "technician"],
        required: false,
        defaultValue: "technician",
        input: false,
      },
      staffId: {
        type: "string",
        required: false,
        defaultValue: "",
        input: false,
      },
    },
  },
  plugins: [
    username(),
    admin(),
  ],
});

function normalizeSqliteBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function mapRawAuthUserRow(row, staffById = new Map()) {
  const workspaceRole = deriveWorkspaceRole(row);
  const staffId = normalizeOptionalString(row?.staffId);
  const linkedStaffName = staffId ? staffById.get(staffId)?.name : "";

  return {
    id: String(row.id),
    username: normalizeUsername(row.username),
    name: linkedStaffName || row.name || row.displayUsername || row.username || row.email || "Staff User",
    role: workspaceRole,
    staffId,
    authRole: normalizeAuthRole(row.authRole, toAuthRole(workspaceRole)),
    email: row.email || buildSyntheticEmail(row.username),
    emailVerified: normalizeSqliteBoolean(row.emailVerified),
    image: row.image || null,
    createdAt: toIsoString(row.createdAt, new Date().toISOString()),
    updatedAt: toIsoString(row.updatedAt, new Date().toISOString()),
    displayUsername: row.displayUsername || row.name || row.username || "",
    banned: normalizeSqliteBoolean(row.banned),
    banReason: row.banReason || null,
    banExpires: toIsoString(row.banExpires, null),
    passwordHash: row.passwordHash || "",
  };
}

function toAppUser(userLike) {
  if (!userLike) return null;

  const workspaceRole = deriveWorkspaceRole(userLike);
  return {
    id: String(userLike.id),
    username: normalizeUsername(userLike.username),
    name: userLike.name || userLike.displayUsername || userLike.username || userLike.email || "Staff User",
    role: workspaceRole,
    staffId: normalizeOptionalString(userLike.staffId),
    email: userLike.email || buildSyntheticEmail(userLike.username),
    authRole: normalizeAuthRole(userLike.role, toAuthRole(workspaceRole)),
  };
}

function getAllRawAuthUserRows() {
  return authDb.prepare(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.emailVerified,
      u.image,
      u.role AS authRole,
      u.banned,
      u.banReason,
      u.banExpires,
      u.username,
      u.displayUsername,
      u.workspaceRole,
      u.staffId,
      u.createdAt,
      u.updatedAt,
      a.password AS passwordHash
    FROM "user" u
    LEFT JOIN "account" a
      ON a.userId = u.id
     AND a.providerId = 'credential'
    ORDER BY lower(COALESCE(u.name, u.displayUsername, u.username, u.email))
  `).all();
}

function getRawAuthUserRowById(userId) {
  if (!userId) return null;

  return authDb.prepare(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.emailVerified,
      u.image,
      u.role AS authRole,
      u.banned,
      u.banReason,
      u.banExpires,
      u.username,
      u.displayUsername,
      u.workspaceRole,
      u.staffId,
      u.createdAt,
      u.updatedAt,
      a.password AS passwordHash
    FROM "user" u
    LEFT JOIN "account" a
      ON a.userId = u.id
     AND a.providerId = 'credential'
    WHERE u.id = ?
    LIMIT 1
  `).get(String(userId)) || null;
}

function getRawAuthUserRowByUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return null;

  return authDb.prepare(`
    SELECT
      u.id,
      u.username,
      a.password AS passwordHash
    FROM "user" u
    LEFT JOIN "account" a
      ON a.userId = u.id
     AND a.providerId = 'credential'
    WHERE lower(u.username) = ?
    LIMIT 1
  `).get(normalizedUsername) || null;
}

function getCurrentUserSessions(userId) {
  if (!userId) return [];

  return authDb.prepare(`
    SELECT id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
    FROM "session"
    WHERE userId = ?
    ORDER BY createdAt ASC
  `).all(String(userId));
}

function getAuthUserCount() {
  const row = authDb.prepare(`SELECT COUNT(*) AS count FROM "user"`).get();
  return Number(row?.count || 0);
}

function normalizeBackupAuthUser(input) {
  const username = normalizeUsername(input?.username);
  if (!username) return null;

  const workspaceRole = normalizeWorkspaceRole(
    input?.workspaceRole || input?.role,
    normalizeOptionalString(input?.staffId) ? "technician" : "office"
  );

  return {
    id: normalizeOptionalString(input?.id) || crypto.randomUUID(),
    username,
    name: normalizeOptionalString(input?.name) || username,
    displayUsername: normalizeOptionalString(input?.displayUsername) || normalizeOptionalString(input?.name) || username,
    role: workspaceRole,
    authRole: normalizeAuthRole(input?.authRole, toAuthRole(workspaceRole)),
    staffId: normalizeOptionalString(input?.staffId),
    email: normalizeOptionalString(input?.email) || buildSyntheticEmail(username),
    emailVerified: input?.emailVerified === false ? false : true,
    image: normalizeOptionalString(input?.image),
    passwordHash: String(input?.passwordHash || ""),
    createdAt: toIsoString(input?.createdAt, new Date().toISOString()),
    updatedAt: toIsoString(input?.updatedAt, new Date().toISOString()),
    banned: input?.banned === true,
    banReason: normalizeOptionalString(input?.banReason),
    banExpires: toIsoString(input?.banExpires, null),
  };
}

function insertAuthUsers(rawUsers, preservedSessions = []) {
  const deleteSessionRows = authDb.prepare(`DELETE FROM "session"`);
  const deleteAccountRows = authDb.prepare(`DELETE FROM "account"`);
  const deleteVerificationRows = authDb.prepare(`DELETE FROM "verification"`);
  const deleteUserRows = authDb.prepare(`DELETE FROM "user"`);
  const insertUser = authDb.prepare(`
    INSERT INTO "user" (
      id,
      name,
      email,
      emailVerified,
      image,
      createdAt,
      updatedAt,
      role,
      banned,
      banReason,
      banExpires,
      username,
      displayUsername,
      workspaceRole,
      staffId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAccount = authDb.prepare(`
    INSERT INTO "account" (
      id,
      userId,
      accountId,
      providerId,
      password,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, 'credential', ?, ?, ?)
  `);
  const insertSession = authDb.prepare(`
    INSERT INTO "session" (
      id,
      userId,
      token,
      expiresAt,
      ipAddress,
      userAgent,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = authDb.transaction((users, sessions) => {
    deleteSessionRows.run();
    deleteAccountRows.run();
    deleteVerificationRows.run();
    deleteUserRows.run();

    users.forEach((user) => {
      insertUser.run(
        user.id,
        user.name,
        user.email,
        user.emailVerified ? 1 : 0,
        user.image,
        user.createdAt,
        user.updatedAt,
        normalizeAuthRole(user.authRole, toAuthRole(user.role)),
        user.banned ? 1 : 0,
        user.banReason,
        user.banExpires,
        user.username,
        user.displayUsername,
        user.role,
        user.staffId
      );

      if (user.passwordHash) {
        insertAccount.run(
          crypto.randomUUID(),
          user.id,
          user.id,
          user.passwordHash,
          user.createdAt,
          user.updatedAt
        );
      }
    });

    sessions.forEach((session) => {
      insertSession.run(
        String(session.id || crypto.randomUUID()),
        String(session.userId),
        String(session.token),
        toIsoString(session.expiresAt, new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()),
        normalizeOptionalString(session.ipAddress),
        normalizeOptionalString(session.userAgent),
        toIsoString(session.createdAt, new Date().toISOString()),
        toIsoString(session.updatedAt, toIsoString(session.createdAt, new Date().toISOString()))
      );
    });
  });

  transaction(rawUsers, preservedSessions);
}

function canInjectCurrentUserIntoBackup(users, currentUser) {
  if (!currentUser) return false;

  const currentUsername = normalizeUsername(currentUser.username);
  const currentEmail = String(currentUser.email || "").trim().toLowerCase();
  const currentStaffId = normalizeOptionalString(currentUser.staffId);

  return !users.some((user) => {
    if (String(user.id) === String(currentUser.id)) return true;
    if (normalizeUsername(user.username) === currentUsername) return true;
    if (String(user.email || "").trim().toLowerCase() === currentEmail) return true;
    return Boolean(currentStaffId && normalizeOptionalString(user.staffId) === currentStaffId);
  });
}

function findMatchingUserForSession(users, currentUser) {
  if (!currentUser) return null;

  const currentId = String(currentUser.id || "");
  const currentUsername = normalizeUsername(currentUser.username);
  const currentEmail = String(currentUser.email || "").trim().toLowerCase();

  return users.find((candidate) => (
    String(candidate.id) === currentId
    || normalizeUsername(candidate.username) === currentUsername
    || String(candidate.email || "").trim().toLowerCase() === currentEmail
  )) || null;
}

async function migrateLegacyUsersIfNeeded() {
  const data = loadData();
  const migrationMeta = data.meta?.authMigration;
  if (migrationMeta?.version === AUTH_MIGRATION_VERSION) {
    return;
  }

  const legacyUsers = Array.isArray(data.users) ? data.users : [];
  if (getAuthUserCount() === 0 && legacyUsers.length > 0) {
    const nextUsers = legacyUsers
      .map((user) => normalizeBackupAuthUser({
        ...user,
        workspaceRole: user.role,
      }))
      .filter(Boolean);

    if (nextUsers.length > 0) {
      insertAuthUsers(nextUsers, []);
    }
  }

  saveData({
    ...data,
    users: [],
    sessions: [],
    meta: {
      ...data.meta,
      authMigration: {
        version: AUTH_MIGRATION_VERSION,
        migratedAt: new Date().toISOString(),
      },
    },
  });
}

export async function ensureAuthReady() {
  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      const context = await auth.$context;
      await context.runMigrations();
      await migrateLegacyUsersIfNeeded();
    })();
  }

  return authReadyPromise;
}

export async function getRequestAuthSession(req) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
    returnHeaders: true,
  }).catch(() => null);

  if (!session?.response?.session || !session?.response?.user) {
    return null;
  }

  return {
    headers: session.headers || null,
    rawUser: session.response.user,
    session: session.response.session,
    user: toAppUser(session.response.user),
  };
}

export function verifyUserPassword(userId, password) {
  const normalizedUserId = normalizeOptionalString(userId);
  const passwordValue = String(password || "");

  if (!normalizedUserId || !passwordValue) {
    return false;
  }

  const userRow = getRawAuthUserRowById(normalizedUserId);
  if (!userRow?.passwordHash) {
    return false;
  }

  return verifyLegacyPassword({
    hash: userRow.passwordHash,
    password: passwordValue,
  });
}

export function getAuthDatabasePath() {
  return AUTH_DB_PATH;
}

export function getAuthMinimumPasswordLength() {
  return AUTH_MIN_PASSWORD_LENGTH;
}

export async function resetExistingAuthUserPassword({ username = "admin", newPassword } = {}) {
  const normalizedUsername = normalizeUsername(username);
  const passwordValue = String(newPassword || "");

  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }

  if (passwordValue.length < AUTH_MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${AUTH_MIN_PASSWORD_LENGTH} characters.`);
  }

  const userRow = getRawAuthUserRowByUsername(normalizedUsername);
  if (!userRow) {
    throw new Error(`Existing user "${normalizedUsername}" was not found. No account was created.`);
  }

  if (!userRow.passwordHash) {
    throw new Error(`Existing user "${normalizedUsername}" does not have a credential password account.`);
  }

  const context = await auth.$context;
  const revokedSessionCount = getCurrentUserSessions(userRow.id).length;
  const passwordHash = await context.password.hash(passwordValue);

  await context.internalAdapter.updatePassword(userRow.id, passwordHash);
  await context.internalAdapter.deleteUserSessions(userRow.id);

  return {
    userId: String(userRow.id),
    username: normalizedUsername,
    authDbPath: AUTH_DB_PATH,
    revokedSessionCount,
  };
}

export function getManagedUserAccounts(staff = []) {
  const staffById = new Map((Array.isArray(staff) ? staff : []).map((staffMember) => [staffMember.id, staffMember]));
  return getAllRawAuthUserRows()
    .map((row) => mapRawAuthUserRow(row, staffById))
    .map((account) => {
      const nextAccount = { ...account };
      delete nextAccount.passwordHash;
      return nextAccount;
    });
}

export function getAuthBackupUsers() {
  return getAllRawAuthUserRows().map((row) => {
    const user = mapRawAuthUserRow(row);
    return {
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      role: user.role,
      authRole: user.authRole,
      staffId: user.staffId,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
    };
  });
}

export async function saveManagedUserAccount({ requestHeaders, accountInput, staff = [] }) {
  const accountId = normalizeOptionalString(accountInput?.id);
  const username = normalizeUsername(accountInput?.username);
  const workspaceRole = normalizeWorkspaceRole(accountInput?.role);
  const staffId = normalizeOptionalString(accountInput?.staffId);
  const requestedStaffName = normalizeOptionalString(accountInput?.staffName);
  const password = String(accountInput?.password || "");
  const existingAccounts = getManagedUserAccounts(staff);
  const existingAccount = accountId
    ? existingAccounts.find((account) => account.id === accountId) || null
    : null;

  if (!username) {
    throw new Error("Username is required.");
  }

  if (password && password.length < AUTH_MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${AUTH_MIN_PASSWORD_LENGTH} characters.`);
  }

  if (!existingAccount && !password) {
    throw new Error("A password is required when creating a new login.");
  }

  const duplicateStaffLink = staffId
    ? existingAccounts.find((account) => account.id !== existingAccount?.id && account.staffId === staffId)
    : null;
  if (duplicateStaffLink) {
    throw new Error("That staff member already has a linked login.");
  }

  const linkedStaffMember = staffId
    ? (Array.isArray(staff) ? staff.find((staffMember) => staffMember.id === staffId) : null)
    : null;
  if (staffId && !linkedStaffMember && !requestedStaffName) {
    throw new Error("The linked staff member could not be found.");
  }

  const displayName = linkedStaffMember?.name || requestedStaffName || existingAccount?.name || username;
  const authRole = toAuthRole(workspaceRole);
  const email = buildSyntheticEmail(username);
  const usernameChanged = !existingAccount || username !== normalizeUsername(existingAccount.username);
  const emailChanged = !existingAccount || email !== String(existingAccount.email || "").trim().toLowerCase();

  try {
    if (!existingAccount) {
      const created = await auth.api.createUser({
        body: {
          email,
          password,
          name: displayName,
          role: authRole,
          data: {
            username,
            displayUsername: displayName,
            workspaceRole,
            staffId,
          },
        },
        headers: requestHeaders,
      });

      const createdUserId = created?.user?.id || created?.id;
      const nextRow = getRawAuthUserRowById(createdUserId);
      if (!nextRow) {
        throw new Error("Unable to save login access.");
      }

      const nextAccount = mapRawAuthUserRow(nextRow, new Map(
        (Array.isArray(staff) ? staff : []).map((staffMember) => [staffMember.id, staffMember])
      ));
      delete nextAccount.passwordHash;
      return nextAccount;
    }

    const updateData = {
      name: displayName,
      displayUsername: displayName,
      workspaceRole,
      staffId,
      ...(emailChanged ? { email } : {}),
      ...(usernameChanged ? { username } : {}),
    };

    await auth.api.adminUpdateUser({
      body: {
        userId: existingAccount.id,
        data: updateData,
      },
      headers: requestHeaders,
    });

    await auth.api.setRole({
      body: {
        userId: existingAccount.id,
        role: authRole,
      },
      headers: requestHeaders,
    });

    if (password) {
      await auth.api.setUserPassword({
        body: {
          userId: existingAccount.id,
          newPassword: password,
        },
        headers: requestHeaders,
      });

      await auth.api.revokeUserSessions({
        body: {
          userId: existingAccount.id,
        },
        headers: requestHeaders,
      }).catch(() => {});
    }

    const nextRow = getRawAuthUserRowById(existingAccount.id);
    if (!nextRow) {
      throw new Error("Unable to save login access.");
    }

    const nextAccount = mapRawAuthUserRow(nextRow, new Map(
      (Array.isArray(staff) ? staff : []).map((staffMember) => [staffMember.id, staffMember])
    ));
    delete nextAccount.passwordHash;
    return nextAccount;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save login access.";
    throw new Error(message);
  }
}

export function syncManagedUserNamesWithStaff(staff = []) {
  const staffById = new Map((Array.isArray(staff) ? staff : []).map((staffMember) => [staffMember.id, staffMember]));
  const authUsers = getAllRawAuthUserRows().filter((user) => normalizeOptionalString(user.staffId));
  const updateUser = authDb.prepare(`
    UPDATE "user"
       SET name = ?,
           displayUsername = ?,
           updatedAt = ?
     WHERE id = ?
  `);

  const transaction = authDb.transaction((users) => {
    users.forEach((user) => {
      const staffMember = staffById.get(normalizeOptionalString(user.staffId));
      if (!staffMember?.name) return;

      if (staffMember.name === user.name && staffMember.name === user.displayUsername) {
        return;
      }

      updateUser.run(
        staffMember.name,
        staffMember.name,
        new Date().toISOString(),
        String(user.id)
      );
    });
  });

  transaction(authUsers);
}

export function restoreAuthBackup(backupInput, currentUser = null) {
  const backupUsersSource = Array.isArray(backupInput?.authUsers)
    ? backupInput.authUsers
    : (Array.isArray(backupInput?.users) ? backupInput.users : []);
  let backupUsers = backupUsersSource.map(normalizeBackupAuthUser).filter(Boolean);
  const currentRawUser = currentUser?.id ? getRawAuthUserRowById(currentUser.id) : null;
  const preservedSessions = currentRawUser ? getCurrentUserSessions(currentRawUser.id) : [];
  let matchedUser = currentRawUser ? findMatchingUserForSession(backupUsers, mapRawAuthUserRow(currentRawUser)) : null;
  let preservedCurrentAdmin = false;

  if (!matchedUser && currentRawUser) {
    const currentBackupRecord = normalizeBackupAuthUser(mapRawAuthUserRow(currentRawUser));
    if (currentBackupRecord && canInjectCurrentUserIntoBackup(backupUsers, currentBackupRecord)) {
      backupUsers = [...backupUsers, currentBackupRecord];
      matchedUser = currentBackupRecord;
      preservedCurrentAdmin = true;
    }
  }

  const nextSessions = matchedUser
    ? preservedSessions.map((session) => ({
        ...session,
        userId: matchedUser.id,
      }))
    : [];

  insertAuthUsers(backupUsers, nextSessions);

  const resolvedUserRow = matchedUser ? getRawAuthUserRowById(matchedUser.id) : null;
  return {
    message: currentRawUser && !matchedUser
      ? "Backup restored, but your current login could not be matched to an account in that file."
      : preservedCurrentAdmin
        ? "Backup restored and your current admin login was preserved."
        : "Backup restored successfully.",
    sessionPreserved: !currentRawUser || Boolean(matchedUser),
    user: resolvedUserRow ? toAppUser(mapRawAuthUserRow(resolvedUserRow)) : currentUser,
  };
}
