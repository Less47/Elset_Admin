import express from "express";
import {
  createInventoryItem,
  deleteInventoryItem,
  restoreDeletedInventoryItem,
  updateInventoryItem,
  WorkspaceInventoryError,
} from "./server-workspace-inventory.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return body[key] && typeof body[key] === "object" && !Array.isArray(body[key])
    ? body[key]
    : body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceInventoryError) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new WorkspaceInventoryError("Inventory record endpoints are available only in SQLite workspace mode.", 409);
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

function handleInventoryRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const result = operation(db, req);
      return sendSuccess(req, res, result, env);
    } catch (error) {
      const statusCode = getStatusCode(error);
      return res.status(statusCode).json({
        error: getErrorMessage(error, "Unable to update the inventory records."),
      });
    } finally {
      db?.close();
    }
  };
}

export function createInventoryRouter({
  requireAuth,
  requireRole,
  env = globalThis.process?.env || {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const roleMiddleware = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const middleware = [authMiddleware, roleMiddleware];

  router.post(
    "/api/inventory-items",
    ...middleware,
    handleInventoryRoute((db, req) => createInventoryItem(db, getRequestBody(req, "item")), env)
  );

  router.patch(
    "/api/inventory-items/:id",
    ...middleware,
    handleInventoryRoute((db, req) => updateInventoryItem(db, req.params.id, getRequestBody(req, "item")), env)
  );

  router.delete(
    "/api/inventory-items/:id",
    ...middleware,
    handleInventoryRoute((db, req) => deleteInventoryItem(db, req.params.id), env)
  );

  router.post(
    "/api/inventory-items/:id/restore",
    ...middleware,
    handleInventoryRoute((db, req) => restoreDeletedInventoryItem(db, req.params.id), env)
  );

  return router;
}

export function registerInventoryRoutes(app, options = {}) {
  app.use(createInventoryRouter(options));
}
