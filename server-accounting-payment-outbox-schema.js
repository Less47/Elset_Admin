// A local payment edit and its durable accounting intent commit together.
// No FK to payments: deletion must retain its intent and external identity.
export const accountingPaymentOutboxSchemaSql = `
  ALTER TABLE integration_external_payments ADD COLUMN external_snapshot_json TEXT NOT NULL DEFAULT '';
  ALTER TABLE integration_operations ADD COLUMN request_json TEXT NOT NULL DEFAULT '';
  CREATE TABLE integration_payment_outbox (
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL CHECK(provider='quickbooks'),
    external_tenant_id TEXT NOT NULL,
    provider_environment TEXT NOT NULL,
    local_payment_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    completed_revision INTEGER NOT NULL DEFAULT 0,
    desired_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    safe_error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,provider,external_tenant_id,local_payment_id),
    UNIQUE(local_payment_id)
  );
  CREATE INDEX idx_payment_outbox_due ON integration_payment_outbox(status,retry_at);
  CREATE INDEX idx_payment_outbox_invoice ON integration_payment_outbox(invoice_id);
  UPDATE workspace_info SET schema_version=14 WHERE id=1;
`;
