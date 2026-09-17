// Built-in optional modules. Enablement belongs to the shared workspace.
export const ADDONS = Object.freeze({
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

export function normalizeAddonState(source) {
  const values = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return Object.fromEntries(ADDON_LIST.map((addon) => [addon.key, values[addon.key] === undefined ? addon.defaultEnabled === true : values[addon.key] === true]));
}

export function isAddonEnabled(addons, key) {
  return Object.hasOwn(ADDONS, key) && normalizeAddonState(addons)[key] === true;
}
