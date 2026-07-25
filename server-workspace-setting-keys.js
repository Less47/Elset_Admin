import { ADMIN_EMAIL } from "./src/lib/quote-template.js";

export const workspaceUiSettingKeys = [
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

export const workspacePreferenceSettingKeys = [
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

export const defaultWorkspaceSettings = {
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

const secretKeyPattern = /(?:password|secret|token|api[_-]?key|oauth|smtp[_-]?pass|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)/i;

export function isWorkspaceSecretSettingKey(key) {
  return secretKeyPattern.test(String(key || ""));
}
