import { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";

export const UnsavedChangesContext = createContext(null);

// Editors register only draft state. React Router owns all route blocking/history.
export function useUnsavedChanges(dirty, { busy = false, kind, onDiscard } = {}) {
  const { register } = useContext(UnsavedChangesContext);
  const saved = useRef(false);
  useLayoutEffect(() => { saved.current = false; }, [dirty]);
  useLayoutEffect(() => register({
    shouldBlock: () => !saved.current && (dirty || busy), busy, kind, onDiscard,
  }), [register, dirty, busy, kind, onDiscard]);
  useLayoutEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event) => {
      if (!saved.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, busy]);
  return useCallback(() => { saved.current = true; }, []);
}
