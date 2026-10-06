// Released Jobs remain billable. No invoice, payment or mapping is changed.
export const workspaceBillingSchemaSql = `
  ALTER TABLE jobs ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'billable' CHECK(billing_type IN ('billable','warranty'));
  ALTER TABLE jobs ADD COLUMN warranty_reason TEXT NOT NULL DEFAULT '' CHECK(length(warranty_reason)<=240);
  CREATE INDEX idx_jobs_billing_type ON jobs(billing_type,status);
  CREATE TRIGGER jobs_warranty_invoice_guard BEFORE UPDATE OF billing_type ON jobs
  WHEN NEW.billing_type='warranty' AND (
    EXISTS(SELECT 1 FROM invoices WHERE job_id=NEW.id)
    OR EXISTS(SELECT 1 FROM integration_entity_mappings WHERE local_entity_type='invoice'
      AND (local_entity_id=NEW.id||':invoice' OR local_entity_id IN (SELECT invoice_id FROM deleted_invoices WHERE job_id=NEW.id)))
  ) BEGIN SELECT RAISE(ABORT,'Resolve the existing invoice or accounting mapping before marking this Job as Warranty'); END;
  CREATE TRIGGER jobs_warranty_mapping_insert_guard BEFORE INSERT ON jobs
  WHEN NEW.billing_type='warranty' AND EXISTS(SELECT 1 FROM integration_entity_mappings WHERE local_entity_type='invoice'
    AND (local_entity_id=NEW.id||':invoice' OR local_entity_id IN (SELECT invoice_id FROM deleted_invoices WHERE job_id=NEW.id)))
  BEGIN SELECT RAISE(ABORT,'Resolve the existing accounting mapping before marking this Job as Warranty'); END;
  CREATE TRIGGER invoices_billable_job_insert BEFORE INSERT ON invoices
  WHEN EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id AND billing_type='warranty')
  BEGIN SELECT RAISE(ABORT,'Warranty job cannot be invoiced'); END;
  CREATE TRIGGER invoices_billable_job_update BEFORE UPDATE OF job_id ON invoices
  WHEN EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id AND billing_type='warranty')
  BEGIN SELECT RAISE(ABORT,'Warranty job cannot be invoiced'); END;
  UPDATE workspace_info SET schema_version=18 WHERE id=1;
`;
