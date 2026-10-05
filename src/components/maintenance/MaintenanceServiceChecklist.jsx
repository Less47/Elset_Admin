import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import { MAINTENANCE_RESULTS, MAINTENANCE_SEVERITIES, MAINTENANCE_ACKNOWLEDGEMENTS } from "@/lib/maintenance-checklist";
import { maintenanceServiceRequest } from "@/lib/maintenance-service-api";
import MaintenanceSignature from "./MaintenanceSignature";
import MaintenanceServiceReport from "./MaintenanceServiceReport";
import "./MaintenanceService.css";

function DefectEditor({ item, saved, photos, busy, onSave, onDirty }) {
  const [draft, setDraft] = useState(() => ({ severity: saved?.severity || "", description: saved?.description || "",
    recommendedAction: saved?.recommendedAction || "", photoRefs: saved?.photoRefs || [] }));
  const dirty = JSON.stringify(draft) !== JSON.stringify({ severity: saved?.severity || "", description: saved?.description || "",
    recommendedAction: saved?.recommendedAction || "", photoRefs: saved?.photoRefs || [] });
  useEffect(() => { onDirty(item.id, dirty); return () => onDirty(item.id, false); }, [onDirty, item.id, dirty]);
  const field = key => ({ value: draft[key], onChange: event => setDraft(current => ({ ...current, [key]: event.target.value })) });
  return <div className="maintenance-defect-editor" aria-label={`Defect for check ${item.position}`}>
    <p id={`defect-help-${item.id}`} className="text-xs text-status-danger">Description and severity are required before completing this service.</p>
    <label className="grid gap-1 text-xs font-medium">Severity<select className="h-11 rounded-lg border bg-card px-3" aria-label={`Severity for check ${item.position}`} aria-describedby={`defect-help-${item.id}`} {...field("severity")} disabled={busy} required><option value="">Select severity</option>{Object.entries(MAINTENANCE_SEVERITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="grid gap-1 text-xs font-medium">Defect description<Textarea rows={3} aria-label={`Defect description for check ${item.position}`} aria-describedby={`defect-help-${item.id}`} maxLength={8000} {...field("description")} disabled={busy} required /></label>
    <label className="grid gap-1 text-xs font-medium">Recommended action (optional)<Textarea rows={2} maxLength={8000} aria-label={`Recommended action for check ${item.position}`} {...field("recommendedAction")} disabled={busy} /></label>
    <fieldset disabled={busy}><legend className="mb-2 text-xs font-medium">Link job photos (optional)</legend>{photos.length ? <div className="flex flex-wrap gap-3">{photos.map(photo => <label className="maintenance-photo-choice" key={photo.id}><input type="checkbox" checked={draft.photoRefs.includes(photo.id)} onChange={event => setDraft(current => ({ ...current, photoRefs: event.target.checked ? [...current.photoRefs, photo.id] : current.photoRefs.filter(id => id !== photo.id) }))} /><img src={photo.url} alt="" className="h-14 w-16 rounded object-cover" /><span className="text-xs">{photo.name || "Job photo"}</span></label>)}</div> : <p className="text-xs text-muted-foreground">Upload photos in the job’s Notes & Photos section, then link them here.</p>}
      {draft.photoRefs.filter(id => !photos.some(photo => photo.id === id)).map(id => <label className="mt-2 flex items-center gap-2 text-xs" key={id}><input type="checkbox" checked onChange={() => setDraft(current => ({ ...current, photoRefs: current.photoRefs.filter(ref => ref !== id) }))} />Linked photo unavailable (uncheck to remove)</label>)}
    </fieldset>
    <Button type="button" size="sm" disabled={busy || !draft.description.trim() || !draft.severity} onClick={() => onSave(draft)}>Save defect</Button>
  </div>;
}

export default function MaintenanceServiceChecklist({ job, enabled, fetchWithAuth, canEmail, customer, onAddonDisabled, onCompleted }) {
  const [report, setReport] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notes, setNotes] = useState(""), [date, setDate] = useState("");
  const [ack, setAck] = useState(""), [representative, setRepresentative] = useState(""), [signature, setSignature] = useState("");
  const [remaining, setRemaining] = useState([]), [defectDirty, setDefectDirty] = useState({});
  const pending = useRef(false);
  const base = `/api/jobs/${encodeURIComponent(job.id)}/maintenance-service`;
  const dirty = report?.status === "draft" && (notes !== report.serviceNotes || date !== report.serviceDate || Boolean(ack || signature || representative) || Object.values(defectDirty).some(Boolean));
  useUnsavedChanges(Boolean(dirty), { busy });
  const dirtyCallback = useRef((id, value) => setDefectDirty(current => current[id] === value ? current : { ...current, [id]: value })).current;
  useEffect(() => {
    let active = true;
    maintenanceServiceRequest(fetchWithAuth, base).then(({ report: loaded }) => {
      if (active) { setReport(loaded); setNotes(loaded?.serviceNotes || ""); setDate(loaded?.serviceDate || ""); }
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, fetchWithAuth, enabled]);
  async function mutate(path, body, method = "POST") {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setRemaining([]);
    try {
      const result = await maintenanceServiceRequest(fetchWithAuth, `${base}${path}`, { method, body: JSON.stringify({ ...body, revision: report?.revision }) });
      setReport(result.report);
      if (!report || path === "/complete") { setNotes(result.report.serviceNotes); setDate(result.report.serviceDate); }
      if (path === "/complete") { setAck(""); setRepresentative(""); setSignature(""); setDefectDirty({}); onCompleted?.(result.jobChange); }
      return result.report;
    } catch (failure) {
      setError(failure.message);
      setRemaining([...(failure.unansweredItems || []), ...(failure.invalidDefectItems || [])]);
      if (failure.code === "ADDON_DISABLED") onAddonDisabled?.();
    } finally { pending.current = false; setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError("");
    try { const result = await maintenanceServiceRequest(fetchWithAuth, base); setReport(result.report); setNotes(result.report?.serviceNotes || ""); setDate(result.report?.serviceDate || ""); setDefectDirty({}); setAck(""); setRepresentative(""); setSignature(""); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  if (loading) return enabled && job.maintenancePlanId ? <p role="status" className="mb-4 text-sm">Loading maintenance checklist…</p> : null;
  if (!report && (!enabled || !job.maintenancePlanId)) return null;
  return <WorkspaceSection title={report?.status === "completed" ? "Completed maintenance" : "Maintenance Checklist"} className="mb-5" description={report?.status === "completed" ? "Historical service record" : "Record the inspection for this visit. The checklist is fixed when this visit starts."}>
    {error ? <div role="alert" className="mb-3"><WorkspaceMessage tone="error">{error}{remaining.length ? <ul className="mt-2 list-disc pl-5">{remaining.map(item => <li key={item.id}>{item.text}</li>)}</ul> : null}</WorkspaceMessage><Button className="mt-2" variant="outline" size="sm" type="button" disabled={busy} onClick={reload}>Reload checklist</Button></div> : null}
    {!report ? <Button type="button" disabled={busy} onClick={() => mutate("", {})}>{busy ? "Starting…" : "Start maintenance checklist"}</Button>
      : report.status === "completed" ? <MaintenanceServiceReport report={report} fetchWithAuth={fetchWithAuth} enabled={enabled} canEmail={canEmail} customer={customer} onAddonDisabled={onAddonDisabled} onHistory={send => setReport(current => ({ ...current, sentHistory: [send, ...current.sentHistory] }))} />
      : enabled ? <div className="maintenance-service-execution grid gap-4" data-maintenance-service-checklist>
        <p className="text-sm" role="status">{report.counts.completed} completed · {report.counts.defects} {report.counts.defects === 1 ? "defect" : "defects"} · {report.counts.na} N/A · <strong>{report.counts.unanswered} unanswered</strong></p>
        <ol className="maintenance-service-items">{report.items.map(item => {
          const saved = report.defects.find(defect => defect.resultId === item.id);
          return <li key={item.id} className="maintenance-service-item" data-service-result={item.id}><p className="text-sm font-medium">{item.position}. {item.text}</p>
            <div role="group" aria-label={`Outcome for check ${item.position}: ${item.text}`} className="maintenance-result-buttons">{Object.entries(MAINTENANCE_RESULTS).map(([value, label]) => <Button type="button" key={value} size="sm" variant={item.result === value ? "default" : "outline"} aria-pressed={item.result === value} aria-label={`${label}: ${item.text}`} disabled={busy || (value !== "defect" && defectDirty[item.id])} onClick={() => mutate(`/checklist/${encodeURIComponent(item.id)}`, { result: value }, "PATCH")}>{label}</Button>)}</div>
            {item.result === "defect" ? <DefectEditor key={`${item.id}-${saved?.updatedAt || "new"}`} item={item} saved={saved} photos={job.photos || []} busy={busy} onDirty={dirtyCallback} onSave={draft => mutate("/defects", { ...draft, resultId: item.id })} /> : null}
          </li>;
        })}</ol>
        <label className="grid gap-1.5 text-sm font-medium">Service date<Input type="date" value={date} onChange={event => setDate(event.target.value)} disabled={busy} /></label>
        <label className="grid gap-1.5 text-sm font-medium">Technician notes<Textarea rows={4} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} disabled={busy} /></label>
        <Button className="justify-self-start" type="button" variant="outline" size="sm" disabled={busy} onClick={() => mutate("", { serviceNotes: notes, serviceDate: date }, "PATCH")}>Save service notes</Button>
        <fieldset className="grid gap-3 border-t pt-4" disabled={busy}><legend className="text-sm font-semibold">Customer acknowledgement</legend>
          <label className="grid gap-1.5 text-sm">Acknowledgement<select aria-label="Acknowledgement" className="h-11 rounded-lg border bg-card px-3" value={ack} onChange={event => { setAck(event.target.value); setSignature(""); }}><option value="">Choose acknowledgement</option>{Object.entries(MAINTENANCE_ACKNOWLEDGEMENTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {ack === "signed" ? <><label className="grid gap-1.5 text-sm">Representative name<Input maxLength={180} value={representative} onChange={event => setRepresentative(event.target.value)} /></label><MaintenanceSignature onChange={setSignature} disabled={busy} /></> : null}
        </fieldset>
        {Object.values(defectDirty).some(Boolean) ? <p className="text-xs text-status-danger">Save each edited defect before completing the service.</p> : null}
        <div className="flex flex-wrap items-center gap-3 border-t pt-3"><Button type="button" disabled={busy || Object.values(defectDirty).some(Boolean)} onClick={() => mutate("/complete", { signatureStatus: ack, representativeName: representative, signatureData: signature, serviceNotes: notes, serviceDate: date, expectedJobStatus: job.status })}>{busy ? "Saving…" : "Complete Service"}</Button><p className="text-xs text-muted-foreground">Completion marks the job completed and locks this report, its notes and signature.</p></div>
      </div> : null}
  </WorkspaceSection>;
}
