import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MapPin, Plus, Search, UserRound } from "lucide-react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import ContactSnapshotEditor from "@/components/shared/ContactSnapshotEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  RecordWorkspace,
  WorkspaceActionBar,
  WorkspaceMessage,
  WorkspaceSection,
} from "@/components/workspace/RecordWorkspace";
import {
  buildCustomerSites,
  customerTypeOptions,
  formatCustomerType,
  formatSiteType,
  getCustomerContacts,
  getCustomerSiteAccessNote,
  getSiteDisplayName,
  normalizeSiteAddress,
  siteTypeOptions,
  urgencyOptions,
} from "@/lib/app-support";

const NOT_SET_VALUE = "not-set";
const UNASSIGNED_VALUE = "unassigned";

function createEmptySiteDraft() {
  return {
    address: "",
    siteType: "",
    ocNumber: "",
    accessNotes: "",
    notes: "",
    contactId: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  };
}

function RequiredMessage({ id, show, children = "This field is required." }) {
  if (!show) return null;
  return <p id={id} className="text-sm text-rose-700">{children}</p>;
}

export default function CreateJobPage({
  backLabel,
  customers,
  jobs,
  staff,
  onCancel,
  onCreated,
  onSave,
  registerNavigationBlocker,
}) {
  const orderedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );
  const orderedStaff = useMemo(
    () => [...(staff || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [staff]
  );
  const [customerMode, setCustomerMode] = useState("existing");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [changingCustomer, setChangingCustomer] = useState(false);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "", customerType: "" });
  const [siteMode, setSiteMode] = useState("select");
  const [changingSite, setChangingSite] = useState(false);
  const [siteDraft, setSiteDraft] = useState(createEmptySiteDraft);
  const [job, setJob] = useState({
    title: "",
    description: "",
    urgency: "Medium",
    jobAddress: "",
    ocNumber: "",
    scheduledDate: "",
    assignedTechnicianId: "",
    assignedTechnicianName: "",
    requesterContact: null,
    onsiteContact: null,
    billingContact: null,
  });
  const [touched, setTouched] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submittingRef = useRef(false);

  const markDirty = () => {
    setIsDirty(true);
    setSubmitError("");
  };

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.toLowerCase().trim();
    if (!query) return orderedCustomers;

    return orderedCustomers.filter((entry) =>
      [
        entry.name,
        entry.email,
        entry.phone,
        entry.customerType,
        entry.address,
        ...(entry.contacts || []).flatMap((contact) => [contact.name, contact.role, contact.phone, contact.email]),
        ...(entry.sites || []).flatMap((site) => [site.label, site.address, site.siteType, site.ocNumber]),
      ].join(" ").toLowerCase().includes(query)
    );
  }, [customerSearch, orderedCustomers]);

  const selectedCustomer = useMemo(
    () => orderedCustomers.find((entry) => entry.id === selectedCustomerId) || null,
    [orderedCustomers, selectedCustomerId]
  );
  const selectedCustomerJobs = useMemo(
    () => jobs.filter((entry) => entry.customerId === selectedCustomerId),
    [jobs, selectedCustomerId]
  );
  const selectedCustomerSites = useMemo(
    () => (selectedCustomer ? buildCustomerSites(selectedCustomer, selectedCustomerJobs) : []),
    [selectedCustomer, selectedCustomerJobs]
  );
  const selectedCustomerContacts = useMemo(
    () => (selectedCustomer ? getCustomerContacts(selectedCustomer) : []),
    [selectedCustomer]
  );
  const selectedSite = useMemo(
    () => selectedCustomerSites.find(
      (site) => normalizeSiteAddress(site.address).toLowerCase() === normalizeSiteAddress(job.jobAddress).toLowerCase()
    ) || null,
    [job.jobAddress, selectedCustomerSites]
  );
  const availableContacts = customerMode === "existing" ? selectedCustomerContacts : [];

  useEffect(() => {
    if (customerMode !== "existing" || !selectedCustomer) return;
    const defaultSite = selectedCustomerSites[0] || null;
    if (defaultSite) {
      setSiteMode("select");
      setChangingSite(false);
      setSiteDraft(createEmptySiteDraft());
      setJob((current) => ({
        ...current,
        jobAddress: defaultSite.address,
        ocNumber: defaultSite.ocNumber || "",
        requesterContact: null,
        onsiteContact: null,
        billingContact: null,
      }));
      return;
    }

    setSiteMode("create");
    setSiteDraft({ ...createEmptySiteDraft(), address: selectedCustomer.address || "" });
    setJob((current) => ({
      ...current,
      jobAddress: selectedCustomer.address || "",
      ocNumber: "",
      requesterContact: null,
      onsiteContact: null,
      billingContact: null,
    }));
  }, [customerMode, selectedCustomer, selectedCustomerSites]);

  useEffect(() => registerNavigationBlocker(() => isDirty && !isSubmitting), [isDirty, isSubmitting, registerNavigationBlocker]);

  const selectedJobAddress = customerMode === "new" || siteMode === "create"
    ? siteDraft.address
    : job.jobAddress;
  const selectedSiteAccessNote = customerMode === "existing" && siteMode === "select"
    ? getCustomerSiteAccessNote(selectedCustomer, selectedJobAddress)
    : siteDraft.accessNotes
      ? { notes: siteDraft.accessNotes }
      : null;
  const hasCustomer = customerMode === "new" ? Boolean(customer.name.trim()) : Boolean(selectedCustomerId);
  const hasAddress = Boolean(normalizeSiteAddress(selectedJobAddress));
  const hasTitle = Boolean(job.title.trim());
  const hasDescription = Boolean(job.description.trim());
  const canSave = hasCustomer && hasAddress && hasTitle && hasDescription && !isSubmitting;

  const selectCustomer = (entry) => {
    markDirty();
    setSelectedCustomerId(entry.id);
    setChangingCustomer(false);
    setTouched((current) => ({ ...current, customer: true }));
  };

  const selectSite = (site) => {
    markDirty();
    setJob((current) => ({ ...current, jobAddress: site.address, ocNumber: site.ocNumber || current.ocNumber || "" }));
    setChangingSite(false);
    setTouched((current) => ({ ...current, site: true }));
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    setTouched({ customer: true, site: true, title: true, description: true });
    if (!canSave) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const existingCustomer = orderedCustomers.find((entry) => entry.id === selectedCustomerId) || null;
      const jobAddress = normalizeSiteAddress(selectedJobAddress);
      const shouldCreateSite = customerMode === "new" || siteMode === "create";
      const siteInput = shouldCreateSite
        ? { ...siteDraft, address: jobAddress }
        : null;
      const saved = await onSave({
        job: {
          ...job,
          jobAddress,
          ocNumber: (job.ocNumber || "").trim() || (selectedSite?.ocNumber || siteInput?.ocNumber || ""),
        },
        customerMode,
        customer: customerMode === "existing" ? existingCustomer : customer,
        siteInput,
      });

      if (!saved?.id) {
        setSubmitError("The job could not be created. Check the details and try again.");
        return;
      }

      setIsDirty(false);
      onCreated(saved);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The job could not be created. Try again.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <RecordWorkspace
      backLabel={backLabel}
      eyebrow="Jobs"
      title="Create Job"
      subtitle="Assign the customer, site, work details, and schedule."
      onBack={() => onCancel()}
      maxWidth="max-w-5xl"
    >
      <div className="grid gap-3 sm:gap-4">
        <WorkspaceSection
          id="create-job-customer"
          panel
          title="Customer"
          description="Choose an existing customer or add a new customer without leaving this job."
        >
          <div className="data-toggle-shell mb-4 grid grid-cols-2 rounded-lg border p-1 sm:max-w-md" aria-label="Customer type">
            <Button
              type="button"
              variant="ghost"
              className={`h-11 rounded-md ${customerMode === "existing" ? "!bg-slate-950 !text-white hover:!bg-slate-950 hover:!text-white" : "text-slate-700 hover:bg-white/70"}`}
              aria-pressed={customerMode === "existing"}
              onClick={() => {
                if (customerMode === "existing") return;
                markDirty();
                setCustomerMode("existing");
                setSelectedCustomerId("");
                setSiteDraft(createEmptySiteDraft());
              }}
            >
              Existing Customer
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={`h-11 rounded-md ${customerMode === "new" ? "!bg-slate-950 !text-white hover:!bg-slate-950 hover:!text-white" : "text-slate-700 hover:bg-white/70"}`}
              aria-pressed={customerMode === "new"}
              onClick={() => {
                if (customerMode === "new") return;
                markDirty();
                setCustomerMode("new");
                setSiteMode("create");
                setChangingSite(false);
                setSiteDraft(createEmptySiteDraft());
                setJob((current) => ({
                  ...current,
                  jobAddress: "",
                  ocNumber: "",
                  requesterContact: null,
                  onsiteContact: null,
                  billingContact: null,
                }));
              }}
            >
              Add New Customer
            </Button>
          </div>

          {customerMode === "existing" ? (
            selectedCustomer && !changingCustomer ? (
              <div className="record-selection-panel flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserRound className="h-4 w-4 text-sky-700" aria-hidden="true" />
                    <p className="font-semibold text-slate-950">{selectedCustomer.name}</p>
                    {selectedCustomer.customerType ? <Badge variant="secondary">{formatCustomerType(selectedCustomer.customerType)}</Badge> : null}
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="h-3.5 w-3.5" /> Selected</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{selectedCustomer.address || "No address saved"}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {[selectedCustomer.email, selectedCustomer.phone].filter(Boolean).join(" · ") || "No email or phone saved"}
                  </p>
                </div>
                <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={() => setChangingCustomer(true)}>
                  Change customer
                </Button>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="customer-search">Search customers</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <Input
                      id="customer-search"
                      className="h-11 pl-10"
                      value={customerSearch}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      placeholder="Search by name, email, phone or address..."
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-xs text-slate-500">{filteredCustomers.length} customer{filteredCustomers.length === 1 ? "" : "s"} found</p>
                </div>

                <div className="record-result-list divide-y divide-slate-200 overflow-hidden rounded-lg bg-white/70" aria-label="Customer search results">
                  {filteredCustomers.length === 0 ? (
                    <p className="py-6 text-sm text-slate-500">No customers match that search.</p>
                  ) : filteredCustomers.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="flex min-h-[4.5rem] w-full items-start justify-between gap-3 px-3 py-3 text-left outline-none transition hover:bg-[var(--data-view-row-hover)] focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                      onClick={() => selectCustomer(entry)}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-950">{entry.name}</span>
                          {entry.customerType ? <Badge variant="secondary">{formatCustomerType(entry.customerType)}</Badge> : null}
                        </span>
                        <span className="mt-1 block text-sm text-slate-600">{entry.address || "No address saved"}</span>
                        <span className="mt-1 block text-sm text-slate-500">{[entry.email, entry.phone].filter(Boolean).join(" · ") || "No email or phone saved"}</span>
                      </span>
                      <span className="mt-0.5 shrink-0 rounded-md border bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-900">Select</span>
                    </button>
                  ))}
                </div>
                <RequiredMessage id="customer-required" show={touched.customer && !hasCustomer}>Choose a customer.</RequiredMessage>
              </div>
            )
          ) : (
            <div className="grid gap-4 sm:gap-5">
              <div className="grid gap-2">
                <Label htmlFor="new-customer-name">Customer or company name</Label>
                <Input
                  id="new-customer-name"
                  className="h-11"
                  value={customer.name}
                  aria-invalid={touched.customer && !customer.name.trim()}
                  aria-describedby={touched.customer && !customer.name.trim() ? "new-customer-name-error" : undefined}
                  onBlur={() => setTouched((current) => ({ ...current, customer: true }))}
                  onChange={(event) => {
                    markDirty();
                    setCustomer((current) => ({ ...current, name: event.target.value }));
                  }}
                />
                <RequiredMessage id="new-customer-name-error" show={touched.customer && !customer.name.trim()} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="new-customer-email">Email</Label>
                  <Input id="new-customer-email" type="email" className="h-11" value={customer.email} onChange={(event) => {
                    markDirty();
                    setCustomer((current) => ({ ...current, email: event.target.value }));
                  }} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-customer-phone">Phone number</Label>
                  <Input id="new-customer-phone" type="tel" className="h-11" value={customer.phone} onChange={(event) => {
                    markDirty();
                    setCustomer((current) => ({ ...current, phone: event.target.value }));
                  }} />
                </div>
              </div>
              <div className="grid gap-2 sm:max-w-sm">
                <Label>Customer type</Label>
                <Select value={customer.customerType || NOT_SET_VALUE} onValueChange={(value) => {
                  markDirty();
                  setCustomer((current) => ({ ...current, customerType: value === NOT_SET_VALUE ? "" : value }));
                }}>
                  <SelectTrigger className="h-11" aria-label="Customer type"><SelectValue placeholder="Select customer type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
                    {customerTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </WorkspaceSection>

        <WorkspaceSection
          id="create-job-site"
          panel
          title="Site"
          description={customerMode === "new" ? "Add the first site for this customer." : "Choose a saved site or add a site for this job."}
        >
          {customerMode === "existing" && !selectedCustomer ? (
            <WorkspaceMessage>Select a customer to see their saved sites.</WorkspaceMessage>
          ) : siteMode === "select" && selectedCustomerSites.length > 0 ? (
            selectedSite && !changingSite ? (
              <div className="record-selection-panel flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <MapPin className="h-4 w-4 text-sky-700" aria-hidden="true" />
                    <p className="font-semibold text-slate-950">{getSiteDisplayName(selectedSite)}</p>
                    {selectedSite.siteType ? <Badge variant="secondary">{formatSiteType(selectedSite.siteType)}</Badge> : null}
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="h-3.5 w-3.5" /> Selected</span>
                  </div>
                  {selectedSite.contactName ? (
                    <p className="mt-2 text-sm text-slate-500">{[selectedSite.contactName, selectedSite.contactPhone, selectedSite.contactEmail].filter(Boolean).join(" · ")}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={() => setChangingSite(true)}>Change site</Button>
                  <Button type="button" variant="ghost" className="h-11 rounded-lg" onClick={() => {
                    markDirty();
                    setSiteMode("create");
                    setSiteDraft({ ...createEmptySiteDraft(), address: selectedCustomer?.address || "" });
                  }}><Plus className="h-4 w-4" /> Add site</Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="record-result-list divide-y divide-slate-200 overflow-hidden rounded-lg bg-white/70" aria-label="Saved sites">
                  {selectedCustomerSites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      className="flex min-h-[4.5rem] w-full items-start justify-between gap-3 px-3 py-3 text-left outline-none transition hover:bg-[var(--data-view-row-hover)] focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                      onClick={() => selectSite(site)}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-950">{getSiteDisplayName(site)}</span>
                          {site.siteType ? <Badge variant="secondary">{formatSiteType(site.siteType)}</Badge> : null}
                        </span>
                        {site.contactName ? <span className="mt-1 block text-sm text-slate-500">{[site.contactName, site.contactPhone].filter(Boolean).join(" · ")}</span> : null}
                      </span>
                      <span className="mt-0.5 shrink-0 rounded-md border bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-900">Select</span>
                    </button>
                  ))}
                </div>
                <Button type="button" variant="outline" className="h-11 justify-self-start rounded-lg" onClick={() => {
                  markDirty();
                  setSiteMode("create");
                  setSiteDraft({ ...createEmptySiteDraft(), address: selectedCustomer?.address || "" });
                }}><Plus className="h-4 w-4" /> Add a new site</Button>
              </div>
            )
          ) : (
            <div className="grid gap-4 sm:gap-5">
              {customerMode === "existing" && selectedCustomerSites.length > 0 ? (
                <Button type="button" variant="ghost" className="h-11 justify-self-start rounded-lg" onClick={() => {
                  markDirty();
                  setSiteMode("select");
                  selectSite(selectedCustomerSites[0]);
                }}>Use a saved site</Button>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="new-site-address">{customerMode === "new" ? "Primary site address" : "Site address"}</Label>
                <AddressAutocompleteInput
                  id="new-site-address"
                  value={siteDraft.address}
                  onBlur={() => setTouched((current) => ({ ...current, site: true }))}
                  onChange={(value) => {
                    markDirty();
                    setSiteDraft((current) => ({ ...current, address: value }));
                  }}
                  placeholder="Search the site address for this job"
                />
                <RequiredMessage id="site-address-error" show={touched.site && !hasAddress}>Enter a site address.</RequiredMessage>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
                <div className="grid gap-2">
                  <Label>Site type</Label>
                  <Select value={siteDraft.siteType || NOT_SET_VALUE} onValueChange={(value) => {
                    markDirty();
                    setSiteDraft((current) => ({ ...current, siteType: value === NOT_SET_VALUE ? "" : value }));
                  }}>
                    <SelectTrigger className="h-11" aria-label="Site type"><SelectValue placeholder="Select site type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
                      {siteTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-site-oc-number">OC number</Label>
                  <Input id="new-site-oc-number" className="h-11" value={siteDraft.ocNumber} onChange={(event) => {
                    markDirty();
                    setSiteDraft((current) => ({ ...current, ocNumber: event.target.value }));
                  }} placeholder="Optional client reference" />
                </div>
              </div>
              <ContactSnapshotEditor
                title="Site contact"
                description="Optional. This becomes the default on-site contact for jobs at this address."
                contacts={availableContacts}
                fallbackRole="Site contact"
                value={{
                  id: siteDraft.contactId,
                  name: siteDraft.contactName,
                  role: "Site contact",
                  phone: siteDraft.contactPhone,
                  email: siteDraft.contactEmail,
                }}
                onChange={(contact) => {
                  markDirty();
                  setSiteDraft((current) => ({
                    ...current,
                    contactId: contact?.id || "",
                    contactName: contact?.name || "",
                    contactPhone: contact?.phone || "",
                    contactEmail: contact?.email || "",
                  }));
                }}
              />
              <div className="grid gap-2">
                <Label htmlFor="new-site-access-notes">Access notes</Label>
                <Textarea id="new-site-access-notes" rows={3} value={siteDraft.accessNotes} onChange={(event) => {
                  markDirty();
                  setSiteDraft((current) => ({ ...current, accessNotes: event.target.value }));
                }} placeholder="Gate code, parking, call-on-arrival details, after-hours information..." />
              </div>
            </div>
          )}

          {selectedSiteAccessNote?.notes ? (
            <div className="mt-5 border-l-4 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">Site access notes</p>
              <p className="mt-1 whitespace-pre-wrap leading-6">{selectedSiteAccessNote.notes}</p>
            </div>
          ) : null}
        </WorkspaceSection>

        <WorkspaceSection
          id="create-job-details"
          panel
          title="Job details"
          description="Describe the work request using the same details stored on the existing job record."
        >
          <div className="grid gap-4 sm:gap-5">
            <div className="grid gap-2">
              <Label htmlFor="job-title">Job title</Label>
              <Input
                id="job-title"
                className="h-11"
                value={job.title}
                aria-invalid={touched.title && !hasTitle}
                aria-describedby={touched.title && !hasTitle ? "job-title-error" : undefined}
                onBlur={() => setTouched((current) => ({ ...current, title: true }))}
                onChange={(event) => {
                  markDirty();
                  setJob((current) => ({ ...current, title: event.target.value }));
                }}
                placeholder="e.g. Swing gate motor replacement"
              />
              <RequiredMessage id="job-title-error" show={touched.title && !hasTitle} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="job-description">Description of work</Label>
              <Textarea
                id="job-description"
                rows={6}
                value={job.description}
                aria-invalid={touched.description && !hasDescription}
                aria-describedby={touched.description && !hasDescription ? "job-description-error" : undefined}
                onBlur={() => setTouched((current) => ({ ...current, description: true }))}
                onChange={(event) => {
                  markDirty();
                  setJob((current) => ({ ...current, description: event.target.value }));
                }}
              />
              <RequiredMessage id="job-description-error" show={touched.description && !hasDescription} />
            </div>
            <div className="grid gap-2 sm:max-w-md">
              <Label htmlFor="job-oc-number">OC number</Label>
              <Input id="job-oc-number" className="h-11" value={job.ocNumber} onChange={(event) => {
                markDirty();
                setJob((current) => ({ ...current, ocNumber: event.target.value }));
              }} placeholder="Optional invoice reference" />
            </div>
          </div>
        </WorkspaceSection>

        <WorkspaceSection
          id="create-job-schedule"
          panel
          title="Schedule & assignment"
          description="Set the visit date, technician, and urgency. New jobs continue to start in To Do."
        >
          <div className="grid gap-4 md:grid-cols-2 md:gap-5">
            <div className="grid gap-2">
              <Label htmlFor="job-scheduled-date">Scheduled date</Label>
              <Input id="job-scheduled-date" className="h-11" type="date" value={job.scheduledDate} onChange={(event) => {
                markDirty();
                setJob((current) => ({ ...current, scheduledDate: event.target.value }));
              }} />
            </div>
            <div className="grid gap-2">
              <Label>Assigned technician</Label>
              <Select value={job.assignedTechnicianId || UNASSIGNED_VALUE} onValueChange={(value) => {
                markDirty();
                const technician = orderedStaff.find((entry) => entry.id === value) || null;
                setJob((current) => ({
                  ...current,
                  assignedTechnicianId: technician?.id || "",
                  assignedTechnicianName: technician?.name || "",
                }));
              }}>
                <SelectTrigger className="h-11" aria-label="Assigned technician"><SelectValue placeholder="Choose a technician" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                  {orderedStaff.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}{entry.role ? ` · ${entry.role}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Urgency</Label>
              <Select value={job.urgency} onValueChange={(value) => {
                markDirty();
                setJob((current) => ({ ...current, urgency: value }));
              }}>
                <SelectTrigger className="h-11" aria-label="Urgency"><SelectValue /></SelectTrigger>
                <SelectContent>{urgencyOptions.map((urgency) => <SelectItem key={urgency} value={urgency}>{urgency}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="record-passive-surface rounded-lg px-4 py-3 text-sm">
              <p className="font-medium text-slate-950">Initial status</p>
              <p className="mt-1 text-slate-600">To Do</p>
            </div>
          </div>

          <details className="record-inset-surface mt-5 rounded-lg p-3 sm:p-4">
            <summary className="cursor-pointer font-medium text-slate-950">Job contacts (optional)</summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">Leave these blank to use the saved site and customer billing contacts.</p>
            <div className="mt-5 grid gap-4">
              <ContactSnapshotEditor title="Requester" description="Who asked for the work or booked the visit." contacts={availableContacts} fallbackRole="Requester" value={job.requesterContact} onChange={(contact) => {
                markDirty();
                setJob((current) => ({ ...current, requesterContact: contact }));
              }} />
              <ContactSnapshotEditor title="On-site contact" description="Who the team should speak with on arrival." contacts={availableContacts} fallbackRole="On-site contact" value={job.onsiteContact} onChange={(contact) => {
                markDirty();
                setJob((current) => ({ ...current, onsiteContact: contact }));
              }} />
              <ContactSnapshotEditor title="Billing contact" description="Who quotes and invoices should go to for this job." contacts={availableContacts} fallbackRole="Billing contact" value={job.billingContact} onChange={(contact) => {
                markDirty();
                setJob((current) => ({ ...current, billingContact: contact }));
              }} />
            </div>
          </details>
        </WorkspaceSection>
      </div>

      {submitError ? <div className="mt-5" role="alert"><WorkspaceMessage tone="error">{submitError}</WorkspaceMessage></div> : null}

      <WorkspaceActionBar
        maxWidth="max-w-5xl"
        status={isSubmitting ? "Creating job…" : isDirty ? "Unsaved job" : ""}
      >
        <Button type="button" variant="outline" className="h-11 rounded-lg px-4" onClick={() => onCancel()} disabled={isSubmitting}>Cancel</Button>
        <Button type="button" className="h-11 rounded-lg px-5 hover:opacity-90" disabled={!canSave} aria-busy={isSubmitting} onClick={handleSubmit}>
          {isSubmitting ? "Creating…" : "Create Job"}
        </Button>
      </WorkspaceActionBar>
    </RecordWorkspace>
  );
}
