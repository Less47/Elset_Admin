-- Frozen reproduction of the locally applied schema-10 variant observed on 2026-09-21.
-- The first Git commit already includes lease_owner; its pre-commit source is unavailable.
-- Do not derive this missing-column fixture from the current migration in tests.

  ALTER TABLE payments ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','xero'));
  CREATE TABLE integration_invoice_payment_sync (
    invoice_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL,
    external_invoice_id TEXT NOT NULL,
    managed INTEGER NOT NULL DEFAULT 0 CHECK(managed IN (0,1)),
    status TEXT NOT NULL,
    error_code TEXT NOT NULL DEFAULT '',
    safe_error_message TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT,
    external_updated_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE integration_external_payments (
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL,
    external_payment_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    external_invoice_id TEXT NOT NULL,
    local_payment_id TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL,
    payment_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','REMOVED')),
    external_updated_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,provider,external_tenant_id,external_payment_id),
    UNIQUE(provider,external_tenant_id,external_payment_id)
  );
  CREATE INDEX idx_external_payments_invoice ON integration_external_payments(workspace_id,provider,external_tenant_id,invoice_id);
  CREATE TABLE integration_webhook_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL,
    event_category TEXT NOT NULL,
    event_type TEXT NOT NULL,
    external_resource_id TEXT NOT NULL,
    event_sequence TEXT NOT NULL,
    event_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    last_error_at TEXT,
    safe_error_message TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_webhook_ready ON integration_webhook_events(status,retry_at,lease_until);
  UPDATE workspace_info SET schema_version=10 WHERE id=1;
