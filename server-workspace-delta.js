import { normalizeStoredData } from "./server-store.js";
import { readWorkspaceRecords } from "./server-workspace-state.js";
import { readRows } from "./server-workspace-query.js";

const recordId = (key, record) => key === "deletedJobs" ? record.job.id
  : key === "deletedCustomers" ? record.customer.id : record.id;
const ids = rows => rows.map(row => row.id);
const parsedIds = value => JSON.parse(value || "[]");

// Describe affected relationships before a write, while deleted links still exist.
// All lookups are scoped to this operation; no workspace snapshot is needed.
function collectScope(db, domain, req, result, scope = {}) {
  const customerWrites = [];
  const add = (key, values) => {
    const valid = values.flat().filter(value => typeof value === "string" && value);
    if (valid.length) scope[key] = [...new Set([...(scope[key] || []), ...valid])];
  };
  const related = (table, column, values) => readRows(db, table, values, { column });
  const route = req.route.path;
  const id = req.params.id;
  const restoring = route.endsWith("/restore");
  const deleting = req.method === "DELETE";

  if (domain === "jobs") {
    if (route === "/api/deleted-jobs") {
      add("deletedJobs", related("deleted_records", "kind", ["job"]).map(row => row.record_id));
    } else if (route === "/api/jobs/reschedule-day") {
      add("jobs", req.method === "GET" ? result?.jobs?.map(entry => entry.job.id) || []
        : Array.isArray(req.body?.jobs) ? req.body.jobs.map(entry => entry?.id) : []);
    } else if (route === "/api/jobs/tomorrow") {
      add("jobs", result?.jobIds || []);
    } else {
      add("jobs", [id, result?.job?.id, result?.id && (route === "/api/jobs" || restoring) ? result.id : null]);
      if (restoring || (deleting && route === "/api/jobs/:id")) add("deletedJobs", [id]);
      const jobs = readRows(db, "jobs", scope.jobs);
      const archived = restoring ? related("deleted_records", "record_id", [id]).filter(row => row.kind === "job").map(row => JSON.parse(row.payload_json)) : [];
      add("maintenancePlans", [...jobs.map(row => row.maintenance_plan_id), ...archived.map(job => job.maintenancePlanId)]);
      if (route === "/api/jobs" && (req.body?.customerMode === "new" || req.body?.siteInput)) {
        customerWrites.push(req.body?.customer?.id, req.body?.job?.customerId, result?.customerId);
        add("customers", customerWrites);
      }
      for (const job of archived) {
        if (!db.prepare("SELECT id FROM customers WHERE id = ?").get(job.customerId)) {
          add("customers", [job.customerId]); add("deletedCustomers", [job.customerId]);
          customerWrites.push(job.customerId);
        }
      }
      if (restoring && result?.customerId && scope.customers?.includes(result.customerId)) customerWrites.push(result.customerId);
    }
  } else if (domain === "documents") {
    add("jobs", [result?.jobId, route.startsWith("/api/jobs/") ? id : null]);
    add("deletedInvoices", [result?.archiveId, restoring ? id : null]);
  } else if (domain === "customers") {
    if (route === "/api/deleted-customers") {
      add("deletedCustomers", related("deleted_records", "kind", ["customer"]).map(row => row.record_id));
    } else if (route.startsWith("/api/contacts")) {
      add("contacts", [req.params.contactId, result?.id, result?.contactId]);
    } else {
      add("customers", [id, route === "/api/customers" ? result?.id : null]);
      if (!route.includes("/contacts")) customerWrites.push(id, route === "/api/customers" ? result?.id : null);
      const customerIds = [id, route === "/api/customers" ? result?.id : null].filter(Boolean);
      if (restoring || (deleting && route === "/api/customers/:id")) add("deletedCustomers", customerIds);
      if (route === "/api/customers/:id") {
        add("jobs", ids(related("jobs", "customer_id", customerIds)));
        add("maintenancePlans", ids(related("maintenance_plans", "customer_id", customerIds)));
        if (deleting) add("deletedJobs", scope.jobs || []);
      } else if (route.includes("/sites") && !route.includes("/contacts")) {
        add("maintenancePlans", ids(related("maintenance_plans", "customer_id", customerIds)));
        if (req.method === "PATCH") {
          const site = db.prepare("SELECT address FROM sites WHERE customer_id = ? AND id = ?").get(id, req.params.siteId);
          const body = req.body?.site || req.body || {};
          const address = body.previousAddress || req.body?.previousAddress || site?.address;
          if (address) add("jobs", db.prepare("SELECT id FROM jobs WHERE customer_id = ? AND lower(job_address) = lower(?)")
            .all(id, String(address).replace(/\s+/g, " ").trim()).map(row => row.id));
        }
      }
      if (restoring) {
        const archives = related("deleted_maintenance_plans", "customer_id", customerIds);
        add("maintenancePlans", archives.map(row => row.plan_id));
        add("jobs", archives.flatMap(row => parsedIds(row.linked_job_ids_json)));
      }
    }
  } else if (domain === "maintenance") {
    add("maintenancePlans", [id, result?.plan?.id, result?.id, result?.planId]);
    add("jobs", [result?.job?.id]);
    // Recurrence edits can adopt existing jobs; deletes/restores change job links.
    add("jobs", ids(related("jobs", "maintenance_plan_id", scope.maintenancePlans)));
    if (restoring) add("jobs", related("deleted_maintenance_plans", "plan_id", scope.maintenancePlans).flatMap(row => parsedIds(row.linked_job_ids_json)));
  } else if (domain === "inventory") {
    add("inventoryItems", [id, result?.id, result?.itemId]);
  } else if (domain === "staff") {
    add("staff", [id, result?.id, result?.staffId]);
    if (deleting || restoring) {
      add("jobs", ids(related("jobs", "assigned_technician_id", scope.staff)));
      add("maintenancePlans", ids(related("maintenance_plans", "default_technician_id", scope.staff)));
      if (restoring) for (const row of related("deleted_staff_members", "staff_id", scope.staff)) {
        add("jobs", parsedIds(row.assigned_job_ids_json));
        add("maintenancePlans", parsedIds(row.maintenance_plan_ids_json));
      }
    }
  } else if (domain === "settings") {
    scope[req.params.type ? (req.params.type === "invoice" ? "invoiceTemplate" : "quoteTemplate") : "settings"] = true;
  }

  // Customer/site saves may also edit shared contacts. Rebuild each direct or
  // site-linked owner of those contacts, including owners outside this customer.
  const writtenCustomerIds = customerWrites.filter(Boolean);
  if (writtenCustomerIds.length) {
    if (domain === "jobs") add("maintenancePlans", ids(related("maintenance_plans", "customer_id", writtenCustomerIds)));
    const sites = related("sites", "customer_id", writtenCustomerIds);
    add("contacts", [
      ...related("customer_contact_links", "customer_id", writtenCustomerIds),
      ...related("site_contact_links", "site_id", ids(sites)),
    ].map(row => row.contact_id));
  }
  if (scope.contacts?.length) {
    add("customers", related("customer_contact_links", "contact_id", scope.contacts).map(row => row.customer_id));
    const siteLinks = related("site_contact_links", "contact_id", scope.contacts);
    add("customers", readRows(db, "sites", siteLinks.map(row => row.site_id)).map(row => row.customer_id));
  }
  return scope;
}

function project(db, scope) {
  const records = normalizeStoredData(readWorkspaceRecords(db, scope));
  return Object.fromEntries(Object.entries(scope).map(([key, selection]) => [key, selection === true ? records[key]
    : records[key].filter(record => selection.includes(recordId(key, record)))]));
}

export function workspaceMutationResponse(db, domain, req, operation) {
  const run = db.transaction(() => {
    const scope = collectScope(db, domain, req);
    const before = project(db, scope);
    const result = operation(db, req);
    collectScope(db, domain, req, result, scope);
    const after = project(db, scope);
    const delta = {};
    const acknowledgedIds = new Set([req.params.id, req.params.contactId, result?.id, result?.jobId, result?.job?.id,
      ...(domain === "jobs" && Array.isArray(req.body?.jobs) ? req.body.jobs.map(job => job.id) : [])].filter(Boolean));
    for (const [key, selection] of Object.entries(scope)) {
      if (selection === true) {
        delta[key] = after[key];
        continue;
      }
      const old = new Map((before[key] || []).map(record => [recordId(key, record), JSON.stringify(record)]));
      const currentIds = new Set(after[key].map(record => recordId(key, record)));
      // Always acknowledge explicitly requested records, even for idempotent writes.
      const upsert = after[key].filter(record => acknowledgedIds.has(recordId(key, record))
        || old.get(recordId(key, record)) !== JSON.stringify(record));
      const removeIds = selection.filter(id => !currentIds.has(id));
      if (upsert.length || removeIds.length) delta[key] = { upsert, removeIds };
    }
    if (req.user?.role === "technician") {
      for (const key of Object.keys(delta)) if (key !== "jobs") delete delta[key];
    }
    return { ok: true, result, delta };
  });
  return req.method === "GET" ? run() : run.immediate();
}
