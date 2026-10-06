// Reconstruct older fixtures from today's schema without retaining v18 artifacts.
export function removeBillingSchemaForLegacyFixture(db) {
  db.exec(`DROP TRIGGER jobs_warranty_invoice_guard; DROP TRIGGER jobs_warranty_mapping_insert_guard;
    DROP TRIGGER invoices_billable_job_insert; DROP TRIGGER invoices_billable_job_update;
    DROP INDEX idx_jobs_billing_type; ALTER TABLE jobs DROP COLUMN billing_type;
    ALTER TABLE jobs DROP COLUMN warranty_reason;
    DELETE FROM workspace_schema_migrations WHERE version=18;`);
}
