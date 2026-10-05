import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { RecordWorkspace, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { maintenanceServiceRequest } from "@/lib/maintenance-service-api";
import MaintenanceServiceReport from "./MaintenanceServiceReport";
import { Button } from "@/components/ui/button";
import { formatMaintenanceDate } from "@/lib/maintenance-recurrence";

export default function MaintenanceServiceReportPage() {
  const { session, workspaceAddons, data } = useOutletContext();
  const { reportId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null), [error, setError] = useState("");
  const [history, setHistory] = useState(null);
  useEffect(() => {
    let active = true;
    maintenanceServiceRequest(session.fetchWithAuth, `/api/maintenance-service-reports${reportId ? `/${encodeURIComponent(reportId)}` : ""}`)
      .then(result => { if (active) { setError(""); setReport(result.report || null); setHistory(result.reports || null); } }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [session.fetchWithAuth, reportId]);
  return <RecordWorkspace title={report ? `Service Report · Job #${report.snapshot.jobNumber}` : "Maintenance Service Report"} eyebrow="Maintenance" backLabel="Maintenance" onBack={() => navigate(report && data.maintenancePlans.some(plan => plan.id === report.planId) ? `/maintenance/${encodeURIComponent(report.planId)}` : "/maintenance")}>
    {error ? <WorkspaceMessage tone="error">{error}</WorkspaceMessage> : reportId && report?.id === reportId ? <div className="record-major-panel rounded-xl border p-panel"><MaintenanceServiceReport key={report.id} report={report} fetchWithAuth={session.fetchWithAuth} enabled={workspaceAddons.addons.maintenanceChecklists}
      canEmail={session.canManageBusiness} onAddonDisabled={workspaceAddons.refresh} customer={data.customers.find(customer => customer.id === report.snapshot.customerId)} onHistory={send => setReport(current => ({ ...current, sentHistory: [send, ...current.sentHistory] }))} /></div> : !reportId && history ? null : <p role="status">Loading service report…</p>}
    {!reportId && history ? <div className="record-major-panel grid gap-3 rounded-xl border p-panel" aria-label="Completed service reports"><p className="text-sm text-muted-foreground">Completed visits are preserved here, including reports from archived plans and jobs.</p>{history.length ? <ol className="grid gap-3">{history.map(item => <li className="border-b py-3 last:border-0" key={item.id}><p className="font-medium">{item.siteAddress}</p><p className="text-sm">{item.customerName} · {formatMaintenanceDate(item.serviceDate)} · Job #{item.jobNumber}</p><p className="text-xs text-muted-foreground">{item.technicianName} · Completed · {item.defectCount} {item.defectCount === 1 ? "defect" : "defects"}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => navigate(`/maintenance-reports/${encodeURIComponent(item.id)}`)}>View Report</Button></li>)}</ol> : <p>No completed service reports yet.</p>}</div> : null}
  </RecordWorkspace>;
}
