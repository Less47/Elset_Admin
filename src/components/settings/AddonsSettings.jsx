import { useState } from "react";
import XeroSettings from "./XeroSettings";
import { ADDON_LIST, isAddonEnabled } from "@/lib/addons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function AddonsSettings({ workspaceAddons, available, fetchWithAuth }) {
  const [disableAddon, setDisableAddon] = useState(null);
  const [notice, setNotice] = useState("");
  const { addons, loading, saving, error, change, refresh } = workspaceAddons;
  async function save(addon, enabled) {
    setNotice("");
    if (await change(addon.key, enabled)) {
      setDisableAddon(null);
      setNotice(`${addon.name} ${enabled ? "enabled" : "disabled"} for this workspace.`);
    }
  }
  return <section className="grid gap-3" aria-label="Workspace add-ons">
    <div><h2 className="text-lg font-semibold">Add-ons</h2><p className="text-sm text-text-secondary">Choose the built-in modules your company uses. Changes apply to everyone in this workspace.</p></div>
    {ADDON_LIST.map((addon) => {
      const enabled = isAddonEnabled(addons, addon.key);
      return <article key={addon.key} className="rounded-xl border border-border bg-card p-4 text-card-foreground" data-addon={addon.key}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><h3 className="text-base font-semibold">{addon.name}</h3><p id={`addon-description-${addon.key}`} className="mt-1 max-w-2xl text-sm text-text-secondary">{addon.description}</p></div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            <Badge className={enabled ? "bg-status-success-surface text-status-success" : "bg-muted text-muted-foreground"}>{enabled ? "Enabled" : "Disabled"}</Badge>
            <button type="button" role="switch" aria-label={`${addon.name} enabled`} aria-describedby={`addon-description-${addon.key}${available ? "" : " addon-storage-requirement"}`} aria-checked={enabled} disabled={!available || loading || saving}
              onClick={() => enabled ? setDisableAddon(addon) : void save(addon, true)}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
              <span aria-hidden="true" className={`pointer-events-none inline-flex h-6 w-11 items-center rounded-full border border-border transition-colors ${enabled ? "bg-primary" : "bg-muted"}`}>
                <span className={`h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
        </div>
        {addon.includes?.length ? <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary">{addon.includes.map((item) => <li key={item}>• {item}</li>)}</ul> : null}
        {addon.key === "xero" ? <XeroSettings enabled={enabled} available={available} fetchWithAuth={fetchWithAuth} /> : null}
      </article>;
    })}
    {!available ? <p id="addon-storage-requirement" className="text-sm text-text-secondary">Add-ons require SQLite workspace storage. This workspace is using legacy JSON storage.</p> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-status-danger"><span>{error}</span><Button variant="outline" size="sm" disabled={saving} onClick={() => void refresh()}>Retry</Button></div> : null}
    <p role="status" className="text-sm text-text-secondary">{loading ? "Loading add-ons…" : saving ? "Saving add-ons…" : notice}</p>
    <Dialog open={Boolean(disableAddon)} onOpenChange={(open) => { if (!open && !saving) setDisableAddon(null); }}>
      <DialogContent className="sm:max-w-sm" showCloseButton={!saving} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Disable {disableAddon?.name}?</DialogTitle><DialogDescription>{disableAddon?.disableDescription || `${disableAddon?.name || "This add-on"} will be unavailable. Existing records and history will be preserved.`}</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setDisableAddon(null)}>Cancel</Button><Button disabled={saving} onClick={() => void save(disableAddon, false)}>{saving ? "Disabling…" : "Disable"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
