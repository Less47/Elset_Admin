import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { readWorkspaceBrandingAsset, saveWorkspaceBrandingAsset, validateWorkspaceBrandingAsset, WorkspaceLogoError } from "./server-workspace-logo.js";
import { WORKSPACE_BRANDING_ASSETS, WORKSPACE_BRANDING_MAX_BYTES, WORKSPACE_BRANDING_TYPES } from "./src/lib/workspace-logo.js";

export function createWorkspaceLogoRouter({ requireAuth, requireRole, env = process.env }) {
  const router = express.Router();
  const editors = requireRole(["admin", "office"]);
  function openDb() {
    return openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false, fileMustExist: true });
  }
  const handle = (operation) => async (req, res, next) => {
    let db;
    res.set("Cache-Control", "private, no-store");
    try { await operation(req, res, () => (db = openDb())); } catch (error) { next(error); } finally { db?.close(); }
  };

  for (const [kind, { endpoint, label }] of Object.entries(WORKSPACE_BRANDING_ASSETS)) {
    router.put(endpoint, requireAuth, editors, (req, _res, next) => {
      if (!WORKSPACE_BRANDING_TYPES.includes(req.get("Content-Type")?.split(";")[0].trim().toLowerCase())) return next(new WorkspaceLogoError("Choose a PNG, JPEG or WebP image.", 415));
      next();
    }, express.raw({ type: () => true, limit: WORKSPACE_BRANDING_MAX_BYTES, inflate: false }), handle(async (req, res, open) => {
      const asset = await validateWorkspaceBrandingAsset(req.body, req.get("Content-Type").split(";")[0].trim().toLowerCase(), kind);
      res.json({ ok: true, ...saveWorkspaceBrandingAsset(open(), kind, asset) });
    }));
    router.delete(endpoint, requireAuth, editors, handle(async (_req, res, open) => {
      res.json({ ok: true, ...saveWorkspaceBrandingAsset(open(), kind, null) });
    }));
    router.get(`${endpoint}/:id`, requireAuth, handle(async (req, res, open) => {
      const asset = readWorkspaceBrandingAsset(open(), kind, req.params.id);
      if (!asset) throw new WorkspaceLogoError(`${label} not found.`, 404);
      res.set("X-Content-Type-Options", "nosniff");
      res.type(asset.mimeType).send(asset.bytes);
    }));
    router.use(endpoint, (error, _req, res, next) => {
      if (res.headersSent) return next(error);
      const tooLarge = error.type === "entity.too.large";
      res.set("Cache-Control", "private, no-store").status(tooLarge ? 413 : error.statusCode || error.status || 500).json({
        error: tooLarge ? `${label} must be 2 MB or smaller.` : error instanceof WorkspaceLogoError ? error.message : `Unable to load or save the ${label.toLowerCase()}.`,
      });
    });
  }
  return router;
}
