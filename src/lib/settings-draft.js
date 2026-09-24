// Compare editable values only. Callers project runtime status/timestamps out.
export function settingsFingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(settingsFingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${settingsFingerprint(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function settingsPatch(baseline, draft) {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => settingsFingerprint(value) !== settingsFingerprint(baseline[key])));
}

export function createSettingsDraft(initial) {
  let snapshot = { baseline: structuredClone(initial), draft: structuredClone(initial), dirty: false, saving: false, error: "", status: "idle" };
  const listeners = new Set();
  const publish = (values) => {
    snapshot = { ...snapshot, ...values };
    snapshot.dirty = settingsFingerprint(snapshot.draft) !== settingsFingerprint(snapshot.baseline);
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    sync(value) {
      if (!snapshot.dirty && !snapshot.saving && settingsFingerprint(value) !== settingsFingerprint(snapshot.baseline)) {
        publish({ baseline: structuredClone(value), draft: structuredClone(value), status: "idle", error: "" });
      }
    },
    change(value) { publish({ draft: typeof value === "function" ? value(snapshot.draft) : value, error: "", status: snapshot.saving ? "saving" : "idle" }); },
    discard() {
      if (snapshot.saving) return false;
      publish({ draft: structuredClone(snapshot.baseline), error: "", status: "idle" });
      return true;
    },
    async save(persist, captured = snapshot) {
      if (snapshot.saving) return false;
      if (!captured.dirty) return true;
      const submitted = structuredClone(captured.draft), baseline = structuredClone(captured.baseline);
      publish({ saving: true, error: "", status: "saving" });
      try {
        const acknowledged = await persist(submitted, baseline);
        if (acknowledged === false) throw new Error("Changes could not be saved. Please retry.");
        const saved = acknowledged ?? submitted;
        const draft = settingsFingerprint(snapshot.draft) === settingsFingerprint(submitted) ? saved : snapshot.draft;
        publish({ baseline: structuredClone(saved), draft: structuredClone(draft), saving: false,
          status: settingsFingerprint(draft) === settingsFingerprint(saved) ? "saved" : "idle" });
        return true;
      } catch (error) {
        publish({ saving: false, status: "error", error: error.message || "Changes could not be saved. Please retry." });
        return false;
      }
    },
  };
}

export function createSettingsDraftGroup() {
  const entries = new Map(), listeners = new Set();
  let saving = false, saved = false, snapshot = { dirty: false, saving: false, saved: false, errors: [] };
  const publish = () => {
    const states = [...entries.values()].map(entry => entry.store.getSnapshot());
    snapshot = { dirty: states.some(state => state.dirty), saving: saving || states.some(state => state.saving),
      saved: saved && !states.some(state => state.dirty), errors: states.map(state => state.error).filter(Boolean) };
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    register(id, store, persist) {
      const entry = { store, persist, unsubscribe: store.subscribe(publish) };
      entries.set(id, entry); publish();
      return () => { entry.unsubscribe(); if (entries.get(id) === entry) entries.delete(id); publish(); };
    },
    discard() {
      if (snapshot.saving) return false;
      saved = false;
      for (const entry of entries.values()) entry.store.discard();
      publish(); return true;
    },
    async save() {
      if (snapshot.saving || !snapshot.dirty) return false;
      const submitted = [...entries.values()].map(entry => ({ entry, captured: structuredClone(entry.store.getSnapshot()) }));
      saving = true; saved = false; publish();
      try {
        // Separate resources acknowledge independently; a later failure never
        // labels an unacknowledged draft saved or repeats successful writes.
        for (const { entry, captured } of submitted) if (!await entry.store.save(entry.persist, captured)) return false;
        saved = true; return true;
      } finally { saving = false; publish(); }
    },
  };
}
