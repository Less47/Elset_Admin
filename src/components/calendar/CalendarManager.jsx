import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { statuses, statusThemes } from "@/lib/job-status";

export default function CalendarManager({
  jobs,
  onOpenJob,
  onScheduleJob,
  addMonths,
  getCalendarDays,
  parseDateInputValue,
  toDateInputValue,
}) {
  const [viewMonth, setViewMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState("");
  const [isDayPanelOpen, setIsDayPanelOpen] = useState(false);

  const calendarDays = useMemo(() => getCalendarDays(viewMonth), [getCalendarDays, viewMonth]);
  const selectedDateObject = parseDateInputValue(selectedDate) || new Date();
  const selectedDateLabel = selectedDate
    ? selectedDateObject.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "No date selected";
  const monthLabel = viewMonth.toLocaleDateString("en-AU", { month: "long", year: "numeric" });

  const scheduledJobsByDate = useMemo(() => {
    return jobs.reduce((map, job) => {
      const dateKey = toDateInputValue(job.scheduledDate);
      if (!dateKey) return map;
      const current = map.get(dateKey) || [];
      map.set(dateKey, [...current, job]);
      return map;
    }, new Map());
  }, [jobs, toDateInputValue]);

  const selectedDateJobs = useMemo(() => {
    return [...(scheduledJobsByDate.get(selectedDate) || [])].sort((a, b) => {
      const statusDiff = statuses.indexOf(a.status) - statuses.indexOf(b.status);
      if (statusDiff !== 0) return statusDiff;
      return (a.jobNumber || 0) - (b.jobNumber || 0);
    });
  }, [scheduledJobsByDate, selectedDate]);

  function selectDate(dateKey) {
    setSelectedDate(dateKey);
    setIsDayPanelOpen(true);
    const parsedDate = parseDateInputValue(dateKey);
    if (parsedDate) setViewMonth(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
  }

  return (
    <div className="space-y-4">
      <div className="floating-page-toolbar px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-2xl font-semibold leading-8 text-slate-950">{monthLabel}</CardTitle>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setViewMonth((prev) => addMonths(prev, -1))}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                const today = new Date();
                setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                selectDate(toDateInputValue(today));
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setViewMonth((prev) => addMonths(prev, 1))}>
              Next
            </Button>
          </div>
        </div>
      </div>
      <div>
        <Card className="gap-0 overflow-hidden rounded-xl border-slate-900 py-0">
          <CardContent className="p-0">
            <div className="grid grid-cols-7 gap-px border-b border-slate-900 bg-slate-900 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="bg-slate-100 px-2 py-2">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-slate-900">
              {calendarDays.map((day) => {
                const dayJobs = scheduledJobsByDate.get(day.key) || [];
                const isSelected = selectedDate === day.key;
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => selectDate(day.key)}
                    className={`min-h-32 bg-white p-2 text-left transition hover:bg-slate-50 ${
                      !day.inMonth ? "text-slate-400" : "text-slate-900"
                    } ${isSelected ? "ring-2 ring-inset ring-slate-900" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${day.isToday ? "bg-slate-900 text-white" : ""}`}>
                        {day.date.getDate()}
                      </span>
                      {dayJobs.length > 0 ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{dayJobs.length}</span>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-1">
                      {dayJobs.slice(0, 3).map((job) => (
                        <div key={job.id} className="truncate rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                          #{job.jobNumber} {job.customerName}
                        </div>
                      ))}
                      {dayJobs.length > 3 ? (
                        <p className="px-1 text-xs text-slate-500">+{dayJobs.length - 3} more</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className={`fixed inset-0 z-40 transition ${isDayPanelOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
        <button
          type="button"
          className={`absolute inset-0 bg-slate-950/20 transition-opacity ${isDayPanelOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setIsDayPanelOpen(false)}
          aria-label="Close selected day panel"
        />
        <aside
          className={`absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
            isDayPanelOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Selected Day</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{selectedDateLabel}</h2>
            </div>
            <Button type="button" size="icon" variant="ghost" className="shrink-0 rounded-xl" onClick={() => setIsDayPanelOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid gap-4">
              {selectedDateJobs.length === 0 ? (
                <EmptyState title="No jobs scheduled" text="Jobs scheduled to this date will appear here." />
              ) : (
                selectedDateJobs.map((job) => (
                  <div key={job.id} className="rounded-2xl border bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
                        <p className="truncate font-semibold text-slate-900">{job.customerName}</p>
                        <p className="mt-1 text-sm text-slate-600">{job.title}</p>
                      </div>
                      <Badge className={(statusThemes[job.status] || statusThemes["To Do"]).badge}>{job.status}</Badge>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600">{job.jobAddress}</p>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" className="rounded-lg" onClick={() => onScheduleJob(job.id, "")}>
                        Clear Date
                      </Button>
                      <Button size="sm" className="rounded-lg" onClick={() => onOpenJob(job)}>
                        View Job
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
        </div>
    </div>
  );
}
