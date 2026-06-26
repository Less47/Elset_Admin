import { useEffect, useMemo, useState } from "react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  buildCustomerSites,
  customerTypeOptions,
  formatCustomerType,
  formatSiteType,
  getCustomerSiteAccessNote,
  getSiteDisplayName,
  normalizeSiteAddress,
  siteTypeOptions,
  urgencyOptions,
} from "@/lib/app-support";

const NOT_SET_VALUE = "not-set";

export default function JobFormDialog({ open, onOpenChange, customers, jobs, staff, onSave }) {
  const orderedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );
  const defaultStaffId = staff[0]?.id || "";
  const emptySiteDraft = useMemo(
    () => ({
      address: "",
      siteType: "",
      ocNumber: "",
      accessNotes: "",
      notes: "",
    }),
    []
  );
  const [mode, setMode] = useState("existing");
  const [selectedCustomerId, setSelectedCustomerId] = useState(orderedCustomers[0]?.id || "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "", customerType: "" });
  const [existingSiteMode, setExistingSiteMode] = useState("select");
  const [siteDraft, setSiteDraft] = useState(emptySiteDraft);
  const [job, setJob] = useState({
    title: "",
    description: "",
    urgency: "Medium",
    assignedTechnicianId: defaultStaffId,
    jobAddress: orderedCustomers[0]?.address || "",
    ocNumber: "",
    scheduledDate: "",
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setMode("existing");
      setSelectedCustomerId(orderedCustomers[0]?.id || "");
      setCustomerSearch("");
      setCustomer({ name: "", email: "", phone: "", customerType: "" });
      setExistingSiteMode("select");
      setSiteDraft(emptySiteDraft);
      setJob({
        title: "",
        description: "",
        urgency: "Medium",
        assignedTechnicianId: defaultStaffId,
        jobAddress: orderedCustomers[0]?.address || "",
        ocNumber: "",
        scheduledDate: "",
      });
    }
  }, [defaultStaffId, emptySiteDraft, open, orderedCustomers]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filteredExistingCustomers = useMemo(() => {
    const query = customerSearch.toLowerCase().trim();
    if (!query) return orderedCustomers;

    return orderedCustomers.filter((entry) =>
      [
        entry.name,
        entry.email,
        entry.phone,
        entry.customerType,
        entry.address,
        ...(entry.siteAccessNotes || []).flatMap((site) => [site.address, site.notes]),
        ...(entry.sites || []).flatMap((site) => [
          site.label,
          site.address,
          site.siteType,
          site.ocNumber,
          site.accessNotes,
          site.notes,
          ...(site.assets || []).flatMap((asset) => [asset.name, asset.type, asset.location, asset.model, asset.notes]),
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [customerSearch, orderedCustomers]);

  const selectedExistingCustomer = useMemo(
    () => orderedCustomers.find((entry) => entry.id === selectedCustomerId) || null,
    [orderedCustomers, selectedCustomerId]
  );
  const selectedExistingCustomerJobs = useMemo(
    () => jobs.filter((entry) => entry.customerId === selectedCustomerId),
    [jobs, selectedCustomerId]
  );
  const selectedExistingCustomerSites = useMemo(
    () => (selectedExistingCustomer ? buildCustomerSites(selectedExistingCustomer, selectedExistingCustomerJobs) : []),
    [selectedExistingCustomer, selectedExistingCustomerJobs]
  );
  const selectedExistingSite = useMemo(
    () =>
      selectedExistingCustomerSites.find(
        (site) => normalizeSiteAddress(site.address).toLowerCase() === normalizeSiteAddress(job.jobAddress).toLowerCase()
      ) || null,
    [job.jobAddress, selectedExistingCustomerSites]
  );

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || mode !== "existing") return;
    const defaultSite = selectedExistingCustomerSites[0] || null;

    if (defaultSite) {
      setExistingSiteMode("select");
      setSiteDraft(emptySiteDraft);
      setJob((prev) => ({ ...prev, jobAddress: defaultSite.address }));
      setJob((prev) => ({ ...prev, ocNumber: defaultSite.ocNumber || "" }));
      return;
    }

    const fallbackAddress = selectedExistingCustomer?.address || "";
    setExistingSiteMode("create");
    setSiteDraft({
      ...emptySiteDraft,
      address: fallbackAddress,
    });
    setJob((prev) => ({ ...prev, jobAddress: fallbackAddress, ocNumber: "" }));
  }, [emptySiteDraft, mode, open, selectedExistingCustomer?.address, selectedExistingCustomer?.id, selectedExistingCustomerSites]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedJobAddress = mode === "existing"
    ? existingSiteMode === "create"
      ? siteDraft.address
      : job.jobAddress
    : siteDraft.address;
  const selectedSiteAccessNote =
    mode === "existing"
      ? existingSiteMode === "create"
        ? (siteDraft.accessNotes ? { notes: siteDraft.accessNotes } : null)
        : getCustomerSiteAccessNote(selectedExistingCustomer, selectedJobAddress)
      : siteDraft.accessNotes
        ? { notes: siteDraft.accessNotes }
        : null;
  const canCreateSite = Boolean(normalizeSiteAddress(siteDraft.address));
  const canSave = Boolean(
    job.title.trim() &&
      job.description.trim() &&
      job.assignedTechnicianId &&
      normalizeSiteAddress(selectedJobAddress) &&
      (mode === "existing" ? selectedCustomerId : customer.name.trim())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] rounded-3xl sm:max-w-[96vw] xl:max-w-[1520px] 2xl:max-w-[1660px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Create New Job</DialogTitle>
        </DialogHeader>

        <DialogBody>
        <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.96fr)_minmax(420px,1.14fr)_minmax(320px,0.9fr)]">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose an existing customer or add a new record before assigning the site and job details.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Tabs
                value={mode}
                onValueChange={(value) => {
                  setMode(value);
                  setSiteDraft(emptySiteDraft);
                }}
              >
                <TabsList className="grid w-full grid-cols-2 rounded-xl">
                  <TabsTrigger value="existing">Existing Customer</TabsTrigger>
                  <TabsTrigger value="new">Add New Customer</TabsTrigger>
                </TabsList>
                <TabsContent value="existing" className="mt-4 grid gap-4">
                  <FormField label="Find customer">
                    <Input
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search name, email, phone, or address..."
                    />
                  </FormField>

                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span>{filteredExistingCustomers.length} customer{filteredExistingCustomers.length === 1 ? "" : "s"} found</span>
                    <span>{selectedExistingCustomer ? `Selected: ${selectedExistingCustomer.name}` : "No customer selected"}</span>
                  </div>

                  <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                    {filteredExistingCustomers.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500">No customers match that search yet.</div>
                    ) : (
                      filteredExistingCustomers.map((entry, index) => {
                        const isSelected = entry.id === selectedCustomerId;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => setSelectedCustomerId(entry.id)}
                            className={`grid w-full gap-1 px-4 py-3 text-left transition ${
                              index !== filteredExistingCustomers.length - 1 ? "border-b border-slate-200" : ""
                            } ${
                              isSelected
                                ? "bg-slate-900 text-white"
                                : "bg-white text-slate-900 hover:bg-slate-100"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="font-medium">{entry.name}</p>
                                {entry.customerType ? (
                                  <Badge className={isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"}>
                                    {formatCustomerType(entry.customerType)}
                                  </Badge>
                                ) : null}
                              </div>
                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                                  isSelected
                                    ? "bg-white/15 text-white"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {isSelected ? "Selected" : "Record"}
                              </span>
                            </div>
                            <p className={`truncate text-sm ${isSelected ? "text-slate-200" : "text-slate-600"}`}>
                              {entry.email || "No email"}{entry.phone ? ` - ${entry.phone}` : ""}
                            </p>
                            <p className={`truncate text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                              {entry.address || "No address saved"}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {selectedExistingCustomer && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Selected customer</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Customer</p>
                          <p className="mt-1 font-medium text-slate-900">{selectedExistingCustomer.name}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Email</p>
                          <p className="mt-1 font-medium text-slate-900">{selectedExistingCustomer.email || "Not set"}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Phone</p>
                          <p className="mt-1 font-medium text-slate-900">{selectedExistingCustomer.phone || "Not set"}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Customer type</p>
                          <p className="mt-1 font-medium text-slate-900">{formatCustomerType(selectedExistingCustomer.customerType)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Address</p>
                          <p className="mt-1 font-medium text-slate-900">{selectedExistingCustomer.address || "Not set"}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="new" className="mt-4 grid gap-4">
                  <FormField label="Customer / company name">
                    <Input value={customer.name} onChange={(e) => setCustomer((p) => ({ ...p, name: e.target.value }))} />
                  </FormField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Email">
                      <Input value={customer.email} onChange={(e) => setCustomer((p) => ({ ...p, email: e.target.value }))} />
                    </FormField>
                    <FormField label="Phone number">
                      <Input value={customer.phone} onChange={(e) => setCustomer((p) => ({ ...p, phone: e.target.value }))} />
                    </FormField>
                  </div>
                  <FormField label="Customer type">
                    <Select
                      value={customer.customerType || NOT_SET_VALUE}
                      onValueChange={(value) => setCustomer((p) => ({ ...p, customerType: value === NOT_SET_VALUE ? "" : value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
                        {customerTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">Site</CardTitle>
              <p className="text-sm text-muted-foreground">
                {mode === "existing"
                  ? "Choose one of the customer's saved sites or create a new site for this job."
                  : "Create the first site profile for this customer while you create the job."}
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              {mode === "existing" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={existingSiteMode === "select" ? "secondary" : "outline"}
                    className="rounded-xl"
                    disabled={selectedExistingCustomerSites.length === 0}
                    onClick={() => {
                      if (selectedExistingCustomerSites.length === 0) return;
                      setExistingSiteMode("select");
                      setJob((prev) => ({
                        ...prev,
                        jobAddress: selectedExistingCustomerSites[0].address,
                        ocNumber: selectedExistingCustomerSites[0].ocNumber || "",
                      }));
                    }}
                  >
                    Select Site
                  </Button>
                  <Button
                    type="button"
                    variant={existingSiteMode === "create" ? "secondary" : "outline"}
                    className="rounded-xl"
                    onClick={() => {
                      setExistingSiteMode("create");
                      setSiteDraft((prev) => ({
                        ...emptySiteDraft,
                        ...prev,
                        address: prev.address || selectedExistingCustomer?.address || "",
                      }));
                    }}
                  >
                    Create Site
                  </Button>
                </div>
              ) : null}

              {mode === "existing" && existingSiteMode === "select" ? (
                selectedExistingCustomerSites.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    This customer does not have any saved sites yet. Use <span className="font-medium text-slate-700">Create Site</span> to add one now.
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label>Saved sites</Label>
                      <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                        <div className="grid gap-2">
                          {selectedExistingCustomerSites.map((site) => {
                            const isSelected = selectedExistingSite?.id === site.id;
                            return (
                              <button
                                key={site.id}
                                type="button"
                                onClick={() => setJob((prev) => ({ ...prev, jobAddress: site.address, ocNumber: site.ocNumber || "" }))}
                                className={`grid gap-2 rounded-xl border px-4 py-3 text-left transition ${
                                  isSelected
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-slate-100"
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-medium">{getSiteDisplayName(site)}</p>
                                </div>
                                  <div className="flex flex-wrap gap-2">
                                    {site.siteType ? (
                                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${isSelected ? "bg-white/15 text-white" : "bg-emerald-100 text-emerald-800"}`}>
                                        {formatSiteType(site.siteType)}
                                      </span>
                                    ) : null}
                                    {site.assetCount > 0 ? (
                                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${isSelected ? "bg-white/15 text-white" : "bg-teal-100 text-teal-800"}`}>
                                        {site.assetCount} items
                                      </span>
                                    ) : null}
                                    {site.jobCount > 0 ? (
                                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${isSelected ? "bg-white/15 text-white" : "bg-sky-100 text-sky-800"}`}>
                                        {site.jobCount} jobs
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                {site.accessNotes ? (
                                  <p className={`line-clamp-2 text-sm ${isSelected ? "text-slate-200" : "text-slate-600"}`}>{site.accessNotes}</p>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {selectedExistingSite ? (
                      <div className="rounded-xl border bg-slate-50 p-4 text-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{getSiteDisplayName(selectedExistingSite)}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedExistingSite.siteType ? <Badge className="bg-emerald-100 text-emerald-800">{formatSiteType(selectedExistingSite.siteType)}</Badge> : null}
                            {selectedExistingSite.assetCount > 0 ? <Badge className="bg-teal-100 text-teal-800">{selectedExistingSite.assetCount} items</Badge> : null}
                            {selectedExistingSite.jobCount > 0 ? <Badge className="bg-sky-100 text-sky-800">{selectedExistingSite.jobCount} jobs</Badge> : null}
                          </div>
                        </div>
                        {selectedExistingSite.profileNotes ? <p className="mt-3 text-slate-600">{selectedExistingSite.profileNotes}</p> : null}
                      </div>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="grid gap-4">
                  <FormField label={mode === "existing" ? "Site address" : "Primary site address"}>
                    <AddressAutocompleteInput
                      value={siteDraft.address}
                      onChange={(value) => setSiteDraft((prev) => ({ ...prev, address: value }))}
                      placeholder="Search the site address for this job"
                    />
                  </FormField>
                  <FormField label="Site type">
                    <Select
                      value={siteDraft.siteType || NOT_SET_VALUE}
                      onValueChange={(value) => setSiteDraft((prev) => ({ ...prev, siteType: value === NOT_SET_VALUE ? "" : value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select site type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
                        {siteTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="OC number">
                    <Input
                      value={siteDraft.ocNumber}
                      onChange={(e) => setSiteDraft((prev) => ({ ...prev, ocNumber: e.target.value }))}
                      placeholder="Optional client order/control number"
                    />
                  </FormField>
                  <FormField label="Access notes">
                    <Textarea
                      rows={3}
                      value={siteDraft.accessNotes}
                      onChange={(e) => setSiteDraft((prev) => ({ ...prev, accessNotes: e.target.value }))}
                      placeholder="Gate code, parking, call-on-arrival details, after-hours info..."
                    />
                  </FormField>
                </div>
              )}

              {selectedSiteAccessNote?.notes ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Site access notes</p>
                  <p className="mt-2 whitespace-pre-wrap leading-6 text-amber-950">{selectedSiteAccessNote.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">Job Details</CardTitle>
              <p className="text-sm text-muted-foreground">
                Capture the actual work request, schedule, urgency, and assigned technician.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField label="Job title">
                <Input value={job.title} onChange={(e) => setJob((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Swing gate motor replacement" />
              </FormField>
              <FormField label="Description of work">
                <Textarea value={job.description} onChange={(e) => setJob((p) => ({ ...p, description: e.target.value }))} rows={6} />
              </FormField>
              <FormField label="Scheduled date">
                <Input
                  type="date"
                  value={job.scheduledDate}
                  onChange={(e) => setJob((p) => ({ ...p, scheduledDate: e.target.value }))}
                />
              </FormField>
              <FormField label="OC number">
                <Input
                  value={job.ocNumber}
                  onChange={(e) => setJob((p) => ({ ...p, ocNumber: e.target.value }))}
                  placeholder="Optional invoice reference"
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Urgency">
                  <Select value={job.urgency} onValueChange={(value) => setJob((p) => ({ ...p, urgency: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {urgencyOptions.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Assigned technician">
                  <Select
                    value={job.assignedTechnicianId}
                    onValueChange={(value) => setJob((p) => ({ ...p, assignedTechnicianId: value }))}
                    disabled={staff.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={staff.length === 0 ? "No staff available" : "Select staff member"} />
                    </SelectTrigger>
                    <SelectContent>
                      {staff.map((staffMember) => (
                        <SelectItem key={staffMember.id} value={staffMember.id}>
                          {staffMember.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Job destination</p>
                <p className="mt-2 font-medium text-slate-900">{normalizeSiteAddress(selectedJobAddress) || "Choose or create a site first"}</p>
                <p className="mt-1 text-slate-600">
                  {mode === "existing"
                    ? selectedExistingCustomer?.name || "No customer selected"
                    : customer.name || "New customer"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              const tech = staff.find((t) => t.id === job.assignedTechnicianId);
              const existingCustomer = orderedCustomers.find((c) => c.id === selectedCustomerId);
              const jobAddress = normalizeSiteAddress(selectedJobAddress);
              const siteInput = canCreateSite
                ? {
                    ...siteDraft,
                    address: jobAddress,
                  }
                : null;
              onSave({
                job: {
                  ...job,
                  jobAddress,
                  ocNumber:
                    (job.ocNumber || "").trim()
                    || (mode === "existing" && existingSiteMode === "select" ? selectedExistingSite?.ocNumber || "" : siteInput?.ocNumber || ""),
                },
                customerMode: mode,
                customer: mode === "existing" ? existingCustomer : customer,
                technician: tech,
                siteInput:
                  mode === "new" || (mode === "existing" && existingSiteMode === "create")
                    ? siteInput
                    : null,
              });
              onOpenChange(false);
            }}
          >
            Create Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
