/* eslint-disable react-refresh/only-export-components */

import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  History,
  Map as MapIcon,
  MapPinned,
  Package,
  Receipt,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import {
  calculateInvoicePaidAmount,
  calculateInvoiceTotal,
  defaultInvoiceTemplate,
  defaultQuoteTemplate,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "@/lib/quote-template";
import {
  APP_TEXT_DARK,
  APP_TEXT_LIGHT,
  AUTH_MIGRATION_KEY,
  RECYCLE_BIN_RETENTION_MS,
  STORAGE_KEY,
  contentDensityOptions,
  customerTypeOptions,
  defaultStaffMembers,
  defaultThemeSettings,
  inventoryCategories,
  loginAccessRoleOptions,
  maintenanceFrequencyOptions,
  sidebarWidthOptions,
  siteTypeOptions,
} from "./app-support-config.js";

export {
  APP_TEXT_DARK,
  APP_TEXT_LIGHT,
  AUTH_MIGRATION_KEY,
  LOGO_SRC,
  RECYCLE_BIN_RETENTION_MS,
  STORAGE_KEY,
  SUPPLIER_MANUALS_BASE_URL,
  SUPPLIER_MANUALS_INDEX_URL,
  contentDensityOptions,
  customerTypeOptions,
  defaultStaffMembers,
  defaultThemeSettings,
  inventoryCategories,
  loginAccessRoleOptions,
  maintenanceFrequencyOptions,
  sidebarWidthOptions,
  sidebarWidthStyles,
  siteTypeOptions,
  uiSettingKeys,
  preferenceSettingKeys,
  urgencyOptions,
} from "./app-support-config.js";
export * from "./supplier-manuals.js";
export { SupplierManualMatches } from "@/components/shared/SupplierManualMatches";

export function formatLoginAccessRole(role) {
  const match = loginAccessRoleOptions.find((option) => option.value === role);
  return match?.label || "Technician";
}

export function getSuggestedLoginAccessRole(staffMember) {
  const roleText = String(staffMember?.role || "").toLowerCase();
  if (roleText.includes("admin")) return "admin";
  if (roleText.includes("office")) return "office";
  return "technician";
}

export function formatCustomerType(type) {
  const match = customerTypeOptions.find((option) => option.value === type);
  return match?.label || "Not set";
}

export function formatSiteType(type) {
  const match = siteTypeOptions.find((option) => option.value === type);
  return match?.label || "Not set";
}

export const contentDensityStyles = {
  compact: {
    sectionGap: "1rem",
    mobileX: "0.875rem",
    mobileY: "0.875rem",
    smX: "1rem",
    smY: "1rem",
    lgX: "1.25rem",
    lgY: "1.25rem",
  },
  comfortable: {
    sectionGap: "1.5rem",
    mobileX: "1rem",
    mobileY: "1rem",
    smX: "1.25rem",
    smY: "1.25rem",
    lgX: "1.5rem",
    lgY: "1.5rem",
  },
  spacious: {
    sectionGap: "1.875rem",
    mobileX: "1.125rem",
    mobileY: "1.125rem",
    smX: "1.375rem",
    smY: "1.375rem",
    lgX: "1.875rem",
    lgY: "1.875rem",
  },
};

export const settingsTabs = [
  { value: "preferences", label: "Preferences" },
  { value: "templates", label: "Document Templates" },
  { value: "ui", label: "UI Settings" },
  { value: "backup", label: "Data Backup" },
];

export const settingsTabMeta = {
  preferences: {
    eyebrow: "Company Preferences",
    title: "Preferences",
    description: "Manage company details, outgoing email defaults, and other shared administrative preferences.",
  },
  templates: {
    eyebrow: "Document Templates",
    title: "Document Templates",
    description: "Edit the quote and invoice templates, preview the PDFs, and keep your branded documents consistent.",
  },
  ui: {
    eyebrow: "Workspace Settings",
    title: "UI Settings",
    description: "Adjust application colours, table styling, popup gradients, layout spacing, and workspace visibility controls for the main shell.",
  },
  backup: {
    eyebrow: "Backup & Recovery",
    title: "Data Backup",
    description: "Download a secure JSON snapshot of the shared workspace data so you always have an offline copy of your records.",
  },
};

export const themeColorFields = [
  {
    key: "pageBackgroundStart",
    label: "Page gradient start",
    description: "Top-left page background tone.",
  },
  {
    key: "pageBackgroundEnd",
    label: "Page gradient end",
    description: "Bottom-right page background tone.",
  },
  {
    key: "sidebarSurface",
    label: "Sidebar surface",
    description: "The main background color of the left menu.",
  },
  {
    key: "sidebarHeader",
    label: "Sidebar header",
    description: "The dark branded header block in the menu.",
  },
  {
    key: "sidebarActive",
    label: "Active menu item",
    description: "Highlight color for the selected menu section.",
  },
  {
    key: "heroSurface",
    label: "Page header",
    description: "Main header card background color.",
  },
  {
    key: "actionColor",
    label: "Primary action",
    description: "Used for the main call-to-action buttons.",
  },
  {
    key: "borderColor",
    label: "UI border",
    description: "Shared border color for cards, buttons, inputs, and panels.",
  },
  {
    key: "dialogSurface",
    label: "Popup surface",
    description: "Base color used to generate popup gradients throughout the app.",
  },
  {
    key: "dataViewSurface",
    label: "Database surface",
    description: "Base tint for the row backgrounds and database cards.",
  },
  {
    key: "dataViewAccent",
    label: "Database accent",
    description: "Header, hover, and border accent used across database views.",
  },
];

export const themePresets = [
  {
    id: "elset",
    label: "Elset Classic",
    description: "The original Elset brand palette with the bright blue shell and orange action colour.",
    values: {
      pageBackgroundStart: "#0F90CD",
      pageBackgroundEnd: "#0F90CD",
      sidebarSurface: "#FFFFFF",
      sidebarHeader: "#0F90CD",
      sidebarActive: "#F69320",
      heroSurface: "#0F90CD",
      actionColor: "#F69320",
      borderColor: "#1E293B",
      dialogSurface: "#9FE4FB",
      dataViewSurface: "#EAF7FB",
      dataViewAccent: "#0F90CD",
    },
  },
  {
    id: "copper-dawn",
    label: "Copper Dawn",
    description: "Warm terracotta, soft cream, and punchier copper action colours.",
    values: {
      pageBackgroundStart: "#FFF1E7",
      pageBackgroundEnd: "#F3BA8D",
      sidebarSurface: "#FFF8F2",
      sidebarHeader: "#8A3C22",
      sidebarActive: "#F58A4B",
      heroSurface: "#A94A24",
      actionColor: "#E6632B",
      borderColor: "#5A2F20",
      dialogSurface: "#FFF7F1",
      dataViewSurface: "#FFF4EC",
      dataViewAccent: "#C96C33",
    },
  },
  {
    id: "evergreen-ledger",
    label: "Evergreen Ledger",
    description: "Deep greens, pale paper surfaces, and a more grounded workshop feel.",
    values: {
      pageBackgroundStart: "#EEF7E8",
      pageBackgroundEnd: "#B4D29B",
      sidebarSurface: "#F8FAF1",
      sidebarHeader: "#22492D",
      sidebarActive: "#6BAE58",
      heroSurface: "#2E603A",
      actionColor: "#80C24D",
      borderColor: "#23422B",
      dialogSurface: "#F7FBF3",
      dataViewSurface: "#F1F8EC",
      dataViewAccent: "#5E8F51",
    },
  },
  {
    id: "midnight-signal",
    label: "Midnight Signal",
    description: "A darker shell with electric cyan borders and a sharper after-hours vibe.",
    values: {
      pageBackgroundStart: "#0B132B",
      pageBackgroundEnd: "#155E75",
      sidebarSurface: "#111827",
      sidebarHeader: "#0E7490",
      sidebarActive: "#22D3EE",
      heroSurface: "#111827",
      actionColor: "#14B8A6",
      borderColor: "#38BDF8",
      dialogSurface: "#E6F7FF",
      dataViewSurface: "#F0FBFF",
      dataViewAccent: "#22D3EE",
    },
  },
  {
    id: "studio-rose",
    label: "Studio Rose",
    description: "Soft blush foundations with richer magenta accents and darker wine framing.",
    values: {
      pageBackgroundStart: "#FFF1F5",
      pageBackgroundEnd: "#F4BCCB",
      sidebarSurface: "#FFF8FB",
      sidebarHeader: "#7A2D4F",
      sidebarActive: "#E36D97",
      heroSurface: "#95395E",
      actionColor: "#D94C7F",
      borderColor: "#61263F",
      dialogSurface: "#FFF7FA",
      dataViewSurface: "#FFF3F8",
      dataViewAccent: "#D94C7F",
    },
  },
  {
    id: "desert-circuit",
    label: "Desert Circuit",
    description: "Sand, brass, and workshop amber for a warmer, more industrial palette.",
    values: {
      pageBackgroundStart: "#FFF6DB",
      pageBackgroundEnd: "#E7C56D",
      sidebarSurface: "#FCF8EA",
      sidebarHeader: "#5A4718",
      sidebarActive: "#C9901E",
      heroSurface: "#7A5C12",
      actionColor: "#DE7E12",
      borderColor: "#4A3915",
      dialogSurface: "#FFFBEF",
      dataViewSurface: "#FFF8EB",
      dataViewAccent: "#D4932A",
    },
  },
];

export const sideNavItems = [
  {
    id: "service-board",
    label: "Service Board",
    description: "Manage live jobs, queues, and service work.",
    icon: ClipboardList,
  },
  {
    id: "customers",
    label: "Customers",
    description: "Open the customer database and update records.",
    icon: Users,
  },
  {
    id: "sites",
    label: "Sites",
    description: "Review each site, its gates or projects, and related job history.",
    icon: MapPinned,
  },
  {
    id: "map",
    label: "Map",
    description: "Visualize saved jobs across Melbourne on an interactive map.",
    icon: MapIcon,
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Plan optional job dates and keep unscheduled work visible.",
    icon: CalendarDays,
  },
  {
    id: "job-history",
    label: "Job History",
    description: "Search every saved job record with database-style filters and quick job access.",
    icon: History,
  },
  {
    id: "invoices",
    label: "Invoices",
    description: "Track invoice status, due dates, and payments.",
    icon: Receipt,
  },
  {
    id: "maintenance",
    label: "Maintenance",
    description: "Manage recurring maintenance plans and generate service jobs.",
    icon: RotateCcw,
  },
  {
    id: "staff",
    label: "Staff",
    description: "Manage staff records, contact details, and login access.",
    icon: ShieldCheck,
  },
  {
    id: "inventory",
    label: "Parts Inventory",
    description: "Track parts, stock levels, suppliers, and reorder points.",
    icon: Package,
  },
  {
    id: "statistics",
    label: "Statistics",
    description: "Review workload, urgency, and document totals.",
    icon: BarChart3,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Adjust the application theme colors and workspace styling.",
    icon: SettingsIcon,
  },
  {
    id: "recycle-bin",
    label: "Recycle Bin",
    description: "Review deleted jobs and customers before they expire.",
    icon: Trash2,
  },
];

export const sectionMeta = {
  "service-board": {
    eyebrow: "Operations",
    title: "GateFlow Service Board",
    description: "Track live work orders, move jobs across the board, and keep the team coordinated.",
  },
  customers: {
    eyebrow: "Customer Database",
    title: "Customers",
    description: "Work through the customer database with structured filters, sorting, and quick profile access.",
  },
  "job-history": {
    eyebrow: "Service Records",
    title: "Job History",
    description: "Review every saved job in one database view, filter by status, and jump straight into the full record.",
  },
  sites: {
    eyebrow: "Site Profiles",
    title: "Sites",
    description: "Open site-level records, group multiple gates or projects under one address, and review work history by site.",
  },
  map: {
    eyebrow: "Field Coverage",
    title: "Jobs Map",
    description: "See where active and completed jobs sit on the map, inspect coverage across Melbourne, and jump straight into job details.",
  },
  calendar: {
    eyebrow: "Work Planning",
    title: "Calendar",
    description: "Review scheduled work by date and open a day panel when you need to inspect or adjust jobs.",
  },
  invoices: {
    eyebrow: "Payments",
    title: "Invoices",
    description: "Track invoices, due dates, payment status, overdue work, and jobs still waiting to be invoiced.",
  },
  maintenance: {
    eyebrow: "Preventive Service",
    title: "Maintenance Plans",
    description: "Schedule recurring maintenance by customer and site, then spin each due visit into a normal service job.",
  },
  staff: {
    eyebrow: "Team Directory",
    title: "Staff Management",
    description: "Maintain staff records, roles, and contact details for the people working across the business.",
  },
  inventory: {
    eyebrow: "Parts Store",
    title: "Parts Inventory",
    description: "Track stock levels, suppliers, unit costs, and reorder points for commonly used parts.",
  },
  statistics: {
    eyebrow: "Business Snapshot",
    title: "Statistics",
    description: "Monitor workload, urgency, and quote or invoice totals across the service operation.",
  },
  settings: {
    eyebrow: "Workspace Settings",
    title: "Settings",
    description: "Manage the UI, company preferences, email defaults, and document templates in one place.",
  },
  "recycle-bin": {
    eyebrow: "Recovery Center",
    title: "Recycle Bin",
    description: "Deleted jobs and customers stay here for 7 days before they are removed automatically.",
  },
};

export const templateTypeOptions = [
  { id: "quote", label: "Quote Template" },
  { id: "invoice", label: "Invoice Template" },
];

export const previewCustomerFixtures = [
  {
    customerName: "Harbour View Strata",
    customerEmail: "facilities@harbourview.test",
    title: "Sliding gate automation upgrade",
    jobAddress: "18 Marina Parade, Melbourne",
  },
  {
    customerName: "Riverside Logistics",
    customerEmail: "ops@riverside.test",
    title: "Warehouse boom gate service",
    jobAddress: "47 Freight Link, Dandenong",
  },
  {
    customerName: "Summit Business Park",
    customerEmail: "admin@summitpark.test",
    title: "Access control fault inspection",
    jobAddress: "206 Enterprise Drive, Richmond",
  },
];

export const defaultCustomers = [
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

export const defaultMaintenancePlans = [
  {
    id: crypto.randomUUID(),
    planName: "Entry boom gate preventive service",
    customerId: defaultCustomers[1].id,
    siteAddress: defaultCustomers[1].address,
    frequency: "quarterly",
    nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString().slice(0, 10),
    defaultTechnicianId: "",
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
    defaultTechnicianId: "",
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

export const seedData = {
  staff: defaultStaffMembers,
  customers: defaultCustomers,
  inventoryItems: [
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
  ],
  maintenancePlans: defaultMaintenancePlans,
  jobs: [],
  deletedJobs: [],
  deletedCustomers: [],
  quoteTemplate: defaultQuoteTemplate,
  invoiceTemplate: defaultInvoiceTemplate,
  settings: defaultThemeSettings,
};

export function slugDate() {
  return new Date().toISOString().slice(0, 10);
}

export function countBusinessRecords(state) {
  if (!state || typeof state !== "object") return 0;
  return (
    (Array.isArray(state.staff) ? state.staff.length : 0) +
    (Array.isArray(state.customers) ? state.customers.length : 0) +
    (Array.isArray(state.inventoryItems) ? state.inventoryItems.length : 0) +
    (Array.isArray(state.maintenancePlans) ? state.maintenancePlans.length : 0) +
    (Array.isArray(state.jobs) ? state.jobs.length : 0) +
    (Array.isArray(state.deletedJobs) ? state.deletedJobs.length : 0) +
    (Array.isArray(state.deletedCustomers) ? state.deletedCustomers.length : 0)
  );
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

export function formatDate(date) {
  if (!date) return "Not set";
  return new Date(date).toLocaleDateString();
}

export function toTimestamp(date) {
  const timestamp = new Date(date || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function toDateInputValue(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToDateInput(value, days) {
  const date = parseDateInputValue(value) || new Date();
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

export function parseDateInputValue(value) {
  const normalized = toDateInputValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function getCalendarDays(monthDate) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date,
      key: toDateInputValue(date),
      inMonth: date.getMonth() === monthDate.getMonth(),
      isToday: toDateInputValue(date) === toDateInputValue(new Date()),
    };
  });
}

export function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function getRecycleBinExpiryDate(deletedAt) {
  return new Date(toTimestamp(deletedAt) + RECYCLE_BIN_RETENTION_MS).toISOString();
}

export function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const shortHexMatch = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (!shortHexMatch) return fallback;

  const [r, g, b] = shortHexMatch[1].split("");
  return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
}

export function isHexColorDraftValid(value) {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

export function normalizeOptionValue(value, options, fallback) {
  return options.some((option) => option.value === value) ? value : fallback;
}

export function normalizeTextSetting(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value;
}

export function pickSettings(source, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = source[key];
    return acc;
  }, {});
}

export function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex, "#000000").slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const toHex = (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mixHexColors(baseHex, mixHex, weight = 0.5) {
  const base = hexToRgb(baseHex);
  const mix = hexToRgb(mixHex);
  const clampedWeight = Math.max(0, Math.min(1, weight));

  return rgbToHex({
    r: base.r + (mix.r - base.r) * clampedWeight,
    g: base.g + (mix.g - base.g) * clampedWeight,
    b: base.b + (mix.b - base.b) * clampedWeight,
  });
}

export function getContrastTextColor(hex, { dark = APP_TEXT_DARK, light = APP_TEXT_LIGHT } = {}) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  return luminance > 0.65 ? dark : light;
}

export function buildDataViewTheme(settings) {
  const normalizedSettings = normalizeThemeSettings(settings);
  const surface = normalizeHexColor(normalizedSettings.dataViewSurface, defaultThemeSettings.dataViewSurface);
  const accent = normalizeHexColor(normalizedSettings.dataViewAccent, defaultThemeSettings.dataViewAccent);
  const liftedSurface = mixHexColors(surface, "#FFFFFF", 0.72);
  const airySurface = mixHexColors(surface, "#FFFFFF", 0.88);

  return {
    surface,
    accent,
    headerStart: mixHexColors(liftedSurface, accent, 0.18),
    headerEnd: mixHexColors(airySurface, "#FFFFFF", 0.18),
    border: mixHexColors(liftedSurface, accent, 0.2),
    borderStrong: mixHexColors(accent, APP_TEXT_DARK, 0.18),
    gridLine: mixHexColors(airySurface, accent, 0.1),
    headerCell: mixHexColors(airySurface, accent, 0.08),
    row: mixHexColors(airySurface, "#FFFFFF", 0.18),
    rowAlt: mixHexColors(airySurface, accent, 0.06),
    rowHover: mixHexColors(airySurface, accent, 0.14),
    stat: mixHexColors(airySurface, "#FFFFFF", 0.1),
    textTint: mixHexColors(APP_TEXT_DARK, accent, 0.2),
    shadow: hexToRgba(accent, 0.24),
  };
}

export function normalizeThemeSettings(settings) {
  return {
    pageBackgroundStart: normalizeHexColor(settings?.pageBackgroundStart, defaultThemeSettings.pageBackgroundStart),
    pageBackgroundEnd: normalizeHexColor(settings?.pageBackgroundEnd, defaultThemeSettings.pageBackgroundEnd),
    sidebarSurface: normalizeHexColor(settings?.sidebarSurface, defaultThemeSettings.sidebarSurface),
    sidebarHeader: normalizeHexColor(settings?.sidebarHeader, defaultThemeSettings.sidebarHeader),
    sidebarActive: normalizeHexColor(settings?.sidebarActive, defaultThemeSettings.sidebarActive),
    heroSurface: normalizeHexColor(settings?.heroSurface, defaultThemeSettings.heroSurface),
    actionColor: normalizeHexColor(settings?.actionColor, defaultThemeSettings.actionColor),
    borderColor: normalizeHexColor(settings?.borderColor, defaultThemeSettings.borderColor),
    dialogSurface: normalizeHexColor(settings?.dialogSurface, defaultThemeSettings.dialogSurface),
    dataViewSurface: normalizeHexColor(settings?.dataViewSurface, defaultThemeSettings.dataViewSurface),
    dataViewAccent: normalizeHexColor(settings?.dataViewAccent, defaultThemeSettings.dataViewAccent),
    sidebarWidth: normalizeOptionValue(settings?.sidebarWidth, sidebarWidthOptions, defaultThemeSettings.sidebarWidth),
    contentDensity: normalizeOptionValue(settings?.contentDensity, contentDensityOptions, defaultThemeSettings.contentDensity),
    companyName: normalizeTextSetting(settings?.companyName, defaultThemeSettings.companyName),
    companyAbn: normalizeTextSetting(settings?.companyAbn, defaultThemeSettings.companyAbn),
    companyAcn: normalizeTextSetting(settings?.companyAcn, defaultThemeSettings.companyAcn),
    companyEmail: normalizeTextSetting(settings?.companyEmail, defaultThemeSettings.companyEmail),
    companyPhone: normalizeTextSetting(settings?.companyPhone, defaultThemeSettings.companyPhone),
    companyAddress: normalizeTextSetting(settings?.companyAddress, defaultThemeSettings.companyAddress),
    bankAccountName: normalizeTextSetting(settings?.bankAccountName, defaultThemeSettings.bankAccountName),
    bankBsb: normalizeTextSetting(settings?.bankBsb, defaultThemeSettings.bankBsb),
    bankAccountNumber: normalizeTextSetting(settings?.bankAccountNumber, defaultThemeSettings.bankAccountNumber),
    defaultSenderEmail: normalizeTextSetting(settings?.defaultSenderEmail, defaultThemeSettings.defaultSenderEmail),
    replyToEmail: normalizeTextSetting(settings?.replyToEmail, defaultThemeSettings.replyToEmail),
    quoteCcEmail: normalizeTextSetting(settings?.quoteCcEmail, defaultThemeSettings.quoteCcEmail),
    invoiceCcEmail: normalizeTextSetting(settings?.invoiceCcEmail, defaultThemeSettings.invoiceCcEmail),
    emailSignature: normalizeTextSetting(settings?.emailSignature, defaultThemeSettings.emailSignature),
  };
}

export function normalizePaymentAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
}

export function normalizeInvoicePaymentRecord(payment) {
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

export function normalizeInvoicePayments(document, invoiceTotal, fallbackDate) {
  const explicitPayments = Array.isArray(document?.payments)
    ? document.payments
        .map(normalizeInvoicePaymentRecord)
        .filter((payment) => payment && payment.amount > 0)
    : [];

  if (explicitPayments.length > 0) {
    return explicitPayments.sort((a, b) => toTimestamp(a.date || a.createdAt) - toTimestamp(b.date || b.createdAt));
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

export function getInvoicePaymentSummary(invoice) {
  const normalizedInvoice = normalizeDocument("invoice", invoice);
  if (!normalizedInvoice) {
    return {
      total: 0,
      paidAmount: 0,
      balanceAmount: 0,
      overpaidAmount: 0,
      paymentCount: 0,
      lastPaymentDate: "",
    };
  }

  const total = calculateInvoiceTotal(normalizedInvoice.items);
  const paidAmount = calculateInvoicePaidAmount(normalizedInvoice.payments || []);
  const balanceAmount = Math.max(Number((total - paidAmount).toFixed(2)), 0);
  const overpaidAmount = Math.max(Number((paidAmount - total).toFixed(2)), 0);
  const sortedPayments = [...(normalizedInvoice.payments || [])].sort(
    (a, b) => toTimestamp(a.date || a.createdAt) - toTimestamp(b.date || b.createdAt)
  );
  const lastPayment = sortedPayments.at(-1) || null;

  return {
    total,
    paidAmount,
    balanceAmount,
    overpaidAmount,
    paymentCount: sortedPayments.length,
    lastPaymentDate: lastPayment?.date || "",
  };
}

export function normalizeDocument(type, doc) {
  if (!doc) return null;
  const baseDocument = {
    type,
    issueDate: toDateInputValue(doc.issueDate) || slugDate(),
    notes: doc.notes || "",
    items: Array.isArray(doc.items) ? doc.items : [],
    sentHistory: Array.isArray(doc.sentHistory) ? doc.sentHistory : [],
  };

  if (type !== "invoice") return baseDocument;

  const dueDate = toDateInputValue(doc.dueDate) || addDaysToDateInput(baseDocument.issueDate, 7);
  const invoiceTotal = calculateInvoiceTotal(baseDocument.items);
  return {
    ...baseDocument,
    dueDate,
    paymentNotes: String(doc.paymentNotes || "").trim(),
    payments: normalizeInvoicePayments(doc, invoiceTotal, dueDate || baseDocument.issueDate),
  };
}

export function getInvoiceStatus(job) {
  const invoice = normalizeDocument("invoice", job?.invoice);

  if (!invoice) {
    return {
      id: "not-invoiced",
      label: "Not invoiced",
      className: "bg-slate-100 text-slate-700",
      rank: 0,
    };
  }

  const paymentSummary = getInvoicePaymentSummary(invoice);

  if (paymentSummary.total > 0 && paymentSummary.balanceAmount <= 0) {
    return {
      id: "paid",
      label: "Paid",
      className: "bg-emerald-100 text-emerald-800",
      rank: 6,
    };
  }

  const today = toDateInputValue(new Date());
  if (paymentSummary.balanceAmount > 0 && invoice.dueDate && invoice.dueDate < today) {
    return {
      id: "overdue",
      label: "Overdue",
      className: "bg-rose-100 text-rose-800",
      rank: 1,
    };
  }

  if (paymentSummary.paidAmount > 0) {
    return {
      id: paymentSummary.paymentCount <= 1 ? "deposit-paid" : "partially-paid",
      label: paymentSummary.paymentCount <= 1 ? "Deposit Paid" : "Partially Paid",
      className: paymentSummary.paymentCount <= 1 ? "bg-amber-100 text-amber-800" : "bg-violet-100 text-violet-800",
      rank: paymentSummary.paymentCount <= 1 ? 4 : 5,
    };
  }

  if (invoice.sentHistory?.length) {
    return {
      id: "unpaid",
      label: "Unpaid",
      className: "bg-sky-100 text-sky-800",
      rank: 3,
    };
  }

  return {
    id: "draft",
    label: "Draft",
    className: "bg-amber-100 text-amber-800",
    rank: 2,
  };
}

export function normalizeJobRecord(job) {
  const rawTomorrowOrder = job?.serviceBoardTomorrowOrder;
  const tomorrowOrderValue = Number(rawTomorrowOrder);
  const hasTomorrowOrder = rawTomorrowOrder !== null && rawTomorrowOrder !== undefined && Number.isFinite(tomorrowOrderValue);
  const legacyBillingContact = normalizeJobContactSnapshot(
    job?.customerEmail || job?.customerPhone
      ? {
          id: String(job?.billingContact?.id || "").trim(),
          name: job?.billingContact?.name || job?.customerName,
          role: job?.billingContact?.role || "Billing contact",
          phone: job?.billingContact?.phone || job?.customerPhone,
          email: job?.billingContact?.email || job?.customerEmail,
          notes: job?.billingContact?.notes || "",
        }
      : job?.billingContact,
    "Billing contact"
  );

  return {
    ...job,
    jobNumber: Number.isInteger(Number(job?.jobNumber)) && Number(job.jobNumber) > 0 ? Number(job.jobNumber) : null,
    scheduledDate: toDateInputValue(job?.scheduledDate),
    assignedTechnicianId: "",
    assignedTechnicianName: "",
    maintenancePlanId: String(job?.maintenancePlanId || "").trim(),
    maintenancePlanName: String(job?.maintenancePlanName || "").trim(),
    maintenanceDueDate: toDateInputValue(job?.maintenanceDueDate),
    serviceBoardTomorrowDate: toDateInputValue(job?.serviceBoardTomorrowDate),
    serviceBoardTomorrowOrder: hasTomorrowOrder ? tomorrowOrderValue : null,
    ocNumber: String(job?.ocNumber || "").trim(),
    notes: Array.isArray(job.notes) ? job.notes : [],
    photos: Array.isArray(job.photos) ? job.photos : [],
    requesterContact: normalizeJobContactSnapshot(job?.requesterContact, "Requester"),
    onsiteContact: normalizeJobContactSnapshot(job?.onsiteContact, "On-site contact"),
    billingContact: legacyBillingContact,
    quote: normalizeDocument("quote", job.quote),
    invoice: normalizeDocument("invoice", job.invoice),
  };
}

export function normalizeDeletedJobRecord(record) {
  if (!record) return null;
  return {
    deletedAt: record.deletedAt || new Date().toISOString(),
    job: normalizeJobRecord(record.job || record),
  };
}

export function assignJobNumbers(jobs) {
  const usedNumbers = new Set(
    jobs
      .map((job) => (Number.isInteger(Number(job?.jobNumber)) && Number(job.jobNumber) > 0 ? Number(job.jobNumber) : null))
      .filter(Boolean)
  );
  let nextNumber = 1;

  const jobNumbersById = new Map();
  [...jobs]
    .sort((a, b) => {
      const createdDiff = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return String(a.id).localeCompare(String(b.id));
    })
    .forEach((job) => {
      let jobNumber = Number.isInteger(Number(job?.jobNumber)) && Number(job.jobNumber) > 0 ? Number(job.jobNumber) : null;
      if (!jobNumber) {
        while (usedNumbers.has(nextNumber)) nextNumber += 1;
        jobNumber = nextNumber;
        usedNumbers.add(jobNumber);
        nextNumber += 1;
      }
      jobNumbersById.set(job.id, jobNumber);
    });

  return jobs.map((job) => ({
    ...job,
    jobNumber: jobNumbersById.get(job.id) || job.jobNumber,
  }));
}

export function getNextJobNumber(jobs) {
  return (
    jobs.reduce((max, job) => {
      const jobNumber = Number.isInteger(Number(job?.jobNumber)) && Number(job.jobNumber) > 0 ? Number(job.jobNumber) : 0;
      return Math.max(max, jobNumber);
    }, 0) + 1
  );
}

function buildContactSignature(contact) {
  return [
    String(contact?.name || "").trim().toLowerCase(),
    String(contact?.email || "").trim().toLowerCase(),
    String(contact?.phone || "").trim(),
  ].join("|");
}

export function normalizeContactRecord(contact, fallback = {}) {
  if (!contact && !fallback) return null;

  const normalized = {
    id: String(contact?.id || fallback.id || "").trim() || crypto.randomUUID(),
    name: String(contact?.name || fallback.name || "").trim(),
    role: String(contact?.role || fallback.role || "").trim(),
    phone: String(contact?.phone || fallback.phone || "").trim(),
    email: String(contact?.email || fallback.email || "").trim(),
    notes: String(contact?.notes || fallback.notes || "").trim(),
  };

  if (!normalized.name && !normalized.phone && !normalized.email && !normalized.notes) {
    return null;
  }

  return normalized;
}

export function normalizeCustomerContacts(contacts, { customerId = "", customerName = "", email = "", phone = "", sites = [] } = {}) {
  const nextContacts = [];

  const addContact = (contact, fallback = {}) => {
    const normalized = normalizeContactRecord(contact, fallback);
    if (!normalized) return null;

    const signature = buildContactSignature(normalized);
    const existing = nextContacts.find((entry) => entry.id === normalized.id || (signature && buildContactSignature(entry) === signature));
    if (existing) return existing;

    nextContacts.push(normalized);
    return normalized;
  };

  if (Array.isArray(contacts)) {
    contacts.forEach((contact) => addContact(contact));
  }

  if (email || phone) {
    addContact(
      {
        id: customerId ? `${customerId}-primary-contact` : "",
        name: customerName,
        role: "Primary contact",
        email,
        phone,
      },
      {
        id: customerId ? `${customerId}-primary-contact` : "",
        name: customerName,
        role: "Primary contact",
        email,
        phone,
      }
    );
  }

  (Array.isArray(sites) ? sites : []).forEach((site) => {
    if (!site?.contactName && !site?.contactPhone && !site?.contactEmail) return;

    addContact(
      {
        id: String(site.contactId || "").trim() || (site.id ? `${site.id}-site-contact` : ""),
        name: site.contactName,
        role: "Site contact",
        phone: site.contactPhone,
        email: site.contactEmail,
      },
      {
        id: site.id ? `${site.id}-site-contact` : "",
        role: "Site contact",
      }
    );
  });

  return nextContacts.sort((a, b) => getContactDisplayName(a).localeCompare(getContactDisplayName(b)) || a.role.localeCompare(b.role));
}

export function normalizeJobContactSnapshot(contact, fallbackRole = "") {
  return normalizeContactRecord(contact, {
    role: fallbackRole,
    id: String(contact?.id || "").trim(),
  });
}

export function buildContactSnapshot(contact, fallbackRole = "") {
  return normalizeJobContactSnapshot(
    contact
      ? {
          id: contact.id,
          name: contact.name,
          role: contact.role || fallbackRole,
          phone: contact.phone,
          email: contact.email,
          notes: contact.notes,
        }
      : null,
    fallbackRole
  );
}

export function getContactDisplayName(contact) {
  if (!contact) return "Unnamed contact";
  return contact.name || contact.email || contact.phone || "Unnamed contact";
}

export function getCustomerContacts(customer) {
  return normalizeCustomerContacts(customer?.contacts, {
    customerId: customer?.id,
    customerName: customer?.name,
    email: customer?.email,
    phone: customer?.phone,
    sites: normalizeCustomerSiteProfiles(customer?.sites, customer?.address, customer?.siteAccessNotes),
  });
}

export function getCustomerBillingContact(customer) {
  const contacts = getCustomerContacts(customer);
  const billingContactId = String(customer?.billingContactId || "").trim();
  return contacts.find((contact) => contact.id === billingContactId)
    || contacts.find((contact) => contact.email)
    || contacts[0]
    || null;
}

export function normalizeCustomerRecord(customer, fallbackCreatedAt) {
  const normalizedCustomer = customer || {};
  const address = normalizeSiteAddress(normalizedCustomer.address);
  const baseSites = normalizeCustomerSiteProfiles(normalizedCustomer.sites, address, normalizedCustomer.siteAccessNotes);
  const contacts = normalizeCustomerContacts(normalizedCustomer.contacts, {
    customerId: normalizedCustomer.id,
    customerName: normalizedCustomer.name,
    email: normalizedCustomer.email,
    phone: normalizedCustomer.phone,
    sites: baseSites,
  });
  const sites = baseSites.map((site) => {
    const resolvedContact = resolveSiteContactRecord(site, contacts);
    return normalizeSiteProfileRecord({
      ...site,
      contactId: resolvedContact?.id || site.contactId || "",
      contactName: resolvedContact?.name || site.contactName || "",
      contactPhone: resolvedContact?.phone || site.contactPhone || "",
      contactEmail: resolvedContact?.email || site.contactEmail || "",
    });
  });
  const siteAccessNotes = normalizeSiteAccessNotes([
    ...(Array.isArray(normalizedCustomer.siteAccessNotes) ? normalizedCustomer.siteAccessNotes : []),
    ...sites
      .filter((site) => site.accessNotes)
      .map((site) => ({
        id: site.id,
        address: site.address,
        notes: site.accessNotes,
        updatedAt: site.updatedAt,
      })),
  ]);
  const resolvedBillingContact = contacts.find((contact) => contact.id === String(normalizedCustomer.billingContactId || "").trim())
    || contacts.find((contact) => contact.email)
    || contacts[0]
    || null;

  return {
    ...normalizedCustomer,
    id: normalizedCustomer.id || crypto.randomUUID(),
    name: String(normalizedCustomer.name || "").trim() || "Unnamed customer",
    email: String(normalizedCustomer.email || "").trim(),
    phone: String(normalizedCustomer.phone || "").trim(),
    customerType: normalizeOptionValue(normalizedCustomer.customerType, customerTypeOptions, ""),
    contacts,
    billingContactId: resolvedBillingContact?.id || "",
    address,
    sites,
    siteAccessNotes,
    createdAt: normalizedCustomer.createdAt || fallbackCreatedAt || new Date().toISOString(),
  };
}

export function normalizeSiteAddress(address) {
  return String(address || "").replace(/\s+/g, " ").trim();
}

export function normalizeSiteAccessNoteRecord(note) {
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

export function normalizeSiteAccessNotes(notes) {
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

      const latest = toTimestamp(note.updatedAt) >= toTimestamp(existing.updatedAt) ? note : existing;
      noteMap.set(key, {
        ...latest,
        notes: latest.notes,
      });
    });

  return [...noteMap.values()].sort((a, b) => a.address.localeCompare(b.address));
}

export function normalizeSiteAssetRecord(asset) {
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

export function normalizeSiteAssets(assets) {
  if (!Array.isArray(assets)) return [];

  return assets
    .map(normalizeSiteAssetRecord)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

function resolveSiteContactRecord(siteProfile, customerContacts = []) {
  const contactId = String(siteProfile?.contactId || "").trim();
  const linkedContact = contactId ? customerContacts.find((contact) => contact.id === contactId) || null : null;

  return buildContactSnapshot(
    linkedContact || {
      id: contactId,
      name: siteProfile?.contactName,
      phone: siteProfile?.contactPhone,
      email: siteProfile?.contactEmail,
      role: "Site contact",
    },
    "Site contact"
  );
}

export function normalizeSiteProfileRecord(site, fallbackAddress = "", legacyAccessNote = null) {
  const address = normalizeSiteAddress(site?.address || fallbackAddress || legacyAccessNote?.address);
  if (!address) return null;

  return {
    id: site?.id || crypto.randomUUID(),
    label: String(site?.label || "").trim(),
    address,
    siteType: normalizeOptionValue(site?.siteType, siteTypeOptions, ""),
    ocNumber: String(site?.ocNumber || "").trim(),
    accessNotes: String(site?.accessNotes ?? legacyAccessNote?.notes ?? "").trim(),
    notes: String(site?.notes || "").trim(),
    contactId: String(site?.contactId || "").trim(),
    contactName: String(site?.contactName || "").trim(),
    contactPhone: String(site?.contactPhone || "").trim(),
    contactEmail: String(site?.contactEmail || "").trim(),
    assets: normalizeSiteAssets(site?.assets),
    createdAt: site?.createdAt || legacyAccessNote?.updatedAt || new Date().toISOString(),
    updatedAt: site?.updatedAt || legacyAccessNote?.updatedAt || site?.createdAt || new Date().toISOString(),
  };
}

export function mergeSiteProfileRecords(existing, incoming) {
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
    contactId: hasExplicitField("contactId") ? incoming.contactId : existing.contactId,
    contactName: hasExplicitField("contactName") ? incoming.contactName : existing.contactName,
    contactPhone: hasExplicitField("contactPhone") ? incoming.contactPhone : existing.contactPhone,
    contactEmail: hasExplicitField("contactEmail") ? incoming.contactEmail : existing.contactEmail,
    assets: hasExplicitField("assets") ? incoming.assets : existing.assets,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt:
      hasExplicitField("updatedAt") && toTimestamp(incoming.updatedAt) >= toTimestamp(existing.updatedAt)
        ? incoming.updatedAt || existing.updatedAt
        : existing.updatedAt,
  });
}

export function normalizeCustomerSiteProfiles(sites, primaryAddress = "", legacySiteAccessNotes = []) {
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
            contactId: hasOwn(site, "contactId"),
            contactName: hasOwn(site, "contactName"),
            contactPhone: hasOwn(site, "contactPhone"),
            contactEmail: hasOwn(site, "contactEmail"),
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

export function getCustomerSiteProfile(customer, siteIdentifier) {
  if (!customer || !siteIdentifier) return null;

  const normalizedIdentifier = normalizeSiteAddress(siteIdentifier).toLowerCase();
  const siteProfile = (
    normalizeCustomerSiteProfiles(customer.sites, customer.address, customer.siteAccessNotes).find(
      (site) => site.id === siteIdentifier || site.address.toLowerCase() === normalizedIdentifier
    ) || null
  );

  if (!siteProfile) return null;

  const resolvedContact = resolveSiteContactRecord(siteProfile, getCustomerContacts(customer));
  return {
    ...siteProfile,
    contactId: resolvedContact?.id || siteProfile.contactId || "",
    contactName: resolvedContact?.name || siteProfile.contactName || "",
    contactPhone: resolvedContact?.phone || siteProfile.contactPhone || "",
    contactEmail: resolvedContact?.email || siteProfile.contactEmail || "",
  };
}

export function normalizeChecklistItems(items) {
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

export function addMonthsToDateInput(value, months) {
  const normalized = toDateInputValue(value);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return toDateInputValue(date);
}

export function getMaintenanceFrequencyMeta(frequency) {
  return maintenanceFrequencyOptions.find((option) => option.value === frequency) || maintenanceFrequencyOptions[1];
}

export function getNextMaintenanceDueDate(currentDueDate, frequency) {
  const intervalMonths = getMaintenanceFrequencyMeta(frequency).intervalMonths;
  return addMonthsToDateInput(currentDueDate, intervalMonths);
}

export function normalizeMaintenancePlanRecord(plan) {
  if (!plan) return null;

  return {
    id: plan.id || crypto.randomUUID(),
    planName: String(plan.planName || "").trim() || "Untitled maintenance plan",
    customerId: String(plan.customerId || "").trim(),
    siteAddress: normalizeSiteAddress(plan.siteAddress),
    frequency: normalizeOptionValue(plan.frequency, maintenanceFrequencyOptions, maintenanceFrequencyOptions[1].value),
    nextDueDate: toDateInputValue(plan.nextDueDate),
    defaultTechnicianId: "",
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

export function getSuggestedMaintenanceSite(customer, jobs) {
  if (!customer) return "";
  return buildCustomerSites(customer, jobs)[0]?.address || normalizeSiteAddress(customer.address);
}

export function getMaintenancePlanJobs(planId, jobs) {
  return jobs
    .filter((job) => job.maintenancePlanId === planId)
    .sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt));
}

export function getMaintenancePlanStatus(plan, jobs) {
  const linkedJobs = getMaintenancePlanJobs(plan.id, jobs);
  const activeJobs = linkedJobs.filter((job) => job.status !== "Completed");
  if (activeJobs.length > 0) {
    return {
      id: "active-job",
      label: activeJobs.length === 1 ? "Active job" : `${activeJobs.length} active jobs`,
      className: "bg-sky-100 text-sky-800",
      rank: 0,
    };
  }

  if (!plan.nextDueDate) {
    return {
      id: "unscheduled",
      label: "No due date",
      className: "bg-slate-100 text-slate-700",
      rank: 4,
    };
  }

  const today = slugDate();
  if (plan.nextDueDate < today) {
    return {
      id: "overdue",
      label: "Overdue",
      className: "bg-rose-100 text-rose-800",
      rank: 1,
    };
  }

  if (plan.nextDueDate <= addDaysToDateInput(today, 7)) {
    return {
      id: "due-soon",
      label: plan.nextDueDate === today ? "Due today" : "Due soon",
      className: "bg-amber-100 text-amber-800",
      rank: 2,
    };
  }

  return {
    id: "upcoming",
    label: "Upcoming",
    className: "bg-emerald-100 text-emerald-800",
    rank: 3,
  };
}

export function buildMaintenanceJobDescription(plan) {
  const sections = [
    `Recurring maintenance visit for ${plan.planName}.`,
    plan.siteAddress ? `Site: ${plan.siteAddress}` : "",
    `Frequency: ${getMaintenanceFrequencyMeta(plan.frequency).label}`,
    plan.notes ? `Plan notes: ${plan.notes}` : "",
    plan.checklist.length > 0
      ? `Checklist:\n${plan.checklist.map((item) => `- ${item}`).join("\n")}`
      : "",
  ];

  return sections.filter(Boolean).join("\n\n");
}

export function buildCustomerSites(customer, jobs) {
  const siteMap = new Map();
  const siteProfiles = normalizeCustomerSiteProfiles(customer?.sites, customer?.address, customer?.siteAccessNotes);
  const customerContacts = getCustomerContacts(customer);
  const primaryAddress = normalizeSiteAddress(customer?.address);

  const addSite = (address, { job = null, primary = false, siteProfile = null } = {}) => {
    const normalizedAddress = normalizeSiteAddress(address);
    if (!normalizedAddress) return;

    const key = normalizedAddress.toLowerCase();
    const current = siteMap.get(key) || {
      id: key,
      address: normalizedAddress,
      siteProfileId: "",
      label: "",
      isPrimary: false,
      jobCount: 0,
      openJobCount: 0,
      completedJobCount: 0,
      latestUpdatedAt: "",
      accessNotes: "",
      accessNotesUpdatedAt: "",
      profileNotes: "",
      siteType: "",
      ocNumber: "",
      contactId: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      assets: [],
      assetCount: 0,
    };

    if (primary) current.isPrimary = true;

    if (job) {
      current.jobCount += 1;
      if (job.status === "Completed") {
        current.completedJobCount += 1;
      } else {
        current.openJobCount += 1;
      }
      if (toTimestamp(job.updatedAt) > toTimestamp(current.latestUpdatedAt)) {
        current.latestUpdatedAt = job.updatedAt;
      }
    }

    if (siteProfile) {
      const resolvedContact = resolveSiteContactRecord(siteProfile, customerContacts);
      current.siteProfileId = siteProfile.id;
      current.label = siteProfile.label;
      current.profileNotes = siteProfile.notes;
      current.siteType = siteProfile.siteType;
      current.ocNumber = siteProfile.ocNumber;
      current.contactId = resolvedContact?.id || siteProfile.contactId || "";
      current.contactName = resolvedContact?.name || siteProfile.contactName || "";
      current.contactPhone = resolvedContact?.phone || siteProfile.contactPhone || "";
      current.contactEmail = resolvedContact?.email || siteProfile.contactEmail || "";
      current.assets = normalizeSiteAssets(siteProfile.assets);
      current.assetCount = current.assets.length;
      current.accessNotes = siteProfile.accessNotes;
      current.accessNotesUpdatedAt = siteProfile.updatedAt || current.accessNotesUpdatedAt;
      if (toTimestamp(siteProfile.updatedAt) > toTimestamp(current.latestUpdatedAt)) {
        current.latestUpdatedAt = siteProfile.updatedAt;
      }
    }

    siteMap.set(key, current);
  };

  addSite(primaryAddress, { primary: true });
  jobs.forEach((job) => addSite(job.jobAddress, { job }));
  siteProfiles.forEach((siteProfile) =>
    addSite(siteProfile.address, {
      siteProfile,
      primary: Boolean(primaryAddress) && siteProfile.address.toLowerCase() === primaryAddress.toLowerCase(),
    })
  );

  return [...siteMap.values()].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return toTimestamp(b.latestUpdatedAt) - toTimestamp(a.latestUpdatedAt) || a.address.localeCompare(b.address);
  });
}

export function getSiteDisplayName(site) {
  return site?.address || site?.label || "Unnamed site";
}

export function getCustomerSiteAccessNote(customer, address) {
  const siteProfile = getCustomerSiteProfile(customer, address);
  if (!siteProfile?.accessNotes) return null;

  return {
    id: siteProfile.id,
    address: siteProfile.address,
    notes: siteProfile.accessNotes,
    updatedAt: siteProfile.updatedAt,
  };
}

export function getCustomerSitePrimaryContact(customer, siteIdentifier) {
  const siteProfile = getCustomerSiteProfile(customer, siteIdentifier);
  if (!siteProfile) return null;
  return buildContactSnapshot(
    {
      id: siteProfile.contactId,
      name: siteProfile.contactName,
      phone: siteProfile.contactPhone,
      email: siteProfile.contactEmail,
      role: "Site contact",
    },
    "Site contact"
  );
}

export function buildSiteProfileDraft(site) {
  if (!site) {
    return {
      id: crypto.randomUUID(),
      label: "",
      address: "",
      siteType: "",
      ocNumber: "",
      accessNotes: "",
      notes: "",
      contactId: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      assets: [],
    };
  }

  return {
    id: site.siteProfileId || site.id || crypto.randomUUID(),
    label: "",
    address: normalizeSiteAddress(site.address),
    siteType: normalizeOptionValue(site.siteType, siteTypeOptions, ""),
    ocNumber: String(site.ocNumber || "").trim(),
    accessNotes: String(site.accessNotes || "").trim(),
    notes: String(site.profileNotes || site.notes || "").trim(),
    contactId: String(site.contactId || "").trim(),
    contactName: String(site.contactName || "").trim(),
    contactPhone: String(site.contactPhone || "").trim(),
    contactEmail: String(site.contactEmail || "").trim(),
    assets: normalizeSiteAssets(site.assets),
  };
}

export function normalizeInventoryRecord(item) {
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

export function getInventoryStockStatus(item) {
  const quantity = normalizeNumber(item?.quantity, 0);
  const reorderLevel = normalizeNumber(item?.reorderLevel, 0);

  if (quantity <= 0) {
    return { id: "out", label: "Out of stock", className: "bg-rose-100 text-rose-800" };
  }

  if (reorderLevel > 0 && quantity <= reorderLevel) {
    return { id: "low", label: "Low stock", className: "bg-amber-100 text-amber-800" };
  }

  return { id: "in", label: "In stock", className: "bg-emerald-100 text-emerald-800" };
}

export function normalizeStaffRecord(staffMember) {
  if (!staffMember) return null;
  const createdAt = staffMember.createdAt || new Date().toISOString();
  return {
    ...(staffMember && typeof staffMember === "object" && !Array.isArray(staffMember) ? staffMember : {}),
    id: staffMember.id || crypto.randomUUID(),
    name: staffMember.name || "Unnamed staff member",
    role: staffMember.role || "Staff",
    email: staffMember.email || "",
    phone: staffMember.phone || "",
    createdAt,
    ...(staffMember.updatedAt ? { updatedAt: staffMember.updatedAt } : {}),
  };
}

export function normalizeDeletedCustomerRecord(record) {
  if (!record) return null;
  return {
    deletedAt: record.deletedAt || new Date().toISOString(),
    customer: normalizeCustomerRecord(record.customer || record),
  };
}

export function syncJobWithCustomer(job, customer) {
  if (!customer) return job;
  const billingContact = getCustomerBillingContact(customer);
  return {
    ...job,
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email || billingContact?.email || "",
    customerPhone: customer.phone || billingContact?.phone || "",
  };
}

export function syncJobWithStaff(job) {
  return {
    ...job,
    assignedTechnicianId: "",
    assignedTechnicianName: "",
  };
}

export function purgeExpiredRecycleBinState(state) {
  const cutoff = Date.now() - RECYCLE_BIN_RETENTION_MS;
  const deletedJobs = (state.deletedJobs || []).filter((record) => toTimestamp(record.deletedAt) >= cutoff);
  const deletedCustomers = (state.deletedCustomers || []).filter((record) => toTimestamp(record.deletedAt) >= cutoff);

  if (
    deletedJobs.length === (state.deletedJobs || []).length &&
    deletedCustomers.length === (state.deletedCustomers || []).length
  ) {
    return state;
  }

  return {
    ...state,
    deletedJobs,
    deletedCustomers,
  };
}

export function normalizeAppState(savedState) {
  const staff = Array.isArray(savedState?.staff)
    ? savedState.staff.map(normalizeStaffRecord).filter(Boolean)
    : seedData.staff.map(normalizeStaffRecord).filter(Boolean);
  const jobs = Array.isArray(savedState?.jobs)
    ? assignJobNumbers(savedState.jobs.map(normalizeJobRecord))
    : [];
  const earliestJobByCustomerId = jobs.reduce((map, job) => {
    const existing = map.get(job.customerId);
    if (!existing || new Date(job.createdAt).getTime() < new Date(existing).getTime()) {
      map.set(job.customerId, job.createdAt);
    }
    return map;
  }, new Map());
  const customers = Array.isArray(savedState?.customers)
    ? savedState.customers.map((customer) => normalizeCustomerRecord(customer, earliestJobByCustomerId.get(customer.id)))
    : seedData.customers.map((customer) => normalizeCustomerRecord(customer));
  const inventoryItems = Array.isArray(savedState?.inventoryItems)
    ? savedState.inventoryItems.map(normalizeInventoryRecord).filter(Boolean)
    : Array.isArray(savedState?.parts)
      ? savedState.parts.map(normalizeInventoryRecord).filter(Boolean)
      : (seedData.inventoryItems || []).map(normalizeInventoryRecord).filter(Boolean);
  const maintenancePlans = Array.isArray(savedState?.maintenancePlans)
    ? savedState.maintenancePlans.map(normalizeMaintenancePlanRecord).filter(Boolean)
    : savedState
      ? []
      : (seedData.maintenancePlans || []).map(normalizeMaintenancePlanRecord).filter(Boolean);
  const deletedJobs = Array.isArray(savedState?.deletedJobs)
    ? savedState.deletedJobs.map(normalizeDeletedJobRecord).filter(Boolean)
    : [];
  const deletedCustomers = Array.isArray(savedState?.deletedCustomers)
    ? savedState.deletedCustomers.map(normalizeDeletedCustomerRecord).filter(Boolean)
    : [];

  return purgeExpiredRecycleBinState({
    staff,
    customers,
    inventoryItems,
    maintenancePlans,
    jobs,
    deletedJobs,
    deletedCustomers,
    quoteTemplate: normalizeQuoteTemplate(savedState?.quoteTemplate),
    invoiceTemplate: normalizeInvoiceTemplate(savedState?.invoiceTemplate),
    settings: normalizeThemeSettings(savedState?.settings),
  });
}

export function getInitialState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeAppState(JSON.parse(saved));
  } catch {
    // Ignore invalid persisted state and fall back to seeded demo data.
  }

  const [c1, c2] = seedData.customers;
  const demoJobs = [
    {
      id: crypto.randomUUID(),
      jobNumber: 1,
      title: "Sliding gate motor fault",
      description: "Gate intermittently stops halfway. Inspect motor, control board, and limit settings.",
      urgency: "High",
      status: "To Do",
      assignedTechnicianId: "",
      assignedTechnicianName: "",
      customerId: c1.id,
      customerName: c1.name,
      customerEmail: c1.email,
      customerPhone: c1.phone,
      jobAddress: c1.address,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: [],
      photos: [],
      quote: null,
      invoice: null,
    },
    {
      id: crypto.randomUUID(),
      jobNumber: 2,
      title: "Boom gate annual service",
      description: "Preventive maintenance and safety inspection for entry boom gate.",
      urgency: "Medium",
      status: "In Progress",
      assignedTechnicianId: "",
      assignedTechnicianName: "",
      customerId: c2.id,
      customerName: c2.name,
      customerEmail: c2.email,
      customerPhone: c2.phone,
      jobAddress: c2.address,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: [{ id: crypto.randomUUID(), author: "Office", text: "On site. Found worn hinge and weak battery backup.", createdAt: new Date().toISOString() }],
      photos: [],
      quote: {
        type: "quote",
        issueDate: slugDate(),
        notes: "Valid for 14 days.",
        sentHistory: [],
        items: [
          { id: crypto.randomUUID(), description: "Battery backup replacement", qty: 1, rate: 220 },
          { id: crypto.randomUUID(), description: "Service labour", qty: 1.5, rate: 135 },
        ],
      },
      invoice: null,
    },
  ];

  return {
    staff: seedData.staff.map(normalizeStaffRecord),
    customers: seedData.customers.map((customer) => normalizeCustomerRecord(customer)),
    maintenancePlans: (seedData.maintenancePlans || []).map(normalizeMaintenancePlanRecord),
    jobs: assignJobNumbers(demoJobs.map(normalizeJobRecord)),
    deletedJobs: [],
    deletedCustomers: [],
    quoteTemplate: normalizeQuoteTemplate(seedData.quoteTemplate),
    invoiceTemplate: normalizeInvoiceTemplate(seedData.invoiceTemplate),
    settings: normalizeThemeSettings(seedData.settings),
  };
}

export function getLegacyPersistedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeAppState(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export function hasCompletedServerMigration() {
  try {
    return localStorage.getItem(AUTH_MIGRATION_KEY) === "done";
  } catch {
    return false;
  }
}

export function markServerMigrationComplete() {
  try {
    localStorage.setItem(AUTH_MIGRATION_KEY, "done");
  } catch {
    // Ignore local storage write issues.
  }
}

export function createTemplatePreviewFixture(type) {
  const customer =
    previewCustomerFixtures[Math.floor(Math.random() * previewCustomerFixtures.length)] ||
    previewCustomerFixtures[0];

  if (type === "invoice") {
    return {
      job: {
        id: "preview-invoice",
        jobNumber: 101,
        description: "Scheduled service and safety inspection completed for the main entry system.",
        ...customer,
      },
      document: {
        type: "invoice",
        issueDate: slugDate(),
        notes: "Scheduled service and safety inspection completed as listed.",
        items: [
          { id: "preview-invoice-1", description: "Scheduled service labour", qty: 2, rate: 145 },
          { id: "preview-invoice-2", description: "Replacement gate safety edge", qty: 1, rate: 265 },
        ],
      },
    };
  }

  return {
    job: {
      id: "preview-quote",
      jobNumber: 42,
      description: "Inspect the existing gate automation, diagnose intermittent faults, and quote required safety sensor replacement.",
      ...customer,
    },
    document: {
      type: "quote",
      issueDate: slugDate(),
      notes: "Access is required between 8am and 4pm. Pricing includes labour and listed parts only.",
      items: [
        { id: "preview-quote-1", description: "Gate motor inspection and diagnosis", qty: 1, rate: 180 },
        { id: "preview-quote-2", description: "Replacement safety sensor pair", qty: 1, rate: 240 },
      ],
    },
  };
}

export function buildDefaultDoc(job, type) {
  const isInvoice = type === "invoice";
  const issueDate = slugDate();
  return {
    type,
    issueDate,
    notes: "",
    ...(isInvoice
      ? {
          dueDate: addDaysToDateInput(issueDate, 7),
          paymentNotes: "",
          payments: [],
        }
      : {}),
    sentHistory: [],
    items: [
      {
        id: crypto.randomUUID(),
        description: isInvoice ? `Labour for ${job.title}` : `${job.title} assessment / parts estimate`,
        qty: 1,
        rate: isInvoice ? 165 : 150,
      },
    ],
  };
}
