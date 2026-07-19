import express from "express";
import {
  completeMaintenanceCycle,
  createMaintenancePlan,
  deleteMaintenancePlan,
  generateMaintenanceJob,
  restoreDeletedMaintenancePlan,
  scheduleMaintenancePlan,
  updateMaintenancePlan,
  WorkspaceMaintenanceError,
} from "./server-workspace-maintenance.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return body[key] && typeof body[key] === "object" && !Array.isArray(body[key])
    ? body[key]
    : body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceMaintenanceError) return error.statusCode;
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new WorkspaceMaintenanceError("Maintenance record endpoints are available only in SQLite workspace mode.", 409);
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

function handleMaintenanceRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const result = operation(db, req);
      return sendSuccess(req, res, result, env);
    } catch (error) {
      const statusCode = getStatusCode(error);
      return res.status(statusCode).json({
        error: getErrorMessage(error, "Unable to update the maintenance records."),
      });
    } finally {
      db?.close();
    }
  };
}

export function createMaintenanceRouter({
  requireAuth,
  requireRole,
  env = globalThis.process?.env || {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const manageRoleMiddleware = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const middleware = [authMiddleware, manageRoleMiddleware];

  router.post(
    "/api/maintenance-plans",
    ...middleware,
    handleMaintenanceRoute((db, req) => createMaintenancePlan(db, getRequestBody(req, "plan")), env)
  );

  router.patch(
    "/api/maintenance-plans/:id",
    ...middleware,
    handleMaintenanceRoute((db, req) => updateMaintenancePlan(db, req.params.id, getRequestBody(req, "plan")), env)
  );

  router.patch(
    "/api/maintenance-plans/:id/schedule",
    ...middleware,
    handleMaintenanceRoute((db, req) => scheduleMaintenancePlan(db, req.params.id, req.body?.nextDueDate), env)
  );

  router.post(
    "/api/maintenance-plans/:id/complete-cycle",
    ...middleware,
    handleMaintenanceRoute((db, req) => completeMaintenanceCycle(db, req.params.id, req.body || {}), env)
  );

  router.post(
    "/api/maintenance-plans/:id/generate-job",
    ...middleware,
    handleMaintenanceRoute((db, req) => generateMaintenanceJob(db, req.params.id, req.body || {}), env)
  );

  router.delete(
    "/api/maintenance-plans/:id",
    ...middleware,
    handleMaintenanceRoute((db, req) => deleteMaintenancePlan(db, req.params.id), env)
  );

  router.post(
    "/api/maintenance-plans/:id/restore",
    ...middleware,
    handleMaintenanceRoute((db, req) => restoreDeletedMaintenancePlan(db, req.params.id), env)
  );

  return router;
}

export function registerMaintenanceRoutes(app, options = {}) {
  app.use(createMaintenanceRouter(options));
}
