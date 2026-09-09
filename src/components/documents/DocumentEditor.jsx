import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RECORD_WORKSPACE_WIDE_MAX_WIDTH, RecordWorkspace, WorkspaceActionBar } from "@/components/workspace/RecordWorkspace";
import { buildDefaultDoc, formatDate, getInvoicePaymentSummary, getInvoiceStatus, normalizeDocument, slugDate } from "@/lib/app-support";
import { ADMIN_EMAIL, buildDocumentReference, calculateDocTotal, calculateQuoteGst, calculateQuoteTotal, getDocumentRecipientEmail, getDocumentRecipientName, money } from "@/lib/quote-template";
import "./DocumentWorkspace.css";

function Field({ id, label, children }) {
  return <div className="document-field"><label htmlFor={id}>{label}</label>{children}</div>;
}
function Detail({ label, children, total = false }) {
  return <div className={`document-detail ${total ? "document-total" : ""}`}><dt>{label}</dt><dd>{children}</dd></div>;
}
function draftSnapshot(document) {
  // Inputs return strings, while saved numeric fields may arrive as numbers.
  // Compare their displayed values without changing persisted data or math.
  return JSON.stringify(document, (key, value) => ["qty", "rate", "amount"].includes(key) ? String(value ?? "") : value);
}

export default function DocumentEditor({ job, type, backLabel, onBack, registerNavigationBlocker, onSave, onPreviewDocument, onSendDocument, onOpenSentDocument, isSendingDocument = false }) {
  const [docState, setDocState] = useState(() => normalizeDocument(type, job[type] || buildDefaultDoc(job, type)));
  const [baseline, setBaseline] = useState(() => draftSnapshot(docState));
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewingDocument, setIsPreviewingDocument] = useState(false);
  const [sendPreview, setSendPreview] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const workspaceRef = useRef(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const dirty = draftSnapshot(docState) !== baseline;
  const busy = isSaving || isSendingDocument;
  const previewOpen = Boolean(sendPreview);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => registerNavigationBlocker?.(() => dirty || busy), [registerNavigationBlocker, dirty, busy]);
  useEffect(() => {
    // Preserve dirty drafts across server refreshes; rebase clean forms after save.
    if (!job[type] || dirty || busy) return;
    const next = normalizeDocument(type, job[type]);
    setDocState(next);
    setBaseline(draftSnapshot(next));
  }, [job, type, dirty, busy]);
  useEffect(() => {
    const heading = workspaceRef.current?.querySelector("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [previewOpen]);
  useEffect(() => {
    const url = sendPreview?.previewUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [sendPreview?.previewUrl]);

  const subtotal = calculateDocTotal(docState.items);
  const gst = calculateQuoteGst(docState.items);
  const total = calculateQuoteTotal(docState.items);
  const paymentSummary = type === "invoice" ? getInvoicePaymentSummary(docState) : null;
  const invoiceStatus = type === "invoice" ? getInvoiceStatus({ ...job, invoice: docState }) : null;
  const sentCount = docState.sentHistory?.length || 0;
  const documentLabel = type === "quote" ? "Quote" : "Invoice";
  const recipientEmail = getDocumentRecipientEmail(job);
  const recipientName = getDocumentRecipientName(job);
  const clientReference = String(job.ocNumber || "").trim();
  const paymentReceiptStamp = type === "invoice" && paymentSummary?.paidAmount > 0 && paymentSummary?.total > 0
    ? paymentSummary.balanceAmount > 0 ? "PART PAYMENT" : "PAID" : "";
  const paymentReceiptPurpose = paymentReceiptStamp === "PART PAYMENT" ? "part-payment-receipt" : paymentReceiptStamp === "PAID" ? "paid-receipt" : "";
  const paymentReceiptLabel = paymentReceiptStamp === "PAID" ? "Paid Receipt" : paymentReceiptStamp === "PART PAYMENT" ? "Part Payment Receipt" : "";
  const sendActionLabel = paymentReceiptLabel || documentLabel;
  const sendActionOptions = paymentReceiptStamp ? { stampText: paymentReceiptStamp, emailPurpose: paymentReceiptPurpose, previewTitle: `Preview ${paymentReceiptLabel}`, confirmLabel: `Confirm & Send ${paymentReceiptLabel}` } : {};

  async function previewDocument(options = {}) {
    if (busyRef.current || isPreviewingDocument) return;
    setIsPreviewingDocument(true);
    setError("");
    try {
      const preview = await onPreviewDocument(docState, options);
      if (preview) {
        if (!mountedRef.current) { URL.revokeObjectURL(preview.previewUrl); return; }
        setSendPreview({ ...preview, document: normalizeDocument(type, docState), previewTitle: options.previewTitle || `Preview ${documentLabel}`, confirmLabel: options.confirmLabel || `Confirm & Send ${documentLabel}`, sendOptions: options });
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Unable to render the ${type} preview.`);
    } finally { setIsPreviewingDocument(false); }
  }
  async function saveDocument() {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsSaving(true);
    setError("");
    setFeedback("");
    try {
      const saved = await onSave(docState);
      if (saved === false) { setError(`Unable to save the ${type}. Your changes are still here.`); return; }
      setBaseline(draftSnapshot(docState));
      setFeedback("Saved");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Unable to save the ${type}.`);
    } finally { busyRef.current = false; setIsSaving(false); }
  }
  async function sendDocument() {
    if (busyRef.current || !sendPreview?.document) return;
    busyRef.current = true;
    setError("");
    try {
      const sent = await onSendDocument(sendPreview.document, sendPreview.sendOptions || {});
      if (sent === false) { setError("Unable to finish sending. Review the error before trying again."); return; }
      setBaseline(draftSnapshot(docState));
      setFeedback(`${sendActionLabel} sent with PDF attachment`);
      setSendPreview(null);
    } finally { busyRef.current = false; }
  }
  const updateItem = (id, key, value) => setDocState((prev) => ({ ...prev, items: prev.items.map((item) => item.id === id ? { ...item, [key]: value } : item) }));
  const removeItem = (id) => setDocState((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== id) }));
  const updatePayment = (id, key, value) => setDocState((prev) => ({ ...prev, payments: (prev.payments || []).map((payment) => payment.id === id ? { ...payment, [key]: value } : payment) }));
  const removePayment = (id) => setDocState((prev) => ({ ...prev, payments: (prev.payments || []).filter((payment) => payment.id !== id) }));
  const actions = <>
    <Button type="button" variant="outline" disabled={busy || isPreviewingDocument} onClick={() => previewDocument(sendActionOptions)}>{isPreviewingDocument ? "Generating preview..." : "Preview"}</Button>
    <Button type="button" disabled={busy || isPreviewingDocument} onClick={saveDocument}>{isSaving ? "Saving..." : `Save ${documentLabel}`}</Button>
  </>;
  const previewActions = <>
    <Button type="button" disabled={!recipientEmail || isSendingDocument} onClick={sendDocument}>{isSendingDocument ? "Sending..." : sendPreview?.confirmLabel}</Button>
  </>;
  const title = sendPreview ? sendPreview.previewTitle : job[type] ? `${documentLabel} ${buildDocumentReference(job, type)}` : `New ${documentLabel}`;

  return <div ref={workspaceRef} className="document-workspace" data-document-workspace={type} data-document-mode={job[type] ? "edit" : "create"}>
    <RecordWorkspace maxWidth={RECORD_WORKSPACE_WIDE_MAX_WIDTH} title={title} eyebrow={`Job #${job.jobNumber} · ${job.title}`} subtitle={`${job.customerName} · ${job.jobAddress || ""}`} backLabel={sendPreview ? `${documentLabel} editor` : backLabel} onBack={sendPreview ? () => { if (!isSendingDocument) setSendPreview(null); } : () => onBack()} headerActions={<div className="hidden gap-2 lg:flex">{sendPreview ? previewActions : actions}</div>}>
      <p className="document-feedback" role="status" aria-live="polite">{busy ? isSaving ? "Saving..." : "Sending..." : dirty ? "Unsaved changes" : feedback}</p>
      {error ? <p role="alert" className="document-error">{error}</p> : null}
      {sendPreview ? <div className="document-preview-layout" data-document-preview>
        <div className="document-pdf-panel"><iframe title={`${documentLabel} PDF preview`} src={sendPreview.previewUrl} /><a href={sendPreview.previewUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-sky-800 underline">Open PDF in a new tab</a></div>
        <section className="document-summary" aria-labelledby="send-details-title">
          <h2 id="send-details-title">Send details</h2><p className="text-sm text-slate-600">Review the PDF before confirming the send.</p>
          <dl><Detail label="To">{sendPreview.toName || recipientName}<br />{sendPreview.toEmail || recipientEmail || "No email saved"}</Detail><Detail label="From">{sendPreview.fromEmail || ADMIN_EMAIL}</Detail>{sendPreview.ccEmail ? <Detail label="CC">{sendPreview.ccEmail}</Detail> : null}<Detail label="Document">{sendPreview.stampText ? `${sendPreview.stampText} ${documentLabel}` : `${documentLabel} PDF`}</Detail><Detail label="Job">#{job.jobNumber}</Detail></dl>
          {sendPreview.priorAttempts > 0 ? <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">This customer already has {sendPreview.priorAttempts} previous {type} send {sendPreview.priorAttempts === 1 ? "attempt" : "attempts"}.</p> : null}
        </section>
      </div> : <fieldset disabled={busy || isPreviewingDocument} className="min-w-0 space-y-4" aria-label={`${documentLabel} editor`}>
        <section className="document-section" aria-labelledby="document-details-title">
          <h2 id="document-details-title">{documentLabel} details</h2><p className="mb-3 text-sm text-slate-600 break-words">{job.customerName} · Job #{job.jobNumber} · {job.jobAddress}</p>
          <div className="document-fields">
            <Field id="document-customer" label="Customer"><Input id="document-customer" value={job.customerName} disabled /></Field>
            <Field id="document-issue-date" label="Issue date"><Input id="document-issue-date" type="date" value={docState.issueDate} onChange={(e) => setDocState((p) => ({ ...p, issueDate: e.target.value }))} /></Field>
            {type === "invoice" ? <Field id="document-due-date" label="Due date"><Input id="document-due-date" type="date" value={docState.dueDate || ""} onChange={(e) => setDocState((p) => ({ ...p, dueDate: e.target.value }))} /></Field> : null}
            {clientReference ? <Field id="document-reference" label="Client reference / PO number"><Input id="document-reference" value={clientReference} disabled /></Field> : null}
          </div>
        </section>
        <section className="document-section" aria-labelledby="document-items-title">
          <div className="document-section-heading"><h2 id="document-items-title">Line items</h2><Button type="button" variant="outline" onClick={() => setDocState((prev) => ({ ...prev, items: [...prev.items, { id: crypto.randomUUID(), description: "", qty: 1, rate: 0 }] }))}><Plus className="h-4 w-4" /> Add Item</Button></div>
          <div className="document-item-labels" aria-hidden="true"><span>Description</span><span>Qty</span><span>Rate</span><span>Total</span><span /></div>
          <div className="document-items">{docState.items.map((item, index) => <div className="document-item" key={item.id} data-document-item>
            <Field id={`item-${item.id}-description`} label={`Item ${index + 1} description`}><Input id={`item-${item.id}-description`} placeholder={`Item ${index + 1} description`} value={item.description} onChange={(e) => updateItem(item.id, "description", e.target.value)} /></Field>
            <Field id={`item-${item.id}-qty`} label={`Item ${index + 1} quantity`}><Input id={`item-${item.id}-qty`} type="number" step="0.1" placeholder="Qty" value={item.qty} onChange={(e) => updateItem(item.id, "qty", e.target.value)} /></Field>
            <Field id={`item-${item.id}-rate`} label={`Item ${index + 1} rate`}><Input id={`item-${item.id}-rate`} type="number" step="0.01" placeholder="Rate" value={item.rate} onChange={(e) => updateItem(item.id, "rate", e.target.value)} /></Field>
            <output className="document-line-total" aria-label={`Item ${index + 1} total`}>{money(calculateDocTotal([item]))}</output><Button type="button" variant="ghost" className="document-remove" aria-label={`Remove item ${index + 1}`} title="Remove item" onClick={() => removeItem(item.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>)}</div>
        </section>
        <div className="document-bottom-layout">
          <section className="document-section" aria-label="Document notes"><Field id="document-notes" label={type === "invoice" ? "Work completed" : "Scope / notes"}><Textarea id="document-notes" value={docState.notes} rows={4} onChange={(e) => setDocState((p) => ({ ...p, notes: e.target.value }))} /></Field></section>
          <section className="document-summary" aria-label="Document summary"><h2>Summary</h2><dl>
            <Detail label="Line items">{docState.items.length}</Detail><Detail label="Subtotal"><span data-document-subtotal>{money(subtotal)}</span></Detail><Detail label="GST"><span data-document-gst>{money(gst)}</span></Detail><Detail label="Total" total><span data-document-total>{money(total)}</span></Detail>
            {paymentSummary ? <><Detail label="Status"><Badge className={invoiceStatus.className}>{invoiceStatus.label}</Badge></Detail><Detail label="Paid so far">{money(paymentSummary.paidAmount)}</Detail><Detail label="Balance">{money(paymentSummary.balanceAmount)}</Detail><Detail label="Due date">{docState.dueDate ? formatDate(docState.dueDate) : "Not set"}</Detail><Detail label="Payments">{paymentSummary.paymentCount}</Detail>{paymentSummary.lastPaymentDate ? <Detail label="Last payment">{formatDate(paymentSummary.lastPaymentDate)}</Detail> : null}</> : null}
          </dl></section>
        </div>
        {type === "invoice" ? <section className="document-section" aria-labelledby="document-payments-title">
          <div className="document-section-heading"><h2 id="document-payments-title">Payments received</h2><Button type="button" variant="outline" onClick={() => setDocState((prev) => ({ ...prev, payments: [...(prev.payments || []), { id: crypto.randomUUID(), amount: "", date: slugDate(), method: "", reference: "", notes: "" }] }))}><Plus className="h-4 w-4" /> Add Payment</Button></div>
          {(docState.payments || []).length === 0 ? <p className="text-sm text-slate-600">No payments recorded yet.</p> : (docState.payments || []).map((payment, index) => <div className="document-payment" key={payment.id}>
            <div className="document-payment-fields">
              <Field id={`payment-${payment.id}-amount`} label={`Payment ${index + 1} amount`}><Input id={`payment-${payment.id}-amount`} type="number" step="0.01" placeholder="Amount" value={payment.amount} onChange={(e) => updatePayment(payment.id, "amount", e.target.value)} /></Field>
              <Field id={`payment-${payment.id}-date`} label={`Payment ${index + 1} date`}><Input id={`payment-${payment.id}-date`} type="date" value={payment.date || ""} onChange={(e) => updatePayment(payment.id, "date", e.target.value)} /></Field>
              <Field id={`payment-${payment.id}-method`} label={`Payment ${index + 1} method`}><Input id={`payment-${payment.id}-method`} placeholder="Method" value={payment.method || ""} onChange={(e) => updatePayment(payment.id, "method", e.target.value)} /></Field>
              <Field id={`payment-${payment.id}-reference`} label={`Payment ${index + 1} reference`}><Input id={`payment-${payment.id}-reference`} placeholder="Reference" value={payment.reference || ""} onChange={(e) => updatePayment(payment.id, "reference", e.target.value)} /></Field>
              <Button type="button" variant="ghost" aria-label={`Remove payment ${index + 1}`} onClick={() => removePayment(payment.id)}>Remove</Button>
            </div>
            <Field id={`payment-${payment.id}-notes`} label={`Payment ${index + 1} notes`}><Textarea id={`payment-${payment.id}-notes`} rows={2} value={payment.notes || ""} onChange={(e) => updatePayment(payment.id, "notes", e.target.value)} /></Field>
          </div>)}
          <div className="mt-3"><Field id="document-payment-notes" label="Payment notes"><Textarea id="document-payment-notes" value={docState.paymentNotes || ""} rows={2} onChange={(e) => setDocState((p) => ({ ...p, paymentNotes: e.target.value }))} placeholder="General remittance notes, follow-up details, or account comments..." /></Field></div>
        </section> : null}
        <section className="document-section" aria-labelledby="document-email-title">
          <h2 id="document-email-title">Email</h2><dl className="document-email-details"><Detail label="Recipient">{recipientName}</Detail><Detail label="Send to">{recipientEmail || "No email saved"}</Detail><Detail label="Send from">{ADMIN_EMAIL}</Detail><Detail label="Previous attempts">{sentCount}</Detail></dl>
          <div className="mt-3 flex flex-wrap gap-2">{sentCount > 0 && onOpenSentDocument ? <Button type="button" variant="outline" onClick={onOpenSentDocument}>Open {documentLabel}</Button> : null}<Button type="button" variant="secondary" disabled={!recipientEmail || isPreviewingDocument} onClick={() => previewDocument(sendActionOptions)}>Preview &amp; Send {sendActionLabel}</Button></div>
        </section>
      </fieldset>}
      <div className="lg:hidden"><WorkspaceActionBar status={busy ? isSaving ? "Saving..." : "Sending..." : dirty ? "Unsaved" : feedback}>{sendPreview ? previewActions : actions}</WorkspaceActionBar></div>
    </RecordWorkspace>
  </div>;
}
