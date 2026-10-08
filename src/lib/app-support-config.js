import { ADMIN_EMAIL } from "@/lib/quote-template";

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
export { maintenanceFrequencyOptions } from "./maintenance-frequency.js";

export const defaultThemeSettings = {
  pageBackgroundStart: "#0F90CD",
  pageBackgroundEnd: "#0F90CD",
  sidebarSurface: "#FFFFFF",
  sidebarActive: "#F69320",
  heroSurface: "#0F90CD",
  actionColor: "#F69320",
  borderColor: "#1E293B",
  dialogSurface: "#9FE4FB",
  dataViewSurface: "#EAF7FB",
  dataViewAccent: "#0F90CD",
  roundedEdges: true,
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
  "sidebarActive",
  "heroSurface",
  "actionColor",
  "borderColor",
  "dialogSurface",
  "dataViewSurface",
  "dataViewAccent",
  "roundedEdges",
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

export const inventoryCategories = ["Automation", "Access Control", "Electrical", "Hardware", "Consumables", "Tools", "Other"];
