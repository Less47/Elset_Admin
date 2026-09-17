import crypto from "node:crypto";
import { AccountingError } from "./server-accounting-errors.js";
import { digest } from "./server-accounting-crypto.js";

export class AccountingStore {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
    this.workspaceId = db.prepare("SELECT workspace_id FROM integration_workspace WHERE id = 1").get().workspace_id;
  }
  integration() {
    return this.db.prepare("SELECT * FROM workspace_integrations WHERE workspace_id = ? AND provider = ?").get(this.workspaceId, this.provider);
  }
  ensureIntegration() {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO workspace_integrations(id, workspace_id, provider, created_at, updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(workspace_id, provider) DO NOTHING`).run(crypto.randomUUID(), this.workspaceId, this.provider, now, now);
    return this.integration();
  }
  update(values) {
    const allowed = new Set(["external_tenant_id", "external_tenant_name", "external_connection_id", "encrypted_access_token", "encrypted_refresh_token", "token_expires_at", "granted_scopes", "status", "config_json", "organisations_json", "connected_by_user_id", "connected_at", "last_success_at", "last_error_at", "safe_error_message", "retry_after"]);
    const entries = Object.entries(values);
    if (entries.some(([key]) => !allowed.has(key))) throw new Error("Invalid integration field");
    this.db.prepare(`UPDATE workspace_integrations SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ? WHERE workspace_id = ? AND provider = ?`)
      .run(...entries.map(([, value]) => value), new Date().toISOString(), this.workspaceId, this.provider);
  }
  scope(tenant, type, id) { return [this.workspaceId, this.provider, tenant, type, id]; }
  mapping(tenant, type, id) {
    return this.db.prepare(`SELECT * FROM integration_entity_mappings WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND local_entity_type=? AND local_entity_id=?`).get(...this.scope(tenant, type, id));
  }
  map(tenant, type, id, externalId, reference = "", fingerprint = "") {
    const now = new Date().toISOString();
    try {
      this.db.prepare(`INSERT INTO integration_entity_mappings(id, workspace_id, provider, external_tenant_id, local_entity_type, local_entity_id, external_entity_id, external_reference, external_fingerprint, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,provider,external_tenant_id,local_entity_type,local_entity_id)
        DO UPDATE SET external_reference=excluded.external_reference, external_fingerprint=excluded.external_fingerprint, updated_at=excluded.updated_at
        WHERE integration_entity_mappings.external_entity_id=excluded.external_entity_id`)
        .run(crypto.randomUUID(), ...this.scope(tenant, type, id), externalId, reference, fingerprint, now, now);
      if (this.mapping(tenant, type, id)?.external_entity_id !== externalId) throw new Error();
    } catch { throw new AccountingError("MAPPING_CONFLICT", "This accounting record is already mapped to another local record. Review the mapping before retrying.", 409); }
  }
  log(tenant, type, id, operation, status, externalId = "", error) {
    this.db.prepare(`INSERT INTO integration_sync_log(workspace_id,provider,external_tenant_id,entity_type,entity_id,operation,status,external_entity_id,error_code,safe_error_message,http_status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(...this.scope(tenant, type, id), operation, status, externalId, error?.code || "", error?.message || "", error?.statusCode || null, new Date().toISOString());
  }
  latest(tenant, type, id) {
    return this.db.prepare("SELECT * FROM integration_sync_log WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND entity_type=? AND entity_id=? ORDER BY id DESC LIMIT 1").get(...this.scope(tenant, type, id));
  }
  operation(tenant, type, id) {
    return this.db.prepare("SELECT * FROM integration_operations WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND entity_type=? AND entity_id=?").get(...this.scope(tenant, type, id));
  }
  prepareOperation(tenant, type, id, request) {
    const hash = digest(JSON.stringify(request)), current = this.operation(tenant, type, id);
    if (current?.status === "PENDING") {
      if (current.request_hash !== hash) throw new AccountingError("AMBIGUOUS_WRITE", "An earlier request has an uncertain result. Restore the previously saved details or reconcile the existing accounting record before retrying.", 409);
      if (Date.now() - current.started_at < 5 * 60_000) return current.idempotency_key;
      throw new AccountingError("AMBIGUOUS_WRITE", "The earlier request could not be reconciled and its retry window expired. Check the accounting organisation before retrying; no new record was created.", 409);
    }
    const key = crypto.randomUUID();
    this.db.prepare(`INSERT INTO integration_operations(workspace_id,provider,external_tenant_id,entity_type,entity_id,request_hash,idempotency_key,started_at,status)
      VALUES(?,?,?,?,?,?,?,?, 'PENDING') ON CONFLICT(workspace_id,provider,external_tenant_id,entity_type,entity_id)
      DO UPDATE SET request_hash=excluded.request_hash,idempotency_key=excluded.idempotency_key,started_at=excluded.started_at,status='PENDING'`)
      .run(...this.scope(tenant, type, id), hash, key, Date.now());
    return key;
  }
  finishOperation(tenant, type, id, status = "DONE") {
    this.db.prepare("UPDATE integration_operations SET status=? WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND entity_type=? AND entity_id=?")
      .run(status, ...this.scope(tenant, type, id));
  }
  isLocked() {
    return Boolean(this.db.prepare("SELECT 1 FROM integration_locks WHERE workspace_id=? AND provider=? AND expires_at>?").get(this.workspaceId, this.provider, Date.now()));
  }
  async lock(action) {
    const owner = crypto.randomUUID();
    const acquire = this.db.prepare(`INSERT INTO integration_locks(workspace_id,provider,owner,expires_at) VALUES(?,?,?,?)
      ON CONFLICT(workspace_id,provider) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE integration_locks.expires_at<?`)
      .run(this.workspaceId, this.provider, owner, Date.now() + 120_000, Date.now());
    if (!acquire.changes) throw new AccountingError("INTEGRATION_BUSY", "Another accounting request is in progress. Try again when it finishes.", 409);
    const heartbeat = setInterval(() => this.db.prepare("UPDATE integration_locks SET expires_at=? WHERE workspace_id=? AND provider=? AND owner=?").run(Date.now() + 120_000, this.workspaceId, this.provider, owner), 15_000);
    heartbeat.unref();
    try { return await action(); }
    finally {
      clearInterval(heartbeat);
      this.db.prepare("DELETE FROM integration_locks WHERE workspace_id=? AND provider=? AND owner=?").run(this.workspaceId, this.provider, owner);
    }
  }
}
