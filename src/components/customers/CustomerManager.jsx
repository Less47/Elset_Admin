import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useUserUiPreference } from "@/hooks/useUserUiPreferences";
import { Plus } from "lucide-react";
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
  PagePrimaryAction,
  PageSearchField,
  ResponsivePageControls,
  ResultSummary,
  ViewModeToggle,
} from "@/components/shared/ResponsivePageControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerTypeOptions, formatCustomerType } from "@/lib/app-support";

const NOT_SET_FILTER_VALUE = "__not_set__";
const customerSortOptions = [
  { value: "name-asc", label: "A-Z" },
  { value: "name-desc", label: "Z-A" },
  { value: "created-newest", label: "Newest" },
  { value: "created-oldest", label: "Oldest" },
  { value: "jobs-most", label: "Most jobs" },
  { value: "activity-recent", label: "Recent activity" },
];

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
  const [viewMode, setViewMode] = useUserUiPreference("customerView");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterClock] = useState(() => ({ now: Date.now(), year: new Date().getFullYear() }));
  const filterTriggerRef = useRef(null);
  const deferredSearch = useDeferredValue(search);
  const isMobileRecordLayout = useMobileRecordLayout();

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
  const activeFilterCount = [filterBy !== "all", createdRange !== "all-time", customerTypeFilter !== "all"]
    .filter(Boolean).length;

  const renderCustomerCards = (className) => (
    <div className={className}>
      {filteredCustomers.map((customer) => (
        <div
          key={customer.id}
          onDoubleClick={() => onOpenProfile(customer.id)}
          title="Double-click to open customer profile"
          className="data-record-card cursor-pointer select-none rounded-2xl border bg-card p-3 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{customer.name}</p>
              <p className="mt-1 text-sm text-text-secondary">{customer.address || "No address saved"}</p>
            </div>
            {customer.customerType ? <Badge className="bg-surface-raised text-text-secondary">{formatCustomerType(customer.customerType)}</Badge> : null}
          </div>

          <div className="mt-4 grid gap-2 border-t border-border pt-3 text-sm text-text-secondary sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <span>Email</span>
              <span className="truncate font-medium text-foreground">{customer.email || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Phone</span>
              <span className="truncate font-medium text-foreground">{customer.phone || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Jobs</span>
              <span className="font-medium text-foreground">{customer.jobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Open jobs</span>
              <span className="font-medium text-foreground">{customer.openJobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <span>Last activity</span>
              <span className="font-medium text-foreground">{customer.latestUpdatedAt ? formatDate(customer.latestUpdatedAt) : "No activity"}</span>
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
    <>
    <div className="space-y-4">
      <ResponsivePageControls
        search={(
          <PageSearchField
            value={search}
            onChange={setSearch}
            placeholder="Search customers..."
            label="Search customers"
          />
        )}
        controls={(
          <>
            <FilterButton ref={filterTriggerRef} activeCount={activeFilterCount} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
            <CompactSortControl value={sortBy} onValueChange={setSortBy} options={customerSortOptions} label="Sort customers" />
            <div className="hidden md:block">
              <ViewModeToggle value={viewMode} onChange={setViewMode} label="Customer view" />
            </div>
          </>
        )}
        action={(
          <PagePrimaryAction onClick={onCreateCustomer}>
            <Plus className="h-4 w-4" /> New Customer
          </PagePrimaryAction>
        )}
        summary={<ResultSummary>{filteredCustomers.length} {filteredCustomers.length === 1 ? "customer" : "customers"}</ResultSummary>}
      />

      <DesktopPageControls
        search={(
          <DesktopControlField label="Search" size="search">
            <PageSearchField compact value={search} onChange={setSearch} placeholder="Search customers..." label="Search customers" />
          </DesktopControlField>
        )}
        viewToggle={(
          <DesktopControlField label="View" size="view">
            <ViewModeToggle compact value={viewMode} onChange={setViewMode} label="Customer view" />
          </DesktopControlField>
        )}
        filters={(
          <>
          <DesktopControlField htmlFor="desktop-customer-sort" label="Sort by" size="small">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger id="desktop-customer-sort" className="data-toolbar-field rounded-lg border-border bg-card">
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
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-customer-record-filter" label="Record filter" size="medium">
            <Select value={filterBy} onValueChange={setFilterBy}>
              <SelectTrigger id="desktop-customer-record-filter" className="data-toolbar-field rounded-lg border-border bg-card">
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
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-customer-created-range" label="Created" size="small">
            <Select value={createdRange} onValueChange={setCreatedRange}>
              <SelectTrigger id="desktop-customer-created-range" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue placeholder="Created range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-time">All time</SelectItem>
                <SelectItem value="last-30">Last 30 days</SelectItem>
                <SelectItem value="last-90">Last 90 days</SelectItem>
                <SelectItem value="this-year">This year</SelectItem>
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-customer-type-filter" label="Customer type" size="medium">
            <Select value={customerTypeFilter} onValueChange={setCustomerTypeFilter}>
              <SelectTrigger id="desktop-customer-type-filter" className="data-toolbar-field rounded-lg border-border bg-card">
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
          </DesktopControlField>
          </>
        )}
        actions={(
          <PagePrimaryAction compact onClick={onCreateCustomer}>
            <Plus className="h-4 w-4" /> New Customer
          </PagePrimaryAction>
        )}
      />

      <Card
        className={isMobileRecordLayout
          ? "gap-0 overflow-visible rounded-none border-0 bg-transparent py-0 shadow-none"
          : "data-card gap-0 overflow-hidden rounded-xl border-border shadow-none"}
        data-mobile-record-results-shell={isMobileRecordLayout ? "" : undefined}
      >
      <CardContent className={isMobileRecordLayout ? "p-0" : viewMode !== "list" ? "p-panel" : "p-0"}>
        {filteredCustomers.length === 0 ? (
          <div className={!isMobileRecordLayout && viewMode === "list" ? "p-panel" : ""}>
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
        ) : isMobileRecordLayout ? (
          <MobileRecordList label="Customers">
            {filteredCustomers.map((customer) => {
              const headingId = `mobile-customer-${encodeURIComponent(customer.id)}-title`;
              return (
                <MobileRecordCard key={customer.id} labelledBy={headingId} recordId={customer.id}>
                  <MobileRecordHeader>
                    <div className="min-w-0">
                      <h3 id={headingId} className="line-clamp-2 text-[15px] font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
                        {customer.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-4 text-text-secondary [overflow-wrap:anywhere]">
                        {customer.address || "No address saved"}
                      </p>
                    </div>
                    {customer.customerType ? (
                      <Badge className="max-w-[44%] shrink-0 bg-surface-raised text-text-secondary">
                        {formatCustomerType(customer.customerType)}
                      </Badge>
                    ) : null}
                  </MobileRecordHeader>

                  <MobileRecordBody>
                    <p className="line-clamp-1 text-text-secondary"><span className="sr-only">Email: </span>{customer.email || "No email"}</p>
                    <p className="line-clamp-1 text-text-secondary"><span className="sr-only">Phone: </span>{customer.phone || "No phone"}</p>
                  </MobileRecordBody>

                  <MobileRecordActions>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-border px-3"
                      aria-label={`Open profile for ${customer.name}`}
                      onClick={() => onOpenProfile(customer.id)}
                    >
                      Open Profile
                    </Button>
                  </MobileRecordActions>
                </MobileRecordCard>
              );
            })}
          </MobileRecordList>
        ) : (
          <div data-desktop-record-results>
            {viewMode === "list" ? (
              <>
              <div className="overflow-x-auto text-xs 2xl:hidden">
                <div className="data-grid grid min-w-[600px] gap-px bg-surface-selected md:min-w-0">
                  <div className="data-grid-header grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_104px_96px] gap-px bg-surface-selected font-semibold uppercase tracking-[0.12em] text-muted-foreground [&>*]:bg-surface-raised">
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
                      className="data-grid-row grid cursor-pointer select-none grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_104px_96px] gap-px bg-surface-selected transition [&>*]:bg-card"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate font-semibold text-foreground">{customer.name}</p>
                          {customer.customerType ? <Badge className="hidden bg-surface-raised px-1.5 py-0 text-[10px] text-text-secondary xl:inline-flex">{formatCustomerType(customer.customerType)}</Badge> : null}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{customer.address || "No address saved"}</p>
                      </div>
                      <div className="min-w-0 text-text-secondary">
                        <p className="truncate">{customer.email || "No email"}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{customer.phone || "No phone"}</p>
                      </div>
                      <div className="min-w-0 text-text-secondary">
                        <p className="truncate">{customer.latestUpdatedAt ? formatDate(customer.latestUpdatedAt) : "No activity"}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Created {formatDate(customer.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="text-right text-[11px] text-text-secondary">
                          <span className="font-semibold text-foreground">{customer.jobCount}</span> total / <span className="font-semibold text-foreground">{customer.openJobCount}</span> open
                        </p>
                        <Button variant="outline" size="sm" className="h-7 rounded-md border-border px-2 text-[11px]" onClick={() => onOpenProfile(customer.id)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden overflow-x-auto 2xl:block">
              <div className="min-w-[1180px]">
                <div className="data-grid grid gap-px bg-surface-selected">
                  <div className="data-grid-header grid grid-cols-[1.8fr_1.25fr_1fr_120px_130px_90px_90px_130px] gap-px bg-surface-selected text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground [&>*]:bg-surface-raised">
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
                      className="data-grid-row grid cursor-pointer select-none grid-cols-[1.8fr_1.25fr_1fr_120px_130px_90px_90px_130px] gap-px bg-surface-selected text-sm transition [&>*]:bg-card"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-foreground">{customer.name}</p>
                          {customer.customerType ? <Badge className="bg-surface-raised text-text-secondary">{formatCustomerType(customer.customerType)}</Badge> : null}
                        </div>
                        <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0 font-mono uppercase tracking-[0.12em]">{customer.id.slice(0, 8)}</span>
                          <span className="truncate">{customer.address || "No address saved"}</span>
                        </div>
                      </div>
                      <p className="truncate text-text-secondary">{customer.email || "Not set"}</p>
                      <p className="truncate text-text-secondary">{customer.phone || "Not set"}</p>
                      <p className="text-text-secondary">{formatDate(customer.createdAt)}</p>
                      <p className="text-text-secondary">{customer.latestUpdatedAt ? formatDate(customer.latestUpdatedAt) : "No activity"}</p>
                      <div className="text-right">
                        <span className="font-medium text-foreground">{customer.jobCount}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-foreground">{customer.openJobCount}</span>
                      </div>
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" className="rounded-md border-border" onClick={() => onOpenProfile(customer.id)}>
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
      description="Filter customers without taking space away from the customer list."
      onReset={() => {
        setFilterBy("all");
        setCreatedRange("all-time");
        setCustomerTypeFilter("all");
      }}
    >
      <FilterSheetField id="mobile-customer-record-filter" label="Record filter">
        <Select value={filterBy} onValueChange={setFilterBy}>
          <SelectTrigger id="mobile-customer-record-filter" className="h-11 w-full rounded-xl bg-card">
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
      </FilterSheetField>
      <FilterSheetField id="mobile-customer-created-range" label="Created">
        <Select value={createdRange} onValueChange={setCreatedRange}>
          <SelectTrigger id="mobile-customer-created-range" className="h-11 w-full rounded-xl bg-card">
            <SelectValue placeholder="Created range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-time">All time</SelectItem>
            <SelectItem value="last-30">Last 30 days</SelectItem>
            <SelectItem value="last-90">Last 90 days</SelectItem>
            <SelectItem value="this-year">This year</SelectItem>
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-customer-type-filter" label="Customer type">
        <Select value={customerTypeFilter} onValueChange={setCustomerTypeFilter}>
          <SelectTrigger id="mobile-customer-type-filter" className="h-11 w-full rounded-xl bg-card">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
            {customerTypeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterSheetField>
    </MobileFilterSheet>
    </>
  );
}
