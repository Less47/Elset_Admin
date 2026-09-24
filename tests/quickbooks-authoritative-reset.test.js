// Temporary synthetic reset coverage. No real accounting or Fly requests.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { parseResetArgs, planReset, sourceHash, meaningfulMatch, invoiceUpdatePayload } from "../scripts/quickbooks-authoritative-reset-core.mjs";
import { applyReset, createResetAdapter, resetTransport, verifyFlySnapshot } from "../scripts/quickbooks-authoritative-reset.mjs";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { AccountingService } from "../server-accounting-service.js";
import { insertInvoiceTree } from "../server-workspace-documents.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { createQuickBooksMock } from "./helpers/quickbooks-mock.js";

const range = { from: "2026-08-01", to: "2026-09-22" };
function fixture() {
  const source = { id: "local", jobId: "job", customerId: "local-customer", number: "INV-0252", date: "2026-08-27", dueDate: "2026-08-27", currency: "AUD", eligible: true, reason: "", customer: { name: "Example", email: "example@test.invalid" },
    lines: [{ id: "line", description: "Double power point", quantity: 3, unitAmountCents: 16000, amountCents: 48000, taxCents: 4800, taxTreatment: "taxable" }], subtotalCents: 48000, taxCents: 4800, totalCents: 52800, paidCents: 52800 };
  const invoice = { Id: "346", DocNumber: "251", TxnDate: source.date, DueDate: source.dueDate, CustomerRef: { value: "94", name: "Example" }, CurrencyRef: { value: "AUD" }, TotalAmt: 528, Balance: 0, SyncToken: "2", TxnTaxDetail: { TotalTax: 48 },
    Line: [{ Id: "1", DetailType: "SalesItemLineDetail", Description: source.lines[0].description, Amount: 480, SalesItemLineDetail: { Qty: 3, UnitPrice: 160, ItemRef: { value: "121" }, ItemAccountRef: { value: "16" }, TaxCodeRef: { value: "5" } } }],
    MetaData: { CreateTime: "2026-08-27T01:00:00Z" }, LinkedTxn: [{ TxnId: "348", TxnType: "Payment" }] };
  const duplicate = { ...structuredClone(invoice), Id: "353", DocNumber: source.number, Balance: 528, SyncToken: "0", LinkedTxn: [], MetaData: { CreateTime: "2026-09-21T01:00:00Z" } };
  const payment = { Id: "348", SyncToken: "0", TxnDate: "2026-09-08", CustomerRef: { value: "94" }, CurrencyRef: { value: "AUD" }, TotalAmt: 528, UnappliedAmt: 0, Line: [{ Amount: 528, LinkedTxn: [{ TxnId: "346", TxnType: "Invoice" }] }] };
  const input = { localInvoices: [source], localCustomers: [{ id: source.customerId, ...source.customer }], workspaceId: "workspace", tenantId: "realm", configurationReady: true,
    mappings: [{ provider: "quickbooks", external_tenant_id: "realm", local_entity_type: "invoice", local_entity_id: source.id, external_entity_id: "353" }],
    catalog: [], config: { itemId: "123", incomeAccountId: "9", taxMappings: { taxable: "5" } },
    inventory: { invoices: [invoice, duplicate], customers: [{ Id: "94", DisplayName: "Example", PrimaryEmailAddr: { Address: source.customer.email }, Active: true }],
      items: [{ Id: "123", Name: "ELSET Services", Type: "Service", Active: true, IncomeAccountRef: { value: "9" } }], payments: [payment], credits: [], deposits: [] } };
  const plan = () => planReset(input, range);
  return { source, invoice, duplicate, payment, input, plan };
}

function executorFixture(f) {
  const writes = [], mappings = [], archiveEntries = [], events = [];
  let sequence = 800;
  const adapter = {
    load: async () => structuredClone(f.input),
    readInvoice: async id => structuredClone(f.input.inventory.invoices.find(row => row.Id === id)),
    assertSource(source) { assert.equal(sourceHash(f.input.localInvoices.find(row => row.id === source.id)), sourceHash(source)); },
    async write(endpoint, payload, id, operation) {
      assert.equal(endpoint, "invoice"); writes.push({ endpoint, payload: structuredClone(payload), id, operation });
      let row = f.input.inventory.invoices.find(row => row.Id === payload.Id);
      if (payload.Id) {
        if (row.SyncToken !== payload.SyncToken) { const error = new Error(); error.code = "STALE_SYNC_TOKEN"; throw error; }
        if (operation === "void") { row.TotalAmt = 0; row.Balance = 0; row.PrivateNote = "Voided"; row.TxnTaxDetail.TotalTax = 0; row.Line.forEach(line => { line.Amount = 0; }); }
        else {
          Object.assign(row, structuredClone(payload));
          if (payload.Line) { const subtotal = payload.Line.reduce((n, line) => n + line.Amount, 0); row.TxnTaxDetail = { TotalTax: Math.round(subtotal * 10) / 100 }; row.TotalAmt = Math.round(subtotal * 110) / 100; row.Balance = row.TotalAmt; }
        }
        row.SyncToken = String(Number(row.SyncToken) + 1); row.sparse = false;
      } else {
        const subtotal = payload.Line.reduce((n, line) => n + line.Amount, 0);
        row = { ...structuredClone(payload), Id: String(sequence++), SyncToken: "0", TotalAmt: Math.round(subtotal * 110) / 100, Balance: Math.round(subtotal * 110) / 100, TxnTaxDetail: { TotalTax: Math.round(subtotal * 10) / 100 }, LinkedTxn: [], sparse: false };
        f.input.inventory.invoices.push(row);
      }
      return { Invoice: structuredClone(row) };
    },
    finish() {}, customer: async (_source, resolution) => resolution.id,
    async newInvoicePayload(source, customerId) { return { DocNumber: source.number, TxnDate: source.date, DueDate: source.dueDate, CustomerRef: { value: customerId }, CurrencyRef: { value: "AUD" }, GlobalTaxCalculation: "TaxExcluded",
      Line: source.lines.map(line => ({ DetailType: "SalesItemLineDetail", Description: line.description, Amount: line.amountCents / 100, SalesItemLineDetail: { ItemRef: { value: "123" }, Qty: line.quantity, UnitPrice: line.unitAmountCents / 100, TaxCodeRef: { value: "5" } } })) }; },
    mapInvoice(source, raw, customerId, previousId, options = {}) {
      assert.equal(meaningfulMatch(source, options.allowNumberDifference ? { ...raw, DocNumber: source.number } : raw, customerId), true);
      mappings.push({ id: raw.Id, previousId });
      let mapping = f.input.mappings.find(row => row.local_entity_type === "invoice" && row.local_entity_id === source.id);
      if (!mapping) { mapping = { provider: "quickbooks", external_tenant_id: "realm", local_entity_type: "invoice", local_entity_id: source.id }; f.input.mappings.push(mapping); }
      mapping.external_entity_id = raw.Id;
    },
  };
  const run = approved => applyReset(approved || f.plan(), { adapter, archive: async entry => { archiveEntries.push(structuredClone(entry)); return `archive-${archiveEntries.length}`; }, event: entry => events.push(entry), snapshot: { snapshotId: "vs_fixture", verifiedAt: new Date().toISOString() } });
  return { adapter, run, writes, mappings, archiveEntries, events };
}

test("date cutoff is mandatory and apply requires reviewed plan and fresh snapshot arguments", () => {
  for (const args of [[], ["--reset-dry-run"], ["--reset-dry-run", "--from=2026-02-30"], ["--reset-dry-run", "--reset-apply", "--from=2026-01-01"], ["--reset-dry-run", "--from=2027-01-01"], ["--reset-apply", "--from=2026-01-01"]]) assert.throws(() => parseResetArgs(args, "2026-09-22"));
  assert.deepEqual(parseResetArgs(["--reset-dry-run", "--from=2026-08-01"], "2026-09-22"), { mode: "reset-dry-run", from: "2026-08-01", to: "2026-09-22" });
});
test("paid canonical beats newer unpaid mapped duplicate; payments do not need mutation", () => {
  const f = fixture(), row = f.plan().records[0];
  assert.equal(row.canonicalId, "346"); assert.equal(row.primaryAction, "REMAP_TO_DIFFERENT_QB_RECORD");
  assert.deepEqual(row.duplicateIds, ["353"]); assert.deepEqual(row.updateFields, ["DocNumber"]); assert.deepEqual(row.reviews, []);
});
test("a fake paid state or wrong-customer allocation cannot win canonical selection", () => {
  const f = fixture(); f.payment.CustomerRef.value = "wrong";
  assert.equal(f.plan().records[0].canonicalId, "353");
  assert.equal(f.plan().records[0].duplicateIds.length, 0);
});
test("linked duplicate is preserved and credit/deposit state prevents void", () => {
  for (const type of ["Payment", "CreditMemo", "Deposit", "Unknown"]) {
    const f = fixture(); f.duplicate.LinkedTxn = [{ TxnId: "999", TxnType: type }];
    const row = f.plan().records[0]; assert.equal(row.duplicateIds.length, 0);
    assert.ok(row.warnings.some(w => w.startsWith("LINKED_DUPLICATE_PRESERVED")));
  }
});
test("older QB targets and out-of-range ELSET invoices are never proposed for mutation", () => {
  const f = fixture(); f.invoice.TxnDate = "2026-07-31"; f.duplicate.TxnDate = "2026-07-31";
  const row = f.plan().records[0]; assert.ok(row.reviews.includes("CANONICAL_OUTSIDE_DATE_RANGE_NO_TOUCH")); assert.deepEqual(row.actions, []);
  f.source.date = "2026-07-31"; assert.equal(f.plan().records.length, 0);
});
test("missing invoices can be created while existing paid amounts are explicitly reported", () => {
  const f = fixture(); f.input.inventory.invoices = []; f.input.mappings = [];
  const row = f.plan().records[0]; assert.deepEqual(row.actions, ["CREATE_QB"]); assert.ok(row.warnings.some(w => w.includes("No Payment")));
  f.input.inventory.customers = []; assert.deepEqual(f.plan().records[0].actions, ["CREATE_QB"]);
});
test("ambiguous numbering and another ELSET owner block creation or destructive adoption", () => {
  const f = fixture(); f.input.inventory.invoices = [f.invoice]; f.input.mappings = [];
  const other = structuredClone(f.source); other.id = "other"; other.number = "INV-0251"; f.input.localInvoices.push(other);
  assert.ok(f.plan().records.every(row => row.reviews.includes("CANONICAL_IDENTITY_REVIEW_REQUIRED")));
});
test("cosmetic items, reordered lines and whitespace do not generate line updates", () => {
  const f = fixture(); f.input.inventory.invoices = [f.duplicate]; f.input.inventory.payments = []; f.source.paidCents = 0;
  f.source.lines.push({ id: "zero", description: "Commission test", quantity: 1, unitAmountCents: 0, amountCents: 0, taxCents: 0, taxTreatment: "taxable" });
  f.duplicate.Line.unshift({ DetailType: "SalesItemLineDetail", Description: "  COMMISSION\r\n test ", Amount: 0, SalesItemLineDetail: { Qty: 1, UnitPrice: 0, ItemRef: { value: "old" } } });
  const row = f.plan().records[0]; assert.equal(row.primaryAction, "KEEP_AS_IS"); assert.deepEqual(row.updateFields, []);
});
test("linked invoice customer/date or financial edits require review", () => {
  const f = fixture(); f.input.inventory.invoices = [f.invoice]; f.input.mappings[0].external_entity_id = "346"; f.invoice.DocNumber = f.source.number; f.invoice.TxnDate = "2026-08-26";
  assert.ok(f.plan().records[0].reviews.some(r => r.startsWith("LINKED_OR_SETTLED")));
});
test("unlinked clear invoice can receive required content changes while retaining historical ItemRef", () => {
  const f = fixture(); f.input.inventory.invoices = [f.duplicate]; f.input.inventory.payments = []; f.duplicate.Line[0].Description = "Older wording";
  const row = f.plan().records[0]; assert.ok(row.actions.includes("UPDATE_QB_TO_ELSET")); assert.ok(row.updateFields.includes("Line"));
  const payload = invoiceUpdatePayload(f.source, f.duplicate, "94", f.input.config, row.updateFields);
  assert.equal(payload.Line[0].Description, f.source.lines[0].description); assert.equal(payload.Line[0].SalesItemLineDetail.ItemRef.value, "121");
});
test("unrelated QB-only records are left and Xero-owned invoices are not adopted", () => {
  const f = fixture(); const extra = structuredClone(f.invoice); extra.Id = "900"; extra.CustomerRef.value = "other"; extra.DocNumber = "other"; extra.TxnDate = "2026-08-28"; f.input.inventory.invoices.push(extra);
  assert.equal(f.plan().qbOnly.find(row => row.qbId === "900").action, "LEAVE_REPORT");
  f.input.mappings.push({ provider: "xero", external_tenant_id: "xero-company", local_entity_type: "invoice", local_entity_id: f.source.id, external_entity_id: "xero-id" });
  assert.ok(f.plan().records[0].reviews.includes("OTHER_ACCOUNTING_OWNER"));
});
test("pure dry-run planner mutates neither financial records nor mappings", () => {
  const f = fixture(), before = structuredClone(f.input); f.plan(); assert.deepEqual(f.input, before);
});
test("transport rejects all Payment mutations, send equivalents, delete and dry-run writes", async () => {
  let requests = 0;
  for (const mode of ["reset-dry-run", "reset-apply"]) {
    const guard = resetTransport(async () => { requests++; return new Response("{}"); }, { mode, tenantId: "123", paceMs: 0 });
    for (const [endpoint, method] of [["payment", "POST"], ["invoice/1/send", "POST"], ["invoice/1/send", "GET"], ["invoice/1/sendEmail", "GET"], ["invoice?operation=delete", "POST"], ["invoice/1", "DELETE"], ["invoice", "POST"]]) await assert.rejects(guard(`https://quickbooks.api.intuit.com/v3/company/123/${endpoint}`, { method, body: method === "POST" ? "{}" : undefined }), /blocked/);
    assert.throws(() => guard.permit("payment", {}));
    if (mode === "reset-dry-run") assert.throws(() => guard.permit("invoice", {}));
  }
  assert.equal(requests, 0);
});
test("apply transport requires a one-use capability for the precise approved payload", async () => {
  let requests = 0; const guard = resetTransport(async () => { requests++; return new Response("{}"); }, { mode: "reset-apply", tenantId: "123", paceMs: 0 });
  const payload = { Id: "1", SyncToken: "2", sparse: true, DocNumber: "INV-0001" }; guard.permit("invoice", payload);
  await assert.rejects(guard("https://quickbooks.api.intuit.com/v3/company/123/invoice", { method: "POST", body: "{}" }));
  await guard("https://quickbooks.api.intuit.com/v3/company/123/invoice", { method: "POST", body: JSON.stringify(payload) });
  await assert.rejects(guard("https://quickbooks.api.intuit.com/v3/company/123/invoice", { method: "POST", body: JSON.stringify(payload) }));
  assert.equal(requests, 1);
});
test("apply remaps paid 346, releases/voids unlinked 353, aligns number, preserves Payment 348 and is idempotent", async () => {
  const f = fixture(), x = executorFixture(f), originalPayment = structuredClone(f.payment), approved = f.plan();
  const result = await x.run(approved);
  assert.equal(result.outcomes[0].status, "ALIGNED"); assert.equal(f.input.mappings[0].external_entity_id, "346");
  assert.equal(f.invoice.DocNumber, f.source.number); assert.equal(f.duplicate.TotalAmt, 0); assert.equal(f.duplicate.DocNumber, "VOID-353");
  assert.deepEqual(f.payment, originalPayment); assert.equal(result.verification.paymentsUnchanged, true); assert.equal(result.exceptions.length, 0);
  assert.ok(x.archiveEntries.length >= 4); assert.ok(x.writes.every(row => row.endpoint === "invoice"));
  const count = x.writes.length; const second = await x.run(approved); assert.equal(x.writes.length, count); assert.equal(second.outcomes[0].status, "ALREADY_ALIGNED");
});
test("missing invoice is created and mapped only after a validated reread, with no Payment creation", async () => {
  const f = fixture(); f.input.inventory.invoices = []; f.input.inventory.payments = []; f.input.mappings = [];
  const x = executorFixture(f), result = await x.run();
  assert.equal(result.outcomes[0].status, "CREATED"); assert.equal(x.writes.length, 1); assert.equal(x.mappings.length, 1);
  assert.equal(f.input.inventory.invoices[0].Balance, 528); assert.equal(f.input.inventory.payments.length, 0);
  assert.ok(result.exceptions.some(row => row.warnings?.includes("PAYMENT_AMOUNT_DIFFERENCE_NO_PAYMENT_MUTATION")));
});
test("existing unlinked invoice update validates ELSET content before storing mapping", async () => {
  const f = fixture(); f.input.inventory.invoices = [f.duplicate]; f.input.inventory.payments = []; f.source.paidCents = 0; f.duplicate.Line[0].Description = "Old description";
  const x = executorFixture(f), result = await x.run(); assert.equal(result.outcomes[0].status, "ALIGNED");
  assert.equal(f.duplicate.Line[0].Description, f.source.lines[0].description); assert.equal(x.mappings.length, 1);
});
test("fresh SyncToken is used and stale-token failures never store unverified mappings", async () => {
  const f = fixture(); f.input.inventory.invoices = [f.duplicate]; f.input.inventory.payments = []; f.source.paidCents = 0; f.duplicate.DocNumber = "252";
  const x = executorFixture(f), approved = f.plan(); f.duplicate.SyncToken = "9";
  await x.run(approved); assert.equal(x.writes[0].payload.SyncToken, "9");
  const g = fixture(); g.input.inventory.invoices = [g.duplicate]; g.input.inventory.payments = []; g.duplicate.DocNumber = "252";
  const y = executorFixture(g), write = y.adapter.write;
  y.adapter.write = async (...args) => { g.duplicate.SyncToken = "99"; return write(...args); };
  const result = await y.run(); assert.equal(result.outcomes[0].reason, "STALE_SYNC_TOKEN"); assert.equal(y.mappings.length, 0);
});
test("new accounting links or changed source after dry-run block unsafe writes", async () => {
  const f = fixture(), approved = f.plan(), x = executorFixture(f); f.duplicate.LinkedTxn = [{ TxnType: "CreditMemo", TxnId: "credit" }];
  const result = await x.run(approved); assert.equal(x.writes.length, 0); assert.equal(x.mappings.length, 0); assert.equal(result.outcomes[0].reason, "DRY_RUN_PLAN_CHANGED");
  const g = fixture(), before = g.plan(), y = executorFixture(g); g.source.lines[0].description = "Changed";
  assert.equal((await y.run(before)).outcomes[0].reason, "LOCAL_EDIT_CONFLICT"); assert.equal(y.writes.length, 0);
});
test("readback mismatch and archive failure leave no unverified mapping", async () => {
  const f = fixture(); f.input.inventory.invoices = []; f.input.inventory.payments = []; f.input.mappings = [];
  const x = executorFixture(f), original = x.adapter.write;
  x.adapter.write = async (...args) => { const result = await original(...args); f.input.inventory.invoices[0].TotalAmt = 999; return result; };
  assert.equal((await x.run()).outcomes[0].reason, "INVOICE_READBACK_FAILED"); assert.equal(x.mappings.length, 0);
  const g = fixture(), y = executorFixture(g);
  await assert.rejects(applyReset(g.plan(), { adapter: y.adapter, archive: async () => null, event() {}, snapshot: { snapshotId: "vs_test", verifiedAt: new Date().toISOString() } }), /ARCHIVE_REQUIRED/);
  assert.equal(y.writes.length, 0);
});
test("snapshot verification checks the actual mount, completion and freshness using GET only", async () => {
  const now = Date.now(), recent = new Date(now - 10_000).toISOString(), approvedAt = new Date(now - 20_000).toISOString();
  let volume = { id: "vol_fixture", attached_machine_id: "a123" }, snapshot = { id: "vs_fixture", created_at: recent, digest: "digest", size: 1, status: "created" };
  const fetchImpl = async (url, options) => { assert.equal(options.method, undefined); return Response.json(url.endsWith("/snapshots") ? [snapshot] : url.includes("/volumes/") ? volume : { id: "a123", config: { mounts: [{ path: "/app/data", volume: "vol_fixture" }] } }); };
  const args = { app: "elset-admin", machineId: "a123", volumeId: "vol_fixture", snapshotId: "vs_fixture", token: "fixture-token", approvedAt, now, fetchImpl };
  assert.equal((await verifyFlySnapshot(args)).snapshotId, "vs_fixture");
  snapshot = { ...snapshot, status: "running" }; await assert.rejects(verifyFlySnapshot(args), /FRESH_COMPLETED/);
  snapshot = { ...snapshot, status: "created", created_at: new Date(now - 7200000).toISOString() }; await assert.rejects(verifyFlySnapshot(args), /FRESH_COMPLETED/);
  volume = { ...volume, attached_machine_id: "other" }; await assert.rejects(verifyFlySnapshot(args), /WRONG_VOLUME/);
});

function liveAdapterFixture(t, mode) {
  const db = openWorkspaceDb({ dbPath: ":memory:" }); t.after(() => db.close());
  db.exec("INSERT INTO customers(id,name,email,created_at) VALUES('c','Example','example@test.invalid','2026-08-27'); INSERT INTO jobs(id,job_number,title,customer_id,status,created_at,updated_at) VALUES('j',252,'Example','c','Completed','2026-08-27','2026-08-27')");
  insertInvoiceTree(db, "j", { id: "i", issueDate: "2026-08-27", dueDate: "2026-08-27", items: [{ description: "Saved work description", qty: 3, rate: 160 }], sentHistory: [{ id: "sent", sentAt: "2026-08-27", toEmail: "example@test.invalid" }], payments: [] });
  updateWorkspaceAddons(db, { quickbooks: true });
  const mock = createQuickBooksMock(), env = { QUICKBOOKS_CLIENT_ID: "fixture-client", QUICKBOOKS_CLIENT_SECRET: "fixture-secret", QUICKBOOKS_REDIRECT_URI: "https://example.test/callback", QUICKBOOKS_ENVIRONMENT: "production", ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  mock.customers.push({ Id: "94", DisplayName: "Example", Active: true, PrimaryEmailAddr: { Address: "example@test.invalid" } });
  const transport = resetTransport(mock.fetch, { mode, tenantId: mock.realm, paceMs: 0 }), service = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: transport });
  service.store.ensureIntegration();
  service.store.update({ ...service.credentialValues({ accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600000, scopes: service.provider.requiredScopes }), status: "CONNECTED", provider_environment: "production", external_tenant_id: mock.realm,
    organisations_json: JSON.stringify([{ id: mock.realm }]), config_json: JSON.stringify({ itemId: "20", incomeAccountId: "10", taxMappings: { taxable: "30" } }) });
  const adapter = createResetAdapter(service, transport, mode, () => {});
  return { db, mock, adapter, service, transport };
}
test("real database/provider adapter dry-run reads make zero mapping/business/provider writes", async t => {
  const f = liveAdapterFixture(t, "reset-dry-run"), changes = f.db.prepare("SELECT total_changes() n").get().n;
  const input = await f.adapter.load(), report = planReset(input, range);
  assert.equal(report.summary.operations.CREATE_QB, 1); assert.equal(f.transport.audit.quickbooksMutations, 0);
  assert.equal(f.db.prepare("SELECT total_changes() n").get().n, changes); assert.equal(f.db.prepare("SELECT count(*) n FROM integration_entity_mappings").get().n, 0);
  await assert.rejects(f.adapter.customer(input.localInvoices[0], report.records[0].customerResolution), /DRY_RUN_WRITE/);
});
test("new invoices use validated per-line catalog mapping and ad-hoc fallback without rewriting saved descriptions", async t => {
  const f = liveAdapterFixture(t, "reset-apply");
  f.db.prepare("INSERT INTO price_list_items(id,name,description,unit_price_cents,unit,tax_treatment,archived,created_at,updated_at) VALUES('catalog','Labour','Catalog text',99900,'hour','taxable',0,?,?)").run("2026-08-27", "2026-08-27");
  f.db.prepare("UPDATE invoice_line_items SET extra_json=? WHERE invoice_id='i'").run(JSON.stringify({ priceListItemId: "catalog" }));
  const input = await f.adapter.load(), source = input.localInvoices[0], before = structuredClone(source);
  const payload = await f.adapter.newInvoicePayload(source, "94");
  assert.equal(payload.Line[0].Description, "Saved work description"); assert.equal(payload.Line[0].Amount, 480); assert.equal(payload.Line[0].SalesItemLineDetail.Qty, 3);
  const mapped = f.service.store.mapping(f.mock.realm, "price-list-item", "catalog"); assert.ok(mapped); assert.equal(payload.Line[0].SalesItemLineDetail.ItemRef.value, mapped.external_entity_id);
  assert.deepEqual(source, before); assert.equal(f.mock.calls.filter(row => row.method === "POST" && new URL(row.url).pathname.endsWith("/item")).length, 1);
  await f.adapter.newInvoicePayload(source, "94"); assert.equal(f.mock.calls.filter(row => row.method === "POST" && new URL(row.url).pathname.endsWith("/item")).length, 1);
});

test("actual mapping store only remaps a verified canonical and rejects stale mappings or wrong totals", async t => {
  const f = liveAdapterFixture(t, "reset-apply"), input = await f.adapter.load(), source = input.localInvoices[0];
  const raw = fixture().invoice; raw.Line[0].Description = source.lines[0].description;
  f.service.store.map(f.mock.realm, "invoice", source.id, "353", source.number);
  f.adapter.mapInvoice(source, raw, "94", "353", { allowNumberDifference: true });
  assert.equal(f.service.store.mapping(f.mock.realm, "invoice", source.id).external_entity_id, "346");
  assert.throws(() => f.adapter.mapInvoice(source, { ...raw, TotalAmt: 999 }, "94", "346", { allowNumberDifference: true }), /UNVERIFIED_MAPPING/);
  assert.throws(() => f.adapter.mapInvoice(source, { ...raw, Id: "400" }, "94", "353", { allowNumberDifference: true }), /MAPPING_EDIT_CONFLICT/);
  assert.equal(f.service.store.mapping(f.mock.realm, "invoice", source.id).external_entity_id, "346");
});
test("ad-hoc lines use configured fallback and newly created customers are reread before mapping", async t => {
  const f = liveAdapterFixture(t, "reset-apply"); f.mock.customers.splice(0);
  const input = await f.adapter.load(), source = input.localInvoices[0], plan = planReset(input, range);
  const customerId = await f.adapter.customer(source, plan.records[0].customerResolution);
  assert.ok(f.mock.calls.some(call => call.method === "GET" && new URL(call.url).pathname.endsWith(`/customer/${customerId}`)));
  assert.equal(f.service.store.mapping(f.mock.realm, "customer", source.customerId).external_entity_id, customerId);
  const payload = await f.adapter.newInvoicePayload(source, customerId);
  assert.equal(payload.Line[0].SalesItemLineDetail.ItemRef.value, "20");
  assert.equal(f.mock.calls.filter(call => call.method === "POST" && new URL(call.url).pathname.endsWith("/item")).length, 0);
});
test("unlinked customer/date corrections preserve existing record identity", () => {
  const f = fixture(); f.input.inventory.invoices = [f.duplicate]; f.input.inventory.payments = []; f.source.paidCents = 0;
  f.duplicate.TxnDate = "2026-08-26";
  let row = f.plan().records[0]; assert.deepEqual(row.updateFields, ["TxnDate"]); assert.equal(row.canonicalId, "353");
  f.duplicate.TxnDate = f.source.date; f.duplicate.CustomerRef.value = "other";
  row = f.plan().records[0]; assert.deepEqual(row.updateFields, ["CustomerRef"]); assert.equal(row.canonicalId, "353");
});
test("line replacements never reuse one QuickBooks line ID twice", () => {
  const f = fixture(); f.source.lines.push({ ...f.source.lines[0], id: "second", description: "Different work" });
  const payload = invoiceUpdatePayload(f.source, f.duplicate, "94", f.input.config, ["Line"]);
  const ids = payload.Line.map(line => line.Id).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size); assert.equal(payload.Line[1].Id, undefined);
});
test("financial/content replacement refuses unmanaged QuickBooks line attributes", () => {
  const f = fixture(); f.input.inventory.invoices = [f.duplicate]; f.input.inventory.payments = [];
  f.duplicate.Line[0].Description = "Old description"; f.duplicate.Line[0].SalesItemLineDetail.ClassRef = { value: "class" };
  assert.ok(f.plan().records[0].reviews.includes("UNMANAGED_LINE_ATTRIBUTES_REVIEW_REQUIRED"));
});
