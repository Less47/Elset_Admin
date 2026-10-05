import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MEDIA_IMAGE_ACCEPT, SITE_PHOTO_MAX_BYTES, mediaRequest, uploadMedia } from "@/lib/workspace-media";
import { formatDate } from "@/lib/app-support";

function PhotoImage({ photo, full = false }) {
  const [missing, setMissing] = useState(false);
  return missing ? <div role="status" className="flex min-h-28 items-center justify-center bg-muted p-3 text-xs text-muted-foreground">Image unavailable</div>
    : <img src={full ? photo.url : photo.thumbnailUrl} alt={photo.caption || photo.name || "Photo"} loading={full ? "eager" : "lazy"} decoding="async" onError={() => setMissing(true)}
      className={full ? "max-h-[55dvh] w-full object-contain" : "aspect-square w-full bg-muted object-cover"} />;
}
const sourceLabel = photo => photo.source === "site" ? "Site photo" : `Job #${photo.jobNumber ?? photo.jobId} · ${formatDate(photo.jobDate)}`;

export default function SitePhotoGallery({ siteId, fetchWithAuth, canManage = false, onOpenJob }) {
  const [source, setSource] = useState("all");
  const [photos, setPhotos] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(null);
  const [caption, setCaption] = useState("");
  const input = useRef(null);
  const generation = useRef(0);
  const endpoint = `/api/sites/${encodeURIComponent(siteId)}/photos`;
  const load = useCallback(async (offset = 0, signal) => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const payload = await mediaRequest(fetchWithAuth, `${endpoint}?source=${source}&offset=${offset}`, { signal });
      if (current !== generation.current || signal?.aborted) return;
      setPhotos(previous => offset ? [...previous, ...payload.photos] : payload.photos);
      setNextOffset(payload.nextOffset);
    } catch (failure) { if (current === generation.current && !signal?.aborted) setError(failure.message); }
    finally { if (current === generation.current && !signal?.aborted) setLoading(false); }
  }, [endpoint, fetchWithAuth, source]);
  useEffect(() => {
    const controller = new AbortController();
    setPhotos([]); setNextOffset(null); setSelected(null);
    load(0, controller.signal);
    return () => { controller.abort(); generation.current += 1; };
  }, [load]);

  async function upload(files) {
    if (busy || !files.length) return;
    setBusy(true); setError(""); setNotice("");
    let uploaded = 0, failureMessage = "";
    try {
      for (const file of files) {
        if (file.size > SITE_PHOTO_MAX_BYTES) throw new Error(`${file.name} must be 8 MB or smaller.`);
        await uploadMedia(fetchWithAuth, endpoint, file); uploaded += 1;
      }
    } catch (failure) { failureMessage = failure.message; }
    finally {
      if (uploaded) { await load(); setNotice(`${uploaded} ${uploaded === 1 ? "photo" : "photos"} uploaded.`); }
      setError(failureMessage); setBusy(false);
    }
  }
  async function remove(photo) {
    if (photo.source !== "site" || !window.confirm(`Delete ${photo.caption || photo.name} from this Site? This cannot be undone.`)) return;
    setBusy(true); setError("");
    try { await mediaRequest(fetchWithAuth, `${endpoint}/${encodeURIComponent(photo.id)}`, { method: "DELETE" }); setSelected(null); await load(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function saveCaption() {
    setBusy(true); setError("");
    try {
      const result = await mediaRequest(fetchWithAuth, `${endpoint}/${encodeURIComponent(selected.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption }) });
      setSelected(current => ({ ...current, caption: result.caption }));
      setPhotos(current => current.map(photo => photo.id === selected.id && photo.source === "site" ? { ...photo, caption: result.caption } : photo));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Site Photos" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label="Photo source filter" className="flex flex-wrap gap-1">
        {[["all", "All"], ["site", "Site Photos"], ["job", "Job Photos"]].map(([value, label]) => <Button key={value} type="button" size="sm" variant={source === value ? "default" : "outline"} aria-pressed={source === value} disabled={busy} onClick={() => setSource(value)}>{label}</Button>)}
      </div>
      {canManage ? <Button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving…" : "Upload Site Photos"}</Button> : null}
    </div>
    {canManage ? <><input ref={input} className="sr-only" type="file" multiple accept={MEDIA_IMAGE_ACCEPT} aria-label="Choose Site photos" disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; upload(files); }} /><p className="text-xs text-muted-foreground">JPEG, PNG or WebP · up to 8 MB each.</p></> : null}
    <p className="text-xs text-muted-foreground">Site reference photos and photos from Jobs explicitly linked to this Site. Job photos remain on their Job.</p>
    {error ? <div role="alert" className="text-sm text-status-danger">{error} <Button size="sm" variant="outline" disabled={loading || busy} onClick={() => load()}>Retry</Button></div> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" data-site-photo-grid>
      {photos.map(photo => <article key={`${photo.source}-${photo.id}`} className="min-w-0 overflow-hidden rounded-lg border bg-card">
        <button type="button" className="block w-full text-left focus-visible:outline-2 focus-visible:outline-primary" aria-label={`View ${photo.caption || photo.name}`} onClick={() => { setSelected(photo); setCaption(photo.caption || ""); }}><PhotoImage photo={photo} /></button>
        <div className="space-y-1 p-2 text-xs">
          <p className="truncate font-medium" title={photo.caption || photo.name}>{photo.caption || photo.name}</p>
          <p className="[overflow-wrap:anywhere]">{sourceLabel(photo)}</p>
          {photo.source === "site" ? <p className="text-muted-foreground">{formatDate(photo.createdAt)}{photo.uploadedBy ? ` · ${photo.uploadedBy}` : ""}</p> : <Button type="button" variant="outline" size="sm" className="h-8 w-full" onClick={() => onOpenJob(photo.jobId)}>Open Job</Button>}
        </div>
      </article>)}
    </div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading photos…</p> : !error && !photos.length ? <p className="py-4 text-sm text-muted-foreground">No photos yet.</p> : null}
    {nextOffset !== null ? <Button variant="outline" disabled={loading || busy} onClick={() => load(nextOffset)}>Load more photos</Button> : null}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !busy) setSelected(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle className="pr-8 [overflow-wrap:anywhere]">{selected?.caption || selected?.name || "Photo"}</DialogTitle><DialogDescription>{selected ? sourceLabel(selected) : ""}</DialogDescription></DialogHeader>
        {selected ? <><PhotoImage key={`${selected.source}-${selected.id}`} photo={selected} full /><p className="text-xs text-muted-foreground">Uploaded {formatDate(selected.createdAt)}{selected.uploadedBy ? ` · ${selected.uploadedBy}` : ""}</p>
          {selected.source === "job" ? <><p className="text-sm [overflow-wrap:anywhere]">{selected.jobTitle}</p><Button onClick={() => onOpenJob(selected.jobId)}>Open Job</Button></> : canManage ? <div className="grid gap-2">
            <label className="grid gap-1 text-sm">Caption (optional)<Input maxLength={240} value={caption} disabled={busy} onChange={event => setCaption(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2"><Button disabled={busy || caption === (selected.caption || "")} onClick={saveCaption}>Save Caption</Button><Button variant="outline" disabled={busy} onClick={() => remove(selected)}>Remove Site Photo</Button></div>
          </div> : null}
          {error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : null}
        </> : null}
      </DialogContent>
    </Dialog>
  </section>;
}
