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
import { buildSiteProfileDraft, formatDate, formatSiteType, getSiteDisplayName, normalizeSiteAddress, normalizeSiteAssetRecord, siteTypeOptions, toTimestamp } from "@/lib/app-support";

const NOT_SET_VALUE = "not-set";

export default function SiteProfileDialog({ open, onOpenChange, customer, site, jobs, onOpenJob, onSaveSite, onDeleteSiteProfile }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftSite, setDraftSite] = useState(buildSiteProfileDraft(site));
  const [newAssetDraft, setNewAssetDraft] = useState({ name: "", type: "", location: "", model: "", notes: "" });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !customer) return;
    setDraftSite(buildSiteProfileDraft(site));
    setNewAssetDraft({ name: "", type: "", location: "", model: "", notes: "" });
    setIsEditing(!site || !site.siteProfileId);
  }, [customer, open, site]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!customer) return null;

  const activeAddress = normalizeSiteAddress(isEditing ? draftSite.address : site.address);
  const siteJobs = [...jobs]
    .filter((job) => normalizeSiteAddress(job.jobAddress).toLowerCase() === activeAddress.toLowerCase())
    .sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt));
  const completedJobs = siteJobs.filter((job) => job.status === "Completed").length;
  const openJobs = siteJobs.length - completedJobs;
  const hasSavedProfile = Boolean(site?.siteProfileId);
  const canSave = Boolean(activeAddress);
  const canAddAsset = Boolean(newAssetDraft.name.trim());

  const updateDraftAsset = (assetId, key, value) => {
    setDraftSite((prev) => ({
      ...prev,
      assets: prev.assets.map((asset) => (asset.id === assetId ? { ...asset, [key]: value } : asset)),
    }));
  };

  const removeDraftAsset = (assetId) => {
    setDraftSite((prev) => ({
      ...prev,
      assets: prev.assets.filter((asset) => asset.id !== assetId),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] max-h-[92vh] rounded-3xl sm:max-w-[96vw] lg:h-[88vh] lg:max-w-[1500px] 2xl:max-w-[1640px]">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <DialogTitle className="text-xl">{site ? getSiteDisplayName(isEditing ? draftSite : site) : "New Site"}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Site profile for {customer.name}. Keep one address together even when it has multiple gates or project areas.
              </p>
            </div>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => {
                      if (!site) {
                        onOpenChange(false);
                        return;
                      }
                      setDraftSite(buildSiteProfileDraft(site));
                      setNewAssetDraft({ name: "", type: "", location: "", model: "", notes: "" });
                      setIsEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="rounded-xl"
                    disabled={!canSave}
                    onClick={() => {
                      const saved = onSaveSite(customer.id, draftSite, site?.address || "");
                      if (saved) setIsEditing(false);
                    }}
                  >
                    Save Site Profile
                  </Button>
                </>
              ) : (
                <>
                  {hasSavedProfile ? (
                    <Button
                      variant="outline"
                      className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      onClick={() => onDeleteSiteProfile(customer.id, site)}
                    >
                      Remove Saved Profile
                    </Button>
                  ) : null}
                  <Button variant="outline" className="rounded-xl" onClick={() => setIsEditing(true)}>
                    Edit Site Profile
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="overflow-y-auto lg:overflow-hidden">
        <div className="grid gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[340px_minmax(360px,0.95fr)_minmax(620px,1.35fr)]">
          <div className="grid gap-4 lg:self-start">
            <Card className="rounded-3xl border-slate-200">
              <CardHeader>
                <CardTitle className="text-base">Site Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                {isEditing ? (
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
                    <FormField label="Site contact">
                      <Input
                        value={draftSite.contactName}
                        onChange={(e) => setDraftSite((prev) => ({ ...prev, contactName: e.target.value }))}
                        placeholder="Contact on arrival"
                      />
                    </FormField>
                    <FormField label="Site contact phone">
                      <Input
                        value={draftSite.contactPhone}
                        onChange={(e) => setDraftSite((prev) => ({ ...prev, contactPhone: e.target.value }))}
                        placeholder="Direct mobile or desk number"
                      />
                    </FormField>
                    <FormField label="OC number">
                      <Input
                        value={draftSite.ocNumber}
                        onChange={(e) => setDraftSite((prev) => ({ ...prev, ocNumber: e.target.value }))}
                        placeholder="Optional client order/control number"
                      />
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
                      <p className="text-xs uppercase text-muted-foreground">OC number</p>
                      <p className="mt-1 font-medium text-slate-900">{site.ocNumber || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Last activity</p>
                      <p className="mt-1 font-medium text-slate-900">{site.latestUpdatedAt ? formatDate(site.latestUpdatedAt) : "No activity yet"}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 bg-slate-50">
              <CardHeader>
                <CardTitle className="text-base">Site Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Total jobs</span>
                  <span className="font-semibold text-slate-900">{siteJobs.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Open jobs</span>
                  <span className="font-semibold text-slate-900">{openJobs}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Completed jobs</span>
                  <span className="font-semibold text-slate-900">{completedJobs}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Gates / projects</span>
                  <span className="font-semibold text-slate-900">{(isEditing ? draftSite.assets : site.assets || []).length}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl border-slate-200 bg-slate-50/70 lg:self-start">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Gates / Projects</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep each gate, entry point, or project area attached to this site.
                  </p>
                </div>
                <Badge variant="secondary">{(isEditing ? draftSite.assets : site.assets || []).length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {isEditing ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
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

                {(isEditing ? draftSite.assets : site.assets || []).length === 0 ? (
                  <EmptyState title="No gate or project records yet" text="Add each gate, operator, or project area here so the site history stays grouped together." />
                ) : (
                  (isEditing ? draftSite.assets : site.assets || []).map((asset) => (
                    <div key={asset.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                      {isEditing ? (
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
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Job History</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Jobs at this site, newest activity first.</p>
                </div>
                <Badge variant="secondary">{siteJobs.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:pr-2">
              <div className="grid gap-4">
                {!isEditing && site.accessNotes ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Access notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-950">{site.accessNotes}</p>
                  </div>
                ) : null}

                {!isEditing && site.profileNotes ? (
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Site notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{site.profileNotes}</p>
                  </div>
                ) : null}

                {siteJobs.length === 0 ? (
                  <EmptyState title="No jobs linked to this site yet" text="Jobs for this address will appear here automatically." />
                ) : (
                  siteJobs.map((job) => (
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
                        <div className="flex items-center justify-between gap-3">
                          <span>Technician</span>
                          <span className="font-medium text-slate-900">{job.assignedTechnicianName}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Last updated</span>
                          <span className="font-medium text-slate-900">{formatDate(job.updatedAt)}</span>
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
