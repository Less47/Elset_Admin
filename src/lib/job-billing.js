export const JOB_BILLING_TYPES = ["billable", "warranty"];
export const WARRANTY_REASON_MAX_LENGTH = 240;
export const WARRANTY_INVOICE_MESSAGE = "Warranty job — non-billable. Change Billing Type to Billable before creating an invoice.";
export const WARRANTY_EXISTING_INVOICE_MESSAGE = "This Job already has an invoice or accounting ownership. Resolve or remove the invoice and review its accounting mapping before marking the Job as Warranty.";
export const isWarrantyJob = job => job?.billingType === "warranty";

export function normalizeBillingType(value = "billable") {
  if (!JOB_BILLING_TYPES.includes(value)) throw Object.assign(new Error("Billing Type must be Billable or Warranty."), { statusCode: 400 });
  return value;
}

export function normalizeWarrantyReason(value = "") {
  if (typeof value !== "string" || value.trim().length > WARRANTY_REASON_MAX_LENGTH || [...value].some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  })) {
    throw Object.assign(new Error(`Warranty Reason must be text of ${WARRANTY_REASON_MAX_LENGTH} characters or fewer.`), { statusCode: 400 });
  }
  return value.trim();
}

export function matchesJobBillingFilter(job, filter = "all") {
  return filter === "all" || (job?.billingType || "billable") === filter;
}

export const warrantyBadgeClassName = "bg-billing-warranty-surface text-billing-warranty border-billing-warranty-border";
