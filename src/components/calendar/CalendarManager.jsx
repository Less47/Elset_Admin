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
import CalendarDayInspector from "./CalendarDayInspector";
import CalendarMaintenanceItem from "./CalendarMaintenanceItem";
import MaintenanceDateChoice from "@/components/maintenance/MaintenanceDateChoice";
import { filterQueueJobs, formatCalendarDate, groupCalendarJobs, isCalendarDate, queueStatuses } from "./calendar-utils";
import { useCalendarDrag } from "./useCalendarDrag";
import "./Calendar.css";

export default function CalendarManager({ jobs, onOpenJob, onScheduleJob, onPreviewDayReschedule, onRescheduleDayJobs, onLoadMaintenanceOccurrences, onRescheduleMaintenance, onGenerateMaintenanceJob, onOpenPlan, addMonths, getCalendarDays, parseDateInputValue, toDateInputValue }) {
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
  const [hasMiniColumn, setHasMiniColumn] = useState(false);
  const [maintenanceRange, setMaintenanceRange] = useState({ from: "", to: "", items: [] });
  const [maintenanceMove, setMaintenanceMove] = useState(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceRefresh, setMaintenanceRefresh] = useState(0);
  const [maintenanceLoadError, setMaintenanceLoadError] = useState("");
  const bulkPreviewRef = useRef(null);
  const savingRef = useRef(false);
  const returnFocusRef = useRef(null);
  const suppressSheetRestoreRef = useRef(false);
  const workspaceRef = useRef(null);
  const miniPaneRef = useRef(null);
  const inspectorHeadingRef = useRef(null);
  const dayReturnFocusRef = useRef(null);
  const jobsTrigger = useRef(null);
  const todayTrigger = useRef(null);
  const workspaceDayPanel = useMediaQuery("(min-width: 768px)");
  const persistentQueue = useMediaQuery("(min-width: 1024px) and (orientation: landscape)");

  useEffect(() => {
    const pane = miniPaneRef.current;
    // CSS owns the column breakpoints, including the workspace container width.
    const observer = new ResizeObserver(() => setHasMiniColumn(pane.getClientRects().length > 0));
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const selectedDateObject = useMemo(() => parseDateInputValue(selectedDate), [parseDateInputValue, selectedDate]);
  const days = useMemo(() => getCalendarDays(selectedDateObject), [getCalendarDays, selectedDateObject]);
  const monthLabel = selectedDateObject.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const rangeFrom = days[0].key;
  const rangeTo = days[days.length - 1].key;
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    onLoadMaintenanceOccurrences(rangeFrom, rangeTo, controller.signal).then((items) => {
      if (!current) return;
      setMaintenanceRange({ from: rangeFrom, to: rangeTo, items });
      setMaintenanceLoadError("");
    }).catch((failure) => {
      if (current && failure.name !== "AbortError") setMaintenanceLoadError(failure.message || "Unable to load maintenance dates.");
    });
    return () => { current = false; controller.abort(); };
  }, [rangeFrom, rangeTo, onLoadMaintenanceOccurrences, maintenanceRefresh]);
  const occurrences = useMemo(() => maintenanceRange.from === rangeFrom && maintenanceRange.to === rangeTo ? maintenanceRange.items : [], [maintenanceRange, rangeFrom, rangeTo]);
  const displayedOccurrences = useMemo(() => occurrences.map((entry) => entry.key === maintenanceMove?.occurrence.key ? { ...entry, date: maintenanceMove.date, scheduledDate: maintenanceMove.date } : entry), [occurrences, maintenanceMove]);
  const displayedJobs = useMemo(() => pending ? jobs.map((job) => job.id === pending.jobId ? { ...job, scheduledDate: pending.date } : job) : jobs, [jobs, pending]);
  // Co-located linked work has one chip. A job moved to another day remains an
  // ordinary, independently scheduled job and retains its maintenance label.
  const jobsByDate = useMemo(() => groupCalendarJobs([
    ...displayedJobs.filter((job) => !displayedOccurrences.some((entry) => entry.jobId === job.id && entry.date === toDateInputValue(job.scheduledDate))),
    ...displayedOccurrences,
  ], toDateInputValue), [displayedJobs, displayedOccurrences, toDateInputValue]);
  const queueJobs = useMemo(() => filterQueueJobs(displayedJobs, { search, ...filters }), [displayedJobs, search, filters]);
  const scheduledJobsByDate = useMemo(() => groupCalendarJobs(displayedJobs, toDateInputValue), [displayedJobs, toDateInputValue]);
  const selectedJobs = jobsByDate.get(selectedDate) || [];
  const eligibleJobs = displayedJobs.filter((job) => toDateInputValue(job.scheduledDate) === selectedDate && queueStatuses.includes(job.status));
  const scheduleJob = panel?.type === "schedule" ? displayedJobs.find((job) => job.id === panel.jobId) : null;
  const selectedOccurrence = panel?.type === "maintenance" ? displayedOccurrences.find((entry) => entry.key === panel.occurrenceKey) : null;

  const proposeMaintenanceMove = useCallback((occurrence, date) => {
    if (savingRef.current || maintenanceMove || occurrence.date === date) return;
    if (!isCalendarDate(date)) { setError("Choose a valid maintenance date."); return; }
    if (occurrence.locked || !occurrence.active) { setError("Historical or completed maintenance cannot be moved."); return; }
    setError(""); setMaintenanceMove({ occurrence, date });
  }, [maintenanceMove]);

  async function commitMaintenanceMove(scope) {
    if (!maintenanceMove || savingRef.current) return;
    savingRef.current = true; setMaintenanceBusy(true);
    try {
      const saved = await onRescheduleMaintenance(maintenanceMove.occurrence, maintenanceMove.date, scope);
      if (!saved) throw new Error("Unable to save the maintenance date.");
      // Keep the tentative chip until the saved range arrives, avoiding a flash
      // back to its old date when the workspace response updates the parent.
      const items = await onLoadMaintenanceOccurrences(rangeFrom, rangeTo);
      setMaintenanceRange({ from: rangeFrom, to: rangeTo, items });
      setPanel((current) => current?.type === "maintenance" ? null : current);
      setAnnouncement("Maintenance date updated.");
    } catch (failure) {
      setError(`${failure.message || "Unable to update maintenance."} The original view has been restored; refresh to confirm the saved schedule.`);
      setMaintenanceRefresh((value) => value + 1);
    } finally { savingRef.current = false; setMaintenanceBusy(false); setMaintenanceMove(null); }
  }

  const saveSchedule = useCallback(async (jobId, date) => {
    if (savingRef.current) return false;
    const occurrence = occurrences.find((entry) => entry.id === jobId);
    if (occurrence) { proposeMaintenanceMove(occurrence, date); return false; }
    if (date !== "" && !isCalendarDate(date)) {
      setError("Choose a valid calendar date.");
      return false;
    }
    const job = jobs.find((entry) => entry.id === jobId);
    if (!job) return false;
    setError("");
    if (toDateInputValue(job.scheduledDate) === date) {
      setPanel((current) => current?.type === "schedule" ? (current.fromDay ? { type: "day" } : null) : current);
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
      setPanel((current) => current?.type === "schedule" && current.jobId === jobId ? (current.fromDay ? { type: "day" } : null) : current);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : failureMessage);
      setAnnouncement(`Schedule unchanged for Job #${job.jobNumber}.`);
      return false;
    } finally {
      savingRef.current = false;
      setPending(null);
    }
  }, [jobs, onScheduleJob, toDateInputValue, occurrences, proposeMaintenanceMove]);

  const dragApi = useCalendarDrag({ enabled: !pending && !bulkBusy && !maintenanceMove && !maintenanceBusy, onDrop: saveSchedule });

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
    suppressSheetRestoreRef.current = true;
    setSelectedDate(sourceDate);
    setPanel({ type: "day" });
  }

  function changePanelOpen(open) {
    if (open || bulkBusy) return;
    bulkPreviewRef.current = null;
    setPanel((current) => current?.type === "schedule" && current.fromDay ? { type: "day" } : null);
  }

  function closeInspector() {
    setPanel(null);
    const trigger = dayReturnFocusRef.current;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else workspaceRef.current?.querySelector(`[data-calendar-date="${selectedDate}"] .calendar-day-open`)?.focus({ preventScroll: true });
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
    if (job.kind === "maintenance") {
      setError(""); setScheduleDraft(job.date); setPanel({ type: "maintenance", occurrenceKey: job.key });
      return;
    }
    bulkPreviewRef.current = null;
    returnFocusRef.current = null;
    setPanel(null);
    dragApi.cancelDrag();
    onOpenJob(job);
  }

  function openSchedule(job, trigger) {
    bulkPreviewRef.current = null;
    const fromDay = Boolean(trigger?.closest("[data-calendar-day-inspector]"));
    returnFocusRef.current = fromDay ? inspectorHeadingRef.current : trigger?.closest(".calendar-sheet") ? (persistentQueue ? todayTrigger.current : jobsTrigger.current) : trigger;
    setScheduleDraft(toDateInputValue(job.scheduledDate) || selectedDate);
    setError("");
    setPanel({ type: "schedule", jobId: job.id, action: job.scheduledDate ? "Reschedule" : "Schedule", fromDay });
  }

  function openDay(date, trigger) {
    bulkPreviewRef.current = null;
    setSelectedDate(date);
    returnFocusRef.current = trigger;
    dayReturnFocusRef.current = trigger;
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
  const maintenanceActions = {
    openPlan: (occurrence) => { setPanel(null); onOpenPlan(occurrence.planId); },
    openJob: (occurrence) => { const job = jobs.find((entry) => entry.id === occurrence.jobId); if (job) openJob(job); },
    reschedule: (occurrence) => openJob(occurrence),
    generate: async (occurrence) => {
      if (savingRef.current) return;
      savingRef.current = true; setMaintenanceBusy(true); setError("");
      try {
        await onGenerateMaintenanceJob(occurrence.planId, occurrence, { openJob: false });
        setMaintenanceRefresh((value) => value + 1);
        setAnnouncement("Maintenance job generated.");
      } catch (failure) { setError(failure.message || "Unable to generate the job."); }
      finally { savingRef.current = false; setMaintenanceBusy(false); }
    },
  };
  const panelTitle = panel?.type === "maintenance" ? "Scheduled maintenance" : panel?.type === "bulk" ? "Reschedule jobs" : panel?.type === "schedule" ? `${panel.action} Job #${scheduleJob?.jobNumber || ""}` : panel?.type === "day" ? formatCalendarDate(selectedDate, { weekday: "long", day: "numeric", month: "long" }) : "Scheduling jobs";
  const dayPanelOpen = panel?.type === "day";
  const inspectorOpen = hasMiniColumn && (dayPanelOpen || panel?.fromDay || panel?.type === "bulk");
  const dayPanelContent = (
    <div className="grid gap-3" data-calendar-day-detail>
      {eligibleJobs.length ? <Button type="button" variant="outline" className="h-11 text-xs text-status-info" disabled={Boolean(pending) || bulkBusy} onClick={() => openBulk()}>Reschedule day</Button> : <p className="text-xs text-text-secondary">No active jobs available to reschedule.</p>}
      {selectedJobs.length ? selectedJobs.map((job) => job.kind === "maintenance" ? <CalendarMaintenanceItem key={job.id} occurrence={job} actions={maintenanceActions} dragApi={dragApi} busy={maintenanceBusy} /> : <CalendarJobCard key={job.id} job={job} onOpenJob={openJob} onSchedule={openSchedule} onUnschedule={() => saveSchedule(job.id, "")} dragApi={dragApi} draggable={false} busy={Boolean(pending)} />) : <p className="py-2 text-sm text-text-secondary">No jobs scheduled.</p>}
    </div>
  );
  const notice = bulkNotice ? <div className="shrink-0 space-y-1 rounded-lg border border-status-info-border bg-status-info-surface p-3 text-xs text-status-info" data-bulk-notice>
    <div className="flex items-center justify-between gap-2"><p role="status">{bulkNotice.message}</p>{bulkNotice.undo ? <Button type="button" variant="outline" className="h-11 shrink-0 text-xs" disabled={bulkBusy || Boolean(pending)} onClick={undoDayMove}>Undo</Button> : null}</div>
    {bulkNotice.failed?.length ? <ul aria-label="Jobs not restored">{bulkNotice.failed.map((entry) => <li key={entry.id}>Job #{entry.jobNumber || entry.id}: {entry.error}</li>)}</ul> : null}
  </div> : null;

  return (
    <div ref={workspaceRef} className="calendar-workspace min-w-0" data-calendar-workspace>
      {maintenanceLoadError ? <div role="alert" className="flex items-center gap-2 rounded-lg bg-status-danger-surface p-2 text-xs text-status-danger">{maintenanceLoadError}<Button size="sm" variant="outline" onClick={() => setMaintenanceRefresh((value) => value + 1)}>Retry</Button></div> : null}
      <div className="calendar-layout">
        <div ref={miniPaneRef} className="calendar-mini-pane">
          {inspectorOpen ? <CalendarDayInspector date={selectedDate} jobs={selectedJobs} eligibleCount={eligibleJobs.length} dragApi={dragApi} busy={Boolean(pending) || bulkBusy || maintenanceBusy} active={dayPanelOpen} headingRef={inspectorHeadingRef} notice={dayPanelOpen ? notice : null} onClose={closeInspector} onOpenJob={openJob} onSchedule={openSchedule} onRescheduleDay={() => openBulk()} maintenanceActions={maintenanceActions} /> : <MiniCalendar {...miniProps} />}
        </div>
        <div className="calendar-center">
          <header className="calendar-toolbar min-w-0" data-calendar-toolbar>
            <h1 className="calendar-toolbar-title text-base font-semibold text-inherit sm:text-lg" data-calendar-month>{monthLabel}</h1>
            <div className="calendar-month-navigation flex items-center gap-1">
              <Button type="button" variant="outline" className="calendar-nav-arrow h-11 w-11 bg-card/95 p-0" aria-label="Previous month" title="Previous month" onClick={() => miniProps.onMonthChange(-1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" ref={todayTrigger} variant="outline" className="calendar-today-button h-11 bg-card/95 px-3 text-xs" onClick={miniProps.onToday}>Today</Button>
              <Button type="button" variant="outline" className="calendar-nav-arrow h-11 w-11 bg-card/95 p-0" aria-label="Next month" title="Next month" onClick={() => miniProps.onMonthChange(1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="calendar-toolbar-actions flex items-center gap-2">
              {workspaceDayPanel ? <Button type="button" variant="outline" className="calendar-navigator-toggle h-11 bg-card/95 px-2 text-xs" aria-expanded={navigatorOpen} aria-controls="calendar-expanded-navigator" onClick={() => setNavigatorOpen((value) => !value)}><CalendarDays className="h-4 w-4" /> Dates</Button> : null}
              <Button type="button" ref={jobsTrigger} className="calendar-jobs-toggle h-11 px-3 text-xs" aria-label={`Jobs ${queueJobs.length}`} onClick={() => { returnFocusRef.current = jobsTrigger.current; setPanel({ type: "jobs" }); }}><ListFilter className="calendar-jobs-icon h-4 w-4" /> Jobs <span className="calendar-jobs-count rounded-full bg-current/25 px-1.5">{queueJobs.length}</span></Button>
            </div>
          </header>
          {workspaceDayPanel && navigatorOpen ? <div className="calendar-mini-expanded" id="calendar-expanded-navigator"><MiniCalendar {...miniProps} /></div> : null}
          {error ? <div className="flex items-start justify-between gap-2 rounded-lg border border-status-danger-border bg-status-danger-surface p-3 text-sm text-status-danger" role="alert"><span>{error}</span><Button type="button" variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label="Dismiss scheduling error" onClick={() => setError("")}><X className="h-4 w-4" /></Button></div> : null}
          {!panel ? notice : null}
          <MainCalendar days={days} monthLabel={monthLabel} selectedDate={selectedDate} jobsByDate={jobsByDate} dragApi={dragApi} onOpenJob={openJob} onOpenDay={openDay} inlineDayDetails={hasMiniColumn} />
          <p className="calendar-announcement text-xs text-text-secondary" role="status" aria-live="polite">{dragApi.drag?.target != null ? `Move ${dragApi.drag.job.kind === "maintenance" ? "maintenance" : `Job #${dragApi.drag.job.jobNumber}`} to ${dragApi.drag.target ? formatCalendarDate(dragApi.drag.target) : "Unscheduled"}` : announcement}</p>
        </div>
        <div className="calendar-queue-pane">{persistentQueue ? <CalendarQueue {...queueProps} /> : null}</div>
      </div>

      {workspaceDayPanel && !hasMiniColumn ? (
        <CalendarSheet open={dayPanelOpen} modal={false} placement="workspace-left" portalContainer={workspaceRef.current} restoreFocus={!panel} focusKey="day" notice={notice} onOpenChange={changePanelOpen} title={formatCalendarDate(selectedDate, { weekday: "long", day: "numeric", month: "long" })} description={`${selectedJobs.length} scheduled ${selectedJobs.length === 1 ? "job" : "jobs"}`} error={error} returnFocusRef={returnFocusRef}>
          {dayPanelContent}
        </CalendarSheet>
      ) : null}

      <CalendarSheet open={Boolean(panel) && (!dayPanelOpen || (!workspaceDayPanel && !hasMiniColumn))} modal={panel?.type !== "day"} bulk={panel?.type === "bulk"} busy={bulkBusy || maintenanceBusy} focusKey={panel?.type} notice={notice} suppressRestoreRef={suppressSheetRestoreRef} onOpenChange={changePanelOpen} title={panelTitle} description={panel?.type === "bulk" ? `${formatCalendarDate(panel.sourceDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${panel.entries?.length ?? "Loading"} eligible jobs` : panel?.type === "schedule" ? "Change the scheduled date for this job." : panel?.type === "day" ? `${selectedJobs.length} scheduled ${selectedJobs.length === 1 ? "job" : "jobs"}` : panel?.type === "maintenance" ? "Recurring maintenance visit" : "To Do and In Progress jobs"} error={error} returnFocusRef={returnFocusRef}>
        {panel?.type === "jobs" ? <CalendarQueue {...queueProps} inSheet /> : null}
        {selectedOccurrence ? <div className="grid gap-4">
          <CalendarMaintenanceItem occurrence={selectedOccurrence} actions={maintenanceActions} dragApi={dragApi} busy={maintenanceBusy} />
          {!selectedOccurrence.locked && selectedOccurrence.active ? <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); proposeMaintenanceMove(selectedOccurrence, scheduleDraft); }}>
            <label className="grid gap-2 text-xs font-semibold">Maintenance date<Input type="date" value={scheduleDraft} onChange={(event) => setScheduleDraft(event.target.value)} required disabled={maintenanceBusy} /></label>
            <Button type="submit" disabled={maintenanceBusy || scheduleDraft === selectedOccurrence.date}>Change date</Button>
          </form> : null}
        </div> : null}
        {dayPanelOpen && !workspaceDayPanel ? dayPanelContent : null}
        {panel?.type === "bulk" ? panel.loading ? <p className="p-3 text-sm" role="status">Loading active jobs…</p> : panel.loadError ? <div className="space-y-3 p-3"><p role="alert">{panel.loadError}</p><Button type="button" className="h-11" onClick={() => openBulk(panel.sourceDate)}>Try again</Button><Button type="button" variant="outline" className="h-11" onClick={() => backToDay(panel.sourceDate)}>Back to day</Button></div> : <CalendarBulkReschedule sourceDate={panel.sourceDate} entries={panel.entries} jobsByDate={scheduledJobsByDate} busy={bulkBusy} result={panel.result} error={panel.moveError} onMove={moveDayJobs} onCancel={() => backToDay(panel.sourceDate)} onReview={(ids) => openBulk(panel.sourceDate, ids)} /> : null}
        {scheduleJob ? (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveSchedule(scheduleJob.id, scheduleDraft); }}>
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{scheduleJob.customerName}</p><p className="mt-1 break-words text-xs text-text-secondary">{scheduleJob.title}</p></div>
            <div className="space-y-1.5"><label htmlFor="calendar-schedule-date" className="text-xs font-semibold">Scheduled date</label><Input id="calendar-schedule-date" type="date" className="h-11 w-full" value={scheduleDraft} onChange={(event) => setScheduleDraft(event.target.value)} required disabled={Boolean(pending)} /></div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              {scheduleJob.scheduledDate ? <Button type="button" variant="outline" className="h-11 text-xs" disabled={Boolean(pending)} onClick={() => saveSchedule(scheduleJob.id, "")}>Remove scheduled date</Button> : null}
              <Button type="submit" className="h-11 px-4 text-xs" disabled={Boolean(pending)} aria-busy={Boolean(pending)}>{pending ? "Saving…" : "Save date"}</Button>
            </div>
          </form>
        ) : null}
      </CalendarSheet>
      <MaintenanceDateChoice open={Boolean(maintenanceMove)} from={maintenanceMove?.occurrence.date} to={maintenanceMove?.date} busy={maintenanceBusy} onChoose={commitMaintenanceMove} onCancel={() => { setMaintenanceMove(null); setAnnouncement("Maintenance date unchanged."); }} />
      {dragApi.drag?.touch ? createPortal(<div className="calendar-drag-preview" style={{ left: Math.min(Math.max(8, dragApi.drag.x + 12), window.innerWidth - 202), top: Math.max(8, dragApi.drag.y - 80) }} aria-hidden="true"><p className="text-xs font-semibold text-foreground">Moving {dragApi.drag.job.kind === "maintenance" ? "maintenance" : `Job #${dragApi.drag.job.jobNumber}`}</p><p className="truncate text-xs text-text-secondary">{dragApi.drag.job.customerName}</p><p className="mt-1 text-xs font-medium text-status-info">{dragApi.drag.target === null ? "Choose a destination" : dragApi.drag.target === "" ? "Remove scheduled date" : `Drop on ${formatCalendarDate(dragApi.drag.target)}`}</p></div>, document.body) : null}
    </div>
  );
}
