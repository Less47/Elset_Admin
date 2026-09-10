import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMaintenanceFrequencyMeta } from "@/lib/app-support";
import { formatCalendarDate } from "./calendar-utils";

export function CalendarMaintenanceChip({ occurrence, onOpen, dragApi }) {
  return <button type="button" data-calendar-maintenance={occurrence.key}
    className={`calendar-job-chip calendar-maintenance-chip block w-full min-w-0 truncate border-l-2 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${dragApi.drag?.job.id === occurrence.id ? "opacity-50" : ""}`}
    {...dragApi.getDragProps(occurrence, !occurrence.locked && occurrence.active)}
    aria-label={`${occurrence.planName} · Maintenance${occurrence.jobNumber ? ` · Job #${occurrence.jobNumber}` : ""}`}
    title={`${occurrence.planName}\n${occurrence.customerName}\n${occurrence.siteAddress}\n${formatCalendarDate(occurrence.date)} · ${getMaintenanceFrequencyMeta(occurrence.frequency).label}${occurrence.jobNumber ? `\nLinked Job #${occurrence.jobNumber}` : ""}`}
    onClick={(event) => { if (dragApi.allowClick(event)) onOpen(occurrence); }}>
    <Wrench className="mr-1 inline h-2.5 w-2.5" aria-hidden="true" />{occurrence.planName} · {occurrence.jobNumber ? `Job #${occurrence.jobNumber}` : occurrence.completedAt ? "Completed" : "Maintenance"}
  </button>;
}

export default function CalendarMaintenanceItem({ occurrence, actions, dragApi, busy }) {
  return <article data-calendar-inspector-maintenance={occurrence.key} className="calendar-maintenance-detail rounded-lg border p-2" {...dragApi.getDragProps(occurrence, !occurrence.locked && occurrence.active)}>
    <div className="flex items-center gap-1 text-[10px] font-semibold text-teal-800"><Wrench className="h-3 w-3" /> Maintenance · {getMaintenanceFrequencyMeta(occurrence.frequency).label}</div>
    <p className="mt-1 truncate text-xs font-semibold">{occurrence.planName}</p><p className="truncate text-[10px] text-slate-600">{occurrence.customerName}</p>
    <p className="mt-1 text-[10px] text-slate-600">{formatCalendarDate(occurrence.date)}{occurrence.completedAt ? " · Completed" : ""}</p>
    {occurrence.jobNumber ? <p className="mt-1 text-[10px] text-teal-900">Job #{occurrence.jobNumber} · {occurrence.jobStatus}{occurrence.jobScheduledDate !== occurrence.date ? ` · Scheduled ${formatCalendarDate(occurrence.jobScheduledDate)}` : ""}</p> : null}
    {occurrence.generated && !occurrence.jobId ? <p className="mt-1 text-[10px] text-slate-600">Generated job archived</p> : null}
    <div className="mt-2 flex flex-wrap gap-1" data-calendar-action>
      <Button size="sm" variant="outline" className="calendar-maintenance-action" onClick={() => actions.openPlan(occurrence)}>Open Plan</Button>
      {occurrence.jobId ? <Button size="sm" variant="outline" className="calendar-maintenance-action" onClick={() => actions.openJob(occurrence)}>Open Job</Button> : !occurrence.completedAt && !occurrence.generated ? <Button size="sm" className="calendar-maintenance-action" disabled={busy || !occurrence.active} onClick={() => actions.generate(occurrence)}>Generate Job</Button> : null}
      {!occurrence.locked && occurrence.active ? <Button size="sm" variant="ghost" className="calendar-maintenance-action" disabled={busy} onClick={() => actions.reschedule(occurrence)}>Change date</Button> : null}
    </div>
  </article>;
}
