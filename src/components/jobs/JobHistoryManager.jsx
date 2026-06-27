import { useDeferredValue, useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statuses, statusThemes } from "@/lib/job-status";
import { urgencyOptions } from "@/lib/app-support";

const DAY_IN_MS = 1000 * 60 * 60 * 24;

function getUrgencyBadgeClassName(urgency) {
  if (urgency === "High") return "bg-rose-100 text-rose-800";
  if (urgency === "Medium") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export default function JobHistoryManager({
  jobs,
  staff,
  onOpenJob,
  formatDate,
  getInvoiceStatus,
  toTimestamp,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("activity-recent");
  const [statusFilter, setStatusFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [createdRange, setCreatedRange] = useState("all-time");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [filterClock] = useState(() => ({ now: Date.now(), year: new Date().getFullYear() }));
  const deferredSearch = useDeferredValue(search);

  const technicianOptions = useMemo(
    () => [...staff].sort((a, b) => a.name.localeCompare(b.name)),
    [staff]
  );

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
            job.assignedTechnicianName,
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
      const matchesTechnician =
        technicianFilter === "all"
          ? true
          : technicianFilter === "unassigned"
            ? !job.assignedTechnicianId
            : job.assignedTechnicianId === technicianFilter;

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
        && matchesTechnician
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
  }, [createdFrom, createdRange, createdTo, deferredSearch, documentFilter, filterClock, jobRows, sortBy, statusFilter, technicianFilter, urgencyFilter, toTimestamp]);

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

  const resetFilters = () => {
    setSearch("");
    setSortBy("activity-recent");
    setStatusFilter("all");
    setUrgencyFilter("all");
    setTechnicianFilter("all");
    setDocumentFilter("all");
    setCreatedRange("all-time");
    setCreatedFrom("");
    setCreatedTo("");
  };

  const statSummary = [
    `${historyStats.total} Jobs`,
    `${historyStats.open} Open`,
    `${historyStats.completed} Completed`,
    `${historyStats.quoted} Quoted`,
    `${historyStats.invoiced} Invoiced`,
  ].join(" · ");

  return (
    <Card className="data-card gap-0 overflow-hidden rounded-xl border-slate-300 shadow-none">
      <CardHeader className="data-card-header space-y-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-lg leading-6">Job History</CardTitle>
            <p className="mt-0.5 truncate text-xs text-slate-600">
              Search, filter, and open saved job records.
            </p>
          </div>
          <div className="shrink-0 text-xs text-slate-600">
            Showing <span className="font-semibold text-slate-900">{filteredJobs.length}</span> of {jobRows.length} jobs
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700">
          {statSummary.split(" · ").map((stat, index) => (
            <span key={stat} className={index === 0 ? "font-semibold text-slate-950" : ""}>
              {stat}
            </span>
          ))}
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
            <Input
              className="data-toolbar-field rounded-lg border-slate-300 bg-white"
              placeholder="Search job, customer, technician, address, or status..."
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

          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              className="data-toolbar-button rounded-lg border-slate-300 bg-white px-4"
              onClick={resetFilters}
            >
              Reset
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[180px_190px_220px_180px_170px_170px_170px]">
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Technician</p>
            <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All technicians</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {technicianOptions.map((technician) => (
                  <SelectItem key={technician.id} value={technician.id}>
                    {technician.name}
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
      </CardHeader>

      <CardContent className="p-0">
        {filteredJobs.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No jobs found" text="Try adjusting the search or filters to find the job you want." />
          </div>
        ) : (
          <>
            <div className="text-xs 2xl:hidden">
              <div className="data-grid grid gap-px bg-slate-200">
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
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{job.assignedTechnicianName || "Unassigned"} - {job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</p>
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
                <div className="data-grid-header grid grid-cols-[1.55fr_1.2fr_120px_110px_130px_170px_180px_150px_130px] gap-px bg-slate-200 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-5 [&>*]:py-3">
                  <span>Job</span>
                  <span>Customer & Site</span>
                  <span>Status</span>
                  <span>Urgency</span>
                  <span>Scheduled</span>
                  <span>Technician</span>
                  <span>Documents</span>
                  <span>Last Activity</span>
                  <span className="text-right">Action</span>
                </div>

                {filteredJobs.map((job) => (
                  <div
                    key={job.id}
                    onDoubleClick={() => onOpenJob(job)}
                    title="Double-click to open job"
                    className="data-grid-row grid cursor-pointer select-none grid-cols-[1.55fr_1.2fr_120px_110px_130px_170px_180px_150px_130px] gap-px bg-slate-200 text-sm transition [&>*]:bg-white [&>*]:px-5 [&>*]:py-3"
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

                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{job.assignedTechnicianName || "Unassigned"}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{job.customerPhone || job.customerEmail || "No contact saved"}</p>
                    </div>

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
  );
}
