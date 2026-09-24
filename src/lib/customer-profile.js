import { siteAddressMetadata, updatedSiteAddressMetadata } from "./site-location.js";

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const addressKey = (value) => clean(value).toLowerCase();

export function customerPostalFields(customer) {
  const address = clean(customer?.address);
  const postalAddress = clean(customer?.postalAddress);
  const same = customer?.postalAddressSameAsPrimary ?? (!postalAddress || addressKey(postalAddress) === addressKey(address));
  return { postalAddressSameAsPrimary: same === true, postalAddress: same === true ? address : postalAddress };
}

// Apply only the edited primary-site fields to the latest customer. Other sites,
// assets, contacts and imported metadata remain owned by their existing records.
export function applyPrimarySiteUpdate(customer, patch) {
  const invalid = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) invalid("Primary site is invalid.");
  if (patch.expectedAddress !== undefined && addressKey(patch.expectedAddress) !== addressKey(customer.address)) {
    invalid("The primary site changed since this form was opened. Refresh and try again.", 409);
  }
  const sites = customer.sites || [];
  const existing = sites.find((site) => addressKey(site.address) === addressKey(customer.address));
  if (patch.id && patch.id !== existing?.id) invalid("The primary site changed. Refresh and try again.", 409);
  const address = clean(patch.address ?? existing?.address);
  if (!address) invalid("Primary site address is required.");
  if (sites.some((site) => site.id !== existing?.id && addressKey(site.address) === addressKey(address))) {
    invalid("Another site already uses that address.", 409);
  }
  const now = new Date().toISOString();
  const site = {
    ...existing,
    ...updatedSiteAddressMetadata(existing, { address, ...siteAddressMetadata(patch) }),
    id: existing?.id || crypto.randomUUID(), address,
    siteType: patch.siteType ?? existing?.siteType ?? "",
    ocNumber: patch.ocNumber ?? existing?.ocNumber ?? "",
    _inferredProfile: false, createdAt: existing?.createdAt || now, updatedAt: now,
  };
  return {
    ...customer, address,
    sites: existing ? sites.map((entry) => entry.id === existing.id ? site : entry) : [...sites, site],
    siteAccessNotes: (customer.siteAccessNotes || []).map((note) => addressKey(note.address) === addressKey(customer.address)
      ? { ...note, address, updatedAt: now } : note),
  };
}
