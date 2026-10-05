// Stable source keys are independent of display text and shared by both runtimes.
export const STANDARD_MAINTENANCE_CHECKLIST = Object.freeze([
  ["system-condition", "Inspect overall system condition"],
  ["movement-operation", "Check gate/door movement and operation"],
  ["mechanical-components", "Inspect hinges, rollers and mechanical components"],
  ["motor-drive", "Check motor/drive system"],
  ["safety-devices", "Check safety devices"],
  ["safety-beams", "Test photocells / safety beams"],
  ["electrical-controls", "Check control equipment and electrical connections"],
  ["backup-power", "Check backup battery / power system"],
  ["contamination", "Inspect for insects, moisture and contamination"],
  ["clean-equipment", "Clean equipment and work area"],
].map(([key, text], index) => Object.freeze({ key: `standard-${key}`, text, standard: true, position: index + 1 })));

export const MAINTENANCE_RESULTS = Object.freeze({ completed: "Completed", defect: "Defect", na: "N/A" });
export const MAINTENANCE_SEVERITIES = Object.freeze({ advisory: "Advisory", action_required: "Action required", urgent: "Urgent" });
export const MAINTENANCE_ACKNOWLEDGEMENTS = Object.freeze({ signed: "Customer signed", unavailable: "Customer unavailable", declined: "Customer declined signature" });

export function maintenanceChecklistTemplate(items = [], planId = "plan") {
  const source = Array.isArray(items) ? items : String(items || "").split(/\r?\n/);
  const standardKeys = new Set(STANDARD_MAINTENANCE_CHECKLIST.map(item => item.key));
  const custom = source.map((item, index) => typeof item === "string"
    ? { id: `${planId}:checklist:${index + 1}`, text: item }
    : { ...item }).filter(item => String(item.text || "").trim() && !standardKeys.has(item.key));
  return [
    ...STANDARD_MAINTENANCE_CHECKLIST.map(item => ({ ...item, id: `${planId}:${item.key}` })),
    ...custom.map((item, index) => ({ ...item, text: String(item.text).trim(), standard: false,
      id: item.id || `${planId}:checklist:${index + 1}`, key: item.key || item.id || `${planId}:checklist:${index + 1}`,
      position: STANDARD_MAINTENANCE_CHECKLIST.length + index + 1 })),
  ];
}

export function maintenanceReportCounts(report) {
  const items = report?.items || [];
  return { total: items.length, completed: items.filter(item => item.result === "completed").length,
    defects: items.filter(item => item.result === "defect").length, na: items.filter(item => item.result === "na").length,
    unanswered: items.filter(item => !item.result).length };
}
