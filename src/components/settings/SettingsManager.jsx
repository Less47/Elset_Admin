import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  settingsTabMeta,
  sidebarWidthOptions,
  templateTypeOptions,
  themeColorFields,
  themePresets,
} from "@/lib/app-support";
import {
  documentTemplatePlaceholders,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "@/lib/quote-template";

const companyFields = [
  { key: "companyName", label: "Company name", placeholder: "Elset" },
  { key: "companyEmail", label: "Company email", placeholder: "admin@elset.com.au" },
  { key: "companyPhone", label: "Company phone", placeholder: "0400 000 000" },
  { key: "companyAddress", label: "Company address", placeholder: "Street, suburb, state", multiline: true },
];

const emailFields = [
  { key: "defaultSenderEmail", label: "Default sender email", placeholder: "admin@elset.com.au" },
  { key: "replyToEmail", label: "Reply-to email", placeholder: "admin@elset.com.au" },
  { key: "quoteCcEmail", label: "Quote CC email", placeholder: "Optional" },
  { key: "invoiceCcEmail", label: "Invoice CC email", placeholder: "Optional" },
];

const templateFields = [
  { key: "companyName", label: "Company name" },
  { key: "companyEmail", label: "Company email" },
  { key: "companyPhone", label: "Company phone" },
  { key: "companyAddress", label: "Company address", multiline: true, rows: 3 },
  { key: "accentColor", label: "Accent colour", type: "color" },
  { key: "quoteHeading", label: "Document heading" },
  { key: "introText", label: "Intro text", multiline: true, rows: 4 },
  { key: "notesHeading", label: "Notes heading" },
  { key: "termsHeading", label: "Terms heading" },
  { key: "termsText", label: "Terms text", multiline: true, rows: 5 },
  { key: "footerText", label: "Footer text", multiline: true, rows: 3 },
];

function WorkspacePreview({ settings }) {
  const normalizedSettings = normalizeThemeSettings(settings);
  const pageStart = normalizeHexColor(normalizedSettings.pageBackgroundStart, "#0F90CD");
  const pageEnd = normalizeHexColor(normalizedSettings.pageBackgroundEnd, pageStart);
  const sidebarSurface = normalizeHexColor(normalizedSettings.sidebarSurface, "#FFFFFF");
  const sidebarHeader = normalizeHexColor(normalizedSettings.sidebarHeader, "#0F90CD");
  const sidebarActive = normalizeHexColor(normalizedSettings.sidebarActive, "#F69320");
  const heroSurface = normalizeHexColor(normalizedSettings.heroSurface, "#0F90CD");
  const actionColor = normalizeHexColor(normalizedSettings.actionColor, "#F69320");
  const dialogSurface = normalizeHexColor(normalizedSettings.dialogSurface, "#F8FAFC");

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
          <div className="grid gap-4 p-4 lg:grid-cols-[220px_1fr]">
            <div
              className="overflow-hidden rounded-2xl border shadow-sm"
              style={{
                backgroundColor: hexToRgba(sidebarSurface, 0.94),
                borderColor: hexToRgba(sidebarHeader, 0.12),
                color: getContrastTextColor(sidebarSurface, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
              }}
            >
              <div
                className="p-4"
                style={{
                  backgroundColor: sidebarHeader,
                  color: getContrastTextColor(sidebarHeader, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
                }}
              >
                <div className="mx-auto grid max-w-full grid-cols-[84px_56px] items-center justify-center gap-2.5">
                  <div className="flex h-12 w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-white px-1 shadow-sm">
                    <img src={LOGO_SRC} alt="Elset logo" className="block h-auto w-[138%] max-w-none" />
                  </div>
                  <div className="min-w-0 self-center text-left font-semibold uppercase leading-none tracking-[0.04em]">
                    <span className="block text-[0.65rem]">Admin</span>
                    <span className="mt-1 block text-[0.8rem]">Menu</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-2 p-3">
                <div
                  className="rounded-2xl border px-3 py-2 text-sm font-medium shadow-sm"
                  style={{
                    backgroundColor: sidebarActive,
                    borderColor: sidebarActive,
                    color: getContrastTextColor(sidebarActive, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
                  }}
                >
                  Active section
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm">Customers</div>
                <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm">Invoices</div>
              </div>
            </div>

            <div className="grid gap-4">
              <div
                className="rounded-2xl border p-5 shadow-sm"
                style={{
                  backgroundColor: heroSurface,
                  borderColor: hexToRgba(heroSurface, 0.18),
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
                        borderColor: actionColor,
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
                  backgroundColor: dialogSurface,
                  borderColor: hexToRgba(dialogSurface, 0.18),
                  color: getContrastTextColor(dialogSurface, { dark: APP_TEXT_DARK, light: APP_TEXT_LIGHT }),
                }}
              >
                <p className="text-sm font-semibold">Dialog Surface Preview</p>
                <p className="mt-2 text-sm opacity-80">
                  Popups, editors, and modals will use this surface for a consistent branded feel.
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExactDocumentPreview({ authToken, requestBody }) {
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
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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
  }, [authToken, deferredRequestBody]);

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
  settings,
  onSettingChange,
  onApplyPreset,
  onResetUiSettings,
  onResetPreferences,
  onApplyCompanyToTemplates,
  activeTemplateType,
  onActiveTemplateTypeChange,
  templates,
  onTemplateChange,
  onResetTemplate,
  authToken,
  isAdmin,
  onDownloadBackup,
  backupSummary,
}) {
  const tabMeta = settingsTabMeta[activeSettingsTab] || settingsTabMeta.preferences;
  const normalizedSettings = useMemo(() => normalizeThemeSettings(settings), [settings]);
  const currentTemplateType = activeTemplateType === "invoice" ? "invoice" : "quote";
  const [backupStatus, setBackupStatus] = useState("idle");
  const [backupMessage, setBackupMessage] = useState("");

  const activeTemplate = useMemo(() => {
    return currentTemplateType === "invoice"
      ? normalizeInvoiceTemplate(templates?.invoice)
      : normalizeQuoteTemplate(templates?.quote);
  }, [currentTemplateType, templates?.invoice, templates?.quote]);

  const previewFixture = useMemo(() => createTemplatePreviewFixture(currentTemplateType), [currentTemplateType]);
  const previewRequestBody = useMemo(() => JSON.stringify({
    documentType: currentTemplateType,
    job: previewFixture.job,
    document: previewFixture.document,
    template: activeTemplate,
  }), [activeTemplate, currentTemplateType, previewFixture]);
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

  const updateTemplateField = (key, value) => {
    onTemplateChange(currentTemplateType, {
      ...activeTemplate,
      [key]: value,
    });
  };

  const handleBackupDownload = async () => {
    if (!onDownloadBackup || backupStatus === "loading") return;

    setBackupStatus("loading");
    setBackupMessage("");

    const result = await onDownloadBackup();

    if (result?.ok) {
      setBackupStatus("success");
      setBackupMessage(`${result.filename || "Backup file"} downloaded successfully.`);
      return;
    }

    setBackupStatus("error");
    setBackupMessage(result?.error || "Unable to download the backup file.");
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
          <Badge className={authToken ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}>
            {authToken ? "Server sync enabled" : "Local mode"}
          </Badge>
        </CardHeader>
      </Card>

      {activeSettingsTab === "preferences" && (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-6">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Company Details</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">These values flow into templates, outgoing document emails, and workspace branding.</p>
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
                <CardTitle className="text-lg">Template Sync</CardTitle>
                <p className="mt-1 text-sm text-slate-600">Push your company contact details into both quote and invoice templates in one step.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  The company name, email, phone, and address fields can be copied into both document templates without resetting the rest of the wording.
                </div>
                <Button className="rounded-xl" onClick={onApplyCompanyToTemplates}>
                  Apply Company Details To Templates
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Current Defaults</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
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
                  <p className="mt-1 text-sm text-slate-600">Adjust wording, headings, colours, and business details for each document type.</p>
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
                  <Button variant="outline" className="rounded-xl" onClick={onApplyCompanyToTemplates}>
                    Apply Company Details
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {templateFields.map((field) => (
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
                <p className="mt-1 text-sm text-slate-600">These tokens can be used in the intro, terms, and footer text.</p>
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
              <ExactDocumentPreview authToken={authToken} requestBody={previewRequestBody} />
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
                        {Object.values(preset.values).slice(0, 4).map((value) => (
                          <span
                            key={`${preset.id}-${value}`}
                            className="h-4 w-4 rounded-full border border-black/10"
                            style={{ backgroundColor: value }}
                          />
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Colour Controls</CardTitle>
                <p className="mt-1 text-sm text-slate-600">These values style the page background, sidebar, popups, and primary action buttons.</p>
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
                    disabled={!isAdmin || backupStatus === "loading"}
                  >
                    {backupStatus === "loading" ? "Preparing Backup..." : "Download Backup"}
                  </Button>

                  {backupStatus === "loading" ? (
                    <Badge className="bg-sky-100 text-sky-800">Generating file...</Badge>
                  ) : backupStatus === "success" ? (
                    <Badge className="bg-emerald-100 text-emerald-800">Backup downloaded</Badge>
                  ) : backupStatus === "error" ? (
                    <Badge className="bg-rose-100 text-rose-800">Download failed</Badge>
                  ) : null}
                </div>

                {backupMessage ? (
                  <p className={`text-sm ${backupStatus === "error" ? "text-rose-700" : "text-slate-600"}`}>
                    {backupMessage}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-sm text-amber-700">
                    Sign in with an admin account to download a full backup file from this screen.
                  </p>
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
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
