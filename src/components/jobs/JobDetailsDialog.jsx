import { useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  SupplierManualMatches,
  formatDate,
  getContactDisplayName,
  getCustomerBillingContact,
  getCustomerSiteAccessNote,
  getCustomerSitePrimaryContact,
  getInvoicePaymentSummary,
  getInvoiceStatus,
  normalizeSiteAddress,
} from "@/lib/app-support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { statuses } from "@/lib/job-status";
import { calculateDocTotal, calculateInvoiceTotal, calculateQuoteTotal, money } from "@/lib/quote-template";

export default function JobDetailsDialog({
  open,
  onOpenChange,
  job,
  customer = null,
  onStatusChange,
  onAddNote,
  onAddPhotos,
  onDeletePhoto,
  onEditJob,
  onDeleteJob,
  canEditJob = true,
  canDeleteJob = true,
  showCommercialDocuments = true,
  supplierManualMatches = [],
  supplierManualStatus = "idle",
  supplierManualError = "",
  onOpenCustomerProfile = null,
  onOpenSiteProfile = null,
  onOpenDocument = null,
  onOpenSentDocument = null,
}) {
  const [note, setNote] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  if (!job) return null;
  const jobPhotos = job.photos || [];
  const activeSelectedPhoto = selectedPhoto ? jobPhotos.find((photo) => photo.id === selectedPhoto.id) || null : null;
  const activeSelectedPhotoIndex = activeSelectedPhoto ? jobPhotos.findIndex((photo) => photo.id === activeSelectedPhoto.id) : -1;
  const jobSiteAccessNote = getCustomerSiteAccessNote(customer, job.jobAddress);
  const requesterContact = job.requesterContact || null;
  const onsiteContact = job.onsiteContact || getCustomerSitePrimaryContact(customer, job.jobAddress) || null;
  const billingContact = job.billingContact
    || getCustomerBillingContact(customer)
    || (job.customerEmail || job.customerPhone
      ? {
          id: "",
          name: job.customerName,
          role: "Billing contact",
          phone: job.customerPhone,
          email: job.customerEmail,
        }
      : null);
  const jobInvoiceStatus = getInvoiceStatus(job);
  const jobInvoicePaymentSummary = getInvoicePaymentSummary(job.invoice);
  const canCyclePhotos = jobPhotos.length > 1;
  const handleCyclePhoto = (direction) => {
    if (!canCyclePhotos || activeSelectedPhotoIndex < 0) return;

    const nextIndex = (activeSelectedPhotoIndex + direction + jobPhotos.length) % jobPhotos.length;
    setSelectedPhoto(jobPhotos[nextIndex]);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) setSelectedPhoto(null);
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-h-[92vh] rounded-3xl sm:max-w-[96vw] xl:max-w-[1560px] 2xl:max-w-[1720px]">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Job #{job.jobNumber}</p>
              <DialogTitle className="text-xl">{job.title}</DialogTitle>
              {job.maintenancePlanName ? (
                <div className="mt-2">
                  <Badge className="bg-emerald-100 text-emerald-800">Maintenance Plan</Badge>
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              {canDeleteJob ? (
                <Button
                  variant="outline"
                  className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  onClick={onDeleteJob}
                >
                  Delete Job
                </Button>
              ) : null}
              {canEditJob ? (
                <Button variant="outline" className="rounded-xl" onClick={onEditJob}>
                  Edit Job
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          <div className={`grid gap-6 ${showCommercialDocuments ? "xl:grid-cols-[minmax(360px,1.1fr)_minmax(320px,0.92fr)_minmax(320px,0.92fr)]" : "xl:grid-cols-[minmax(360px,1.18fr)_minmax(320px,0.92fr)]"}`}>
            <div className="grid content-start gap-5">
              <Card className="rounded-2xl">
                <CardContent className="grid gap-4 p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Job Number</p>
                      <p className="font-medium">#{job.jobNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Customer</p>
                      <p className="font-medium">{job.customerName}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Assigned Technician</p>
                      <p className="font-medium">{job.assignedTechnicianName}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Phone</p>
                      <p className="font-medium">{job.customerPhone}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Urgency</p>
                      <p className="font-medium">{job.urgency}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Scheduled Date</p>
                      <p className="font-medium">{job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</p>
                    </div>
                    {job.maintenancePlanName ? (
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Maintenance Due</p>
                        <p className="font-medium">{job.maintenanceDueDate ? formatDate(job.maintenanceDueDate) : "Not set"}</p>
                      </div>
                    ) : null}
                  </div>
                  {job.maintenancePlanName ? (
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Maintenance Plan</p>
                      <p className="font-medium">{job.maintenancePlanName}</p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Job Address</p>
                    <p className="font-medium">{job.jobAddress}</p>
                    {customer && (onOpenCustomerProfile || onOpenSiteProfile) ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {onOpenCustomerProfile ? (
                          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => onOpenCustomerProfile?.(customer.id)}>
                            Open Customer Profile
                          </Button>
                        ) : null}
                        {onOpenSiteProfile ? (
                          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => onOpenSiteProfile?.(customer.id, normalizeSiteAddress(job.jobAddress).toLowerCase())}>
                            Open Site Profile
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Job contacts</p>
                    <div className="mt-3 grid gap-3">
                      {requesterContact ? (
                        <div className="rounded-2xl border bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase text-muted-foreground">Requester</p>
                              <p className="mt-1 font-medium text-slate-900">{getContactDisplayName(requesterContact)}</p>
                            </div>
                            {requesterContact.role ? <Badge variant="secondary">{requesterContact.role}</Badge> : null}
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            {[requesterContact.phone, requesterContact.email].filter(Boolean).join(" - ") || "No phone or email saved"}
                          </p>
                        </div>
                      ) : null}

                      {onsiteContact ? (
                        <div className="rounded-2xl border bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase text-muted-foreground">On-site Contact</p>
                              <p className="mt-1 font-medium text-slate-900">{getContactDisplayName(onsiteContact)}</p>
                            </div>
                            {onsiteContact.role ? <Badge variant="secondary">{onsiteContact.role}</Badge> : null}
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            {[onsiteContact.phone, onsiteContact.email].filter(Boolean).join(" - ") || "No phone or email saved"}
                          </p>
                        </div>
                      ) : null}

                      {billingContact ? (
                        <div className="rounded-2xl border bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase text-muted-foreground">Billing Contact</p>
                              <p className="mt-1 font-medium text-slate-900">{getContactDisplayName(billingContact)}</p>
                            </div>
                            {billingContact.role ? <Badge variant="secondary">{billingContact.role}</Badge> : null}
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            {[billingContact.phone, billingContact.email].filter(Boolean).join(" - ") || "No phone or email saved"}
                          </p>
                        </div>
                      ) : null}

                      {!requesterContact && !onsiteContact && !billingContact ? (
                        <p className="text-sm text-slate-500">No job-specific contacts saved yet.</p>
                      ) : null}
                    </div>
                  </div>
                  {jobSiteAccessNote?.notes ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Site access notes</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-950">{jobSiteAccessNote.notes}</p>
                      {jobSiteAccessNote.updatedAt ? (
                        <p className="mt-2 text-xs text-amber-700">Updated {formatDate(jobSiteAccessNote.updatedAt)}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Description</p>
                    <p className="text-sm leading-6 text-slate-700">{job.description}</p>
                  </div>
                  <div className="grid gap-2 sm:max-w-[240px]">
                    <Label>Update Status</Label>
                    <Select value={job.status} onValueChange={(value) => onStatusChange(value)}>
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
                  </div>
                </CardContent>
              </Card>

              <SupplierManualMatches
                matches={supplierManualMatches}
                status={supplierManualStatus}
                error={supplierManualError}
              />
            </div>

            <div className="grid content-start gap-5">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-base">Job Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add site notes, faults found, parts needed..." />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      onClick={() => {
                        if (!note.trim()) return;
                        onAddNote(note);
                        setNote("");
                      }}
                    >
                      Add Note
                    </Button>
                  </div>
                  <div className="grid gap-3">
                    {(job.notes || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No notes yet.</p>
                    ) : (
                      job.notes.map((n) => (
                        <div key={n.id} className="rounded-2xl border bg-slate-50 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{n.author}</span>
                            <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="mt-2 text-slate-700">{n.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle className="text-base">Photos</CardTitle>
                  <Label htmlFor="photo-upload" className="cursor-pointer">
                    <div className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                      <Camera className="h-3.5 w-3.5" /> Upload photos
                    </div>
                  </Label>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    id="photo-upload"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length) onAddPhotos(files);
                      e.target.value = "";
                    }}
                  />
                  <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]">
                    {jobPhotos.length === 0 ? (
                      <p className="col-span-full text-sm text-muted-foreground">No photos uploaded yet.</p>
                    ) : (
                      jobPhotos.map((photo, index) => (
                        <div key={photo.id} className="group relative">
                          <button
                            type="button"
                            className="w-full overflow-hidden rounded-2xl border text-left transition hover:border-slate-300 hover:bg-slate-50"
                            onClick={() => setSelectedPhoto(photo)}
                          >
                            <img src={photo.url} alt={photo.name} className="h-20 w-full object-cover" />
                            <div className="space-y-1 border-t bg-white px-3 py-1.5">
                              <p className="truncate text-sm font-medium text-slate-900">{photo.name || `Photo ${index + 1}`}</p>
                              <p className="text-xs text-slate-500">Open full size</p>
                            </div>
                          </button>

                          {onDeletePhoto ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="absolute right-2 top-2 h-8 w-8 rounded-full border-rose-200 bg-white/95 text-rose-700 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onDeletePhoto(photo);
                                if (selectedPhoto?.id === photo.id) {
                                  setSelectedPhoto(null);
                                }
                              }}
                              aria-label={`Delete ${photo.name || `photo ${index + 1}`}`}
                              title="Delete photo"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {showCommercialDocuments ? (
              <div className="grid content-start gap-5">
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-base">Commercial Documents</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="rounded-2xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">Quote</p>
                          <p className="mt-1 text-muted-foreground">
                            {job.quote ? `Saved - ${money(calculateQuoteTotal(job.quote.items))}` : "No quote saved yet"}
                          </p>
                          {job.quote?.sentHistory?.length ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Sent {job.quote.sentHistory.length} {job.quote.sentHistory.length === 1 ? "time" : "times"}
                            </p>
                          ) : null}
                        </div>
                        {job.quote?.sentHistory?.length && onOpenSentDocument ? (
                          <Button variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={() => onOpenSentDocument("quote")}>
                            Open Quote
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="rounded-2xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">Invoice</p>
                          <p className="mt-1 text-muted-foreground">
                            {job.invoice ? `Saved - ${money(calculateInvoiceTotal(job.invoice.items))}` : "No invoice saved yet"}
                          </p>
                          {job.invoice ? (
                            <div className="mt-2 space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <Badge className={jobInvoiceStatus.className}>{jobInvoiceStatus.label}</Badge>
                                <Badge variant="secondary">Due {formatDate(job.invoice.dueDate)}</Badge>
                              </div>
                              <div className="text-xs text-slate-600">
                                <p>Paid {money(jobInvoicePaymentSummary.paidAmount)} of {money(jobInvoicePaymentSummary.total)}</p>
                                <p>Balance {money(jobInvoicePaymentSummary.balanceAmount)}</p>
                              </div>
                            </div>
                          ) : null}
                          {job.invoice?.sentHistory?.length ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Sent {job.invoice.sentHistory.length} {job.invoice.sentHistory.length === 1 ? "time" : "times"}
                            </p>
                          ) : null}
                        </div>
                        {job.invoice?.sentHistory?.length && onOpenSentDocument ? (
                          <Button variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={() => onOpenSentDocument("invoice")}>
                            Open Invoice
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {onOpenDocument ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="rounded-xl" onClick={() => onOpenDocument("quote")}>
                          Open Quote Editor
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-xl" onClick={() => onOpenDocument("invoice")}>
                          Open Invoice Editor
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>

      <Dialog open={Boolean(activeSelectedPhoto)} onOpenChange={(viewerOpen) => {
        if (!viewerOpen) setSelectedPhoto(null);
      }}>
        <DialogContent className="max-h-[92vh] rounded-3xl sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6 text-xl">
              {activeSelectedPhoto?.name || "Job Photo"}
            </DialogTitle>
          </DialogHeader>

          <DialogBody>
            {activeSelectedPhoto ? (
              <div className="flex min-h-[50vh] items-center justify-center gap-3">
                {canCyclePhotos ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    className="shrink-0 rounded-full border-slate-300 bg-white"
                    onClick={() => handleCyclePhoto(-1)}
                    aria-label="Previous photo"
                    title="Previous photo"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                ) : null}
                <div className="flex min-h-[50vh] flex-1 items-center justify-center rounded-2xl bg-slate-950 p-3">
                  <img
                    src={activeSelectedPhoto.url}
                    alt={activeSelectedPhoto.name || "Job photo"}
                    className="max-h-[72vh] max-w-full rounded-xl object-contain"
                  />
                </div>
                {canCyclePhotos ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    className="shrink-0 rounded-full border-slate-300 bg-white"
                    onClick={() => handleCyclePhoto(1)}
                    aria-label="Next photo"
                    title="Next photo"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
