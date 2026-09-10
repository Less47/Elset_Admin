// Persisted recurrence keys stay compatible with existing plans and segments.
export const maintenanceFrequencyOptions = [
  { value: "monthly", label: "Monthly", intervalMonths: 1 },
  { value: "quarterly", label: "Quarterly", intervalMonths: 3 },
  { value: "six-monthly", label: "Biannually", intervalMonths: 6 },
  { value: "annual", label: "Annually", intervalMonths: 12 },
];

const aliases = {
  monthly: "monthly", month: "monthly", "1monthly": "monthly", "1month": "monthly", everymonth: "monthly",
  quarterly: "quarterly", quarter: "quarterly", "3monthly": "quarterly", "3months": "quarterly", every3months: "quarterly",
  sixmonthly: "six-monthly", "6monthly": "six-monthly", "6months": "six-monthly", every6months: "six-monthly", biannual: "six-monthly", biannually: "six-monthly", semiannual: "six-monthly", semiannually: "six-monthly",
  annual: "annual", annually: "annual", yearly: "annual", year: "annual", "1year": "annual", "12monthly": "annual", "12months": "annual", every12months: "annual", everyyear: "annual",
};

export function normalizeMaintenanceFrequency(value, fallback = "quarterly") {
  const key = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return Object.hasOwn(aliases, key) ? aliases[key] : fallback;
}

export function getMaintenanceFrequencyMeta(value) {
  return maintenanceFrequencyOptions.find((option) => option.value === normalizeMaintenanceFrequency(value));
}

export const frequencyMonths = Object.fromEntries(maintenanceFrequencyOptions.map((option) => [option.value, option.intervalMonths]));
