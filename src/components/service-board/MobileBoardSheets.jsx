import { useState } from "react";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { statuses, statusThemes } from "@/lib/job-status";
import { serviceBoardIndicatorLegend } from "./service-board-utils";

const mobileSheetClassName = "bottom-0 left-0 top-auto max-h-[min(86dvh,46rem)] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none rounded-t-3xl border-x-0 border-b-0 p-0 data-closed:slide-out-to-bottom-4 data-open:slide-in-from-bottom-4 motion-reduce:transition-none motion-reduce:data-closed:animate-none motion-reduce:data-open:animate-none sm:left-1/2 sm:w-[min(100%-2rem,38rem)] sm:-translate-x-1/2 sm:rounded-b-3xl sm:border-x sm:border-b";

function SheetHeader({ children, description }) {
  return (
    <DialogHeader
      className="gap-1 border-b px-4 pb-3 pt-4 pr-4 sm:px-5"
      style={{
        paddingLeft: "calc(1rem + env(safe-area-inset-left))",
        paddingRight: "calc(1rem + env(safe-area-inset-right))",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle className="text-lg font-semibold">{children}</DialogTitle>
          <DialogDescription className="mt-1">{description}</DialogDescription>
        </div>
        <DialogClose asChild>
          <Button type="button" variant="ghost" className="h-11 w-11 rounded-xl p-0" aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </DialogClose>
      </div>
    </DialogHeader>
  );
}

export function MobileBoardFilters({
  activeFilterCount,
  onClearFilters,
  onOpenChange,
  onShowTagLabelsChange,
  onUrgencyChange,
  open,
  returnFocusRef,
  showHighUrgencyOnly,
  showTagLabels,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={mobileSheetClassName}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef?.current?.focus();
        }}
      >
        <SheetHeader description="Keep the board focused without losing your selected options.">
          Board filters
        </SheetHeader>

        <DialogBody
          className="overscroll-contain px-4 py-4 sm:px-5"
          style={{
            paddingRight: "calc(1rem + env(safe-area-inset-right))",
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
            paddingLeft: "calc(1rem + env(safe-area-inset-left))",
          }}
        >
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold">Active filters</p>
                <Badge variant="secondary">{activeFilterCount}</Badge>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 rounded-xl px-3"
                onClick={onClearFilters}
                disabled={activeFilterCount === 0}
              >
                Clear all
              </Button>
            </div>

            <label
              htmlFor="mobile-high-urgency-filter"
              className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl border bg-white/70 px-4 py-3"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-900">High urgency only</span>
                <span className="mt-0.5 block text-xs text-slate-600">Show only jobs marked High priority.</span>
              </span>
              <Checkbox
                id="mobile-high-urgency-filter"
                checked={showHighUrgencyOnly}
                onCheckedChange={(checked) => onUrgencyChange(Boolean(checked))}
                aria-label="High urgency only"
              />
            </label>

            <label
              htmlFor="mobile-show-tag-labels"
              className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl border bg-white/70 px-4 py-3"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-900">Show indicator labels</span>
                <span className="mt-0.5 block text-xs text-slate-600">Expand card dots into short descriptions.</span>
              </span>
              <Checkbox
                id="mobile-show-tag-labels"
                checked={showTagLabels}
                onCheckedChange={(checked) => onShowTagLabelsChange(Boolean(checked))}
                aria-label="Show indicator labels"
              />
            </label>

            <details className="group rounded-2xl border bg-white/70">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-sky-500/35 [&::-webkit-details-marker]:hidden">
                Legend
                <span className="text-xs font-medium text-slate-500 group-open:hidden">Show</span>
                <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Hide</span>
              </summary>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t px-4 py-4 text-xs text-slate-700">
                {serviceBoardIndicatorLegend.map((indicator) => (
                  <div key={indicator.id} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${indicator.dotClassName}`} />
                    <span>{indicator.label}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function MobileStatusChangeSheet({ job, onClose, onMoved, onStatusChange, returnFocusId }) {
  const [pendingStatus, setPendingStatus] = useState("");
  const [error, setError] = useState("");

  if (!job) return null;

  const handleMove = async (status) => {
    if (status === job.status || pendingStatus) return;

    setError("");
    setPendingStatus(status);
    try {
      const saved = await onStatusChange(job.id, status);
      if (!saved) {
        return;
      }
      onMoved(job, status);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "The job status could not be changed.");
    } finally {
      setPendingStatus("");
    }
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => {
      if (!nextOpen && !pendingStatus) onClose();
    }}>
      <DialogContent
        className={mobileSheetClassName}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = document.getElementById(returnFocusId)
            || document.querySelector('[role="tab"][aria-selected="true"]');
          target?.focus();
        }}
      >
        <SheetHeader description={`${job.customerName} · ${job.title}`}>
          Move Job #{job.jobNumber}
        </SheetHeader>

        <DialogBody
          className="overscroll-contain px-4 py-4 sm:px-5"
          style={{
            paddingRight: "calc(1rem + env(safe-area-inset-right))",
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
            paddingLeft: "calc(1rem + env(safe-area-inset-left))",
          }}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Move job to</p>
          <div className="grid gap-2">
            {statuses.map((status) => {
              const isCurrent = status === job.status;
              const isPending = status === pendingStatus;
              const theme = statusThemes[status] || statusThemes["To Do"];

              return (
                <Button
                  key={status}
                  type="button"
                  variant="outline"
                  className={`min-h-14 justify-between rounded-2xl px-4 text-left ${theme.card}`}
                  onClick={() => handleMove(status)}
                  disabled={isCurrent || Boolean(pendingStatus)}
                  aria-label={isCurrent ? `${status}, current status` : `Move to ${status}`}
                >
                  <span className="font-semibold">{status}</span>
                  {isCurrent ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <Check className="h-4 w-4" /> Current
                    </span>
                  ) : isPending ? (
                    <span className="text-xs text-slate-600">Moving…</span>
                  ) : null}
                </Button>
              );
            })}
          </div>
          {error ? <p className="mt-3 text-sm font-medium text-rose-700" role="alert">{error}</p> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
