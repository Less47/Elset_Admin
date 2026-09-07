import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import CalendarJobCard from "./CalendarJobCard";
import { MainCalendar, MiniCalendar } from "./CalendarMonth";
import CalendarQueue from "./CalendarQueue";
import CalendarSheet from "./CalendarSheet";
import CalendarBulkReschedule from "./CalendarBulkReschedule";
import { filterQueueJobs, formatCalendarDate, groupCalendarJobs, isCalendarDate, queueStatuses } from "./calendar-utils";
import { useCalendarDrag } from "./useCalendarDrag";
import "./Calendar.css";

export default function CalendarManager({ jobs, onOpenJob, onScheduleJob, onPreviewDayReschedule, onRescheduleDayJobs, addMonths, getCalendarDays, parseDateInputValue, toDateInputValue }) {
  // The selected date is also the single source of truth for both displayed months.
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ urgency: "all", schedule: "all" });
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [panel, setPanel] = useState(null);
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState(null);
  const bulkPreviewRef = useRef(null);
  const savingRef = useRef(false);
  const returnFocusRef = useRef(null);
  const jobsTrigger = useRef(null);
  const todayTrigger = useRef(null);
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const persistentQueue = useMediaQuery("(min-width: 1024px) and (orientation: landscape)");

  const selectedDateObject = useMemo(() => parseDateInputValue(selectedDate), [parseDateInputValue, selectedDate]);
  const days = useMemo(() => getCalendarDays(selectedDateObject), [getCalendarDays, selectedDateObject]);
  const monthLabel = selectedDateObject.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const displayedJobs = useMemo(() => pending ? jobs.map((job) => job.id === pending.jobId ? { ...job, scheduledDate: pending.date } : job) : jobs, [jobs, pending]);
  const jobsByDate = useMemo(() => groupCalendarJobs(displayedJobs, toDateInputValue), [displayedJobs, toDateInputValue]);
  const queueJobs = useMemo(() => filterQueueJobs(displayedJobs, { search, ...filters }), [displayedJobs, search, filters]);
  const selectedJobs = jobsByDate.get(selectedDate) || [];
  const eligibleJobs = selectedJobs.filter((job) => queueStatuses.includes(job.status));
  const scheduleJob = panel?.type === "schedule" ? displayedJobs.find((job) => job.id === panel.jobId) : null;

  const saveSchedule = useCallback(async (jobId, date) => {
    if (savingRef.current) return false;
    if (date !== "" && !isCalendarDate(date)) {
      setError("Choose a valid calendar date.");
      return false;
    }
    const job = jobs.find((entry) => entry.id === jobId);
    if (!job) return false;
    setError("");
    if (toDateInputValue(job.scheduledDate) === date) {
      setPanel((current) => current?.type === "schedule" ? null : current);
      return true;
    }
    savingRef.current = true;
    setPending({ jobId, date });
    setAnnouncement(`Saving schedule for Job #${job.jobNumber}…`);
    let failureMessage = "Unable to update the job schedule. The original date has been restored. Try again.";
    try {
      const saved = await onScheduleJob(jobId, date, {
        recordOnly: true,
        onError: (failure) => { failureMessage = failure instanceof Error ? failure.message : String(failure); },
      });
      if (!saved) {
        setError(failureMessage);
        setAnnouncement(`Schedule unchanged for Job #${job.jobNumber}.`);
        return false;
      }
      setAnnouncement(date ? `Job #${job.jobNumber} scheduled for ${formatCalendarDate(date)}.` : `Scheduled date removed from Job #${job.jobNumber}.`);
      setPanel((current) => current?.type === "schedule" && current.jobId === jobId ? null : current);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : failureMessage);
      setAnnouncement(`Schedule unchanged for Job #${job.jobNumber}.`);
      return false;
    } finally {
      savingRef.current = false;
      setPending(null);
    }
  }, [jobs, onScheduleJob, toDateInputValue]);

  const dragApi = useCalendarDrag({ enabled: !pending && !bulkBusy, onDrop: saveSchedule });

  useEffect(() => {
    if (!bulkNotice?.undo) return;
    const timer = window.setTimeout(() => setBulkNotice((current) => current === bulkNotice ? { ...current, undo: null } : current), 15_000);
    return () => window.clearTimeout(timer);
  }, [bulkNotice]);

  useEffect(() => () => { bulkPreviewRef.current = null; }, []);

  async function openBulk(sourceDate = selectedDate, onlyIds) {
    if (savingRef.current) return;
    dragApi.cancelDrag();
    const loading = { type: "bulk", sourceDate, loading: true };
    bulkPreviewRef.current = loading;
    setPanel(loading);
    try {
      const preview = await onPreviewDayReschedule(sourceDate);
      if (bulkPreviewRef.current !== loading) return;
      bulkPreviewRef.current = null;
      preview.applyState();
      setPanel((current) => current === loading ? {
        ...loading, loading: false,
        entries: onlyIds ? preview.jobs.filter(({ job }) => onlyIds.includes(job.id)) : preview.jobs,
      } : current);
    } catch (failure) {
      if (bulkPreviewRef.current !== loading) return;
      bulkPreviewRef.current = null;
      setPanel((current) => current === loading ? { ...loading, loading: false, loadError: failure.message || "Unable to load this day." } : current);
    }
  }

  function backToDay(sourceDate) {
    bulkPreviewRef.current = null;
    setSelectedDate(sourceDate);
    setPanel({ type: "day" });
  }

  function changePanelOpen(open) {
    if (open || bulkBusy) return;
    bulkPreviewRef.current = null;
    setPanel(null);
  }

  async function moveDayJobs(entries, destination) {
    if (savingRef.current || panel?.type !== "bulk") return;
    const sourceDate = panel.sourceDate;
    savingRef.current = true;
    setBulkBusy(true);
    setBulkNotice(null);
    try {
      const result = await onRescheduleDayJobs({ sourceDate, scheduledDate: destination, jobs: entries.map(({ job, revision }) => ({ id: job.id, revision })) });
      const count = result.succeeded.length;
      const message = result.failed.length ? `${count} of ${entries.length} jobs moved to ${formatCalendarDate(destination)}.` : `${count} ${count === 1 ? "job" : "jobs"} moved to ${formatCalendarDate(destination, { weekday: "long", day: "numeric", month: "long" })}.`;
      setBulkNotice({ message, undo: count ? { sourceDate: destination, scheduledDate: sourceDate, jobs: result.succeeded.map(({ id, revision }) => ({ id, revision })) } : null });
      if (result.failed.length) setPanel((current) => ({ ...current, result }));
      else backToDay(sourceDate);
    } catch (failure) {
      setPanel((current) => ({ ...current, moveError: failure.message || "Unable to confirm the move. Review the day before trying again." }));
    } finally {
      savingRef.current = false;
      setBulkBusy(false);
    }
  }

  async function undoDayMove() {
    if (savingRef.current || !bulkNotice?.undo) return;
    const operation = bulkNotice.undo;
    bulkPreviewRef.current = null;
    savingRef.current = true;
    setBulkBusy(true);
    setBulkNotice({ message: "Restoring original dates…", undo: null });
    try {
      const result = await onRescheduleDayJobs(operation);
      setBulkNotice({ message: `${result.succeeded.length} of ${operation.jobs.length} jobs restored to ${formatCalendarDate(operation.scheduledDate)}.`, failed: result.failed, undo: null });
      if (panel?.type === "bulk") backToDay(operation.scheduledDate);
    } catch (failure) {
      setBulkNotice({ message: failure.message || "Unable to confirm Undo. Review the day to check the saved dates.", undo: null });
    } finally {
      savingRef.current = false;
      setBulkBusy(false);
    }
  }

  function openJob(job) {
    bulkPreviewRef.current = null;
    returnFocusRef.current = null;
    setPanel(null);
    dragApi.cancelDrag();
    onOpenJob(job);
  }

  function openSchedule(job, trigger) {
    bulkPreviewRef.current = null;
    returnFocusRef.current = trigger?.closest(".calendar-sheet") ? (persistentQueue ? todayTrigger.current : jobsTrigger.current) : trigger;
    setScheduleDraft(toDateInputValue(job.scheduledDate) || selectedDate);
    setError("");
    setPanel({ type: "schedule", jobId: job.id, action: job.scheduledDate ? "Reschedule" : "Schedule" });
  }

  function openDay(date, trigger) {
    bulkPreviewRef.current = null;
    setSelectedDate(date);
    returnFocusRef.current = trigger;
    setPanel({ type: "day" });
  }

  const miniProps = {
    days, monthLabel, selectedDate,
    onSelect: setSelectedDate,
    onMonthChange: (amount) => setSelectedDate(toDateInputValue(addMonths(selectedDateObject, amount))),
    onToday: () => setSelectedDate(toDateInputValue(new Date())),
  };
  const queueProps = {
    jobs: queueJobs, search, onSearch: setSearch, filters, onFilters: setFilters,
    onOpenJob: openJob, onSchedule: openSchedule,
    onUnschedule: (job) => saveSchedule(job.id, ""), dragApi, busy: Boolean(pending) || bulkBusy,
  };
  const panelTitle = panel?.type === "bulk" ? "Reschedule jobs" : panel?.type === "schedule" ? `${panel.action} Job #${scheduleJob?.jobNumber || ""}` : panel?.type === "day" ? formatCalendarDate(selectedDate, { weekday: "long", day: "numeric", month: "long" }) : "Scheduling jobs";
  const notice = bulkNotice ? <div className="shrink-0 space-y-1 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950" data-bulk-notice>
    <div className="flex items-center justify-between gap-2"><p role="status">{bulkNotice.message}</p>{bulkNotice.undo ? <Button type="button" variant="outline" className="h-11 shrink-0 text-xs" disabled={bulkBusy || Boolean(pending)} onClick={undoDayMove}>Undo</Button> : null}</div>
    {bulkNotice.failed?.length ? <ul aria-label="Jobs not restored">{bulkNotice.failed.map((entry) => <li key={entry.id}>Job #{entry.jobNumber || entry.id}: {entry.error}</li>)}</ul> : null}
  </div> : null;

  return (
    <div className="calendar-workspace min-w-0" data-calendar-workspace>
      <div className="calendar-layout">
        <div className="calendar-mini-pane"><MiniCalendar {...miniProps} /></div>
        <div className="calendar-center space-y-3">
          <header className="floating-page-toolbar calendar-toolbar min-w-0 p-2.5" data-calendar-toolbar>
            <h1 className="calendar-toolbar-title text-base font-semibold text-white sm:text-lg" data-calendar-month>{monthLabel}</h1>
            <div className="calendar-month-navigation flex items-center gap-1">
              <Button type="button" variant="outline" className="h-11 w-11 bg-white/95 p-0" aria-label="Previous" title="Previous month" onClick={() => miniProps.onMonthChange(-1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" ref={todayTrigger} variant="outline" className="h-11 bg-white/95 px-3 text-xs" onClick={miniProps.onToday}>Today</Button>
              <Button type="button" variant="outline" className="h-11 w-11 bg-white/95 p-0" aria-label="Next" title="Next month" onClick={() => miniProps.onMonthChange(1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="calendar-toolbar-actions flex items-center gap-2">
              <Button type="button" variant="outline" className="calendar-navigator-toggle h-11 bg-white/95 px-2 text-xs" aria-expanded={navigatorOpen} aria-controls="calendar-expanded-navigator" onClick={() => setNavigatorOpen((value) => !value)}><CalendarDays className="h-4 w-4" /> Dates</Button>
              <Button type="button" ref={jobsTrigger} className="calendar-jobs-toggle h-11 px-3 text-xs" onClick={() => { returnFocusRef.current = jobsTrigger.current; setPanel({ type: "jobs" }); }}><ListFilter className="h-4 w-4" /> Jobs <span className="rounded-full bg-white/25 px-1.5">{queueJobs.length}</span></Button>
            </div>
          </header>
          {navigatorOpen ? <div className="calendar-mini-expanded" id="calendar-expanded-navigator"><MiniCalendar {...miniProps} /></div> : null}
          {error ? <div className="flex items-start justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="alert"><span>{error}</span><Button type="button" variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label="Dismiss scheduling error" onClick={() => setError("")}><X className="h-4 w-4" /></Button></div> : null}
          {!panel ? notice : null}
          <MainCalendar days={days} monthLabel={monthLabel} selectedDate={selectedDate} jobsByDate={jobsByDate} dragApi={dragApi} onOpenJob={openJob} onOpenDay={openDay} coarsePointer={coarsePointer} />
          <p className="text-xs text-slate-700" role="status" aria-live="polite">{dragApi.drag?.target != null ? `Move Job #${dragApi.drag.job.jobNumber} to ${dragApi.drag.target ? formatCalendarDate(dragApi.drag.target) : "Unscheduled"}` : announcement}</p>
        </div>
        <div className="calendar-queue-pane">{persistentQueue ? <CalendarQueue {...queueProps} /> : null}</div>
      </div>

      <CalendarSheet open={Boolean(panel)} modal={panel?.type !== "day"} bulk={panel?.type === "bulk"} busy={bulkBusy} focusKey={panel?.type} notice={notice} onOpenChange={changePanelOpen} title={panelTitle} description={panel?.type === "bulk" ? `${formatCalendarDate(panel.sourceDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${panel.entries?.length ?? "Loading"} eligible jobs` : panel?.type === "schedule" ? "Change the scheduled date for this job." : panel?.type === "day" ? `${selectedJobs.length} scheduled ${selectedJobs.length === 1 ? "job" : "jobs"}` : "To Do and In Progress jobs"} error={error} returnFocusRef={returnFocusRef}>
        {panel?.type === "jobs" ? <CalendarQueue {...queueProps} inSheet /> : null}
        {panel?.type === "day" ? (
          <div className="grid gap-3" data-calendar-day-detail>
            {eligibleJobs.length ? <Button type="button" variant="outline" className="h-11 text-xs text-sky-900" disabled={Boolean(pending) || bulkBusy} onClick={() => openBulk()}>Reschedule day</Button> : <p className="text-xs text-slate-600">No active jobs available to reschedule.</p>}
            {selectedJobs.length ? selectedJobs.map((job) => <CalendarJobCard key={job.id} job={job} onOpenJob={openJob} onSchedule={openSchedule} onUnschedule={() => saveSchedule(job.id, "")} dragApi={dragApi} draggable={false} busy={Boolean(pending)} />) : <p className="py-2 text-sm text-slate-600">No jobs scheduled.</p>}
          </div>
        ) : null}
        {panel?.type === "bulk" ? panel.loading ? <p className="p-3 text-sm" role="status">Loading active jobs…</p> : panel.loadError ? <div className="space-y-3 p-3"><p role="alert">{panel.loadError}</p><Button type="button" className="h-11" onClick={() => openBulk(panel.sourceDate)}>Try again</Button><Button type="button" variant="outline" className="h-11" onClick={() => backToDay(panel.sourceDate)}>Back to day</Button></div> : <CalendarBulkReschedule sourceDate={panel.sourceDate} entries={panel.entries} jobsByDate={jobsByDate} busy={bulkBusy} result={panel.result} error={panel.moveError} onMove={moveDayJobs} onCancel={() => backToDay(panel.sourceDate)} onReview={(ids) => openBulk(panel.sourceDate, ids)} /> : null}
        {scheduleJob ? (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveSchedule(scheduleJob.id, scheduleDraft); }}>
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{scheduleJob.customerName}</p><p className="mt-1 break-words text-xs text-slate-600">{scheduleJob.title}</p></div>
            <div className="space-y-1.5"><label htmlFor="calendar-schedule-date" className="text-xs font-semibold">Scheduled date</label><Input id="calendar-schedule-date" type="date" className="h-11 w-full" value={scheduleDraft} onChange={(event) => setScheduleDraft(event.target.value)} required disabled={Boolean(pending)} /></div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              {scheduleJob.scheduledDate ? <Button type="button" variant="outline" className="h-11 text-xs" disabled={Boolean(pending)} onClick={() => saveSchedule(scheduleJob.id, "")}>Remove scheduled date</Button> : null}
              <Button type="submit" className="h-11 px-4 text-xs" disabled={Boolean(pending)} aria-busy={Boolean(pending)}>{pending ? "Saving…" : "Save date"}</Button>
            </div>
          </form>
        ) : null}
      </CalendarSheet>
      {dragApi.drag?.touch ? createPortal(<div className="calendar-drag-preview" style={{ left: Math.min(Math.max(8, dragApi.drag.x + 12), window.innerWidth - 202), top: Math.max(8, dragApi.drag.y - 80) }} aria-hidden="true"><p className="text-xs font-semibold text-slate-950">Moving Job #{dragApi.drag.job.jobNumber}</p><p className="truncate text-xs text-slate-600">{dragApi.drag.job.customerName}</p><p className="mt-1 text-xs font-medium text-sky-800">{dragApi.drag.target === null ? "Choose a destination" : dragApi.drag.target === "" ? "Remove scheduled date" : `Drop on ${formatCalendarDate(dragApi.drag.target)}`}</p></div>, document.body) : null}
    </div>
  );
}
