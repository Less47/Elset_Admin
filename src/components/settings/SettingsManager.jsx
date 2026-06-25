import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  APP_TEXT_DARK,
  APP_TEXT_LIGHT,
  contentDensityOptions,
  createTemplatePreviewFixture,
  getContrastTextColor,
  hexToRgba,
  LOGO_SRC,
  mixHexColors,
  normalizeHexColor,
  normalizeThemeSettings,
  settingsTabs,
  settingsTabMeta,
  sidebarWidthOptions,
  templateTypeOptions,
  themeColorFields,
  themePresets,
} from "@/lib/app-support";
import {
  buildTemplateWithBusinessDetails,
  documentTemplatePlaceholders,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "@/lib/quote-template";

const companyFields = [
  { key: "companyName", label: "Company name", placeholder: "Elset" },
  { key: "companyAbn", label: "ABN", placeholder: "12 345 678 901" },
  { key: "companyAcn", label: "ACN", placeholder: "123 456 789" },
  { key: "companyEmail", label: "Company email", placeholder: "admin@elset.com.au" },
  { key: "companyPhone", label: "Company phone", placeholder: "0400 000 000" },
  { key: "companyAddress", label: "Company address", placeholder: "Street, suburb, state", multiline: true },
];

const bankFields = [
  { key: "bankAccountName", label: "Bank account name", placeholder: "ELSET PTY LTD" },
  { key: "bankBsb", label: "BSB", placeholder: "000-000" },
  { key: "bankAccountNumber", label: "Account number", placeholder: "000000000" },
];

const emailFields = [
  { key: "defaultSenderEmail", label: "Default sender email", placeholder: "admin@elset.com.au" },
  { key: "replyToEmail", label: "Reply-to email", placeholder: "admin@elset.com.au" },
  { key: "quoteCcEmail", label: "Quote CC email", placeholder: "Optional" },
  { key: "invoiceCcEmail", label: "Invoice CC email", placeholder: "Optional" },
];

const serviceM8ImportOptionFields = [
  {
    key: "includeContacts",
    label: "Contacts",
    description: "Use ServiceM8 primary contacts for customer email, phone, and site contacts.",
  },
  {
    key: "includeSchedules",
    label: "Schedules",
    description: "Bring across scheduled dates and match assigned staff where names or emails already exist.",
  },
  {
    key: "includeJobMaterials",
    label: "Line items",
    description: "Convert ServiceM8 job materials into quote or invoice line items.",
  },
  {
    key: "includeJobNotes",
    label: "Job notes",
    description: "Copy ServiceM8 job notes into each imported job history.",
  },
  {
    key: "includePayments",
    label: "Payments",
    description: "Import ServiceM8 job payments onto generated invoice records.",
  },
  {
    key: "includeInactive",
    label: "Inactive records",
    description: "Include inactive ServiceM8 customers and jobs instead of only active records.",
  },
];

const templateFields = [
  { key: "accentColor", label: "Accent colour", type: "color" },
  { key: "quoteHeading", label: "Document heading" },
  { key: "introText", label: "Intro text", multiline: true, rows: 4, documentTypes: ["invoice"] },
  { key: "notesHeading", label: "Notes heading", documentTypes: ["invoice"] },
  { key: "termsHeading", label: "Section heading" },
  { key: "termsText", label: "Section text", multiline: true, rows: 5 },
  { key: "footerText", label: "Footer text", multiline: true, rows: 3 },
];

const presetPreviewKeys = [
  "pageBackgroundStart",
  "pageBackgroundEnd",
  "sidebarHeader",
  "actionColor",
  "dialogSurface",
];

const FAVICON_SRC = "/favicon.png";

function WorkspacePreview({ settings }) {
  const normalizedSettings = normalizeThemeSettings(settings);
  const pageStart = normalizeHexColor(normalizedSettings.pageBackgroundStart, "#0F90CD");
  const pageEnd = normalizeHexColor(normalizedSettings.pageBackgroundEnd, pageStart);
  const sidebarSurface = normalizeHexColor(normalizedSettings.sidebarSurface, "#FFFFFF");
  const sidebarHeader = normalizeHexColor(normalizedSettings.sidebarHeader, "#0F90CD");
  const sidebarActive = normalizeHexColor(normalizedSettings.sidebarActive, "#F69320");
  const heroSurface = normalizeHexColor(normalizedSettings.heroSurface, "#0F90CD");
  const actionColor = normalizeHexColor(normalizedSettings.actionColor, "#F69320");
  const borderColor = normalizeHexColor(normalizedSettings.borderColor, "#1E293B");
  const dialogSurface = normalizeHexColor(normalizedSettings.dialogSurface, "#F8FAFC");
  const dialogText = getContrastTextColor(dialogSurface, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT });
  const dialogSurfaceGradient = `radial-gradient(190% 160% at 50% -18%, ${mixHexColors(dialogSurface, "#FFFFFF", dialogText === APP_TEXT_LIGHT ? 0.16 : 0.32)} 0%, ${dialogSurface} 62%, ${mixHexColors(dialogSurface, APP_TEXT_DARK, dialogText === APP_TEXT_LIGHT ? 0.24 : 0.1)} 100%)`;
  const isIconOnlySidebar = normalizedSettings.sidebarWidth === "icon-only";

  return (
    <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Workspace Preview</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="overflow-hidden rounded-3xl border border-slate-200 shadow-sm"
          style={{
            backgroundImage: `linear-gradient(135deg, ${pageStart} 0%, ${mixHexColors(pageStart, "#FFFFFF", 0.5)} 48%, ${pageEnd} 100%)`,
          }}
        >
          <div className={isIconOnlySidebar ? "grid gap-4 p-4 lg:grid-cols-[72px_1fr]" : "grid gap-4 p-4 lg:grid-cols-[220px_1fr]"}>
            <div
              className="overflow-hidden rounded-2xl border shadow-sm"
              style={{
                backgroundColor: hexToRgba(sidebarSurface, 0.94),
                borderColor,
                color: getContrastTextColor(sidebarSurface, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
              }}
            >
              <div
                className={isIconOnlySidebar ? "flex justify-center p-3" : "p-4"}
                style={{
                  backgroundColor: sidebarHeader,
                  color: getContrastTextColor(sidebarHeader, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
                }}
              >
                {isIconOnlySidebar ? (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/5 bg-white p-2 shadow-sm">
                    <img src={FAVICON_SRC} alt="Elset Admin" className="block h-full w-full object-contain" />
                  </div>
                ) : (
                  <div className="mx-auto grid max-w-full grid-cols-[84px_56px] items-center justify-center gap-2.5">
                    <div className="flex h-12 w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-white px-1 shadow-sm">
                      <img src={LOGO_SRC} alt="Elset logo" className="block h-auto w-[138%] max-w-none" />
                    </div>
                    <div className="min-w-0 self-center text-left font-semibold uppercase leading-none tracking-[0.04em]">
                      <span className="block text-[0.65rem]">Admin</span>
                      <span className="mt-1 block text-[0.8rem]">Menu</span>
                    </div>
                  </div>
                )}
              </div>
              <div className={isIconOnlySidebar ? "grid justify-center gap-2 p-3" : "grid gap-2 p-3"}>
                <div
                  className={isIconOnlySidebar ? "flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-medium shadow-sm" : "rounded-2xl border px-3 py-2 text-sm font-medium shadow-sm"}
                  style={{
                    backgroundColor: sidebarActive,
                    borderColor,
                    color: getContrastTextColor(sidebarActive, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
                  }}
                >
                  {isIconOnlySidebar ? "A" : "Active section"}
                </div>
                {isIconOnlySidebar ? (
                  <>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/70 text-sm">C</div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/70 text-sm">I</div>
                  </>
                ) : (
                  <>
                    <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm">Customers</div>
                    <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm">Invoices</div>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-4">
              <div
                className="rounded-2xl border p-5 shadow-sm"
                style={{
                  backgroundColor: heroSurface,
                  borderColor,
                  color: getContrastTextColor(heroSurface, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
                }}
              >
                <div className="grid gap-4 md:grid-cols-[minmax(110px,1fr)_minmax(0,2fr)_minmax(110px,1fr)] md:items-center">
                  <div className="flex justify-center md:justify-start">
                    <div className="rounded-2xl border border-black/5 bg-white px-3 py-2 shadow-sm">
                      <img src={LOGO_SRC} alt="Elset logo" className="h-9 w-auto" />
                    </div>
                  </div>

                  <div className="text-center">
                    <h3 className="text-2xl font-semibold">Settings Preview</h3>
                  </div>

                  <div className="flex justify-center md:justify-end">
                    <button
                      type="button"
                      className="rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm"
                      style={{
                        backgroundColor: actionColor,
                        borderColor,
                        color: getContrastTextColor(actionColor, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
                      }}
                    >
                      Primary action
                    </button>
                  </div>
                </div>
              </div>

              <div
                className="rounded-2xl border p-5 shadow-sm"
                style={{
                  backgroundImage: dialogSurfaceGradient,
                  backgroundColor: dialogSurface,
                  borderColor,
                  color: dialogText,
                }}
              >
                <p className="text-sm font-semibold">Dialog Gradient Preview</p>
                <p className="mt-2 text-sm opacity-80">
                  Popups, editors, and modals will use a generated gradient based on this one popup colour.
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExactDocumentPreview({ requestBody }) {
  const deferredRequestBody = useDeferredValue(requestBody);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewStatus, setPreviewStatus] = useState("idle");
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!deferredRequestBody) return undefined;

    const controller = new AbortController();

    const loadPreview = async () => {
      setPreviewStatus("loading");
      setPreviewError("");

      try {
        const response = await fetch("/api/quotes/preview-pdf", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: deferredRequestBody,
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Failed to render the exact document preview.");
        }

        const blob = await response.blob();
        const nextPreviewUrl = URL.createObjectURL(blob);

        setPreviewUrl((previousUrl) => {
          if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
          }
          return nextPreviewUrl;
        });
        setPreviewStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreviewStatus("error");
        setPreviewError(error instanceof Error ? error.message : "Failed to render the exact document preview.");
      }
    };

    loadPreview();

    return () => {
      controller.abort();
    };
  }, [deferredRequestBody]);

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">This renders the exact PDF attachment the customer receives.</p>
        {previewStatus === "loading" ? (
          <Badge className="bg-slate-100 text-slate-700">Refreshing preview...</Badge>
        ) : previewStatus === "ready" ? (
          <Badge className="bg-emerald-100 text-emerald-800">Exact PDF preview</Badge>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-sm">
        {previewUrl ? (
          <iframe title="Exact customer document preview" src={previewUrl} className="h-[980px] w-full bg-white" />
        ) : previewStatus === "error" ? (
          <div className="p-6 text-sm text-rose-700">{previewError}</div>
        ) : (
          <div className="p-6 text-sm text-slate-600">Rendering exact preview...</div>
        )}
      </div>

      {previewUrl && previewError ? (
        <p className="text-sm text-rose-700">{previewError}</p>
      ) : null}

      {previewUrl ? (
        <div className="flex justify-end">
          <Button asChild variant="outline" className="rounded-xl">
            <a href={previewUrl} target="_blank" rel="noreferrer">
              Open Full Preview
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function SettingsManager({
  activeSettingsTab,
  onActiveSettingsTabChange,
  settings,
  onSettingChange,
  onApplyPreset,
  onResetUiSettings,
  onResetPreferences,
  activeTemplateType,
  onActiveTemplateTypeChange,
  templates,
  onTemplateChange,
  onResetTemplate,
  isAuthenticated,
  isAdmin,
  onDownloadBackup,
  onRestoreBackup,
  onPreviewServiceM8Import,
  onApplyServiceM8Import,
  backupSummary,
}) {
  const tabMeta = settingsTabMeta[activeSettingsTab] || settingsTabMeta.preferences;
  const normalizedSettings = useMemo(() => normalizeThemeSettings(settings), [settings]);
  const currentTemplateType = activeTemplateType === "invoice" ? "invoice" : "quote";
  const [downloadStatus, setDownloadStatus] = useState("idle");
  const [downloadMessage, setDownloadMessage] = useState("");
  const [restoreStatus, setRestoreStatus] = useState("idle");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreInputKey, setRestoreInputKey] = useState(0);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restorePassword, setRestorePassword] = useState("");
  const [serviceM8ApiKey, setServiceM8ApiKey] = useState("");
  const [serviceM8Options, setServiceM8Options] = useState({
    includeContacts: true,
    includeSchedules: true,
    includeJobMaterials: true,
    includeJobNotes: true,
    includePayments: true,
    includeInactive: false,
  });
  const [serviceM8Status, setServiceM8Status] = useState("idle");
  const [serviceM8Message, setServiceM8Message] = useState("");
  const [serviceM8Summary, setServiceM8Summary] = useState(null);
  const [serviceM8PreviewId, setServiceM8PreviewId] = useState("");

  const activeTemplate = useMemo(() => {
    return currentTemplateType === "invoice"
      ? normalizeInvoiceTemplate(templates?.invoice)
      : normalizeQuoteTemplate(templates?.quote);
  }, [currentTemplateType, templates?.invoice, templates?.quote]);
  const activePreviewTemplate = useMemo(
    () => buildTemplateWithBusinessDetails(activeTemplate, normalizedSettings, currentTemplateType),
    [activeTemplate, currentTemplateType, normalizedSettings]
  );

  const previewFixture = useMemo(() => createTemplatePreviewFixture(currentTemplateType), [currentTemplateType]);
  const previewRequestBody = useMemo(() => JSON.stringify({
    documentType: currentTemplateType,
    job: previewFixture.job,
    document: previewFixture.document,
    template: activePreviewTemplate,
  }), [activePreviewTemplate, currentTemplateType, previewFixture]);
  const visibleTemplateFields = useMemo(
    () => templateFields.filter((field) => !field.documentTypes || field.documentTypes.includes(currentTemplateType)),
    [currentTemplateType]
  );
  const backupCards = useMemo(() => ([
    { key: "customers", label: "Customers", value: backupSummary?.customers || 0 },
    { key: "jobs", label: "Jobs", value: backupSummary?.jobs || 0 },
    { key: "staff", label: "Staff", value: backupSummary?.staff || 0 },
    { key: "inventoryItems", label: "Inventory Items", value: backupSummary?.inventoryItems || 0 },
    { key: "maintenancePlans", label: "Maintenance Plans", value: backupSummary?.maintenancePlans || 0 },
    { key: "userAccounts", label: "Login Accounts", value: backupSummary?.userAccounts || 0 },
    { key: "deletedJobs", label: "Deleted Jobs", value: backupSummary?.deletedJobs || 0 },
    { key: "deletedCustomers", label: "Deleted Customers", value: backupSummary?.deletedCustomers || 0 },
  ]), [backupSummary]);
  const serviceM8SummaryCards = useMemo(() => serviceM8Summary ? ([
    { key: "customer-create", label: "Customers To Create", value: serviceM8Summary.customers?.create || 0 },
    { key: "customer-update", label: "Customers To Update", value: serviceM8Summary.customers?.update || 0 },
    { key: "job-create", label: "Jobs To Create", value: serviceM8Summary.jobs?.create || 0 },
    { key: "job-update", label: "Jobs To Update", value: serviceM8Summary.jobs?.update || 0 },
    { key: "quotes", label: "Quotes Found", value: serviceM8Summary.documents?.quotes || 0 },
    { key: "invoices", label: "Invoices Found", value: serviceM8Summary.documents?.invoices || 0 },
  ]) : [], [serviceM8Summary]);

  const updateTemplateField = (key, value) => {
    onTemplateChange(currentTemplateType, {
      ...activeTemplate,
      [key]: value,
    });
  };

  const resetServiceM8Preview = () => {
    setServiceM8Summary(null);
    setServiceM8PreviewId("");
    setServiceM8Message("");
    setServiceM8Status("idle");
  };

  const updateServiceM8Option = (key, checked) => {
    setServiceM8Options((prev) => ({
      ...prev,
      [key]: Boolean(checked),
    }));
    resetServiceM8Preview();
  };

  const handleBackupDownload = async () => {
    if (!onDownloadBackup || downloadStatus === "loading") return;

    setDownloadStatus("loading");
    setDownloadMessage("");

    const result = await onDownloadBackup();

    if (result?.ok) {
      setDownloadStatus("success");
      setDownloadMessage(`${result.filename || "Backup file"} downloaded successfully.`);
      return;
    }

    setDownloadStatus("error");
    setDownloadMessage(result?.error || "Unable to download the backup file.");
  };

  const openRestoreConfirmation = () => {
    if (!onRestoreBackup || restoreStatus === "loading" || !restoreFile || !isAdmin) return;
    setRestoreStatus("idle");
    setRestoreMessage("");
    setRestorePassword("");
    setRestoreConfirmOpen(true);
  };

  const handleBackupRestore = async (event) => {
    event?.preventDefault();
    if (!onRestoreBackup || restoreStatus === "loading" || !restoreFile) return;

    setRestoreStatus("loading");
    setRestoreMessage("");

    const result = await onRestoreBackup(restoreFile, restorePassword);

    if (result?.ok) {
      setRestoreStatus("success");
      setRestoreMessage(result.message || `${restoreFile.name || "Backup file"} restored successfully.`);
      setRestoreFile(null);
      setRestoreInputKey((prev) => prev + 1);
      setRestorePassword("");
      setRestoreConfirmOpen(false);
      return;
    }

    setRestoreStatus("error");
    setRestoreMessage(result?.error || "Unable to restore the backup file.");
  };

  const handleServiceM8Preview = async () => {
    if (!onPreviewServiceM8Import || serviceM8Status === "previewing" || serviceM8Status === "importing") return;

    setServiceM8Status("previewing");
    setServiceM8Message("");
    setServiceM8Summary(null);

    const result = await onPreviewServiceM8Import(serviceM8ApiKey, serviceM8Options);

    if (result?.ok) {
      setServiceM8Status("preview-ready");
      setServiceM8Summary(result.summary);
      setServiceM8PreviewId(result.previewId || "");
      setServiceM8Message("Preview ready. Review the totals, then import when you're happy with them.");
      return;
    }

    setServiceM8Status("error");
    setServiceM8Message(result?.error || "Unable to preview the ServiceM8 import.");
  };

  const handleServiceM8Import = async () => {
    if (!onApplyServiceM8Import || serviceM8Status === "previewing" || serviceM8Status === "importing" || !serviceM8Summary) return;

    setServiceM8Status("importing");
    setServiceM8Message("");

    const result = await onApplyServiceM8Import(serviceM8ApiKey, serviceM8Options, serviceM8PreviewId);

    if (result?.ok) {
      setServiceM8Status("success");
      setServiceM8Summary(result.summary);
      setServiceM8PreviewId("");
      setServiceM8Message("ServiceM8 import complete. The shared workspace has been updated.");
      return;
    }

    setServiceM8Status("error");
    setServiceM8Message(result?.error || "Unable to import ServiceM8 data.");
  };

  return (
    <div className="grid gap-6">
      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Badge className="w-fit rounded-full bg-slate-100 text-slate-700">{tabMeta.eyebrow}</Badge>
            <div>
              <CardTitle className="text-2xl">{tabMeta.title}</CardTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{tabMeta.description}</p>
            </div>
          </div>
          <Badge className={isAuthenticated ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}>
            {isAuthenticated ? "Server sync enabled" : "Offline"}
          </Badge>
        </CardHeader>
        <CardContent className="border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-2">
            {settingsTabs.map((tab) => {
              const isActive = activeSettingsTab === tab.value;

              return (
                <Button
                  key={tab.value}
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  className="rounded-xl"
                  onClick={() => onActiveSettingsTabChange?.(tab.value)}
                >
                  {tab.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {activeSettingsTab === "preferences" && (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-6">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Company Details</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">These values are the single source of truth for generated quotes, invoices, outgoing emails, and workspace branding.</p>
                </div>
                <Button variant="outline" className="rounded-xl" onClick={onResetPreferences}>
                  Reset Preferences
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {companyFields.map((field) => (
                  <div key={field.key} className={field.multiline ? "md:col-span-2" : ""}>
                    <FormField label={field.label}>
                      {field.multiline ? (
                        <Textarea
                          rows={4}
                          value={normalizedSettings[field.key]}
                          placeholder={field.placeholder}
                          onChange={(event) => onSettingChange(field.key, event.target.value)}
                        />
                      ) : (
                        <Input
                          value={normalizedSettings[field.key]}
                          placeholder={field.placeholder}
                          onChange={(event) => onSettingChange(field.key, event.target.value)}
                        />
                      )}
                    </FormField>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Bank Details</CardTitle>
                <p className="mt-1 text-sm text-slate-600">Used by invoice templates wherever payment or bank placeholders appear.</p>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                {bankFields.map((field) => (
                  <FormField key={field.key} label={field.label}>
                    <Input
                      value={normalizedSettings[field.key]}
                      placeholder={field.placeholder}
                      onChange={(event) => onSettingChange(field.key, event.target.value)}
                    />
                  </FormField>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Email Defaults</CardTitle>
                <p className="mt-1 text-sm text-slate-600">Set the default sender, reply-to, CC recipients, and email signature used when sending documents.</p>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {emailFields.map((field) => (
                    <FormField key={field.key} label={field.label}>
                      <Input
                        value={normalizedSettings[field.key]}
                        placeholder={field.placeholder}
                        onChange={(event) => onSettingChange(field.key, event.target.value)}
                      />
                    </FormField>
                  ))}
                </div>

                <FormField label="Email signature">
                  <Textarea
                    rows={5}
                    value={normalizedSettings.emailSignature}
                    onChange={(event) => onSettingChange("emailSignature", event.target.value)}
                  />
                </FormField>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Current Defaults</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Company Identity</p>
                  <p className="mt-2 font-medium text-slate-900">{normalizedSettings.companyName || "Not set"}</p>
                  <p className="mt-1 text-slate-700">
                    {[normalizedSettings.companyAbn ? `ABN ${normalizedSettings.companyAbn}` : "", normalizedSettings.companyAcn ? `ACN ${normalizedSettings.companyAcn}` : ""]
                      .filter(Boolean)
                      .join("  •  ") || "ABN / ACN not set"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Bank Account</p>
                  <p className="mt-2 font-medium text-slate-900">{normalizedSettings.bankAccountName || "Not set"}</p>
                  <p className="mt-1 text-slate-700">
                    {[normalizedSettings.bankBsb ? `BSB ${normalizedSettings.bankBsb}` : "", normalizedSettings.bankAccountNumber ? `Account ${normalizedSettings.bankAccountNumber}` : ""]
                      .filter(Boolean)
                      .join(" / ") || "Bank details not set"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Primary Sender</p>
                  <p className="mt-2 font-medium text-slate-900">{normalizedSettings.defaultSenderEmail || "Not set"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reply To</p>
                  <p className="mt-2 font-medium text-slate-900">{normalizedSettings.replyToEmail || "Not set"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Signature</p>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{normalizedSettings.emailSignature || "Not set"}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {activeSettingsTab === "templates" && (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-6">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Template Editor</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">Adjust wording, headings, section text, and colours for each document type. Company and bank details come from Preferences.</p>
                </div>
                <div className="w-full max-w-[220px]">
                  <Select value={currentTemplateType} onValueChange={onActiveTemplateTypeChange}>
                    <SelectTrigger className="w-full rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {templateTypeOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" className="rounded-xl" onClick={() => onResetTemplate(currentTemplateType)}>
                    Reset This Template
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {visibleTemplateFields.map((field) => (
                    <div key={field.key} className={field.multiline ? "md:col-span-2" : ""}>
                      <FormField label={field.label}>
                        {field.multiline ? (
                          <Textarea
                            rows={field.rows || 4}
                            value={activeTemplate[field.key]}
                            onChange={(event) => updateTemplateField(field.key, event.target.value)}
                          />
                        ) : field.type === "color" ? (
                          <div className="flex items-center gap-3">
                            <Input
                              type="color"
                              className="h-10 w-16 rounded-xl p-1"
                              value={normalizeHexColor(activeTemplate[field.key], "#0F172A")}
                              onChange={(event) => updateTemplateField(field.key, event.target.value)}
                            />
                            <Input
                              value={activeTemplate[field.key]}
                              onChange={(event) => updateTemplateField(field.key, event.target.value)}
                            />
                          </div>
                        ) : (
                          <Input
                            value={activeTemplate[field.key]}
                            onChange={(event) => updateTemplateField(field.key, event.target.value)}
                          />
                        )}
                      </FormField>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Supported Placeholders</CardTitle>
                <p className="mt-1 text-sm text-slate-600">These tokens can be used in the intro, terms, and footer text. Company and bank tokens use the values saved in Preferences.</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {documentTemplatePlaceholders.map((placeholder) => (
                  <Badge key={placeholder} className="rounded-full bg-slate-100 text-slate-700">
                    {placeholder}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Live Preview</CardTitle>
              <p className="mt-1 text-sm text-slate-600">See the exact generated document attachment before sending it to a customer.</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ExactDocumentPreview requestBody={previewRequestBody} />
            </CardContent>
          </Card>
        </div>
      )}

      {activeSettingsTab === "ui" && (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-6">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Theme Presets</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">Start from a preset, then fine-tune individual colours below.</p>
                </div>
                <Button variant="outline" className="rounded-xl" onClick={onResetUiSettings}>
                  Reset UI
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {themePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                    onClick={() => onApplyPreset(preset.values)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-950">{preset.label}</p>
                      <div className="flex gap-1.5">
                        {presetPreviewKeys.map((key) => (
                          <span
                            key={`${preset.id}-${key}`}
                            className="h-4 w-4 rounded-full border border-black/10"
                            style={{ backgroundColor: preset.values[key] }}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{preset.description}</p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Colour Controls</CardTitle>
                <p className="mt-1 text-sm text-slate-600">These values style the page background, sidebar, popup gradients, primary action buttons, and shared border colour.</p>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {themeColorFields.map((field) => (
                  <div key={field.key} className="grid gap-2">
                    <FormField label={field.label}>
                      <div className="flex items-center gap-3">
                        <Input
                          type="color"
                          className="h-10 w-16 rounded-xl p-1"
                          value={normalizeHexColor(normalizedSettings[field.key], "#0F172A")}
                          onChange={(event) => onSettingChange(field.key, event.target.value)}
                        />
                        <Input
                          value={normalizedSettings[field.key]}
                          onChange={(event) => onSettingChange(field.key, event.target.value)}
                        />
                      </div>
                    </FormField>
                    <p className="text-xs leading-5 text-slate-500">{field.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Layout</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="Sidebar width">
                    <Select value={normalizedSettings.sidebarWidth} onValueChange={(value) => onSettingChange("sidebarWidth", value)}>
                      <SelectTrigger className="w-full rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sidebarWidthOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="Content density">
                    <Select value={normalizedSettings.contentDensity} onValueChange={(value) => onSettingChange("contentDensity", value)}>
                      <SelectTrigger className="w-full rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {contentDensityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              </CardContent>
            </Card>
          </div>

          <WorkspacePreview settings={normalizedSettings} />
        </div>
      )}

      {activeSettingsTab === "backup" && (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-6">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Download Full Backup</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">
                    Save a JSON copy of the shared workspace, including customers, jobs, staff, templates, settings, and login accounts.
                  </p>
                </div>
                <Badge className={isAdmin ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                  {isAdmin ? "Admin Access" : "Admin Only"}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  Active session tokens are left out of the file for security, but the backup still includes the core workspace records and saved login accounts.
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    className="rounded-xl"
                    onClick={handleBackupDownload}
                    disabled={!isAdmin || downloadStatus === "loading"}
                  >
                    {downloadStatus === "loading" ? "Preparing Backup..." : "Download Backup"}
                  </Button>

                  {downloadStatus === "loading" ? (
                    <Badge className="bg-sky-100 text-sky-800">Generating file...</Badge>
                  ) : downloadStatus === "success" ? (
                    <Badge className="bg-emerald-100 text-emerald-800">Backup downloaded</Badge>
                  ) : downloadStatus === "error" ? (
                    <Badge className="bg-rose-100 text-rose-800">Download failed</Badge>
                  ) : null}
                </div>

                {downloadMessage ? (
                  <p className={`text-sm ${downloadStatus === "error" ? "text-rose-700" : "text-slate-600"}`}>
                    {downloadMessage}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-sm text-amber-700">
                    Sign in with an admin account to download a full backup file from this screen.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Restore From Backup</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">
                    Upload a previously downloaded backup JSON file to replace the current shared workspace snapshot.
                  </p>
                </div>
                <Badge className={isAdmin ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}>
                  {isAdmin ? "Overwrite Mode" : "Admin Only"}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  This will overwrite customers, jobs, staff, settings, templates, deleted records, and saved login accounts on the shared server.
                </div>

                <FormField label="Backup JSON file">
                  <Input
                    key={restoreInputKey}
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) => {
                      setRestoreFile(event.target.files?.[0] || null);
                      setRestoreStatus("idle");
                      setRestoreMessage("");
                    }}
                    disabled={!isAdmin || restoreStatus === "loading"}
                  />
                </FormField>

                {restoreFile ? (
                  <p className="text-sm text-slate-600">
                    Selected file: <span className="font-medium text-slate-900">{restoreFile.name}</span>
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    className="rounded-xl"
                    onClick={openRestoreConfirmation}
                    disabled={!isAdmin || !restoreFile || restoreStatus === "loading"}
                  >
                    {restoreStatus === "loading" ? "Restoring Backup..." : "Restore Backup"}
                  </Button>

                  {restoreStatus === "loading" ? (
                    <Badge className="bg-sky-100 text-sky-800">Replacing shared data...</Badge>
                  ) : restoreStatus === "success" ? (
                    <Badge className="bg-emerald-100 text-emerald-800">Backup restored</Badge>
                  ) : restoreStatus === "error" ? (
                    <Badge className="bg-rose-100 text-rose-800">Restore failed</Badge>
                  ) : null}
                </div>

                {restoreMessage ? (
                  <p className={`text-sm ${restoreStatus === "error" ? "text-rose-700" : "text-slate-600"}`}>
                    {restoreMessage}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-sm text-amber-700">
                    Sign in with an admin account to restore a backup file from this screen.
                  </p>
                ) : (
                  <p className="text-sm text-slate-600">
                    Use this only with backup files exported from this workspace. You will need to re-enter your admin password before the restore starts.
                  </p>
                )}
              </CardContent>
            </Card>

            <Dialog
              open={restoreConfirmOpen}
              onOpenChange={(nextOpen) => {
                if (restoreStatus === "loading") return;
                setRestoreConfirmOpen(nextOpen);
                if (!nextOpen) {
                  setRestorePassword("");
                }
              }}
            >
              <DialogContent className="rounded-3xl sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Confirm Backup Restore</DialogTitle>
                  <DialogDescription>
                    Restoring a backup will overwrite the current shared workspace for everyone. Re-enter your admin password to continue.
                  </DialogDescription>
                </DialogHeader>

                <form className="grid gap-4" onSubmit={handleBackupRestore}>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    This replaces customers, jobs, staff, templates, deleted records, and saved login accounts with the uploaded backup file.
                  </div>

                  {restoreFile ? (
                    <p className="text-sm text-slate-600">
                      Backup file: <span className="font-medium text-slate-900">{restoreFile.name}</span>
                    </p>
                  ) : null}

                  <FormField label="Admin password">
                    <Input
                      type="password"
                      value={restorePassword}
                      onChange={(event) => setRestorePassword(event.target.value)}
                      placeholder="Re-enter your password"
                      autoComplete="current-password"
                      disabled={restoreStatus === "loading"}
                    />
                  </FormField>

                  {restoreStatus === "error" && restoreMessage ? (
                    <p className="text-sm text-rose-700">{restoreMessage}</p>
                  ) : null}

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => {
                        setRestoreConfirmOpen(false);
                        setRestorePassword("");
                      }}
                      disabled={restoreStatus === "loading"}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="rounded-xl"
                      disabled={!restorePassword || restoreStatus === "loading"}
                    >
                      {restoreStatus === "loading" ? "Restoring Backup..." : "Confirm Restore"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">ServiceM8 API Import</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">
                    Preview and import ServiceM8 customers, sites, jobs, notes, invoice line items, and payments using a private API key.
                  </p>
                </div>
                <Badge className={isAdmin ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}>
                  {isAdmin ? "Admin Import" : "Admin Only"}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
                  The API key is only sent to the server for this request and is not saved in the app. The importer uses ServiceM8 UUIDs to update existing imported records instead of duplicating them.
                </div>

                <FormField label="ServiceM8 private API key">
                  <Input
                    type="password"
                    value={serviceM8ApiKey}
                    placeholder="Paste your ServiceM8 API key"
                    autoComplete="off"
                    onChange={(event) => {
                      setServiceM8ApiKey(event.target.value);
                      resetServiceM8Preview();
                    }}
                    disabled={!isAdmin || serviceM8Status === "previewing" || serviceM8Status === "importing"}
                  />
                </FormField>

                <div className="grid gap-3 md:grid-cols-2">
                  {serviceM8ImportOptionFields.map((field) => (
                    <label
                      key={field.key}
                      className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm"
                    >
                      <Checkbox
                        checked={Boolean(serviceM8Options[field.key])}
                        onCheckedChange={(checked) => updateServiceM8Option(field.key, checked)}
                        disabled={!isAdmin || serviceM8Status === "previewing" || serviceM8Status === "importing"}
                      />
                      <span>
                        <span className="block font-semibold text-slate-950">{field.label}</span>
                        <span className="mt-1 block leading-5 text-slate-600">{field.description}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    className="rounded-xl"
                    onClick={handleServiceM8Preview}
                    disabled={!isAdmin || !serviceM8ApiKey.trim() || serviceM8Status === "previewing" || serviceM8Status === "importing"}
                  >
                    {serviceM8Status === "previewing" ? "Reading ServiceM8..." : "Preview Import"}
                  </Button>
                  <Button
                    className="rounded-xl"
                    variant="outline"
                    onClick={handleServiceM8Import}
                    disabled={!isAdmin || !serviceM8Summary || serviceM8Status === "previewing" || serviceM8Status === "importing"}
                  >
                    {serviceM8Status === "importing" ? "Importing..." : "Import Previewed Data"}
                  </Button>

                  {serviceM8Status === "previewing" ? (
                    <Badge className="bg-sky-100 text-sky-800">Fetching API data...</Badge>
                  ) : serviceM8Status === "preview-ready" ? (
                    <Badge className="bg-amber-100 text-amber-800">Preview ready</Badge>
                  ) : serviceM8Status === "success" ? (
                    <Badge className="bg-emerald-100 text-emerald-800">Import complete</Badge>
                  ) : serviceM8Status === "error" ? (
                    <Badge className="bg-rose-100 text-rose-800">Import issue</Badge>
                  ) : null}
                </div>

                {serviceM8Message ? (
                  <p className={`text-sm ${serviceM8Status === "error" ? "text-rose-700" : "text-slate-600"}`}>
                    {serviceM8Message}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-sm text-amber-700">
                    Sign in with an admin account to run the ServiceM8 importer.
                  </p>
                ) : (
                  <p className="text-sm text-slate-600">
                    Always download a backup before importing. Preview does not change your data; import refetches ServiceM8 and then merges the results.
                  </p>
                )}

                {serviceM8Summary ? (
                  <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      {serviceM8SummaryCards.map((item) => (
                        <div key={item.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="font-semibold text-slate-950">Fetched From ServiceM8</p>
                      <p className="mt-2 leading-6">
                        {serviceM8Summary.fetched?.clients || 0} clients, {serviceM8Summary.fetched?.jobs || 0} jobs, {serviceM8Summary.fetched?.companyContacts || 0} contacts, {serviceM8Summary.fetched?.jobMaterials || 0} line items, {serviceM8Summary.fetched?.jobPayments || 0} payments, and {serviceM8Summary.fetched?.jobNotes || 0} notes.
                      </p>
                    </div>

                    {serviceM8Summary.sampleCustomers?.length ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-950">Customer Preview</p>
                        <div className="mt-3 grid gap-2">
                          {serviceM8Summary.sampleCustomers.map((customer, index) => (
                            <div key={`${customer.name}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                              <span className="font-medium text-slate-900">{customer.name}</span>
                              <span className="text-slate-600">{customer.action} - {customer.siteCount} site{customer.siteCount === 1 ? "" : "s"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {serviceM8Summary.sampleJobs?.length ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-950">Job Preview</p>
                        <div className="mt-3 grid gap-2">
                          {serviceM8Summary.sampleJobs.map((job, index) => (
                            <div key={`${job.job}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-slate-900">{job.job}</span>
                                <span className="text-slate-600">{job.action} - {job.status}</span>
                              </div>
                              <p className="mt-1 text-slate-600">{job.customerName} - {job.title}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {serviceM8Summary.warnings?.length ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                        <p className="font-semibold">Warnings</p>
                        <div className="mt-2 grid gap-1">
                          {serviceM8Summary.warnings.slice(0, 6).map((warning, index) => (
                            <p key={`${warning}-${index}`}>{warning}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">What's Included</CardTitle>
                <p className="mt-1 text-sm text-slate-600">
                  This export is designed to capture the full shared workspace snapshot, not just the visible page settings.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {backupCards.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Backup Notes</CardTitle>
              <p className="mt-1 text-sm text-slate-600">A couple of guardrails so the export stays useful when you need it.</p>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm text-slate-700">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                Download backups regularly after major admin changes like bulk customer imports, maintenance plan updates, or template edits.
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                Store the JSON file somewhere secure because it contains customer records, operational history, and login account data.
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                The file is exported directly from the server-side data store, so it reflects the shared workspace rather than only your current browser state.
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                Before restoring a backup, download a fresh copy of the current workspace so you can roll back if the uploaded file is older than expected.
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
