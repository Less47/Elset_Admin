import { useMemo, useRef, useState } from "react";
import { ArrowDownUp, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statuses, statusThemes } from "@/lib/job-status";
import MobileJobCard from "./MobileJobCard";
import { MobileBoardFilters, MobileStatusChangeSheet } from "./MobileBoardSheets";
import MobileStatusTabs from "./MobileStatusTabs";
import {
  getMobileBoardPanelId,
  getMobileMoveButtonId,
  serviceBoardSortOptions,
  sortJobsForColumn,
  TOMORROW_VIEW,
} from "./service-board-utils";

export default function MobileServiceBoard({
  canManageTomorrow,
  columnSortModes,
  customers,
  formatDate,
  getCustomerSiteAccessNote,
  getInvoiceStatus,
  jobs,
  officeSearch,
  onColumnSortModeChange,
  onOpenJob,
  onPlanJobForTomorrow,
  onRemoveAllJobsFromTomorrow,
  onRemoveJobFromTomorrow,
  onSearchChange,
  onSelectedViewChange,
  onShowTagLabelsChange,
  onStatusChange,
  onUrgencyChange,
  showHighUrgencyOnly,
  showTagLabels,
  selectedView,
  tomorrowJobs,
  tomorrowPlanningDate,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moveJob, setMoveJob] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const filterTriggerRef = useRef(null);

  const counts = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status, jobs.filter((job) => job.status === status).length])),
    [jobs]
  );
  const candidateJobs = useMemo(() => {
    const byId = new Map([...jobs, ...tomorrowJobs].map((job) => [job.id, job]));
    return [...byId.values()];
  }, [jobs, tomorrowJobs]);
  const siteAccessNotesByJobId = useMemo(() => {
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));
    return new Map(
      candidateJobs.map((job) => [job.id, getCustomerSiteAccessNote(customersById.get(job.customerId), job.jobAddress)])
    );
  }, [candidateJobs, customers, getCustomerSiteAccessNote]);

  const isTomorrowView = selectedView === TOMORROW_VIEW;
  const sortMode = isTomorrowView ? "recent" : columnSortModes[selectedView] || "recent";
  const selectedJobs = isTomorrowView
    ? tomorrowJobs
    : sortJobsForColumn(jobs.filter((job) => job.status === selectedView), sortMode);
  const selectedLabel = isTomorrowView ? "Tomorrow" : selectedView;
  const activeFilterCount = showHighUrgencyOnly ? 1 : 0;

  const handlePlanForTomorrow = async (jobId) => {
    const job = candidateJobs.find((entry) => entry.id === jobId);
    const saved = await onPlanJobForTomorrow(jobId);
    if (saved) setStatusMessage(`Job #${job?.jobNumber || ""} added to tomorrow.`);
  };

  const handleRemoveFromTomorrow = async (jobId) => {
    const job = candidateJobs.find((entry) => entry.id === jobId);
    const saved = await onRemoveJobFromTomorrow(jobId);
    if (saved) setStatusMessage(`Job #${job?.jobNumber || ""} removed from tomorrow.`);
  };

  const handleMoved = (job, nextStatus) => {
    setMoveJob(null);
    onSelectedViewChange(nextStatus);
    setStatusMessage(`Job #${job.jobNumber} moved to ${nextStatus}.`);
  };

  return (
    <section
      className="mobile-service-board grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 pb-20"
      aria-label="Mobile Service Board"
    >
      <MobileStatusTabs
        counts={counts}
        selectedView={selectedView}
        onSelect={onSelectedViewChange}
      />

      <div className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-2xl border bg-white/88 p-2 shadow-sm backdrop-blur">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            className="h-11 rounded-xl bg-white pl-9 pr-11 text-base"
            value={officeSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search jobs…"
            aria-label="Search jobs"
          />
          {officeSearch ? (
            <button
              type="button"
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 outline-none hover:text-slate-900 focus-visible:ring-3 focus-visible:ring-sky-500/35"
              onClick={() => onSearchChange("")}
              aria-label="Clear job search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <Button
          ref={filterTriggerRef}
          type="button"
          variant="outline"
          className="relative h-11 w-11 rounded-xl bg-white p-0 sm:w-auto sm:px-3"
          onClick={() => setFiltersOpen(true)}
          aria-label={`Open board filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount ? (
            <Badge className="absolute -right-1.5 -top-1.5 h-5 min-w-5 justify-center rounded-full bg-sky-700 px-1 text-[10px] text-white sm:static">
              {activeFilterCount}
            </Badge>
          ) : null}
        </Button>

        {!isTomorrowView ? (
          <Select value={sortMode} onValueChange={(nextSortMode) => onColumnSortModeChange(selectedView, nextSortMode)}>
            <SelectTrigger
              className="h-11 w-11 rounded-xl bg-white px-0 sm:w-[116px] sm:px-3"
              aria-label={`Sort ${selectedView} jobs`}
              title="Sort jobs"
            >
              <ArrowDownUp className="mx-auto h-4 w-4 shrink-0 sm:mx-0" />
              <span className="hidden sm:inline"><SelectValue /></span>
            </SelectTrigger>
            <SelectContent>
              {serviceBoardSortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {statusMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" role="status">
          {statusMessage}
        </div>
      ) : null}

      <div
        id={getMobileBoardPanelId(selectedView)}
        role="tabpanel"
        aria-label={`${selectedLabel} jobs`}
        data-service-board-status={isTomorrowView ? undefined : selectedView}
        data-mobile-board-view={selectedLabel}
        className="w-full min-w-0 max-w-full rounded-2xl border bg-white/64 p-2.5 shadow-sm backdrop-blur sm:p-3"
      >
        <div className="flex min-h-11 items-center justify-between gap-3 px-1 pb-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">{selectedLabel}</h2>
            <p className="text-xs text-slate-600">{selectedJobs.length} {selectedJobs.length === 1 ? "job" : "jobs"}</p>
          </div>
          {isTomorrowView && canManageTomorrow && tomorrowJobs.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 rounded-xl px-3 text-rose-700"
              onClick={onRemoveAllJobsFromTomorrow}
            >
              <Trash2 className="h-4 w-4" />
              Clear tomorrow
            </Button>
          ) : null}
        </div>

        {selectedJobs.length === 0 ? (
          <div className={`rounded-2xl border border-dashed px-4 py-10 text-center ${
            isTomorrowView ? "border-sky-200 bg-sky-50/75" : statusThemes[selectedView]?.card || "bg-slate-50"
          }`}>
            <p className="font-semibold text-slate-900">No jobs in {selectedLabel}</p>
            <p className="mt-1 text-sm text-slate-600">
              {isTomorrowView
                ? canManageTomorrow
                  ? "Use the Tomorrow action on a job to build the plan."
                  : "No jobs are currently planned for tomorrow."
                : "Choose another status or adjust your filters."}
            </p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {selectedJobs.map((job) => (
              <MobileJobCard
                key={job.id}
                canManageTomorrow={canManageTomorrow}
                formatDate={formatDate}
                getInvoiceStatus={getInvoiceStatus}
                isPlannedForTomorrow={job.serviceBoardTomorrowDate === tomorrowPlanningDate}
                job={job}
                onMove={setMoveJob}
                onOpen={onOpenJob}
                onPlanForTomorrow={!isTomorrowView ? handlePlanForTomorrow : null}
                onRemoveFromTomorrow={isTomorrowView ? handleRemoveFromTomorrow : null}
                showStatus={isTomorrowView}
                showTagLabels={showTagLabels}
                siteAccessNote={siteAccessNotesByJobId.get(job.id) || null}
              />
            ))}
          </div>
        )}
      </div>

      <MobileBoardFilters
        activeFilterCount={activeFilterCount}
        onClearFilters={() => onUrgencyChange(false)}
        onOpenChange={setFiltersOpen}
        onShowTagLabelsChange={onShowTagLabelsChange}
        onUrgencyChange={onUrgencyChange}
        open={filtersOpen}
        returnFocusRef={filterTriggerRef}
        showHighUrgencyOnly={showHighUrgencyOnly}
        showTagLabels={showTagLabels}
      />

      <MobileStatusChangeSheet
        key={moveJob?.id || "closed"}
        job={moveJob}
        onClose={() => setMoveJob(null)}
        onMoved={handleMoved}
        onStatusChange={onStatusChange}
        returnFocusId={moveJob ? getMobileMoveButtonId(moveJob.id) : ""}
      />
    </section>
  );
}
