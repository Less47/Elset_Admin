import { useEffect, useRef, useState } from "react";
import { useSettingsDraft } from "@/hooks/useSettingsDraft";
import { Upload, Trash2 } from "lucide-react";
import WorkspaceLogo, { WorkspaceBrandMark } from "@/components/app/WorkspaceLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WORKSPACE_BRANDING_MAX_BYTES, WORKSPACE_BRANDING_TYPES } from "@/lib/workspace-logo";

function BrandingEditor({ kind, url = "", onChange, enabled }) {
  const mark = kind === "mark";
  const title = mark ? "Brand Mark" : "Company Logo";
  const actionLabel = mark ? "Brand Mark" : "Logo";
  const input = useRef(null);
  // Each resource acknowledges independently if a grouped save partially fails.
  const form = useSettingsDraft(`branding-${kind}`, { url, file: null }, async value => ({ url: await onChange(kind, value.file), file: null }), { enabled });
  const busy = form.scope?.state.saving || form.saving;
  const previewUrl = form.draft.url;
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  function stage(file) {
    setError("");
    if (file && !WORKSPACE_BRANDING_TYPES.includes(file.type)) { setError("Choose a PNG, JPEG or WebP image."); return; }
    if (file && file.size > WORKSPACE_BRANDING_MAX_BYTES) { setError(`${mark ? "Brand mark" : "Workspace logo"} must be 2 MB or smaller.`); return; }
    form.setDraft({ url: file ? URL.createObjectURL(file) : "", file });
    setConfirmRemove(false);
  }
  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  return (
    <section className="min-w-0 space-y-3" data-branding-editor={kind} aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="branding-preview">
        {mark ? <WorkspaceBrandMark url={previewUrl} preview /> : <WorkspaceLogo url={previewUrl} preview className="max-w-[246px]" />}
      </div>
      <p className="text-xs text-text-secondary">{mark ? "Icon-only sidebar and compact use" : "Standard sidebar and full-branding use"}</p>
      <input ref={input} type="file" accept={WORKSPACE_BRANDING_TYPES.join(",")} aria-label={mark ? "Brand mark file" : "Workspace logo file"} className="sr-only" disabled={busy || !enabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) stage(file); }} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || !enabled} onClick={() => input.current?.click()}><Upload className="h-4 w-4" />{previewUrl ? "Replace" : "Upload"} {actionLabel}</Button>
        {previewUrl ? <Button type="button" variant="ghost" disabled={busy || !enabled} onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" />Remove {actionLabel}</Button> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
      <p role="status" aria-label={`${title} save status`} aria-live="polite" className="text-xs text-text-secondary">
        {busy ? `Saving ${mark ? "brand mark" : "workspace logo"}...` : form.dirty ? `${title} preview. Save changes to apply it to the workspace.` : form.status === "saved" ? `${mark ? "Brand mark" : "Workspace logo"} ${previewUrl ? "saved" : "removed"}.` : ""}
      </p>
      <Dialog open={confirmRemove} onOpenChange={(open) => { if (!busy) setConfirmRemove(open); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{mark ? "Remove brand mark?" : "Remove workspace logo?"}</DialogTitle>
            <DialogDescription>{mark ? "The default workspace icon will be used in the icon-only sidebar after you save changes." : "The workspace icon will appear for everyone after you save changes."}</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => stage(null)}>Remove {actionLabel}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function WorkspaceBranding({ logoUrl, brandMarkUrl, onChange, enabled }) {
  return (
    <Card className="rounded-3xl border-border shadow-sm" data-workspace-branding>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Workspace Branding</CardTitle>
        <p className="text-sm text-text-secondary">Shared branding for everyone. Your personal theme stays separate.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="workspace-branding-editors">
          <BrandingEditor kind="logo" url={logoUrl} onChange={onChange} enabled={enabled} />
          <BrandingEditor kind="mark" url={brandMarkUrl} onChange={onChange} enabled={enabled} />
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG or WebP. Up to 2 MB, 4096 pixels per side and 8 megapixels.</p>
        {!enabled ? <p className="text-sm text-text-secondary">Workspace branding is available with SQLite workspace storage.</p> : null}
      </CardContent>
    </Card>
  );
}
