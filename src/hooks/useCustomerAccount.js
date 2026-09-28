import { useEffect, useState } from "react";
import { invoiceToday } from "@/lib/invoice-account";

export function useCustomerAccount(customerId, jobs) {
  const [remote, setRemote] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true, controller;
    async function load() {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      const request = controller;
      try {
        const response = await fetch(`/api/customers/${encodeURIComponent(customerId)}/account-summary?today=${invoiceToday()}`, {
          credentials: "same-origin", cache: "no-store", signal: request.signal,
        });
        if (!response.ok) throw new Error("Account unavailable");
        const summary = await response.json();
        if (summary.customerId !== customerId || ["outstandingCents", "totalInvoicedCents", "totalReceivedCents", "invoiceCount"]
          .some((key) => !Number.isSafeInteger(summary[key]) || summary[key] < 0)) throw new Error("Invalid account response");
        if (active && !request.signal.aborted) setRemote({ customerId, jobs, summary });
      } catch {
        if (active && !request.signal.aborted) setRemote({ customerId, jobs, error: true });
      }
    }
    void load();
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
  }, [customerId, jobs, refresh]);

  const current = remote?.customerId === customerId && remote.jobs === jobs ? remote : null;
  return { summary: current?.summary, error: Boolean(current?.error), loading: !current, retry: () => setRefresh((value) => value + 1) };
}
