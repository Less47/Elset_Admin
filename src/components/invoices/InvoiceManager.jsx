import { useDeferredValue, useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateInvoiceTotal, money } from "@/lib/quote-template";

const invoiceTimeRangeOptions = [
  { value: "all-time", label: "All time" },
  { value: "last-30", label: "Past month" },
  { value: "last-7", label: "Past week" },
  { value: "last-365", label: "Past year" },
];

export default function InvoiceManager({
  jobs,
  onOpenJob,
  onOpenInvoice,
  onOpenSentInvoice,
  onUpdateInvoicePayment,
  formatDate,
  getInvoicePaymentSummary,
  getInvoiceStatus,
  normalizeDocument,
  toTimestamp,
}) {
  const [search, setSearch] = useState("");
  const [timeRange, setTimeRange] = useState("all-time");
  const [filterBy, setFilterBy] = useState("all");
  const [sortBy, setSortBy] = useState("status");
  const [filterClock] = useState(() => ({ now: Date.now() }));
  const deferredSearch = useDeferredValue(search);

  const invoiceRows = useMemo(() => {
    return jobs
      .map((job) => {
        const invoice = normalizeDocument("invoice", job.invoice);
        const invoiceStatus = getInvoiceStatus({ ...job, invoice });
        const total = invoice ? calculateInvoiceTotal(invoice.items) : 0;
        const paymentSummary = getInvoicePaymentSummary(invoice);
        return {
          job,
          invoice,
          invoiceStatus,
          total,
          paymentSummary,
          outstanding: invoice ? paymentSummary.balanceAmount : 0,
        };
      });
  }, [getInvoicePaymentSummary, getInvoiceStatus, jobs, normalizeDocument]);

  const rangedRows = useMemo(() => {
    return invoiceRows.filter((row) => {
      const referenceTimestamp = toTimestamp(row.invoice?.issueDate || row.job.createdAt);

      if (timeRange === "last-7") {
        return referenceTimestamp >= filterClock.now - 1000 * 60 * 60 * 24 * 7;
      }

      if (timeRange === "last-30") {
        return referenceTimestamp >= filterClock.now - 1000 * 60 * 60 * 24 * 30;
      }

      if (timeRange === "last-365") {
        return referenceTimestamp >= filterClock.now - 1000 * 60 * 60 * 24 * 365;
      }

      return true;
    });
  }, [filterClock.now, invoiceRows, timeRange, toTimestamp]);

  const invoiceStats = useMemo(() => {
    return rangedRows.reduce((stats, row) => ({
      totalRows: stats.totalRows + 1,
      invoiced: stats.invoiced + (row.invoice ? 1 : 0),
      paid: stats.paid + (row.invoiceStatus.id === "paid" ? 1 : 0),
      overdue: stats.overdue + (row.invoiceStatus.id === "overdue" ? 1 : 0),
      notInvoiced: stats.notInvoiced + (row.invoiceStatus.id === "not-invoiced" ? 1 : 0),
      totalValue: stats.totalValue + row.total,
      outstandingValue: stats.outstandingValue + row.outstanding,
      receivedValue: stats.receivedValue + row.paymentSummary.paidAmount,
    }), {
      totalRows: 0,
      invoiced: 0,
      paid: 0,
      overdue: 0,
      notInvoiced: 0,
      totalValue: 0,
      outstandingValue: 0,
      receivedValue: 0,
    });
  }, [rangedRows]);

  const filteredRows = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const rows = rangedRows.filter((row) => {
      const paymentSearchText = (row.invoice?.payments || [])
        .map((payment) => [payment.amount, payment.date, payment.method, payment.reference, payment.notes].join(" "))
        .join(" ");
      const matchesSearch = query
        ? [
            row.job.jobNumber,
            row.job.customerName,
            row.job.title,
            row.job.jobAddress,
            row.job.ocNumber,
            row.job.customerEmail,
            row.invoice?.issueDate,
            row.invoice?.dueDate,
            row.invoice?.paymentNotes,
            paymentSearchText,
          ].join(" ").toLowerCase().includes(query)
        : true;

      const matchesFilter =
        filterBy === "all"
          ? true
          : filterBy === "outstanding"
            ? Boolean(row.invoice) && row.paymentSummary.balanceAmount > 0
            : row.invoiceStatus.id === filterBy;

      return matchesSearch && matchesFilter;
    });

    rows.sort((a, b) => {
      if (sortBy === "due-date") return toTimestamp(a.invoice?.dueDate) - toTimestamp(b.invoice?.dueDate);
      if (sortBy === "value-high") return b.total - a.total;
      if (sortBy === "customer") return a.job.customerName.localeCompare(b.job.customerName);
      if (sortBy === "job-number") return (b.job.jobNumber || 0) - (a.job.jobNumber || 0);
      return a.invoiceStatus.rank - b.invoiceStatus.rank || toTimestamp(a.invoice?.dueDate) - toTimestamp(b.invoice?.dueDate);
    });

    return rows;
  }, [deferredSearch, filterBy, rangedRows, sortBy, toTimestamp]);

  return (
    <Card className="data-card gap-0 overflow-hidden rounded-xl border-slate-300 shadow-none">
      <CardHeader className="data-card-header space-y-4 border-b border-slate-200 bg-slate-50 px-5 py-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle className="text-lg">Invoices & Payments</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Review every job here so you can raise invoices for deposits, progress claims, or final payment at any stage.
            </p>
          </div>
          <div className="text-sm text-slate-600">
            Showing <span className="font-semibold text-slate-900">{filteredRows.length}</span> of {invoiceStats.totalRows} billing records
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.45fr)_200px_200px_220px_auto]">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
            <Input
              className="data-toolbar-field rounded-lg border-slate-300 bg-white"
              placeholder="Search invoice, customer, job, email, or address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Time range</p>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {invoiceTimeRangeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status filter</p>
            <Select value={filterBy} onValueChange={setFilterBy}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                <SelectItem value="outstanding">Outstanding</SelectItem>
                <SelectItem value="not-invoiced">Not invoiced</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="deposit-paid">Deposit paid</SelectItem>
                <SelectItem value="partially-paid">Partially paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="status">Needs attention</SelectItem>
                <SelectItem value="due-date">Due date</SelectItem>
                <SelectItem value="value-high">Highest value</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="job-number">Newest job number</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              className="data-toolbar-button w-full rounded-lg border-slate-300 bg-white 2xl:w-auto"
              onClick={() => {
                setSearch("");
                setTimeRange("all-time");
                setFilterBy("all");
                setSortBy("status");
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </CardHeader>

      <div className="data-stat-grid grid gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-6">
        {[
          { label: "Invoices", value: invoiceStats.invoiced },
          { label: "Not invoiced", value: invoiceStats.notInvoiced },
          { label: "Overdue", value: invoiceStats.overdue },
          { label: "Total", value: money(invoiceStats.totalValue) },
          { label: "Outstanding", value: money(invoiceStats.outstandingValue) },
          { label: "Received", value: money(invoiceStats.receivedValue) },
        ].map((stat) => (
          <div key={stat.label} className="data-stat-card bg-white px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{stat.value}</p>
          </div>
        ))}
      </div>

      <CardContent className="p-0">
        {filteredRows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No billing records found" text="Try adjusting the search or filters." />
          </div>
        ) : (
          <>
            <div className="text-xs 2xl:hidden">
              <div className="data-grid grid gap-px bg-slate-200">
                <div className="data-grid-header grid grid-cols-[minmax(0,1.25fr)_112px_128px_150px] gap-px bg-slate-200 font-semibold uppercase tracking-[0.12em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-3 [&>*]:py-2">
                  <span>Job</span>
                  <span>Invoice</span>
                  <span>Payment</span>
                  <span className="text-right">Actions</span>
                </div>

                {filteredRows.map((row) => (
                  <div
                    key={row.job.id}
                    className="data-grid-row grid grid-cols-[minmax(0,1.25fr)_112px_128px_150px] gap-px bg-slate-200 transition [&>*]:bg-white [&>*]:px-3 [&>*]:py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Job #{row.job.jobNumber}</p>
                      <p className="truncate font-semibold text-slate-950">{row.job.customerName}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{row.job.title}</p>
                      {row.job.ocNumber ? <p className="mt-0.5 truncate text-[11px] text-slate-500">OC {row.job.ocNumber}</p> : null}
                    </div>

                    <div className="min-w-0 text-slate-700">
                      <Badge className={`${row.invoiceStatus.className} px-1.5 py-0 text-[10px]`}>{row.invoiceStatus.label}</Badge>
                      <p className="mt-1 truncate text-[11px]">Issued {row.invoice ? formatDate(row.invoice.issueDate) : "Not set"}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{row.invoice ? money(row.total) : money(0)}</p>
                    </div>

                    <div className="min-w-0 text-slate-700">
                      <p className="truncate font-medium text-slate-900">Bal {row.invoice ? money(row.paymentSummary.balanceAmount) : money(0)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">Paid {row.invoice ? money(row.paymentSummary.paidAmount) : money(0)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{row.paymentSummary.paymentCount} payments</p>
                    </div>

                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="outline" size="sm" className="h-7 rounded-md border-slate-300 px-2 text-[11px]" onClick={() => onOpenJob(row.job)}>
                        Job
                      </Button>
                      {row.invoice?.sentHistory?.length && onOpenSentInvoice ? (
                        <Button variant="outline" size="sm" className="h-7 rounded-md border-slate-300 px-2 text-[11px]" onClick={() => onOpenSentInvoice(row.job)}>
                          Open
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" className="h-7 rounded-md border-slate-300 px-2 text-[11px]" onClick={() => onOpenInvoice(row.job)}>
                        {row.invoice ? "Editor" : "Create"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden overflow-x-auto 2xl:block">
            <div className="min-w-[1540px]">
              <div className="data-grid grid gap-px bg-slate-200">
                <div className="data-grid-header grid grid-cols-[110px_1.35fr_1.35fr_130px_130px_130px_130px_230px_260px] gap-px bg-slate-200 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-5 [&>*]:py-3">
                  <span>Job</span>
                  <span>Customer</span>
                  <span>Work</span>
                  <span>Issued</span>
                  <span>Due</span>
                  <span className="text-right">Total</span>
                  <span>Status</span>
                  <span>Payment</span>
                  <span className="text-right">Actions</span>
                </div>

                {filteredRows.map((row) => (
                  <div
                    key={row.job.id}
                    className="data-grid-row grid grid-cols-[110px_1.35fr_1.35fr_130px_130px_130px_130px_230px_260px] gap-px bg-slate-200 text-sm transition [&>*]:bg-white [&>*]:px-5 [&>*]:py-3"
                  >
                    <p className="font-semibold text-slate-950">#{row.job.jobNumber}</p>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{row.job.customerName}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{row.job.customerEmail || "No email saved"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-slate-800">{row.job.title}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{row.job.jobAddress || "No address"}</p>
                      {row.job.ocNumber ? <p className="mt-1 truncate text-xs text-slate-500">OC {row.job.ocNumber}</p> : null}
                    </div>
                    <p className="text-slate-700">{row.invoice ? formatDate(row.invoice.issueDate) : "Not set"}</p>
                    <div>
                      {row.invoice ? (
                        <Input
                          type="date"
                          className="data-toolbar-field h-8 rounded-md border-slate-300 bg-white"
                          value={row.invoice.dueDate || ""}
                          onChange={(e) => onUpdateInvoicePayment(row.job.id, { dueDate: e.target.value })}
                        />
                      ) : (
                        <span className="text-slate-500">Not set</span>
                      )}
                    </div>
                    <p className="text-right font-semibold text-slate-950">{row.invoice ? money(row.total) : money(0)}</p>
                    <div>
                      <Badge className={row.invoiceStatus.className}>{row.invoiceStatus.label}</Badge>
                    </div>
                    <div>
                      {row.invoice ? (
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">
                            Paid {money(row.paymentSummary.paidAmount)} of {money(row.total)}
                          </p>
                          <p className="text-xs text-slate-500">Balance {money(row.paymentSummary.balanceAmount)}</p>
                          {row.paymentSummary.paymentCount > 0 ? (
                            <p className="text-xs text-slate-500">
                              {row.paymentSummary.paymentCount} {row.paymentSummary.paymentCount === 1 ? "payment" : "payments"}
                              {row.paymentSummary.lastPaymentDate ? ` - ${formatDate(row.paymentSummary.lastPaymentDate)}` : ""}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500">No payments logged</p>
                          )}
                        </div>
                    ) : (
                      <span className="text-slate-500">No invoice</span>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" className="rounded-md border-slate-300" onClick={() => onOpenJob(row.job)}>
                      Job
                    </Button>
                    {row.invoice?.sentHistory?.length && onOpenSentInvoice ? (
                      <Button variant="outline" size="sm" className="rounded-md border-slate-300" onClick={() => onOpenSentInvoice(row.job)}>
                        Open Invoice
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" className="rounded-md border-slate-300" onClick={() => onOpenInvoice(row.job)}>
                      {row.invoice ? "Open Invoice Editor" : "Create Invoice"}
                    </Button>
                  </div>
                </div>
                ))}
              </div>
            </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
