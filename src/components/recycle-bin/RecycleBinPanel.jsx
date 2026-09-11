import { useMemo, useRef, useState } from "react";
import { WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { calculateQuoteTotal, money } from "@/lib/quote-template";
import { RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function RecycleBinPanel({
  deletedJobs,
  deletedCustomers,
  deletedInvoices = [],
  onRestoreInvoice,
  onRestoreJob,
  onRestoreCustomer,
  onEmptyDeletedJobs,
  onEmptyDeletedCustomers,
  formatDate,
  getRecycleBinExpiryDate,
  toTimestamp,
}) {
  const [restoringInvoice, setRestoringInvoice] = useState("");
  const [invoiceFeedback, setInvoiceFeedback] = useState(null);
  const restoringRef = useRef(false);
  async function restoreInvoice(id) {
    if (restoringRef.current) return;
    restoringRef.current = true;
    setRestoringInvoice(id);
    setInvoiceFeedback(null);
    try {
      const result = await onRestoreInvoice(id);
      setInvoiceFeedback(result?.ok ? { tone: "success", message: "Invoice restored" } : { tone: "error", message: result?.error || "Unable to restore the invoice. Please try again." });
    } catch {
      setInvoiceFeedback({ tone: "error", message: "Unable to restore the invoice. Please try again." });
    } finally { restoringRef.current = false; setRestoringInvoice(""); }
  }
  const sortedDeletedInvoices = useMemo(() => [...deletedInvoices].sort((a, b) => toTimestamp(b.deletedAt) - toTimestamp(a.deletedAt)), [deletedInvoices, toTimestamp]);
  const sortedDeletedJobs = useMemo(
    () => [...deletedJobs].sort((a, b) => toTimestamp(b.deletedAt) - toTimestamp(a.deletedAt)),
    [deletedJobs, toTimestamp]
  );
  const sortedDeletedCustomers = useMemo(
    () => [...deletedCustomers].sort((a, b) => toTimestamp(b.deletedAt) - toTimestamp(a.deletedAt)),
    [deletedCustomers, toTimestamp]
  );

  return (
    <div className="space-y-6">
      <Tabs defaultValue="jobs" className="space-y-6">
        <div className="floating-page-toolbar flex items-center px-4 py-3">
          <TabsList className="grid w-full max-w-[480px] grid-cols-3 rounded-xl bg-card/90">
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="jobs">
          <Card className="rounded-3xl border-border">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Deleted Jobs</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Restore a job before its recycle-bin expiry date.</p>
              </div>
              <Button
                variant="outline"
                className="rounded-xl border-status-danger-border text-status-danger hover:bg-status-danger-surface hover:text-status-danger"
                disabled={sortedDeletedJobs.length === 0}
                onClick={onEmptyDeletedJobs}
              >
                Empty Job Bin
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {sortedDeletedJobs.length === 0 ? (
                  <EmptyState title="Job recycle bin is empty" text="Deleted jobs will appear here for 7 days before automatic removal." />
                ) : (
                  sortedDeletedJobs.map((record) => (
                    <div key={`${record.job.id}-${record.deletedAt}`} className="rounded-2xl border bg-card p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Job #{record.job.jobNumber}</p>
                          <p className="font-semibold text-foreground">{record.job.title}</p>
                          <p className="mt-1 text-sm text-text-secondary">{record.job.customerName}</p>
                        </div>
                        <Button className="rounded-xl" onClick={() => onRestoreJob(record.job.id)}>
                          <RotateCcw className="mr-2 h-4 w-4" /> Restore Job
                        </Button>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-text-secondary md:grid-cols-2">
                        <div className="flex items-center justify-between gap-3">
                          <span>Deleted</span>
                          <span className="font-medium text-foreground">{formatDate(record.deletedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Auto delete</span>
                          <span className="font-medium text-foreground">{formatDate(getRecycleBinExpiryDate(record.deletedAt))}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Status</span>
                          <span className="font-medium text-foreground">{record.job.status}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Documents</span>
                          <span className="font-medium text-foreground">
                            {record.job.quote ? "Quote saved" : "No quote"} / {record.job.invoice ? "Invoice saved" : "No invoice"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card className="rounded-3xl border-border">
            <CardHeader><CardTitle className="text-base">Deleted Invoices</CardTitle><p className="mt-1 text-sm text-muted-foreground">Invoices and their send history are kept here for recovery.</p></CardHeader>
            <CardContent className="space-y-4">
              {invoiceFeedback ? <div role={invoiceFeedback.tone === "error" ? "alert" : "status"}><WorkspaceMessage tone={invoiceFeedback.tone}>{invoiceFeedback.message}</WorkspaceMessage></div> : null}
              {sortedDeletedInvoices.length === 0 ? <EmptyState title="Invoice recycle bin is empty" text="Deleted invoices will appear here for recovery." /> : sortedDeletedInvoices.map((record) => <div key={record.id} className="rounded-2xl border bg-card p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 break-words"><p className="font-semibold text-foreground">{record.invoiceNumber}</p><p className="mt-1 text-sm text-text-secondary">{record.customerName}</p></div>
                  <Button className="rounded-xl" disabled={Boolean(restoringInvoice)} onClick={() => restoreInvoice(record.id)}><RotateCcw className="mr-2 h-4 w-4" />{restoringInvoice === record.id ? "Restoring..." : "Restore Invoice"}</Button>
                </div>
                <dl className="mt-4 grid gap-2 text-sm text-text-secondary sm:grid-cols-2"><div className="flex justify-between gap-3"><dt>Amount</dt><dd className="font-medium text-foreground">{money(calculateQuoteTotal(record.invoice.items || []))}</dd></div><div className="flex justify-between gap-3"><dt>Deleted</dt><dd className="font-medium text-foreground">{formatDate(record.deletedAt)}</dd></div></dl>
              </div>)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card className="rounded-3xl border-border">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Deleted Customers</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Restore a customer record before it expires from the recycle bin.</p>
              </div>
              <Button
                variant="outline"
                className="rounded-xl border-status-danger-border text-status-danger hover:bg-status-danger-surface hover:text-status-danger"
                disabled={sortedDeletedCustomers.length === 0}
                onClick={onEmptyDeletedCustomers}
              >
                Empty Customer Bin
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {sortedDeletedCustomers.length === 0 ? (
                  <EmptyState title="Customer recycle bin is empty" text="Deleted customer records will appear here for 7 days before automatic removal." />
                ) : (
                  sortedDeletedCustomers.map((record) => {
                    const relatedDeletedJobs = deletedJobs.filter((entry) => entry.job.customerId === record.customer.id).length;
                    return (
                      <div key={`${record.customer.id}-${record.deletedAt}`} className="rounded-2xl border bg-card p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-foreground">{record.customer.name}</p>
                            <p className="mt-1 text-sm text-text-secondary">{record.customer.email || "No email saved"}</p>
                          </div>
                          <Button className="rounded-xl" onClick={() => onRestoreCustomer(record.customer.id)}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Restore Customer
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-2 text-sm text-text-secondary md:grid-cols-2">
                          <div className="flex items-center justify-between gap-3">
                            <span>Deleted</span>
                            <span className="font-medium text-foreground">{formatDate(record.deletedAt)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Auto delete</span>
                            <span className="font-medium text-foreground">{formatDate(getRecycleBinExpiryDate(record.deletedAt))}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Phone</span>
                            <span className="font-medium text-foreground">{record.customer.phone || "Not set"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Related deleted jobs</span>
                            <span className="font-medium text-foreground">{relatedDeletedJobs}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
