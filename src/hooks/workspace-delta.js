const collectionKeys = new Set(["jobs", "customers", "contacts", "inventoryItems", "staff", "maintenancePlans", "deletedJobs", "deletedCustomers", "deletedInvoices"]);
const objectKeys = new Set(["settings", "quoteTemplate", "invoiceTemplate"]);
const recordId = (key, record) => key === "deletedJobs" ? record.job.id
  : key === "deletedCustomers" ? record.customer.id : record.id;

// Use with a functional React setter. Only touched collections and records change
// identity, so a response cannot replace unrelated edits made while it was pending.
export function applyWorkspaceDelta(state, delta, normalizeRecord = (_key, record) => record) {
  const next = { ...state };
  for (const [key, change] of Object.entries(delta || {})) {
    if (objectKeys.has(key)) { next[key] = change; continue; }
    if (!collectionKeys.has(key)) continue;
    const removed = new Set(change.removeIds || []);
    const updates = new Map((change.upsert || []).map(record => [recordId(key, record), normalizeRecord(key, record)]));
    const records = [];
    for (const record of state[key] || []) {
      const id = recordId(key, record);
      if (removed.has(id)) continue;
      records.push(updates.has(id) ? updates.get(id) : record);
      updates.delete(id);
    }
    next[key] = [...updates.values(), ...records];
  }
  return next;
}
