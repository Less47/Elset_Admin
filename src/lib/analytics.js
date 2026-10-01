import { invoiceDate, invoiceToday, invoiceOverdueDays, invoiceStatusFromAmounts } from "./invoice-account.js";
import { expandMaintenanceOccurrences, effectiveMaintenancePlan } from "./maintenance-recurrence.js";
import { COST_CATEGORIES } from "./job-costing.js";
import { statuses } from "./job-status.js";

export const ANALYTICS_TABS = ["Overview", "Financial", "Jobs", "Customers", "Maintenance", "Profitability", "Reports"];
export const DATE_PRESETS = ["Today", "This week", "This month", "Last month", "This quarter", "This year", "Last 12 months", "Custom range"];
const DAY = 86400000;
export const dateOffset = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const dateDays = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY) + 1;
export const inRange = (date, range) => Boolean(invoiceDate(date) && date >= range.from && date <= range.to);
export function createdDate(value) {
  if (invoiceDate(value)) return value;
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? invoiceToday(date) : "";
}
export function presetRange(preset, today = invoiceToday()) {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  let from = today, to = today;
  if (preset === "This week") from = dateOffset(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  if (preset === "This month") from = `${today.slice(0, 7)}-01`;
  if (preset === "Last month") { to = dateOffset(`${today.slice(0, 7)}-01`, -1); from = `${to.slice(0, 7)}-01`; }
  if (preset === "This quarter") from = `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  if (preset === "This year") from = `${year}-01-01`;
  if (preset === "Last 12 months") { const d = new Date(`${today}T12:00:00Z`); d.setUTCFullYear(year - 1); from = dateOffset(d.toISOString().slice(0, 10), 1); }
  return { from, to };
}
export function previousRange(range) {
  return { from: dateOffset(range.from, -dateDays(range.from, range.to)), to: dateOffset(range.from, -1) };
}
export function comparison(current, previous) {
  if (!previous) return current ? "New vs previous period" : "No change vs previous period";
  const percent = (current - previous) / Math.abs(previous) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}% vs previous period`;
}
export function timeBuckets(range) {
  if (!invoiceDate(range.from) || !invoiceDate(range.to) || range.from > range.to) return [];
  const days = dateDays(range.from, range.to), unit = days <= 45 ? "day" : days <= 150 ? "week" : days <= 3660 ? "month" : "year";
  const result = [];
  let start = range.from;
  while (start <= range.to) {
    let end;
    if (unit === "day" || unit === "week") end = dateOffset(start, unit === "day" ? 0 : 6);
    else if (unit === "year") end = `${start.slice(0, 4)}-12-31`;
    else { const next = new Date(`${start.slice(0, 7)}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1); end = dateOffset(next.toISOString().slice(0, 10), -1); }
    end = end > range.to ? range.to : end;
    const label = new Date(`${start}T12:00:00Z`).toLocaleDateString("en-AU", unit === "month" ? { month: "short", year: "2-digit", timeZone: "UTC" } : unit === "year" ? { year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" });
    result.push({ from: start, to: end, label, invoiced: 0, received: 0, invoiceCount: 0, created: 0, newCustomers: 0, revenue: 0, costs: 0, profit: 0 });
    start = dateOffset(end, 1);
  }
  return result;
}
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
const grouping = (rows, key) => {
  const map = new Map();
  for (const row of rows) { const id = typeof key === "function" ? key(row) : row[key]; if (!map.has(id)) map.set(id, []); map.get(id).push(row); }
  return map;
};
const rank = (rows, key) => [...rows].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
const distribution = (rows, key) => [...grouping(rows, key)].map(([name, entries]) => ({ id: name, name: name || "Not recorded", value: entries.length }));
const addressKey = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

export function analyticsScope(data, financials, filters = {}) {
  const allCustomers = new Map(data.customers.map(customer => [customer.id, customer]));
  const sites = new Map(data.customers.flatMap(customer => (customer.sites || []).map(site => [site.id, { ...site, customerId: customer.id }])));
  const site = sites.get(filters.site);
  const assignments = new Map((financials?.jobAssignments || []).map(row => [row.jobId, row]));
  const jobs = data.jobs.map(job => assignments.has(job.id) ? { ...job, ...assignments.get(job.id) } : job).filter(job => (!filters.customer || job.customerId === filters.customer)
    && (!filters.type || allCustomers.get(job.customerId)?.customerType === filters.type)
    && (!filters.site || (site && job.customerId === site.customerId && addressKey(job.jobAddress) === addressKey(site.address)))
    && (!filters.technician || (job.assignedTechnicianId || "unassigned") === filters.technician)
    && (!filters.status || job.status === filters.status));
  const jobIds = new Set(jobs.map(job => job.id));
  const relatedCustomers = new Set(jobs.map(job => job.customerId));
  const dimensionCustomers = data.customers.filter(customer => (!filters.customer || customer.id === filters.customer)
    && (!filters.type || customer.customerType === filters.type)
    && (!filters.site || customer.id === site?.customerId));
  const customers = dimensionCustomers.filter(customer => !(filters.technician || filters.status) || relatedCustomers.has(customer.id));
  // A plan's default technician does not require an already-generated job.
  const customerIds = new Set(dimensionCustomers.map(customer => customer.id));
  const plans = (data.maintenancePlans || []).filter(plan => customerIds.has(plan.customerId)
    && (!filters.site || plan.siteId === filters.site || addressKey(plan.siteAddress) === addressKey(site?.address))
    && (!filters.technician || (plan.defaultTechnicianId || "unassigned") === filters.technician));
  return { jobs, customers, plans, invoices: (financials?.invoices || []).filter(row => jobIds.has(row.jobId)),
    payments: (financials?.payments || []).filter(row => jobIds.has(row.jobId)), costing: (financials?.costing || []).filter(row => jobIds.has(row.jobId)), allCustomers };
}

// No completion-duration, status-dwell, acceptance-rate or technician-speed
// metrics: the schema has no reliable general job/status event history.
export function deriveAnalytics(data, financials, range, filters = {}, today = invoiceToday()) {
  const scope = analyticsScope(data, financials, filters), { jobs, customers, plans, allCustomers } = scope;
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  const invoices = scope.invoices.map(row => ({ ...row, id: row.invoiceId, name: row.invoiceNumber,
    customerName: allCustomers.get(row.customerId)?.name || "Unknown customer", overdueDays: invoiceOverdueDays(row.balanceCents, row.dueDate, today),
    status: invoiceStatusFromAmounts({ total: row.totalCents, balance: row.balanceCents, paid: row.paidCents, paymentCount: row.paymentCount, sentCount: row.sentCount, dueDate: row.dueDate, today }).label }));
  const payments = scope.payments.map(row => ({ ...row, customerName: allCustomers.get(row.customerId)?.name || "Unknown customer" }));
  const periodInvoices = invoices.filter(row => inRange(row.issueDate, range)), periodPayments = payments.filter(row => inRange(row.date, range));
  const createdJobs = jobs.filter(job => inRange(createdDate(job.createdAt), range)), newCustomers = customers.filter(row => inRange(createdDate(row.createdAt), range));
  const overdue = invoices.filter(row => row.overdueDays > 0), outstanding = invoices.filter(row => row.balanceCents > 0);
  const buckets = timeBuckets(range);
  // Binary lookup keeps long date ranges and large ledgers linearithmic.
  const bucketFor = date => { let lo = 0, hi = buckets.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, b = buckets[mid]; if (date < b.from) hi = mid - 1; else if (date > b.to) lo = mid + 1; else return b; } return null; };
  for (const row of periodInvoices) { const b = bucketFor(row.issueDate); b.invoiced += row.totalCents / 100; b.invoiceCount++; }
  for (const row of periodPayments) bucketFor(row.date).received += row.amountCents / 100;
  for (const row of createdJobs) bucketFor(createdDate(row.createdAt)).created++;
  for (const row of newCustomers) bucketFor(createdDate(row.createdAt)).newCustomers++;
  const aging = ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"].map((name, index) => ({ id: String(index), name, value: 0, count: 0 }));
  for (const row of outstanding) { const b = aging[row.overdueDays === 0 ? 0 : row.overdueDays <= 30 ? 1 : row.overdueDays <= 60 ? 2 : row.overdueDays <= 90 ? 3 : 4]; b.value += row.balanceCents / 100; b.count++; }
  const lifetime = new Map(customers.map(row => [row.id, { id: row.id, name: row.name, type: row.customerType || "Not recorded", createdDate: createdDate(row.createdAt), invoiced: 0, received: 0, outstanding: 0, invoiceCount: 0, jobCount: 0, periodInvoiced: 0, periodReceived: 0 }]));
  for (const row of invoices) { const c = lifetime.get(row.customerId); if (c) { c.invoiced += row.totalCents; c.received += row.paidCents; c.outstanding += row.balanceCents; c.invoiceCount++; if (inRange(row.issueDate, range)) c.periodInvoiced += row.totalCents; } }
  for (const row of periodPayments) { const c = lifetime.get(row.customerId); if (c) c.periodReceived += row.amountCents; }
  for (const job of jobs) { const c = lifetime.get(job.customerId); if (c) c.jobCount++; }
  const customerRows = [...lifetime.values()];
  const jobsByPlan = grouping(jobs, "maintenancePlanId");
  const planRows = plans.map(source => {
    const linked = jobsByPlan.get(source.id) || [], plan = effectiveMaintenancePlan(source, linked);
    const due = plan.nextDueDate, active = plan.active !== false;
    const status = !active ? "Inactive" : !due ? (linked.some(job => job.status !== "Completed") ? "Active job" : "No due date") : due < today ? "Overdue" : due <= dateOffset(today, 7) ? "Due soon" : "Upcoming";
    return { ...plan, name: plan.planName, customerName: allCustomers.get(plan.customerId)?.name || "Unknown customer", status, value: Math.round(Number(plan.contractPrice || 0) * 100), active };
  });
  const forecastEndDate = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); forecastEndDate.setUTCMonth(forecastEndDate.getUTCMonth() + 12);
  const forecastEnd = dateOffset(forecastEndDate.toISOString().slice(0, 10), -1);
  const forecast = timeBuckets({ from: today, to: forecastEnd }).map(b => ({ ...b, visits: 0, value: 0 }));
  const occurrences = [], forecastByMonth = new Map(forecast.map(b => [b.from.slice(0, 7), b]));
  for (const plan of planRows) {
    const linked = jobsByPlan.get(plan.id) || [];
    if (plan.active) for (const occurrence of expandMaintenanceOccurrences(plan, today, forecastEnd, linked, today)) {
      if (occurrence.completedAt) continue;
      const bucket = forecastByMonth.get(occurrence.date.slice(0, 7));
      if (bucket) { bucket.visits++; bucket.value += plan.value / 100; }
    }
    for (const occurrence of expandMaintenanceOccurrences(plan, range.from, range.to, linked, today)) occurrences.push({ ...occurrence, id: occurrence.key, name: plan.planName, customerName: plan.customerName, value: plan.value, status: occurrence.completedAt ? "Completed" : occurrence.date < today ? "Overdue" : "Upcoming" });
  }
  const invoiceByJob = new Map(invoices.map(row => [row.jobId, row]));
  const costByJob = new Map(scope.costing.map(row => [row.jobId, row]));
  const profitability = jobs.flatMap(job => {
    const invoice = invoiceByJob.get(job.id), date = invoice?.issueDate || createdDate(job.createdAt);
    if (!inRange(date, range)) return [];
    const cost = costByJob.get(job.id);
    const row = { ...(cost || { revenueCents: invoice?.subtotalCents || 0, totalCostCents: 0, grossProfitCents: 0, marginPercent: null, entries: [], categories: [] }),
      id: job.id, jobId: job.id, name: `#${job.jobNumber} ${job.title}`, customerName: allCustomers.get(job.customerId)?.name || job.customerName, date,
      hasCosts: Boolean(cost?.entries.length), invoiced: Boolean(invoice), maintenance: Boolean(job.maintenancePlanId) };
    const b = bucketFor(date); if (b && row.hasCosts) { b.revenue += row.revenueCents / 100; b.costs += row.totalCostCents / 100; b.profit += row.grossProfitCents / 100; }
    return [row];
  });
  const costed = profitability.filter(row => row.hasCosts);
  const categoryTotals = new Map(COST_CATEGORIES.map(c => [c.key, { ...c, id: c.key, name: c.label, value: 0 }]));
  for (const row of costed) for (const c of row.categories) categoryTotals.get(c.key).value += c.totalCostCents / 100;
  const margins = ["Negative", "0–19.9%", "20–39.9%", "40%+", "No revenue"].map(name => ({ name, value: 0 }));
  for (const row of costed) margins[row.marginPercent === null ? 4 : row.marginPercent < 0 ? 0 : row.marginPercent < 20 ? 1 : row.marginPercent < 40 ? 2 : 3].value++;
  const metrics = { invoiced: sum(periodInvoices, "totalCents"), received: sum(periodPayments, "amountCents"), outstanding: sum(outstanding, "balanceCents"), overdue: sum(overdue, "balanceCents"), overdueCount: overdue.length,
    invoiceCount: periodInvoices.length, averageInvoice: periodInvoices.length ? sum(periodInvoices, "totalCents") / periodInvoices.length : 0,
    created: createdJobs.length, completed: jobs.filter(j => j.status === "Completed").length, open: jobs.filter(j => j.status !== "Completed").length,
    inProgress: jobs.filter(j => j.status === "In Progress").length, unscheduled: jobs.filter(j => j.status !== "Completed" && !j.scheduledDate).length,
    customers: customers.length, newCustomers: newCustomers.length, invoicedCustomers: new Set(periodInvoices.map(i => i.customerId)).size,
    owingCustomers: customerRows.filter(c => c.outstanding > 0).length,
    activePlans: planRows.filter(p => p.active).length, contract: sum(planRows.filter(p => p.active), "value"), overduePlans: planRows.filter(p => p.status === "Overdue").length,
    due7: planRows.filter(p => p.active && p.nextDueDate >= today && p.nextDueDate <= dateOffset(today, 7)).length,
    due30: planRows.filter(p => p.active && p.nextDueDate >= today && p.nextDueDate <= dateOffset(today, 30)).length,
    generated: jobs.filter(j => j.maintenancePlanId).length, revenue: sum(costed, "revenueCents"), costs: sum(costed, "totalCostCents"), profit: sum(costed, "grossProfitCents"), costed: costed.length, uncosted: profitability.filter(p => p.invoiced && !p.hasCosts).length };
  metrics.margin = metrics.revenue ? metrics.profit / metrics.revenue * 100 : null;
  metrics.averageCustomerValue = metrics.invoicedCustomers ? metrics.invoiced / metrics.invoicedCustomers : 0;
  return { ...scope, invoices, payments, periodInvoices, periodPayments, createdJobs, newCustomers, overdue, outstanding, buckets, aging, customerRows,
    topCustomers: rank(customerRows, "periodInvoiced"), topReceived: rank(customerRows, "periodReceived"), owingCustomers: rank(customerRows, "outstanding"),
    customerTypes: distribution(customers, "customerType"), statusCounts: statuses.map(name => ({ name, value: jobs.filter(j => j.status === name).length })),
    urgency: distribution(jobs, "urgency"), jobTypes: distribution(jobs, j => allCustomers.get(j.customerId)?.customerType),
    technicians: [...grouping(jobs, j => j.assignedTechnicianId || "unassigned")].map(([id, entries]) => ({ id, name: data.staff.find(s => s.id === id)?.name || entries[0].assignedTechnicianName || "Unassigned", value: entries.length })), jobsByCustomer: rank(customerRows, "jobCount"),
    planRows, occurrences, forecast, planStatus: distribution(planRows, "status"), frequencies: distribution(planRows, "frequency"),
    maintenanceCustomers: [...grouping(planRows.filter(p => p.active), "customerId")].map(([id, rows]) => ({ id, name: allCustomers.get(id)?.name || "Unknown customer", value: sum(rows, "value") / 100, count: rows.length })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
    profitability, costed, categoryTotals: [...categoryTotals.values()], margins, metrics, jobsById };
}
