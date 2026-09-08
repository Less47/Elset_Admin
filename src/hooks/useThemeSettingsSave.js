import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isHexColorDraftValid, normalizeThemeSettings, pickSettings, preferenceSettingKeys, themeColorFields, uiSettingKeys } from "@/lib/app-support";
import { createThemeSettingsSaveQueue, PREFERENCE_SAVE_DEBOUNCE_MS } from "./theme-settings-save-queue";
import { requestSettingsWorkspaceUpdate } from "./workspace-customer-api";

export function useThemeSettingsSave({ settings, fetchWithAuth, setData, sessionKey }) {
  const [saveScope, setSaveScope] = useState("theme");
  const queue = useMemo(() => createThemeSettingsSaveQueue({
    save: (patch) => {
      const isPreferencePatch = Object.keys(patch).some((key) => preferenceSettingKeys.includes(key));
      if (!sessionKey) throw new Error(isPreferencePatch ? "Sign in to save preference changes." : "Sign in to save theme changes.");
      return requestSettingsWorkspaceUpdate({
        fetchWithAuth,
        path: "/api/settings",
        method: "PATCH",
        body: { settings: patch },
        errorMessage: isPreferencePatch ? "Preference changes could not be saved." : "Theme change could not be saved.",
      });
    },
    onSaved: (patch, payload) => {
      const saved = payload.result?.settings || payload.state.settings;
      // This endpoint returns the entire workspace. A theme acknowledgement
      // must not replace jobs, other settings, or newer local theme selections.
      const acknowledged = Object.fromEntries(Object.keys(patch).map((key) => [key, saved[key]]));
      setData((previous) => ({ ...previous, settings: { ...previous.settings, ...acknowledged } }));
    },
  }), [fetchWithAuth, sessionKey, setData]);

  useEffect(() => {
    queue.activate();
    return () => queue.dispose();
  }, [queue]);

  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const visualSettings = useMemo(() => ({ ...settings, ...snapshot.overrides }), [settings, snapshot.overrides]);

  function change(values) {
    const keys = uiSettingKeys.filter((key) => Object.hasOwn(values, key));
    const colourKeys = themeColorFields.map((field) => field.key);
    if (keys.some((key) => colourKeys.includes(key) && !isHexColorDraftValid(values[key]))) return false;
    setSaveScope("theme");
    return queue.change(pickSettings(normalizeThemeSettings(values), keys));
  }

  function changePreferences(values, { immediate = false } = {}) {
    const keys = preferenceSettingKeys.filter((key) => Object.hasOwn(values, key));
    const patch = Object.fromEntries(keys.map((key) => [key, String(values[key] ?? "")]));
    setSaveScope("preferences");
    return queue.change(patch, immediate ? 0 : PREFERENCE_SAVE_DEBOUNCE_MS);
  }

  return { settings: visualSettings, status: snapshot.status, error: snapshot.error, scope: saveScope, change, changePreferences, retry: queue.retry };
}
