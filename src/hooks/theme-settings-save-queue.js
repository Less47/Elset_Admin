export const THEME_SAVE_DEBOUNCE_MS = 400;
export const PREFERENCE_SAVE_DEBOUNCE_MS = 600;

// Owned by App, so leaving the Settings page does not cancel a pending save.
export function createThemeSettingsSaveQueue({
  save,
  onSaved = () => {},
  debounceMs = THEME_SAVE_DEBOUNCE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let snapshot = { overrides: {}, status: "idle", error: "" };
  let pending = {};
  let timer = null;
  let ready = false;
  let inFlight = false;
  let active = true;
  const listeners = new Set();
  const hasPending = () => Object.keys(pending).length > 0;

  function publish(update) {
    snapshot = { ...snapshot, ...update };
    listeners.forEach((listener) => listener());
  }

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  async function drain() {
    if (!active || inFlight || !ready || !hasPending()) return;
    const batch = pending;
    pending = {};
    ready = false;
    inFlight = true;
    publish({ status: "saving", error: "" });
    try {
      const payload = await save(batch);
      if (!active) return;
      onSaved(batch, payload);
      // A user may return to the in-flight value while experimenting.
      for (const key of Object.keys(pending)) {
        if (pending[key] === batch[key]) delete pending[key];
      }
      publish({ status: hasPending() ? "pending" : "saved" });
    } catch (error) {
      if (!active) return;
      pending = { ...batch, ...pending };
      ready = false;
      cancelTimer();
      publish({
        status: "error",
        error: error instanceof Error ? error.message : "Theme change could not be saved.",
      });
    } finally {
      inFlight = false;
    }
    // The debounce may have elapsed while the previous request was outstanding.
    if (active && ready && hasPending()) void drain();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change(patch, changeDebounceMs = debounceMs) {
      if (!active || !Object.keys(patch).length) return false;
      if (snapshot.status !== "error"
        && Object.entries(patch).every(([key, value]) => snapshot.overrides[key] === value)) return true;
      pending = { ...pending, ...patch };
      // Retain session-local choices even when unrelated API responses contain
      // an older workspace snapshot. Only the user can replace these overrides.
      publish({ overrides: { ...snapshot.overrides, ...patch }, status: inFlight ? "saving" : "pending", error: "" });
      ready = false;
      cancelTimer();
      timer = setTimer(() => {
        timer = null;
        ready = true;
        void drain();
      }, changeDebounceMs);
      return true;
    },
    retry() {
      if (!active || inFlight || !hasPending()) return;
      cancelTimer();
      ready = true;
      void drain();
    },
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      cancelTimer();
      listeners.clear();
    },
  };
}
