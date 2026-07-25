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
  getContactDisplayName,
  normalizeCustomerRecord,
  normalizeCustomerSiteProfiles,
  normalizeSiteAccessNotes,
  normalizeSiteAddress,
  normalizeSiteProfileRecord,
  siteTypeOptions,
} from "@/lib/app-support";

const NOT_SET_VALUE = "not-set";
const EMPTY_DRAFT_CUSTOMER = {
  name: "",
  email: "",
  phone: "",
  customerType: "",
  address: "",
  contacts: [],
  billingContactId: "",
  useAccountBilling: false,
  siteAccessNotes: [],
  sites: [],
};

function getPrimaryContactId(customerId) {
  return customerId ? `${customerId}-primary-contact` : "";
}

function buildEmptyCustomerContact() {
  return {
    id: crypto.randomUUID(),
    name: "",
    role: "",
    phone: "",
    email: "",
    notes: "",
  };
}

function buildCustomerDraft(sourceCustomer) {
  const normalizedCustomer = normalizeCustomerRecord(sourceCustomer);
  const primaryContactId = getPrimaryContactId(normalizedCustomer.id);

  return {
    name: normalizedCustomer.name || "",
    email: normalizedCustomer.email || "",
    phone: normalizedCustomer.phone || "",
    customerType: normalizedCustomer.customerType || "",
    address: normalizedCustomer.address || "",
    contacts: (normalizedCustomer.contacts || []).filter((contact) => contact.id !== primaryContactId),
    billingContactId: normalizedCustomer.billingContactId === primaryContactId ? "" : normalizedCustomer.billingContactId || "",
    useAccountBilling: normalizedCustomer.billingContactId === primaryContactId,
    siteAccessNotes: normalizeSiteAccessNotes(normalizedCustomer.siteAccessNotes),
    sites: normalizeCustomerSiteProfiles(normalizedCustomer.sites, normalizedCustomer.address, normalizedCustomer.siteAccessNotes),
  };
}

function buildCustomerSavePayload(customer, draftCustomer) {
  return normalizeCustomerRecord({
    ...customer,
    ...draftCustomer,
    billingContactId: draftCustomer.useAccountBilling ? getPrimaryContactId(customer.id) : draftCustomer.billingContactId,
    id: customer.id,
    createdAt: customer.createdAt,
  });
}

export default function CustomerProfileDialog({ open, onOpenChange, customer, jobs, onOpenJob, onOpenSiteProfile, onSaveCustomer, onDeleteCustomer }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftCustomer, setDraftCustomer] = useState(EMPTY_DRAFT_CUSTOMER);
  const [newSiteDraft, setNewSiteDraft] = useState({ address: "", siteType: "", ocNumber: "", notes: "" });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!customer || !open) return;
    setIsEditing(false);
    setDraftCustomer(buildCustomerDraft(customer));
    setNewSiteDraft({ address: "", siteType: "", ocNumber: "", notes: "" });
  }, [customer, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!customer) return null;

  const customerJobs = [...jobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const completedJobs = customerJobs.filter((job) => job.status === "Completed").length;
  const openJobs = customerJobs.length - completedJobs;
  const customerProfileRecord = isEditing
    ? buildCustomerSavePayload(customer, draftCustomer)
    : customer;
  const customerSites = buildCustomerSites(customerProfileRecord, customerJobs);
  const savedSiteAddresses = new Set(normalizeSiteAccessNotes(draftCustomer.siteAccessNotes).map((entry) => entry.address.toLowerCase()));
  const primaryContactId = getPrimaryContactId(customer.id);
  const displayContacts = customerProfileRecord.contacts || [];
  const contactCount = isEditing
    ? draftCustomer.contacts.length + ((draftCustomer.email.trim() || draftCustomer.phone.trim()) ? 1 : 0)
    : displayContacts.length;

  const updateDraftContact = (contactId, key, value) => {
    setDraftCustomer((prev) => ({
      ...prev,
      contacts: prev.contacts.map((contact) => (
        contact.id === contactId
          ? { ...contact, [key]: value }
          : contact
      )),
    }));
  };

  const removeDraftContact = (contactId) => {
    setDraftCustomer((prev) => ({
      ...prev,
      contacts: prev.contacts.filter((contact) => contact.id !== contactId),
      billingContactId: prev.billingContactId === contactId ? "" : prev.billingContactId,
    }));
  };

  const updateDraftSiteAccessNote = (address, notes, siteType, ocNumber) => {
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
        ocNumber: ocNumber !== undefined ? ocNumber : existingSite?.ocNumber || "",
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
                      setDraftCustomer(buildCustomerDraft(customer));
                      setNewSiteDraft({ address: "", siteType: "", ocNumber: "", notes: "" });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="rounded-xl"
                    onClick={async () => {
                      const saved = await onSaveCustomer(customer.id, buildCustomerSavePayload(customer, draftCustomer));
                      if (saved) {
                        setIsEditing(false);
                        setNewSiteDraft({ address: "", siteType: "", ocNumber: "", notes: "" });
                      }
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
                    <FormField label="Account email">
                      <Input value={draftCustomer.email} onChange={(e) => setDraftCustomer((prev) => ({ ...prev, email: e.target.value }))} />
                    </FormField>
                    <FormField label="Account phone">
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
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                      Account email and phone stay as the customer-level fallback. Add individual people below for site access, requester, and billing contacts.
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Billing default</p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          {draftCustomer.useAccountBilling
                            ? "The account contact will be used by default for billing and document sending."
                            : draftCustomer.billingContactId
                              ? "A saved contact is currently preferred for billing."
                              : "No dedicated billing contact is selected yet."}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant={draftCustomer.useAccountBilling ? "secondary" : "outline"}
                        className="rounded-xl"
                        disabled={!draftCustomer.email.trim() && !draftCustomer.phone.trim()}
                        onClick={() =>
                          setDraftCustomer((prev) => ({
                            ...prev,
                            useAccountBilling: true,
                            billingContactId: "",
                          }))
                        }
                      >
                        Use Account Contact
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Customer</p>
                      <p className="mt-1 font-medium text-slate-900">{customer.name || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Account email</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{customer.email || "Not set"}</p>
                        {customerProfileRecord.billingContactId === primaryContactId ? (
                          <Badge className="bg-sky-100 text-sky-800">Billing default</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Account phone</p>
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

            <Card className="rounded-3xl border-slate-200">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Contacts</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Save the people attached to this customer so sites, jobs, and billing can point to the right person.
                    </p>
                  </div>
                  <Badge variant="secondary">{contactCount}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                {isEditing ? (
                  <>
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                      The account email and phone above stay separate as the main customer fallback. Add named people here for site access, requester, or billing-specific contacts.
                    </div>
                    {draftCustomer.contacts.length === 0 ? (
                      <EmptyState title="No saved contacts yet" text="Add the people who actually handle site access, work requests, or accounts for this customer." />
                    ) : (
                      draftCustomer.contacts.map((contact) => (
                        <div key={contact.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-2">
                              {contact.role ? <Badge variant="secondary">{contact.role}</Badge> : null}
                              {draftCustomer.billingContactId === contact.id && !draftCustomer.useAccountBilling ? (
                                <Badge className="bg-sky-100 text-sky-800">Billing default</Badge>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                              onClick={() => removeDraftContact(contact.id)}
                            >
                              Remove
                            </Button>
                          </div>

                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <FormField label="Name">
                              <Input value={contact.name || ""} onChange={(event) => updateDraftContact(contact.id, "name", event.target.value)} />
                            </FormField>
                            <FormField label="Role">
                              <Input value={contact.role || ""} onChange={(event) => updateDraftContact(contact.id, "role", event.target.value)} placeholder="Accounts, Site manager, Caretaker..." />
                            </FormField>
                            <FormField label="Phone">
                              <Input value={contact.phone || ""} onChange={(event) => updateDraftContact(contact.id, "phone", event.target.value)} />
                            </FormField>
                            <FormField label="Email">
                              <Input value={contact.email || ""} onChange={(event) => updateDraftContact(contact.id, "email", event.target.value)} />
                            </FormField>
                          </div>

                          <div className="mt-4 flex justify-end">
                            <Button
                              type="button"
                              variant={draftCustomer.billingContactId === contact.id && !draftCustomer.useAccountBilling ? "secondary" : "outline"}
                              className="rounded-xl"
                              onClick={() =>
                                setDraftCustomer((prev) => ({
                                  ...prev,
                                  billingContactId: contact.id,
                                  useAccountBilling: false,
                                }))
                              }
                            >
                              {draftCustomer.billingContactId === contact.id && !draftCustomer.useAccountBilling
                                ? "Billing Default"
                                : "Use For Billing"}
                            </Button>
                          </div>
                        </div>
                      ))
                    )}

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() =>
                          setDraftCustomer((prev) => ({
                            ...prev,
                            contacts: [...prev.contacts, buildEmptyCustomerContact()],
                          }))
                        }
                      >
                        Add Contact
                      </Button>
                    </div>
                  </>
                ) : displayContacts.length === 0 ? (
                  <EmptyState title="No contacts saved yet" text="Edit this customer to add the people who handle access, requests, or billing." />
                ) : (
                  displayContacts.map((contact) => (
                    <div key={contact.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{getContactDisplayName(contact)}</p>
                          {contact.role ? <p className="mt-1 text-sm text-slate-600">{contact.role}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {contact.id === primaryContactId ? <Badge variant="secondary">Account</Badge> : null}
                          {customerProfileRecord.billingContactId === contact.id ? <Badge className="bg-sky-100 text-sky-800">Billing</Badge> : null}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-slate-600">
                        <div className="flex items-center justify-between gap-3">
                          <span>Phone</span>
                          <span className="text-right font-medium text-slate-900">{contact.phone || "Not set"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Email</span>
                          <span className="text-right font-medium text-slate-900">{contact.email || "Not set"}</span>
                        </div>
                      </div>
                    </div>
                  ))
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
                      <Input
                        value={newSiteDraft.ocNumber}
                        onChange={(e) => setNewSiteDraft((prev) => ({ ...prev, ocNumber: e.target.value }))}
                        placeholder="OC number (optional)"
                      />
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
                            updateDraftSiteAccessNote(newSiteDraft.address, newSiteDraft.notes, newSiteDraft.siteType, newSiteDraft.ocNumber);
                            setNewSiteDraft({ address: "", siteType: "", ocNumber: "", notes: "" });
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
                            <FormField label="OC number">
                              <Input
                                value={site.ocNumber || ""}
                                onChange={(e) => updateDraftSiteAccessNote(site.address, site.accessNotes || "", site.siteType, e.target.value)}
                                placeholder="Optional invoice reference"
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
                                        && !entry.ocNumber
                                        && !entry.notes
                                        && !entry.contactId
                                        && !entry.contactName
                                        && !entry.contactPhone
                                        && !entry.contactEmail
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
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">{site.address || "No address saved"}</p>
                            {site.ocNumber ? <p className="mt-1 text-xs text-slate-500">OC {site.ocNumber}</p> : null}
                          </div>
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
              <div className="grid gap-3">
                {customerJobs.length === 0 ? (
                  <EmptyState title="No jobs recorded yet" text="This customer does not have any service jobs saved in the system yet." />
                ) : (
                  customerJobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className="w-full rounded-2xl border bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                      onClick={() => {
                        onOpenChange(false);
                        onOpenJob(job);
                      }}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{job.jobNumber}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{job.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{job.description}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Site: <span className="font-medium text-slate-700">{job.jobAddress || customer.address || "Not set"}</span>
                      </p>
                    </button>
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
