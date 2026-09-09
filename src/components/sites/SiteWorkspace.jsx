import { useEffect, useRef, useState } from "react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import ContactSnapshotEditor from "@/components/shared/ContactSnapshotEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import { CustomerJobHistory } from "@/components/customers/CustomerWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RECORD_WORKSPACE_WIDE_MAX_WIDTH, RecordWorkspace, WorkspaceSection, WorkspaceActionBar, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { buildSiteProfileDraft, formatDate, formatSiteType, getCustomerContacts, getSiteDisplayName, normalizeSiteAddress, normalizeSiteAssetRecord, siteTypeOptions, toTimestamp } from "@/lib/app-support";
const NOT_SET_VALUE = "not-set";
const EMPTY_ASSET = { name: "", type: "", location: "", model: "", notes: "" };

export default function SiteWorkspace({ customer, site, jobs, editing = false, tab = "overview", onTabChange, backLabel, onBack, onEdit, onOpenCustomer, onOpenJob, onSaveSite, onSaved, onDeleteSiteProfile, registerNavigationBlocker }) {
  const isEditingSite = editing || !site;
  const [initial] = useState(() => buildSiteProfileDraft(site));
  const [draftSite, setDraftSite] = useState(initial);
  const [newAssetDraft, setNewAssetDraft] = useState(EMPTY_ASSET);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dirty = isEditingSite && (JSON.stringify(draftSite) !== JSON.stringify(initial) || JSON.stringify(newAssetDraft) !== JSON.stringify(EMPTY_ASSET));
  useEffect(() => registerNavigationBlocker?.(() => dirty || saving), [dirty, saving, registerNavigationBlocker]);
  const activeSite = isEditingSite ? draftSite : site;
  const activeAddress = normalizeSiteAddress(activeSite?.address || "");
  const customerContacts = getCustomerContacts(customer);
  const siteJobs = [...jobs].filter((job) => normalizeSiteAddress(job.jobAddress).toLowerCase() === activeAddress.toLowerCase()).sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt));
  const openJobs = siteJobs.filter((job) => job.status !== "Completed").length;
  const hasSavedProfile = Boolean(site?.siteProfileId);
  const canSave = Boolean(activeAddress) && !saving;
  const canAddAsset = Boolean(newAssetDraft.name.trim());
  const updateDraftAsset = (assetId, key, value) => setDraftSite((prev) => ({ ...prev, assets: prev.assets.map((asset) => asset.id === assetId ? { ...asset, [key]: value } : asset) }));
  const removeDraftAsset = (assetId) => setDraftSite((prev) => ({ ...prev, assets: prev.assets.filter((asset) => asset.id !== assetId) }));
  const save = async () => {
    if (!canSave || submitting.current) return;
    if (JSON.stringify(newAssetDraft) !== JSON.stringify(EMPTY_ASSET)) { setError("Add the gate or project before saving the site, or clear its unfinished fields."); return; }
    submitting.current = true; setSaving(true); setError("");
    try {
      const saved = await onSaveSite(customer.id, draftSite, site?.address || "");
      if (!saved) { setError("The site could not be saved. Your changes are still here."); return; }
      onSaved(saved);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save the site."); }
    finally { submitting.current = false; setSaving(false); }
  };
  const currentTab = ["overview", "assets", "jobs"].includes(tab) ? tab : "overview";
  return <RecordWorkspace backLabel={backLabel} eyebrow={customer.name} title={!site ? "New Site" : isEditingSite ? "Edit Site Profile" : getSiteDisplayName(site)}
    subtitle={site?.address || "Site details and gates / projects"} maxWidth={RECORD_WORKSPACE_WIDE_MAX_WIDTH} onBack={() => onBack()}
    headerActions={!isEditingSite ? <Button type="button" className="h-11" onClick={onEdit}>Edit Site Profile</Button> : null}>
    <div className="min-w-0 [&_p]:[overflow-wrap:anywhere] [&_input]:min-w-0 [&_textarea]:min-w-0">
      <Tabs value={currentTab} onValueChange={onTabChange} className="min-w-0 gap-3">
        <div className="record-tab-strip min-w-0 overflow-x-auto pb-1"><TabsList aria-label="Site sections" className="h-auto min-h-11 w-max gap-1 bg-transparent">
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="overview">Overview</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="assets">Gates / Projects <span className="text-xs">{(activeSite?.assets || []).length}</span></TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="jobs">Job History <span className="text-xs">{siteJobs.length}</span></TabsTrigger>
        </TabsList></div>
        <TabsContent value="overview" className="min-w-0"><WorkspaceSection title="Site details" panel>
          <fieldset disabled={saving} className={isEditingSite ? "grid min-w-0 items-start gap-3 sm:grid-cols-2" : "grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"}>

                {isEditingSite ? (
                  <>
                    <FormField label="Address">
                      <AddressAutocompleteInput
                        value={draftSite.address}
                        onChange={(value) => setDraftSite((prev) => ({ ...prev, address: value }))}
                        placeholder="Search this site address"
                      />
                    </FormField>
                    <FormField label="Site type">
                      <Select
                        value={draftSite.siteType || NOT_SET_VALUE}
                        onValueChange={(value) => setDraftSite((prev) => ({ ...prev, siteType: value === NOT_SET_VALUE ? "" : value }))}
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
                    <ContactSnapshotEditor
                      title="Site contact"
                      description="Pick a saved customer contact or keep a site-specific access contact just for this address."
                      contacts={customerContacts}
                      fallbackRole="Site contact"
                      value={{
                        id: draftSite.contactId,
                        name: draftSite.contactName,
                        role: "Site contact",
                        phone: draftSite.contactPhone,
                        email: draftSite.contactEmail,
                      }}
                      onChange={(contact) =>
                        setDraftSite((prev) => ({
                          ...prev,
                          contactId: contact?.id || "",
                          contactName: contact?.name || "",
                          contactPhone: contact?.phone || "",
                          contactEmail: contact?.email || "",
                        }))
                      }
                    />
                    <FormField label="OC number">
                      <Input
                        value={draftSite.ocNumber}
                        onChange={(e) => setDraftSite((prev) => ({ ...prev, ocNumber: e.target.value }))}
                        placeholder="e.g. PS123456"
                      />
                      <p className="text-sm text-slate-500">Owners Corporation / plan reference for this property.</p>
                    </FormField>
                    <FormField label="Access notes">
                      <Textarea
                        rows={4}
                        value={draftSite.accessNotes}
                        onChange={(e) => setDraftSite((prev) => ({ ...prev, accessNotes: e.target.value }))}
                        placeholder="Gate code, parking, access windows, call-on-arrival details..."
                      />
                    </FormField>
                    <FormField label="Site notes">
                      <Textarea
                        rows={4}
                        value={draftSite.notes}
                        onChange={(e) => setDraftSite((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="General context, layout, project details, recurring issues..."
                      />
                    </FormField>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Customer</p>
                      <p className="mt-1 font-medium text-slate-900">{customer.name}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Address</p>
                      <p className="mt-1 font-medium text-slate-900">{site.address || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Site type</p>
                      <p className="mt-1 font-medium text-slate-900">{formatSiteType(site.siteType)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Site contact</p>
                      <p className="mt-1 font-medium text-slate-900">{site.contactName || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Contact phone</p>
                      <p className="mt-1 font-medium text-slate-900">{site.contactPhone || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Contact email</p>
                      <p className="mt-1 font-medium text-slate-900">{site.contactEmail || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">OC number</p>
                      <p className="mt-1 font-medium text-slate-900">{site.ocNumber || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Last activity</p>
                      <p className="mt-1 font-medium text-slate-900">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity yet"}</p>
                    </div>
                  </>
                )}
              
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3 text-sm"><span>{siteJobs.length} jobs · {openJobs} open · {siteJobs.length - openJobs} completed</span><Button type="button" variant="outline" onClick={onOpenCustomer}>Open Customer Profile</Button></div>
        </WorkspaceSection>
        {!isEditingSite && hasSavedProfile ? <div className="mt-4 flex justify-end"><Button type="button" variant="outline" className="border-rose-200 text-rose-700" onClick={() => onDeleteSiteProfile(customer.id, site)}>Remove Saved Profile</Button></div> : null}
        </TabsContent>
        <TabsContent value="assets" className="min-w-0"><WorkspaceSection title="Gates / Projects" description="Gates, entry points and project areas attached to this site."><fieldset disabled={saving} className="min-w-0">

              <div className="grid gap-3">
                {!isEditingSite && site.accessNotes ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Access notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-950">{site.accessNotes}</p>
                  </div>
                ) : null}

                {!isEditingSite && site.profileNotes ? (
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Site notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{site.profileNotes}</p>
                  </div>
                ) : null}

                {isEditingSite ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Add gate or project</p>
                    <div className="mt-3 grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          value={newAssetDraft.name}
                          onChange={(e) => setNewAssetDraft((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="Name"
                        />
                        <Input
                          value={newAssetDraft.type}
                          onChange={(e) => setNewAssetDraft((prev) => ({ ...prev, type: e.target.value }))}
                          placeholder="Type"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          value={newAssetDraft.location}
                          onChange={(e) => setNewAssetDraft((prev) => ({ ...prev, location: e.target.value }))}
                          placeholder="Location on site"
                        />
                        <Input
                          value={newAssetDraft.model}
                          onChange={(e) => setNewAssetDraft((prev) => ({ ...prev, model: e.target.value }))}
                          placeholder="Model / operator"
                        />
                      </div>
                      <Textarea
                        rows={3}
                        value={newAssetDraft.notes}
                        onChange={(e) => setNewAssetDraft((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="Fault history, setup notes, remotes, access method..."
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          className="rounded-xl"
                          disabled={!canAddAsset}
                          onClick={() => {
                            setDraftSite((prev) => ({
                              ...prev,
                              assets: [
                                ...prev.assets,
                                normalizeSiteAssetRecord({
                                  ...newAssetDraft,
                                  id: crypto.randomUUID(),
                                  updatedAt: new Date().toISOString(),
                                }),
                              ],
                            }));
                            setNewAssetDraft({ name: "", type: "", location: "", model: "", notes: "" });
                          }}
                        >
                          Add Gate / Project
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {(isEditingSite ? draftSite.assets : site.assets || []).length === 0 ? (
                  <EmptyState title="No gate or project records yet" text="Add each gate, operator, or project area here so the site history stays grouped together." />
                ) : (
                  (isEditingSite ? draftSite.assets : site.assets || []).map((asset) => (
                    <div key={asset.id} className="rounded-lg border bg-white p-3 shadow-sm">
                      {isEditingSite ? (
                        <div className="grid gap-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Input value={asset.name} onChange={(e) => updateDraftAsset(asset.id, "name", e.target.value)} placeholder="Name" />
                            <Input value={asset.type} onChange={(e) => updateDraftAsset(asset.id, "type", e.target.value)} placeholder="Type" />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Input value={asset.location} onChange={(e) => updateDraftAsset(asset.id, "location", e.target.value)} placeholder="Location on site" />
                            <Input value={asset.model} onChange={(e) => updateDraftAsset(asset.id, "model", e.target.value)} placeholder="Model / operator" />
                          </div>
                          <Textarea rows={3} value={asset.notes} onChange={(e) => updateDraftAsset(asset.id, "notes", e.target.value)} placeholder="Notes" />
                          <div className="flex justify-end">
                            <Button variant="outline" className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => removeDraftAsset(asset.id)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900">{asset.name}</p>
                              <p className="mt-1 text-sm text-slate-600">
                                {[asset.type, asset.location].filter(Boolean).join(" - ") || "No type or location saved"}
                              </p>
                            </div>
                            {asset.model ? <Badge variant="secondary">{asset.model}</Badge> : null}
                          </div>
                          {asset.notes ? <p className="text-sm leading-6 text-slate-700">{asset.notes}</p> : null}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            
        </fieldset></WorkspaceSection></TabsContent>
        <TabsContent value="jobs" className="min-w-0"><WorkspaceSection title="Job History"><CustomerJobHistory jobs={siteJobs} onOpenJob={onOpenJob} /></WorkspaceSection></TabsContent>
      </Tabs>
      {error ? <div role="alert" className="mt-3"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
      {isEditingSite ? <WorkspaceActionBar maxWidth={RECORD_WORKSPACE_WIDE_MAX_WIDTH} status={saving ? "Saving…" : dirty ? "Unsaved changes" : ""}>
        <Button type="button" variant="outline" className="h-11" disabled={saving} onClick={() => onBack()}>Cancel</Button>
        <Button type="button" className="h-11" disabled={!canSave} onClick={save}>Save Site Profile</Button>
      </WorkspaceActionBar> : null}
    </div>
  </RecordWorkspace>;
}
