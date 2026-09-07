import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarJobChip } from "./CalendarJobCard";
import { formatCalendarDate, weekdays } from "./calendar-utils";

export function MiniCalendar({ days, monthLabel, selectedDate, onSelect, onMonthChange, onToday }) {
  function moveFocus(event, day) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -day.date.getDay(), End: 6 - day.date.getDay() };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const index = days.findIndex((item) => item.key === day.key);
    const target = days[index + offsets[event.key]];
    if (target) {
      const navigator = event.currentTarget.closest(".calendar-mini");
      onSelect(target.key);
      window.requestAnimationFrame(() => navigator?.querySelector(`[data-mini-date="${target.key}"]`)?.focus());
    }
  }
  return (
    <section className="calendar-mini min-w-0 rounded-xl border bg-white/95 p-2.5" aria-label="Date navigator">
      <div className="flex items-center justify-between gap-1">
        <Button type="button" variant="ghost" className="h-9 min-h-9 w-7 min-w-7 p-0" onClick={() => onMonthChange(-1)} aria-label="Previous month in date navigator"><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="min-w-0 text-center text-xs font-semibold" data-mini-month>{monthLabel}</h2>
        <Button type="button" variant="ghost" className="h-9 min-h-9 w-7 min-w-7 p-0" onClick={() => onMonthChange(1)} aria-label="Next month in date navigator"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[10px] text-slate-500" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day[0]}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-y-1">
        {days.map((day) => (
          <button
            type="button" key={day.key} data-mini-date={day.key}
            aria-label={formatCalendarDate(day.key, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            aria-pressed={day.key === selectedDate}
            aria-current={day.isToday ? "date" : undefined}
            tabIndex={day.key === selectedDate ? 0 : -1}
            className={`calendar-mini-date rounded-md text-[11px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${day.isToday ? "ring-1 ring-orange-400" : ""} ${day.key === selectedDate ? "bg-slate-900 font-semibold text-white" : day.isToday ? "bg-orange-100 font-semibold text-orange-900" : day.inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-400"}`}
            onClick={() => onSelect(day.key)} onKeyDown={(event) => moveFocus(event, day)}
          >{day.date.getDate()}</button>
        ))}
      </div>
      <Button type="button" variant="outline" className="mt-3 h-11 w-full text-xs" onClick={onToday} aria-label="Go to today in date navigator">Today</Button>
    </section>
  );
}

export function MainCalendar({ days, monthLabel, selectedDate, jobsByDate, dragApi, onOpenJob, onOpenDay, coarsePointer }) {
  const visibleLimit = coarsePointer ? 1 : 2;
  return (
    <section className="calendar-main min-w-0 overflow-hidden rounded-xl border bg-white/95" aria-label={`${monthLabel} calendar`} data-calendar-main>
      <div className="calendar-weekdays grid grid-cols-7 border-b bg-slate-50 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {weekdays.map((day) => <div key={day} className="py-2">{day}</div>)}
      </div>
      <div className="calendar-month-grid grid grid-cols-7" data-calendar-dragging={Boolean(dragApi.drag) || undefined} {...dragApi.dropProps}>
        {days.map((day) => {
          const jobs = jobsByDate.get(day.key) || [];
          const target = dragApi.drag?.target === day.key;
          return (
            <div
              key={day.key} data-calendar-date={day.key} data-calendar-drop-date={day.key}
              data-drop-active={target || undefined} data-selected={selectedDate === day.key || undefined}
              className={`calendar-day min-w-0 border-b border-r p-1 ${day.inMonth ? "bg-white/70" : "bg-slate-200"} ${selectedDate === day.key ? "calendar-day-selected" : ""} ${target ? "calendar-day-target" : ""}`}
            >
              <button
                type="button" className="calendar-day-open outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                onClick={(event) => { if (dragApi.allowClick(event)) onOpenDay(day.key, event.currentTarget); }}
                aria-pressed={selectedDate === day.key} aria-current={day.isToday ? "date" : undefined}
                aria-haspopup="dialog"
                aria-label={`${formatCalendarDate(day.key, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
              />
              <div className="calendar-day-select flex w-full min-w-0 items-start justify-between rounded-md p-0.5 text-left" aria-hidden="true">
                <span className={`calendar-day-number flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${day.isToday ? "bg-orange-100 text-orange-900 ring-1 ring-orange-300" : day.inMonth ? "text-slate-800" : "text-slate-500"}`}>{day.date.getDate()}</span>
                <span className="calendar-mobile-count mt-1 text-[10px] text-slate-500">{jobs.length || ""}</span>
              </div>
              <div className="calendar-day-jobs grid min-w-0 gap-1">
                {jobs.slice(0, visibleLimit).map((job) => <CalendarJobChip key={job.id} job={job} onOpenJob={onOpenJob} dragApi={dragApi} />)}
                {jobs.length > visibleLimit ? <button type="button" className="calendar-more min-w-0 truncate rounded px-1 text-left text-[11px] font-medium text-sky-800 outline-none hover:bg-sky-50 focus-visible:ring-3 focus-visible:ring-ring/50" onClick={(event) => { if (dragApi.allowClick(event)) onOpenDay(day.key, event.currentTarget); }}>+ {jobs.length - visibleLimit} more</button> : null}
              </div>
              {jobs.length ? <div className="calendar-mobile-dots mt-1 flex justify-center gap-1" aria-hidden="true">{jobs.slice(0, 3).map((job) => <span key={job.id} className={`h-1.5 w-1.5 rounded-full ${job.status === "To Do" ? "bg-amber-400" : job.status === "In Progress" ? "bg-sky-500" : "bg-emerald-500"}`} />)}</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
