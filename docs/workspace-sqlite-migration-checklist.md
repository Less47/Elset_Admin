# Workspace SQLite Migration Checklist

Use this checklist before moving a real ELSET Admin workspace from `app-data.json` to SQLite.

## Local Testing

- Confirm you are not working in the Fly volume.
- Run `npm install`.
- Run `npm test`.
- Run `npm run migrate:workspace -- --dry-run --source fixtures/demo-workspace.json`.
- Create a temporary data directory.
- Copy a non-production or synthetic `app-data.json` into that temporary directory.
- Run `ELSET_DATA_DIR=/tmp/elset-migration-test npm run migrate:workspace`.
- Start the app against the temporary directory only.
- Confirm customers, sites, assets, jobs, notes, quotes, invoices, payments, inventory, settings, and deleted records load.

## Staging Migration

- Take a staging backup first.
- Copy staging `app-data.json` into the staging data directory.
- Run `npm run migrate:workspace -- --dry-run`.
- Review the migration report counts and financial totals.
- Run `npm run migrate:workspace`.
- Restart staging with SQLite enabled or with the migrated DB present.
- Validate the main workflow in staging.

## Production Backup

- Schedule a quiet window.
- Tell staff not to use the app during migration.
- Run the existing Fly backup command from your machine if needed: `npm run backup:fly`.
- Verify the backup archive exists in `backups/`.
- Verify the backup checksum file exists.
- Store a copy somewhere outside the repo.
- Do not delete or rename production `app-data.json`.

## Production Migration

- Do not run migration commands until the production backup is verified.
- Connect only through the planned operational process.
- Run a dry run against the production JSON first.
- Compare customer, site, asset, job, quote, invoice, payment, outstanding balance, maintenance, inventory, and send-history counts.
- Run the real migration only if the dry run is clean.
- Keep `app-data.json` in place after migration.

## Validation

- Start the app.
- Confirm the storage mode is SQLite.
- Check that staff can log in.
- Confirm customers, sites, assets, jobs, quotes, invoices, payments, inventory, settings, and deleted records are visible.
- Create a test customer.
- Create a test site.
- Create a test asset.
- Create and schedule a test job.
- Add a note.
- Change job status.
- Create a quote.
- Create an invoice.
- Record a partial payment.
- Record a final payment.
- Restart the server.
- Confirm the test records persist.
- Remove the test records using normal app controls.

## SQLite Backup Restore Test

- Create a temporary data directory.
- Start the app against that temporary directory only.
- Download a SQLite backup bundle from Settings > Data Backup.
- Restore the bundle into another temporary SQLite workspace.
- Confirm the restore creates `ELSET_DATA_DIR/backups/pre-restore-workspace-sqlite-*`.
- Confirm customer, site, job, quote, invoice, payment, maintenance, inventory, staff, settings, and deleted-record counts match the backup summary.
- Confirm login accounts, sessions, SMTP credentials, API keys, OAuth tokens, and environment variables were not restored or changed.
- Confirm a failed or tampered backup leaves the original workspace database in place.

## Rollback

- Stop the app.
- Set `ELSET_WORKSPACE_STORAGE=json`.
- Restart the app.
- Confirm the old JSON-backed workspace loads.
- Do not delete the SQLite database until the cause of rollback is understood.
- Do not delete the original JSON file.

## Sign-Off

- Record the migration timestamp.
- Record the source JSON checksum.
- Record the SQLite backup location.
- Record who validated the migration.
- Record any issues or follow-up work.
