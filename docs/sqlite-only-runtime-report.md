# SQLite-only workspace runtime retirement

This change retires live JSON workspace storage. The working tree was clean at the initial audit. No commit, push, deployment, production connection, production mutation, or deletion of the historical production JSON file was performed.

## Runtime behavior

| Area | Result |
| --- | --- |
| Workspace source | SQLite at `ELSET_DATA_DIR/elset-workspace.db`; the existing explicit DB-path override remains useful for isolated tests. |
| Authentication | Better Auth at `ELSET_DATA_DIR/auth.db`, with its existing explicit path override. |
| Startup | An existing database is mandatory in development, test, and production. Supported existing SQLite schemas still upgrade transactionally. Missing, corrupt, unrecognized, future, or damaged schemas fail startup. |
| Readiness | Read-only SQLite schema, integrity, and relationship checks; missing storage produces unhealthy readiness. |
| Historical JSON file | Its presence, contents, and absence have no effect on runtime datastore selection. |
| Retired storage environment variable | No runtime code reads `ELSET_WORKSPACE_STORAGE`. Setting its old `json` value cannot enable a fallback. |
| Initial app state | `GET /api/app-state` returns authorized SQLite state without a `storageMode` field. |
| Broad writes | `PUT /api/app-state` is removed and returns 404. There is no replacement broad SQLite write API. |
| Record writes | Customer, Site, Job, schedule, note, document, payment, Staff, inventory, maintenance, template, Settings, add-on, branding, and accounting APIs continue using SQLite. Runtime connections require the database to exist. |
| Browser state | Removed legacy local-storage workspace migration, broad autosave, JSON settings saves, and local-only mutation branches. Initial unauthenticated state is empty; a failed bootstrap never substitutes demo data. |

The missing-database message identifies the path and says: “Refusing to start without the SQLite workspace database. Restore a verified SQLite backup before starting the application.” No empty replacement workspace is created.

### Normalization and offline migration

`server-store.js` remains a pure normalization/default/data-shape module. Its filesystem paths, JSON load/save functions, authorized broad saves, legacy authentication persistence, and JSON backup/restore functions were removed. Historical record normalization remains available to the SQLite loader and explicit imports.

Shared integer financial calculations and database summaries moved unchanged to `server-workspace-financials.js` and `server-workspace-summary.js`. The offline importer re-exports them for compatibility. Normal runtime modules now import the shared modules directly; neither server entry point depends on the offline importer.

Retained deliberately:

- `scripts/migrate-workspace.mjs`: explicit offline dry-run/import, source backup/checksum, validation, transaction rollback, and duplicate-import protection.
- `server-workspace-importer.js`: historical record conversion and validation.
- `fixtures/demo-workspace.json`: committed synthetic input for tests and explicit demo setup.
- Migration and historical normalization tests, including real CLI invocation.
- `scripts/generate-demo-data.mjs`: now an offline synthetic generator requiring a new `--output=<json-file>`. It refuses overwrite and never updates a live workspace.

The application no longer imports legacy JSON users during Better Auth startup. Existing Better Auth sign-in, password verification, account management, and account-specific appearance settings remain in place. Settings still preview drafts locally and persist through explicit Save changes.

### ServiceM8

The only apply flow is preview/import plan → SQLite transaction → refreshed authorized SQLite state. Removed the JSON merge/save branch and its dependency injection. Preview ownership/expiry, dry-run and validation-only behavior, permissions, import validation, transaction rollback, and duplicate handling remain covered by the existing ServiceM8 tests. No live ServiceM8 import was run.

## Backup and restore

Settings downloads the existing `elset-workspace-sqlite-backup-v1` bundle. Its `.json` extension is a transport envelope containing SQLite bytes, metadata, and checksums; it is not JSON runtime storage. The format's existing `backup.storageMode: "sqlite"` metadata is retained for bundle compatibility and does not select a datastore.

Removed the legacy `POST /api/admin/data-backup/restore` endpoint and its frontend branch. The supported `POST /api/admin/workspace-restore` path retains password verification, validation/dry-run, restore locking, pre-restore backup, atomic replacement, verification, and rollback. A workspace restore never overwrites `auth.db`. An integration test compares auth users/accounts/sessions before and after a real workspace restore and verifies the same authenticated session still works.

The shared SQLite backup function opens sources read-only and uses SQLite's online backup API, including committed WAL contents. It converts only the resulting copies to standalone rollback-journal mode so portable snapshots do not require live WAL/SHM files. Local `backup:workspace` also uses this helper and full workspace validation. If `--include-auth` is requested, missing auth now fails explicitly instead of silently omitting it.

Workspace snapshots include encrypted accounting integration credentials stored in SQLite. They exclude Better Auth records and environment secrets. The full Fly snapshot includes Better Auth records as well. Documentation and Settings help distinguish these cases; retain the matching integration encryption key separately for recovery.

### How `npm run backup:fly` works

1. Read Fly's machine list. Select exactly one started machine with a mount at `/app/data`; require `--machine=<id>` if ambiguous. An explicit ID must also satisfy these conditions.
2. Run a self-contained helper on that machine, using existing deployed SQLite backup code and `better-sqlite3`. The helper is transmitted as encoded Node code and does not require deploying this change first. It honors the machine's explicit workspace/auth path overrides.
3. Create a private, unique `/tmp/elset-fly-backup-<uuid>/snapshot` directory. Take separate online backups of workspace and auth databases; never copy live DB/WAL/SHM sets. Convert snapshot copies to standalone journal mode and validate them.
4. Copy `uploads/` and `generated-documents/` when present. Reject symbolic links and special files. Record which directories were included.
5. Write metadata containing source machine/image, schema, business counts, financial totals, auth table counts, sizes, and hashes. Hash metadata and inventory every included file in a manifest with its own checksum.
6. Download recursively from the same machine using SFTP. Validate manifest paths/inventory, sizes and SHA-256 values, workspace schema/integrity/foreign keys/counts/financial totals, and auth integrity/foreign keys/counts locally.
7. Only after validation succeeds, write a local validation report, create a `.tar.gz` archive, hash it, and report success. Output contains paths, hashes, and summary counts, not credentials or record contents.
8. In `finally`, remove only that generated remote temporary directory on the same machine. Retain partial local output on failure and report cleanup failure if necessary. Never remove anything under `/app/data`.

Supported options: `--app=<name>`, `--machine=<id>`, and `--output=<directory>`. The default app remains `elset-admin`; backups remain gitignored. Machine pinning and recursive transfer flags were checked against local Fly CLI help and [Fly's SFTP documentation](https://www.fly.io/docs/flyctl/ssh-sftp-get/).

Each database snapshot is individually consistent. Workspace, auth, and external files do not share one transaction; pause application writes when a coordinated recovery point is required. Environment secrets are not exported. No accounting provider is contacted.

The actual production Fly command was **not run**. Local tests execute the exact serialized remote helper against synthetic databases containing committed WAL data, mock machine selection and SFTP transport, and create/validate a real local archive. Live Fly access, available remote disk space, and production download performance remain operational acceptance checks.

### Recovery boundaries

- For workspace-only recovery, validate the Settings bundle and use its existing restore flow; authentication remains untouched.
- A Fly archive contains `snapshot/elset-workspace.db`, `snapshot/auth.db`, metadata, checksum files, and any included external directories. It is an operational recovery artifact, not a Settings upload bundle.
- Full filesystem recovery requires stopping the application and separately planning workspace, auth, external-file, and matching-secret restoration. This change adds no automatic auth restoration.
- Preserve failed databases and historical JSON files. Do not switch datastore engines or delete `/app/data/app-data.json` as part of this retirement.

## Remaining historical JSON references

Repository searches included hidden configuration and excluded dependency/build/runtime-data artifacts. Remaining `app-data.json` mentions are:

| File | Purpose |
| --- | --- |
| `.gitignore` | Prevent historical local business data from being committed. |
| `scripts/migrate-workspace.mjs` | Explicit offline source filename and CLI help. |
| `tests/workspace-migration.test.js` | Malformed-source handling, explicit import, source preservation, and auth-startup non-rewrite checks in temporary directories. |
| `tests/sqlite-only-runtime.test.js` | Historical JSON sentinel proving missing SQLite never falls back and normal startup/API/backup/restore leaves JSON unchanged. |
| `tests/create-local-admin.test.js` | Existing protection test that local auth administration does not change workspace JSON. |
| `README.md` | Offline migration instructions and preservation of the historical production file. |
| `docs/fly-sqlite-deployment-runbook.md` | Explicitly historical offline migration steps and current SQLite recovery boundaries. |
| `docs/workspace-sqlite-migration-checklist.md` | Offline migration/source-preservation checklist. |
| `docs/google-maps-test-report.md` | Historical record/coordinate audit, marked as superseded runtime architecture. |
| `docs/google-places-migration-report.md` | Historical test evidence/source-file preservation. |
| `docs/geoapify-cleanup-report.md` | Historical unchanged-file hash evidence. |
| `docs/google-address-route-fix-report.md` | Historical unchanged-file hash evidence. |
| `docs/site-location-audit-report.md` | Historical coordinate/source-preservation audit. |
| This report | Retirement decisions and audit inventory. |

No runtime code contains those references. A static local-import graph audit of `server.js` and `dev-server.js` visited **86 modules**, finding no dependency on `server-workspace-importer.js`/`scripts/migrate-workspace.mjs` and no retired runtime selector/persistence identifiers. The old environment selector appears only in its hostile-configuration test and this report. Removed storage helper names and live rollback instructions have no runtime callers. Generic JSON HTTP bodies, SQLite JSON columns, and historical record normalization remain legitimate.

## Observed verification

All mutable test work used temporary synthetic SQLite/auth databases. Accounting browser tests use controlled provider fixtures. No production data or secrets were accessed.

| Check | Result |
| --- | --- |
| `npm test` | **715 passed, 0 failed**, including the new SQLite-only and runtime-backup suites, existing accounting/payment tests, and offline migration CLI coverage. |
| `npm run lint` | Passed. |
| `npm run build` | Passed; final Vite build completed in 673 ms. |
| Relevant Playwright | **333 distinct scenarios passed across the runs below**, with no unresolved failures. The final focused run against the final build passed **16/16**. |
| Actual `npm start`, valid temporary workspace | Health HTTP 200 with `sqliteExists: true`; frontend HTTP 200; unauthenticated app-state HTTP 401. Historical JSON unchanged. Server stopped after verification. |
| Actual `npm start`, missing DB with historical JSON present | Exit **1** with explicit refusal; no listening message, no workspace DB created, historical JSON unchanged. |
| `git diff --check` | Passed. |

Browser run details (all used the explicit Playwright config and tsconfig):

- Customer account/customer CRUD, documents, costing, and Settings: 144 scenarios; initial result 132 passed / 12 failed. Document failures were corrected and rerun.
- Calendar scheduling, documents, maintenance, mobile workflows, QuickBooks and Xero: 235 scenarios; initial result 226 passed / 9 failed. All nine were corrected and passed the focused rerun.
- Final focused run: 16 passed / 0 failed, covering all nine remaining failures plus quote/invoice saves, rounded-edge preferences, and Settings save guards at four widths.
- De-duplicating by file and scenario title yields 333 scenarios whose latest result is passing. This was relevant coverage, not a claim that every repository E2E was run.

An additional offline demo check generated a new synthetic fixture, verified overwrite refusal and unchanged source bytes, and successfully dry-ran migration without creating a database.

The direct startup harness ran `npm.cmd start` on Windows. A test-only Node preload recorded the child PID solely for precise cleanup; application startup code was unchanged. Node was v24.19.0. Playwright used `--config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1`.

Earlier browser runs exposed a leftover removed JSON-save test variable, an issued-invoice list expectation for an unsent draft, a hidden price-list filter, and mobile tests expecting non-invoiced jobs on the issued-invoice page. Tests now follow the existing controls and invoice eligibility rules. QuickBooks tests close the parent connection dialog before changing Settings tabs and select nested dialogs by their accessible names. The visual-density test explicitly selects List view so persisted account preferences cannot alter its layout assumptions. No unrelated invoice eligibility or CSS behavior was changed.

Ignored evidence: `test-results/sqlite-only-tests-final.log`, `sqlite-only-lint-final.log`, `sqlite-only-build-final.log`, `sqlite-only-e2e-main.log`, `sqlite-only-e2e-final.log`, `sqlite-only-e2e-recheck.log`, `sqlite-only-e2e-summary.json`, `sqlite-only-npm-start.json`, and `sqlite-only-runtime-import-audit.json`.

## Before commit or deployment

Git status: **117 modified files, 2 deleted files, and 6 new untracked files (125 total)**; the staged diff is empty. Changes are uncommitted and unstaged. No deploy, push, production backup command, provider connection, or production data modification was performed. Keep the already-downloaded verified production backup and historical JSON file. Before any separately authorized release, confirm the persistent SQLite mount, supported schema, available backup space, matching encryption secrets, and a verified recovery artifact. Live Fly execution remains unverified as described above.

## Exact changed-file manifest

The manifest contains 125 files. `M` means modified, `A` new/untracked, and `D` deleted. The large number of test edits primarily removes obsolete storage-mode setup or JSON-only branches.

```text
M docs/addons-job-costing.md
M docs/addons-toggle-fix.md
M docs/calendar-undo.md
M docs/customer-account-report.md
M docs/fly-sqlite-deployment-runbook.md
M docs/google-maps-test-report.md
M docs/google-places-migration-report.md
M docs/items-price-list.md
M docs/local-addons-storage-fix.md
M docs/maintenance-calendar-overhaul.md
M docs/maintenance-form-refinement.md
M docs/quickbooks-v3-setup.md
M docs/settings-explicit-save.md
M docs/site-coordinate-backfill.md
A docs/sqlite-only-runtime-report.md
M docs/user-ui-preferences.md
M docs/workspace-branding-report.md
M docs/workspace-sqlite-migration-checklist.md
M docs/xero-v1-setup.md
M output/invoice-delete-report.md
M output/service-board-job-notes-report.md
M output/service-board-performance-report.md
M README.md
M scripts/backfill-site-coordinates.mjs
M scripts/backup-fly-data.mjs
M scripts/backup-workspace-sqlite.mjs
M scripts/benchmark-service-board.mjs
M scripts/generate-demo-data.mjs
M scripts/migrate-workspace.mjs
A scripts/runtime-backup.mjs
M server-accounting-routes.js
M server-accounting-webhooks.js
M server-accounting-workspace.js
M server-addon-routes.js
M server-app.js
M server-auth.js
M server-customer-routes.js
M server-document-routes.js
M server-inventory-routes.js
D server-invoice-archive.js
M server-job-costing-routes.js
M server-job-routes.js
M server-maintenance-routes.js
M server-price-list-routes.js
M server-quickbooks-webhooks.js
M server-servicem8-import-routes.js
M server-settings-routes.js
M server-staff-routes.js
M server-store.js
M server-user-preferences-routes.js
M server-user-ui-preferences.js
M server-workspace-backup.js
M server-workspace-documents.js
A server-workspace-financials.js
M server-workspace-importer.js
M server-workspace-inventory.js
M server-workspace-logo-routes.js
M server-workspace-maintenance.js
M server-workspace-restore-routes.js
M server-workspace-restore.js
M server-workspace-storage.js
A server-workspace-summary.js
M server-xero-webhooks.js
M src/App.jsx
M src/components/app/WorkspaceShell.jsx
M src/components/customers/CustomerAccount.jsx
M src/components/customers/CustomerPages.jsx
M src/components/customers/CustomerWorkspace.jsx
M src/components/settings/AddonsSettings.jsx
M src/components/settings/SettingsManager.jsx
M src/hooks/useAppSession.js
M src/hooks/useCustomerAccount.js
M src/hooks/useSettingsPersistence.js
M src/hooks/useWorkspaceActions.js
D src/hooks/workspace-autosave.js
M src/hooks/workspace-customer-api.js
M src/lib/app-support-config.js
M src/lib/app-support.jsx
M src/lib/invoice-account.js
M tests/accounting-inbox-worker.test.js
M tests/backfill-site-coordinates.test.js
M tests/create-local-admin.test.js
M tests/customer-account.test.js
M tests/customer-routes.test.js
M tests/document-routes.test.js
M tests/e2e/calendar-scheduling.spec.mjs
M tests/e2e/customer-account.spec.mjs
M tests/e2e/customer-sqlite-workflow.spec.mjs
M tests/e2e/customer-workspaces.spec.mjs
M tests/e2e/document-workspaces.spec.mjs
M tests/e2e/google-maps-test.spec.mjs
M tests/e2e/google-places.spec.mjs
M tests/e2e/invoice-job-status-filter.spec.mjs
M tests/e2e/job-costing.spec.mjs
M tests/e2e/maintenance-calendar.spec.mjs
M tests/e2e/mobile-navigation-service-board.spec.mjs
M tests/e2e/public-legal-pages.spec.mjs
M tests/e2e/quickbooks-integration.spec.mjs
M tests/e2e/service-board-controls.spec.mjs
M tests/e2e/site-navigation.spec.mjs
M tests/e2e/theme-settings.spec.mjs
M tests/e2e/xero-integration.spec.mjs
M tests/inventory-routes.test.js
M tests/invoice-deletion.test.js
M tests/job-costing.test.js
M tests/job-routes.test.js
M tests/maintenance-plan-form.test.js
M tests/maintenance-routes.test.js
M tests/price-list.test.js
M tests/quickbooks-accounting.test.js
M tests/quickbooks-webhooks.test.js
A tests/runtime-backup.test.js
M tests/servicem8-import-routes.test.js
M tests/settings-routes.test.js
A tests/sqlite-only-runtime.test.js
M tests/staff-routes.test.js
M tests/user-ui-preferences.test.js
M tests/workspace-autosave-audit.test.js
M tests/workspace-customer-api.test.js
M tests/workspace-logo.test.js
M tests/workspace-migration.test.js
M tests/workspace-restore-routes.test.js
M tests/workspace-schema-upgrade.test.js
M tests/xero-accounting.test.js
M tests/xero-payments.test.js
```
