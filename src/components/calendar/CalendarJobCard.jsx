import { CalendarDays, CalendarX2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { statusThemes } from "@/lib/job-status";
import { formatStreetAndSuburb } from "@/components/service-board/service-board-utils";
import { formatCalendarDate } from "./calendar-utils";

const urgencyTone = {
  Low: "bg-slate-100 text-slate-700",
  Medium: "bg-amber-100 text-amber-800",
  High: "bg-rose-100 text-rose-800",
};

export default function CalendarJobCard({ job, onOpenJob, onSchedule, onUnschedule, dragApi, draggable = true, busy = false }) {
  const theme = statusThemes[job.status] || statusThemes["To Do"];
  return (
    <article
      data-calendar-queue-job={job.id}
      className={`calendar-queue-card min-w-0 rounded-xl border ${theme.card} ${dragApi.drag?.job.id === job.id ? "opacity-50" : ""}`}
      {...dragApi.getDragProps(job, draggable)}
      aria-busy={busy}
    >
      <button
        type="button"
        className="calendar-job-open block w-full min-w-0 rounded-t-xl p-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={(event) => { if (dragApi.allowClick(event)) onOpenJob(job); }}
        aria-label={`Open Job #${job.jobNumber}: ${job.customerName}`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Job #{job.jobNumber}</span>
          {draggable ? <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" /> : null}
        </span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-950">{job.customerName}</span>
        <span className="block truncate text-xs text-slate-700">{job.title || job.description || "Untitled job"}</span>
        <span className="mt-1 block truncate text-[11px] text-slate-600">{formatStreetAndSuburb(job.jobAddress) || "Site not set"}</span>
        <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-700">
          <span>{formatCalendarDate(job.scheduledDate)}</span>
          {job.urgency ? <Badge className={`h-auto px-1.5 py-0 text-[10px] ${urgencyTone[job.urgency] || urgencyTone.Low}`}>{job.urgency}</Badge> : null}
        </span>
        {job.assignedTechnicianName ? <span className="mt-1 block truncate text-[11px] text-slate-600">{job.assignedTechnicianName}</span> : null}
      </button>
      <div className="flex gap-1 border-t border-black/10 px-2 py-1.5" data-calendar-action>
        <Button type="button" size="sm" variant="outline" className="h-11 min-w-0 flex-1 bg-white/75 px-2 text-xs" disabled={busy} onClick={(event) => onSchedule(job, event.currentTarget)}>
          <CalendarDays className="h-3.5 w-3.5" /> {job.scheduledDate ? "Reschedule" : "Schedule"}
        </Button>
        {job.scheduledDate ? (
          <Button type="button" variant="outline" className="h-11 w-11 shrink-0 bg-white/75 p-0" disabled={busy} onClick={() => onUnschedule(job)} aria-label={`Remove scheduled date for Job #${job.jobNumber}`} title="Remove scheduled date">
            <CalendarX2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function CalendarJobChip({ job, onOpenJob, dragApi }) {
  return (
    <button
      type="button"
      data-calendar-job={job.id}
      className={`calendar-job-chip block w-full min-w-0 truncate rounded border px-1.5 text-left text-[11px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${(statusThemes[job.status] || statusThemes["To Do"]).card} ${dragApi.drag?.job.id === job.id ? "opacity-50" : ""}`}
      {...dragApi.getDragProps(job)}
      onClick={(event) => { if (dragApi.allowClick(event)) onOpenJob(job); }}
      aria-label={`Open Job #${job.jobNumber}: ${job.customerName}, ${job.title}, ${job.status}`}
      title={`Job #${job.jobNumber} · ${job.customerName}\n${job.title}\n${job.status}\nDrag to another date to reschedule.`}
    >
      <span className="calendar-chip-number font-semibold">#{job.jobNumber}</span><span className="calendar-chip-separator"> · </span><span className="calendar-chip-customer">{job.customerName}</span>
    </button>
  );
}
