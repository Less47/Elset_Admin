# Local Add-ons disabled: storage audit and fix

Date: 17 September 2026. Scope: this local checkout only. No production connection, auth database copy, commit, merge, push or deployment.

## 1. Exact disabling condition

`src/components/settings/AddonsSettings.jsx` renders a native button with:

```jsx
disabled={!available || loading || saving}
```

`available` is `SettingsManager.isSqliteBackupMode`, calculated from `workspaceStorageMode === "sqlite"`. That mode comes from the authenticated `/api/app-state` response. Its backend and `/api/health` both call `getWorkspaceStorageMode()`.

| Input | Before fix | After fix |
| --- | --- | --- |
| Server workspace storage mode | `json`, directly observed on API and Vite proxy | `sqlite`, directly observed on both |
| SQLite database exists | `false` | `true` |
| `available` after workspace load | `false`, determined by the observed server mode and exact code expression | `true` after session reload |
| `!available` | **`true`: sufficient to disable both switches** | `false` after session reload |
| Browser `loading` | Not directly observed | Not directly observed |
| Browser `saving` | Not directly observed | Not directly observed |

The signed-in browser was not accessible through either browser surfaces or native Computer Use. Temporary authenticated local-only diagnostics were attempted, but no browser report arrived; they were removed. No unobserved loading/saving values or direct authenticated toggle results are claimed.

The switch's `disabled:cursor-not-allowed` class correctly reflects its actual HTML disabled state. No CSS or permission workaround was applied.

## 2. Environment difference

The local server had `data/app-data.json` and `data/auth.db`, but no `data/elset-workspace.db`. No root `.env` existed. Both `http://localhost:3101/api/health` and `http://localhost:5173/api/health` returned HTTP 200 with:

```json
{"ok":true,"storage":{"mode":"json","sqliteExists":false,"jsonExists":true,"jsonHasBusinessRecords":true}}
```

The existing Add-on PATCH API and Job Costing require SQLite. Legacy JSON GET returns default Add-on state; PATCH rejects it with HTTP 409. This restriction already exists on main. Production's reported working Add-ons are consistent with its SQLite deployment; no live production requests were made for this audit.

“Server sync enabled” is rendered solely from `isAuthenticated`. It does not mean SQLite is active and is not a read-only/remote-managed permission flag. Shared server JSON storage can show that label while lacking the SQLite dependency.

## 3. Branch comparison

After `git fetch origin`, all of these resolved to `6b687bd6998a055ddf803c8b7ea5f7588eb838f4`:

- `feature/xero-v1`
- local `main`
- `origin/main`
- their merge base

`git log feature/xero-v1..origin/main` and `git diff main...feature/xero-v1` were empty. The branch is not missing a committed main-branch toggle fix. Commit `3ef6637` already contains the corrected switch condition. Existing uncommitted Xero work was preserved.

## 4. Local auth and permissions

Read-only inspection of the local Better Auth database found one user:

- User ID: `ztiQyhZuJ9SGz6Iac3Zyl0r1pTpgieEh`
- Username: `admin`
- Auth role: `admin`
- Workspace role: `admin`
- Existing session records were preserved.

`useAppSession.canManageBusiness` is true for admin/office. That flag is passed as `canManageWorkspaceSettings`; Add-ons are rendered only for those users. PATCH independently requires admin/office. The stored local account passes this model. Its association is the deployment's single workspace, not a separate per-user workspace membership table.

No role changes, new users, password resets, token extraction, generated sessions or auth bypasses were used. Actual browser session restoration remains unverified.

## 5. API and process audit

- Public health: HTTP 200 through both frontend proxy and direct API, before and after migration.
- Unauthenticated GETs to `/api/auth/me`, `/api/app-state` and `/api/settings/addons`: HTTP 401 with an `error` payload, as expected.
- Authenticated API calls were not available without the user's browser session; no claims of observed 403/409/500 or pending requests are made for that session.
- Source contracts: auth returns `user`; workspace returns `{ok, storageMode, state}`; Add-ons returns `{ok, result}`. The Add-ons hook clears loading on both successful and failed loads, and clears saving in success/failure/finally paths.
- Vite on 5173 proxies `/api` to local port 3101. Its served AddonsSettings module contained the current disabled expression and Xero card. One Vite process and one watched API child were confirmed for this checkout; API restarts replaced that child normally.
- `dev-server.js` and Vite were restarted/reloaded through the existing watchers. No persistent source or environment change was needed.

## 6. Database root cause and minimal fix

This was an **unmigrated local workspace**, not a missing forward migration inside an existing SQLite database. Normal startup intentionally leaves a local JSON workspace in JSON mode when no SQLite database exists; it does not automatically import business data. The documented `npm run migrate:workspace` operation is required.

Applied steps:

1. Ran the existing migration with `--dry-run`: passed.
2. Stopped only the verified local API child to prevent writes during migration.
3. Ran the existing migration with explicit paths under this checkout's `data` directory.
4. Verified source and backup SHA-256 match, and source JSON remained unchanged.
5. Restarted the local API and refreshed Vite through their existing watchers.
6. Verified automatic storage detection now selects SQLite, schema 9, integrity `ok`, and zero foreign-key errors.

Backup: `data/backups/workspace-json-before-sqlite-2026-09-17T03-56-32-463Z/app-data.json`, with adjacent `.sha256` file.

Source/backup SHA-256: `764017d62172ad7a7dd0f4c948159d27e5e2eb8357801ea0934fd4fd552acf88`.

The migration preserved 54 Customers, 68 Sites, 54 Jobs, 26 Quotes, 13 Invoices, 18 send-history records and the archived invoice, together with the remaining workspace records. Its financial validation passed. Auth users/session count remained unchanged.

## 7. Files and verification

Changes attributable to this fix:

- New ignored local database: `data/elset-workspace.db` (plus runtime SQLite sidecars when open).
- New local migration backup and checksum under the path above.
- This report: `docs/local-addons-storage-fix.md`.
- Ignored evidence logs: `test-results/local-addons-migration-dry-run.log`, `test-results/local-addons-migration.log`, `test-results/local-addons-focused.log`.

No lasting application source, permission, CSS, registry or environment changes. Temporary diagnostics were removed. Existing uncommitted Xero implementation changes remain intact.

Verification:

- Migration dry run and actual migration passed all built-in count, relationship and financial checks.
- SQLite schema 9, `integrity_check=ok`, zero foreign-key errors.
- Source JSON unchanged; backup checksum verified.
- Direct/proxied health both HTTP 200 and SQLite after restart.
- `node --test tests/workspace-migration.test.js tests/workspace-schema-upgrade.test.js tests/job-costing.test.js`: **55 passed, 0 failed**.
- Authenticated local browser ON/OFF, refresh persistence and exact loading/saving flags: **not verified**. Open/reload local Settings → Add-ons while signed in to complete that check. The API still enforces normal authentication.
