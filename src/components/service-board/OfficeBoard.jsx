import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronRight, Columns3, Eye, EyeOff, LayoutGrid, List, Minimize2, Rows3, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { statuses, statusThemes } from "@/lib/job-status";
import { calculateInvoiceTotal, calculateQuoteTotal, money } from "@/lib/quote-template";

const serviceBoardViewOptions = [
  { value: "list", label: "List", icon: List },
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "compact", label: "Compact", icon: Rows3 },
];

const serviceBoardSortOptions = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "urgency", label: "Urgency" },
  { value: "customer", label: "Customer" },
  { value: "scheduled", label: "Scheduled" },
  { value: "value", label: "Highest Value" },
];

const serviceBoardIndicatorLegend = [
  { id: "quote", label: "Quote sent", dotClassName: "bg-cyan-500" },
  { id: "invoice-draft", label: "Invoice draft", dotClassName: "bg-orange-500" },
  { id: "invoice-pending", label: "Outstanding invoice", dotClassName: "bg-violet-500" },
  { id: "invoice-paid", label: "Invoice paid", dotClassName: "bg-emerald-500" },
  { id: "invoice-attention", label: "Invoice needs attention", dotClassName: "bg-rose-500" },
  { id: "manuals", label: "Supplier manual", dotClassName: "bg-indigo-500" },
  { id: "maintenance", label: "Maintenance", dotClassName: "bg-teal-500" },
  { id: "access", label: "Access notes", dotClassName: "bg-amber-500" },
];

const TOUCH_DRAG_HOLD_MS = 180;
const TOUCH_DRAG_CANCEL_DISTANCE = 10;
const TOUCH_DRAG_ACTIVATE_DISTANCE = 6;

function getSiteAccessNotePreview(notes) {
  if (!notes) return "";

  return (
    String(notes)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

function getJobValueMeta(job) {
  if (job?.invoice) {
    const total = calculateInvoiceTotal(job.invoice.items || []);
    return {
      label: "Invoice",
      amount: money(total),
      total,
    };
  }

  if (job?.quote) {
    const total = calculateQuoteTotal(job.quote.items || []);
    return {
      label: "Quote",
      amount: money(total),
      total,
    };
  }

  return null;
}

function toSortTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getUrgencyRank(urgency) {
  const ranks = { High: 0, Medium: 1, Low: 2 };
  return ranks[urgency] ?? 3;
}

function getJobValueAmount(job) {
  if (job?.invoice) return calculateInvoiceTotal(job.invoice.items || []);
  if (job?.quote) return calculateQuoteTotal(job.quote.items || []);
  return 0;
}

function formatStreetAndSuburb(address) {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "Site not set";

  const street = parts[0];
  const suburbSource = parts[1] || parts[0];
  const suburb = suburbSource
    .replace(/\b(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\b/gi, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return suburb && suburb !== street ? `${street}, ${suburb}` : street;
}

function getTrackedTouch(touchList, touchId) {
  if (!touchList) return null;
  return Array.from(touchList).find((touch) => touch.identifier === touchId) || null;
}

function isInteractiveTouchTarget(target) {
  return target instanceof Element && Boolean(
    target.closest("button, a, input, select, textarea, [role='button'], [data-slot='select-trigger']")
  );
}

function sortJobsForColumn(jobs, sortMode = "recent") {
  return [...jobs].sort((a, b) => {
    if (sortMode === "oldest") {
      return toSortTimestamp(a.createdAt) - toSortTimestamp(b.createdAt) || (a.jobNumber || 0) - (b.jobNumber || 0);
    }

    if (sortMode === "urgency") {
      return getUrgencyRank(a.urgency) - getUrgencyRank(b.urgency)
        || toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    if (sortMode === "customer") {
      return a.customerName.localeCompare(b.customerName)
        || toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    if (sortMode === "scheduled") {
      const aScheduled = a.scheduledDate ? toSortTimestamp(a.scheduledDate) : Number.POSITIVE_INFINITY;
      const bScheduled = b.scheduledDate ? toSortTimestamp(b.scheduledDate) : Number.POSITIVE_INFINITY;
      return aScheduled - bScheduled
        || getUrgencyRank(a.urgency) - getUrgencyRank(b.urgency)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    if (sortMode === "value") {
      return getJobValueAmount(b) - getJobValueAmount(a)
        || toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    return toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
      || (b.jobNumber || 0) - (a.jobNumber || 0);
  });
}

function buildJobCardIndicators({ job, manualMatches, invoiceStatus, siteAccessPreview }) {
  const indicators = [];
  const quoteSent = Boolean(job.quote?.sentHistory?.length);
  const showInvoiceStatus = Boolean(job.invoice) || job.status === "Completed";

  if (quoteSent) {
    indicators.push({
      id: "quote",
      label: "Quoted",
      dotClassName: "bg-cyan-500",
    });
  }

  if (showInvoiceStatus) {
    if (invoiceStatus.id === "paid") {
      indicators.push({
        id: "invoice-paid",
        label: "Invoice Paid",
        dotClassName: "bg-emerald-500",
      });
    } else if (invoiceStatus.id === "draft") {
      indicators.push({
        id: "invoice-draft",
        label: "Draft Invoice",
        dotClassName: "bg-orange-500",
      });
    } else if (invoiceStatus.id === "overdue" || invoiceStatus.id === "not-invoiced") {
      indicators.push({
        id: "invoice-attention",
        label: invoiceStatus.label,
        dotClassName: "bg-rose-500",
      });
    } else {
      indicators.push({
        id: "invoice-pending",
        label: invoiceStatus.label,
        dotClassName: "bg-violet-500",
      });
    }
  }

  if (manualMatches.length > 0) {
    indicators.push({
      id: "manuals",
      label: `${manualMatches.length} manual${manualMatches.length === 1 ? "" : "s"}`,
      dotClassName: "bg-indigo-500",
    });
  }

  if (job.maintenancePlanName) {
    indicators.push({
      id: "maintenance",
      label: "Maintenance",
      dotClassName: "bg-teal-500",
    });
  }

  if (siteAccessPreview) {
    indicators.push({
      id: "access",
      label: "Access Notes",
      dotClassName: "bg-amber-500",
    });
  }

  return indicators;
}

function ServiceBoardViewToggle({ status, viewMode, onChange }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/80 bg-white/85 p-1 shadow-sm">
      {serviceBoardViewOptions.map(({ value, label, icon }) => {
        const isActive = viewMode === value;
        const ViewIcon = icon;
        return (
          <Button
            key={value}
            type="button"
            size="xs"
            variant={isActive ? "secondary" : "ghost"}
            className={isActive ? "rounded-lg bg-slate-900 px-2 text-white hover:bg-slate-900/90 hover:text-white 2xl:px-2.5" : "rounded-lg px-2 text-slate-600 hover:text-slate-900 2xl:px-2.5"}
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
        className="h-8 min-w-[96px] rounded-lg border-slate-300 bg-white text-xs font-medium 2xl:min-w-[120px]"
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
  showTagLabels,
  onToggleShowTagLabels,
  hiddenColumnCount = 0,
  onShowHiddenColumns = null,
  tone = "default",
}) {
  const isHeroTone = tone === "hero";
  const hasHiddenColumns = hiddenColumnCount > 0;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 ${isHeroTone ? "border-white/20" : "border-slate-200/80"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${isHeroTone ? "text-white/70" : "text-slate-500"}`}>Legend</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {serviceBoardIndicatorLegend.map((indicator) => (
          <div key={indicator.id} className={`inline-flex items-center gap-1.5 text-[11px] ${isHeroTone ? "text-white/90" : "text-slate-700"}`}>
            <span className={`h-2 w-2 rounded-full ${indicator.dotClassName}`} />
            <span>{indicator.label}</span>
          </div>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={`rounded-xl ${isHeroTone ? "border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" : "bg-slate-50"}`}
          disabled={!hasHiddenColumns}
          onClick={onShowHiddenColumns || undefined}
          title={hasHiddenColumns ? "Show hidden columns" : "No hidden columns"}
        >
          <Eye className="h-4 w-4" />
          Show Columns
          {hasHiddenColumns ? <Badge variant="secondary">{hiddenColumnCount}</Badge> : null}
        </Button>
        <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${isHeroTone ? "border-white/20 bg-white/10" : "border-slate-200 bg-slate-50"}`}>
          <Checkbox checked={showTagLabels} onCheckedChange={(checked) => onToggleShowTagLabels(Boolean(checked))} />
          <span className={`text-[11px] ${isHeroTone ? "text-white/90" : "text-slate-700"}`}>Show tag info</span>
        </div>
      </div>
    </div>
  );
}

function TomorrowJobCard({ job, formatDate, onOpenJob, onRemoveJob }) {
  const urgencyTone = {
    Low: "bg-slate-100 text-slate-700",
    Medium: "bg-amber-100 text-amber-800",
    High: "bg-rose-100 text-rose-800",
  };
  const statusTheme = statusThemes[job.status] || statusThemes["To Do"];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${statusTheme.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
          <p className="mt-1 font-semibold leading-5 text-slate-950">{job.customerName}</p>
          <p className="mt-1 text-sm text-slate-700">{job.title}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge className={statusTheme.badge}>{job.status}</Badge>
          {job.status !== "Completed" ? <Badge className={urgencyTone[job.urgency] || urgencyTone.Low}>{job.urgency}</Badge> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-slate-600">
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0">Site</span>
          <span className="line-clamp-2 max-w-[240px] text-right font-medium text-slate-800">{job.jobAddress || "Not set"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Tech</span>
          <span className="text-right font-medium text-slate-800">{job.assignedTechnicianName || "Unassigned"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Scheduled</span>
          <span className="text-right font-medium text-slate-800">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
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
}

export function ServiceBoardTomorrowPanel({
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
        type="button"
        variant="outline"
        className="fixed top-1/2 z-[60] flex -translate-y-1/2 rotate-90 items-center gap-2 rounded-b-2xl rounded-t-none border-slate-300 bg-white/95 px-3 py-2 shadow-lg transition-all duration-300 hover:bg-white"
        style={{ right: open ? `calc(${panelWidth} - ${tabEdgeOffset}px)` : `${-tabEdgeOffset}px` }}
        onClick={() => onOpenChange(!open)}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Tomorrow</span>
        <Badge className="bg-sky-100 text-sky-800">{jobs.length}</Badge>
        <ChevronRight className={`h-4 w-4 text-slate-600 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </Button>

      <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
        <button
          type="button"
          className="absolute inset-0 bg-slate-950/18 backdrop-blur-[1px]"
          onClick={() => onOpenChange(false)}
          aria-label="Close tomorrow panel"
        />
      </div>

      <aside
        className={`fixed right-0 top-0 z-50 h-screen w-[min(92vw,440px)] border-l border-slate-200 bg-white/96 shadow-2xl backdrop-blur transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Tomorrow</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{formatDate(tomorrowDate)}</p>
                <p className="mt-2 text-sm text-slate-600">
                  Build tomorrow&apos;s run sheet from the board using the hover arrow on each job card.
                </p>
              </div>
              <Button type="button" variant="outline" size="icon" className="rounded-xl" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-600">Planned jobs</span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={() => onRemoveAllJobs?.()}
                  disabled={jobs.length === 0}
                >
                  Remove all
                </Button>
                <Badge className="bg-sky-100 text-sky-800">{jobs.length}</Badge>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">
                Hover a job card and click the arrow to send it here.
              </div>
            ) : (
              <div className="grid gap-3">
                {jobs.map((job) => (
                  <TomorrowJobCard
                    key={job.id}
                    job={job}
                    formatDate={formatDate}
                    onOpenJob={onOpenJob}
                    onRemoveJob={onRemoveJob}
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
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {indicators.map((indicator) =>
        showTagLabels ? (
          <div
            key={indicator.id}
            className="inline-flex items-center gap-2 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600"
            title={indicator.label}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${indicator.dotClassName}`} />
            {indicator.label}
          </div>
        ) : (
          <span
            key={indicator.id}
            className={`inline-flex h-3.5 w-3.5 rounded-full ring-2 ring-white/85 ${indicator.dotClassName}`}
            title={indicator.label}
            aria-label={indicator.label}
          />
        )
      )}
    </div>
  );
}

function JobCard({
  job,
  onOpen,
  manualMatches = [],
  siteAccessNote = null,
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
    Low: "bg-slate-100 text-slate-700",
    Medium: "bg-amber-100 text-amber-800",
    High: "bg-rose-100 text-rose-800",
  };
  const statusTheme = statusThemes[job.status] || statusThemes["To Do"];
  const invoiceStatus = getInvoiceStatus(job);
  const siteAccessPreview = getSiteAccessNotePreview(siteAccessNote?.notes);
  const jobValueMeta = getJobValueMeta(job);
  const isGridView = viewMode === "grid";
  const isCompactView = viewMode === "compact";
  const [isCompactExpanded, setIsCompactExpanded] = useState(false);
  const cardClassName = `${isGridView ? "h-full overflow-visible rounded-2xl" : isCompactView ? "rounded-xl" : "rounded-2xl"} select-none shadow-sm transition hover:shadow-md ${statusTheme.card} ${isTouchDragging ? "opacity-45" : ""}`;
  const cardContentClassName = isGridView ? "flex h-full flex-col px-3.5 py-1 md:max-xl:px-3 md:max-xl:py-0.5" : isCompactView ? "px-2.5 py-0" : "p-4";
  const descriptionClassName = isCompactView ? "mt-2 line-clamp-1 text-sm text-slate-700" : isGridView ? "mt-2 line-clamp-2 text-sm text-slate-700" : "mt-3 line-clamp-3 text-sm text-slate-700";
  const actionRowClassName = isCompactView ? "mt-3 flex flex-wrap gap-2" : "mt-4 flex flex-wrap gap-2";
  const cardIndicators = buildJobCardIndicators({
    job,
    manualMatches,
    invoiceStatus,
    siteAccessPreview,
  });
  const stopDoubleClickPropagation = (event) => event.stopPropagation();
  const handleCardDoubleClick = () => onOpen(job);
  const shouldShowHeaderMeta = Boolean(jobValueMeta) || job.status !== "Completed";
  const compactAddress = formatStreetAndSuburb(job.jobAddress);
  const tomorrowActionPositionClassName = isGridView || isCompactView ? "right-0 top-0 translate-x-1/2 -translate-y-1/2" : "right-2 top-2";
  const tomorrowAction = isPlannedForTomorrow ? (
    <span
      className={`absolute z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/95 text-[10px] font-bold text-white shadow-sm ring-2 ring-white/90 ${tomorrowActionPositionClassName}`}
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
      className={`service-board-tomorrow-action absolute z-10 h-8 w-8 rounded-full border-sky-200 bg-white/95 text-sky-700 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100 ${tomorrowActionPositionClassName}`}
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
    event.dataTransfer.setData("jobId", job.id);
  };

  if (isCompactView) {
    return (
      <div
        className="group relative"
        draggable={draggable}
        onDragStart={handleDragStart}
        onDoubleClick={handleCardDoubleClick}
        onTouchStart={onTouchDragStart ? (event) => onTouchDragStart(job, event) : undefined}
        title="Double-click to open job"
      >
        <JobCardIndicators
          indicators={cardIndicators}
          showTagLabels={false}
          className="pointer-events-none absolute left-0 top-0 z-20 -translate-y-1/2 gap-1.5"
        />
        {tomorrowAction}
        <Card className={cardClassName}>
          <CardContent className={cardContentClassName}>
            <button
              type="button"
              className="flex w-full items-start justify-between gap-2 text-left"
              onClick={() => setIsCompactExpanded((prev) => !prev)}
              aria-expanded={isCompactExpanded}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-semibold leading-4 text-slate-950">{job.customerName}</p>
                    <p className="line-clamp-1 text-[11px] leading-4 text-slate-600">{job.title}</p>
                    <p className="line-clamp-1 text-[11px] font-medium leading-4 text-slate-700">{compactAddress}</p>
                  </div>
                  {shouldShowHeaderMeta ? (
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {jobValueMeta ? (
                        <div className="rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-900 shadow-sm" title={`${jobValueMeta.label} value`}>
                          {jobValueMeta.amount}
                        </div>
                      ) : null}
                      {job.status !== "Completed" ? <Badge className={urgencyTone[job.urgency]}>{job.urgency}</Badge> : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-sm">
                <ChevronRight className={`h-4 w-4 transition-transform ${isCompactExpanded ? "rotate-90" : ""}`} />
              </span>
            </button>

            {isCompactExpanded ? (
              <div className="mt-3 grid gap-3 border-t border-white/80 pt-3 text-xs text-slate-600">
                <div className="rounded-xl border border-white/80 bg-white/70 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="shrink-0 text-slate-500">Site</span>
                    <span className="text-right font-medium text-slate-800">{compactAddress}</span>
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
      className={`group relative ${isGridView ? "h-full" : ""}`}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDoubleClick={handleCardDoubleClick}
      onTouchStart={onTouchDragStart ? (event) => onTouchDragStart(job, event) : undefined}
      title="Double-click to open job"
    >
      {isGridView ? (
        <JobCardIndicators
          indicators={cardIndicators}
          showTagLabels={false}
          className="pointer-events-none absolute left-0 top-0 z-20 -translate-y-1/2 gap-1.5"
        />
      ) : null}
      {tomorrowAction}
      <Card className={cardClassName}>
        <CardContent className={cardContentClassName}>
          {isGridView ? (
            <div className="flex h-full flex-col justify-between gap-4">
              <div className="space-y-1.5 pr-10 md:max-xl:space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:max-xl:text-[10px]">Job #{job.jobNumber}</p>
                <p className="text-sm font-medium leading-5 text-slate-800 md:max-xl:text-xs md:max-xl:leading-4">{job.customerName}</p>
                <p className="text-xs font-normal leading-4 text-slate-950 md:max-xl:text-[11px] md:max-xl:leading-[1.1rem]">{job.title}</p>
                <p className="line-clamp-3 text-xs leading-4 text-slate-700 md:max-xl:text-[11px] md:max-xl:leading-[1.1rem]">{compactAddress}</p>
              </div>

            </div>
          ) : (
            <>
          <JobCardIndicators indicators={cardIndicators} showTagLabels={showTagLabels} className="mb-2" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
              <p className="font-semibold leading-5 text-slate-950">{job.customerName}</p>
              <p className="text-xs text-slate-600">{job.title}</p>
            </div>
            {shouldShowHeaderMeta ? (
              <div className="flex shrink-0 flex-col items-end gap-2">
                {jobValueMeta ? (
                  <div className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-slate-900 shadow-sm" title={`${jobValueMeta.label} value`}>
                    {jobValueMeta.amount}
                  </div>
                ) : null}
                {job.status !== "Completed" ? <Badge className={urgencyTone[job.urgency]}>{job.urgency}</Badge> : null}
              </div>
            ) : null}
          </div>

          {job.description ? <p className={descriptionClassName}>{job.description}</p> : null}

          {viewMode === "list" ? (
            <div className="mt-4 grid gap-2 text-xs text-slate-600">
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0">Site</span>
                <span className="line-clamp-2 max-w-[220px] text-right font-medium text-slate-800">{job.jobAddress || "Not set"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Tech</span>
                <span className="font-medium text-slate-800">{job.assignedTechnicianName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Scheduled</span>
                <span className="font-medium text-slate-800">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 text-xs text-slate-600">
              <div className="rounded-xl border border-white/80 bg-white/70 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="shrink-0 text-slate-500">Site</span>
                  <span className="line-clamp-2 text-right font-medium text-slate-800">{job.jobAddress || "Not set"}</span>
                </div>
              </div>
              {!isGridView ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span>Tech</span>
                    <span className="font-medium text-slate-800">{job.assignedTechnicianName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Scheduled</span>
                    <span className="font-medium text-slate-800">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
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
}

export function OfficeBoard({
  jobs,
  customers = [],
  onDropJob,
  onOpenJob,
  supplierManuals = [],
  allowDragging = true,
  columnSortModes = {},
  columnViewModes = {},
  onColumnSortModeChange,
  onColumnViewModeChange,
  onPlanJobForTomorrow,
  showTagLabels = false,
  findSupplierManualMatches,
  getCustomerSiteAccessNote,
  getInvoiceStatus,
  formatDate,
  tomorrowPlanningDate = "",
  hiddenColumnStatuses = [],
  onHideColumn,
}) {
  const [focusedColumnStatus, setFocusedColumnStatus] = useState("");
  const [touchDrag, setTouchDrag] = useState(null);
  const [touchDropTargetStatus, setTouchDropTargetStatus] = useState("");
  const touchDragSessionRef = useRef(null);
  const touchDragHoldTimerRef = useRef(null);
  const manualMatchesByJobId = useMemo(() => {
    return new Map(jobs.map((job) => [job.id, findSupplierManualMatches(job, supplierManuals, 3)]));
  }, [findSupplierManualMatches, jobs, supplierManuals]);

  const siteAccessNotesByJobId = useMemo(() => {
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));
    return new Map(
      jobs.map((job) => [job.id, getCustomerSiteAccessNote(customersById.get(job.customerId), job.jobAddress)])
    );
  }, [customers, getCustomerSiteAccessNote, jobs]);

  const clearTouchDragHoldTimer = useCallback(() => {
    if (touchDragHoldTimerRef.current) {
      window.clearTimeout(touchDragHoldTimerRef.current);
      touchDragHoldTimerRef.current = null;
    }
  }, []);

  const syncTouchDrag = useCallback((nextSession) => {
    touchDragSessionRef.current = nextSession;
    setTouchDrag(nextSession);
  }, []);

  const clearTouchDragSession = useCallback(() => {
    clearTouchDragHoldTimer();
    touchDragSessionRef.current = null;
    setTouchDrag(null);
    setTouchDropTargetStatus("");
  }, [clearTouchDragHoldTimer]);

  const getTouchDropStatus = useCallback((clientX, clientY) => {
    const statusElement = document.elementFromPoint(clientX, clientY)?.closest?.("[data-service-board-status]");
    return statusElement?.getAttribute("data-service-board-status") || "";
  }, []);

  const handleTouchDragStart = useCallback((job, event) => {
    if (!allowDragging || event.touches.length !== 1 || isInteractiveTouchTarget(event.target)) {
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
    syncTouchDrag(nextSession);
    setTouchDropTargetStatus("");

    touchDragHoldTimerRef.current = window.setTimeout(() => {
      const currentSession = touchDragSessionRef.current;
      if (!currentSession || currentSession.jobId !== job.id || currentSession.touchId !== touch.identifier) {
        return;
      }

      syncTouchDrag({
        ...currentSession,
        isPrimed: true,
      });
    }, TOUCH_DRAG_HOLD_MS);
  }, [allowDragging, clearTouchDragHoldTimer, syncTouchDrag]);

  useEffect(() => {
    if (!touchDrag) return undefined;

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

      const nextSession = {
        ...currentSession,
        clientX: touch.clientX,
        clientY: touch.clientY,
        isActive: currentSession.isActive || movement > TOUCH_DRAG_ACTIVATE_DISTANCE,
      };

      syncTouchDrag(nextSession);

      if (nextSession.isActive) {
        event.preventDefault();
        setTouchDropTargetStatus(getTouchDropStatus(touch.clientX, touch.clientY));
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
        onDropJob(currentSession.jobId, dropStatus);
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
  }, [clearTouchDragSession, getTouchDropStatus, onDropJob, syncTouchDrag, touchDrag]);

  useEffect(() => {
    return () => {
      clearTouchDragHoldTimer();
    };
  }, [clearTouchDragHoldTimer]);

  const hiddenStatusSet = useMemo(() => new Set(hiddenColumnStatuses), [hiddenColumnStatuses]);
  const visibleStatuses = focusedColumnStatus
    ? statuses.filter((status) => status === focusedColumnStatus)
    : statuses.filter((status) => !hiddenStatusSet.has(status));
  const boardGridClassName = focusedColumnStatus || visibleStatuses.length <= 1
    ? "grid-cols-1"
    : visibleStatuses.length === 2
      ? "lg:grid-cols-2"
      : "lg:grid-cols-3";

  const handleHideColumn = (status) => {
    setFocusedColumnStatus((currentStatus) => (currentStatus === status ? "" : currentStatus));
    onHideColumn?.(status);
  };

  return (
    <div className="relative grid gap-4">
      {touchDrag?.isActive ? (
        <div
          className="pointer-events-none fixed z-[80] w-[200px] -translate-y-1/2 rounded-2xl border border-sky-300 bg-white/96 px-3 py-2 shadow-2xl backdrop-blur"
          style={{
            left: touchDrag.clientX,
            top: touchDrag.clientY,
            transform: "translate(18px, -50%)",
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Move Job #{touchDrag.jobNumber}</p>
          <p className="mt-1 text-sm font-semibold leading-5 text-slate-950">{touchDrag.customerName}</p>
          <p className="line-clamp-2 text-xs leading-4 text-slate-600">{touchDrag.title}</p>
        </div>
      ) : null}
      <div className={`grid gap-4 ${boardGridClassName}`}>
        {visibleStatuses.map((status) => {
          const columnJobs = jobs.filter((job) => job.status === status);
          const sortedColumnJobs = sortJobsForColumn(columnJobs, columnSortModes[status] || "recent");
          const statusTheme = statusThemes[status] || statusThemes["To Do"];
          const sortMode = columnSortModes[status] || "recent";
          const viewMode = columnViewModes[status] || "list";
          const isFocusedColumn = focusedColumnStatus === status;
          const shouldAutoFillGridCards = isFocusedColumn || visibleStatuses.length < statuses.length;
          const jobLayoutClassName = viewMode === "grid"
            ? shouldAutoFillGridCards
              ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]"
              : "grid grid-cols-1 gap-3 sm:grid-cols-2"
            : viewMode === "compact" ? "grid gap-2" : "grid gap-4";
          const isTouchDropTarget = touchDrag?.isActive && touchDropTargetStatus === status;

          return (
            <Card
              key={status}
              data-service-board-status={status}
              className={`min-h-[520px] rounded-3xl backdrop-blur transition-shadow ${statusTheme.column} ${isTouchDropTarget ? "ring-4 ring-sky-300/80 shadow-xl shadow-sky-200/60" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const jobId = event.dataTransfer.getData("jobId");
                onDropJob(jobId, status);
              }}
            >
            <CardHeader className="gap-4">
              <div className="grid gap-2">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <CardTitle className="min-w-0">{status}</CardTitle>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-xl bg-white/80"
                      onClick={() => setFocusedColumnStatus(isFocusedColumn ? "" : status)}
                      title={isFocusedColumn ? "Show all columns" : `Show only ${status}`}
                      aria-label={isFocusedColumn ? "Show all columns" : `Show only ${status}`}
                    >
                      {isFocusedColumn ? <Columns3 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-xl bg-white/80"
                      onClick={() => handleHideColumn(status)}
                      title={`Hide ${status}`}
                      aria-label={`Hide ${status}`}
                    >
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 2xl:justify-end 2xl:gap-2">
                  <ServiceBoardSortSelect status={status} sortMode={sortMode} onChange={(nextSortMode) => onColumnSortModeChange?.(status, nextSortMode)} />
                  <ServiceBoardViewToggle status={status} viewMode={viewMode} onChange={(nextViewMode) => onColumnViewModeChange?.(status, nextViewMode)} />
                  <Badge className={`shrink-0 ${statusTheme.badge}`}>{columnJobs.length}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className={jobLayoutClassName}>
                {sortedColumnJobs.length === 0 ? (
                  <div className={viewMode === "grid" ? "col-span-full" : ""}>
                    <EmptyState
                      title={`No jobs in ${status}`}
                      text={allowDragging ? "Drag a card here to update its status." : "Jobs assigned to this status will appear here."}
                    />
                  </div>
                ) : (
                  sortedColumnJobs.map((job) => (
                    <JobCard
                      key={`${job.id}-${viewMode}`}
                      job={job}
                      onOpen={onOpenJob}
                      manualMatches={manualMatchesByJobId.get(job.id) || []}
                      siteAccessNote={siteAccessNotesByJobId.get(job.id) || null}
                      draggable={allowDragging}
                      viewMode={viewMode}
                      showTagLabels={showTagLabels}
                      isPlannedForTomorrow={job.serviceBoardTomorrowDate === tomorrowPlanningDate}
                      isTouchDragging={touchDrag?.isActive && touchDrag.jobId === job.id}
                      onPlanForTomorrow={
                        onPlanJobForTomorrow && job.serviceBoardTomorrowDate !== tomorrowPlanningDate
                          ? onPlanJobForTomorrow
                          : null
                      }
                      onTouchDragStart={allowDragging ? handleTouchDragStart : null}
                      formatDate={formatDate}
                      getInvoiceStatus={getInvoiceStatus}
                    />
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        );
        })}
      </div>
    </div>
  );
}
