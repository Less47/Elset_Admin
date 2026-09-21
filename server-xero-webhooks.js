import crypto from "node:crypto";
import express from "express";
import { processAccountingInbox, createAccountingInboxWorker } from "./server-accounting-webhooks.js";
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

export const processXeroInbox = (db, options = {}) => processAccountingInbox(db, { ...options, providerId: "xero" });
export const createXeroInboxWorker = createAccountingInboxWorker;

export function registerXeroWebhook(app, { env = process.env, fetchImpl, worker = createXeroInboxWorker({ env, fetchImpl }) } = {}) {
  if (env.NODE_ENV === "production" && !env.XERO_WEBHOOK_KEY) console.error("[accounting] XERO_WEBHOOK_KEY is not configured; webhook delivery is unavailable.");
  app.locals.xeroInboxWorker = worker;
  app.locals.accountingInboxWorker = worker;
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
