import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Plus, Wrench, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
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

function PlanList({ mobile, children }) {
  return mobile ? <MobileRecordList label="Maintenance plan records">{children}</MobileRecordList> : <div className="grid gap-2.5" data-desktop-record-results>{children}</div>;
}
function PlanCard({ mobile, plan, onOpen, children }) {
  function handleDoubleClick(event) {
    if (event.target.closest("button, a, input, select, textarea, [role='button']")) return;
    onOpen(plan.id);
  }
  return mobile ? <MobileRecordCard className="maintenance-plan-card cursor-pointer" recordId={plan.id} labelledBy={`maintenance-title-${plan.id}`}><div data-maintenance-plan={plan.id} onDoubleClick={handleDoubleClick}>{children}</div></MobileRecordCard>
    : <article className="maintenance-plan-card cursor-pointer" data-maintenance-plan={plan.id} onDoubleClick={handleDoubleClick}>{children}</article>;
}

export function MaintenanceMetrics({ plan }) {
  const priceSet = plan.contractPriceSet ?? Number(plan.contractPrice) > 0;
  return <dl className="maintenance-metrics">
    <div><dt>Next due</dt><dd>{plan.nextDueDate ? formatDate(plan.nextDueDate) : "Not set"}</dd></div>
    <div><dt>Estimated time</dt><dd>{plan.estimatedDurationHours > 0 ? `${plan.estimatedDurationHours} hrs` : "Not set"}</dd></div>
    <div className={priceSet ? "" : "maintenance-price-missing"} data-contract-price={priceSet ? "set" : "missing"}><dt>Contract price</dt><dd>{priceSet ? money(plan.contractPrice) : "Not set"}</dd></div>
  </dl>;
}

export default function MaintenanceManager({ maintenancePlans, customers, jobs, onGenerateJob, onOpenPlan }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("due-date");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
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

  async function generate(plan) {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(plan.id); setError("");
    try { await onGenerateJob(plan.id, plan.nextOccurrence); }
    catch (failure) { setError(failure.message || "Unable to generate the maintenance job."); }
    finally { savingRef.current = false; setBusy(null); }
  }
  const filterSelect = (id) => <Select value={filter} onValueChange={setFilter}><SelectTrigger id={id} className="data-toolbar-field bg-white"><SelectValue /></SelectTrigger><SelectContent>{filters.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>;
  const addAction = <PagePrimaryAction onClick={() => onOpenPlan("new")}><Plus className="h-4 w-4" /> Add Maintenance Plan</PagePrimaryAction>;
  const summary = <dl className="maintenance-summary" aria-label="Maintenance summary">{stats.map(([label, value]) => <div key={label}><dt>{label}{label === "Active" ? <span className="sr-only"> jobs</span> : label === "Contract" ? <span className="sr-only"> value</span> : null}</dt><dd>{value}</dd></div>)}</dl>;
  return <div className="maintenance-dashboard" data-maintenance-dashboard style={maintenanceToolbarStyle(toolbarSurface)}>
    <ResponsivePageControls className="maintenance-responsive-controls" surfaceClassName="maintenance-toolbar" search={<PageSearchField value={search} onChange={setSearch} placeholder="Search maintenance..." label="Search maintenance plans" />} controls={<><FilterButton ref={filterTrigger} activeCount={filter === "all" ? 0 : 1} open={filtersOpen} onClick={() => setFiltersOpen(true)} /><CompactSortControl value={sort} onValueChange={setSort} options={sorts} label="Sort maintenance plans" /></>} action={addAction} toolbarSummary={summary} summary={<ResultSummary className="sr-only">{visible.length} maintenance plans</ResultSummary>} />
    <DesktopPageControls className="maintenance-toolbar" search={<DesktopControlField label="Search" size="search"><PageSearchField compact value={search} onChange={setSearch} placeholder="Search plan, customer or site..." label="Search maintenance plans" /></DesktopControlField>} filters={<><DesktopControlField htmlFor="maintenance-filter" label="Filter" size="medium">{filterSelect("maintenance-filter")}</DesktopControlField><DesktopControlField htmlFor="maintenance-sort" label="Sort by" size="medium"><Select value={sort} onValueChange={setSort}><SelectTrigger id="maintenance-sort" className="data-toolbar-field bg-white"><SelectValue /></SelectTrigger><SelectContent>{sorts.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></DesktopControlField></>} summary={summary} actions={addAction} />
    {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
    <div className="maintenance-dashboard-body">
      <section className="maintenance-plan-list" aria-label="Maintenance plans">
        <h2 className="sr-only">Maintenance plans</h2>
        <PlanList mobile={mobile}>{visible.length ? visible.map(({ plan, customer, status, activeJobs }) => <PlanCard mobile={mobile} plan={plan} onOpen={onOpenPlan} key={plan.id}>
          <div className="maintenance-card-heading"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge className={status.className}>{status.label}</Badge><span className="text-xs font-medium text-slate-500">{getMaintenanceFrequencyMeta(plan.frequency).label}</span>{activeJobs ? <span className="text-xs text-sky-700">{activeJobs} active {activeJobs === 1 ? "job" : "jobs"}</span> : null}</div><h3 id={`maintenance-title-${plan.id}`} className="mt-2 truncate font-semibold text-slate-950">{plan.planName}</h3><p className="mt-0.5 truncate text-xs text-slate-600">{customer?.name || "Unknown customer"} · {plan.siteAddress}</p></div>
            <div className="maintenance-card-actions"><Button variant="outline" size="sm" onClick={() => onOpenPlan(plan.id)}>Open Plan <ArrowUpRight className="h-3 w-3" /></Button><Button size="sm" disabled={!plan.active || Boolean(busy)} onClick={() => generate(plan)}>{busy === plan.id ? "Generating…" : "Generate Job"}</Button><Button variant="ghost" size="sm" onClick={() => onOpenPlan(plan.id, { edit: true })}>Edit</Button></div>
          </div><MaintenanceMetrics plan={plan} />
        </PlanCard>) : null}</PlanList>{!visible.length ? <EmptyState title="No maintenance plans found" text="Adjust your search or add a maintenance plan." /> : null}
      </section>
      <aside className="maintenance-due-queue" aria-label="Due Queue"><div className="flex items-center gap-2"><Wrench className="h-4 w-4" /><h2 className="font-semibold">Due Queue</h2><span className="maintenance-due-count ml-auto rounded-full px-2 text-xs">{due.length}</span></div><p className="maintenance-due-muted mt-1 text-xs">Overdue and due in the next 7 days.</p>
        {due.length ? due.slice(0, 8).map(({ plan, customer, status }) => <div className="maintenance-due-row" key={plan.id}><div className="flex items-start justify-between gap-2"><button type="button" className="min-w-0 text-left text-sm font-semibold hover:underline" onClick={() => onOpenPlan(plan.id)}>{plan.planName}</button><Badge className={status.className}>{status.label}</Badge></div><p className="maintenance-due-muted mt-1 truncate text-xs">{customer?.name}</p><div className="mt-3 flex items-center justify-between gap-2"><span className="maintenance-due-muted text-xs">Due {formatDate(plan.nextDueDate)}</span><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => generate(plan)}>Generate Job</Button></div></div>) : <p className="maintenance-due-muted py-8 text-sm">Nothing urgent. Your next visits are on the Calendar.</p>}
      </aside>
    </div>
    <MobileFilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} returnFocusRef={filterTrigger} activeCount={filter === "all" ? 0 : 1} onReset={() => setFilter("all")} description="Filter maintenance plans by service state."><FilterSheetField id="mobile-maintenance-filter" label="Status">{filterSelect("mobile-maintenance-filter")}</FilterSheetField></MobileFilterSheet>
  </div>;
}
