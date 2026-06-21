import { useEffect, useState } from "react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildCustomerSites,
  customerTypeOptions,
  formatCustomerType,
  formatDate,
  normalizeCustomerRecord,
  normalizeCustomerSiteProfiles,
  normalizeSiteAccessNotes,
  normalizeSiteAddress,
  normalizeSiteProfileRecord,
  siteTypeOptions,
} from "@/lib/app-support";

const NOT_SET_VALUE = "not-set";

export default function CustomerProfileDialog({ open, onOpenChange, customer, jobs, onOpenJob, onOpenSiteProfile, onSaveCustomer, onDeleteCustomer }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftCustomer, setDraftCustomer] = useState({ name: "", email: "", phone: "", customerType: "", address: "", siteAccessNotes: [], sites: [] });
  const [newSiteDraft, setNewSiteDraft] = useState({ address: "", siteType: "", notes: "" });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!customer || !open) return;
    setIsEditing(false);
    setDraftCustomer({
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || "",
      customerType: customer.customerType || "",
      address: customer.address || "",
      siteAccessNotes: normalizeSiteAccessNotes(customer.siteAccessNotes),
      sites: normalizeCustomerSiteProfiles(customer.sites, customer.address, customer.siteAccessNotes),
    });
    setNewSiteDraft({ address: "", siteType: "", notes: "" });
  }, [customer, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!customer) return null;

  const customerJobs = [...jobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const completedJobs = customerJobs.filter((job) => job.status === "Completed").length;
  const openJobs = customerJobs.length - completedJobs;
  const customerProfileRecord = isEditing
    ? normalizeCustomerRecord({ ...customer, ...draftCustomer, id: customer.id, createdAt: customer.createdAt })
    : customer;
  const customerSites = buildCustomerSites(customerProfileRecord, customerJobs);
  const savedSiteAddresses = new Set(normalizeSiteAccessNotes(draftCustomer.siteAccessNotes).map((entry) => entry.address.toLowerCase()));

  const updateDraftSiteAccessNote = (address, notes, siteType) => {
    const normalizedAddress = normalizeSiteAddress(address);
    if (!normalizedAddress) return;

    setDraftCustomer((prev) => {
      const currentNotes = normalizeSiteAccessNotes(prev.siteAccessNotes);
      const existing = currentNotes.find((entry) => entry.address.toLowerCase() === normalizedAddress.toLowerCase()) || null;
      const remaining = currentNotes.filter((entry) => entry.address.toLowerCase() !== normalizedAddress.toLowerCase());
      const normalizedNotes = String(notes || "").trim();
      const currentSites = normalizeCustomerSiteProfiles(prev.sites, prev.address, prev.siteAccessNotes);
      const existingSite = currentSites.find((entry) => entry.address.toLowerCase() === normalizedAddress.toLowerCase()) || null;
      const remainingSites = currentSites.filter((entry) => entry.address.toLowerCase() !== normalizedAddress.toLowerCase());
      const nextSite = normalizeSiteProfileRecord({
        ...(existingSite || {}),
        id: existingSite?.id || crypto.randomUUID(),
        address: normalizedAddress,
        siteType: siteType !== undefined ? siteType : existingSite?.siteType || "",
        accessNotes: normalizedNotes,
        updatedAt: new Date().toISOString(),
      });

      return {
        ...prev,
        sites: normalizeCustomerSiteProfiles(nextSite ? [...remainingSites, nextSite] : remainingSites, prev.address, []),
        siteAccessNotes: normalizeSiteAccessNotes([
          ...remaining,
          {
            id: existing?.id || crypto.randomUUID(),
            address: normalizedAddress,
            notes: normalizedNotes,
            updatedAt: new Date().toISOString(),
          },
        ]),
      };
    });
  };

  const canAddSiteAccessNote = Boolean(normalizeSiteAddress(newSiteDraft.address));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] rounded-3xl sm:max-w-7xl">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <DialogTitle className="text-xl">{customer.name}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Customer profile with full contact details, sites, and the running history of jobs for this customer.
              </p>
            </div>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => {
                      setIsEditing(false);
                      setDraftCustomer({
                        name: customer.name || "",
                        email: customer.email || "",
                        phone: customer.phone || "",
                        customerType: customer.customerType || "",
                        address: customer.address || "",
                        siteAccessNotes: normalizeSiteAccessNotes(customer.siteAccessNotes),
                        sites: normalizeCustomerSiteProfiles(customer.sites, customer.address, customer.siteAccessNotes),
                      });
                      setNewSiteDraft({ address: "", siteType: "", notes: "" });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="rounded-xl"
                    onClick={() => {
                      onSaveCustomer(customer.id, normalizeCustomerRecord({ ...customer, ...draftCustomer, id: customer.id, createdAt: customer.createdAt }));
                      setIsEditing(false);
                      setNewSiteDraft({ address: "", siteType: "", notes: "" });
                    }}
                  >
                    Save Changes
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    onClick={() => onDeleteCustomer(customer.id)}
                  >
                    Delete Customer
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => setIsEditing(true)}>
                    Edit Customer
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
        <div className="grid gap-6 lg:grid-cols-[300px_1fr] xl:grid-cols-[300px_minmax(280px,0.9fr)_minmax(460px,1.35fr)]">
          <div className="grid gap-4 xl:self-start">
            <Card className="rounded-3xl border-slate-200">
              <CardHeader>
                <CardTitle className="text-base">Customer Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                {isEditing ? (
                  <>
                    <FormField label="Customer name">
                      <Input value={draftCustomer.name} onChange={(e) => setDraftCustomer((prev) => ({ ...prev, name: e.target.value }))} />
                    </FormField>
                    <FormField label="Email">
                      <Input value={draftCustomer.email} onChange={(e) => setDraftCustomer((prev) => ({ ...prev, email: e.target.value }))} />
                    </FormField>
                    <FormField label="Phone">
                      <Input value={draftCustomer.phone} onChange={(e) => setDraftCustomer((prev) => ({ ...prev, phone: e.target.value }))} />
                    </FormField>
                    <FormField label="Customer type">
                      <Select
                        value={draftCustomer.customerType || NOT_SET_VALUE}
                        onValueChange={(value) => setDraftCustomer((prev) => ({ ...prev, customerType: value === NOT_SET_VALUE ? "" : value }))}
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
                    <FormField label="Address">
                      <AddressAutocompleteInput
                        value={draftCustomer.address}
                        onChange={(value) => setDraftCustomer((prev) => ({ ...prev, address: value }))}
                        placeholder="Search the customer's main address"
                      />
                    </FormField>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Customer</p>
                      <p className="mt-1 font-medium text-slate-900">{customer.name || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Email</p>
                      <p className="mt-1 font-medium text-slate-900">{customer.email || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Phone</p>
                      <p className="mt-1 font-medium text-slate-900">{customer.phone || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Customer type</p>
                      <p className="mt-1 font-medium text-slate-900">{formatCustomerType(customer.customerType)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Address</p>
                      <p className="mt-1 font-medium text-slate-900">{customer.address || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Created</p>
                      <p className="mt-1 font-medium text-slate-900">{formatDate(customer.createdAt)}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 bg-slate-50">
              <CardHeader>
                <CardTitle className="text-base">Job Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Total jobs</span>
                  <span className="font-semibold text-slate-900">{customerJobs.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Sites</span>
                  <span className="font-semibold text-slate-900">{customerSites.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Open jobs</span>
                  <span className="font-semibold text-slate-900">{openJobs}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Completed jobs</span>
                  <span className="font-semibold text-slate-900">{completedJobs}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl border-slate-200 bg-slate-50/70 lg:self-start">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Sites</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Saved from customer records, job site addresses, and site access notes. Open a site profile to keep multiple gates or projects together.
                  </p>
                </div>
                <Badge variant="secondary">{customerSites.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {isEditing ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Add site</p>
                    <div className="mt-3 grid gap-3">
                      <AddressAutocompleteInput
                        value={newSiteDraft.address}
                        onChange={(value) => setNewSiteDraft((prev) => ({ ...prev, address: value }))}
                        placeholder="Search a site address"
                      />
                      <Select
                        value={newSiteDraft.siteType || NOT_SET_VALUE}
                        onValueChange={(value) => setNewSiteDraft((prev) => ({ ...prev, siteType: value === NOT_SET_VALUE ? "" : value }))}
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
                      <Textarea
                        rows={3}
                        value={newSiteDraft.notes}
                        onChange={(e) => setNewSiteDraft((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="Gate code, parking, contact person, access hours, or other arrival notes"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          className="rounded-xl"
                          disabled={!canAddSiteAccessNote}
                          onClick={() => {
                            updateDraftSiteAccessNote(newSiteDraft.address, newSiteDraft.notes, newSiteDraft.siteType);
                            setNewSiteDraft({ address: "", siteType: "", notes: "" });
                          }}
                        >
                          Add Site
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {customerSites.length === 0 ? (
                  <EmptyState title="No sites saved yet" text="Add a site address to the customer or one of their jobs to see it here." />
                ) : (
                  customerSites.map((site) => (
                    <div key={site.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                      {isEditing ? (
                        <div className="grid gap-4">
                          <p className="text-sm font-medium text-slate-900">{site.address || "No address saved"}</p>
                          <div className="border-t border-slate-100 pt-4">
                            <FormField label="Site access notes">
                              <Textarea
                                rows={4}
                                value={site.accessNotes || ""}
                                onChange={(e) => updateDraftSiteAccessNote(site.address, e.target.value)}
                                placeholder="Gate code, call-on-arrival contact, parking, after-hours access, alarm info..."
                              />
                            </FormField>
                            <p className="mt-2 text-xs text-slate-500">
                              These notes will appear automatically on matching jobs for this site.
                            </p>
                            <div className="mt-3 flex flex-wrap justify-between gap-2">
                              <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenSiteProfile(customer.id, site.id)}>
                                Open Site Profile
                              </Button>
                            {savedSiteAddresses.has(site.address.toLowerCase()) ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                onClick={() =>
                                  setDraftCustomer((prev) => ({
                                    ...prev,
                                    sites: normalizeCustomerSiteProfiles(prev.sites, prev.address, prev.siteAccessNotes).flatMap((entry) => {
                                      if (entry.address.toLowerCase() !== site.address.toLowerCase()) return [entry];
                                      const shouldRemoveSiteProfile =
                                        !entry.siteType
                                        && !entry.notes
                                        && !entry.contactName
                                        && !entry.contactPhone
                                        && (!entry.assets || entry.assets.length === 0)
                                        && !site.isPrimary
                                        && site.jobCount === 0;
                                      if (shouldRemoveSiteProfile) return [];
                                      return [{ ...entry, accessNotes: "", updatedAt: new Date().toISOString() }];
                                    }),
                                    siteAccessNotes: normalizeSiteAccessNotes(prev.siteAccessNotes).filter(
                                      (entry) => entry.address.toLowerCase() !== site.address.toLowerCase()
                                    ),
                                  }))
                                }
                              >
                                {site.isPrimary || site.jobCount > 0 ? "Clear Saved Note" : "Remove Saved Site"}
                              </Button>
                            ) : null}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="min-w-0 text-sm font-medium text-slate-900">{site.address || "No address saved"}</p>
                          <Button variant="outline" className="shrink-0 rounded-xl" onClick={() => onOpenSiteProfile(customer.id, site.id)}>
                            Open Site Profile
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200 lg:col-span-2 xl:col-span-1">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Job History</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Most recent activity first.</p>
                </div>
                <Badge variant="secondary">{customerJobs.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {customerJobs.length === 0 ? (
                  <EmptyState title="No jobs recorded yet" text="This customer does not have any service jobs saved in the system yet." />
                ) : (
                  customerJobs.map((job) => (
                    <div key={job.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
                          <p className="font-semibold text-slate-900">{job.title}</p>
                          <p className="mt-1 text-sm text-slate-600">{job.description}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{job.status}</Badge>
                          <Badge className={job.urgency === "High" ? "bg-rose-100 text-rose-800" : job.urgency === "Medium" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}>
                            {job.urgency}
                          </Badge>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600 md:grid-cols-2">
                        <div className="flex items-start justify-between gap-3 md:col-span-2">
                          <span className="shrink-0">Site</span>
                          <span className="text-right font-medium text-slate-900">{job.jobAddress || customer.address || "Not set"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Technician</span>
                          <span className="font-medium text-slate-900">{job.assignedTechnicianName}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Last updated</span>
                          <span className="font-medium text-slate-900">{new Date(job.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Quote</span>
                          <span className="font-medium text-slate-900">{job.quote ? "Saved" : "Not created"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Invoice</span>
                          <span className="font-medium text-slate-900">{job.invoice ? "Saved" : "Not created"}</span>
                        </div>
                      </div>

                      <div className="mt-4 flex justify-end">
                        <Button
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => {
                            onOpenChange(false);
                            onOpenJob(job);
                          }}
                        >
                          View Job
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
