import { formatStreetAndSuburb } from "./site-address.js";
import { normalizeMaintenanceFrequency } from "./maintenance-frequency.js";
import { isMaintenanceDate } from "./maintenance-recurrence.js";

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const addressKey = (value) => clean(value).toLowerCase();
const addressFields = ["streetAddress", "addressLine1", "suburb", "city", "locality"];

// Preserve optional structured components already supplied by a site/import.
// Normal ELSET sites currently store only `address`; no fields are invented.
export function structuredSiteAddress(site) {
  return Object.fromEntries(addressFields.filter((key) => site?.[key] != null).map((key) => [key, clean(site[key])]));
}

export function updatedStructuredSiteAddress(existing, input) {
  const previous = structuredSiteAddress(existing);
  const incoming = structuredSiteAddress(input);
  if (input?.address !== undefined && addressKey(input.address) !== addressKey(existing?.address)) {
    return { ...Object.fromEntries(Object.keys(previous).map((key) => [key, ""])), ...incoming };
  }
  return { ...previous, ...incoming };
}

function withoutRegion(value) {
  return clean(value)
    .replace(/(?:,\s*|\s+)(?:Australia|AU)$/i, "")
    .replace(/(?:,\s*|\s+)\b(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT|Victoria|New South Wales|Queensland|South Australia|Western Australia|Tasmania|Australian Capital Territory|Northern Territory)\b(?:\s+\d{4})?$/i, "")
    .replace(/(?:,\s*|\s+)\d{4}$/, "").replace(/,\s*$/, "").trim();
}

export function maintenancePlanName(site) {
  const street = clean(site?.streetAddress || site?.addressLine1);
  const suburb = withoutRegion(site?.suburb || site?.locality || site?.city);
  if (street && suburb) return `${street} ${suburb.toUpperCase()}`;
  const address = withoutRegion(site?.address || street || site?.label);
  if (!address) return "";
  const parts = address.split(",").map(clean).filter(Boolean);
  const locality = parts.at(-1);
  if (parts.length >= 2 && /^[\p{L}][\p{L}\s'’-]*$/u.test(locality)) {
    // Reuse the existing formatter for the ordinary street, suburb format.
    const formatted = parts.length === 2 ? formatStreetAndSuburb(address) : `${parts.slice(0, -1).join(", ")}, ${locality}`;
    const separator = formatted.lastIndexOf(", ");
    return `${formatted.slice(0, separator)} ${formatted.slice(separator + 2).toUpperCase()}`;
  }
  // Conservative support for old unpunctuated Australian addresses. If the
  // street boundary is uncertain, keep the useful address rather than guess.
  const match = address.match(/^(.+\b(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Place|Pl|Parade|Pde|Terrace|Tce|Boulevard|Blvd|Way|Close|Circuit|Cct)\.?)\s+([\p{L}][\p{L}\s'’-]*)$/iu);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : address;
}

export function maintenanceCustomerSites(customer) {
  return (customer?.sites || []).filter((site) => site.id && !site._inferredProfile && clean(site.address || site.streetAddress || site.addressLine1));
}

export function maintenancePlanSite(plan, customers) {
  const customer = customers.find((entry) => entry.id === plan?.customerId);
  const sites = maintenanceCustomerSites(customer);
  return plan?.siteId ? sites.find((site) => site.id === plan.siteId) || null
    : sites.find((site) => addressKey(site.address) === addressKey(plan?.siteAddress)) || null;
}

export function maintenancePlanIdentity(plan, customers) {
  const site = maintenancePlanSite(plan, customers);
  return { ...plan, siteId: site?.id || plan.siteId || "", siteAddress: site?.address || plan.siteAddress,
    planName: maintenancePlanName(site || { address: plan.siteAddress }) || plan.planName };
}

export function canonicalMaintenancePlanInput(input, existing, customers) {
  const source = { ...existing, ...input };
  const customer = customers.find((entry) => entry.id === source.customerId);
  const invalid = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
  if (!customer) invalid("Select a valid customer.", 404);
  const site = maintenanceCustomerSites(customer).find((entry) => entry.id === source.siteId);
  if (source.siteId && !site) invalid("Site does not belong to the selected customer or is no longer available.", 404);
  const legacyUnchanged = existing && !existing.siteId && !source.siteId
    && existing.customerId === source.customerId && addressKey(existing.siteAddress) === addressKey(source.siteAddress);
  if (!site && !legacyUnchanged) invalid("Select a valid site for this customer.");
  const identity = maintenancePlanIdentity(source, customers);
  if (!identity.planName || !clean(identity.siteAddress)) invalid("The selected site needs a valid address.");
  const frequency = normalizeMaintenanceFrequency(source.frequency, null);
  if (!frequency) invalid("Select a supported maintenance frequency.");
  if (!isMaintenanceDate(source.nextDueDate)) invalid("Next service date is invalid.");
  if (source.active !== undefined && typeof source.active !== "boolean") invalid("Plan status is invalid.");
  for (const [key, label] of [["estimatedDurationHours", "Estimated duration"], ["contractPrice", "Contract price"]]) {
    if (!Number.isFinite(Number(source[key] || 0)) || Number(source[key] || 0) < 0) invalid(`${label} must be a non-negative number.`);
  }
  return { ...source, ...identity, frequency };
}
