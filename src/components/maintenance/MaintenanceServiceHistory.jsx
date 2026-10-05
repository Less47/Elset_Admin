import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { maintenanceServiceRequest } from "@/lib/maintenance-service-api";
import { MAINTENANCE_ACKNOWLEDGEMENTS } from "@/lib/maintenance-checklist";
import { formatMaintenanceDate } from "@/lib/maintenance-recurrence";

export default function MaintenanceServiceHistory({ planId, enabled, fetchWithAuth }) {
  const [reports, setReports] = useState([]), [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    maintenanceServiceRequest(fetchWithAuth, `/api/maintenance-plans/${encodeURIComponent(planId)}/service-history`)
      .then(result => { if (active) setReports(result.reports); }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [planId, fetchWithAuth, enabled]);
  return <WorkspaceSection title="Service History">
    {error ? <div role="alert"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
    {reports.length ? <ol className="maintenance-history-rows">{reports.map(report => <li className="border-b py-3 first:pt-0 last:border-0" key={report.id}>
      <p className="text-sm font-medium">{formatMaintenanceDate(report.serviceDate)} · Job #{report.jobNumber}</p>
      <p className="mt-1 text-xs text-muted-foreground">{report.technicianName} · Completed · {report.defectCount ? `${report.defectCount} ${report.defectCount === 1 ? "defect" : "defects"}` : "No defects"}</p>
      <p className="text-xs text-muted-foreground">{MAINTENANCE_ACKNOWLEDGEMENTS[report.signatureStatus]}</p>
      <Button className="mt-2 h-11" type="button" variant="outline" size="sm" onClick={() => navigate(`/maintenance-reports/${encodeURIComponent(report.id)}`)}>View Report</Button>
    </li>)}</ol> : <p className="text-sm text-muted-foreground">No completed service reports yet.</p>}
  </WorkspaceSection>;
}
