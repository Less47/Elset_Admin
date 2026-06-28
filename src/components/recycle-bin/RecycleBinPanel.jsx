import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function RecycleBinPanel({
  deletedJobs,
  deletedCustomers,
  onRestoreJob,
  onRestoreCustomer,
  onEmptyDeletedJobs,
  onEmptyDeletedCustomers,
  formatDate,
  getRecycleBinExpiryDate,
  toTimestamp,
}) {
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
        <div className="floating-page-toolbar flex items-center px-5 py-4">
          <TabsList className="grid w-full max-w-[360px] grid-cols-2 rounded-xl bg-white/90">
            <TabsTrigger value="jobs">Deleted Jobs</TabsTrigger>
            <TabsTrigger value="customers">Deleted Customers</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="jobs">
          <Card className="rounded-3xl border-slate-200">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Deleted Jobs</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Restore a job before its recycle-bin expiry date.</p>
              </div>
              <Button
                variant="outline"
                className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
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
                    <div key={`${record.job.id}-${record.deletedAt}`} className="rounded-2xl border bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job #{record.job.jobNumber}</p>
                          <p className="font-semibold text-slate-900">{record.job.title}</p>
                          <p className="mt-1 text-sm text-slate-600">{record.job.customerName}</p>
                        </div>
                        <Button className="rounded-xl" onClick={() => onRestoreJob(record.job.id)}>
                          <RotateCcw className="mr-2 h-4 w-4" /> Restore Job
                        </Button>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                        <div className="flex items-center justify-between gap-3">
                          <span>Deleted</span>
                          <span className="font-medium text-slate-900">{formatDate(record.deletedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Auto delete</span>
                          <span className="font-medium text-slate-900">{formatDate(getRecycleBinExpiryDate(record.deletedAt))}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Status</span>
                          <span className="font-medium text-slate-900">{record.job.status}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Documents</span>
                          <span className="font-medium text-slate-900">
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

        <TabsContent value="customers">
          <Card className="rounded-3xl border-slate-200">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Deleted Customers</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Restore a customer record before it expires from the recycle bin.</p>
              </div>
              <Button
                variant="outline"
                className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
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
                      <div key={`${record.customer.id}-${record.deletedAt}`} className="rounded-2xl border bg-white p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-slate-900">{record.customer.name}</p>
                            <p className="mt-1 text-sm text-slate-600">{record.customer.email || "No email saved"}</p>
                          </div>
                          <Button className="rounded-xl" onClick={() => onRestoreCustomer(record.customer.id)}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Restore Customer
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                          <div className="flex items-center justify-between gap-3">
                            <span>Deleted</span>
                            <span className="font-medium text-slate-900">{formatDate(record.deletedAt)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Auto delete</span>
                            <span className="font-medium text-slate-900">{formatDate(getRecycleBinExpiryDate(record.deletedAt))}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Phone</span>
                            <span className="font-medium text-slate-900">{record.customer.phone || "Not set"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Related deleted jobs</span>
                            <span className="font-medium text-slate-900">{relatedDeletedJobs}</span>
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
