import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceAddons, updateWorkspaceAddons, WorkspaceAddonError } from "./server-workspace-addons.js";

export function createAddonRouter({ requireAuth, requireRole, env = globalThis.process?.env || {} } = {}) {
  const router = express.Router();
  const auth = requireAuth || ((_req, _res, next) => next());
  const manage = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const handle = (update) => (req, res) => {
    let db;
    res.setHeader("Cache-Control", "no-store");
    try {
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), readonly: !update, migrate: false, fileMustExist: true });
      return res.json({ ok: true, result: update ? updateWorkspaceAddons(db, req.body) : getWorkspaceAddons(db) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error instanceof WorkspaceAddonError ? error.message : "Unable to access workspace add-ons." });
    } finally { db?.close(); }
  };
  router.get("/api/settings/addons", auth, handle(false));
  router.patch("/api/settings/addons", auth, manage, handle(true));
  return router;
}

export function registerAddonRoutes(app, options = {}) {
  app.use(createAddonRouter(options));
}
