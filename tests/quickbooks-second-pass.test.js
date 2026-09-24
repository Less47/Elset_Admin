// TEMPORARY synthetic diagnostic tests. No Intuit calls or production data.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeReconciliation, linkedAccounting } from "../scripts/quickbooks-reconciliation-core.mjs";
import { analyzeSecondPass, compareCandidate, expectedItem, normalizeDescription, paymentCategory, parseSecondPassArgs, secondPassCli, verifySameLocalDataset, writeSecondPassReports } from "../scripts/quickbooks-reconciliation-second-pass.mjs";

function fixture() {
  const source = { id: "local", number: "INV-0001", date: "2025-01-01", dueDate: "2025-01-08", currency: "AUD", customerId: "customer", eligible: true, reason: "", customer: { name: "Example" },
    lines: [{ id: "line", description: "Replace motor", quantity: 2, unitAmountCents: 5000, amountCents: 10000 }], subtotalCents: 10000, taxCents: 1000, totalCents: 11000, paidCents: 0 };
  const invoice = { Id: "10", DocNumber: "1", TxnDate: source.date, CustomerRef: { value: "20", name: "Example" }, CurrencyRef: { value: "AUD" }, TotalAmt: 110, Balance: 110, TxnTaxDetail: { TotalTax: 10 }, SyncToken: "0",
    Line: [{ DetailType: "SalesItemLineDetail", Description: "Replace motor", Amount: 100, SalesItemLineDetail: { Qty: 2, UnitPrice: 50, ItemRef: { value: "old" }, ItemAccountRef: { value: "income" } } }] };
  const archive = { company: { id: "realm" }, invoices: [invoice], customers: [{ Id: "20", DisplayName: "Example", Active: true }], items: [{ Id: "fallback", Name: "ELSET Services", Active: true, Type: "Service", IncomeAccountRef: { value: "income" } }], payments: [], credits: [], deposits: [] };
  const input = { ...archive, localInvoices: [source], localCustomers: [{ id: "customer", name: "Example" }], workspaceId: "workspace", tenantId: "realm", mappings: [], configurationReady: true };
  const baseline = () => ({ ...analyzeReconciliation(input), company: archive.company });
  const context = () => ({ ...archive, config: { itemId: "fallback" }, catalog: [], mappings: input.mappings, tenantId: "realm", records: baseline().records, accounting: linkedAccounting(archive.invoices, archive.payments, archive.credits, archive.deposits) });
  const compare = () => compareCandidate(baseline().records[0], source, invoice, context());
  const run = () => analyzeSecondPass({ baseline: baseline(), archive, localInvoices: input.localInvoices, mappings: input.mappings, config: { itemId: "fallback" } });
  return { source, invoice, archive, input, baseline, context, compare, run };
}

test("second pass rejects apply, partial-history flags and local production execution", () => {
  for (const args of [[], ["--apply"], ["--dry-run", "--apply"], ["--dry-run", "--from=2025-01-01"]]) assert.throws(() => parseSecondPassArgs(args), /Required/);
  assert.doesNotThrow(() => parseSecondPassArgs(["--dry-run"]));
  assert.throws(() => secondPassCli(["--dry-run"], { env: {} }), /Run only inside/);
});

test("format-only descriptions preserve meaningful wording, codes and electrical-unit case", () => {
  const f = fixture(); f.invoice.Line[0].Description = "  REPLACE\r\n  motor  ";
  let result = f.compare();
  assert.equal(result.flags.DESCRIPTION_FORMAT_ONLY, true); assert.equal(result.flags.DESCRIPTION_CONTENT_DIFF, false);
  assert.equal(result.bucket, "COSMETIC_ONLY");
  f.invoice.Line[0].Description = "Repair motor";
  result = f.compare(); assert.equal(result.flags.DESCRIPTION_CONTENT_DIFF, true); assert.equal(result.flags.DESCRIPTION_FORMAT_ONLY, false);
  assert.equal(result.bucket, "CONTENT_DIFF_NO_FINANCIAL_CHANGE");
  assert.notEqual(normalizeDescription("20 mA"), normalizeDescription("20 MA"));
  assert.notEqual(normalizeDescription("Part A1"), normalizeDescription("Part a1"));
  assert.notEqual(normalizeDescription("no damage"), normalizeDescription("damage"));
});

test("historical items and legacy number formatting do not imply wrong financial content", () => {
  const result = fixture().compare();
  assert.equal(result.flags.PRODUCT_SERVICE_DIFF, true); assert.equal(result.flags.HISTORICAL_ITEM_DIFFERENCE_ONLY, true);
  assert.equal(result.flags.DOC_NUMBER_DIFF, true); assert.equal(result.flags.DOC_NUMBER_FORMAT_ONLY, true);
  assert.equal(result.flags.STRICT_ITEM_ONLY, false); assert.equal(result.bucket, "COSMETIC_ONLY");
  assert.deepEqual(result.monetaryDifferences, []);
});

test("line quantity, precise unit price and amount differences are separately exposed even when headers agree", () => {
  const f = fixture(); f.invoice.Line[0].SalesItemLineDetail.Qty = 1;
  f.invoice.Line[0].SalesItemLineDetail.UnitPrice = "100.000001"; f.invoice.Line[0].Amount = "100.01";
  const result = f.compare();
  assert.equal(result.flags.QTY_DIFF, true); assert.equal(result.flags.UNIT_PRICE_DIFF, true); assert.equal(result.flags.LINE_AMOUNT_DIFF, true);
  assert.equal(result.flags.TOTAL_DIFF, false); assert.equal(result.bucket, "CONTENT_DIFF_NO_FINANCIAL_CHANGE");
  assert.deepEqual(result.monetaryDifferences.find(x => x.field === "unit_price"), { field: "unit_price", position: 1, elset: 50000000, quickbooks: 100000001, unit: "AUD millionths" });
  assert.equal(result.monetaryDifferences.find(x => x.field === "line_amount").quickbooks, 10001);
});

test("header financial and balance differences have exact paired monetary values and multiple-type bucket", () => {
  const f = fixture(); f.invoice.TotalAmt = 121; f.invoice.Balance = 121; f.invoice.TxnTaxDetail.TotalTax = 11;
  const result = f.compare(); assert.equal(result.bucket, "MULTIPLE_DIFF_TYPES");
  for (const key of ["SUBTOTAL_DIFF", "GST_DIFF", "TOTAL_DIFF", "BALANCE_DIFF"]) assert.equal(result.flags[key], true);
  assert.deepEqual(result.monetaryDifferences.find(x => x.field === "gst"), { field: "gst", elset: 1000, quickbooks: 1100, unit: "AUD cents" });
});

test("missing lines and material number differences cannot be called cosmetic", () => {
  const f = fixture(); f.invoice.DocNumber = "2";
  assert.equal(f.compare().flags.DOC_NUMBER_CONTENT_DIFF, true);
  f.invoice.Line.push({ ...structuredClone(f.invoice.Line[0]), Amount: 0 });
  const result = f.compare(); assert.equal(result.flags.LINE_COUNT_DIFF, true); assert.equal(result.flags.PRODUCT_SERVICE_COMPARISON_UNKNOWN, true);
  assert.equal(result.lines[1].elsetLineAmountCents, null); assert.equal(result.flags.HISTORICAL_ITEM_DIFFERENCE_ONLY, false);
});

test("complete line reordering preserves descriptions, quantities and prices without hiding structural differences", () => {
  const f = fixture();
  f.source.lines.push({ id: "line2", description: "Test safety beam", quantity: 1, unitAmountCents: 0, amountCents: 0 });
  f.invoice.Line.unshift({ DetailType: "SalesItemLineDetail", Description: "TEST safety beam", Amount: 0, SalesItemLineDetail: { Qty: 1, UnitPrice: 0, ItemRef: { value: "old" } } });
  const result = f.compare();
  assert.equal(result.flags.LINE_ORDER_DIFF, true); assert.equal(result.flags.DESCRIPTION_FORMAT_ONLY, true);
  for (const key of ["DESCRIPTION_CONTENT_DIFF", "QTY_DIFF", "UNIT_PRICE_DIFF", "LINE_AMOUNT_DIFF"]) assert.equal(result.flags[key], false);
  assert.equal(result.bucket, "CONTENT_DIFF_NO_FINANCIAL_CHANGE"); assert.equal(result.lines[0].qbPosition, 2);
  assert.deepEqual(result.monetaryDifferences, []);
  f.invoice.Line[0].Amount = 0.01;
  assert.equal(f.compare().flags.LINE_ORDER_DIFF, false); assert.equal(f.compare().flags.LINE_AMOUNT_DIFF, true);
});

test("item prediction uses saved provenance, prefers mapped IDs and never invents an ID for a future item", () => {
  const f = fixture(), context = f.context(), line = { priceListItemId: "catalog" };
  context.catalog = [{ id: "catalog", name: "New motor" }];
  let result = expectedItem(line, context); assert.equal(result.status, "WOULD_REQUIRE_NEW_ITEM"); assert.equal(result.comparisonKnown, false);
  context.mappings = [{ provider: "quickbooks", external_tenant_id: "realm", local_entity_type: "price-list-item", local_entity_id: "catalog", external_entity_id: "fallback" }];
  result = expectedItem(line, context); assert.equal(result.id, "fallback"); assert.equal(result.status, "EXISTING_MAPPING");
  context.mappings = []; context.catalog[0].archived = 1;
  assert.equal(expectedItem(line, context).status, "FALLBACK");
  assert.equal(expectedItem({ description: "New motor" }, context).id, "fallback");
});

test("a unique business match wins over a shared number-only claim without writing a mapping", () => {
  const f = fixture(); const other = structuredClone(f.source); other.id = "other"; other.number = "INV-0002"; other.date = "2025-03-01"; other.lines[0].description = "Other work";
  f.input.localInvoices.push(other); f.invoice.DocNumber = "2";
  const before = JSON.stringify(f.input), result = f.run();
  const row = result.records[0]; assert.equal(row.firstPassClassification, "MULTIPLE_QB_CANDIDATES");
  assert.equal(row.canonicalReview.status, "CLEAR_CANONICAL_CANDIDATE"); assert.equal(row.canonicalReview.qbId, "10");
  assert.equal(row.paymentReview.category, "MATCHING_PAYMENT_STATE"); assert.equal(row.paymentReview.identityReviewRequired, true);
  assert.equal(JSON.stringify(f.input), before);
});

test("two identical ELSET owners or two equally matching QB invoices remain review required", () => {
  const f = fixture(); f.input.localInvoices.push({ ...structuredClone(f.source), id: "other", number: "INV-0002" });
  assert.ok(f.run().records.every(row => row.canonicalReview.status === "REVIEW_REQUIRED"));
  const g = fixture(); g.archive.invoices.push({ ...structuredClone(g.invoice), Id: "11" });
  assert.equal(g.run().records[0].canonicalReview.status, "REVIEW_REQUIRED");
});

test("missing paid records need accounting review and expanded content matches block create", () => {
  const f = fixture(); f.archive.invoices.splice(0); f.source.paidCents = 11000;
  let row = f.run().records[0]; assert.equal(row.firstPassAction, "CREATE_QB_INVOICE"); assert.equal(row.missingReview.status, "REVIEW_BEFORE_CREATE");
  assert.equal(row.paymentReview.category, "OTHER"); assert.equal(row.paymentReview.qbBalanceCents, null);
  f.source.paidCents = 0; assert.equal(f.run().records[0].missingReview.status, "SAFE_CREATE");
  const g = fixture(); g.invoice.DocNumber = "88"; g.invoice.TxnDate = "2024-06-01";
  row = g.run().records[0]; assert.equal(row.firstPassAction, "CREATE_QB_INVOICE"); assert.equal(row.missingReview.status, "POSSIBLE_EXISTING_QB_RECORD");
  assert.ok(row.missingReview.weakCandidates[0].weakReasons.includes("SAME_LINES_REGARDLESS_OF_CUSTOMER_OR_DATE"));
});

test("all seven payment categories distinguish unknown identity and inferred settlement", () => {
  const f = fixture(); const cases = [
    [11000, 110, "ELSET_PAID_QB_UNPAID"], [5000, 110, "ELSET_PARTIAL_QB_UNPAID"], [0, 0, "QB_PAID_ELSET_UNPAID"],
    [4000, 50, "PAYMENT_AMOUNT_DIFF"], [11000, 0, "MATCHING_PAYMENT_STATE"], [0, -1, "OTHER"],
  ];
  for (const [paid, balance, category] of cases) {
    f.source.paidCents = paid; f.invoice.Balance = balance;
    assert.equal(paymentCategory(f.baseline().records[0], f.compare()), category);
  }
  f.invoice.Balance = 0; f.invoice.LinkedTxn = [{ TxnType: "CreditMemo", TxnId: "credit" }];
  assert.equal(paymentCategory(f.baseline().records[0], f.compare()), "CREDIT_OR_OTHER_LINKED_TRANSACTION");
  assert.equal(paymentCategory(f.baseline().records[0], null), "OTHER");
});

test("reverse payment allocations retain amount, date and invoice ID", () => {
  const f = fixture(); f.archive.payments.push({ Id: "receipt", TotalAmt: 110, UnappliedAmt: 0, TxnDate: "2025-01-04", Line: [{ Amount: 110, LinkedTxn: [{ TxnId: "10", TxnType: "Invoice" }] }] });
  const result = f.compare(); assert.deepEqual(result.linkedTransactionTypes, ["Payment"]);
  assert.equal(result.linkedPayments[0].allocations[0].amountCents, 11000); assert.equal(result.protectedAccountingState, true);
});

test("INV-0252 prefers supported paid legacy history but never changes the current mapping", () => {
  const f = fixture(); f.source.number = "INV-0252"; f.source.paidCents = 11000;
  f.invoice.Id = "353"; f.invoice.DocNumber = "INV-0252"; f.invoice.MetaData = { CreateTime: "2026-09-21T00:00:00Z" };
  f.archive.invoices.push({ ...structuredClone(f.invoice), Id: "346", DocNumber: "251", Balance: 0, MetaData: { CreateTime: "2026-08-27T00:00:00Z" } });
  f.input.mappings.push({ provider: "quickbooks", external_tenant_id: "realm", local_entity_type: "invoice", local_entity_id: "local", external_entity_id: "353" });
  f.archive.payments.push({ Id: "348", TotalAmt: 110, UnappliedAmt: 0, Line: [{ Amount: 110, LinkedTxn: [{ TxnId: "346", TxnType: "Invoice" }] }] });
  let result = f.run(); assert.equal(result.inv0252.strongerHistoricalAccountingId, "346"); assert.equal(result.inv0252.currentMappedId, "353");
  assert.equal(result.inv0252.status, "REVIEW_REQUIRED"); assert.equal(result.phases[2].voidProposals.length, 0);
  f.archive.payments[0].Line[0].Amount = 100;
  result = f.run(); assert.equal(result.inv0252.strongerHistoricalAccountingId, "");
});

test("same-dataset verification fails closed for source, payment, mapping and customer drift", () => {
  const f = fixture(), baseline = f.baseline();
  assert.equal(verifySameLocalDataset(baseline, f.baseline()).matchedInvoices, 1);
  for (const key of ["fingerprint", "elsetPaidCents", "mappedQuickbooksId", "customer", "classification"]) {
    const changed = structuredClone(baseline); changed.records[0][key] = "changed";
    assert.throws(() => verifySameLocalDataset(baseline, changed), /ELSET_DATA_DRIFT/);
  }
  const changed = structuredClone(baseline); changed.records[0].customerResolution.safe = false;
  assert.throws(() => verifySameLocalDataset(baseline, changed), /ELSET_DATA_DRIFT/);
});

test("reports preserve all required columns, unknown money, formula guards and exclusive output creation", () => {
  const f = fixture(); f.source.customer.name = "=unsafe()"; f.archive.invoices.splice(0);
  const report = f.run(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "qb-second-pass-"));
  try {
    const paths = writeSecondPassReports(report, directory, "test"), csv = fs.readFileSync(paths.csv, "utf8");
    assert.ok(csv.includes("PRODUCT_SERVICE_DIFF")); assert.ok(csv.includes("UNIT_PRICE_DIFF")); assert.ok(csv.includes("'="));
    assert.equal(JSON.parse(fs.readFileSync(paths.json)).records[0].paymentReview.qbBalanceCents, null);
    assert.ok(fs.readFileSync(paths.payment, "utf8").includes("qbInferredPaidCents"));
    assert.throws(() => writeSecondPassReports(report, directory, "test"), /EEXIST/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
