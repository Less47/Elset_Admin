import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import DocumentEmailComposer from "@/components/documents/DocumentEmailComposer";
import { documentContactSuggestions, resolveDocumentEmailDraft } from "@/lib/document-email";
import { maintenanceServiceEmailDraft } from "@/lib/maintenance-service-email";
import { maintenanceServiceRequest, openMaintenanceServicePdf } from "@/lib/maintenance-service-api";
import { MAINTENANCE_ACKNOWLEDGEMENTS, MAINTENANCE_RESULTS, MAINTENANCE_SEVERITIES } from "@/lib/maintenance-checklist";
import { formatMaintenanceDate } from "@/lib/maintenance-recurrence";
import "@/components/documents/DocumentWorkspace.css";
import "./MaintenanceService.css";

export default function MaintenanceServiceReport({ report, fetchWithAuth, canEmail, enabled, customer, onHistory, onAddonDisabled }) {
  const [expanded, setExpanded] = useState(false), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [errors, setErrors] = useState({});
  useUnsavedChanges(Boolean(draft), { busy });
  const base = canEmail ? `/api/maintenance-service-reports/${encodeURIComponent(report.id)}` : `/api/jobs/${encodeURIComponent(report.jobId)}/maintenance-service`;
  async function pdf(download) {
    setBusy(true); setError("");
    try { await openMaintenanceServicePdf(fetchWithAuth, base, download); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function send(event) {
    event.preventDefault();
    const { email, errors: validation } = resolveDocumentEmailDraft(draft);
    setErrors(validation); if (Object.keys(validation).length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await maintenanceServiceRequest(fetchWithAuth, `${base}/send`, { method: "POST", body: JSON.stringify({ email }) });
      const delivery = [result.rejectedRecipients?.length ? `Rejected: ${result.rejectedRecipients.join(", ")}.` : "", result.unconfirmedRecipients?.length ? `Unconfirmed: ${result.unconfirmedRecipients.join(", ")}.` : ""].filter(Boolean).join(" ");
      setNotice([`Email accepted for ${result.acceptedRecipients.join(", ")}.`, result.warning, delivery].filter(Boolean).join(" "));
      setDraft(null); if (result.history) onHistory?.(result.history);
    } catch (failure) {
      if (failure.code === "ADDON_DISABLED") onAddonDisabled?.();
      setErrors(failure.fieldErrors || {});
      const delivery = failure.delivery;
      setError([failure.message, delivery?.rejectedRecipients?.length ? `Rejected: ${delivery.rejectedRecipients.join(", ")}.` : "",
        delivery?.unconfirmedRecipients?.length ? `Unconfirmed: ${delivery.unconfirmedRecipients.join(", ")}.` : ""].filter(Boolean).join(" "));
    } finally { setBusy(false); }
  }
  return <div className="maintenance-service-report grid min-w-0 gap-3" data-maintenance-service-report>
    <div><h3 className="text-base font-semibold">Maintenance Service Report</h3><p className="text-sm text-text-secondary">Completed · {report.counts.defects} {report.counts.defects === 1 ? "defect" : "defects"} · {MAINTENANCE_ACKNOWLEDGEMENTS[report.signatureStatus]}</p>
      <p className="mt-1 text-xs text-muted-foreground">{formatMaintenanceDate(report.serviceDate)} · {report.technicianName}</p></div>
    {error ? <div role="alert"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
    {notice ? <p role="status" className="break-words text-sm text-text-secondary">{notice}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setExpanded(!expanded)}>{expanded ? "Hide Report" : "View Report"}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => pdf(false)}>Preview PDF</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => pdf(true)}>Download PDF</Button>
      {enabled && canEmail ? <Button type="button" size="sm" disabled={busy || Boolean(draft)} onClick={() => { setDraft(maintenanceServiceEmailDraft(report)); setErrors({}); }}>Email Service Report</Button> : null}</div>
    {expanded ? <div className="grid gap-4 border-t pt-4" data-maintenance-report-preview>
      <dl className="grid gap-1 text-sm"><div><dt className="inline font-semibold">Customer: </dt><dd className="inline">{report.snapshot.customerName}</dd></div><div><dt className="inline font-semibold">Site: </dt><dd className="inline">{report.snapshot.siteAddress}</dd></div><div><dt className="inline font-semibold">Plan: </dt><dd className="inline">{report.snapshot.planName}</dd></div><div><dt className="inline font-semibold">Job: </dt><dd className="inline">#{report.snapshot.jobNumber}</dd></div>{report.snapshot.clientReference ? <div>Client/site reference: {report.snapshot.clientReference}</div> : null}</dl>
      <ol className="grid gap-2 text-sm">{report.items.map(item => <li key={item.id}><strong className="mr-2">{MAINTENANCE_RESULTS[item.result]}</strong>{item.position}. {item.text}{item.notes ? <p className="ml-3 whitespace-pre-wrap text-xs text-muted-foreground">{item.notes}</p> : null}</li>)}</ol>
      <section aria-label="Recorded defects"><h4 className="font-semibold">Defects</h4>{report.defects.length ? report.defects.map(defect => <article key={defect.id} className="mt-2 border-l-2 border-status-danger pl-3 text-sm"><strong>{MAINTENANCE_SEVERITIES[defect.severity]} · {report.items.find(item => item.id === defect.resultId)?.text}</strong><p className="whitespace-pre-wrap">{defect.description}</p>{defect.recommendedAction ? <p className="mt-1 whitespace-pre-wrap">Recommended action: {defect.recommendedAction}</p> : null}<div className="mt-2 flex flex-wrap gap-2">{defect.photoRefs.map(id => { const photo = report.photos.find(photo => photo.id === id); return photo ? <figure key={id}><img className="h-24 max-w-full rounded object-contain" src={photo.url} alt={photo.name || "Defect photo"} /><figcaption className="text-xs">{photo.name}</figcaption></figure> : <p key={id} className="text-xs text-muted-foreground">Linked photo unavailable.</p>; })}</div></article>) : <p className="text-sm text-muted-foreground">No defects recorded.</p>}</section>
      <section><h4 className="font-semibold">Technician notes</h4><p className="whitespace-pre-wrap text-sm">{report.serviceNotes || "No additional notes."}</p></section>
      <section><h4 className="font-semibold">Customer acknowledgement</h4><p className="text-sm">{MAINTENANCE_ACKNOWLEDGEMENTS[report.signatureStatus]}{report.representativeName ? ` · ${report.representativeName}` : ""}</p>{report.signatureData ? <img className="mt-2 w-full max-w-xs rounded border bg-white" src={report.signatureData} alt={`Signature of ${report.representativeName}`} /> : null}{report.signedAt ? <p className="text-xs text-muted-foreground">Signed: {new Date(report.signedAt).toLocaleString("en-AU")}</p> : null}</section>
      <p className="text-xs text-muted-foreground">Completed by {report.technicianName}: {new Date(report.completedAt).toLocaleString("en-AU")}. This report is read-only.</p>
    </div> : null}
    {draft && enabled && canEmail ? <form className="grid gap-3 border-t pt-4" onSubmit={send} aria-label="Email service report">
      <h4 className="font-semibold">Email Service Report</h4><DocumentEmailComposer draft={draft} onChange={setDraft} errors={errors} disabled={busy}
        suggestions={documentContactSuggestions({ ...report.snapshot, jobAddress: report.snapshot.siteAddress }, customer)} />
      <div className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel email</Button><Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send Service Report"}</Button></div>
    </form> : null}
    {canEmail && report.sentHistory.length ? <details><summary className="cursor-pointer text-sm font-semibold">Email history ({report.sentHistory.length})</summary><ol className="mt-2 grid gap-3">{report.sentHistory.map(send => <li key={send.id} className="break-words border-l-2 pl-3 text-xs"><p>{new Date(send.sentAt).toLocaleString("en-AU")} · {send.sentBy?.name}</p><p>To: {send.to.join(", ")}</p>{send.cc.length ? <p>CC: {send.cc.join(", ")}</p> : null}{send.bcc.length ? <p>BCC (private): {send.bcc.join(", ")}</p> : null}<p>{send.subject}</p><p className="whitespace-pre-wrap">{send.message}</p><p>Accepted: {send.acceptedRecipients.join(", ")}</p>{send.rejectedRecipients.length ? <p>Rejected: {send.rejectedRecipients.join(", ")}</p> : null}{send.unconfirmedRecipients.length ? <p>Unconfirmed: {send.unconfirmedRecipients.join(", ")}</p> : null}<p>From: {send.fromEmail} · Reply-to: {send.replyToEmail}</p>{send.messageId ? <p>Provider ID: {send.messageId}</p> : null}</li>)}</ol></details> : null}
  </div>;
}
