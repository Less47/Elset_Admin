import { useCallback, useEffect, useState } from "react";

export async function priceListRequest(fetchWithAuth, path = "", options = {}) {
  const response = await fetchWithAuth(`/api/price-list-items${path}`, {
    ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Unable to access the price list. Please try again.");
  return payload;
}

export function usePriceList(fetchWithAuth, status = "all") {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async (signal) => {
    setLoading(true); setError("");
    try {
      const result = await priceListRequest(fetchWithAuth, `?status=${status}`, { signal });
      if (!signal?.aborted) setItems(result.items);
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message || "Unable to load the price list.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [fetchWithAuth, status]);
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return { items, loading, error, refresh };
}
