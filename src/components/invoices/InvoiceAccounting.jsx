import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { accountingRequest } from "@/lib/accounting-api";
import { accountingProviderName } from "@/lib/addons";
import { normalizeDocument } from "@/lib/app-support";

const labels = { NOT_SYNCED: "Not synced", SYNCING: "Syncing…", SYNCED: "Synced", FAILED: "Sync failed", CONFLICT: "Review required", NEEDS_REAUTHORIZATION: "Reconnect required" };
export default function InvoiceAccounting({ provider = "xero", jobId, invoice, fetchWithAuth, blocked, onBusyChange, onReconciled }) {
  const name = accountingProviderName(provider);
  const [state, setState] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const busyRef = useRef(false);
  const latest = useRef({ invoice, blocked, onReconciled });
  useEffect(() => { latest.current = { invoice, blocked, onReconciled }; }, [invoice, blocked, onReconciled]);
  const base = `/api/jobs/${encodeURIComponent(jobId)}/invoice/integrations/${provider}`;
  useEffect(() => {
    let current = true;
    async function load() {
      if (document.visibilityState === "hidden" || busyRef.current) return;
      try {
        const result = invoice ? await accountingRequest(fetchWithAuth, `${base}/status`) : { connection: await accountingRequest(fetchWithAuth, `/api/integrations/${provider}/status`), status: "NOT_SYNCED", eligible: false, reason: "Save and issue this invoice before syncing." };
        if (!current) return;
        setState(result); setError("");
        const saved = latest.current;
        if (result.invoice && !saved.blocked && !busyRef.current
          && JSON.stringify(normalizeDocument("invoice", result.invoice)) !== JSON.stringify(normalizeDocument("invoice", saved.invoice))) saved.onReconciled?.(result.invoice);
      } catch (cause) { if (current) setError(cause.message); }
    }
    void load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [base, invoice, fetchWithAuth, retry, provider]);
  async function sync(endpoint = "sync") {
    if (busyRef.current || blocked) return;
    busyRef.current = true; setBusy(true); onBusyChange(true); setError("");
    try {
      const result = await accountingRequest(fetchWithAuth, `${base}/${endpoint}`, { method: "POST", body: {} });
      setState(result);
      if (result.invoice) onReconciled?.(result.invoice);
    }
    catch (cause) {
      setError(cause.message);
      try {
        const result = await accountingRequest(fetchWithAuth, `${base}/status`);
        setState(result);
        if (result.invoice) onReconciled?.(result.invoice);
      } catch { /* retain safe original error */ }
    } finally { busyRef.current = false; setBusy(false); onBusyChange(false); }
  }
  const connected = state?.connection?.status === "CONNECTED";
  const configured = (provider === "quickbooks" ? state?.connection?.config?.itemId : state?.connection?.config?.salesAccountId) && state?.connection?.config?.taxMappings?.taxable;
  const failed = ["FAILED", "CONFLICT", "NEEDS_REAUTHORIZATION"].includes(state?.status);
  const canSync = state?.connection?.enabled && connected && configured && state.eligible;
  return <section className="document-section" aria-label={`${name} invoice sync`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2>{name}</h2><p className="text-sm text-text-secondary" role="status">{busy ? "Syncing…" : !state ? error ? "Sync status unavailable" : "Loading sync status…" : connected ? labels[state.status] || "Not synced" : state.connection.status === "NEEDS_REAUTHORIZATION" ? `Reconnect ${name}` : `${name} not connected`}</p></div>
      {canSync ? <Button type="button" size="sm" disabled={blocked || busy || state.status === "SYNCING"} onClick={() => void sync()}>{failed ? `Retry ${name} sync` : state.externalId ? `Update ${name}` : `Send to ${name}`}</Button> : null}
    </div>
    {state && !connected ? <p className="mt-2 text-sm text-text-secondary">Connect {name} from Settings → Add-ons.</p> : connected && !configured ? <p className="mt-2 text-sm text-text-secondary">Select a sales item or account and tax mapping in Settings → Add-ons before syncing.</p> : null}
    {state && !state.eligible ? <p className="mt-2 text-sm text-text-secondary">{state.reason}</p> : blocked && !busy ? <p className="mt-2 text-sm text-text-secondary">Save your invoice changes before syncing.</p> : null}
    {state?.externalReference ? <p className="mt-2 break-words text-sm">{name} invoice: {state.externalReference}</p> : null}
    {state?.lastSyncedAt ? <p className="mt-1 text-xs text-text-secondary">Last synced: {new Date(state.lastSyncedAt).toLocaleString()}</p> : null}
    {state?.connection?.retryAt > Date.now() ? <p className="mt-1 text-xs text-text-secondary">Retry after {new Date(state.connection.retryAt).toLocaleString()}.</p> : null}
    {error || state?.error ? <p role="alert" className="mt-2 break-words text-sm text-status-danger">{error || state.error}</p> : null}
    {!state && error || state?.status === "SYNCING" ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Refresh sync status</Button> : null}
    {state?.externalId ? <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">Payment sync: {state.connection.paymentSync === "PAYMENT_PERMISSION_REQUIRED" ? "Permission required" : state.paymentSync?.status === "SYNCED" ? "Up to date" : labels[state.paymentSync?.status] || "Not synced"}</p>
        <Button type="button" size="sm" variant="outline" disabled={blocked || busy || !connected || !state.connection.enabled || state.connection.paymentSync !== "CONNECTED"} onClick={() => void sync("sync-payments")}>Sync from {name}</Button>
      </div>
      {state.connection.paymentSync === "PAYMENT_PERMISSION_REQUIRED" ? <p className="text-sm text-text-secondary">{name} needs additional permission to sync payments. Update {name} Permissions in Settings → Add-ons.</p> : null}
      {state.paymentSync?.lastSyncedAt ? <p className="text-xs text-text-secondary">Last synced from {name}: {new Date(state.paymentSync.lastSyncedAt).toLocaleString()}</p> : null}
      {state.paymentSync?.error ? <p role="alert" className="text-sm text-status-danger">{state.paymentSync.error}</p> : null}
      {state.paymentSync?.history?.length ? <details className="text-sm"><summary className="cursor-pointer">Payment sync history</summary><ul className="mt-2 space-y-1">{state.paymentSync.history.map((entry, index) => <li key={`${entry.createdAt}-${index}`} className="break-words text-text-secondary">{new Date(entry.createdAt).toLocaleString()} · {entry.message}</li>)}</ul></details> : null}
    </div> : null}
  </section>;
}
