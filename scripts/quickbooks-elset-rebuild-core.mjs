// Temporary, explicit rebuild. No database or network access in this module.
import crypto from "node:crypto";

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hash = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const fail = (code, message = code) => { const error = new Error(message); error.code = code; throw error; };
const id = value => typeof value === "string" && /^\d+$/.test(value);
const cents = value => Number.isFinite(value) ? Math.round(value * 100) : NaN;
const ref = value => value?.value || "";
const norm = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const dateOK = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const links = row => [...(row.LinkedTxn || []), ...(row.Line || []).flatMap(line => [...(line.LinkedTxn || []), ...(line.DepositLineDetail?.LinkedTxn || [])])];
export const stableEntity = row => {
  const { SyncToken: _version, MetaData: _metadata, ...facts } = row;
  return facts;
};
export const invoiceBeforeDelete = row => {
  const { Balance: _balance, LinkedTxn: _links, InvoiceLink: _generatedLink, ...facts } = stableEntity(row);
  // Query includes this false default on some invoices while a direct read omits it.
  return { ...facts, FreeFormAddress: facts.FreeFormAddress ?? false };
};
export const paymentBeforeDelete = row => ({
  ...stableEntity(row),
  Line: (row.Line || []).map(line => ({ ...line, ...(line.LineEx ? { LineEx: { ...line.LineEx,
    // QuickBooks recalculates this display-only invoice balance after another receipt is removed.
    any: (line.LineEx.any || []).filter(entry => entry.value?.Name !== "txnOpenBalance"),
  } } : {}) })),
});
export const marker = (workspace, kind, localId) => `ELSET:rebuild-${kind}-${hash([workspace, kind, localId]).slice(0, 32)}`;

function customerPlan(input, source, reuseNamedCustomerIds) {
  const note = marker(input.workspaceId, "customer", source.customerId);
  const customer = source.customer;
  const mapping = input.mappings.find(row => row.provider === "quickbooks" && row.external_tenant_id === input.tenantId && row.local_entity_type === "customer" && row.local_entity_id === source.customerId);
  const eligible = row => row?.Active === true && !row.Job && !row.IsProject && !row.ParentRef?.value;
  const owns = row => !input.mappings.some(m => m.provider === "quickbooks" && m.external_tenant_id === input.tenantId && m.local_entity_type === "customer" && m.external_entity_id === row.Id && m.local_entity_id !== source.customerId);
  const marked = input.inventory.customers.filter(row => row.Notes === note);
  if (marked.length > 1) fail("DUPLICATE_CUSTOMER_MARKER");
  let target = mapping ? input.inventory.customers.find(row => row.Id === mapping.external_entity_id) : marked[0];
  if (mapping && (!eligible(target) || !owns(target))) fail("EXISTING_CUSTOMER_MAPPING_INVALID");
  if (!target) {
    const localNames = new Set(input.localInvoices.filter(row => norm(row.customer.name) === norm(customer.name)).map(row => row.customerId));
    const matches = input.inventory.customers.filter(row => eligible(row) && owns(row) && norm(row.DisplayName) === norm(customer.name)
      && (!customer.email || !row.PrimaryEmailAddr?.Address || norm(row.PrimaryEmailAddr.Address) === norm(customer.email) || reuseNamedCustomerIds.includes(row.Id)));
    if (localNames.size === 1 && matches.length === 1) target = matches[0];
  }
  const suffix = ` [${hash([input.workspaceId, source.customerId]).slice(0, 12)}]`;
  const nameCollision = input.inventory.customers.some(row => norm(row.DisplayName) === norm(customer.name))
    || new Set(input.localInvoices.filter(row => norm(row.customer.name) === norm(customer.name)).map(row => row.customerId)).size > 1;
  const payload = { DisplayName: customer.name.trim().replace(/\s+/g, " ").slice(0, 500 - (nameCollision ? suffix.length : 0)) + (nameCollision ? suffix : ""), Notes: note,
    ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}),
    ...(customer.address ? { BillAddr: { Line1: customer.address } } : {}) };
  // New rebuild customers deliberately have no email address. No existing customer is edited.
  return { localId: source.customerId, externalId: target?.Id || "", previousId: mapping?.external_entity_id || "", name: customer.name, marker: note, payload };
}

export function buildRebuildPlan(input, { from, to, paymentAccountId, preserveExternalAccounts = true, reuseNamedCustomerIds = [], retainInvoiceIds = [] }) {
  if (!dateOK(from) || !dateOK(to) || from > to || !id(paymentAccountId)) fail("INVALID_REBUILD_SCOPE");
  if (!Array.isArray(reuseNamedCustomerIds) || reuseNamedCustomerIds.some(value => !id(value)) || new Set(reuseNamedCustomerIds).size !== reuseNamedCustomerIds.length) fail("INVALID_CUSTOMER_CONFIRMATIONS");
  if (!Array.isArray(retainInvoiceIds) || retainInvoiceIds.some(value => !id(value)) || new Set(retainInvoiceIds).size !== retainInvoiceIds.length) fail("INVALID_RETAINED_INVOICES");
  if (!input.configurationReady || input.organisation?.currency !== "AUD" || !["AU", "Australia"].includes(input.organisation?.country)) fail("CONFIGURATION_REQUIRED");
  const selected = input.localInvoices.filter(row => row.date >= from && row.date <= to);
  if (!selected.length || selected.length !== input.localInvoices.length) fail("FULL_ELSET_HISTORY_REQUIRED");
  const numbers = new Set(), customerPlans = new Map();
  const allPayments = input.localPayments;
  if (!Array.isArray(allPayments)) fail("LOCAL_PAYMENTS_REQUIRED");
  const targets = input.inventory.invoices.filter(row => row.TxnDate >= from && row.TxnDate <= to);
  const targetIds = new Set(targets.map(row => row.Id));
  const payments = input.inventory.payments.filter(row => links(row).some(link => link.TxnType === "Invoice" && targetIds.has(link.TxnId)));
  const paymentIds = new Set(payments.map(row => row.Id));
  for (const row of [...targets, ...payments]) if (!id(row.Id) || !/^\d+$/.test(String(row.SyncToken))) fail("INVALID_PROVIDER_ID_VERSION");
  for (const row of targets) {
    if (ref(row.CurrencyRef) && ref(row.CurrencyRef) !== "AUD" || cents(row.Deposit || 0) !== 0
      || links(row).some(link => link.TxnType !== "Payment" || !paymentIds.has(link.TxnId))) fail("UNSUPPORTED_INVOICE_LINK");
  }
  for (const row of payments) {
    if (cents(row.UnappliedAmt) !== 0 || !links(row).length || links(row).some(link => link.TxnType !== "Invoice" || !targetIds.has(link.TxnId))) fail("PAYMENT_CROSSES_REBUILD_SCOPE");
  }
  for (const row of [...input.inventory.deposits, ...input.inventory.credits]) {
    if (links(row).some(link => targetIds.has(link.TxnId) || paymentIds.has(link.TxnId))) fail("DEPOSIT_OR_CREDIT_LINK_REQUIRES_SEPARATE_SCOPE");
  }
  // A company-level credit could be automatically applied to a recreated invoice.
  if (input.inventory.payments.some(row => cents(row.UnappliedAmt) !== 0) || input.inventory.credits.some(row => cents(row.RemainingCredit ?? row.Balance ?? row.TotalAmt) !== 0)) fail("UNAPPLIED_CREDIT_PRESENT");
  const validAccount = accountId => input.paymentAccounts.some(row => row.Id === accountId && row.Active === true
    && (row.AccountType === "Bank" || row.AccountSubType === "UndepositedFunds") && (!ref(row.CurrencyRef) || ref(row.CurrencyRef) === "AUD"));
  if (!validAccount(paymentAccountId)) fail("PAYMENT_ACCOUNT_REQUIRED");
  const rows = selected.map(source => {
    if (!source.eligible || !dateOK(source.date) || !dateOK(source.dueDate) || !source.customer?.name?.trim() || source.currency !== "AUD"
      || !Number.isSafeInteger(source.totalCents) || source.totalCents <= 0 || !source.lines.length || source.number.length > 21 || numbers.has(source.number)) fail("INVALID_LOCAL_INVOICE");
    numbers.add(source.number);
    if (source.lines.some(line => !line.description.trim() || !(line.quantity > 0) || !Number.isSafeInteger(line.unitAmountCents) || line.unitAmountCents < 0 || !Number.isSafeInteger(line.amountCents))) fail("INVALID_LOCAL_LINE");
    if (input.mappings.some(row => row.local_entity_type === "invoice" && row.local_entity_id === source.id && (row.provider !== "quickbooks" || row.external_tenant_id !== input.tenantId))) fail("FOREIGN_ACCOUNTING_OWNER");
    if (!customerPlans.has(source.customerId)) customerPlans.set(source.customerId, customerPlan(input, source, reuseNamedCustomerIds));
    const receipts = allPayments.filter(row => row.invoice_id === source.id).map(row => {
      if (!row.id || !Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0 || !dateOK(row.date) || !["manual", "quickbooks"].includes(row.source)) fail("INVALID_LOCAL_PAYMENT");
      let accountId = paymentAccountId;
      if (preserveExternalAccounts && row.source === "quickbooks") {
        const old = input.externalPayments.filter(p => p.local_payment_id === row.id && p.provider === "quickbooks" && p.external_tenant_id === input.tenantId && p.status === "ACTIVE");
        const providerPayment = old.length === 1 && input.inventory.payments.find(p => p.Id === old[0].external_payment_id);
        if (!providerPayment || !validAccount(ref(providerPayment.DepositToAccountRef))) fail("EXTERNAL_PAYMENT_ACCOUNT_UNVERIFIED");
        accountId = ref(providerPayment.DepositToAccountRef);
      }
      return { ...row, accountId, marker: marker(input.workspaceId, "payment", row.id) };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const paid = receipts.reduce((sum, row) => sum + row.amount_cents, 0);
    if (paid !== source.paidCents || paid > source.totalCents) fail("LOCAL_PAYMENT_TOTAL_MISMATCH");
    return { source, receipts, marker: marker(input.workspaceId, "invoice", source.id), previousId: input.mappings.find(row => row.provider === "quickbooks" && row.external_tenant_id === input.tenantId && row.local_entity_type === "invoice" && row.local_entity_id === source.id)?.external_entity_id || "" };
  }).sort((a, b) => a.source.date.localeCompare(b.source.date) || a.source.number.localeCompare(b.source.number));
  if (rows.reduce((n, r) => n + r.receipts.length, 0) !== allPayments.length) fail("LOCAL_PAYMENT_OUTSIDE_SCOPE");
  if (reuseNamedCustomerIds.some(externalId => ![...customerPlans.values()].some(customer => customer.externalId === externalId))) fail("CONFIRMED_CUSTOMER_NOT_UNAMBIGUOUS");
  const retainedRows = rows.filter(row => retainInvoiceIds.includes(row.previousId));
  if (retainedRows.length !== retainInvoiceIds.length) fail("RETAINED_MAPPING_REQUIRED");
  const retainedPaymentIds = new Set();
  for (const row of retainedRows) {
    const customerId = customerPlans.get(row.source.customerId).externalId;
    if (!customerId || row.receipts.length !== 1 || row.receipts.some(receipt => receipt.source !== "quickbooks")) fail("RETAINED_BANK_RECEIPT_REQUIRED");
    row.retainedInvoiceId = row.previousId;
    row.retainedPayments = row.receipts.map(receipt => {
      const mapped = input.externalPayments.filter(p => p.local_payment_id === receipt.id && p.provider === "quickbooks" && p.external_tenant_id === input.tenantId && p.status === "ACTIVE");
      if (mapped.length !== 1 || mapped[0].external_invoice_id !== row.previousId || !input.paymentAccounts.some(account => account.Id === receipt.accountId && account.AccountType === "Bank")) fail("RETAINED_BANK_RECEIPT_REQUIRED");
      retainedPaymentIds.add(mapped[0].external_payment_id);
      return { receiptId: receipt.id, externalId: mapped[0].external_payment_id };
    });
    const lineItemIds = Object.fromEntries(row.source.lines.map(line => [line.id, input.mappings.find(m => m.provider === "quickbooks" && m.external_tenant_id === input.tenantId && m.local_entity_type === "price-list-item" && m.local_entity_id === line.priceListItemId)?.external_entity_id || input.config.itemId]));
    row.retainedPayload = makeInvoicePayload(row.source, customerId, { ...input.config, lineItemIds }, row.marker);
    checkRetainedRow(row, input.inventory);
  }
  const replacements = rows.filter(row => !retainInvoiceIds.includes(row.previousId));
  const plan = { schema: "elset-quickbooks-rebuild-v1", workspaceId: input.workspaceId, companyId: input.tenantId,
    range: { from, to }, paymentAccountId, preserveExternalAccounts, reuseNamedCustomerIds, retainInvoiceIds, sourceHash: input.sourceHash,
    customers: [...customerPlans.values()], rows: replacements, retainedRows,
    deleteInvoices: targets.filter(row => !retainInvoiceIds.includes(row.Id)), deletePayments: payments.filter(row => !retainedPaymentIds.has(row.Id)),
    preserved: { invoices: input.inventory.invoices.filter(row => !targetIds.has(row.Id) || retainInvoiceIds.includes(row.Id)), payments: input.inventory.payments.filter(row => !paymentIds.has(row.Id) || retainedPaymentIds.has(row.Id)), deposits: input.inventory.deposits, credits: input.inventory.credits },
    configuration: input.config, summary: { deleteInvoices: targets.length - retainedRows.length, deletePayments: payments.length - retainedPaymentIds.size,
      createInvoices: replacements.length, createPayments: allPayments.length - retainedPaymentIds.size, createCustomers: [...customerPlans.values()].filter(row => !row.externalId).length,
      ...(retainedRows.length ? { retainedInvoices: retainedRows.length, retainedPayments: retainedPaymentIds.size } : {}),
      totalCents: rows.reduce((n, r) => n + r.source.totalCents, 0), paidCents: rows.reduce((n, r) => n + r.source.paidCents, 0),
      outstandingCents: rows.reduce((n, r) => n + r.source.totalCents - r.source.paidCents, 0),
      receiptAccounts: rows.flatMap(row => row.receipts).reduce((out, row) => { out[row.accountId] = (out[row.accountId] || 0) + 1; return out; }, {}) } };
  plan.planHash = hash(plan);
  return structuredClone(plan);
}

export function makeInvoicePayload(source, customerId, config, note) {
  return { CustomerRef: { value: customerId }, DocNumber: source.number, TxnDate: source.date, DueDate: source.dueDate,
    CurrencyRef: { value: "AUD" }, PrivateNote: note, EmailStatus: "NotSet", BillEmail: { Address: "" },
    AllowOnlinePayment: false, AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: false,
    GlobalTaxCalculation: "TaxExcluded", Line: source.lines.map(line => ({ DetailType: "SalesItemLineDetail", Description: line.description,
      Amount: line.amountCents / 100, SalesItemLineDetail: { ItemRef: { value: config.lineItemIds?.[line.id] || config.itemId }, TaxCodeRef: { value: config.taxMappings[line.taxTreatment] }, Qty: line.quantity, UnitPrice: line.unitAmountCents / 100 } })) };
}
export function makePaymentPayload(receipt, invoiceId, customerId) {
  return { CustomerRef: { value: customerId }, CurrencyRef: { value: "AUD" }, TxnDate: receipt.date,
    TotalAmt: receipt.amount_cents / 100, DepositToAccountRef: { value: receipt.accountId }, PrivateNote: receipt.marker,
    ...(receipt.reference ? { PaymentRefNum: String(receipt.reference).slice(0, 21) } : {}),
    ProcessPayment: false, Line: [{ Amount: receipt.amount_cents / 100, LinkedTxn: [{ TxnId: invoiceId, TxnType: "Invoice" }] }] };
}
export function checkInvoice(raw, payload, source, paidCents = 0) {
  const expected = payload.Line, actual = (raw.Line || []).filter(row => row.DetailType !== "SubTotalLineDetail");
  if (!id(raw.Id) || raw.DocNumber !== source.number || raw.TxnDate !== source.date || raw.DueDate !== source.dueDate
    || ref(raw.CustomerRef) !== ref(payload.CustomerRef) || ref(raw.CurrencyRef) !== "AUD" || raw.PrivateNote !== payload.PrivateNote
    || raw.EmailStatus !== "NotSet" || raw.GlobalTaxCalculation !== "TaxExcluded" || cents(raw.TotalAmt) !== source.totalCents
    || cents(raw.TxnTaxDetail?.TotalTax) !== source.taxCents || cents(raw.Balance) !== source.totalCents - paidCents || actual.length !== expected.length) fail("INVOICE_READBACK_MISMATCH");
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i], b = expected[i];
    if (a.DetailType !== b.DetailType || (a.Description || "") !== b.Description || cents(a.Amount) !== cents(b.Amount)
      || a.SalesItemLineDetail?.Qty !== b.SalesItemLineDetail.Qty || cents(a.SalesItemLineDetail?.UnitPrice) !== cents(b.SalesItemLineDetail.UnitPrice)
      || ref(a.SalesItemLineDetail?.ItemRef) !== ref(b.SalesItemLineDetail.ItemRef) || ref(a.SalesItemLineDetail?.TaxCodeRef) !== ref(b.SalesItemLineDetail.TaxCodeRef)) fail("INVOICE_LINE_READBACK_MISMATCH");
  }
  return raw;
}
export function checkPayment(raw, payload) {
  if (!id(raw.Id) || raw.PrivateNote !== payload.PrivateNote || raw.TxnDate !== payload.TxnDate || ref(raw.CustomerRef) !== ref(payload.CustomerRef)
    || cents(raw.TotalAmt) !== cents(payload.TotalAmt) || cents(raw.UnappliedAmt) !== 0 || ref(raw.CurrencyRef) !== "AUD"
    || ref(raw.DepositToAccountRef) !== ref(payload.DepositToAccountRef) || raw.ProcessPayment === true
    || raw.Line?.length !== 1 || cents(raw.Line[0].Amount) !== cents(payload.TotalAmt)
    || hash(links(raw).map(row => ({ TxnType: row.TxnType, TxnId: row.TxnId }))) !== hash(links(payload))) fail("PAYMENT_READBACK_MISMATCH");
  return raw;
}

export function checkRetainedRow(row, inventory) {
  const invoice = inventory.invoices.find(raw => raw.Id === row.retainedInvoiceId);
  if (!invoice) fail("RETAINED_INVOICE_MISSING");
  if (links(invoice).length !== row.retainedPayments.length || links(invoice).some(link => link.TxnType !== "Payment" || !row.retainedPayments.some(mapping => mapping.externalId === link.TxnId))) fail("RETAINED_ALLOCATION_MISMATCH");
  // Existing notes and email history are preserved. All financial fields must already match.
  checkInvoice({ ...invoice, PrivateNote: row.marker, EmailStatus: "NotSet" }, row.retainedPayload, row.source, row.source.paidCents);
  for (const receipt of row.receipts) {
    const externalId = row.retainedPayments.find(mapping => mapping.receiptId === receipt.id)?.externalId;
    const payment = inventory.payments.find(raw => raw.Id === externalId);
    if (!payment) fail("RETAINED_PAYMENT_MISSING");
    checkPayment({ ...payment, PrivateNote: receipt.marker }, makePaymentPayload(receipt, invoice.Id, invoice.CustomerRef.value));
  }
}

export function assertResumeInventory(plan, current, ledger) {
  const underway = Object.keys(ledger.steps).some(key => key.startsWith("delete-"));
  for (const [kind, originals, additions] of [["invoices", plan.deleteInvoices, plan.rows.map(row => row.marker)],
    ["payments", plan.deletePayments, plan.rows.flatMap(row => row.receipts.map(p => p.marker))]]) {
    const singular = kind === "invoices" ? "invoice" : "payment";
    const allowed = new Map([...originals, ...plan.preserved[kind]].map(row => [row.Id, row]));
    for (const row of current[kind]) {
      const original = allowed.get(row.Id);
      if (!original) { if (!additions.includes(row.PrivateNote)) fail("UNEXPECTED_QUICKBOOKS_RECORD"); continue; }
      const projection = underway && originals.some(r => r.Id === row.Id) ? singular === "invoice" ? invoiceBeforeDelete : paymentBeforeDelete : stableEntity;
      if (hash(projection(row)) !== hash(projection(original))) fail("QUICKBOOKS_CHANGED_SINCE_PLAN");
    }
    for (const row of originals) if (!current[kind].some(r => r.Id === row.Id) && !ledger.steps[`delete-${singular}:${row.Id}`]?.started) fail("UNEXPECTED_MISSING_QUICKBOOKS_RECORD");
    for (const row of plan.preserved[kind]) if (!current[kind].some(r => r.Id === row.Id)) fail("PRESERVED_RECORD_MISSING");
  }
  for (const kind of ["credits", "deposits"]) if (hash(current[kind].map(stableEntity).sort((a,b) => a.Id.localeCompare(b.Id)))
    !== hash(plan.preserved[kind].map(stableEntity).sort((a,b) => a.Id.localeCompare(b.Id)))) fail("PRESERVED_ACCOUNTING_CHANGED");
}

// The executor is shared by the production CLI and synthetic failure/recovery tests.
export async function executeRebuild(plan, { adapter, ledger, save, archive }) {
  const { planHash, ...contents } = plan;
  if (hash(contents) !== planHash || ledger.planHash !== planHash) fail("PLAN_HASH_MISMATCH");
  await adapter.assertSource(plan.sourceHash);
  if (!ledger.prechangeArchive) { ledger.prechangeArchive = await archive(); if (!ledger.prechangeArchive) fail("ARCHIVE_REQUIRED"); await save(); }
  const step = async (key, fn) => {
    await adapter.assertSource(plan.sourceHash);
    const entry = ledger.steps[key] ||= { started: false };
    if (entry.done) return entry.value;
    entry.started = true; await save();
    const value = await fn(entry);
    entry.value = value; entry.done = true; await save(); return value;
  };
  // Financial replacement starts only after every customer and line-item payload is resolved.
  const customers = {};
  for (const customer of plan.customers) customers[customer.localId] = await step(`customer:${customer.localId}`, () => adapter.customer(customer));
  const payloads = {};
  for (const row of plan.rows) payloads[row.source.id] = await step(`payload:${row.source.id}`, () => adapter.invoicePayload(row, customers[row.source.customerId], plan));
  for (const raw of plan.deletePayments) await step(`delete-payment:${raw.Id}`, () => adapter.remove("payment", raw));
  for (const raw of plan.deleteInvoices) await step(`delete-invoice:${raw.Id}`, () => adapter.remove("invoice", raw));
  for (const row of plan.rows) {
    const payload = payloads[row.source.id];
    const externalId = await step(`invoice:${row.source.id}`, () => adapter.createInvoice(row, payload));
    const receipts = [];
    for (const receipt of row.receipts) {
      const paymentPayload = makePaymentPayload(receipt, externalId, customers[row.source.customerId]);
      const paymentId = await step(`payment:${receipt.id}`, () => adapter.createPayment(receipt, paymentPayload));
      receipts.push({ receipt, externalId: paymentId });
    }
    await step(`mapping:${row.source.id}`, () => adapter.mapInvoice(row, externalId, payload, receipts));
  }
  await adapter.assertSource(plan.sourceHash);
  const verification = await adapter.verify(plan, ledger, payloads);
  if (!verification?.matched) fail("FINAL_COMPARISON_FAILED");
  ledger.complete = true; ledger.verification = verification; await save();
  return verification;
}
