export const WORKSPACE_LOGO_KEY = "workspaceLogo";
export const WORKSPACE_BRAND_MARK_KEY = "workspaceBrandMark";
export const WORKSPACE_BRANDING_MAX_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_BRANDING_MAX_DIMENSION = 4096;
export const WORKSPACE_BRANDING_MAX_PIXELS = 8_000_000;
export const WORKSPACE_BRANDING_TYPES = ["image/png", "image/jpeg", "image/webp"];
// Keep the existing company-logo API and imports stable.
export const WORKSPACE_LOGO_MAX_BYTES = WORKSPACE_BRANDING_MAX_BYTES;
export const WORKSPACE_LOGO_MAX_DIMENSION = WORKSPACE_BRANDING_MAX_DIMENSION;
export const WORKSPACE_LOGO_MAX_PIXELS = WORKSPACE_BRANDING_MAX_PIXELS;
export const WORKSPACE_LOGO_TYPES = WORKSPACE_BRANDING_TYPES;

export const WORKSPACE_BRANDING_ASSETS = Object.freeze({
  logo: { key: WORKSPACE_LOGO_KEY, urlKey: "workspaceLogoUrl", endpoint: "/api/settings/workspace-logo", label: "Workspace logo" },
  mark: { key: WORKSPACE_BRAND_MARK_KEY, urlKey: "workspaceBrandMarkUrl", endpoint: "/api/settings/workspace-brand-mark", label: "Brand mark" },
});

export function workspaceBrandingUrl(kind, id) {
  const asset = WORKSPACE_BRANDING_ASSETS[kind];
  return asset && typeof id === "string" && /^[a-f0-9]{64}$/.test(id) ? `${asset.endpoint}/${id}` : "";
}

export function isWorkspaceBrandingUrl(kind, value) {
  const endpoint = WORKSPACE_BRANDING_ASSETS[kind]?.endpoint;
  return Boolean(endpoint && typeof value === "string" && value.startsWith(`${endpoint}/`) && /^[a-f0-9]{64}$/.test(value.slice(endpoint.length + 1)));
}

export function workspaceLogoUrl(id) {
  return workspaceBrandingUrl("logo", id);
}

export function isWorkspaceLogoUrl(value) {
  return isWorkspaceBrandingUrl("logo", value);
}

export const workspaceBrandMarkUrl = id => workspaceBrandingUrl("mark", id);
export const isWorkspaceBrandMarkUrl = value => isWorkspaceBrandingUrl("mark", value);
