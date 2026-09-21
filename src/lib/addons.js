// Built-in optional modules. Enablement belongs to the shared workspace.
export const ADDONS = Object.freeze({
  quickbooks: Object.freeze({
    key: "quickbooks", name: "QuickBooks Online", category: "Accounting",
    description: "Sync customers and issued invoices with QuickBooks Online. Receive invoice payments from QuickBooks.",
    includes: ["Manual invoice sync", "Incoming payment sync"],
    disableDescription: "QuickBooks controls and syncing will stop. The connection, configuration, mappings and history will be preserved. Use Disconnect to remove the connection.",
    defaultEnabled: false,
  }),
  xero: Object.freeze({
    key: "xero", name: "Xero", category: "Accounting",
    description: "Connect your jobs and invoices with Xero accounting. Sync customers and issued invoices from this workspace to Xero.",
    includes: ["Manual invoice sync", "Customers synced as needed"],
    disableDescription: "Xero controls and syncing will be disabled. The connection, configuration, mappings and history will be preserved. Use Disconnect to remove the connection.",
    defaultEnabled: false,
  }),
  jobCosting: Object.freeze({
    key: "jobCosting",
    name: "Job Costing",
    description: "Track materials, labour and other direct job costs. Compare actual costs against invoice revenue and see job-level gross profit and margin.",
    category: "Operations",
    includes: ["Cost entries", "Cost breakdown", "Gross profit", "Margin %", "Quote vs invoice comparison"],
    disableDescription: "Job Costing will be hidden from Jobs. Existing cost entries and historical costing data will be preserved.",
    defaultEnabled: false,
  }),
});

export const ADDON_LIST = Object.freeze(Object.values(ADDONS));
export const ACCOUNTING_PROVIDERS = Object.freeze(["xero", "quickbooks"]);
export const accountingProviderName = (id) => id === "quickbooks" ? "QuickBooks" : id === "xero" ? "Xero" : "Accounting";
export const activeAccountingProvider = (addons) => ACCOUNTING_PROVIDERS.find((id) => addons?.[id] === true) || "";

export function normalizeAddonState(source) {
  const values = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return Object.fromEntries(ADDON_LIST.map((addon) => [addon.key, values[addon.key] === undefined ? addon.defaultEnabled === true : values[addon.key] === true]));
}

export function isAddonEnabled(addons, key) {
  return Object.hasOwn(ADDONS, key) && normalizeAddonState(addons)[key] === true;
}
