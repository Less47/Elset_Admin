// One forward migration. Copy every original payment column, including extra_json.
export const accountingV3SchemaSql = `
  CREATE TABLE payments_v3 (
    id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0, date TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, extra_json TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','xero','quickbooks')),
    FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );
  INSERT INTO payments_v3 SELECT id,invoice_id,amount_cents,date,method,reference,notes,created_at,extra_json,source FROM payments;
  DROP TABLE payments;
  ALTER TABLE payments_v3 RENAME TO payments;
  CREATE INDEX idx_payments_invoice ON payments(invoice_id);
  CREATE INDEX idx_payments_date ON payments(date);
  CREATE TABLE integration_external_payments_v3 (
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL, external_tenant_id TEXT NOT NULL, external_payment_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL, external_invoice_id TEXT NOT NULL, local_payment_id TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL, payment_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','REMOVED')),
    external_updated_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,provider,external_tenant_id,external_payment_id,invoice_id),
    UNIQUE(provider,external_tenant_id,external_payment_id,external_invoice_id)
  );
  INSERT INTO integration_external_payments_v3 SELECT * FROM integration_external_payments;
  DROP TABLE integration_external_payments;
  ALTER TABLE integration_external_payments_v3 RENAME TO integration_external_payments;
  CREATE INDEX idx_external_payments_invoice ON integration_external_payments(workspace_id,provider,external_tenant_id,invoice_id);
  ALTER TABLE workspace_integrations ADD COLUMN provider_environment TEXT NOT NULL DEFAULT '';
  ALTER TABLE workspace_integrations ADD COLUMN credential_metadata_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE integration_oauth_states ADD COLUMN provider_environment TEXT NOT NULL DEFAULT '';
  ALTER TABLE integration_entity_mappings ADD COLUMN external_version TEXT NOT NULL DEFAULT '';
  UPDATE workspace_info SET schema_version=11 WHERE id=1;
`;
