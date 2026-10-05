import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { WorkspaceAddonError, requireWorkspaceAddon } from "./server-workspace-addons.js";
import { DocumentEmailError, submitPdfEmail } from "./server-document-email.js";
import { documentSendErrorMessage } from "./src/lib/document-send-status.js";
import { maintenanceServiceEmailDraft } from "./src/lib/maintenance-service-email.js";
import { normalizeDocumentEmail } from "./src/lib/document-email.js";
import { generateMaintenanceServicePdf } from "./server-maintenance-service-pdf.js";
import { WorkspaceJobError } from "./server-workspace-jobs.js";
import { getMaintenancePlanById } from "./server-workspace-state.js";
import {
  MaintenanceServiceError, assertMaintenanceServiceAccess, getMaintenanceServiceReport, getMaintenanceServiceHistory,
  initializeMaintenanceService, updateMaintenanceServiceResult, updateMaintenanceServiceDefect, updateMaintenanceServiceNotes,
  completeMaintenanceService, maintenanceServiceAvailable, persistMaintenanceServiceSend,
} from "./server-workspace-maintenance-service.js";

export function createMaintenanceServiceRouter({ requireAuth, requireRole, env = process.env,
  generatePdf = generateMaintenanceServicePdf, createTransport, persistSend = persistMaintenanceServiceSend } = {}) {
  const router = express.Router();
  const auth = requireAuth || ((_req, _res, next) => next());
  const roles = (commercial = false) => requireRole ? requireRole(["admin", "office", ...(commercial ? [] : ["technician"])]) : (_req, _res, next) => next();
  const parser = express.json({ limit: "512kb" });
  const handle = (operation, { readonly = false } = {}) => async (req, res) => {
    let db;
    res.setHeader("Cache-Control", "no-store");
    try {
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), readonly, migrate: false, fileMustExist: true });
      await operation(db, req, res);
    } catch (error) {
      const known = error instanceof MaintenanceServiceError || error instanceof WorkspaceAddonError || error instanceof DocumentEmailError || error instanceof WorkspaceJobError;
      res.status(error.statusCode || (error.code === "INVALID_EMAIL" ? 400 : 500)).json({
        error: known ? error.message : "Unable to access the maintenance service report.",
        ...(known && error.code ? { code: error.code } : {}),
        ...(error instanceof WorkspaceAddonError ? { addon: error.addon } : {}),
        ...(known ? { fieldErrors: error.fieldErrors, unansweredItems: error.unansweredItems, invalidDefectItems: error.invalidDefectItems,
          currentRevision: error.currentRevision, delivery: error.delivery } : {}),
      });
    } finally { db?.close(); }
  };
  function authorizedReport(db, req, { commercial = false, completed = false } = {}) {
    const report = getMaintenanceServiceReport(db, req.params.id, { reportId: req.params.reportId });
    if (req.params.reportId && !report) throw new MaintenanceServiceError("Service report not found.", 404);
    assertMaintenanceServiceAccess(db, report?.jobId || req.params.id, req.user, { commercial, historical: report?.status === "completed" });
    if (report?.status !== "completed" && !maintenanceServiceAvailable(db)) requireWorkspaceAddon(db, "maintenanceChecklists");
    if (completed && report?.status !== "completed") throw new MaintenanceServiceError("Complete this service before generating or sending its report.", 409);
    return report;
  }
  const base = "/api/jobs/:id/maintenance-service";
  router.get(base, auth, roles(), handle((db, req, res) => {
    // Disabled workspaces may still read completed reports. Empty reads allow the
    // Job page to discover historical records without revealing execution controls.
    const report = getMaintenanceServiceReport(db, req.params.id);
    const job = assertMaintenanceServiceAccess(db, req.params.id, req.user, { historical: report?.status === "completed" });
    if (report && req.user.role === "technician") report.sentHistory = [];
    res.json({ ok: true, report: !maintenanceServiceAvailable(db) && report?.status !== "completed" ? null : report,
      canInitialize: maintenanceServiceAvailable(db) && Boolean(job?.maintenancePlanId && getMaintenancePlanById(db, job.maintenancePlanId)) });
  }, { readonly: true }));
  router.post(base, auth, roles(), parser, handle((db, req, res) => {
    assertMaintenanceServiceAccess(db, req.params.id, req.user);
    res.json({ ok: true, report: initializeMaintenanceService(db, req.params.id) });
  }));
  router.patch(`${base}/checklist/:resultId`, auth, roles(), parser, handle((db, req, res) => {
    assertMaintenanceServiceAccess(db, req.params.id, req.user);
    res.json({ ok: true, report: updateMaintenanceServiceResult(db, req.params.id, req.params.resultId, req.body, req.user) });
  }));
  router.post(`${base}/defects`, auth, roles(), parser, handle((db, req, res) => {
    assertMaintenanceServiceAccess(db, req.params.id, req.user);
    res.json({ ok: true, report: updateMaintenanceServiceDefect(db, req.params.id, req.body?.resultId, req.body, req.user) });
  }));
  router.patch(`${base}/defects/:defectId`, auth, roles(), parser, handle((db, req, res) => {
    assertMaintenanceServiceAccess(db, req.params.id, req.user);
    const report = getMaintenanceServiceReport(db, req.params.id);
    const defect = report?.defects.find(defect => defect.id === req.params.defectId);
    if (!defect) throw new MaintenanceServiceError("Defect not found.", 404);
    res.json({ ok: true, report: updateMaintenanceServiceDefect(db, req.params.id, defect.resultId, req.body, req.user) });
  }));
  router.patch(base, auth, roles(), parser, handle((db, req, res) => {
    assertMaintenanceServiceAccess(db, req.params.id, req.user);
    res.json({ ok: true, report: updateMaintenanceServiceNotes(db, req.params.id, req.body) });
  }));
  router.post(`${base}/complete`, auth, roles(), parser, handle(async (db, req, res) => {
    assertMaintenanceServiceAccess(db, req.params.id, req.user);
    const result = await completeMaintenanceService(db, req.params.id, req.body, req.user, { returnChange: true });
    if (req.user.role === "technician") result.jobChange.maintenancePlan = null;
    res.json({ ok: true, ...result });
  }));
  const pdf = handle(async (db, req, res) => {
    const report = authorizedReport(db, req, { completed: true });
    const { bytes, filename } = await generatePdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${filename}"`);
    res.send(Buffer.from(bytes));
  }, { readonly: true });
  router.get(`${base}/report.pdf`, auth, roles(), pdf);
  router.get("/api/maintenance-service-reports/:reportId/report.pdf", auth, roles(true), pdf);
  router.get("/api/maintenance-service-reports/:reportId", auth, roles(true), handle((db, req, res) => {
    res.json({ ok: true, report: authorizedReport(db, req, { commercial: true, completed: true }) });
  }, { readonly: true }));
  router.get("/api/maintenance-plans/:id/service-history", auth, roles(true), handle((db, req, res) => {
    if (!["admin", "office"].includes(req.user?.role)) throw new MaintenanceServiceError("You do not have permission to view service history.", 403);
    res.json({ ok: true, reports: getMaintenanceServiceHistory(db, req.params.id) });
  }, { readonly: true }));
  router.get("/api/maintenance-service-reports", auth, roles(true), handle((db, req, res) => {
    if (!["admin", "office"].includes(req.user?.role)) throw new MaintenanceServiceError("You do not have permission to view service history.", 403);
    res.json({ ok: true, reports: getMaintenanceServiceHistory(db) });
  }, { readonly: true }));
  const send = handle(async (db, req, res) => {
    const report = authorizedReport(db, req, { commercial: true, completed: true });
    requireWorkspaceAddon(db, "maintenanceChecklists");
    const composed = normalizeDocumentEmail(req.body?.email ?? maintenanceServiceEmailDraft(report));
    if (Object.keys(composed.errors).length) throw new DocumentEmailError("maintenance", "INVALID_EMAIL", { fieldErrors: composed.errors });
    if (!createTransport && ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].some(key => !env[key])) {
      throw new MaintenanceServiceError(documentSendErrorMessage("maintenance", "EMAIL_NOT_CONFIGURED"), 503, { code: "EMAIL_NOT_CONFIGURED" });
    }
    let attachment;
    try { attachment = await generatePdf(report); } catch { throw new DocumentEmailError("maintenance", "ATTACHMENT_FAILED"); }
    const port = Number(env.SMTP_PORT || 587);
    const result = await submitPdfEmail({ type: "maintenance", email: composed.email, attachment,
      defaultFromEmail: env.EMAIL_FROM,
      transportConfig: { host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === "true" || port === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } }, createTransport ? { createTransport } : {});
    try {
      const history = persistSend(db, report.id, result, req.user);
      res.json({ ...result, historySaved: true, history });
    } catch {
      // Delivery has already happened. A successful provider submission must never
      // turn into a generic failure that encourages duplicate customer mail.
      res.json({ ...result, historySaved: false,
        warning: [result.warning, "Email was accepted, but its send history could not be saved. Do not resend to recreate history. Ask an administrator to investigate."].filter(Boolean).join(" ") });
    }
  });
  router.post(`${base}/send`, auth, roles(true), parser, send);
  router.post("/api/maintenance-service-reports/:reportId/send", auth, roles(true), parser, send);
  router.use((error, _req, res, next) => {
    if (error.type === "entity.too.large") return res.status(413).json({ error: "Service report request is too large (maximum 512 KB)." });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON request." });
    next(error);
  });
  return router;
}
