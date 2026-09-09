# Authenticated personal UI preferences

Implementation and verification report, 9 September 2026. All verification used synthetic, isolated local data. No commit, push, merge, deployment, or manual production database operation was performed.

## 1. Existing architecture

The audit and classification were reported before implementation. `SettingsManager` had a shared Preferences tab (company, bank and email fields) and a UI Settings tab (11 colours, sidebar width and density). Both read `data.settings`, persisted in workspace SQLite `settings(key, value_json, updated_at)` or legacy `app-data.json`. `PATCH /api/settings` returned the authorized workspace; `/api/settings/reset` and document-template routes also operated on shared settings.

`useThemeSettingsSave` already provided immediate drafts, a single active save, 400 ms visual debounce and 600 ms company-text debounce. `useThemePalette` applied CSS variables to the app and document root. Customer/Site List/Grid and Service Board display choices were React state, without server persistence. Browser storage contained legacy workspace/migration data (`gateflow-demo-v1`), not a dedicated preference cache.

Better Auth uses a separate SQLite `auth.db` with opaque string user IDs, sessions and credential accounts. The app resolves `/api/auth/me` and loads `/api/app-state`. Authentication middleware obtains the Better Auth session and sets `req.user`; that existing path remains in use.

## 2. Settings classified as personal

| Existing control | Account preference |
| --- | --- |
| Page, sidebar, header, action, border, popup and data-view colours | All 11 existing colour fields |
| Sidebar width and content density | Existing supported choices |
| Customers and Sites List/Grid | One preference for each page |
| Service Board List/Grid/Compact | One preference for each status column |
| Service Board sort order | One preference for each status column |
| Show tag info and hidden board columns | Personal display choices |

These are the existing controls; no speculative settings were added. Every authenticated role can edit its own appearance. Technicians see only UI Settings within Settings; company, templates, backup and business actions retain their existing authorization.

## 3. Settings remaining workspace-global

The 14 shared fields remain `companyName`, `companyAbn`, `companyAcn`, `companyEmail`, `companyPhone`, `companyAddress`, `bankAccountName`, `bankBsb`, `bankAccountNumber`, `defaultSenderEmail`, `replyToEmail`, `quoteCcEmail`, `invoiceCcEmail`, and `emailSignature`. Quote/invoice templates and their existing configuration, business records, statuses, numbering and operational defaults remain shared. The company section now labels this explicitly; UI Settings labels account-specific appearance.

## 4. Database choice

Preferences live in a dedicated ELSET-owned table in the existing auth database, resolved with `ELSET_AUTH_DB_PATH` or `ELSET_DATA_DIR/auth.db`. This follows the authenticated account and works in both SQLite and legacy JSON workspace modes. Creating a workspace SQLite file solely for preferences could otherwise switch an existing JSON installation's storage mode. No Better Auth core columns, tables, triggers, foreign keys or `user_version` are changed.

The existing Fly data backup includes `auth.db` and its WAL/SHM files, so it includes these preferences. Workspace-only SQLite exports intentionally exclude auth data and therefore do not carry personal preferences. No backup/deployment script was run or changed.

## 5. Exact additive migration

`migrateUserPreferencesSchema` runs at app startup after existing auth readiness. It uses an immediate SQLite transaction and an ELSET-owned migration ledger:

```sql
CREATE TABLE IF NOT EXISTS elset_account_schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
);
-- If version 1 is absent:
CREATE TABLE IF NOT EXISTS user_ui_preferences (
  user_id TEXT PRIMARY KEY NOT NULL,
  preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO elset_account_schema_migrations (version, name, applied_at)
VALUES (1, 'user-ui-preferences', ?);
```

The timestamp is an ISO string. Repeated startup is idempotent. Existing auth rows, workspace schema/data and legacy appearance settings remain intact. Connections use WAL, a 5-second busy timeout and transactions for merges/upserts. The primary key ensures one record per account. The existing account management UI supports disabling accounts, without a safe ELSET deletion hook; externally deleted accounts can leave harmless orphan preference rows. No cross-table deletion mechanism was introduced.

## 6. Preference schema

The explicit flat schema has 23 fields. Its defaults are:

```json
{
  "pageBackgroundStart": "#0F90CD",
  "pageBackgroundEnd": "#0F90CD",
  "sidebarSurface": "#FFFFFF",
  "sidebarHeader": "#0F90CD",
  "sidebarActive": "#F69320",
  "heroSurface": "#0F90CD",
  "actionColor": "#F69320",
  "borderColor": "#1E293B",
  "dialogSurface": "#9FE4FB",
  "dataViewSurface": "#EAF7FB",
  "dataViewAccent": "#0F90CD",
  "sidebarWidth": "standard",
  "contentDensity": "comfortable",
  "customerView": "list",
  "siteView": "list",
  "boardToDoView": "list",
  "boardInProgressView": "list",
  "boardCompletedView": "list",
  "boardToDoSort": "recent",
  "boardInProgressSort": "recent",
  "boardCompletedSort": "recent",
  "boardShowTagLabels": false,
  "boardHiddenColumns": []
}
```

Colours accept `#RGB` or `#RRGGBB` and normalize to uppercase six-digit hex. Sidebar choices are icon-only/compact/standard/wide; density is compact/comfortable/spacious. Page views are list/grid; board views add compact. Board sorts are recent/oldest/urgency/customer/scheduled/value. Tag labels require a boolean; hidden columns accept only the three existing statuses, with duplicates removed. Unknown keys, nested arbitrary objects, invalid values, and prototype-pollution keys are rejected with 400.

## 7. API endpoints

`GET /api/user-preferences` returns `{ "ok": true, "preferences": { ... } }` for the current account. `PATCH /api/user-preferences` accepts a narrow flat patch such as `{ "actionColor": "#FF8800" }`, merges it transactionally with that account's stored values and returns normalized preferences. Responses use `Cache-Control: private, no-store`. Neither operation returns/replaces app state. Existing records require only a small auth-database read/write; initial fallback reads only appearance rows from workspace SQLite, or the existing legacy JSON file when in JSON mode.

## 8. Secure identity

Both routes require the existing session authentication middleware and use only `req.user.id`. The router refuses initialization without that middleware. There is no target-user route parameter. Query parameters and body `userId` fields are rejected. Unauthenticated calls return 401; technicians' company-setting writes still return 403. No ID, ownership or permission setting is included in the personal schema.

## 9. Defaults and initial loading

An existing personal record wins. Accounts without a row receive the current legacy appearance, normalized against safe ELSET defaults; GET creates no row. The first update snapshots the full effective personal schema, and subsequent patches merge only changed keys. Missing/invalid fallback values use safe defaults. A failed load leaves the app usable with fallback appearance and compact retry feedback.

Logged-out screens use safe defaults and make no preference request. Auth identity changes create a new preference store, abort old requests, discard pending old-account saves and reset appearance before paint. The authenticated workspace waits for its preference load; a load failure releases it with fallback and retry. CSS variables now apply in a layout effect to avoid painting a previous account's theme.

## 10. Legacy transition

Global appearance values remain as a migration fallback. `PATCH /api/settings` rejects personal keys, including mixed company/appearance patches; the old global UI reset rejects requests. Legacy broad JSON workspace saves preserve existing appearance fields. Personal controls always use the new endpoint, including in JSON mode. Explicit business backup/import behavior remains intact. Reset UI Settings resets this account's 13 appearance values, leaving page/board choices under their existing controls.

## 11. Save strategy

The app-level personal store updates visible drafts immediately and coalesces controls for 400 ms. There is at most one active preference write; newer keys/values wait for it and latest selections win. Local overrides protect active choices from stale acknowledgements. Navigating between sections does not cancel saves; signing out cancels pending work. Failures retain the local appearance, expose compact feedback and support retry. The separate company-text queue retains its 600 ms debounce and caret-safe drafts. No localStorage/sessionStorage preference persistence was introduced.

## 12. Cross-account isolation results

Automated real Better Auth browser sessions ran concurrently: A selected orange and compact density; B selected blue and retained comfortable density. Refresh preserved both choices. Customer/Site views and board layout, sorting, hidden columns and tag labels were also isolated. A sign-out/pending-save test delayed B's preference load and verified default appearance while waiting, followed by B's own colour, without A leaking into B.

The requested separate manual browser interaction remains unverified: the computer-use inventory exposed no browser, and opening Chrome or the in-app browser returned `Browser is not available`. Automated independent browser contexts and visual inspection of their saved screenshots were completed; these are not reported as a manual two-browser check.

## 13. Cross-device persistence results

A fresh independent browser context logged into A and loaded A's persisted appearance without shared browser storage. Both accounts retained their own settings after page refresh and an actual stop/start of the isolated app server. This verifies a new session's server persistence; physical second-computer testing was not available.

## 14. Shared-settings regression results

A changed the genuine shared company name; B reloaded and saw it while retaining B's blue appearance. Personal changes left the complete workspace snapshot unchanged. API tests also verify rejection of global UI writes/resets, unchanged jobs and authorization. Legacy JSON tests verify personal saves leave the file unchanged and broad business saves preserve global appearance while allowing shared company updates. Existing company typing/caret and document-template route checks passed.

## 15. Files changed

| Area | Files |
| --- | --- |
| Dedicated storage and API | `server-user-ui-preferences.js`, `server-user-preferences-routes.js`, `server-app.js` |
| Shared-setting transition guards | `server-settings-routes.js`, `server-store.js` |
| Schema and client state | `src/lib/user-ui-preferences.js`, `src/hooks/user-ui-preferences-store.js`, `src/hooks/useUserUiPreferences.js` |
| Theme and app integration | `src/App.jsx`, `src/hooks/useThemeSettingsSave.js`, `src/hooks/useThemePalette.js`, `src/hooks/useWorkspaceActions.js`, `src/hooks/useWorkspaceViewModel.js` |
| Existing preference controls and labels | `src/components/app/WorkspaceShell.jsx`, `src/components/settings/SettingsManager.jsx`, `src/components/customers/CustomerManager.jsx`, `src/components/sites/SiteManager.jsx`, `src/lib/app-support.jsx` |
| Tests | `tests/user-ui-preferences.test.js`, `tests/user-ui-preferences-store.test.js`, `tests/settings-routes.test.js`, `tests/e2e/theme-settings.spec.mjs`, `tests/e2e/mobile-navigation-service-board.spec.mjs` |
| Documentation | `docs/user-ui-preferences.md` |

## 16. Tests added

Seven storage/API/legacy tests and three client-store tests cover strict validation, additive migration, fallback, uniqueness, partial merge, account isolation, reopened database connections, spoofing/anonymous rejection, shared business settings, JSON compatibility, coalescing, one active write, stale responses, account teardown and retry. Seven browser scenarios add real-auth migration, concurrent accounts/fresh sessions/restart, sign-out isolation, page/board preferences, 20-selection stress, technician access and failed-load recovery. Existing theme tests now verify the targeted personal endpoint; existing shared-setting and technician-navigation expectations were updated to match the intended behavior.

## 17. Exact verification results

Run from the repository in PowerShell, with Node/Git on PATH:

```powershell
$env:PATH = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;' + $env:PATH
node --test tests/user-ui-preferences.test.js tests/user-ui-preferences-store.test.js tests/settings-routes.test.js
npm test
npm run lint
npm run build
npx playwright test tests/e2e/theme-settings.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
npx playwright test tests/e2e/mobile-navigation-service-board.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'mobile navigation and actions retain|desktop view retains three columns'
npx playwright test tests/e2e/theme-settings.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'migrate additively'
git diff --check
```

- Focused tests: 16 passed, 0 failed.
- Full unit suite: 199 passed, 0 failed.
- Theme browser suite: 22 passed, 0 failed, 0 skipped/flaky.
- Relevant mobile-permission/desktop-board regressions: 2 passed, 0 failed.
- Final migration startup recheck: 1 passed, 0 failed.
- Lint, production build and whitespace diff check passed. Vite still reports its large-chunk advisory; the build succeeds.
- Rapid-selection evidence: 20 selections, 1 narrow PATCH, final `#AA0013`, health 200 in 8 ms, one preference row, unchanged workspace, no server crash or SQLite lock error observed.

Logs and extracted browser results are in ignored `test-results/user-ui-preferences/`. Visual evidence is in `test-results/theme/personal-user-a-orange.png`, `personal-user-b-blue.png`, and `personal-technician-mobile.png`; stress evidence is `personal-stress-results.json`. The full repository E2E suite was not run; the complete affected theme suite and relevant navigation/board regressions were run.

## 18. Deliberately shared or transient settings

Company/email/bank/document/operational configuration stays shared because it controls business behavior and generated documents. Legacy global appearance remains solely for compatibility/fallback. Dormant legacy `showHeroMetrics`, `showSectionDescriptions` and `showHeroEyebrow` keys have no UI readers and were preserved without adding controls. Search, filters, focused records, fullscreen, open panels and the current mobile status remain transient session state. Job statuses, Tomorrow membership, permissions and record ownership are never personal UI preferences.
