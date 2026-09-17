import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { accountingRequest } from "@/lib/accounting-api";

const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labels = { CONNECTED: "Connected", DISCONNECTED: "Not connected", SELECT_ORGANISATION: "Choose organisation", NEEDS_REAUTHORIZATION: "Reconnect Xero" };

export default function XeroSettings({ enabled, available, fetchWithAuth }) {
  const [status, setStatus] = useState(null), [options, setOptions] = useState(null), [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState(() => {
    const result = new URLSearchParams(window.location.search).get("result");
    return result === "cancelled" ? "Xero connection was cancelled. You can connect again." : result === "failed" ? "Xero connection could not be completed. Start Connect to Xero again." : "";
  });
  const [tenantId, setTenantId] = useState(""), [confirm, setConfirm] = useState("");
  const busyRef = useRef(false);
  const base = "/api/integrations/xero";
  useEffect(() => {
    if (!available) return;
    let active = true;
    accountingRequest(fetchWithAuth, `${base}/status`).then((result) => {
      if (active) { setStatus(result); setTenantId(result.externalTenantId || result.organisations[0]?.id || ""); setError(""); setLoading(false); }
    }).catch((cause) => { if (active) { setError(cause.message); setLoading(false); } });
    return () => { active = false; };
  }, [fetchWithAuth, available, enabled]);
  async function run(endpoint, method = "GET", body) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await accountingRequest(fetchWithAuth, `${base}/${endpoint}`, { method, body });
      if (result.url) { window.location.assign(result.url); return; }
      setStatus(result);
      if (result.accounts) { setOptions(result); setDraft(result.config); }
      if (endpoint === "organisation" || endpoint === "disconnect") { setOptions(null); setConfirm(""); }
      if (endpoint === "test") setNotice(result.message);
      if (endpoint === "config" && method === "PATCH") setNotice("Xero configuration saved.");
    } catch (cause) {
      setError(cause.message);
      // A failed health/configuration request may have marked the connection for renewal.
      try { setStatus(await accountingRequest(fetchWithAuth, `${base}/status`)); } catch { /* Keep the actionable request error. */ }
    }
    finally { busyRef.current = false; setBusy(false); setLoading(false); }
  }
  if (!available) return null;
  const connected = status?.status === "CONNECTED";
  const disabled = busy || loading;
  return <div className="mt-3 space-y-3 border-t pt-3" aria-label="Xero connection">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 text-sm"><p className="font-medium">{loading ? "Loading connection…" : labels[status?.status] || "Connection unavailable"}</p>
        {status?.externalTenantName ? <p className="break-words text-text-secondary">{status.externalTenantName}</p> : null}</div>
      <div className="flex flex-wrap gap-2">
        {enabled && !connected ? <Button size="sm" disabled={disabled || !status?.serverConfigured} onClick={() => void run("connect", "POST", {})}>{status?.status === "DISCONNECTED" ? "Connect to Xero" : "Reconnect Xero"}</Button> : null}
        {enabled && connected ? <><Button size="sm" variant="outline" disabled={disabled} onClick={() => void run("config")}>Configure</Button><Button size="sm" variant="outline" disabled={disabled} onClick={() => void run("test", "POST", {})}>Test connection</Button></> : null}
        {status && status.status !== "DISCONNECTED" ? <Button size="sm" variant="outline" disabled={disabled} onClick={() => setConfirm("disconnect")}>Disconnect</Button> : null}
      </div>
    </div>
    {enabled && status?.serverConfigured === false ? <p className="text-sm text-text-secondary">Xero integration is temporarily unavailable. Please contact support.</p> : null}
    {enabled && status?.organisations?.length > 0 ? <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1"><Label htmlFor="xero-organisation">Connected organisation</Label><select id="xero-organisation" className={selectClass} value={tenantId} disabled={disabled} onChange={(event) => setTenantId(event.target.value)}>
        <option value="" disabled>Choose organisation</option>{status.organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
      </select></div>
      <Button variant="outline" size="sm" disabled={disabled || !tenantId || (connected && tenantId === status.externalTenantId)} onClick={() => status.externalTenantId && tenantId !== status.externalTenantId ? setConfirm("organisation") : void run("organisation", "POST", { tenantId })}>Use organisation</Button>
    </div> : null}
    {enabled && options && connected ? <form className="space-y-3 rounded-lg border bg-surface-raised p-3" onSubmit={(event) => { event.preventDefault(); void run("config", "PATCH", draft); }}>
      <h4 className="text-sm font-semibold">Configuration</h4>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1"><Label htmlFor="xero-sales-account">Sales account</Label><select id="xero-sales-account" className={selectClass} required disabled={disabled} value={draft.salesAccountId || ""} onChange={(event) => setDraft((current) => ({ ...current, salesAccountId: event.target.value }))}>
          <option value="" disabled>Select sales account</option>{options.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
        </select></div>
        {status.taxTreatments.map((treatment) => <div key={treatment.key} className="min-w-0 space-y-1"><Label htmlFor={`xero-tax-${treatment.key}`}>{treatment.label}</Label><select id={`xero-tax-${treatment.key}`} className={selectClass} required disabled={disabled} value={draft.taxMappings?.[treatment.key] || ""} onChange={(event) => setDraft((current) => ({ ...current, taxMappings: { ...current.taxMappings, [treatment.key]: event.target.value } }))}>
          <option value="" disabled>Select matching tax rate</option>{options.taxRates.filter((tax) => tax.rate === treatment.rate).map((tax) => <option key={tax.id} value={tax.id}>{tax.name} ({tax.rate}%)</option>)}
        </select></div>)}
      </div>
      <p className="text-xs text-text-secondary">Invoice sync: Manual. This workspace currently invoices in AUD with 10% GST on all lines. Payments are not synced.</p>
      <Button type="submit" size="sm" disabled={disabled}>Save Xero configuration</Button>
    </form> : null}
    {status?.lastSuccessAt ? <p className="text-xs text-text-secondary">Last successful sync: {new Date(status.lastSuccessAt).toLocaleString()}</p> : null}
    {status?.retryAt > Date.now() ? <p className="text-xs text-text-secondary">Retry after {new Date(status.retryAt).toLocaleString()}.</p> : null}
    {error || status?.error ? <p role="alert" className="break-words text-sm text-status-danger">{error || status.error}</p> : null}
    {!status && !loading ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void run("status")}>Retry connection status</Button> : null}
    <p role="status" className="text-sm text-text-secondary">{busy ? "Working…" : notice}</p>
    <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open && !busy) setConfirm(""); }}>
      <DialogContent showCloseButton={!busy} className="sm:max-w-md" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{confirm === "disconnect" ? "Disconnect Xero?" : "Change Xero organisation?"}</DialogTitle><DialogDescription>{confirm === "disconnect"
          ? "Invoice syncing will stop. Existing customers, invoices, configuration and Xero mapping history will be preserved."
          : "This is a different Xero organisation. Existing mappings will stay with the previous organisation. Select the sales account and tax mapping again before syncing."}</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm("")}>Cancel</Button><Button disabled={busy} onClick={() => void run(confirm === "disconnect" ? "disconnect" : "organisation", "POST", confirm === "disconnect" ? {} : { tenantId, confirmChange: true })}>{confirm === "disconnect" ? "Disconnect Xero" : "Change organisation"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
