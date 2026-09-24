// TEMPORARY: full-history, read-only reconciliation and review reports.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decimalToScaledInteger } from "../server-workspace-importer.js";

export const normalized = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const fingerprint = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function scaled(value, scale = 100) {
  if (!["number", "string"].includes(typeof value) || !/^-?\d+(?:\.\d+)?$/.test(String(value))) return null;
  try { return decimalToScaledInteger(value, scale); } catch { return null; }
}
const unique = entries => [...new Set(entries)];
const id = row => row?.Id || "";
const ref = value => value?.value || "";
const invoiceClasses = ["EXACT_MATCH", "MISSING_IN_QB", "DIFFERENT_IN_QB", "MULTIPLE_QB_CANDIDATES", "MAPPING_BROKEN", "VOIDED_IN_QB"];
const qbClasses = ["CANONICAL_ELSET_MATCH", "LIKELY_DUPLICATE", "QB_ONLY", "AMBIGUOUS_QB_ONLY", "VOIDED"];
const actions = ["NONE", "CREATE_QB_INVOICE", "LINK_EXISTING_QB_INVOICE", "UPDATE_QB_INVOICE_TO_ELSET", "VOID_QB_DUPLICATE", "REVIEW_DUPLICATE", "REVIEW_QB_ONLY", "REVIEW_PAYMENT", "REVIEW_CONFLICT"];
const markers = row => unique([row.PrivateNote, row.CustomerMemo?.value, row.Memo].filter(Boolean).join("\n").match(/ELSET:ops-[a-f0-9]+|(?:servicem8|sm8)[\s:#=/|-]+[a-z0-9-]{6,}/gi) || []).map(normalized);
const voided = row => /^voided\b/i.test(row.PrivateNote || "") || ["void", "voided"].includes(normalized(row.TxnStatus));

export function normalizeInvoice(row, { local = false, customerId = "", homeCurrency = "AUD" } = {}) {
  const lines = local ? row.lines.map(line => ({ kind: "SalesItemLineDetail", description: normalized(line.description), quantityMicros: scaled(line.quantity, 1_000_000),
    rateMicros: Number.isSafeInteger(line.unitAmountCents) ? line.unitAmountCents * 10000 : null, amountCents: line.amountCents }))
    : (row.Line || []).filter(line => line.DetailType !== "SubTotalLineDetail").map(line => ({ kind: line.DetailType || "Unknown", description: normalized(line.Description),
      quantityMicros: scaled(line.SalesItemLineDetail?.Qty, 1_000_000), rateMicros: scaled(line.SalesItemLineDetail?.UnitPrice, 1_000_000), amountCents: scaled(line.Amount),
      ...(line.DetailType === "DiscountLineDetail" ? { discount: { percentBased: line.DiscountLineDetail?.PercentBased, percentMicros: scaled(line.DiscountLineDetail?.DiscountPercent, 1_000_000) } } : {}) }));
  const totalCents = local ? row.totalCents : scaled(row.TotalAmt), taxCents = local ? row.taxCents : scaled(row.TxnTaxDetail?.TotalTax);
  const result = { number: local ? row.number : String(row.DocNumber || ""), customerId: local ? customerId : ref(row.CustomerRef),
    date: local ? row.date : row.TxnDate || "", currency: local ? row.currency : ref(row.CurrencyRef) || homeCurrency,
    lines, subtotalCents: local ? row.subtotalCents : totalCents === null || taxCents === null ? null : totalCents - taxCents, taxCents, totalCents };
  const { number: _number, ...business } = result;
  return { ...result, fingerprint: fingerprint(result), businessFingerprint: fingerprint(business), lineFingerprint: fingerprint(lines),
    valid: Boolean(result.date && result.customerId && lines.length && lines.every(line => line.kind === "SalesItemLineDetail"
      && [line.quantityMicros, line.rateMicros, line.amountCents].every(Number.isSafeInteger))) && [result.subtotalCents, taxCents, totalCents].every(Number.isSafeInteger) };
}

function compare(local, remote) {
  const flags = [];
  if (local.number !== remote.number) flags.push("NUMBER_DIFF");
  if (!local.customerId || local.customerId !== remote.customerId) flags.push("CUSTOMER_DIFF");
  if (!local.date || local.date !== remote.date) flags.push("DATE_DIFF");
  if (local.currency !== remote.currency) flags.push("CURRENCY_DIFF");
  if (!local.lines.length || local.lineFingerprint !== remote.lineFingerprint) flags.push("LINE_DIFF");
  if (!Number.isSafeInteger(remote.subtotalCents) || local.subtotalCents !== remote.subtotalCents) flags.push("SUBTOTAL_DIFF");
  if (!Number.isSafeInteger(remote.taxCents) || local.taxCents !== remote.taxCents) flags.push("GST_DIFF");
  if (!Number.isSafeInteger(remote.totalCents) || local.totalCents !== remote.totalCents) flags.push("TOTAL_DIFF");
  if (!remote.valid) flags.push("UNSUPPORTED_OR_INVALID_QB_CONTENT");
  return flags;
}

function transactionLinks(row) {
  const lines = row.Line || [];
  return [...(row.LinkedTxn || []), ...lines.flatMap(line => [...(line.LinkedTxn || []), ...(line.DepositLineDetail?.LinkedTxn || []), ...transactionLinks({ Line: line.GroupLineDetail?.Line || [] })])];
}
export function linkedAccounting(invoices, payments = [], credits = [], deposits = []) {
  const links = new Map(invoices.map(row => [row.Id, transactionLinks(row).map(link => ({ type: link.TxnType || "Unknown", id: link.TxnId || "", via: "invoice" }))]));
  const paymentInvoices = new Map();
  const add = (invoiceId, type, transactionId, via) => { if (links.has(invoiceId)) links.get(invoiceId).push({ type, id: transactionId, via }); };
  for (const payment of payments) {
    const associated = transactionLinks(payment), invoiceIds = unique(associated.filter(link => link.TxnType === "Invoice").map(link => link.TxnId));
    paymentInvoices.set(payment.Id, invoiceIds);
    for (const invoiceId of invoiceIds) {
      add(invoiceId, "Payment", payment.Id, "payment allocation");
      for (const link of associated.filter(link => !["Invoice", "Payment"].includes(link.TxnType))) add(invoiceId, link.TxnType || "Unknown", link.TxnId, `Payment ${payment.Id}`);
    }
  }
  for (const [type, records] of [["CreditMemo", credits], ["Deposit", deposits]]) for (const row of records) {
    for (const link of transactionLinks(row)) {
      if (link.TxnType === "Invoice") add(link.TxnId, type, row.Id, `${type} link`);
      if (link.TxnType === "Payment") for (const invoiceId of paymentInvoices.get(link.TxnId) || []) add(invoiceId, type, row.Id, `Payment ${link.TxnId}`);
    }
  }
  return new Map(invoices.map(row => {
    const connected = [...new Map(links.get(row.Id).map(link => [`${link.type}:${link.id}`, link])).values()];
    const flags = [];
    if (connected.some(link => link.type === "Payment")) flags.push("HAS_QB_PAYMENT");
    if (connected.some(link => /credit/i.test(link.type))) flags.push("HAS_QB_CREDIT");
    if (connected.some(link => /deposit/i.test(link.type)) || (scaled(row.Deposit) || 0) > 0) flags.push("HAS_QB_DEPOSIT");
    if (connected.length) flags.push("HAS_LINKED_TRANSACTION");
    const total = scaled(row.TotalAmt), balance = scaled(row.Balance);
    const protectedState = flags.length > 0 || !Number.isSafeInteger(balance) || !Number.isSafeInteger(total) || balance !== total || total <= 0 || voided(row);
    return [row.Id, { links: connected, flags, balanceCents: balance, protectedState }];
  }));
}

function resolveCustomer(source, customers, localCustomers, mappings, workspaceId, tenantId) {
  const mapping = mappings.find(row => row.provider === "quickbooks" && row.external_tenant_id === tenantId && row.local_entity_type === "customer" && row.local_entity_id === source.customerId);
  // Marker hashing in the existing service uses raw strings, not JSON strings.
  const marker = `ELSET:ops-${crypto.createHash("sha256").update(`${workspaceId}:${source.customerId}`).digest("hex").slice(0, 40)}`;
  const name = normalized(source.customer?.name), email = normalized(source.customer?.email);
  let matches = mapping ? customers.filter(row => row.Id === mapping.external_entity_id) : customers.filter(row => row.Notes === marker);
  if (!mapping && !matches.length) matches = customers.filter(row => (name && [row.DisplayName, row.CompanyName, row.FullyQualifiedName].some(value => normalized(value) === name))
    || (email && normalized(row.PrimaryEmailAddr?.Address) === email));
  const row = matches.length === 1 ? matches[0] : null;
  const localCollision = !mapping && localCustomers.some(customer => customer.id !== source.customerId && ((name && normalized(customer.name) === name) || (email && normalized(customer.email) === email)));
  const reverse = row && mappings.some(entry => entry.provider === "quickbooks" && entry.external_tenant_id === tenantId && entry.local_entity_type === "customer" && entry.external_entity_id === row.Id && entry.local_entity_id !== source.customerId);
  const contradicts = row && !mapping && row.Notes !== marker && (![row.DisplayName, row.CompanyName, row.FullyQualifiedName].some(value => normalized(value) === name)
    || (email && normalized(row.PrimaryEmailAddr?.Address) && normalized(row.PrimaryEmailAddr.Address) !== email) || (row.Notes?.startsWith("ELSET:") && row.Notes !== marker));
  const ambiguous = matches.length > 1 || localCollision || reverse || contradicts;
  return { id: !ambiguous && row ? row.Id : "", candidates: matches.map(id), mapped: Boolean(mapping),
    safe: !ambiguous && (row ? row.Active === true && !row.Job && !row.IsProject && !row.ParentRef?.value : !mapping && Boolean(name)),
    state: ambiguous ? "AMBIGUOUS" : row ? "MATCHED" : mapping ? "BROKEN" : "NEW",
    reason: ambiguous ? "Customer name/email candidates conflict or are not unique." : row ? "Existing mapping, exact marker or unique exact normalized customer identity." : mapping ? "Mapped customer is unavailable." : "No exact customer candidate; new customer would be needed." };
}

function candidateEvidence(local, remote, raw, marker) {
  const reasons = [];
  if (local.number && local.number === remote.number) reasons.push("EXACT_NUMBER");
  if (markers(raw).includes(normalized(marker))) reasons.push("ELSET_MARKER");
  if (local.valid && remote.valid && local.businessFingerprint === remote.businessFingerprint) reasons.push("EXACT_CUSTOMER_DATE_LINES_TOTALS");
  if (local.customerId && local.customerId === remote.customerId && local.date && local.date === remote.date
    && local.totalCents === remote.totalCents && local.lines.length && local.lines.map(line => line.description).join("\n") === remote.lines.map(line => line.description).join("\n")) reasons.push("SAME_CUSTOMER_DATE_TOTAL_DESCRIPTIONS");
  // Legacy numeric DocNumbers are evidence, never equality or write authority.
  // Even an uncorroborated numeric collision must block creating a duplicate.
  const numberKey = value => String(value || "").match(/^(?:INV[- ]?)?0*(\d+)$/i)?.[1];
  if (local.number !== remote.number && numberKey(local.number) && numberKey(local.number) === numberKey(remote.number)) {
    const sameCustomer = local.customerId && local.customerId === remote.customerId, sameDate = local.date && local.date === remote.date;
    const sameTotal = Number.isSafeInteger(local.totalCents) && local.totalCents === remote.totalCents, sameLines = local.lines.length && local.lineFingerprint === remote.lineFingerprint;
    reasons.push((sameCustomer && (sameDate || sameTotal || sameLines)) || (sameDate && (sameTotal || sameLines)) ? "NUMBER_VARIANT_WITH_CORROBORATION" : "NUMBER_VARIANT_ONLY");
  }
  return unique(reasons);
}

export function analyzeReconciliation({ localInvoices, localCustomers, invoices, customers, payments = [], credits = [], deposits = [], mappings = [], workspaceId, tenantId, homeCurrency = "AUD", configurationReady = false, canUpdate = () => false }) {
  const remote = new Map(invoices.map(row => [row.Id, normalizeInvoice(row, { homeCurrency })]));
  const accounting = linkedAccounting(invoices, payments, credits, deposits);
  const claimed = new Map();
  const records = localInvoices.map(source => {
    const customer = resolveCustomer(source, customers, localCustomers, mappings, workspaceId, tenantId);
    const normalizedInvoice = normalizeInvoice(source, { local: true, customerId: customer.id });
    const mapping = mappings.find(row => row.provider === "quickbooks" && row.external_tenant_id === tenantId && row.local_entity_type === "invoice" && row.local_entity_id === source.id);
    const foreignMapping = mappings.some(row => row.local_entity_type === "invoice" && row.local_entity_id === source.id && (row.provider !== "quickbooks" || row.external_tenant_id !== tenantId));
    const marker = `ELSET:ops-${crypto.createHash("sha256").update(`${workspaceId}:${source.id}`).digest("hex").slice(0, 24)}`;
    const allCandidates = invoices.flatMap(raw => {
      const reasons = candidateEvidence(normalizedInvoice, remote.get(raw.Id), raw, marker);
      if (mapping?.external_entity_id === raw.Id) reasons.unshift("EXISTING_MAPPING");
      if (!reasons.length) return [];
      const entries = claimed.get(raw.Id) || []; entries.push(source.id); claimed.set(raw.Id, entries);
      return [{ id: raw.Id, reasons, score: reasons.includes("EXISTING_MAPPING") ? 100 : reasons.includes("ELSET_MARKER") ? 95 : reasons.includes("EXACT_NUMBER") && reasons.includes("EXACT_CUSTOMER_DATE_LINES_TOTALS") ? 90 : reasons.includes("EXACT_NUMBER") ? 70 : 50 }];
    });
    const possibleCandidates = allCandidates.filter(candidate => candidate.reasons.length === 1 && candidate.reasons[0] === "NUMBER_VARIANT_ONLY");
    const candidates = allCandidates.filter(candidate => !possibleCandidates.includes(candidate));
    const mappedRaw = mapping && invoices.find(row => row.Id === mapping.external_entity_id);
    const broken = Boolean(mapping && (!mappedRaw || (markers(mappedRaw).some(value => value.startsWith("elset:") && value !== normalized(marker)))
      || (mappedRaw.DocNumber !== source.number && !markers(mappedRaw).includes(normalized(marker)) && normalizedInvoice.businessFingerprint !== remote.get(mappedRaw.Id).businessFingerprint)));
    let selected = !broken && mappedRaw ? mappedRaw : !mapping && candidates.length === 1 ? invoices.find(row => row.Id === candidates[0].id) : null;
    let classification = broken || foreignMapping ? "MAPPING_BROKEN" : candidates.length > 1 && !mapping ? "MULTIPLE_QB_CANDIDATES" : !selected ? "MISSING_IN_QB"
      : voided(selected) && source.eligible ? "VOIDED_IN_QB" : compare(normalizedInvoice, remote.get(selected.Id)).length ? "DIFFERENT_IN_QB" : "EXACT_MATCH";
    if (classification === "MAPPING_BROKEN") selected = null;
    const flags = [...(!source.eligible ? ["ELSET_INELIGIBLE"] : []), ...(!customer.safe ? ["CUSTOMER_REVIEW"] : []), ...(foreignMapping ? ["OTHER_ACCOUNTING_OWNER"] : []),
      ...(allCandidates.some(candidate => candidate.reasons.some(reason => reason.startsWith("NUMBER_VARIANT"))) ? ["NUMBER_VARIANT_REVIEW"] : []),
      ...(selected ? [...compare(normalizedInvoice, remote.get(selected.Id)), ...accounting.get(selected.Id).flags] : [])];
    const balance = selected ? accounting.get(selected.Id).balanceCents : null;
    const paymentMatch = selected && customer.safe && customer.id && !flags.includes("CUSTOMER_DIFF") && Number.isSafeInteger(balance) && source.totalCents === remote.get(selected.Id).totalCents && source.totalCents - balance === source.paidCents
      && balance >= 0 && balance <= source.totalCents && !flags.some(flag => ["HAS_QB_CREDIT", "HAS_QB_DEPOSIT"].includes(flag));
    if (!paymentMatch) flags.push("PAYMENT_BALANCE_DIFF");
    let proposedAction = "REVIEW_CONFLICT";
    if (!source.eligible) proposedAction = "NONE";
    else if (classification === "EXACT_MATCH") proposedAction = mapping ? "NONE" : customer.safe ? "LINK_EXISTING_QB_INVOICE" : "REVIEW_CONFLICT";
    else if (classification === "MISSING_IN_QB") proposedAction = customer.safe && configurationReady && !possibleCandidates.length ? "CREATE_QB_INVOICE" : "REVIEW_CONFLICT";
    else if (classification === "MULTIPLE_QB_CANDIDATES") proposedAction = "REVIEW_DUPLICATE";
    else if (classification === "DIFFERENT_IN_QB" && selected) {
      const reliableIdentity = mapping || candidates[0]?.reasons.includes("ELSET_MARKER") || (candidates[0]?.reasons.includes("EXACT_NUMBER") && !flags.includes("CUSTOMER_DIFF") && (!flags.includes("DATE_DIFF") || !flags.includes("LINE_DIFF")));
      proposedAction = accounting.get(selected.Id).protectedState ? "REVIEW_PAYMENT" : reliableIdentity && customer.safe && configurationReady && canUpdate(selected) ? "UPDATE_QB_INVOICE_TO_ELSET" : "REVIEW_CONFLICT";
    }
    return { elsetInvoiceId: source.id, invoiceNumber: source.number, customer: source.customer?.name || "", invoiceDate: source.date,
      eligible: source.eligible, eligibilityReason: source.reason || "", elsetTotalCents: source.totalCents, elsetPaidCents: source.paidCents,
      classification, flags: unique(flags), proposedAction, configurationBlocked: !configurationReady && ["MISSING_IN_QB", "DIFFERENT_IN_QB"].includes(classification),
      quickbooksInvoiceId: selected?.Id || "", quickbooksBalanceCents: balance, candidates, possibleCandidates, customerResolution: customer,
      paymentDiscrepancy: paymentMatch ? "PAYMENT_MATCH" : "PAYMENT_REVIEW_REQUIRED", fingerprint: normalizedInvoice.fingerprint, normalizedInvoice,
      mappedQuickbooksId: mapping?.external_entity_id || "" };
  });
  // One external invoice cannot be silently adopted by two local invoices.
  for (const row of records) {
    if (row.quickbooksInvoiceId && unique(claimed.get(row.quickbooksInvoiceId) || []).length > 1) {
      row.flags.push("SHARED_QB_CANDIDATE"); row.proposedAction = "REVIEW_CONFLICT";
      row.paymentDiscrepancy = "PAYMENT_REVIEW_REQUIRED";
      if (!row.flags.includes("PAYMENT_BALANCE_DIFF")) row.flags.push("PAYMENT_IDENTITY_REVIEW");
      if (!row.mappedQuickbooksId) { row.classification = "MULTIPLE_QB_CANDIDATES"; row.quickbooksInvoiceId = ""; }
    }
  }
  const canonical = new Map(records.filter(row => row.quickbooksInvoiceId && row.customerResolution.safe && !row.flags.some(flag => ["SHARED_QB_CANDIDATE", "CUSTOMER_DIFF"].includes(flag))).map(row => [row.quickbooksInvoiceId, row]));
  // A unique exact match may be proposed as canonical within a variant group.
  for (const row of records.filter(row => row.classification === "MULTIPLE_QB_CANDIDATES" && row.eligible)) {
    const exact = row.candidates.filter(candidate => !voided(invoices.find(raw => raw.Id === candidate.id)) && !compare(row.normalizedInvoice, remote.get(candidate.id)).length
      && unique(claimed.get(candidate.id) || []).length === 1);
    if (exact.length === 1) { canonical.set(exact[0].id, row); row.proposedCanonicalId = exact[0].id; }
  }
  const pairs = [];
  for (let a = 0; a < invoices.length; a++) for (let b = a + 1; b < invoices.length; b++) {
    const left = invoices[a], right = invoices[b], ln = remote.get(left.Id), rn = remote.get(right.Id), reasons = [];
    if (ln.number && ln.number === rn.number) reasons.push("SAME_DOC_NUMBER");
    if (markers(left).some(marker => markers(right).includes(marker))) reasons.push("SHARED_SOURCE_MARKER");
    if (ln.valid && rn.valid && ln.businessFingerprint === rn.businessFingerprint) reasons.push("EXACT_CUSTOMER_DATE_LINES_TOTALS");
    const createdGap = Math.abs(Date.parse(left.MetaData?.CreateTime) - Date.parse(right.MetaData?.CreateTime));
    if (ln.customerId && ln.customerId === rn.customerId && ln.date === rn.date && ln.lines.length && ln.lines.length === rn.lines.length
      && ln.lines.every((line, index) => line.description === rn.lines[index].description) && createdGap <= 300000
      && Number.isSafeInteger(ln.totalCents) && Number.isSafeInteger(rn.totalCents) && Math.abs(ln.totalCents - rn.totalCents) <= Math.max(100, Math.floor(Math.abs(ln.totalCents) / 20))) reasons.push("NEAR_IDENTICAL_CREATED_WITHIN_5_MINUTES");
    if (reasons.length) pairs.push({ ids: [left.Id, right.Id], reasons });
  }
  const parent = new Map(invoices.map(row => [row.Id, row.Id]));
  const root = value => { while (parent.get(value) !== value) value = parent.get(value); return value; };
  for (const pair of pairs) parent.set(root(pair.ids[1]), root(pair.ids[0]));
  const grouped = new Map();
  for (const row of invoices) { const key = root(row.Id); grouped.set(key, [...(grouped.get(key) || []), row.Id]); }
  const duplicateGroups = [];
  const duplicate = new Map();
  for (const ids of grouped.values()) {
    if (ids.length < 2) continue;
    const canonicalIds = ids.filter(value => canonical.has(value));
    const selected = canonicalIds.length === 1 ? canonicalIds[0] : "";
    const local = selected ? canonical.get(selected) : null;
    const group = { id: `group-${duplicateGroups.length + 1}`, proposedCanonicalId: selected, elsetInvoiceNumber: local?.invoiceNumber || "",
      reason: selected ? local.mappedQuickbooksId === selected ? "Existing ELSET mapping identifies the canonical invoice." : "Only one candidate exactly matches the current ELSET content and number." : "No uniquely safe canonical ELSET invoice; human review required.",
      evidence: pairs.filter(pair => ids.includes(pair.ids[0]) && ids.includes(pair.ids[1])), invoices: [] };
    for (const value of ids) {
      const raw = invoices.find(row => row.Id === value), info = accounting.get(value), normalizedInvoice = remote.get(value);
      const pair = selected && pairs.find(entry => entry.ids.includes(selected) && entry.ids.includes(value));
      const mappedElsewhere = mappings.some(entry => entry.provider === "quickbooks" && entry.external_tenant_id === tenantId && entry.local_entity_type === "invoice" && entry.external_entity_id === value);
      const extremelyStrong = selected && local?.eligible && !compare(local.normalizedInvoice, remote.get(selected)).length && value !== selected && remote.get(selected).valid && normalizedInvoice.valid && remote.get(selected).businessFingerprint === normalizedInvoice.businessFingerprint
        && pair?.reasons.some(reason => ["SAME_DOC_NUMBER", "SHARED_SOURCE_MARKER", "NEAR_IDENTICAL_CREATED_WITHIN_5_MINUTES"].includes(reason));
      const proposedAction = value === selected || voided(raw) ? "NONE" : selected && extremelyStrong && !mappedElsewhere && !info.protectedState && /^\d+$/.test(String(raw.SyncToken ?? "")) ? "VOID_QB_DUPLICATE" : "REVIEW_DUPLICATE";
      const entry = { qbInvoiceId: value, qbDocNumber: raw.DocNumber || "", qbCustomer: customers.find(customer => customer.Id === ref(raw.CustomerRef))?.DisplayName || ref(raw.CustomerRef),
        qbDate: raw.TxnDate || "", qbTotalCents: normalizedInvoice.totalCents, qbBalanceCents: info.balanceCents, qbLinkedTransactionCount: info.links.length,
        linkedTransactions: info.links, flags: info.flags, metadata: raw.MetaData || {}, syncToken: raw.SyncToken, fingerprint: normalizedInvoice.fingerprint,
        proposedCanonical: value === selected, proposedAction, matchReasons: group.evidence.filter(edge => edge.ids.includes(value)).flatMap(edge => edge.reasons) };
      group.invoices.push(entry);
      if (value !== selected) duplicate.set(value, { group, entry, local });
    }
    duplicateGroups.push(group);
  }
  const quickbooksRecords = invoices.map(raw => {
    const linked = accounting.get(raw.Id), local = canonical.get(raw.Id), dupe = duplicate.get(raw.Id), candidates = unique(claimed.get(raw.Id) || []);
    const classification = voided(raw) ? "VOIDED" : local ? "CANONICAL_ELSET_MATCH" : dupe?.local ? "LIKELY_DUPLICATE" : candidates.length || dupe ? "AMBIGUOUS_QB_ONLY" : "QB_ONLY";
    return { qbInvoiceId: raw.Id, invoiceNumber: raw.DocNumber || "", customer: customers.find(customer => customer.Id === ref(raw.CustomerRef))?.DisplayName || ref(raw.CustomerRef), date: raw.TxnDate || "",
      classification, proposedAction: voided(raw) ? linked.links.length ? "REVIEW_PAYMENT" : "NONE" : local ? local.proposedAction : dupe ? dupe.entry.proposedAction : candidates.length ? "REVIEW_CONFLICT" : "REVIEW_QB_ONLY",
      elsetInvoiceId: local?.elsetInvoiceId || "", elsetCandidates: candidates, totalCents: remote.get(raw.Id).totalCents,
      balanceCents: linked.balanceCents, linkedTransactions: linked.links, flags: linked.flags, syncToken: raw.SyncToken, metadata: raw.MetaData || {},
      fingerprint: remote.get(raw.Id).fingerprint, normalizedInvoice: remote.get(raw.Id) };
  });
  // Every action is a proposal; accounting edits always require a fresh read and archive.
  const summary = { elsetInvoices: records.length, eligibleElsetInvoices: records.filter(row => row.eligible).length, quickbooksInvoices: quickbooksRecords.length,
    elset: Object.fromEntries(invoiceClasses.map(key => [key, records.filter(row => row.classification === key).length])),
    quickbooks: Object.fromEntries(qbClasses.map(key => [key, quickbooksRecords.filter(row => row.classification === key).length])),
    linkedPayments: quickbooksRecords.filter(row => row.flags.includes("HAS_QB_PAYMENT")).length, linkedCredits: quickbooksRecords.filter(row => row.flags.includes("HAS_QB_CREDIT")).length,
    paymentReviewRequired: records.filter(row => row.eligible && row.paymentDiscrepancy === "PAYMENT_REVIEW_REQUIRED").length, duplicateGroups: duplicateGroups.length,
    proposedActions: Object.fromEntries(actions.map(key => [key, records.filter(row => row.proposedAction === key).length + quickbooksRecords.filter(row => !row.elsetInvoiceId && row.proposedAction === key).length])) };
  return { records, quickbooksRecords, duplicateGroups, summary };
}

// Invoice entities are archived, not HTTP responses or integration records.
// Strip any credential-shaped keys defensively while preserving SyncToken.
export function withoutSecrets(value) {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|encryption[_-]?key|oauth[_-]?code|webhook[_-]?verifier[_-]?token)$/i.test(key)).map(([key, entry]) => [key, withoutSecrets(entry)]));
  return value;
}
function csv(rows, columns) {
  const cell = value => { let result = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? ""); result = result.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " "); if (/^\s*[=+@-]/.test(result)) result = `'${result}`; return `"${result.replaceAll('"', '""')}"`; };
  return [columns.join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\n");
}
export function writeReconciliationReports(report, directory, timestamp) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const base = path.join(directory, `quickbooks-reconciliation-${timestamp}`), duplicates = path.join(directory, `quickbooks-duplicate-review-${timestamp}.csv`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(withoutSecrets(report), null, 2), { mode: 0o600 });
  const rows = [...(report.records || []).map(row => ({ side: "ELSET", ...row, totalCents: row.elsetTotalCents, paidCents: row.elsetPaidCents, balanceCents: row.quickbooksBalanceCents })),
    ...(report.quickbooksRecords || []).map(row => ({ side: "QuickBooks", ...row, invoiceDate: row.date, quickbooksInvoiceId: row.qbInvoiceId }))];
  fs.writeFileSync(`${base}.csv`, csv(rows, ["side", "elsetInvoiceId", "invoiceNumber", "customer", "invoiceDate", "totalCents", "paidCents", "balanceCents", "quickbooksInvoiceId", "classification", "flags", "proposedAction", "paymentDiscrepancy", "eligibilityReason", "candidates", "possibleCandidates", "fingerprint"]), { mode: 0o600 });
  const duplicateRows = (report.duplicateGroups || []).flatMap(group => group.invoices.map(row => ({ groupId: group.id, elsetInvoiceNumber: group.elsetInvoiceNumber,
    elsetCustomer: report.records.find(local => local.invoiceNumber === group.elsetInvoiceNumber)?.customer || "", elsetTotal: report.records.find(local => local.invoiceNumber === group.elsetInvoiceNumber)?.elsetTotalCents,
    ...row, qbTotal: row.qbTotalCents, qbBalance: row.qbBalanceCents, canonicalReason: group.reason })));
  fs.writeFileSync(duplicates, csv(duplicateRows, ["groupId", "elsetInvoiceNumber", "elsetCustomer", "elsetTotal", "qbInvoiceId", "qbDocNumber", "qbCustomer", "qbDate", "qbTotal", "qbBalance", "qbLinkedTransactionCount", "linkedTransactions", "metadata", "matchReasons", "proposedCanonical", "canonicalReason", "proposedAction"]), { mode: 0o600 });
  return { json: `${base}.json`, csv: `${base}.csv`, duplicates };
}
