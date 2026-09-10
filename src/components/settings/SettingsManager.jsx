import { buildSemanticTheme } from "@/lib/theme-tokens";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import ThemeColourField from "./ThemeColourField";
import WorkspaceBranding from "./WorkspaceBranding";
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
  contentDensityOptions,
  createTemplatePreviewFixture,
  normalizeThemeSettings,
  settingsTabs,
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
  { key: "quoteHeading", label: "Document heading" },
  { key: "introText", label: "Intro text", multiline: true, rows: 4, documentTypes: ["quote", "invoice"] },
  { key: "notesHeading", label: "Notes heading", documentTypes: ["quote", "invoice"] },
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
  "dataViewAccent",
];

function WorkspacePreview({ settings }) {
  const { vars } = buildSemanticTheme(normalizeThemeSettings(settings));
  return (
    <Card className="min-w-0 self-start overflow-hidden rounded-3xl border-border shadow-sm xl:sticky xl:top-5">
      <CardHeader><CardTitle className="text-base">Workspace Preview</CardTitle></CardHeader>
      <CardContent>
        <div data-workspace-preview style={vars} className="theme-workspace-preview rounded-2xl border p-3 text-sm">
          <div className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] gap-3">
            <aside className="overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground">
              <div className="theme-preview-sidebar-header p-2 text-xs font-semibold">ELSET</div>
              <div className="grid gap-2 p-2 text-[10px]">
                <div className="rounded bg-sidebar-primary px-1 py-2 text-sidebar-primary-foreground">Customers</div>
                <div className="rounded bg-sidebar-accent px-1 py-2">Calendar</div>
                <div className="px-1 py-2">Invoices</div>
              </div>
            </aside>
            <div className="grid min-w-0 gap-3">
              <header className="theme-preview-header rounded-xl border p-3 font-semibold">Customer workspace</header>
              <div className="grid min-w-0 gap-3 rounded-xl border bg-card p-3 text-card-foreground">
                <div><p className="font-semibold">Main container</p><p className="text-xs text-text-secondary">Customer details and service work</p></div>
                <Input aria-label="Preview search" placeholder="Search customers?" readOnly />
                <div className="rounded-lg border bg-surface-raised p-3"><p className="font-medium">Raised card</p><p className="text-xs text-muted-foreground">Contact details and metadata</p></div>
                <div className="overflow-hidden rounded-lg border" data-preview-table>
                  <div className="grid grid-cols-2 gap-2 bg-muted p-2 text-xs font-semibold"><span>Customer</span><span>Status</span></div>
                  {['Acme Gates', 'Northside Works'].map((name, i) => <div key={name} className={'grid grid-cols-2 gap-2 p-2 text-xs ' + (i ? 'bg-surface-raised' : 'bg-card')}><span>{name}</span><span className="text-status-success">Active</span></div>)}
                </div>
                <Button type="button">Primary action</Button>
              </div>
              <div className="theme-preview-popup rounded-xl border p-3"><p className="font-semibold">Popup / dialog</p><p className="mt-1 text-xs">Review customer details before continuing.</p><div className="mt-3 rounded border bg-input-surface p-2 text-foreground">Form value</div></div>
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
        <p className="text-sm text-text-secondary">This renders the exact PDF attachment the customer receives.</p>
        {previewStatus === "loading" ? (
          <Badge className="bg-surface-raised text-text-secondary">Refreshing preview...</Badge>
        ) : previewStatus === "ready" ? (
          <Badge className="bg-status-success-surface text-status-success">Exact PDF preview</Badge>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface-raised p-3 shadow-sm sm:p-3">
        {previewUrl ? (
          <div className="mx-auto w-full min-w-[640px] max-w-[794px] overflow-hidden rounded-sm bg-paper shadow-lg">
            <iframe
              title="Exact customer document preview"
              src={previewUrl}
              className="block h-[clamp(640px,78vh,1040px)] w-full bg-paper"
            />
          </div>
        ) : previewStatus === "error" ? (
          <div className="p-panel text-sm text-status-danger">{previewError}</div>
        ) : (
          <div className="p-panel text-sm text-text-secondary">Rendering exact preview...</div>
        )}
      </div>

      {previewUrl && previewError ? (
        <p className="text-sm text-status-danger">{previewError}</p>
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
  themeSaveState,
  onRetryThemeSave,
  onSettingChange,
  onApplyPreset,
  onResetUiSettings,
  onResetPreferences,
  onWorkspaceLogoChange,
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
  workspaceStorageMode = "json",
  canManageWorkspaceSettings = true,
}) {
  const normalizedSettings = useMemo(() => normalizeThemeSettings(settings), [settings]);
  const currentTemplateType = activeTemplateType === "invoice" ? "invoice" : "quote";
  const isSqliteBackupMode = String(workspaceStorageMode || "").trim().toLowerCase() === "sqlite";
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
  const backupCards = useMemo(() => {
    const cards = [
      { key: "customers", label: "Customers", value: backupSummary?.customers || 0 },
      { key: "jobs", label: "Jobs", value: backupSummary?.jobs || 0 },
      { key: "staff", label: "Staff", value: backupSummary?.staff || 0 },
      { key: "inventoryItems", label: "Inventory Items", value: backupSummary?.inventoryItems || 0 },
      { key: "maintenancePlans", label: "Maintenance Plans", value: backupSummary?.maintenancePlans || 0 },
      { key: "userAccounts", label: "Login Accounts", value: backupSummary?.userAccounts || 0 },
      { key: "deletedJobs", label: "Deleted Jobs", value: backupSummary?.deletedJobs || 0 },
      { key: "deletedCustomers", label: "Deleted Customers", value: backupSummary?.deletedCustomers || 0 },
    ];
    return isSqliteBackupMode ? cards.filter((item) => item.key !== "userAccounts") : cards;
  }, [backupSummary, isSqliteBackupMode]);
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
    <div className="grid gap-4">
      <div className="floating-page-toolbar flex flex-col gap-2 overflow-x-auto overscroll-x-contain px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
          <Badge className={isAuthenticated ? "bg-status-success-surface text-status-success" : "bg-surface-raised text-text-secondary"}>
            {isAuthenticated ? "Server sync enabled" : "Offline"}
          </Badge>
        </div>
        <div className="flex min-w-max flex-nowrap gap-2" data-settings-navigation>
          {settingsTabs.filter((tab) => canManageWorkspaceSettings || tab.value === "ui").map((tab) => {
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
      </div>

      {canManageWorkspaceSettings && activeSettingsTab === "preferences" && (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-4">
            <WorkspaceBranding url={normalizedSettings.workspaceLogoUrl} onChange={onWorkspaceLogoChange} enabled={isSqliteBackupMode} />
            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Company Details</CardTitle>
                  <p className="mt-1 text-sm text-text-secondary">Shared workspace settings: these company values apply to everyone and to generated quotes, invoices and outgoing emails.</p>
                </div>
                <div className="grid justify-items-start gap-2 lg:justify-items-end">
                  <Button variant="outline" className="rounded-xl" onClick={onResetPreferences}>
                    Reset Preferences
                  </Button>
                  <div role="status" aria-label="Preferences save status" aria-live="polite" aria-atomic="true" className="text-sm text-text-secondary">
                    {themeSaveState?.scope !== "preferences" ? null : themeSaveState?.status === "error" ? (
                      <div className="flex flex-wrap items-center gap-2 text-status-danger">
                        <span>Preference changes could not be saved. {themeSaveState.error !== "Preference changes could not be saved." ? themeSaveState.error : ""}</span>
                        <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={onRetryThemeSave}>Retry</Button>
                      </div>
                    ) : themeSaveState?.status === "saved" ? "Saved" : ["pending", "saving"].includes(themeSaveState?.status) ? "Saving…" : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {companyFields.map((field) => (
                  <div key={field.key} className={field.multiline ? "md:col-span-2" : ""}>
                    <FormField label={field.label}>
                      {field.multiline ? (
                        <Textarea
                          data-setting-key={field.key}
                          rows={4}
                          value={normalizedSettings[field.key]}
                          placeholder={field.placeholder}
                          onChange={(event) => onSettingChange(field.key, event.target.value)}
                        />
                      ) : (
                        <Input
                          data-setting-key={field.key}
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

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Bank Details</CardTitle>
                <p className="mt-1 text-sm text-text-secondary">Used by invoice templates wherever payment or bank placeholders appear.</p>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                {bankFields.map((field) => (
                  <FormField key={field.key} label={field.label}>
                    <Input
                      data-setting-key={field.key}
                      value={normalizedSettings[field.key]}
                      placeholder={field.placeholder}
                      onChange={(event) => onSettingChange(field.key, event.target.value)}
                    />
                  </FormField>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Email Defaults</CardTitle>
                <p className="mt-1 text-sm text-text-secondary">Set the default sender, reply-to, CC recipients, and email signature used when sending documents.</p>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {emailFields.map((field) => (
                    <FormField key={field.key} label={field.label}>
                      <Input
                        data-setting-key={field.key}
                        value={normalizedSettings[field.key]}
                        placeholder={field.placeholder}
                        onChange={(event) => onSettingChange(field.key, event.target.value)}
                      />
                    </FormField>
                  ))}
                </div>

                <FormField label="Email signature">
                  <Textarea
                    data-setting-key="emailSignature"
                    rows={5}
                    value={normalizedSettings.emailSignature}
                    onChange={(event) => onSettingChange("emailSignature", event.target.value)}
                  />
                </FormField>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4">
            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Current Defaults</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="rounded-2xl border border-border bg-muted p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Company Identity</p>
                  <p className="mt-2 font-medium text-foreground">{normalizedSettings.companyName || "Not set"}</p>
                  <p className="mt-1 text-text-secondary">
                    {[normalizedSettings.companyAbn ? `ABN ${normalizedSettings.companyAbn}` : "", normalizedSettings.companyAcn ? `ACN ${normalizedSettings.companyAcn}` : ""]
                      .filter(Boolean)
                      .join("  •  ") || "ABN / ACN not set"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-muted p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Bank Account</p>
                  <p className="mt-2 font-medium text-foreground">{normalizedSettings.bankAccountName || "Not set"}</p>
                  <p className="mt-1 text-text-secondary">
                    {[normalizedSettings.bankBsb ? `BSB ${normalizedSettings.bankBsb}` : "", normalizedSettings.bankAccountNumber ? `Account ${normalizedSettings.bankAccountNumber}` : ""]
                      .filter(Boolean)
                      .join(" / ") || "Bank details not set"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-muted p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Primary Sender</p>
                  <p className="mt-2 font-medium text-foreground">{normalizedSettings.defaultSenderEmail || "Not set"}</p>
                </div>
                <div className="rounded-2xl border border-border bg-muted p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Reply To</p>
                  <p className="mt-2 font-medium text-foreground">{normalizedSettings.replyToEmail || "Not set"}</p>
                </div>
                <div className="rounded-2xl border border-border bg-muted p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Signature</p>
                  <p className="mt-2 whitespace-pre-wrap text-text-secondary">{normalizedSettings.emailSignature || "Not set"}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {canManageWorkspaceSettings && activeSettingsTab === "templates" && (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-4">
            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Template Editor</CardTitle>
                  <p className="mt-1 text-sm text-text-secondary">Adjust wording, headings, and section text for each document type. Company and bank details come from Preferences.</p>
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

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Supported Placeholders</CardTitle>
                <p className="mt-1 text-sm text-text-secondary">These tokens can be used in the intro, terms, and footer text. Company and bank tokens use the values saved in Preferences.</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {documentTemplatePlaceholders.map((placeholder) => (
                  <Badge key={placeholder} className="rounded-full bg-surface-raised text-text-secondary">
                    {placeholder}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-3xl border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Live Preview</CardTitle>
              <p className="mt-1 text-sm text-text-secondary">See the exact generated document attachment before sending it to a customer.</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ExactDocumentPreview requestBody={previewRequestBody} />
            </CardContent>
          </Card>
        </div>
      )}

      {activeSettingsTab === "ui" && (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <p className="text-sm text-text-secondary xl:col-span-2">Personal appearance — saved to your account across devices. These choices do not change anyone else's view.</p>
          <div className="grid gap-4">
            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Theme Presets</CardTitle>
                  <p className="mt-1 text-sm text-text-secondary">Start from a preset, then fine-tune individual colours below.</p>
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
                    data-theme-preset={preset.id}
                    aria-pressed={Object.entries(preset.values).every(([key, value]) => normalizedSettings[key] === value)}
                    className="theme-preset-card min-w-0 rounded-2xl border border-border bg-surface-raised p-3 text-left transition hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => onApplyPreset(preset.values)}
                  >
                    <div data-theme-sample className="theme-preset-sample mb-3" style={buildSemanticTheme(preset.values).vars}><span /><div><i /><i /><i /></div></div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-foreground">{preset.label}</p>
                      <div className="flex gap-1.5">
                        {presetPreviewKeys.map((key) => (
                          <span
                            key={`${preset.id}-${key}`}
                            className="h-4 w-4 rounded-full border border-border"
                            style={{ backgroundColor: preset.values[key] }}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">{preset.description}</p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Colour Controls</CardTitle>
                <p className="mt-1 text-sm text-text-secondary">Database surface coordinates panels, tables, raised cards, and inputs. Text and status colours adapt automatically. Popup surface also controls dialogs and dropdowns.</p>
                <div role="status" aria-label="Theme save status" aria-live="polite" aria-atomic="true" className="text-sm text-text-secondary">
                  {themeSaveState?.scope === "preferences" ? null : themeSaveState?.status === "error" ? (
                    <div className="flex flex-wrap items-center gap-2 text-status-danger">
                      <span>Theme change could not be saved. {themeSaveState.error !== "Theme change could not be saved." ? themeSaveState.error : ""}</span>
                      <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={onRetryThemeSave}>Retry</Button>
                    </div>
                  ) : themeSaveState?.status === "saved" ? "Saved" : ["pending", "saving"].includes(themeSaveState?.status) ? "Saving…" : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {themeColorFields.map((field) => (
                  <ThemeColourField key={field.key} field={field} value={normalizedSettings[field.key]} onChange={onSettingChange} />
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Layout</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="Sidebar width">
                    <Select value={normalizedSettings.sidebarWidth} onValueChange={(value) => onSettingChange("sidebarWidth", value)}>
                      <SelectTrigger aria-label="Sidebar width" className="w-full rounded-xl">
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
                      <SelectTrigger aria-label="Content density" className="w-full rounded-xl">
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

      {canManageWorkspaceSettings && activeSettingsTab === "backup" && (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-4">
            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Download Full Backup</CardTitle>
                  <p className="mt-1 text-sm text-text-secondary">
                    {isSqliteBackupMode
                      ? "Save a SQLite workspace backup bundle with customers, jobs, staff, templates, settings, and deleted records."
                      : "Save a JSON copy of the shared workspace, including customers, jobs, staff, templates, settings, and login accounts."}
                  </p>
                </div>
                <Badge className={isAdmin ? "bg-status-success-surface text-status-success" : "bg-status-warning-surface text-status-warning"}>
                  {isAdmin ? "Admin Access" : "Admin Only"}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-2xl border border-border bg-muted p-3 text-sm text-text-secondary">
                  {isSqliteBackupMode
                    ? "Login accounts, active sessions, SMTP credentials, API keys, and environment secrets are left out of SQLite workspace backups."
                    : "Active session tokens are left out of the file for security, but the backup still includes the core workspace records and saved login accounts."}
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
                    <Badge className="bg-status-info-surface text-status-info">Generating file...</Badge>
                  ) : downloadStatus === "success" ? (
                    <Badge className="bg-status-success-surface text-status-success">Backup downloaded</Badge>
                  ) : downloadStatus === "error" ? (
                    <Badge className="bg-status-danger-surface text-status-danger">Download failed</Badge>
                  ) : null}
                </div>

                {downloadMessage ? (
                  <p className={`text-sm ${downloadStatus === "error" ? "text-status-danger" : "text-text-secondary"}`}>
                    {downloadMessage}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-sm text-status-warning">
                    Sign in with an admin account to download a full backup file from this screen.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">Restore From Backup</CardTitle>
                  <p className="mt-1 text-sm text-text-secondary">
                    {isSqliteBackupMode
                      ? "Upload a SQLite workspace backup JSON bundle to replace the current shared workspace snapshot."
                      : "Upload a previously downloaded backup JSON file to replace the current shared workspace snapshot."}
                  </p>
                </div>
                <Badge className={isAdmin ? "bg-status-warning-surface text-status-warning" : "bg-surface-raised text-text-secondary"}>
                  {isAdmin ? "Overwrite Mode" : "Admin Only"}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-2xl border border-status-warning-border bg-status-warning-surface p-3 text-sm text-status-warning">
                  {isSqliteBackupMode
                    ? "This will overwrite workspace records only. Login accounts, sessions, SMTP credentials, API keys, and environment settings are not restored."
                    : "This will overwrite customers, jobs, staff, settings, templates, deleted records, and saved login accounts on the shared server."}
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
                  <p className="text-sm text-text-secondary">
                    Selected file: <span className="font-medium text-foreground">{restoreFile.name}</span>
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
                    <Badge className="bg-status-info-surface text-status-info">Replacing shared data...</Badge>
                  ) : restoreStatus === "success" ? (
                    <Badge className="bg-status-success-surface text-status-success">Backup restored</Badge>
                  ) : restoreStatus === "error" ? (
                    <Badge className="bg-status-danger-surface text-status-danger">Restore failed</Badge>
                  ) : null}
                </div>

                {restoreMessage ? (
                  <p className={`text-sm ${restoreStatus === "error" ? "text-status-danger" : "text-text-secondary"}`}>
                    {restoreMessage}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-sm text-status-warning">
                    Sign in with an admin account to restore a backup file from this screen.
                  </p>
                ) : (
                  <p className="text-sm text-text-secondary">
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
                  <div className="rounded-2xl border border-status-warning-border bg-status-warning-surface p-3 text-sm text-status-warning">
                    {isSqliteBackupMode
                      ? "This replaces the SQLite workspace snapshot only. Login accounts and secrets are left untouched."
                      : "This replaces customers, jobs, staff, templates, deleted records, and saved login accounts with the uploaded backup file."}
                  </div>

                  {restoreFile ? (
                    <p className="text-sm text-text-secondary">
                      Backup file: <span className="font-medium text-foreground">{restoreFile.name}</span>
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
                    <p className="text-sm text-status-danger">{restoreMessage}</p>
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

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg">ServiceM8 API Import</CardTitle>
                  <p className="mt-1 text-sm text-text-secondary">
                    Preview and import ServiceM8 customers, sites, jobs, notes, invoice line items, and payments using a private API key.
                  </p>
                </div>
                <Badge className={isAdmin ? "bg-status-success-surface text-status-success" : "bg-surface-raised text-text-secondary"}>
                  {isAdmin ? "Admin Import" : "Admin Only"}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-2xl border border-status-info-border bg-status-info-surface p-3 text-sm leading-6 text-status-info">
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
                      className="flex cursor-pointer gap-3 rounded-2xl border border-border bg-muted p-3 text-sm"
                    >
                      <Checkbox
                        checked={Boolean(serviceM8Options[field.key])}
                        onCheckedChange={(checked) => updateServiceM8Option(field.key, checked)}
                        disabled={!isAdmin || serviceM8Status === "previewing" || serviceM8Status === "importing"}
                      />
                      <span>
                        <span className="block font-semibold text-foreground">{field.label}</span>
                        <span className="mt-1 block leading-5 text-text-secondary">{field.description}</span>
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
                    <Badge className="bg-status-info-surface text-status-info">Fetching API data...</Badge>
                  ) : serviceM8Status === "preview-ready" ? (
                    <Badge className="bg-status-warning-surface text-status-warning">Preview ready</Badge>
                  ) : serviceM8Status === "success" ? (
                    <Badge className="bg-status-success-surface text-status-success">Import complete</Badge>
                  ) : serviceM8Status === "error" ? (
                    <Badge className="bg-status-danger-surface text-status-danger">Import issue</Badge>
                  ) : null}
                </div>

                {serviceM8Message ? (
                  <p className={`text-sm ${serviceM8Status === "error" ? "text-status-danger" : "text-text-secondary"}`}>
                    {serviceM8Message}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-sm text-status-warning">
                    Sign in with an admin account to run the ServiceM8 importer.
                  </p>
                ) : (
                  <p className="text-sm text-text-secondary">
                    Always download a backup before importing. Preview does not change your data; import refetches ServiceM8 and then merges the results.
                  </p>
                )}

                {serviceM8Summary ? (
                  <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      {serviceM8SummaryCards.map((item) => (
                        <div key={item.key} className="rounded-2xl border border-border bg-card p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                          <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-border bg-muted p-3 text-sm text-text-secondary">
                      <p className="font-semibold text-foreground">Fetched From ServiceM8</p>
                      <p className="mt-2 leading-6">
                        {serviceM8Summary.fetched?.clients || 0} clients, {serviceM8Summary.fetched?.jobs || 0} jobs, {serviceM8Summary.fetched?.companyContacts || 0} contacts, {serviceM8Summary.fetched?.jobMaterials || 0} line items, {serviceM8Summary.fetched?.jobPayments || 0} payments, and {serviceM8Summary.fetched?.jobNotes || 0} notes.
                      </p>
                    </div>

                    {serviceM8Summary.sampleCustomers?.length ? (
                      <div className="rounded-2xl border border-border bg-card p-3">
                        <p className="text-sm font-semibold text-foreground">Customer Preview</p>
                        <div className="mt-3 grid gap-2">
                          {serviceM8Summary.sampleCustomers.map((customer, index) => (
                            <div key={`${customer.name}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                              <span className="font-medium text-foreground">{customer.name}</span>
                              <span className="text-text-secondary">{customer.action} - {customer.siteCount} site{customer.siteCount === 1 ? "" : "s"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {serviceM8Summary.sampleJobs?.length ? (
                      <div className="rounded-2xl border border-border bg-card p-3">
                        <p className="text-sm font-semibold text-foreground">Job Preview</p>
                        <div className="mt-3 grid gap-2">
                          {serviceM8Summary.sampleJobs.map((job, index) => (
                            <div key={`${job.job}-${index}`} className="rounded-xl bg-muted px-3 py-2 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-foreground">{job.job}</span>
                                <span className="text-text-secondary">{job.action} - {job.status}</span>
                              </div>
                              <p className="mt-1 text-text-secondary">{job.customerName} - {job.title}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {serviceM8Summary.warnings?.length ? (
                      <div className="rounded-2xl border border-status-warning-border bg-status-warning-surface p-3 text-sm text-status-warning">
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

            <Card className="rounded-3xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">What's Included</CardTitle>
                <p className="mt-1 text-sm text-text-secondary">
                  This export is designed to capture the full shared workspace snapshot, not just the visible page settings.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {backupCards.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-border bg-muted p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Backup Notes</CardTitle>
              <p className="mt-1 text-sm text-text-secondary">A couple of guardrails so the export stays useful when you need it.</p>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm text-text-secondary">
              <div className="rounded-2xl border border-border bg-muted p-3">
                Download backups regularly after major admin changes like bulk customer imports, maintenance plan updates, or template edits.
              </div>
              <div className="rounded-2xl border border-border bg-muted p-3">
                Store the JSON file somewhere secure because it contains customer records, operational history, and login account data.
              </div>
              <div className="rounded-2xl border border-border bg-muted p-3">
                The file is exported directly from the server-side data store, so it reflects the shared workspace rather than only your current browser state.
              </div>
              <div className="rounded-2xl border border-border bg-muted p-3">
                Before restoring a backup, download a fresh copy of the current workspace so you can roll back if the uploaded file is older than expected.
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
