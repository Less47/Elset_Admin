// TEMPORARY: synthetic full-history review tests. Never contacts Intuit.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeReconciliation, normalizeInvoice, scaled, withoutSecrets, writeReconciliationReports } from "../scripts/quickbooks-reconciliation-core.mjs";
import { parseReconciliationArgs, readOnlyFetch, runReconciliation, fetchAll, reconciliationCli } from "../scripts/quickbooks-one-time-backfill.mjs";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { insertInvoiceTree } from "../server-workspace-documents.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { AccountingService } from "../server-accounting-service.js";
import { createQuickBooksMock } from "./helpers/quickbooks-mock.js";

function fixture() {
  const source = { id: "invoice", number: "INV-0001", date: "2025-01-01", currency: "AUD", customerId: "customer", eligible: true, reason: "", customer: { name: "Example Pty Ltd", email: "billing@example.test" },
    lines: [{ id: "line", description: "Replace contactor and test unit", quantity: 2, unitAmountCents: 50000, amountCents: 100000 }], subtotalCents: 100000, taxCents: 10000, totalCents: 110000, paidCents: 0 };
  const customer = { Id: "50", DisplayName: "Example Pty Ltd", PrimaryEmailAddr: { Address: "billing@example.test" }, Active: true };
  const invoice = { Id: "60", DocNumber: source.number, TxnDate: source.date, CustomerRef: { value: "50" }, CurrencyRef: { value: "AUD" }, TotalAmt: 1100, Balance: 1100, TxnTaxDetail: { TotalTax: 100 }, SyncToken: "2",
    Line: [{ DetailType: "SalesItemLineDetail", Description: source.lines[0].description, Amount: 1000, SalesItemLineDetail: { Qty: 2, UnitPrice: 500, ItemRef: { value: "20" } } }], MetaData: { CreateTime: "2025-01-01T00:00:00Z", LastUpdatedTime: "2025-01-01T00:00:00Z" } };
  const input = { localInvoices: [source], localCustomers: [{ id: "customer", ...source.customer }], invoices: [invoice], customers: [customer], mappings: [], workspaceId: "workspace", tenantId: "realm", configurationReady: true, canUpdate: () => true };
  const map = () => input.mappings.push({ provider: "quickbooks", external_tenant_id: "realm", local_entity_type: "invoice", local_entity_id: "invoice", external_entity_id: "60" });
  return { input, source, customer, invoice, map, run: () => analyzeReconciliation(input) };
}
test("reconciliation requires explicit all-history dry-run and refuses any apply or local production database", async () => {
  for (const args of [[], ["--apply"], ["--dry-run", "--apply"], ["--dry-run", "--from=2025-01-01"]]) assert.throws(() => parseReconciliationArgs(args), /Required/);
  assert.deepEqual(parseReconciliationArgs(["--dry-run"]), { mode: "dry-run", scope: "all-history" });
  await assert.rejects(reconciliationCli(["--dry-run"], { env: {}, output() {} }), /Run inside/);
});
test("exact normalized match is canonical; ItemRef and legacy source notes alone never cause cosmetic updates", () => {
  const f = fixture(); f.customer.DisplayName = "  EXAMPLE   PTY LTD "; f.invoice.Line[0].Description = " Replace   CONTACTOR and test unit ";
  f.invoice.Line[0].SalesItemLineDetail.ItemRef.value = "legacy"; f.invoice.PrivateNote = "ServiceM8:old-record-id";
  const result = f.run(); assert.equal(result.records[0].classification, "EXACT_MATCH"); assert.equal(result.records[0].proposedAction, "LINK_EXISTING_QB_INVOICE");
  assert.equal(result.quickbooksRecords[0].classification, "CANONICAL_ELSET_MATCH"); assert.equal(result.records[0].paymentDiscrepancy, "PAYMENT_MATCH");
  assert.equal(result.records[0].fingerprint, result.quickbooksRecords[0].fingerprint);
});
test("missing invoice with safe customer proposes create; invalid configuration and drafts block it", () => {
  const f = fixture(); f.input.invoices = [];
  assert.equal(f.run().records[0].proposedAction, "CREATE_QB_INVOICE");
  f.input.configurationReady = false; assert.equal(f.run().records[0].proposedAction, "REVIEW_CONFLICT");
  f.source.eligible = false; const row = f.run().records[0]; assert.equal(row.classification, "MISSING_IN_QB"); assert.equal(row.proposedAction, "NONE");
});
test("different unpaid invoice proposes update only for unambiguous identity and supported content", () => {
  const f = fixture(); f.invoice.TotalAmt = 1111; f.invoice.Balance = 1111;
  let row = f.run().records[0]; assert.equal(row.classification, "DIFFERENT_IN_QB"); assert.ok(row.flags.includes("TOTAL_DIFF")); assert.equal(row.proposedAction, "UPDATE_QB_INVOICE_TO_ELSET");
  f.invoice.CustomerRef.value = "other"; assert.equal(f.run().records[0].proposedAction, "REVIEW_CONFLICT");
  f.invoice.CustomerRef.value = "50"; f.input.canUpdate = () => false; assert.equal(f.run().records[0].proposedAction, "REVIEW_CONFLICT");
});
test("missing mapped invoice and unrelated mapped identity are broken rather than recreated", () => {
  const f = fixture(); f.map(); f.input.invoices = [];
  assert.equal(f.run().records[0].classification, "MAPPING_BROKEN"); assert.equal(f.run().records[0].proposedAction, "REVIEW_CONFLICT");
  f.input.invoices = [f.invoice]; f.invoice.DocNumber = "OTHER"; f.invoice.CustomerRef.value = "other";
  assert.equal(f.run().records[0].classification, "MAPPING_BROKEN");
});
test("a mapped exact duplicate group proposes canonical and void only for the unlinked duplicate", () => {
  const f = fixture(); f.map(); f.input.invoices.push({ ...structuredClone(f.invoice), Id: "61" });
  const result = f.run(); assert.equal(result.records[0].classification, "EXACT_MATCH");
  assert.equal(result.duplicateGroups[0].proposedCanonicalId, "60"); assert.equal(result.quickbooksRecords[1].classification, "LIKELY_DUPLICATE");
  assert.equal(result.quickbooksRecords[1].proposedAction, "VOID_QB_DUPLICATE");
  f.invoice.TotalAmt = 999; f.invoice.Balance = 999; f.input.invoices[1].TotalAmt = 999; f.input.invoices[1].Balance = 999;
  assert.equal(f.run().quickbooksRecords[1].proposedAction, "REVIEW_DUPLICATE");
});
test("identical unmapped duplicates never get an arbitrary canonical; variants show a unique exact candidate for review", () => {
  const f = fixture(); f.input.invoices.push({ ...structuredClone(f.invoice), Id: "61" });
  let result = f.run(); assert.equal(result.records[0].classification, "MULTIPLE_QB_CANDIDATES"); assert.equal(result.duplicateGroups[0].proposedCanonicalId, "");
  assert.ok(result.quickbooksRecords.every(row => row.proposedAction === "REVIEW_DUPLICATE"));
  f.input.invoices[1].TotalAmt = 1200; f.input.invoices[1].Balance = 1200;
  result = f.run(); assert.equal(result.duplicateGroups[0].proposedCanonicalId, "60"); assert.equal(result.quickbooksRecords[1].proposedAction, "REVIEW_DUPLICATE");
});
test("duplicates with different numbers are detected by content and close creation time, not number alone", () => {
  const f = fixture(); f.map(); f.input.invoices.push({ ...structuredClone(f.invoice), Id: "61", DocNumber: "LEGACY-1", MetaData: { CreateTime: "2025-01-01T00:01:00Z" } });
  const result = f.run(); assert.equal(result.duplicateGroups.length, 1); assert.equal(result.quickbooksRecords[1].proposedAction, "VOID_QB_DUPLICATE");
  f.input.invoices[1].Line[0].Description = "Different work";
  assert.equal(f.run().duplicateGroups.length, 0);
});
test("QB-only legitimate records stay review-only; weak alternate numbers cannot authorize a rewrite", () => {
  const f = fixture(); f.invoice.DocNumber = "MANUAL-1"; f.invoice.TxnDate = "2020-01-01";
  let result = f.run(); assert.equal(result.quickbooksRecords[0].classification, "QB_ONLY"); assert.equal(result.quickbooksRecords[0].proposedAction, "REVIEW_QB_ONLY");
  f.invoice.TxnDate = f.source.date; result = f.run();
  assert.equal(result.records[0].classification, "DIFFERENT_IN_QB"); assert.equal(result.records[0].proposedAction, "REVIEW_CONFLICT");
});
test("legacy number variants with corroborating customer/date evidence are differences, never missing creates or automatic renumbering", () => {
  const f = fixture(); f.invoice.DocNumber = "1"; f.invoice.Line[0].Description = "Older description";
  let result = f.run(); assert.equal(result.records[0].classification, "DIFFERENT_IN_QB"); assert.equal(result.records[0].proposedAction, "REVIEW_CONFLICT");
  assert.ok(result.records[0].flags.includes("LINE_DIFF")); assert.ok(result.records[0].flags.includes("NUMBER_VARIANT_REVIEW"));
  f.invoice.TxnDate = "2025-01-02"; result = f.run();
  assert.equal(result.records[0].classification, "DIFFERENT_IN_QB"); assert.equal(result.records[0].proposedAction, "REVIEW_CONFLICT");
});
test("uncorroborated number collisions block creation and remain ambiguous QuickBooks-only, without claiming a safe identity", () => {
  const f = fixture(); f.invoice.DocNumber = "1"; f.invoice.CustomerRef.value = "other"; f.invoice.TxnDate = "2020-01-01"; f.invoice.TotalAmt = 999; f.invoice.Line = [];
  const result = f.run(); assert.equal(result.records[0].classification, "MISSING_IN_QB"); assert.equal(result.records[0].proposedAction, "REVIEW_CONFLICT");
  assert.equal(result.records[0].possibleCandidates[0].id, "60"); assert.equal(result.quickbooksRecords[0].classification, "AMBIGUOUS_QB_ONLY");
});
test("a single external candidate shared by local invoices is ambiguous, never linked twice", () => {
  const f = fixture(); f.input.localInvoices.push({ ...structuredClone(f.source), id: "other", number: "INV-0002" });
  const result = f.run(); assert.ok(result.records.every(row => row.classification === "MULTIPLE_QB_CANDIDATES"));
  assert.ok(result.records.every(row => row.paymentDiscrepancy === "PAYMENT_REVIEW_REQUIRED"));
  assert.ok(result.records.every(row => row.proposedAction === "REVIEW_CONFLICT")); assert.equal(result.quickbooksRecords[0].classification, "AMBIGUOUS_QB_ONLY");
});
test("customer duplicate names/email evidence prevents guesses and creation", () => {
  const f = fixture(); f.input.customers.push({ ...f.customer, Id: "51" });
  assert.equal(f.run().records[0].customerResolution.state, "AMBIGUOUS"); assert.equal(f.run().records[0].proposedAction, "REVIEW_CONFLICT");
  assert.equal(f.run().records[0].paymentDiscrepancy, "PAYMENT_REVIEW_REQUIRED");
  f.input.invoices = []; assert.equal(f.run().records[0].proposedAction, "REVIEW_CONFLICT");
});
test("voided invoices are separately classified and never recreated or voided again", () => {
  const f = fixture(); f.invoice.PrivateNote = "Voided"; f.invoice.TotalAmt = 0; f.invoice.Balance = 0; f.invoice.TxnTaxDetail.TotalTax = 0;
  const result = f.run(); assert.equal(result.records[0].classification, "VOIDED_IN_QB"); assert.equal(result.quickbooksRecords[0].classification, "VOIDED");
  assert.equal(result.records[0].proposedAction, "REVIEW_CONFLICT"); assert.equal(result.quickbooksRecords[0].proposedAction, "NONE");
});
test("payment, credit, deposit and unknown linked accounting relationships prevent destructive proposals", async t => {
  for (const kind of ["Payment", "CreditMemo", "Deposit", "Estimate", "balance-only", "deposit-amount", "reverse-credit", "reverse-deposit"]) await t.test(kind, () => {
    const f = fixture(); f.map(); const duplicate = { ...structuredClone(f.invoice), Id: "61" }; f.input.invoices.push(duplicate);
    if (kind === "balance-only") duplicate.Balance = 1000;
    else if (kind === "deposit-amount") duplicate.Deposit = 100;
    else if (kind === "reverse-credit" || kind === "reverse-deposit") {
      f.input.payments = [{ Id: "80", Line: [{ LinkedTxn: [{ TxnId: "61", TxnType: "Invoice" }, { TxnId: "90", TxnType: "CreditMemo" }] }] }];
      if (kind === "reverse-deposit") f.input.deposits = [{ Id: "91", Line: [{ LinkedTxn: [{ TxnId: "80", TxnType: "Payment" }] }] }];
    } else duplicate.LinkedTxn = [{ TxnId: "80", TxnType: kind }];
    assert.equal(f.run().quickbooksRecords[1].proposedAction, "REVIEW_DUPLICATE");
    f.input.invoices = [duplicate]; f.input.mappings[0].external_entity_id = "61"; duplicate.TotalAmt = 1111;
    assert.equal(f.run().records[0].proposedAction, "REVIEW_PAYMENT");
  });
});
test("money and quantity normalization uses scaled integers, preserves fractional rate differences and fingerprints deterministically", () => {
  assert.equal(scaled(0.1 + 0.2), 30); assert.equal(scaled("1.005"), 101); assert.equal(scaled(-1.005), -101); assert.equal(scaled("invalid"), null);
  const f = fixture(), first = normalizeInvoice(f.invoice); assert.equal(normalizeInvoice(structuredClone(f.invoice)).fingerprint, first.fingerprint);
  f.invoice.Line[0].SalesItemLineDetail.UnitPrice = 500.000001;
  assert.equal(f.run().records[0].classification, "DIFFERENT_IN_QB");
});
test("pagination reads more than 100 or 1000 records, including beyond the old 20-page settings limit", async () => {
  const data = Array.from({ length: 20001 }, (_, index) => ({ Id: String(index + 1) })); const starts = [];
  const service = { provider: { request: async (_context, endpoint) => { const query = new URL(`https://example.test/${endpoint}`).searchParams.get("query"), start = Number(query.match(/STARTPOSITION (\d+)/)[1]); starts.push(start); return { QueryResponse: { Invoice: data.slice(start - 1, start + 999) } }; } } };
  assert.equal((await fetchAll(service, {}, "Invoice")).length, 20001); assert.equal(starts.at(-1), 20001);
  service.provider.request = async () => ({ QueryResponse: { Invoice: Array.from({ length: 1000 }, (_, index) => ({ Id: String(index) })) } });
  await assert.rejects(fetchAll(service, {}, "Invoice"), /pagination/);
});
test("read-only transport blocks every financial write and invoice-send operation, even GET send", async () => {
  let calls = 0; const transport = readOnlyFetch(async () => { calls++; return Response.json({}); }, { paceMs: 0 });
  for (const endpoint of ["invoice", "customer", "item", "payment", "invoice/1/send", "creditmemo", "deposit", "invoice?operation=void", "invoice?operation=delete"]) await assert.rejects(transport(`https://quickbooks.api.intuit.com/v3/company/123/${endpoint}`, { method: "POST", body: "{}" }), /Blocked/);
  await assert.rejects(transport("https://quickbooks.api.intuit.com/v3/company/123/invoice/1/send"), /Blocked/);
  await assert.rejects(transport("https://sandbox-quickbooks.api.intuit.com/v3/company/123/query"), /Blocked/);
  assert.equal(calls, 0); assert.equal(transport.audit.quickbooksMutations, 0);
});
test("reports account for both sides, duplicate CSV has financial and canonical evidence, archive sanitizer retains SyncToken", t => {
  const f = fixture(); f.map(); f.input.invoices.push({ ...structuredClone(f.invoice), Id: "61" }); f.source.customer.name = '=customer("test")';
  f.input.mappings.push({ provider: "quickbooks", external_tenant_id: "realm", local_entity_type: "customer", local_entity_id: "customer", external_entity_id: "50" });
  const report = f.run(); const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-report-"));
  const paths = writeReconciliationReports(report, directory, "fixture");
  t.after(() => { for (const filename of Object.values(paths)) fs.unlinkSync(filename); fs.rmdirSync(directory); });
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.json, "utf8")), report);
  const csv = fs.readFileSync(paths.duplicates, "utf8"); assert.ok(csv.includes("qbLinkedTransactionCount")); assert.ok(csv.includes("VOID_QB_DUPLICATE")); assert.ok(csv.includes("'="));
  assert.equal(fs.readFileSync(paths.csv, "utf8").split("\n").length, 4);
  assert.deepEqual(withoutSecrets({ SyncToken: "2", access_token: "secret", nested: { clientSecret: "secret", Line: [] } }), { SyncToken: "2", nested: { Line: [] } });
});

async function integration(t) {
  const db = openWorkspaceDb({ dbPath: ":memory:" }); t.after(() => db.close());
  db.exec("INSERT INTO customers(id,name,email,created_at) VALUES('customer','Example Pty Ltd','billing@example.test','2025-01-01'); INSERT INTO jobs(id,job_number,title,customer_id,status,created_at,updated_at) VALUES('job',1,'Work','customer','Completed','2025-01-01','2025-01-01')");
  insertInvoiceTree(db, "job", { id: "invoice", issueDate: "2025-01-01", dueDate: "2025-01-31", items: [{ description: "Work", qty: 1, rate: 100 }], sentHistory: [{ id: "sent", sentAt: "2025-01-01" }] });
  updateWorkspaceAddons(db, { quickbooks: true });
  const mock = createQuickBooksMock(), env = { NODE_ENV: "test", QUICKBOOKS_ENVIRONMENT: "production", QUICKBOOKS_CLIENT_ID: "fixture", QUICKBOOKS_CLIENT_SECRET: "fixture-secret", QUICKBOOKS_REDIRECT_URI: "https://example.test/callback", ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  const service = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: mock.fetch, authorizeOAuthInitiator: async () => true });
  const state = new URL((await service.connect("admin", "session")).url).searchParams.get("state"); await service.callback({ state, code: "fixture", realmId: mock.realm });
  await service.configure({ itemId: "20", taxMappings: { taxable: "30" } }); mock.calls.length = 0;
  const run = archive => runReconciliation(db, { env, fetchImpl: mock.fetch, paceMs: 0, archive, output() {} });
  return { db, mock, service, run };
}
test("full dry-run archives all entities before analysis, has zero local business or QuickBooks writes and no send endpoint", async t => {
  const f = await integration(t);
  const tables = ["invoices", "invoice_line_items", "payments", "customers", "integration_entity_mappings", "integration_operations", "integration_sync_log"];
  const snapshot = () => JSON.stringify(tables.map(table => f.db.prepare(`SELECT * FROM ${table}`).all())); const before = snapshot(); let archive;
  const result = await f.run(value => { archive = value; return "synthetic-archive.json"; });
  assert.equal(result.complete, true); assert.equal(result.summary.elsetInvoices, 1); assert.equal(result.summary.elset.MISSING_IN_QB, 1);
  assert.ok(archive); for (const key of ["invoices", "customers", "items", "payments", "credits", "deposits"]) assert.ok(Array.isArray(archive[key]));
  assert.equal(snapshot(), before); assert.ok(f.mock.calls.every(call => call.method === "GET" && !call.url.includes("/send")));
  assert.equal(result.apiAudit.quickbooksMutations, 0); assert.ok(!JSON.stringify(archive).includes("fixture-secret"));
});
test("archive failure, rate limiting and incomplete reads cannot produce a complete action plan", async t => {
  const f = await integration(t); let report = await f.run(() => { throw new Error("disk full"); });
  assert.equal(report.complete, false); assert.equal(report.records, undefined);
  f.mock.failNext = { path: "/query", status: 429, headers: { "Retry-After": "120" } };
  report = await f.run(() => "archive"); assert.equal(report.stopped, "RATE_LIMITED"); const calls = f.mock.calls.length;
  report = await f.run(() => "archive"); assert.equal(report.complete, false); assert.equal(f.mock.calls.length, calls);
});
