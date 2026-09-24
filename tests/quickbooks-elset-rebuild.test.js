import test from "node:test";
import assert from "node:assert/strict";
import { buildRebuildPlan, hash, makeInvoicePayload, makePaymentPayload, checkInvoice, checkPayment, assertResumeInventory, executeRebuild } from "../scripts/quickbooks-elset-rebuild-core.mjs";
import { rebuildTransport } from "../scripts/quickbooks-elset-rebuild.mjs";

const options = { from: "2025-09-03", to: "2026-09-24", paymentAccountId: "32", preserveExternalAccounts: true };
function fixture() {
  const source = { id: "local-invoice", jobId: "job", customerId: "local-customer", number: "INV-0252", eligible: true,
    date: "2026-08-27", dueDate: "2026-09-03", currency: "AUD", customer: { name: "Example", email: "example@test.invalid" },
    subtotalCents: 48000, taxCents: 4800, totalCents: 52800, paidCents: 52800,
    lines: [{ id: "line", description: "Historical description\nSecond line", quantity: 3, unitAmountCents: 16000, amountCents: 48000, taxCents: 4800, taxTreatment: "taxable" }] };
  const config = { itemId: "123", incomeAccountId: "9", taxMappings: { taxable: "5" }, taxRateIds: { taxable: "2" }, currency: "AUD" };
  const invoice = { ...makeInvoicePayload(source, "94", config, "old-note"), Id: "346", SyncToken: "2", TotalAmt: 528, Balance: 0, TxnTaxDetail: { TotalTax: 48 }, LinkedTxn: [{ TxnType: "Payment", TxnId: "348" }] };
  const oldReceipt = { id: "old", date: "2026-09-08", amount_cents: 52800, accountId: "32", marker: "old-receipt" };
  const payment = { ...makePaymentPayload(oldReceipt, "346", "94"), Id: "348", SyncToken: "0", UnappliedAmt: 0 };
  const input = { localInvoices: [source], workspaceId: "workspace", tenantId: "9341455", sourceHash: "frozen-source", organisation: { country: "AU", currency: "AUD" }, configurationReady: true, config, mappings: [], externalPayments: [],
    localPayments: [{ id: "receipt1", invoice_id: source.id, amount_cents: 20000, date: "2026-09-01", source: "manual", reference: "PART-1" },
      { id: "receipt2", invoice_id: source.id, amount_cents: 32800, date: "2026-09-08", source: "manual", reference: "PART-2" }],
    paymentAccounts: [{ Id: "32", Active: true, AccountType: "Other Current Asset", AccountSubType: "UndepositedFunds" }, { Id: "54", Active: true, AccountType: "Bank", CurrencyRef: { value: "AUD" } }],
    inventory: { invoices: [invoice], payments: [payment], customers: [{ Id: "94", Active: true, DisplayName: "Example", PrimaryEmailAddr: { Address: source.customer.email } }], items: [], credits: [], deposits: [{ Id: "1", SyncToken: "0", TxnDate: "2025-08-03", TotalAmt: 100, Line: [] }] } };
  return { input, source, invoice, payment, plan: () => buildRebuildPlan(input, options) };
}
test("rebuild replaces invoices and receipts with ELSET totals, preserving unrelated deposit", () => {
  const f = fixture(), p = f.plan();
  assert.deepEqual(p.summary, { deleteInvoices: 1, deletePayments: 1, createInvoices: 1, createPayments: 2, createCustomers: 0, totalCents: 52800, paidCents: 52800, outstandingCents: 0, receiptAccounts: { 32: 2 } });
  assert.deepEqual(p.preserved.deposits, f.input.inventory.deposits);
});
test("the bank destination of a verified QuickBooks-sourced receipt is retained", () => {
  const f = fixture(); f.input.localPayments[0].source = "quickbooks";
  f.input.externalPayments.push({ provider: "quickbooks", external_tenant_id: f.input.tenantId, local_payment_id: "receipt1", external_payment_id: "348", status: "ACTIVE" });
  f.payment.DepositToAccountRef.value = "54";
  assert.deepEqual(f.plan().summary.receiptAccounts, { 32: 1, 54: 1 });
  f.input.externalPayments = []; assert.throws(f.plan, { code: "EXTERNAL_PAYMENT_ACCOUNT_UNVERIFIED" });
});
for (const [name, change, expected] of [
  ["draft source", f => { f.source.eligible = false; }, "INVALID_LOCAL_INVOICE"],
  ["invalid invoice date", f => { f.source.date = "2026-02-30"; }, "INVALID_LOCAL_INVOICE"],
  ["invalid due date", f => { f.source.dueDate = "2026-02-30"; }, "INVALID_LOCAL_INVOICE"],
  ["duplicate invoice number", f => { f.input.localInvoices.push({ ...f.source, id: "second" }); }, "INVALID_LOCAL_INVOICE"],
  ["payment mismatch", f => { f.source.paidCents = 1; }, "LOCAL_PAYMENT_TOTAL_MISMATCH"],
  ["overpayment", f => { f.input.localPayments[0].amount_cents += 100; f.source.paidCents += 100; }, "LOCAL_PAYMENT_TOTAL_MISMATCH"],
  ["negative payment", f => { f.input.localPayments[0].amount_cents = -1; }, "INVALID_LOCAL_PAYMENT"],
  ["invalid payment date", f => { f.input.localPayments[0].date = "not-a-date"; }, "INVALID_LOCAL_PAYMENT"],
  ["foreign payment source", f => { f.input.localPayments[0].source = "xero"; }, "INVALID_LOCAL_PAYMENT"],
  ["foreign invoice mapping", f => { f.input.mappings.push({ provider: "xero", external_tenant_id: "elsewhere", local_entity_type: "invoice", local_entity_id: f.source.id }); }, "FOREIGN_ACCOUNTING_OWNER"],
  ["cross-scope payment", f => { f.payment.Line.push({ Amount: 1, LinkedTxn: [{ TxnType: "Invoice", TxnId: "outside" }] }); }, "PAYMENT_CROSSES_REBUILD_SCOPE"],
  ["unapplied payment", f => { f.payment.UnappliedAmt = 1; }, "PAYMENT_CROSSES_REBUILD_SCOPE"],
  ["linked deposit", f => { f.input.inventory.deposits[0].Line.push({ LinkedTxn: [{ TxnType: "Payment", TxnId: "348" }] }); }, "DEPOSIT_OR_CREDIT_LINK_REQUIRES_SEPARATE_SCOPE"],
  ["open credit", f => { f.input.inventory.credits.push({ Id: "5", TotalAmt: 10 }); }, "UNAPPLIED_CREDIT_PRESENT"],
  ["unusable deposit account", f => { f.input.paymentAccounts[0].AccountSubType = "Inventory"; }, "PAYMENT_ACCOUNT_REQUIRED"],
  ["missing configuration", f => { f.input.configurationReady = false; }, "CONFIGURATION_REQUIRED"],
  ["payment outside invoice scope", f => { f.input.localPayments.push({ id: "orphan", invoice_id: "elsewhere" }); }, "LOCAL_PAYMENT_OUTSIDE_SCOPE"],
]) test(`planner stops for ${name}`, () => { const f = fixture(); change(f); assert.throws(f.plan, { code: expected }); });
test("ambiguous customer names create a deterministic separate customer, without an email address", () => {
  const f = fixture(); f.input.inventory.customers.push({ ...f.input.inventory.customers[0], Id: "95" });
  const c = f.plan().customers[0]; assert.equal(c.externalId, ""); assert.equal(c.payload.PrimaryEmailAddr, undefined);
  assert.equal(f.plan().customers[0].payload.DisplayName, c.payload.DisplayName);
});
test("a confirmed named customer can retain a different email without creating a duplicate", () => {
  const f = fixture(); f.input.inventory.customers[0].PrimaryEmailAddr.Address = "older@test.invalid";
  assert.equal(f.plan().summary.createCustomers, 1);
  const plan = buildRebuildPlan(f.input, { ...options, reuseNamedCustomerIds: ["94"] });
  assert.equal(plan.summary.createCustomers, 0); assert.equal(plan.customers[0].externalId, "94");
  assert.deepEqual(plan.reuseNamedCustomerIds, ["94"]);
  f.input.inventory.customers[0].DisplayName = "Someone else";
  assert.throws(() => buildRebuildPlan(f.input, { ...options, reuseNamedCustomerIds: ["94"] }), { code: "CONFIRMED_CUSTOMER_NOT_UNAMBIGUOUS" });
});
test("customer confirmation cannot override another local customer's ownership", () => {
  const f = fixture(); f.input.mappings.push({ provider: "quickbooks", external_tenant_id: f.input.tenantId, local_entity_type: "customer", local_entity_id: "another-local-customer", external_entity_id: "94" });
  assert.throws(() => buildRebuildPlan(f.input, { ...options, reuseNamedCustomerIds: ["94"] }), { code: "CONFIRMED_CUSTOMER_NOT_UNAMBIGUOUS" });
});
test("a new customer without a name collision retains the ELSET display name", () => {
  const f = fixture(); f.input.inventory.customers = [];
  assert.equal(f.plan().customers[0].payload.DisplayName, "Example");
});
function bankRetentionFixture() {
  const f = fixture();
  f.input.localPayments = [{ ...f.input.localPayments[0], amount_cents: f.source.paidCents, date: f.payment.TxnDate, source: "quickbooks" }];
  f.payment.DepositToAccountRef.value = "54";
  f.input.mappings.push({ provider: "quickbooks", external_tenant_id: f.input.tenantId, local_entity_type: "invoice", local_entity_id: f.source.id, external_entity_id: f.invoice.Id });
  f.input.externalPayments = [{ provider: "quickbooks", external_tenant_id: f.input.tenantId, local_payment_id: "receipt1", external_payment_id: f.payment.Id, external_invoice_id: f.invoice.Id, status: "ACTIVE" }];
  f.retainedPlan = () => buildRebuildPlan(f.input, { ...options, retainInvoiceIds: [f.invoice.Id] });
  return f;
}
test("an exactly matching bank invoice and payment are retained with unchanged total receipts", () => {
  const f = bankRetentionFixture(), p = f.retainedPlan();
  assert.equal(p.rows.length, 0); assert.equal(p.retainedRows.length, 1);
  assert.equal(p.deleteInvoices.length, 0); assert.equal(p.deletePayments.length, 0);
  assert.equal(p.summary.totalCents, 52800); assert.equal(p.summary.paidCents, 52800);
  assert.equal(p.summary.retainedPayments, 1); assert.equal(p.summary.createPayments, 0);
  assert.deepEqual(p.preserved.invoices, [f.invoice]); assert.deepEqual(p.preserved.payments, [f.payment]);
  f.payment.TxnDate = "2026-09-09";
  assert.throws(() => assertResumeInventory(p, f.input.inventory, { steps: {} }), { code: "QUICKBOOKS_CHANGED_SINCE_PLAN" });
});
test("retention refuses a changed invoice line, receipt date, invoice mapping or extra allocation", () => {
  const a = bankRetentionFixture(); a.invoice.Line[0].Description = "Different work"; assert.throws(a.retainedPlan, { code: "INVOICE_LINE_READBACK_MISMATCH" });
  const b = bankRetentionFixture(); b.input.localPayments[0].date = "2026-09-09"; assert.throws(b.retainedPlan, { code: "PAYMENT_READBACK_MISMATCH" });
  const c = bankRetentionFixture(); c.input.externalPayments[0].external_invoice_id = "999"; assert.throws(c.retainedPlan, { code: "RETAINED_BANK_RECEIPT_REQUIRED" });
  const d = bankRetentionFixture(); d.invoice.LinkedTxn.push({ TxnType: "Payment", TxnId: d.payment.Id }); assert.throws(d.retainedPlan, { code: "RETAINED_ALLOCATION_MISMATCH" });
});
test("manual or undeposited receipts cannot enter the bank-retention exception", () => {
  const a = bankRetentionFixture(); a.input.localPayments[0].source = "manual"; assert.throws(a.retainedPlan, { code: "RETAINED_BANK_RECEIPT_REQUIRED" });
  const b = bankRetentionFixture(); b.payment.DepositToAccountRef.value = "32"; assert.throws(b.retainedPlan, { code: "RETAINED_BANK_RECEIPT_REQUIRED" });
});
test("a retained bank pair requires no financial mutations during execution", async () => {
  const f = bankRetentionFixture(), p = f.retainedPlan(), writes = [], ledger = { planHash: p.planHash, steps: {} };
  const adapter = { assertSource() {}, customer: async () => "94", remove: async () => writes.push("delete"), createInvoice: async () => writes.push("invoice"), createPayment: async () => writes.push("payment"), verify: async () => ({ matched: true }) };
  await executeRebuild(p, { adapter, ledger, save: async () => {}, archive: async () => "archive" });
  assert.deepEqual(writes, []); assert.equal(ledger.complete, true);
});
test("payloads preserve historical line content and record receipts without charging or emailing", () => {
  const f = fixture(), p = f.plan(), payload = makeInvoicePayload(f.source, "94", f.input.config, p.rows[0].marker);
  assert.equal(payload.Line[0].Description, f.source.lines[0].description); assert.equal(payload.EmailStatus, "NotSet"); assert.equal(payload.BillEmail.Address, "");
  const receipt = makePaymentPayload(p.rows[0].receipts[0], "500", "94");
  assert.equal(receipt.ProcessPayment, false); assert.equal(receipt.TotalAmt, 200); assert.equal(receipt.TxnDate, "2026-09-01");
});
test("readback catches wrong totals, dates, description, tax, receipt allocation and email state", () => {
  const f = fixture(), p = f.plan(); const payload = makeInvoicePayload(f.source, "94", f.input.config, p.rows[0].marker);
  const raw = { ...payload, Id: "500", TotalAmt: 528, Balance: 528, TxnTaxDetail: { TotalTax: 48 } };
  assert.equal(checkInvoice(raw, payload, f.source).Id, "500");
  for (const patch of [{ TotalAmt: 529 }, { DueDate: "2026-09-04" }, { EmailStatus: "EmailSent" }, { Balance: 0 }]) assert.throws(() => checkInvoice({ ...raw, ...patch }, payload, f.source));
  const changed = structuredClone(raw); changed.Line[0].Description = "Replaced description"; assert.throws(() => checkInvoice(changed, payload, f.source));
  const pay = makePaymentPayload(p.rows[0].receipts[0], "500", "94"), remote = { ...pay, Id: "600", UnappliedAmt: 0 };
  checkPayment(remote, pay); assert.throws(() => checkPayment({ ...remote, ProcessPayment: true }, pay));
  assert.throws(() => checkPayment({ ...remote, Line: [{ Amount: 200, LinkedTxn: [{ TxnType: "Invoice", TxnId: "wrong" }] }] }, pay));
});
test("preflight catches external edits, missing records and new records but permits journalled deletion", () => {
  const f = fixture(), p = f.plan(), ledger = { steps: {} };
  assertResumeInventory(p, f.input.inventory, ledger);
  f.invoice.DocNumber = "changed"; assert.throws(() => assertResumeInventory(p, f.input.inventory, ledger)); f.invoice.DocNumber = "INV-0252";
  f.input.inventory.payments = []; assert.throws(() => assertResumeInventory(p, f.input.inventory, ledger));
  ledger.steps["delete-payment:348"] = { started: true }; f.invoice.LinkedTxn = []; f.invoice.Balance = 528;
  assertResumeInventory(p, f.input.inventory, ledger);
  f.input.inventory.invoices.push({ ...f.invoice, Id: "900" }); assert.throws(() => assertResumeInventory(p, f.input.inventory, ledger));
});

test("recovery allows recalculated invoice display balances but still rejects payment or reference edits", () => {
  const f = fixture();
  f.payment.Line[0].LineEx = { any: [{ value: { Name: "txnOpenBalance", Value: "528.00" } }, { value: { Name: "txnReferenceNumber", Value: "INV-0252" } }] };
  const plan = f.plan();
  f.payment.Line[0].LineEx.any[0].value.Value = "1056.00";
  assert.throws(() => assertResumeInventory(plan, f.input.inventory, { steps: {} }), { code: "QUICKBOOKS_CHANGED_SINCE_PLAN" });
  const ledger = { steps: { "delete-payment:349": { started: true, done: true } } };
  assertResumeInventory(plan, f.input.inventory, ledger);
  f.payment.TotalAmt = 529;
  assert.throws(() => assertResumeInventory(plan, f.input.inventory, ledger), { code: "QUICKBOOKS_CHANGED_SINCE_PLAN" });
  f.payment.TotalAmt = 528; f.payment.Line[0].LineEx.any[1].value.Value = "INV-9999";
  assert.throws(() => assertResumeInventory(plan, f.input.inventory, ledger), { code: "QUICKBOOKS_CHANGED_SINCE_PLAN" });
});
test("invoice comparison treats an omitted false address-format default consistently without ignoring address changes", () => {
  const f = fixture(); f.invoice.FreeFormAddress = false; f.invoice.BillAddr = { Line1: "1 Example Road" };
  const plan = f.plan(), ledger = { steps: { "delete-payment:348": { started: true } } };
  delete f.invoice.FreeFormAddress;
  assertResumeInventory(plan, f.input.inventory, ledger);
  f.invoice.FreeFormAddress = true;
  assert.throws(() => assertResumeInventory(plan, f.input.inventory, ledger), { code: "QUICKBOOKS_CHANGED_SINCE_PLAN" });
  delete f.invoice.FreeFormAddress; f.invoice.BillAddr.Line1 = "2 Different Road";
  assert.throws(() => assertResumeInventory(plan, f.input.inventory, ledger), { code: "QUICKBOOKS_CHANGED_SINCE_PLAN" });
});
test("a regenerated online invoice link is not financial drift, but email-state changes still stop recovery", () => {
  const f = fixture(), plan = f.plan(), ledger = { steps: { "delete-payment:348": { started: true } } };
  f.invoice.InvoiceLink = "https://example.invalid/generated-after-payment-removal";
  assertResumeInventory(plan, f.input.inventory, ledger);
  f.invoice.EmailStatus = "EmailSent";
  assert.throws(() => assertResumeInventory(plan, f.input.inventory, ledger), { code: "QUICKBOOKS_CHANGED_SINCE_PLAN" });
});
function executionFixture() {
  const f = fixture(), p = f.plan(), writes = [], ledger = { planHash: p.planHash, steps: {}, complete: false };
  let sourceChanged = false, failOnce = false, archiveMissing = false, verifyBad = false;
  const adapter = {
    assertSource(expected) { assert.equal(expected, p.sourceHash); if (sourceChanged) throw new Error("Source changed"); },
    customer: async () => "94", invoicePayload: async row => makeInvoicePayload(row.source, "94", p.configuration, row.marker),
    remove: async (kind, row) => { writes.push(`delete-${kind}:${row.Id}`); return row.Id; },
    createInvoice: async () => { writes.push("create-invoice"); return "500"; },
    createPayment: async receipt => { if (failOnce) { failOnce = false; throw new Error("Interrupted"); } writes.push(`payment:${receipt.id}`); return receipt.id === "receipt1" ? "600" : "601"; },
    mapInvoice: async () => { writes.push("map"); return "500"; }, verify: async () => ({ matched: !verifyBad }),
  };
  const run = () => executeRebuild(p, { adapter, ledger, save: async () => {}, archive: async () => archiveMissing ? null : "verified-archive" });
  return { f, p, writes, ledger, run, changeSource() { sourceChanged = true; }, interrupt() { failOnce = true; }, failArchive() { archiveMissing = true; }, failVerification() { verifyBad = true; } };
}
test("executor orders payments before invoice deletion, then recreates and verifies; repeat does not write", async () => {
  const f = executionFixture(); await f.run();
  assert.deepEqual(f.writes, ["delete-payment:348", "delete-invoice:346", "create-invoice", "payment:receipt1", "payment:receipt2", "map"]);
  assert.equal(f.ledger.complete, true); await f.run(); assert.equal(f.writes.length, 6);
});
test("interruption resumes at the incomplete receipt without repeating completed deletes or creates", async () => {
  const f = executionFixture(); f.interrupt(); await assert.rejects(f.run()); assert.equal(f.ledger.complete, false);
  await f.run(); assert.deepEqual(f.writes, ["delete-payment:348", "delete-invoice:346", "create-invoice", "payment:receipt1", "payment:receipt2", "map"]);
});
test("changed source, missing archive, tampered plan and failed comparison never report completion", async () => {
  const f = executionFixture(); f.changeSource(); await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  const a = executionFixture(); a.failArchive(); await assert.rejects(a.run(), { code: "ARCHIVE_REQUIRED" }); assert.equal(a.writes.length, 0);
  const b = executionFixture(); b.p.rows[0].source.totalCents++; await assert.rejects(b.run(), { code: "PLAN_HASH_MISMATCH" }); assert.equal(b.writes.length, 0);
  const c = executionFixture(); c.failVerification(); await assert.rejects(c.run(), { code: "FINAL_COMPARISON_FAILED" }); assert.equal(c.ledger.complete, false);
});

test("transport blocks sends, charging, foreign companies, writes in prepare, unapproved and reused capabilities", async () => {
  const calls = [], base = "https://quickbooks.api.intuit.com/v3/company/9341455/";
  const transport = rebuildTransport(async (...args) => { calls.push(args); return {}; }, { apply: true, tenantId: "9341455", paceMs: 0 });
  for (const suffix of ["invoice/1/send", "payment/1/send", "invoice?operation=void", "deposit?operation=delete"]) await assert.rejects(transport(base + suffix, { method: "POST", body: "{}" }));
  assert.throws(() => transport.permit("payment", { ProcessPayment: true }));
  assert.throws(() => transport.permit("invoice", { EmailStatus: "NeedToSend" }));
  assert.throws(() => transport.permit("deposit", { Id: "1", SyncToken: "0" }, "delete"));
  const payload = { Id: "346", SyncToken: "3" };
  transport.permit("invoice", payload, "delete");
  await assert.rejects(transport(base.replace("9341455", "999") + "invoice?operation=delete", { method: "POST", body: JSON.stringify(payload) }));
  await transport(base + "invoice?operation=delete", { method: "POST", body: JSON.stringify(payload) });
  await assert.rejects(transport(base + "invoice?operation=delete", { method: "POST", body: JSON.stringify(payload) }));
  const dry = rebuildTransport(async () => { throw new Error("Must not reach network"); }, { apply: false, tenantId: "9341455", paceMs: 0 });
  assert.throws(() => dry.permit("invoice", payload, "delete")); await assert.rejects(dry(base + "invoice", { method: "POST", body: "{}" }));
  assert.equal(calls.length, 1); assert.equal(transport.audit.sendCalls, 0); assert.equal(transport.audit.invoiceWrites, 1);
});
test("plan fingerprint binds receipts, destination accounts and destructive targets", () => {
  const f = fixture(), p = f.plan(); f.input.localPayments[0].reference = "new-reference"; assert.notEqual(f.plan().planHash, p.planHash);
  const { planHash, ...contents } = p; assert.equal(hash(contents), planHash);
});
