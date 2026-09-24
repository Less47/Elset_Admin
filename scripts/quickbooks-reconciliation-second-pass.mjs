// TEMPORARY diagnostic only. No HTTP client, AccountingService instance or apply path.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openWorkspaceDb, assertWorkspaceSchema, getWorkspaceDbPath } from "../server-workspace-db.js";
import { readLocalHistory } from "./quickbooks-one-time-backfill.mjs";
import { analyzeReconciliation, normalizeInvoice, normalized, linkedAccounting, scaled, withoutSecrets } from "./quickbooks-reconciliation-core.mjs";

export const baselineTimestamp = "2026-09-22T02-55-18-968Z";
const baselineHashes = {
  report: "8a989517dc7aef728ecdd356b52a42d9ff27b7727dcd2f96eeebdc0e433f371b",
  archive: "bee66ef71d323a4f371165239f4d69dd50a92d648a52706fee5296668041ff34",
};
export const differenceFlags = ["CUSTOMER_DIFF", "DATE_DIFF", "DOC_NUMBER_DIFF", "LINE_COUNT_DIFF", "PRODUCT_SERVICE_DIFF", "DESCRIPTION_DIFF", "QTY_DIFF", "UNIT_PRICE_DIFF", "LINE_AMOUNT_DIFF", "SUBTOTAL_DIFF", "GST_DIFF", "TOTAL_DIFF", "BALANCE_DIFF", "PAYMENT_STATE_DIFF"];
export const discrepancyBuckets = ["COSMETIC_ONLY", "CONTENT_DIFF_NO_FINANCIAL_CHANGE", "FINANCIAL_DIFF", "CUSTOMER_OR_DATE_DIFF", "PAYMENT_ONLY_DIFF", "MULTIPLE_DIFF_TYPES"];
export const paymentBuckets = ["ELSET_PAID_QB_UNPAID", "ELSET_PARTIAL_QB_UNPAID", "QB_PAID_ELSET_UNPAID", "PAYMENT_AMOUNT_DIFF", "MATCHING_PAYMENT_STATE", "CREDIT_OR_OTHER_LINKED_TRANSACTION", "OTHER"];
const unique = values => [...new Set(values)];
const int = Number.isSafeInteger;
const countBy = (rows, key, keys) => Object.fromEntries((keys || unique(rows.map(row => row[key]))).map(value => [value, rows.filter(row => row[key] === value).length]));
const numberKey = value => String(value || "").match(/^(?:INV[- ]?)?0*(\d+)$/i)?.[1];
const sha = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const refs = invoice => (invoice.Line || []).filter(line => line.DetailType !== "SubTotalLineDetail");
const itemShapeEligible = item => item?.Active === true && ["Service", "NonInventory"].includes(item.Type) && Boolean(item.IncomeAccountRef?.value);
const unorderedBusinessKey = invoice => JSON.stringify([invoice.customerId, invoice.date, invoice.currency,
  invoice.lines.map(line => JSON.stringify(line)).sort(), invoice.subtotalCents, invoice.taxCents, invoice.totalCents]);

// Fold prose case only; retain model codes containing digits and case-sensitive units.
// Punctuation, spelling, numbers and word order are never discarded.
export function normalizeDescription(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").replace(/[A-Za-z0-9]+/g, word =>
    /\d/.test(word) || /^(mA|MA|mV|MV|mW|MW|mAh|Ah|kW|KW|kWh)$/.test(word) ? word : word.toLowerCase());
}
export function paymentState(total, paid) {
  if (!int(total) || !int(paid) || total <= 0 || paid < 0 || paid > total) return "UNKNOWN";
  return paid === 0 ? "UNPAID" : paid === total ? "PAID" : "PARTIAL";
}

export function expectedItem(line, { config, items, catalog, mappings, tenantId }) {
  const project = (itemId, status, reason) => {
    const item = items.find(row => row.Id === itemId);
    return { id: itemId || "", name: item?.FullyQualifiedName || item?.Name || "", incomeAccountId: item?.IncomeAccountRef?.value || "",
      status, reason, comparisonKnown: Boolean(itemId && itemShapeEligible(item)), accountEligibility: "NOT_REVALIDATED_ARCHIVE_HAS_NO_ACCOUNT_ENTITY" };
  };
  const fallback = reason => project(config.itemId, "FALLBACK", reason);
  if (!line.priceListItemId) return fallback("Saved line has no priceListItemId; the new model uses the configured fallback.");
  const mapping = mappings.find(row => row.provider === "quickbooks" && row.external_tenant_id === tenantId && row.local_entity_type === "price-list-item" && row.local_entity_id === line.priceListItemId);
  if (mapping) {
    const item = items.find(row => row.Id === mapping.external_entity_id);
    return itemShapeEligible(item) ? project(item.Id, "EXISTING_MAPPING", "Current-company price-list mapping.") : fallback("Mapped item is missing or fails archived type/active/account-reference checks.");
  }
  const source = catalog.find(row => row.id === line.priceListItemId);
  if (!source || source.archived) return fallback("Source price-list item is missing or archived.");
  const matches = items.filter(row => [row.Name, row.FullyQualifiedName].some(name => normalized(name) === normalized(source.name)));
  if (matches.length) return matches.length === 1 && itemShapeEligible(matches[0]) ? project(matches[0].Id, "EXACT_NAME", "Unique eligible archived item name; no mapping was written.") : fallback("Item name is ambiguous or ineligible.");
  if (!source.name?.trim() || source.name.length > 100 || source.name.includes(":") || [...source.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return fallback("Source name cannot safely become an item name.");
  return { id: "", name: source.name, incomeAccountId: config.incomeAccountId || "", status: "WOULD_REQUIRE_NEW_ITEM", reason: "No archived name match; no item was created.", comparisonKnown: false, accountEligibility: "NOT_REVALIDATED_ARCHIVE_HAS_NO_ACCOUNT_ENTITY" };
}

export function discrepancyBucket(flags) {
  const dimensions = [];
  if (flags.CUSTOMER_DIFF || flags.DATE_DIFF) dimensions.push("CUSTOMER_OR_DATE_DIFF");
  if (flags.SUBTOTAL_DIFF || flags.GST_DIFF || flags.TOTAL_DIFF || flags.CURRENCY_DIFF) dimensions.push("FINANCIAL_DIFF");
  if (flags.LINE_COUNT_DIFF || flags.LINE_ORDER_DIFF || flags.DESCRIPTION_CONTENT_DIFF || flags.QTY_DIFF || flags.UNIT_PRICE_DIFF || flags.LINE_AMOUNT_DIFF || flags.DOC_NUMBER_CONTENT_DIFF || flags.UNSUPPORTED_CONTENT) dimensions.push("CONTENT_DIFF_NO_FINANCIAL_CHANGE");
  if (flags.BALANCE_DIFF || flags.PAYMENT_STATE_DIFF) dimensions.push("PAYMENT_ONLY_DIFF");
  // Cosmetic differences are auxiliary when substantive differences exist.
  if (dimensions.length > 1) return { bucket: "MULTIPLE_DIFF_TYPES", discrepancyTypes: dimensions };
  return { bucket: dimensions[0] || "COSMETIC_ONLY", discrepancyTypes: dimensions.length ? dimensions : ["COSMETIC_ONLY"] };
}

export function compareCandidate(record, source, raw, context) {
  const local = record.normalizedInvoice, remote = normalizeInvoice(raw), qbLines = refs(raw), accounting = context.accounting.get(raw.Id);
  const balance = scaled(raw.Balance), inferredPaid = int(remote.totalCents) && int(balance) ? remote.totalCents - balance : null;
  const localBalance = int(record.elsetPaidCents) ? local.totalCents - record.elsetPaidCents : null;
  const lineKey = (description, line) => JSON.stringify([line?.kind, normalizeDescription(description), line?.quantityMicros, line?.rateMicros, line?.amountCents]);
  const localKeys = source.lines.map((line, index) => lineKey(line.description, local.lines[index]));
  const qbKeys = qbLines.map((line, index) => lineKey(line.Description, remote.lines[index]));
  const equalLineMultiset = JSON.stringify([...localKeys].sort()) === JSON.stringify([...qbKeys].sort());
  const available = qbKeys.map((key, index) => ({ key, index }));
  // Only realign a complete exact multiset, including repeated-line multiplicity.
  // Otherwise preserve positions and expose every unmatched value for review.
  const alignment = equalLineMultiset ? localKeys.map(key => available.splice(available.findIndex(entry => entry.key === key), 1)[0].index) : localKeys.map((_, index) => index);
  const lineOrderDiff = equalLineMultiset && alignment.some((qbIndex, localIndex) => qbIndex !== localIndex);
  const lines = Array.from({ length: Math.max(source.lines.length, qbLines.length) }, (_, index) => {
    const qbIndex = alignment[index] ?? index;
    const a = source.lines[index], b = qbLines[qbIndex], an = local.lines[index], bn = remote.lines[qbIndex], expected = a ? expectedItem(a, context) : null;
    const descriptionDiff = String(a?.description ?? "") !== String(b?.Description ?? "");
    const contentDiff = !a || !b || normalizeDescription(a.description) !== normalizeDescription(b.Description);
    return { position: index + 1, qbPosition: qbIndex + 1, lineAlignment: equalLineMultiset ? "EXACT_CONTENT_BIJECTION" : "POSITION_REQUIRES_REVIEW", elsetLineId: a?.id || "", priceListItemId: a?.priceListItemId || "", elsetDescription: a?.description ?? null, qbDescription: b?.Description ?? null,
      expectedItem: expected, qbItemId: b?.SalesItemLineDetail?.ItemRef?.value || "", qbItemName: b?.SalesItemLineDetail?.ItemRef?.name || "",
      qbIncomeAccountId: b?.SalesItemLineDetail?.ItemAccountRef?.value || "", qbIncomeAccountName: b?.SalesItemLineDetail?.ItemAccountRef?.name || "",
      elsetQuantityMicros: an?.quantityMicros ?? null, qbQuantityMicros: bn?.quantityMicros ?? null,
      elsetUnitPriceMicros: an?.rateMicros ?? null, qbUnitPriceMicros: bn?.rateMicros ?? null,
      elsetLineAmountCents: an?.amountCents ?? null, qbLineAmountCents: bn?.amountCents ?? null,
      DESCRIPTION_DIFF: descriptionDiff, DESCRIPTION_FORMAT_ONLY: descriptionDiff && !contentDiff, DESCRIPTION_CONTENT_DIFF: contentDiff,
      PRODUCT_SERVICE_DIFF: Boolean(expected?.comparisonKnown && b && expected.id !== b.SalesItemLineDetail?.ItemRef?.value),
      PRODUCT_SERVICE_COMPARISON_UNKNOWN: Boolean(!a || !b || !expected?.comparisonKnown),
      INCOME_ACCOUNT_DIFF: Boolean(expected?.incomeAccountId && b?.SalesItemLineDetail?.ItemAccountRef?.value && expected.incomeAccountId !== b.SalesItemLineDetail.ItemAccountRef.value),
      QTY_DIFF: !a || !b || !int(bn?.quantityMicros) || an.quantityMicros !== bn.quantityMicros,
      UNIT_PRICE_DIFF: !a || !b || !int(bn?.rateMicros) || an.rateMicros !== bn.rateMicros,
      LINE_AMOUNT_DIFF: !a || !b || !int(bn?.amountCents) || an.amountCents !== bn.amountCents };
  });
  const localState = paymentState(local.totalCents, record.elsetPaidCents), qbState = paymentState(remote.totalCents, inferredPaid);
  const flags = { CUSTOMER_DIFF: !local.customerId || local.customerId !== remote.customerId, DATE_DIFF: local.date !== remote.date,
    DOC_NUMBER_DIFF: local.number !== remote.number, DOC_NUMBER_FORMAT_ONLY: local.number !== remote.number && Boolean(numberKey(local.number)) && numberKey(local.number) === numberKey(remote.number),
    DOC_NUMBER_CONTENT_DIFF: local.number !== remote.number && (!numberKey(local.number) || numberKey(local.number) !== numberKey(remote.number)),
    LINE_COUNT_DIFF: local.lines.length !== remote.lines.length, LINE_ORDER_DIFF: lineOrderDiff,
    ...Object.fromEntries(["PRODUCT_SERVICE_DIFF", "PRODUCT_SERVICE_COMPARISON_UNKNOWN", "INCOME_ACCOUNT_DIFF", "DESCRIPTION_DIFF", "DESCRIPTION_CONTENT_DIFF", "QTY_DIFF", "UNIT_PRICE_DIFF", "LINE_AMOUNT_DIFF"].map(key => [key, lines.some(line => line[key])])),
    DESCRIPTION_FORMAT_ONLY: lines.some(line => line.DESCRIPTION_FORMAT_ONLY) && !lines.some(line => line.DESCRIPTION_CONTENT_DIFF),
    HAS_DESCRIPTION_FORMAT_DIFFERENCE: lines.some(line => line.DESCRIPTION_FORMAT_ONLY),
    SUBTOTAL_DIFF: !int(remote.subtotalCents) || local.subtotalCents !== remote.subtotalCents,
    GST_DIFF: !int(remote.taxCents) || local.taxCents !== remote.taxCents, TOTAL_DIFF: !int(remote.totalCents) || local.totalCents !== remote.totalCents,
    BALANCE_DIFF: !int(balance) || !int(localBalance) || localBalance !== balance,
    PAYMENT_STATE_DIFF: localState !== qbState || localState === "UNKNOWN", CURRENCY_DIFF: local.currency !== remote.currency, UNSUPPORTED_CONTENT: !remote.valid };
  const substantiveKeys = ["CUSTOMER_DIFF", "DATE_DIFF", "LINE_COUNT_DIFF", "DESCRIPTION_CONTENT_DIFF", "QTY_DIFF", "UNIT_PRICE_DIFF", "LINE_AMOUNT_DIFF", "SUBTOTAL_DIFF", "GST_DIFF", "TOTAL_DIFF", "CURRENCY_DIFF", "UNSUPPORTED_CONTENT"];
  const businessMatch = !substantiveKeys.some(key => flags[key]);
  flags.HISTORICAL_ITEM_DIFFERENCE_ONLY = businessMatch && !flags.LINE_ORDER_DIFF && flags.PRODUCT_SERVICE_DIFF && !flags.PRODUCT_SERVICE_COMPARISON_UNKNOWN;
  flags.STRICT_ITEM_ONLY = flags.HISTORICAL_ITEM_DIFFERENCE_ONLY && !flags.DOC_NUMBER_DIFF && !flags.DESCRIPTION_DIFF && !flags.BALANCE_DIFF && !flags.PAYMENT_STATE_DIFF;
  const monetaryDifferences = [];
  for (const [flag, field, a, b, unit] of [["SUBTOTAL_DIFF", "subtotal", local.subtotalCents, remote.subtotalCents, "AUD cents"], ["GST_DIFF", "gst", local.taxCents, remote.taxCents, "AUD cents"], ["TOTAL_DIFF", "total", local.totalCents, remote.totalCents, "AUD cents"], ["BALANCE_DIFF", "balance", localBalance, balance, "AUD cents"]]) {
    if (flags[flag]) monetaryDifferences.push({ field, elset: a, quickbooks: b, unit });
  }
  if (record.elsetPaidCents !== inferredPaid) monetaryDifferences.push({ field: "paid_vs_inferred_paid", elset: record.elsetPaidCents, quickbooks: inferredPaid, unit: "AUD cents" });
  for (const line of lines) {
    if (line.UNIT_PRICE_DIFF) monetaryDifferences.push({ field: "unit_price", position: line.position, elset: line.elsetUnitPriceMicros, quickbooks: line.qbUnitPriceMicros, unit: "AUD millionths" });
    if (line.LINE_AMOUNT_DIFF) monetaryDifferences.push({ field: "line_amount", position: line.position, elset: line.elsetLineAmountCents, quickbooks: line.qbLineAmountCents, unit: "AUD cents" });
  }
  const linkedPayments = accounting.links.filter(link => link.type === "Payment").map(link => {
    const payment = context.payments.find(p => p.Id === link.id);
    return { id: link.id, date: payment?.TxnDate || "", customerId: payment?.CustomerRef?.value || "", totalCents: scaled(payment?.TotalAmt), unappliedCents: scaled(payment?.UnappliedAmt),
      allocations: (payment?.Line || []).filter(line => line.LinkedTxn?.some(txn => txn.TxnType === "Invoice" && txn.TxnId === raw.Id)).map(line => ({ amountCents: scaled(line.Amount), links: line.LinkedTxn })), metadata: payment?.MetaData || {} };
  });
  return { qbId: raw.Id, qbDocNumber: remote.number, qbCustomerId: remote.customerId, qbCustomer: raw.CustomerRef?.name || context.customers.find(c => c.Id === remote.customerId)?.DisplayName || "",
    qbDate: remote.date, qbDueDate: raw.DueDate || "", qbSubtotalCents: remote.subtotalCents, qbGstCents: remote.taxCents, qbTotalCents: remote.totalCents,
    qbBalanceCents: balance, qbInferredPaidCents: inferredPaid, elsetBalanceCents: localBalance, elsetPaymentState: localState, qbPaymentState: qbState,
    linkedTransactions: accounting.links, linkedTransactionTypes: unique(accounting.links.map(link => link.type)), linkedPayments,
    qbDepositCents: scaled(raw.Deposit) || 0, protectedAccountingState: accounting.protectedState,
    createdAt: raw.MetaData?.CreateTime || "", updatedAt: raw.MetaData?.LastUpdatedTime || "", syncToken: raw.SyncToken,
    existingLocalMappings: context.mappings.filter(m => m.provider === "quickbooks" && m.external_tenant_id === context.tenantId && m.local_entity_type === "invoice" && m.external_entity_id === raw.Id).map(m => ({ invoiceId: m.local_entity_id, invoiceNumber: context.records.find(r => r.elsetInvoiceId === m.local_entity_id)?.invoiceNumber || "" })),
    otherLocalClaims: context.records.filter(other => other.elsetInvoiceId !== record.elsetInvoiceId && [...other.candidates, ...other.possibleCandidates].some(candidate => candidate.id === raw.Id)).map(other => ({ invoiceNumber: other.invoiceNumber, mapped: other.mappedQuickbooksId === raw.Id, evidence: [...other.candidates, ...other.possibleCandidates].find(candidate => candidate.id === raw.Id)?.reasons || [], businessContentMatch: unorderedBusinessKey(other.normalizedInvoice) === unorderedBusinessKey(remote) })),
    mappedToThisInvoice: record.mappedQuickbooksId === raw.Id, firstPassEvidence: [...record.candidates, ...record.possibleCandidates].find(c => c.id === raw.Id)?.reasons || [],
    businessMatch, identitySafe: businessMatch && record.customerResolution.safe, flags, ...discrepancyBucket(flags),
    fieldMatches: Object.fromEntries(Object.entries(flags).filter(([key]) => differenceFlags.includes(key)).map(([key, value]) => [key.replace(/_DIFF$/, "_MATCH"), key === "PRODUCT_SERVICE_DIFF" && flags.PRODUCT_SERVICE_COMPARISON_UNKNOWN ? null : !value])),
    customerComparison: local.customerId ? "RESOLVED_ID_COMPARISON" : "UNRESOLVED_ELSET_CUSTOMER_NOT_CONFIRMED_WRONG_CUSTOMER",
    monetaryDifferences, lines, qbPrivateNote: raw.PrivateNote || "", qbCustomerMemo: raw.CustomerMemo?.value || "", qbEmailStatus: raw.EmailStatus || "" };
}

export function chooseCanonical(record, comparisons, allRecords, rawInvoices) {
  const strong = comparisons.filter(candidate => candidate.identitySafe);
  if (strong.length !== 1) return { status: "REVIEW_REQUIRED", qbId: "", reason: strong.length ? "Several candidates match the full business content; payment history, provenance and ownership need review." : "No single candidate matches customer, date, descriptions, quantities, rates and totals." };
  const best = strong[0], raw = rawInvoices.find(row => row.Id === best.qbId), remote = normalizeInvoice(raw);
  const competing = allRecords.filter(other => other.elsetInvoiceId !== record.elsetInvoiceId &&
    (other.mappedQuickbooksId === best.qbId || unorderedBusinessKey(other.normalizedInvoice) === unorderedBusinessKey(remote)));
  if (competing.length || best.existingLocalMappings.some(mapping => mapping.invoiceId !== record.elsetInvoiceId)) return { status: "REVIEW_REQUIRED", qbId: "", reason: "Another ELSET invoice has an existing mapping or identical business content for this QB invoice.", competingInvoices: competing.map(row => row.invoiceNumber) };
  return { status: "CLEAR_CANONICAL_CANDIDATE", qbId: best.qbId, reason: "Unique full business-content match with no competing mapped or exact-content ELSET owner. Other shared reference claims lack full content equality. Diagnostic recommendation only; reference differences and paid history still require review before linking." };
}

export function paymentCategory(record, comparison) {
  if (!comparison) return "OTHER";
  if (comparison.linkedTransactionTypes.some(type => type !== "Payment") || comparison.qbDepositCents > 0) return "CREDIT_OR_OTHER_LINKED_TRANSACTION";
  if ([comparison.elsetPaymentState, comparison.qbPaymentState].includes("UNKNOWN")) return "OTHER";
  if (comparison.elsetPaymentState === "PAID" && comparison.qbPaymentState === "UNPAID") return "ELSET_PAID_QB_UNPAID";
  if (comparison.elsetPaymentState === "PARTIAL" && comparison.qbPaymentState === "UNPAID") return "ELSET_PARTIAL_QB_UNPAID";
  if (comparison.elsetPaymentState === "UNPAID" && comparison.qbPaymentState === "PAID") return "QB_PAID_ELSET_UNPAID";
  if (record.elsetPaidCents !== comparison.qbInferredPaidCents || record.elsetTotalCents !== comparison.qbTotalCents) return "PAYMENT_AMOUNT_DIFF";
  return "MATCHING_PAYMENT_STATE";
}

export function verifySameLocalDataset(baseline, current) {
  if (baseline.records.length !== current.records.length) throw new Error("ELSET_DATA_DRIFT: invoice count changed.");
  const now = new Map(current.records.map(row => [row.elsetInvoiceId, row]));
  for (const before of baseline.records) {
    const after = now.get(before.elsetInvoiceId);
    if (!after || ["fingerprint", "elsetPaidCents", "eligible", "mappedQuickbooksId", "customer", "classification"].some(key => before[key] !== after[key])
      || JSON.stringify(before.customerResolution) !== JSON.stringify(after.customerResolution)) throw new Error(`ELSET_DATA_DRIFT: ${before.invoiceNumber}; stop and review the changed dataset.`);
  }
  return { matchedInvoices: baseline.records.length, normalizedContent: true, paidAmounts: true, customerResolution: true, invoiceMappings: true, classifications: true,
    limitation: "First pass did not retain raw ELSET description formatting or price-list provenance. Those are read from the current production snapshot; normalized content and all financial/identity values agree with baseline." };
}

export function analyzeSecondPass({ baseline, archive, localInvoices, catalog = [], mappings = [], config = {} }) {
  const context = { ...archive, catalog, mappings, config, tenantId: baseline.company.id, records: baseline.records,
    accounting: linkedAccounting(archive.invoices, archive.payments, archive.credits, archive.deposits) };
  const local = new Map(localInvoices.map(row => [row.id, row])), remote = new Map(archive.invoices.map(row => [row.Id, row]));
  const records = baseline.records.map(record => {
    const source = local.get(record.elsetInvoiceId);
    if (!source) throw new Error("ELSET_DATA_DRIFT: missing source invoice.");
    const candidateIds = unique([...record.candidates, ...record.possibleCandidates].map(row => row.id).concat(record.quickbooksInvoiceId || []));
    const comparisons = candidateIds.map(id => {
      if (!remote.has(id)) throw new Error("ARCHIVE_MISMATCH: missing candidate.");
      return compareCandidate(record, source, remote.get(id), context);
    });
    const selected = comparisons.find(candidate => candidate.qbId === record.quickbooksInvoiceId) || null;
    const canonicalReview = chooseCanonical(record, comparisons, baseline.records, archive.invoices);
    const diagnostic = selected || comparisons.find(candidate => candidate.qbId === canonicalReview.qbId) || null;
    const result = { elsetInvoiceId: record.elsetInvoiceId, invoiceNumber: record.invoiceNumber, elsetCustomer: record.customer, elsetCustomerId: source.customerId,
      elsetDate: record.invoiceDate, elsetDueDate: source.dueDate, elsetSubtotalCents: record.normalizedInvoice.subtotalCents, elsetGstCents: record.normalizedInvoice.taxCents,
      elsetTotalCents: record.elsetTotalCents, elsetPaidCents: record.elsetPaidCents, elsetBalanceCents: record.elsetTotalCents - record.elsetPaidCents,
      firstPassClassification: record.classification, firstPassAction: record.proposedAction, firstPassFlags: record.flags,
      customerResolution: record.customerResolution, mappedQuickbooksId: record.mappedQuickbooksId, selectedQbId: selected?.qbId || "",
      bucket: selected?.bucket || "NOT_IN_DIFFERENT_COHORT", flags: selected?.flags || null, selectedComparison: selected,
      canonicalReview, candidates: comparisons, paymentReviewRequired: record.paymentDiscrepancy === "PAYMENT_REVIEW_REQUIRED",
      paymentReview: { category: paymentCategory(record, diagnostic), comparedQbId: diagnostic?.qbId || "", comparisonBasis: selected ? "FIRST_PASS_SELECTED_COUNTERPART" : diagnostic ? "SECOND_PASS_CLEAR_CANDIDATE_PROPOSAL" : "NO_UNAMBIGUOUS_COUNTERPART",
        qbTotalCents: diagnostic?.qbTotalCents ?? null, qbBalanceCents: diagnostic?.qbBalanceCents ?? null, qbInferredPaidCents: diagnostic?.qbInferredPaidCents ?? null,
        linkedTransactionTypes: diagnostic?.linkedTransactionTypes || [], identityReviewRequired: !diagnostic || !diagnostic.identitySafe || record.flags.includes("SHARED_QB_CANDIDATE"),
        note: "Total less Balance is inferred settlement, not proof of a cash receipt. Numeric matches do not resolve customer/reference/ownership conflicts. See per-candidate allocations and links." },
      suggestedPhases: [], suggestedAction: "REVIEW_ONLY" };
    if (record.classification === "MISSING_IN_QB") {
      // Search all archived invoices again for content/amount candidates, including changed dates or customer identity.
      const weak = archive.invoices.flatMap(raw => {
        const qb = normalizeInvoice(raw), a = record.normalizedInvoice, reasons = [];
        if (record.possibleCandidates.some(c => c.id === raw.Id)) reasons.push("FIRST_PASS_NUMBER_VARIANT_ONLY");
        if (a.customerId && a.customerId === qb.customerId && a.totalCents === qb.totalCents) reasons.push("SAME_CUSTOMER_AND_TOTAL");
        if (a.date === qb.date && a.totalCents === qb.totalCents) reasons.push("SAME_DATE_AND_TOTAL");
        if (a.lines.length && a.lineFingerprint === qb.lineFingerprint) reasons.push("SAME_LINES_REGARDLESS_OF_CUSTOMER_OR_DATE");
        return reasons.length ? [{ ...compareCandidate(record, source, raw, context), weakReasons: reasons }] : [];
      });
      const safeIdentity = record.proposedAction === "CREATE_QB_INVOICE" && !weak.length;
      const status = weak.length ? "POSSIBLE_EXISTING_QB_RECORD" : safeIdentity && record.elsetPaidCents === 0 ? "SAFE_CREATE" : "REVIEW_BEFORE_CREATE";
      result.missingReview = { status, firstPassCreateProposal: record.proposedAction === "CREATE_QB_INVOICE", identitySafeForCreation: safeIdentity, weakCandidates: weak,
        firstPassNoCounterpartReason: record.possibleCandidates.length ? "Only uncorroborated legacy number candidates; no mapped, marked, exact-number or sufficiently corroborated content counterpart." : "No mapped, marked, exact-number or sufficiently corroborated content counterpart in the first pass.",
        reason: weak.length ? "Weak number/content/amount evidence could represent an existing invoice. Resolve every candidate before creating." : !record.customerResolution.safe ? `Customer identity unresolved: ${record.customerResolution.reason}` : record.elsetPaidCents > 0 ? "No archived counterpart found, but ELSET has recorded payments. Creating an unpaid QB invoice needs accounting/payment review first." : safeIdentity ? "No candidate after expanded archived-invoice search, safe customer resolution, validated first-pass configuration and no ELSET payments. Conditional future invoice-only create candidate; no approval or current-state preflight implied." : "First-pass eligibility/configuration requires review.",
        absenceScope: "All 171 archived Invoice entities (or full synthetic input in tests). Does not assert absence of SalesReceipts, JournalEntries or other entity types not in the first-pass archive." };
      if (status === "SAFE_CREATE") { result.suggestedPhases.push("PHASE_1"); result.suggestedAction = "CONDITIONAL_CREATE_TRULY_MISSING_INVOICE"; }
      else result.suggestedAction = "RESOLVE_MISSING_INVOICE_REVIEW";
    }
    if (record.classification === "MULTIPLE_QB_CANDIDATES" || comparisons.filter(c => c.businessMatch).length > 1) result.suggestedPhases.push("PHASE_3");
    if (result.paymentReviewRequired) result.suggestedPhases.push("PHASE_4");
    if (record.classification === "EXACT_MATCH" && !record.mappedQuickbooksId && canonicalReview.status === "CLEAR_CANONICAL_CANDIDATE" && !result.paymentReview.identityReviewRequired) {
      result.suggestedPhases.push("PHASE_1"); result.suggestedAction = "CONDITIONAL_LINK_EXACT_COUNTERPART";
    }
    if (selected?.bucket === "COSMETIC_ONLY") result.suggestedAction = "KEEP_HISTORICAL_ITEM_DESCRIPTION_FORMAT_AND_NUMBER_FORMAT";
    if (selected?.flags.LINE_ORDER_DIFF && !["CUSTOMER_DIFF", "DATE_DIFF", "DOC_NUMBER_CONTENT_DIFF", "BALANCE_DIFF", "PAYMENT_STATE_DIFF"].some(key => selected.flags[key])) result.suggestedAction = "KEEP_HISTORICAL_LINE_ORDER_AND_ITEMS";
    if (selected && !selected.protectedAccountingState && record.customerResolution.safe && !record.flags.includes("SHARED_QB_CANDIDATE")
      && !selected.flags.CUSTOMER_DIFF && !selected.flags.DATE_DIFF && !selected.flags.DOC_NUMBER_CONTENT_DIFF
      && !selected.flags.LINE_ORDER_DIFF
      && ["CONTENT_DIFF_NO_FINANCIAL_CHANGE", "FINANCIAL_DIFF"].includes(selected.bucket)
      && (record.mappedQuickbooksId || selected.firstPassEvidence.includes("ELSET_MARKER"))) {
      result.suggestedPhases.push("PHASE_2"); result.suggestedAction = "REVIEW_UNAMBIGUOUS_UNLINKED_CONTENT_CORRECTION";
    }
    result.suggestedPhases = unique(result.suggestedPhases);
    return result;
  });
  const different = records.filter(row => row.firstPassClassification === "DIFFERENT_IN_QB");
  const multiple = records.filter(row => row.firstPassClassification === "MULTIPLE_QB_CANDIDATES");
  const missing = records.filter(row => row.firstPassClassification === "MISSING_IN_QB");
  const payment = records.filter(row => row.paymentReviewRequired);
  const special = records.find(row => row.invoiceNumber === "INV-0252");
  const legacy = special?.candidates.find(row => row.qbId === "346"), mapped = special?.candidates.find(row => row.qbId === "353");
  const payment348 = legacy?.linkedPayments.find(row => row.id === "348");
  const legacySupported = Boolean(legacy?.identitySafe && mapped?.identitySafe && special.elsetPaidCents > 0 && legacy.qbBalanceCents === 0
    && legacy.qbInferredPaidCents === special.elsetPaidCents && mapped.qbBalanceCents === special.elsetTotalCents
    && payment348?.allocations.reduce((n, row) => n + row.amountCents, 0) === special.elsetPaidCents && Date.parse(legacy.createdAt) < Date.parse(mapped.createdAt));
  return { schema: "elset-quickbooks-second-pass-v1", complete: true, mode: "dry-run/read-only", company: baseline.company, baselineTimestamp,
    audit: { quickbooksReads: 0, quickbooksMutations: 0, tokenRefreshes: 0, databaseWrites: 0, usesArchivedQuickBooksData: true },
    methodology: { monetaryUnits: "Integer AUD cents; quantities and unit prices in millionths. Null means unavailable, never zero.",
      buckets: "Exclusive substantive dimensions: customer/date; totals/currency; wording/line quantities/rates/amounts/material number; payment. More than one = MULTIPLE_DIFF_TYPES. Item, description format and equivalent INV prefix/zero-padding are ancillary; alone = COSMETIC_ONLY. Document numbers are still reported exactly, never rewritten.",
      historicalItems: "HISTORICAL_ITEM_DIFFERENCE_ONLY concerns business-content equality excluding references, harmless formatting and settlement. Other flags remain visible. STRICT_ITEM_ONLY additionally requires exact number/description/balance. No historical Item rewrite is proposed. Income-account differences are separately visible and not a claim of ledger equivalence.",
      descriptions: "Whitespace/line-ending collapse and prose case folding; preserve punctuation, word order, numeric/model tokens and case-sensitive electrical units. When the complete line multiset (description/quantity/rate/amount/type including multiplicity) agrees, align exact lines and flag LINE_ORDER_DIFF separately. Otherwise compare by position. Both original positions are retained; reordering never masquerades as changed prices or wording.",
      identity: "CUSTOMER_DIFF includes unresolved ELSET customer identity; customerComparison and customerResolution distinguish unknown from confirmed mismatch. Clear canonical is diagnostic only, never a mapping write.",
      productPrediction: "Use saved priceListItemId and current company mappings/catalog, or configured fallback for ad-hoc lines. No guessing from descriptions. Archive lacks Account entities, so active Income-account validation is not repeated and future item/create operations need live validation.",
      payment: "Categories describe numeric state of first-pass selected counterpart, or a second-pass clear candidate proposal. Identity review remains explicit. Unknown/missing/multiple unresolved counterparts = OTHER; matching numeric state does not authorize linking.",
      phaseBoundary: "All phases are proposals. No executor. Re-read live entities and links, verify accounting periods and create a fresh archive before any separately authorized writes." },
    summary: { elsetInvoices: records.length, quickbooksInvoices: archive.invoices.length, differentCount: different.length,
      discrepancyBuckets: countBy(different, "bucket", discrepancyBuckets), flagCounts: Object.fromEntries([...differenceFlags, "LINE_ORDER_DIFF", "DESCRIPTION_FORMAT_ONLY", "DESCRIPTION_CONTENT_DIFF", "HISTORICAL_ITEM_DIFFERENCE_ONLY", "STRICT_ITEM_ONLY", "PRODUCT_SERVICE_COMPARISON_UNKNOWN", "INCOME_ACCOUNT_DIFF"].map(key => [key, different.filter(row => row.flags[key]).length])),
      historicalItemDifferenceOnlyAllSelected: records.filter(row => row.flags?.HISTORICAL_ITEM_DIFFERENCE_ONLY).length,
      multipleCount: multiple.length, multipleCandidateRows: multiple.reduce((n, row) => n + row.candidates.length, 0), multipleConclusions: countBy(multiple.map(row => row.canonicalReview), "status", ["CLEAR_CANONICAL_CANDIDATE", "REVIEW_REQUIRED"]),
      missingCount: missing.length, missingConclusions: countBy(missing.map(row => row.missingReview), "status", ["SAFE_CREATE", "POSSIBLE_EXISTING_QB_RECORD", "REVIEW_BEFORE_CREATE"]), firstPassCreateProposals: missing.filter(row => row.missingReview.firstPassCreateProposal).length,
      paymentReviewCount: payment.length, paymentBuckets: countBy(payment.map(row => row.paymentReview), "category", paymentBuckets), paymentIdentityReviewCount: payment.filter(row => row.paymentReview.identityReviewRequired).length,
      phaseCounts: Object.fromEntries(["PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4"].map(phase => [phase, records.filter(row => row.suggestedPhases.includes(phase)).length])) },
    records, differentInvoiceNumbers: different.map(row => row.invoiceNumber), multipleInvoiceNumbers: multiple.map(row => row.invoiceNumber), missingInvoiceNumbers: missing.map(row => row.invoiceNumber), paymentReviewInvoiceNumbers: payment.map(row => row.invoiceNumber),
    inv0252: special ? { invoiceNumber: special.invoiceNumber, elsetCustomer: special.elsetCustomer, elsetDate: special.elsetDate, elsetSubtotalCents: special.elsetSubtotalCents, elsetGstCents: special.elsetGstCents, elsetTotalCents: special.elsetTotalCents, elsetPaidCents: special.elsetPaidCents, mappedQuickbooksId: special.mappedQuickbooksId,
      candidates: special.candidates.filter(row => ["353", "346"].includes(row.qbId)), conclusion: legacySupported ? `QB 346 is the stronger historical accounting representation: its matching business content and zero balance are supported by Payment 348 for AUD ${(special.elsetPaidCents / 100).toFixed(2)}, consistent with ELSET paid amount. QB 353 is stronger for the exact current document number, ELSET marker and saved mapping; it was created later and remains unpaid. Recommend accounting review of preserving 346 and resolving 353/current mapping; do not remap, transfer payments or void either record automatically. Item income account and due-date differences are retained for review.` : "Evidence does not establish a stronger historical accounting representation. Review both records and payment allocations manually.", status: "REVIEW_REQUIRED", strongerHistoricalAccountingId: legacySupported ? "346" : "", currentMappedId: special.mappedQuickbooksId } : null,
    phases: [
      { phase: "PHASE_1", purpose: "Conditional safe nondestructive actions", actions: "Link exact unique existing records, create truly missing unpaid records after expanded search and customer/configuration checks, repair broken mappings only with certain unique identity.", invoiceNumbers: records.filter(r => r.suggestedPhases.includes("PHASE_1")).map(r => r.invoiceNumber), brokenMappingRepairs: [] },
      { phase: "PHASE_2", purpose: "Safe content corrections", actions: "Only certain ELSET-owned, unambiguous, unpaid/unlinked invoices. No cosmetic historical item/format/legacy-number rewrites. Current evidence does not make numeric reference similarity update authority.", invoiceNumbers: records.filter(r => r.suggestedPhases.includes("PHASE_2")).map(r => r.invoiceNumber) },
      { phase: "PHASE_3", purpose: "Canonical and duplicate review", actions: "Resolve shared-number claims separately from actual duplicates. Preserve paid history. Consider voiding only a proven duplicate with no payments, credits, deposits, other links or mapping conflict, after fresh reads and separate approval. No current void recommendation.", invoiceNumbers: records.filter(r => r.suggestedPhases.includes("PHASE_3")).map(r => r.invoiceNumber), voidProposals: [] },
      { phase: "PHASE_4", purpose: "Accounting-aware payment reconciliation", actions: "Resolve receipt allocations, identity, credits and accounting-period effects manually. Never create/delete/update a Payment just to force balances to agree.", invoiceNumbers: records.filter(r => r.suggestedPhases.includes("PHASE_4")).map(r => r.invoiceNumber) },
    ] };
}

function csv(rows, columns) {
  const cell = value => {
    let result = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    result = [...result].map(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)) ? " " : c).join("");
    if (/^\s*[=+@-]/.test(result)) result = `'${result}`;
    return `"${result.replaceAll('"', '""')}"`;
  };
  return [columns.join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n");
}
export function writeSecondPassReports(report, directory, timestamp) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const base = path.join(directory, `quickbooks-reconciliation-second-pass-${timestamp}`);
  const paths = { json: `${base}.json`, csv: `${base}.csv`, multiple: path.join(directory, `quickbooks-multiple-candidate-review-${timestamp}.csv`), payment: path.join(directory, `quickbooks-payment-review-${timestamp}.csv`) };
  const localColumns = ["invoiceNumber", "elsetInvoiceId", "elsetCustomer", "elsetDate", "elsetSubtotalCents", "elsetGstCents", "elsetTotalCents", "elsetPaidCents", "elsetBalanceCents", "mappedQuickbooksId"];
  const qbColumns = ["qbId", "qbDocNumber", "qbCustomer", "qbCustomerId", "qbDate", "qbSubtotalCents", "qbGstCents", "qbTotalCents", "qbBalanceCents", "qbInferredPaidCents", "linkedTransactionTypes", "linkedTransactions", "linkedPayments", "createdAt", "updatedAt", "existingLocalMappings", "otherLocalClaims", "fieldMatches", "monetaryDifferences", "lines"];
  const flagColumns = [...differenceFlags, "LINE_ORDER_DIFF", "DOC_NUMBER_FORMAT_ONLY", "DOC_NUMBER_CONTENT_DIFF", "DESCRIPTION_FORMAT_ONLY", "DESCRIPTION_CONTENT_DIFF", "HISTORICAL_ITEM_DIFFERENCE_ONLY", "STRICT_ITEM_ONLY", "PRODUCT_SERVICE_COMPARISON_UNKNOWN", "INCOME_ACCOUNT_DIFF"];
  const general = report.records.map(row => ({ ...row, ...row.selectedComparison, ...row.flags, missingStatus: row.missingReview?.status, missingReason: row.missingReview?.reason, firstPassNoCounterpartReason: row.missingReview?.firstPassNoCounterpartReason, weakCandidates: row.missingReview?.weakCandidates,
    paymentCategory: row.paymentReview.category, canonicalStatus: row.canonicalReview.status, canonicalCandidateId: row.canonicalReview.qbId }));
  const multiple = report.records.filter(row => row.firstPassClassification === "MULTIPLE_QB_CANDIDATES").flatMap(row => row.candidates.map(candidate => ({ ...row, ...candidate, ...candidate.flags, canonicalStatus: row.canonicalReview.status, canonicalCandidateId: row.canonicalReview.qbId, canonicalReason: row.canonicalReview.reason })));
  const payments = report.records.filter(row => row.paymentReviewRequired).map(row => ({ ...row, ...row.paymentReview,
    candidatePayments: row.candidates.map(candidate => ({ qbId: candidate.qbId, totalCents: candidate.qbTotalCents, balanceCents: candidate.qbBalanceCents, inferredPaidCents: candidate.qbInferredPaidCents, linkedTransactions: candidate.linkedTransactions, linkedPayments: candidate.linkedPayments })) }));
  const files = [[paths.json, JSON.stringify(withoutSecrets(report), null, 2)],
    [paths.csv, csv(general, [...localColumns, "firstPassClassification", "firstPassAction", "bucket", ...flagColumns, ...qbColumns, "customerResolution", "canonicalStatus", "canonicalCandidateId", "paymentCategory", "missingStatus", "missingReason", "firstPassNoCounterpartReason", "weakCandidates", "suggestedPhases", "suggestedAction"])],
    [paths.multiple, csv(multiple, [...localColumns, ...qbColumns, ...flagColumns, "firstPassEvidence", "canonicalStatus", "canonicalCandidateId", "canonicalReason"])],
    [paths.payment, csv(payments, [...localColumns, "category", "comparedQbId", "comparisonBasis", "qbTotalCents", "qbBalanceCents", "qbInferredPaidCents", "linkedTransactionTypes", "identityReviewRequired", "note", "candidatePayments"])]];
  for (const [filename, content] of files) fs.writeFileSync(filename, content, { flag: "wx", mode: 0o600 });
  return paths;
}

export function parseSecondPassArgs(args) {
  if (args.length !== 1 || args[0] !== "--dry-run") throw new Error("Required: --dry-run. This diagnostic has no apply mode.");
}
export function secondPassCli(args = process.argv.slice(2), { env = process.env, output = console.log } = {}) {
  parseSecondPassArgs(args);
  const dbPath = getWorkspaceDbPath(env);
  if (process.platform !== "linux" || env.FLY_APP_NAME !== "elset-admin" || !env.FLY_MACHINE_ID || dbPath !== "/app/data/elset-workspace.db" || fs.realpathSync(dbPath) !== dbPath) throw new Error("Run only inside the existing elset-admin Fly machine; production databases must remain there.");
  const directory = fileURLToPath(new URL("../output/", import.meta.url));
  const baselinePath = path.join(directory, `quickbooks-reconciliation-${baselineTimestamp}.json`), archivePath = path.join(directory, `quickbooks-reconciliation-prechange-${baselineTimestamp}.json`);
  const baselineBuffer = fs.readFileSync(baselinePath), archiveBuffer = fs.readFileSync(archivePath);
  if (sha(baselineBuffer) !== baselineHashes.report || sha(archiveBuffer) !== baselineHashes.archive) throw new Error("BASELINE_INTEGRITY: archive/report is not the reviewed final first-pass dataset.");
  const baseline = JSON.parse(baselineBuffer), archive = JSON.parse(archiveBuffer);
  if (!baseline.complete || baseline.company.id !== archive.company.id || archive.invoices.length !== 171 || baseline.records.length !== 180) throw new Error("BASELINE_INTEGRITY: unexpected company/completeness/count.");
  const db = openWorkspaceDb({ dbPath, readonly: true, fileMustExist: true, migrate: false });
  let report;
  try {
    assertWorkspaceSchema(db);
    db.pragma("query_only = ON");
    report = db.transaction(() => {
      const before = db.prepare("SELECT total_changes() n").get().n;
      const workspaceId = db.prepare("SELECT workspace_id FROM integration_workspace WHERE id=1").get().workspace_id;
      const connection = db.prepare("SELECT external_tenant_id,provider_environment,config_json FROM workspace_integrations WHERE workspace_id=? AND provider='quickbooks'").get(workspaceId);
      if (connection?.external_tenant_id !== baseline.company.id || connection.provider_environment !== "production") throw new Error("COMPANY_DRIFT: current connection differs from archived production company.");
      const localInvoices = readLocalHistory(db);
      for (const source of localInvoices) {
        const extras = new Map(db.prepare("SELECT id,extra_json FROM invoice_line_items WHERE invoice_id=? ORDER BY position").all(source.id).map(row => [row.id, JSON.parse(row.extra_json || "{}")]));
        for (const line of source.lines) if (typeof extras.get(line.id)?.priceListItemId === "string") line.priceListItemId = extras.get(line.id).priceListItemId;
      }
      const mappings = db.prepare("SELECT provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id FROM integration_entity_mappings WHERE workspace_id=?").all(workspaceId);
      const localCustomers = db.prepare("SELECT id,name,email FROM customers").all();
      const current = analyzeReconciliation({ localInvoices, localCustomers, ...archive, mappings, workspaceId, tenantId: baseline.company.id, configurationReady: baseline.configurationReady });
      const verification = verifySameLocalDataset(baseline, current);
      const catalog = db.prepare("SELECT id,name,archived FROM price_list_items").all(), savedConfig = JSON.parse(connection.config_json);
      const config = { itemId: savedConfig.itemId, incomeAccountId: savedConfig.incomeAccountId };
      const result = analyzeSecondPass({ baseline, archive, localInvoices, catalog, mappings, config });
      if (db.prepare("SELECT total_changes() n").get().n !== before) throw new Error("READ_ONLY_VIOLATION");
      result.provenance = { generatedAt: new Date().toISOString(), archivedQuickBooksCapturedAt: archive.capturedAt, baselinePath, archivePath, hashes: baselineHashes,
        database: dbPath, readonly: db.readonly, queryOnly: db.pragma("query_only", { simple: true }) === 1, localDatasetVerification: verification,
        expectedItemConfig: config, sourceLineCount: localInvoices.reduce((n, row) => n + row.lines.length, 0), priceListLinkedLineCount: localInvoices.flatMap(row => row.lines).filter(line => line.priceListItemId).length };
      return result;
    })();
  } finally { db.close(); }
  if (report.summary.differentCount !== 124 || report.summary.multipleCount !== 21 || report.summary.missingCount !== 16 || report.summary.paymentReviewCount !== 77) throw new Error("COHORT_DRIFT: second pass no longer describes the requested cohorts.");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-"), paths = writeSecondPassReports(report, directory, timestamp);
  output(JSON.stringify({ complete: true, summary: report.summary, audit: report.audit, provenance: report.provenance, reports: paths }, null, 2));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = secondPassCli(); }
  catch (error) { console.error(String(error.message).replace(/[\r\n]/g, " ")); process.exitCode = 1; }
}
