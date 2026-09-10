export const WORKSPACE_LOGO_KEY = "workspaceLogo";
export const WORKSPACE_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_LOGO_MAX_DIMENSION = 4096;
export const WORKSPACE_LOGO_MAX_PIXELS = 8_000_000;
export const WORKSPACE_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function workspaceLogoUrl(id) {
  return typeof id === "string" && /^[a-f0-9]{64}$/.test(id) ? `/api/settings/workspace-logo/${id}` : "";
}

export function isWorkspaceLogoUrl(value) {
  return typeof value === "string" && /^\/api\/settings\/workspace-logo\/[a-f0-9]{64}$/.test(value);
}
