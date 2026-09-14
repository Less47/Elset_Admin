import { useRef, useState } from "react";
import { FilterButton, FilterSheetField, MobileFilterSheet, PageSearchField, ResponsivePageControls, ResultSummary } from "@/components/shared/ResponsivePageControls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerTypeOptions, siteTypeOptions } from "@/lib/app-support";
import { ALL_FILTER_VALUE, NOT_SET_FILTER_VALUE, JOB_FILTERS } from "./map-filters";

const fields = [
  { key: "jobFilter", label: "Jobs", options: JOB_FILTERS },
  { key: "siteTypeFilter", label: "Site type", options: [
    { value: ALL_FILTER_VALUE, label: "All site types" }, { value: NOT_SET_FILTER_VALUE, label: "Not set" }, ...siteTypeOptions,
  ] },
  { key: "customerTypeFilter", label: "Customer type", options: [
    { value: ALL_FILTER_VALUE, label: "All customer types" }, { value: NOT_SET_FILTER_VALUE, label: "Not set" }, ...customerTypeOptions,
  ] },
];

export default function GoogleMapFilters({ filters, setFilters, jobCount, mappedCount }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const activeCount = fields.filter(({ key }) => filters[key] !== "all").length;
  const search = <PageSearchField value={filters.search} onChange={(search) => setFilters((previous) => ({ ...previous, search }))} placeholder="Search map jobs..." label="Search map jobs" />;
  const select = (field, prefix) => (
    <Select value={filters[field.key]} onValueChange={(value) => setFilters((previous) => ({ ...previous, [field.key]: value }))}>
      <SelectTrigger id={`${prefix}-${field.key}`} className="h-11 w-full rounded-xl bg-card" aria-label={field.label}><SelectValue /></SelectTrigger>
      <SelectContent side={prefix === "google-mobile" ? "top" : "bottom"}>{field.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  );
  return <>
    <ResponsivePageControls compact className="map-floating-controls" surfaceClassName="map-filter-surface"
      search={search}
      controls={<FilterButton ref={triggerRef} activeCount={activeCount} open={open} onClick={() => setOpen(true)} />}
      summary={<ResultSummary className="w-fit rounded-full border border-border bg-card/95 px-2.5 py-1 text-xs text-foreground">{jobCount} {jobCount === 1 ? "job" : "jobs"} · {mappedCount} mapped</ResultSummary>}
    />
    <div className="map-desktop-filter-bar map-filter-surface absolute left-1/2 top-4 z-[1000] hidden -translate-x-1/2 px-3 py-2.5 xl:block">
      <div className="grid grid-cols-[minmax(240px,1fr)_150px_150px_180px] items-end gap-2">
        {search}
        {fields.map((field) => <div key={field.key} className="grid gap-1">
          <label htmlFor={`google-desktop-${field.key}`} className="text-xs font-semibold text-text-secondary">{field.label}</label>
          {select(field, "google-desktop")}
        </div>)}
      </div>
    </div>
    <MobileFilterSheet open={open} onOpenChange={setOpen} returnFocusRef={triggerRef} activeCount={activeCount}
      modal={false} className="google-map-filter-sheet"
      description="Choose which jobs and customer sites appear on the map."
      onReset={() => setFilters((previous) => ({ ...previous, jobFilter: "all", siteTypeFilter: "all", customerTypeFilter: "all" }))}>
      {fields.map((field) => <FilterSheetField key={field.key} id={`google-mobile-${field.key}`} label={field.label}>{select(field, "google-mobile")}</FilterSheetField>)}
    </MobileFilterSheet>
  </>;
}
