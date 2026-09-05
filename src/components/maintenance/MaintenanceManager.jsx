import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import {
  CompactSortControl,
  FilterButton,
  FilterSheetField,
  MobileFilterSheet,
  PagePrimaryAction,
  PageSearchField,
  ResponsivePageControls,
  ResultSummary,
} from "@/components/shared/ResponsivePageControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildCustomerSites,
  formatDate,
  getMaintenanceFrequencyMeta,
  getMaintenancePlanJobs,
  getMaintenancePlanStatus,
  getSuggestedMaintenanceSite,
  maintenanceFrequencyOptions,
  normalizeChecklistItems,
  normalizeMaintenancePlanRecord,
  normalizeNumber,
  normalizeSiteAddress,
  slugDate,
  toDateInputValue,
  toTimestamp,
} from "@/lib/app-support";
import { statusThemes } from "@/lib/job-status";
import { money } from "@/lib/quote-template";

const maintenanceSortOptions = [
  { value: "due-date", label: "Due date" },
  { value: "customer", label: "Customer" },
  { value: "created-recent", label: "Newest plan" },
];

function MaintenancePlanDialog({ open, onOpenChange, initialPlan, customers, jobs, onSave }) {
  const orderedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );
  const defaultCustomer = orderedCustomers[0] || null;
  const [draft, setDraft] = useState({
    planName: "",
    customerId: "",
    siteAddress: "",
    frequency: maintenanceFrequencyOptions[1].value,
    nextDueDate: slugDate(),
    estimatedDurationHours: "1",
    contractPrice: "0",
    checklistText: "",
    notes: "",
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;

    const normalizedPlan = initialPlan ? normalizeMaintenancePlanRecord(initialPlan) : null;
    const selectedCustomer = orderedCustomers.find((customer) => customer.id === normalizedPlan?.customerId) || defaultCustomer;
    const selectedCustomerJobs = selectedCustomer ? jobs.filter((job) => job.customerId === selectedCustomer.id) : [];

    setDraft({
      planName: normalizedPlan?.planName || "",
      customerId: normalizedPlan?.customerId || selectedCustomer?.id || "",
      siteAddress: normalizedPlan?.siteAddress || getSuggestedMaintenanceSite(selectedCustomer, selectedCustomerJobs),
      frequency: normalizedPlan?.frequency || maintenanceFrequencyOptions[1].value,
      nextDueDate: normalizedPlan?.nextDueDate || slugDate(),
      estimatedDurationHours: String(normalizedPlan?.estimatedDurationHours ?? 1),
      contractPrice: String(normalizedPlan?.contractPrice ?? 0),
      checklistText: Array.isArray(normalizedPlan?.checklist) ? normalizedPlan.checklist.join("\n") : "",
      notes: normalizedPlan?.notes || "",
    });
  }, [defaultCustomer, initialPlan, jobs, open, orderedCustomers]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedCustomer = useMemo(
    () => orderedCustomers.find((customer) => customer.id === draft.customerId) || null,
    [draft.customerId, orderedCustomers]
  );
  const selectedCustomerJobs = useMemo(
    () => jobs.filter((job) => job.customerId === draft.customerId),
    [draft.customerId, jobs]
  );
  const siteSuggestions = useMemo(
    () => (selectedCustomer ? buildCustomerSites(selectedCustomer, selectedCustomerJobs) : []),
    [selectedCustomer, selectedCustomerJobs]
  );
  const canSave = Boolean(
    draft.customerId
      && draft.planName.trim()
      && normalizeSiteAddress(draft.siteAddress)
      && draft.nextDueDate
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] rounded-3xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{initialPlan ? "Edit Maintenance Plan" : "Create Maintenance Plan"}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">Plan Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FormField label="Plan name">
                  <Input
                    value={draft.planName}
                    onChange={(e) => setDraft((prev) => ({ ...prev, planName: e.target.value }))}
                    placeholder="e.g. Quarterly boom gate service"
                  />
                </FormField>

                <FormField label="Customer">
                  <Select
                    value={draft.customerId}
                    onValueChange={(value) => {
                      const nextCustomer = orderedCustomers.find((customer) => customer.id === value) || null;
                      const nextCustomerJobs = jobs.filter((job) => job.customerId === value);
                      setDraft((prev) => ({
                        ...prev,
                        customerId: value,
                        siteAddress: getSuggestedMaintenanceSite(nextCustomer, nextCustomerJobs),
                      }));
                    }}
                    disabled={orderedCustomers.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={orderedCustomers.length === 0 ? "Add a customer first" : "Select customer"} />
                    </SelectTrigger>
                    <SelectContent>
                      {orderedCustomers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Site address">
                  <Textarea
                    rows={3}
                    value={draft.siteAddress}
                    onChange={(e) => setDraft((prev) => ({ ...prev, siteAddress: e.target.value }))}
                    placeholder="Enter the site or property address for this maintenance plan"
                  />
                </FormField>

                {siteSuggestions.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Saved sites</p>
                    <div className="flex flex-wrap gap-2">
                      {siteSuggestions.map((site) => (
                        <Button
                          key={site.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-lg"
                          onClick={() => setDraft((prev) => ({ ...prev, siteAddress: site.address }))}
                        >
                          {site.address}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Frequency">
                    <Select value={draft.frequency} onValueChange={(value) => setDraft((prev) => ({ ...prev, frequency: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {maintenanceFrequencyOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="Next due date">
                    <Input
                      type="date"
                      value={draft.nextDueDate}
                      onChange={(e) => setDraft((prev) => ({ ...prev, nextDueDate: e.target.value }))}
                    />
                  </FormField>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 bg-slate-50">
              <CardHeader>
                <CardTitle className="text-base">Visit Defaults</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Estimated hours">
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      value={draft.estimatedDurationHours}
                      onChange={(e) => setDraft((prev) => ({ ...prev, estimatedDurationHours: e.target.value }))}
                    />
                  </FormField>
                </div>

                <FormField label="Contract price">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.contractPrice}
                    onChange={(e) => setDraft((prev) => ({ ...prev, contractPrice: e.target.value }))}
                  />
                </FormField>

                <FormField label="Checklist">
                  <Textarea
                    rows={7}
                    value={draft.checklistText}
                    onChange={(e) => setDraft((prev) => ({ ...prev, checklistText: e.target.value }))}
                    placeholder={"One task per line\nTest safety devices\nInspect hardware\nCheck battery backup"}
                  />
                </FormField>

                <FormField label="Notes">
                  <Textarea
                    rows={4}
                    value={draft.notes}
                    onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Access instructions, preferred visit window, contract notes..."
                  />
                </FormField>
              </CardContent>
            </Card>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={async () => {
              const didSave = onSave({
                planName: draft.planName,
                customerId: draft.customerId,
                siteAddress: normalizeSiteAddress(draft.siteAddress),
                frequency: draft.frequency,
                nextDueDate: toDateInputValue(draft.nextDueDate),
                defaultTechnicianId: "",
                estimatedDurationHours: normalizeNumber(draft.estimatedDurationHours, 0),
                contractPrice: normalizeNumber(draft.contractPrice, 0),
                checklist: normalizeChecklistItems(draft.checklistText),
                notes: draft.notes,
              });
              if (didSave instanceof Promise && (await didSave) === false) return;
              if (didSave !== false) onOpenChange(false);
            }}
          >
            {initialPlan ? "Save Plan" : "Create Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MaintenanceManager({
  maintenancePlans,
  customers,
  jobs,
  onCreatePlan,
  onUpdatePlan,
  onDeletePlan,
  onGenerateJob,
  onOpenJob,
}) {
  const [search, setSearch] = useState("");
  const [filterBy, setFilterBy] = useState("all");
  const [sortBy, setSortBy] = useState("due-date");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const filterTriggerRef = useRef(null);
  const deferredSearch = useDeferredValue(search);

  const customersById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);

  const planRows = useMemo(() => {
    return (maintenancePlans || [])
      .map(normalizeMaintenancePlanRecord)
      .filter(Boolean)
      .map((plan) => {
        const customer = customersById.get(plan.customerId) || null;
        const linkedJobs = getMaintenancePlanJobs(plan.id, jobs);
        const activeJobs = linkedJobs.filter((job) => job.status !== "Completed");
        const activeJob = activeJobs[0] || null;
        const status = getMaintenancePlanStatus(plan, jobs);

        return {
          plan,
          customer,
          linkedJobs,
          activeJob,
          activeJobCount: activeJobs.length,
          status,
          frequencyLabel: getMaintenanceFrequencyMeta(plan.frequency).label,
        };
      });
  }, [customersById, jobs, maintenancePlans]);

  const maintenanceStats = useMemo(() => {
    return planRows.reduce((stats, row) => ({
      totalPlans: stats.totalPlans + 1,
      overdue: stats.overdue + (row.status.id === "overdue" ? 1 : 0),
      dueSoon: stats.dueSoon + (row.status.id === "due-soon" ? 1 : 0),
      activeJobs: stats.activeJobs + (row.activeJob ? 1 : 0),
      contractValue: stats.contractValue + row.plan.contractPrice,
    }), {
      totalPlans: 0,
      overdue: 0,
      dueSoon: 0,
      activeJobs: 0,
      contractValue: 0,
    });
  }, [planRows]);

  const filteredRows = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const rows = planRows.filter((row) => {
      const matchesSearch = query
        ? [
            row.plan.planName,
            row.customer?.name,
            row.plan.siteAddress,
            row.frequencyLabel,
            row.plan.notes,
            row.plan.checklist.join(" "),
          ].join(" ").toLowerCase().includes(query)
        : true;

      const matchesFilter =
        filterBy === "all"
          ? true
          : filterBy === "needs-attention"
            ? row.status.id === "overdue" || row.status.id === "due-soon" || row.status.id === "active-job"
            : row.status.id === filterBy;

      return matchesSearch && matchesFilter;
    });

    rows.sort((a, b) => {
      if (sortBy === "customer") {
        return (a.customer?.name || "").localeCompare(b.customer?.name || "") || a.plan.planName.localeCompare(b.plan.planName);
      }
      if (sortBy === "created-recent") {
        return toTimestamp(b.plan.createdAt) - toTimestamp(a.plan.createdAt);
      }
      return a.status.rank - b.status.rank || toTimestamp(a.plan.nextDueDate) - toTimestamp(b.plan.nextDueDate);
    });

    return rows;
  }, [deferredSearch, filterBy, planRows, sortBy]);
  const activeFilterCount = filterBy === "all" ? 0 : 1;

  const dueQueue = useMemo(
    () => planRows
      .filter((row) => row.status.id === "overdue" || row.status.id === "due-soon")
      .sort((a, b) => toTimestamp(a.plan.nextDueDate) - toTimestamp(b.plan.nextDueDate))
      .slice(0, 8),
    [planRows]
  );

  const activeRows = useMemo(
    () => planRows
      .filter((row) => row.activeJob)
      .sort((a, b) => toTimestamp(b.activeJob?.updatedAt) - toTimestamp(a.activeJob?.updatedAt))
      .slice(0, 8),
    [planRows]
  );

  return (
    <>
      <ResponsivePageControls
        className="mb-4"
        search={(
          <PageSearchField value={search} onChange={setSearch} placeholder="Search maintenance..." label="Search maintenance plans" />
        )}
        controls={(
          <>
            <FilterButton ref={filterTriggerRef} activeCount={activeFilterCount} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
            <CompactSortControl value={sortBy} onValueChange={setSortBy} options={maintenanceSortOptions} label="Sort maintenance plans" />
          </>
        )}
        action={(
          <PagePrimaryAction onClick={() => { setEditingPlan(null); setPlanDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Maintenance Plan
          </PagePrimaryAction>
        )}
        summary={<ResultSummary>{filteredRows.length} maintenance {filteredRows.length === 1 ? "plan" : "plans"}</ResultSummary>}
      />

      <div className="floating-page-toolbar mb-4 hidden px-4 py-3 xl:block">
        <div className="grid gap-2 md:grid-cols-[minmax(220px,1.35fr)_minmax(145px,0.7fr)_minmax(145px,0.7fr)_minmax(190px,0.9fr)] md:items-end">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
            <Input
              className="data-toolbar-field rounded-lg border-slate-300 bg-white"
              placeholder="Search plan, customer, site, or checklist..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Filter</p>
            <Select value={filterBy} onValueChange={setFilterBy}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                <SelectItem value="needs-attention">Needs attention</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="due-soon">Due soon</SelectItem>
                <SelectItem value="active-job">Active job</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="due-date">Due date</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="created-recent">Newest plan</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            className="h-11 self-end rounded-xl px-5"
            onClick={() => {
              setEditingPlan(null);
              setPlanDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Maintenance Plan
          </Button>
        </div>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden rounded-3xl border-slate-200">
            <div className="hidden gap-px border-b border-slate-200 bg-slate-200 xl:grid xl:grid-cols-5">
            {[
              { label: "Plans", value: maintenanceStats.totalPlans },
              { label: "Overdue", value: maintenanceStats.overdue },
              { label: "Due soon", value: maintenanceStats.dueSoon },
              { label: "Active jobs", value: maintenanceStats.activeJobs },
              { label: "Contract value", value: money(maintenanceStats.contractValue) },
            ].map((stat) => (
              <div key={stat.label} className="bg-white px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{stat.value}</p>
              </div>
            ))}
          </div>

          <CardContent className="grid gap-4 p-5">
            {filteredRows.length === 0 ? (
              <EmptyState title="No maintenance plans found" text="Try adjusting the search or filters, or add your first plan." />
            ) : (
              filteredRows.map((row) => (
                <div key={row.plan.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <Badge className={row.status.className}>{row.status.label}</Badge>
                        <Badge variant="secondary">{row.frequencyLabel}</Badge>
                        {row.activeJob ? <Badge className="bg-sky-100 text-sky-800">Job #{row.activeJob.jobNumber} open</Badge> : null}
                      </div>
                      <p className="mt-3 text-lg font-semibold text-slate-950">{row.plan.planName}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {(row.customer?.name || "Unknown customer")} - {row.plan.siteAddress || "No site address"}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      {row.activeJob ? (
                        <Button className="rounded-lg" onClick={() => onOpenJob(row.activeJob)}>
                          View Active Job
                        </Button>
                      ) : (
                        <Button className="rounded-lg" onClick={() => onGenerateJob(row.plan.id)}>
                          Generate Job
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="rounded-lg"
                        onClick={() => {
                          setEditingPlan(row.plan);
                          setPlanDialogOpen(true);
                        }}
                      >
                        Edit Plan
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        onClick={() => onDeletePlan(row.plan.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Next due</p>
                      <p className="mt-2 font-semibold text-slate-950">{row.plan.nextDueDate ? formatDate(row.plan.nextDueDate) : "Not set"}</p>
                    </div>
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Estimated time</p>
                      <p className="mt-2 font-semibold text-slate-950">{row.plan.estimatedDurationHours > 0 ? `${row.plan.estimatedDurationHours} hrs` : "Not set"}</p>
                    </div>
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Contract price</p>
                      <p className="mt-2 font-semibold text-slate-950">{row.plan.contractPrice > 0 ? money(row.plan.contractPrice) : "Not set"}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.95fr]">
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Checklist</p>
                      {row.plan.checklist.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-500">No checklist saved yet.</p>
                      ) : (
                        <div className="mt-2 grid gap-2 text-sm text-slate-700">
                          {row.plan.checklist.slice(0, 4).map((item, index) => (
                            <p key={`${row.plan.id}-checklist-${index}`}>{index + 1}. {item}</p>
                          ))}
                          {row.plan.checklist.length > 4 ? <p className="text-slate-500">+{row.plan.checklist.length - 4} more</p> : null}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recent activity</p>
                      <div className="mt-2 grid gap-2 text-sm text-slate-700">
                        <p>Last generated: <span className="font-medium text-slate-950">{row.plan.lastGeneratedAt ? formatDate(row.plan.lastGeneratedAt) : "Not yet"}</span></p>
                        <p>Last completed: <span className="font-medium text-slate-950">{row.plan.lastCompletedAt ? formatDate(row.plan.lastCompletedAt) : "Not yet"}</span></p>
                        <p>Linked jobs: <span className="font-medium text-slate-950">{row.linkedJobs.length}</span></p>
                        {row.plan.notes ? <p className="pt-1 text-slate-600">{row.plan.notes}</p> : <p className="pt-1 text-slate-500">No extra notes saved for this plan.</p>}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="rounded-3xl border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg">Due Queue</CardTitle>
              <p className="text-sm text-muted-foreground">Plans that need attention first.</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {dueQueue.length === 0 ? (
                <EmptyState title="Nothing urgent" text="Overdue plans and visits due soon will appear here." />
              ) : (
                dueQueue.map((row) => (
                  <div key={`due-${row.plan.id}`} className="rounded-2xl border bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-950">{row.plan.planName}</p>
                        <p className="mt-1 text-sm text-slate-600">{row.customer?.name || "Unknown customer"}</p>
                      </div>
                      <Badge className={row.status.className}>{row.status.label}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{row.plan.siteAddress || "No site address"}</p>
                    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-500">Due {formatDate(row.plan.nextDueDate)}</span>
                      <Button size="sm" className="rounded-lg" onClick={() => onGenerateJob(row.plan.id)}>
                        Generate Job
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg">Active Maintenance Jobs</CardTitle>
              <p className="text-sm text-muted-foreground">Generated jobs already moving through the board.</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {activeRows.length === 0 ? (
                <EmptyState title="No active maintenance jobs" text="Generated maintenance jobs will appear here until they are completed." />
              ) : (
                activeRows.map((row) => (
                  <div key={`active-${row.plan.id}`} className="rounded-2xl border bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-950">{row.plan.planName}</p>
                        <p className="mt-1 text-sm text-slate-600">Job #{row.activeJob?.jobNumber} - {row.activeJob?.status}</p>
                      </div>
                      <Badge className={(statusThemes[row.activeJob?.status] || statusThemes["To Do"]).badge}>{row.activeJob?.status}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{row.activeJob?.title}</p>
                    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-500">{row.activeJob?.updatedAt ? `Updated ${formatDate(row.activeJob.updatedAt)}` : "Open now"}</span>
                      <Button variant="outline" size="sm" className="rounded-lg" onClick={() => row.activeJob && onOpenJob(row.activeJob)}>
                        View Job
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <MobileFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        returnFocusRef={filterTriggerRef}
        activeCount={activeFilterCount}
        description="Filter maintenance plans by their current service state."
        onReset={() => setFilterBy("all")}
      >
        <FilterSheetField id="mobile-maintenance-status-filter" label="Status">
          <Select value={filterBy} onValueChange={setFilterBy}>
            <SelectTrigger id="mobile-maintenance-status-filter" className="h-11 w-full rounded-xl bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              <SelectItem value="needs-attention">Needs attention</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="due-soon">Due soon</SelectItem>
              <SelectItem value="active-job">Active job</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
            </SelectContent>
          </Select>
        </FilterSheetField>
      </MobileFilterSheet>

      <MaintenancePlanDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        initialPlan={editingPlan}
        customers={customers}
        jobs={jobs}
        onSave={(planInput) => {
          if (editingPlan) {
            return onUpdatePlan(editingPlan.id, planInput);
          }

          return onCreatePlan(planInput);
        }}
      />
    </>
  );
}
