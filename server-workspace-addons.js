import { ADDONS, ACCOUNTING_PROVIDERS, isAddonEnabled, normalizeAddonState } from "./src/lib/addons.js";

export class WorkspaceAddonError extends Error {
  constructor(message, statusCode = 400, code = "") {
    super(message);
    this.name = "WorkspaceAddonError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function getWorkspaceAddons(db) {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'addons'").get();
  return normalizeAddonState(row ? JSON.parse(row.value_json) : {});
}

export function requireWorkspaceAddon(db, key) {
  if (ACCOUNTING_PROVIDERS.includes(key) && ACCOUNTING_PROVIDERS.filter((id) => getWorkspaceAddons(db)[id]).length > 1) {
    throw new WorkspaceAddonError("Only one accounting provider may be enabled. Disable the other provider in Settings → Add-ons.", 409, "ACCOUNTING_PROVIDER_CONFLICT");
  }
  if (!isAddonEnabled(getWorkspaceAddons(db), key)) {
    const error = new WorkspaceAddonError(`${ADDONS[key]?.name || "This add-on"} is disabled for this workspace.`, 403, "ADDON_DISABLED");
    error.addon = key;
    throw error;
  }
}

export function updateWorkspaceAddons(db, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length) {
    throw new WorkspaceAddonError("Add-on settings must be a non-empty object.");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(ADDONS, key)) throw new WorkspaceAddonError("Unknown add-on.");
    if (typeof value !== "boolean") throw new WorkspaceAddonError("Add-on enablement must be true or false.");
  }
  return db.transaction(() => {
    const addons = { ...getWorkspaceAddons(db), ...patch };
    if (ACCOUNTING_PROVIDERS.filter((key) => addons[key]).length > 1) {
      throw new WorkspaceAddonError("Only one accounting provider may be enabled. Disable the current accounting add-on before enabling another. Existing connections and history will be retained.", 409, "ACCOUNTING_PROVIDER_CONFLICT");
    }
    if (ACCOUNTING_PROVIDERS.some((key) => patch[key] !== undefined && patch[key] !== getWorkspaceAddons(db)[key])
      && db.prepare("SELECT 1 FROM integration_locks WHERE expires_at>? LIMIT 1").get(Date.now())) {
      throw new WorkspaceAddonError("An accounting request is in progress. Wait for it to finish before changing providers.", 409, "INTEGRATION_BUSY");
    }
    const updatedAt = new Date().toISOString();
    db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES ('addons', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
      .run(JSON.stringify(addons), updatedAt);
    db.prepare("UPDATE workspace_info SET updated_at = ? WHERE id = 1").run(updatedAt);
    return addons;
  })();
}
