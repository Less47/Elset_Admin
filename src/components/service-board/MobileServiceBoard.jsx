import { useMemo, useRef, useState } from "react";
import { PageWorkspace, PageTopBar, PageBody } from "@/components/workspace/PageWorkspace";
import { useStableCallback } from "@/hooks/useStableCallback";
import { ArrowDownUp, Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statuses, statusThemes } from "@/lib/job-status";
import MobileJobCard from "./MobileJobCard";
import JobNoteModeButton from "./JobNoteModeButton";
import { MobileBoardFilters, MobileStatusChangeSheet } from "./MobileBoardSheets";
import MobileStatusTabs from "./MobileStatusTabs";
import CompletedShowMore from "./CompletedShowMore";
import { useCompletedJobLimit } from "./useCompletedJobLimit";
import {
  getMobileBoardPanelId,
  getMobileMoveButtonId,
  serviceBoardSortOptions,
  sortJobsForColumn,
} from "./service-board-utils";

export default function MobileServiceBoard({
  accountingProvider,
  billingTypeFilter = "all",
  onBillingTypeChange,
  noteStatus,
  noteEditMode = false,
  onToggleNoteEditMode,
  onEditNote,
  columnSortModes,
  formatDate,
  getInvoiceStatus,
  jobs,
  officeSearch,
  onColumnSortModeChange,
  onOpenJob,
  onSearchChange,
  onSelectedViewChange,
  onShowTagLabelsChange,
  onStatusChange,
  onUrgencyChange,
  showHighUrgencyOnly,
  showTagLabels,
  selectedView,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moveJob, setMoveJob] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const filterTriggerRef = useRef(null);
  const { visibleLimit, showMore } = useCompletedJobLimit(officeSearch, showHighUrgencyOnly, columnSortModes.Completed || "recent", billingTypeFilter);

  const counts = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status, jobs.filter((job) => job.status === status).length])),
    [jobs]
  );
  const activeView = statuses.includes(selectedView) ? selectedView : statuses[0];
  const statusDateKey = new Date().toDateString();
  const sortMode = columnSortModes[activeView] || "recent";
  const selectedJobs = useMemo(() => sortJobsForColumn(jobs.filter((job) => job.status === activeView), sortMode), [jobs, activeView, sortMode]);
  const selectedLabel = activeView;
  const visibleJobs = activeView === "Completed" ? selectedJobs.slice(0, visibleLimit) : selectedJobs;
  const activeFilterCount = Number(showHighUrgencyOnly) + Number(billingTypeFilter !== "all");

  const openJob = useStableCallback(onOpenJob);
  const editNote = useStableCallback(onEditNote);
  const handleMoved = (job, nextStatus) => {
    setMoveJob(null);
    onSelectedViewChange(nextStatus);
    setStatusMessage(`Job #${job.jobNumber} moved to ${nextStatus}.`);
  };

  return (
    <PageWorkspace
      className="mobile-service-board"
      aria-label="Mobile Service Board"
    >
      <PageTopBar data-service-board-toolbar innerClassName="px-2.5 pb-2.5">
      <MobileStatusTabs
        counts={counts}
        selectedView={activeView}
        onSelect={onSelectedViewChange}
      />

      <div className="flex w-full min-w-0 max-w-full items-center gap-1.5 rounded-2xl border bg-card/88 p-2 shadow-sm backdrop-blur" data-service-board-primary-controls>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 rounded-xl bg-card pl-9 pr-11 text-base"
            value={officeSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search jobs…"
            aria-label="Search jobs"
          />
          {officeSearch ? (
            <button
              type="button"
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-status-info-border/35"
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
          className="relative h-11 w-11 rounded-xl bg-card p-0 sm:w-auto sm:px-3"
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

        <JobNoteModeButton active={noteEditMode} onToggle={onToggleNoteEditMode} mobile />

        <Select value={sortMode} onValueChange={(nextSortMode) => onColumnSortModeChange(activeView, nextSortMode)}>
          <SelectTrigger
            className="h-11 w-11 rounded-xl bg-card px-0 sm:w-[116px] sm:px-3"
            aria-label={`Sort ${activeView} jobs`}
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
      </div>

      </PageTopBar>
      <PageBody className="space-y-3 pb-20">
      {noteStatus}
      {statusMessage ? (
        <div className="rounded-xl border border-status-success-border bg-status-success-surface px-3 py-2 text-sm font-medium text-status-success" role="status">
          {statusMessage}
        </div>
      ) : null}

      <div
        id={getMobileBoardPanelId(activeView)}
        role="tabpanel"
        aria-label={`${selectedLabel} jobs`}
        data-service-board-status={activeView}
        data-mobile-board-view={selectedLabel}
        className="w-full min-w-0 max-w-full rounded-2xl border bg-card/64 p-2.5 shadow-sm backdrop-blur"
      >
        <div className="flex min-h-11 items-center justify-between gap-3 px-1 pb-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{selectedLabel}</h2>
            <p className="text-xs text-text-secondary">{selectedJobs.length} {selectedJobs.length === 1 ? "job" : "jobs"}</p>
          </div>
        </div>

        {selectedJobs.length === 0 ? (
          <div className={`rounded-2xl border border-dashed px-4 py-10 text-center ${
            statusThemes[activeView]?.card || "bg-muted"
          }`}>
            <p className="font-semibold text-foreground">No jobs in {selectedLabel}</p>
            <p className="mt-1 text-sm text-text-secondary">
              Choose another status or adjust your filters.
            </p>
          </div>
        ) : (
          <div className={`grid ${visibleJobs.some((job) => job.serviceBoardNote) ? "gap-3 pb-2" : "gap-2"}`}>
            {visibleJobs.map((job) => (
              <MobileJobCard
                accountingProvider={accountingProvider}
                noteEditMode={noteEditMode}
                onEditNote={editNote}
                key={job.id}
                formatDate={formatDate}
                getInvoiceStatus={getInvoiceStatus}
                statusDateKey={statusDateKey}
                job={job}
                onMove={setMoveJob}
                onOpen={openJob}
                showTagLabels={showTagLabels}
              />
            ))}
          </div>
        )}
        {activeView === "Completed" ? <CompletedShowMore visibleLimit={visibleLimit} totalCount={selectedJobs.length} onShowMore={showMore} /> : null}
      </div>

      </PageBody>
      <MobileBoardFilters
        accountingProvider={accountingProvider}
        activeFilterCount={activeFilterCount}
        billingTypeFilter={billingTypeFilter}
        onBillingTypeChange={onBillingTypeChange}
        onClearFilters={() => { onUrgencyChange(false); onBillingTypeChange("all"); }}
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
    </PageWorkspace>
  );
}
