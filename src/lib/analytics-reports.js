import { COST_CATEGORIES } from "./job-costing.js";

export const REPORTS = [
  ["sales", "Sales Report", "Financial", "Invoice issue date", ["customer", "site", "technician", "status", "type"]],
  ["payments", "Payments Received", "Financial", "Payment date", ["customer", "site", "type"]],
  ["outstanding", "Outstanding Invoices", "Financial", "Current balances · all issue dates", ["customer", "site", "type"]],
  ["aging", "Invoice Aging", "Financial", "Current balances · due-date aging", ["customer", "type"]],
  ["customer-revenue", "Customer Revenue", "Financial", "Invoice issue date / payment date", ["customer", "type"]],
  ["jobs", "Jobs Report", "Operations", "Job creation date", ["customer", "site", "technician", "status", "type"]],
  ["open-jobs", "Open Jobs", "Operations", "Current status · all creation dates", ["customer", "site", "technician", "type"]],
  ["completed-jobs", "Completed Jobs", "Operations", "Currently completed · all creation dates", ["customer", "site", "technician", "type"]],
  ["technician", "Technician Workload", "Operations", "Current assignments · all creation dates", ["customer", "site", "technician", "status", "type"]],
  ["jobs-customer", "Jobs by Customer", "Operations", "Job creation date", ["customer", "type"]],
  ["maintenance-schedule", "Maintenance Schedule", "Maintenance", "Occurrence due date", ["customer", "site", "technician", "type"]],
  ["maintenance-overdue", "Overdue Maintenance", "Maintenance", "Current next due dates", ["customer", "site", "technician", "type"]],
  ["maintenance-value", "Maintenance Contract Value", "Maintenance", "Active plans · price per visit, not annual revenue", ["customer", "site", "type"]],
  ["profitability", "Job Profitability", "Profitability", "Invoice issue date; unbilled jobs by creation date · all recorded job costs, ex GST", ["customer", "site", "type"]],
  ["costs", "Cost Breakdown", "Profitability", "Selected job cohort · all recorded job costs, ex GST", ["customer", "site", "type"]],
  ["margin", "Gross Margin", "Profitability", "Costed jobs in selected cohort · ex GST", ["customer", "site", "type"]],
  ["customers", "Customer Summary", "Customers", "Lifetime totals · current customers", ["customer", "type"]],
  ["lifetime", "Customer Lifetime Value", "Customers", "Lifetime totals · current customers", ["customer", "type"]],
  ["new-customers", "New Customers", "Customers", "Customer creation date", ["customer", "type"]],
].map(([id, name, group, basis, filters]) => ({ id, name, group, basis, filters }));

const col = (key, label, type = "text", link) => ({ key, label, type, link });
const customer = col("customerName", "Customer", "text", row => `/customers/${encodeURIComponent(row.customerId)}`);
const invoiceColumns = [col("invoiceNumber", "Invoice", "text", row => `/jobs/${encodeURIComponent(row.jobId)}/invoice`), customer,
  col("issueDate", "Issued", "date"), col("dueDate", "Due", "date"), col("totalCents", "Invoiced", "money"), col("paidCents", "Received to date", "money"), col("balanceCents", "Outstanding", "money"), col("status", "Status"), col("overdueDays", "Days overdue", "number")];
const jobColumns = [col("jobNumber", "Job", "text", row => `/jobs/${encodeURIComponent(row.id)}`), col("title", "Title"), customer, col("status", "Current status"), col("urgency", "Urgency"), col("assignedTechnicianName", "Technician"), col("scheduledDate", "Scheduled", "date")];
const customerColumns = [col("name", "Customer", "text", row => `/customers/${encodeURIComponent(row.id)}`), col("type", "Type"), col("invoiced", "Total invoiced", "money"), col("received", "Total received", "money"), col("outstanding", "Outstanding", "money"), col("invoiceCount", "Invoices", "number"), col("jobCount", "Jobs", "number")];
const planColumns = [col("name", "Plan", "text", row => `/maintenance/${encodeURIComponent(row.planId || row.id)}`), customer, col("siteAddress", "Site"), col("frequency", "Frequency"), col("nextDueDate", "Next due", "date"), col("value", "Price / visit", "money"), col("status", "Status")];
const profitColumns = [col("name", "Job", "text", row => `/jobs/${encodeURIComponent(row.jobId)}`), col("customerName", "Customer"), col("date", "Cohort date", "date"), col("revenueCents", "Revenue ex GST", "money"), col("totalCostCents", "Recorded costs", "money"), col("grossProfitCents", "Gross profit", "money"), col("marginPercent", "Margin", "percent"), col("costState", "Costing")];

export function reportTable(id, a) {
  if (["sales", "outstanding", "aging"].includes(id)) return { columns: invoiceColumns,
    rows: (id === "sales" ? a.periodInvoices : a.outstanding).toSorted((x, y) => id === "aging" ? y.overdueDays - x.overdueDays || x.invoiceId.localeCompare(y.invoiceId) : y.totalCents - x.totalCents || x.invoiceId.localeCompare(y.invoiceId)) };
  if (id === "payments") return { columns: [col("date", "Received", "date"), col("invoiceNumber", "Invoice", "text", row => `/jobs/${encodeURIComponent(row.jobId)}/invoice`), customer, col("amountCents", "Amount", "money"), col("method", "Method"), col("reference", "Reference")], rows: a.periodPayments.toSorted((x, y) => y.date.localeCompare(x.date) || x.id.localeCompare(y.id)) };
  if (["customers", "lifetime", "customer-revenue", "new-customers", "jobs-customer"].includes(id)) {
    let rows = a.customerRows, columns = customerColumns;
    if (id === "customer-revenue") { rows = a.topCustomers.filter(c => c.periodInvoiced || c.periodReceived); columns = [customerColumns[0], col("periodInvoiced", "Invoiced in period", "money"), col("periodReceived", "Received in period", "money")]; }
    if (id === "new-customers") { const ids = new Set(a.newCustomers.map(c => c.id)); rows = rows.filter(c => ids.has(c.id)); columns = [customerColumns[0], col("createdDate", "Created", "date"), customerColumns[1]]; }
    if (id === "jobs-customer") { const counts = new Map(); for (const job of a.createdJobs) counts.set(job.customerId, (counts.get(job.customerId) || 0) + 1); rows = rows.map(c => ({ ...c, jobCount: counts.get(c.id) || 0 })).filter(c => c.jobCount).sort((x, y) => y.jobCount - x.jobCount || x.name.localeCompare(y.name)); columns = [customerColumns[0], customerColumns[6]]; }
    return { rows, columns };
  }
  if (["jobs", "open-jobs", "completed-jobs", "technician"].includes(id)) return { columns: jobColumns, rows: (id === "jobs" ? a.createdJobs : a.jobs).filter(j => id === "open-jobs" ? j.status !== "Completed" : id === "completed-jobs" ? j.status === "Completed" : true).map(j => ({ ...j, customerName: a.allCustomers.get(j.customerId)?.name || j.customerName, assignedTechnicianName: j.assignedTechnicianName || "Unassigned" })) };
  if (id.startsWith("maintenance-")) return { columns: id === "maintenance-schedule" ? planColumns.map(c => c.key === "nextDueDate" ? col("date", "Visit due", "date") : c) : planColumns,
    rows: (id === "maintenance-schedule" ? a.occurrences : a.planRows.filter(p => id === "maintenance-overdue" ? p.status === "Overdue" : p.active)).toSorted((x, y) => (x.date || x.nextDueDate || "").localeCompare(y.date || y.nextDueDate || "") || x.id.localeCompare(y.id)) };
  if (id === "costs") return { columns: [col("name", "Job", "text", row => `/jobs/${encodeURIComponent(row.jobId)}`), col("costDate", "Cost date", "date"), col("category", "Category"), col("description", "Description"), col("totalCostCents", "Cost ex GST", "money")], rows: a.costed.flatMap(job => job.entries.map(entry => ({ ...entry, name: job.name, category: COST_CATEGORIES.find(category => category.key === entry.category)?.label || entry.category }))) };
  return { columns: profitColumns, rows: (id === "margin" ? a.costed : a.profitability).filter(row => row.invoiced || row.hasCosts).map(row => ({ ...row, grossProfitCents: row.hasCosts ? row.grossProfitCents : null, marginPercent: row.hasCosts ? row.marginPercent : null, costState: row.hasCosts ? "Recorded" : "Not recorded" })).sort((x, y) => (y.grossProfitCents ?? -Infinity) - (x.grossProfitCents ?? -Infinity) || x.id.localeCompare(y.id)) };
}

export function exportReportCsv(columns, rows) {
  const escape = value => {
    let text = value === null || value === undefined ? "" : String(value);
    // Prevent spreadsheet formulas in user-entered text, while keeping actual
    // numbers (including negative profit) as numeric cells.
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return "\uFEFF" + [columns.map(c => escape(c.label)).join(","), ...rows.map(row => columns.map(c => {
    const value = row[c.key];
    if (value == null) return "";
    return c.type === "money" ? (Number(value) / 100).toFixed(2) : escape(value);
  }).join(","))].join("\r\n") + "\r\n";
}
