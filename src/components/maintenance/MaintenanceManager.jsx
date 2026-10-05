import { PageWorkspace, PageTopBar, PageBody } from "@/components/workspace/PageWorkspace";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Plus, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MobileRecordCard, MobileRecordList } from "@/components/shared/MobileRecordList";
import { useMobileRecordLayout } from "@/hooks/useMobileRecordLayout";
import { useUserUiPreference } from "@/hooks/useUserUiPreferences";
import { CompactSortControl, DesktopControlField, DesktopPageControls, FilterButton, FilterSheetField, MobileFilterSheet, PagePrimaryAction, PageSearchField, ResponsivePageControls, ResultSummary } from "@/components/shared/ResponsivePageControls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { APP_TEXT_DARK, APP_TEXT_LIGHT, getMaintenanceFrequencyMeta, getMaintenancePlanStatus, hexToRgb } from "@/lib/app-support";
import { effectiveMaintenancePlan, formatMaintenanceDate as formatDate } from "@/lib/maintenance-recurrence";
import { money } from "@/lib/quote-template";
import "./Maintenance.css";

const sorts = [{ value: "due-date", label: "Due date" }, { value: "customer", label: "Customer" }, { value: "created-recent", label: "Newest plan" }];
const filters = [["all", "All plans"], ["needs-attention", "Needs attention"], ["overdue", "Overdue"], ["due-soon", "Due soon"], ["active-job", "Active job"], ["upcoming", "Upcoming"], ["inactive", "Inactive"]];

function maintenanceToolbarStyle(surface) {
  // Pick from the existing app foreground colours using relative luminance.
  // The shared brightness threshold can leave white text on mid-tone themes.
  const luminance = (color) => {
    const { r, g, b } = hexToRgb(color);
    return [r, g, b].map((channel) => channel / 255)
      .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  };
  const background = luminance(surface);
  const candidates = [APP_TEXT_DARK, APP_TEXT_LIGHT].map((color) => {
    const foreground = luminance(color);
    return { color, contrast: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) };
  });
  const best = candidates.sort((a, b) => b.contrast - a.contrast)[0];
  return { "--maintenance-toolbar-text": best.color, "--maintenance-toolbar-label-strength": best.contrast >= 6 ? "92%" : "100%" };
}

function planOpeningProps(plan, onOpen, mobile) {
  function open(event) {
    const interactive = event.target.closest("button, a, input, select, textarea, [role='button'], [role='link'], [contenteditable='true']");
    if (interactive && interactive !== event.currentTarget) return;
    onOpen(plan.id);
  }
  return {
    tabIndex: 0,
    "aria-label": `Open maintenance plan ${plan.planName}`,
    title: mobile ? "Open maintenance plan" : "Double-click or press Enter to open maintenance plan",
    onClick: mobile ? open : undefined,
    onDoubleClick: mobile ? undefined : open,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget || event.repeat || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      onOpen(plan.id);
    },
  };
}

function ContractPrice({ plan }) {
  const priceSet = plan.contractPriceSet ?? Number(plan.contractPrice) > 0;
  return <span className={priceSet ? "" : "text-status-danger"} data-contract-price={priceSet ? "set" : "missing"}>{priceSet ? money(plan.contractPrice) : "Not set"}</span>;
}

function PlansTable({ rows, onOpen }) {
  return <div data-desktop-record-results role="table" aria-label="Maintenance plans" className="data-grid maintenance-table">
    <div role="rowgroup" className="maintenance-table-heading">
      <div role="row" className="data-grid-header maintenance-table-columns">
        <span role="columnheader">Status</span><span role="columnheader">Plan</span>
        <span role="columnheader" className="maintenance-wide-column">Customer</span><span role="columnheader" className="maintenance-wide-column">Site</span>
        <span role="columnheader" className="maintenance-wide-column">Frequency</span><span role="columnheader">Next Due</span>
        <span role="columnheader" className="maintenance-time-column">Est. Time</span><span role="columnheader" className="text-right">Contract</span><span role="columnheader" className="text-right">Active Jobs</span>
      </div>
    </div>
    <div role="rowgroup" className="maintenance-table-rows">
      {rows.map(({ plan, customer, status, activeJobs }) => <div key={plan.id} role="row" className="data-grid-row maintenance-table-columns maintenance-open-record" data-maintenance-plan={plan.id} {...planOpeningProps(plan, onOpen, false)}>
        <div role="cell"><Badge className={status.className}>{status.label}</Badge></div>
        <div role="cell" className="maintenance-plan-name"><span className="truncate font-semibold" title={plan.planName}>{plan.planName}</span><span className="maintenance-compact-meta truncate text-text-secondary" title={customer?.name}>{customer?.name || "Unknown customer"} · {getMaintenanceFrequencyMeta(plan.frequency).label}</span><span className="maintenance-compact-meta truncate text-text-secondary" title={plan.siteAddress}>{plan.siteAddress}</span></div>
        <div role="cell" className="maintenance-wide-column"><span className="truncate" title={customer?.name}>{customer?.name || "Unknown customer"}</span></div>
        <div role="cell" className="maintenance-wide-column"><span className="truncate" title={plan.siteAddress}>{plan.siteAddress}</span></div>
        <div role="cell" className="maintenance-wide-column">{getMaintenanceFrequencyMeta(plan.frequency).label}</div>
        <div role="cell">{plan.nextDueDate ? formatDate(plan.nextDueDate) : "Not set"}</div>
        <div role="cell" className="maintenance-time-column">{plan.estimatedDurationHours > 0 ? `${plan.estimatedDurationHours} hrs` : "Not set"}</div>
        <div role="cell" className="justify-end tabular-nums"><ContractPrice plan={plan} /></div>
        <div role="cell" className="justify-end tabular-nums" aria-label={`${activeJobs} active ${activeJobs === 1 ? "job" : "jobs"}`}>{activeJobs}</div>
      </div>)}
    </div>
  </div>;
}

export function MaintenanceMetrics({ plan }) {
  const priceSet = plan.contractPriceSet ?? Number(plan.contractPrice) > 0;
  return <dl className="maintenance-metrics">
    <div><dt>Next due</dt><dd>{plan.nextDueDate ? formatDate(plan.nextDueDate) : "Not set"}</dd></div>
    <div><dt>Estimated time</dt><dd>{plan.estimatedDurationHours > 0 ? `${plan.estimatedDurationHours} hrs` : "Not set"}</dd></div>
    <div className={priceSet ? "" : "maintenance-price-missing"} data-contract-price={priceSet ? "set" : "missing"}><dt>Contract price</dt><dd>{priceSet ? money(plan.contractPrice) : "Not set"}</dd></div>
  </dl>;
}

export default function MaintenanceManager({ maintenancePlans, customers, jobs, onOpenPlan }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("filter");
    return filters.some(([id]) => id === requested) ? requested : "all";
  });
  const [sort, setSort] = useState("due-date");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterTrigger = useRef(null);
  const query = useDeferredValue(search).trim().toLowerCase();
  const mobile = useMobileRecordLayout();
  const [toolbarSurface] = useUserUiPreference("heroSurface");
  const rows = useMemo(() => maintenancePlans.map((source) => {
    const plan = effectiveMaintenancePlan(source, jobs);
    return { plan, customer: customers.find((entry) => entry.id === plan.customerId), status: getMaintenancePlanStatus(plan, jobs),
      activeJobs: jobs.filter((job) => job.maintenancePlanId === plan.id && job.status !== "Completed").length };
  }), [maintenancePlans, jobs, customers]);
  const due = rows.filter((row) => ["overdue", "due-soon"].includes(row.status.id)).sort((a, b) => a.plan.nextDueDate.localeCompare(b.plan.nextDueDate));
  const visible = rows.filter((row) => {
    const matches = [row.plan.planName, row.customer?.name, row.plan.siteAddress, getMaintenanceFrequencyMeta(row.plan.frequency).label].join(" ").toLowerCase().includes(query);
    return matches && (filter === "all" || (filter === "active-job" ? row.activeJobs > 0 : filter === "needs-attention" ? ["overdue", "due-soon"].includes(row.status.id) || !(row.plan.contractPriceSet ?? row.plan.contractPrice > 0) : row.status.id === filter));
  }).sort((a, b) => sort === "customer" ? (a.customer?.name || "").localeCompare(b.customer?.name || "") : sort === "created-recent" ? String(b.plan.createdAt).localeCompare(String(a.plan.createdAt)) : a.plan.nextDueDate.localeCompare(b.plan.nextDueDate));
  const stats = [["Plans", rows.length], ["Overdue", rows.filter((row) => row.status.id === "overdue").length], ["Due soon", rows.filter((row) => row.status.id === "due-soon").length], ["Active", rows.reduce((sum, row) => sum + row.activeJobs, 0)], ["Contract", money(rows.filter((row) => row.plan.active).reduce((sum, row) => sum + Number(row.plan.contractPrice || 0), 0))]];

  const filterSelect = (id) => <Select value={filter} onValueChange={setFilter}><SelectTrigger id={id} className="data-toolbar-field bg-card"><SelectValue /></SelectTrigger><SelectContent>{filters.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>;
  const addAction = <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="h-11" onClick={() => navigate("/maintenance-reports")}>Service Reports</Button><PagePrimaryAction onClick={() => onOpenPlan("new")}><Plus className="h-4 w-4" /> Add Maintenance Plan</PagePrimaryAction></div>;
  const summary = <dl className="maintenance-summary" aria-label="Maintenance summary">{stats.map(([label, value]) => <div key={label}><dt>{label}{label === "Active" ? <span className="sr-only"> jobs</span> : label === "Contract" ? <span className="sr-only"> value</span> : null}</dt><dd>{value}</dd></div>)}</dl>;
  return <PageWorkspace className="maintenance-dashboard" data-maintenance-dashboard style={maintenanceToolbarStyle(toolbarSurface)}>
    <PageTopBar>
    <ResponsivePageControls className="maintenance-responsive-controls" surfaceClassName="maintenance-toolbar" search={<PageSearchField value={search} onChange={setSearch} placeholder="Search maintenance..." label="Search maintenance plans" />} controls={<><FilterButton ref={filterTrigger} activeCount={filter === "all" ? 0 : 1} open={filtersOpen} onClick={() => setFiltersOpen(true)} /><CompactSortControl value={sort} onValueChange={setSort} options={sorts} label="Sort maintenance plans" /></>} action={addAction} toolbarSummary={summary} summary={<ResultSummary className="sr-only">{visible.length} maintenance plans</ResultSummary>} />
    <DesktopPageControls activeCount={filter === "all" ? 0 : 1} onReset={() => setFilter("all")} className="maintenance-toolbar" search={<DesktopControlField hideLabel label="Search" size="search"><PageSearchField compact value={search} onChange={setSearch} placeholder="Search plan, customer or site..." label="Search maintenance plans" /></DesktopControlField>} filters={<><DesktopControlField htmlFor="maintenance-filter" label="Filter" size="medium">{filterSelect("maintenance-filter")}</DesktopControlField><DesktopControlField htmlFor="maintenance-sort" label="Sort by" size="medium"><Select value={sort} onValueChange={setSort}><SelectTrigger id="maintenance-sort" className="data-toolbar-field bg-card"><SelectValue /></SelectTrigger><SelectContent>{sorts.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></DesktopControlField></>} summary={summary} actions={addAction} />
    </PageTopBar>
    <PageBody className="maintenance-dashboard-body">
      <section className="maintenance-plans-pane" aria-label="Maintenance plans" data-maintenance-plans-pane>
        <h2 className="sr-only">Maintenance plans</h2>
        {mobile ? <MobileRecordList label="Maintenance plan records" className="gap-0">{visible.map(({ plan, customer, status, activeJobs }) => <MobileRecordCard className="maintenance-mobile-plan p-0" recordId={plan.id} labelledBy={`maintenance-title-${plan.id}`} key={plan.id}>
          <div role="link" className="maintenance-open-record p-3" data-maintenance-plan={plan.id} {...planOpeningProps(plan, onOpenPlan, true)}>
            <div className="flex flex-wrap items-center gap-2"><Badge className={status.className}>{status.label}</Badge><span className="text-xs text-text-secondary">{getMaintenanceFrequencyMeta(plan.frequency).label}</span>{activeJobs ? <span className="text-xs text-status-info">{activeJobs} active {activeJobs === 1 ? "job" : "jobs"}</span> : null}</div>
            <h3 id={`maintenance-title-${plan.id}`} className="mt-1 truncate font-semibold" title={plan.planName}>{plan.planName}</h3>
            <p className="truncate text-xs text-text-secondary" title={customer?.name}>{customer?.name || "Unknown customer"}</p><p className="truncate text-xs text-text-secondary" title={plan.siteAddress}>{plan.siteAddress}</p>
            <MaintenanceMetrics plan={plan} />
          </div>
        </MobileRecordCard>)}</MobileRecordList> : <PlansTable rows={visible} onOpen={onOpenPlan} />}
        {!visible.length ? <div className="px-3 py-5 text-sm text-text-secondary" role="status"><p className="font-medium">No maintenance plans found</p><p className="mt-1 text-xs">Adjust your search or add a maintenance plan.</p></div> : null}
      </section>
      <aside className="maintenance-due-queue" aria-label="Due Queue"><div className="maintenance-due-heading"><Wrench className="h-4 w-4" aria-hidden="true" /><h2 className="font-semibold">Due Queue</h2><span className="maintenance-due-count ml-auto rounded-full px-2 text-xs" aria-label={`${due.length} due visits`}>{due.length}</span></div>
        {due.length ? <ul className="m-0 list-none p-0">{due.map(({ plan, customer, status }) => <li key={plan.id}><div role="link" className="maintenance-due-row maintenance-open-record" data-maintenance-due={plan.id} {...planOpeningProps(plan, onOpenPlan, mobile)}><div className="flex min-w-0 items-center justify-between gap-2"><span className="truncate text-xs font-semibold" title={plan.planName}>{plan.planName}</span><Badge className={status.className}>{status.label}</Badge></div><p className="maintenance-due-muted truncate text-xs" title={customer?.name}>{customer?.name || "Unknown customer"}</p><p className="maintenance-due-muted text-xs">Due {formatDate(plan.nextDueDate)}</p></div></li>)}</ul> : <p className="maintenance-due-muted px-3 py-3 text-xs">No maintenance visits due.</p>}
      </aside>
    </PageBody>
    <MobileFilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} returnFocusRef={filterTrigger} activeCount={filter === "all" ? 0 : 1} onReset={() => setFilter("all")} description="Filter maintenance plans by service state."><FilterSheetField id="mobile-maintenance-filter" label="Status">{filterSelect("mobile-maintenance-filter")}</FilterSheetField></MobileFilterSheet>
  </PageWorkspace>;
}
