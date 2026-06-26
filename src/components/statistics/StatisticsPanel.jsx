import { useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { statuses } from "@/lib/job-status";
import { calculateInvoiceTotal, calculateQuoteTotal, money } from "@/lib/quote-template";

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export default function StatisticsPanel({
  dashboard,
  jobs,
  customers,
  staff,
  inventoryItems = [],
  getInventoryStockStatus,
  normalizeInventoryRecord,
}) {
  const [statisticsClock] = useState(() => Date.now());

  const averages = useMemo(() => {
    if (jobs.length === 0) {
      return {
        valuePerMonth: 0,
        valuePerWeek: 0,
        valuePerJob: 0,
        activeSinceLabel: null,
      };
    }

    const jobTimestamps = jobs
      .map((job) => new Date(job.createdAt || job.updatedAt || 0).getTime())
      .filter((timestamp) => timestamp > 0);
    const firstRecordedAt = jobTimestamps.length > 0 ? Math.min(...jobTimestamps) : statisticsClock;
    const activeDays = Math.max(1, (statisticsClock - firstRecordedAt) / DAY_IN_MS);
    const activeWeeks = Math.max(1, activeDays / 7);
    const activeMonths = Math.max(1, activeDays / 30.4375);
    const totalTrackedValue = jobs.reduce((sum, job) => {
      if (job.invoice) return sum + calculateInvoiceTotal(job.invoice.items);
      if (job.quote) return sum + calculateQuoteTotal(job.quote.items);
      return sum;
    }, 0);

    return {
      valuePerMonth: totalTrackedValue / activeMonths,
      valuePerWeek: totalTrackedValue / activeWeeks,
      valuePerJob: totalTrackedValue / jobs.length,
      activeSinceLabel: new Date(firstRecordedAt).toLocaleDateString(),
    };
  }, [jobs, statisticsClock]);

  const statusSummary = statuses.map((status) => {
    const count = jobs.filter((job) => job.status === status).length;
    const share = dashboard.totalJobs === 0 ? 0 : Math.round((count / dashboard.totalJobs) * 100);
    return { status, count, share };
  });

  const technicianSummary = staff.map((technician) => {
    const assignedJobs = jobs.filter((job) => job.assignedTechnicianId === technician.id);
    return {
      ...technician,
      totalJobs: assignedJobs.length,
      openJobs: assignedJobs.filter((job) => job.status !== "Completed").length,
      completedJobs: assignedJobs.filter((job) => job.status === "Completed").length,
    };
  });

  const lowStockParts = inventoryItems
    .map(normalizeInventoryRecord)
    .filter(Boolean)
    .filter((part) => {
      const status = getInventoryStockStatus(part);
      return status.id === "low" || status.id === "out";
    });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-3xl border-slate-200">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Customer Records</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{customers.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-slate-200">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Open Jobs</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{dashboard.openJobs}</p>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-slate-200">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Completed Jobs</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{dashboard.completedJobs}</p>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-slate-200">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Documents Saved</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{dashboard.quotesCount + dashboard.invoicesCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-slate-200">
        <CardHeader>
          <CardTitle className="text-lg">Averages</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-4">
            <p className="text-sm text-muted-foreground">Monthly Average</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{money(averages.valuePerMonth)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {averages.activeSinceLabel ? `Average tracked value per month since ${averages.activeSinceLabel}.` : "No jobs recorded yet."}
            </p>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-4">
            <p className="text-sm text-muted-foreground">Weekly Average</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{money(averages.valuePerWeek)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Average tracked value per week across the current job history.
            </p>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-4">
            <p className="text-sm text-muted-foreground">Average Value Per Job</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{money(averages.valuePerJob)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Uses invoice totals first, then quote totals when no invoice exists.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-3xl border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg">Job Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusSummary.map(({ status, count, share }) => (
              <div key={status} className="grid gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-900">{status}</span>
                  <span className="text-muted-foreground">{count} jobs - {share}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-900 transition-all" style={{ width: `${share}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg">Financial Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Quotes prepared</span>
              <span className="font-medium text-slate-900">{dashboard.quotesCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Quote value</span>
              <span className="font-medium text-slate-900">{money(dashboard.quotesValue)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>Invoices prepared</span>
              <span className="font-medium text-slate-900">{dashboard.invoicesCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Invoice value</span>
              <span className="font-medium text-slate-900">{money(dashboard.invoicesValue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Outstanding invoices</span>
              <span className="font-medium text-slate-900">{money(dashboard.outstandingInvoiceValue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Overdue invoices</span>
              <span className="font-medium text-slate-900">{dashboard.overdueInvoices}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Completed not invoiced</span>
              <span className="font-medium text-slate-900">{dashboard.notInvoicedCompleted}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>High urgency jobs</span>
              <span className="font-medium text-slate-900">{dashboard.highUrgency}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-slate-200">
        <CardHeader>
          <CardTitle className="text-lg">Inventory Snapshot</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-4">
            <p className="text-sm text-muted-foreground">Parts tracked</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.totalParts}</p>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-4">
            <p className="text-sm text-muted-foreground">Needs reorder</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.lowStockParts}</p>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-4">
            <p className="text-sm text-muted-foreground">Stock value</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{money(dashboard.inventoryValue)}</p>
          </div>
          {lowStockParts.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 md:col-span-3">
              <p className="text-sm font-semibold text-amber-900">Reorder soon</p>
              <p className="mt-2 text-sm text-amber-800">
                {lowStockParts.slice(0, 4).map((part) => part.name).join(", ")}
                {lowStockParts.length > 4 ? `, and ${lowStockParts.length - 4} more` : ""}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-slate-200">
        <CardHeader>
          <CardTitle className="text-lg">Staff Workload</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {technicianSummary.length === 0 ? (
            <EmptyState title="No staff records yet" text="Add staff members to track workload across the team." />
          ) : technicianSummary.map((technician) => (
            <div key={technician.id} className="rounded-2xl border bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{technician.name}</p>
                <Badge variant="secondary">{technician.totalJobs} assigned</Badge>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Open jobs</span>
                  <span className="font-medium text-slate-900">{technician.openJobs}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Completed jobs</span>
                  <span className="font-medium text-slate-900">{technician.completedJobs}</span>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
