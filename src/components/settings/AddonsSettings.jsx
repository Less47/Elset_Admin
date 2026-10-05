import { useRef, useState } from "react";
import { Calculator, ClipboardCheck } from "lucide-react";
import AccountingSettings from "./AccountingSettings";
import AddonDetails from "./AddonDetails";
import { useSettingsDraft } from "@/hooks/useSettingsDraft";
import { settingsPatch } from "@/lib/settings-draft";
import { ADDON_LIST, ACCOUNTING_PROVIDERS, activeAccountingProvider, accountingProviderName, isAddonEnabled } from "@/lib/addons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function AddonsSettings({ workspaceAddons, available, fetchWithAuth }) {
  const detailTrigger = useRef(null);
  const [details, setDetails] = useState(() => {
    const provider = new URLSearchParams(window.location.search).get("accounting");
    return ACCOUNTING_PROVIDERS.includes(provider) ? provider : "";
  });
  const [disableAddon, setDisableAddon] = useState(null);
  const [notice, setNotice] = useState("");
  const { addons: persistedAddons, loading, saving, error, refresh } = workspaceAddons;
  const form = useSettingsDraft("addons", persistedAddons, (draft, baseline) => workspaceAddons.save(settingsPatch(baseline, draft)), { enabled: available && !loading });
  const addons = form.draft;
  function stage(addon, enabled) {
    setNotice("");
    form.setDraft(current => ({ ...current, [addon.key]: enabled }));
    setDisableAddon(null);
    setNotice(`${addon.name} will be ${enabled ? "enabled" : "disabled"} when you save changes.`);
  }
  return <section className="grid gap-3" aria-label="Workspace add-ons">
    <div><h2 className="text-lg font-semibold">Add-ons</h2><p className="text-sm text-text-secondary">Choose the built-in modules your company uses. Changes apply to everyone in this workspace.</p></div>
    <div className="grid min-w-0 auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3" data-addon-grid>{ADDON_LIST.map((addon) => {
      const enabled = isAddonEnabled(addons, addon.key);
      const otherAccounting = ACCOUNTING_PROVIDERS.includes(addon.key) && !enabled && activeAccountingProvider(addons);
      const accounting = ACCOUNTING_PROVIDERS.includes(addon.key);
      const providerWarning = otherAccounting ? <p className="text-sm text-text-secondary">Disable {accountingProviderName(otherAccounting)} before enabling {addon.name}. Its connection and history will be preserved; existing invoices stay with their original provider.</p> : null;
      return <article key={addon.key} className="relative flex min-h-44 min-w-0 flex-col rounded-xl border border-border bg-card p-3 text-card-foreground" data-addon={addon.key}>
        <button type="button" className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`About ${addon.name}`} aria-haspopup="dialog" onClick={(event) => { detailTrigger.current = event.currentTarget; setDetails(addon.key); }} />
        <div className="mb-2 flex items-start justify-between gap-2">
          <div data-addon-icon aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-semibold ${addon.key === "quickbooks" ? "bg-[#2ca01c] text-white text-xl" : addon.key === "xero" ? "bg-[#0077c8] text-white text-sm" : "bg-status-info-surface text-status-info"}`}>
            {addon.key === "quickbooks" ? "qb" : addon.key === "xero" ? "xero" : addon.key === "maintenanceChecklists" ? <ClipboardCheck className="h-5 w-5" /> : <Calculator className="h-5 w-5" />}
          </div>
          <div className="relative z-10 flex min-w-0 items-center gap-2">
            {accounting ? <AccountingSettings provider={addon.key} addon={addon} enabled={isAddonEnabled(persistedAddons, addon.key)} showStatus={enabled} available={available} fetchWithAuth={fetchWithAuth} open={details === addon.key} onOpenChange={(open) => setDetails(open ? addon.key : "")} providerWarning={providerWarning} returnFocusRef={detailTrigger} /> : <Badge className={enabled ? "bg-status-success-surface text-status-success" : "bg-muted text-muted-foreground"}>{enabled ? "Enabled" : "Disabled"}</Badge>}
            <button type="button" role="switch" aria-label={`${addon.name} enabled`} aria-describedby={`addon-description-${addon.key}${available ? "" : " addon-storage-requirement"}`} aria-checked={enabled} disabled={!available || loading || saving || Boolean(otherAccounting)}
              onClick={() => enabled ? setDisableAddon(addon) : stage(addon, true)}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
              <span aria-hidden="true" className={`pointer-events-none inline-flex h-6 w-11 items-center rounded-full border border-border transition-colors ${enabled ? "bg-primary" : "bg-muted"}`}>
                <span className={`h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
        </div>
        <h3 className="pointer-events-none text-sm font-semibold">{addon.name}</h3><p id={`addon-description-${addon.key}`} className="pointer-events-none mt-1 text-xs leading-5 text-text-secondary">{addon.key === "maintenanceChecklists" ? "Inspect, record defects and deliver service reports." : addon.key === "jobCosting" ? "Track job costs, profit and margin." : `Sync invoices and payments with ${addon.name}.`}</p>
        <span className="pointer-events-none mt-auto pt-3 text-xs text-text-secondary">View details</span>
        {!accounting ? <AddonDetails addon={addon} open={details === addon.key} onOpenChange={(open) => setDetails(open ? addon.key : "")} returnFocusRef={detailTrigger} /> : null}
      </article>;
    })}</div>
    {!available ? <p id="addon-storage-requirement" className="text-sm text-text-secondary">Add-ons are unavailable for this workspace.</p> : null}
    {error && !form.error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-status-danger"><span>{error}</span><Button variant="outline" size="sm" disabled={saving} onClick={() => void refresh()}>Retry</Button></div> : null}
    <p role="status" className="text-sm text-text-secondary">{loading ? "Loading add-ons…" : saving ? "Saving add-ons…" : notice}</p>
    <Dialog open={Boolean(disableAddon)} onOpenChange={(open) => { if (!open && !saving) setDisableAddon(null); }}>
      <DialogContent className="sm:max-w-sm" showCloseButton={!saving} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Disable {disableAddon?.name}?</DialogTitle><DialogDescription>{disableAddon?.disableDescription || `${disableAddon?.name || "This add-on"} will be unavailable. Existing records and history will be preserved.`}</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setDisableAddon(null)}>Cancel</Button><Button disabled={saving} onClick={() => stage(disableAddon, false)}>Disable</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
