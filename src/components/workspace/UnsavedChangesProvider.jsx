import { useCallback, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { UnsavedChangesDialog } from "./RecordWorkspace";
import { UnsavedChangesContext } from "./unsaved-changes-context";

export default function UnsavedChangesProvider({ children }) {
  const draft = useRef(null);
  const [options, setOptions] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const shouldBlock = useCallback(() => Boolean(draft.current?.shouldBlock()), []);
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => {
    // Record tabs replace location state without leaving or unmounting the draft.
    const samePage = currentLocation.pathname === nextLocation.pathname
      && currentLocation.search === nextLocation.search
      && currentLocation.state?.section === nextLocation.state?.section;
    return !samePage && shouldBlock();
  }, [shouldBlock]));
  const register = useCallback((entry) => {
    draft.current = entry;
    setOptions(entry);
    return () => { if (draft.current === entry) draft.current = null; };
  }, []);
  // Settings tabs and sign-out are actions, not SPA routes.
  const requestAction = useCallback((action) => {
    if (shouldBlock()) { setPendingAction(() => action); return false; }
    action();
    return true;
  }, [shouldBlock]);
  const keepEditing = () => {
    setPendingAction(null);
    if (blocker.state === "blocked") blocker.reset();
  };
  const discard = () => {
    if (draft.current?.busy || draft.current?.onDiscard?.() === false) return;
    draft.current = null;
    setPendingAction(null);
    if (blocker.state === "blocked") blocker.proceed();
    else pendingAction?.();
  };
  return <UnsavedChangesContext.Provider value={{ register, requestAction }}>
    {children}
    <UnsavedChangesDialog open={blocker.state === "blocked" || Boolean(pendingAction)}
      onKeepEditing={keepEditing} onDiscard={discard} settings={options?.kind === "settings"} busy={options?.busy} />
  </UnsavedChangesContext.Provider>;
}
