import { createBlankDocumentLine } from "./price-list.js";

// Supply buildDefaultDoc(job, "invoice") so the normal document workflow owns
// date/payment defaults. Only commercial quote lines transfer.
export function buildInvoiceDraftFromQuote(quote, defaultInvoice) {
  return {
    ...defaultInvoice,
    items: Array.isArray(quote?.items) && quote.items.length
      ? quote.items.map((item) => ({ ...structuredClone(item), id: createBlankDocumentLine().id }))
      : defaultInvoice.items,
  };
}

export function invoiceConversionDraft(job, type, state) {
  const transfer = state?.quoteInvoiceDraft;
  if (type !== "invoice" || !job?.quote || job.invoice || transfer?.jobId !== job.id
    || transfer.document?.type !== "invoice" || !Array.isArray(transfer.document.items)) return null;
  return transfer.document;
}
