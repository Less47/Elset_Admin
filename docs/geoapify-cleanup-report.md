# Geoapify / Leaflet cleanup

14 September 2026. Local cleanup on the existing `main` working tree. No commit, push, deployment, Fly secret changes, production data access or data migration was performed. Earlier uncommitted Site-coordinate work and the user's `.dockerignore` change were preserved.

## Removed runtime code

`/map` now has a single Google renderer. Removed the lazy legacy import and renderer selection from `WorkspaceShell`, the variant prop in `App`, and legacy/test map variant handling in `useWorkspaceNavigation`.

Removed `/map/legacy` and `/map/google-test`, including the latter's redirect. These URLs no longer resolve to a map; they use the existing Service Board fallback. Unknown map subpaths cannot restore a map through old browser history state. `/map` remains canonical, including normalization of `/map/` and existing root history entries for the Map section. Record navigation and Back continue using the existing navigator.

Deleted `src/components/map/JobsMapManager.jsx`, which contained Leaflet initialization, tiles, DOM marker icons, same-address offsets, popups/tooltips, viewport management and provider requests. There was no separate legacy clustering package. Google clustering remains unchanged.

Deleted `src/components/shared/AddressAutocompleteInput.jsx`. Its last active consumer was the direct address editor in `JobDetailsPage`. That editor now uses the existing shared `GoogleAddressAutocompleteInput`, waits for Places Details before enabling Save, and retains manual entry when the key or service is unavailable. It keeps its existing Job-only address update behavior; editing a Job does not rewrite a shared Site or its coordinates. Customer/Site and embedded Create Job pickers were already using Google and were preserved.

Removed Leaflet-only selectors from `src/index.css`. Shared map filters, floating controls, workspace sizing and Google-specific CSS were preserved. The Leaflet stylesheet and its packaged icon assets disappear with the package. The public asset inventory contained no separate Leaflet icons to delete.

## Server endpoints and configuration

Removed these handlers from `server-app.js`:

| Endpoint | Retired responsibility |
| --- | --- |
| `GET /api/address/autocomplete` | Geoapify suggestion proxy and configuration warning |
| `GET /api/map/config` | Geoapify tile URLs, attribution and tile configuration |
| `POST /api/map/geocode` | Geoapify address geocoding and runtime cache |

Repository tracing confirmed that `/api/map/config` had not been repurposed for Google. All three endpoints now return 404. Removed their URL builders, response adapter, constants, environment readers, startup warnings and process-local cache.

`GET /api/map/locations` remains unchanged: it reads authorized saved Site coordinates. Google Maps/Places loading, Google configuration messages, build-key forwarding, Dockerfile, `fly.toml`, and the separate Site audit/backfill tool are unchanged. Existing email configuration warnings remain.

## Packages

After source deletion, the repository contained no remaining Leaflet import or `require` call. Ran:

```text
npm uninstall leaflet --no-audit --no-fund
```

Only `leaflet` 1.9.4 was removed from `package.json` and `package-lock.json`. `react-leaflet` and Geoapify SDK packages were not installed. `npm ls leaflet react-leaflet --all` reports an empty tree. Google loader and marker-clusterer dependencies were preserved.

## Environment variables that can be retired

After this cleanup is deployed, these previously read variables are no longer required and can be removed from Fly secrets/environment configuration if present:

- `GEOAPIFY_API_KEY`
- `GEOAPIFY_MAPS_API_KEY`
- `GEOAPIFY_COUNTRY_CODE`
- `GEOAPIFY_MAP_STYLE`
- `GEOAPIFY_AUTOCOMPLETE_LIMIT`

`VITE_GEOAPIFY_API_KEY` is also unused and can be removed if present; the audited repository did not read or define it. No Fly secret inventory was queried or modified. The local `.env.local` contains no Geoapify variable names and was left unchanged.

Keep `VITE_GOOGLE_MAPS_API_KEY`. The optional separate `GOOGLE_GEOCODING_API_KEY` used by an explicitly applied Site backfill is unrelated to the retired provider. Current README, `.env.example` and Fly runbook instructions now describe Google configuration only.

## Audit classification and remaining references

The audit covered source, routes, tests, package files, Docker/Fly configuration, current documentation and local environment variable names without displaying values.

| Original match category | Disposition |
| --- | --- |
| Active Geoapify code | Removed server handlers/helpers/configuration and old autocomplete component. |
| Active Leaflet code | Removed renderer, imports, package and provider-specific CSS/assets. |
| Obsolete fallback | Removed both migration routes, renderer variants and old history translation. |
| Documentation/test references | Current setup docs updated; historical reports clearly marked; provider-specific tests retired or converted to Google. |
| Generic coordinate/address code | Preserved Site coordinates, aliases, normalization, formatting, saved-Site resolution, navigation and shared filters. |

Post-cleanup case-insensitive searches for `geoapify`, `GEOAPIFY`, `leaflet`, `react-leaflet`, provider URLs and retired endpoint/routes found **no active implementation**. The production `dist` assets contain none of these provider names or retired route/endpoint strings.

Remaining matches are intentional:

- This report records what was removed and the obsolete environment variable names.
- Eight historical reports retain their original audit/results as history, with a notice linking here: `google-address-route-fix-report.md`, `google-map-promotion-report.md`, `google-maps-parity-report.md`, `google-maps-test-report.md`, `google-places-migration-report.md`, `site-location-audit-report.md`, `site-navigation-report.md`, and `theme-system-report.md`.
- `tests/e2e/google-maps-test.spec.mjs` checks that the removed renderer/library is not requested and the retired routes cannot render a map.
- `tests/e2e/google-places.spec.mjs` traps any obsolete autocomplete request and requires zero calls. It no longer supplies the obsolete configuration warning.
- `tests/workspace-navigation.test.js` rejects retired/unknown map subroutes, including old history state.
- `tests/workspace-schema-upgrade.test.js` uses its isolated server smoke test to confirm retired endpoints return 404 and startup emits no provider warnings.

The broad case-insensitive `L.` search also matches ordinary identifiers and prose, such as `URL.`, `AbortSignal.`, `email.`, `panel.` and `Intl.`. There are no active `L.*` Leaflet calls. The only remaining literal `L.` API reference is historical documentation. Per-line classifications are retained locally under ignored `test-results/geoapify-cleanup/`: `before-classified.json`, `remaining-references.json`, and `generic-l-references.json`.

## Coordinate/data preservation

No production/customer/Site/Job data was modified. No database migration, coordinate rename, coordinate deletion, geocoding or backfill was run. Existing provider-independent `latitude` / `longitude`, `lat` / `lon`, `lat` / `lng` and supported nested `location` aliases continue to use the same shared normalization.

The task-start SHA-256 comparison confirms unchanged local `data/app-data.json`, `.env.local`, coordinate/persistence helpers, saved-Site endpoint, navigation utility, backfill tools, and Google map/Places components and styles. It also confirms the original `.dockerignore` edit and Google deployment configuration were preserved. Only `JobDetailsPage` changed among address forms.

## Verification

- `npm test`: **344/344 passed**, zero skipped. Covers saved/legacy/numeric-string coordinates, invalid/missing values, explicit Site ownership, shared Sites, multi-site customers, persistence, navigation and retired API endpoints.
- `npm run lint`: passed.
- `npm run build`: passed; existing chunk-size advisory remains. No Leaflet output chunk is produced; the Google stylesheet is unchanged.
- `git diff --check`: passed.
- **32 focused browser checks passed across the final selected cases.** Real Google Maps checks cover the built application at `/map`, correct linked Sites, grouping/clustering (including 240 jobs), record navigation/Back, filters, mobile/dark overlays, and retired URLs. Address checks cover Customer/Site persistence, manual fallback, both embedded creation paths and the migrated Job Details editor. The Job Details checks confirm no Site records or coordinates change. The updated mobile theme/autocomplete check also passed.
- Browser run detail: the first 31-case run passed 30 cases and timed out scrolling to a filter option for a pointer click. The filter matrix was changed to use keyboard selection, retaining every filter/count assertion, and its focused rerun passed. Google product code was not changed for this test. The independent mobile theme check passed 1/1.

The browser suite used local fixture databases/API responses, mocked Places selections and live Google map rendering at the permitted local referrer. It did not use production records or modify production. No live server-side geocoding request was made.

Commands for the main browser selection used `ELSET_GOOGLE_MAPS_LIVE_TEST=1`, `ELSET_GOOGLE_MAPS_TEST_URL=http://localhost:5173`, `ELSET_NAVIGATION_TEST_URL=http://localhost:5173` and `ELSET_GOOGLE_PLACES_LIVE_TEST=1`:

```text
npx playwright test tests/e2e/google-maps-test.spec.mjs tests/e2e/google-places.spec.mjs tests/e2e/site-navigation.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep "Job Details address editor|retired map route|Create Customer saves|Create/Edit Site|Google unavailable|active address route|missing Google key|embedded Customer|saved Places fixture|explicitly linked|live Google renders|record coverage|live dense clusters|live primary route|live production build|midnight-signal overlays|live cluster panel|Job Details navigation and keyboard"
npx playwright test tests/e2e/google-maps-test.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep "record coverage" --output=test-results/geoapify-cleanup/filter-check
npx playwright test tests/e2e/theme-settings.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep "semantic mobile fields, autocomplete"
```

## Files changed in this cleanup

30 files: 27 existing files modified, two deleted, and this new report. Earlier uncommitted changes outside this cleanup remain in the working tree.

- Runtime: `server-app.js`, `src/App.jsx`, `src/components/app/WorkspaceShell.jsx`, `src/components/jobs/JobDetailsPage.jsx`, `src/hooks/useWorkspaceNavigation.js`, `src/index.css`.
- Deleted: `src/components/map/JobsMapManager.jsx`, `src/components/shared/AddressAutocompleteInput.jsx`.
- Dependencies/setup: `package.json`, `package-lock.json`, `.env.example`, `README.md`, `docs/fly-sqlite-deployment-runbook.md`.
- Tests: `tests/e2e/google-maps-test.spec.mjs`, `tests/e2e/google-places.spec.mjs`, `tests/e2e/mobile-navigation-service-board.spec.mjs`, `tests/e2e/theme-settings.spec.mjs`, `tests/map-locations-routes.test.js`, `tests/page-workspace-architecture.test.js`, `tests/workspace-navigation.test.js`, `tests/workspace-schema-upgrade.test.js`.
- Historical-report notices: the eight report filenames listed above.
- New: `docs/geoapify-cleanup-report.md`.

The detailed file-preservation comparison is in ignored `test-results/geoapify-cleanup/diff-audit.json`.
