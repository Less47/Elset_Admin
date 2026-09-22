import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { accountingRequest } from "@/lib/accounting-api";
import { accountingProviderName } from "@/lib/addons";
import QuickBooksSalesItemSettings from "./QuickBooksSalesItemSettings";

const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labels = { CONNECTED: "Connected", DISCONNECTED: "Not connected", SELECT_ORGANISATION: "Choose organisation", NEEDS_REAUTHORIZATION: "Reconnect required" };

export default function AccountingSettings({ provider = "xero", enabled, available, fetchWithAuth }) {
  const name = accountingProviderName(provider), quickbooks = provider === "quickbooks";
  const [status, setStatus] = useState(null), [options, setOptions] = useState(null), [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("accounting") !== provider) return "";
    return params.get("result") === "cancelled" ? `${name} connection was cancelled. You can connect again.`
      : params.get("result") === "failed" ? `${name} connection could not be completed. Start Connect again.` : "";
  });
  const [tenantId, setTenantId] = useState(""), [confirm, setConfirm] = useState("");
  const busyRef = useRef(false), base = `/api/integrations/${provider}`;
  useEffect(() => {
    if (!available) return;
    let active = true;
    accountingRequest(fetchWithAuth, `${base}/status`).then((result) => {
      if (active) { setStatus(result); setTenantId(result.externalTenantId || result.organisations[0]?.id || ""); setError(""); setLoading(false); }
    }).catch((cause) => { if (active) { setError(cause.message); setLoading(false); } });
    return () => { active = false; };
  }, [fetchWithAuth, available, enabled, base]);
  async function run(endpoint, method = "GET", body) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await accountingRequest(fetchWithAuth, `${base}/${endpoint}`, { method, body });
      if (result.url) { window.location.assign(result.url); return; }
      setStatus(result);
      setTenantId(result.externalTenantId || result.organisations?.[0]?.id || "");
      if (result.accounts) { setOptions(result); setDraft(current => endpoint === "sales-item" ? { ...current, itemId: result.salesItem.id } : result.config); }
      if (["organisation", "disconnect", "company-switch"].includes(endpoint)) { setOptions(null); setDraft({}); setConfirm(""); }
      if (endpoint === "company-switch") setNotice(body.confirm ? "QuickBooks company switched. Configure its default sales item and GST code before syncing." : "Company switch cancelled. The previous connection was kept.");
      if (endpoint === "test") setNotice(result.message);
      if (endpoint === "config" && method === "PATCH") setNotice(`${name} configuration saved.`);
      if (endpoint === "sales-item") setNotice(`${result.reused ? "Reused existing" : "Created"} ${result.salesItem.name} · ${result.salesItem.incomeAccountName}. Save QuickBooks configuration to use this default.`);
      return result;
    } catch (cause) {
      setError(cause.message);
      try { setStatus(await accountingRequest(fetchWithAuth, `${base}/status`)); } catch { /* Keep request error. */ }
      return { error: cause.message };
    } finally { busyRef.current = false; setBusy(false); setLoading(false); }
  }
  if (!available) return null;
  const pendingSwitch = quickbooks ? status?.pendingCompanySwitch : null;
  const connected = status?.status === "CONNECTED", disabled = busy || loading || Boolean(pendingSwitch);
  const company = options?.organisation && options.organisation.id === status?.externalTenantId ? options.organisation
    : status?.organisations?.find((organisation) => organisation.id === status.externalTenantId);
  return <div className="mt-3 space-y-3 border-t pt-3" aria-label={`${name} connection`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 text-sm"><p className="font-medium">{loading ? "Loading connection…" : labels[status?.status] || "Connection unavailable"}</p>
        {status?.externalTenantName && status.status !== "DISCONNECTED" ? <p className="break-words text-text-secondary">{quickbooks ? "Connected organisation: " : ""}{status.externalTenantName}</p> : null}
        {quickbooks && company && status.status !== "DISCONNECTED" ? <p className="break-all text-xs text-text-secondary">Company ID: {company.id} · {company.country} · {company.currency}</p> : null}
        {quickbooks && status?.environment ? <p className="text-xs text-text-secondary">{status.environment === "sandbox" ? "Sandbox — test company" : "Production company"}</p> : null}</div>
      <div className="flex flex-wrap gap-2">
        {enabled && !connected ? <Button size="sm" disabled={disabled || !status?.serverConfigured} onClick={() => void run("connect", "POST", {})}>{status?.status === "DISCONNECTED" ? `Connect to ${name}` : `Reconnect ${name}`}</Button> : null}
        {enabled && connected ? <><Button size="sm" variant="outline" disabled={disabled} onClick={() => void run("config")}>Configure</Button><Button size="sm" variant="outline" disabled={disabled} onClick={() => void run("test", "POST", {})}>Test connection</Button></> : null}
        {enabled && connected && quickbooks ? <Button size="sm" variant="outline" disabled={disabled || !status?.serverConfigured} onClick={() => void run("connect", "POST", {})}>Reconnect QuickBooks</Button> : null}
        {status && status.status !== "DISCONNECTED" ? <Button size="sm" variant="outline" disabled={disabled} onClick={() => setConfirm("disconnect")}>Disconnect</Button> : null}
      </div>
    </div>
    {enabled && connected ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p>Invoice sync: Available · Payment synchronisation: {status.paymentSync === "CONNECTED" ? "Connected" : `Additional ${name} permission required`}</p>
      {status.paymentSync === "PAYMENT_PERMISSION_REQUIRED" ? <Button size="sm" variant="outline" disabled={disabled} onClick={() => void run("connect", "POST", {})}>Update {name} Permissions</Button> : null}
    </div> : null}
    {enabled && status?.serverConfigured === false ? <p className="text-sm text-text-secondary">{status.setupMessage?.replace(/^Accounting integration/, `${name} integration`) || `${name} integration is temporarily unavailable. Please contact support.`}</p> : null}
    {enabled && !quickbooks && status?.organisations?.length > 0 ? <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1"><Label htmlFor={`${provider}-organisation`}>Connected organisation</Label><select id={`${provider}-organisation`} className={selectClass} value={tenantId} disabled={disabled} onChange={(event) => setTenantId(event.target.value)}>
        <option value="" disabled>Choose organisation</option>{status.organisations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select></div>
      <Button variant="outline" size="sm" disabled={disabled || !tenantId || (connected && tenantId === status.externalTenantId)} onClick={() => status.externalTenantId && tenantId !== status.externalTenantId ? setConfirm("organisation") : void run("organisation", "POST", { tenantId })}>Use organisation</Button>
    </div> : null}
    {enabled && connected && quickbooks && !status.config?.itemId ? <p className="text-sm text-text-secondary">Configure this company's default sales item and GST code before syncing invoices.</p> : null}
    {enabled && options && connected ? <form className="space-y-3 rounded-lg border bg-surface-raised p-3" onSubmit={(event) => { event.preventDefault(); void run("config", "PATCH", draft); }}>
      <h4 className="text-sm font-semibold">Configuration</h4>
      {options.configurationIssue ? <p role="alert" className="text-sm text-status-danger">{options.configurationIssue.message}</p> : null}
      {quickbooks && options.organisation ? <p className="text-xs text-text-secondary">Company tax settings: {options.organisation.country} · {options.organisation.currency}. {options.organisation.usingSalesTax === true ? "GST / sales tax is enabled." : options.organisation.usingSalesTax === false ? "GST / sales tax is disabled." : "QuickBooks did not report whether GST / sales tax is enabled."}</p> : null}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {quickbooks ? <QuickBooksSalesItemSettings items={options.items} accounts={options.accounts} value={draft.itemId} disabled={disabled} creationDisabled={Boolean(options.configurationIssue)} companyName={company?.name || status.externalTenantName}
          onChange={itemId => setDraft(current => ({ ...current, itemId }))} onCreate={incomeAccountId => run("sales-item", "POST", { incomeAccountId, tenantId: options.organisation.id })} />
          : <div className="min-w-0 space-y-1"><Label htmlFor={`${provider}-sales-account`}>Sales account</Label><select id={`${provider}-sales-account`} className={selectClass} required disabled={disabled} value={draft.salesAccountId || ""} onChange={(event) => setDraft((current) => ({ ...current, salesAccountId: event.target.value }))}>
            <option value="" disabled>Select sales account</option>{options.accounts.map((row) => <option key={row.id} value={row.id}>{row.code ? `${row.code} — ` : ""}{row.name}</option>)}
          </select></div>}
        {status.taxTreatments.map((treatment) => <div key={treatment.key} className="min-w-0 space-y-1"><Label htmlFor={`${provider}-tax-${treatment.key}`}>{quickbooks ? "Default QuickBooks GST code" : treatment.label}</Label>
          {quickbooks && <p className="text-xs text-text-secondary">ELSET invoices currently use 10% GST. This mapping tells QuickBooks which Australian sales tax code represents that tax treatment.</p>}
          <select id={`${provider}-tax-${treatment.key}`} className={selectClass} required disabled={disabled || Boolean(options.configurationIssue)} value={options.taxRates.some((tax) => tax.rate === treatment.rate && tax.id === draft.taxMappings?.[treatment.key]) ? draft.taxMappings[treatment.key] : ""} onChange={(event) => setDraft((current) => ({ ...current, taxMappings: { ...current.taxMappings, [treatment.key]: event.target.value } }))}>
          <option value="" disabled>{quickbooks ? "Select matching tax code" : "Select matching tax rate"}</option>{options.taxRates.filter((tax) => tax.rate === treatment.rate).map((tax) => <option key={tax.id} value={tax.id}>{tax.name} ({tax.rate}%)</option>)}
        </select></div>)}
      </div>
      <p className="text-xs text-text-secondary">Invoice sync is manual. {name} manages payments on mapped invoices. This workspace invoices in AUD with 10% GST on all lines.</p>
      {quickbooks ? <p className="text-xs text-text-secondary">Enable custom transaction numbers in QuickBooks to keep ELSET invoice numbers.</p> : null}
      <Button type="submit" size="sm" disabled={disabled || Boolean(options.configurationIssue) || (quickbooks && !options.items.some(item => item.id === draft.itemId))}>Save {name} configuration</Button>
    </form> : null}
    {status?.lastSuccessAt ? <p className="text-xs text-text-secondary">Last successful sync: {new Date(status.lastSuccessAt).toLocaleString()}</p> : null}
    {status?.retryAt > Date.now() ? <p className="text-xs text-text-secondary">Retry after {new Date(status.retryAt).toLocaleString()}.</p> : null}
    {error || status?.error ? <p role="alert" className="break-words text-sm text-status-danger">{error || status.error}</p> : null}
    {!status && !loading ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void run("status")}>Retry connection status</Button> : null}
    <p role="status" className="text-sm text-text-secondary">{busy ? "Working…" : notice}</p>
    <Dialog open={Boolean(confirm || pendingSwitch)} onOpenChange={(open) => { if (!open && !busy && !pendingSwitch) setConfirm(""); }}>
      <DialogContent showCloseButton={!busy && !pendingSwitch} className="sm:max-w-md" onEscapeKeyDown={(event) => { if (busy || pendingSwitch) event.preventDefault(); }} onInteractOutside={(event) => { if (busy || pendingSwitch) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{pendingSwitch ? "Switch QuickBooks company?" : confirm === "disconnect" ? `Disconnect ${name}?` : `Change ${name} organisation?`}</DialogTitle><DialogDescription>{pendingSwitch
          ? "Existing mappings and history for the previous company will be preserved and will not be reused for the new company. QuickBooks configuration will need to be set again."
          : confirm === "disconnect"
          ? "Accounting sync will stop. Existing customers, invoices, payments, configuration and mapping history will be preserved."
          : "Existing mappings will stay with the previous company. Existing invoices cannot be sent to the new company. Configure its sales item or account and tax mapping before syncing new invoices."}</DialogDescription></DialogHeader>
        {pendingSwitch ? <div className="space-y-2 text-sm"><p className="break-words">Current: {pendingSwitch.current.name}</p><p className="break-words">New: {pendingSwitch.proposed.name}</p><p>{pendingSwitch.proposed.country} / {pendingSwitch.proposed.currency}</p></div> : null}
        {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => pendingSwitch ? void run("company-switch", "POST", { switchId: pendingSwitch.id, confirm: false }) : setConfirm("")}>Cancel</Button><Button disabled={busy} onClick={() => void run(pendingSwitch ? "company-switch" : confirm === "disconnect" ? "disconnect" : "organisation", "POST", pendingSwitch ? { switchId: pendingSwitch.id, confirm: true } : confirm === "disconnect" ? {} : { tenantId, confirmChange: true })}>{pendingSwitch ? "Switch company" : confirm === "disconnect" ? `Disconnect ${name}` : "Change organisation"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
