import { ADMIN_EMAIL } from "@/lib/quote-template";

export const STORAGE_KEY = "gateflow-demo-v1";
export const AUTH_MIGRATION_KEY = "gateflow-server-migration-v1";
export const LOGO_SRC = "/elset-logo.png";
export const RECYCLE_BIN_RETENTION_MS = 1000 * 60 * 60 * 24 * 7;
export const APP_TEXT_DARK = "#0F172A";
export const APP_TEXT_LIGHT = "#FFFFFF";

export const defaultStaffMembers = [
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

export const urgencyOptions = ["Low", "Medium", "High"];
export const loginAccessRoleOptions = [
  { value: "technician", label: "Technician" },
  { value: "office", label: "Office" },
  { value: "admin", label: "Admin" },
];
export const customerTypeOptions = [
  { value: "homeowner", label: "Homeowner" },
  { value: "strata", label: "Strata" },
  { value: "property-manager", label: "Property Manager" },
  { value: "builder", label: "Builder" },
  { value: "business", label: "Business" },
  { value: "government", label: "Government" },
  { value: "other", label: "Other" },
];
export const siteTypeOptions = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "industrial", label: "Industrial" },
  { value: "mixed-use", label: "Mixed Use" },
  { value: "other", label: "Other" },
];
export const maintenanceFrequencyOptions = [
  { value: "monthly", label: "Monthly", intervalMonths: 1 },
  { value: "quarterly", label: "Quarterly", intervalMonths: 3 },
  { value: "six-monthly", label: "6 Monthly", intervalMonths: 6 },
  { value: "annual", label: "Annual", intervalMonths: 12 },
];

export const defaultThemeSettings = {
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
  sidebarWidth: "standard",
  contentDensity: "comfortable",
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

export const uiSettingKeys = [
  "pageBackgroundStart",
  "pageBackgroundEnd",
  "sidebarSurface",
  "sidebarHeader",
  "sidebarActive",
  "heroSurface",
  "actionColor",
  "borderColor",
  "dialogSurface",
  "dataViewSurface",
  "dataViewAccent",
  "sidebarWidth",
  "contentDensity",
];

export const preferenceSettingKeys = [
  "companyName",
  "companyAbn",
  "companyAcn",
  "companyEmail",
  "companyPhone",
  "companyAddress",
  "bankAccountName",
  "bankBsb",
  "bankAccountNumber",
  "defaultSenderEmail",
  "replyToEmail",
  "quoteCcEmail",
  "invoiceCcEmail",
  "emailSignature",
];

export const sidebarWidthOptions = [
  { value: "icon-only", label: "Icon only", description: "Collapses the sidebar to icons, hides menu titles, and shows only the app favicon at the top." },
  { value: "compact", label: "Compact", description: "Keeps the sidebar tighter and leaves more room for content." },
  { value: "standard", label: "Standard", description: "Balanced spacing for everyday admin work." },
  { value: "wide", label: "Wide", description: "Gives the menu more breathing room and presence." },
];

export const contentDensityOptions = [
  { value: "compact", label: "Compact", description: "Reduces page padding and section gaps." },
  { value: "comfortable", label: "Comfortable", description: "Balanced spacing across the workspace." },
  { value: "spacious", label: "Spacious", description: "Adds extra padding for a more open layout." },
];

export const inventoryCategories = ["Automation", "Access Control", "Electrical", "Hardware", "Consumables", "Tools", "Other"];

export const sidebarWidthStyles = {
  "icon-only": { width: "84px", offset: "108px" },
  compact: { width: "248px", offset: "272px" },
  standard: { width: "280px", offset: "304px" },
  wide: { width: "320px", offset: "344px" },
};
