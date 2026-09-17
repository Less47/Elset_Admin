import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeAddonState } from "@/lib/addons";

function readAddonState(payload) {
  if (!payload?.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    throw new Error("The add-on settings could not be read. Try again.");
  }
  return normalizeAddonState(payload.result);
}

// Shared availability is read from the server, never persisted in browser or
// personal preferences. A session scope prevents late responses crossing users.
export function useWorkspaceAddons({ fetchWithAuth, sessionKey, refreshKey }) {
  const scope = useMemo(() => ({ sessionKey, active: false, version: 0, saving: false }), [sessionKey]);
  const [snapshot, setSnapshot] = useState(null);
  const refresh = useCallback(async () => {
    if (!sessionKey || !scope.active || scope.saving) return;
    const version = ++scope.version;
    try {
      const response = await fetchWithAuth("/api/settings/addons", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to load add-ons.");
      const addons = readAddonState(payload);
      if (scope.active && version === scope.version) {
        setSnapshot({ scope, addons, loading: false, saving: false, error: "" });
      }
    } catch (error) {
      if (scope.active && version === scope.version) setSnapshot((previous) => ({
        scope, addons: previous?.scope === scope ? previous.addons : normalizeAddonState(),
        loading: false, saving: false, error: error.message || "Unable to load add-ons.",
      }));
    }
  }, [fetchWithAuth, scope, sessionKey]);

  useEffect(() => {
    scope.active = true;
    return () => { scope.active = false; scope.version += 1; };
  }, [scope]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [refresh, refreshKey]);

  const change = useCallback(async (key, enabled) => {
    if (!sessionKey || !scope.active || scope.saving) return false;
    scope.saving = true;
    scope.version += 1;
    setSnapshot((previous) => ({
      scope, addons: previous?.scope === scope ? previous.addons : normalizeAddonState(),
      loading: false, saving: true, error: "",
    }));
    try {
      const response = await fetchWithAuth("/api/settings/addons", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: enabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to save add-ons.");
      const addons = readAddonState(payload);
      if (!scope.active) return false;
      setSnapshot({ scope, addons, loading: false, saving: false, error: "" });
      return true;
    } catch (error) {
      if (scope.active) setSnapshot((previous) => ({
        scope, addons: previous?.scope === scope ? previous.addons : normalizeAddonState(),
        loading: false, saving: false, error: error.message || "Unable to save add-ons.",
      }));
      return false;
    } finally { scope.saving = false; }
  }, [fetchWithAuth, scope, sessionKey]);

  const current = snapshot?.scope === scope ? snapshot : null;
  return { addons: current?.addons || normalizeAddonState(), loading: Boolean(sessionKey) && (!current || current.loading),
    saving: current?.saving || false, error: current?.error || "", refresh, change };
}
