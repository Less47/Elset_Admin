import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";
import { readWorkspaceLogo, saveWorkspaceLogo, validateWorkspaceLogo, WorkspaceLogoError } from "./server-workspace-logo.js";
import { WORKSPACE_LOGO_MAX_BYTES, WORKSPACE_LOGO_TYPES } from "./src/lib/workspace-logo.js";

export function createWorkspaceLogoRouter({ requireAuth, requireRole, env = process.env }) {
  const router = express.Router();
  const endpoint = "/api/settings/workspace-logo";
  const editors = requireRole(["admin", "office"]);
  function openDb() {
    if (getWorkspaceStorageMode(env) !== "sqlite") throw new WorkspaceLogoError("Workspace branding requires SQLite workspace storage.", 409);
    return openWorkspaceDb({ dbPath: getWorkspaceDbPath(env) });
  }
  const handle = (operation) => async (req, res, next) => {
    let db;
    res.set("Cache-Control", "private, no-store");
    try { await operation(req, res, () => (db = openDb())); } catch (error) { next(error); } finally { db?.close(); }
  };

  router.put(endpoint, requireAuth, editors, (req, _res, next) => {
    if (!WORKSPACE_LOGO_TYPES.includes(req.get("Content-Type")?.split(";")[0].trim().toLowerCase())) return next(new WorkspaceLogoError("Choose a PNG, JPEG or WebP image.", 415));
    next();
  }, express.raw({ type: () => true, limit: WORKSPACE_LOGO_MAX_BYTES, inflate: false }), handle(async (req, res, open) => {
    const asset = await validateWorkspaceLogo(req.body, req.get("Content-Type").split(";")[0].trim().toLowerCase());
    res.json({ ok: true, ...saveWorkspaceLogo(open(), asset) });
  }));
  router.delete(endpoint, requireAuth, editors, handle(async (_req, res, open) => {
    res.json({ ok: true, ...saveWorkspaceLogo(open(), null) });
  }));
  router.get(`${endpoint}/:id`, requireAuth, handle(async (req, res, open) => {
    const asset = readWorkspaceLogo(open(), req.params.id);
    if (!asset) throw new WorkspaceLogoError("Workspace logo not found.", 404);
    res.set("X-Content-Type-Options", "nosniff");
    res.type(asset.mimeType).send(asset.bytes);
  }));
  router.use(endpoint, (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const tooLarge = error.type === "entity.too.large";
    res.set("Cache-Control", "private, no-store").status(tooLarge ? 413 : error.statusCode || error.status || 500).json({
      error: tooLarge ? "Workspace logo must be 2 MB or smaller." : error instanceof WorkspaceLogoError ? error.message : "Unable to load or save the workspace logo.",
    });
  });
  return router;
}
