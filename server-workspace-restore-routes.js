import express from "express";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";
import {
  WorkspaceRestoreError,
  restoreWorkspaceSqliteBackupPayload,
  validateWorkspaceRestorePayload,
} from "./server-workspace-restore.js";
import { WorkspaceRestoreInProgressError } from "./server-workspace-restore-lock.js";

function getBackupInput(req) {
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "backupData")) {
    return req.body.backupData;
  }
  return req.body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceRestoreError || error instanceof WorkspaceRestoreInProgressError) {
    return error.statusCode;
  }
  return 400;
}

export function createWorkspaceRestoreRouter({
  env = globalThis.process?.env || {},
  requireAuth,
  requireRole,
  verifyUserPassword,
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const adminMiddleware = requireRole ? requireRole(["admin"]) : ((_req, _res, next) => next());

  router.post("/api/admin/workspace-restore", authMiddleware, adminMiddleware, async (req, res) => {
    try {
      if (getWorkspaceStorageMode(env) !== "sqlite") {
        return res.status(409).json({
          error: "The SQLite workspace restore endpoint is available only in SQLite workspace mode.",
        });
      }

      const restorePassword = String(req.body?.restorePassword || "");
      if (!restorePassword) {
        return res.status(400).json({ error: "Re-enter your admin password to restore a backup." });
      }

      if (typeof verifyUserPassword !== "function") {
        return res.status(500).json({ error: "Workspace restore password verification is not configured." });
      }

      if (!verifyUserPassword(req.user?.id, restorePassword)) {
        return res.status(403).json({ error: "The admin password you entered is incorrect." });
      }

      const backupInput = getBackupInput(req);
      const dryRun = Boolean(req.body?.dryRun || req.body?.validateOnly);
      const restore = dryRun
        ? validateWorkspaceRestorePayload(backupInput)
        : await restoreWorkspaceSqliteBackupPayload(backupInput, { env });

      return res.json({
        ok: true,
        dryRun,
        message: dryRun
          ? "SQLite workspace backup validated successfully."
          : "SQLite workspace backup restored successfully.",
        restore,
        ...(dryRun ? {} : { state: getAuthorizedWorkspaceState(req.user, { env }) }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restore the workspace backup.";
      return res.status(getStatusCode(error)).json({ error: message });
    }
  });

  return router;
}

export function registerWorkspaceRestoreRoutes(app, options = {}) {
  app.use(createWorkspaceRestoreRouter(options));
}
