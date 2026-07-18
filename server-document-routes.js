import express from "express";
import {
  addDocumentSentHistory,
  addInvoicePayment,
  deleteInvoiceForJob,
  deleteInvoicePayment,
  deleteQuoteForJob,
  replaceInvoiceForJob,
  replaceQuoteForJob,
  updateInvoiceForJob,
  updateInvoicePayment,
  WorkspaceDocumentError,
} from "./server-workspace-documents.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return body[key] && typeof body[key] === "object" && !Array.isArray(body[key])
    ? body[key]
    : body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceDocumentError) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new WorkspaceDocumentError("Document record endpoints are available only in SQLite workspace mode.", 409);
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

function handleDocumentRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const result = operation(db, req);
      return sendSuccess(req, res, result, env);
    } catch (error) {
      const statusCode = getStatusCode(error);
      return res.status(statusCode).json({
        error: getErrorMessage(error, "Unable to update the document records."),
      });
    } finally {
      db?.close();
    }
  };
}

export function createDocumentRouter({
  requireAuth,
  requireRole,
  env = globalThis.process?.env || {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const roleMiddleware = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const middleware = [authMiddleware, roleMiddleware];

  router.put(
    "/api/jobs/:id/quote",
    ...middleware,
    handleDocumentRoute((db, req) => replaceQuoteForJob(db, req.params.id, getRequestBody(req, "quote")), env)
  );

  router.delete(
    "/api/jobs/:id/quote",
    ...middleware,
    handleDocumentRoute((db, req) => deleteQuoteForJob(db, req.params.id), env)
  );

  router.post(
    "/api/jobs/:id/quote/sent-history",
    ...middleware,
    handleDocumentRoute((db, req) => addDocumentSentHistory(db, req.params.id, "quote", getRequestBody(req, "history")), env)
  );

  router.put(
    "/api/jobs/:id/invoice",
    ...middleware,
    handleDocumentRoute((db, req) => replaceInvoiceForJob(db, req.params.id, getRequestBody(req, "invoice")), env)
  );

  router.patch(
    "/api/jobs/:id/invoice",
    ...middleware,
    handleDocumentRoute((db, req) => updateInvoiceForJob(db, req.params.id, getRequestBody(req, "invoice")), env)
  );

  router.delete(
    "/api/jobs/:id/invoice",
    ...middleware,
    handleDocumentRoute((db, req) => deleteInvoiceForJob(db, req.params.id), env)
  );

  router.post(
    "/api/jobs/:id/invoice/sent-history",
    ...middleware,
    handleDocumentRoute((db, req) => addDocumentSentHistory(db, req.params.id, "invoice", getRequestBody(req, "history")), env)
  );

  router.post(
    "/api/jobs/:id/invoice/payments",
    ...middleware,
    handleDocumentRoute((db, req) => addInvoicePayment(db, req.params.id, getRequestBody(req, "payment")), env)
  );

  router.patch(
    "/api/jobs/:id/invoice/payments/:paymentId",
    ...middleware,
    handleDocumentRoute(
      (db, req) => updateInvoicePayment(db, req.params.id, req.params.paymentId, getRequestBody(req, "payment")),
      env
    )
  );

  router.delete(
    "/api/jobs/:id/invoice/payments/:paymentId",
    ...middleware,
    handleDocumentRoute((db, req) => deleteInvoicePayment(db, req.params.id, req.params.paymentId), env)
  );

  return router;
}

export function registerDocumentRoutes(app, options = {}) {
  app.use(createDocumentRouter(options));
}
