import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isHexColorDraftValid, normalizeThemeSettings, pickSettings, themeColorFields, uiSettingKeys } from "@/lib/app-support";
import { createThemeSettingsSaveQueue } from "./theme-settings-save-queue";
import { requestSettingsWorkspaceUpdate } from "./workspace-customer-api";

export function useThemeSettingsSave({ settings, fetchWithAuth, setData, sessionKey }) {
  const queue = useMemo(() => createThemeSettingsSaveQueue({
    save: (patch) => {
      if (!sessionKey) throw new Error("Sign in to save theme changes.");
      return requestSettingsWorkspaceUpdate({
        fetchWithAuth,
        path: "/api/settings",
        method: "PATCH",
        body: { settings: patch },
        errorMessage: "Theme change could not be saved.",
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
    return queue.change(pickSettings(normalizeThemeSettings(values), keys));
  }

  return { settings: visualSettings, status: snapshot.status, error: snapshot.error, change, retry: queue.retry };
}
