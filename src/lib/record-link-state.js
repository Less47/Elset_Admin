// Carry the visible record's return label and originating section in Router state.
// No routing, history, or navigation takes place here.
export function recordLinkState(location, match, jobs = []) {
  const handle = match.handle || {};
  const section = handle.record ? location.state?.sourceSection || handle.section || "service-board"
    : handle.section || location.state?.section || "service-board";
  const label = typeof handle.label === "function" ? handle.label(match.params, jobs) : handle.label;
  return {
    sourceSection: section,
    returnTo: { path: location.pathname + location.search, label: label || sectionLabels[section] || "Service Board" },
  };
}

const sectionLabels = {
  "service-board": "Service Board", customers: "Customers", sites: "Sites", map: "Map", calendar: "Calendar",
  "job-history": "Job History", invoices: "Invoices", maintenance: "Maintenance", staff: "Staff",
  inventory: "Parts Inventory", statistics: "Reports & Analytics", settings: "Settings", "recycle-bin": "Recycle Bin",
};
