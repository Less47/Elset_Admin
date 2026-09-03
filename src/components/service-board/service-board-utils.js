import { calculateInvoiceTotal, calculateQuoteTotal, money } from "@/lib/quote-template";

export const TOMORROW_VIEW = "__tomorrow__";

export function getMobileBoardPanelId(viewId) {
  return `mobile-board-panel-${viewId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function getMobileMoveButtonId(jobId) {
  return `mobile-move-job-${jobId}`;
}

export const serviceBoardSortOptions = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "urgency", label: "Urgency" },
  { value: "customer", label: "Customer" },
  { value: "scheduled", label: "Scheduled" },
  { value: "value", label: "Highest Value" },
];

export const serviceBoardIndicatorLegend = [
  { id: "quote", label: "Quote sent", dotClassName: "bg-cyan-500" },
  { id: "invoice-draft", label: "Invoice draft", dotClassName: "bg-orange-500" },
  { id: "invoice-pending", label: "Outstanding invoice", dotClassName: "bg-violet-500" },
  { id: "invoice-paid", label: "Invoice paid", dotClassName: "bg-emerald-500" },
  { id: "invoice-attention", label: "Invoice needs attention", dotClassName: "bg-rose-500" },
  { id: "manuals", label: "Supplier manual", dotClassName: "bg-indigo-500" },
  { id: "maintenance", label: "Maintenance", dotClassName: "bg-teal-500" },
  { id: "access", label: "Access notes", dotClassName: "bg-amber-500" },
];

export function getSiteAccessNotePreview(notes) {
  if (!notes) return "";

  return (
    String(notes)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

export function getJobValueMeta(job) {
  if (job?.invoice) {
    const total = calculateInvoiceTotal(job.invoice.items || []);
    return {
      label: "Invoice",
      amount: money(total),
      total,
    };
  }

  if (job?.quote) {
    const total = calculateQuoteTotal(job.quote.items || []);
    return {
      label: "Quote",
      amount: money(total),
      total,
    };
  }

  return null;
}

function toSortTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getUrgencyRank(urgency) {
  const ranks = { High: 0, Medium: 1, Low: 2 };
  return ranks[urgency] ?? 3;
}

function getJobValueAmount(job) {
  if (job?.invoice) return calculateInvoiceTotal(job.invoice.items || []);
  if (job?.quote) return calculateQuoteTotal(job.quote.items || []);
  return 0;
}

export function formatStreetAndSuburb(address) {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "Site not set";

  const street = parts[0];
  const suburbSource = parts[1] || parts[0];
  const suburb = suburbSource
    .replace(/\b(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\b/gi, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return suburb && suburb !== street ? `${street}, ${suburb}` : street;
}

export function sortJobsForColumn(jobs, sortMode = "recent") {
  return [...jobs].sort((a, b) => {
    if (sortMode === "oldest") {
      return toSortTimestamp(a.createdAt) - toSortTimestamp(b.createdAt) || (a.jobNumber || 0) - (b.jobNumber || 0);
    }

    if (sortMode === "urgency") {
      return getUrgencyRank(a.urgency) - getUrgencyRank(b.urgency)
        || toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    if (sortMode === "customer") {
      return a.customerName.localeCompare(b.customerName)
        || toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    if (sortMode === "scheduled") {
      const aScheduled = a.scheduledDate ? toSortTimestamp(a.scheduledDate) : Number.POSITIVE_INFINITY;
      const bScheduled = b.scheduledDate ? toSortTimestamp(b.scheduledDate) : Number.POSITIVE_INFINITY;
      return aScheduled - bScheduled
        || getUrgencyRank(a.urgency) - getUrgencyRank(b.urgency)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    if (sortMode === "value") {
      return getJobValueAmount(b) - getJobValueAmount(a)
        || toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
        || (b.jobNumber || 0) - (a.jobNumber || 0);
    }

    return toSortTimestamp(b.updatedAt) - toSortTimestamp(a.updatedAt)
      || (b.jobNumber || 0) - (a.jobNumber || 0);
  });
}

export function buildJobCardIndicators({ job, manualMatches, invoiceStatus, siteAccessPreview }) {
  const indicators = [];
  const quoteSent = Boolean(job.quote?.sentHistory?.length);
  const showInvoiceStatus = Boolean(job.invoice) || job.status === "Completed";

  if (quoteSent) {
    indicators.push({ id: "quote", label: "Quoted", dotClassName: "bg-cyan-500" });
  }

  if (showInvoiceStatus) {
    if (invoiceStatus.id === "paid") {
      indicators.push({ id: "invoice-paid", label: "Invoice Paid", dotClassName: "bg-emerald-500" });
    } else if (invoiceStatus.id === "draft") {
      indicators.push({ id: "invoice-draft", label: "Draft Invoice", dotClassName: "bg-orange-500" });
    } else if (invoiceStatus.id === "overdue" || invoiceStatus.id === "not-invoiced") {
      indicators.push({ id: "invoice-attention", label: invoiceStatus.label, dotClassName: "bg-rose-500" });
    } else {
      indicators.push({ id: "invoice-pending", label: invoiceStatus.label, dotClassName: "bg-violet-500" });
    }
  }

  if (manualMatches.length > 0) {
    indicators.push({
      id: "manuals",
      label: `${manualMatches.length} manual${manualMatches.length === 1 ? "" : "s"}`,
      dotClassName: "bg-indigo-500",
    });
  }

  if (job.maintenancePlanName) {
    indicators.push({ id: "maintenance", label: "Maintenance", dotClassName: "bg-teal-500" });
  }

  if (siteAccessPreview) {
    indicators.push({ id: "access", label: "Access Notes", dotClassName: "bg-amber-500" });
  }

  return indicators;
}
