import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";
import { WorkspaceAddonError } from "./server-workspace-addons.js";
import { createJobCostEntry, deleteJobCostEntry, getJobCostingSummary, updateJobCostEntry, WorkspaceJobCostingError } from "./server-workspace-job-costing.js";

export function createJobCostingRouter({ requireAuth, requireRole, env = globalThis.process?.env || {} } = {}) {
  const router = express.Router();
  const auth = requireAuth || ((_req, _res, next) => next());
  const commercial = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const handle = (operation, readonly = false) => (req, res) => {
    let db;
    res.setHeader("Cache-Control", "no-store");
    try {
      if (getWorkspaceStorageMode(env) !== "sqlite") throw new WorkspaceJobCostingError("Job Costing requires SQLite workspace storage.", 409);
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), readonly, migrate: false });
      return res.json({ ok: true, result: operation(db, req) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error instanceof WorkspaceAddonError || error instanceof WorkspaceJobCostingError ? error.message : "Unable to access job costing.",
        ...(error.code === "ADDON_DISABLED" ? { code: error.code, addon: error.addon } : {}),
      });
    } finally { db?.close(); }
  };
  router.get("/api/jobs/:id/costing", auth, commercial, handle((db, req) => getJobCostingSummary(db, req.params.id), true));
  router.post("/api/jobs/:id/costs", auth, commercial, handle((db, req) => createJobCostEntry(db, req.params.id, req.body, { userId: req.user?.id })));
  router.patch("/api/jobs/:id/costs/:costId", auth, commercial, handle((db, req) => updateJobCostEntry(db, req.params.id, req.params.costId, req.body)));
  router.delete("/api/jobs/:id/costs/:costId", auth, commercial, handle((db, req) => deleteJobCostEntry(db, req.params.id, req.params.costId)));
  return router;
}

export function registerJobCostingRoutes(app, options = {}) {
  app.use(createJobCostingRouter(options));
}
