import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createSettingsDraftGroup } from "@/lib/settings-draft";
import { SettingsDraftContext } from "./settings-draft-context";
import { Button } from "@/components/ui/button";

export default function SettingsDraftScope({ navigation, children }) {
  const { registerBlocker, requestNavigation } = navigation;
  const [group] = useState(createSettingsDraftGroup);
  const state = useSyncExternalStore(group.subscribe, group.getSnapshot);
  useLayoutEffect(() => registerBlocker(() => group.getSnapshot().dirty || group.getSnapshot().saving,
    { kind: "settings", onDiscard: group.discard, busy: state.saving }), [registerBlocker, group, state.dirty, state.saving]);
  const value = useMemo(() => ({ group, state, requestNavigation }), [group, state, requestNavigation]);
  return <SettingsDraftContext.Provider value={value}>{children}</SettingsDraftContext.Provider>;
}

export function SettingsSaveButton({ scope }) {
  const state = useSyncExternalStore(scope.group.subscribe, scope.group.getSnapshot);
  return <div className="flex flex-wrap items-center justify-end gap-2">
    <div aria-live="polite" aria-atomic="true" className="text-sm">
      {state.errors.length ? <p role="alert" className="text-status-danger">{state.errors.join(" ")}</p>
        : <span role="status" aria-label="Settings save status" className="text-text-secondary">{state.saving ? "Saving..." : state.dirty ? "Unsaved changes" : state.saved ? "Saved" : ""}</span>}
    </div>
    <Button type="button" disabled={!state.dirty || state.saving} aria-busy={state.saving} onClick={() => void scope.group.save()}>{state.saving ? "Saving..." : "Save changes"}</Button>
  </div>;
}
