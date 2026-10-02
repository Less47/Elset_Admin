import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  WORKSPACE_BRANDING_ASSETS, WORKSPACE_BRANDING_MAX_BYTES, WORKSPACE_BRANDING_MAX_DIMENSION,
  WORKSPACE_BRANDING_MAX_PIXELS, WORKSPACE_BRANDING_TYPES, workspaceBrandingUrl,
} from "./src/lib/workspace-logo.js";

export class WorkspaceLogoError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

function detectedMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

export async function validateWorkspaceBrandingAsset(bytes, mimeType, kind) {
  const { label } = WORKSPACE_BRANDING_ASSETS[kind];
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new WorkspaceLogoError("Choose a PNG, JPEG or WebP image.");
  if (bytes.length > WORKSPACE_BRANDING_MAX_BYTES) throw new WorkspaceLogoError(`${label} must be 2 MB or smaller.`, 413);
  if (!WORKSPACE_BRANDING_TYPES.includes(mimeType) || detectedMime(bytes) !== mimeType) {
    throw new WorkspaceLogoError("The file must be a PNG, JPEG or WebP image matching its file type.");
  }
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: WORKSPACE_BRANDING_MAX_PIXELS });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width > WORKSPACE_BRANDING_MAX_DIMENSION || metadata.height > WORKSPACE_BRANDING_MAX_DIMENSION) {
      throw new WorkspaceLogoError("Image dimensions must be at most 4096 pixels per side and 8 megapixels in total.");
    }
    if ((metadata.pages || 1) !== 1) throw new WorkspaceLogoError("Choose a static branding image, without animation.");
    // Decode all pixels to reject corrupt/truncated uploads, but store the original bytes.
    await image.stats();
    return { id: createHash("sha256").update(bytes).digest("hex"), mimeType, width: metadata.width, height: metadata.height, data: bytes.toString("base64") };
  } catch (error) {
    if (error instanceof WorkspaceLogoError) throw error;
    throw new WorkspaceLogoError("Unable to read this image. Use a valid PNG, JPEG or WebP up to 4096 pixels per side and 8 megapixels.");
  }
}

export function saveWorkspaceBrandingAsset(db, kind, asset) {
  const { key, urlKey } = WORKSPACE_BRANDING_ASSETS[kind];
  return db.transaction(() => {
    const updatedAt = new Date().toISOString();
    if (asset) {
      db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
        .run(key, JSON.stringify(asset), updatedAt);
    } else {
      db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    }
    db.prepare("UPDATE workspace_info SET updated_at = ? WHERE id = 1").run(updatedAt);
    return { [urlKey]: workspaceBrandingUrl(kind, asset?.id) };
  })();
}

export function readWorkspaceBrandingAsset(db, kind, id) {
  if (!workspaceBrandingUrl(kind, id)) return null;
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(WORKSPACE_BRANDING_ASSETS[kind].key);
  let asset;
  try { asset = JSON.parse(row?.value_json || "null"); } catch { return null; }
  if (asset?.id !== id || typeof asset.data !== "string" || asset.data.length > Math.ceil(WORKSPACE_BRANDING_MAX_BYTES / 3) * 4) return null;
  const bytes = Buffer.from(asset.data, "base64");
  if (!WORKSPACE_BRANDING_TYPES.includes(asset.mimeType) || detectedMime(bytes) !== asset.mimeType || createHash("sha256").update(bytes).digest("hex") !== id) return null;
  return { bytes, mimeType: asset.mimeType };
}

export const validateWorkspaceLogo = (bytes, mimeType) => validateWorkspaceBrandingAsset(bytes, mimeType, "logo");
export const saveWorkspaceLogo = (db, asset) => saveWorkspaceBrandingAsset(db, "logo", asset);
export const readWorkspaceLogo = (db, id) => readWorkspaceBrandingAsset(db, "logo", id);
