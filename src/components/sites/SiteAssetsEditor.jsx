import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normalizeSiteAssetRecord } from "@/lib/app-support";

export default function SiteAssetsEditor({ assets, newAssetDraft, onChangeDraft, onChangeAssets }) {
  const update = (id, key, value) => onChangeAssets((current) => current.map((asset) => asset.id === id ? { ...asset, [key]: value } : asset));
  return <div className="grid min-w-0 gap-3">
    <div className="rounded-lg border border-dashed border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Add gate or project</p>
      <div className="mt-3 grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Input aria-label="Gate / project name" value={newAssetDraft.name} onChange={(event) => onChangeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Name" />
          <Input aria-label="Gate / project type" value={newAssetDraft.type} onChange={(event) => onChangeDraft((current) => ({ ...current, type: event.target.value }))} placeholder="Type" />
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Input aria-label="Gate / project location" value={newAssetDraft.location} onChange={(event) => onChangeDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Location on site" />
          <Input aria-label="Gate / project model" value={newAssetDraft.model} onChange={(event) => onChangeDraft((current) => ({ ...current, model: event.target.value }))} placeholder="Model / operator" />
        </div>
        <Textarea aria-label="Gate / project notes" rows={3} value={newAssetDraft.notes} onChange={(event) => onChangeDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Fault history, setup notes, remotes, access method..." />
        <div className="flex justify-end"><Button type="button" className="rounded-xl" disabled={!newAssetDraft.name.trim()} onClick={() => {
          onChangeAssets((current) => [...current, normalizeSiteAssetRecord({ ...newAssetDraft, id: crypto.randomUUID(), updatedAt: new Date().toISOString() })]);
          onChangeDraft({ name: "", type: "", location: "", model: "", notes: "" });
        }}>Add Gate / Project</Button></div>
      </div>
    </div>
    {!assets.length ? <EmptyState title="No gate or project records yet" text="Add each gate, operator, or project area here so the site history stays grouped together." />
      : assets.map((asset) => <div key={asset.id} className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Input aria-label={`Name of ${asset.name || "gate / project"}`} value={asset.name} onChange={(event) => update(asset.id, "name", event.target.value)} placeholder="Name" />
            <Input aria-label={`Type of ${asset.name || "gate / project"}`} value={asset.type} onChange={(event) => update(asset.id, "type", event.target.value)} placeholder="Type" />
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Input aria-label={`Location of ${asset.name || "gate / project"}`} value={asset.location} onChange={(event) => update(asset.id, "location", event.target.value)} placeholder="Location on site" />
            <Input aria-label={`Model of ${asset.name || "gate / project"}`} value={asset.model} onChange={(event) => update(asset.id, "model", event.target.value)} placeholder="Model / operator" />
          </div>
          <Textarea aria-label={`Notes for ${asset.name || "gate / project"}`} rows={3} value={asset.notes} onChange={(event) => update(asset.id, "notes", event.target.value)} placeholder="Notes" />
          <div className="flex justify-end"><Button type="button" variant="outline" className="rounded-xl border-status-danger-border text-status-danger hover:bg-status-danger-surface hover:text-status-danger" onClick={() => onChangeAssets((current) => current.filter((entry) => entry.id !== asset.id))}>Remove</Button></div>
        </div>
      </div>)}
  </div>;
}
