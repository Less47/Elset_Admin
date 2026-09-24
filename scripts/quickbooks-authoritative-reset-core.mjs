// TEMPORARY one-time reset planner. Pure analysis: no provider or database writes.
import crypto from "node:crypto";
import { analyzeReconciliation, normalizeInvoice, linkedAccounting, scaled, fingerprint } from "./quickbooks-reconciliation-core.mjs";
import { compareCandidate, normalizeDescription, expectedItem } from "./quickbooks-reconciliation-second-pass.mjs";

export const resetActions = ["KEEP_AS_IS", "UPDATE_QB_TO_ELSET", "CREATE_QB", "REMAP_TO_DIFFERENT_QB_RECORD", "VOID_DUPLICATE", "LEAVE_REVIEW"];
export const inRange = (date, range) => Boolean(date && date >= range.from && date <= range.to);
export const isVoided = invoice => /^voided\b/i.test(invoice.PrivateNote || "") || ["void", "voided"].includes(String(invoice.TxnStatus || "").toLowerCase());
export const sourceHash = source => fingerprint(source);
export const entityHash = entity => fingerprint(entity);
export const reviewedInvoiceHash = entity => {
  const { SyncToken: _version, MetaData: _metadata, ...facts } = entity;
  return fingerprint(facts);
};
const unique = values => [...new Set(values)];
const ref = value => value?.value || "";
const validVersion = raw => /^\d+$/.test(String(raw.SyncToken ?? ""));
const lineKey = line => JSON.stringify([line.kind, normalizeDescription(line.description), line.quantityMicros, line.rateMicros, line.amountCents]);
const lineBag = invoice => JSON.stringify(invoice.lines.map(lineKey).sort());
const amountsMatch = (a, b) => ["subtotalCents", "taxCents", "totalCents"].every(key => Number.isSafeInteger(a[key]) && a[key] === b[key]);
const headerBusinessMatch = (a, b) => a.customerId && a.customerId === b.customerId && a.date === b.date && a.currency === b.currency && amountsMatch(a, b) && lineBag(a) === lineBag(b);
const invoiceMarker = (workspaceId, id) => `ELSET:ops-${crypto.createHash("sha256").update(`${workspaceId}:${id}`).digest("hex").slice(0, 24)}`;

export function sydneyToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function parseResetArgs(args, today = sydneyToday()) {
  const result = {}, allowed = new Set(["from", "to", "approved-plan", "approved-plan-sha256", "snapshot-id", "volume-id"]);
  for (const arg of args) {
    if (["--reset-dry-run", "--reset-apply"].includes(arg)) {
      if (result.mode) throw new Error("Choose exactly one reset mode.");
      result.mode = arg.slice(2); continue;
    }
    const match = arg.match(/^--([a-z0-9-]+)=(.+)$/);
    if (!match || !allowed.has(match[1]) || result[match[1]]) throw new Error("Unknown or repeated reset argument.");
    result[match[1]] = match[2];
  }
  const dateOK = date => /^\d{4}-\d{2}-\d{2}$/.test(date || "") && Number.isFinite(Date.parse(date)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  result.to ||= today;
  if (!result.mode || !dateOK(result.from) || !dateOK(result.to) || result.from > result.to || result.to > today) throw new Error("Require --reset-dry-run or --reset-apply, --from=YYYY-MM-DD, and optional --to=YYYY-MM-DD (default today in Sydney). Invalid/future dates are refused.");
  const applyArgs = ["approved-plan", "approved-plan-sha256", "snapshot-id", "volume-id"];
  if (result.mode === "reset-apply" && (applyArgs.some(key => !result[key]) || !/^[a-f0-9]{64}$/.test(result["approved-plan-sha256"]) || !/^vs_[A-Za-z0-9]+$/.test(result["snapshot-id"]) || !/^vol_[a-z0-9]+$/.test(result["volume-id"]))) throw new Error("Apply requires the approved dry-run file and SHA-256 plus a fresh verified Fly volume/snapshot ID.");
  if (result.mode === "reset-dry-run" && applyArgs.some(key => result[key])) throw new Error("Apply credentials/approval arguments are not accepted in dry-run.");
  return result;
}

// Require verifiable positive allocations to this invoice, same customer/currency,
// and no credits/deposits/unknown links before treating a paid state as legitimate.
export function paymentEvidence(raw, inventory, accounting = linkedAccounting(inventory.invoices, inventory.payments, inventory.credits, inventory.deposits)) {
  const state = accounting.get(raw.Id), total = scaled(raw.TotalAmt), balance = scaled(raw.Balance);
  const links = state.links, payments = links.filter(link => link.type === "Payment");
  let allocated = 0, valid = payments.length > 0;
  for (const link of payments) {
    const payment = inventory.payments.find(row => row.Id === link.id);
    if (!payment || ref(payment.CustomerRef) !== ref(raw.CustomerRef) || (ref(payment.CurrencyRef) || "AUD") !== (ref(raw.CurrencyRef) || "AUD") || !payment.TxnDate) { valid = false; continue; }
    const allocations = (payment.Line || []).filter(line => line.LinkedTxn?.some(txn => txn.TxnType === "Invoice" && txn.TxnId === raw.Id));
    if (!allocations.length) valid = false;
    for (const line of allocations) {
      const amount = scaled(line.Amount);
      if (!Number.isSafeInteger(amount) || amount <= 0 || line.LinkedTxn.length !== 1) valid = false;
      else allocated += amount;
    }
  }
  const otherLinks = links.some(link => link.type !== "Payment") || (scaled(raw.Deposit) || 0) > 0;
  const inferredPaid = Number.isSafeInteger(total) && Number.isSafeInteger(balance) ? total - balance : null;
  const legitimatePayments = valid && !otherLinks && allocated === inferredPaid && allocated > 0 && allocated <= total;
  const unlinkedUnpaid = !links.length && !otherLinks && Number.isSafeInteger(total) && total > 0 && balance === total && !isVoided(raw);
  return { links, paymentIds: payments.map(row => row.id), hasPayments: payments.length > 0, hasCredits: links.some(link => /credit/i.test(link.type)),
    otherLinks, allocatedCents: allocated, inferredPaidCents: inferredPaid, legitimatePayments, unlinkedUnpaid, protected: !unlinkedUnpaid };
}

export function planReset(input, range) {
  const { localInvoices, localCustomers, inventory, mappings, workspaceId, tenantId, config = {}, catalog = [], configurationReady = false } = input;
  const base = analyzeReconciliation({ localInvoices, localCustomers, ...inventory, mappings, workspaceId, tenantId, configurationReady });
  const accounting = linkedAccounting(inventory.invoices, inventory.payments, inventory.credits, inventory.deposits);
  const active = inventory.invoices.filter(raw => !isVoided(raw));
  const normalized = new Map(active.map(raw => [raw.Id, normalizeInvoice(raw)]));
  const context = { ...inventory, records: base.records, mappings, tenantId, config, catalog, accounting };
  const allRecords = new Map(base.records.map(record => [record.elsetInvoiceId, record]));
  const owners = new Map(active.map(raw => [raw.Id, base.records.filter(record => record.customerResolution.safe && headerBusinessMatch(record.normalizedInvoice, normalized.get(raw.Id))).map(record => record.elsetInvoiceId)]));
  const plans = localInvoices.filter(source => inRange(source.date, range)).map(source => {
    const record = allRecords.get(source.id), a = record.normalizedInvoice;
    const candidates = active.flatMap(raw => {
      const b = normalized.get(raw.Id), original = [...record.candidates, ...record.possibleCandidates].find(row => row.id === raw.Id);
      const sameCustomer = Boolean(a.customerId && a.customerId === b.customerId), sameDate = a.date === b.date, sameAmounts = amountsMatch(a, b), sameLines = lineBag(a) === lineBag(b);
      const mapped = record.mappedQuickbooksId === raw.Id, marked = String(raw.PrivateNote || "").includes(invoiceMarker(workspaceId, source.id)), exactNumber = raw.DocNumber === source.number;
      if (!original && !mapped && !marked && !exactNumber && !(sameCustomer && (sameDate && sameAmounts || sameLines && sameAmounts)) && !(sameDate && sameAmounts && sameLines)) return [];
      const comparison = compareCandidate(record, source, raw, context), evidence = paymentEvidence(raw, inventory, accounting);
      const fullMatch = comparison.businessMatch && record.customerResolution.safe;
      const otherOwners = (owners.get(raw.Id) || []).filter(id => id !== source.id);
      const otherMapping = mappings.some(m => m.provider === "quickbooks" && m.external_tenant_id === tenantId && m.local_entity_type === "invoice" && m.external_entity_id === raw.Id && m.local_entity_id !== source.id);
      const trustedIdentity = fullMatch || marked && (sameCustomer || sameLines || sameAmounts) || mapped && (sameCustomer || sameLines && sameAmounts)
        || exactNumber && [sameCustomer, sameDate, sameAmounts, sameLines].filter(Boolean).length >= 2
        || sameCustomer && sameAmounts && sameLines;
      const safeIdentity = trustedIdentity && !otherOwners.length && !otherMapping && record.customerResolution.safe;
      // Full matching paid history outranks a later unpaid saved mapping.
      const rank = [Number(fullMatch && evidence.legitimatePayments), Number(mapped), Number(exactNumber), Number(sameCustomer), Number(sameDate), Number(sameAmounts), Number(evidence.legitimatePayments), Number(sameLines)];
      return [{ id: raw.Id, rawHash: entityHash(raw), reviewedHash: reviewedInvoiceHash(raw), syncToken: raw.SyncToken, docNumber: raw.DocNumber, date: raw.TxnDate,
        sameCustomer, sameDate, sameAmounts, sameLines, fullMatch, mapped, marked, exactNumber, safeIdentity, rank,
        otherOwners: otherOwners.map(id => allRecords.get(id)?.invoiceNumber || id), otherMapping, inRange: inRange(raw.TxnDate, range),
        payment: evidence, comparison, evidence: unique([...(original?.reasons || []), ...(fullMatch ? ["FULL_BUSINESS_MATCH_IGNORE_LINE_ORDER"] : [])]) }];
    });
    const strong = candidates.filter(candidate => candidate.safeIdentity).sort((a, b) => {
      for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i];
      return 0;
    });
    const canonical = strong.length && (strong.length === 1 || JSON.stringify(strong[0].rank) !== JSON.stringify(strong[1].rank)) ? strong[0] : null;
    const result = { elsetInvoiceId: source.id, invoiceNumber: source.number, customer: source.customer?.name || "", date: source.date,
      subtotalCents: source.subtotalCents, gstCents: source.taxCents, totalCents: source.totalCents, paidCents: source.paidCents,
      sourceHash: sourceHash(source), customerResolution: record.customerResolution, previousMappingId: record.mappedQuickbooksId,
      canonicalId: canonical?.id || "", canonicalReason: canonical ? canonical.fullMatch && canonical.payment.legitimatePayments ? "Full financial/content match with verified receipt allocations; preserve accounting history before mapping preference." : "Unique strongest unambiguous identity using mapping, exact number, customer, date, totals and links." : "No single safely established canonical invoice.",
      candidates, actions: [], primaryAction: "LEAVE_REVIEW", updateFields: [], duplicateIds: [], reviews: [], warnings: [],
      itemPlan: source.lines.map(line => ({ lineId: line.id, ...expectedItem(line, context) })) };
    if (!source.eligible || !normalizeInvoice(source, { local: true, customerId: a.customerId || "new-customer" }).valid) result.reviews.push("ELSET_INELIGIBLE_OR_INVALID");
    if (!configurationReady) result.reviews.push("CONFIGURATION_REVIEW_REQUIRED");
    if (!record.customerResolution.safe) result.reviews.push("CUSTOMER_IDENTITY_REVIEW_REQUIRED");
    if (mappings.some(m => m.local_entity_type === "invoice" && m.local_entity_id === source.id && (m.provider !== "quickbooks" || m.external_tenant_id !== tenantId))) result.reviews.push("OTHER_ACCOUNTING_OWNER");
    if (result.reviews.length) return result;
    if (!canonical) {
      if (candidates.length || record.mappedQuickbooksId) result.reviews.push("CANONICAL_IDENTITY_REVIEW_REQUIRED");
      else {
        result.actions.push("CREATE_QB"); result.primaryAction = "CREATE_QB";
        if (source.paidCents > 0) result.warnings.push("ELSET has payments; new QB invoice will remain unpaid. No Payment is exported or changed.");
      }
      return result;
    }
    if (!canonical.inRange) { result.reviews.push("CANONICAL_OUTSIDE_DATE_RANGE_NO_TOUCH"); return result; }
    if (canonical.payment.inferredPaidCents !== source.paidCents) result.warnings.push("PAYMENT_AMOUNT_DIFFERENCE_NO_PAYMENT_MUTATION");
    if (!validVersion(active.find(raw => raw.Id === canonical.id))) { result.reviews.push("INVALID_SYNC_TOKEN"); return result; }
    const flags = canonical.comparison.flags;
    if (flags.DOC_NUMBER_DIFF) result.updateFields.push("DocNumber");
    if (flags.CUSTOMER_DIFF) result.updateFields.push("CustomerRef");
    if (flags.DATE_DIFF) result.updateFields.push("TxnDate");
    const contentChange = ["LINE_COUNT_DIFF", "DESCRIPTION_CONTENT_DIFF", "QTY_DIFF", "UNIT_PRICE_DIFF", "LINE_AMOUNT_DIFF", "SUBTOTAL_DIFF", "GST_DIFF", "TOTAL_DIFF", "CURRENCY_DIFF", "UNSUPPORTED_CONTENT"].some(key => flags[key]);
    if (contentChange) result.updateFields.push("Line", "TxnTaxDetail");
    if (canonical.payment.protected && result.updateFields.some(field => field !== "DocNumber")) result.reviews.push("LINKED_OR_SETTLED_INVOICE_CUSTOMER_DATE_FINANCIAL_CHANGE_REQUIRES_REVIEW");
    if (canonical.payment.protected && result.updateFields.length && !canonical.payment.legitimatePayments) result.reviews.push("UNVERIFIED_SETTLEMENT_OR_OTHER_ACCOUNTING_LINKS");
    if (flags.UNSUPPORTED_CONTENT) result.reviews.push("UNSUPPORTED_INVOICE_CONTENT");
    if (contentChange && active.find(raw => raw.Id === canonical.id).Line.some(line => line.DetailType === "SalesItemLineDetail"
      && Object.keys(line.SalesItemLineDetail || {}).some(key => !["ItemRef", "TaxCodeRef", "Qty", "UnitPrice", "ItemAccountRef"].includes(key)))) result.reviews.push("UNMANAGED_LINE_ATTRIBUTES_REVIEW_REQUIRED");
    for (const duplicate of candidates.filter(candidate => candidate.id !== canonical.id && candidate.fullMatch)) {
      const obvious = canonical.fullMatch && (duplicate.docNumber === canonical.docNumber || duplicate.marked || canonical.marked || duplicate.mapped && canonical.payment.legitimatePayments);
      if (!obvious || duplicate.otherOwners.length || duplicate.otherMapping) { result.warnings.push(`POSSIBLE_DUPLICATE_REVIEW:${duplicate.id}`); continue; }
      if (!duplicate.inRange) { result.warnings.push(`DUPLICATE_OUTSIDE_DATE_RANGE_LEAVE:${duplicate.id}`); continue; }
      if (!duplicate.payment.unlinkedUnpaid) { result.warnings.push(`LINKED_DUPLICATE_PRESERVED:${duplicate.id}`); continue; }
      if (!validVersion(active.find(raw => raw.Id === duplicate.id))) { result.warnings.push(`DUPLICATE_INVALID_SYNC_TOKEN:${duplicate.id}`); continue; }
      result.duplicateIds.push(duplicate.id);
    }
    const numberConflicts = active.filter(raw => raw.Id !== canonical.id && raw.DocNumber === source.number);
    if (result.updateFields.includes("DocNumber") && numberConflicts.some(raw => !result.duplicateIds.includes(raw.Id))) result.reviews.push("DESIRED_NUMBER_USED_BY_NON_VOIDABLE_RECORD");
    if (result.reviews.length) return result;
    if (result.updateFields.length) result.actions.push("UPDATE_QB_TO_ELSET");
    if (record.mappedQuickbooksId !== canonical.id) result.actions.push(record.mappedQuickbooksId ? "REMAP_TO_DIFFERENT_QB_RECORD" : "LINK_EXISTING_QB_RECORD");
    if (result.duplicateIds.length) result.actions.push("VOID_DUPLICATE");
    if (!result.actions.includes("UPDATE_QB_TO_ELSET")) result.actions.push("KEEP_AS_IS");
    result.primaryAction = result.actions.includes("REMAP_TO_DIFFERENT_QB_RECORD") ? "REMAP_TO_DIFFERENT_QB_RECORD" : result.actions.includes("UPDATE_QB_TO_ELSET") ? "UPDATE_QB_TO_ELSET" : "KEEP_AS_IS";
    if (result.duplicateIds.some(id => active.find(raw => raw.Id === id).DocNumber === source.number)) result.warnings.push("Before void, give the unlinked duplicate a unique VOID-<id> reference to release the canonical invoice number; retain its original number in the archive and audit log.");
    return result;
  });
  // An invoice selected by competing local records never becomes two mappings.
  const chosenIds = plans.filter(row => !row.reviews.length).map(row => row.canonicalId).filter(Boolean);
  for (const row of plans) if (row.canonicalId && chosenIds.filter(id => id === row.canonicalId).length > 1) {
    row.reviews.push("SHARED_CANONICAL_REVIEW_REQUIRED"); row.actions = []; row.primaryAction = "LEAVE_REVIEW";
  }
  const canonicalIds = new Set(plans.filter(row => !row.reviews.length).map(row => row.canonicalId).filter(Boolean));
  const duplicateRows = plans.filter(row => !row.reviews.length).flatMap(row => row.duplicateIds.map(id => ({ qbId: id, elsetInvoiceId: row.elsetInvoiceId, invoiceNumber: row.invoiceNumber, canonicalId: row.canonicalId,
    action: canonicalIds.has(id) ? "LEAVE_REVIEW" : "VOID_DUPLICATE", releaseDocNumber: inventory.invoices.find(raw => raw.Id === id).DocNumber === row.invoiceNumber ? `VOID-${id}` : "" })));
  for (const row of plans) {
    const blocked = duplicateRows.filter(d => d.elsetInvoiceId === row.elsetInvoiceId && d.action === "LEAVE_REVIEW");
    if (blocked.length) { row.reviews.push("DUPLICATE_IS_ANOTHER_CANONICAL"); row.actions = []; row.primaryAction = "LEAVE_REVIEW"; }
  }
  const qbOnly = inventory.invoices.filter(raw => inRange(raw.TxnDate, range) && !canonicalIds.has(raw.Id) && !duplicateRows.some(d => d.qbId === raw.Id)).map(raw => ({ qbId: raw.Id, docNumber: raw.DocNumber, date: raw.TxnDate, totalCents: scaled(raw.TotalAmt), balanceCents: scaled(raw.Balance), linkedTransactions: accounting.get(raw.Id).links,
    action: "LEAVE_REPORT", reason: isVoided(raw) ? "ALREADY_VOIDED" : "No proven unlinked duplicate relationship; absence from ELSET is not evidence of junk." }));
  const paymentRows = plans.filter(row => row.candidates.find(c => c.id === row.canonicalId)?.payment.hasPayments);
  const credits = plans.filter(row => row.candidates.find(c => c.id === row.canonicalId)?.payment.hasCredits);
  const summary = { elsetInvoicesInRange: plans.length, elsetInvoicesOutsideRange: localInvoices.length - plans.length, quickbooksInvoicesInRange: inventory.invoices.filter(raw => inRange(raw.TxnDate, range)).length,
    primaryActions: Object.fromEntries(resetActions.filter(a => a !== "VOID_DUPLICATE").map(action => [action, plans.filter(row => row.primaryAction === action).length])),
    operations: Object.fromEntries([...resetActions, "LINK_EXISTING_QB_RECORD"].map(action => [action, action === "VOID_DUPLICATE" ? duplicateRows.filter(row => row.action === action).length : action === "LEAVE_REVIEW" ? plans.filter(row => row.reviews.length).length : plans.filter(row => row.actions.includes(action)).length])),
    recordsWithPayments: paymentRows.length, elsetRecordsWithPayments: plans.filter(row => row.paidCents > 0).length, recordsWithCredits: credits.length, recordsSkippedForSafety: plans.filter(row => row.reviews.length).length,
    qbOnlyLeaveReport: qbOnly.length, linkedDuplicatesPreserved: plans.reduce((n, row) => n + row.warnings.filter(w => w.startsWith("LINKED_DUPLICATE_PRESERVED:")).length, 0) };
  return { schema: "elset-quickbooks-authoritative-reset-v1", range: { from: range.from, to: range.to }, companyId: tenantId, summary, records: plans, duplicates: duplicateRows, qbOnly,
    policy: "ELSET authoritative; preserve linked history. No Payment mutations or sends. Local issue date and each QB target's current TxnDate must both be in range. All-history reads detect cross-cutoff collisions. Cosmetic items/order/format are preserved. Actions overlap; primaryActions are exclusive." };
}

export function meaningfulMatch(source, raw, customerId) {
  const a = normalizeInvoice(source, { local: true, customerId }), b = normalizeInvoice(raw);
  return raw.DocNumber === source.number && headerBusinessMatch(a, b) && b.valid && !isVoided(raw);
}
export function invoiceUpdatePayload(source, raw, customerId, config, fields) {
  const payload = { Id: raw.Id, SyncToken: String(raw.SyncToken), sparse: true };
  if (fields.includes("DocNumber")) payload.DocNumber = source.number;
  if (fields.includes("CustomerRef")) payload.CustomerRef = { value: customerId };
  if (fields.includes("TxnDate")) payload.TxnDate = source.date;
  if (fields.includes("Line")) {
    const existing = (raw.Line || []).filter(line => line.DetailType === "SalesItemLineDetail");
    const used = new Set();
    payload.GlobalTaxCalculation = "TaxExcluded";
    payload.CurrencyRef = { value: source.currency };
    payload.Line = source.lines.map((line, index) => {
      const matches = existing.filter(old => !used.has(old) && normalizeDescription(old.Description) === normalizeDescription(line.description));
      const previous = matches.length === 1 ? matches[0] : !used.has(existing[index]) ? existing[index] : existing.find(old => !used.has(old));
      if (previous) used.add(previous);
      return { ...(previous?.Id ? { Id: previous.Id } : {}), DetailType: "SalesItemLineDetail", Description: line.description, Amount: line.amountCents / 100,
        SalesItemLineDetail: { ItemRef: { value: previous?.SalesItemLineDetail?.ItemRef?.value || config.itemId }, Qty: line.quantity, UnitPrice: line.unitAmountCents / 100, TaxCodeRef: { value: config.taxMappings[line.taxTreatment] } } };
    });
    payload.TxnTaxDetail = { TotalTax: source.taxCents / 100 };
  }
  return payload;
}
