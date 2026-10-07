import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";

export default function SiteEquipmentAssets({ assets, canManage, editing, dirty, saving, error, onManage, onChange, onAdd, onRemove, onCancel, onSave }) {
  return <WorkspaceSection title="Assets" description="Equipment records attached to this site."
    trailing={canManage && !editing ? <Button type="button" className="h-11" onClick={onManage}>Manage Assets</Button> : null}>
    {editing ? <form aria-label="Edit Site Assets" onSubmit={onSave} className="grid min-w-0 gap-3">
      <fieldset disabled={saving} className="grid min-w-0 gap-3">
        {!assets.length ? <EmptyState title="No Site Assets" text="Add equipment to this site using Add Asset." /> : null}
        {assets.map((asset, index) => <section key={asset.id} aria-label={`Asset ${index + 1}`} className="grid min-w-0 gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2">
          <FormField label="Asset name" htmlFor={`asset-${asset.id}-name`}><Input id={`asset-${asset.id}-name`} required value={asset.name || ""} onChange={(event) => onChange(asset.id, "name", event.target.value)} /></FormField>
          <FormField label="Equipment type" htmlFor={`asset-${asset.id}-type`}><Input id={`asset-${asset.id}-type`} value={asset.type || ""} onChange={(event) => onChange(asset.id, "type", event.target.value)} /></FormField>
          <FormField label="Location" htmlFor={`asset-${asset.id}-location`}><Input id={`asset-${asset.id}-location`} value={asset.location || ""} onChange={(event) => onChange(asset.id, "location", event.target.value)} /></FormField>
          <FormField label="Model" htmlFor={`asset-${asset.id}-model`}><Input id={`asset-${asset.id}-model`} value={asset.model || ""} onChange={(event) => onChange(asset.id, "model", event.target.value)} /></FormField>
          <div className="min-w-0 sm:col-span-2"><FormField label="Equipment notes" htmlFor={`asset-${asset.id}-notes`}><Textarea id={`asset-${asset.id}-notes`} value={asset.notes || ""} onChange={(event) => onChange(asset.id, "notes", event.target.value)} /></FormField></div>
          <div className="sm:col-span-2"><Button type="button" variant="outline" className="h-11 text-status-danger" aria-label={`Remove Asset ${asset.name || index + 1}`} onClick={() => onRemove(asset.id)}>Remove Asset</Button></div>
        </section>)}
        <div><Button type="button" variant="outline" className="h-11" onClick={onAdd}>Add Asset</Button></div>
      </fieldset>
      {error ? <div role="alert"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <span className="mr-auto text-sm text-muted-foreground" aria-live="polite">{saving ? "Saving Assets…" : dirty ? "Unsaved Asset changes" : ""}</span>
        <Button type="button" variant="outline" className="h-11" disabled={saving} onClick={onCancel}>Cancel Assets</Button>
        <Button type="submit" className="h-11" disabled={saving || !dirty}>Save Assets</Button>
      </div>
    </form> : <div className="grid min-w-0 gap-3">
      {!assets.length ? <EmptyState title="No Site Assets" text="No equipment records are attached to this site." /> : null}
      {assets.map((asset) => <div key={asset.id} className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
          <p className="font-semibold text-foreground">{asset.name}</p>
          <p className="mt-1 text-sm text-text-secondary">{[asset.type, asset.location].filter(Boolean).join(" - ") || "No type or location saved"}</p>
        </div>{asset.model ? <Badge variant="secondary">{asset.model}</Badge> : null}</div>
        {asset.notes ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{asset.notes}</p> : null}
      </div>)}
    </div>}
  </WorkspaceSection>;
}
