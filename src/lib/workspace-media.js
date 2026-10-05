export const STAFF_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const SITE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MEDIA_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";

export const mediaUrl = (id, thumbnail = false) => `/api/media/${encodeURIComponent(id)}/${thumbnail ? "thumbnail" : "image"}`;
export const staffInitials = (name = "") => String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";

export async function mediaRequest(fetchWithAuth, path, options) {
  const response = await fetchWithAuth(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to update photos.");
  return payload;
}

export function uploadMedia(fetchWithAuth, path, file) {
  return mediaRequest(fetchWithAuth, path, {
    method: "PUT", headers: { "Content-Type": file.type, "X-Media-Filename": encodeURIComponent(file.name) }, body: file,
  });
}
