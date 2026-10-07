import { useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import { useId, useRef, useState } from "react";
import { GoogleAddressAutocompleteInput } from "@/components/shared/GoogleAddressAutocompleteInput";
import ContactAssignmentsEditor from "@/components/shared/ContactAssignmentsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerPostalFields } from "@/lib/customer-profile";
import { getCustomerRelatedContacts } from "@/lib/contact-model";
import { siteAddressMetadata } from "@/lib/site-location";
import { RecordWorkspace, WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { buildCustomerSites, customerTypeOptions, normalizeCustomerRecord, siteTypeOptions } from "@/lib/app-support";
import "./CustomerFormPage.css";

function buildDraft(customer) {
  if (!customer) return { name: "", email: "", phone: "", customerType: "", address: "", contacts: [], contactAssignments: [], primarySiteType: "", primaryOcNumber: "", postalAddressSameAsPrimary: true, postalAddress: "" };
  const normalized = normalizeCustomerRecord(customer);
  const site = buildCustomerSites(normalized, []).find((entry) => entry.isPrimary);
  return {
    name: normalized.name, email: normalized.email, phone: normalized.phone, customerType: normalized.customerType,
    address: normalized.address, primarySiteType: site?.siteType || "", primaryOcNumber: site?.ocNumber || "",
    primarySiteAddress: { address: normalized.address, ...siteAddressMetadata(site) },
    ...customerPostalFields(normalized),
    contacts: normalized.contacts,
    contactAssignments: normalized.contactAssignments || [],
    contactUpdates: [],
    siteContactRemovals: [],
  };
}

export function CustomerField({ id, label, children }) {
  return <div className="grid min-w-0 gap-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

export function CustomerTypeField({ id, label, value, options, onChange }) {
  return <CustomerField id={id} label={label}>
    <Select value={value || "not-set"} onValueChange={(next) => onChange(next === "not-set" ? "" : next)}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="not-set">Not set</SelectItem>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </CustomerField>;
}

export default function CustomerFormPage({ customer = null, contacts = [], backLabel = "Customers", onCancel, onSave, onSaved, onOpenSite, onDelete, onDeleted }) {
  const editing = Boolean(customer);
  const formId = useId();
  const [initial] = useState(() => buildDraft(customer));
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addressPending, setAddressPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const markSaved = useUnsavedChanges(dirty, { busy: saving || deleting });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const primarySite = editing ? buildCustomerSites(customer, []).find((site) => site.isPrimary) : null;
  const relatedRecords = [...getCustomerRelatedContacts(customer), ...contacts, ...(draft.contacts || []), ...(draft.contactUpdates || [])];
  const relatedCustomer = editing ? { ...customer, contactAssignments: draft.contactAssignments,
    sites: (customer.sites || []).map((site) => ({ ...site, contactAssignments: (site.contactAssignments || []).filter((assignment) =>
      !draft.siteContactRemovals.some((removal) => removal.siteId === site.id && removal.contactId === assignment.contactId)) })) } : null;
  const relatedContacts = editing ? getCustomerRelatedContacts(relatedCustomer, relatedRecords) : [];
  const updateContact = (contact) => {
    const keys = ["name", "position", "phone", "email", "notes"];
    const original = [...getCustomerRelatedContacts(customer), ...contacts, ...(draft.contacts || [])].findLast((entry) => entry.id === contact.id);
    const unchanged = original && keys.every((key) => (contact[key] || "") === (original[key] || ""));
    update("contactUpdates", [...draft.contactUpdates.filter((entry) => entry.id !== contact.id),
      ...(unchanged ? [] : [{ id: contact.id, ...Object.fromEntries(keys.map((key) => [key, contact[key] || ""])) }])]);
  };
  const removeSiteContact = (contactId, site) => setDraft((current) => ({ ...current,
    siteContactRemovals: [...current.siteContactRemovals, { siteId: site.siteId, contactId, name: site.name,
      contactName: relatedRecords.findLast((contact) => contact.id === contactId)?.name || relatedRecords.findLast((contact) => contact.id === contactId)?.phone || "Unnamed contact" }] }));
  const updateAssignments = (assignments) => setDraft((current) => {
    const retainedIds = new Set([...getCustomerRelatedContacts(customer, relatedRecords).map((contact) => contact.id), ...assignments.map((assignment) => assignment.contactId)]);
    return { ...current, contactAssignments: assignments,
      ...(editing ? { contactUpdates: current.contactUpdates.filter((contact) => retainedIds.has(contact.id)) } : {}) };
  });

  const submit = async (event) => {
    event?.preventDefault();
    if (addressPending || submitting.current || (!editing && !draft.name.trim())) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const siteChanged = ["address", "primarySiteType", "primaryOcNumber", "primarySiteAddress"]
        .some((key) => JSON.stringify(draft[key]) !== JSON.stringify(initial[key]));
      const payload = editing ? (() => {
        const normalized = normalizeCustomerRecord({ ...customer, ...draft });
        return { name: normalized.name, email: normalized.email, phone: normalized.phone, customerType: normalized.customerType,
          contactAssignments: draft.contactAssignments,
          ...(draft.contactUpdates.length ? { contactUpdates: draft.contactUpdates } : {}),
          ...(draft.siteContactRemovals.length ? { siteContactRemovals: draft.siteContactRemovals.map(({ siteId, contactId }) => ({ siteId, contactId })) } : {}),
          ...customerPostalFields(draft),
          ...(siteChanged ? { primarySite: {
            id: primarySite?.siteProfileId || "", expectedAddress: initial.address,
            ...(draft.address !== initial.address || JSON.stringify(draft.primarySiteAddress) !== JSON.stringify(initial.primarySiteAddress)
              ? { address: draft.address, ...siteAddressMetadata(draft.primarySiteAddress) } : {}),
            ...(draft.primarySiteType !== initial.primarySiteType ? { siteType: draft.primarySiteType } : {}),
            ...(draft.primaryOcNumber !== initial.primaryOcNumber ? { ocNumber: draft.primaryOcNumber } : {}),
          } } : {}) };
      })() : { ...draft, ...customerPostalFields(draft) };
      const saved = await onSave(payload);
      if (!saved) { setError("The customer could not be saved. Your changes are still here; review them and try again."); return; }
      markSaved();
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the customer.");
    } finally { submitting.current = false; setSaving(false); }
  };

  const saveStatus = saving ? "Saving…" : dirty ? "Unsaved changes" : "";
  const deleteCustomer = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setDeleting(true);
    try {
      if (await onDelete()) {
        markSaved();
        onDeleted();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the customer.");
    } finally { submitting.current = false; setDeleting(false); }
  };
  const formActions = <>
    <span className="sr-only text-xs xl:not-sr-only" role="status">{saveStatus}</span>
    <Button type="button" variant="outline" className="hidden h-11 sm:inline-flex" disabled={saving || deleting} onClick={() => onCancel()}>Cancel</Button>
    <Button type="submit" form={formId} className="h-11" disabled={saving || deleting || addressPending || (!editing && !draft.name.trim())} aria-busy={saving}>{saving ? "Saving…" : editing ? "Save Customer" : "Create Customer"}</Button>
  </>;

  return <RecordWorkspace backLabel={backLabel} eyebrow="Customers" title={editing ? "Edit Customer" : "New Customer"}
    subtitle={editing ? customer.name : ""} onBack={() => onCancel()} maxWidth="max-w-none" headerActions={formActions}>
    <form id={formId} onSubmit={submit} className="grid min-w-0 w-full gap-4" aria-label={editing ? "Edit Customer" : "Create Customer"}>
      {error ? <div role="alert"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
      <fieldset disabled={saving || deleting} className="customer-form-columns">
        <div className="grid min-w-0 gap-4" data-customer-form-column="details">
        <WorkspaceSection title="Customer details" panel>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><CustomerField id="customer-name" label="Customer / company name"><Input id="customer-name" value={draft.name} required={!editing} onChange={(event) => update("name", event.target.value)} autoComplete="organization" /></CustomerField></div>
            <CustomerField id="customer-email" label="Account email"><Input id="customer-email" value={draft.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" /></CustomerField>
            <CustomerField id="customer-phone" label="Account phone"><Input id="customer-phone" value={draft.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" /></CustomerField>
            <CustomerTypeField id="customer-type" label="Customer type" options={customerTypeOptions} value={draft.customerType} onChange={(value) => update("customerType", value)} />
          </div>
        </WorkspaceSection>
        <WorkspaceSection title="Primary site" panel>
          <div className="grid min-w-0 items-start gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><CustomerField id="primary-site-address" label="Address"><GoogleAddressAutocompleteInput id="primary-site-address" value={draft.primarySiteAddress || { address: draft.address }} onSelectionPending={setAddressPending} onChange={(address) => setDraft((current) => ({ ...current, address: address.address, primarySiteAddress: address }))} placeholder="Search the customer's main address" /></CustomerField></div>
            <CustomerTypeField id="primary-site-type" label="Primary site type" options={siteTypeOptions} value={draft.primarySiteType} onChange={(value) => update("primarySiteType", value)} />
            <CustomerField id="primary-site-oc" label="OC number"><Input id="primary-site-oc" value={draft.primaryOcNumber} onChange={(event) => update("primaryOcNumber", event.target.value)} placeholder="e.g. PS123456" /><p className="text-xs text-text-secondary">Owners Corporation / plan reference for this property.</p></CustomerField>
          </div>
          {editing && primarySite ? <div className="mt-3 flex justify-end"><Button type="button" variant="outline" onClick={() => onOpenSite(primarySite)}>Open Site Profile</Button></div> : null}
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm" htmlFor="customer-postal-same">
            <input id="customer-postal-same" type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={draft.postalAddressSameAsPrimary} onChange={(event) => update("postalAddressSameAsPrimary", event.target.checked)} />
            Postal address is the same as the main address
          </label>
          {!draft.postalAddressSameAsPrimary ? <CustomerField id="customer-postal-address" label="Postal address"><Input id="customer-postal-address" value={draft.postalAddress} onChange={(event) => update("postalAddress", event.target.value)} placeholder="Street address or PO Box, suburb, state and postcode" autoComplete="street-address" /></CustomerField> : null}
        </WorkspaceSection>
        </div>
        <div className="min-w-0" data-customer-form-column="contacts">
        <WorkspaceSection title="Contacts" panel>
          <ContactAssignmentsEditor value={draft.contactAssignments} contacts={contacts} preferredContacts={[...(draft.contacts || []), ...(draft.contactUpdates || [])]}
            relatedContacts={relatedContacts} onContactChange={editing ? updateContact : undefined}
            onRemoveSiteContact={editing ? removeSiteContact : undefined}
            onChange={updateAssignments} />
          {editing && draft.siteContactRemovals.length ? <div className="mt-3 grid min-w-0 gap-1 border-t pt-2" role="status">
            <p className="text-xs text-text-secondary">Site assignments removed from this draft. Save Customer to apply; contacts will not be deleted.</p>
            {draft.siteContactRemovals.map((removal) => <div key={`${removal.siteId}-${removal.contactId}`} className="flex min-w-0 items-center justify-between gap-2 text-xs">
              <span className="min-w-0 [overflow-wrap:anywhere]">{removal.contactName} · {removal.name}</span>
              <Button type="button" variant="ghost" aria-label={`Undo removal from ${removal.name}`} onClick={() => update("siteContactRemovals", draft.siteContactRemovals.filter((entry) => entry !== removal))}>Undo</Button>
            </div>)}
          </div> : null}
        </WorkspaceSection>
        </div>
      </fieldset>
      {editing && onDelete ? <section className="grid min-w-0 gap-3 border-y border-status-danger-border bg-status-danger-surface p-4" aria-labelledby="customer-danger-zone-title" data-customer-danger-zone>
        <div><h2 id="customer-danger-zone-title" className="text-base font-semibold text-status-danger">Danger zone</h2>
          <p className="mt-1 text-sm text-text-secondary">This customer and their linked records will be moved to the Recycle Bin.</p></div>
        <Button type="button" variant="outline" className="min-h-11 justify-self-start border-status-danger-border text-status-danger hover:bg-status-danger-surface" disabled={saving || deleting} aria-busy={deleting} onClick={deleteCustomer}>Delete Customer</Button>
      </section> : null}
    </form>
  </RecordWorkspace>;
}
