import { requestSettingsWorkspaceUpdate } from "./workspace-customer-api";
import { normalizeDocumentTemplate } from "@/lib/quote-template";
import { settingsPatch } from "@/lib/settings-draft";
import { pickSettings, preferenceSettingKeys, uiSettingKeys } from "@/lib/app-support";

// Imperative writes only: the Settings draft owns previews and error state.
export function useSettingsPersistence({ session, personal, setData }) {
  return {
    async preferences(draft, baseline) {
      const patch = settingsPatch(baseline, draft);
      // The settings API preserves text and trims email fields. A successful
      // targeted write acknowledges that patch, not unrelated snapshot values.
      for (const key of Object.keys(patch)) if (key.endsWith("Email")) patch[key] = patch[key].trim();
      await requestSettingsWorkspaceUpdate({ fetchWithAuth: session.fetchWithAuth, path: "/api/settings", method: "PATCH", body: { settings: patch }, errorMessage: "Preference changes could not be saved." });
      const saved = { ...baseline, ...patch };
      setData(previous => ({ ...previous, settings: { ...previous.settings, ...Object.fromEntries(Object.keys(patch).map(key => [key, saved[key]])) } }));
      return pickSettings(saved, preferenceSettingKeys);
    },
    async appearance(draft, baseline) {
      return pickSettings(await personal.save(settingsPatch(baseline, draft)), uiSettingKeys);
    },
    async template(type, draft) {
      const normalized = normalizeDocumentTemplate(draft, type), key = type === "invoice" ? "invoiceTemplate" : "quoteTemplate";
      const payload = await requestSettingsWorkspaceUpdate({ fetchWithAuth: session.fetchWithAuth, path: `/api/document-templates/${type}`, method: "PUT", body: { template: normalized } });
      const saved = payload.delta?.[key] || payload.state?.[key];
      setData(previous => ({ ...previous, [key]: saved }));
      return saved;
    },
  };
}
