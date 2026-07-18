# Elset Admin

<img src="public/elset-logo.png" alt="Elset logo" width="320" />

Elset Admin is a Vite + React service management app for tracking jobs, customers, sites, quotes, invoices, and payments.

## Run the app

Install dependencies:

```bash
npm install
```

Start the full dev stack:

```bash
npm run dev
```

That starts:

- the frontend dev server
- the local Express API used for login, session restore, and quote email endpoints

In development, open the app at `http://localhost:5173`.
The API stays on `http://localhost:3101` and no longer serves the app UI there.
If a stale Vite process from this repo is already holding `5173`, the frontend launcher will stop it and restart cleanly.

If you only want the frontend, run:

```bash
npm run dev:client
```

If you only want the API, run:

```bash
npm run server
```

The Vite dev server proxies `/api` requests to the port set in `ELSET_API_PORT`, which defaults to `http://localhost:3101`.
Keep the API on a different port from the frontend dev server, otherwise `/api` will proxy back into Vite and logins will fail.

If you want the backend to serve the built frontend instead of the dev server, run:

```bash
npm run build
npm run server
```

Then open `http://localhost:3101`.

## Environment Setup

Copy `.env.example` to `.env` and fill in the runtime values you need:

```bash
ELSET_API_PORT=3101
ELSET_FRONTEND_URL=http://localhost:5173
BETTER_AUTH_SECRET=replace-me-with-a-random-secret
BETTER_AUTH_URL=http://localhost:3101
GEOAPIFY_API_KEY=replace-me
# Optional: only needed if you want a separate Geoapify key for map tiles
GEOAPIFY_MAPS_API_KEY=
GEOAPIFY_COUNTRY_CODE=au
GEOAPIFY_MAP_STYLE=osm-bright
GEOAPIFY_AUTOCOMPLETE_LIMIT=6
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=replace-me
EMAIL_FROM=admin@elset.com.au
```

`GEOAPIFY_API_KEY` enables address autocomplete and map geocoding.
`GEOAPIFY_MAPS_API_KEY` is optional because the server falls back to `GEOAPIFY_API_KEY` for map tiles.
`EMAIL_FROM` must use a domain you have verified in Resend, so `admin@elset.com.au` will work once `elset.com.au` is verified in your Resend account.

## Live Data Backups

The Fly app stores live workspace data on the `elset_admin_data` volume mounted at `/app/data`.

Create a local raw backup from Fly:

```bash
npm run backup:fly
```

That downloads `app-data.json`, `auth.db`, `auth.db-wal`, and `auth.db-shm` into `backups/`, then creates a `.tar.gz` archive with a SHA-256 checksum. The `backups/` folder is ignored by git.

## Workspace Storage

Runtime workspace data must not be committed to Git. The live JSON workspace, SQLite databases, uploaded files, generated documents, temporary PDFs, and backups are ignored by `.gitignore` and excluded from Docker builds by `.dockerignore`.

Current runtime paths:

- Legacy workspace JSON: `ELSET_DATA_DIR/app-data.json`
- New workspace SQLite database: `ELSET_DATA_DIR/elset-workspace.db`
- Better Auth database: `ELSET_DATA_DIR/auth.db`

On Fly, `ELSET_DATA_DIR` resolves to `/app/data`, which is the persistent volume. Locally, it defaults to `./data`.

The committed development fixture is synthetic only:

```bash
fixtures/demo-workspace.json
```

Application startup must not treat that fixture as live business data. Copy it into a temporary `ELSET_DATA_DIR` only for tests or demos.

## SQLite Workspace Migration

Dry-run a migration without writing a database:

```bash
npm run migrate:workspace -- --dry-run
```

Dry-run a specific JSON file:

```bash
npm run migrate:workspace -- --dry-run --source fixtures/demo-workspace.json
```

Run a local migration:

```bash
npm run migrate:workspace
```

The migration command:

- reads `ELSET_DATA_DIR/app-data.json` unless `--source` is provided
- creates `ELSET_DATA_DIR/elset-workspace.db` unless `--db` is provided
- creates a timestamped JSON backup under `ELSET_DATA_DIR/backups/`
- leaves the original JSON file untouched
- refuses malformed JSON
- refuses duplicate imports into a non-empty workspace database
- validates record counts, relationships, quote totals, invoice totals, payments, and outstanding balances
- never connects to Fly.io by itself

For local test restores, use a temporary directory:

```bash
mkdir -p /tmp/elset-restore-test
cp fixtures/demo-workspace.json /tmp/elset-restore-test/app-data.json
ELSET_DATA_DIR=/tmp/elset-restore-test npm run migrate:workspace
ELSET_DATA_DIR=/tmp/elset-restore-test npm test
```

Do not restore over the active production data directory until the backup has been validated separately.

Create a local SQLite workspace backup:

```bash
npm run backup:workspace
```

Include the Better Auth database when appropriate:

```bash
npm run backup:workspace -- --include-auth
```

Include externally stored runtime files such as uploads and generated documents:

```bash
npm run backup:workspace -- --include-files
```

The backup command uses SQLite's backup API, writes checksums, records schema/version metadata, validates foreign keys, and prints a small count summary. It does not connect to Fly.io.

When the app is running in SQLite mode, the Settings > Data Backup screen downloads an uploadable JSON bundle that contains only the workspace SQLite database plus metadata and checksums. It does not include Better Auth login accounts, sessions, SMTP credentials, API keys, OAuth tokens, or environment variables.

Restore a SQLite workspace backup from the Settings > Data Backup screen only after testing the file somewhere safe. The SQLite restore path:

- accepts only `elset-workspace-sqlite-backup-v1` workspace backup bundles
- validates metadata, SHA-256 checksums, SQLite integrity, schema version, required tables, foreign keys, record counts, and financial totals before replacing data
- rejects backups with authentication tables or unexpected embedded files
- creates a verified pre-restore backup under `ELSET_DATA_DIR/backups/pre-restore-workspace-sqlite-*`
- blocks workspace writes while the restore is running
- replaces the workspace database as a complete snapshot, then reloads the app state
- removes stale SQLite WAL/SHM/journal files during the swap
- rolls back to the pre-restore database if replacement or verification fails

The legacy JSON restore path remains available only when `ELSET_WORKSPACE_STORAGE=json` is active. SQLite restore never overwrites `auth.db` or secrets.

## SQLite Rollout And Rollback

The old JSON-backed store remains available temporarily as a rollback mode.

Storage mode rules:

- `ELSET_WORKSPACE_STORAGE=json` uses the legacy JSON store.
- `ELSET_WORKSPACE_STORAGE=sqlite` uses `elset-workspace.db`.
- If no mode is set and `elset-workspace.db` exists, the server reads from SQLite.
- If no mode is set in production and a non-empty `app-data.json` exists without `elset-workspace.db`, the server refuses to start with a migration-required message.

This prevents the app from silently starting with an empty SQLite database over an existing JSON workspace.

Rollback after a failed SQLite validation:

```bash
ELSET_WORKSPACE_STORAGE=json npm run server
```

Keep the original `app-data.json` until the SQLite migration has been validated and signed off.

## Git History Cleanup

This repo previously tracked runtime files. This change removes them from future Git tracking only; it does not rewrite history.

If customer data or generated PDFs were committed in earlier history, remove them only with a deliberate manual history-cleanup process after making verified backups and coordinating with anyone who has cloned the repo. A typical tool is `git filter-repo`, followed by force-pushing rewritten branches and rotating any exposed secrets. Do not run history rewriting casually.

When the API is running, quote sends:

- generate a PDF attachment from the current quote template
- send the email directly from the backend through Resend SMTP
- record send history against the quote in the app state

## Fly.io Deployment

Do not rely on a local `.env` file being present inside the Fly machine. Set production config as Fly secrets and environment variables instead.

Required secret for the jobs map:

```bash
flyctl secrets set GEOAPIFY_API_KEY=replace-me -a elset-admin
```

Optional if you want a separate Geoapify tiles key:

```bash
flyctl secrets set GEOAPIFY_MAPS_API_KEY=replace-me -a elset-admin
```

Typical production secrets:

```bash
flyctl secrets set BETTER_AUTH_SECRET=replace-me SMTP_HOST=smtp.resend.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=resend SMTP_PASS=replace-me EMAIL_FROM=admin@elset.com.au -a elset-admin
```

After updating secrets, deploy again or restart the machine:

```bash
flyctl deploy -a elset-admin
```

You can confirm what Fly has configured with:

```bash
flyctl secrets list -a elset-admin
```

## Quote Template Editing

The sidebar includes a `Quote Template` section where admin users can edit:

- company details shown on the PDF
- heading text and branding color
- intro, terms, and footer content
- placeholder-based text such as `{{customerName}}`, `{{jobTitle}}`, and `{{total}}`

Template changes are stored in the app state and are used the next time a quote PDF is sent.

The PDF preview in the template editor is generated by the backend from the same code-driven PDF renderer used when quotes are emailed.
