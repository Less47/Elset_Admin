# Fly SQLite Deployment Runbook

This runbook is for the controlled production move from the legacy workspace JSON file to the SQLite workspace database. It uses placeholders for production identifiers and secrets. Replace placeholders only during the maintenance window.

Local configuration currently expects:

- Fly volume mount path: `/app/data`
- Workspace JSON source: `/app/data/app-data.json`
- Workspace SQLite database: `/app/data/elset-workspace.db`
- Better Auth database: `/app/data/auth.db`
- SQLite backup directory: `/app/data/backups`
- Runtime file directories, when used: `/app/data/uploads` and `/app/data/generated-documents`

The workspace database and Better Auth database are separate files. Do not restore workspace backups over `auth.db`, and do not store SMTP credentials, API keys, OAuth tokens, sessions, or passwords in the workspace database.

## 1. Pre-Maintenance Checks

Local:

```bash
git status --short
npm test
npm run test:e2e
npm run lint
npm run build
git diff --check
```

Fly read-only:

```bash
flyctl status -a <fly-app-name>
flyctl volumes list -a <fly-app-name>
flyctl machines list -a <fly-app-name>
flyctl secrets list -a <fly-app-name>
```

Confirm before continuing:

- Exactly one production machine will write to SQLite during normal operation.
- The attached production volume ID is `<volume-id>` in `<region>`.
- The volume is mounted at `/app/data`.
- `ELSET_DATA_DIR` is `/app/data`.
- No Fly process group, autoscaling setting, or extra machine can create concurrent SQLite writers.
- Required environment variables exist without printing their values: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `GEOAPIFY_API_KEY`, and optional `GEOAPIFY_MAPS_API_KEY`, `GEOAPIFY_COUNTRY_CODE`, `GEOAPIFY_MAP_STYLE`, `GEOAPIFY_AUTOCOMPLETE_LIMIT`.

## 2. Write-Free Maintenance Window

Fly mutating:

```bash
flyctl scale count 1 -a <fly-app-name>
flyctl machines stop <machine-id> -a <fly-app-name>
```

Confirm staff are logged out and no one is creating jobs, invoices, payments, imports, settings changes, or restores. Do not run the migration while writes are possible.

## 3. Verified Backup Procedure

If production is still JSON-backed before the migration, create and verify a raw JSON/auth backup first:

Local / Fly read-only:

```bash
FLY_APP=<fly-app-name> npm run backup:fly
```

Record the local archive path and SHA-256 checksum. Copy the archive somewhere outside the repository before proceeding.

If production already has a SQLite workspace, or immediately after the real migration completes, create a SQLite workspace backup from inside the container so it reads the mounted volume:

Fly mutating:

```bash
flyctl ssh console -a <fly-app-name> -s
cd /app
ELSET_DATA_DIR=/app/data npm run backup:workspace -- --include-files
```

Fly read-only:

```bash
flyctl ssh console -a <fly-app-name> -s
ls -lah /app/data/backups
```

Record the backup directory and every SHA-256 checksum. Do not proceed until the relevant backup has been validated.

## 4. Production JSON Dry-Run Migration

Fly read-only:

```bash
flyctl ssh console -a <fly-app-name> -s
cd /app
ELSET_DATA_DIR=/app/data npm run migrate:workspace -- --dry-run
```

Review counts and totals for staff, customers, sites, assets, access notes, jobs, job notes, attachments, quotes, invoices, payments, sent history, maintenance plans, inventory, settings, templates, and deleted records. Stop if any count, relationship, or financial total does not match.

## 5. Real Volume Migration

Fly mutating:

```bash
flyctl ssh console -a <fly-app-name> -s
cd /app
ELSET_DATA_DIR=/app/data npm run migrate:workspace
```

This command must create `/app/data/backups/workspace-json-before-sqlite-*`, leave `/app/data/app-data.json` untouched, create `/app/data/elset-workspace.db`, and refuse duplicate imports.

## 6. SQLite Startup Verification

Fly mutating:

```bash
flyctl machines start <machine-id> -a <fly-app-name>
```

Fly read-only:

```bash
flyctl logs -a <fly-app-name>
flyctl ssh console -a <fly-app-name> -s
curl -fsS http://127.0.0.1:8080/api/health
```

The health response must report `ok: true` and `storage.mode: sqlite`. If `/app/data` is missing, empty, read-only, mounted at the wrong path, or missing `elset-workspace.db`, startup and health must fail.

## 7. Count, Total, And Integrity Checks

Fly read-only:

```bash
flyctl ssh console -a <fly-app-name> -s
cd /app
node scripts/migrate-workspace.mjs --dry-run --source /app/data/app-data.json --db /app/data/elset-workspace.db
```

If the migration command refuses because the database is already populated, use the migration report and backup metadata recorded earlier. Separately verify SQLite:

Fly read-only:

```bash
flyctl ssh console -a <fly-app-name> -s
cd /app
node -e "import('./server-workspace-storage.js').then(({getWorkspaceReadinessStatus})=>console.log(JSON.stringify(getWorkspaceReadinessStatus(), null, 2)))"
```

Confirm job numbers are unique, invoice balances match payments, and customer/site/job, maintenance, document, payment, and technician relationships are intact.

## 8. Application Smoke Checks

Browser:

- Log in as an administrator.
- Confirm dashboard loads.
- Open customers, service board, job history, invoices, calendar, maintenance, inventory, staff, and settings.
- Create, edit, archive, and restore a temporary customer.
- Create and edit a temporary job.
- Create a temporary quote and invoice.
- Add and remove a temporary payment.
- Create and edit a temporary maintenance plan.
- Create and edit a temporary inventory item.
- Update and reset one temporary setting.
- Download and validate a SQLite backup.
- Confirm no browser request uses `PUT /api/app-state`.

Remove only the temporary smoke-test records through the app.

## 9. Rollback Decision Points

Rollback before allowing normal use if:

- Health does not report SQLite mode.
- Login fails for known valid staff.
- Counts or financial totals do not match the migration report.
- Foreign-key or integrity checks fail.
- Quotes, invoices, payments, jobs, customers, or sites are missing.
- The app attempts a broad `PUT /api/app-state` in SQLite mode.
- More than one Fly machine can write to the SQLite database.

## 10. Rollback Procedure

Preferred rollback preserves the migrated SQLite database for investigation and starts the previous JSON-backed workspace explicitly.

Fly mutating:

```bash
flyctl machines stop <machine-id> -a <fly-app-name>
flyctl secrets set ELSET_WORKSPACE_STORAGE=json -a <fly-app-name>
flyctl machines start <machine-id> -a <fly-app-name>
```

Fly read-only:

```bash
flyctl logs -a <fly-app-name>
flyctl ssh console -a <fly-app-name> -s
curl -fsS http://127.0.0.1:8080/api/health
```

Do not delete `/app/data/elset-workspace.db`. Do not delete `/app/data/app-data.json`. Do not deploy older JSON-only code over a migrated workspace unless `ELSET_WORKSPACE_STORAGE=json` is set and the JSON file has been verified.

## 11. Post-Deployment Monitoring

Fly read-only:

```bash
flyctl logs -a <fly-app-name>
flyctl status -a <fly-app-name>
flyctl machines list -a <fly-app-name>
```

Watch for SQLite busy timeouts, write failures, restore locks, missing volume errors, health check failures, SMTP errors, and unexpected broad workspace write rejections. Create a fresh SQLite backup after the first successful production work session.

## 12. Command Labels

Local commands run only on the operator machine and must not touch Fly unless they include `flyctl`.

Fly read-only commands inspect status, logs, files, or health without changing records or machine configuration.

Fly mutating commands can change production state, machine state, secrets, backups, or workspace data. Run them only inside the maintenance window after a verified backup.
