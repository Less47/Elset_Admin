import { useEffect, useState } from "react";
import { FileText, Plus, Receipt } from "lucide-react";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { buildDefaultDoc, formatDate, getInvoicePaymentSummary, getInvoiceStatus, normalizeDocument, slugDate } from "@/lib/app-support";
import { ADMIN_EMAIL, calculateDocTotal, money } from "@/lib/quote-template";

export default function DocumentEditor({
  open,
  onOpenChange,
  job,
  type,
  onSave,
  onPreviewDocument,
  onSendDocument,
  onOpenSentDocument,
  isSendingDocument = false,
}) {
  const [docState, setDocState] = useState(null);
  const [isPreviewingDocument, setIsPreviewingDocument] = useState(false);
  const [sendPreview, setSendPreview] = useState(null);

  useEffect(() => {
    if (!job || !type) return;
    const document = normalizeDocument(type, job[type] || buildDefaultDoc(job, type));
    setDocState({
      ...document,
      sentHistory: document?.sentHistory || [],
    });
  }, [job, type]);

  useEffect(() => {
    if (open) return;
    if (sendPreview?.previewUrl) URL.revokeObjectURL(sendPreview.previewUrl);
    setSendPreview(null);
    setIsPreviewingDocument(false);
  }, [open, sendPreview?.previewUrl]);

  if (!job || !docState) return null;

  const total = calculateDocTotal(docState.items);
  const paymentSummary = type === "invoice" ? getInvoicePaymentSummary(docState) : null;
  const invoiceStatus = type === "invoice" ? getInvoiceStatus({ ...job, invoice: docState }) : null;
  const sentCount = docState.sentHistory?.length || 0;
  const documentLabel = type === "quote" ? "Quote" : "Invoice";
  const paymentReceiptStamp = type === "invoice" && paymentSummary?.paidAmount > 0 && paymentSummary?.total > 0
    ? paymentSummary.balanceAmount > 0
      ? "PART PAYMENT"
      : "PAID"
    : "";
  const paymentReceiptPurpose = paymentReceiptStamp === "PART PAYMENT"
    ? "part-payment-receipt"
    : paymentReceiptStamp === "PAID"
      ? "paid-receipt"
      : "";

  const closeSendPreview = () => {
    if (sendPreview?.previewUrl) URL.revokeObjectURL(sendPreview.previewUrl);
    setSendPreview(null);
  };

  const handlePreviewBeforeSend = async (options = {}) => {
    if (!onPreviewDocument) return;
    if (!job.customerEmail) return;

    if (sendPreview?.previewUrl) URL.revokeObjectURL(sendPreview.previewUrl);
    setSendPreview(null);
    setIsPreviewingDocument(true);

    try {
      const preview = await onPreviewDocument(docState, options);
      if (!preview) return;
      setSendPreview({
        ...preview,
        document: normalizeDocument(type, docState),
        previewTitle: options.previewTitle || `Preview ${documentLabel}`,
        confirmLabel: options.confirmLabel || `Confirm & Send ${documentLabel}`,
        sendOptions: options,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to render the ${documentLabel.toLowerCase()} preview.`;
      window.alert(message);
    } finally {
      setIsPreviewingDocument(false);
    }
  };

  const updateItem = (id, key, value) => {
    setDocState((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    }));
  };

  const removeItem = (id) => {
    setDocState((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));
  };

  const updatePayment = (id, key, value) => {
    setDocState((prev) => ({
      ...prev,
      payments: (prev.payments || []).map((payment) => (payment.id === id ? { ...payment, [key]: value } : payment)),
    }));
  };

  const removePayment = (id) => {
    setDocState((prev) => ({
      ...prev,
      payments: (prev.payments || []).filter((payment) => payment.id !== id),
    }));
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] rounded-3xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {type === "quote" ? <FileText className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}
            {type === "quote" ? "Quote" : "Invoice"} - {job.title}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Customer">
                <Input value={job.customerName} disabled />
              </FormField>
              <FormField label="Issue date">
                <Input
                  type="date"
                  value={docState.issueDate}
                  onChange={(e) => setDocState((p) => ({ ...p, issueDate: e.target.value }))}
                />
              </FormField>
            </div>

            {type === "invoice" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Due date">
                  <Input
                    type="date"
                    value={docState.dueDate || ""}
                    onChange={(e) => setDocState((p) => ({ ...p, dueDate: e.target.value }))}
                  />
                </FormField>
                <FormField label="OC number">
                  <Input value={job.ocNumber || "Not set"} disabled />
                </FormField>
              </div>
            )}

            {type === "invoice" && (
              <div className="grid gap-4">
                <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Payment Snapshot</p>
                  <div className="flex items-center justify-between text-sm">
                    <span>Status</span>
                    <Badge className={invoiceStatus.className}>{invoiceStatus.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>Paid so far</span>
                    <span className="font-medium text-slate-900">{money(paymentSummary.paidAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>Balance</span>
                    <span className="font-medium text-slate-900">{money(paymentSummary.balanceAmount)}</span>
                  </div>
                </div>
              </div>
            )}

            <FormField label="Notes / template text">
              <Textarea
                value={docState.notes}
                rows={3}
                onChange={(e) => setDocState((p) => ({ ...p, notes: e.target.value }))}
              />
            </FormField>

            {type === "invoice" && (
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <Label>Payments received</Label>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() =>
                      setDocState((prev) => ({
                        ...prev,
                        payments: [
                          ...(prev.payments || []),
                          {
                            id: crypto.randomUUID(),
                            amount: "",
                            date: slugDate(),
                            method: "",
                            reference: "",
                            notes: "",
                          },
                        ],
                      }))
                    }
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Payment
                  </Button>
                </div>

                {(docState.payments || []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                    No payments recorded yet.
                  </div>
                ) : (
                  (docState.payments || []).map((payment, index) => (
                    <Card key={payment.id} className="rounded-2xl border-slate-200">
                      <CardContent className="grid gap-3 p-4">
                        <div className="grid gap-3 sm:grid-cols-[140px_150px_1fr_1fr_80px]">
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Amount"
                            value={payment.amount}
                            onChange={(e) => updatePayment(payment.id, "amount", e.target.value)}
                          />
                          <Input
                            type="date"
                            value={payment.date || ""}
                            onChange={(e) => updatePayment(payment.id, "date", e.target.value)}
                          />
                          <Input
                            placeholder="Method"
                            value={payment.method || ""}
                            onChange={(e) => updatePayment(payment.id, "method", e.target.value)}
                          />
                          <Input
                            placeholder="Reference"
                            value={payment.reference || ""}
                            onChange={(e) => updatePayment(payment.id, "reference", e.target.value)}
                          />
                          <Button variant="ghost" onClick={() => removePayment(payment.id)}>
                            Remove
                          </Button>
                        </div>
                        <Textarea
                          rows={2}
                          value={payment.notes || ""}
                          onChange={(e) => updatePayment(payment.id, "notes", e.target.value)}
                          placeholder={`Payment ${index + 1} notes`}
                        />
                      </CardContent>
                    </Card>
                  ))
                )}

                <FormField label="Payment notes">
                  <Textarea
                    value={docState.paymentNotes || ""}
                    rows={2}
                    onChange={(e) => setDocState((p) => ({ ...p, paymentNotes: e.target.value }))}
                    placeholder="General remittance notes, follow-up details, or account comments..."
                  />
                </FormField>

                {paymentReceiptStamp ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {paymentReceiptStamp === "PAID" ? "Paid invoice receipt" : "Part payment receipt"}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Preview a customer copy stamped {paymentReceiptStamp} before sending it.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-xl"
                        disabled={!job.customerEmail || isSendingDocument || isPreviewingDocument}
                        onClick={() => handlePreviewBeforeSend({
                          stampText: paymentReceiptStamp,
                          emailPurpose: paymentReceiptPurpose,
                          previewTitle: `Preview ${paymentReceiptStamp === "PAID" ? "Paid Receipt" : "Part Payment Receipt"}`,
                          confirmLabel: `Confirm & Send ${paymentReceiptStamp === "PAID" ? "Paid Receipt" : "Part Payment Receipt"}`,
                        })}
                      >
                        {isPreviewingDocument ? "Generating preview..." : `Preview & Send ${paymentReceiptStamp === "PAID" ? "Paid Receipt" : "Part Payment Receipt"}`}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() =>
                    setDocState((prev) => ({
                      ...prev,
                      items: [
                        ...prev.items,
                        { id: crypto.randomUUID(), description: "", qty: 1, rate: 0 },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add Item
                </Button>
              </div>

              {docState.items.map((item, index) => (
                <Card key={item.id} className="rounded-2xl border-slate-200">
                  <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_90px_110px_80px]">
                    <Input
                      placeholder={`Item ${index + 1} description`}
                      value={item.description}
                      onChange={(e) => updateItem(item.id, "description", e.target.value)}
                    />
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="Qty"
                      value={item.qty}
                      onChange={(e) => updateItem(item.id, "qty", e.target.value)}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Rate"
                      value={item.rate}
                      onChange={(e) => updateItem(item.id, "rate", e.target.value)}
                    />
                    <Button variant="ghost" onClick={() => removeItem(item.id)}>
                      Remove
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card className="h-fit rounded-3xl border-slate-200 bg-slate-50">
            <CardHeader>
              <CardTitle className="text-lg">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span>Document type</span>
                <span className="font-medium capitalize">{type}</span>
              </div>
              <div className="flex justify-between">
                <span>Job number</span>
                <span className="font-medium">#{job.jobNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Line items</span>
                <span className="font-medium">{docState.items.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Customer</span>
                <span className="max-w-[140px] text-right font-medium">{job.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span>Send to</span>
                <span className="max-w-[140px] text-right font-medium">{job.customerEmail || "No email saved"}</span>
              </div>
              <div className="flex justify-between">
                <span>Send from</span>
                <span className="max-w-[140px] text-right font-medium">{ADMIN_EMAIL}</span>
              </div>
              <div className="flex justify-between">
                <span>Previous attempts</span>
                <span className="font-medium">{sentCount}</span>
              </div>
              {type === "invoice" && (
                <>
                  <div className="flex justify-between">
                    <span>Due date</span>
                    <span className="font-medium">{docState.dueDate ? formatDate(docState.dueDate) : "Not set"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className="font-medium">{invoiceStatus.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Paid so far</span>
                    <span className="font-medium">{money(paymentSummary.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Balance</span>
                    <span className="font-medium">{money(paymentSummary.balanceAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payments</span>
                    <span className="font-medium">{paymentSummary.paymentCount}</span>
                  </div>
                  {paymentSummary.lastPaymentDate ? (
                    <div className="flex justify-between">
                      <span>Last payment</span>
                      <span className="font-medium">{formatDate(paymentSummary.lastPaymentDate)}</span>
                    </div>
                  ) : null}
                </>
              )}
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {type === "quote"
                  ? "Quote emails are generated as PDF attachments and sent through the API using the active template."
                  : "Invoice emails are generated as PDF attachments and sent through the API using the active template."}
              </p>
            </CardContent>
          </Card>
        </div>

        </DialogBody>

        <DialogFooter>
          {sentCount > 0 && onOpenSentDocument ? (
            <Button variant="outline" onClick={onOpenSentDocument} disabled={isSendingDocument}>
              Open {documentLabel}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={!job.customerEmail || isSendingDocument || isPreviewingDocument}
            onClick={() => handlePreviewBeforeSend()}
          >
            {isSendingDocument ? "Sending..." : isPreviewingDocument ? "Generating preview..." : `Preview & Send ${documentLabel}`}
          </Button>
          <Button
            disabled={isSendingDocument}
            onClick={() => {
              onSave(docState);
              onOpenChange(false);
            }}
          >
            Save {documentLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(sendPreview)} onOpenChange={(nextOpen) => {
      if (!nextOpen && !isSendingDocument) closeSendPreview();
    }}>
      <DialogContent className="h-[92vh] max-h-[92vh] rounded-3xl sm:max-w-[94vw] xl:max-w-[1180px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{sendPreview?.previewTitle || `Preview ${documentLabel}`}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Review the PDF that will be emailed before confirming the send.
          </p>
        </DialogHeader>

        <DialogBody className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            {sendPreview?.previewUrl ? (
              <iframe
                title={`${documentLabel} PDF preview`}
                src={sendPreview.previewUrl}
                className="h-full min-h-[520px] w-full bg-white"
              />
            ) : null}
          </div>

          <Card className="h-fit rounded-2xl border-slate-200 bg-slate-50">
            <CardHeader>
              <CardTitle className="text-base">Send Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span>To</span>
                <span className="text-right font-medium">{sendPreview?.toEmail || job.customerEmail}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>From</span>
                <span className="text-right font-medium">{sendPreview?.fromEmail || ADMIN_EMAIL}</span>
              </div>
              {sendPreview?.ccEmail ? (
                <div className="flex justify-between gap-4">
                  <span>CC</span>
                  <span className="text-right font-medium">{sendPreview.ccEmail}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <span>Document</span>
                <span className="font-medium">
                  {sendPreview?.stampText ? `${sendPreview.stampText} ${documentLabel}` : `${documentLabel} PDF`}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Job</span>
                <span className="font-medium">#{job.jobNumber}</span>
              </div>
              {sendPreview?.priorAttempts > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
                  This customer already has {sendPreview.priorAttempts} previous {documentLabel.toLowerCase()} send {sendPreview.priorAttempts === 1 ? "attempt" : "attempts"}.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={closeSendPreview} disabled={isSendingDocument}>
            Back to Edit
          </Button>
          <Button
            variant="secondary"
            disabled={isSendingDocument || !sendPreview?.document}
            onClick={async () => {
              if (!sendPreview?.document) return;
              const sent = await onSendDocument?.(sendPreview.document, sendPreview.sendOptions || {});
              if (sent !== false) closeSendPreview();
            }}
          >
            {isSendingDocument ? "Sending..." : sendPreview?.confirmLabel || `Confirm & Send ${documentLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
