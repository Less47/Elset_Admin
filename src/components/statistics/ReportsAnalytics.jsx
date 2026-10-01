import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Download, SlidersHorizontal, Printer, RefreshCw, ArrowUpRight } from "lucide-react";
import { PageWorkspace, PageTopBar, PageBody } from "@/components/workspace/PageWorkspace";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ANALYTICS_TABS, DATE_PRESETS, deriveAnalytics, presetRange, previousRange } from "@/lib/analytics";
import { REPORTS, reportTable, exportReportCsv } from "@/lib/analytics-reports";
import { invoiceDate, invoiceToday } from "@/lib/invoice-account";
import { money } from "@/lib/quote-template";
import { statuses } from "@/lib/job-status";
import { AnalyticsMetric, AnalyticsSection, AnalyticsChart, AnalyticsTable } from "./AnalyticsPrimitives";
import "./analytics.css";

const filterLabels = { customer: "Customer", site: "Site", technician: "Technician", status: "Job status", type: "Customer type" };
const customerColumn = { key: "name", label: "Customer", link: row => `/customers/${encodeURIComponent(row.id)}` };
const currency = value => money(value / 100);
const noFinancials = { invoices: [], payments: [], costing: [], costingEnabled: false };

export default function ReportsAnalytics({ data, fetchWithAuth }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [today] = useState(invoiceToday);
  const [financials, setFinancials] = useState(null), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [filtersOpen, setFiltersOpen] = useState(false);
  const preset = DATE_PRESETS.includes(params.get("range")) ? params.get("range") : "This month";
  const defaultRange = presetRange(preset, today);
  const from = params.get("from") ?? defaultRange.from, to = params.get("to") ?? defaultRange.to;
  const valid = Boolean(invoiceDate(from) && invoiceDate(to) && from <= to);
  const range = useMemo(() => valid ? { from, to } : presetRange("This month", today), [from, to, valid, today]);
  const tab = ANALYTICS_TABS.find(t => t.toLowerCase() === params.get("tab")) || "Overview";
  const report = REPORTS.find(r => r.id === params.get("report")) || REPORTS[0];
  const compare = params.get("compare") === "1";
  const allowedFilters = tab === "Reports" ? report.filters : tab === "Customers" ? ["customer", "type"] : tab === "Maintenance" ? ["customer", "site", "technician", "type"] : tab === "Profitability" ? ["customer", "site", "type"] : Object.keys(filterLabels);
  const filters = Object.fromEntries(allowedFilters.map(key => [key, params.get(key) || ""]));
  const filterKey = JSON.stringify(filters);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const a = useMemo(() => deriveAnalytics(data, financials || noFinancials, range, JSON.parse(filterKey), today), [data, financials, range, filterKey, today]);
  const previous = useMemo(() => compare && valid ? deriveAnalytics(data, financials || noFinancials, previousRange(range), JSON.parse(filterKey), today).metrics : null, [data, financials, range, filterKey, today, compare, valid]);
  const table = useMemo(() => reportTable(report.id, a), [report.id, a]);

  // Abort stale reads when leaving or when a committed workspace change arrives.
  // One financial projection supplies every tab; switching charts makes no request.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetchWithAuth("/api/reports/financials", { signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !payload.result) throw new Error(payload.error || "Unable to load reports.");
      if (active) { setFinancials(payload.result); setError(""); }
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; controller.abort(); };
  }, [fetchWithAuth, data.jobs, data.settings.addons, refresh]);

  function update(values) {
    setParams(previousParams => { const next = new URLSearchParams(previousParams); for (const [key, value] of Object.entries(values)) value || ["from", "to"].includes(key) ? next.set(key, value) : next.delete(key); return next; }, { replace: true, preventScrollReset: true });
  }
  function openReport(id, extra = {}) { update({ tab: "reports", report: id, ...extra }); }
  function exportCsv() {
    const blob = new Blob([exportReportCsv(table.columns, table.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${range.from}_${range.to}.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const view = (id, text = "View report") => <button className="analytics-text-action" onClick={() => openReport(id)}>{text}<ArrowUpRight size={12} /></button>;
  const metric = (key, label, { money: isMoney = false, percent = false, dated = false, detail, onClick } = {}) => <AnalyticsMetric key={key} label={label} value={isMoney ? currency(a.metrics[key]) : percent ? a.metrics[key] == null ? "—" : `${a.metrics[key].toFixed(1)}%` : a.metrics[key]} detail={detail || (dated ? "Selected period" : "Current snapshot")} previous={dated ? previous?.[key] : undefined} compare={dated && compare ? { current: a.metrics[key] } : undefined} onClick={onClick} />;
  const kpis = entries => <dl className="analytics-kpis">{entries.map(([key, label, options]) => metric(key, label, options))}</dl>;
  const series = (title, detail, entries, id, { bars = false, cash = false, data: chartData = a.buckets } = {}) => <AnalyticsSection title={title} detail={detail} action={view(id)}><AnalyticsChart label={title} data={chartData} series={entries} currency={cash} bars={bars} onPoint={row => openReport(id, row.from ? { range: "Custom range", from: row.from, to: row.to } : {})} /></AnalyticsSection>;
  const horizontal = (title, detail, rows, id, { cash = false, click } = {}) => <AnalyticsSection title={title} detail={detail} action={view(id)}><AnalyticsChart label={title} data={rows} series={[["value", cash ? "Amount" : "Count"]]} currency={cash} horizontal onPoint={click || (() => openReport(id))} /></AnalyticsSection>;
  const preview = (title, id, rows, columns, detail) => { const reportData = reportTable(id, a); return <AnalyticsSection title={title} detail={detail} action={view(id)}><AnalyticsTable label={title} rows={rows || reportData.rows} columns={columns || reportData.columns} limit={6} compact /></AnalyticsSection>; };
  const revenueChart = series("Invoiced & received", "Issue dates and payment dates · including GST", [["invoiced", "Invoiced"], ["received", "Received"]], "sales", { cash: true });
  const createdChart = series("Jobs created", "Creation date · completion history is not recorded", [["created", "Created"]], "jobs", { bars: true });
  const agingChart = horizontal("Accounts receivable", `Current balances at ${today} · all issue dates`, a.aging, "aging", { cash: true });
  const pipelineChart = horizontal("Job pipeline", "Current status · all creation dates", a.statusCounts, "jobs", { click: row => navigate("/", { state: { section: "job-history", jobStatus: row.name } }) });
  const topCustomerChart = horizontal("Top customers by invoiced value", "Selected issue dates · including GST", a.topCustomers.filter(c => c.periodInvoiced).slice(0, 6).map(c => ({ ...c, value: c.periodInvoiced / 100 })), "customer-revenue", { cash: true, click: row => navigate(`/customers/${encodeURIComponent(row.id)}`, { state: { sourceSection: "statistics", returnTo: { path: `/statistics?${params}`, label: "Reports & Analytics" } } }) });
  const costingUnavailable = !financials?.costingEnabled && <div className="analytics-empty"><h2>Job Costing is disabled</h2><p>Enable Job Costing in Settings → Add-ons to view recorded costs and gross margins.</p><Link to="/settings">Open Settings</Link></div>;
  const filterContext = Object.entries(filters).filter(([, value]) => value).map(([key, value]) => {
    const label = key === "customer" ? data.customers.find(c => c.id === value)?.name : key === "site" ? data.customers.flatMap(c => c.sites || []).find(s => s.id === value)?.address : key === "technician" ? data.staff.find(s => s.id === value)?.name || "Unassigned" : value;
    return `${filterLabels[key]}: ${label || value}`;
  }).join(" · ") || "All records";

  return <PageWorkspace className="analytics-workspace" data-analytics>
    <PageTopBar className="analytics-chrome"><div className="analytics-toolbar"><div className="analytics-heading"><h1>Reports & Analytics</h1><span>ELSET business reporting</span></div>
      <div className="analytics-range"><label><span className="sr-only">Date range</span><select aria-label="Date range" value={preset} onChange={event => { const value = event.target.value; update({ range: value, ...(value === "Custom range" ? { from, to } : presetRange(value, today)) }); }}>{DATE_PRESETS.map(p => <option key={p}>{p}</option>)}</select></label>
        <label><span className="sr-only">From date</span><input aria-label="From date" type="date" value={from} onChange={event => update({ range: "Custom range", from: event.target.value })} /></label><span>–</span><label><span className="sr-only">To date</span><input aria-label="To date" type="date" value={to} onChange={event => update({ range: "Custom range", to: event.target.value })} /></label></div>
      <label className="analytics-compare"><input type="checkbox" checked={compare} onChange={event => update({ compare: event.target.checked ? "1" : "" })} />Compare previous period</label>
      <button className="analytics-button" onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={14} />Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</button>
      <button className="analytics-button analytics-refresh" aria-label="Refresh reports" title="Refresh reports" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /></button>
    </div><div className="analytics-tabs" role="tablist" aria-label="Analytics sections">{ANALYTICS_TABS.map(name => <button key={name} id={`analytics-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls="analytics-panel" onClick={() => update({ tab: name.toLowerCase() })} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const index = ANALYTICS_TABS.indexOf(name), next = event.key === "Home" ? 0 : event.key === "End" ? 6 : (index + (event.key === "ArrowRight" ? 1 : -1) + 7) % 7; update({ tab: ANALYTICS_TABS[next].toLowerCase() }); document.getElementById(`analytics-tab-${ANALYTICS_TABS[next]}`)?.focus();
    }} tabIndex={tab === name ? 0 : -1}>{name}</button>)}</div></PageTopBar>
    <PageBody className="analytics-body">
      <div className="analytics-context"><span>{from} — {to} · {filterContext}</span><span>{compare && valid ? `Compared with ${previousRange(range).from} — ${previousRange(range).to} · ` : ""}Snapshot {today} · AUD</span></div>
      {!valid && <p className="analytics-error" role="alert">Choose a valid date range with the start on or before the end.</p>}
      {error && <p className="analytics-error" role="alert">{error} <button onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
      {!financials && !error && <p className="analytics-empty" role="status">Loading reporting data…</p>}
      {valid && financials && !error && <div id="analytics-panel" role="tabpanel" aria-labelledby={`analytics-tab-${tab}`}>
      {tab === "Overview" && <>
        {kpis([["invoiced", "Total invoiced", { money: true, dated: true, onClick: () => openReport("sales") }], ["received", "Payments received", { money: true, dated: true, onClick: () => openReport("payments") }], ["outstanding", "Outstanding", { money: true, onClick: () => openReport("outstanding") }], ["completed", "Jobs completed", { onClick: () => openReport("completed-jobs") }], ["averageInvoice", "Average invoice", { money: true, dated: true }], ["overdueCount", "Overdue invoices", { onClick: () => navigate("/invoices?status=overdue") }]])}
        <div className="analytics-grid analytics-grid-lead">{revenueChart}{createdChart}</div><div className="analytics-grid">{agingChart}{pipelineChart}{topCustomerChart}
          {preview("Maintenance snapshot", "maintenance-overdue", a.planRows.filter(p => p.active).sort((x, y) => x.nextDueDate.localeCompare(y.nextDueDate)), undefined, `${a.metrics.overduePlans} overdue plans · ${a.metrics.due7} due in 7 days`)}
        </div><div className="analytics-footline">{financials.costingEnabled ? <><strong>Costed jobs: {a.metrics.costed}</strong><span>Recorded gross profit: {currency(a.metrics.profit)} ex GST</span>{view("profitability", "Explore profitability")}</> : <><span>Costs and margins are available with Job Costing.</span><Link to="/settings">Settings</Link></>}</div>
      </>}
      {tab === "Financial" && <>
        {kpis([["invoiced", "Total invoiced", { money: true, dated: true }], ["received", "Received", { money: true, dated: true }], ["outstanding", "Outstanding", { money: true }], ["overdue", "Overdue", { money: true }], ["invoiceCount", "Invoice count", { dated: true }], ["averageInvoice", "Average invoice", { money: true, dated: true }]])}
        <p className="analytics-basis">Issued or paid invoices only; drafts, voids and archives excluded. Receipts use payment dates and can relate to earlier invoices. Current balances include all issue dates; overpayments remain on their own invoice.</p>
        <div className="analytics-grid analytics-grid-lead">{revenueChart}{series("Payments received", "Recorded payment dates · including GST", [["received", "Received"]], "payments", { bars: true, cash: true })}</div>
        <div className="analytics-grid">{agingChart}{horizontal("Invoice status", "Current status of invoices issued in the selected period", Object.entries(a.periodInvoices.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {})).map(([name, value]) => ({ name, value })), "sales")}
        {preview("Largest outstanding customers", "lifetime", a.owingCustomers.filter(c => c.outstanding), [customerColumn, { key: "outstanding", label: "Outstanding", type: "money" }, { key: "invoiceCount", label: "Invoices", type: "number" }], "Current balances · all dates")}
        {preview("Largest invoices", "sales")}{preview("Recent payments", "payments")}{preview("Oldest overdue invoices", "aging", a.overdue.toSorted((x, y) => y.overdueDays - x.overdueDays))}</div>
      </>}
      {tab === "Jobs" && <>
        {kpis([["created", "Created", { dated: true }], ["open", "Open"], ["completed", "Completed"], ["inProgress", "In progress"], ["unscheduled", "Unscheduled"]])}
        <p className="analytics-basis">Creation counts use the selected dates. Status, urgency and assignments describe current jobs across all dates. Completion dates and time in status are not recorded reliably.</p>
        <div className="analytics-grid">{createdChart}{pipelineChart}{horizontal("Jobs by urgency", "Current jobs", a.urgency, "open-jobs")}{horizontal("Technician assignments", "Current workload · not a productivity ranking", a.technicians, "technician")}{horizontal("Jobs by customer type", "Current jobs", a.jobTypes, "jobs")}{horizontal("Top customers by job count", "Current jobs", a.jobsByCustomer.slice(0, 6).map(c => ({ ...c, value: c.jobCount })), "jobs-customer")}</div>
      </>}
      {tab === "Customers" && <>
        {kpis([["customers", "Total customers"], ["newCustomers", "New customers", { dated: true }], ["invoicedCustomers", "Invoiced in period", { dated: true }], ["owingCustomers", "With outstanding balances"], ["averageCustomerValue", "Average invoiced / customer", { money: true, dated: true, detail: "Customers invoiced in period" }]])}
        <div className="analytics-grid">{topCustomerChart}{horizontal("Top customers by receipts", "Payment dates in selected period", a.topReceived.filter(c => c.periodReceived).slice(0, 6).map(c => ({ ...c, value: c.periodReceived / 100 })), "customer-revenue", { cash: true })}{horizontal("Customer types", "Current customer records", a.customerTypes, "customers")}{series("New customers", "Customer creation dates", [["newCustomers", "Customers"]], "new-customers", { bars: true })}</div>
        {preview("Customer lifetime value", "lifetime", undefined, undefined, "All-time issued invoices and recorded payments · including GST")}
      </>}
      {tab === "Maintenance" && <>
        {kpis([["activePlans", "Active plans"], ["contract", "Contract prices", { money: true, detail: "Sum of active per-visit prices" }], ["overduePlans", "Overdue plans", { onClick: () => navigate("/maintenance?filter=overdue") }], ["due7", "Due next 7 days"], ["due30", "Due next 30 days"], ["generated", "Generated jobs"]])}
        <p className="analytics-basis">Due counts describe each active plan’s next ungenerated visit. Forecast includes uncompleted recurring occurrences from today, including generated visits. Contract prices are per visit; they are not annual recurring revenue.</p>
        <div className="analytics-grid analytics-grid-lead">{series("12-month maintenance workload", "Recurrence engine · from today through the next 12 calendar months", [["visits", "Visits"]], "maintenance-schedule", { bars: true, data: a.forecast })}{horizontal("Due status", "Current plan status", a.planStatus, "maintenance-overdue", { click: row => navigate(`/maintenance?filter=${({ Overdue: "overdue", "Due soon": "due-soon", Upcoming: "upcoming", Inactive: "inactive" })[row.name] || "all"}`) })}</div>
        <div className="analytics-grid">{horizontal("Maintenance value by customer", "Sum of active per-visit prices", a.maintenanceCustomers, "maintenance-value", { cash: true })}{horizontal("Plans by frequency", "Current plans", a.frequencies, "maintenance-value")}{preview("Overdue maintenance", "maintenance-overdue")}{preview("Upcoming maintenance", "maintenance-schedule", a.occurrences.filter(o => !o.completedAt && o.date >= today).sort((x, y) => x.date.localeCompare(y.date)), undefined, "Selected date range")}{preview("Highest-value maintenance customers", "maintenance-value", a.maintenanceCustomers.map(c => ({ ...c, value: c.value * 100 })), [customerColumn, { key: "value", label: "Contract prices", type: "money" }, { key: "count", label: "Plans", type: "number" }])}
        {financials.costingEnabled && preview("Maintenance job profitability", "profitability", reportTable("profitability", a).rows.filter(r => a.jobsById.get(r.jobId)?.maintenancePlanId), undefined, "Selected cohort · recorded costs only")}</div>
      </>}
      {tab === "Profitability" && (costingUnavailable || <>
        {kpis([["revenue", "Costed job revenue", { money: true, detail: "Ex GST · selected job cohort" }], ["costs", "Recorded costs", { money: true, detail: "All costs for selected jobs" }], ["profit", "Gross profit", { money: true, detail: "Costed jobs only" }], ["margin", "Gross margin", { percent: true, detail: "Costed jobs only" }], ["costed", "Jobs with costing", { detail: "Selected job cohort" }], ["uncosted", "Uncosted invoiced jobs", { detail: "Excluded from margin totals" }]])}
        <p className="analytics-basis">Gross margin: {a.metrics.margin == null ? "—" : `${a.metrics.margin.toFixed(1)}%`} · Jobs invoiced in the selected period; unbilled jobs use creation dates. All recorded costs for those jobs are included. No recorded costs does not mean zero cost.</p>
        <div className="analytics-grid">{series("Gross profit by job cohort", "Grouped by invoice issue date / unbilled job creation date · ex GST", [["profit", "Gross profit"]], "profitability", { cash: true })}{horizontal("Costs by category", "Recorded costs for selected jobs · ex GST", a.categoryTotals, "costs", { cash: true })}{series("Revenue vs cost", "Costed jobs in selected cohort · ex GST", [["revenue", "Revenue"], ["costs", "Costs"]], "profitability", { bars: true, cash: true })}{horizontal("Margin distribution", "Costed jobs · zero-revenue jobs shown separately", a.margins, "margin")}{preview("Most profitable jobs", "profitability", reportTable("profitability", a).rows.filter(r => r.hasCosts))}{preview("Lowest margin jobs", "margin", a.costed.toSorted((x, y) => (x.marginPercent ?? -Infinity) - (y.marginPercent ?? -Infinity)))}{preview("Uncosted invoiced jobs", "profitability", reportTable("profitability", a).rows.filter(r => r.invoiced && !r.hasCosts))}</div>
      </>)}
      {tab === "Reports" && <div className="analytics-report-centre"><nav className="analytics-report-list" aria-label="Report catalogue">{[...new Set(REPORTS.map(r => r.group))].map(group => <div key={group}><h2>{group}</h2>{REPORTS.filter(r => r.group === group).map(r => <button key={r.id} aria-current={report.id === r.id ? "page" : undefined} onClick={() => update({ report: r.id })}>{r.name}</button>)}</div>)}</nav>
        <article className="analytics-report" data-print-report><header className="analytics-report-header"><div><h2>{report.name}</h2><p>{from} — {to} · {filterContext}</p><p>{report.basis} · Snapshot {today} · AUD</p></div><div className="analytics-report-actions"><button className="analytics-button" disabled={!valid || (report.group === "Profitability" && !financials.costingEnabled)} onClick={exportCsv}><Download size={14} />Export CSV</button><button className="analytics-button" onClick={() => window.print()}><Printer size={14} />Print / Save as PDF</button></div></header>
        {report.group === "Profitability" && !financials.costingEnabled ? costingUnavailable : <><div className="analytics-report-summary"><strong>{table.rows.length} records</strong>{table.columns.filter(c => c.type === "money").map(c => <span key={c.key}>{c.label}: <b>{currency(table.rows.reduce((total, row) => total + (Number(row[c.key]) || 0), 0))}</b></span>)}</div><AnalyticsTable label={report.name} {...table} /><p className="analytics-report-end">{table.rows.length} records · ELSET Reports & Analytics · {filterContext}</p></>}
        </article></div>}
      </div>}
    </PageBody>
    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}><DialogContent className="analytics-filter-dialog"><DialogHeader><DialogTitle>Analytics filters</DialogTitle><DialogDescription>Filters apply to this view and its exports. Date basis is shown with each report.</DialogDescription></DialogHeader>
      {allowedFilters.map(key => <label key={key}>{filterLabels[key]}<select aria-label={filterLabels[key]} value={filters[key]} onChange={event => update({ [key]: event.target.value, ...(key === "customer" ? { site: "" } : {}) })}><option value="">All</option>
        {(key === "customer" ? data.customers.map(c => [c.id, c.name]) : key === "site" ? data.customers.filter(c => !filters.customer || c.id === filters.customer).flatMap(c => (c.sites || []).map(s => [s.id, `${c.name} · ${s.label || s.address}`])) : key === "technician" ? [["unassigned", "Unassigned"], ...data.staff.map(s => [s.id, s.name])] : key === "status" ? statuses.map(s => [s, s]) : [...new Set(data.customers.map(c => c.customerType).filter(Boolean))].sort().map(t => [t, t])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>)}<div className="analytics-filter-actions"><button className="analytics-button" onClick={() => update(Object.fromEntries(Object.keys(filterLabels).map(key => [key, ""])))}>Clear filters</button><button className="analytics-button" onClick={() => setFiltersOpen(false)}>Done</button></div>
    </DialogContent></Dialog>
  </PageWorkspace>;
}
