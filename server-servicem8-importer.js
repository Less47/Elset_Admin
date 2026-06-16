import crypto from "crypto";

const SERVICE_M8_API_BASE = "https://api.servicem8.com/api_1.0";
const SERVICE_M8_REQUEST_TIMEOUT_MS = 30000;
const SERVICE_M8_MAX_PAGES_PER_ENDPOINT = 250;
const SERVICE_M8_MAX_RETRIES = 2;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeLookupValue(value) {
  return cleanText(value).toLowerCase();
}

function getRecordUuid(record) {
  return cleanText(record?.uuid);
}

function toBoolean(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function isActiveRecord(record, includeInactive = false) {
  if (includeInactive) return true;
  if (!record || record.active === undefined || record.active === null || record.active === "") return true;
  return toBoolean(record.active);
}

function parseMoney(value, fallback = 0) {
  const normalized = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function toDateInputValue(value) {
  const text = cleanText(value);
  if (!text || text === "0000-00-00" || text === "0000-00-00 00:00:00") return "";

  const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : "";
}

function toIsoTimestamp(value, fallback = new Date().toISOString()) {
  const text = cleanText(value);
  if (!text || text === "0000-00-00" || text === "0000-00-00 00:00:00") return fallback;

  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toTimestamp(value) {
  const text = cleanText(value);
  if (!text || text === "0000-00-00" || text === "0000-00-00 00:00:00") return 0;
  const parsed = new Date(text.includes("T") ? text : text.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = Number.parseInt(response?.headers?.get("retry-after") || "", 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return 700 * (attempt + 1);
}

function getServiceM8ErrorMessage(payload, response, fallback) {
  if (payload && typeof payload === "object") {
    const message = cleanText(payload.message || payload.error || payload.error_description);
    if (message) return message;
  }

  const statusText = cleanText(response?.statusText);
  return statusText ? `${fallback}: ${statusText}` : fallback;
}

async function fetchServiceM8Response(url, apiKey) {
  let lastError = null;

  for (let attempt = 0; attempt <= SERVICE_M8_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SERVICE_M8_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        signal: controller.signal,
      });

      if (response.status !== 429 && response.status < 500) {
        return response;
      }

      if (attempt >= SERVICE_M8_MAX_RETRIES) {
        return response;
      }

      await wait(getRetryDelayMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt >= SERVICE_M8_MAX_RETRIES) {
        throw error;
      }
      await wait(700 * (attempt + 1));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("ServiceM8 request failed.");
}

async function fetchServiceM8Collection(apiKey, endpoint) {
  const records = [];
  let cursor = "-1";
  let pageCount = 0;

  while (cursor) {
    pageCount += 1;
    if (pageCount > SERVICE_M8_MAX_PAGES_PER_ENDPOINT) {
      throw new Error(`ServiceM8 ${endpoint.label} import stopped after ${SERVICE_M8_MAX_PAGES_PER_ENDPOINT} pages.`);
    }

    const url = new URL(`${SERVICE_M8_API_BASE}/${endpoint.path}`);
    url.searchParams.set("cursor", cursor);

    const response = await fetchServiceM8Response(url, apiKey);
    const responseText = await response.text();
    let payload = null;

    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = getServiceM8ErrorMessage(
        payload,
        response,
        `Unable to fetch ServiceM8 ${endpoint.label}`
      );
      throw new Error(message);
    }

    if (!Array.isArray(payload)) {
      throw new Error(`ServiceM8 ${endpoint.label} response was not a list.`);
    }

    records.push(...payload);
    cursor = cleanText(response.headers.get("x-next-cursor"));
  }

  return records;
}

function normalizeImportOptions(options = {}) {
  return {
    includeInactive: Boolean(options.includeInactive),
    includeContacts: options.includeContacts !== false,
    includeSchedules: options.includeSchedules !== false,
    includeJobMaterials: options.includeJobMaterials !== false,
    includeJobNotes: options.includeJobNotes !== false,
    includePayments: options.includePayments !== false,
  };
}

async function fetchServiceM8Snapshot(apiKey, importOptions) {
  const warnings = [];
  const normalizedApiKey = cleanText(apiKey);
  if (!normalizedApiKey) {
    throw new Error("Enter your ServiceM8 API key before importing.");
  }

  const snapshot = {
    clients: [],
    contacts: [],
    jobs: [],
    activities: [],
    materials: [],
    notes: [],
    payments: [],
    staff: [],
    warnings,
  };

  const endpoints = [
    { key: "clients", path: "company.json", label: "clients", required: true, enabled: true },
    { key: "jobs", path: "job.json", label: "jobs", required: true, enabled: true },
    { key: "contacts", path: "companycontact.json", label: "company contacts", enabled: importOptions.includeContacts },
    { key: "activities", path: "jobactivity.json", label: "job schedule activities", enabled: importOptions.includeSchedules },
    { key: "staff", path: "staff.json", label: "staff", enabled: importOptions.includeSchedules || importOptions.includeJobNotes },
    { key: "materials", path: "jobmaterial.json", label: "job materials", enabled: importOptions.includeJobMaterials },
    { key: "payments", path: "jobpayment.json", label: "job payments", enabled: importOptions.includePayments },
    { key: "notes", path: "note.json", label: "job notes", enabled: importOptions.includeJobNotes },
  ];

  for (const endpoint of endpoints) {
    if (!endpoint.enabled) continue;

    try {
      snapshot[endpoint.key] = await fetchServiceM8Collection(normalizedApiKey, endpoint);
    } catch (error) {
      if (endpoint.required) throw error;
      const message = error instanceof Error ? error.message : `Unable to fetch ServiceM8 ${endpoint.label}.`;
      warnings.push(`${endpoint.label} skipped: ${message}`);
      snapshot[endpoint.key] = [];
    }
  }

  return snapshot;
}

function groupBy(records, getKey) {
  return records.reduce((groups, record) => {
    const key = cleanText(getKey(record));
    if (!key) return groups;
    const current = groups.get(key) || [];
    current.push(record);
    groups.set(key, current);
    return groups;
  }, new Map());
}

function buildCompanyAddress(company) {
  const explicitAddress = cleanText(company?.address);
  if (explicitAddress) return explicitAddress;

  const street = cleanText(company?.address_street);
  const suburbLine = [
    cleanText(company?.address_city),
    cleanText(company?.address_state),
    cleanText(company?.address_postcode),
  ].filter(Boolean).join(" ");
  const country = cleanText(company?.address_country);

  return [street, suburbLine, country].filter(Boolean).join(", ");
}

function getCompanyParentUuid(company) {
  return cleanText(company?.parent_company_uuid);
}

function getContactName(contact) {
  return [cleanText(contact?.first), cleanText(contact?.last)].filter(Boolean).join(" ");
}

function getContactPhone(contact) {
  return cleanText(contact?.mobile || contact?.phone);
}

function selectPrimaryContact(contacts = []) {
  const activeContacts = contacts.filter((contact) => isActiveRecord(contact, false));
  return [...activeContacts].sort((a, b) => Number(toBoolean(b?.is_primary_contact)) - Number(toBoolean(a?.is_primary_contact)))[0] || null;
}

function getServiceM8Ref(record) {
  return record?.externalRefs?.serviceM8 && typeof record.externalRefs.serviceM8 === "object"
    ? record.externalRefs.serviceM8
    : {};
}

function getServiceM8CompanyUuids(customer) {
  const ref = getServiceM8Ref(customer);
  return [
    cleanText(ref.companyUuid),
    ...(Array.isArray(ref.siteUuids) ? ref.siteUuids.map(cleanText) : []),
  ].filter(Boolean);
}

function getServiceM8JobUuid(job) {
  const ref = getServiceM8Ref(job);
  return cleanText(ref.jobUuid);
}

function getCustomerLookupKey(customer) {
  return `${normalizeLookupValue(customer?.name)}|${normalizeLookupValue(customer?.address)}`;
}

function buildExistingCustomerMaps(existingData) {
  const byServiceM8Uuid = new Map();
  const byNameAddress = new Map();

  (existingData.customers || []).forEach((customer) => {
    getServiceM8CompanyUuids(customer).forEach((uuid) => byServiceM8Uuid.set(uuid, customer));
    const nameAddressKey = getCustomerLookupKey(customer);
    if (nameAddressKey !== "|") {
      byNameAddress.set(nameAddressKey, customer);
    }
  });

  return { byServiceM8Uuid, byNameAddress };
}

function buildExistingJobMaps(existingData) {
  const byServiceM8Uuid = new Map();

  (existingData.jobs || []).forEach((job) => {
    const jobUuid = getServiceM8JobUuid(job);
    if (jobUuid) byServiceM8Uuid.set(jobUuid, job);
  });

  return { byServiceM8Uuid };
}

function mergeServiceM8Refs(existingRefs = {}, incomingRefs = {}) {
  const existingServiceM8 = existingRefs.serviceM8 || {};
  const incomingServiceM8 = incomingRefs.serviceM8 || {};
  const siteUuids = [...new Set([
    ...(Array.isArray(existingServiceM8.siteUuids) ? existingServiceM8.siteUuids : []),
    ...(Array.isArray(incomingServiceM8.siteUuids) ? incomingServiceM8.siteUuids : []),
  ].map(cleanText).filter(Boolean))];

  return {
    ...existingRefs,
    ...incomingRefs,
    serviceM8: {
      ...existingServiceM8,
      ...incomingServiceM8,
      ...(siteUuids.length > 0 ? { siteUuids } : {}),
    },
  };
}

function mergeSiteRecord(existing, incoming, preferIncoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const pick = (key) => {
    const incomingValue = incoming[key];
    const existingValue = existing[key];
    return preferIncoming
      ? (incomingValue || existingValue || "")
      : (existingValue || incomingValue || "");
  };

  return {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id,
    label: pick("label"),
    address: incoming.address || existing.address,
    siteType: pick("siteType"),
    accessNotes: pick("accessNotes"),
    notes: pick("notes"),
    contactName: pick("contactName"),
    contactPhone: pick("contactPhone"),
    assets: Array.isArray(existing.assets) && existing.assets.length > 0 ? existing.assets : (incoming.assets || []),
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: preferIncoming ? (incoming.updatedAt || existing.updatedAt) : (existing.updatedAt || incoming.updatedAt),
  };
}

function mergeSites(existingSites = [], incomingSites = [], preferIncoming = false) {
  const siteMap = new Map();

  existingSites.forEach((site) => {
    const key = normalizeLookupValue(site?.address || site?.label || site?.id);
    if (key) siteMap.set(key, site);
  });

  incomingSites.forEach((site) => {
    const key = normalizeLookupValue(site?.address || site?.label || site?.id);
    if (!key) return;
    siteMap.set(key, mergeSiteRecord(siteMap.get(key), site, preferIncoming));
  });

  return [...siteMap.values()];
}

function mergeCustomerRecord(existing, incoming, preferIncoming) {
  if (!existing) return incoming;

  const pick = (key) => {
    const incomingValue = incoming[key];
    const existingValue = existing[key];
    return preferIncoming
      ? (incomingValue || existingValue || "")
      : (existingValue || incomingValue || "");
  };

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    name: pick("name"),
    email: pick("email"),
    phone: pick("phone"),
    customerType: pick("customerType"),
    address: pick("address"),
    sites: mergeSites(existing.sites, incoming.sites, preferIncoming),
    siteAccessNotes: Array.isArray(existing.siteAccessNotes) ? existing.siteAccessNotes : [],
    externalRefs: mergeServiceM8Refs(existing.externalRefs, incoming.externalRefs),
    createdAt: existing.createdAt || incoming.createdAt,
  };
}

function buildSiteDraft(company, contactsByCompanyUuid, importedAt, isPrimarySite = false) {
  const companyUuid = getRecordUuid(company);
  const contact = selectPrimaryContact(contactsByCompanyUuid.get(companyUuid) || []);
  const address = buildCompanyAddress(company);

  if (!address) return null;

  return {
    id: companyUuid ? `servicem8-site-${companyUuid}` : crypto.randomUUID(),
    label: isPrimarySite ? "Main site" : (cleanText(company?.name) || "ServiceM8 site"),
    address,
    siteType: "",
    accessNotes: "",
    notes: cleanText(company?.billing_attention)
      ? `Billing attention: ${cleanText(company.billing_attention)}`
      : "",
    contactName: getContactName(contact),
    contactPhone: getContactPhone(contact),
    assets: [],
    createdAt: toIsoTimestamp(company?.edit_date, importedAt),
    updatedAt: toIsoTimestamp(company?.edit_date, importedAt),
  };
}

function buildCustomerDraft(company, siteCompanies, contactsByCompanyUuid, existingCustomer, importedAt) {
  const companyUuid = getRecordUuid(company);
  const primaryContact = selectPrimaryContact(contactsByCompanyUuid.get(companyUuid) || []);
  const siteUuids = siteCompanies.map(getRecordUuid).filter(Boolean);
  const siteDrafts = [
    buildSiteDraft(company, contactsByCompanyUuid, importedAt, true),
    ...siteCompanies.map((siteCompany) => buildSiteDraft(siteCompany, contactsByCompanyUuid, importedAt, false)),
  ].filter(Boolean);
  const firstSiteAddress = siteDrafts[0]?.address || "";
  const companyAddress = buildCompanyAddress(company) || firstSiteAddress;

  return {
    id: existingCustomer?.id || (companyUuid ? `servicem8-company-${companyUuid}` : crypto.randomUUID()),
    name: cleanText(company?.name) || "Unnamed ServiceM8 customer",
    email: cleanText(company?.email || primaryContact?.email),
    phone: cleanText(company?.phone || getContactPhone(primaryContact)),
    customerType: toBoolean(company?.is_individual) ? "homeowner" : "business",
    address: companyAddress,
    sites: siteDrafts,
    siteAccessNotes: [],
    externalRefs: {
      serviceM8: {
        companyUuid,
        siteUuids,
        importedAt,
        editDate: cleanText(company?.edit_date),
      },
    },
    createdAt: existingCustomer?.createdAt || toIsoTimestamp(company?.edit_date, importedAt),
  };
}

function buildCustomerPlans(existingData, snapshot, importOptions, importedAt) {
  const warnings = [];
  const existingMaps = buildExistingCustomerMaps(existingData);
  const activeJobCompanyUuids = new Set(
    (snapshot.jobs || [])
      .filter((job) => isActiveRecord(job, importOptions.includeInactive))
      .map((job) => cleanText(job.company_uuid))
      .filter(Boolean)
  );
  const companies = (snapshot.clients || [])
    .filter((company) => {
      const uuid = getRecordUuid(company);
      return uuid && (isActiveRecord(company, importOptions.includeInactive) || activeJobCompanyUuids.has(uuid));
    });
  const companiesByUuid = new Map(companies.map((company) => [getRecordUuid(company), company]));
  const contactsByCompanyUuid = groupBy(
    (snapshot.contacts || []).filter((contact) => isActiveRecord(contact, importOptions.includeInactive)),
    (contact) => contact.company_uuid
  );
  const sitesByParentUuid = groupBy(
    companies.filter((company) => getCompanyParentUuid(company)),
    getCompanyParentUuid
  );
  const headCompanies = companies.filter((company) => {
    const parentUuid = getCompanyParentUuid(company);
    return !parentUuid || !companiesByUuid.has(parentUuid);
  });
  const plans = [];
  const serviceCompanyToCustomerId = new Map();
  const serviceCompanyToSiteAddress = new Map();

  headCompanies.forEach((company) => {
    const companyUuid = getRecordUuid(company);
    const siteCompanies = sitesByParentUuid.get(companyUuid) || [];
    const sourceMatch = [
      companyUuid,
      ...siteCompanies.map(getRecordUuid),
    ].filter(Boolean).map((uuid) => existingMaps.byServiceM8Uuid.get(uuid)).find(Boolean);
    const nameAddressKey = `${normalizeLookupValue(company?.name)}|${normalizeLookupValue(buildCompanyAddress(company))}`;
    const fallbackMatch = sourceMatch || existingMaps.byNameAddress.get(nameAddressKey);
    const matchKind = sourceMatch ? "source" : fallbackMatch ? "name-address" : "none";
    const draft = buildCustomerDraft(company, siteCompanies, contactsByCompanyUuid, fallbackMatch, importedAt);
    const record = fallbackMatch
      ? mergeCustomerRecord(fallbackMatch, draft, matchKind === "source")
      : draft;

    [company, ...siteCompanies].forEach((serviceCompany) => {
      const serviceCompanyUuid = getRecordUuid(serviceCompany);
      if (!serviceCompanyUuid) return;
      serviceCompanyToCustomerId.set(serviceCompanyUuid, record.id);
      serviceCompanyToSiteAddress.set(serviceCompanyUuid, buildCompanyAddress(serviceCompany) || record.address);
    });

    plans.push({
      action: fallbackMatch ? "update" : "create",
      matchKind,
      serviceM8Uuid: companyUuid,
      name: record.name,
      siteCount: record.sites.length,
      record,
    });
  });

  const mappedCompanyUuids = new Set([...serviceCompanyToCustomerId.keys()]);
  companies.forEach((company) => {
    const companyUuid = getRecordUuid(company);
    if (!companyUuid || mappedCompanyUuids.has(companyUuid)) return;
    warnings.push(`ServiceM8 company ${cleanText(company.name) || companyUuid} could not be mapped to a customer.`);
  });

  return {
    plans,
    warnings,
    serviceCompanyToCustomerId,
    serviceCompanyToSiteAddress,
  };
}

function buildStaffMaps(existingData, snapshot, importOptions) {
  const serviceStaffByUuid = new Map(
    (snapshot.staff || [])
      .filter((staff) => isActiveRecord(staff, importOptions.includeInactive))
      .map((staff) => [getRecordUuid(staff), staff])
      .filter(([uuid]) => Boolean(uuid))
  );
  const appStaffByEmail = new Map();
  const appStaffByName = new Map();

  (existingData.staff || []).forEach((staff) => {
    const email = normalizeLookupValue(staff.email);
    const name = normalizeLookupValue(staff.name);
    if (email) appStaffByEmail.set(email, staff);
    if (name) appStaffByName.set(name, staff);
  });

  return { serviceStaffByUuid, appStaffByEmail, appStaffByName };
}

function getServiceStaffName(serviceStaff) {
  return [cleanText(serviceStaff?.first), cleanText(serviceStaff?.last)].filter(Boolean).join(" ");
}

function resolveAppStaff(serviceStaffUuid, staffMaps) {
  const serviceStaff = staffMaps.serviceStaffByUuid.get(cleanText(serviceStaffUuid));
  if (!serviceStaff) return null;

  const email = normalizeLookupValue(serviceStaff.email);
  const name = normalizeLookupValue(getServiceStaffName(serviceStaff));

  return (email && staffMaps.appStaffByEmail.get(email))
    || (name && staffMaps.appStaffByName.get(name))
    || null;
}

function chooseRepresentativeActivity(activities = []) {
  const scheduledActivities = activities
    .filter((activity) => isActiveRecord(activity, false) && toBoolean(activity.activity_was_scheduled))
    .sort((a, b) => toTimestamp(a.start_date) - toTimestamp(b.start_date));

  if (scheduledActivities.length === 0) return null;

  const now = Date.now();
  return scheduledActivities.find((activity) => toTimestamp(activity.start_date) >= now)
    || scheduledActivities[scheduledActivities.length - 1];
}

function mapServiceM8Status(job, activities = []) {
  const status = cleanText(job?.status).toLowerCase();

  if (status === "completed" || status === "unsuccessful" || toDateInputValue(job?.completion_date)) {
    return "Completed";
  }

  if (activities.some((activity) => isActiveRecord(activity, false) && toBoolean(activity.activity_was_recorded))) {
    return "In Progress";
  }

  return "To Do";
}

function buildJobTitle(job) {
  const description = cleanMultilineText(job?.job_description);
  const firstLine = description.split("\n").map(cleanText).find(Boolean);
  if (firstLine) return firstLine.slice(0, 110);

  const generatedJobId = cleanText(job?.generated_job_id);
  return generatedJobId ? `ServiceM8 job ${generatedJobId}` : "Imported ServiceM8 job";
}

function buildJobDescription(job) {
  const blocks = [];
  const jobDescription = cleanMultilineText(job?.job_description);
  const workDone = cleanMultilineText(job?.work_done_description);
  const metadata = [];

  if (jobDescription) blocks.push(jobDescription);
  if (workDone && workDone !== jobDescription) blocks.push(`Work completed:\n${workDone}`);

  if (cleanText(job?.generated_job_id)) metadata.push(`ServiceM8 job: ${cleanText(job.generated_job_id)}`);
  if (cleanText(job?.status)) metadata.push(`Original ServiceM8 status: ${cleanText(job.status)}`);
  if (cleanText(job?.purchase_order_number)) metadata.push(`Purchase order: ${cleanText(job.purchase_order_number)}`);
  if (cleanText(job?.billing_address)) metadata.push(`Billing address: ${cleanText(job.billing_address)}`);
  if (metadata.length > 0) blocks.push(metadata.join("\n"));

  return blocks.join("\n\n");
}

function buildDocumentItems(job, materials = []) {
  const activeMaterials = materials.filter((material) => isActiveRecord(material, false));
  const items = activeMaterials.map((material) => {
    const quantity = Math.max(parseMoney(material.quantity, 1), 0) || 1;
    const unitPrice = parseMoney(material.price, 0);
    const displayedAmount = parseMoney(material.displayed_amount, 0);
    const rate = unitPrice > 0 ? unitPrice : displayedAmount;

    return {
      id: getRecordUuid(material) ? `servicem8-material-${getRecordUuid(material)}` : crypto.randomUUID(),
      description: cleanText(material.name) || "ServiceM8 line item",
      qty: quantity,
      rate: roundMoney(rate),
    };
  });

  if (items.length === 0) {
    const totalInvoiceAmount = parseMoney(job?.total_invoice_amount, 0);
    if (totalInvoiceAmount > 0) {
      items.push({
        id: `servicem8-total-${getRecordUuid(job) || crypto.randomUUID()}`,
        description: "ServiceM8 imported invoice total",
        qty: 1,
        rate: roundMoney(totalInvoiceAmount),
      });
    }
  }

  return items;
}

function buildInvoicePayments(payments = [], staffMaps) {
  return payments
    .filter((payment) => isActiveRecord(payment, false) && parseMoney(payment.amount, 0) > 0)
    .map((payment) => {
      const actionedByStaff = resolveAppStaff(payment.actioned_by_uuid, staffMaps);
      return {
        id: getRecordUuid(payment) ? `servicem8-payment-${getRecordUuid(payment)}` : crypto.randomUUID(),
        amount: roundMoney(parseMoney(payment.amount, 0)),
        date: toDateInputValue(payment.timestamp || payment.edit_date) || new Date().toISOString().slice(0, 10),
        method: cleanText(payment.method),
        reference: getRecordUuid(payment),
        notes: [
          cleanText(payment.note),
          actionedByStaff?.name ? `Recorded by ${actionedByStaff.name}` : "",
          toBoolean(payment.is_deposit) ? "Marked as a ServiceM8 deposit." : "",
        ].filter(Boolean).join("\n"),
        createdAt: toIsoTimestamp(payment.timestamp || payment.edit_date),
      };
    });
}

function buildDocument(job, type, items, payments, staffMaps) {
  if (items.length === 0 && type !== "invoice") return null;

  const issueDate = type === "quote"
    ? (toDateInputValue(job?.quote_date || job?.date) || new Date().toISOString().slice(0, 10))
    : (toDateInputValue(job?.completion_date || job?.invoice_sent_stamp || job?.work_order_date || job?.date) || new Date().toISOString().slice(0, 10));
  const sentStamp = type === "quote" ? job?.quote_sent_stamp : job?.invoice_sent_stamp;
  const wasSent = type === "quote" ? toBoolean(job?.quote_sent) : toBoolean(job?.invoice_sent);
  const sentHistory = wasSent || sentStamp
    ? [{ sentAt: toIsoTimestamp(sentStamp || issueDate), to: "", subject: `Imported ServiceM8 ${type}` }]
    : [];

  if (type === "quote") {
    return {
      type: "quote",
      issueDate,
      notes: "",
      items,
      sentHistory,
    };
  }

  const invoicePayments = buildInvoicePayments(payments, staffMaps);
  if (items.length === 0 && invoicePayments.length === 0) return null;

  return {
    type: "invoice",
    issueDate,
    dueDate: issueDate,
    notes: cleanMultilineText(job?.work_done_description),
    items,
    sentHistory,
    payments: invoicePayments,
  };
}

function buildJobNotes(serviceNotes = [], staffMaps) {
  return serviceNotes
    .filter((note) => isActiveRecord(note, false) && cleanText(note.related_object).toLowerCase() === "job")
    .map((note) => {
      const authorStaff = resolveAppStaff(note.edit_by_staff_uuid || note.action_completed_by_staff_uuid, staffMaps);
      return {
        id: getRecordUuid(note) ? `servicem8-note-${getRecordUuid(note)}` : crypto.randomUUID(),
        author: authorStaff?.name || "ServiceM8",
        text: cleanMultilineText(note.note),
        createdAt: toIsoTimestamp(note.create_date || note.edit_date),
      };
    })
    .filter((note) => note.text);
}

function mergeJobNotes(existingNotes = [], incomingNotes = []) {
  const merged = [...existingNotes];
  const seen = new Set(
    existingNotes.map((note) => `${cleanText(note.id)}|${normalizeLookupValue(note.text)}|${cleanText(note.createdAt)}`)
  );

  incomingNotes.forEach((note) => {
    const key = `${cleanText(note.id)}|${normalizeLookupValue(note.text)}|${cleanText(note.createdAt)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(note);
  });

  return merged;
}

function mergeJobRecord(existing, incoming) {
  if (!existing) return incoming;

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    jobNumber: existing.jobNumber || incoming.jobNumber,
    notes: mergeJobNotes(existing.notes, incoming.notes),
    photos: Array.isArray(existing.photos) ? existing.photos : [],
    quote: incoming.quote || existing.quote,
    invoice: incoming.invoice || existing.invoice,
    externalRefs: mergeServiceM8Refs(existing.externalRefs, incoming.externalRefs),
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: incoming.updatedAt || existing.updatedAt,
  };
}

function createJobNumberAllocator(existingJobs = []) {
  const usedNumbers = new Set(
    existingJobs
      .map((job) => Number(job?.jobNumber))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
  let nextNumber = Math.max(0, ...usedNumbers) + 1;

  return (existingJob, generatedJobId) => {
    const existingJobNumber = Number(existingJob?.jobNumber);
    if (Number.isInteger(existingJobNumber) && existingJobNumber > 0) return existingJobNumber;

    const generatedText = cleanText(generatedJobId);
    const generatedNumber = /^\d+$/.test(generatedText) ? Number(generatedText) : 0;
    if (Number.isInteger(generatedNumber) && generatedNumber > 0 && !usedNumbers.has(generatedNumber)) {
      usedNumbers.add(generatedNumber);
      return generatedNumber;
    }

    while (usedNumbers.has(nextNumber)) nextNumber += 1;
    usedNumbers.add(nextNumber);
    const allocatedNumber = nextNumber;
    nextNumber += 1;
    return allocatedNumber;
  };
}

function buildJobDraft({
  job,
  customer,
  siteAddress,
  existingJob,
  activities,
  materials,
  notes,
  payments,
  staffMaps,
  allocateJobNumber,
  importedAt,
}) {
  const jobUuid = getRecordUuid(job);
  const representativeActivity = chooseRepresentativeActivity(activities);
  const assignedStaff = resolveAppStaff(representativeActivity?.staff_uuid || job?.created_by_staff_uuid, staffMaps);
  const serviceM8Status = cleanText(job?.status);
  const documentItems = buildDocumentItems(job, materials);
  const shouldBuildQuote = serviceM8Status.toLowerCase() === "quote" || toBoolean(job?.quote_sent) || Boolean(toDateInputValue(job?.quote_date));
  const shouldBuildInvoice = serviceM8Status.toLowerCase() === "completed"
    || toBoolean(job?.invoice_sent)
    || parseMoney(job?.total_invoice_amount, 0) > 0
    || payments.some((payment) => parseMoney(payment.amount, 0) > 0);

  return {
    id: existingJob?.id || (jobUuid ? `servicem8-job-${jobUuid}` : crypto.randomUUID()),
    jobNumber: allocateJobNumber(existingJob, job?.generated_job_id),
    title: buildJobTitle(job),
    description: buildJobDescription(job),
    urgency: "Medium",
    status: mapServiceM8Status(job, activities),
    scheduledDate: toDateInputValue(representativeActivity?.start_date || job?.date),
    assignedTechnicianId: assignedStaff?.id || "",
    assignedTechnicianName: assignedStaff?.name || "",
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    jobAddress: cleanText(job?.job_address) || siteAddress || customer.address,
    createdAt: toIsoTimestamp(job?.date || job?.edit_date, importedAt),
    updatedAt: toIsoTimestamp(job?.edit_date || job?.date, importedAt),
    notes: buildJobNotes(notes, staffMaps),
    photos: [],
    quote: shouldBuildQuote ? buildDocument(job, "quote", documentItems, [], staffMaps) : null,
    invoice: shouldBuildInvoice ? buildDocument(job, "invoice", documentItems, payments, staffMaps) : null,
    externalRefs: {
      serviceM8: {
        jobUuid,
        generatedJobId: cleanText(job?.generated_job_id),
        importedAt,
        editDate: cleanText(job?.edit_date),
      },
    },
  };
}

function buildJobPlans(existingData, snapshot, importOptions, customerContext, importedAt) {
  const warnings = [];
  const existingMaps = buildExistingJobMaps(existingData);
  const staffMaps = buildStaffMaps(existingData, snapshot, importOptions);
  const activitiesByJobUuid = groupBy(
    (snapshot.activities || []).filter((activity) => isActiveRecord(activity, importOptions.includeInactive)),
    (activity) => activity.job_uuid
  );
  const materialsByJobUuid = groupBy(
    (snapshot.materials || []).filter((material) => isActiveRecord(material, importOptions.includeInactive)),
    (material) => material.job_uuid
  );
  const notesByJobUuid = groupBy(
    (snapshot.notes || []).filter((note) => isActiveRecord(note, importOptions.includeInactive)),
    (note) => note.related_object_uuid
  );
  const paymentsByJobUuid = groupBy(
    (snapshot.payments || []).filter((payment) => isActiveRecord(payment, importOptions.includeInactive)),
    (payment) => payment.job_uuid
  );
  const customersById = new Map(customerContext.plans.map((plan) => [plan.record.id, plan.record]));
  const allocateJobNumber = createJobNumberAllocator(existingData.jobs || []);
  const plans = [];

  const jobs = (snapshot.jobs || [])
    .filter((job) => getRecordUuid(job) && isActiveRecord(job, importOptions.includeInactive))
    .sort((a, b) => toTimestamp(a.date || a.edit_date) - toTimestamp(b.date || b.edit_date));

  jobs.forEach((job) => {
    const jobUuid = getRecordUuid(job);
    const serviceCompanyUuid = cleanText(job.company_uuid);
    const customerId = customerContext.serviceCompanyToCustomerId.get(serviceCompanyUuid);
    const customer = customersById.get(customerId);

    if (!customer) {
      warnings.push(`ServiceM8 job ${cleanText(job.generated_job_id) || jobUuid} skipped because its customer could not be mapped.`);
      return;
    }

    const existingJob = existingMaps.byServiceM8Uuid.get(jobUuid);
    const draft = buildJobDraft({
      job,
      customer,
      siteAddress: customerContext.serviceCompanyToSiteAddress.get(serviceCompanyUuid),
      existingJob,
      activities: activitiesByJobUuid.get(jobUuid) || [],
      materials: materialsByJobUuid.get(jobUuid) || [],
      notes: notesByJobUuid.get(jobUuid) || [],
      payments: paymentsByJobUuid.get(jobUuid) || [],
      staffMaps,
      allocateJobNumber,
      importedAt,
    });

    plans.push({
      action: existingJob ? "update" : "create",
      serviceM8Uuid: jobUuid,
      generatedJobId: cleanText(job.generated_job_id),
      title: draft.title,
      customerName: draft.customerName,
      status: draft.status,
      record: existingJob ? mergeJobRecord(existingJob, draft) : draft,
    });
  });

  return { plans, warnings };
}

function countActions(plans) {
  return plans.reduce((counts, plan) => {
    counts[plan.action] = (counts[plan.action] || 0) + 1;
    return counts;
  }, { create: 0, update: 0 });
}

function buildPreviewSummary(snapshot, customerPlans, jobPlans, warnings) {
  const customerActionCounts = countActions(customerPlans);
  const jobActionCounts = countActions(jobPlans);

  return {
    fetched: {
      clients: snapshot.clients.length,
      companyContacts: snapshot.contacts.length,
      jobs: snapshot.jobs.length,
      jobActivities: snapshot.activities.length,
      jobMaterials: snapshot.materials.length,
      jobNotes: snapshot.notes.length,
      jobPayments: snapshot.payments.length,
      staff: snapshot.staff.length,
    },
    customers: {
      create: customerActionCounts.create,
      update: customerActionCounts.update,
      totalSites: customerPlans.reduce((total, plan) => total + plan.siteCount, 0),
    },
    jobs: {
      create: jobActionCounts.create,
      update: jobActionCounts.update,
    },
    documents: {
      quotes: jobPlans.filter((plan) => plan.record.quote).length,
      invoices: jobPlans.filter((plan) => plan.record.invoice).length,
      payments: jobPlans.reduce((total, plan) => total + (plan.record.invoice?.payments?.length || 0), 0),
      notes: jobPlans.reduce((total, plan) => total + (plan.record.notes?.length || 0), 0),
    },
    warnings,
    sampleCustomers: customerPlans.slice(0, 6).map((plan) => ({
      action: plan.action,
      name: plan.name,
      siteCount: plan.siteCount,
      matchKind: plan.matchKind,
    })),
    sampleJobs: jobPlans.slice(0, 6).map((plan) => ({
      action: plan.action,
      job: plan.generatedJobId || plan.title,
      title: plan.title,
      customerName: plan.customerName,
      status: plan.status,
    })),
  };
}

function buildPlan(existingData, snapshot, options) {
  const importedAt = new Date().toISOString();
  const importOptions = normalizeImportOptions(options);
  const customerContext = buildCustomerPlans(existingData, snapshot, importOptions, importedAt);
  const jobContext = buildJobPlans(existingData, snapshot, importOptions, customerContext, importedAt);
  const warnings = [
    ...snapshot.warnings,
    ...customerContext.warnings,
    ...jobContext.warnings,
  ];

  return {
    importedAt,
    options: importOptions,
    customers: customerContext.plans,
    jobs: jobContext.plans,
    summary: buildPreviewSummary(snapshot, customerContext.plans, jobContext.plans, warnings),
  };
}

export async function previewServiceM8Import({ apiKey, existingData, options }) {
  const importOptions = normalizeImportOptions(options);
  const snapshot = await fetchServiceM8Snapshot(apiKey, importOptions);
  return buildPlan(existingData, snapshot, importOptions);
}

export function applyServiceM8ImportPlan(existingData, plan) {
  const customersById = new Map((existingData.customers || []).map((customer) => [customer.id, customer]));
  const jobsById = new Map((existingData.jobs || []).map((job) => [job.id, job]));

  plan.customers.forEach((customerPlan) => {
    customersById.set(customerPlan.record.id, customerPlan.record);
  });
  plan.jobs.forEach((jobPlan) => {
    jobsById.set(jobPlan.record.id, jobPlan.record);
  });

  return {
    ...existingData,
    customers: [...customersById.values()],
    jobs: [...jobsById.values()],
  };
}

export async function buildAndApplyServiceM8Import({ apiKey, existingData, options }) {
  const plan = await previewServiceM8Import({ apiKey, existingData, options });
  return {
    plan,
    nextData: applyServiceM8ImportPlan(existingData, plan),
  };
}
