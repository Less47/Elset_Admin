import crypto from "node:crypto";
import Database from "better-sqlite3";
import { AccountingService } from "./server-accounting-service.js";
import { safeAccountingError } from "./server-accounting-errors.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";
import { pendingQuickBooksCompany } from "./server-quickbooks-oauth.js";

const retryable = new Set(["RATE_LIMITED", "PROVIDER_UNAVAILABLE", "EXTERNAL_CHANGING", "INTEGRATION_BUSY", "INTEGRATION_ERROR"]);

function inboxDiagnostic(error) {
  // Never serialize the exception, its cause, request, or raw message: provider
  // errors and JSON parse failures can contain credentials or payload fragments.
  let message = "Unexpected inbox error (message withheld).";
  let type = "Error", code = "";
  if (error instanceof Database.SqliteError) {
    type = "SqliteError";
    code = /^SQLITE_[A-Z_]{1,40}$/.test(error.code) ? error.code : "";
    if (["no such column: lease_owner", "no such table: integration_webhook_events",
      "database is locked", "database is busy", "attempt to write a readonly database",
      "database disk image is malformed", "database or disk is full"].includes(error.message)) message = error.message;
    else message = "SQLite inbox operation failed.";
  } else if (error instanceof SyntaxError) {
    type = "SyntaxError"; message = "Invalid stored accounting JSON (contents withheld).";
  } else if (error instanceof TypeError) type = "TypeError";
  // Reconstruct only source locations, never the message or arbitrary stack lines.
  const locations = [...String(error?.stack || "").matchAll(/[/\\]((?:server-[\w-]+|quickbooks|xero(?:-payments)?)\.js):(\d+):(\d+)\)?$/gm)]
    .slice(0, 8).map(([, file, line, column]) => `${file}:${line}:${column}`);
  return { type, code, message, locations };
}

export async function processAccountingInbox(db, { providerId = "xero", env = process.env, fetchImpl, limit = 20 } = {}) {
  const service = new AccountingService(db, { providerId, env, fetchImpl });
  const name = service.provider.name;
  db.prepare(`UPDATE integration_webhook_events SET status='FAILED',lease_until=0,lease_owner='',last_error_at=?,
    safe_error_message='Payment retry limit reached. Review the invoice and use manual payment sync.'
    WHERE provider=? AND status='PROCESSING' AND attempt_count>=8 AND lease_until<?`).run(new Date().toISOString(), providerId, Date.now());
  const connection = service.store.integration();
  if (service.enabled() && connection?.status === "CONNECTED" && !pendingQuickBooksCompany(service) && JSON.parse(connection.granted_scopes).includes(service.provider.paymentScope)) {
    db.prepare("UPDATE integration_webhook_events SET status='PENDING',retry_at=0 WHERE status='PAUSED' AND provider=? AND external_tenant_id=? AND attempt_count<8").run(providerId, connection.external_tenant_id);
  }
  let processed = 0;
  while (processed < limit) {
    const owner = crypto.randomUUID(), now = Date.now();
    const event = db.transaction(() => {
      const next = db.prepare(`SELECT * FROM integration_webhook_events WHERE provider=? AND attempt_count<8
        AND ((status IN ('PENDING','RETRYABLE') AND retry_at<=?) OR (status='PROCESSING' AND lease_until<?)) ORDER BY received_at,id LIMIT 1`).get(providerId, now, now);
      if (!next) return null;
      db.prepare("UPDATE integration_webhook_events SET status='PROCESSING',lease_owner=?,lease_until=?,attempt_count=attempt_count+1 WHERE id=?").run(owner, now + 120_000, next.id);
      return { ...next, attempt_count: next.attempt_count + 1 };
    })();
    if (!event) break;
    processed++;
    const heartbeat = setInterval(() => db.prepare("UPDATE integration_webhook_events SET lease_until=? WHERE id=? AND lease_owner=?").run(Date.now() + 120_000, event.id, owner), 15_000);
    heartbeat.unref();
    const finish = (status, message = "", retryAt = 0) => db.prepare(`UPDATE integration_webhook_events SET status=?,safe_error_message=?,retry_at=?,
      processed_at=?,last_error_at=?,lease_until=0,lease_owner='' WHERE id=? AND lease_owner=?`).run(status, message, retryAt,
      ["PROCESSED", "IGNORED"].includes(status) ? new Date().toISOString() : null,
      ["RETRYABLE", "FAILED", "REVIEW_REQUIRED", "PAUSED"].includes(status) ? new Date().toISOString() : null, event.id, owner);
    try {
      const connection = service.store.integration();
      if (connection?.external_tenant_id !== event.external_tenant_id) { finish("IGNORED", `No connected workspace matches this ${name} company.`); continue; }
      if (pendingQuickBooksCompany(service)) { finish("PAUSED", "Confirm or cancel the QuickBooks company switch before payment synchronisation resumes."); continue; }
      if (!service.enabled() || connection.status !== "CONNECTED") { finish("PAUSED", `Payment synchronisation is paused until ${name} is enabled and connected.`); continue; }
      let externalIds = [event.external_resource_id];
      if (event.event_category === "PAYMENT" && service.provider.paymentInvoiceIds) {
        // A moved/deleted payment must also reconcile its PREVIOUS allocations.
        const historical = db.prepare("SELECT DISTINCT external_invoice_id FROM integration_external_payments WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND external_payment_id=?")
          .all(service.store.workspaceId, providerId, event.external_tenant_id, event.external_resource_id).map((row) => row.external_invoice_id);
        const current = await service.work(async () => service.provider.paymentInvoiceIds(await service.credentials(), event.external_resource_id));
        externalIds = [...new Set([...historical, ...current])];
      }
      const jobs = externalIds.flatMap((id) => db.prepare(`SELECT i.job_id FROM integration_entity_mappings m JOIN invoices i ON i.id=m.local_entity_id
        WHERE m.workspace_id=? AND m.provider=? AND m.external_tenant_id=? AND m.local_entity_type='invoice' AND m.external_entity_id=?`)
        .all(service.store.workspaceId, providerId, event.external_tenant_id, id)).map((row) => row.job_id);
      if (!jobs.length) { finish("IGNORED", `No ELSET invoice mapping matches this ${name} event.`); continue; }
      for (const jobId of new Set(jobs)) await service.syncPayments(jobId, { expectedTenant: event.external_tenant_id });
      finish("PROCESSED");
    } catch (cause) {
      const error = safeAccountingError(cause);
      if (retryable.has(error.code) && event.attempt_count < 8) {
        const delay = Math.max(error.retryAfter * 1000, Math.min(3_600_000, 30_000 * 2 ** (event.attempt_count - 1)));
        finish("RETRYABLE", error.message, Date.now() + delay);
      } else finish(["PAYMENT_PERMISSION_REQUIRED", "NEEDS_REAUTHORIZATION", "NOT_CONNECTED", "ENVIRONMENT_MISMATCH"].includes(error.code) ? "PAUSED" : error.statusCode === 409 ? "REVIEW_REQUIRED" : "FAILED", error.message);
    } finally { clearInterval(heartbeat); }
  }
  return processed;
}

// One bounded durable queue consumer for all providers; no polling of company data.
export function createAccountingInboxWorker({ env = process.env, fetchImpl } = {}) {
  let running = false, stopped = false, timer, wakeAgain = false;
  const schedule = (delay = 0) => {
    if (stopped || getWorkspaceStorageMode(env) !== "sqlite") return;
    if (running) { wakeAgain = true; return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      running = true;
      let db, nextDelay;
      try {
        db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false, fileMustExist: true });
        for (const providerId of ["xero", "quickbooks"]) {
          try {
            await processAccountingInbox(db, { providerId, env, fetchImpl });
            const next = db.prepare(`SELECT MIN(CASE WHEN status='PROCESSING' THEN lease_until ELSE retry_at END) due
              FROM integration_webhook_events WHERE provider=? AND
              ((status IN ('PENDING','RETRYABLE') AND attempt_count<8) OR status='PROCESSING')`).get(providerId);
            if (next.due !== null) nextDelay = Math.min(nextDelay ?? Infinity, Math.max(1000, next.due - Date.now()));
          } catch (error) {
            console.error(`[accounting] ${providerId} inbox processing failed; persisted events remain recoverable.`, inboxDiagnostic(error));
            nextDelay = Math.min(nextDelay ?? Infinity, 60_000);
          }
        }
      } catch (error) {
        console.error("[accounting] Inbox processing unavailable; persisted events remain recoverable.", inboxDiagnostic(error));
        nextDelay = 60_000;
      }
      finally { db?.close(); running = false; }
      if (wakeAgain) { wakeAgain = false; nextDelay = 0; }
      if (nextDelay !== undefined) schedule(nextDelay);
    }, Math.min(delay, 2_147_483_647));
    timer.unref();
  };
  return { start: schedule, wake: schedule, stop() { stopped = true; clearTimeout(timer); } };
}
