import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { openWorkspaceDb, migrateWorkspaceSchema } from "../server-workspace-db.js";
import { importWorkspaceJsonData, summarizeWorkspaceDb } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { replaceInvoiceForJob, replaceQuoteForJob, addDocumentSentHistory } from "../server-workspace-documents.js";
import { createPriceListItem, updatePriceListItem, listPriceListItems, getPriceListItem } from "../server-workspace-price-list.js";
import { createPriceListRouter } from "../server-price-list-routes.js";
import { createBlankDocumentLine, priceListItemToLine, filterPriceList } from "../src/lib/price-list.js";
import { calculateQuoteGst, calculateQuoteTotal, calculateInvoiceTotal, defaultQuoteTemplate } from "../src/lib/quote-template.js";
import { buildDocumentPdfPayload } from "../src/lib/document-pdf-payload.js";
import { generateDocumentPdf } from "../quote-pdf.js";
import { readPdfTextRuns } from "./helpers/pdf-text.js";
import { readAccountingInvoice } from "../server-accounting-workspace.js";
import { AccountingService } from "../server-accounting-service.js";
import { updateWorkspaceAddons } from "../server-workspace-addons.js";
import { createXeroMock } from "./helpers/xero-mock.js";
import { createQuickBooksMock } from "./helpers/quickbooks-mock.js";
import { backupSqliteDatabase, validateWorkspaceBackupDatabaseFile } from "../server-workspace-backup.js";

const itemInput = { name: "Labour", description: "Gate maintenance labour", code: "LAB-01", unit: "hour", unitPrice: 145, taxTreatment: "taxable", category: "Services" };
const fixture = () => JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
function database(t, dbPath = ":memory:") {
  const db = openWorkspaceDb({ dbPath }); t.after(() => { if (db.open) db.close(); });
  importWorkspaceJsonData(db, fixture()); return db;
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-price-list-"));
  t.after(() => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("elset-price-list-"));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return directory;
}
const jobId = "demo-job-1001";
const document = (line) => ({ issueDate: "2026-09-21", dueDate: "2026-10-21", items: [line], payments: [], sentHistory: [{ id: "sent-price", sentAt: "2026-09-21", documentSnapshot: { items: [line] } }] });

test("blank document lines have no generated description or price and remain independent", () => {
  const a = createBlankDocumentLine(), b = createBlankDocumentLine();
  assert.equal(a.description, ""); assert.equal(a.qty, 1); assert.equal(a.rate, 0); assert.notEqual(a.id, b.id);
  a.description = "Ad-hoc work"; assert.equal(b.description, "");
  assert.equal(calculateQuoteTotal([b]), 0);
});

test("catalog create, edit, search, archive and restore preserve IDs/timestamps and existing documents", (t) => {
  const db = database(t);
  const before = loadWorkspaceStateFromDb(db), totals = summarizeWorkspaceDb(db).financials;
  const item = createPriceListItem(db, itemInput);
  assert.ok(item.id); assert.equal(item.unitPrice, 145); assert.equal(item.archived, false);
  for (const search of ["labour", "lab-01", "maintenance"]) assert.equal(listPriceListItems(db, { search }).length, 1);
  const edit = updatePriceListItem(db, item.id, { name: "Labour revised", unitPrice: "155.00", updatedAt: item.updatedAt });
  assert.equal(edit.id, item.id); assert.equal(edit.createdAt, item.createdAt); assert.ok(edit.updatedAt > item.updatedAt);
  assert.throws(() => updatePriceListItem(db, item.id, { unitPrice: 10, updatedAt: item.updatedAt }), { statusCode: 409 });
  const archived = updatePriceListItem(db, item.id, { archived: true, updatedAt: edit.updatedAt });
  assert.equal(listPriceListItems(db).length, 0); assert.equal(listPriceListItems(db, { status: "archived" }).length, 1);
  assert.equal(filterPriceList([archived]).length, 0); assert.throws(() => priceListItemToLine(archived), /archived/);
  updatePriceListItem(db, item.id, { archived: false, updatedAt: archived.updatedAt });
  assert.equal(listPriceListItems(db).length, 1);
  assert.deepEqual(loadWorkspaceStateFromDb(db), before); assert.deepEqual(summarizeWorkspaceDb(db).financials, totals);
});

test("quote and invoice snapshots keep old values, editable overrides and history after catalog changes", (t) => {
  const db = database(t), item = createPriceListItem(db, itemInput);
  const quoteLine = priceListItemToLine(item), invoiceLine = priceListItemToLine(item);
  assert.notEqual(quoteLine.id, invoiceLine.id);
  replaceQuoteForJob(db, jobId, document(quoteLine)); replaceInvoiceForJob(db, jobId, document(invoiceLine));
  for (const kind of ["quote", "invoice"]) addDocumentSentHistory(db, jobId, kind, { id: "price-snapshot", sentAt: "2026-09-21", toEmail: "fixture@example.test", documentSnapshot: document(kind === "quote" ? quoteLine : invoiceLine) });
  const before = loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === jobId);
  const updated = updatePriceListItem(db, item.id, { name: "New labour name", unitPrice: 155, updatedAt: item.updatedAt });
  assert.equal(priceListItemToLine(updated).rate, 155);
  updatePriceListItem(db, item.id, { archived: true, updatedAt: updated.updatedAt });
  const after = loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === jobId);
  assert.deepEqual(after, before);
  for (const kind of ["quote", "invoice"]) {
    assert.equal(after[kind].items[0].rate, 145); assert.equal(after[kind].items[0].priceListItemId, item.id);
    assert.equal(after[kind].items[0].unit, "hour"); assert.equal(after[kind].items[0].taxTreatment, "taxable");
    assert.equal(calculateQuoteGst(after[kind].items), 14.5); assert.equal(calculateInvoiceTotal(after[kind].items), 159.5);
    assert.equal(after[kind].sentHistory.find((entry) => entry.id === "price-snapshot").documentSnapshot.items[0].rate, 145);
  }
  const edited = { ...after.quote, items: [{ ...after.quote.items[0], description: "Agreed work", qty: 2, rate: 140 }] };
  replaceQuoteForJob(db, jobId, edited);
  assert.equal(calculateQuoteTotal(loadWorkspaceStateFromDb(db).jobs.find((job) => job.id === jobId).quote.items), 308);
  assert.equal(getPriceListItem(db, item.id).unitPrice, 155);
  const accounting = readAccountingInvoice(db, jobId);
  assert.equal(accounting.totalCents, 15950); assert.equal(accounting.lines[0].unitAmountCents, 14500);
});

test("catalog rejects invalid prices, unsupported GST and units without changing stored items", (t) => {
  const db = database(t);
  for (const patch of [{ name: " " }, { name: "x".repeat(201) }, { unitPrice: "" }, { unitPrice: -1 }, { unitPrice: "1.234" }, { unitPrice: Infinity }, { unitPrice: "1e3" }, { unitPrice: 1e12 }, { taxTreatment: "gst-free" }, { unit: "unknown" }, { archived: "false" }]) {
    assert.throws(() => createPriceListItem(db, { ...itemInput, ...patch }), { statusCode: 400 });
  }
  assert.equal(listPriceListItems(db).length, 0);
  const item = createPriceListItem(db, { ...itemInput, description: "", unitPrice: 0 });
  assert.equal(priceListItemToLine(item).description, item.name);
  assert.throws(() => getPriceListItem(db, "missing"), { statusCode: 404 });
});

test("schema 12 to 13 is additive, rolls back on failure and runs once", (t) => {
  const db = database(t);
  const totals = summarizeWorkspaceDb(db).financials;
  db.exec("DROP TABLE price_list_items; DELETE FROM workspace_schema_migrations WHERE version=13; UPDATE workspace_info SET schema_version=12; PRAGMA user_version=12;");
  const before = loadWorkspaceStateFromDb(db);
  db.exec("CREATE TRIGGER fail_price_list BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version=13 BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(() => migrateWorkspaceSchema(db), /12 -> 13 failed/);
  assert.equal(db.pragma("user_version", { simple: true }), 12);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='price_list_items'").get(), undefined);
  db.exec("DROP TRIGGER fail_price_list");
  const versions = []; migrateWorkspaceSchema(db, { onMigration: ({ toVersion }) => versions.push(toVersion) });
  assert.deepEqual(versions, [13]); assert.deepEqual(loadWorkspaceStateFromDb(db), before);
  assert.deepEqual(summarizeWorkspaceDb(db).financials, totals); assert.deepEqual(listPriceListItems(db), []);
  migrateWorkspaceSchema(db, { onMigration() { assert.fail("Already applied"); } });
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok"); assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("JSON migration and SQLite backups retain the shared catalog and archived records", async (t) => {
  const directory = temporary(t), dbPath = path.join(directory, "workspace.db"), backupPath = path.join(directory, "backup.db");
  const source = fixture();
  source.priceListItems = [{ ...itemInput, id: "retained-item", archived: true, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z" }];
  const db = openWorkspaceDb({ dbPath });
  try {
    const imported = importWorkspaceJsonData(db, source);
    assert.equal(imported.dbSummary.counts.priceListItems, 1);
    assert.deepEqual(getPriceListItem(db, "retained-item"), source.priceListItems[0]);
  } finally { db.close(); }
  await backupSqliteDatabase(dbPath, backupPath);
  assert.equal(validateWorkspaceBackupDatabaseFile(backupPath).summary.counts.priceListItems, 1);
  const copy = openWorkspaceDb({ dbPath: backupPath });
  try { assert.deepEqual(getPriceListItem(copy, "retained-item"), source.priceListItems[0]); } finally { copy.close(); }
});

test("authenticated catalog API isolates workspaces, enforces roles and never offers hard deletion", async (t) => {
  let db, server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (db?.open) db.close();
  });
  const directory = temporary(t), dbPath = path.join(directory, "workspace.db");
  db = database(t, dbPath);
  const env = { ELSET_WORKSPACE_STORAGE: "sqlite", ELSET_WORKSPACE_DB_PATH: dbPath };
  const app = express(); app.use(express.json());
  app.use(createPriceListRouter({ env,
    requireAuth: (req, res, next) => { if (!req.headers["x-role"]) return res.sendStatus(401); req.user = { role: req.headers["x-role"] }; next(); },
    requireRole: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
  }));
  server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/price-list-items`;
  assert.equal((await fetch(url)).status, 401);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.equal((await fetch(url + (method === "PATCH" || method === "DELETE" ? "/missing" : ""), { method, headers: { "X-Role": "technician" } })).status, 403);
  const headers = { "X-Role": "office", "Content-Type": "application/json" };
  const created = await (await fetch(url, { method: "POST", headers, body: JSON.stringify(itemInput) })).json();
  assert.equal(created.item.unitPrice, 145);
  const archived = await fetch(`${url}/${created.item.id}`, { method: "PATCH", headers, body: JSON.stringify({ archived: true, updatedAt: created.item.updatedAt }) });
  assert.equal(archived.status, 200);
  assert.deepEqual((await (await fetch(url, { headers })).json()).items, []);
  assert.equal((await (await fetch(url + "?status=archived&search=LAB-01", { headers })).json()).items.length, 1);
  assert.equal((await fetch(url + "?status=invalid", { headers })).status, 400);
  assert.equal((await fetch(`${url}/${created.item.id}`, { method: "DELETE", headers })).status, 404);
  assert.equal(listPriceListItems(db, { status: "all" }).length, 1);
  const other = database(t); assert.deepEqual(listPriceListItems(other), []);
});

test("legacy JSON catalog API retains unrelated state while editing and archiving", async (t) => {
  let data = { jobs: [{ id: "historic", invoice: { items: [{ description: "Unchanged", qty: 2, rate: 30 }] } }], settings: { keep: true } };
  const before = structuredClone(data);
  const app = express(); app.use(express.json());
  app.use(createPriceListRouter({ env: { ELSET_WORKSPACE_STORAGE: "json" }, requireAuth: (_req, _res, next) => next(), requireRole: () => (_req, _res, next) => next(), jsonStore: { loadData: () => structuredClone(data), saveData: (next) => { data = next; } } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/price-list-items`, headers = { "Content-Type": "application/json" };
  const { item } = await (await fetch(url, { method: "POST", headers, body: JSON.stringify(itemInput) })).json();
  const response = await fetch(`${url}/${item.id}`, { method: "PATCH", headers, body: JSON.stringify({ updatedAt: item.updatedAt, unitPrice: 155, archived: true }) });
  assert.equal(response.status, 200); assert.deepEqual(data.jobs, before.jobs); assert.deepEqual(data.settings, before.settings);
  assert.equal(data.priceListItems[0].unitPrice, 155); assert.deepEqual((await (await fetch(url)).json()).items, []);
});

for (const provider of ["xero", "quickbooks"]) test(`${provider} sync uses stored invoice snapshots after price-list edit/archive and creates no provider items`, async (t) => {
  const db = database(t), item = createPriceListItem(db, itemInput), line = priceListItemToLine(item);
  replaceInvoiceForJob(db, jobId, document(line));
  updatePriceListItem(db, item.id, { updatedAt: item.updatedAt, unitPrice: 155, description: "New description", archived: true });
  updateWorkspaceAddons(db, { [provider]: true });
  const mock = provider === "xero" ? createXeroMock() : createQuickBooksMock();
  const env = { XERO_CLIENT_ID: "fixture", XERO_CLIENT_SECRET: "fixture", XERO_REDIRECT_URI: "http://localhost:3101/api/integrations/xero/callback",
    QUICKBOOKS_CLIENT_ID: "fixture", QUICKBOOKS_CLIENT_SECRET: "fixture", QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_REDIRECT_URI: "http://localhost:3101/api/integrations/quickbooks/callback", ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  const service = new AccountingService(db, { providerId: provider, env, fetchImpl: mock.fetch, authorizeOAuthInitiator: async () => true });
  const state = new URL((await service.connect("admin", "session")).url).searchParams.get("state");
  await service.callback({ state, code: "fixture", ...(provider === "quickbooks" ? { realmId: "123456789" } : {}) }, "admin", "session");
  await service.configure(provider === "xero" ? { salesAccountId: "sales-id", taxMappings: { taxable: "OUTPUT" } } : { itemId: "20", taxMappings: { taxable: "30" } });
  await service.syncInvoice(jobId);
  const invoice = mock.invoices[0];
  assert.equal(provider === "xero" ? invoice.Total : invoice.TotalAmt, 159.5);
  const sentLine = provider === "xero" ? invoice.LineItems[0] : invoice.Line.find((entry) => entry.DetailType === "SalesItemLineDetail");
  assert.equal(sentLine.Description, line.description);
  assert.equal(provider === "xero" ? sentLine.UnitAmount : sentLine.SalesItemLineDetail.UnitPrice, 145);
  assert.equal(mock.calls.some((call) => /\/(items|item)(?:\?|$)/i.test(call.url) && ["POST", "PUT"].includes(call.method)), false);
});

for (const type of ["quote", "invoice"]) test(`${type} PDF uses editable snapshot description and prices without a catalog lookup`, async () => {
  const source = { ...itemInput, id: "source", archived: false };
  const line = priceListItemToLine(source);
  Object.assign(source, { unitPrice: 999, archived: true });
  const job = { id: "pdf", jobNumber: 55, title: "Service", customerName: "Fixture customer", jobAddress: "Test address" };
  const payload = buildDocumentPdfPayload({ job, document: document(line), template: defaultQuoteTemplate, documentType: type });
  assert.equal(payload.document.items[0].rate, 145); assert.equal(source.unitPrice, 999);
  const pdf = await generateDocumentPdf(payload);
  const text = (await readPdfTextRuns(pdf.bytes)).flat().map((run) => run.text).join(" ");
  assert.match(text, /Gate maintenance labour/); assert.match(text, /159\.50/); assert.match(text, /14\.50/);
});
