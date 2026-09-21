import express from "express";
import { AccountingService } from "./server-accounting-service.js";
import { AccountingError, safeAccountingError } from "./server-accounting-errors.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";

export function createAccountingRouter({ requireAuth, requireRole, getOptionalAuthSession, authorizeOAuthInitiator, env = process.env, fetchImpl } = {}) {
  const router = express.Router();
  const auth = requireAuth || ((_req, res) => res.status(401).json({ error: "Authentication required." }));
  const manage = requireRole ? requireRole(["admin", "office"]) : ((_req, res) => res.status(403).json({ error: "Business settings permission required." }));
  const handle = (operation, { callback = false, mutation = false } = {}) => async (req, res) => {
    let db;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (getWorkspaceStorageMode(env) !== "sqlite") throw new AccountingError("SQLITE_REQUIRED", "Accounting integrations require SQLite workspace storage.", 409);
      if (mutation && (req.get("X-Accounting-Request") !== "1" || req.get("Sec-Fetch-Site") === "cross-site")) throw new AccountingError("INVALID_ORIGIN", "Accounting actions must be initiated from this application.", 403);
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false });
      const service = new AccountingService(db, { providerId: req.params.provider, env, fetchImpl, authorizeOAuthInitiator });
      const result = await operation(service, req);
      if (mutation || callback) req.app.locals.accountingInboxWorker?.wake();
      if (callback) return res.status(302).set("Location", returnUrl(result.pendingCompanySwitch ? "confirm-company" : "connected", req.params.provider)).end();
      return res.json({ ok: true, result });
    } catch (cause) {
      const error = ["ADDON_DISABLED", "ACCOUNTING_PROVIDER_CONFLICT", "INTEGRATION_BUSY"].includes(cause?.code) ? new AccountingError(cause.code, cause.message, cause.statusCode) : safeAccountingError(cause);
      if (callback) return res.status(302).set("Location", returnUrl(error.code === "OAUTH_CANCELLED" ? "cancelled" : "failed", req.params.provider)).end();
      if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
      return res.status(error.statusCode).json({ error: error.message, code: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    } finally { db?.close(); }
  };
  function returnUrl(result, provider) {
    // This route is fixed; callback query parameters never control redirects/workspace.
    const path = `/settings?accounting=${provider === "quickbooks" ? "quickbooks" : "xero"}&result=${result}`;
    return env.ELSET_FRONTEND_URL ? new URL(path, env.ELSET_FRONTEND_URL).href : path;
  }
  const route = "/api/integrations/:provider";
  router.get(`${route}/status`, auth, manage, handle((service) => service.status()));
  router.post(`${route}/connect`, auth, manage, handle((service, req) => service.connect(req.user.id, req.authSession?.id), { mutation: true }));
  router.get(`${route}/callback`, handle(async (service, req) => {
    const session = getOptionalAuthSession ? await getOptionalAuthSession(req) : null;
    return service.callback(req.query, session?.user?.id, session?.session?.id);
  }, { callback: true }));
  router.get(`${route}/config`, auth, manage, handle((service) => service.getConfig()));
  router.patch(`${route}/config`, auth, manage, handle((service, req) => service.configure(req.body), { mutation: true }));
  router.post(`${route}/organisation`, auth, manage, handle((service, req) => service.chooseOrganisation(req.body?.tenantId, req.body?.confirmChange), { mutation: true }));
  router.post(`${route}/company-switch`, auth, manage, handle((service, req) => service.switchCompany(req.body?.switchId, req.body?.confirm), { mutation: true }));
  router.post(`${route}/test`, auth, manage, handle((service) => service.testConnection(), { mutation: true }));
  router.post(`${route}/disconnect`, auth, manage, handle((service) => service.disconnect(), { mutation: true }));
  const invoiceRoute = "/api/jobs/:id/invoice/integrations/:provider";
  router.get(`${invoiceRoute}/status`, auth, manage, handle((service, req) => service.invoiceStatus(req.params.id)));
  router.post(`${invoiceRoute}/sync`, auth, manage, handle((service, req) => service.syncInvoice(req.params.id), { mutation: true }));
  router.post(`${invoiceRoute}/sync-payments`, auth, manage, handle((service, req) => service.syncPayments(req.params.id), { mutation: true }));
  return router;
}
export function registerAccountingRoutes(app, options = {}) { app.use(createAccountingRouter(options)); }
