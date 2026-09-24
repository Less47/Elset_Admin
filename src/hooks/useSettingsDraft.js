import { useContext, useLayoutEffect, useState, useRef, useSyncExternalStore } from "react";
import { createSettingsDraft } from "@/lib/settings-draft";
import { SettingsDraftContext } from "@/components/settings/settings-draft-context";

export function useSettingsDraft(id, value, persist, { enabled = true } = {}) {
  const scope = useContext(SettingsDraftContext), latest = useRef(persist);
  useLayoutEffect(() => { latest.current = persist; });
  const [store] = useState(() => createSettingsDraft(value));
  useLayoutEffect(() => { store.sync(value); }, [store, value]);
  useLayoutEffect(() => enabled ? scope?.group.register(id, store, (...args) => latest.current(...args)) : undefined, [scope?.group, id, store, enabled]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, setDraft: store.change, discard: store.discard, save: () => store.save((...args) => latest.current(...args)), store, scope };
}
