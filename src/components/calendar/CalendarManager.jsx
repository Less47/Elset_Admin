import { useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { statuses, statusThemes } from "@/lib/job-status";

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

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
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));

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

  const unscheduledJobs = useMemo(() => {
    return jobs
      .filter((job) => !toDateInputValue(job.scheduledDate) && job.status !== "Completed")
      .sort((a, b) => {
        const urgencyRank = { High: 0, Medium: 1, Low: 2 };
        return (urgencyRank[a.urgency] ?? 3) - (urgencyRank[b.urgency] ?? 3) || (a.jobNumber || 0) - (b.jobNumber || 0);
      });
  }, [jobs, toDateInputValue]);

  const calendarStats = useMemo(() => {
    const monthKey = getMonthKey(viewMonth);
    return {
      scheduledThisMonth: jobs.filter((job) => toDateInputValue(job.scheduledDate).startsWith(monthKey)).length,
      scheduledToday: jobs.filter((job) => toDateInputValue(job.scheduledDate) === toDateInputValue(new Date())).length,
      unscheduledOpen: unscheduledJobs.length,
    };
  }, [jobs, toDateInputValue, unscheduledJobs.length, viewMonth]);

  function selectDate(dateKey) {
    setSelectedDate(dateKey);
    const parsedDate = parseDateInputValue(dateKey);
    if (parsedDate) setViewMonth(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-slate-200 bg-white/90">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-slate-900">Optional scheduling</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep jobs unscheduled until you need a plan. Assign a date when it helps the morning run sheet.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-2xl border bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">This month</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{calendarStats.scheduledThisMonth}</p>
            </div>
            <div className="rounded-2xl border bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Today</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{calendarStats.scheduledToday}</p>
            </div>
            <div className="rounded-2xl border bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Unscheduled</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{calendarStats.unscheduledOpen}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden rounded-3xl border-slate-200">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">{monthLabel}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Click a day to review or schedule work.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-lg" onClick={() => setViewMonth((prev) => addMonths(prev, -1))}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => {
                    const today = new Date();
                    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                    setSelectedDate(toDateInputValue(today));
                  }}
                >
                  Today
                </Button>
                <Button variant="outline" className="rounded-lg" onClick={() => setViewMonth((prev) => addMonths(prev, 1))}>
                  Next
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="border-r border-slate-200 px-2 py-3 last:border-r-0">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 bg-slate-200">
              {calendarDays.map((day) => {
                const dayJobs = scheduledJobsByDate.get(day.key) || [];
                const isSelected = selectedDate === day.key;
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => setSelectedDate(day.key)}
                    className={`min-h-32 border-r border-b border-slate-200 bg-white p-2 text-left transition hover:bg-slate-50 ${
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

        <div className="grid gap-6">
          <Card className="rounded-3xl border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg">Selected Day</CardTitle>
              <p className="text-sm text-muted-foreground">{selectedDateLabel}</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField label="Jump to date">
                <Input type="date" value={selectedDate} onChange={(e) => selectDate(e.target.value)} />
              </FormField>

              {selectedDateJobs.length === 0 ? (
                <EmptyState title="No jobs scheduled" text="Assign unscheduled jobs to this date when you are ready to plan the day." />
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
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg">Unscheduled Jobs</CardTitle>
              <p className="text-sm text-muted-foreground">Open jobs can stay here until you choose a day.</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {unscheduledJobs.length === 0 ? (
                <EmptyState title="No unscheduled open jobs" text="Open jobs with no date will appear here." />
              ) : (
                unscheduledJobs.map((job) => (
                  <div key={job.id} className="rounded-2xl border bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
                        <p className="truncate font-semibold text-slate-900">{job.customerName}</p>
                        <p className="mt-1 text-sm text-slate-600">{job.title}</p>
                      </div>
                      <Badge className={job.urgency === "High" ? "bg-rose-100 text-rose-800" : job.urgency === "Medium" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}>
                        {job.urgency}
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" className="rounded-lg" onClick={() => onOpenJob(job)}>
                        View
                      </Button>
                      <Button size="sm" className="rounded-lg" disabled={!selectedDate} onClick={() => onScheduleJob(job.id, selectedDate)}>
                        Schedule Here
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
