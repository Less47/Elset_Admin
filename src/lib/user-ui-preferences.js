// Presentation only. Company/document settings never belong in this schema.
export const defaultAppearanceSettings = {
  pageBackgroundStart: "#0F90CD", pageBackgroundEnd: "#0F90CD",
  sidebarSurface: "#FFFFFF", sidebarHeader: "#0F90CD", sidebarActive: "#F69320",
  heroSurface: "#0F90CD", actionColor: "#F69320", borderColor: "#1E293B",
  dialogSurface: "#9FE4FB", dataViewSurface: "#EAF7FB", dataViewAccent: "#0F90CD",
  sidebarWidth: "standard", contentDensity: "comfortable",
};
export const appearanceSettingKeys = Object.keys(defaultAppearanceSettings);
export const boardPreferenceKeys = {
  "To Do": { view: "boardToDoView", sort: "boardToDoSort" },
  "In Progress": { view: "boardInProgressView", sort: "boardInProgressSort" },
  Completed: { view: "boardCompletedView", sort: "boardCompletedSort" },
};
export const defaultUserUiPreferences = {
  ...defaultAppearanceSettings,
  customerView: "list", siteView: "list",
  boardToDoView: "list", boardInProgressView: "list", boardCompletedView: "list",
  boardToDoSort: "recent", boardInProgressSort: "recent", boardCompletedSort: "recent",
  boardShowTagLabels: false, boardHiddenColumns: [],
};
export const userUiPreferenceKeys = Object.keys(defaultUserUiPreferences);
const allowedKeys = new Set(userUiPreferenceKeys);
const colorKeys = new Set(appearanceSettingKeys.filter((key) => key !== "sidebarWidth" && key !== "contentDensity"));
const choices = {
  sidebarWidth: ["icon-only", "compact", "standard", "wide"],
  contentDensity: ["compact", "comfortable", "spacious"],
  customerView: ["list", "grid"], siteView: ["list", "grid"],
};
for (const keys of Object.values(boardPreferenceKeys)) {
  choices[keys.view] = ["list", "grid", "compact"];
  choices[keys.sort] = ["recent", "oldest", "urgency", "customer", "scheduled", "value"];
}

export class UserUiPreferenceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "UserUiPreferenceError";
    this.statusCode = statusCode;
  }
}

export function validateUserUiPreferencePatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new UserUiPreferenceError("Preferences must be an object.");
  }
  const entries = Object.entries(input);
  if (!entries.length) throw new UserUiPreferenceError("Provide at least one preference.");
  const patch = {};
  for (const [key, value] of entries) {
    if (!allowedKeys.has(key)) throw new UserUiPreferenceError(`Unsupported preference: ${key}.`);
    if (colorKeys.has(key)) {
      if (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim())) {
        throw new UserUiPreferenceError(`${key} must be a valid hex colour.`);
      }
      const hex = value.trim().slice(1);
      patch[key] = "#" + (hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex).toUpperCase();
    } else if (Object.hasOwn(choices, key)) {
      if (!choices[key].includes(value)) throw new UserUiPreferenceError(`${key} is invalid.`);
      patch[key] = value;
    } else if (key === "boardShowTagLabels") {
      if (typeof value !== "boolean") throw new UserUiPreferenceError(`${key} must be a boolean.`);
      patch[key] = value;
    } else if (key === "boardHiddenColumns") {
      if (!Array.isArray(value) || value.length > 3 || value.some((status) => !Object.hasOwn(boardPreferenceKeys, status))) {
        throw new UserUiPreferenceError("Hidden columns must contain supported board columns.");
      }
      patch[key] = [...new Set(value)];
    }
  }
  return patch;
}

export function normalizeUserUiPreferences(...sources) {
  const result = { ...defaultUserUiPreferences, boardHiddenColumns: [] };
  for (const source of sources) {
    for (const key of userUiPreferenceKeys) {
      if (!source || !Object.hasOwn(source, key)) continue;
      try { Object.assign(result, validateUserUiPreferencePatch({ [key]: source[key] })); } catch { /* Retain the safe fallback. */ }
    }
  }
  return result;
}
