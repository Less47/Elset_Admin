import { useDeferredValue, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  MobileRecordActions,
  MobileRecordBody,
  MobileRecordCard,
  MobileRecordHeader,
  MobileRecordList,
} from "@/components/shared/MobileRecordList";
import { useMobileRecordLayout } from "@/hooks/useMobileRecordLayout";
import {
  CompactSortControl,
  DesktopControlField,
  DesktopPageControls,
  FilterButton,
  FilterSheetField,
  MobileFilterSheet,
  PageSearchField,
  ResponsivePageControls,
  ResultSummary,
} from "@/components/shared/ResponsivePageControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statuses, statusThemes } from "@/lib/job-status";
import { urgencyOptions } from "@/lib/app-support";

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const jobHistorySortOptions = [
  { value: "activity-recent", label: "Recent" },
  { value: "job-newest", label: "Newest job" },
  { value: "job-oldest", label: "Oldest job" },
  { value: "created-newest", label: "Newest created" },
  { value: "scheduled-soon", label: "Scheduled soon" },
  { value: "customer", label: "Customer" },
  { value: "status", label: "Status" },
];

function getUrgencyBadgeClassName(urgency) {
  if (urgency === "High") return "bg-status-danger-surface text-status-danger";
  if (urgency === "Medium") return "bg-status-warning-surface text-status-warning";
  return "bg-surface-raised text-text-secondary";
}

export default function JobHistoryManager({
  jobs,
  onOpenJob,
  formatDate,
  getInvoiceStatus,
  toTimestamp,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("activity-recent");
  const [statusFilter, setStatusFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [createdRange, setCreatedRange] = useState("all-time");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterClock] = useState(() => ({ now: Date.now(), year: new Date().getFullYear() }));
  const filterTriggerRef = useRef(null);
  const deferredSearch = useDeferredValue(search);
  const mobileRecordLayout = useMobileRecordLayout();

  const jobRows = useMemo(() => {
    return jobs.map((job) => ({
      ...job,
      hasQuote: Boolean(job.quote),
      hasInvoice: Boolean(job.invoice),
      invoiceStatus: getInvoiceStatus(job),
      scheduledAt: job.scheduledDate ? toTimestamp(job.scheduledDate) : Number.POSITIVE_INFINITY,
      createdAtTimestamp: toTimestamp(job.createdAt),
      updatedAtTimestamp: toTimestamp(job.updatedAt),
    }));
  }, [getInvoiceStatus, jobs, toTimestamp]);

  const filteredJobs = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const rows = jobRows.filter((job) => {
      const matchesSearch = query
        ? [
            job.jobNumber,
            job.title,
            job.description,
            job.customerName,
            job.customerEmail,
            job.customerPhone,
            job.jobAddress,
            job.status,
            job.urgency,
            job.scheduledDate,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true;

      const matchesStatus = statusFilter === "all" ? true : job.status === statusFilter;
      const matchesUrgency = urgencyFilter === "all" ? true : job.urgency === urgencyFilter;

      const matchesDocument =
        documentFilter === "all"
          ? true
          : documentFilter === "quoted"
            ? job.hasQuote
          : documentFilter === "not-quoted"
            ? !job.hasQuote
          : documentFilter === "invoiced"
            ? job.hasInvoice
          : documentFilter === "not-invoiced"
            ? !job.hasInvoice
          : documentFilter === "completed-not-invoiced"
            ? job.status === "Completed" && !job.hasInvoice
            : job.invoiceStatus.id === "overdue";

      const createdAt = job.createdAtTimestamp;
      const matchesCreatedRange =
        createdRange === "all-time"
          ? true
          : createdRange === "last-30"
            ? createdAt >= filterClock.now - DAY_IN_MS * 30
          : createdRange === "last-90"
            ? createdAt >= filterClock.now - DAY_IN_MS * 90
            : new Date(job.createdAt).getFullYear() === filterClock.year;
      const matchesCreatedFrom = createdFrom ? createdAt >= toTimestamp(createdFrom) : true;
      const matchesCreatedTo = createdTo ? createdAt < toTimestamp(createdTo) + DAY_IN_MS : true;

      return matchesSearch
        && matchesStatus
        && matchesUrgency
        && matchesDocument
        && matchesCreatedRange
        && matchesCreatedFrom
        && matchesCreatedTo;
    });

    rows.sort((a, b) => {
      if (sortBy === "job-newest") return (b.jobNumber || 0) - (a.jobNumber || 0) || b.updatedAtTimestamp - a.updatedAtTimestamp;
      if (sortBy === "job-oldest") return (a.jobNumber || 0) - (b.jobNumber || 0) || a.updatedAtTimestamp - b.updatedAtTimestamp;
      if (sortBy === "created-newest") return b.createdAtTimestamp - a.createdAtTimestamp || (b.jobNumber || 0) - (a.jobNumber || 0);
      if (sortBy === "scheduled-soon") return a.scheduledAt - b.scheduledAt || b.updatedAtTimestamp - a.updatedAtTimestamp;
      if (sortBy === "customer") return a.customerName.localeCompare(b.customerName) || (b.jobNumber || 0) - (a.jobNumber || 0);
      if (sortBy === "status") return statuses.indexOf(a.status) - statuses.indexOf(b.status) || b.updatedAtTimestamp - a.updatedAtTimestamp;
      return b.updatedAtTimestamp - a.updatedAtTimestamp || (b.jobNumber || 0) - (a.jobNumber || 0);
    });

    return rows;
  }, [createdFrom, createdRange, createdTo, deferredSearch, documentFilter, filterClock, jobRows, sortBy, statusFilter, urgencyFilter, toTimestamp]);

  const historyStats = useMemo(() => {
    return filteredJobs.reduce((stats, job) => ({
      total: stats.total + 1,
      open: stats.open + (job.status === "Completed" ? 0 : 1),
      completed: stats.completed + (job.status === "Completed" ? 1 : 0),
      quoted: stats.quoted + (job.hasQuote ? 1 : 0),
      invoiced: stats.invoiced + (job.hasInvoice ? 1 : 0),
    }), {
      total: 0,
      open: 0,
      completed: 0,
      quoted: 0,
      invoiced: 0,
    });
  }, [filteredJobs]);
  const activeFilterCount = [
    statusFilter !== "all",
    urgencyFilter !== "all",
    documentFilter !== "all",
    createdRange !== "all-time",
    Boolean(createdFrom),
    Boolean(createdTo),
  ].filter(Boolean).length;

  return (
    <>
    <div className="space-y-4">
      <ResponsivePageControls
        search={(
          <PageSearchField
            value={search}
            onChange={setSearch}
            placeholder="Search jobs..."
            label="Search job history"
          />
        )}
        controls={(
          <>
            <FilterButton ref={filterTriggerRef} activeCount={activeFilterCount} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
            <CompactSortControl value={sortBy} onValueChange={setSortBy} options={jobHistorySortOptions} label="Sort job history" />
          </>
        )}
        summary={(
          <ResultSummary>
            {historyStats.total} {historyStats.total === 1 ? "job" : "jobs"} · {historyStats.open} open
          </ResultSummary>
        )}
      />

      <DesktopPageControls
        search={(
          <DesktopControlField label="Search" size="search">
            <PageSearchField
              compact
              value={search}
              onChange={setSearch}
              placeholder="Search job, customer, address, or status..."
              label="Search job history"
            />
          </DesktopControlField>
        )}
        filters={(
          <>
          <DesktopControlField htmlFor="desktop-job-history-sort" label="Sort by" size="medium">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger id="desktop-job-history-sort" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activity-recent">Recent activity</SelectItem>
                <SelectItem value="job-newest">Newest job number</SelectItem>
                <SelectItem value="job-oldest">Oldest job number</SelectItem>
                <SelectItem value="created-newest">Newest created</SelectItem>
                <SelectItem value="scheduled-soon">Scheduled soonest</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-job-status-filter" label="Status" size="medium">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="desktop-job-status-filter" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-job-urgency-filter" label="Urgency" size="medium">
            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger id="desktop-job-urgency-filter" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All urgency levels</SelectItem>
                {urgencyOptions.map((urgency) => (
                  <SelectItem key={urgency} value={urgency}>
                    {urgency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-job-document-filter" label="Documents" size="large">
            <Select value={documentFilter} onValueChange={setDocumentFilter}>
              <SelectTrigger id="desktop-job-document-filter" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                <SelectItem value="quoted">With quote</SelectItem>
                <SelectItem value="not-quoted">Without quote</SelectItem>
                <SelectItem value="invoiced">With invoice</SelectItem>
                <SelectItem value="not-invoiced">Without invoice</SelectItem>
                <SelectItem value="completed-not-invoiced">Completed not invoiced</SelectItem>
                <SelectItem value="invoice-overdue">Overdue invoice</SelectItem>
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-job-created-range" label="Quick range" size="small">
            <Select value={createdRange} onValueChange={setCreatedRange}>
              <SelectTrigger id="desktop-job-created-range" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-time">All time</SelectItem>
                <SelectItem value="last-30">Last 30 days</SelectItem>
                <SelectItem value="last-90">Last 90 days</SelectItem>
                <SelectItem value="this-year">This year</SelectItem>
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-job-created-from" label="Created from" size="date">
            <Input
              id="desktop-job-created-from"
              type="date"
              className="data-toolbar-field rounded-lg border-border bg-card"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
            />
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-job-created-to" label="Created to" size="date">
            <Input
              id="desktop-job-created-to"
              type="date"
              className="data-toolbar-field rounded-lg border-border bg-card"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
            />
          </DesktopControlField>
          </>
        )}
      />

      <Card
        className={mobileRecordLayout
          ? "gap-0 overflow-visible rounded-none border-0 bg-transparent py-0 shadow-none"
          : "data-card gap-0 overflow-hidden rounded-xl border-border shadow-none"}
        data-mobile-record-results-shell={mobileRecordLayout ? "" : undefined}
      >
        <div className="data-stat-grid hidden gap-px border-b border-border bg-surface-selected xl:grid xl:grid-cols-5">
          {[
            { label: "Jobs", value: historyStats.total },
            { label: "Open", value: historyStats.open },
            { label: "Completed", value: historyStats.completed },
            { label: "Quoted", value: historyStats.quoted },
            { label: "Invoiced", value: historyStats.invoiced },
          ].map((stat) => (
            <div key={stat.label} className="data-stat-card bg-card px-panel py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>

        <CardContent className="p-0">
        {mobileRecordLayout ? (
          filteredJobs.length === 0 ? (
            <div className="p-panel">
              <EmptyState title="No jobs found" text="Try adjusting the search or filters to find the job you want." />
            </div>
          ) : (
            <MobileRecordList label="Job history records">
              {filteredJobs.map((job) => {
                const headingId = `mobile-job-history-${encodeURIComponent(job.id)}-title`;

                return (
                  <MobileRecordCard key={job.id} labelledBy={headingId} recordId={job.id}>
                    <MobileRecordHeader>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Job #{job.jobNumber}</p>
                        <h3 id={headingId} className="mt-0.5 line-clamp-2 font-semibold leading-5 text-foreground">{job.title}</h3>
                      </div>
                      <Badge className={`${statusThemes[job.status]?.badge || "bg-surface-raised text-text-secondary"} max-w-[9rem]`}>{job.status}</Badge>
                    </MobileRecordHeader>

                    <MobileRecordBody>
                      <p className="line-clamp-1 font-medium text-foreground">{job.customerName}</p>
                      <p className="line-clamp-2">{job.jobAddress || "No site address saved"}</p>
                      <p className="text-xs">
                        <span className="font-semibold text-text-secondary">Scheduled</span>{" "}
                        {job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}
                      </p>
                    </MobileRecordBody>

                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                      <Badge className={getUrgencyBadgeClassName(job.urgency)}>{job.urgency || "Low"}</Badge>
                      <Badge variant="secondary">{job.hasQuote ? "Quote saved" : "No quote"}</Badge>
                      <Badge className={`${job.invoiceStatus.className} ${job.invoiceStatus.id === "overdue" ? "ring-2 ring-status-danger-border" : ""}`}>{job.invoiceStatus.label}</Badge>
                    </div>

                    <MobileRecordActions>
                      <Button
                        variant="outline"
                        aria-label={`Open Job #${job.jobNumber}: ${job.title}`}
                        onClick={() => onOpenJob(job)}
                      >
                        Open Job
                      </Button>
                    </MobileRecordActions>
                  </MobileRecordCard>
                );
              })}
            </MobileRecordList>
          )
        ) : (
          <div data-desktop-record-results>
          {filteredJobs.length === 0 ? (
            <div className="p-panel">
              <EmptyState title="No jobs found" text="Try adjusting the search or filters to find the job you want." />
            </div>
          ) : (
            <>
            <div className="overflow-x-auto text-xs 2xl:hidden">
              <div className="data-grid grid min-w-[600px] gap-px bg-surface-selected md:min-w-0">
                <div className="data-grid-header grid grid-cols-[minmax(0,1.35fr)_minmax(210px,0.9fr)_170px_82px] gap-px bg-surface-selected font-semibold uppercase tracking-[0.12em] text-muted-foreground [&>*]:bg-surface-raised">
                  <span>Job</span>
                  <span>Customer</span>
                  <span>Status</span>
                  <span className="text-right">Open</span>
                </div>

                {filteredJobs.map((job) => (
                  <div
                    key={job.id}
                    onDoubleClick={() => onOpenJob(job)}
                    title="Double-click to open job"
                    className="data-grid-row grid cursor-pointer select-none grid-cols-[minmax(0,1.35fr)_minmax(210px,0.9fr)_170px_82px] gap-px bg-surface-selected transition [&>*]:bg-card"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Job #{job.jobNumber}</p>
                      <p className="truncate font-semibold text-foreground">{job.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{job.description || "No description saved."}</p>
                    </div>

                    <div className="min-w-0 text-text-secondary">
                      <p className="truncate font-medium text-foreground">{job.customerName}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{job.jobAddress || "No site address saved"}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</p>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <Badge className={`${statusThemes[job.status]?.badge || "bg-surface-raised text-text-secondary"} px-1.5 py-0 text-[10px]`}>{job.status}</Badge>
                      <Badge className={`${getUrgencyBadgeClassName(job.urgency)} px-1.5 py-0 text-[10px]`}>{job.urgency || "Low"}</Badge>
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{job.hasQuote ? "Quote" : "No quote"}</Badge>
                      <Badge className={`${job.invoiceStatus.className} ${job.invoiceStatus.id === "overdue" ? "ring-2 ring-status-danger-border" : ""} px-1.5 py-0 text-[10px]`}>{job.invoiceStatus.label}</Badge>
                    </div>

                    <div className="flex items-center justify-end">
                      <Button variant="outline" size="sm" className="h-7 rounded-md border-border px-2 text-[11px]" onClick={() => onOpenJob(job)}>
                        Open
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden overflow-x-auto 2xl:block">
            <div className="min-w-[1520px]">
              <div className="data-grid grid gap-px bg-surface-selected">
                <div className="data-grid-header grid grid-cols-[1.55fr_1.2fr_120px_110px_130px_180px_150px_130px] gap-px bg-surface-selected text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground [&>*]:bg-surface-raised">
                  <span>Job</span>
                  <span>Customer & Site</span>
                  <span>Status</span>
                  <span>Urgency</span>
                  <span>Scheduled</span>
                  <span>Documents</span>
                  <span>Last Activity</span>
                  <span className="text-right">Action</span>
                </div>

                {filteredJobs.map((job) => (
                  <div
                    key={job.id}
                    onDoubleClick={() => onOpenJob(job)}
                    title="Double-click to open job"
                    className="data-grid-row grid cursor-pointer select-none grid-cols-[1.55fr_1.2fr_120px_110px_130px_180px_150px_130px] gap-px bg-surface-selected text-sm transition [&>*]:bg-card"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Job #{job.jobNumber}</p>
                      <p className="truncate font-semibold text-foreground">{job.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{job.description || "No description saved."}</p>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{job.customerName}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{job.jobAddress || "No site address saved"}</p>
                    </div>

                    <div>
                      <Badge className={statusThemes[job.status]?.badge || "bg-surface-raised text-text-secondary"}>{job.status}</Badge>
                    </div>

                    <div>
                      <Badge className={getUrgencyBadgeClassName(job.urgency)}>{job.urgency || "Low"}</Badge>
                    </div>

                    <p className="text-text-secondary">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</p>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{job.hasQuote ? "Quote saved" : "No quote"}</Badge>
                      <Badge className={`${job.invoiceStatus.className} ${job.invoiceStatus.id === "overdue" ? "ring-2 ring-status-danger-border" : ""}`}>{job.invoiceStatus.label}</Badge>
                    </div>

                    <div>
                      <p className="font-medium text-foreground">{formatDate(job.updatedAt)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Created {formatDate(job.createdAt)}</p>
                    </div>

                    <div className="flex items-center justify-end">
                      <Button variant="outline" size="sm" className="rounded-md border-border" onClick={() => onOpenJob(job)}>
                        Open Job
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </div>
            </>
          )}
          </div>
        )}
      </CardContent>
      </Card>
    </div>
    <MobileFilterSheet
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      returnFocusRef={filterTriggerRef}
      activeCount={activeFilterCount}
      description="Filter job records by status, urgency, documents, and creation date."
      onReset={() => {
        setStatusFilter("all");
        setUrgencyFilter("all");
        setDocumentFilter("all");
        setCreatedRange("all-time");
        setCreatedFrom("");
        setCreatedTo("");
      }}
    >
      <FilterSheetField id="mobile-job-status-filter" label="Status">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger id="mobile-job-status-filter" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-job-urgency-filter" label="Urgency">
        <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
          <SelectTrigger id="mobile-job-urgency-filter" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgency levels</SelectItem>
            {urgencyOptions.map((urgency) => <SelectItem key={urgency} value={urgency}>{urgency}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-job-document-filter" label="Documents">
        <Select value={documentFilter} onValueChange={setDocumentFilter}>
          <SelectTrigger id="mobile-job-document-filter" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs</SelectItem>
            <SelectItem value="quoted">With quote</SelectItem>
            <SelectItem value="not-quoted">Without quote</SelectItem>
            <SelectItem value="invoiced">With invoice</SelectItem>
            <SelectItem value="not-invoiced">Without invoice</SelectItem>
            <SelectItem value="completed-not-invoiced">Completed not invoiced</SelectItem>
            <SelectItem value="invoice-overdue">Overdue invoice</SelectItem>
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-job-created-range" label="Quick range">
        <Select value={createdRange} onValueChange={setCreatedRange}>
          <SelectTrigger id="mobile-job-created-range" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all-time">All time</SelectItem>
            <SelectItem value="last-30">Last 30 days</SelectItem>
            <SelectItem value="last-90">Last 90 days</SelectItem>
            <SelectItem value="this-year">This year</SelectItem>
          </SelectContent>
        </Select>
      </FilterSheetField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FilterSheetField id="mobile-job-created-from" label="Created from">
          <Input id="mobile-job-created-from" type="date" className="h-11 rounded-xl bg-card" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
        </FilterSheetField>
        <FilterSheetField id="mobile-job-created-to" label="Created to">
          <Input id="mobile-job-created-to" type="date" className="h-11 rounded-xl bg-card" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
        </FilterSheetField>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Quick range and custom dates are combined when both are selected.</p>
    </MobileFilterSheet>
    </>
  );
}
