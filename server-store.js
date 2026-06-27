import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Buffer } from "buffer";
import { fileURLToPath } from "url";
import {
  ADMIN_EMAIL,
  calculateDocTotal,
  defaultInvoiceTemplate,
  defaultQuoteTemplate,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "./src/lib/quote-template.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(globalThis.process?.env?.ELSET_DATA_DIR || path.join(__dirname, "data"));
const DATA_FILE = path.join(DATA_DIR, "app-data.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const defaultSettings = {
  pageBackgroundStart: "#0F90CD",
  pageBackgroundEnd: "#0F90CD",
  sidebarSurface: "#FFFFFF",
  sidebarHeader: "#0F90CD",
  sidebarActive: "#F69320",
  heroSurface: "#0F90CD",
  actionColor: "#F69320",
  dialogSurface: "#F8FAFC",
  sidebarWidth: "standard",
  contentDensity: "comfortable",
  showHeroMetrics: true,
  showSectionDescriptions: true,
  showHeroEyebrow: true,
  companyName: "Elset",
  companyAbn: "",
  companyAcn: "",
  companyEmail: ADMIN_EMAIL,
  companyPhone: "",
  companyAddress: "",
  bankAccountName: "ELSET PTY LTD",
  bankBsb: "",
  bankAccountNumber: "",
  defaultSenderEmail: ADMIN_EMAIL,
  replyToEmail: ADMIN_EMAIL,
  quoteCcEmail: "",
  invoiceCcEmail: "",
  emailSignature: "Regards, ELSET PTY LD",
};

const defaultStaff = [
  {
    id: "tech-1",
    name: "Massimo",
    role: "Lead Technician",
    email: "massimo@elset.com.au",
    phone: "0400 555 111",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString(),
  },
  {
    id: "tech-2",
    name: "Domenic",
    role: "Service Technician",
    email: "domenic@elset.com.au",
    phone: "0400 555 222",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 72).toISOString(),
  },
];

const defaultCustomers = [
  {
    id: crypto.randomUUID(),
    name: "Northside Apartments",
    email: "manager@northside.com",
    phone: "0400 111 222",
    customerType: "strata",
    address: "14 Park View Rd, Northside",
    sites: [
      {
        id: crypto.randomUUID(),
        label: "Front Entry",
        address: "14 Park View Rd, Northside",
        siteType: "residential",
        accessNotes: "Call the building manager on arrival. Visitor parking is beside the front sliding gate.",
        notes: "Main resident entry with heavy daily traffic and visitor access.",
        contactName: "Building Manager",
        contactPhone: "0400 111 222",
        assets: [
          {
            id: crypto.randomUUID(),
            name: "Front sliding gate",
            type: "Sliding Gate",
            location: "Main driveway",
            model: "FAAC 844",
            notes: "Intercom release is linked to the apartment directory.",
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        label: "Basement Ramp",
        address: "18 Basement Ramp, Northside",
        siteType: "residential",
        accessNotes: "Use the basement intercom at the ramp entry. Height clearance is 2.1 m.",
        notes: "Separate service area used for basement access and after-hours contractor entry.",
        assets: [
          {
            id: crypto.randomUUID(),
            name: "Basement ramp entry",
            type: "Access Ramp",
            location: "Lower car park",
            model: "BFT control system",
            notes: "Best to test during quieter periods because of resident traffic.",
          },
        ],
      },
    ],
    siteAccessNotes: [
      {
        id: crypto.randomUUID(),
        address: "14 Park View Rd, Northside",
        notes: "Call the building manager on arrival. Visitor parking is beside the front sliding gate.",
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        address: "18 Basement Ramp, Northside",
        notes: "Use the basement intercom at the ramp entry. Height clearance is 2.1 m.",
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
  },
  {
    id: crypto.randomUUID(),
    name: "Apex Steel",
    email: "accounts@apexsteel.com",
    phone: "0400 333 444",
    customerType: "business",
    address: "82 Industrial Ave, Westfield",
    sites: [
      {
        id: crypto.randomUUID(),
        label: "Warehouse Entry",
        address: "82 Industrial Ave, Westfield",
        siteType: "industrial",
        accessNotes: "Check in with the front office before opening the gate. Avoid blocking the roller door during loading hours.",
        notes: "Primary truck and staff entry for the warehouse.",
        contactName: "Warehouse Supervisor",
        assets: [
          {
            id: crypto.randomUUID(),
            name: "Boom gate",
            type: "Boom Gate",
            location: "Front truck entrance",
            model: "Magnetic barrier arm",
            notes: "Shared lane with forklifts during dispatch windows.",
          },
          {
            id: crypto.randomUUID(),
            name: "Pedestrian access control",
            type: "Access Control",
            location: "Front office side gate",
            model: "Keypad + intercom",
            notes: "Often paired with delivery-driver access requests.",
          },
        ],
      },
    ],
    siteAccessNotes: [
      {
        id: crypto.randomUUID(),
        address: "82 Industrial Ave, Westfield",
        notes: "Check in with the front office before opening the gate. Avoid blocking the roller door during loading hours.",
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString(),
  },
];

const inventoryCategories = ["Automation", "Access Control", "Electrical", "Hardware", "Consumables", "Tools", "Other"];
const maintenanceFrequencyValues = ["monthly", "quarterly", "six-monthly", "annual"];
const userRoleValues = ["admin", "office", "technician"];
const customerTypeValues = ["homeowner", "strata", "property-manager", "builder", "business", "government", "other"];
const siteTypeValues = ["residential", "commercial", "industrial", "mixed-use", "other"];

const defaultInventoryItems = [
  {
    id: crypto.randomUUID(),
    name: "Gate remote",
    sku: "REMOTE-ELSET",
    category: "Access Control",
    supplier: "",
    location: "Service van",
    quantity: 12,
    reorderLevel: 5,
    unitCost: 38,
    notes: "",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
  {
    id: crypto.randomUUID(),
    name: "12V backup battery",
    sku: "BAT-12V",
    category: "Electrical",
    supplier: "",
    location: "Workshop shelf",
    quantity: 3,
    reorderLevel: 4,
    unitCost: 42,
    notes: "Used for common battery backup replacements.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
];

const defaultMaintenancePlans = [
  {
    id: crypto.randomUUID(),
    planName: "Entry boom gate preventive service",
    customerId: defaultCustomers[1].id,
    siteAddress: defaultCustomers[1].address,
    frequency: "quarterly",
    nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString().slice(0, 10),
    defaultTechnicianId: defaultStaff[1].id,
    estimatedDurationHours: 2,
    contractPrice: 295,
    checklist: [
      "Test safety loops and obstacle detection",
      "Inspect boom arm fixings and cabinet hardware",
      "Check battery backup and charger output",
    ],
    notes: "Coordinate access with the warehouse supervisor before arrival.",
    lastGeneratedAt: "",
    lastGeneratedJobId: "",
    lastCompletedAt: "",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
  },
  {
    id: crypto.randomUUID(),
    planName: "Sliding gate safety inspection",
    customerId: defaultCustomers[0].id,
    siteAddress: "18 Basement Ramp, Northside",
    frequency: "six-monthly",
    nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 24).toISOString().slice(0, 10),
    defaultTechnicianId: defaultStaff[0].id,
    estimatedDurationHours: 1.5,
    contractPrice: 220,
    checklist: [
      "Test gate travel and force settings",
      "Inspect track, rollers, and hinges",
      "Confirm remote controls and intercom release",
    ],
    notes: "",
    lastGeneratedAt: "",
    lastGeneratedJobId: "",
    lastCompletedAt: "",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 18).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
  },
];

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSiteAddress(address) {
  return String(address || "").replace(/\s+/g, " ").trim();
}

function normalizeEnumValue(value, values, fallback = "") {
  return values.includes(value) ? value : fallback;
}

function toDateInputValue(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateInput(value, days) {
  const normalized = toDateInputValue(value);
  const date = normalized ? new Date(`${normalized}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string" || !storedHash.includes(":")) return false;
  const [salt, expectedHash] = storedHash.split(":");
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function normalizeSiteAccessNoteRecord(note) {
  if (!note) return null;
  const address = normalizeSiteAddress(note.address);
  if (!address) return null;

  return {
    id: note.id || crypto.randomUUID(),
    address,
    notes: String(note.notes || "").trim(),
    updatedAt: note.updatedAt || note.createdAt || new Date().toISOString(),
  };
}

function normalizeSiteAccessNotes(notes) {
  if (!Array.isArray(notes)) return [];

  const noteMap = new Map();

  notes
    .map(normalizeSiteAccessNoteRecord)
    .filter(Boolean)
    .forEach((note) => {
      const key = note.address.toLowerCase();
      const existing = noteMap.get(key);

      if (!existing) {
        noteMap.set(key, note);
        return;
      }

      const noteTime = Date.parse(note.updatedAt || "") || 0;
      const existingTime = Date.parse(existing.updatedAt || "") || 0;
      const latest = noteTime >= existingTime ? note : existing;
      noteMap.set(key, {
        ...latest,
        notes: latest.notes,
      });
    });

  return [...noteMap.values()].sort((a, b) => a.address.localeCompare(b.address));
}

function normalizeSiteAssetRecord(asset) {
  if (!asset) return null;

  return {
    id: asset.id || crypto.randomUUID(),
    name: String(asset.name || "").trim() || "Unnamed gate / project",
    type: String(asset.type || "").trim(),
    location: String(asset.location || "").trim(),
    model: String(asset.model || "").trim(),
    notes: String(asset.notes || "").trim(),
    updatedAt: asset.updatedAt || asset.createdAt || new Date().toISOString(),
  };
}

function normalizeSiteAssets(assets) {
  if (!Array.isArray(assets)) return [];

  return assets
    .map(normalizeSiteAssetRecord)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

function normalizeSiteProfileRecord(site, fallbackAddress = "", legacyAccessNote = null) {
  const address = normalizeSiteAddress(site?.address || fallbackAddress || legacyAccessNote?.address);
  if (!address) return null;

  return {
    id: site?.id || crypto.randomUUID(),
    label: String(site?.label || "").trim(),
    address,
    siteType: normalizeEnumValue(site?.siteType, siteTypeValues, ""),
    ocNumber: String(site?.ocNumber || "").trim(),
    accessNotes: String(site?.accessNotes ?? legacyAccessNote?.notes ?? "").trim(),
    notes: String(site?.notes || "").trim(),
    contactName: String(site?.contactName || "").trim(),
    contactPhone: String(site?.contactPhone || "").trim(),
    assets: normalizeSiteAssets(site?.assets),
    createdAt: site?.createdAt || legacyAccessNote?.updatedAt || new Date().toISOString(),
    updatedAt: site?.updatedAt || legacyAccessNote?.updatedAt || site?.createdAt || new Date().toISOString(),
  };
}

function mergeSiteProfileRecords(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const mergeOptions = arguments[2] || {};
  const hasExplicitField = (key) => Boolean(mergeOptions[key]);

  return normalizeSiteProfileRecord({
    id: existing.id || incoming.id,
    label: hasExplicitField("label") ? incoming.label : existing.label,
    address: incoming.address || existing.address,
    siteType: hasExplicitField("siteType") ? incoming.siteType : existing.siteType,
    ocNumber: hasExplicitField("ocNumber") ? incoming.ocNumber : existing.ocNumber,
    accessNotes: hasExplicitField("accessNotes") ? incoming.accessNotes : existing.accessNotes,
    notes: hasExplicitField("notes") ? incoming.notes : existing.notes,
    contactName: hasExplicitField("contactName") ? incoming.contactName : existing.contactName,
    contactPhone: hasExplicitField("contactPhone") ? incoming.contactPhone : existing.contactPhone,
    assets: hasExplicitField("assets") ? incoming.assets : existing.assets,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt:
      hasExplicitField("updatedAt") && (Date.parse(incoming.updatedAt || "") || 0) >= (Date.parse(existing.updatedAt || "") || 0)
        ? incoming.updatedAt || existing.updatedAt
        : existing.updatedAt,
  });
}

function normalizeCustomerSiteProfiles(sites, primaryAddress = "", legacySiteAccessNotes = []) {
  const siteMap = new Map();
  const hasOwn = (value, key) => Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

  const addSiteProfile = (site, fallbackAddress = "", legacyAccessNote = null) => {
    const normalizedSite = normalizeSiteProfileRecord(site, fallbackAddress, legacyAccessNote);
    if (!normalizedSite) return;

    const key = normalizedSite.address.toLowerCase();
    const existing = siteMap.get(key);
    siteMap.set(
      key,
      existing
        ? mergeSiteProfileRecords(existing, normalizedSite, {
            label: hasOwn(site, "label"),
            siteType: hasOwn(site, "siteType"),
            ocNumber: hasOwn(site, "ocNumber"),
            accessNotes: hasOwn(site, "accessNotes"),
            notes: hasOwn(site, "notes"),
            contactName: hasOwn(site, "contactName"),
            contactPhone: hasOwn(site, "contactPhone"),
            assets: hasOwn(site, "assets"),
            updatedAt: hasOwn(site, "updatedAt") || hasOwn(site, "createdAt") || hasOwn(legacyAccessNote, "updatedAt"),
          })
        : normalizedSite
    );
  };

  if (Array.isArray(sites)) {
    sites.forEach((site) => addSiteProfile(site));
  }

  const normalizedPrimaryAddress = normalizeSiteAddress(primaryAddress);
  if (normalizedPrimaryAddress) {
    addSiteProfile({ address: normalizedPrimaryAddress }, normalizedPrimaryAddress);
  }

  normalizeSiteAccessNotes(legacySiteAccessNotes).forEach((siteAccessNote) => {
    addSiteProfile(
      {
        address: siteAccessNote.address,
        accessNotes: siteAccessNote.notes,
        updatedAt: siteAccessNote.updatedAt,
      },
      siteAccessNote.address,
      siteAccessNote
    );
  });

  return [...siteMap.values()].sort((a, b) => {
    const aPrimary = normalizedPrimaryAddress && a.address.toLowerCase() === normalizedPrimaryAddress.toLowerCase();
    const bPrimary = normalizedPrimaryAddress && b.address.toLowerCase() === normalizedPrimaryAddress.toLowerCase();
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return a.address.localeCompare(b.address);
  });
}

function normalizeStaffRecord(staffMember) {
  if (!staffMember) return null;
  return {
    id: staffMember.id || crypto.randomUUID(),
    name: staffMember.name || "Unnamed staff member",
    role: staffMember.role || "Staff",
    email: staffMember.email || "",
    phone: staffMember.phone || "",
    createdAt: staffMember.createdAt || new Date().toISOString(),
  };
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeUserRole(role) {
  return userRoleValues.includes(role) ? role : "technician";
}

function normalizeExternalRefs(refs) {
  const serviceM8 = refs?.serviceM8;
  if (!serviceM8 || typeof serviceM8 !== "object") return {};

  const normalizedServiceM8 = {};
  const stringKeys = [
    "companyUuid",
    "jobUuid",
    "generatedJobId",
    "importedAt",
    "editDate",
  ];

  stringKeys.forEach((key) => {
    const value = String(serviceM8[key] || "").trim();
    if (value) {
      normalizedServiceM8[key] = value;
    }
  });

  if (Array.isArray(serviceM8.siteUuids)) {
    const siteUuids = [...new Set(
      serviceM8.siteUuids
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
    if (siteUuids.length > 0) {
      normalizedServiceM8.siteUuids = siteUuids;
    }
  }

  return Object.keys(normalizedServiceM8).length > 0
    ? { serviceM8: normalizedServiceM8 }
    : {};
}

function normalizeCustomerRecord(customer) {
  if (!customer) return null;
  const address = normalizeSiteAddress(customer.address);
  const sites = normalizeCustomerSiteProfiles(customer.sites, address, customer.siteAccessNotes);
  const siteAccessNotes = normalizeSiteAccessNotes([
    ...(Array.isArray(customer.siteAccessNotes) ? customer.siteAccessNotes : []),
    ...sites
      .filter((site) => site.accessNotes)
      .map((site) => ({
        id: site.id,
        address: site.address,
        notes: site.accessNotes,
        updatedAt: site.updatedAt,
      })),
  ]);

  return {
    id: customer.id || crypto.randomUUID(),
    name: String(customer.name || "").trim() || "Unnamed customer",
    email: String(customer.email || "").trim(),
    phone: String(customer.phone || "").trim(),
    customerType: normalizeEnumValue(customer.customerType, customerTypeValues, ""),
    address,
    sites,
    siteAccessNotes,
    externalRefs: normalizeExternalRefs(customer.externalRefs),
    createdAt: customer.createdAt || new Date().toISOString(),
  };
}

function normalizeInventoryRecord(item) {
  if (!item) return null;
  return {
    id: item.id || crypto.randomUUID(),
    name: String(item.name || "").trim() || "Unnamed part",
    sku: String(item.sku || "").trim(),
    category: inventoryCategories.includes(item.category) ? item.category : "Other",
    supplier: String(item.supplier || "").trim(),
    location: String(item.location || "").trim(),
    quantity: Math.max(0, normalizeNumber(item.quantity, 0)),
    reorderLevel: Math.max(0, normalizeNumber(item.reorderLevel, 0)),
    unitCost: Math.max(0, normalizeNumber(item.unitCost, 0)),
    notes: String(item.notes || "").trim(),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
  };
}

function normalizeNote(note) {
  if (!note) return null;
  return {
    id: note.id || crypto.randomUUID(),
    author: note.author || "Staff",
    text: note.text || "",
    createdAt: note.createdAt || new Date().toISOString(),
  };
}

function normalizePhoto(photo) {
  if (!photo) return null;
  return {
    id: photo.id || crypto.randomUUID(),
    name: photo.name || "photo.jpg",
    url: photo.url || "",
  };
}

function normalizeChecklistItems(items) {
  if (Array.isArray(items)) {
    return items
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  return String(items || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMaintenancePlanRecord(plan) {
  if (!plan) return null;
  return {
    id: plan.id || crypto.randomUUID(),
    planName: String(plan.planName || "").trim() || "Untitled maintenance plan",
    customerId: String(plan.customerId || "").trim(),
    siteAddress: normalizeSiteAddress(plan.siteAddress),
    frequency: maintenanceFrequencyValues.includes(plan.frequency) ? plan.frequency : "quarterly",
    nextDueDate: toDateInputValue(plan.nextDueDate),
    defaultTechnicianId: String(plan.defaultTechnicianId || "").trim(),
    estimatedDurationHours: Math.max(0, normalizeNumber(plan.estimatedDurationHours, 0)),
    contractPrice: Math.max(0, normalizeNumber(plan.contractPrice, 0)),
    checklist: normalizeChecklistItems(plan.checklist),
    notes: String(plan.notes || "").trim(),
    lastGeneratedAt: plan.lastGeneratedAt || "",
    lastGeneratedJobId: String(plan.lastGeneratedJobId || "").trim(),
    lastCompletedAt: plan.lastCompletedAt || "",
    createdAt: plan.createdAt || new Date().toISOString(),
    updatedAt: plan.updatedAt || plan.createdAt || new Date().toISOString(),
  };
}

function normalizePaymentAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
}

function getPaymentSortValue(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeInvoicePaymentRecord(payment) {
  if (!payment) return null;

  return {
    id: payment.id || crypto.randomUUID(),
    amount: normalizePaymentAmount(payment.amount),
    date: toDateInputValue(payment.date || payment.paidAt || payment.createdAt),
    method: String(payment.method || "").trim(),
    reference: String(payment.reference || "").trim(),
    notes: String(payment.notes || "").trim(),
    createdAt: payment.createdAt || new Date().toISOString(),
  };
}

function normalizeInvoicePayments(document, invoiceTotal, fallbackDate) {
  const explicitPayments = Array.isArray(document?.payments)
    ? document.payments
        .map(normalizeInvoicePaymentRecord)
        .filter((payment) => payment && payment.amount > 0)
    : [];

  if (explicitPayments.length > 0) {
    return explicitPayments.sort(
      (a, b) => getPaymentSortValue(a.date || a.createdAt) - getPaymentSortValue(b.date || b.createdAt)
    );
  }

  if ((document?.paymentStatus === "Paid" || document?.paymentStatus === "paid") && invoiceTotal > 0) {
    const legacyPayment = normalizeInvoicePaymentRecord({
      id: "legacy-paid-payment",
      amount: invoiceTotal,
      date: document.paidAt || fallbackDate,
      notes: document.paymentNotes || "",
    });

    return legacyPayment ? [legacyPayment] : [];
  }

  return [];
}

function normalizeDocumentRecord(document, fallbackType) {
  if (!document) return null;
  const baseDocument = {
    type: document.type || fallbackType,
    issueDate: toDateInputValue(document.issueDate) || new Date().toISOString().slice(0, 10),
    notes: document.notes || "",
    items: Array.isArray(document.items) ? document.items : [],
    sentHistory: Array.isArray(document.sentHistory) ? document.sentHistory : [],
  };

  if (fallbackType !== "invoice" && document.type !== "invoice") return baseDocument;

  const invoiceTotal = calculateDocTotal(baseDocument.items);
  const dueDate = toDateInputValue(document.dueDate) || addDaysToDateInput(baseDocument.issueDate, 7);
  return {
    ...baseDocument,
    dueDate,
    paymentNotes: String(document.paymentNotes || "").trim(),
    payments: normalizeInvoicePayments(document, invoiceTotal, dueDate || baseDocument.issueDate),
  };
}

function normalizeJobRecord(job) {
  if (!job) return null;
  return {
    id: job.id || crypto.randomUUID(),
    jobNumber: job.jobNumber || 1,
    title: job.title || "Untitled job",
    description: job.description || "",
    urgency: job.urgency || "Medium",
    status: job.status || "To Do",
    scheduledDate: toDateInputValue(job.scheduledDate),
    assignedTechnicianId: job.assignedTechnicianId || "",
    assignedTechnicianName: job.assignedTechnicianName || "",
    customerId: job.customerId || "",
    customerName: job.customerName || "",
    customerEmail: job.customerEmail || "",
    customerPhone: job.customerPhone || "",
    jobAddress: job.jobAddress || "",
    ocNumber: String(job.ocNumber || "").trim(),
    maintenancePlanId: String(job.maintenancePlanId || "").trim(),
    maintenancePlanName: String(job.maintenancePlanName || "").trim(),
    maintenanceDueDate: toDateInputValue(job.maintenanceDueDate),
    createdAt: job.createdAt || new Date().toISOString(),
    updatedAt: job.updatedAt || new Date().toISOString(),
    notes: Array.isArray(job.notes) ? job.notes.map(normalizeNote).filter(Boolean) : [],
    photos: Array.isArray(job.photos) ? job.photos.map(normalizePhoto).filter(Boolean) : [],
    quote: normalizeDocumentRecord(job.quote, "quote"),
    invoice: normalizeDocumentRecord(job.invoice, "invoice"),
    externalRefs: normalizeExternalRefs(job.externalRefs),
  };
}

function normalizeDeletedJobRecord(record) {
  if (!record?.job) return null;
  return {
    deletedAt: record.deletedAt || new Date().toISOString(),
    job: normalizeJobRecord(record.job),
  };
}

function normalizeDeletedCustomerRecord(record) {
  if (!record?.customer) return null;
  return {
    deletedAt: record.deletedAt || new Date().toISOString(),
    customer: normalizeCustomerRecord(record.customer),
  };
}

function normalizeSettings(settings) {
  return {
    ...defaultSettings,
    ...(settings || {}),
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    staffId: user.staffId || null,
  };
}

function sanitizeManagedUserAccount(user) {
  if (!user) return null;
  return {
    ...sanitizeUser(user),
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || user.createdAt || "",
  };
}

function normalizeUserRecord(user) {
  if (!user) return null;

  const username = normalizeUsername(user.username);
  if (!username) return null;

  const passwordHash = typeof user.passwordHash === "string" && user.passwordHash.includes(":")
    ? user.passwordHash
    : "";

  if (!passwordHash) return null;

  return {
    id: user.id || crypto.randomUUID(),
    username,
    name: String(user.name || "").trim() || username,
    role: normalizeUserRole(user.role),
    staffId: user.staffId ? String(user.staffId).trim() : null,
    passwordHash,
    createdAt: user.createdAt || new Date().toISOString(),
    updatedAt: user.updatedAt || user.createdAt || new Date().toISOString(),
  };
}

function buildSeedData() {
  const [c1, c2] = defaultCustomers;
  const [s1, s2] = defaultStaff;
  const now = new Date().toISOString();

  return {
    meta: {
      initializedAt: now,
      updatedAt: now,
    },
    users: [],
    sessions: [],
    staff: defaultStaff.map(normalizeStaffRecord),
    customers: defaultCustomers.map(normalizeCustomerRecord),
    inventoryItems: defaultInventoryItems.map(normalizeInventoryRecord),
    maintenancePlans: defaultMaintenancePlans.map(normalizeMaintenancePlanRecord),
    jobs: [
      normalizeJobRecord({
        id: crypto.randomUUID(),
        jobNumber: 1,
        title: "Sliding gate motor fault",
        description: "Gate intermittently stops halfway. Inspect motor, control board, and limit settings.",
        urgency: "High",
        status: "To Do",
        assignedTechnicianId: s1.id,
        assignedTechnicianName: s1.name,
        customerId: c1.id,
        customerName: c1.name,
        customerEmail: c1.email,
        customerPhone: c1.phone,
        jobAddress: c1.address,
        createdAt: now,
        updatedAt: now,
        notes: [],
        photos: [],
        quote: null,
        invoice: null,
      }),
      normalizeJobRecord({
        id: crypto.randomUUID(),
        jobNumber: 2,
        title: "Boom gate annual service",
        description: "Preventive maintenance and safety inspection for entry boom gate.",
        urgency: "Medium",
        status: "In Progress",
        assignedTechnicianId: s2.id,
        assignedTechnicianName: s2.name,
        customerId: c2.id,
        customerName: c2.name,
        customerEmail: c2.email,
        customerPhone: c2.phone,
        jobAddress: c2.address,
        createdAt: now,
        updatedAt: now,
        notes: [
          {
            id: crypto.randomUUID(),
            author: s2.name,
            text: "On site. Found worn hinge and weak battery backup.",
            createdAt: now,
          },
        ],
        photos: [],
        quote: {
          type: "quote",
          issueDate: new Date().toISOString().slice(0, 10),
          notes: "Valid for 14 days.",
          sentHistory: [],
          items: [
            { id: crypto.randomUUID(), description: "Battery backup replacement", qty: 1, rate: 220 },
            { id: crypto.randomUUID(), description: "Service labour", qty: 1.5, rate: 135 },
          ],
        },
        invoice: null,
      }),
    ],
    deletedJobs: [],
    deletedCustomers: [],
    quoteTemplate: normalizeQuoteTemplate(defaultQuoteTemplate),
    invoiceTemplate: normalizeInvoiceTemplate(defaultInvoiceTemplate),
    settings: normalizeSettings(defaultSettings),
  };
}

function syncUsersWithStaff(data) {
  const staffById = new Map((Array.isArray(data.staff) ? data.staff : []).map((staffMember) => [staffMember.id, staffMember]));
  const users = (Array.isArray(data.users) ? data.users : [])
    .map(normalizeUserRecord)
    .filter(Boolean)
    .map((user) => {
      if (!user.staffId) return user;
      const staffMember = staffById.get(user.staffId);
      if (!staffMember || !staffMember.name || staffMember.name === user.name) return user;
      return {
        ...user,
        name: staffMember.name,
        updatedAt: new Date().toISOString(),
      };
    });

  return {
    ...data,
    users,
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(buildSeedData(), null, 2), "utf8");
  }
}

function pruneExpiredSessions(data) {
  const now = Date.now();
  const sessions = Array.isArray(data.sessions)
    ? data.sessions.filter((session) => new Date(session.expiresAt).getTime() > now)
    : [];

  if (sessions.length === (data.sessions || []).length) return data;
  return {
    ...data,
    sessions,
  };
}

function normalizeAuthMigrationMeta(meta) {
  const version = String(meta?.version || "").trim();
  const migratedAt = meta?.migratedAt ? new Date(meta.migratedAt).toISOString() : "";

  if (!version || !migratedAt) {
    return null;
  }

  return {
    version,
    migratedAt,
  };
}

function normalizeStoredData(rawData) {
  const data = rawData || buildSeedData();
  return syncUsersWithStaff(pruneExpiredSessions({
    ...data,
    users: Array.isArray(data.users)
      ? data.users.map(normalizeUserRecord).filter(Boolean)
      : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    staff: Array.isArray(data.staff) ? data.staff.map(normalizeStaffRecord).filter(Boolean) : defaultStaff.map(normalizeStaffRecord),
    customers: Array.isArray(data.customers) ? data.customers.map(normalizeCustomerRecord).filter(Boolean) : [],
    inventoryItems: Array.isArray(data.inventoryItems)
      ? data.inventoryItems.map(normalizeInventoryRecord).filter(Boolean)
      : Array.isArray(data.parts)
        ? data.parts.map(normalizeInventoryRecord).filter(Boolean)
        : [],
    maintenancePlans: Array.isArray(data.maintenancePlans)
      ? data.maintenancePlans.map(normalizeMaintenancePlanRecord).filter(Boolean)
      : [],
    jobs: Array.isArray(data.jobs) ? data.jobs.map(normalizeJobRecord).filter(Boolean) : [],
    deletedJobs: Array.isArray(data.deletedJobs) ? data.deletedJobs.map(normalizeDeletedJobRecord).filter(Boolean) : [],
    deletedCustomers: Array.isArray(data.deletedCustomers) ? data.deletedCustomers.map(normalizeDeletedCustomerRecord).filter(Boolean) : [],
    quoteTemplate: normalizeQuoteTemplate(data.quoteTemplate),
    invoiceTemplate: normalizeInvoiceTemplate(data.invoiceTemplate),
    settings: normalizeSettings(data.settings),
    meta: {
      ...(normalizeAuthMigrationMeta(data.meta?.authMigration)
        ? { authMigration: normalizeAuthMigrationMeta(data.meta?.authMigration) }
        : {}),
      initializedAt: data.meta?.initializedAt || new Date().toISOString(),
      updatedAt: data.meta?.updatedAt || new Date().toISOString(),
    },
  }));
}

export function loadData() {
  ensureDataFile();
  const fileContents = fs.readFileSync(DATA_FILE, "utf8");
  const sanitizedContents = fileContents.charCodeAt(0) === 0xFEFF
    ? fileContents.slice(1)
    : fileContents;

  let raw;
  try {
    raw = JSON.parse(sanitizedContents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new Error(`Unable to read ${DATA_FILE}: ${message}`);
  }

  const normalized = normalizeStoredData(raw);
  if (sanitizedContents !== fileContents || JSON.stringify(raw) !== JSON.stringify(normalized)) {
    saveData(normalized);
  }
  return normalized;
}

export function saveData(nextData) {
  ensureDataFile();
  const normalized = normalizeStoredData(nextData);
  const payload = {
    ...normalized,
    meta: {
      ...normalized.meta,
      updatedAt: new Date().toISOString(),
    },
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export function getAdminBackup(requestUser) {
  if (!requestUser || requestUser.role !== "admin") {
    throw new Error("You do not have permission to download a full backup.");
  }

  const data = loadData();
  return {
    ...data,
    // Session tokens are transient and sensitive, so backups omit them.
    sessions: [],
    backup: {
      format: "elset-backup-v1",
      exportedAt: new Date().toISOString(),
      exportedBy: sanitizeUser(requestUser),
      sourceFile: path.basename(DATA_FILE),
    },
  };
}

function buildSessionRecord(token, userId) {
  return {
    token,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
}

function buildRestoredSessionUserMatcher(requestUser) {
  const requestUsername = normalizeUsername(requestUser?.username);
  const requestUserId = String(requestUser?.id || "").trim();

  return (candidateUser) => {
    if (!candidateUser) return false;
    if (requestUserId && candidateUser.id === requestUserId) return true;
    return requestUsername ? candidateUser.username === requestUsername : false;
  };
}

function canInjectCurrentUserIntoBackup(data, currentUserAccount) {
  if (!currentUserAccount) return false;

  const duplicateUsername = data.users.some((entry) => entry.username === currentUserAccount.username);
  if (duplicateUsername) return false;

  if (currentUserAccount.staffId) {
    const duplicateStaffLink = data.users.some((entry) => entry.staffId === currentUserAccount.staffId);
    if (duplicateStaffLink) return false;
  }

  return true;
}

function prepareBackupImportData(backupInput) {
  if (!backupInput || typeof backupInput !== "object" || Array.isArray(backupInput)) {
    throw new Error("The uploaded backup must be a JSON object.");
  }

  if (backupInput.backup && backupInput.backup.format !== "elset-backup-v1") {
    throw new Error("This backup file uses an unsupported format.");
  }

  const { backup: _BACKUP, ...workspaceData } = backupInput;
  return {
    ...workspaceData,
    sessions: [],
  };
}

export function restoreAdminBackup(requestUser, backupInput, sessionToken = "") {
  if (!requestUser || requestUser.role !== "admin") {
    throw new Error("You do not have permission to restore a full backup.");
  }

  const currentData = loadData();
  const currentUserMatcher = buildRestoredSessionUserMatcher(requestUser);
  const currentUserAccount = currentData.users.find(currentUserMatcher) || null;
  let restoredData = normalizeStoredData(prepareBackupImportData(backupInput));
  let restoredSessionUser = restoredData.users.find(currentUserMatcher) || null;
  let preservedCurrentAdmin = false;

  if (sessionToken && !restoredSessionUser && canInjectCurrentUserIntoBackup(restoredData, currentUserAccount)) {
    restoredData = normalizeStoredData({
      ...restoredData,
      users: [...restoredData.users, currentUserAccount],
      sessions: [],
    });
    restoredSessionUser = restoredData.users.find(currentUserMatcher) || null;
    preservedCurrentAdmin = Boolean(restoredSessionUser);
  }

  const savedData = saveData({
    ...restoredData,
    sessions: sessionToken && restoredSessionUser ? [buildSessionRecord(sessionToken, restoredSessionUser.id)] : [],
  });
  const resolvedUser = restoredSessionUser
    ? sanitizeUser(savedData.users.find((entry) => entry.id === restoredSessionUser.id) || restoredSessionUser)
    : requestUser;

  return {
    accounts: savedData.users.map(sanitizeManagedUserAccount).filter(Boolean),
    message: sessionToken && !restoredSessionUser
      ? "Backup restored, but your current login could not be matched to an account in that file."
      : preservedCurrentAdmin
        ? "Backup restored and your current admin login was preserved."
        : "Backup restored successfully.",
    sessionPreserved: !sessionToken || Boolean(restoredSessionUser),
    state: buildUserState(savedData, resolvedUser),
    user: resolvedUser,
  };
}

function buildUserState(data, user) {
  if (!user) return null;

  if (user.role === "technician") {
    const jobs = data.jobs;
    const customerIds = new Set(jobs.map((job) => job.customerId));
    const customers = data.customers.filter((customer) => customerIds.has(customer.id));
    const staff = data.staff.filter((staffMember) => staffMember.id === user.staffId);

    return {
      staff,
      customers,
      inventoryItems: [],
      maintenancePlans: [],
      jobs,
      deletedJobs: [],
      deletedCustomers: [],
      quoteTemplate: normalizeQuoteTemplate(data.quoteTemplate),
      invoiceTemplate: normalizeInvoiceTemplate(data.invoiceTemplate),
      settings: normalizeSettings(data.settings),
    };
  }

  return {
    staff: data.staff,
    customers: data.customers,
    inventoryItems: data.inventoryItems,
    maintenancePlans: data.maintenancePlans,
    jobs: data.jobs,
    deletedJobs: data.deletedJobs,
    deletedCustomers: data.deletedCustomers,
    quoteTemplate: normalizeQuoteTemplate(data.quoteTemplate),
    invoiceTemplate: normalizeInvoiceTemplate(data.invoiceTemplate),
    settings: normalizeSettings(data.settings),
  };
}

function mergeTechnicianState(existingData, incomingState) {
  const allowedJobIds = new Set(
    existingData.jobs.map((job) => job.id)
  );
  const incomingJobsById = new Map(
    (Array.isArray(incomingState?.jobs) ? incomingState.jobs : [])
      .map((job) => normalizeJobRecord(job))
      .filter(Boolean)
      .map((job) => [job.id, job])
  );

  const jobs = existingData.jobs.map((job) => {
    if (!allowedJobIds.has(job.id)) return job;

    const incomingJob = incomingJobsById.get(job.id);
    if (!incomingJob) return job;

    return {
      ...job,
      status: incomingJob.status || job.status,
      notes: Array.isArray(incomingJob.notes) ? incomingJob.notes.map(normalizeNote).filter(Boolean) : job.notes,
      photos: Array.isArray(incomingJob.photos) ? incomingJob.photos.map(normalizePhoto).filter(Boolean) : job.photos,
      updatedAt: incomingJob.updatedAt || new Date().toISOString(),
    };
  });

  return {
    ...existingData,
    jobs,
  };
}

function mergeOfficeState(existingData, incomingState) {
  return {
    ...existingData,
    staff: Array.isArray(incomingState?.staff) ? incomingState.staff.map(normalizeStaffRecord).filter(Boolean) : existingData.staff,
    customers: Array.isArray(incomingState?.customers) ? incomingState.customers.map(normalizeCustomerRecord).filter(Boolean) : existingData.customers,
    inventoryItems: Array.isArray(incomingState?.inventoryItems)
      ? incomingState.inventoryItems.map(normalizeInventoryRecord).filter(Boolean)
      : Array.isArray(incomingState?.parts)
        ? incomingState.parts.map(normalizeInventoryRecord).filter(Boolean)
        : existingData.inventoryItems,
    maintenancePlans: Array.isArray(incomingState?.maintenancePlans)
      ? incomingState.maintenancePlans.map(normalizeMaintenancePlanRecord).filter(Boolean)
      : existingData.maintenancePlans,
    jobs: Array.isArray(incomingState?.jobs) ? incomingState.jobs.map(normalizeJobRecord).filter(Boolean) : existingData.jobs,
    deletedJobs: Array.isArray(incomingState?.deletedJobs) ? incomingState.deletedJobs.map(normalizeDeletedJobRecord).filter(Boolean) : existingData.deletedJobs,
    deletedCustomers: Array.isArray(incomingState?.deletedCustomers)
      ? incomingState.deletedCustomers.map(normalizeDeletedCustomerRecord).filter(Boolean)
      : existingData.deletedCustomers,
    quoteTemplate: normalizeQuoteTemplate(incomingState?.quoteTemplate || existingData.quoteTemplate),
    invoiceTemplate: normalizeInvoiceTemplate(incomingState?.invoiceTemplate || existingData.invoiceTemplate),
    settings: normalizeSettings(incomingState?.settings || existingData.settings),
  };
}

export function authenticateUser(username, password) {
  const data = loadData();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const user = data.users.find((entry) => entry.username.toLowerCase() === normalizedUsername);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };

  data.sessions = [...data.sessions.filter((entry) => entry.userId !== user.id), session];
  saveData(data);

  return {
    token: session.token,
    user: sanitizeUser(user),
  };
}

export function getSessionUser(token) {
  if (!token) return null;
  const data = loadData();
  const session = data.sessions.find((entry) => entry.token === token);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    data.sessions = data.sessions.filter((entry) => entry.token !== token);
    saveData(data);
    return null;
  }

  const user = data.users.find((entry) => entry.id === session.userId);
  return user ? sanitizeUser(user) : null;
}

export function revokeSession(token) {
  if (!token) return;
  const data = loadData();
  data.sessions = data.sessions.filter((entry) => entry.token !== token);
  saveData(data);
}

export function getAuthorizedAppState(user) {
  const data = loadData();
  return buildUserState(data, user);
}

export function saveAuthorizedAppState(user, incomingState) {
  const data = loadData();
  const merged = user.role === "technician"
    ? mergeTechnicianState(data, incomingState)
    : mergeOfficeState(data, incomingState);

  return buildUserState(saveData(merged), user);
}

export function getAdminUserAccounts(requestUser) {
  if (!requestUser || requestUser.role !== "admin") {
    throw new Error("You do not have permission to view login accounts.");
  }

  const data = loadData();
  return data.users.map(sanitizeManagedUserAccount).filter(Boolean);
}

export function saveAdminUserAccount(requestUser, accountInput) {
  if (!requestUser || requestUser.role !== "admin") {
    throw new Error("You do not have permission to update login accounts.");
  }

  const data = loadData();
  const accountId = String(accountInput?.id || "").trim();
  const existingAccount = accountId
    ? data.users.find((entry) => entry.id === accountId)
    : null;
  const username = normalizeUsername(accountInput?.username);
  const role = normalizeUserRole(accountInput?.role);
  const staffId = accountInput?.staffId ? String(accountInput.staffId).trim() : null;
  const password = String(accountInput?.password || "");

  if (!username) {
    throw new Error("Username is required.");
  }

  if (password && password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  if (!existingAccount && !password) {
    throw new Error("A password is required when creating a new login.");
  }

  const duplicateUsername = data.users.find((entry) => entry.id !== existingAccount?.id && entry.username === username);
  if (duplicateUsername) {
    throw new Error("That username is already in use.");
  }

  if (staffId) {
    const duplicateStaffLink = data.users.find((entry) => entry.id !== existingAccount?.id && entry.staffId === staffId);
    if (duplicateStaffLink) {
      throw new Error("That staff member already has a linked login.");
    }
  }

  const linkedStaffMember = staffId ? data.staff.find((entry) => entry.id === staffId) : null;
  if (staffId && !linkedStaffMember) {
    throw new Error("The linked staff member could not be found.");
  }

  const now = new Date().toISOString();
  const nextAccount = normalizeUserRecord({
    id: existingAccount?.id || crypto.randomUUID(),
    username,
    name: linkedStaffMember?.name || existingAccount?.name || username,
    role,
    staffId,
    passwordHash: password ? hashPassword(password) : existingAccount?.passwordHash,
    createdAt: existingAccount?.createdAt || now,
    updatedAt: now,
  });

  if (!nextAccount) {
    throw new Error("Unable to save that login account.");
  }

  const shouldRevokeSessions = Boolean(existingAccount && password);

  data.users = existingAccount
    ? data.users.map((entry) => (entry.id === existingAccount.id ? nextAccount : entry))
    : [...data.users, nextAccount];

  if (shouldRevokeSessions) {
    data.sessions = data.sessions.filter((entry) => entry.userId !== nextAccount.id);
  }

  saveData(data);
  return sanitizeManagedUserAccount(nextAccount);
}
