import { UnsavedChangesContext, useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import { useContext, useMemo, useState, useSyncExternalStore } from "react";
import { createSettingsDraftGroup } from "@/lib/settings-draft";
import { SettingsDraftContext } from "./settings-draft-context";
import { Button } from "@/components/ui/button";

export default function SettingsDraftScope({ children }) {
  const { requestAction } = useContext(UnsavedChangesContext);
  const [group] = useState(createSettingsDraftGroup);
  const state = useSyncExternalStore(group.subscribe, group.getSnapshot);
  useUnsavedChanges(state.dirty, { kind: "settings", onDiscard: group.discard, busy: state.saving });
  const value = useMemo(() => ({ group, state, requestAction }), [group, state, requestAction]);
  return <SettingsDraftContext.Provider value={value}>{children}</SettingsDraftContext.Provider>;
}

export function SettingsSaveButton({ scope, className }) {
  const state = useSyncExternalStore(scope.group.subscribe, scope.group.getSnapshot);
  return <div className="flex flex-wrap items-center justify-end gap-2">
    <div aria-live="polite" aria-atomic="true" className="text-sm">
      {state.errors.length ? <p role="alert" className="text-status-danger">{state.errors.join(" ")}</p>
        : <span role="status" aria-label="Settings save status" className="text-text-secondary">{state.saving ? "Saving..." : state.dirty ? "Unsaved changes" : state.saved ? "Saved" : ""}</span>}
    </div>
    <Button type="button" className={className} disabled={!state.dirty || state.saving} aria-busy={state.saving} onClick={() => void scope.group.save()}>{state.saving ? "Saving..." : "Save changes"}</Button>
  </div>;
}
