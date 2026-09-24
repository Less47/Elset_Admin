// TEMPORARY: full-history reconciliation. Production writes are intentionally unavailable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AccountingService } from "../server-accounting-service.js";
import { AccountingError } from "../server-accounting-errors.js";
import { readAccountingInvoice } from "../server-accounting-workspace.js";
import { assertWorkspaceSchema, getWorkspaceDbPath, openWorkspaceDb } from "../server-workspace-db.js";
import { isInactiveInvoice } from "../src/lib/invoice-account.js";
import { buildDocumentReference } from "../src/lib/quote-template.js";
import { analyzeReconciliation, normalized, withoutSecrets, writeReconciliationReports } from "./quickbooks-reconciliation-core.mjs";

export class ReconciliationError extends Error {}
const code = error => /^[A-Z_]+$/.test(error?.code || "") ? error.code : "RECONCILIATION_ERROR";
export function parseReconciliationArgs(args) {
  if (args.length !== 1 || args[0] !== "--dry-run") throw new ReconciliationError("Required: --dry-run (entire available invoice history). Apply, updates, voids, deletes and email sending are unavailable in this review tool.");
  return { mode: "dry-run", scope: "all-history" };
}
export function readOnlyFetch(fetchImpl, { paceMs = 250 } = {}) {
  let queue = Promise.resolve(), previous = 0;
  const audit = { reads: 0, tokenRefreshes: 0, quickbooksMutations: 0, blockedRequests: 0 };
  const wrapped = (input, options = {}) => {
    const request = queue.then(async () => {
      const url = new URL(input), method = (options.method || "GET").toUpperCase();
      const read = url.origin === "https://quickbooks.api.intuit.com" && /^\/v3\/company\/\d+\//.test(url.pathname) && method === "GET"
        && !/\/(send|sendEmail|void|delete)(?:\/|$)/i.test(url.pathname) && !url.searchParams.has("operation");
      const refresh = url.href === "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer" && method === "POST" && new URLSearchParams(options.body).get("grant_type") === "refresh_token";
      if (!read && !refresh) { audit.blockedRequests++; throw new ReconciliationError("Blocked non-read request. This tool cannot mutate QuickBooks or send email."); }
      const wait = Math.max(0, paceMs - (Date.now() - previous));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      previous = Date.now(); audit[refresh ? "tokenRefreshes" : "reads"]++;
      return fetchImpl(input, options);
    });
    queue = request.catch(() => {}); return request;
  };
  wrapped.audit = audit; return wrapped;
}

// Reuse provider auth/errors without its settings list's 20-page limit.
export async function fetchAll(service, context, entity, condition = "") {
  if (!["Invoice", "Customer", "Item", "Payment", "CreditMemo", "Deposit"].includes(entity)) throw new ReconciliationError("Unsupported reconciliation entity.");
  const rows = [], seen = new Set();
  for (let page = 0; page < 10000; page++) {
    const query = `SELECT * FROM ${entity}${condition ? ` WHERE ${condition}` : ""} STARTPOSITION ${page * 1000 + 1} MAXRESULTS 1000`;
    const response = await service.provider.request(context, `query?${new URLSearchParams({ query })}`);
    if (!response?.QueryResponse || !Array.isArray(response.QueryResponse[entity] || [])) throw new ReconciliationError(`Incomplete ${entity} query response.`);
    const batch = response.QueryResponse[entity] || [];
    for (const row of batch) {
      if (typeof row.Id !== "string" || !/^\d+$/.test(row.Id) || seen.has(row.Id)) throw new ReconciliationError(`Unstable or invalid ${entity} pagination; no complete report can be claimed.`);
      seen.add(row.Id); rows.push(row);
    }
    if (batch.length < 1000) return rows;
  }
  throw new ReconciliationError("Full-history query exceeded its safety bound; results are incomplete.");
}
const meta = value => { try { const result = JSON.parse(value || "{}"); return result && typeof result === "object" ? result : { invalid: true }; } catch { return { invalid: true }; } };
const excluded = value => isInactiveInvoice(value) || value.invalid || value.archived === true || value.archivedAt || ["draft", "unfinished", "archived"].includes(normalized(value.status || value.invoiceStatus));
export function readLocalHistory(db) {
  return db.transaction(() => {
    const rows = db.prepare("SELECT i.*,j.job_number,j.customer_id,j.status job_status,j.extra_json job_extra,c.extra_json customer_extra,c.name customer_name FROM invoices i LEFT JOIN jobs j ON j.id=i.job_id LEFT JOIN customers c ON c.id=j.customer_id WHERE i.type='invoice' ORDER BY i.issue_date,i.id").all();
    return rows.map(raw => {
      let source;
      try { source = readAccountingInvoice(db, raw.job_id); }
      catch { source = { id: raw.id, jobId: raw.job_id, customerId: raw.customer_id, number: buildDocumentReference({ id: raw.job_id, jobNumber: raw.job_number }, "invoice"), date: raw.issue_date, currency: "AUD", lines: [], subtotalCents: null, taxCents: null, totalCents: null, eligible: false, reason: "Cannot safely project this invoice.", customer: { name: raw.customer_name || "" } }; }
      if ([raw.extra_json, raw.job_extra, raw.customer_extra].some(value => excluded(meta(value))) || ["deleted", "archived", "cancelled", "canceled"].includes(normalized(raw.job_status))) {
        source.eligible = false; source.reason = "Invoice, job or customer is inactive, archived, draft or unfinished.";
      }
      if (!Number.isSafeInteger(source.totalCents) || source.totalCents <= 0) { source.eligible = false; source.reason ||= "Non-positive or invalid invoice total."; }
      return { ...source, paidCents: db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM payments WHERE invoice_id=?").get(raw.id).amount };
    });
  })();
}

export async function runReconciliation(db, { env = process.env, fetchImpl = fetch, paceMs = 250, archive, output = console.log } = {}) {
  if (env.QUICKBOOKS_ENVIRONMENT !== "production") throw new ReconciliationError("Production QuickBooks configuration is required.");
  if (typeof archive !== "function") throw new ReconciliationError("A pre-change archive writer is required, including for dry-run.");
  const transport = readOnlyFetch(fetchImpl, { paceMs });
  const service = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: transport });
  if (service.store.integration()?.provider_environment !== "production") throw new ReconciliationError("The saved connection is not production.");
  const report = { mode: "dry-run", scope: "all-history", startedAt: new Date().toISOString(), complete: false, configurationReady: false,
    warnings: ["Proposals only. Historical invoice changes can affect GST/BAS periods. Payments, credits and deposits require separate review. This tool has no apply mode."], apiAudit: transport.audit };
  try {
    await service.work(async () => {
      const context = await service.credentials(), settings = await service.options(context);
      if (!["AU", "Australia"].includes(settings.organisation.country) || settings.organisation.currency !== "AUD") throw new AccountingError("COMPANY_MISMATCH", "An AU/AUD company is required.", 409);
      report.company = { id: context.tenantId, name: settings.organisation.name, country: settings.organisation.country, currency: settings.organisation.currency };
      try { service.validateConfig(JSON.parse(service.store.integration().config_json), settings); report.configurationReady = true; }
      catch (error) { report.warnings.push(`Configuration requires review (${code(error)}); creation/update proposals are blocked.`); }
      const data = {};
      for (const [key, entity] of [["invoices", "Invoice"], ["customers", "Customer"], ["items", "Item"], ["payments", "Payment"], ["credits", "CreditMemo"], ["deposits", "Deposit"]]) {
        output(`Reading all QuickBooks ${entity} records...`);
        data[key] = await fetchAll(service, context, entity, ["Customer", "Item"].includes(entity) ? "Active IN (true,false)" : "");
        output(`${entity}: ${data[key].length}`);
      }
      const snapshot = { schema: "elset-quickbooks-reconciliation-snapshot-v1", capturedAt: new Date().toISOString(), company: report.company, ...withoutSecrets(data) };
      report.archivePath = await archive(snapshot);
      if (!report.archivePath) throw new ReconciliationError("Snapshot archive was not confirmed. No action plan was produced.");
      const localInvoices = readLocalHistory(db), localCustomers = db.prepare("SELECT id,name,email FROM customers").all();
      const mappings = db.prepare("SELECT provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id FROM integration_entity_mappings WHERE workspace_id=?").all(service.store.workspaceId);
      report.deletedInvoiceArchiveCount = db.prepare("SELECT count(*) n FROM deleted_invoices").get().n;
      Object.assign(report, analyzeReconciliation({ localInvoices, localCustomers, ...data, mappings, workspaceId: service.store.workspaceId, tenantId: context.tenantId,
        configurationReady: report.configurationReady, canUpdate: row => { try { service.provider.assertUpdateSafe(row); return true; } catch { return false; } } }));
      report.inventory = { customers: data.customers.length, items: data.items.length, payments: data.payments.length, credits: data.credits.length, deposits: data.deposits.length };
      report.complete = true;
    });
  } catch (error) {
    report.stopped = code(error); report.warnings.push(`Read-only reconciliation stopped (${code(error)}). The result is incomplete; no QuickBooks changes were attempted.`);
  }
  report.finishedAt = new Date().toISOString(); return report;
}

export async function reconciliationCli(args = process.argv.slice(2), { env = process.env, output = console.log } = {}) {
  parseReconciliationArgs(args);
  const dbPath = getWorkspaceDbPath(env);
  if (process.platform !== "linux" || env.FLY_APP_NAME !== "elset-admin" || !env.FLY_MACHINE_ID || dbPath !== "/app/data/elset-workspace.db" || fs.realpathSync(dbPath) !== dbPath) throw new ReconciliationError("Run inside the existing elset-admin Fly machine against /app/data/elset-workspace.db. Local production database copies are not permitted.");
  const check = openWorkspaceDb({ dbPath, readonly: true, fileMustExist: true, migrate: false });
  try { assertWorkspaceSchema(check); } finally { check.close(); }
  const db = openWorkspaceDb({ dbPath, fileMustExist: true, migrate: false });
  const directory = fileURLToPath(new URL("../output/", import.meta.url)), timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    output("DRY RUN ONLY: entire available invoice history. No create, update, void, delete, Payment or email-send operations.");
    const report = await runReconciliation(db, { env, output, archive: snapshot => {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const filename = path.join(directory, `quickbooks-reconciliation-prechange-${timestamp}.json`);
      fs.writeFileSync(filename, JSON.stringify(snapshot, null, 2), { flag: "wx", mode: 0o400 }); return filename;
    } });
    const paths = writeReconciliationReports(report, directory, timestamp);
    output(JSON.stringify({ complete: report.complete, configurationReady: report.configurationReady, summary: report.summary, apiAudit: report.apiAudit, warnings: report.warnings, reports: paths, archive: report.archivePath }, null, 2));
    return report.complete ? 0 : 1;
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await reconciliationCli(); }
  catch (error) { console.error(error instanceof ReconciliationError ? error.message : `Reconciliation stopped (${code(error)}). Credentials and raw errors are suppressed.`); process.exitCode = 1; }
}
