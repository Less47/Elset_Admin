import { useRef, useState } from "react";
import { CalendarX2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterSheetField, MobileFilterSheet } from "@/components/shared/ResponsivePageControls";
import CalendarJobCard from "./CalendarJobCard";
import { queueStatuses } from "./calendar-utils";

export default function CalendarQueue({ jobs, search, onSearch, filters, onFilters, onOpenJob, onSchedule, onUnschedule, dragApi, busy, inSheet = false }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterTrigger = useRef(null);
  const activeCount = Number(filters.urgency !== "all") + Number(filters.schedule !== "all");
  return (
    <section className={`calendar-queue flex min-h-0 min-w-0 flex-col ${inSheet ? "" : "overflow-hidden bg-card"}`} aria-label="Job scheduling queue" data-calendar-queue>
      <header className="shrink-0 space-y-2 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Job queue <span className="ml-1 text-xs font-normal text-muted-foreground">{jobs.length}</span></h2>
          <Button type="button" ref={filterTrigger} variant="ghost" className="h-11 min-w-11 gap-1 px-2 text-xs" aria-label={`Queue filters${activeCount ? `, ${activeCount} active` : ""}`} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />{activeCount || null}
          </Button>
        </div>
        <Input type="search" className="h-11 bg-card text-sm" aria-label="Search scheduling queue" placeholder="Search jobs…" value={search} onChange={(event) => onSearch(event.target.value)} />
        <p className="text-[11px] leading-4 text-muted-foreground">{inSheet ? "Choose Schedule or Reschedule to set a date." : "Drag a job onto a date, or use its scheduling action."}</p>
      </header>
      <div className="calendar-queue-list min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
        {jobs.length === 0 && (search.trim() || activeCount) ? <p className="py-2 text-xs text-text-secondary">No matching jobs.</p> : queueStatuses.map((status) => {
          const statusJobs = jobs.filter((job) => job.status === status);
          return (
            <section key={status} aria-label={`${status} scheduling jobs`}>
              <h3 className="mb-2 flex items-center justify-between text-xs font-semibold text-foreground"><span>{status}</span><span className="rounded-full bg-surface-raised px-2 text-[11px]">{statusJobs.length}</span></h3>
              <div className="grid min-w-0 gap-2">
                {statusJobs.length ? statusJobs.map((job) => <CalendarJobCard key={job.id} job={job} onOpenJob={onOpenJob} onSchedule={onSchedule} onUnschedule={onUnschedule} dragApi={dragApi} draggable={!inSheet} busy={busy} />) : <p className="text-xs text-muted-foreground">No {status} jobs.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {!inSheet ? (
        <div className={`m-3 mt-0 flex min-h-12 shrink-0 items-center gap-2 rounded-lg border border-dashed p-2.5 text-xs text-text-secondary ${dragApi.drag?.target === "" ? "calendar-day-target" : "bg-muted"}`} data-calendar-drop-date="" data-calendar-unscheduled data-drop-active={dragApi.drag?.target === "" || undefined} {...dragApi.dropProps}>
          <CalendarX2 className="h-4 w-4 shrink-0" /><span>Unscheduled<span className="block text-[11px] text-muted-foreground">Drop here to remove a date</span></span>
        </div>
      ) : null}
      <MobileFilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Queue filters" description="Filter open jobs available for scheduling." activeCount={activeCount} returnFocusRef={filterTrigger} onReset={() => onFilters({ urgency: "all", schedule: "all" })}>
        <FilterSheetField id="calendar-queue-schedule" label="Scheduled">
          <Select value={filters.schedule} onValueChange={(schedule) => onFilters({ ...filters, schedule })}><SelectTrigger id="calendar-queue-schedule" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All open jobs</SelectItem><SelectItem value="unscheduled">Unscheduled</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem></SelectContent></Select>
        </FilterSheetField>
        <FilterSheetField id="calendar-queue-urgency" label="Urgency">
          <Select value={filters.urgency} onValueChange={(urgency) => onFilters({ ...filters, urgency })}><SelectTrigger id="calendar-queue-urgency" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All urgencies</SelectItem>{["Low", "Medium", "High"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
        </FilterSheetField>
      </MobileFilterSheet>
    </section>
  );
}
