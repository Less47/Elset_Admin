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

  return (
    <Card className="overflow-hidden rounded-xl border-slate-300 shadow-none">
      <CardHeader className="space-y-4 border-b border-slate-200 bg-slate-50 px-5 py-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle className="text-lg">Job History</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Search every saved job in one database view, filter it down fast, and open the full record when you need details.
            </p>
          </div>
          <div className="text-sm text-slate-600">
            Showing <span className="font-semibold text-slate-900">{filteredJobs.length}</span> of {jobRows.length} jobs
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_200px_180px_180px]">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
            <Input
              className="rounded-lg border-slate-300 bg-white"
              placeholder="Search job, customer, technician, address, or status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
              <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
              <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[220px_200px_170px_170px_170px_auto] xl:items-end">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Technician</p>
            <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
              <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
              <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
              <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
              className="rounded-lg border-slate-300 bg-white"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Created to</p>
            <Input
              type="date"
              className="rounded-lg border-slate-300 bg-white"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full rounded-lg border-slate-300 bg-white xl:w-auto"
              onClick={resetFilters}
            >
              Reset
            </Button>
          </div>
        </div>
      </CardHeader>

      <div className="grid gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-5">
        {[
          { label: "Jobs", value: historyStats.total },
          { label: "Open", value: historyStats.open },
          { label: "Completed", value: historyStats.completed },
          { label: "Quoted", value: historyStats.quoted },
          { label: "Invoiced", value: historyStats.invoiced },
        ].map((stat) => (
          <div key={stat.label} className="bg-white px-5 py-4">
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
          <div className="overflow-x-auto bg-white">
            <div className="min-w-[1520px]">
              <div className="grid grid-cols-[1.55fr_1.2fr_120px_110px_130px_170px_180px_150px_130px] border-b border-slate-200 bg-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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

              {filteredJobs.map((job, index) => (
                <div
                  key={job.id}
                  onDoubleClick={() => onOpenJob(job)}
                  title="Double-click to open job"
                  className={`grid cursor-pointer select-none grid-cols-[1.55fr_1.2fr_120px_110px_130px_170px_180px_150px_130px] items-center px-5 py-3 text-sm transition hover:bg-slate-50 ${
                    index !== filteredJobs.length - 1 ? "border-b border-slate-200" : ""
                  }`}
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
                    <Badge className={job.invoiceStatus.className}>{job.invoiceStatus.label}</Badge>
                  </div>

                  <div>
                    <p className="font-medium text-slate-900">{formatDate(job.updatedAt)}</p>
                    <p className="mt-1 text-xs text-slate-500">Created {formatDate(job.createdAt)}</p>
                  </div>

                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" className="rounded-md border-slate-300" onClick={() => onOpenJob(job)}>
                      Open Job
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
