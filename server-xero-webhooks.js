import crypto from "node:crypto";
import express from "express";
import { AccountingService } from "./server-accounting-service.js";
import { safeAccountingError } from "./server-accounting-errors.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";

export function verifyXeroSignature(raw, signature, key) {
  if (!key || !Buffer.isBuffer(raw) || typeof signature !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const supplied = Buffer.from(signature, "base64");
  const expected = crypto.createHmac("sha256", key).update(raw).digest();
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export function persistXeroEvents(db, body) {
  if (!body || !Array.isArray(body.events) || body.events.length > 1000
    || !Number.isSafeInteger(body.firstEventSequence) || !Number.isSafeInteger(body.lastEventSequence)
    || body.firstEventSequence < 0 || body.lastEventSequence < body.firstEventSequence) throw new Error("Invalid event envelope");
  return db.transaction(() => {
    let count = 0;
    for (const [index, event] of body.events.entries()) {
      if (!["tenantId", "resourceId", "eventCategory", "eventType", "tenantType", "eventDateUtc"].every((key) => typeof event?.[key] === "string" && event[key].length > 0 && event[key].length <= 128)) throw new Error("Invalid event metadata");
      // The contract has batch sequence bounds, not an event ID. Include the bounds,
      // position and immutable metadata; exclude entropy and untrusted resource URLs.
      const sequence = `${body.firstEventSequence}:${body.lastEventSequence}:${index}`;
      const id = crypto.createHash("sha256").update(JSON.stringify([sequence, event.tenantId, event.resourceId, event.eventCategory, event.eventType, event.eventDateUtc])).digest("hex");
      const supported = event.tenantType === "ORGANISATION" && event.eventCategory === "INVOICE" && event.eventType === "UPDATE";
      count += db.prepare(`INSERT INTO integration_webhook_events(id,provider,external_tenant_id,event_category,event_type,external_resource_id,event_sequence,event_date,status,received_at,processed_at,safe_error_message)
        VALUES(?,'xero',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(id, event.tenantId, event.eventCategory, event.eventType,
        event.resourceId, sequence, event.eventDateUtc, supported ? "PENDING" : "IGNORED", new Date().toISOString(), supported ? null : new Date().toISOString(), supported ? "" : "Event does not require invoice payment reconciliation.").changes;
    }
    return count;
  })();
}

const retryable = new Set(["RATE_LIMITED", "PROVIDER_UNAVAILABLE", "EXTERNAL_CHANGING", "INTEGRATION_BUSY", "INTEGRATION_ERROR"]);
export async function processXeroInbox(db, { env = process.env, fetchImpl, limit = 20 } = {}) {
  const service = new AccountingService(db, { env, fetchImpl });
  db.prepare(`UPDATE integration_webhook_events SET status='FAILED',lease_until=0,lease_owner='',last_error_at=?,
    safe_error_message='Payment synchronisation retry limit reached. Review the invoice and use Sync from Xero.'
    WHERE provider='xero' AND status='PROCESSING' AND attempt_count>=8 AND lease_until<?`).run(new Date().toISOString(), Date.now());
  const connection = service.store.integration();
  if (service.enabled() && connection?.status === "CONNECTED" && JSON.parse(connection.granted_scopes).includes(service.provider.paymentScope)) {
    db.prepare("UPDATE integration_webhook_events SET status='PENDING',retry_at=0 WHERE status='PAUSED' AND provider='xero' AND external_tenant_id=? AND attempt_count<8").run(connection.external_tenant_id);
  }
  let processed = 0;
  while (processed < limit) {
    const owner = crypto.randomUUID(), now = Date.now();
    const event = db.transaction(() => {
      const next = db.prepare(`SELECT * FROM integration_webhook_events WHERE provider='xero' AND attempt_count<8
        AND ((status IN ('PENDING','RETRYABLE') AND retry_at<=?) OR (status='PROCESSING' AND lease_until<?)) ORDER BY received_at,id LIMIT 1`).get(now, now);
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
      if (connection?.external_tenant_id !== event.external_tenant_id) { finish("IGNORED", "No connected workspace matches this Xero organisation."); continue; }
      const mapping = db.prepare(`SELECT m.local_entity_id,i.job_id FROM integration_entity_mappings m JOIN invoices i ON i.id=m.local_entity_id
        WHERE m.workspace_id=? AND m.provider='xero' AND m.external_tenant_id=? AND m.local_entity_type='invoice' AND m.external_entity_id=?`)
        .get(service.store.workspaceId, event.external_tenant_id, event.external_resource_id);
      if (!mapping) { finish("IGNORED", "No ELSET invoice mapping matches this Xero invoice."); continue; }
      if (!service.enabled() || connection.status !== "CONNECTED") { finish("PAUSED", "Payment synchronisation is paused until Xero is enabled and connected."); continue; }
      await service.syncPayments(mapping.job_id, { expectedTenant: event.external_tenant_id });
      finish("PROCESSED");
    } catch (cause) {
      const error = safeAccountingError(cause);
      if (retryable.has(error.code) && event.attempt_count < 8) {
        const delay = Math.max(error.retryAfter * 1000, Math.min(3_600_000, 30_000 * 2 ** (event.attempt_count - 1)));
        finish("RETRYABLE", error.message, Date.now() + delay);
      } else finish(["PAYMENT_PERMISSION_REQUIRED", "NEEDS_REAUTHORIZATION", "NOT_CONNECTED"].includes(error.code) ? "PAUSED" : error.statusCode === 409 ? "REVIEW_REQUIRED" : "FAILED", error.message);
    } finally { clearInterval(heartbeat); }
  }
  return processed;
}

// A bounded queue consumer, not a periodic reconciliation scheduler. Timers only
// wake durable, already-received work while this process is running.
export function createXeroInboxWorker({ env = process.env, fetchImpl } = {}) {
  let running = false, stopped = false, timer;
  const schedule = (delay = 0) => {
    if (stopped || running || getWorkspaceStorageMode(env) !== "sqlite") return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      running = true;
      let db, nextDelay;
      try {
        db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false, fileMustExist: true });
        await processXeroInbox(db, { env, fetchImpl });
        const next = db.prepare(`SELECT MIN(CASE WHEN status='PROCESSING' THEN lease_until ELSE retry_at END) due
          FROM integration_webhook_events WHERE (status IN ('PENDING','RETRYABLE') AND attempt_count<8) OR status='PROCESSING'`).get();
        if (next.due !== null) nextDelay = Math.max(1000, next.due - Date.now());
      } catch { console.error("[accounting] Xero inbox processing unavailable; persisted events remain recoverable."); nextDelay = 60_000; }
      finally { db?.close(); running = false; }
      if (nextDelay !== undefined) schedule(nextDelay);
    }, Math.min(delay, 2_147_483_647));
    timer.unref();
  };
  return { start: schedule, wake: schedule, stop() { stopped = true; clearTimeout(timer); } };
}

export function registerXeroWebhook(app, { env = process.env, fetchImpl, worker = createXeroInboxWorker({ env, fetchImpl }) } = {}) {
  if (env.NODE_ENV === "production" && !env.XERO_WEBHOOK_KEY) console.error("[accounting] XERO_WEBHOOK_KEY is not configured; webhook delivery is unavailable.");
  app.locals.xeroInboxWorker = worker;
  app.post("/api/integrations/xero/webhook", (req, res, next) => {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(req.get("x-xero-signature") || "")) return res.status(401).end();
    next();
  }, express.raw({ type: () => true, limit: "256kb", inflate: false }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!env.XERO_WEBHOOK_KEY) return res.status(503).end();
    if (!verifyXeroSignature(req.body, req.get("x-xero-signature"), env.XERO_WEBHOOK_KEY)) return res.status(401).end();
    let payload;
    try { payload = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).end(); }
    let db;
    try {
      if (getWorkspaceStorageMode(env) !== "sqlite") return res.status(503).end();
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false, fileMustExist: true });
      db.pragma("busy_timeout=1000");
      persistXeroEvents(db, payload);
    } catch { return res.status(503).end(); }
    finally { db?.close(); }
    res.status(200).end();
    worker.wake();
  });
  return worker;
}
