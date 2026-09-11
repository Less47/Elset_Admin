import crypto from "node:crypto";
import { WorkspaceDocumentError } from "./server-workspace-documents.js";
import { invoiceDeletionRestriction, invoiceHasBeenSent } from "./src/lib/invoice-deletion.js";
import { buildDocumentReference } from "./src/lib/quote-template.js";

export function deleteJsonInvoice(state, jobId, { confirmSent = false, deletedBy = "" } = {}) {
  const job = state.jobs.find((entry) => entry.id === jobId);
  if (!job?.invoice) throw new WorkspaceDocumentError("Invoice not found.", 404);
  const restriction = invoiceDeletionRestriction(job.invoice);
  if (restriction) throw new WorkspaceDocumentError(restriction, 409);
  if (invoiceHasBeenSent(job.invoice) && confirmSent !== true) {
    throw Object.assign(new WorkspaceDocumentError("This invoice has already been sent. Confirm deletion of the sent invoice; the customer will still have their copy.", 409), { code: "INVOICE_ALREADY_SENT" });
  }
  const deletedAt = new Date().toISOString();
  const archive = {
    id: crypto.randomUUID(), invoiceId: job.invoice.id || `${jobId}:invoice`, jobId,
    jobNumber: job.jobNumber, invoiceNumber: buildDocumentReference(job, "invoice"), customerName: job.customerName,
    invoice: structuredClone(job.invoice), deletedAt, deletedBy,
  };
  return {
    state: { ...state, jobs: state.jobs.map((entry) => entry.id === jobId ? { ...entry, invoice: null, invoiceArchiveRevision: archive.id, updatedAt: deletedAt } : entry), deletedInvoices: [archive, ...(state.deletedInvoices || [])] },
    result: { jobId, invoiceId: archive.invoiceId, archiveId: archive.id, deletedAt },
  };
}

export function restoreJsonInvoice(state, archiveId) {
  const archive = (state.deletedInvoices || []).find((entry) => entry.id === archiveId);
  if (!archive) throw new WorkspaceDocumentError("Deleted invoice not found.", 404);
  const job = state.jobs.find((entry) => entry.id === archive.jobId);
  if (!job) throw new WorkspaceDocumentError("Restore the linked job before restoring this invoice.", 409);
  if (job.invoice) throw new WorkspaceDocumentError("This job already has an invoice. Its current invoice will not be overwritten.", 409);
  return {
    state: {
      ...state,
      jobs: state.jobs.map((entry) => entry.id === job.id ? { ...entry, invoice: structuredClone(archive.invoice), invoiceArchiveRevision: crypto.randomUUID(), updatedAt: new Date().toISOString() } : entry),
      deletedInvoices: state.deletedInvoices.filter((entry) => entry.id !== archiveId),
    },
    result: { jobId: job.id, invoice: archive.invoice, archiveId },
  };
}
