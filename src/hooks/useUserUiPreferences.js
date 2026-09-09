import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { normalizeUserUiPreferences } from "@/lib/user-ui-preferences";
import { createUserUiPreferencesStore } from "./user-ui-preferences-store";

export const UserUiPreferencesContext = createContext(null);

export function useUserUiPreferences({ fetchWithAuth, sessionKey, legacySettings }) {
  // A new identity always gets a new store. No cache is shared between users.
  const store = useMemo(() => createUserUiPreferencesStore({ fetchWithAuth, sessionKey }), [fetchWithAuth, sessionKey]);
  useLayoutEffect(() => { store.activate(); return () => store.dispose(); }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const preferences = useMemo(() => sessionKey
    ? normalizeUserUiPreferences(snapshot.stored || legacySettings, snapshot.overrides)
    : normalizeUserUiPreferences(), [sessionKey, snapshot.stored, snapshot.overrides, legacySettings]);
  const getPreferences = () => {
    const current = store.getSnapshot();
    return sessionKey
      ? normalizeUserUiPreferences(current.stored || legacySettings, current.overrides)
      : normalizeUserUiPreferences();
  };
  return {
    preferences, getPreferences, change: store.change, retry: store.retry,
    loading: !snapshot.loaded, status: snapshot.loadError ? "error" : snapshot.status,
    error: snapshot.error || snapshot.loadError,
  };
}

export function useUserUiPreference(key) {
  const personal = useContext(UserUiPreferencesContext);
  const value = personal?.preferences[key] ?? normalizeUserUiPreferences()[key];
  const setValue = (next) => personal?.change({ [key]: typeof next === "function" ? next(personal.getPreferences()[key]) : next });
  return [value, setValue];
}
