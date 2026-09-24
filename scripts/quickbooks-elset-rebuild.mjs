// TEMPORARY operator tool. Never imported by application routes or workers.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { AccountingService } from "../server-accounting-service.js";
import { assertWorkspaceSchema, openWorkspaceDb } from "../server-workspace-db.js";
import { getWorkspaceAddons } from "../server-workspace-addons.js";
import { fetchAll } from "./quickbooks-one-time-backfill.mjs";
import { createResetAdapter, verifyFlySnapshot } from "./quickbooks-authoritative-reset.mjs";
import { hash, fail, invoiceBeforeDelete, paymentBeforeDelete, links, buildRebuildPlan, makeInvoicePayload, makePaymentPayload, checkInvoice, checkPayment, checkRetainedRow, assertResumeInventory, executeRebuild } from "./quickbooks-elset-rebuild-core.mjs";

const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const code = error => /^[A-Z_]+$/.test(error?.code || "") ? error.code : "REBUILD_STOPPED";
const directory = "/app/data/quickbooks-elset-rebuild";
const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-");
export function rebuildTransport(fetchImpl, { apply, tenantId, paceMs = 250, onFault = () => {} }) {
  let pending, queue = Promise.resolve(), previous = 0;
  const audit = { reads: 0, tokenRefreshes: 0, invoiceWrites: 0, paymentWrites: 0, customerWrites: 0, itemWrites: 0, sendCalls: 0, blocked: 0 };
  const wrapped = (input, options = {}) => {
    const run = queue.then(async () => {
      const url = new URL(input), method = String(options.method || "GET").toUpperCase();
      const oauth = url.href === "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer" && method === "POST" && new URLSearchParams(options.body).get("grant_type") === "refresh_token";
      const prefix = `/v3/company/${tenantId}/`, endpoint = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
      const company = url.origin === "https://quickbooks.api.intuit.com" && endpoint;
      const operation = url.searchParams.get("operation") || "write";
      const read = company && method === "GET" && !url.searchParams.has("operation") && /^(query|preferences|companyinfo\/\d+|invoice\/\d+|payment\/\d+|customer\/\d+|item\/\d+)$/.test(endpoint);
      const write = company && apply && method === "POST" && pending?.endpoint === endpoint && pending?.operation === operation && pending?.bodyHash === sha(options.body || "");
      if (!oauth && !read && !write) { audit.blocked++; fail("BLOCKED_REBUILD_REQUEST"); }
      if (write) pending = null;
      const wait = Math.max(0, paceMs - (Date.now() - previous));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      previous = Date.now(); audit[oauth ? "tokenRefreshes" : read ? "reads" : `${endpoint}Writes`]++;
      const response = await fetchImpl(input, options);
      if (write && typeof response.clone === "function") {
        const body = await response.clone().json().catch(() => null);
        if (body?.Fault?.Error) onFault({ endpoint, action: operation, status: response.status,
          errors: body.Fault.Error.map(error => ({ code: String(error.code || "").slice(0, 30), element: String(error.element || "").slice(0, 100),
            message: String(error.Message || "").slice(0, 300), detail: String(error.Detail || "").slice(0, 800) })) });
      }
      return response;
    });
    queue = run.catch(() => {}); return run;
  };
  wrapped.permit = (endpoint, payload, operation = "write") => {
    if (!apply || pending || !["invoice", "payment", "customer", "item"].includes(endpoint)
      || !["write", "delete"].includes(operation) || operation === "delete" && !["invoice", "payment"].includes(endpoint)) fail("BLOCKED_REBUILD_REQUEST");
    if (operation === "delete" && (Object.keys(payload).sort().join() !== "Id,SyncToken" || !/^\d+$/.test(payload.Id) || !/^\d+$/.test(payload.SyncToken))) fail("BLOCKED_REBUILD_DELETE");
    if (operation === "write" && (payload.Id || endpoint === "invoice" && payload.EmailStatus !== "NotSet"
      || endpoint === "payment" && (payload.ProcessPayment !== false || payload.CreditCardPayment || payload.CreditChargeInfo))) fail("BLOCKED_REBUILD_WRITE");
    pending = { endpoint, operation, bodyHash: sha(JSON.stringify(payload)) };
  };
  wrapped.clear = () => { pending = null; };
  wrapped.audit = audit; return wrapped;
}

const sourceTables = ["invoices", "invoice_line_items", "payments", "customers", "jobs", "document_send_history", "price_list_items"];
function sourceHash(db) {
  return db.transaction(() => hash(sourceTables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])))();
}
function durableJson(filename, value, replace = false) {
  const bytes = JSON.stringify(value, null, 2), target = replace ? `${filename}.${crypto.randomUUID()}.tmp` : filename;
  const fd = fs.openSync(target, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (replace) fs.renameSync(target, filename);
  if (sha(fs.readFileSync(filename)) !== sha(bytes)) fail("ARCHIVE_VERIFICATION_FAILED");
  return { path: filename, sha256: sha(bytes) };
}
function argumentsFor(args) {
  const options = {};
  for (const arg of args) {
    const matched = arg.match(/^--(prepare|apply)$/) || arg.match(/^--(from|to|payment-account|preserve-external-accounts|reuse-customer-ids|retain-invoice-ids|resume-enabled-from|plan|sha256|volume-id|snapshot-id)=(.+)$/);
    if (!matched || options[matched[1]] !== undefined) fail("INVALID_ARGUMENTS");
    options[matched[1]] = matched[2] ?? true;
  }
  if (Boolean(options.prepare) === Boolean(options.apply)) fail("CHOOSE_PREPARE_OR_APPLY");
  if (options.prepare && (!options.from || !options.to || !options["payment-account"] || !["true", "false"].includes(options["preserve-external-accounts"]))) fail("REBUILD_SCOPE_REQUIRED");
  if (options.apply && ["plan", "sha256", "volume-id", "snapshot-id"].some(key => !options[key])) fail("APPROVED_PLAN_AND_SNAPSHOT_REQUIRED");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  if (options.prepare && options.to > today) fail("FUTURE_CUTOFF");
  return options;
}

async function readInventory(service, context) {
  const inventory = {};
  for (const [key, entity] of [["invoices", "Invoice"], ["payments", "Payment"], ["customers", "Customer"], ["items", "Item"], ["credits", "CreditMemo"], ["deposits", "Deposit"]]) {
    inventory[key] = await fetchAll(service, context, entity, ["Customer", "Item"].includes(entity) ? "Active IN (true,false)" : "");
  }
  return inventory;
}

export async function rebuildCli(args = process.argv.slice(2), { env = process.env, output = console.log, fetchImpl = fetch } = {}) {
  const options = argumentsFor(args), dbPath = "/app/data/elset-workspace.db";
  if (process.platform !== "linux" || env.FLY_APP_NAME !== "elset-admin" || !env.FLY_MACHINE_ID || env.ELSET_DATA_DIR !== "/app/data"
    || env.QUICKBOOKS_ENVIRONMENT !== "production" || fs.realpathSync(dbPath) !== dbPath) fail("FLY_PRODUCTION_ONLY");
  const check = openWorkspaceDb({ dbPath, readonly: true, fileMustExist: true, migrate: false });
  let connection;
  try { assertWorkspaceSchema(check); connection = check.prepare("SELECT external_tenant_id,provider_environment,status FROM workspace_integrations WHERE provider='quickbooks'").get(); }
  finally { check.close(); }
  if (connection?.provider_environment !== "production" || connection.status !== "CONNECTED" || !/^\d+$/.test(connection.external_tenant_id)) fail("PRODUCTION_CONNECTION_REQUIRED");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let approved, snapshot, ledger, ledgerPath;
  if (options.apply) {
    const planPath = fs.realpathSync(options.plan);
    if (path.dirname(planPath) !== directory || sha(fs.readFileSync(planPath)) !== options.sha256) fail("APPROVED_PLAN_HASH_MISMATCH");
    approved = JSON.parse(fs.readFileSync(planPath, "utf8"));
    if (!approved.ready || approved.plan.companyId !== connection.external_tenant_id) fail("APPROVED_COMPANY_MISMATCH");
    snapshot = await verifyFlySnapshot({ app: env.FLY_APP_NAME, machineId: env.FLY_MACHINE_ID, volumeId: options["volume-id"], snapshotId: options["snapshot-id"], token: env.ELSET_RESET_FLY_API_TOKEN, approvedAt: approved.preparedAt, fetchImpl });
    ledgerPath = path.join(directory, `quickbooks-elset-rebuild-ledger-${approved.plan.planHash}.json`);
    ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : { planHash: approved.plan.planHash, steps: {}, complete: false };
    if (ledger.supersededBy) fail("SUPERSEDED_PLAN");
    if (options["resume-enabled-from"]) {
      if (!/^[a-f0-9]{64}$/.test(options["resume-enabled-from"])) fail("INVALID_PREVIOUS_LEDGER");
      const previous = JSON.parse(fs.readFileSync(path.join(directory, `quickbooks-elset-rebuild-ledger-${options["resume-enabled-from"]}.json`)));
      if (!previous.paused || typeof previous.wasEnabled !== "boolean" || previous.supersededBy !== approved.plan.planHash) fail("INVALID_PREVIOUS_LEDGER");
      ledger.wasEnabled ??= previous.wasEnabled;
    }
  }
  const db = openWorkspaceDb({ dbPath, fileMustExist: true, migrate: false });
  const transport = rebuildTransport(fetchImpl, { apply: Boolean(options.apply), tenantId: connection.external_tenant_id, onFault: fault => event({ operation: "provider-fault", ...fault }) });
  const service = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: transport });
  const stamp = nowStamp();
  const eventPath = path.join(directory, `quickbooks-elset-rebuild-journal-${stamp}.jsonl`);
  const eventFd = fs.openSync(eventPath, "wx", 0o600);
  const event = entry => { fs.writeSync(eventFd, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); fs.fsyncSync(eventFd); };
  const save = async () => { durableJson(ledgerPath, ledger, fs.existsSync(ledgerPath)); };
  let result, operationError;
  try {
    await service.work(async () => {
      try {
      const initialSourceHash = sourceHash(db);
      const base = createResetAdapter(service, transport, options.apply ? "reset-apply" : "reset-dry-run", event);
      const input = await base.load(), context = await service.credentials();
      Object.assign(input, { sourceHash: initialSourceHash, localPayments: db.prepare("SELECT * FROM payments ORDER BY invoice_id,id").all(),
        externalPayments: db.prepare("SELECT * FROM integration_external_payments ORDER BY local_payment_id").all(),
        paymentAccounts: await service.provider.query(context, "Account", "Active = true") });
      if (initialSourceHash !== sourceHash(db)) fail("LOCAL_SOURCE_CHANGED");
      if (options.prepare) {
        const plan = buildRebuildPlan(input, { from: options.from, to: options.to, paymentAccountId: options["payment-account"], preserveExternalAccounts: options["preserve-external-accounts"] === "true", reuseNamedCustomerIds: options["reuse-customer-ids"]?.split(",") || [], retainInvoiceIds: options["retain-invoice-ids"]?.split(",") || [] });
        const archive = durableJson(path.join(directory, `quickbooks-elset-rebuild-source-${stamp}.json`), { capturedAt: new Date().toISOString(), input });
        const report = { ready: true, preparedAt: new Date().toISOString(), plan, sourceArchive: archive, codeSha256: sha(fs.readFileSync(new URL(import.meta.url))) };
        const file = durableJson(path.join(directory, `quickbooks-elset-rebuild-plan-${stamp}.json`), report);
        result = { prepared: true, company: input.organisation.name, range: plan.range, summary: plan.summary, plan: file, audit: transport.audit, journal: eventPath };
        return;
      }
      const plan = approved.plan;
      if (plan.sourceHash !== initialSourceHash || hash(plan.configuration) !== hash(input.config)) fail("APPROVED_ELSET_OR_CONFIG_CHANGED");
      assertResumeInventory(plan, input.inventory, ledger);
      const cache = input.inventory;
      const read = async (endpoint, externalId) => {
        const name = endpoint[0].toUpperCase() + endpoint.slice(1);
        try { const raw = (await service.provider.request(context, `${endpoint}/${externalId}`))?.[name]; return raw?.status === "Deleted" ? null : raw; }
        catch (error) { if (error.code === "EXTERNAL_NOT_FOUND") return null; throw error; }
      };
      const assertSource = () => {
        if (sourceHash(db) !== plan.sourceHash) fail("LOCAL_SOURCE_CHANGED");
        if (ledger.paused && !ledger.complete && getWorkspaceAddons(db).quickbooks) fail("QUICKBOOKS_PAUSE_CHANGED");
      };
      const write = async (endpoint, payload, operationId, operation = "write") => {
        assertSource();
        const key = service.store.prepareOperation(context.tenantId, "elset-rebuild", operationId, { endpoint, operation, payload });
        event({ operation: "write-started", endpoint, operationId, action: operation, payloadHash: hash(payload) });
        transport.permit(endpoint, payload, operation);
        try { return await service.provider.request(context, `${endpoint}${operation === "delete" ? "?operation=delete" : ""}`, "POST", payload, key); }
        finally { transport.clear(); }
      };
      const finish = operationId => service.store.finishOperation(context.tenantId, "elset-rebuild", operationId);
      const restoreEnablement = () => {
        const settings = db.prepare("SELECT value_json FROM settings WHERE key='addons'").get();
        const value = JSON.parse(settings?.value_json || "{}");
        value.quickbooks = ledger.wasEnabled;
        db.prepare("UPDATE settings SET value_json=?,updated_at=? WHERE key='addons'").run(JSON.stringify(value), new Date().toISOString());
        ledger.paused = false;
      };
      const adapter = {
        assertSource,
        async customer(customer) {
          let raw = customer.externalId ? await read("customer", customer.externalId) : cache.customers.find(row => row.Notes === customer.marker);
          if (!raw) {
            raw = (await write("customer", customer.payload, `customer:${customer.localId}`))?.Customer;
            if (!raw?.Id) fail("CUSTOMER_CREATE_UNCONFIRMED");
            raw = await read("customer", raw.Id);
            if (raw?.Notes !== customer.marker || raw.DisplayName !== customer.payload.DisplayName) fail("CUSTOMER_READBACK_MISMATCH");
            cache.customers.push(raw);
          }
          if (!raw || raw.Active !== true || raw.Job || raw.IsProject || raw.ParentRef?.value) fail("CUSTOMER_READBACK_MISMATCH");
          service.store.map(context.tenantId, "customer", customer.localId, raw.Id, raw.Notes || "");
          finish(`customer:${customer.localId}`); return raw.Id;
        },
        async invoicePayload(row, customerId) {
          // Reuse the already implemented per-line item resolver; keep historical snapshots.
          const oldPayload = await base.newInvoicePayload(row.source, customerId);
          const lineItemIds = Object.fromEntries(row.source.lines.map((line, i) => [line.id, oldPayload.Line[i].SalesItemLineDetail.ItemRef.value]));
          return makeInvoicePayload(row.source, customerId, { ...plan.configuration, lineItemIds }, row.marker);
        },
        async remove(endpoint, original) {
          const operationId = `delete-${endpoint}:${original.Id}`;
          const current = await read(endpoint, original.Id);
          if (!current) { finish(operationId); return original.Id; }
          const projection = endpoint === "invoice" ? invoiceBeforeDelete : paymentBeforeDelete;
          if (hash(projection(current)) !== hash(projection(original))) fail("DELETE_TARGET_CHANGED");
          if (endpoint === "invoice" && (links(current).length || Math.round(current.Balance * 100) !== Math.round(current.TotalAmt * 100))) fail("INVOICE_STILL_LINKED");
          const pending = service.store.operation(context.tenantId, "elset-rebuild", operationId);
          // A fresh read above proved this exact delete target still exists unchanged.
          if (pending?.status === "PENDING" && Date.now() - pending.started_at >= 5 * 60_000) service.store.finishOperation(context.tenantId, "elset-rebuild", operationId, "RECONCILED_UNCHANGED");
          const response = await write(endpoint, { Id: current.Id, SyncToken: String(current.SyncToken) }, operationId, "delete");
          const deleted = response?.[endpoint === "invoice" ? "Invoice" : "Payment"];
          if (deleted?.Id !== current.Id || deleted.status !== "Deleted" || await read(endpoint, current.Id)) fail("DELETE_READBACK_FAILED");
          cache[endpoint === "invoice" ? "invoices" : "payments"] = cache[endpoint === "invoice" ? "invoices" : "payments"].filter(row => row.Id !== current.Id);
          finish(operationId); event({ operation: "delete-verified", endpoint, externalId: current.Id }); return current.Id;
        },
        async createInvoice(row, payload) {
          const matches = cache.invoices.filter(raw => raw.PrivateNote === row.marker || raw.DocNumber === row.source.number);
          if (matches.length > 1 || matches.length && matches[0].PrivateNote !== row.marker) fail("REBUILD_INVOICE_COLLISION");
          let raw = matches[0], recovered = Boolean(raw);
          if (!raw) { raw = (await write("invoice", payload, `invoice:${row.source.id}`))?.Invoice; if (!raw?.Id) fail("INVOICE_CREATE_UNCONFIRMED"); }
          raw = await read("invoice", raw.Id);
          if (!raw) fail("INVOICE_READBACK_FAILED");
          // Recovery may encounter its already-created receipts; final verification checks exact allocation.
          checkInvoice(raw, payload, row.source, recovered ? row.source.totalCents - Math.round(raw.Balance * 100) : 0);
          if (!recovered) cache.invoices.push(raw);
          finish(`invoice:${row.source.id}`); return raw.Id;
        },
        async createPayment(receipt, payload) {
          const matches = cache.payments.filter(raw => raw.PrivateNote === receipt.marker);
          if (matches.length > 1) fail("REBUILD_PAYMENT_COLLISION");
          let raw = matches[0];
          if (!raw) { raw = (await write("payment", payload, `payment:${receipt.id}`))?.Payment; if (!raw?.Id) fail("PAYMENT_CREATE_UNCONFIRMED"); }
          raw = await read("payment", raw.Id); checkPayment(raw || {}, payload);
          if (!matches.length) cache.payments.push(raw);
          finish(`payment:${receipt.id}`); return raw.Id;
        },
        async mapInvoice(row, externalId, payload, receipts) {
          const raw = checkInvoice(await read("invoice", externalId), payload, row.source, row.source.paidCents);
          assertSource();
          db.transaction(() => {
            base.mapInvoice(row.source, raw, payload.CustomerRef.value, row.previousId);
            for (const { receipt, externalId: paymentId } of receipts.filter(item => item.receipt.source === "quickbooks")) {
              const changed = db.prepare(`UPDATE integration_external_payments SET external_payment_id=?,external_invoice_id=?,external_updated_at='',updated_at=?
                WHERE workspace_id=? AND provider='quickbooks' AND external_tenant_id=? AND invoice_id=? AND local_payment_id=? AND status='ACTIVE'`)
                .run(paymentId, externalId, new Date().toISOString(), plan.workspaceId, plan.companyId, row.source.id, receipt.id);
              if (changed.changes !== 1) fail("EXTERNAL_PAYMENT_MAPPING_CHANGED");
            }
            db.prepare(`UPDATE integration_invoice_payment_sync SET external_invoice_id=?,updated_at=? WHERE workspace_id=? AND provider='quickbooks' AND external_tenant_id=? AND invoice_id=?`)
              .run(externalId, new Date().toISOString(), plan.workspaceId, plan.companyId, row.source.id);
          })();
          event({ operation: "mapping-verified", localId: row.source.id, externalId }); return externalId;
        },
        async verify(currentPlan, currentLedger, payloads) {
          const final = await readInventory(service, context);
          assertSource(); assertResumeInventory(currentPlan, final, currentLedger);
          const expectedInvoiceIds = [], expectedPaymentIds = [];
          for (const row of currentPlan.rows) {
            const invoiceId = currentLedger.steps[`invoice:${row.source.id}`].value;
            const invoice = final.invoices.find(raw => raw.Id === invoiceId);
            checkInvoice(invoice || {}, payloads[row.source.id], row.source, row.source.paidCents);
            if (service.store.mapping(plan.companyId, "invoice", row.source.id)?.external_entity_id !== invoiceId) fail("FINAL_MAPPING_MISMATCH");
            expectedInvoiceIds.push(invoiceId);
            for (const receipt of row.receipts) {
              const paymentId = currentLedger.steps[`payment:${receipt.id}`].value;
              checkPayment(final.payments.find(raw => raw.Id === paymentId) || {}, makePaymentPayload(receipt, invoiceId, payloads[row.source.id].CustomerRef.value));
              expectedPaymentIds.push(paymentId);
            }
          }
          for (const row of currentPlan.retainedRows || []) {
            checkRetainedRow(row, final);
            if (service.store.mapping(plan.companyId, "invoice", row.source.id)?.external_entity_id !== row.retainedInvoiceId) fail("FINAL_RETAINED_MAPPING_MISMATCH");
            for (const mapping of row.retainedPayments) {
              const local = db.prepare("SELECT external_payment_id,external_invoice_id FROM integration_external_payments WHERE workspace_id=? AND provider='quickbooks' AND external_tenant_id=? AND invoice_id=? AND local_payment_id=? AND status='ACTIVE'")
                .get(plan.workspaceId, plan.companyId, row.source.id, mapping.receiptId);
              if (local?.external_payment_id !== mapping.externalId || local.external_invoice_id !== row.retainedInvoiceId) fail("FINAL_RETAINED_MAPPING_MISMATCH");
            }
          }
          if (final.invoices.length !== expectedInvoiceIds.length + plan.preserved.invoices.length || final.payments.length !== expectedPaymentIds.length + plan.preserved.payments.length
            || plan.deleteInvoices.some(row => final.invoices.some(raw => raw.Id === row.Id)) || plan.deletePayments.some(row => final.payments.some(raw => raw.Id === row.Id))) fail("UNEXPECTED_FINAL_RECORDS");
          const archive = durableJson(path.join(directory, `quickbooks-elset-rebuild-final-${stamp}.json`), { capturedAt: new Date().toISOString(), inventory: final, localSourceHash: sourceHash(db) });
          return { matched: true, invoices: expectedInvoiceIds.length + (plan.retainedRows?.length || 0), payments: expectedPaymentIds.length + (plan.retainedRows || []).reduce((n, row) => n + row.receipts.length, 0), ...plan.summary, localFinancialRowsUnchanged: true, archive };
        },
      };
      const archive = async () => {
        const saved = durableJson(path.join(directory, `quickbooks-elset-rebuild-preapply-${stamp}.json`), { input, snapshot });
        const backupPath = `/app/data/backups/quickbooks-elset-rebuild-${stamp}.db`;
        fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
        await db.backup(backupPath); fs.chmodSync(backupPath, 0o600);
        const backup = openWorkspaceDb({ dbPath: backupPath, readonly: true, fileMustExist: true, migrate: false });
        try { if (backup.pragma("integrity_check")[0].integrity_check !== "ok" || sourceHash(backup) !== plan.sourceHash) fail("BACKUP_VERIFICATION_FAILED"); }
        finally { backup.close(); }
        ledger.backup = { path: backupPath, sha256: sha(fs.readFileSync(backupPath)) };
        return saved;
      };
      if (!ledger.prechangeArchive) { ledger.prechangeArchive = await archive(); await save(); }
      if (!ledger.paused && !ledger.complete) {
        ledger.wasEnabled ??= getWorkspaceAddons(db).quickbooks;
        ledger.pauseRequested = true;
        await save();
        // Our integration lock prevents UI toggles. Persist the pause across a failed process.
        const value = JSON.parse(db.prepare("SELECT value_json FROM settings WHERE key='addons'").get()?.value_json || "{}");
        value.quickbooks = false;
        db.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES('addons',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
          .run(JSON.stringify(value), new Date().toISOString());
        ledger.paused = true; await save(); event({ operation: "incoming-sync-paused" });
      }
      const verification = await executeRebuild(plan, { adapter, ledger, save, archive });
      if (ledger.paused) { restoreEnablement(); await save(); event({ operation: "incoming-sync-restored" }); }
      service.store.update({ last_success_at: new Date().toISOString(), safe_error_message: "", retry_after: 0 });
      result = { complete: true, verification, audit: transport.audit, ledger: ledgerPath, journal: eventPath };
      } catch (error) { operationError = error; throw error; }
    }, { allowDisabled: true });
  } catch (error) {
    event({ stopped: code(operationError || error) });
    result = { complete: false, stopped: code(operationError || error), incomingSyncPaused: Boolean(ledger?.paused), audit: transport.audit, ledger: ledgerPath, journal: eventPath };
  } finally { db.close(); fs.closeSync(eventFd); }
  output(JSON.stringify(result, null, 2)); return result.prepared || result.complete ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await rebuildCli(); }
  catch (error) { console.error(code(error)); process.exitCode = 1; }
}
