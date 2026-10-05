// Tests which reconstruct released schemas from today's empty-media fixtures
// must remove every v17 artifact before resetting their historical ledger.
export function removeMediaSchemaForLegacyFixture(db) {
  db.exec(`DROP TRIGGER jobs_site_owner_insert; DROP TRIGGER jobs_site_owner_update;
    DROP INDEX idx_jobs_explicit_site; ALTER TABLE jobs DROP COLUMN site_id;
    DROP TABLE workspace_media; DELETE FROM workspace_schema_migrations WHERE version=17;`);
}
