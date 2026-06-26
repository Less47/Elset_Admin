import { useDeferredValue, useMemo, useState } from "react";
import { LayoutGrid, List, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerTypeOptions, formatCustomerType } from "@/lib/app-support";

const NOT_SET_FILTER_VALUE = "__not_set__";

export default function CustomerManager({
  customers,
  jobs,
  onOpenProfile,
  onCreateCustomer,
  formatDate,
  toTimestamp,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name-asc");
  const [filterBy, setFilterBy] = useState("all");
  const [customerTypeFilter, setCustomerTypeFilter] = useState("all");
  const [createdRange, setCreatedRange] = useState("all-time");
  const [viewMode, setViewMode] = useState("list");
  const [filterClock] = useState(() => ({ now: Date.now(), year: new Date().getFullYear() }));
  const deferredSearch = useDeferredValue(search);

  const jobsByCustomerId = useMemo(() => {
    return jobs.reduce((map, job) => {
      const current = map.get(job.customerId) || {
        jobCount: 0,
        openJobCount: 0,
        latestUpdatedAt: "",
      };
      const latestUpdatedAt = toTimestamp(job.updatedAt) > toTimestamp(current.latestUpdatedAt)
        ? job.updatedAt
        : current.latestUpdatedAt;
      map.set(job.customerId, {
        jobCount: current.jobCount + 1,
        openJobCount: current.openJobCount + (job.status === "Completed" ? 0 : 1),
        latestUpdatedAt,
      });
      return map;
    }, new Map());
  }, [jobs, toTimestamp]);

  const customerRows = useMemo(() => {
    return customers.map((customer) => {
      const metrics = jobsByCustomerId.get(customer.id) || {
        jobCount: 0,
        openJobCount: 0,
        latestUpdatedAt: "",
      };

      return {
        ...customer,
        jobCount: metrics.jobCount,
        openJobCount: metrics.openJobCount,
        latestUpdatedAt: metrics.latestUpdatedAt,
      };
    });
  }, [customers, jobsByCustomerId]);

  const filteredCustomers = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    const rows = customerRows.filter((customer) => {
      const matchesSearch = q
        ? [
            customer.name,
            customer.email,
            customer.phone,
            customer.customerType,
            customer.address,
            ...(customer.siteAccessNotes || []).flatMap((site) => [site.address, site.notes]),
            ...(customer.sites || []).flatMap((site) => [
              site.label,
              site.address,
              site.siteType,
              site.accessNotes,
              site.notes,
              site.contactName,
              site.contactPhone,
              ...(site.assets || []).flatMap((asset) => [asset.name, asset.type, asset.location, asset.model, asset.notes]),
            ]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
        : true;

      const matchesFilter =
        filterBy === "all"
          ? true
          : filterBy === "with-jobs"
            ? customer.jobCount > 0
          : filterBy === "open-jobs"
            ? customer.openJobCount > 0
          : filterBy === "no-jobs"
            ? customer.jobCount === 0
            : !customer.email;

      const createdAt = toTimestamp(customer.createdAt);
      const matchesCreatedRange =
        createdRange === "all-time"
          ? true
          : createdRange === "last-30"
            ? createdAt >= filterClock.now - 1000 * 60 * 60 * 24 * 30
          : createdRange === "last-90"
            ? createdAt >= filterClock.now - 1000 * 60 * 60 * 24 * 90
            : new Date(customer.createdAt).getFullYear() === filterClock.year;

      const matchesCustomerType =
        customerTypeFilter === "all"
          ? true
          : customerTypeFilter === NOT_SET_FILTER_VALUE
            ? !customer.customerType
            : customer.customerType === customerTypeFilter;

      return matchesSearch && matchesFilter && matchesCreatedRange && matchesCustomerType;
    });

    rows.sort((a, b) => {
      if (sortBy === "name-desc") return b.name.localeCompare(a.name);
      if (sortBy === "created-newest") return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
      if (sortBy === "created-oldest") return toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
      if (sortBy === "jobs-most") return b.jobCount - a.jobCount || a.name.localeCompare(b.name);
      if (sortBy === "activity-recent") {
        return toTimestamp(b.latestUpdatedAt) - toTimestamp(a.latestUpdatedAt);
      }
      return a.name.localeCompare(b.name);
    });

    return rows;
  }, [createdRange, customerRows, customerTypeFilter, deferredSearch, filterBy, filterClock, sortBy, toTimestamp]);

  const renderCustomerCards = (className) => (
    <div className={className}>
      {filteredCustomers.map((customer) => (
        <div
          key={customer.id}
          onDoubleClick={() => onOpenProfile(customer.id)}
          title="Double-click to open customer profile"
          className="data-record-card cursor-pointer select-none rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{customer.name}</p>
              <p className="mt-1 text-sm text-slate-600">{customer.address || "No address saved"}</p>
            </div>
            {customer.customerType ? <Badge className="bg-slate-100 text-slate-700">{formatCustomerType(customer.customerType)}</Badge> : null}
          </div>

          <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <span>Email</span>
              <span className="truncate font-medium text-slate-900">{customer.email || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Phone</span>
              <span className="truncate font-medium text-slate-900">{customer.phone || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Jobs</span>
              <span className="font-medium text-slate-900">{customer.jobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Open jobs</span>
              <span className="font-medium text-slate-900">{customer.openJobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <span>Last activity</span>
              <span className="font-medium text-slate-900">{customer.latestUpdatedAt ? formatDate(customer.latestUpdatedAt) : "No activity"}</span>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button variant="outline" className="rounded-xl" onClick={() => onOpenProfile(customer.id)}>
              Open Profile
            </Button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Card className="data-card gap-0 overflow-hidden rounded-xl border-slate-300 shadow-none">
      <CardHeader className="data-card-header space-y-4 border-b border-slate-200 bg-slate-50 px-5 py-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle className="text-lg">Customer Database</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Review customer records in a structured table and open a profile only when you want to edit details.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center">
            <div>
              Showing <span className="font-semibold text-slate-900">{filteredCustomers.length}</span> of {customerRows.length} records
            </div>
            <div className="data-toggle-shell inline-flex rounded-lg border border-slate-300 bg-white p-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`rounded-md px-3 ${viewMode === "list" ? "bg-slate-900 text-white hover:bg-slate-900 hover:text-white" : "text-slate-600 hover:text-slate-900"}`}
                onClick={() => setViewMode("list")}
              >
                <List className="mr-2 h-4 w-4" /> List
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`rounded-md px-3 ${viewMode === "grid" ? "bg-slate-900 text-white hover:bg-slate-900 hover:text-white" : "text-slate-600 hover:text-slate-900"}`}
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="mr-2 h-4 w-4" /> Grid
              </Button>
            </div>
            <Button className="rounded-lg" onClick={onCreateCustomer}>
              <Plus className="mr-2 h-4 w-4" /> New Customer
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.45fr)_200px_200px_200px_200px_auto]">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
            <Input
              className="data-toolbar-field rounded-lg border-slate-300 bg-white"
              placeholder="Search by name, email, phone, or address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue placeholder="Sort customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">Alphabetical A-Z</SelectItem>
                <SelectItem value="name-desc">Alphabetical Z-A</SelectItem>
                <SelectItem value="created-newest">Date created: newest</SelectItem>
                <SelectItem value="created-oldest">Date created: oldest</SelectItem>
                <SelectItem value="jobs-most">Most jobs</SelectItem>
                <SelectItem value="activity-recent">Recent activity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Record filter</p>
            <Select value={filterBy} onValueChange={setFilterBy}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue placeholder="Filter customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                <SelectItem value="with-jobs">With jobs</SelectItem>
                <SelectItem value="open-jobs">With open jobs</SelectItem>
                <SelectItem value="no-jobs">No jobs yet</SelectItem>
                <SelectItem value="missing-email">Missing email</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Created</p>
            <Select value={createdRange} onValueChange={setCreatedRange}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue placeholder="Created range" />
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer type</p>
            <Select value={customerTypeFilter} onValueChange={setCustomerTypeFilter}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
                {customerTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              className="data-toolbar-button w-full rounded-lg border-slate-300 bg-white 2xl:w-auto"
              onClick={() => {
                setSearch("");
                setSortBy("name-asc");
                setFilterBy("all");
                setCreatedRange("all-time");
                setCustomerTypeFilter("all");
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className={viewMode === "list" ? "p-0" : "p-5"}>
        {filteredCustomers.length === 0 ? (
          <div className={viewMode === "list" ? "p-6" : ""}>
            <EmptyState
              title="No customers found"
              text="Try adjusting the search or filters, or create a new customer record."
              action={(
                <Button className="rounded-lg" onClick={onCreateCustomer}>
                  <Plus className="mr-2 h-4 w-4" /> New Customer
                </Button>
              )}
            />
          </div>
        ) : (
          viewMode === "list" ? (
            <>
              <div className="text-xs 2xl:hidden">
                <div className="data-grid grid gap-px bg-slate-200">
                  <div className="data-grid-header grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_104px_96px] gap-px bg-slate-200 font-semibold uppercase tracking-[0.12em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-3 [&>*]:py-2">
                    <span>Customer</span>
                    <span>Contact</span>
                    <span>Activity</span>
                    <span className="text-right">Jobs</span>
                  </div>

                  {filteredCustomers.map((customer) => (
                    <div
                      key={customer.id}
                      onDoubleClick={() => onOpenProfile(customer.id)}
                      title="Double-click to open customer profile"
                      className="data-grid-row grid cursor-pointer select-none grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_104px_96px] gap-px bg-slate-200 transition [&>*]:bg-white [&>*]:px-3 [&>*]:py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate font-semibold text-slate-950">{customer.name}</p>
                          {customer.customerType ? <Badge className="hidden bg-slate-100 px-1.5 py-0 text-[10px] text-slate-700 xl:inline-flex">{formatCustomerType(customer.customerType)}</Badge> : null}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{customer.address || "No address saved"}</p>
                      </div>
                      <div className="min-w-0 text-slate-700">
                        <p className="truncate">{customer.email || "No email"}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{customer.phone || "No phone"}</p>
                      </div>
                      <div className="min-w-0 text-slate-700">
                        <p className="truncate">{customer.latestUpdatedAt ? formatDate(customer.latestUpdatedAt) : "No activity"}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">Created {formatDate(customer.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="text-right text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-950">{customer.jobCount}</span> total / <span className="font-semibold text-slate-950">{customer.openJobCount}</span> open
                        </p>
                        <Button variant="outline" size="sm" className="h-7 rounded-md border-slate-300 px-2 text-[11px]" onClick={() => onOpenProfile(customer.id)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden overflow-x-auto 2xl:block">
              <div className="min-w-[1180px]">
                <div className="data-grid grid gap-px bg-slate-200">
                  <div className="data-grid-header grid grid-cols-[1.8fr_1.25fr_1fr_120px_130px_90px_90px_130px] gap-px bg-slate-200 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-5 [&>*]:py-3">
                    <span>Customer</span>
                    <span>Email</span>
                    <span>Phone</span>
                    <span>Created</span>
                    <span>Last Activity</span>
                    <span className="text-right">Jobs</span>
                    <span className="text-right">Open</span>
                    <span className="text-right">Action</span>
                  </div>

                  {filteredCustomers.map((customer) => (
                    <div
                      key={customer.id}
                      onDoubleClick={() => onOpenProfile(customer.id)}
                      title="Double-click to open customer profile"
                      className="data-grid-row grid cursor-pointer select-none grid-cols-[1.8fr_1.25fr_1fr_120px_130px_90px_90px_130px] gap-px bg-slate-200 text-sm transition [&>*]:bg-white [&>*]:px-5 [&>*]:py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-slate-950">{customer.name}</p>
                          {customer.customerType ? <Badge className="bg-slate-100 text-slate-700">{formatCustomerType(customer.customerType)}</Badge> : null}
                        </div>
                        <div className="mt-1 flex gap-2 text-xs text-slate-500">
                          <span className="shrink-0 font-mono uppercase tracking-[0.12em]">{customer.id.slice(0, 8)}</span>
                          <span className="truncate">{customer.address || "No address saved"}</span>
                        </div>
                      </div>
                      <p className="truncate text-slate-700">{customer.email || "Not set"}</p>
                      <p className="truncate text-slate-700">{customer.phone || "Not set"}</p>
                      <p className="text-slate-700">{formatDate(customer.createdAt)}</p>
                      <p className="text-slate-700">{customer.latestUpdatedAt ? formatDate(customer.latestUpdatedAt) : "No activity"}</p>
                      <div className="text-right">
                        <span className="font-medium text-slate-950">{customer.jobCount}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-slate-950">{customer.openJobCount}</span>
                      </div>
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" className="rounded-md border-slate-300" onClick={() => onOpenProfile(customer.id)}>
                          Open Profile
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </div>
            </>
          ) : (
            renderCustomerCards("grid gap-4 lg:grid-cols-2 2xl:grid-cols-3")
          )
        )}
      </CardContent>
    </Card>
  );
}
