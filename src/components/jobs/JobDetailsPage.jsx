import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, FileText, MapPin, Pencil, Trash2, UserRound } from "lucide-react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import ContactSnapshotEditor from "@/components/shared/ContactSnapshotEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RecordWorkspace, WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import {
  buildCustomerSites,
  formatDate,
  getContactDisplayName,
  getCustomerBillingContact,
  getCustomerContacts,
  getCustomerSiteAccessNote,
  getCustomerSitePrimaryContact,
  getInvoicePaymentSummary,
  getInvoiceStatus,
  normalizeSiteAddress,
  toDateInputValue,
  urgencyOptions,
} from "@/lib/app-support";
import { statuses, statusThemes } from "@/lib/job-status";
import { calculateInvoiceTotal, calculateQuoteTotal, money } from "@/lib/quote-template";

const UNASSIGNED_VALUE = "unassigned";

function buildOverviewDraft(job) {
  return {
    title: job?.title || "",
    description: job?.description || "",
    jobAddress: job?.jobAddress || "",
    clientReference: job?.ocNumber || "",
    requesterContact: job?.requesterContact || null,
    onsiteContact: job?.onsiteContact || null,
    billingContact: job?.billingContact || (
      job?.customerEmail || job?.customerPhone
        ? {
            id: "",
            name: job?.customerName || "",
            role: "Billing contact",
            phone: job?.customerPhone || "",
            email: job?.customerEmail || "",
          }
        : null
    ),
  };
}

function buildScheduleDraft(job) {
  return {
    scheduledDate: toDateInputValue(job?.scheduledDate),
    urgency: job?.urgency || "Medium",
    assignedTechnicianId: job?.assignedTechnicianId || "",
    assignedTechnicianName: job?.assignedTechnicianName || "",
  };
}

function InfoItem({ label, children, className = "" }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium leading-6 text-slate-900">{children}</dd>
    </div>
  );
}

function ContactSummary({ contact, label }) {
  if (!contact) return null;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-900">{getContactDisplayName(contact)}</p>
      <p className="mt-1 text-sm text-slate-500">{[contact.phone, contact.email].filter(Boolean).join(" · ") || "No phone or email saved"}</p>
    </div>
  );
}

function urgencyClassName(urgency) {
  if (urgency === "High") return "bg-rose-100 text-rose-800";
  if (urgency === "Medium") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export default function JobDetailsPage({
  backLabel,
  canDeleteJob,
  canEditJob,
  customer,
  customerJobs,
  job,
  onAddNote,
  onAddPhotos,
  onBack,
  onDeleteJob,
  onDeletePhoto,
  onDeleted,
  onOpenCustomerProfile,
  onOpenDocument,
  onOpenSentDocument,
  onOpenSiteProfile,
  onStatusChange,
  onUpdateJobDetails,
  registerNavigationBlocker,
  showCommercialDocuments,
  staff,
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [overviewEditing, setOverviewEditing] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState(() => buildOverviewDraft(job));
  const [scheduleDraft, setScheduleDraft] = useState(() => buildScheduleDraft(job));
  const [note, setNote] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [isSavingOverview, setIsSavingOverview] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [pendingStatus, setPendingStatus] = useState("");
  const [pageError, setPageError] = useState("");

  const orderedStaff = useMemo(
    () => [...(staff || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [staff]
  );
  const customerSites = useMemo(
    () => (customer ? buildCustomerSites(customer, customerJobs || []) : []),
    [customer, customerJobs]
  );
  const currentJobSite = useMemo(
    () => customerSites.find(
      (site) => normalizeSiteAddress(site.address).toLowerCase() === normalizeSiteAddress(job?.jobAddress).toLowerCase()
    ) || null,
    [customerSites, job?.jobAddress]
  );
  const draftJobSite = useMemo(
    () => customerSites.find(
      (site) => normalizeSiteAddress(site.address).toLowerCase() === normalizeSiteAddress(overviewDraft.jobAddress).toLowerCase()
    ) || null,
    [customerSites, overviewDraft.jobAddress]
  );
  const customerContacts = useMemo(() => (customer ? getCustomerContacts(customer) : []), [customer]);

  const overviewDirty = overviewEditing
    && JSON.stringify(overviewDraft) !== JSON.stringify(buildOverviewDraft(job));
  const scheduleDirty = JSON.stringify(scheduleDraft) !== JSON.stringify(buildScheduleDraft(job));
  const hasUnsavedChanges = overviewDirty || scheduleDirty || Boolean(note.trim());

  useEffect(
    () => registerNavigationBlocker(() => hasUnsavedChanges && !isSavingOverview && !isSavingSchedule),
    [hasUnsavedChanges, isSavingOverview, isSavingSchedule, registerNavigationBlocker]
  );

  if (!job) {
    return (
      <RecordWorkspace backLabel={backLabel} title="Job not found" eyebrow="Jobs" onBack={() => onBack()}>
        <WorkspaceMessage tone="error">This job is unavailable or may have been deleted.</WorkspaceMessage>
      </RecordWorkspace>
    );
  }

  const jobPhotos = job.photos || [];
  const activeSelectedPhoto = selectedPhoto ? jobPhotos.find((photo) => photo.id === selectedPhoto.id) || null : null;
  const activeSelectedPhotoIndex = activeSelectedPhoto ? jobPhotos.findIndex((photo) => photo.id === activeSelectedPhoto.id) : -1;
  const requesterContact = job.requesterContact || null;
  const onsiteContact = job.onsiteContact || getCustomerSitePrimaryContact(customer, job.jobAddress) || null;
  const billingContact = job.billingContact
    || getCustomerBillingContact(customer)
    || (job.customerEmail || job.customerPhone
      ? { id: "", name: job.customerName, role: "Billing contact", phone: job.customerPhone, email: job.customerEmail }
      : null);
  const siteAccessNote = getCustomerSiteAccessNote(customer, job.jobAddress);
  const invoiceStatus = getInvoiceStatus(job);
  const invoicePayment = getInvoicePaymentSummary(job.invoice);
  const statusTheme = statusThemes[job.status] || statusThemes["To Do"];
  const canSaveOverview = Boolean(
    overviewDraft.title.trim() && overviewDraft.description.trim() && normalizeSiteAddress(overviewDraft.jobAddress)
  );
  const visibleTabs = [
    { value: "overview", label: "Overview" },
    { value: "schedule", label: "Schedule" },
    ...(showCommercialDocuments ? [{ value: "documents", label: "Documents" }] : []),
    { value: "notes", label: "Notes & photos" },
  ];

  const saveOverview = async () => {
    if (!canSaveOverview || isSavingOverview) return;
    setIsSavingOverview(true);
    setPageError("");
    const { clientReference, ...overviewUpdates } = overviewDraft;
    const saved = await onUpdateJobDetails({
      ...overviewUpdates,
      jobAddress: normalizeSiteAddress(overviewDraft.jobAddress),
      ocNumber: clientReference.trim(),
    });
    setIsSavingOverview(false);
    if (saved === false) {
      setPageError("The job details could not be saved. Try again.");
      return;
    }
    setOverviewEditing(false);
  };

  const saveSchedule = async () => {
    if (isSavingSchedule) return;
    setIsSavingSchedule(true);
    setPageError("");
    const saved = await onUpdateJobDetails(scheduleDraft);
    setIsSavingSchedule(false);
    if (saved === false) {
      setPageError("The schedule and assignment could not be saved. Try again.");
    }
  };

  const updateStatus = async (nextStatus) => {
    if (!nextStatus || nextStatus === job.status || pendingStatus) return;
    setPendingStatus(nextStatus);
    setPageError("");
    const saved = await onStatusChange(nextStatus);
    setPendingStatus("");
    if (saved === false) setPageError("The job status could not be updated.");
  };

  const cyclePhoto = (direction) => {
    if (jobPhotos.length < 2 || activeSelectedPhotoIndex < 0) return;
    setSelectedPhoto(jobPhotos[(activeSelectedPhotoIndex + direction + jobPhotos.length) % jobPhotos.length]);
  };

  return (
    <>
      <RecordWorkspace
        backLabel={backLabel}
        eyebrow={`Job #${job.jobNumber}`}
        title={job.title}
        subtitle={`${job.customerName} · ${job.jobAddress}`}
        status={<Badge className={urgencyClassName(job.urgency)}>{job.urgency} priority</Badge>}
        onBack={() => onBack()}
        maxWidth="max-w-[90rem]"
        headerActions={(
          <Select value={job.status} onValueChange={updateStatus} disabled={Boolean(pendingStatus)}>
            <SelectTrigger className={`record-workspace-status h-11 w-[8.5rem] rounded-lg font-semibold ${statusTheme.badge}`} aria-label="Update job status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      >
        {pageError ? <div className="mb-5" role="alert"><WorkspaceMessage tone="error">{pageError}</WorkspaceMessage></div> : null}

        <div className="grid min-w-0 gap-3 sm:gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
          <aside className="record-major-panel min-w-0 rounded-xl border p-4 lg:sticky lg:top-28 lg:self-start">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><UserRound className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Customer</p>
                <p className="truncate font-semibold text-slate-950">{job.customerName || "Not set"}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 lg:grid-cols-1">
              <InfoItem label="Site">{job.jobAddress || "Not set"}</InfoItem>
              <InfoItem label="Scheduled">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</InfoItem>
              <InfoItem label="Technician">{job.assignedTechnicianName || "Unassigned"}</InfoItem>
              <InfoItem label="Urgency"><Badge className={urgencyClassName(job.urgency)}>{job.urgency || "Low"}</Badge></InfoItem>
            </dl>
            {canEditJob ? (
              <Button type="button" variant="outline" className="mt-4 h-11 w-full rounded-lg" onClick={() => {
                setActiveTab("overview");
                setOverviewEditing(true);
              }}><Pencil className="h-4 w-4" /> Edit job details</Button>
            ) : null}
          </aside>

          <div className="record-major-panel min-w-0 rounded-xl border">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="record-workspace-tabs min-w-0 gap-0">
              <div className="record-tab-strip rounded-t-lg bg-[var(--data-view-header-start)] px-3 py-2 sm:px-4">
                <TabsList
                  aria-label="Job details sections"
                  className="grid h-auto min-h-11 w-full gap-1 rounded-lg p-1"
                  style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
                >
                  {visibleTabs.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value} className="min-h-11 min-w-0 whitespace-normal border-0 px-1 text-center text-xs leading-tight sm:px-3 sm:text-sm">{tab.label}</TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <div className="bg-white/80 px-3 pb-5 pt-4 sm:px-5 sm:pt-5 lg:px-6">
                <TabsContent value="overview" className="mt-0">
                  <WorkspaceSection
                    title="Job summary"
                    description="The core customer, site, and work information for this job."
                    trailing={canEditJob && !overviewEditing ? (
                      <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={() => setOverviewEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>
                    ) : null}
                  >
                    {overviewEditing ? (
                      <div className="grid gap-5">
                        <div className="grid gap-2">
                          <Label htmlFor="edit-job-title">Job title</Label>
                          <Input id="edit-job-title" className="h-11" value={overviewDraft.title} onChange={(event) => setOverviewDraft((current) => ({ ...current, title: event.target.value }))} aria-invalid={!overviewDraft.title.trim()} />
                          {!overviewDraft.title.trim() ? <p className="text-sm text-rose-700">This field is required.</p> : null}
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="edit-job-description">Description of work</Label>
                          <Textarea id="edit-job-description" rows={6} value={overviewDraft.description} onChange={(event) => setOverviewDraft((current) => ({ ...current, description: event.target.value }))} aria-invalid={!overviewDraft.description.trim()} />
                          {!overviewDraft.description.trim() ? <p className="text-sm text-rose-700">This field is required.</p> : null}
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="edit-job-address">Site address</Label>
                          <AddressAutocompleteInput id="edit-job-address" className="h-11" value={overviewDraft.jobAddress} onChange={(value) => setOverviewDraft((current) => ({ ...current, jobAddress: value }))} placeholder="Search the job site address" />
                          {!normalizeSiteAddress(overviewDraft.jobAddress) ? <p className="text-sm text-rose-700">This field is required.</p> : null}
                        </div>
                        {customerSites.length > 0 ? (
                          <div>
                            <p className="text-sm font-medium text-slate-700">Saved sites</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {customerSites.map((site) => (
                                <Button key={site.id} type="button" variant={normalizeSiteAddress(overviewDraft.jobAddress) === site.address ? "secondary" : "outline"} className="h-11 max-w-full rounded-lg" onClick={() => setOverviewDraft((current) => ({ ...current, jobAddress: site.address }))}>
                                  <span className="truncate">{site.address}</span>
                                </Button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="grid gap-2 sm:max-w-md">
                          <p className="text-sm font-medium text-slate-700">OC number</p>
                          <p className="text-sm font-medium text-slate-950">{draftJobSite?.ocNumber || "Not set"}</p>
                          <p className="text-sm text-slate-500">This belongs to the site and is managed from the Site profile.</p>
                          {customer && draftJobSite && onOpenSiteProfile ? (
                            <Button type="button" variant="outline" className="h-11 justify-self-start rounded-lg" onClick={() => onOpenSiteProfile(customer.id, normalizeSiteAddress(draftJobSite.address).toLowerCase())}>
                              <MapPin className="h-4 w-4" /> Open site profile
                            </Button>
                          ) : null}
                        </div>
                        <div className="grid gap-2 sm:max-w-md">
                          <Label htmlFor="edit-job-client-reference">Client reference / PO number</Label>
                          <Input id="edit-job-client-reference" className="h-11" value={overviewDraft.clientReference} onChange={(event) => setOverviewDraft((current) => ({ ...current, clientReference: event.target.value }))} placeholder="Optional purchase order or client reference" />
                        </div>
                        <details className="record-inset-surface rounded-lg p-3 sm:p-4">
                          <summary className="cursor-pointer font-medium text-slate-950">Job contacts</summary>
                          <div className="mt-5 grid gap-4">
                            <ContactSnapshotEditor title="Requester" description="Who asked for this work." contacts={customerContacts} fallbackRole="Requester" value={overviewDraft.requesterContact} onChange={(contact) => setOverviewDraft((current) => ({ ...current, requesterContact: contact }))} />
                            <ContactSnapshotEditor title="On-site contact" description="Who the team should speak with on arrival." contacts={customerContacts} fallbackRole="On-site contact" value={overviewDraft.onsiteContact} onChange={(contact) => setOverviewDraft((current) => ({ ...current, onsiteContact: contact }))} />
                            <ContactSnapshotEditor title="Billing contact" description="Who quotes and invoices should be sent to." contacts={customerContacts} fallbackRole="Billing contact" value={overviewDraft.billingContact} onChange={(contact) => setOverviewDraft((current) => ({ ...current, billingContact: contact }))} />
                          </div>
                        </details>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="outline" className="h-11 rounded-lg" disabled={isSavingOverview} onClick={() => {
                            setOverviewDraft(buildOverviewDraft(job));
                            setOverviewEditing(false);
                          }}>Cancel</Button>
                          <Button type="button" className="h-11 rounded-lg px-5 hover:opacity-90" disabled={!canSaveOverview || !overviewDirty || isSavingOverview} aria-busy={isSavingOverview} onClick={saveOverview}>{isSavingOverview ? "Saving…" : "Save changes"}</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-5">
                        <div>
                          <p className="text-sm font-medium text-slate-500">Description</p>
                          <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-800">{job.description}</p>
                        </div>
                        <dl className="record-subtle-divider-y grid gap-x-6 gap-y-4 py-4 sm:grid-cols-2">
                          <InfoItem label="Customer">{job.customerName || "Not set"}</InfoItem>
                          <InfoItem label="Customer contact">{[job.customerPhone, job.customerEmail].filter(Boolean).join(" · ") || "Not set"}</InfoItem>
                          <InfoItem label="Site">{job.jobAddress || "Not set"}</InfoItem>
                          <InfoItem label="OC number">{currentJobSite?.ocNumber || "Not set"}</InfoItem>
                          <InfoItem label="Client reference / PO number">{job.ocNumber || "Not set"}</InfoItem>
                          {job.maintenancePlanName ? <InfoItem label="Maintenance plan">{job.maintenancePlanName}</InfoItem> : null}
                          {job.maintenanceDueDate ? <InfoItem label="Maintenance due">{formatDate(job.maintenanceDueDate)}</InfoItem> : null}
                        </dl>

                        <div>
                          <h3 className="font-semibold text-slate-950">Job contacts</h3>
                          <div className="mt-3 divide-y divide-slate-200">
                            <ContactSummary label="Requester" contact={requesterContact} />
                            <ContactSummary label="On-site contact" contact={onsiteContact} />
                            <ContactSummary label="Billing contact" contact={billingContact} />
                            {!requesterContact && !onsiteContact && !billingContact ? <p className="py-3 text-sm text-slate-500">No job-specific contacts saved.</p> : null}
                          </div>
                        </div>

                        {siteAccessNote?.notes ? (
                          <div className="border-l-4 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                            <p className="font-medium">Site access notes</p>
                            <p className="mt-1 whitespace-pre-wrap leading-6">{siteAccessNote.notes}</p>
                          </div>
                        ) : null}

                        {customer && (onOpenCustomerProfile || onOpenSiteProfile) ? (
                          <div className="flex flex-wrap gap-2">
                            {onOpenCustomerProfile ? <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={() => onOpenCustomerProfile(customer.id)}>Open customer profile</Button> : null}
                            {onOpenSiteProfile ? <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={() => onOpenSiteProfile(customer.id, normalizeSiteAddress(job.jobAddress).toLowerCase())}><MapPin className="h-4 w-4" /> Open site profile</Button> : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </WorkspaceSection>

                </TabsContent>

                <TabsContent value="schedule" className="mt-0">
                  <WorkspaceSection title="Schedule & assignment" description="Manage the visit date, assigned technician, and operational priority.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="job-detail-scheduled-date">Scheduled date</Label>
                        <Input id="job-detail-scheduled-date" className="h-11" type="date" disabled={!canEditJob} value={scheduleDraft.scheduledDate} onChange={(event) => setScheduleDraft((current) => ({ ...current, scheduledDate: event.target.value }))} />
                      </div>
                      <div className="grid gap-2">
                        <Label>Assigned technician</Label>
                        <Select disabled={!canEditJob} value={scheduleDraft.assignedTechnicianId || UNASSIGNED_VALUE} onValueChange={(value) => {
                          const technician = orderedStaff.find((entry) => entry.id === value) || null;
                          setScheduleDraft((current) => ({ ...current, assignedTechnicianId: technician?.id || "", assignedTechnicianName: technician?.name || "" }));
                        }}>
                          <SelectTrigger className="h-11" aria-label="Assigned technician"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                            {orderedStaff.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}{entry.role ? ` · ${entry.role}` : ""}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Urgency</Label>
                        <Select disabled={!canEditJob} value={scheduleDraft.urgency} onValueChange={(value) => setScheduleDraft((current) => ({ ...current, urgency: value }))}>
                          <SelectTrigger className="h-11" aria-label="Urgency"><SelectValue /></SelectTrigger>
                          <SelectContent>{urgencyOptions.map((urgency) => <SelectItem key={urgency} value={urgency}>{urgency}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="record-passive-surface rounded-lg px-4 py-3 text-sm">
                        <p className="font-medium text-slate-950">Service Board status</p>
                        <div className="mt-2 flex items-center gap-2"><Badge className={statusTheme.badge}>{job.status}</Badge><span className="text-slate-500">Change from the page header.</span></div>
                      </div>
                    </div>
                    {job.serviceBoardTomorrowDate ? (
                      <div className="record-thin-border mt-5 rounded-lg border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                        Planned for Tomorrow on {formatDate(job.serviceBoardTomorrowDate)}.
                      </div>
                    ) : null}
                    {canEditJob ? (
                      <div className="mt-6 flex justify-end">
                        <Button type="button" className="h-11 rounded-lg px-5 hover:opacity-90" disabled={!scheduleDirty || isSavingSchedule} aria-busy={isSavingSchedule} onClick={saveSchedule}>{isSavingSchedule ? "Saving…" : "Save schedule"}</Button>
                      </div>
                    ) : null}
                  </WorkspaceSection>
                </TabsContent>

                {showCommercialDocuments ? (
                  <TabsContent value="documents" className="mt-0">
                    <WorkspaceSection title="Documents" description="Existing quote and invoice actions remain connected to the current document workflow.">
                      <div className="grid gap-4 md:grid-cols-2">
                        <article className="record-thin-border rounded-lg border-sky-200 bg-sky-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <FileText className="h-5 w-5 text-sky-700" />
                              <h3 className="mt-3 font-semibold text-slate-950">Quote</h3>
                              <p className="mt-1 text-sm text-slate-600">{job.quote ? `Saved · ${money(calculateQuoteTotal(job.quote.items))}` : "No quote saved yet"}</p>
                              {job.quote?.sentHistory?.length ? <p className="mt-2 text-xs text-slate-500">Sent {job.quote.sentHistory.length} {job.quote.sentHistory.length === 1 ? "time" : "times"}</p> : null}
                            </div>
                            {job.quote?.sentHistory?.length && onOpenSentDocument ? <Button type="button" variant="outline" className="h-11 rounded-lg bg-white" onClick={() => onOpenSentDocument("quote")}>Open sent</Button> : null}
                          </div>
                          {onOpenDocument ? <Button type="button" className="mt-4 h-11 rounded-lg hover:opacity-90" onClick={() => onOpenDocument("quote")}>Open Quote Editor</Button> : null}
                        </article>

                        <article className="record-thin-border rounded-lg border-emerald-200 bg-emerald-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <FileText className="h-5 w-5 text-emerald-700" />
                              <h3 className="mt-3 font-semibold text-slate-950">Invoice</h3>
                              <p className="mt-1 text-sm text-slate-600">{job.invoice ? `Saved · ${money(calculateInvoiceTotal(job.invoice.items))}` : "No invoice saved yet"}</p>
                              {job.invoice ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Badge className={invoiceStatus.className}>{invoiceStatus.label}</Badge>
                                  <Badge variant="secondary">Balance {money(invoicePayment.balanceAmount)}</Badge>
                                </div>
                              ) : null}
                              {job.invoice?.sentHistory?.length ? <p className="mt-2 text-xs text-slate-500">Sent {job.invoice.sentHistory.length} {job.invoice.sentHistory.length === 1 ? "time" : "times"}</p> : null}
                            </div>
                            {job.invoice?.sentHistory?.length && onOpenSentDocument ? <Button type="button" variant="outline" className="h-11 rounded-lg bg-white" onClick={() => onOpenSentDocument("invoice")}>Open sent</Button> : null}
                          </div>
                          {onOpenDocument ? <Button type="button" className="mt-4 h-11 rounded-lg hover:opacity-90" onClick={() => onOpenDocument("invoice")}>Open Invoice Editor</Button> : null}
                        </article>
                      </div>
                    </WorkspaceSection>
                  </TabsContent>
                ) : null}

                <TabsContent value="notes" className="mt-0">
                  <WorkspaceSection title="Job notes" description="Add field notes, faults found, and parts needed.">
                    <div className="grid gap-3">
                      <Label htmlFor="new-job-note">New note</Label>
                      <Textarea id="new-job-note" rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add site notes, faults found, parts needed..." />
                      <div className="flex justify-end">
                        <Button type="button" className="h-11 rounded-lg" disabled={!note.trim()} onClick={async () => {
                          const noteText = note.trim();
                          if (!noteText) return;
                          const saved = await onAddNote(noteText);
                          if (saved === false) {
                            setPageError("The note could not be added.");
                            return;
                          }
                          setNote("");
                        }}>Add note</Button>
                      </div>
                    </div>
                    <div className="mt-6 divide-y divide-slate-200">
                      {(job.notes || []).length === 0 ? (
                        <p className="record-empty-state rounded-lg px-4 py-4 text-sm">No notes yet.</p>
                      ) : job.notes.map((entry) => (
                        <article key={entry.id} className="py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-slate-900">{entry.author}</p>
                            <time className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</time>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{entry.text}</p>
                        </article>
                      ))}
                    </div>
                  </WorkspaceSection>

                  <WorkspaceSection
                    title="Photos"
                    description="Upload and review images attached to this job."
                    trailing={(
                      <Label htmlFor="job-photo-upload" className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium hover:bg-slate-50">
                        <Camera className="h-4 w-4" /> Upload photos
                      </Label>
                    )}
                  >
                    <Input id="job-photo-upload" type="file" accept="image/*" multiple className="hidden" onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      if (files.length) onAddPhotos(files);
                      event.target.value = "";
                    }} />
                    {jobPhotos.length === 0 ? (
                      <WorkspaceMessage>No photos uploaded yet.</WorkspaceMessage>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {jobPhotos.map((photo, index) => (
                          <div key={photo.id} className="record-thin-border group relative overflow-hidden rounded-lg border-slate-200 bg-slate-50">
                            <button type="button" className="w-full text-left outline-none focus-visible:ring-3 focus-visible:ring-sky-300" onClick={() => setSelectedPhoto(photo)}>
                              <img src={photo.url} alt={photo.name || `Job photo ${index + 1}`} className="h-36 w-full object-cover" />
                              <p className="truncate px-3 py-3 text-sm font-medium text-slate-900">{photo.name || `Photo ${index + 1}`}</p>
                            </button>
                            {onDeletePhoto ? (
                              <Button type="button" size="icon" variant="outline" className="absolute right-2 top-2 h-11 w-11 rounded-full bg-white/95 text-rose-700 opacity-100 shadow-sm sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100" onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onDeletePhoto(photo);
                              }} aria-label={`Delete ${photo.name || `photo ${index + 1}`}`}><Trash2 className="h-4 w-4" /></Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </WorkspaceSection>
                </TabsContent>
              </div>
            </Tabs>

            {canDeleteJob ? (
              <div className="px-4 pb-5 pt-0 sm:px-7 lg:px-9">
                <Button type="button" variant="destructive" className="h-11 rounded-lg" onClick={async () => {
                  const deleted = await onDeleteJob();
                  if (deleted) onDeleted();
                }}><Trash2 className="h-4 w-4" /> Delete job</Button>
              </div>
            ) : null}
          </div>
        </div>
      </RecordWorkspace>

      <Dialog open={Boolean(activeSelectedPhoto)} onOpenChange={(open) => {
        if (!open) setSelectedPhoto(null);
      }}>
        <DialogContent className="max-h-[92vh] rounded-3xl sm:max-w-5xl">
          <DialogHeader><DialogTitle className="truncate pr-6 text-xl">{activeSelectedPhoto?.name || "Job photo"}</DialogTitle></DialogHeader>
          <DialogBody>
            {activeSelectedPhoto ? (
              <div className="flex min-h-[50vh] items-center justify-center gap-2">
                {jobPhotos.length > 1 ? <Button type="button" variant="outline" size="icon-lg" className="shrink-0 rounded-full" onClick={() => cyclePhoto(-1)} aria-label="Previous photo"><ChevronLeft className="h-5 w-5" /></Button> : null}
                <div className="flex min-h-[50vh] min-w-0 flex-1 items-center justify-center rounded-2xl bg-slate-950 p-3">
                  <img src={activeSelectedPhoto.url} alt={activeSelectedPhoto.name || "Job photo"} className="max-h-[72vh] max-w-full rounded-xl object-contain" />
                </div>
                {jobPhotos.length > 1 ? <Button type="button" variant="outline" size="icon-lg" className="shrink-0 rounded-full" onClick={() => cyclePhoto(1)} aria-label="Next photo"><ChevronRight className="h-5 w-5" /></Button> : null}
              </div>
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
