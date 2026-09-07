import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { statusThemes } from "@/lib/job-status";
import { formatCalendarDate, isCalendarDate } from "./calendar-utils";

const jobCount = (count) => `${count} ${count === 1 ? "job" : "jobs"}`;

export default function CalendarBulkReschedule({ sourceDate, entries, jobsByDate, busy, result, error, onMove, onCancel, onReview }) {
  const [selected, setSelected] = useState(() => new Set(entries.map(({ job }) => job.id)));
  const [destination, setDestination] = useState("");
  const allSelected = entries.length > 0 && selected.size === entries.length;
  const validDestination = isCalendarDate(destination) && destination !== sourceDate;
  const existingCount = (jobsByDate.get(destination) || []).length;

  return (
    <form className="calendar-bulk-form flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={(event) => {
      event.preventDefault();
      if (!busy && !result && selected.size && validDestination) onMove(entries.filter(({ job }) => selected.has(job.id)), destination);
    }}>
      <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
        {result ? (
          <div className="space-y-3" data-bulk-result>
            <p role="status" className="font-semibold">{result.succeeded.length} of {result.succeeded.length + result.failed.length} jobs moved.</p>
            {result.succeeded.length ? <p className="text-xs text-slate-600">Moved: {result.succeeded.map((entry) => `#${entry.jobNumber}`).join(", ")}</p> : null}
            <ul className="space-y-2" aria-label="Jobs not moved">
              {result.failed.map((entry) => <li key={entry.id} className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900"><strong>Job #{entry.jobNumber || entries.find(({ job }) => job.id === entry.id)?.job.jobNumber || entry.id}</strong><p className="mt-1">{entry.error}</p></li>)}
            </ul>
            <Button type="button" variant="outline" className="min-h-11 w-full text-xs" disabled={busy} onClick={() => onReview(result.failed.map((entry) => entry.id))}>Review failed jobs</Button>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center justify-between gap-2 border-b pb-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-xs font-semibold">
                <Checkbox checked={allSelected ? true : selected.size ? "indeterminate" : false} disabled={busy || !entries.length} onCheckedChange={(checked) => setSelected(new Set(checked ? entries.map(({ job }) => job.id) : []))} />
                Select all {entries.length}
              </label>
              <Button type="button" variant="ghost" className="min-h-11 text-xs" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Clear all</Button>
            </div>
            <p className="text-xs text-sky-800" role="status" aria-live="polite">{jobCount(selected.size)} selected</p>
            {entries.length ? <div className="grid min-w-0 gap-2" aria-label="Eligible jobs">
              {entries.map(({ job }) => <label key={job.id} className={`flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-2.5 ${statusThemes[job.status]?.card || "bg-slate-50"}`}>
                <Checkbox className="mt-1" aria-label={`Select Job #${job.jobNumber}`} checked={selected.has(job.id)} disabled={busy} onCheckedChange={(checked) => setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(job.id); else next.delete(job.id);
                  return next;
                })} />
                <span className="block min-w-0 flex-1 text-xs">
                  <span className="flex flex-wrap justify-between gap-1"><strong>Job #{job.jobNumber}</strong><span className="text-[11px] text-slate-700">{job.status}{job.urgency ? ` · ${job.urgency}` : ""}</span></span>
                  <span className="mt-1 block truncate font-semibold" title={job.customerName}>{job.customerName}</span>
                  <span className="block truncate text-slate-700" title={job.title}>{job.title || job.description || "Untitled job"}</span>
                  {job.assignedTechnicianName ? <span className="mt-1 block truncate text-[11px] text-slate-600">{job.assignedTechnicianName}</span> : null}
                </span>
              </label>)}
            </div> : <p className="text-sm text-slate-600">No active jobs available to reschedule.</p>}
            <div className="space-y-1.5 border-t pt-3">
              <label htmlFor="calendar-bulk-date" className="block text-xs font-semibold">Move selected jobs to</label>
              <Input id="calendar-bulk-date" type="date" required value={destination} disabled={busy} className="h-11 w-full min-w-0" onChange={(event) => setDestination(event.target.value)} aria-describedby="calendar-bulk-destination" />
              <p id="calendar-bulk-destination" className="text-xs text-slate-600">{destination === sourceDate ? "Choose a different date; these jobs are already scheduled on this day." : isCalendarDate(destination) ? formatCalendarDate(destination, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Choose the destination day, month and year."}</p>
            </div>
            {validDestination ? <section className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs" aria-label="Destination workload" aria-live="polite">
              <p className="mb-2 font-semibold text-sky-900">Destination workload</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1.5">
                <dt>Currently scheduled</dt><dd>{jobCount(existingCount)}</dd>
                <dt>Moving</dt><dd>{jobCount(selected.size)}</dd>
                <dt className="font-semibold">After move</dt><dd className="font-semibold">{jobCount(existingCount + selected.size)}</dd>
              </dl>
            </section> : null}
          </>
        )}
      </div>
      <footer className="calendar-bulk-footer flex shrink-0 justify-end gap-2 border-t bg-white p-3">
        <Button type="button" variant="outline" className="h-11 text-xs" disabled={busy} onClick={onCancel}>{result ? "Back to day" : "Cancel"}</Button>
        {!result ? <Button type="submit" className="h-11 px-4 text-xs" disabled={busy || Boolean(error) || !selected.size || !validDestination} aria-busy={busy}>{busy ? "Moving jobs…" : `Move ${jobCount(selected.size)}`}</Button> : null}
        {error ? <Button type="button" className="h-11 text-xs" disabled={busy} onClick={() => onReview()}>Review day</Button> : null}
      </footer>
    </form>
  );
}
