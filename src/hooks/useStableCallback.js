import { useCallback, useLayoutEffect, useRef } from "react";

// Event handlers keep their identity for memoized children while using the latest state.
export function useStableCallback(callback) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; }, [callback]);
  return useCallback((...args) => latest.current?.(...args), []);
}
