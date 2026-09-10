import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Wrench } from "lucide-react";
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
    <section className="calendar-mini min-w-0" aria-label="Date navigator">
      <div className="flex items-center justify-between gap-1">
        <Button type="button" variant="ghost" className="calendar-mini-arrow w-6 min-w-6 p-0" onClick={() => onMonthChange(-1)} aria-label="Previous month in date navigator"><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="min-w-0 text-center text-xs font-semibold" data-mini-month>{monthLabel}</h2>
        <Button type="button" variant="ghost" className="calendar-mini-arrow w-6 min-w-6 p-0" onClick={() => onMonthChange(1)} aria-label="Next month in date navigator"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="mt-1 grid grid-cols-7 text-center text-[10px] text-muted-foreground" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day[0]}</span>)}</div>
      <div className="mt-0.5 grid grid-cols-7">
        {days.map((day) => (
          <button
            type="button" key={day.key} data-mini-date={day.key}
            aria-label={formatCalendarDate(day.key, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            aria-pressed={day.key === selectedDate}
            aria-current={day.isToday ? "date" : undefined}
            tabIndex={day.key === selectedDate ? 0 : -1}
            className={`calendar-mini-date rounded-md text-[11px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${day.isToday ? "ring-1 ring-status-warning-border" : ""} ${day.key === selectedDate ? "bg-primary font-semibold text-primary-foreground" : day.isToday ? "bg-status-warning-surface font-semibold text-status-warning" : day.inMonth ? "text-text-secondary hover:bg-surface-raised" : "text-muted-foreground"}`}
            onClick={() => onSelect(day.key)} onKeyDown={(event) => moveFocus(event, day)}
          >{day.date.getDate()}</button>
        ))}
      </div>
      <Button type="button" variant="outline" className="calendar-mini-today mt-1 w-full text-xs" onClick={onToday} aria-label="Go to today in date navigator">Today</Button>
    </section>
  );
}

export function MainCalendar({ days, monthLabel, selectedDate, jobsByDate, dragApi, onOpenJob, onOpenDay, inlineDayDetails = false }) {
  const gridRef = useRef(null);
  const [eventSlots, setEventSlots] = useState(6);
  useEffect(() => {
    const cell = gridRef.current?.firstElementChild;
    if (!cell) return undefined;
    // All six weeks share a row height. Reserve a slot for overflow only when
    // needed, and remeasure on viewport, pointer-size or toolbar-height changes.
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(cell);
      const label = cell.querySelector(".calendar-day-select");
      const stack = cell.querySelector(".calendar-day-jobs");
      const gap = parseFloat(getComputedStyle(stack).rowGap) || 0;
      const rowHeight = parseFloat(style.getPropertyValue("--calendar-event-height"));
      const available = cell.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - label.getBoundingClientRect().height - parseFloat(getComputedStyle(stack).marginTop);
      setEventSlots(Math.max(1, Math.floor((available + gap) / (rowHeight + gap))));
    });
    observer.observe(cell);
    return () => observer.disconnect();
  }, [days]);
  return (
    <section className="calendar-main min-w-0" aria-label={`${monthLabel} calendar`} data-calendar-main>
      <div className="calendar-weekdays grid grid-cols-7 border-b bg-muted text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {weekdays.map((day) => <div key={day}>{day}</div>)}
      </div>
      <div ref={gridRef} className="calendar-month-grid grid grid-cols-7" data-calendar-dragging={Boolean(dragApi.drag) || undefined} {...dragApi.dropProps}>
        {days.map((day) => {
          const jobs = jobsByDate.get(day.key) || [];
          const maintenance = jobs.filter((entry) => entry.kind === "maintenance");
          const visibleLimit = jobs.length > eventSlots ? Math.max(1, eventSlots - 1) : eventSlots;
          const target = dragApi.drag?.target === day.key;
          return (
            <div
              key={day.key} data-calendar-date={day.key} data-calendar-drop-date={day.key}
              data-drop-active={target || undefined} data-selected={selectedDate === day.key || undefined}
              className={`calendar-day min-w-0 border-b border-r ${day.inMonth ? "bg-card/70" : "bg-muted"} ${selectedDate === day.key ? "calendar-day-selected" : ""} ${target ? "calendar-day-target" : ""}`}
            >
              <button
                type="button" className="calendar-day-open outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                onClick={(event) => { if (dragApi.allowClick(event)) onOpenDay(day.key, event.currentTarget); }}
                aria-pressed={selectedDate === day.key} aria-current={day.isToday ? "date" : undefined}
                aria-haspopup={inlineDayDetails ? undefined : "dialog"}
                aria-label={`${formatCalendarDate(day.key, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
              />
              <div className="calendar-day-select flex w-full min-w-0 items-start justify-between text-left" aria-hidden="true">
                <span className={`calendar-day-number flex shrink-0 items-center justify-center rounded-full font-semibold ${day.isToday ? "bg-status-warning-surface text-status-warning ring-1 ring-status-warning-border" : day.inMonth ? "text-foreground" : "text-muted-foreground"}`}>{day.date.getDate()}</span>
                <span className="calendar-mobile-count mt-1 text-[10px] text-muted-foreground">{jobs.length || ""}</span>
              </div>
              <div className="calendar-day-jobs min-w-0">
                {jobs.slice(0, visibleLimit).map((job) => <CalendarJobChip key={job.id} job={job} onOpenJob={onOpenJob} dragApi={dragApi} />)}
                {jobs.length > visibleLimit ? <button type="button" className="calendar-more min-w-0 truncate rounded px-1 text-left text-[11px] font-medium text-status-info outline-none hover:bg-status-info-surface focus-visible:ring-3 focus-visible:ring-ring/50" onClick={(event) => { if (dragApi.allowClick(event)) onOpenDay(day.key, event.currentTarget); }}>+ {jobs.length - visibleLimit} more</button> : null}
              </div>
              {maintenance.length ? <button type="button" className="calendar-mobile-maintenance" data-calendar-maintenance={maintenance[0].key}
                {...dragApi.getDragProps(maintenance[0], maintenance.length === 1 && !maintenance[0].locked && maintenance[0].active)}
                aria-label={maintenance.length === 1 ? `${maintenance[0].planName} · Maintenance` : `${maintenance.length} maintenance visits`}
                onClick={(event) => { if (dragApi.allowClick(event)) { if (maintenance.length === 1) onOpenJob(maintenance[0]); else onOpenDay(day.key, event.currentTarget); } }}>
                <Wrench className="h-3 w-3" aria-hidden="true" /><span>{maintenance.length}</span>
              </button> : null}
              {jobs.length ? <div className="calendar-mobile-dots mt-1 flex justify-center gap-1" aria-hidden="true">{jobs.slice(0, 3).map((job) => <span key={job.id} className={`h-1.5 w-1.5 rounded-full ${job.status === "To Do" ? "bg-amber-400" : job.status === "In Progress" ? "bg-sky-500" : "bg-emerald-500"}`} />)}</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
