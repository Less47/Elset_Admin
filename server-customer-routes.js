import express from "express";
import {
  createCustomer,
  createCustomerSite,
  deleteCustomer,
  deleteCustomerSite,
  restoreCustomer,
  updateCustomer,
  updateCustomerSite,
  WorkspaceCustomerError,
} from "./server-workspace-customers.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return body[key] && typeof body[key] === "object" && !Array.isArray(body[key])
    ? body[key]
    : body;
}

function getSiteRequestBody(req) {
  const body = req.body || {};
  const site = body.site && typeof body.site === "object" && !Array.isArray(body.site)
    ? body.site
    : body;
  return {
    ...site,
    ...(body.previousAddress && !site.previousAddress ? { previousAddress: body.previousAddress } : {}),
  };
}

function getStatusCode(error) {
  if (error instanceof WorkspaceCustomerError) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new WorkspaceCustomerError("Customer record endpoints are available only in SQLite workspace mode.", 409);
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

function handleCustomerRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const result = operation(db, req);
      return sendSuccess(req, res, result, env);
    } catch (error) {
      const statusCode = getStatusCode(error);
      return res.status(statusCode).json({
        error: getErrorMessage(error, "Unable to update the customer records."),
      });
    } finally {
      db?.close();
    }
  };
}

export function createCustomerRouter({
  requireAuth,
  requireRole,
  env = globalThis.process?.env || {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const roleMiddleware = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const middleware = [authMiddleware, roleMiddleware];

  router.post(
    "/api/customers",
    ...middleware,
    handleCustomerRoute((db, req) => createCustomer(db, getRequestBody(req, "customer")), env)
  );

  router.patch(
    "/api/customers/:id",
    ...middleware,
    handleCustomerRoute((db, req) => updateCustomer(db, req.params.id, getRequestBody(req, "customer")), env)
  );

  router.delete(
    "/api/customers/:id",
    ...middleware,
    handleCustomerRoute((db, req) => deleteCustomer(db, req.params.id), env)
  );

  router.post(
    "/api/customers/:id/restore",
    ...middleware,
    handleCustomerRoute((db, req) => restoreCustomer(db, req.params.id), env)
  );

  router.post(
    "/api/customers/:id/sites",
    ...middleware,
    handleCustomerRoute((db, req) => createCustomerSite(db, req.params.id, getSiteRequestBody(req)), env)
  );

  router.patch(
    "/api/customers/:id/sites/:siteId",
    ...middleware,
    handleCustomerRoute((db, req) => updateCustomerSite(db, req.params.id, req.params.siteId, getSiteRequestBody(req)), env)
  );

  router.delete(
    "/api/customers/:id/sites/:siteId",
    ...middleware,
    handleCustomerRoute((db, req) => deleteCustomerSite(db, req.params.id, req.params.siteId), env)
  );

  return router;
}

export function registerCustomerRoutes(app, options = {}) {
  app.use(createCustomerRouter(options));
}
