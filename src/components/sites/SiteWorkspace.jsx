import { useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import { useRef, useState } from "react";
import ProfileMaintenanceContracts from "@/components/maintenance/ProfileMaintenanceContracts";
import SitePhotoGallery from "./SitePhotoGallery";
import SiteDetailsFields from "./SiteDetailsFields";
import SiteAssetsEditor from "./SiteAssetsEditor";
import ContactAssignmentsEditor, { ContactList } from "@/components/shared/ContactAssignmentsEditor";
import { getSiteContacts } from "@/lib/contact-model";
import { EmptyState } from "@/components/shared/EmptyState";
import { CustomerJobHistory } from "@/components/customers/CustomerWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RECORD_WORKSPACE_WIDE_MAX_WIDTH, RecordWorkspace, WorkspaceSection, WorkspaceActionBar, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { buildSiteProfileDraft, formatDate, formatSiteType, getCustomerContacts, getSiteDisplayName, normalizeSiteAddress, toTimestamp } from "@/lib/app-support";
const EMPTY_ASSET = { name: "", type: "", location: "", model: "", notes: "" };

export default function SiteWorkspace({ customer, site, contacts = [], jobs, maintenancePlans = [], onOpenPlan, editing = false, tab = "overview", onTabChange, backLabel, onBack, onEdit, onOpenCustomer, onOpenJob, onSaveSite, onSaved, onDeleteSiteProfile, fetchWithAuth, canManagePhotos = false }) {
  const isEditingSite = editing;
  const [initial] = useState(() => buildSiteProfileDraft(site));
  const [draftSite, setDraftSite] = useState(initial);
  const [newAssetDraft, setNewAssetDraft] = useState(EMPTY_ASSET);
  const [saving, setSaving] = useState(false);
  const [addressPending, setAddressPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dirty = isEditingSite && (JSON.stringify(draftSite) !== JSON.stringify(initial) || JSON.stringify(newAssetDraft) !== JSON.stringify(EMPTY_ASSET));
  const markSaved = useUnsavedChanges(dirty, { busy: saving });
  const activeSite = isEditingSite ? draftSite : site;
  const activeAddress = normalizeSiteAddress(activeSite?.address || "");
  const customerContacts = getCustomerContacts(customer);
  const siteJobs = [...jobs].filter((job) => normalizeSiteAddress(job.jobAddress).toLowerCase() === activeAddress.toLowerCase()).sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt));
  const openJobs = siteJobs.filter((job) => job.status !== "Completed").length;
  const hasSavedProfile = Boolean(site?.siteProfileId);
  const mediaSiteId = customer?.sites?.find(entry => !entry._inferredProfile && entry.id === site?.siteProfileId)?.id || "";
  const canSave = Boolean(activeAddress) && !saving && !addressPending;
  const save = async (event) => {
    event?.preventDefault();
    if (!canSave || submitting.current) return;
    if (JSON.stringify(newAssetDraft) !== JSON.stringify(EMPTY_ASSET)) { setError("Add the gate or project before saving the site, or clear its unfinished fields."); return; }
    submitting.current = true; setSaving(true); setError("");
    try {
      const saved = await onSaveSite(customer.id, draftSite, site?.address || "");
      if (!saved) { setError("The site could not be saved. Your changes are still here."); return; }
      markSaved();
      onSaved(saved);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save the site."); }
    finally { submitting.current = false; setSaving(false); }
  };
  const detailsFields = <SiteDetailsFields value={draftSite} onChange={setDraftSite} onSelectionPending={setAddressPending} />;
  const contactsEditor = <ContactAssignmentsEditor kind="site" value={draftSite.contactAssignments} contacts={contacts} preferredContacts={[...(site?.contacts || []), ...customerContacts]} onChange={(assignments) => setDraftSite((current) => ({ ...current, contactAssignments: assignments }))} />;
  const assetsEditor = <SiteAssetsEditor assets={draftSite.assets} newAssetDraft={newAssetDraft} onChangeDraft={setNewAssetDraft} onChangeAssets={(update) => setDraftSite((current) => ({ ...current, assets: update(current.assets) }))} />;
  const currentTab = ["overview", "contacts", "assets", "maintenance", "jobs", "photos"].includes(tab) ? tab : "overview";
  return <RecordWorkspace backLabel={backLabel} eyebrow={customer.name} title={isEditingSite ? "Edit Site Profile" : getSiteDisplayName(site)}
    subtitle={site?.address || "Site details and gates / projects"} maxWidth={RECORD_WORKSPACE_WIDE_MAX_WIDTH} onBack={() => onBack()}
    headerActions={!isEditingSite ? <Button type="button" className="h-11" onClick={onEdit}>Edit Site Profile</Button> : null}>
    <div className="min-w-0 [&_p]:[overflow-wrap:anywhere] [&_input]:min-w-0 [&_textarea]:min-w-0">
      <Tabs value={currentTab} onValueChange={onTabChange} className="min-w-0 gap-3">
        <div className="record-tab-strip min-w-0 overflow-x-auto pb-1"><TabsList aria-label="Site sections" className="h-auto min-h-11 w-max gap-1 bg-transparent">
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="overview">Overview</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="contacts">Contacts <span className="text-xs">{(activeSite?.contactAssignments || []).length}</span></TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="assets">Gates / Projects <span className="text-xs">{(activeSite?.assets || []).length}</span></TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="jobs">Job History <span className="text-xs">{siteJobs.length}</span></TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="maintenance">Maintenance <span className="text-xs">{maintenancePlans.length}</span></TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="photos">Photos</TabsTrigger>
        </TabsList></div>
        <TabsContent value="overview" className="min-w-0"><WorkspaceSection title="Site details" panel>
          <fieldset disabled={saving} className={isEditingSite ? "grid min-w-0 items-start gap-3 sm:grid-cols-2" : "grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"}>

                {isEditingSite ? detailsFields : (
                  <>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Customer</p>
                      <p className="mt-1 font-medium text-foreground">{customer.name}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Address</p>
                      <p className="mt-1 font-medium text-foreground">{site.address || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Site type</p>
                      <p className="mt-1 font-medium text-foreground">{formatSiteType(site.siteType)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Primary site contact</p>
                      <p className="mt-1 font-medium text-foreground">{site.contactName || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Contact phone</p>
                      <p className="mt-1 font-medium text-foreground">{site.contactPhone || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Contact email</p>
                      <p className="mt-1 font-medium text-foreground">{site.contactEmail || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">OC number</p>
                      <p className="mt-1 font-medium text-foreground">{site.ocNumber || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Last activity</p>
                      <p className="mt-1 font-medium text-foreground">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity yet"}</p>
                    </div>
                  </>
                )}
              
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3 text-sm"><span>{siteJobs.length} jobs · {openJobs} open · {siteJobs.length - openJobs} completed</span><Button type="button" variant="outline" onClick={onOpenCustomer}>Open Customer Profile</Button></div>
        </WorkspaceSection>
        {!isEditingSite && hasSavedProfile ? <div className="mt-4 flex justify-end"><Button type="button" variant="outline" className="border-status-danger-border text-status-danger" onClick={() => onDeleteSiteProfile(customer.id, site)}>Remove Saved Profile</Button></div> : null}
        </TabsContent>
        <TabsContent value="contacts" className="min-w-0"><WorkspaceSection title="Site contacts" description="People to contact about this location." panel>
          <fieldset disabled={saving} className="min-w-0">{isEditingSite ? contactsEditor : <ContactList contacts={getSiteContacts(site)} />}</fieldset>
        </WorkspaceSection></TabsContent>
        <TabsContent value="assets" className="min-w-0"><WorkspaceSection title="Gates / Projects" description="Gates, entry points and project areas attached to this site."><fieldset disabled={saving} className="min-w-0">
          {isEditingSite ? assetsEditor : <div className="grid gap-3">
            {site.accessNotes ? <div className="rounded-lg border border-status-warning-border bg-status-warning-surface p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-status-warning">Access notes</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-status-warning">{site.accessNotes}</p>
            </div> : null}
            {site.profileNotes ? <div className="rounded-lg border bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Site notes</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{site.profileNotes}</p>
            </div> : null}
            {!(site.assets || []).length ? <EmptyState title="No gate or project records yet" text="Add each gate, operator, or project area here so the site history stays grouped together." />
              : site.assets.map((asset) => <div key={asset.id} className="rounded-lg border bg-card p-3 shadow-sm">
                <div className="grid gap-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
                  <p className="font-semibold text-foreground">{asset.name}</p><p className="mt-1 text-sm text-text-secondary">{[asset.type, asset.location].filter(Boolean).join(" - ") || "No type or location saved"}</p>
                </div>{asset.model ? <Badge variant="secondary">{asset.model}</Badge> : null}</div>
                  {asset.notes ? <p className="text-sm leading-6 text-text-secondary">{asset.notes}</p> : null}
                </div>
              </div>)}
          </div>}
        </fieldset></WorkspaceSection></TabsContent>
        <TabsContent value="photos" className="min-w-0"><WorkspaceSection title="Photos">
          {mediaSiteId && !isEditingSite ? <SitePhotoGallery siteId={mediaSiteId} fetchWithAuth={fetchWithAuth} canManage={canManagePhotos} onOpenJob={id => { const job = jobs.find(entry => entry.id === id); if (job) onOpenJob(job); }} /> : <p className="text-sm text-muted-foreground">Save the Site profile, then open its Photos tab to upload photos.</p>}
        </WorkspaceSection></TabsContent>
        <TabsContent value="jobs" className="min-w-0"><WorkspaceSection title="Job History"><CustomerJobHistory jobs={siteJobs} onOpenJob={onOpenJob} /></WorkspaceSection></TabsContent>
        <TabsContent value="maintenance" className="min-w-0"><WorkspaceSection title="Maintenance contracts"><ProfileMaintenanceContracts plans={maintenancePlans} jobs={jobs} onOpenPlan={onOpenPlan} /></WorkspaceSection></TabsContent>
      </Tabs>
      {error ? <div role="alert" className="mt-3"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
      {isEditingSite ? <WorkspaceActionBar maxWidth={RECORD_WORKSPACE_WIDE_MAX_WIDTH} status={saving ? "Saving…" : dirty ? "Unsaved changes" : ""}>
        <Button type="button" variant="outline" className="h-11" disabled={saving} onClick={() => onBack()}>Cancel</Button>
        <Button type="button" className="h-11" disabled={!canSave} onClick={save}>Save Site Profile</Button>
      </WorkspaceActionBar> : null}
    </div>
  </RecordWorkspace>;
}
