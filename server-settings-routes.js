import express from "express";
import {
  resetDocumentTemplate,
  resetWorkspaceSettings,
  updateDocumentTemplate,
  updateWorkspaceSettings,
  WorkspaceSettingsError,
} from "./server-workspace-settings.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { workspaceMutationResponse } from "./server-workspace-delta.js";
import { retiredAppearanceSettingKeys, userUiPreferenceKeys } from "./src/lib/user-ui-preferences.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return Object.prototype.hasOwnProperty.call(body, key)
    ? body[key]
    : body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceSettingsError) return error.statusCode;
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  return openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false, fileMustExist: true });
}

function handleSettingsRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const payload = workspaceMutationResponse(db, "settings", req, operation);
      return res.json(payload);
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
    handleSettingsRoute((db, req) => {
      const patch = getRequestBody(req, "settings");
      if (patch && Object.keys(patch).some((key) => userUiPreferenceKeys.includes(key) || retiredAppearanceSettingKeys.includes(key))) {
        throw new WorkspaceSettingsError("Appearance and display preferences are personal. Use /api/user-preferences.");
      }
      return updateWorkspaceSettings(db, patch);
    }, env)
  );

  router.post(
    "/api/settings/reset",
    ...middleware,
    handleSettingsRoute((db, req) => {
      if (req.body?.group === "ui") throw new WorkspaceSettingsError("Reset appearance through /api/user-preferences.");
      return resetWorkspaceSettings(db, req.body?.group);
    }, env)
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
