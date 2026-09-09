import { createThemeSettingsSaveQueue } from "./theme-settings-save-queue.js";
import { normalizeUserUiPreferences, validateUserUiPreferencePatch } from "../lib/user-ui-preferences.js";

export function createUserUiPreferencesStore({ fetchWithAuth, sessionKey }) {
  let generation = 0;
  let controller;
  let unsubscribeQueue;
  let snapshot = { stored: null, loaded: !sessionKey, loadError: "", overrides: {}, status: "idle", error: "" };
  const listeners = new Set();
  function publish(update) {
    snapshot = { ...snapshot, ...update };
    listeners.forEach((listener) => listener());
  }
  async function request(options = {}) {
    if (!sessionKey || !controller || controller.signal.aborted) throw new Error("Sign in to save personal preferences.");
    const response = await fetchWithAuth("/api/user-preferences", { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.preferences) throw new Error(payload.error || "Personal preferences could not be saved or loaded.");
    return payload;
  }
  const queue = createThemeSettingsSaveQueue({
    save: (patch) => request({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
    onSaved: (_patch, payload) => publish({ stored: normalizeUserUiPreferences(payload.preferences) }),
  });
  async function load() {
    const started = generation;
    try {
      const payload = await request();
      if (started === generation) publish({ stored: normalizeUserUiPreferences(payload.preferences), loaded: true, loadError: "" });
    } catch (error) {
      if (started === generation) publish({ loaded: true, loadError: error.message || "Personal preferences could not be loaded." });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    activate() {
      generation++;
      controller = new AbortController();
      queue.activate();
      unsubscribeQueue = queue.subscribe(() => publish(queue.getSnapshot()));
      if (sessionKey) void load();
    },
    dispose() {
      generation++;
      controller?.abort();
      unsubscribeQueue?.();
      queue.dispose();
    },
    change(values) {
      if (!sessionKey || controller?.signal.aborted) return false;
      try { return queue.change(validateUserUiPreferencePatch(values)); } catch { return false; }
    },
    retry() {
      if (snapshot.loadError) void load();
      queue.retry();
    },
  };
}
