const text = (value) => String(value ?? "").trim();

export function contactRoles(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).map(text).filter(Boolean))];
}

export function isLegacyAccountContact(contact, customer) {
  return contact?.id === `${customer?.id}-primary-contact`
    && !text(contact.position) && !text(contact.notes)
    && /^(primary contact|account|)$/i.test(text(contact.role))
    && (!text(contact.name) || text(contact.name) === text(customer.name))
    && (!text(contact.email) || text(contact.email) === text(customer.email))
    && (!text(contact.phone) || text(contact.phone) === text(customer.phone));
}

export function getCustomerAccountContact(customer) {
  if (!customer || (!customer.email && !customer.phone)) return null;
  return { id: `${customer.id}-primary-contact`, name: customer.name || "Customer account", email: customer.email || "", phone: customer.phone || "", position: "", role: "Account", kind: "account", notes: "" };
}

function hydrate(assignments, records) {
  const byId = records instanceof Map ? records : new Map((records || []).map((contact) => [contact.id, contact]));
  return (assignments || []).flatMap((assignment) => {
    const contact = assignment.contact || byId.get(assignment.contactId);
    return contact ? [{ ...assignment, ...contact, roles: contactRoles(assignment.roles), isPrimary: Boolean(assignment.isPrimary), isBilling: Boolean(assignment.isBilling), role: contactRoles(assignment.roles).join(", ") }] : [];
  }).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id.localeCompare(b.id));
}

export function getCustomerDirectContacts(customer, contacts) {
  if (!customer) return [];
  if (Array.isArray(customer.contactAssignments)) return hydrate(customer.contactAssignments, contacts || customer.contacts);
  return (customer.contacts || []).filter((contact) => !contact.siteId && !isLegacyAccountContact(contact, customer));
}

export function getSiteContacts(site, contacts) {
  if (!site) return [];
  if (Array.isArray(site.contactAssignments)) return hydrate(site.contactAssignments, contacts || site.contacts);
  if (Array.isArray(site.contacts)) return site.contacts;
  if (!site.contactName && !site.contactPhone && !site.contactEmail) return [];
  return [{ id: site.contactId || `${site.id}-site-contact`, name: site.contactName || "", phone: site.contactPhone || "", email: site.contactEmail || "", role: "Site contact", roles: ["Site contact"], isPrimary: true }];
}

export function getSitePrimaryContact(site, contacts) {
  const records = getSiteContacts(site, contacts);
  return records.find((contact) => contact.isPrimary) || null;
}

export function getCustomerPrimaryContact(customer, contacts) {
  return getCustomerDirectContacts(customer, contacts).find((contact) => contact.isPrimary) || null;
}

export function getCustomerBillingContacts(customer, contacts) {
  const direct = getCustomerDirectContacts(customer, contacts);
  return direct.filter((contact) => contact.isBilling || (!Array.isArray(customer?.contactAssignments) && customer?.billingContactId && contact.id === customer.billingContactId));
}

export function getCustomerRelatedContacts(customer, contacts) {
  const related = new Map(getCustomerDirectContacts(customer, contacts).map((contact) => [contact.id, { ...contact, isDirect: true, sites: [] }]));
  for (const site of customer?.sites || []) {
    for (const contact of getSiteContacts(site, contacts)) {
      if (!related.has(contact.id)) related.set(contact.id, { ...contact, isDirect: false, isBilling: false, isPrimary: false, roles: [], sites: [] });
      related.get(contact.id).sites.push({ siteId: site.id, name: site.label || site.address, roles: contact.roles || [], isPrimary: Boolean(contact.isPrimary) });
    }
  }
  return [...related.values()].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.name || a.email || a.id).localeCompare(b.name || b.email || b.id));
}

export function getJobContactGroups(customer, site, purpose) {
  const direct = getCustomerDirectContacts(customer), siteContacts = getSiteContacts(site), billing = getCustomerBillingContacts(customer);
  const groups = purpose === "onsite"
    ? [{ label: "Site contacts", contacts: siteContacts }, { label: "Customer contacts", contacts: direct }]
    : purpose === "billing"
      ? [{ label: "Billing contacts", contacts: billing }, { label: "Other customer contacts", contacts: direct }, { label: "Site contacts", contacts: siteContacts }]
      : [{ label: "Customer contacts", contacts: direct }, { label: "Site contacts", contacts: siteContacts }];
  const account = getCustomerAccountContact(customer);
  if (account) groups.push({ label: "Customer account", contacts: [account] });
  const seen = new Set();
  return groups.map((group) => ({ ...group, contacts: group.contacts.filter((contact) => !seen.has(contact.id) && seen.add(contact.id)) })).filter((group) => group.contacts.length);
}
