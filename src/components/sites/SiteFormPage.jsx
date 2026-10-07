import { useId, useRef, useState } from "react";
import { useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import { RecordWorkspace, WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import ContactAssignmentsEditor from "@/components/shared/ContactAssignmentsEditor";
import { buildSiteProfileDraft, getCustomerContacts, normalizeSiteAddress } from "@/lib/app-support";
import SiteCustomerPicker from "./SiteCustomerPicker";
import SiteDetailsFields from "./SiteDetailsFields";
import "./SiteFormPage.css";

export default function SiteFormPage({ customers, contacts, initialCustomerId = "", backLabel = "Sites", onCancel, onSave, onSaved }) {
  const formId = useId();
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const customer = customers.find((entry) => entry.id === customerId);
  const [initial] = useState(() => buildSiteProfileDraft(null));
  const [draftSite, setDraftSite] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [addressPending, setAddressPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dirty = customerId !== initialCustomerId || JSON.stringify(draftSite) !== JSON.stringify(initial);
  const markSaved = useUnsavedChanges(dirty, { busy: saving });
  const canSave = Boolean(customer && normalizeSiteAddress(draftSite.address)) && !saving && !addressPending;
  const save = async (event) => {
    event.preventDefault();
    if (!canSave || submitting.current) return;
    submitting.current = true; setSaving(true); setError("");
    try {
      const saved = await onSave(customer.id, draftSite);
      if (!saved) { setError("The site could not be saved. Your changes are still here."); return; }
      markSaved(); onSaved(saved, customer.id);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save the site."); }
    finally { submitting.current = false; setSaving(false); }
  };
  return <RecordWorkspace backLabel={backLabel} eyebrow="Sites" title="New Site" subtitle={customer ? `For ${customer.name}` : ""} maxWidth="max-w-none" onBack={onCancel}
    headerActions={<>
      <span className="sr-only text-xs xl:not-sr-only" role="status">{saving ? "Creating…" : dirty ? "Unsaved changes" : ""}</span>
      <Button type="button" variant="outline" className="h-11" disabled={saving} onClick={onCancel}>Cancel</Button>
      <Button type="submit" form={formId} className="h-11" disabled={!canSave} aria-busy={saving}>{saving ? "Creating…" : "Create Site"}</Button>
    </>}>
    <form id={formId} onSubmit={save} aria-label="Create Site" className="grid min-w-0 w-full gap-4 [&_p]:[overflow-wrap:anywhere] [&_input]:min-w-0 [&_textarea]:min-w-0" data-site-create>
      {error ? <div role="alert"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
      <fieldset disabled={saving} className="site-create-columns">
        <div className="grid min-w-0 gap-4" data-site-form-column="details">
          <WorkspaceSection title="Site details" panel><div className="grid min-w-0 items-start gap-3 sm:grid-cols-2">
            <SiteCustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
            <SiteDetailsFields value={draftSite} onChange={setDraftSite} onSelectionPending={setAddressPending} showLabel />
          </div></WorkspaceSection>
        </div>
        <div className="min-w-0" data-site-form-column="contacts"><WorkspaceSection title="Contacts" description="People to contact about this location." panel>
          <ContactAssignmentsEditor kind="site" value={draftSite.contactAssignments} contacts={contacts} preferredContacts={customer ? getCustomerContacts(customer) : []}
            onChange={(assignments) => setDraftSite((current) => ({ ...current, contactAssignments: assignments }))} />
        </WorkspaceSection></div>
      </fieldset>
    </form>
  </RecordWorkspace>;
}
