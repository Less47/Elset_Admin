import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import { maintenanceReportCounts, MAINTENANCE_SEVERITIES } from "@/lib/maintenance-checklist";
import { maintenanceServiceRequest } from "@/lib/maintenance-service-api";
import MaintenanceServiceReport from "./MaintenanceServiceReport";
import "./MaintenanceService.css";

function DefectEditor({ item, saved, photos, busy, onSave, onCancel, onDirty }) {
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
    <div className="flex flex-wrap gap-2"><Button className="h-11" type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button><Button className="h-11" type="button" size="sm" disabled={busy || !draft.description.trim() || !draft.severity} onClick={() => onSave(draft)}>Save Defect</Button></div>
  </div>;
}

export default function MaintenanceServiceChecklist({ job, enabled, initialReport, fetchWithAuth, canEmail, customer, onAddonDisabled, onCompleted }) {
  const [report, setReport] = useState(initialReport), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notes, setNotes] = useState(initialReport?.serviceNotes || ""), [date, setDate] = useState(initialReport?.serviceDate || "");
  const [remaining, setRemaining] = useState([]), [defectDirty, setDefectDirty] = useState({});
  const [editingDefect, setEditingDefect] = useState(null);
  const pending = useRef(false);
  const base = `/api/jobs/${encodeURIComponent(job.id)}/maintenance-service`;
  const dirty = report?.status === "draft" && (notes !== report.serviceNotes || date !== report.serviceDate || Object.values(defectDirty).some(Boolean));
  useUnsavedChanges(Boolean(dirty), { busy });
  const dirtyCallback = useRef((id, value) => setDefectDirty(current => current[id] === value ? current : { ...current, [id]: value })).current;
  async function mutate(path, body, method = "POST") {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setRemaining([]);
    const previous = report;
    if (path === "/check-all") {
      const optimistic = { ...report, items: report.items.map(item => item.result ? item : { ...item, result: "completed" }) };
      setReport({ ...optimistic, counts: maintenanceReportCounts(optimistic) });
    } else if (path.startsWith("/checklist/")) {
      const id = decodeURIComponent(path.slice("/checklist/".length));
      const optimistic = { ...report, items: report.items.map(item => item.id === id ? { ...item, result: body.result } : item),
        defects: body.result === "defect" ? report.defects : report.defects.filter(defect => defect.resultId !== id) };
      setReport({ ...optimistic, counts: maintenanceReportCounts(optimistic) });
    }
    try {
      const result = await maintenanceServiceRequest(fetchWithAuth, `${base}${path}`, { method, body: JSON.stringify({ ...body, revision: report?.revision }) });
      setReport(result.report);
      if (!report || path === "/complete" || (path === "" && method === "PATCH")) { setNotes(result.report.serviceNotes); setDate(result.report.serviceDate); }
      if (path === "/complete") { setDefectDirty({}); onCompleted?.(result.jobChange); }
      return result.report;
    } catch (failure) {
      setReport(previous);
      setError(failure.message);
      setRemaining([...(failure.unansweredItems || []), ...(failure.invalidDefectItems || [])]);
      if (failure.code === "ADDON_DISABLED") onAddonDisabled?.();
    } finally { pending.current = false; setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError("");
    try { const result = await maintenanceServiceRequest(fetchWithAuth, base); setReport(result.report); setNotes(result.report?.serviceNotes || ""); setDate(result.report?.serviceDate || ""); setEditingDefect(null); setDefectDirty({}); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  function complete() {
    const unanswered = report.items.filter(item => !item.result);
    if (!report.items.length || unanswered.length) {
      setRemaining(unanswered); setError(unanswered.length ? `${unanswered.length} unanswered ${unanswered.length === 1 ? "check" : "checks"}. Answer each check before completing the service.` : "This visit has no checklist items. Add checks to the plan before generating the next visit.");
      if (unanswered.length) document.getElementById(`maintenance-result-${unanswered[0].id}`)?.focus();
      return;
    }
    mutate("/complete", { serviceNotes: notes, serviceDate: date, expectedJobStatus: job.status });
  }
  if (!report && (!enabled || !job.maintenancePlanId)) return null;
  return <WorkspaceSection title={report?.status === "completed" ? "Completed maintenance" : "Maintenance Checklist"} className="mb-5" description={report?.status === "completed" ? "Historical service record" : "Record the inspection for this visit. The checklist is fixed when this visit starts."}>
    {error ? <div role="alert" className="mb-3"><WorkspaceMessage tone="error">{error}{remaining.length ? <ul className="mt-2 list-disc pl-5">{remaining.map(item => <li key={item.id}>{item.text}</li>)}</ul> : null}</WorkspaceMessage><Button className="mt-2 h-11" variant="outline" size="sm" type="button" disabled={busy} onClick={reload}>Reload checklist</Button></div> : null}
    {!report ? <Button className="h-11" type="button" disabled={busy} onClick={() => mutate("", {})}>{busy ? "Starting…" : "Start maintenance checklist"}</Button>
      : report.status === "completed" ? <MaintenanceServiceReport report={report} fetchWithAuth={fetchWithAuth} enabled={enabled} canEmail={canEmail} customer={customer} onAddonDisabled={onAddonDisabled} onHistory={send => setReport(current => ({ ...current, sentHistory: [send, ...current.sentHistory] }))} />
      : enabled ? <div className="maintenance-service-execution grid gap-4" data-maintenance-service-checklist>
        <div className="maintenance-service-progress" role="status"><p className="text-sm font-semibold">{report.counts.total - report.counts.unanswered} of {report.counts.total} answered</p><p className="text-xs text-muted-foreground">{report.counts.completed} completed · {report.counts.defects} {report.counts.defects === 1 ? "defect" : "defects"} · {report.counts.na} N/A · {report.counts.unanswered} remaining</p></div>
        <table className="maintenance-checklist-table maintenance-job-checklist" aria-label="Maintenance job checklist">
          <thead><tr><th scope="col"><span className="sr-only">Check box</span><span aria-hidden="true">✓</span></th><th scope="col">No.</th><th scope="col">Item</th><th scope="col">Report defect</th><th scope="col">Mark N/A</th></tr></thead>
          <tbody>{report.items.map(item => {
          const saved = report.defects.find(defect => defect.resultId === item.id);
          return <Fragment key={item.id}><tr className="maintenance-service-item" data-service-result={item.id}>
            <td className="maintenance-check-cell"><label className="maintenance-completed-choice"><input id={`maintenance-result-${item.id}`} type="checkbox" aria-label={`Completed: ${item.text}`} checked={item.result === "completed"} disabled={busy || editingDefect === item.id} onChange={event => mutate(`/checklist/${encodeURIComponent(item.id)}`, { result: event.target.checked ? "completed" : null }, "PATCH")} /></label></td>
            <td className="maintenance-number-cell">{item.position}</td>
            <td className="maintenance-item-cell"><label htmlFor={`maintenance-result-${item.id}`} className="cursor-pointer font-medium">{item.text}</label>
              {saved ? <div className="maintenance-defect-summary text-xs"><p className="font-semibold text-status-danger">Defect · {MAINTENANCE_SEVERITIES[saved.severity]}</p><p className="whitespace-pre-wrap">{saved.description}</p>{saved.recommendedAction ? <p className="text-text-secondary">Recommended: {saved.recommendedAction}</p> : null}{saved.photoRefs.some(id => !(job.photos || []).some(photo => photo.id === id)) ? <p className="text-muted-foreground">Linked photo unavailable</p> : null}</div> : item.result === "na" ? <p className="maintenance-outcome-note text-xs text-muted-foreground">Not applicable · answered</p> : null}
            </td>
            <td className="maintenance-defect-action"><Button type="button" size="sm" variant="ghost" aria-label={`${saved ? "Edit Defect" : "Report defect"}: ${item.text}`} disabled={busy || Boolean(editingDefect)} onClick={() => setEditingDefect(item.id)}>{saved ? "Edit Defect" : "Report defect"}</Button></td>
            <td className="maintenance-na-action"><Button type="button" size="sm" variant="ghost" aria-label={`Mark N/A: ${item.text}`} aria-pressed={item.result === "na"} disabled={busy || editingDefect === item.id} onClick={() => mutate(`/checklist/${encodeURIComponent(item.id)}`, { result: item.result === "na" ? null : "na" }, "PATCH")}>{item.result === "na" ? "N/A · Clear" : "Mark N/A"}</Button></td>
          </tr>{editingDefect === item.id ? <tr className="maintenance-defect-editor-row"><td colSpan={5}><DefectEditor item={item} saved={saved} photos={job.photos || []} busy={busy} onDirty={dirtyCallback} onCancel={() => setEditingDefect(null)} onSave={async draft => { if (await mutate("/defects", { ...draft, resultId: item.id })) setEditingDefect(null); }} /></td></tr> : null}</Fragment>;
        })}</tbody></table>
        <Button className="maintenance-check-all h-11 justify-self-end xl:h-8" type="button" variant="outline" size="sm" disabled={busy || Boolean(editingDefect) || !report.counts.unanswered} onClick={() => mutate("/check-all", {})}>Check All</Button>
        <label className="grid gap-1.5 text-sm font-medium">Service date<Input type="date" value={date} onChange={event => setDate(event.target.value)} disabled={busy} /></label>
        <label className="grid gap-1.5 text-sm font-medium">Service Notes<Textarea aria-label="Service Notes" rows={4} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} disabled={busy} /></label>
        <Button className="h-11 justify-self-start" type="button" variant="outline" size="sm" disabled={busy} onClick={() => mutate("", { serviceNotes: notes, serviceDate: date }, "PATCH")}>Save service notes</Button>
        {Object.values(defectDirty).some(Boolean) ? <p className="text-xs text-status-danger">Save each edited defect before completing the service.</p> : null}
        <div className="flex flex-wrap items-center gap-3 border-t pt-3"><Button className="h-auto min-h-11 whitespace-normal" type="button" disabled={busy || Boolean(editingDefect)} onClick={complete}>{busy ? "Saving…" : "Complete Maintenance Service"}</Button><p className="text-xs text-muted-foreground">Completion marks the job completed and locks this report and its notes.</p></div>
      </div> : null}
  </WorkspaceSection>;
}
