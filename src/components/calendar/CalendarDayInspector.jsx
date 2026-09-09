import { useEffect, useLayoutEffect } from "react";
import { CalendarDays, GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { statusThemes } from "@/lib/job-status";
import { formatCalendarDate } from "./calendar-utils";

export default function CalendarDayInspector({ date, jobs, eligibleCount, dragApi, busy, active, headingRef, notice, onClose, onOpenJob, onSchedule, onRescheduleDay }) {
  const fullDate = formatCalendarDate(date, { weekday: "long", day: "numeric", month: "long" });
  useLayoutEffect(() => {
    if (active) headingRef.current?.focus({ preventScroll: true });
  }, [active, headingRef]);
  useEffect(() => {
    if (!active) return undefined;
    function closeOnEscape(event) {
      // Escape cancels an active drag first; modal scheduling owns its own keys.
      if (event.key !== "Escape" || event.defaultPrevented || dragApi.drag) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [active, dragApi.drag, onClose]);

  return (
    <section className="calendar-day-inspector" id="calendar-day-inspector" aria-label={fullDate} data-calendar-day-inspector data-inspector-date={date}>
      <header className="calendar-inspector-header">
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} aria-label={fullDate} className="truncate font-semibold outline-none">{formatCalendarDate(date, { weekday: "short", day: "numeric", month: "short" })}</h2>
          <p className="text-[10px] text-slate-600" role="status">{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</p>
        </div>
        <Button type="button" variant="ghost" className="calendar-inspector-action shrink-0" aria-label="Close calendar panel" title="Back to mini calendar" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </header>
      <div className="calendar-inspector-jobs" data-calendar-day-detail>
        {jobs.length ? jobs.map((job) => {
          const theme = statusThemes[job.status] || statusThemes["To Do"];
          const time = typeof job.scheduledTime === "string" ? job.scheduledTime.trim() : "";
          return (
            <article key={job.id} data-calendar-inspector-job={job.id} className={`calendar-inspector-job ${theme.card} ${dragApi.drag?.job.id === job.id ? "opacity-50" : ""}`} aria-busy={busy} {...dragApi.getDragProps(job)}>
              <button type="button" className="calendar-inspector-job-open outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`Open Job #${job.jobNumber}: ${job.customerName}`} title={`Job #${job.jobNumber}${time ? ` · ${time}` : ""}\n${job.customerName}\n${job.title || ""}`} onClick={(event) => { if (dragApi.allowClick(event)) onOpenJob(job); }}>
                <span className="flex min-w-0 items-center justify-between gap-1">
                  <span className="truncate text-[10px]"><strong>#{job.jobNumber}</strong>{time ? <span data-inspector-time> · {time}</span> : null}</span>
                  <GripVertical className="calendar-inspector-grip h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                </span>
                <span className="calendar-inspector-customer block truncate font-semibold">{job.customerName}</span>
                {job.title ? <span className="block truncate text-[10px] text-slate-600">{job.title}</span> : null}
              </button>
              <div className="calendar-inspector-job-actions" data-calendar-action>
                <span className={`truncate rounded-sm px-1 text-[10px] ${theme.badge}`}>{job.status}</span>
                <Button type="button" variant="ghost" className="calendar-inspector-action shrink-0" disabled={busy} aria-label={`Reschedule Job #${job.jobNumber}`} title="Reschedule" onClick={(event) => onSchedule(job, event.currentTarget)}><CalendarDays className="h-3.5 w-3.5" /></Button>
              </div>
            </article>
          );
        }) : <p className="p-1.5 text-[11px] text-slate-600">No jobs scheduled.</p>}
      </div>
      {notice}
      <footer className="calendar-inspector-footer">
        {eligibleCount ? <Button type="button" variant="outline" className="calendar-inspector-bulk w-full text-sky-900" disabled={busy} onClick={onRescheduleDay}>Reschedule day</Button> : <p className="text-[10px] text-slate-600">No active jobs available to reschedule.</p>}
      </footer>
    </section>
  );
}
