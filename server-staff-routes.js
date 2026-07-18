import express from "express";
import {
  createStaffMember,
  deleteStaffMember,
  restoreDeletedStaffMember,
  updateStaffMember,
  WorkspaceStaffError,
} from "./server-workspace-staff.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return body[key] && typeof body[key] === "object" && !Array.isArray(body[key])
    ? body[key]
    : body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceStaffError) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new WorkspaceStaffError("Staff record endpoints are available only in SQLite workspace mode.", 409);
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

function handleStaffRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const result = operation(db, req);
      return sendSuccess(req, res, result, env);
    } catch (error) {
      const statusCode = getStatusCode(error);
      return res.status(statusCode).json({
        error: getErrorMessage(error, "Unable to update the staff records."),
      });
    } finally {
      db?.close();
    }
  };
}

export function createStaffRouter({
  requireAuth,
  requireRole,
  env = globalThis.process?.env || {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const roleMiddleware = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const middleware = [authMiddleware, roleMiddleware];

  router.post(
    "/api/staff",
    ...middleware,
    handleStaffRoute((db, req) => createStaffMember(db, getRequestBody(req, "staff")), env)
  );

  router.patch(
    "/api/staff/:id",
    ...middleware,
    handleStaffRoute((db, req) => updateStaffMember(db, req.params.id, getRequestBody(req, "staff")), env)
  );

  router.delete(
    "/api/staff/:id",
    ...middleware,
    handleStaffRoute((db, req) => deleteStaffMember(db, req.params.id), env)
  );

  router.post(
    "/api/staff/:id/restore",
    ...middleware,
    handleStaffRoute((db, req) => restoreDeletedStaffMember(db, req.params.id), env)
  );

  return router;
}

export function registerStaffRoutes(app, options = {}) {
  app.use(createStaffRouter(options));
}
