import fs from "node:fs";
export function analyticsFixture() {
  const data = JSON.parse(fs.readFileSync(new URL("../../fixtures/demo-workspace.json", import.meta.url), "utf8"));
  const customer = data.customers[0], job = data.jobs[0];
  data.settings.addons = { jobCosting: true };
  data.staff = [{ id: "tech-a", name: "Alex Technician", role: "Technician", createdAt: "2026-01-01" }, { id: "tech-b", name: "Alex Technician", role: "Technician", createdAt: "2026-01-01" }];
  data.customers = ["Alpha", "Beta", "Gamma"].map((name, i) => ({ ...customer, id: `c${i}`, name: `${name} Engineering`, customerType: i === 2 ? "homeowner" : "business", createdAt: i === 2 ? "2026-09-18T01:00:00Z" : "2026-01-01T01:00:00Z", address: `${i} Test Street`, sites: [{ id: `s${i}`, label: "Main site", address: `${i} Test Street`, assets: [] }], contactAssignments: [] }));
  const spec = [
    ["partial", 0, 1000, "2026-09-04", "2026-09-10", [[440, "2026-09-05"], [220, "2026-10-01"]]],
    ["paid", 1, 2000, "2026-09-08", "2026-09-20", [[2200, "2026-09-20"]]],
    ["older", 0, 500, "2026-08-05", "2026-08-15", [[550, "2026-09-03"]]],
    ["draft", 1, 9000, "2026-09-01", "2026-09-10", []],
    ["void", 1, 9000, "2026-09-01", "2026-09-10", []],
    ["archive", 1, 9000, "2026-09-01", "2026-09-10", []],
    ["unbilled", 2, null, "2026-09-01", "", []],
    ["uncosted", 2, 200, "2026-09-21", "2026-10-15", []],
    ["overpaid", 2, 100, "2026-09-22", "2026-09-25", [[120, "2026-09-23"]]],
  ];
  data.jobs = spec.map(([id, index, rate, issueDate, dueDate, payments], i) => ({ ...job, id, jobNumber: 8000 + i, title: `Reporting ${id}`, customerId: `c${index}`, customerName: data.customers[index].name, jobAddress: `${index} Test Street`, status: i % 3 === 0 ? "To Do" : i % 3 === 1 ? "In Progress" : "Completed", urgency: i % 2 ? "High" : "Low", assignedTechnicianId: i < 4 ? "tech-a" : i < 7 ? "tech-b" : "", assignedTechnicianName: i < 7 ? "Alex Technician" : "", scheduledDate: "", createdAt: `${issueDate}T01:00:00Z`, updatedAt: "2026-10-01T01:00:00Z", notes: [], photos: [], quote: null, maintenancePlanId: "", invoice: rate === null ? null : {
    type: "invoice", issueDate, dueDate, items: [{ id: `line-${id}`, description: 'Service, "test"', qty: 1, rate }],
    sentHistory: id === "draft" ? [] : [{ id: `sent-${id}`, sentAt: `${issueDate}T02:00:00Z`, toEmail: "accounts@example.test" }],
    payments: payments.map(([amount, date], n) => ({ id: `${id}-p${n}`, amount, date, method: "Bank transfer", reference: n ? "Deposit" : 'Paid, "thanks"' })),
    ...(id === "void" ? { status: "void" } : id === "archive" ? { archived: true } : {}),
  } }));
  data.maintenancePlans = [
    { id: "plan-a", planName: "Quarterly service", customerId: "c0", siteId: "s0", siteAddress: "0 Test Street", frequency: "quarterly", nextDueDate: "2026-09-25", contractPrice: 400, contractPriceSet: true, active: true, checklist: [], createdAt: "2026-01-01" },
    { id: "plan-b", planName: "Monthly service", customerId: "c1", siteId: "s1", siteAddress: "1 Test Street", frequency: "monthly", nextDueDate: "2026-10-05", contractPrice: 200, contractPriceSet: true, active: true, checklist: [], createdAt: "2026-01-01" },
    { id: "plan-c", planName: "Inactive service", customerId: "c2", siteId: "s2", siteAddress: "2 Test Street", frequency: "monthly", nextDueDate: "2026-10-02", contractPrice: 999, active: false, checklist: [], createdAt: "2026-01-01" },
  ];
  data.deletedJobs = []; data.deletedCustomers = []; data.deletedInvoices = [];
  return data;
}
export function seedAnalyticsCosts(db) {
  // The import normalizer deliberately drops inactive document flags. Model
  // existing stored metadata explicitly, as the customer-account tests do.
  db.prepare("UPDATE invoices SET extra_json = ? WHERE job_id = 'void'").run(JSON.stringify({ status: "void" }));
  db.prepare("UPDATE invoices SET extra_json = ? WHERE job_id = 'archive'").run(JSON.stringify({ archived: true }));
  const insert = db.prepare("INSERT INTO job_cost_entries(id,job_id,category,description,quantity_micros,unit_cost_cents,total_cost_cents,cost_date,created_at,updated_at) VALUES(?,?,?,?,1000000,?,?,?,'2026-09-01','2026-09-01')");
  for (const [i, category] of ["materials", "labour", "subcontractors", "sundries", "plantEquipment", "travel", "other"].entries()) insert.run(`cost-${i}`, "partial", category, `${category} expense`, 10000, 10000, "2026-09-03");
  insert.run("cost-loss", "paid", "materials", "High cost", 250000, 250000, "2026-09-05");
  insert.run("cost-unbilled", "unbilled", "labour", "Unbilled work", 10000, 10000, "2026-09-05");
}
