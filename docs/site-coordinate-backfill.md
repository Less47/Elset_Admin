# One-time production Site coordinate backfill

## Status and scope

Implemented locally. No production database has been read, downloaded or modified for this implementation. No commit, push, deployment, snapshot or production backfill has been performed.

The authoritative Site addresses exist only in the live Fly SQLite workspace at **`/app/data/elset-workspace.db`**. Local fixture counts and earlier audit reports are not production counts. The current target count remains unknown until the operator runs `--dry-run` inside the deployed application Machine.

The workflow is: review local implementation → commit/deploy code when authorized → create and verify a Fly volume snapshot → SSH into the existing volume-backed Machine → dry-run → inspect aggregate results → execute. Production addresses stay inside Fly, apart from the address sent directly to Google's Geocoding API when executing. No export to the developer PC is needed.

## Data-model audit

| Item | Authoritative implementation |
| --- | --- |
| Site identity / customer | `sites.id` / `sites.customer_id` |
| Historical formatted address | `sites.address`, exposed as `Site.address` |
| Optional structured address | `streetAddress` / `addressLine1`, `suburb` / `city` / `locality`, `state`, `postcode` in `sites.extra_json` |
| Country | No dedicated column or current Places form field; optional historical `extra_json.country` is respected. This backfill targets Australia. |
| Canonical coordinates | `Site.latitude` and `Site.longitude`, persisted as `sites.extra_json.latitude` and `sites.extra_json.longitude` |
| Google place ID | Current Places conversion does not persist `placeId`; no dedicated column. Existing arbitrary metadata is retained, but this backfill does not add place IDs. |
| Legacy coordinates | `lat` with `lon` or `lng`, and nested `location` coordinate pairs; recognized by `readSavedPosition()` including numeric strings |
| Job relationship | Historically `jobs.customer_id` plus normalized `jobs.job_address` matches a unique Site belonging to that customer. Optional `siteId` / `site_id` metadata takes precedence when present. No dedicated Job Site foreign-key column. |
| Map resolution | `/api/map/locations` → `resolveJobSiteLocation()` → `readSavedPosition(site)`; the map uses saved Site coordinates and does not geocode historical address text automatically. |
| DB resolver | `getWorkspaceDbPath()` in `server-workspace-db.js`: `ELSET_WORKSPACE_DB_PATH`, otherwise `getWorkspaceDataDir()` plus `elset-workspace.db`. `fly.toml` sets `ELSET_DATA_DIR=/app/data` and mounts `elset_admin_data` there. |

Audited sources: `server-workspace-db.js`, `server-workspace-state.js`, `server-workspace-customers.js`, `src/lib/google-place-address.js`, `src/lib/site-location.js`, and `server-map-locations-routes.js`.

Historical Sites can have usable address text without saved coordinates. Re-selecting an address in Places supplies those coordinates; the backfill supplies the same canonical fields for existing Sites. Jobs with missing or ambiguous Site links can still remain unmapped afterward; this operation does not change those links.

## Safety and behavior

`scripts/backfill-site-coordinates.mjs` requires exactly one of `--dry-run` or `--execute`. There is no local database-path override.

Before either mode reads Sites, the entry point:

1. Resolves the DB with the application's normal resolver and prints `Resolved workspace DB: ...`.
2. Requires Linux, `FLY_APP_NAME=elset-admin`, and `FLY_MACHINE_ID`.
3. Requires the resolver to select `/app/data/elset-workspace.db`, the data directory to be `/app/data`, and storage to be SQLite (or the app's automatic existing-SQLite mode).
4. Checks the expected file exists, is a regular file, and resolves to the same physical path.
5. Opens it with `fileMustExist: true`, `migrate: false`, and first validates the existing application schema on a read-only connection. Missing, empty, incompatible or unknown databases are refused. It never initializes or migrates a schema.

Dry-run keeps the read-only connection and enables SQLite `query_only`. It reads actual committed Sites, including the live WAL, without Google calls or a Google key. It does not import JSON, create Sites, or fall back to a local database.

Execute requires `process.env.GOOGLE_GEOCODING_API_KEY`. It processes unique Site rows sequentially, with 250 ms between Sites. The default is all eligible Sites; optional `--limit 25` selects a smaller batch (accepted range 1–1000).

Valid existing canonical or legacy coordinate pairs are skipped. Numeric strings and negative latitudes are valid; latitude must be within -90…90 and longitude within -180…180. The app's explicit-cleared-canonical-pair precedence is preserved: stale aliases cannot revive a deliberately cleared pair.

The address builder prefers complete structured fields, then the existing formatted address, and includes Australia. Blank, obvious placeholder/malformed addresses and explicit non-Australian countries are skipped. It never saves Google's formatted address. Only one non-partial Australian `ROOFTOP` result with a street/premise/subpremise type and valid coordinates is accepted. Interpolated, approximate, multiple, partial and zero results require manual review. These checks use [Google's documented result fields](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding).

Transient network errors, HTTP 429/5xx, `OVER_QUERY_LIMIT` and `UNKNOWN_ERROR` get at most three total attempts, with 500 ms then 1000 ms backoff. Each request has a 15-second timeout. Permanent address failures continue to the next Site; permission/billing/daily-limit errors or exhausted transient retries stop the batch. Errors are reduced to allowlisted codes; raw provider messages, URLs, keys and addresses are never logged.

Each successful update uses SQLite `json_set` to change only `latitude` and `longitude`. It preserves IDs, address text, all other JSON values (including large numeric values), timestamps, Site history/assets and Jobs. An atomic conditional update checks the original Site ID, customer, address and metadata: a concurrent Site edit or deletion wins. No write lock is held during a Google request. Failed or ambiguous results make no writes. Completed Sites are skipped on subsequent runs.

Old `coordinateBackfill` failure markers, if present from the earlier helper, are preserved and counted under `heldForReview`; `--retry-failed` explicitly includes those Sites again. New runs do not write attempt markers. After fixing a provider error, rerunning execution can retry failed Sites, so inspect results before repeating calls.

## Google Cloud setup

Enable billing and **Geocoding API** in the Google Cloud project. Create a separate server-side API key, restrict its allowed API to Geocoding API, and store it as the Fly secret **`GOOGLE_GEOCODING_API_KEY`**. Server-side application restrictions must match the Machine's actual outbound IPs if IP restrictions are used; browser website/referrer restrictions are unsuitable. See [Google's setup guide](https://developers.google.com/maps/documentation/geocoding/guides-v3/get-api-key) and [key security guidance](https://developers.google.com/maps/api-security-best-practices).

Leave **`VITE_GOOGLE_MAPS_API_KEY`** unchanged for the existing Maps/Places UI and established deployment build. The backfill never reads it. Do not put the new secret in source, package scripts, Dockerfile, `fly.toml`, Git, command history or logs. Configure it through Fly's secret management; `fly secrets import --app elset-admin --stage` accepts `NAME=VALUE` via stdin for the subsequent planned deployment. Use a secure secret manager/input flow, not a literal key pasted into a recorded shell command. [Fly secrets import documentation](https://fly.io/docs/flyctl/secrets-import/).

## Operator procedure — after an authorized code deployment

Use the established deployment flow so the browser Maps build key and revision metadata remain correct. The Dockerfile already includes `scripts/`; no build-time, startup, or release-command backfill is added. A Fly release-command Machine does not have the application volume. [Fly volume availability](https://fly.io/docs/volumes/overview/).

### 1. Identify the existing production volume and take a snapshot

On the operator PC, these commands inspect infrastructure and snapshot the Fly volume; they do not download Site addresses:

```powershell
fly volumes list --app elset-admin
fly machine list --app elset-admin
```

Find the existing `elset_admin_data` volume attached to the serving application Machine. Substitute its actual volume and attached Machine IDs below; they are intentionally not guessed from old reports. If several volumes are present, select the authoritative serving Machine/volume before continuing.

```powershell
fly volumes snapshots create <VOLUME_ID> --app elset-admin
fly volumes snapshots list <VOLUME_ID> --app elset-admin
```

Wait until the new snapshot is listed with status `created`; record its ID. **Do not execute the backfill without this verified snapshot.** These are [Fly's snapshot commands](https://fly.io/docs/volumes/snapshots/).

### 2. SSH into that same existing Machine

```powershell
fly ssh console --app elset-admin --machine <MACHINE_ID>
```

`--machine` selects an existing Machine; do not launch a temporary console Machine with a new/empty volume. [Fly SSH documentation](https://fly.io/docs/flyctl/ssh-console/).

### 3. Run the dry-run inside Fly

In the remote Linux shell:

```sh
cd /app
node scripts/backfill-site-coordinates.mjs --dry-run
```

The first line must be:

```text
Resolved workspace DB: /app/data/elset-workspace.db
```

Inspect these aggregate fields:

| Field | Meaning |
| --- | --- |
| `totalSites` | Existing live production Sites |
| `alreadyLocated` | Valid coordinates; excluded from backfill |
| `noAddress` | Unmapped Sites without a usable Australian address |
| `invalidMetadata` | Sites with malformed metadata; untouched |
| `heldForReview` | Old failure markers held unless explicitly retried |
| `eligibleSites` | Sites needing geocoding in this run |
| `selectedSites` | Sites selected after applying an optional limit |
| `saved`, `failed`, `skippedChanged` | Execution outcomes (zero in dry-run) |
| `errors` | Aggregate allowlisted failure codes |
| `remainingEligible` | Eligible Sites not processed in this invocation, not a fresh post-run inventory |

The categories `alreadyLocated + noAddress + invalidMetadata + heldForReview + eligibleSites` equal `totalSites`. A zero or unexpected total is a reason to inspect the Machine/volume choice, not to create/import another database.

### 4. Execute after reviewing the dry-run

In the same remote shell, with the server secret available:

```sh
node scripts/backfill-site-coordinates.mjs --execute
node scripts/backfill-site-coordinates.mjs --dry-run
```

For a small first batch, use `--limit 25` on both the preview and execution. Successfully populated Sites will be skipped on later runs. On exit code 1, inspect aggregate `errors`, `invalidMetadata`, `skippedChanged` and `stopped`; resolve the cause before rerunning. Failed records are counted in `failed`, even when they need manual address review. A fatal database error suppresses its raw details and exits 1; prior successful per-Site writes remain committed and can be safely skipped on a later run.

Refresh the production map after completion. Jobs with successfully geocoded, uniquely linked Sites should now have positions. Remaining missing/ambiguous links or rejected addresses require separate manual review.

Do not perform workspace restores or overlapping bulk imports during the run: the application's restore lock is process-local and cannot coordinate an independent SSH process. Ordinary concurrent Site edits are protected by the conditional update described above.

## Local validation

Automated tests use synthetic temporary SQLite fixtures and mocked Google responses. No production Google calls or production data copies are used.

```powershell
node --test tests/backfill-site-coordinates.test.js tests/site-location-backfill.test.js tests/site-location-resolution.test.js tests/map-locations-routes.test.js
npm test
npm run lint
npm run build
git diff --check
```

Coverage includes valid/numeric-string/legacy coordinates, 20 Jobs sharing a Site, missing/invalid coordinates, malformed addresses and metadata, live WAL reads, no-create/no-migrate guards, sequential pacing and bounded retries, zero/ambiguous/provider failures, two-connection concurrent edits, retained metadata/history, privacy of logs and idempotency. The production CLI's Fly environment/filesystem checks are tested with synthetic inputs; actual deployed execution remains unverified until the authorized operator workflow above.

Observed implementation checks (Windows, Node 24.19.0):

- Focused command above: 27/27 passed.
- `npm test`: initially 356/357 passed; the existing `concurrent initializers apply the migration only once` schema-startup test hit `SQLITE_BUSY`.
- `node --test --test-name-pattern='concurrent initializers' tests/workspace-schema-upgrade.test.js`: 1/1 passed in isolation.
- `node --test --test-reporter=dot`: all 357 passed on the complete rerun.
- `npm run lint`, `npm run build`, `node --check scripts/backfill-site-coordinates.mjs`, `node --check server-site-location-tools.js`, and `git diff --check`: passed. The build reported its large-chunk advisory.

Changed files: this runbook; `scripts/backfill-site-coordinates.mjs`; `server-site-location-tools.js`; `tests/backfill-site-coordinates.test.js`; `tests/site-location-backfill.test.js`; and the earlier `docs/site-location-audit-report.md` (clarifies historical counts and links to this production workflow). No application schema, map UI, Job persistence, deployment configuration or browser key changes were made.
