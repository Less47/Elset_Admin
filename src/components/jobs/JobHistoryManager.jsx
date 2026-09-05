import { useDeferredValue, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  CompactSortControl,
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
  if (urgency === "High") return "bg-rose-100 text-rose-800";
  if (urgency === "Medium") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
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

      <div className="floating-page-toolbar hidden px-4 py-3 xl:block">
        <div className="grid gap-2 md:grid-cols-[minmax(190px,1.2fr)_minmax(135px,0.7fr)_minmax(120px,0.62fr)_minmax(140px,0.72fr)] 2xl:grid-cols-[minmax(200px,1.2fr)_minmax(135px,0.7fr)_minmax(120px,0.62fr)_minmax(140px,0.72fr)_minmax(125px,0.65fr)_minmax(115px,0.6fr)_minmax(130px,0.66fr)_minmax(130px,0.66fr)] md:items-end">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
            <Input
              className="data-toolbar-field rounded-lg border-slate-300 bg-white"
              placeholder="Search job, customer, address, or status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
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
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</p>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
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
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Urgency</p>
            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
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
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Documents</p>
            <Select value={documentFilter} onValueChange={setDocumentFilter}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
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
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Quick range</p>
            <Select value={createdRange} onValueChange={setCreatedRange}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-time">All time</SelectItem>
                <SelectItem value="last-30">Last 30 days</SelectItem>
                <SelectItem value="last-90">Last 90 days</SelectItem>
                <SelectItem value="this-year">This year</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Created from</p>
            <Input
              type="date"
              className="data-toolbar-field rounded-lg border-slate-300 bg-white"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Created to</p>
            <Input
              type="date"
              className="data-toolbar-field rounded-lg border-slate-300 bg-white"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Card className="data-card gap-0 overflow-hidden rounded-xl border-slate-300 shadow-none">
        <div className="data-stat-grid hidden gap-px border-b border-slate-200 bg-slate-200 xl:grid xl:grid-cols-5">
          {[
            { label: "Jobs", value: historyStats.total },
            { label: "Open", value: historyStats.open },
            { label: "Completed", value: historyStats.completed },
            { label: "Quoted", value: historyStats.quoted },
            { label: "Invoiced", value: historyStats.invoiced },
          ].map((stat) => (
            <div key={stat.label} className="data-stat-card bg-white px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{stat.value}</p>
            </div>
          ))}
        </div>

        <CardContent className="p-0">
        {filteredJobs.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No jobs found" text="Try adjusting the search or filters to find the job you want." />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto text-xs 2xl:hidden">
              <div className="data-grid grid min-w-[600px] gap-px bg-slate-200 md:min-w-0">
                <div className="data-grid-header grid grid-cols-[minmax(0,1.35fr)_minmax(210px,0.9fr)_170px_82px] gap-px bg-slate-200 font-semibold uppercase tracking-[0.12em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-3 [&>*]:py-2">
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
                    className="data-grid-row grid cursor-pointer select-none grid-cols-[minmax(0,1.35fr)_minmax(210px,0.9fr)_170px_82px] gap-px bg-slate-200 transition [&>*]:bg-white [&>*]:px-3 [&>*]:py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Job #{job.jobNumber}</p>
                      <p className="truncate font-semibold text-slate-950">{job.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{job.description || "No description saved."}</p>
                    </div>

                    <div className="min-w-0 text-slate-700">
                      <p className="truncate font-medium text-slate-900">{job.customerName}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{job.jobAddress || "No site address saved"}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</p>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <Badge className={`${statusThemes[job.status]?.badge || "bg-slate-100 text-slate-700"} px-1.5 py-0 text-[10px]`}>{job.status}</Badge>
                      <Badge className={`${getUrgencyBadgeClassName(job.urgency)} px-1.5 py-0 text-[10px]`}>{job.urgency || "Low"}</Badge>
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{job.hasQuote ? "Quote" : "No quote"}</Badge>
                      <Badge className={`${job.invoiceStatus.className} ${job.invoiceStatus.id === "overdue" ? "ring-2 ring-rose-200" : ""} px-1.5 py-0 text-[10px]`}>{job.invoiceStatus.label}</Badge>
                    </div>

                    <div className="flex items-center justify-end">
                      <Button variant="outline" size="sm" className="h-7 rounded-md border-slate-300 px-2 text-[11px]" onClick={() => onOpenJob(job)}>
                        Open
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden overflow-x-auto 2xl:block">
            <div className="min-w-[1520px]">
              <div className="data-grid grid gap-px bg-slate-200">
                <div className="data-grid-header grid grid-cols-[1.55fr_1.2fr_120px_110px_130px_180px_150px_130px] gap-px bg-slate-200 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-5 [&>*]:py-3">
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
                    className="data-grid-row grid cursor-pointer select-none grid-cols-[1.55fr_1.2fr_120px_110px_130px_180px_150px_130px] gap-px bg-slate-200 text-sm transition [&>*]:bg-white [&>*]:px-5 [&>*]:py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
                      <p className="truncate font-semibold text-slate-950">{job.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{job.description || "No description saved."}</p>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{job.customerName}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{job.jobAddress || "No site address saved"}</p>
                    </div>

                    <div>
                      <Badge className={statusThemes[job.status]?.badge || "bg-slate-100 text-slate-700"}>{job.status}</Badge>
                    </div>

                    <div>
                      <Badge className={getUrgencyBadgeClassName(job.urgency)}>{job.urgency || "Low"}</Badge>
                    </div>

                    <p className="text-slate-700">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</p>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{job.hasQuote ? "Quote saved" : "No quote"}</Badge>
                      <Badge className={`${job.invoiceStatus.className} ${job.invoiceStatus.id === "overdue" ? "ring-2 ring-rose-200" : ""}`}>{job.invoiceStatus.label}</Badge>
                    </div>

                    <div>
                      <p className="font-medium text-slate-900">{formatDate(job.updatedAt)}</p>
                      <p className="mt-1 text-xs text-slate-500">Created {formatDate(job.createdAt)}</p>
                    </div>

                    <div className="flex items-center justify-end">
                      <Button variant="outline" size="sm" className="rounded-md border-slate-300" onClick={() => onOpenJob(job)}>
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
          <SelectTrigger id="mobile-job-status-filter" className="h-11 w-full rounded-xl bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-job-urgency-filter" label="Urgency">
        <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
          <SelectTrigger id="mobile-job-urgency-filter" className="h-11 w-full rounded-xl bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgency levels</SelectItem>
            {urgencyOptions.map((urgency) => <SelectItem key={urgency} value={urgency}>{urgency}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-job-document-filter" label="Documents">
        <Select value={documentFilter} onValueChange={setDocumentFilter}>
          <SelectTrigger id="mobile-job-document-filter" className="h-11 w-full rounded-xl bg-white"><SelectValue /></SelectTrigger>
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
          <SelectTrigger id="mobile-job-created-range" className="h-11 w-full rounded-xl bg-white"><SelectValue /></SelectTrigger>
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
          <Input id="mobile-job-created-from" type="date" className="h-11 rounded-xl bg-white" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
        </FilterSheetField>
        <FilterSheetField id="mobile-job-created-to" label="Created to">
          <Input id="mobile-job-created-to" type="date" className="h-11 rounded-xl bg-white" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
        </FilterSheetField>
      </div>
      <p className="text-xs leading-5 text-slate-500">Quick range and custom dates are combined when both are selected.</p>
    </MobileFilterSheet>
    </>
  );
}
