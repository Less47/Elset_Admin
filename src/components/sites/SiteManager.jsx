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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCustomerType, formatSiteType, siteTypeOptions } from "@/lib/app-support";

const NOT_SET_FILTER_VALUE = "__not_set__";
const siteSortOptions = [
  { value: "activity", label: "Recent" },
  { value: "jobs", label: "Most jobs" },
  { value: "customer", label: "Customer" },
  { value: "address", label: "Address" },
];

export default function SiteManager({
  customers,
  jobs,
  onOpenSite,
  onCreateSite,
  buildCustomerSites,
  formatDate,
  getSiteDisplayName,
  toTimestamp,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("activity");
  const [siteTypeFilter, setSiteTypeFilter] = useState("all");
  const [viewMode, setViewMode] = useUserUiPreference("siteView");
  const [createSiteDialogOpen, setCreateSiteDialogOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newSiteCustomerId, setNewSiteCustomerId] = useState("");
  const [newSiteCustomerSearch, setNewSiteCustomerSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const deferredNewSiteCustomerSearch = useDeferredValue(newSiteCustomerSearch);
  const filterTriggerRef = useRef(null);
  const isMobileRecordLayout = useMobileRecordLayout();

  const customerOptions = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );

  const selectedNewSiteCustomerId = customerOptions.some((customer) => customer.id === newSiteCustomerId)
    ? newSiteCustomerId
    : customerOptions[0]?.id || "";
  const selectedNewSiteCustomer = useMemo(
    () => customerOptions.find((customer) => customer.id === selectedNewSiteCustomerId) || null,
    [customerOptions, selectedNewSiteCustomerId]
  );

  const filteredNewSiteCustomers = useMemo(() => {
    const query = deferredNewSiteCustomerSearch.toLowerCase().trim();
    if (!query) return customerOptions;

    return customerOptions.filter((customer) =>
      [
        customer.name,
        customer.email,
        customer.phone,
        customer.customerType,
        customer.address,
        ...(customer.siteAccessNotes || []).flatMap((site) => [site.address, site.notes]),
        ...(customer.sites || []).flatMap((site) => [site.label, site.address, site.siteType, site.ocNumber, site.accessNotes, site.notes]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [customerOptions, deferredNewSiteCustomerSearch]);

  const siteRows = useMemo(
    () =>
      customers.flatMap((customer) => {
        const customerJobs = jobs.filter((job) => job.customerId === customer.id);
        return buildCustomerSites(customer, customerJobs).map((site) => ({
          ...site,
          customer,
        }));
      }),
    [buildCustomerSites, customers, jobs]
  );

  const filteredSites = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const rows = siteRows.filter((site) => {
      const matchesSearch = query
        ? [
            site.customer.name,
            site.label,
            site.address,
            site.accessNotes,
            site.profileNotes,
            site.siteType,
            site.ocNumber,
            site.contactName,
            site.contactPhone,
            ...(site.assets || []).flatMap((asset) => [asset.name, asset.type, asset.location, asset.model, asset.notes]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true;

      const matchesSiteType =
        siteTypeFilter === "all"
          ? true
          : siteTypeFilter === NOT_SET_FILTER_VALUE
            ? !site.siteType
            : site.siteType === siteTypeFilter;

      return matchesSearch && matchesSiteType;
    });

    rows.sort((a, b) => {
      if (sortBy === "customer") return a.customer.name.localeCompare(b.customer.name) || getSiteDisplayName(a).localeCompare(getSiteDisplayName(b));
      if (sortBy === "address") return a.address.localeCompare(b.address);
      if (sortBy === "jobs") return b.jobCount - a.jobCount || getSiteDisplayName(a).localeCompare(getSiteDisplayName(b));
      return toTimestamp(b.latestUpdatedAt) - toTimestamp(a.latestUpdatedAt) || getSiteDisplayName(a).localeCompare(getSiteDisplayName(b));
    });

    return rows;
  }, [deferredSearch, getSiteDisplayName, siteRows, siteTypeFilter, sortBy, toTimestamp]);
  const activeFilterCount = siteTypeFilter === "all" ? 0 : 1;

  const renderSiteCards = (className) => (
    <div className={className}>
      {filteredSites.map((site) => (
        <div
          key={`${site.customer.id}-${site.id}`}
          onDoubleClick={() => onOpenSite(site.customer.id, site.id)}
          title="Double-click to open site profile"
          className="data-record-card cursor-pointer select-none rounded-2xl border bg-card p-3 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{site.customer.name}</p>
              <p className="mt-1 font-semibold text-foreground">{getSiteDisplayName(site)}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {site.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
              {site.siteType ? <Badge className="bg-status-success-surface text-status-success">{formatSiteType(site.siteType)}</Badge> : null}
              {site.ocNumber ? <Badge className="bg-status-special-surface text-status-special">OC {site.ocNumber}</Badge> : null}
              {site.assetCount > 0 ? <Badge className="bg-status-maintenance-surface text-status-maintenance">{site.assetCount} items</Badge> : null}
              {site.accessNotes ? <Badge className="bg-status-warning-surface text-status-warning">Access</Badge> : null}
            </div>
          </div>

          <div className="mt-4 grid gap-2 border-t border-border pt-3 text-sm text-text-secondary sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <span>Jobs</span>
              <span className="font-medium text-foreground">{site.jobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Open jobs</span>
              <span className="font-medium text-foreground">{site.openJobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <span>Last activity</span>
              <span className="font-medium text-foreground">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity"}</span>
            </div>
          </div>

          {site.profileNotes ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-secondary">{site.profileNotes}</p> : null}

          <div className="mt-4 flex justify-end">
            <Button variant="outline" className="rounded-xl" onClick={() => onOpenSite(site.customer.id, site.id)}>
              Open Site Profile
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
              placeholder="Search sites..."
              label="Search sites"
            />
          )}
          controls={(
            <>
              <FilterButton ref={filterTriggerRef} activeCount={activeFilterCount} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
              <CompactSortControl value={sortBy} onValueChange={setSortBy} options={siteSortOptions} label="Sort sites" />
              <div className="hidden md:block">
                <ViewModeToggle value={viewMode} onChange={setViewMode} label="Site view" />
              </div>
            </>
          )}
          action={(
            <PagePrimaryAction
              disabled={customerOptions.length === 0}
              onClick={() => {
                setNewSiteCustomerSearch("");
                setCreateSiteDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New Site
            </PagePrimaryAction>
          )}
          summary={<ResultSummary>{filteredSites.length} {filteredSites.length === 1 ? "site" : "sites"}</ResultSummary>}
        />

        <DesktopPageControls
          search={(
            <DesktopControlField label="Search" size="search">
              <PageSearchField
                compact
                value={search}
                onChange={setSearch}
                placeholder="Search customer, site, address, notes, or gate/project details..."
                label="Search sites"
              />
            </DesktopControlField>
          )}
          viewToggle={(
            <DesktopControlField label="View" size="view">
              <ViewModeToggle compact value={viewMode} onChange={setViewMode} label="Site view" />
            </DesktopControlField>
          )}
          filters={(
            <>
          <DesktopControlField htmlFor="desktop-site-sort" label="Sort by" size="medium">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger id="desktop-site-sort" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activity">Recent activity</SelectItem>
                <SelectItem value="jobs">Most jobs</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="address">Address</SelectItem>
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-site-type-filter" label="Site type" size="medium">
            <Select value={siteTypeFilter} onValueChange={setSiteTypeFilter}>
              <SelectTrigger id="desktop-site-type-filter" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
                {siteTypeOptions.map((option) => (
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
          <PagePrimaryAction
            compact
            disabled={customerOptions.length === 0}
            onClick={() => {
              setNewSiteCustomerSearch("");
              setCreateSiteDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New Site
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
          {filteredSites.length === 0 ? (
            <div className={!isMobileRecordLayout && viewMode === "list" ? "p-panel" : ""}>
              <EmptyState title="No sites found" text="Try adjusting the search or create a site from a customer record first." />
            </div>
          ) : isMobileRecordLayout ? (
            <MobileRecordList label="Sites">
              {filteredSites.map((site) => {
                const displayName = getSiteDisplayName(site);
                const headingId = `mobile-site-${encodeURIComponent(site.customer.id)}-${encodeURIComponent(site.id)}-title`;
                return (
                  <MobileRecordCard
                    key={`${site.customer.id}-${site.id}`}
                    labelledBy={headingId}
                    recordId={`${site.customer.id}-${site.id}`}
                  >
                    <MobileRecordHeader>
                      <div className="min-w-0">
                        <h3 id={headingId} className="line-clamp-2 text-[15px] font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
                          {displayName}
                        </h3>
                        {site.address && site.address !== displayName ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-4 text-text-secondary [overflow-wrap:anywhere]">{site.address}</p>
                        ) : null}
                      </div>
                      <div className="flex max-w-[48%] shrink-0 flex-wrap justify-end gap-1">
                        {site.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
                        {site.siteType ? <Badge className="bg-status-success-surface text-status-success">{formatSiteType(site.siteType)}</Badge> : null}
                      </div>
                    </MobileRecordHeader>

                    <MobileRecordBody>
                      <p className="text-text-secondary">
                        <span className="font-medium text-muted-foreground">Customer: </span>
                        <span className="font-medium text-foreground">{site.customer.name}</span>
                      </p>
                    </MobileRecordBody>

                    <MobileRecordActions>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-border px-3"
                        aria-label={`Open site ${displayName}`}
                        onClick={() => onOpenSite(site.customer.id, site.id)}
                      >
                        Open Site
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
                  <div className="data-grid grid min-w-[620px] gap-px bg-surface-selected md:min-w-0">
                    <div className="data-grid-header grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_104px_104px] gap-px bg-surface-selected font-semibold uppercase tracking-[0.12em] text-muted-foreground [&>*]:bg-surface-raised">
                      <span>Site</span>
                      <span>Customer</span>
                      <span>Activity</span>
                      <span className="text-right">Work</span>
                    </div>

                    {filteredSites.map((site) => (
                      <div
                        key={`${site.customer.id}-${site.id}`}
                        onDoubleClick={() => onOpenSite(site.customer.id, site.id)}
                        title="Double-click to open site profile"
                        className="data-grid-row grid cursor-pointer select-none grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_104px_104px] gap-px bg-surface-selected transition [&>*]:bg-card"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate font-semibold text-foreground">{getSiteDisplayName(site)}</p>
                            {site.isPrimary ? <Badge variant="secondary" className="hidden px-1.5 py-0 text-[10px] xl:inline-flex">Primary</Badge> : null}
                            {site.accessNotes ? <Badge className="hidden bg-status-warning-surface px-1.5 py-0 text-[10px] text-status-warning xl:inline-flex">Access</Badge> : null}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{site.address && getSiteDisplayName(site) !== site.address ? site.address : "Primary site"}</p>
                        </div>
                        <div className="min-w-0 text-text-secondary">
                          <p className="truncate font-medium text-foreground">{site.customer.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {[site.siteType ? formatSiteType(site.siteType) : "Type not set", site.ocNumber ? `OC ${site.ocNumber}` : ""].filter(Boolean).join(" - ")}
                          </p>
                        </div>
                        <div className="min-w-0 text-text-secondary">
                          <p className="truncate">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity"}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{site.assetCount} assets</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <p className="text-right text-[11px] text-text-secondary">
                            <span className="font-semibold text-foreground">{site.jobCount}</span> total / <span className="font-semibold text-foreground">{site.openJobCount}</span> open
                          </p>
                          <Button variant="outline" size="sm" className="h-7 rounded-md border-border px-2 text-[11px]" onClick={() => onOpenSite(site.customer.id, site.id)}>
                            Open
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hidden overflow-x-auto 2xl:block">
                <div className="min-w-[1200px]">
                  <div className="data-grid grid gap-px bg-surface-selected">
                    <div className="data-grid-header grid grid-cols-[1.8fr_1.2fr_140px_130px_90px_90px_100px_140px] gap-px bg-surface-selected text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground [&>*]:bg-surface-raised">
                      <span>Site</span>
                      <span>Customer</span>
                      <span>Type</span>
                      <span>Last Activity</span>
                      <span className="text-right">Jobs</span>
                      <span className="text-right">Open</span>
                      <span className="text-right">Assets</span>
                      <span className="text-right">Action</span>
                    </div>

                    {filteredSites.map((site) => (
                      <div
                        key={`${site.customer.id}-${site.id}`}
                        onDoubleClick={() => onOpenSite(site.customer.id, site.id)}
                        title="Double-click to open site profile"
                        className="data-grid-row grid cursor-pointer select-none grid-cols-[1.8fr_1.2fr_140px_130px_90px_90px_100px_140px] gap-px bg-surface-selected text-sm transition [&>*]:bg-card"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-semibold text-foreground">{getSiteDisplayName(site)}</p>
                            {site.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
                            {site.accessNotes ? <Badge className="bg-status-warning-surface text-status-warning">Access</Badge> : null}
                            {site.ocNumber ? <Badge className="bg-status-special-surface text-status-special">OC</Badge> : null}
                          </div>
                          <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0 font-mono uppercase tracking-[0.12em]">{site.id.slice(0, 8)}</span>
                            {site.address && getSiteDisplayName(site) !== site.address ? (
                              <span className="truncate">{site.address}</span>
                            ) : null}
                          </div>
                        </div>
                        <p className="truncate text-text-secondary">{site.customer.name}</p>
                        <div>
                          {site.siteType ? <Badge className="bg-status-success-surface text-status-success">{formatSiteType(site.siteType)}</Badge> : <span className="text-muted-foreground">Not set</span>}
                        </div>
                        <p className="text-text-secondary">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity"}</p>
                        <div className="text-right">
                          <span className="font-medium text-foreground">{site.jobCount}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-foreground">{site.openJobCount}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-foreground">{site.assetCount}</span>
                        </div>
                        <div className="flex justify-end">
                          <Button variant="outline" size="sm" className="rounded-md border-border" onClick={() => onOpenSite(site.customer.id, site.id)}>
                            Open Site
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                </div>
                </>
              ) : (
                renderSiteCards("grid gap-4 lg:grid-cols-2 2xl:grid-cols-3")
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
        description="Filter customer sites while keeping site records in view."
        onReset={() => setSiteTypeFilter("all")}
      >
        <FilterSheetField id="mobile-site-type-filter" label="Site type">
          <Select value={siteTypeFilter} onValueChange={setSiteTypeFilter}>
            <SelectTrigger id="mobile-site-type-filter" className="h-11 w-full rounded-xl bg-card">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
              {siteTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSheetField>
      </MobileFilterSheet>

      <Dialog
        open={createSiteDialogOpen}
        onOpenChange={(open) => {
          setCreateSiteDialogOpen(open);
          if (!open) setNewSiteCustomerSearch("");
        }}
      >
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Site</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Find customer</p>
              <Input
                className="rounded-lg bg-card"
                value={newSiteCustomerSearch}
                onChange={(event) => setNewSiteCustomerSearch(event.target.value)}
                placeholder="Search name, email, phone, or address..."
              />
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{filteredNewSiteCustomers.length} customer{filteredNewSiteCustomers.length === 1 ? "" : "s"} found</span>
              <span>{selectedNewSiteCustomer ? `Selected: ${selectedNewSiteCustomer.name}` : "No customer selected"}</span>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-muted">
              {filteredNewSiteCustomers.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No customers match that search yet.</div>
              ) : (
                filteredNewSiteCustomers.map((customer, index) => {
                  const isSelected = customer.id === selectedNewSiteCustomerId;
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => setNewSiteCustomerId(customer.id)}
                      className={`grid w-full gap-1 px-4 py-3 text-left transition ${
                        index !== filteredNewSiteCustomers.length - 1 ? "border-b border-border" : ""
                      } ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-foreground hover:bg-surface-raised"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate font-medium">{customer.name}</p>
                          {customer.customerType ? (
                            <Badge className={isSelected ? "bg-current/15 text-primary-foreground" : "bg-surface-raised text-text-secondary"}>
                              {formatCustomerType(customer.customerType)}
                            </Badge>
                          ) : null}
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                            isSelected
                              ? "bg-current/15 text-primary-foreground"
                              : "bg-surface-raised text-text-secondary"
                          }`}
                        >
                          {isSelected ? "Selected" : "Record"}
                        </span>
                      </div>
                      <p className={`truncate text-sm ${isSelected ? "text-muted-foreground" : "text-text-secondary"}`}>
                        {customer.email || "No email"}{customer.phone ? ` - ${customer.phone}` : ""}
                      </p>
                      <p className={`truncate text-xs ${isSelected ? "text-muted-foreground" : "text-muted-foreground"}`}>
                        {customer.address || "No address saved"}
                      </p>
                    </button>
                  );
                })
              )}
            </div>

            {selectedNewSiteCustomer ? (
              <div className="rounded-xl border border-border bg-muted p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Selected customer</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Customer</p>
                    <p className="mt-1 font-medium text-foreground">{selectedNewSiteCustomer.name}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Email</p>
                    <p className="mt-1 font-medium text-foreground">{selectedNewSiteCustomer.email || "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Phone</p>
                    <p className="mt-1 font-medium text-foreground">{selectedNewSiteCustomer.phone || "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Customer type</p>
                    <p className="mt-1 font-medium text-foreground">{formatCustomerType(selectedNewSiteCustomer.customerType)}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase text-muted-foreground">Address</p>
                    <p className="mt-1 font-medium text-foreground">{selectedNewSiteCustomer.address || "Not set"}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateSiteDialogOpen(false);
                setNewSiteCustomerSearch("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!selectedNewSiteCustomerId}
              onClick={() => {
                onCreateSite(selectedNewSiteCustomerId);
                setCreateSiteDialogOpen(false);
                setNewSiteCustomerSearch("");
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
