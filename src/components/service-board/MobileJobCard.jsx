import { ArrowUpRight, CalendarPlus, ChevronRight, MoveRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statusThemes } from "@/lib/job-status";
import {
  buildJobCardIndicators,
  formatStreetAndSuburb,
  getJobValueMeta,
  getMobileMoveButtonId,
  getSiteAccessNotePreview,
} from "./service-board-utils";

const urgencyTone = {
  Low: "bg-slate-100 text-slate-700",
  Medium: "bg-amber-100 text-amber-800",
  High: "bg-rose-100 text-rose-800",
};

function MobileIndicatorList({ indicators, showLabels }) {
  if (indicators.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Job indicators">
      {indicators.map((indicator) => (
        <span
          key={indicator.id}
          className={showLabels
            ? "inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-600"
            : `inline-flex h-3 w-3 rounded-full ring-2 ring-white ${indicator.dotClassName}`}
          title={indicator.label}
          aria-label={indicator.label}
        >
          {showLabels ? (
            <>
              <span className={`h-2 w-2 rounded-full ${indicator.dotClassName}`} aria-hidden="true" />
              {indicator.label}
            </>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export default function MobileJobCard({
  canManageTomorrow,
  formatDate,
  getInvoiceStatus,
  isPlannedForTomorrow,
  job,
  onMove,
  onOpen,
  onPlanForTomorrow,
  onRemoveFromTomorrow,
  showStatus = false,
  showTagLabels,
  siteAccessNote,
}) {
  const statusTheme = statusThemes[job.status] || statusThemes["To Do"];
  const location = formatStreetAndSuburb(job.jobAddress);
  const scheduledLabel = job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled";
  const valueMeta = getJobValueMeta(job);
  const indicators = buildJobCardIndicators({
    job,
    invoiceStatus: getInvoiceStatus(job),
    siteAccessPreview: getSiteAccessNotePreview(siteAccessNote?.notes),
  });
  const openLabel = [
    `Open Job #${job.jobNumber}`,
    job.customerName,
    job.title,
    job.status,
    location,
    scheduledLabel,
    valueMeta?.amount,
    `${job.urgency || "Low"} urgency`,
    indicators.map((indicator) => indicator.label).join(", "),
  ].filter(Boolean).join(", ");

  return (
    <article
      className={`mobile-job-card w-full min-w-0 max-w-full overflow-hidden rounded-2xl border shadow-sm ${statusTheme.card}`}
      data-mobile-job-id={job.id}
    >
      <button
        type="button"
        className="block w-full px-3.5 pb-3 pt-3 text-left outline-none transition hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-sky-600/40"
        onClick={() => onOpen(job)}
        aria-label={openLabel}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Job #{job.jobNumber}</p>
            <p className="mt-1 truncate text-[15px] font-semibold leading-5 text-slate-950">{job.customerName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {valueMeta ? (
              <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-slate-900 shadow-sm" title={`${valueMeta.label} value`}>
                {valueMeta.amount}
              </span>
            ) : null}
            <ChevronRight className="h-5 w-5 text-slate-500" aria-hidden="true" />
          </div>
        </div>

        <p className="mt-1 line-clamp-1 text-sm leading-5 text-slate-700">{job.title}</p>

        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
          <span className="truncate font-medium text-slate-700">{location}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{scheduledLabel}</span>
        </div>

        <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge className={urgencyTone[job.urgency] || urgencyTone.Low}>{job.urgency || "Low"}</Badge>
            {showStatus ? <Badge className={statusTheme.badge}>{job.status}</Badge> : null}
            {isPlannedForTomorrow ? <Badge className="bg-sky-100 text-sky-800">Tomorrow</Badge> : null}
          </div>
          <MobileIndicatorList indicators={indicators} showLabels={showTagLabels} />
        </div>
      </button>

      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-end gap-2 border-t border-white/80 bg-white/38 px-2.5 py-1.5">
        {canManageTomorrow && onRemoveFromTomorrow ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 rounded-xl px-3 text-sky-800"
            onClick={() => onRemoveFromTomorrow(job.id)}
            aria-label={`Remove Job #${job.jobNumber} from tomorrow`}
          >
            <CalendarPlus className="h-4 w-4" />
            Remove tomorrow
          </Button>
        ) : null}

        {canManageTomorrow && !isPlannedForTomorrow && onPlanForTomorrow ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 rounded-xl px-3 text-sky-800"
            onClick={() => onPlanForTomorrow(job.id)}
            aria-label={`Add Job #${job.jobNumber} to tomorrow`}
          >
            <ArrowUpRight className="h-4 w-4" />
            Tomorrow
          </Button>
        ) : null}

        <Button
          id={getMobileMoveButtonId(job.id)}
          type="button"
          variant="outline"
          className="min-h-11 rounded-xl bg-white/85 px-3"
          onClick={() => onMove(job)}
          aria-label={`Move Job #${job.jobNumber}`}
        >
          <MoveRight className="h-4 w-4" />
          Move
        </Button>
      </div>
    </article>
  );
}
