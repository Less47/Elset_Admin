import { useEffect, useRef, useState } from "react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RecordWorkspace, RECORD_WORKSPACE_WIDE_MAX_WIDTH, WorkspaceActionBar, WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { buildCustomerSites, customerTypeOptions, normalizeCustomerRecord, siteTypeOptions } from "@/lib/app-support";
import "./CustomerFormPage.css";

function buildDraft(customer) {
  if (!customer) return { name: "", email: "", phone: "", customerType: "", address: "", primarySiteType: "", primaryOcNumber: "" };
  const normalized = normalizeCustomerRecord(customer);
  return {
    name: normalized.name, email: normalized.email, phone: normalized.phone, customerType: normalized.customerType,
    contacts: normalized.contacts.filter((contact) => contact.id !== `${customer.id}-primary-contact`),
    billingContactId: normalized.billingContactId || "",
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

export default function CustomerFormPage({ customer = null, backLabel = "Customers", onCancel, onSave, onSaved, onOpenSite, registerNavigationBlocker }) {
  const editing = Boolean(customer);
  const [initial] = useState(() => buildDraft(customer));
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => registerNavigationBlocker?.(() => dirty || saving), [dirty, saving, registerNavigationBlocker]);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateContact = (id, key, value) => setDraft((current) => ({ ...current, contacts: current.contacts.map((contact) => contact.id === id ? { ...contact, [key]: value } : contact) }));
  const primarySite = editing ? buildCustomerSites(customer, []).find((site) => site.isPrimary) : null;

  const submit = async (event) => {
    event?.preventDefault();
    if (submitting.current || (!editing && !draft.name.trim())) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      // Customer edits do not send stale site trees or change site-owned fields.
      const payload = editing ? (() => {
        const normalized = normalizeCustomerRecord({ ...customer, ...draft });
        return { name: normalized.name, email: normalized.email, phone: normalized.phone, customerType: normalized.customerType,
          contacts: normalized.contacts, billingContactId: normalized.billingContactId };
      })() : draft;
      const saved = await onSave(payload);
      if (!saved) { setError("The customer could not be saved. Your changes are still here; review them and try again."); return; }
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the customer.");
    } finally { submitting.current = false; setSaving(false); }
  };

  const saveStatus = saving ? "Saving…" : dirty ? "Unsaved changes" : "";
  const formActions = <>
    <Button type="button" variant="outline" className={editing ? "h-11" : "h-9 max-lg:h-11"} disabled={saving} onClick={() => onCancel()}>Cancel</Button>
    <Button type="submit" className={editing ? "h-11" : "h-9 max-lg:h-11"} disabled={saving || (!editing && !draft.name.trim())} aria-busy={saving}>{saving ? "Saving…" : editing ? "Save Customer" : "Create Customer"}</Button>
  </>;

  return <RecordWorkspace backLabel={backLabel} eyebrow="Customers" title={editing ? "Edit Customer" : "New Customer"}
    subtitle={editing ? customer.name : ""} onBack={() => onCancel()} maxWidth={editing ? RECORD_WORKSPACE_WIDE_MAX_WIDTH : "max-w-none"}>
    <form onSubmit={submit} className={editing ? "grid min-w-0 gap-4" : "customer-create-form grid min-w-0 w-full max-w-xl"} aria-label={editing ? "Edit Customer" : "Create Customer"}>
      <fieldset disabled={saving} className={editing ? "min-w-0 space-y-4" : "min-w-0"}>
        <WorkspaceSection title="Customer details" panel={editing}>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><CustomerField id="customer-name" label="Customer / company name"><Input id="customer-name" value={draft.name} required={!editing} onChange={(event) => update("name", event.target.value)} autoComplete="organization" /></CustomerField></div>
            <CustomerField id="customer-email" label="Account email"><Input id="customer-email" value={draft.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" /></CustomerField>
            <CustomerField id="customer-phone" label="Account phone"><Input id="customer-phone" value={draft.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" /></CustomerField>
            <CustomerTypeField id="customer-type" label="Customer type" options={customerTypeOptions} value={draft.customerType} onChange={(value) => update("customerType", value)} />
          </div>
        </WorkspaceSection>
        <WorkspaceSection title="Primary site" panel={editing}>
          {editing ? <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm [overflow-wrap:anywhere]"><p>{customer.address || "No primary site saved"}</p><p className="mt-1 text-xs text-slate-600">Address, site type, OC number and access information are managed in the Site profile.</p></div>
            {primarySite ? <Button type="button" variant="outline" onClick={() => onOpenSite(primarySite)}>Open Site Profile</Button> : null}
          </div> : <div className="grid min-w-0 items-start gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><CustomerField id="primary-site-address" label="Address"><AddressAutocompleteInput id="primary-site-address" value={draft.address} onChange={(value) => update("address", value)} placeholder="Search the customer's main address" /></CustomerField></div>
            <CustomerTypeField id="primary-site-type" label="Primary site type" options={siteTypeOptions} value={draft.primarySiteType} onChange={(value) => update("primarySiteType", value)} />
            <CustomerField id="primary-site-oc" label="OC number"><Input id="primary-site-oc" value={draft.primaryOcNumber} onChange={(event) => update("primaryOcNumber", event.target.value)} placeholder="e.g. PS123456" /><p className="text-xs text-slate-600">Owners Corporation / plan reference for this property.</p></CustomerField>
          </div>}
        </WorkspaceSection>
        {editing ? <WorkspaceSection title="Contact details" panel description="Account email and phone remain the customer fallback. Named contacts can be used for access, requests or billing.">
          <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2 border-b pb-3">
            <p className="text-sm">{draft.billingContactId === `${customer.id}-primary-contact` ? "Account contact is the billing default." : draft.billingContactId ? "A saved contact is the billing default." : "No dedicated billing contact selected."}</p>
            <Button type="button" variant="outline" disabled={!draft.email.trim() && !draft.phone.trim()} onClick={() => update("billingContactId", `${customer.id}-primary-contact`)}>Use Account Contact</Button>
          </div>
          <div className="grid min-w-0 gap-3">
            {draft.contacts.map((contact, index) => <section key={contact.id} className="min-w-0 rounded-lg border p-3" aria-label={`Contact ${index + 1}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Contact {index + 1}</h3><div className="flex flex-wrap items-center gap-2">
                {draft.billingContactId === contact.id ? <Badge>Billing default</Badge> : null}
                <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, contacts: current.contacts.filter((entry) => entry.id !== contact.id), billingContactId: current.billingContactId === contact.id ? "" : current.billingContactId }))}>Remove</Button>
              </div></div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">{[["name", "Name"], ["role", "Role"], ["phone", "Phone"], ["email", "Email"]].map(([key, label]) => <CustomerField key={key} id={`contact-${contact.id}-${key}`} label={label}><Input id={`contact-${contact.id}-${key}`} value={contact[key] || ""} onChange={(event) => updateContact(contact.id, key, event.target.value)} /></CustomerField>)}</div>
              <div className="mt-3 flex justify-end"><Button type="button" variant="outline" onClick={() => update("billingContactId", contact.id)}>Use For Billing</Button></div>
            </section>)}
            <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => update("contacts", [...draft.contacts, { id: crypto.randomUUID(), name: "", role: "", phone: "", email: "", notes: "" }])}>Add Contact</Button></div>
          </div>
        </WorkspaceSection> : null}
      </fieldset>
      {error ? <div role="alert" className={editing ? "" : "px-3 pb-3"}><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
      {editing ? <WorkspaceActionBar maxWidth={RECORD_WORKSPACE_WIDE_MAX_WIDTH} status={saveStatus}>{formActions}</WorkspaceActionBar> : (
        <footer className="flex min-w-0 items-center justify-between gap-2 border-t border-[var(--data-view-border)] p-3">
          <div className="min-w-0 flex-1 text-xs font-medium text-slate-600" aria-live="polite">{saveStatus}</div>
          <div className="flex shrink-0 items-center gap-2">{formActions}</div>
        </footer>
      )}
    </form>
  </RecordWorkspace>;
}
