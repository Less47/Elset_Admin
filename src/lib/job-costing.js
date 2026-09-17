import { isQualifyingActualInvoice } from "./invoice-account.js";

export const COST_CATEGORIES = Object.freeze([
  { key: "materials", label: "Materials" },
  { key: "labour", label: "Labour" },
  { key: "subcontractors", label: "Subcontractors" },
  { key: "sundries", label: "Sundries" },
  { key: "plantEquipment", label: "Plant / Equipment" },
  { key: "travel", label: "Travel" },
  { key: "other", label: "Other" },
]);

const QUANTITY_SCALE = 1_000_000n;

function safeInteger(value, label, { signed = false } = {}) {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || (!signed && number < 0)) throw new Error(`${label} cannot be represented safely.`);
  return number;
}

function parseDecimal(value, digits, label) {
  if (!["number", "string"].includes(typeof value)) throw new Error(`${label} must be a valid number.`);
  const text = String(value).trim();
  if (text.length > 40) throw new Error(`${label} is too large.`);
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(text);
  if (!match) throw new Error(`${label} must be non-negative with at most ${digits} decimal places.`);
  return safeInteger(BigInt(match[1]) * (10n ** BigInt(digits)) + BigInt((match[2] || "").padEnd(digits, "0")), label);
}

export function parseQuantityMicros(value) {
  const micros = parseDecimal(value, 6, "Quantity");
  if (micros === 0) throw new Error("Quantity must be greater than zero.");
  return micros;
}

export function parseMoneyCents(value) {
  return parseDecimal(value, 2, "Unit cost");
}

export function formatCostQuantity(micros) {
  const value = BigInt(safeInteger(micros, "Quantity"));
  const whole = value / QUANTITY_SCALE;
  const fraction = String(value % QUANTITY_SCALE).padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function costTotalCents(quantity, unitCostCents) {
  const micros = BigInt(parseQuantityMicros(quantity));
  const cents = BigInt(safeInteger(unitCostCents, "Unit cost"));
  // Round each line half-up to cents, matching invoice line arithmetic.
  return safeInteger((micros * cents + QUANTITY_SCALE / 2n) / QUANTITY_SCALE, "Cost total");
}

function sumCents(values, label) {
  return safeInteger(values.reduce((total, value) => total + BigInt(safeInteger(value, label)), 0n), label);
}

function percentage(numerator, denominator) {
  if (!denominator) return null;
  const raw = BigInt(numerator) * 1000n;
  const divisor = BigInt(denominator);
  const rounded = raw >= 0n ? (raw + divisor / 2n) / divisor : (raw - divisor / 2n) / divisor;
  return Number(rounded) / 10;
}

// Invoice projections come from authoritative invoice/payment rows, never Job prices.
// Read every qualifying invoice for the selected job and deduplicate by document ID.
export function summarizeJobCosting({ jobId, invoices = [], quotes = [], entries = [] }) {
  const seen = new Set();
  const qualifying = invoices.filter((invoice) => {
    if (invoice.jobId !== jobId || !isQualifyingActualInvoice(invoice) || seen.has(invoice.invoiceId)) return false;
    seen.add(invoice.invoiceId);
    return true;
  });
  const jobQuotes = quotes.filter((quote) => quote.jobId === jobId);
  const jobEntries = entries.filter((entry) => entry.jobId === jobId);
  const revenueCents = sumCents(qualifying.map((invoice) => invoice.subtotalCents), "Revenue");
  const quotedCents = sumCents(jobQuotes.map((quote) => quote.subtotalCents), "Quoted value");
  const totalCostCents = sumCents(jobEntries.map((entry) => entry.totalCostCents), "Total costs");
  const grossProfitCents = safeInteger(BigInt(revenueCents) - BigInt(totalCostCents), "Gross profit", { signed: true });
  return {
    jobId, revenueCents, quotedCents, invoicedCents: revenueCents,
    paidCents: sumCents(qualifying.map((invoice) => invoice.paidCents), "Paid amount"),
    outstandingCents: sumCents(qualifying.map((invoice) => invoice.balanceCents), "Outstanding amount"),
    totalCostCents, grossProfitCents, marginPercent: percentage(grossProfitCents, revenueCents),
    quoteCount: jobQuotes.length, invoiceCount: qualifying.length,
    varianceCents: jobQuotes.length ? revenueCents - quotedCents : null,
    categories: COST_CATEGORIES.map((category) => {
      const cents = sumCents(jobEntries.filter((entry) => entry.category === category.key).map((entry) => entry.totalCostCents), "Category total");
      return { ...category, totalCostCents: cents, percent: percentage(cents, totalCostCents) ?? 0 };
    }),
    entries: jobEntries,
  };
}
