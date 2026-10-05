import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { MEDIA_IMAGE_TYPES, SITE_PHOTO_MAX_BYTES, STAFF_PHOTO_MAX_BYTES } from "./src/lib/workspace-media.js";
import { authorizeMediaOwner, listSitePhotos, processMediaImage, readSiteJobImage, removeOwnerPhoto, saveOwnerPhoto, WorkspaceMediaError } from "./server-workspace-media.js";

export function createWorkspaceMediaRouter({ requireAuth, requireRole, env = process.env }) {
  const router = express.Router();
  const editors = requireRole(["admin", "office"]);
  const handle = (operation, readonly = false) => async (req, res, next) => {
    let db;
    res.set("Cache-Control", "private, no-store");
    try {
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), readonly, migrate: false, fileMustExist: true });
      await operation(db, req, res);
    } catch (error) { next(error); } finally { db?.close(); }
  };
  const serve = (res, bytes, mimeType) => res.set("X-Content-Type-Options", "nosniff").type(mimeType).send(bytes);
  for (const [type, endpoint, maxBytes] of [["staff", "/api/staff/:id/avatar", STAFF_PHOTO_MAX_BYTES], ["site", "/api/sites/:id/photos", SITE_PHOTO_MAX_BYTES]]) {
    router.put(endpoint, requireAuth, editors, (req, _res, next) => {
      if (!MEDIA_IMAGE_TYPES.includes(req.get("Content-Type")?.split(";")[0].trim().toLowerCase())) return next(new WorkspaceMediaError("Choose a JPEG, PNG or WebP image.", 415));
      next();
    }, express.raw({ type: () => true, limit: maxBytes, inflate: false }), async (req, _res, next) => {
      try {
        const db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), readonly: true, migrate: false, fileMustExist: true });
        try { authorizeMediaOwner(db, req.user, type, req.params.id, true); } finally { db.close(); }
        try { req.mediaFilename = decodeURIComponent(req.get("X-Media-Filename") || "photo"); } catch { throw new WorkspaceMediaError("Invalid filename."); }
        req.processedMedia = await processMediaImage(req.body, req.get("Content-Type").split(";")[0].trim().toLowerCase(), type, req.mediaFilename);
        next();
      } catch (error) { next(error); }
    }, handle(async (db, req, res) => {
      // Open afresh after decoding, so a concurrent restore/owner deletion cannot
      // publish bytes to an old database handle or an owner that no longer exists.
      res.json({ ok: true, photo: saveOwnerPhoto(db, req.user, type, req.params.id, req.processedMedia, req.mediaFilename) });
    }));
    router.delete(type === "site" ? `${endpoint}/:photoId` : endpoint, requireAuth, editors, handle(async (db, req, res) => {
      removeOwnerPhoto(db, req.user, type, req.params.id, req.params.photoId);
      res.json({ ok: true });
    }));
  }
  router.get("/api/sites/:id/photos", requireAuth, handle(async (db, req, res) => {
    res.json(listSitePhotos(db, req.user, req.params.id, { source: req.query.source || "all", offset: Number(req.query.offset || 0), limit: Number(req.query.limit || 30) }));
  }, true));
  router.patch("/api/sites/:id/photos/:photoId", requireAuth, editors, express.json({ limit: "2kb" }), handle(async (db, req, res) => {
    authorizeMediaOwner(db, req.user, "site", req.params.id, true);
    const caption = req.body?.caption;
    if (typeof caption !== "string" || caption.trim().length > 240) throw new WorkspaceMediaError("Caption must be 240 characters or fewer.");
    const result = db.prepare("UPDATE workspace_media SET caption=? WHERE owner_type='site' AND owner_id=? AND id=?").run(caption.trim(), req.params.id, req.params.photoId);
    if (!result.changes) throw new WorkspaceMediaError("Site photo not found.", 404);
    db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(new Date().toISOString());
    res.json({ ok: true, caption: caption.trim() });
  }));
  router.get("/api/media/:photoId/:variant", requireAuth, handle(async (db, req, res) => {
    if (!["image", "thumbnail"].includes(req.params.variant)) throw new WorkspaceMediaError("Image not found.", 404);
    const row = db.prepare("SELECT owner_type,owner_id FROM workspace_media WHERE id=?").get(req.params.photoId);
    if (!row) throw new WorkspaceMediaError("Image not found.", 404);
    authorizeMediaOwner(db, req.user, row.owner_type, row.owner_id);
    const data = db.prepare(`SELECT ${req.params.variant === "thumbnail" ? "thumbnail" : "image"} AS bytes,mime_type FROM workspace_media WHERE id=?`).get(req.params.photoId);
    serve(res, data.bytes, data.mime_type);
  }, true));
  router.get("/api/sites/:id/photos/jobs/:photoId/:variant", requireAuth, handle(async (db, req, res) => {
    if (!["image", "thumbnail"].includes(req.params.variant)) throw new WorkspaceMediaError("Image not found.", 404);
    const image = await readSiteJobImage(db, req.user, req.params.id, req.params.photoId, req.params.variant === "thumbnail");
    serve(res, image.bytes, image.mimeType);
  }, true));
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    res.set("Cache-Control", "private, no-store").status(error.type === "entity.too.large" ? 413 : error.statusCode || error.status || 500)
      .json({ error: error.type === "entity.too.large" ? "Photo exceeds the upload size limit." : error instanceof WorkspaceMediaError ? error.message : "Unable to load or save photos." });
  });
  return router;
}
