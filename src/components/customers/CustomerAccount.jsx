import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCustomerAccount } from "@/hooks/useCustomerAccount";
import { money } from "@/lib/quote-template";
import { formatDate } from "@/lib/app-support";

export default function CustomerAccount({ customerId, jobs, onOpenInvoice, onViewInvoices }) {
  const { summary, loading, error, retry } = useCustomerAccount(customerId, jobs);
  if (loading) return <p className="py-2 text-sm text-text-secondary" role="status">Loading account…</p>;
  if (error) return <div className="flex flex-wrap items-center justify-between gap-2 text-sm" role="alert">
    <span>Account balance unavailable.</span><Button variant="outline" size="sm" onClick={retry}>Retry</Button>
  </div>;
  const overdue = summary.overdueInvoiceCount > 0;
  const balanceColor = summary.outstandingCents > 0 ? "text-status-danger" : "text-status-success";
  return <div className="min-w-0" data-customer-account>
    <div className="customer-account-summary border-border bg-surface-raised">
      <dl className="customer-account-totals" aria-label="Lifetime account summary">
        <div><dt>Total invoiced</dt><dd data-account-total-invoiced>{money(summary.totalInvoicedCents / 100)}</dd></div>
        <div><dt>Total received</dt><dd data-account-total-received>{money(summary.totalReceivedCents / 100)}</dd></div>
        <div><dt>Outstanding</dt><dd className={balanceColor} data-account-balance>{money(summary.outstandingCents / 100)}</dd></div>
        <div><dt>Invoices</dt><dd data-account-invoice-count>{summary.invoiceCount.toLocaleString("en-AU")}</dd></div>
      </dl>
      <div className={`text-xs ${balanceColor}`}>
        <p>{summary.outstandingCents === 0 ? "Account up to date" : `${summary.openInvoiceCount} unpaid ${summary.openInvoiceCount === 1 ? "invoice" : "invoices"}${overdue ? ` · ${summary.overdueInvoiceCount} overdue` : ""}`}</p>
        {overdue ? <p className="mt-1 text-xs">Oldest overdue: {summary.oldestOverdueDays} {summary.oldestOverdueDays === 1 ? "day" : "days"}</p> : null}
      </div>
    </div>
    {summary.invoices.length > 0 ? <ul className="mt-2 divide-y divide-border" aria-label="Open invoices">
      {summary.invoices.map((invoice) => <li key={invoice.invoiceId}>
        <button type="button" className="customer-account-invoice" onClick={() => onOpenInvoice(invoice.jobId)} aria-label={`Open invoice ${invoice.invoiceNumber}`}>
          <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="font-semibold">{invoice.invoiceNumber}</span><Badge className={`${invoice.status.className} text-[11px]`}>{invoice.status.label}</Badge></span>
          <span className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-text-secondary"><span>Issued {invoice.issueDate ? formatDate(invoice.issueDate) : "date not set"}</span><span>{invoice.dueDate ? `Due ${formatDate(invoice.dueDate)}` : "No due date"}</span></span>
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="text-xs text-text-secondary">{money(invoice.totalCents / 100)} total · {money(invoice.paidCents / 100)} paid</span><span className="text-sm font-semibold tabular-nums">{money(invoice.balanceCents / 100)} outstanding</span></span>
        </button>
      </li>)}
    </ul> : null}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
      <span>{summary.hasMore ? `Showing ${summary.invoices.length} of ${summary.openInvoiceCount} open invoices` : "Issued invoices across all sites"}</span>
      <Button type="button" variant="link" size="sm" className="h-8 px-0" onClick={onViewInvoices}>View all invoices</Button>
    </div>
  </div>;
}
