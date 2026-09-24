import { useEffect, useRef, useState } from "react";
import { useSettingsDraft } from "@/hooks/useSettingsDraft";
import { Upload, Trash2 } from "lucide-react";
import WorkspaceLogo from "@/components/app/WorkspaceLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WORKSPACE_LOGO_MAX_BYTES, WORKSPACE_LOGO_TYPES } from "@/lib/workspace-logo";

export default function WorkspaceBranding({ url, onChange, enabled }) {
  const input = useRef(null);
  const form = useSettingsDraft("branding", { url, file: null }, async value => ({ url: await onChange(value.file), file: null }), { enabled });
  const busy = form.saving;
  const previewUrl = form.draft.url;
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  function stage(file) {
    setError("");
    if (file && !WORKSPACE_LOGO_TYPES.includes(file.type)) { setError("Choose a PNG, JPEG or WebP image."); return; }
    if (file && file.size > WORKSPACE_LOGO_MAX_BYTES) { setError("Workspace logo must be 2 MB or smaller."); return; }
    form.setDraft({ url: file ? URL.createObjectURL(file) : "", file });
    setConfirmRemove(false);
  }
  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  return (
    <Card className="rounded-3xl border-border shadow-sm" data-workspace-branding>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Workspace Branding</CardTitle>
        <p className="text-sm text-text-secondary">One workspace logo for everyone. Your personal theme stays separate.</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm font-medium">Workspace logo</p>
        <div className="w-full max-w-[246px]"><WorkspaceLogo url={previewUrl} /></div>
        <input ref={input} type="file" accept={WORKSPACE_LOGO_TYPES.join(",")} aria-label="Workspace logo file" className="sr-only" disabled={busy || !enabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) stage(file); }} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || !enabled} onClick={() => input.current?.click()}><Upload className="h-4 w-4" />{previewUrl ? "Replace Logo" : "Upload Logo"}</Button>
          {previewUrl ? <Button type="button" variant="outline" disabled={busy || !enabled} onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" />Remove Logo</Button> : null}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG or WebP. Up to 2 MB, 4096 pixels per side and 8 megapixels.</p>
        {!enabled ? <p className="text-sm text-text-secondary">Workspace branding is available with SQLite workspace storage.</p> : null}
        {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
        <p role="status" aria-live="polite" className="text-sm text-text-secondary">{busy ? "Saving workspace logo..." : form.dirty ? "Logo preview. Save changes to apply it to the workspace." : form.status === "saved" ? (previewUrl ? "Workspace logo saved." : "Workspace logo removed.") : ""}</p>
      </CardContent>
      <Dialog open={confirmRemove} onOpenChange={(open) => { if (!busy) setConfirmRemove(open); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Remove workspace logo?</DialogTitle><DialogDescription>The workspace icon will appear for everyone after you save changes.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => stage(null)}>Remove Logo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
