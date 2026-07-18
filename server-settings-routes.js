import express from "express";
import {
  resetDocumentTemplate,
  resetWorkspaceSettings,
  updateDocumentTemplate,
  updateWorkspaceSettings,
  WorkspaceSettingsError,
} from "./server-workspace-settings.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return Object.prototype.hasOwnProperty.call(body, key)
    ? body[key]
    : body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceSettingsError) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new WorkspaceSettingsError("Settings endpoints are available only in SQLite workspace mode.", 409);
  }
  return openWorkspaceDb({ dbPath: getWorkspaceDbPath(env) });
}

function sendSuccess(req, res, result, env) {
  return res.json({
    ok: true,
    result,
    state: getAuthorizedWorkspaceState(req.user, { env }),
  });
}

function handleSettingsRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const result = operation(db, req);
      return sendSuccess(req, res, result, env);
    } catch (error) {
      const statusCode = getStatusCode(error);
      return res.status(statusCode).json({
        error: getErrorMessage(error, "Unable to update workspace settings."),
      });
    } finally {
      db?.close();
    }
  };
}

export function createSettingsRouter({
  requireAuth,
  requireRole,
  env = globalThis.process?.env || {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const roleMiddleware = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const middleware = [authMiddleware, roleMiddleware];

  router.patch(
    "/api/settings",
    ...middleware,
    handleSettingsRoute((db, req) => updateWorkspaceSettings(db, getRequestBody(req, "settings")), env)
  );

  router.post(
    "/api/settings/reset",
    ...middleware,
    handleSettingsRoute((db, req) => resetWorkspaceSettings(db, req.body?.group), env)
  );

  router.put(
    "/api/document-templates/:type",
    ...middleware,
    handleSettingsRoute((db, req) => updateDocumentTemplate(db, req.params.type, getRequestBody(req, "template")), env)
  );

  router.post(
    "/api/document-templates/:type/reset",
    ...middleware,
    handleSettingsRoute((db, req) => resetDocumentTemplate(db, req.params.type), env)
  );

  return router;
}

export function registerSettingsRoutes(app, options = {}) {
  app.use(createSettingsRouter(options));
}
