import { useEffect, useMemo, useState } from "react";
import { invoiceToday, summarizeJsonCustomerAccount } from "@/lib/invoice-account";

export function useCustomerAccount(customerId, jobs, storageMode) {
  const [remote, setRemote] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [today, setToday] = useState(invoiceToday);
  const sqlite = storageMode === "sqlite";
  useEffect(() => {
    let active = true, controller;
    async function load() {
      if (document.visibilityState === "hidden") return;
      if (!sqlite) { setToday(invoiceToday()); return; }
      controller?.abort();
      controller = new AbortController();
      const request = controller;
      try {
        const response = await fetch(`/api/customers/${encodeURIComponent(customerId)}/account-summary?today=${invoiceToday()}`, {
          credentials: "same-origin", cache: "no-store", signal: request.signal,
        });
        if (!response.ok) throw new Error("Account unavailable");
        const summary = await response.json();
        if (summary.customerId !== customerId || !Number.isSafeInteger(summary.outstandingCents)) throw new Error("Invalid account response");
        if (active && !request.signal.aborted) setRemote({ customerId, jobs, summary });
      } catch {
        if (active && !request.signal.aborted) setRemote({ customerId, jobs, error: true });
      }
    }
    if (sqlite) void load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [customerId, jobs, sqlite, refresh]);

  const local = useMemo(() => {
    if (sqlite) return null;
    try { return { summary: summarizeJsonCustomerAccount(customerId, jobs, { today }) }; }
    catch { return { error: true }; }
  }, [customerId, jobs, sqlite, today]);
  const current = sqlite ? remote?.customerId === customerId && remote.jobs === jobs ? remote : null : local;
  return { summary: current?.summary, error: Boolean(current?.error), loading: !current, retry: () => setRefresh((value) => value + 1) };
}
