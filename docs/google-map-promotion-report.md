# Primary Map route promotion

Branch: `feature/google-maps-test`. Local transition on 14 September 2026. No commit, push, merge or deployment.

## 1. Previous route structure

The pre-edit audit found `/map` rendering `JobsMapManager` with Geoapify/Leaflet, and `/map/google-test` rendering the development-only, lazy-loaded `GoogleMapsTest`. The normal sidebar Map action selected the Map section at `/` through browser history state. `WorkspaceShell` supplied the same full-workspace layout to both renderers, while origin metadata retained the correct map behind an open job/site page.

The Google component, its configuration messages and its coordinate reader assumed development/test use. The prior reader was `GET /api/dev/map-locations`, protected by existing admin/office authentication and a development environment gate. Existing Leaflet-specific browser tests reached the old renderer through the normal sidebar.

These findings and the existing coordinate-cache limitation were reported before editing.

## 2. Final route structure

| Destination | Behavior |
| --- | --- |
| `/map` | Primary Google map |
| `/map/legacy` | Temporary Geoapify/Leaflet fallback |
| `/map/google-test` | Replaces the URL with `/map` |
| `/map/google-test/` | Same redirect; query string and hash preserved |
| Old `/` history entry with section `map` | Normalized to `/map` |

The former test path redirects inside the existing browser-history router using `replaceState`, without adding a second Google destination to history. Ordinary route refreshes use the application's existing SPA serving behavior. The route switch applies to development and the built frontend; no deployment was performed.

## 3. Primary Google implementation

`GoogleJobsMap.jsx` is the promoted, renamed component. `/map` mounts it through a lazy import in `WorkspaceShell`. The previous development-only render gate is removed. The primary page does not mount the Leaflet component or call its tile-config/geocode endpoints. Each renderer and its CSS now has its own build output.

The ELSET dataset, coordinate validation, search predicates, filter choices, marker reconciliation/clustering, grouped job details, selection behavior and fitting behavior remain as implemented before promotion. The component's visible test/provider labels have been removed: normal chrome says Map and shows job/mapped counts. Google attribution and branding remain untouched. Errors may identify Google when configuration/load troubleshooting requires it.

## 4. Legacy fallback

`/map/legacy` renders the existing `JobsMapManager.jsx`. Its source is unchanged from the start of this promotion. Existing Geoapify tile/geocode handlers, address autocomplete, common map styles, site helpers, storage and Fly configuration remain unchanged. No Leaflet or Geoapify dependency was removed.

The fallback is hidden from ordinary navigation. Developers can open its URL manually. Google failure does not silently select the fallback.

## 5. Retired test route

The test component/file name is retired in favor of `GoogleJobsMap`; the old test URL is retained solely as a redirect to `/map`. History metadata containing the older `google-test` or `geoapify` variant names is translated to the current Google/legacy names so record navigation remains compatible.

## 6. Sidebar and record navigation

The sidebar retains exactly one Map entry, opening `/map`. No Google Map, Geoapify Map or Legacy Map item was added. Mobile navigation uses that same existing section action.

Open Job and Open Site continue using the existing record navigator. Browser Back returns to `/map`; originating legacy records return to `/map/legacy`. The Google map's DOM instance is retained behind record pages, and tests check that its root is the same after returning. The active filter is retained. Unsaved-change blocking and other record routes continue using their existing navigation flow.

## 7. Search and filter regressions

Search and the shared All Jobs, Incomplete, Urgent, Completed, site type and customer type filters remain unchanged. Browser tests now run those checks at `/map` and compare against `/map/legacy`.

The same 12-job fixture produces matching eligible record counts for all 12 comparison states: default 11/11, completed 4/4, incomplete 7/7, urgent 6/6, plus matching job-number, customer, address, title, site-type, customer-type, Not set and unresolved-address searches/filters. Counts represent jobs, not the number of rendered Google groups. Test fixtures are isolated browser responses and do not write local business records.

## 8. Markers, clustering and viewport

The marker manager, coordinate/grouping helpers and shared filter module are unchanged from the promotion baseline. Clusters still count every job, same-location records share a marker with a complete scrollable job list, and marker instances survive filtering. A dense fixture covers 240 jobs at 12 locations, narrowing to 80 completed jobs.

The existing Melbourne fallback, filtered fitting, cluster expansion and viewport retention remain. The tests exercise cluster selection, all grouped jobs, zoom controls, touch panning, filtering and record navigation. Single map/loader checks and the separate renderer chunks guard against loading both engines for the primary route.

## 9. Mobile, tablet and controls

The edge-to-edge workspace and existing map CSS rules remain unchanged. Tests cover 390x844 mobile, 820x1180 and 1024x768 tablet, and 1440x900 desktop. Mobile uses the existing search/filter fields and Reset/Done sheet pattern; details remain scrollable with no horizontal overflow. Touch panning and tapping Google's zoom controls are exercised; pinch zoom is not separately automated.

Google's zoom controls remain enabled. Fullscreen, Street View and map-type controls remain disabled, as in the prior implementation. ELSET overlays retain clearance above zoom controls and bottom attribution. Visual review found that the original modal mobile filter sheet covered those controls while open. Google now opts into a nonmodal sheet positioned above the reserved bottom area, with dropdowns opening upward. There is no dimming overlay over Google attribution. The shared sheet's defaults preserve its existing behavior for Leaflet and other pages. Screenshot checks assert details/status separation, filter-sheet clearance and that Google's zoom button remains unobstructed. Google attribution/logo/legal text are not hidden or altered.

## 10. Themes, loading and configuration

The primary-route matrix covers Elset Classic, Evergreen Ledger and Midnight Signal, including desktop controls, mobile filters and job details. Preset surface colors and dark/light mode are asserted through the real ELSET preference application. Google base tiles keep their existing standard appearance.

The component retains compact loading, network failure, authentication rejection and missing-key messages. Normal loading text says Loading map. Missing configuration does not initialize Leaflet.

`VITE_GOOGLE_MAPS_API_KEY` remains the only Google browser-key variable. `.env.local` is ignored, no key is hardcoded in source or logged, and no credentials were changed. Because Google is now part of the built application, Vite embeds the configured browser key in its lazy Google build file. This is expected browser-key delivery; the earlier POC assertion that production assets contain no Google key no longer applies. `.env.example` documents build-time configuration and allowed site referrers. No Places, Google Geocoding, Routes or Directions service was added.

The existing coordinate reader is promoted to authenticated **GET `/api/map/locations`** so the built route can use it. It keeps the same authorized-workspace job selection, cache-only lookup, validation, no-store response and existing admin/office role checks. The retired development endpoint is removed. This is promotion of the existing read path, not a new geocoder or data store.

**Known data limitation:** the local file still contains 53 jobs and 67 sites with no saved coordinate pairs. The reader can reuse existing Geoapify runtime-cache results, but cannot create them. A cold backend cache therefore leaves address-only jobs visibly unmapped. For comparison, load `/map/legacy` and let its normal address resolution finish, then return to `/map` and refresh coordinates. Server restarts clear this cache. Promotion does not establish real-record pin parity or resolve the coordinate-persistence issue from the previous stage.

## 11. Files changed in this promotion

| File | Change |
| --- | --- |
| `src/hooks/useWorkspaceNavigation.js` | Primary/legacy paths, retired-path normalization, sidebar destination, old history variant compatibility |
| `src/components/app/WorkspaceShell.jsx` | Separate lazy renderers; Google is the default Map |
| `src/components/map/GoogleJobsMap.jsx` | Renamed from GoogleMapsTest; ordinary Map labels and unmapped message |
| `src/components/map/GoogleJobsMap.css` | Renamed from GoogleMapsTest.css; existing rules preserved, scoped filter-sheet clearance added |
| `src/components/map/GoogleMapFilters.jsx` | Removes test label; opts into the unobstructed Map filter sheet |
| `src/components/shared/ResponsivePageControls.jsx` | Optional modal/class props for the Map sheet; existing defaults retained |
| `src/components/map/google-maps-loader.js` | Development/build-specific configuration guidance; site referrer wording |
| `src/components/map/useExistingMapLocations.js` | Promoted endpoint and normal-user read-error messages |
| `server-map-locations-routes.js` | Renamed/promoted authenticated cache reader; development gate removed |
| `server-app.js` | Imports/registers the promoted reader |
| `.env.example` | Primary Map and build-time browser-key guidance |
| `tests/workspace-navigation.test.js` | Primary, legacy, alias and history cases |
| `tests/map-locations-routes.test.js` | Renamed endpoint test; authorization/read-only behavior and retired endpoint 404 |
| `tests/page-workspace-architecture.test.js` | Both renderers retain centralized job navigation |
| `tests/e2e/google-maps-test.spec.mjs` | Runs existing interactions on primary/legacy paths; adds route, theme, built-frontend and screenshot checks |
| `tests/e2e/mobile-navigation-service-board.spec.mjs` | Original Leaflet regressions explicitly target legacy route |
| `tests/e2e/theme-settings.spec.mjs` | Original Leaflet popup/theme regression explicitly targets legacy route |
| `docs/google-map-promotion-report.md` | This report |
| Earlier two Map reports | Marked as historical and superseded for current routing |

No package changes were made in this promotion. The branch still includes earlier uncommitted POC/parity changes, including the two Google packages and the shared-filter extraction in the legacy component; those predate this route-switch task.

## 12. Verification

```powershell
node --test tests/workspace-navigation.test.js tests/map-locations-routes.test.js tests/google-marker-manager.test.js tests/google-map-data.test.js
# PASS: 9 tests

npm test
# PASS: 309 tests, 0 failures

npm run lint
# PASS

npm run build
# PASS; existing large-main-bundle warning

$env:ELSET_GOOGLE_MAPS_LIVE_TEST='1'
$env:ELSET_GOOGLE_MAPS_TEST_URL='http://localhost:5173'
npx playwright test tests/e2e/google-maps-test.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
# PASS: 14 tests (2.9 minutes)

npx playwright test tests/e2e/google-maps-test.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'live Google renders|live dense|live primary Map'
# PASS: 5 tests (1.7 minutes), with final sheet clearance and isolated Vite test cache

npx playwright test tests/e2e/mobile-navigation-service-board.spec.mjs tests/e2e/theme-settings.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'Legacy Map|semantic legacy map'
# PASS: 3 tests (25.8 seconds), after the final sheet changes

git diff --check
# PASS

node test-results/google-map-promotion/audit.mjs
# PASS: 271 Git-visible files scanned; 0 source key matches; .env.local ignored
# Separate Google/Leaflet build files; existing renderer helpers/routes and package files preserved
```

The full unit total is one lower than the prior parity stage because the development-only endpoint-gate test was removed with that gate. Authorization and read-only cache tests remain.

The Google suite uses live provider requests with the existing localhost:5173 referrer restriction, and isolated workspace/API responses. Its built-frontend check serves the actual `dist` files at that same allowed local origin, so no key or server configuration changes are needed. Network traces/videos remain disabled to avoid recording browser-key request URLs.

After the initial 14-test pass, the filter-sheet refinement was verified with the five affected Google interaction/theme tests. One intermediate dense run lost its open panel during a development reload. The isolated dense rerun passed, the harness was given a separate Vite dependency cache, and the final five-test run passed. No map-initialization workaround was added to application code.

The running local backend also returned HTTP 200 for `/api/health`, HTTP 401 for an unauthenticated request to `/api/map/locations`, and HTTP 404 for the retired `/api/dev/map-locations`. This verifies the renamed endpoint is registered without bypassing authentication.

## 13. Screenshots

All paths below are repository-relative and ignored by Git. They contain isolated fixture jobs, not inserted business records.

| Comparison | Google `/map` | Geoapify `/map/legacy` |
| --- | --- | --- |
| Same default state, 1440x900 | `test-results/google-map-promotion/parity-google-default-1440x900.png` | `test-results/google-map-promotion/parity-geoapify-default-1440x900.png` |
| Same default state, 390x844 | `test-results/google-map-promotion/primary-comparison-google-390x844.png` | `test-results/google-map-promotion/primary-comparison-geoapify-390x844.png` |

Additional primary-route evidence under `test-results/google-map-promotion/`:

- `primary-elset-1440x900.png`, `primary-evergreen-ledger-1440x900.png`, `primary-midnight-signal-1440x900.png`
- `primary-{elset,evergreen-ledger,midnight-signal}-details-390x844.png`
- `primary-{elset,evergreen-ledger,midnight-signal}-filters-390x844.png`
- `parity-dense-dark-details-390x844.png`
- `parity-dense-dark-820x1180.png`, `parity-dense-dark-1024x768.png`
- `production-primary-1440x900.png`
- `missing-key-1440x900.png`, `google-auth-error-1440x900.png`
- `parity-counts.json`, `source-audit.json`

The Geoapify comparison uses deterministic test tiles because no Geoapify tile key was available to that isolated harness. Google uses live tiles. These pairs compare record coverage, layout and control density; they do not establish a live tile-quality comparison or actual 53-job coverage.

Both map implementations remain available locally. Nothing was committed, pushed, merged, uninstalled or deployed.
