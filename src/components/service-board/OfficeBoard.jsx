import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStableCallback } from "@/hooks/useStableCallback";
import { ArrowUpRight, ChevronRight, LayoutGrid, List, Rows3, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { statuses, statusThemes } from "@/lib/job-status";
import CompletedShowMore from "./CompletedShowMore";
import JobNoteModeButton from "./JobNoteModeButton";
import JobNotePill from "./JobNotePill";
import { useCompletedJobLimit } from "./useCompletedJobLimit";
import {
  buildJobCardIndicators,
  formatStreetAndSuburb,
  getJobValueMeta,
  serviceBoardIndicatorLegend,
  serviceBoardSortOptions,
  sortJobsForColumn,
} from "./service-board-utils";

const serviceBoardViewOptions = [
  { value: "list", label: "List", icon: List },
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "compact", label: "Compact", icon: Rows3 },
];

const TOUCH_DRAG_HOLD_MS = 180;
const TOUCH_DRAG_CANCEL_DISTANCE = 10;
const TOUCH_DRAG_ACTIVATE_DISTANCE = 6;

function getTrackedTouch(touchList, touchId) {
  if (!touchList) return null;
  return Array.from(touchList).find((touch) => touch.identifier === touchId) || null;
}

function isInteractiveTouchTarget(target) {
  return target instanceof Element && Boolean(
    target.closest("button, a, input, select, textarea, [role='button'], [data-slot='select-trigger']")
  );
}

function ServiceBoardViewToggle({ status, viewMode, onChange }) {
  return (
    <div className="ml-auto flex items-center gap-1 rounded-xl border border-border bg-card/85 p-1 shadow-sm @min-[20rem]:ml-0" role="group" aria-label={`${status} view`}>
      {serviceBoardViewOptions.map(({ value, label, icon }) => {
        const isActive = viewMode === value;
        const ViewIcon = icon;
        return (
          <Button
            key={value}
            type="button"
            size="xs"
            variant={isActive ? "secondary" : "ghost"}
            className={isActive ? "rounded-lg bg-primary px-2 text-primary-foreground hover:bg-primary hover:text-primary-foreground 2xl:px-2.5" : "rounded-lg px-2 text-text-secondary hover:text-foreground 2xl:px-2.5"}
            onClick={() => onChange(value)}
            aria-label={`${status} ${label} view`}
            aria-pressed={isActive}
            title={`${status} ${label.toLowerCase()} view`}
          >
            <ViewIcon className="h-3.5 w-3.5" />
          </Button>
        );
      })}
    </div>
  );
}

function ServiceBoardSortSelect({ status, sortMode, onChange }) {
  return (
    <Select value={sortMode} onValueChange={onChange}>
      <SelectTrigger
        className="ml-auto h-8 w-24 min-w-20 max-w-24 flex-1 rounded-lg border-border bg-card text-xs font-medium [&_[data-slot=select-value]]:truncate"
        aria-label={`${status} sort order`}
        title={`${status} sort order`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {serviceBoardSortOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ServiceBoardTagLegend({
  noteEditMode = false,
  onToggleNoteEditMode,
  showTagLabels,
  onToggleShowTagLabels,
  tone = "default",
}) {
  const isHeroTone = tone === "hero";

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 ${isHeroTone ? "border-white/20" : "border-border"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${isHeroTone ? "text-inherit" : "text-muted-foreground"}`}>Legend</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {serviceBoardIndicatorLegend.map((indicator) => (
          <div key={indicator.id} className={`inline-flex items-center gap-1.5 text-[11px] ${isHeroTone ? "text-inherit" : "text-text-secondary"}`}>
            <span className={`h-2 w-2 rounded-full ${indicator.dotClassName}`} />
            <span>{indicator.label}</span>
          </div>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${isHeroTone ? "border-white/20 bg-current/10" : "border-border bg-muted"}`}>
          <Checkbox checked={showTagLabels} onCheckedChange={(checked) => onToggleShowTagLabels(Boolean(checked))} />
          <span className={`text-[11px] ${isHeroTone ? "text-inherit" : "text-text-secondary"}`}>Show tag info</span>
        </div>
        <JobNoteModeButton active={noteEditMode} onToggle={onToggleNoteEditMode} />
      </div>
    </div>
  );
}

const TomorrowJobCard = memo(function TomorrowJobCard({ job, formatDate, onOpenJob, onRemoveJob, noteEditMode, onEditNote }) {
  const urgencyTone = {
    Low: "bg-surface-raised text-text-secondary",
    Medium: "bg-status-warning-surface text-status-warning",
    High: "bg-status-danger-surface text-status-danger",
  };
  const statusTheme = statusThemes[job.status] || statusThemes["To Do"];

  return (
    <div
      className={`relative rounded-2xl border p-4 shadow-sm ${statusTheme.card}`}
      data-note-edit-mode={noteEditMode || undefined}
      data-tomorrow-job-id={job.id}
      tabIndex={noteEditMode ? 0 : undefined}
      onClick={(event) => { if (noteEditMode && !event.target.closest("button")) onEditNote(job, event); }}
      onKeyDown={(event) => {
        if (noteEditMode && event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          onEditNote(job, event);
        }
      }}
    >
      <JobNotePill note={job.serviceBoardNote} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Job #{job.jobNumber}</p>
          <p className="mt-1 font-semibold leading-5 text-foreground">{job.customerName}</p>
          <p className="mt-1 text-sm text-text-secondary">{job.title}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge className={statusTheme.badge}>{job.status}</Badge>
          {job.status !== "Completed" ? <Badge className={urgencyTone[job.urgency] || urgencyTone.Low}>{job.urgency}</Badge> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-text-secondary">
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0">Site</span>
          <span className="line-clamp-2 max-w-[240px] text-right font-medium text-foreground">{job.jobAddress || "Not set"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Scheduled</span>
          <span className="text-right font-medium text-foreground">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={() => onRemoveJob(job.id)}>
          <X className="mr-1.5 h-3.5 w-3.5" /> Remove
        </Button>
        <Button type="button" size="sm" variant="secondary" className="rounded-xl" onClick={() => onOpenJob(job)}>
          View Job
        </Button>
      </div>
    </div>
  );
});

export function ServiceBoardTomorrowPanel({
  noteEditMode = false,
  onEditNote,
  jobs,
  open,
  tomorrowDate,
  onOpenChange,
  onOpenJob,
  onRemoveAllJobs,
  onRemoveJob,
  formatDate,
}) {
  const panelWidth = "min(92vw, 440px)";
  const openJob = useStableCallback(onOpenJob);
  const removeJob = useStableCallback(onRemoveJob);
  const editNote = useStableCallback(onEditNote);
  const tabButtonRef = useRef(null);
  const [tabEdgeOffset, setTabEdgeOffset] = useState(0);

  useEffect(() => {
    if (!tabButtonRef.current) return undefined;

    const measureOffset = () => {
      const width = tabButtonRef.current?.offsetWidth || 0;
      const height = tabButtonRef.current?.offsetHeight || 0;
      setTabEdgeOffset(Math.max(0, (width - height) / 2));
    };

    measureOffset();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      measureOffset();
    });

    observer.observe(tabButtonRef.current);

    return () => {
      observer.disconnect();
    };
  }, [jobs.length]);

  return (
    <>
      <Button
        ref={tabButtonRef}
        data-desktop-tomorrow-tab
        type="button"
        variant="outline"
        className="fixed top-1/2 z-[60] flex -translate-y-1/2 rotate-90 items-center gap-2 rounded-b-2xl rounded-t-none border-border bg-card/95 px-3 py-2 shadow-lg transition-all duration-300 hover:bg-card"
        style={{ right: open ? `calc(${panelWidth} - ${tabEdgeOffset}px)` : `${-tabEdgeOffset}px` }}
        onClick={() => onOpenChange(!open)}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Tomorrow</span>
        <Badge className="bg-status-info-surface text-status-info">{jobs.length}</Badge>
        <ChevronRight className={`h-4 w-4 text-text-secondary transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </Button>

      <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
        <button
          type="button"
          className="absolute inset-0 bg-scrim backdrop-blur-[1px]"
          onClick={() => onOpenChange(false)}
          aria-label="Close tomorrow panel"
        />
      </div>

      <aside
        className={`fixed right-0 top-0 z-50 h-screen w-[min(92vw,440px)] border-l border-border bg-card/96 shadow-2xl backdrop-blur transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tomorrow</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{formatDate(tomorrowDate)}</p>
                <p className="mt-2 text-sm text-text-secondary">
                  Build tomorrow&apos;s run sheet from the board using the hover arrow on each job card.
                </p>
              </div>
              <Button type="button" variant="outline" size="icon" className="rounded-xl" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted px-3 py-2">
              <span className="text-sm text-text-secondary">Planned jobs</span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-status-danger-border text-status-danger hover:bg-status-danger-surface"
                  onClick={() => onRemoveAllJobs?.()}
                  disabled={jobs.length === 0}
                >
                  Remove all
                </Button>
                <Badge className="bg-status-info-surface text-status-info">{jobs.length}</Badge>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted px-5 py-8 text-center text-sm text-text-secondary">
                Hover a job card and click the arrow to send it here.
              </div>
            ) : (
              <div className="grid gap-3">
                {jobs.map((job) => (
                  <TomorrowJobCard
                    noteEditMode={noteEditMode}
                    onEditNote={editNote}
                    key={job.id}
                    job={job}
                    formatDate={formatDate}
                    onOpenJob={openJob}
                    onRemoveJob={removeJob}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function JobCardIndicators({ indicators, showTagLabels, className = "mt-2" }) {
  if (indicators.length === 0) return null;

  return (
    <div className={`flex min-w-0 max-w-full flex-wrap items-center gap-1.5 ${className}`}>
      {indicators.map((indicator) =>
        showTagLabels ? (
          <div
            key={indicator.id}
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-card/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary"
            title={indicator.label}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${indicator.dotClassName}`} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{indicator.label}</span>
          </div>
        ) : (
          <span
            key={indicator.id}
            className={`inline-flex h-3.5 w-3.5 rounded-full ring-2 ring-border ${indicator.dotClassName}`}
            title={indicator.label}
            aria-label={indicator.label}
          />
        )
      )}
    </div>
  );
}

// The statusDateKey prop also invalidates memoization when date-based invoice indicators change.
const JobCard = memo(function JobCard({
  job,
  noteEditMode = false,
  onEditNote,
  onOpen,
  draggable = false,
  viewMode = "list",
  showTagLabels = false,
  isPlannedForTomorrow = false,
  isTouchDragging = false,
  onPlanForTomorrow = null,
  onTouchDragStart = null,
  formatDate,
  getInvoiceStatus,
}) {
  const urgencyTone = {
    Low: "bg-surface-raised text-text-secondary",
    Medium: "bg-status-warning-surface text-status-warning",
    High: "bg-status-danger-surface text-status-danger",
  };
  const statusTheme = statusThemes[job.status] || statusThemes["To Do"];
  const invoiceStatus = getInvoiceStatus(job);
  const jobValueMeta = getJobValueMeta(job);
  const isGridView = viewMode === "grid";
  const isCompactView = viewMode === "compact";
  const [isCompactExpanded, setIsCompactExpanded] = useState(false);
  const priceRef = useRef(null);
  useEffect(() => {
    const price = priceRef.current;
    if (!price) return undefined;
    const measure = () => price.closest("[data-service-board-job-id]").style.setProperty("--job-price-width", `${price.getBoundingClientRect().width}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(price);
    return () => observer.disconnect();
  }, [isGridView, isCompactView, jobValueMeta?.amount]);
  const cardClassName = `box-border w-full min-w-0 max-w-full ${isGridView ? "h-full overflow-visible rounded-2xl py-0" : isCompactView ? "rounded-xl py-2" : "rounded-2xl py-0"} select-none shadow-sm transition hover:shadow-md ${statusTheme.card} ${isTouchDragging ? "opacity-45" : ""}`;
  const cardContentClassName = isGridView ? "flex h-full flex-col p-2 pb-3" : isCompactView ? "px-2.5 py-0" : "p-2.5";
  // Keep enough room for the full price, the gap, and a visible note ellipsis.
  const headerMetaMinWidth = job.serviceBoardNote && jobValueMeta
    ? "min-w-[calc(var(--job-price-width,5rem)+1.75rem)]"
    : "min-w-0";
  const headerMetaClassName = `flex ${headerMetaMinWidth} shrink-0 ${isCompactView ? (job.serviceBoardNote ? "max-w-[60%]" : "max-w-[min(100%,6rem)]") : "max-w-1/2"} flex-col items-end`;
  const urgencyClassName = `h-auto min-w-0 max-w-full whitespace-normal ${urgencyTone[job.urgency]}`;
  const descriptionClassName = `${isCompactView ? "line-clamp-1" : "line-clamp-2"} mt-1.5 text-sm leading-snug text-text-secondary`;
  const actionRowClassName = "mt-1.5 flex flex-wrap gap-2";
  const cardIndicators = buildJobCardIndicators({
    job,
    invoiceStatus,
  });
  const stopDoubleClickPropagation = (event) => event.stopPropagation();
  const handleCardDoubleClick = () => {
    if (noteEditMode) return;
    onOpen(job);
  };
  const noteInteraction = {
    "data-service-board-job-id": job.id,
    "data-job-card-view": viewMode,
    "data-note-edit-mode": noteEditMode || undefined,
    tabIndex: noteEditMode ? 0 : undefined,
    role: noteEditMode ? "group" : undefined,
    "aria-label": noteEditMode ? `Edit note for Job #${job.jobNumber}` : undefined,
    onClickCapture: (event) => {
      if (!noteEditMode || event.target.closest("button:not([data-job-card-body]), a, input, select, textarea, [role='combobox']")) return;
      event.preventDefault();
      event.stopPropagation();
      onEditNote(job, event);
    },
    onKeyDown: (event) => {
      if (noteEditMode && event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        onEditNote(job, event);
      }
    },
  };
  const shouldShowHeaderMeta = Boolean(jobValueMeta || job.serviceBoardNote) || job.status !== "Completed";
  const inlineNoteAndPrice = jobValueMeta || job.serviceBoardNote ? (
    <div data-job-card-value-row className="flex min-w-0 max-w-full items-center justify-end gap-1">
      <JobNotePill note={job.serviceBoardNote} variant="inline" />
      {jobValueMeta ? (
        <div ref={priceRef} className="shrink-0 whitespace-nowrap rounded-full bg-card/85 px-2 py-0.5 text-[11px] font-semibold text-foreground shadow-sm" title={`${jobValueMeta.label} value`}>
          {jobValueMeta.amount}
        </div>
      ) : null}
    </div>
  ) : null;
  const compactAddress = formatStreetAndSuburb(job.jobAddress);
  const tomorrowActionPositionClassName = "right-1.5 top-1.5";
  const tomorrowAction = isPlannedForTomorrow ? (
    <span
      className={`absolute z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-status-info-surface text-[10px] font-bold text-status-info shadow-sm ring-2 ring-border ${tomorrowActionPositionClassName}`}
      title="Planned for tomorrow"
      aria-label="Planned for tomorrow"
    >
      T
    </span>
  ) : onPlanForTomorrow ? (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={`service-board-tomorrow-action absolute z-10 h-8 w-8 rounded-full border-status-info-border bg-card/95 text-status-info opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100 ${tomorrowActionPositionClassName}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onPlanForTomorrow(job.id);
      }}
      aria-label={`Add Job #${job.jobNumber} to tomorrow`}
      title="Add to tomorrow"
    >
      <ArrowUpRight className="h-4 w-4" />
    </Button>
  ) : null;

  const handleDragStart = (event) => {
    if (noteEditMode || !draggable) { event.preventDefault(); return; }
    event.dataTransfer.setData("jobId", job.id);
  };

  if (isCompactView) {
    return (
      <div
        {...noteInteraction}
        className="group relative box-border w-full min-w-0 max-w-full"
        draggable={draggable && !noteEditMode}
        onDragStart={handleDragStart}
        onDoubleClick={handleCardDoubleClick}
        onTouchStart={!noteEditMode && onTouchDragStart ? (event) => onTouchDragStart(job, event) : undefined}
        title={noteEditMode ? "Click to edit job note" : "Double-click to open job"}
      >
        <JobCardIndicators
          indicators={cardIndicators}
          showTagLabels={false}
          className="pointer-events-none absolute left-0 top-0 z-20 -translate-y-1/2 gap-1.5"
        />
        {tomorrowAction}
        <Card className={cardClassName}>
          <CardContent className={`min-w-0 max-w-full [overflow-wrap:anywhere] ${cardContentClassName}`}>
            <button
              type="button"
              data-job-card-body
              className="flex w-full min-w-0 items-start justify-between gap-2 pr-12 text-left lg:pr-9"
              onClick={() => setIsCompactExpanded((prev) => !prev)}
              aria-expanded={isCompactExpanded}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-semibold leading-4 text-foreground">{job.customerName}</p>
                    <p className="line-clamp-1 text-[11px] leading-4 text-text-secondary">{job.title}</p>
                    <p className="line-clamp-1 text-[11px] font-medium leading-4 text-text-secondary">{compactAddress}</p>
                  </div>
                  {shouldShowHeaderMeta ? (
                    <div className={`${headerMetaClassName} gap-1.5`}>
                      {inlineNoteAndPrice}
                      {job.status !== "Completed" ? <Badge className={urgencyClassName}>{job.urgency}</Badge> : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card/85 text-text-secondary shadow-sm">
                <ChevronRight className={`h-4 w-4 transition-transform ${isCompactExpanded ? "rotate-90" : ""}`} />
              </span>
            </button>

            {isCompactExpanded ? (
              <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 border-t border-border pt-2 text-xs text-text-secondary">
                <div className="rounded-xl border border-border bg-card/70 px-2 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Site</span>
                    <span className="min-w-0 line-clamp-2 text-right font-medium text-foreground">{compactAddress}</span>
                  </div>
                </div>
                <div className={actionRowClassName}>
                  <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => onOpen(job)} onDoubleClick={stopDoubleClickPropagation}>
                    View Job
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      {...noteInteraction}
      className={`group relative box-border w-full min-w-0 max-w-full ${isGridView ? "h-full" : ""}`}
      draggable={draggable && !noteEditMode}
      onDragStart={handleDragStart}
      onDoubleClick={handleCardDoubleClick}
      onTouchStart={!noteEditMode && onTouchDragStart ? (event) => onTouchDragStart(job, event) : undefined}
      title={noteEditMode ? "Click to edit job note" : "Double-click to open job"}
    >
      {isGridView ? <JobNotePill note={job.serviceBoardNote} variant="floating" withFloatingPrice={Boolean(jobValueMeta)} /> : null}
      {isGridView ? (
        <JobCardIndicators
          indicators={cardIndicators}
          showTagLabels={false}
          className="pointer-events-none absolute left-0 top-0 z-20 -translate-y-1/2 gap-1.5"
        />
      ) : null}
      {tomorrowAction}
      {isGridView && jobValueMeta ? (
        <div
          data-grid-job-value
          ref={priceRef}
          className="service-board-floating-pill right-0 z-20 max-w-full truncate rounded-full bg-card/95 px-2 py-0.5 text-[11px] font-semibold leading-4 tabular-nums text-foreground shadow-sm"
          title={`${jobValueMeta.label} value: ${jobValueMeta.amount}`}
        >
          {jobValueMeta.amount}
        </div>
      ) : null}
      <Card className={cardClassName}>
        <CardContent className={`min-w-0 max-w-full [overflow-wrap:anywhere] ${cardContentClassName}`}>
          {isGridView ? (
            <div className="flex h-full min-w-0 flex-col justify-between gap-2">
              <div className="space-y-1">
                {tomorrowAction ? <span aria-hidden="true" className="float-right h-8 w-10 max-lg:h-11 max-lg:w-12" /> : null}
                <p data-job-card-number className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Job #{job.jobNumber}</p>
                <p data-job-card-customer className="text-xs font-medium leading-4 text-foreground">{job.customerName}</p>
                <p className="text-[11px] font-normal leading-4 text-foreground">{job.title}</p>
                <p className="line-clamp-2 text-[11px] leading-4 text-text-secondary">{compactAddress}</p>
              </div>

            </div>
          ) : (
            <>
          {cardIndicators.length > 0 ? <div data-job-card-indicators className="mb-1 flex min-h-6 items-center pr-8 max-lg:min-h-10 max-lg:pr-12">
            <JobCardIndicators indicators={cardIndicators} showTagLabels={showTagLabels} className="" />
          </div> : null}

          <div className={`flex items-start justify-between gap-2 ${cardIndicators.length === 0 && tomorrowAction ? "pr-10 max-lg:pr-12" : ""}`}>
            <div className="min-w-0 flex-1">
              <p data-job-card-number className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Job #{job.jobNumber}</p>
              <p className="font-semibold leading-5 text-foreground">{job.customerName}</p>
              <p className="text-xs text-text-secondary">{job.title}</p>
            </div>
            {shouldShowHeaderMeta ? (
              <div className={`${headerMetaClassName} gap-1.5`}>
                {inlineNoteAndPrice}
                {job.status !== "Completed" ? <Badge className={urgencyClassName}>{job.urgency}</Badge> : null}
              </div>
            ) : null}
          </div>

          {job.description ? <p className={descriptionClassName}>{job.description}</p> : null}

          {viewMode === "list" ? (
            <div className="mt-1.5 grid min-w-0 grid-cols-1 gap-1 text-xs text-text-secondary">
              <div className="flex items-start justify-between gap-2">
                <span className="shrink-0">Site</span>
                <span className="min-w-0 line-clamp-2 max-w-[220px] text-right font-medium text-foreground">{job.jobAddress || "Not set"}</span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0">Scheduled</span>
                <span className="min-w-0 text-right font-medium text-foreground">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
              </div>
            </div>
          ) : (
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-xs text-text-secondary">
              <div className="rounded-xl border border-border bg-card/70 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="shrink-0 text-muted-foreground">Site</span>
                  <span className="min-w-0 line-clamp-2 text-right font-medium text-foreground">{job.jobAddress || "Not set"}</span>
                </div>
              </div>
              {!isGridView ? (
                <div className="grid min-w-0 grid-cols-1 gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">Scheduled</span>
                    <span className="min-w-0 text-right font-medium text-foreground">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}

            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

export function OfficeBoard({
  jobs,
  noteEditMode = false,
  onEditNote,
  onDropJob,
  onOpenJob,
  allowDragging = true,
  columnSortModes = {},
  columnViewModes = {},
  onColumnSortModeChange,
  onColumnViewModeChange,
  onPlanJobForTomorrow,
  showTagLabels = false,
  getInvoiceStatus,
  formatDate,
  tomorrowPlanningDate = "",
  officeSearch = "",
  showHighUrgencyOnly = false,
}) {
  const { visibleLimit, showMore } = useCompletedJobLimit(officeSearch, showHighUrgencyOnly, columnSortModes.Completed || "recent");
  const [touchDrag, setTouchDrag] = useState(null);
  const [touchDropTargetStatus, setTouchDropTargetStatus] = useState("");
  const touchDragSessionRef = useRef(null);
  const touchDragHoldTimerRef = useRef(null);
  const touchDragFrameRef = useRef(null);
  const touchDragPreviewRef = useRef(null);
  const openJob = useStableCallback(onOpenJob);
  const editNote = useStableCallback(onEditNote);
  const planForTomorrow = useStableCallback(onPlanJobForTomorrow);
  const dropJob = useStableCallback(onDropJob);
  const todoSort = columnSortModes["To Do"] || "recent";
  const progressSort = columnSortModes["In Progress"] || "recent";
  const completedSort = columnSortModes.Completed || "recent";
  const sortedColumns = useMemo(() => {
    const groups = Object.fromEntries(statuses.map((status) => [status, []]));
    for (const job of jobs) groups[job.status]?.push(job);
    return {
      "To Do": sortJobsForColumn(groups["To Do"], todoSort),
      "In Progress": sortJobsForColumn(groups["In Progress"], progressSort),
      Completed: sortJobsForColumn(groups.Completed, completedSort),
    };
  }, [jobs, todoSort, progressSort, completedSort]);

  const clearTouchDragHoldTimer = useCallback(() => {
    if (touchDragHoldTimerRef.current) {
      window.clearTimeout(touchDragHoldTimerRef.current);
      touchDragHoldTimerRef.current = null;
    }
  }, []);

  const clearTouchDragSession = useCallback(() => {
    clearTouchDragHoldTimer();
    window.cancelAnimationFrame(touchDragFrameRef.current);
    touchDragFrameRef.current = null;
    touchDragSessionRef.current = null;
    setTouchDrag(null);
    setTouchDropTargetStatus("");
  }, [clearTouchDragHoldTimer]);

  const getTouchDropStatus = useCallback((clientX, clientY) => {
    const statusElement = document.elementFromPoint(clientX, clientY)?.closest?.("[data-service-board-status]");
    return statusElement?.getAttribute("data-service-board-status") || "";
  }, []);

  const handleTouchDragStart = useCallback((job, event) => {
    if (noteEditMode || !allowDragging || event.touches.length !== 1 || isInteractiveTouchTarget(event.target)) {
      return;
    }

    const touch = event.touches[0];
    const nextSession = {
      jobId: job.id,
      jobNumber: job.jobNumber,
      customerName: job.customerName,
      title: job.title,
      touchId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      clientX: touch.clientX,
      clientY: touch.clientY,
      isPrimed: false,
      isActive: false,
    };

    clearTouchDragHoldTimer();
    touchDragSessionRef.current = nextSession;
    setTouchDrag({ ...nextSession });
    setTouchDropTargetStatus("");

    touchDragHoldTimerRef.current = window.setTimeout(() => {
      const currentSession = touchDragSessionRef.current;
      if (!currentSession || currentSession.jobId !== job.id || currentSession.touchId !== touch.identifier) {
        return;
      }

      currentSession.isPrimed = true;
    }, TOUCH_DRAG_HOLD_MS);
  }, [noteEditMode, allowDragging, clearTouchDragHoldTimer]);

  const trackingTouch = Boolean(touchDrag);
  useEffect(() => {
    if (!trackingTouch || noteEditMode) return undefined;

    const paintTouchPosition = () => {
      touchDragFrameRef.current = null;
      const session = touchDragSessionRef.current;
      if (!session?.isActive) return;
      if (touchDragPreviewRef.current) {
        touchDragPreviewRef.current.style.transform = `translate3d(${session.clientX + 18}px, ${session.clientY}px, 0) translateY(-50%)`;
      }
      const target = getTouchDropStatus(session.clientX, session.clientY);
      setTouchDropTargetStatus((previous) => previous === target ? previous : target);
    };

    const handleTouchMove = (event) => {
      const currentSession = touchDragSessionRef.current;
      if (!currentSession) return;

      const touch = getTrackedTouch(event.touches, currentSession.touchId);
      if (!touch) return;

      const movement = Math.hypot(touch.clientX - currentSession.startX, touch.clientY - currentSession.startY);

      if (!currentSession.isPrimed) {
        if (movement > TOUCH_DRAG_CANCEL_DISTANCE) {
          clearTouchDragSession();
        }
        return;
      }

      currentSession.clientX = touch.clientX;
      currentSession.clientY = touch.clientY;
      if (!currentSession.isActive && movement > TOUCH_DRAG_ACTIVATE_DISTANCE) {
        currentSession.isActive = true;
        setTouchDrag({ ...currentSession });
      }
      if (currentSession.isActive) {
        event.preventDefault();
        if (touchDragFrameRef.current === null) touchDragFrameRef.current = window.requestAnimationFrame(paintTouchPosition);
      }
    };

    const handleTouchEnd = (event) => {
      const currentSession = touchDragSessionRef.current;
      if (!currentSession) return;

      const touch = getTrackedTouch(event.changedTouches, currentSession.touchId);
      const clientX = touch?.clientX ?? currentSession.clientX;
      const clientY = touch?.clientY ?? currentSession.clientY;
      const dropStatus = currentSession.isActive ? getTouchDropStatus(clientX, clientY) : "";

      clearTouchDragSession();

      if (currentSession.isActive && dropStatus) {
        dropJob(currentSession.jobId, dropStatus);
      }
    };

    const handleTouchCancel = () => {
      clearTouchDragSession();
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [noteEditMode, clearTouchDragSession, getTouchDropStatus, dropJob, trackingTouch]);

  useEffect(() => {
    if (!noteEditMode) return undefined;
    // Cancel any gesture already in progress on the next browser frame.
    const frame = window.requestAnimationFrame(clearTouchDragSession);
    return () => window.cancelAnimationFrame(frame);
  }, [noteEditMode, clearTouchDragSession]);

  useEffect(() => {
    return () => {
      clearTouchDragHoldTimer();
      window.cancelAnimationFrame(touchDragFrameRef.current);
    };
  }, [clearTouchDragHoldTimer]);

  return (
    <div className="relative grid gap-4">
      {!noteEditMode && touchDrag?.isActive ? (
        <div
          ref={touchDragPreviewRef}
          className="pointer-events-none fixed z-[80] w-[200px] -translate-y-1/2 rounded-2xl border border-status-info-border bg-card/96 px-3 py-2 shadow-2xl backdrop-blur"
          style={{
            left: 0,
            top: 0,
            transform: `translate3d(${touchDrag.clientX + 18}px, ${touchDrag.clientY}px, 0) translateY(-50%)`,
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Move Job #{touchDrag.jobNumber}</p>
          <p className="mt-1 text-sm font-semibold leading-5 text-foreground">{touchDrag.customerName}</p>
          <p className="line-clamp-2 text-xs leading-4 text-text-secondary">{touchDrag.title}</p>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        {statuses.map((status) => {
          const sortedColumnJobs = sortedColumns[status];
          const columnJobs = sortedColumnJobs;
          const visibleJobs = status === "Completed" ? sortedColumnJobs.slice(0, visibleLimit) : sortedColumnJobs;
          const statusTheme = statusThemes[status] || statusThemes["To Do"];
          const sortMode = columnSortModes[status] || "recent";
          const viewMode = columnViewModes[status] || "list";
          const jobLayoutClassName = viewMode === "grid"
            ? "grid grid-cols-2 gap-x-2 gap-y-3 pb-1 @min-[29rem]:grid-cols-3"
            : "grid grid-cols-1 gap-2";
          const isTouchDropTarget = touchDrag?.isActive && touchDropTargetStatus === status;

          return (
            <Card
              key={status}
              data-service-board-status={status}
              className={`min-h-[520px] min-w-0 max-w-full gap-2 rounded-3xl py-2 backdrop-blur transition-shadow ${statusTheme.column} ${isTouchDropTarget ? "ring-4 ring-status-info-border/80 shadow-xl shadow-sky-200/60" : ""}`}
              onDragOver={(event) => { if (allowDragging && !noteEditMode) event.preventDefault(); }}
              onDrop={(event) => {
                if (!allowDragging || noteEditMode) return;
                const jobId = event.dataTransfer.getData("jobId");
                dropJob(jobId, status);
              }}
            >
            <CardHeader className="@container gap-2 px-2" data-service-board-column-header>
              <div className="flex min-w-0 flex-wrap items-start gap-1.5">
                <div className="flex shrink-0 items-center gap-1.5">
                  <CardTitle className="whitespace-nowrap text-sm">{status}</CardTitle>
                  <Badge aria-label={`${status} matching jobs`} className={`shrink-0 ${statusTheme.badge}`}>{columnJobs.length}</Badge>
                </div>
                <ServiceBoardSortSelect status={status} sortMode={sortMode} onChange={(nextSortMode) => onColumnSortModeChange?.(status, nextSortMode)} />
                <ServiceBoardViewToggle status={status} viewMode={viewMode} onChange={(nextViewMode) => onColumnViewModeChange?.(status, nextViewMode)} />
              </div>
            </CardHeader>
            <CardContent className="@container min-w-0 max-w-full px-1.5">
              <div className={`w-full min-w-0 max-w-full ${jobLayoutClassName}`}>
                {sortedColumnJobs.length === 0 ? (
                  <div className={viewMode === "grid" ? "col-span-full" : ""}>
                    <EmptyState
                      title={`No jobs in ${status}`}
                      text={allowDragging ? "Drag a card here to update its status." : "Jobs assigned to this status will appear here."}
                    />
                  </div>
                ) : (
                  visibleJobs.map((job) => (
                    <JobCard
                      noteEditMode={noteEditMode}
                      onEditNote={editNote}
                      key={`${job.id}-${viewMode}`}
                      job={job}
                      onOpen={openJob}
                      draggable={allowDragging}
                      viewMode={viewMode}
                      showTagLabels={showTagLabels}
                      isPlannedForTomorrow={job.serviceBoardTomorrowDate === tomorrowPlanningDate}
                      isTouchDragging={Boolean(touchDrag?.isActive && touchDrag.jobId === job.id)}
                      onPlanForTomorrow={
                        onPlanJobForTomorrow && job.serviceBoardTomorrowDate !== tomorrowPlanningDate
                          ? planForTomorrow
                          : null
                      }
                      onTouchDragStart={allowDragging ? handleTouchDragStart : null}
                      formatDate={formatDate}
                      getInvoiceStatus={getInvoiceStatus}
                      statusDateKey={tomorrowPlanningDate}
                    />
                  ))
                )}
              </div>
              {status === "Completed" ? <CompletedShowMore visibleLimit={visibleLimit} totalCount={columnJobs.length} onShowMore={showMore} /> : null}
            </CardContent>
          </Card>
        );
        })}
      </div>
    </div>
  );
}
