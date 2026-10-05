import { useRef, useState } from "react";
import StaffAvatar from "@/components/shared/StaffAvatar";
import { Button } from "@/components/ui/button";
import { MEDIA_IMAGE_ACCEPT, STAFF_PHOTO_MAX_BYTES, mediaRequest, uploadMedia } from "@/lib/workspace-media";

export default function StaffPhotoEditor({ staff, fetchWithAuth, onSaved, onBusyChange }) {
  const [avatar, setAvatar] = useState(staff);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef(null);
  async function change(file) {
    if (busy) return;
    if (file && file.size > STAFF_PHOTO_MAX_BYTES) { setError("Profile photo must be 2 MB or smaller."); return; }
    setBusy(true); onBusyChange(true); setError("");
    try {
      const endpoint = `/api/staff/${encodeURIComponent(staff.id)}/avatar`;
      const result = file ? await uploadMedia(fetchWithAuth, endpoint, file) : await mediaRequest(fetchWithAuth, endpoint, { method: "DELETE" });
      const next = { avatarMediaId: result.photo?.id || null, avatarUrl: result.photo?.thumbnailUrl || "" };
      setAvatar(current => ({ ...current, ...next })); onSaved(staff.id, next);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section aria-label="Profile Photo" className="rounded-lg border p-3">
    <h3 className="mb-2 text-sm font-semibold">Profile Photo</h3>
    <div className="flex flex-wrap items-center gap-3">
      <StaffAvatar staff={avatar} className="size-16" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving photo…" : avatar.avatarUrl ? "Change Profile Photo" : "Upload Profile Photo"}</Button>
        {avatar.avatarUrl ? <Button type="button" variant="outline" disabled={busy} onClick={() => change(null)}>Remove Profile Photo</Button> : null}
      </div>
    </div>
    <input ref={input} type="file" className="sr-only" aria-label="Choose profile photo" accept={MEDIA_IMAGE_ACCEPT} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) change(file); }} />
    <p className="mt-2 text-xs text-muted-foreground">JPEG, PNG or WebP · up to 2 MB. Photo changes save immediately.</p>
    {error ? <p role="alert" className="mt-2 text-sm text-status-danger">{error}</p> : null}
  </section>;
}
