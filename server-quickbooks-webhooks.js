import crypto from "node:crypto";
import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";
import { createAccountingInboxWorker, processAccountingInbox } from "./server-accounting-webhooks.js";

class InvalidQuickBooksWebhook extends Error {}
const metadataString = (value, limit = 128) => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const eventTime = /^\d{4}-\d{2}-\d{2}[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

// Intuit's current format is a CloudEvents array, with a realm on EACH event.
// Only project routing metadata: data may be absent, empty, or contain private
// entity details. Reconciliation always fetches current QuickBooks API state.
export function parseQuickBooksEvents(payload) {
  if (!Array.isArray(payload) || payload.length > 1000) throw new InvalidQuickBooksWebhook("Invalid CloudEvents envelope");
  return payload.map((event) => {
    if (event?.specversion !== "1.0" || !["id", "type", "time", "intuitentityid", "intuitaccountid"].every((key) => metadataString(event[key]))
      || !metadataString(event.source, 2048)
      || (event.datacontenttype !== undefined && !metadataString(event.datacontenttype, 256))
      || !/^\d{1,50}$/.test(event.intuitaccountid) || !eventTime.test(event.time) || !Number.isFinite(Date.parse(event.time))) {
      throw new InvalidQuickBooksWebhook("Invalid CloudEvents metadata");
    }
    // Documented forms use past-tense operations (created/updated/deleted/voided).
    // Normalize routing only; immutable event and company IDs remain untouched.
    const type = event.type.toLowerCase();
    const match = /^qbo\.(invoice|payment)\.(created|updated|deleted|voided)\.v1$/.exec(type);
    if (match && !/^\d{1,50}$/.test(event.intuitentityid)) throw new InvalidQuickBooksWebhook("Invalid QuickBooks resource ID");
    return { eventId: event.id, source: event.source, realmId: event.intuitaccountid, resourceId: event.intuitentityid,
      time: event.time, type, category: match ? match[1].toUpperCase() : "OTHER" };
  });
}

// Intuit: base64 HMAC-SHA256 over the exact HTTP body, using the app's
// environment-specific webhook verifier token (not its OAuth client secret).
export function verifyQuickBooksSignature(raw, signature, verifierToken) {
  if (!verifierToken || !Buffer.isBuffer(raw) || typeof signature !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const supplied = Buffer.from(signature, "base64");
  const calculated = crypto.createHmac("sha256", verifierToken).update(raw).digest();
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
}
export function persistQuickBooksEvents(db, payload) {
  // Validate the whole batch before writing, so malformed events cannot cause a
  // partial acknowledgement. CloudEvents identity is source + id; scope it to
  // provider/company too, and recognize earlier inbox keys without rewriting rows.
  const events = parseQuickBooksEvents(payload);
  return db.transaction(() => {
    let count = 0;
    const insert = db.prepare(`INSERT INTO integration_webhook_events(id,provider,external_tenant_id,event_category,event_type,external_resource_id,event_sequence,event_date,status,received_at,processed_at,safe_error_message)
      VALUES(?,'quickbooks',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
    const previousKey = db.prepare("SELECT 1 FROM integration_webhook_events WHERE id=? AND provider='quickbooks' AND external_tenant_id=? AND event_sequence=?");
    for (const event of events) {
      const oldId = crypto.createHash("sha256").update(JSON.stringify(["quickbooks", event.realmId, event.eventId])).digest("hex");
      if (previousKey.get(oldId, event.realmId, event.eventId)) continue;
      const id = crypto.createHash("sha256").update(JSON.stringify(["quickbooks", event.realmId, event.source, event.eventId])).digest("hex");
      const now = new Date().toISOString();
      const supported = event.category !== "OTHER";
      count += insert.run(id, event.realmId, event.category, event.type, event.resourceId, event.eventId, event.time,
        supported ? "PENDING" : "IGNORED", now, supported ? null : now, supported ? "" : "Event is outside invoice and payment reconciliation.").changes;
    }
    return count;
  })();
}
export const processQuickBooksInbox = (db, options = {}) => processAccountingInbox(db, { ...options, providerId: "quickbooks" });
export function registerQuickBooksWebhook(app, { env = process.env, fetchImpl, worker = createAccountingInboxWorker({ env, fetchImpl }) } = {}) {
  app.locals.accountingInboxWorker = worker;
  app.post("/api/integrations/quickbooks/webhook", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!/^[A-Za-z0-9+/]{43}=$/.test(req.get("intuit-signature") || "")) return res.status(401).end();
    next();
  }, express.raw({ type: () => true, limit: "256kb", inflate: false }), (req, res) => {
    if (!env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN) return res.status(503).end();
    if (!verifyQuickBooksSignature(req.body, req.get("intuit-signature"), env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN)) return res.status(401).end();
    let body;
    try { body = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).end(); }
    let db, inserted;
    try {
      if (getWorkspaceStorageMode(env) !== "sqlite" || !["sandbox", "production"].includes(env.QUICKBOOKS_ENVIRONMENT)) return res.status(503).end();
      db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false, fileMustExist: true });
      db.pragma("busy_timeout=1000");
      const saved = db.prepare("SELECT provider_environment FROM workspace_integrations WHERE provider='quickbooks'").get();
      if (saved?.provider_environment && saved.provider_environment !== env.QUICKBOOKS_ENVIRONMENT) return res.status(503).end();
      inserted = persistQuickBooksEvents(db, body);
    } catch (error) { return res.status(error instanceof InvalidQuickBooksWebhook ? 400 : 503).end(); }
    finally { db?.close(); }
    res.status(200).end();
    if (inserted) worker.wake();
  });
  return worker;
}
