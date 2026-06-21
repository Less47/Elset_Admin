import { useMemo, useState } from "react";
import { ChevronRight, LayoutGrid, List, Rows3, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { statuses, statusThemes } from "@/lib/job-status";
import { calculateDocTotal, money } from "@/lib/quote-template";

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
    const total = calculateDocTotal(job.invoice.items || []);
    return {
      label: "Invoice",
      amount: money(total),
      total,
    };
  }

  if (job?.quote) {
    const total = calculateDocTotal(job.quote.items || []);
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
  if (job?.invoice) return calculateDocTotal(job.invoice.items || []);
  if (job?.quote) return calculateDocTotal(job.quote.items || []);
  return 0;
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

export function ServiceBoardTagLegend({ showTagLabels, onToggleShowTagLabels, tone = "default" }) {
  const isHeroTone = tone === "hero";

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
      <div className={`ml-auto flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${isHeroTone ? "border-white/20 bg-white/10" : "border-slate-200 bg-slate-50"}`}>
        <Checkbox checked={showTagLabels} onCheckedChange={(checked) => onToggleShowTagLabels(Boolean(checked))} />
        <span className={`text-[11px] ${isHeroTone ? "text-white/90" : "text-slate-700"}`}>Show tag info</span>
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

export function ServiceBoardTomorrowPlanner({
  jobs,
  tomorrowDate,
  onDropJob,
  onOpenJob,
  onRemoveJob,
  formatDate,
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <Card
      className={`rounded-3xl border-slate-200 bg-white/80 shadow-sm backdrop-blur transition ${isDragOver ? "ring-2 ring-sky-300/80" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        const jobId = event.dataTransfer.getData("jobId");
        setIsDragOver(false);
        onDropJob(jobId);
      }}
    >
      <CardContent className="grid gap-4 p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Tomorrow</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">{formatDate(tomorrowDate)}</p>
            <p className="mt-1 text-sm text-slate-600">
              Drag jobs here to line up tomorrow&apos;s run sheet without changing their current status on the board.
            </p>
          </div>
          <Badge className="w-fit bg-sky-100 text-sky-800">
            {jobs.length} planned
          </Badge>
        </div>

        {jobs.length === 0 ? (
          <div className={`rounded-2xl border-2 border-dashed px-5 py-8 text-center text-sm transition ${isDragOver ? "border-sky-400 bg-sky-50 text-sky-900" : "border-slate-300 bg-slate-50 text-slate-600"}`}>
            Drop jobs here to build tomorrow&apos;s list.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
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
      </CardContent>
    </Card>
  );
}

function JobCardIndicators({ indicators, showTagLabels, className = "mt-2" }) {
  if (indicators.length === 0) return null;

  return (
    <div className={`${className} flex flex-wrap items-center gap-2`}>
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
  onQuickStatusChange,
  manualMatches = [],
  siteAccessNote = null,
  draggable = false,
  allowQuickStatusChange = false,
  viewMode = "list",
  showTagLabels = false,
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
  const cardClassName = `${isGridView ? "h-full rounded-2xl" : isCompactView ? "rounded-xl" : "rounded-2xl"} select-none shadow-sm transition hover:shadow-md ${statusTheme.card}`;
  const cardContentClassName = isGridView ? "flex h-full flex-col p-3.5" : isCompactView ? "p-3.5" : "p-4";
  const descriptionClassName = isCompactView ? "mt-2 line-clamp-1 text-sm text-slate-700" : isGridView ? "mt-2 line-clamp-2 text-sm text-slate-700" : "mt-3 line-clamp-3 text-sm text-slate-700";
  const actionRowClassName = isGridView ? "mt-auto flex flex-wrap gap-2 pt-4" : isCompactView ? "mt-3 flex flex-wrap gap-2" : "mt-4 flex flex-wrap gap-2";
  const statusRowClassName = `flex gap-3 ${allowQuickStatusChange ? "items-start justify-between" : "items-center justify-between"}`;
  const cardIndicators = buildJobCardIndicators({
    job,
    manualMatches,
    invoiceStatus,
    siteAccessPreview,
  });
  const stopDoubleClickPropagation = (event) => event.stopPropagation();
  const handleCardDoubleClick = () => onOpen(job);
  const shouldShowHeaderMeta = Boolean(jobValueMeta) || job.status !== "Completed";

  const statusControl = allowQuickStatusChange ? (
    <div className={isCompactView ? "w-[140px]" : "w-[150px]"}>
      <Select value={job.status} onValueChange={(value) => onQuickStatusChange?.(job.id, value)}>
        <SelectTrigger className="h-8 rounded-lg border-slate-300 bg-white text-xs font-medium">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((status) => (
            <SelectItem key={status} value={status}>
              {status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : (
    <Badge className={statusTheme.badge}>{job.status}</Badge>
  );

  const handleDragStart = (event) => {
    event.dataTransfer.setData("jobId", job.id);
  };

  if (isCompactView) {
    return (
      <div draggable={draggable} onDragStart={handleDragStart} onDoubleClick={handleCardDoubleClick} title="Double-click to open job">
        <Card className={cardClassName}>
          <CardContent className={cardContentClassName}>
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 text-left"
              onClick={() => setIsCompactExpanded((prev) => !prev)}
              aria-expanded={isCompactExpanded}
            >
              <div className="min-w-0 flex-1">
                <JobCardIndicators indicators={cardIndicators} showTagLabels={showTagLabels} className="mb-2" />

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
                    <p className="text-sm font-semibold leading-5 text-slate-950">{job.customerName}</p>
                    <p className="line-clamp-1 text-[11px] text-slate-600">{job.title}</p>
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

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  <span className="truncate font-medium text-slate-700">{job.assignedTechnicianName}</span>
                  <span>{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
                </div>
              </div>

              <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-sm">
                <ChevronRight className={`h-4 w-4 transition-transform ${isCompactExpanded ? "rotate-90" : ""}`} />
              </span>
            </button>

            {isCompactExpanded ? (
              <div className="mt-3 grid gap-3 border-t border-white/80 pt-3 text-xs text-slate-600">
                {job.description ? <p className="text-sm text-slate-700">{job.description}</p> : null}
                <div className="rounded-xl border border-white/80 bg-white/70 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="shrink-0 text-slate-500">Site</span>
                    <span className="text-right font-medium text-slate-800">{job.jobAddress || "Not set"}</span>
                  </div>
                  {siteAccessPreview ? <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-amber-900">Access: {siteAccessPreview}</p> : null}
                </div>
                <div className="grid gap-2">
                  <div className={statusRowClassName}>
                    <span>Status</span>
                    {statusControl}
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
      className={isGridView ? "h-full" : undefined}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDoubleClick={handleCardDoubleClick}
      title="Double-click to open job"
    >
      <Card className={cardClassName}>
        <CardContent className={cardContentClassName}>
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
              {siteAccessPreview ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Access</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-950">{siteAccessPreview}</p>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span>Tech</span>
                <span className="font-medium text-slate-800">{job.assignedTechnicianName}</span>
              </div>
              <div className={statusRowClassName}>
                <span>Status</span>
                {statusControl}
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
                {siteAccessPreview ? <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-amber-900">Access: {siteAccessPreview}</p> : null}
              </div>
              {!isGridView ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span>Tech</span>
                    <span className="font-medium text-slate-800">{job.assignedTechnicianName}</span>
                  </div>
                  <div className={statusRowClassName}>
                    <span>Status</span>
                    {statusControl}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Scheduled</span>
                    <span className="font-medium text-slate-800">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className={actionRowClassName}>
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => onOpen(job)} onDoubleClick={stopDoubleClickPropagation}>
              View Job
            </Button>
          </div>
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
  onQuickStatusChange,
  supplierManuals = [],
  allowDragging = true,
  allowQuickStatusChange = false,
  columnSortModes = {},
  columnViewModes = {},
  onColumnSortModeChange,
  onColumnViewModeChange,
  showTagLabels = false,
  findSupplierManualMatches,
  getCustomerSiteAccessNote,
  getInvoiceStatus,
  formatDate,
}) {
  const manualMatchesByJobId = useMemo(() => {
    return new Map(jobs.map((job) => [job.id, findSupplierManualMatches(job, supplierManuals, 3)]));
  }, [findSupplierManualMatches, jobs, supplierManuals]);

  const siteAccessNotesByJobId = useMemo(() => {
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));
    return new Map(
      jobs.map((job) => [job.id, getCustomerSiteAccessNote(customersById.get(job.customerId), job.jobAddress)])
    );
  }, [customers, getCustomerSiteAccessNote, jobs]);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {statuses.map((status) => {
        const columnJobs = jobs.filter((job) => job.status === status);
        const sortedColumnJobs = sortJobsForColumn(columnJobs, columnSortModes[status] || "recent");
        const statusTheme = statusThemes[status] || statusThemes["To Do"];
        const sortMode = columnSortModes[status] || "recent";
        const viewMode = columnViewModes[status] || "list";
        const jobLayoutClassName = viewMode === "grid" ? "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]" : viewMode === "compact" ? "grid gap-2" : "grid gap-4";

        return (
          <Card
            key={status}
            className={`min-h-[520px] rounded-3xl backdrop-blur ${statusTheme.column}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const jobId = event.dataTransfer.getData("jobId");
              onDropJob(jobId, status);
            }}
          >
            <CardHeader className="gap-4">
              <div className="grid gap-2 2xl:flex 2xl:items-center 2xl:justify-between 2xl:gap-3">
                <CardTitle className="min-w-0">{status}</CardTitle>
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
                      onQuickStatusChange={onQuickStatusChange}
                      manualMatches={manualMatchesByJobId.get(job.id) || []}
                      siteAccessNote={siteAccessNotesByJobId.get(job.id) || null}
                      draggable={allowDragging}
                      allowQuickStatusChange={allowQuickStatusChange}
                      viewMode={viewMode}
                      showTagLabels={showTagLabels}
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
  );
}
