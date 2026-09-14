import { useCallback, useEffect, useState } from "react";

const EMPTY_LOCATIONS = new Map();

export function useExistingMapLocations(datasetKey, enabled) {
  const [snapshot, setSnapshot] = useState({ datasetKey: "", locations: EMPTY_LOCATIONS, loading: false, error: "" });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled || !datasetKey) return undefined;
    const controller = new AbortController();
    let requestRevision = 0;
    async function load() {
      const currentRequest = ++requestRevision;
      setSnapshot((previous) => ({ ...previous, loading: true, error: "" }));
      try {
        const response = await fetch("/api/map/locations", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Map coordinates could not be loaded. Please try again.");
        const payload = await response.json();
        if (payload.source !== "geoapify-runtime-cache" || !Array.isArray(payload.results)) throw new Error("Map coordinates are temporarily unavailable. Please try again.");
        if (controller.signal.aborted || currentRequest !== requestRevision) return;
        setSnapshot({ datasetKey, locations: new Map(payload.results.map((entry) => [entry.jobId, entry.location])), loading: false, error: "" });
      } catch (error) {
        if (controller.signal.aborted || currentRequest !== requestRevision) return;
        setSnapshot((previous) => ({ ...previous, loading: false, error: error.message }));
      }
    }
    load();
    window.addEventListener("focus", load);
    return () => { controller.abort(); window.removeEventListener("focus", load); };
  }, [datasetKey, enabled, revision]);
  return { ...snapshot, locations: snapshot.datasetKey === datasetKey ? snapshot.locations : EMPTY_LOCATIONS, refresh };
}
