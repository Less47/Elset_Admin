import { useRef, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import WorkspaceLogo from "@/components/app/WorkspaceLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WORKSPACE_LOGO_MAX_BYTES, WORKSPACE_LOGO_TYPES } from "@/lib/workspace-logo";

export default function WorkspaceBranding({ url, onChange, enabled }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function save(file) {
    setError("");
    setNotice("");
    if (file && !WORKSPACE_LOGO_TYPES.includes(file.type)) { setError("Choose a PNG, JPEG or WebP image."); return; }
    if (file && file.size > WORKSPACE_LOGO_MAX_BYTES) { setError("Workspace logo must be 2 MB or smaller."); return; }
    setBusy(true);
    try {
      await onChange(file);
      setNotice(file ? "Workspace logo saved." : "Workspace logo removed.");
      setConfirmRemove(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the workspace logo.");
      setConfirmRemove(false);
    } finally { setBusy(false); }
  }

  return (
    <Card className="rounded-3xl border-border shadow-sm" data-workspace-branding>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Workspace Branding</CardTitle>
        <p className="text-sm text-text-secondary">One workspace logo for everyone. Your personal theme stays separate.</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm font-medium">Workspace logo</p>
        <div className="w-full max-w-[246px]"><WorkspaceLogo url={url} /></div>
        <input ref={input} type="file" accept={WORKSPACE_LOGO_TYPES.join(",")} aria-label="Workspace logo file" className="sr-only" disabled={busy || !enabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void save(file); }} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || !enabled} onClick={() => input.current?.click()}><Upload className="h-4 w-4" />{url ? "Replace Logo" : "Upload Logo"}</Button>
          {url ? <Button type="button" variant="outline" disabled={busy || !enabled} onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" />Remove Logo</Button> : null}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG or WebP. Up to 2 MB, 4096 pixels per side and 8 megapixels.</p>
        {!enabled ? <p className="text-sm text-text-secondary">Workspace branding is available with SQLite workspace storage.</p> : null}
        {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
        <p role="status" aria-live="polite" className="text-sm text-text-secondary">{busy ? "Saving workspace logo…" : notice}</p>
      </CardContent>
      <Dialog open={confirmRemove} onOpenChange={(open) => { if (!busy) setConfirmRemove(open); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Remove workspace logo?</DialogTitle><DialogDescription>The workspace icon will appear for everyone.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void save(null)}>Remove Logo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
