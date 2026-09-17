import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { accountingRequest } from "@/lib/accounting-api";

const labels = { NOT_SYNCED: "Not synced", SYNCING: "Syncing…", SYNCED: "Synced", FAILED: "Xero sync failed", CONFLICT: "Review required", NEEDS_REAUTHORIZATION: "Reconnect Xero" };
export default function InvoiceAccounting({ jobId, invoice, fetchWithAuth, blocked, onBusyChange }) {
  const [state, setState] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const busyRef = useRef(false);
  const base = `/api/jobs/${encodeURIComponent(jobId)}/invoice/integrations/xero`;
  useEffect(() => {
    let current = true;
    const load = invoice ? accountingRequest(fetchWithAuth, `${base}/status`) : accountingRequest(fetchWithAuth, "/api/integrations/xero/status").then((connection) => ({ connection, status: "NOT_SYNCED", eligible: false, reason: "Save and issue this invoice before syncing." }));
    load.then((result) => { if (current) { setState(result); setError(""); } }).catch((cause) => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [base, invoice, fetchWithAuth, retry]);
  async function sync() {
    if (busyRef.current || blocked) return;
    busyRef.current = true; setBusy(true); onBusyChange(true); setError("");
    try { setState(await accountingRequest(fetchWithAuth, `${base}/sync`, { method: "POST", body: {} })); }
    catch (cause) {
      setError(cause.message);
      try { setState(await accountingRequest(fetchWithAuth, `${base}/status`)); } catch { /* retain safe original error */ }
    } finally { busyRef.current = false; setBusy(false); onBusyChange(false); }
  }
  const connected = state?.connection?.status === "CONNECTED";
  const configured = state?.connection?.config?.salesAccountId && state?.connection?.config?.taxMappings?.taxable;
  const failed = ["FAILED", "CONFLICT", "NEEDS_REAUTHORIZATION"].includes(state?.status);
  const canSync = state?.connection?.enabled && connected && configured && state.eligible;
  return <section className="document-section" aria-label="Xero invoice sync">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2>Xero</h2><p className="text-sm text-text-secondary" role="status">{busy ? "Syncing…" : !state ? error ? "Sync status unavailable" : "Loading sync status…" : connected ? labels[state.status] || "Not synced" : state.connection.status === "NEEDS_REAUTHORIZATION" ? "Reconnect Xero" : "Xero not connected"}</p></div>
      {canSync ? <Button type="button" size="sm" disabled={blocked || busy || state.status === "SYNCING"} onClick={() => void sync()}>{failed ? "Retry Xero sync" : state.externalId ? "Update Xero" : "Send to Xero"}</Button> : null}
    </div>
    {state && !connected ? <p className="mt-2 text-sm text-text-secondary">Connect Xero from Settings → Add-ons.</p> : connected && !configured ? <p className="mt-2 text-sm text-text-secondary">Select a sales account and tax mapping in Settings → Add-ons before syncing.</p> : null}
    {state && !state.eligible ? <p className="mt-2 text-sm text-text-secondary">{state.reason}</p> : blocked && !busy ? <p className="mt-2 text-sm text-text-secondary">Save your invoice changes before syncing.</p> : null}
    {state?.externalReference ? <p className="mt-2 break-words text-sm">Xero invoice: {state.externalReference}</p> : null}
    {state?.lastSyncedAt ? <p className="mt-1 text-xs text-text-secondary">Last synced: {new Date(state.lastSyncedAt).toLocaleString()}</p> : null}
    {state?.connection?.retryAt > Date.now() ? <p className="mt-1 text-xs text-text-secondary">Retry after {new Date(state.connection.retryAt).toLocaleString()}.</p> : null}
    {error || state?.error ? <p role="alert" className="mt-2 break-words text-sm text-status-danger">{error || state.error}</p> : null}
    {!state && error || state?.status === "SYNCING" ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Refresh sync status</Button> : null}
    <p className="mt-2 text-xs text-text-secondary">Manual invoice sync. Payments remain separate.</p>
  </section>;
}
