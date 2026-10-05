import crypto from "node:crypto";
import sharp from "sharp";
import { MEDIA_IMAGE_TYPES, SITE_PHOTO_MAX_BYTES, STAFF_PHOTO_MAX_BYTES, mediaUrl } from "./src/lib/workspace-media.js";

export class WorkspaceMediaError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

export function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

export async function processMediaImage(bytes, mimeType, ownerType, filename = "photo") {
  const maxBytes = ownerType === "staff" ? STAFF_PHOTO_MAX_BYTES : SITE_PHOTO_MAX_BYTES;
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new WorkspaceMediaError("Choose a JPEG, PNG or WebP image.");
  if (bytes.length > maxBytes) throw new WorkspaceMediaError(`Photo must be ${maxBytes / 1024 / 1024} MB or smaller.`, 413);
  if (!MEDIA_IMAGE_TYPES.includes(mimeType) || imageMime(bytes) !== mimeType) throw new WorkspaceMediaError("Image contents must match a JPEG, PNG or WebP file type.", 415);
  const extension = String(filename).split(".").at(-1).toLowerCase();
  if (String(filename).includes(".") && !({ "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"] })[mimeType].includes(extension)) {
    throw new WorkspaceMediaError("The filename extension must match the image type.", 415);
  }
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 24_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width > 12000 || metadata.height > 12000 || (metadata.pages || 1) !== 1) {
      throw new WorkspaceMediaError("Use a static image up to 12000 pixels per side and 24 megapixels.");
    }
    const avatar = ownerType === "staff";
    const full = await image.rotate().resize(avatar ? 512 : 2048, avatar ? 512 : 2048, {
      fit: avatar ? "cover" : "inside", withoutEnlargement: true,
    }).webp({ quality: 85 }).toBuffer();
    const thumbnail = await sharp(full).resize(avatar ? 96 : 320, avatar ? 96 : 320, { fit: "cover", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    if (full.length > SITE_PHOTO_MAX_BYTES || thumbnail.length > 262144) throw new WorkspaceMediaError("Processed image is too large.", 413);
    return { image: full, thumbnail, mimeType: "image/webp" };
  } catch (error) {
    if (error instanceof WorkspaceMediaError) throw error;
    throw new WorkspaceMediaError("Unable to decode this image. Use a valid static JPEG, PNG or WebP up to 24 megapixels.");
  }
}

const editors = user => ["admin", "office"].includes(user?.role);
export function authorizeMediaOwner(db, user, type, id, mutation = false) {
  if (!user || !["admin", "office", "technician"].includes(user.role) || (mutation && !editors(user))) throw new WorkspaceMediaError("You do not have permission to access these photos.", 403);
  const row = db.prepare(`SELECT id FROM ${type === "staff" ? "staff" : "sites"} WHERE id=?`).get(id);
  if (!row) throw new WorkspaceMediaError("Photo owner not found.", 404);
  if (editors(user)) return;
  // Existing technician policy exposes all active jobs. Only grant Site media
  // access when one of those jobs explicitly names this Site, never by customer/address.
  const allowed = type === "staff" ? user.staffId === id || db.prepare("SELECT 1 FROM jobs WHERE assigned_technician_id=? LIMIT 1").get(id)
    : db.prepare("SELECT 1 FROM jobs WHERE site_id=? LIMIT 1").get(id);
  if (!allowed) throw new WorkspaceMediaError("Photo owner not found.", 404);
}

const metadataColumns = "id,owner_type,owner_id,name,mime_type,size_bytes,caption,uploaded_by,created_at";
export function mediaMetadata(row) {
  return { id: row.id, source: row.owner_type, ownerId: row.owner_id, name: row.name, mimeType: row.mime_type,
    sizeBytes: row.size_bytes, caption: row.caption, uploadedBy: row.uploaded_by, createdAt: row.created_at,
    url: mediaUrl(row.id), thumbnailUrl: mediaUrl(row.id, true) };
}

export function readStaffAvatar(db, staffId) {
  const row = db.prepare(`SELECT ${metadataColumns} FROM workspace_media WHERE owner_type='staff' AND owner_id=?`).get(staffId);
  return row ? mediaMetadata(row) : null;
}

export function saveOwnerPhoto(db, user, type, ownerId, processed, filename) {
  return db.transaction(() => {
    authorizeMediaOwner(db, user, type, ownerId, true);
    if (type === "staff") db.prepare("DELETE FROM workspace_media WHERE owner_type='staff' AND owner_id=?").run(ownerId);
    const id = crypto.randomUUID(), createdAt = new Date().toISOString();
    // Filename is display metadata only, never a filesystem path or response header.
    const name = [...String(filename || "Photo").replaceAll("\\", "/").split("/").at(-1)].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").slice(0, 180) || "Photo";
    db.prepare(`INSERT INTO workspace_media(id,owner_type,owner_id,name,mime_type,size_bytes,image,thumbnail,uploaded_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, type, ownerId, name, processed.mimeType, processed.image.length, processed.image, processed.thumbnail, user.name || user.username || user.id || "", createdAt);
    db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(createdAt);
    return mediaMetadata(db.prepare(`SELECT ${metadataColumns} FROM workspace_media WHERE id=?`).get(id));
  }).immediate();
}

export function removeOwnerPhoto(db, user, type, ownerId, photoId) {
  return db.transaction(() => {
    authorizeMediaOwner(db, user, type, ownerId, true);
    const result = type === "staff" ? db.prepare("DELETE FROM workspace_media WHERE owner_type='staff' AND owner_id=?").run(ownerId)
      : db.prepare("DELETE FROM workspace_media WHERE owner_type='site' AND owner_id=? AND id=?").run(ownerId, photoId);
    if (type === "site" && !result.changes) throw new WorkspaceMediaError("Site photo not found.", 404);
    db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(new Date().toISOString());
  }).immediate();
}

export function listSitePhotos(db, user, siteId, { source = "all", offset = 0, limit = 30 } = {}) {
  authorizeMediaOwner(db, user, "site", siteId);
  if (!["all", "site", "job"].includes(source)) throw new WorkspaceMediaError("Unknown photo filter.");
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 60) throw new WorkspaceMediaError("Invalid photo page.");
  // Select metadata only. No original images, data URLs or BLOBs in gallery responses.
  const rows = db.prepare(`SELECT * FROM (
    SELECT id,'site' AS source,name,caption,uploaded_by,created_at,NULL AS job_id,NULL AS job_number,NULL AS job_title,NULL AS job_date
      FROM workspace_media WHERE owner_type='site' AND owner_id=? AND ? != 'job'
    UNION ALL
    SELECT a.id,'job',a.name,'','',a.created_at,j.id,j.job_number,j.title,COALESCE(NULLIF(j.scheduled_date,''),j.created_at)
      FROM job_attachments a JOIN jobs j ON a.job_id=j.id JOIN sites s ON j.site_id=s.id AND j.customer_id=s.customer_id
      WHERE j.site_id=? AND a.kind='photo' AND ? != 'site'
  ) ORDER BY created_at DESC,source,id LIMIT ? OFFSET ?`).all(siteId, source, siteId, source, limit + 1, offset);
  const photos = rows.slice(0, limit).map(row => ({ id: row.id, source: row.source, name: row.name, caption: row.caption,
    uploadedBy: row.uploaded_by, createdAt: row.created_at, jobId: row.job_id, jobNumber: row.job_number, jobTitle: row.job_title, jobDate: row.job_date,
    url: row.source === "site" ? mediaUrl(row.id) : `/api/sites/${encodeURIComponent(siteId)}/photos/jobs/${encodeURIComponent(row.id)}/image`,
    thumbnailUrl: row.source === "site" ? mediaUrl(row.id, true) : `/api/sites/${encodeURIComponent(siteId)}/photos/jobs/${encodeURIComponent(row.id)}/thumbnail`,
  }));
  return { photos, nextOffset: rows.length > limit ? offset + limit : null };
}

export async function readSiteJobImage(db, user, siteId, photoId, thumbnail) {
  authorizeMediaOwner(db, user, "site", siteId);
  const row = db.prepare(`SELECT a.url FROM job_attachments a JOIN jobs j ON a.job_id=j.id JOIN sites s ON j.site_id=s.id AND j.customer_id=s.customer_id
    WHERE j.site_id=? AND a.id=? AND a.kind='photo'`).get(siteId, photoId);
  // Existing job uploads are data URLs in SQLite. Never fetch arbitrary legacy
  // URLs or read legacy paths; unavailable media keeps its source context in UI.
  const match = row?.url?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match || match[2].length > Math.ceil(SITE_PHOTO_MAX_BYTES / 3) * 4 + 100) throw new WorkspaceMediaError("Job image unavailable.", 404);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > SITE_PHOTO_MAX_BYTES || imageMime(bytes) !== match[1]) throw new WorkspaceMediaError("Job image unavailable.", 404);
  if (!thumbnail) return { bytes, mimeType: match[1] };
  try {
    const bytesThumb = await sharp(bytes, { failOn: "warning", limitInputPixels: 24_000_000 }).rotate().resize(320, 320, { fit: "cover", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    return { bytes: bytesThumb, mimeType: "image/webp" };
  } catch { throw new WorkspaceMediaError("Job image unavailable.", 404); }
}
