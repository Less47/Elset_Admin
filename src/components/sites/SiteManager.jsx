import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatSiteType, siteTypeOptions } from "@/lib/app-support";

const NOT_SET_FILTER_VALUE = "__not_set__";

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
  const [viewMode, setViewMode] = useState("list");
  const [createSiteDialogOpen, setCreateSiteDialogOpen] = useState(false);
  const [newSiteCustomerId, setNewSiteCustomerId] = useState("");
  const deferredSearch = useDeferredValue(search);

  const customerOptions = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );

  useEffect(() => {
    setNewSiteCustomerId((prev) => (
      prev && customerOptions.some((customer) => customer.id === prev)
        ? prev
        : customerOptions[0]?.id || ""
    ));
  }, [customerOptions]);

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

  return (
    <>
      <Card className="overflow-hidden rounded-xl border-slate-300 shadow-none">
        <CardHeader className="space-y-4 border-b border-slate-200 bg-slate-50 px-5 py-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle className="text-lg">Site Profiles</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Group multiple gates or projects under one site and review work history by address instead of only by customer.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center">
            <div>
              Showing <span className="font-semibold text-slate-900">{filteredSites.length}</span> of {siteRows.length} sites
            </div>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
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
            <Button
              className="rounded-lg"
              disabled={customerOptions.length === 0}
              onClick={() => setCreateSiteDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" /> New Site
            </Button>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_220px_220px_auto]">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
            <Input
              className="rounded-lg border-slate-300 bg-white"
              placeholder="Search customer, site, address, notes, or gate/project details..."
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
                <SelectItem value="activity">Recent activity</SelectItem>
                <SelectItem value="jobs">Most jobs</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="address">Address</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Site type</p>
            <Select value={siteTypeFilter} onValueChange={setSiteTypeFilter}>
              <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full rounded-lg border-slate-300 bg-white xl:w-auto"
              onClick={() => {
                setSearch("");
                setSortBy("activity");
                setSiteTypeFilter("all");
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
        </CardHeader>

        <CardContent className={viewMode === "list" ? "p-0" : "p-5"}>
          {filteredSites.length === 0 ? (
            <div className={viewMode === "list" ? "p-6" : ""}>
              <EmptyState title="No sites found" text="Try adjusting the search or create a site from a customer record first." />
            </div>
          ) : (
            viewMode === "list" ? (
              <div className="overflow-x-auto bg-white">
                <div className="min-w-[1200px]">
                  <div className="grid grid-cols-[1.8fr_1.2fr_140px_130px_90px_90px_100px_140px] border-b border-slate-200 bg-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <span>Site</span>
                    <span>Customer</span>
                    <span>Type</span>
                    <span>Last Activity</span>
                    <span className="text-right">Jobs</span>
                    <span className="text-right">Open</span>
                    <span className="text-right">Assets</span>
                    <span className="text-right">Action</span>
                  </div>

                  {filteredSites.map((site, index) => (
                    <div
                      key={`${site.customer.id}-${site.id}`}
                      onDoubleClick={() => onOpenSite(site.customer.id, site.id)}
                      title="Double-click to open site profile"
                      className={`grid cursor-pointer select-none grid-cols-[1.8fr_1.2fr_140px_130px_90px_90px_100px_140px] items-center px-5 py-3 text-sm transition hover:bg-slate-50 ${
                        index !== filteredSites.length - 1 ? "border-b border-slate-200" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-slate-950">{getSiteDisplayName(site)}</p>
                          {site.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
                          {site.accessNotes ? <Badge className="bg-amber-100 text-amber-800">Access</Badge> : null}
                        </div>
                        <div className="mt-1 flex gap-2 text-xs text-slate-500">
                          <span className="shrink-0 font-mono uppercase tracking-[0.12em]">{site.id.slice(0, 8)}</span>
                          {site.address && getSiteDisplayName(site) !== site.address ? (
                            <span className="truncate">{site.address}</span>
                          ) : null}
                        </div>
                      </div>
                      <p className="truncate text-slate-700">{site.customer.name}</p>
                      <div>
                        {site.siteType ? <Badge className="bg-emerald-100 text-emerald-800">{formatSiteType(site.siteType)}</Badge> : <span className="text-slate-500">Not set</span>}
                      </div>
                      <p className="text-slate-700">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity"}</p>
                      <div className="text-right">
                        <span className="font-medium text-slate-950">{site.jobCount}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-slate-950">{site.openJobCount}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-slate-950">{site.assetCount}</span>
                      </div>
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" className="rounded-md border-slate-300" onClick={() => onOpenSite(site.customer.id, site.id)}>
                          Open Site
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {filteredSites.map((site) => (
                  <div
                    key={`${site.customer.id}-${site.id}`}
                    onDoubleClick={() => onOpenSite(site.customer.id, site.id)}
                    title="Double-click to open site profile"
                    className="cursor-pointer select-none rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{site.customer.name}</p>
                        <p className="mt-1 font-semibold text-slate-900">{getSiteDisplayName(site)}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {site.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
                        {site.siteType ? <Badge className="bg-emerald-100 text-emerald-800">{formatSiteType(site.siteType)}</Badge> : null}
                        {site.assetCount > 0 ? <Badge className="bg-teal-100 text-teal-800">{site.assetCount} items</Badge> : null}
                        {site.accessNotes ? <Badge className="bg-amber-100 text-amber-800">Access</Badge> : null}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600 sm:grid-cols-2">
                      <div className="flex items-center justify-between gap-3">
                        <span>Jobs</span>
                        <span className="font-medium text-slate-900">{site.jobCount}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Open jobs</span>
                        <span className="font-medium text-slate-900">{site.openJobCount}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:col-span-2">
                        <span>Last activity</span>
                        <span className="font-medium text-slate-900">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity"}</span>
                      </div>
                    </div>

                    {site.profileNotes ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">{site.profileNotes}</p> : null}

                    <div className="mt-4 flex justify-end">
                      <Button variant="outline" className="rounded-xl" onClick={() => onOpenSite(site.customer.id, site.id)}>
                        Open Site Profile
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </CardContent>
      </Card>

      <Dialog open={createSiteDialogOpen} onOpenChange={setCreateSiteDialogOpen}>
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Site</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Choose the customer this site belongs to, then fill in the site profile details.
            </p>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer</p>
              <Select value={newSiteCustomerId} onValueChange={setNewSiteCustomerId}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customerOptions.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSiteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newSiteCustomerId}
              onClick={() => {
                onCreateSite(newSiteCustomerId);
                setCreateSiteDialogOpen(false);
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
