import { useDeferredValue, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  MobileRecordActions,
  MobileRecordBody,
  MobileRecordCard,
  MobileRecordHeader,
  MobileRecordList,
  MobileRecordStat,
  MobileRecordStats,
} from "@/components/shared/MobileRecordList";
import { useMobileRecordLayout } from "@/hooks/useMobileRecordLayout";
import {
  CompactSortControl,
  DesktopControlField,
  DesktopPageControls,
  FilterButton,
  FilterSheetField,
  MobileFilterSheet,
  PageSearchField,
  ResponsivePageControls,
  ResultSummary,
} from "@/components/shared/ResponsivePageControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateInvoiceTotal, money } from "@/lib/quote-template";
import { statuses } from "@/lib/job-status";
import { matchesInvoiceJobStatus } from "@/lib/invoice-filters";

const invoiceTimeRangeOptions = [
  { value: "all-time", label: "All time" },
  { value: "last-30", label: "Past month" },
  { value: "last-7", label: "Past week" },
  { value: "last-365", label: "Past year" },
];
const invoiceSortOptions = [
  { value: "status", label: "Attention" },
  { value: "due-date", label: "Due date" },
  { value: "value-high", label: "Highest value" },
  { value: "customer", label: "Customer" },
  { value: "job-number", label: "Newest job" },
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
  const [jobStatusFilter, setJobStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("status");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterClock] = useState(() => ({ now: Date.now() }));
  const filterTriggerRef = useRef(null);
  const deferredSearch = useDeferredValue(search);
  const mobileRecordLayout = useMobileRecordLayout();

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

      return matchesSearch && matchesFilter && matchesInvoiceJobStatus(row, jobStatusFilter);
    });

    rows.sort((a, b) => {
      if (sortBy === "due-date") return toTimestamp(a.invoice?.dueDate) - toTimestamp(b.invoice?.dueDate);
      if (sortBy === "value-high") return b.total - a.total;
      if (sortBy === "customer") return a.job.customerName.localeCompare(b.job.customerName);
      if (sortBy === "job-number") return (b.job.jobNumber || 0) - (a.job.jobNumber || 0);
      return a.invoiceStatus.rank - b.invoiceStatus.rank || toTimestamp(a.invoice?.dueDate) - toTimestamp(b.invoice?.dueDate);
    });

    return rows;
  }, [deferredSearch, filterBy, jobStatusFilter, rangedRows, sortBy, toTimestamp]);
  const activeFilterCount = [timeRange !== "all-time", filterBy !== "all", jobStatusFilter !== "all"].filter(Boolean).length;
  const visibleInvoiceCount = filteredRows.filter((row) => row.invoice).length;

  return (
    <>
    <div className="space-y-4">
      <ResponsivePageControls
        search={(
          <PageSearchField value={search} onChange={setSearch} placeholder="Search invoices..." label="Search invoices" />
        )}
        controls={(
          <>
            <FilterButton ref={filterTriggerRef} activeCount={activeFilterCount} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
            <CompactSortControl value={sortBy} onValueChange={setSortBy} options={invoiceSortOptions} label="Sort invoices" />
          </>
        )}
        summary={(
          <ResultSummary>
            {visibleInvoiceCount} {visibleInvoiceCount === 1 ? "invoice" : "invoices"} · {filteredRows.length} billing {filteredRows.length === 1 ? "record" : "records"}
          </ResultSummary>
        )}
      />

      <DesktopPageControls
        search={(
          <DesktopControlField label="Search" size="search" className="flex-[1_1_12rem]">
            <PageSearchField compact value={search} onChange={setSearch} placeholder="Search billing records..." label="Search billing records" />
          </DesktopControlField>
        )}
        filters={(
          <>
          <DesktopControlField htmlFor="desktop-invoice-time-range" label="Time range" size="small">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger id="desktop-invoice-time-range" className="data-toolbar-field rounded-lg border-border bg-card">
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
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-invoice-status-filter" label="Status filter" size="medium">
            <Select value={filterBy} onValueChange={setFilterBy}>
              <SelectTrigger id="desktop-invoice-status-filter" className="data-toolbar-field rounded-lg border-border bg-card">
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
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-invoice-job-status" label="Job Status" size="large">
            <Select value={jobStatusFilter} onValueChange={setJobStatusFilter}>
              <SelectTrigger id="desktop-invoice-job-status" className="data-toolbar-field rounded-lg border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Job Statuses</SelectItem>
                {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
              </SelectContent>
            </Select>
          </DesktopControlField>

          <DesktopControlField htmlFor="desktop-invoice-sort" label="Sort by" size="medium">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger id="desktop-invoice-sort" className="data-toolbar-field rounded-lg border-border bg-card">
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
          </DesktopControlField>
          </>
        )}
      />

      <Card
        className={mobileRecordLayout
          ? "gap-0 overflow-visible rounded-none border-0 bg-transparent py-0 shadow-none"
          : "data-card gap-0 overflow-hidden rounded-xl border-border shadow-none"}
        data-mobile-record-results-shell={mobileRecordLayout ? "" : undefined}
      >
      <div className="data-stat-grid hidden gap-px border-b border-border bg-surface-selected xl:grid xl:grid-cols-6">
        {[
          { label: "Invoices", value: invoiceStats.invoiced },
          { label: "Not invoiced", value: invoiceStats.notInvoiced },
          { label: "Overdue", value: invoiceStats.overdue },
          { label: "Total", value: money(invoiceStats.totalValue) },
          { label: "Outstanding", value: money(invoiceStats.outstandingValue) },
          { label: "Received", value: money(invoiceStats.receivedValue) },
        ].map((stat) => (
          <div key={stat.label} className="data-stat-card bg-card px-panel py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      <CardContent className="p-0">
        {mobileRecordLayout ? (
          filteredRows.length === 0 ? (
            <div className="p-panel">
              <EmptyState title="No billing records found" text="Try adjusting the search or filters." />
            </div>
          ) : (
            <MobileRecordList label="Invoice records">
              {filteredRows.map((row) => {
                const headingId = `mobile-invoice-${encodeURIComponent(row.job.id)}-title`;

                return (
                  <MobileRecordCard key={row.job.id} labelledBy={headingId} recordId={row.job.id}>
                    <MobileRecordHeader>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Job #{row.job.jobNumber}</p>
                        <h3 id={headingId} className="mt-0.5 line-clamp-2 font-semibold leading-5 text-foreground">{row.job.customerName}</h3>
                      </div>
                      <Badge className={`${row.invoiceStatus.className} max-w-[9rem]`}>{row.invoiceStatus.label}</Badge>
                    </MobileRecordHeader>

                    <MobileRecordBody>
                      <p className="line-clamp-2 font-medium text-foreground">{row.job.title}</p>
                      {row.job.jobAddress ? <p className="line-clamp-2">{row.job.jobAddress}</p> : null}
                      {row.job.ocNumber ? <p className="line-clamp-1 text-xs">Client ref {row.job.ocNumber}</p> : null}
                      {row.invoice ? (
                        <p className="text-xs">
                          Issued {formatDate(row.invoice.issueDate)}
                          {row.invoice.dueDate ? ` · Due ${formatDate(row.invoice.dueDate)}` : ""}
                        </p>
                      ) : null}
                    </MobileRecordBody>

                    <MobileRecordStats>
                      <MobileRecordStat label="Total">{row.invoice ? money(row.total) : money(0)}</MobileRecordStat>
                      <MobileRecordStat label="Payment">
                        {row.invoice ? (
                          <>
                            <span className="block">Paid {money(row.paymentSummary.paidAmount)}</span>
                            <span className="block text-xs font-medium text-muted-foreground">Balance {money(row.paymentSummary.balanceAmount)}</span>
                          </>
                        ) : "No invoice"}
                      </MobileRecordStat>
                    </MobileRecordStats>

                    <MobileRecordActions>
                      <Button variant="outline" aria-label={`Open Job #${row.job.jobNumber}`} onClick={() => onOpenJob(row.job)}>
                        Job
                      </Button>
                      {row.invoice?.sentHistory?.length && onOpenSentInvoice ? (
                        <Button variant="outline" aria-label={`Open sent invoice for Job #${row.job.jobNumber}`} onClick={() => onOpenSentInvoice(row.job)}>
                          Open Invoice
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        aria-label={`${row.invoice ? "Open invoice editor" : "Create invoice"} for Job #${row.job.jobNumber}`}
                        onClick={() => onOpenInvoice(row.job)}
                      >
                        {row.invoice ? "Open Invoice Editor" : "Create Invoice"}
                      </Button>
                    </MobileRecordActions>
                  </MobileRecordCard>
                );
              })}
            </MobileRecordList>
          )
        ) : (
          <div data-desktop-record-results>
          {filteredRows.length === 0 ? (
            <div className="p-panel">
              <EmptyState title="No billing records found" text="Try adjusting the search or filters." />
            </div>
          ) : (
            <>
            <div className="overflow-x-auto text-xs 2xl:hidden">
              <div className="data-grid grid min-w-[560px] gap-px bg-surface-selected md:min-w-0">
                <div className="data-grid-header grid grid-cols-[minmax(0,1.25fr)_112px_128px_150px] gap-px bg-surface-selected font-semibold uppercase tracking-[0.12em] text-muted-foreground [&>*]:bg-surface-raised">
                  <span>Job</span>
                  <span>Invoice</span>
                  <span>Payment</span>
                  <span className="text-right">Actions</span>
                </div>

                {filteredRows.map((row) => (
                  <div
                    key={row.job.id}
                    className="data-grid-row grid grid-cols-[minmax(0,1.25fr)_112px_128px_150px] gap-px bg-surface-selected transition [&>*]:bg-card"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Job #{row.job.jobNumber}</p>
                      <p className="truncate font-semibold text-foreground">{row.job.customerName}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.job.title}</p>
                      {row.job.ocNumber ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Client ref {row.job.ocNumber}</p> : null}
                    </div>

                    <div className="min-w-0 text-text-secondary">
                      <Badge className={`${row.invoiceStatus.className} px-1.5 py-0 text-[10px]`}>{row.invoiceStatus.label}</Badge>
                      <p className="mt-1 truncate text-[11px]">Issued {row.invoice ? formatDate(row.invoice.issueDate) : "Not set"}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.invoice ? money(row.total) : money(0)}</p>
                    </div>

                    <div className="min-w-0 text-text-secondary">
                      <p className="truncate font-medium text-foreground">Bal {row.invoice ? money(row.paymentSummary.balanceAmount) : money(0)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Paid {row.invoice ? money(row.paymentSummary.paidAmount) : money(0)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.paymentSummary.paymentCount} payments</p>
                    </div>

                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="outline" size="sm" className="h-7 rounded-md border-border px-2 text-[11px]" onClick={() => onOpenJob(row.job)}>
                        Job
                      </Button>
                      {row.invoice?.sentHistory?.length && onOpenSentInvoice ? (
                        <Button variant="outline" size="sm" className="h-7 rounded-md border-border px-2 text-[11px]" onClick={() => onOpenSentInvoice(row.job)}>
                          Open
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" className="h-7 rounded-md border-border px-2 text-[11px]" onClick={() => onOpenInvoice(row.job)}>
                        {row.invoice ? "Editor" : "Create"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden overflow-x-auto 2xl:block">
            <div className="min-w-[1540px]">
              <div className="data-grid grid gap-px bg-surface-selected">
                <div className="data-grid-header grid grid-cols-[110px_1.35fr_1.35fr_130px_130px_130px_130px_230px_260px] gap-px bg-surface-selected text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground [&>*]:bg-surface-raised">
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
                    className="data-grid-row grid grid-cols-[110px_1.35fr_1.35fr_130px_130px_130px_130px_230px_260px] gap-px bg-surface-selected text-sm transition [&>*]:bg-card"
                  >
                    <p className="font-semibold text-foreground">#{row.job.jobNumber}</p>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{row.job.customerName}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{row.job.customerEmail || "No email saved"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{row.job.title}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{row.job.jobAddress || "No address"}</p>
                      {row.job.ocNumber ? <p className="mt-1 truncate text-xs text-muted-foreground">Client ref {row.job.ocNumber}</p> : null}
                    </div>
                    <p className="text-text-secondary">{row.invoice ? formatDate(row.invoice.issueDate) : "Not set"}</p>
                    <div>
                      {row.invoice ? (
                        <Input
                          type="date"
                          className="data-toolbar-field h-8 rounded-md border-border bg-card"
                          value={row.invoice.dueDate || ""}
                          onChange={(e) => onUpdateInvoicePayment(row.job.id, { dueDate: e.target.value })}
                        />
                      ) : (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </div>
                    <p className="text-right font-semibold text-foreground">{row.invoice ? money(row.total) : money(0)}</p>
                    <div>
                      <Badge className={row.invoiceStatus.className}>{row.invoiceStatus.label}</Badge>
                    </div>
                    <div>
                      {row.invoice ? (
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            Paid {money(row.paymentSummary.paidAmount)} of {money(row.total)}
                          </p>
                          <p className="text-xs text-muted-foreground">Balance {money(row.paymentSummary.balanceAmount)}</p>
                          {row.paymentSummary.paymentCount > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {row.paymentSummary.paymentCount} {row.paymentSummary.paymentCount === 1 ? "payment" : "payments"}
                              {row.paymentSummary.lastPaymentDate ? ` - ${formatDate(row.paymentSummary.lastPaymentDate)}` : ""}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">No payments logged</p>
                          )}
                        </div>
                    ) : (
                      <span className="text-muted-foreground">No invoice</span>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" className="rounded-md border-border" onClick={() => onOpenJob(row.job)}>
                      Job
                    </Button>
                    {row.invoice?.sentHistory?.length && onOpenSentInvoice ? (
                      <Button variant="outline" size="sm" className="rounded-md border-border" onClick={() => onOpenSentInvoice(row.job)}>
                        Open Invoice
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" className="rounded-md border-border" onClick={() => onOpenInvoice(row.job)}>
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
          </div>
        )}
      </CardContent>
      </Card>
    </div>
    <MobileFilterSheet
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      returnFocusRef={filterTriggerRef}
      activeCount={activeFilterCount}
      description="Filter billing records by time range, payment status, and job status."
      onReset={() => {
        setTimeRange("all-time");
        setFilterBy("all");
        setJobStatusFilter("all");
      }}
    >
      <FilterSheetField id="mobile-invoice-time-range" label="Time range">
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger id="mobile-invoice-time-range" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            {invoiceTimeRangeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-invoice-status-filter" label="Status filter">
        <Select value={filterBy} onValueChange={setFilterBy}>
          <SelectTrigger id="mobile-invoice-status-filter" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
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
      </FilterSheetField>
      <FilterSheetField id="mobile-invoice-job-status" label="Job Status">
        <Select value={jobStatusFilter} onValueChange={setJobStatusFilter}>
          <SelectTrigger id="mobile-invoice-job-status" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Job Statuses</SelectItem>
            {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
    </MobileFilterSheet>
    </>
  );
}
