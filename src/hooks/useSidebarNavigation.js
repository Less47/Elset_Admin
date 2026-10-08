import { useMemo, useState } from "react";

// Navigation state is local to this browser and signed-in user, outside Settings.
export function useSidebarNavigation(userId) {
  const storageKey = userId ? `elset.sidebar-collapsed:${userId}` : "";
  const initial = useMemo(() => {
    try { return Boolean(storageKey && localStorage.getItem(storageKey) === "true"); }
    catch { return false; }
  }, [storageKey]);
  const [state, setState] = useState(null);
  const collapsed = state?.key === storageKey ? state.collapsed : initial;
  const toggle = () => {
    const next = !collapsed;
    setState({ key: storageKey, collapsed: next });
    try { if (storageKey) localStorage.setItem(storageKey, String(next)); }
    catch { /* Keep navigation usable when browser storage is unavailable. */ }
  };
  return { collapsed, toggle };
}
