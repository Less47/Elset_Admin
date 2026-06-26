import { useEffect, useState } from "react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { buildCustomerSites, formatDate, getCustomerSiteAccessNote, normalizeSiteAddress, toDateInputValue, urgencyOptions } from "@/lib/app-support";
import { statuses } from "@/lib/job-status";

export default function JobEditDialog({ open, onOpenChange, job, customer = null, customerJobs = [], staff, onSave }) {
  const [draftJob, setDraftJob] = useState(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !job) return;
    const defaultStaffId = staff[0]?.id || "";
    setDraftJob({
      title: job.title || "",
      description: job.description || "",
      urgency: job.urgency || "Medium",
      status: job.status || "To Do",
      assignedTechnicianId: job.assignedTechnicianId || defaultStaffId,
      jobAddress: job.jobAddress || "",
      ocNumber: job.ocNumber || "",
      scheduledDate: toDateInputValue(job.scheduledDate),
    });
  }, [job, open, staff]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!job || !draftJob) return null;

  const customerSites = customer ? buildCustomerSites(customer, customerJobs) : [];
  const jobSiteAccessNote = getCustomerSiteAccessNote(customer, draftJob.jobAddress);
  const canSave = draftJob.title.trim() && draftJob.description.trim() && draftJob.jobAddress.trim() && draftJob.assignedTechnicianId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] rounded-3xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Edit Job #{job.jobNumber}</DialogTitle>
        </DialogHeader>

        <DialogBody>
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">Job Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField label="Job title">
                <Input value={draftJob.title} onChange={(e) => setDraftJob((prev) => ({ ...prev, title: e.target.value }))} />
              </FormField>

              <FormField label="Description of work">
                <Textarea
                  rows={5}
                  value={draftJob.description}
                  onChange={(e) => setDraftJob((prev) => ({ ...prev, description: e.target.value }))}
                />
              </FormField>

              <FormField label="Site address">
                <AddressAutocompleteInput
                  value={draftJob.jobAddress}
                  onChange={(value) => setDraftJob((prev) => ({ ...prev, jobAddress: value }))}
                  placeholder="Search the job site address"
                />
              </FormField>

              {customerSites.length > 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Saved sites</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {customerSites.map((site) => (
                      <Button
                        key={site.id}
                        type="button"
                        variant={normalizeSiteAddress(draftJob.jobAddress) === site.address ? "secondary" : "outline"}
                        className="max-w-full rounded-xl"
                        onClick={() => setDraftJob((prev) => ({ ...prev, jobAddress: site.address, ocNumber: site.ocNumber || prev.ocNumber || "" }))}
                      >
                        <span className="truncate">{site.address}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              {jobSiteAccessNote?.notes ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Site access notes</p>
                  <p className="mt-2 whitespace-pre-wrap leading-6 text-amber-950">{jobSiteAccessNote.notes}</p>
                </div>
              ) : null}

              <FormField label="Scheduled date">
                <Input
                  type="date"
                  value={draftJob.scheduledDate}
                  onChange={(e) => setDraftJob((prev) => ({ ...prev, scheduledDate: e.target.value }))}
                />
              </FormField>

              <FormField label="OC number">
                <Input
                  value={draftJob.ocNumber}
                  onChange={(e) => setDraftJob((prev) => ({ ...prev, ocNumber: e.target.value }))}
                  placeholder="Optional invoice reference"
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Urgency">
                  <Select value={draftJob.urgency} onValueChange={(value) => setDraftJob((prev) => ({ ...prev, urgency: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {urgencyOptions.map((urgency) => (
                        <SelectItem key={urgency} value={urgency}>
                          {urgency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Status">
                  <Select value={draftJob.status} onValueChange={(value) => setDraftJob((prev) => ({ ...prev, status: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Assigned technician">
                  <Select
                    value={draftJob.assignedTechnicianId}
                    onValueChange={(value) => setDraftJob((prev) => ({ ...prev, assignedTechnicianId: value }))}
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
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 bg-slate-50">
            <CardHeader>
              <CardTitle className="text-base">Linked Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Customer</p>
                <p className="mt-1 font-medium text-slate-900">{job.customerName || "Not set"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Email</p>
                <p className="mt-1 font-medium text-slate-900">{job.customerEmail || "Not set"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Phone</p>
                <p className="mt-1 font-medium text-slate-900">{job.customerPhone || "Not set"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Created</p>
                <p className="mt-1 font-medium text-slate-900">{formatDate(job.createdAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600">
                Customer contact details stay managed from the customer profile. This screen is for editing the job itself.
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
              const technician = staff.find((entry) => entry.id === draftJob.assignedTechnicianId);
              const didSave = onSave({
                ...draftJob,
                assignedTechnicianName: technician?.name || job.assignedTechnicianName,
              });
              if (didSave !== false) onOpenChange(false);
            }}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
