# Google Maps feature parity comparison

> Historical parity-stage report. The [primary-route promotion report](google-map-promotion-report.md) supersedes its routing, development-only endpoint/component and production-key statements. The coordinate-cache limitation still applies.

Branch: `feature/google-maps-test`. Local work on 14 September 2026. No commit, push, merge or deployment.

The Google test implementation now shares the original record filters, reads already resolved coordinates, fits visible locations, and updates clustered markers incrementally. The Google route remains development-only at `http://localhost:5173/map/google-test`; `http://localhost:5173/map` still renders Geoapify/Leaflet.

**Acceptance remains open for the real-data comparison.** The local file contains 53 jobs and 67 sites, with no saved job or site coordinate pairs. The original map geocodes addresses at runtime. Google can now reuse that existing server cache, but does not populate it. Automated provider comparisons passed against identical isolated records and coordinate responses; they do not prove current pin coverage for the 53 local jobs. No authenticated user browser was available for that final live comparison.

## 1. Existing Geoapify features found

- Jobs from the authenticated workspace, ordered by most recently updated, enriched through existing customer/site relationships. Site matching uses customer ID plus normalized job address.
- Geoapify tile configuration from `GET /api/map/config`, address resolution through `POST /api/map/geocode`, and an in-memory server coordinate cache. Coordinates are not persisted on this local dataset.
- Deferred ELSET text search; All Jobs, Incomplete, Urgent and Completed; site type and customer type, including Not set.
- One Leaflet marker per resolved job. Same-address jobs receive circular display offsets. There is no marker clusterer in the original implementation.
- Completed markers are green; incomplete high-urgency markers red; other markers purple. Hover tooltips show job number/title. The existing popup shows title, job number/customer and Job Details navigation.
- Visible filtered markers determine bounds: Melbourne/zoom 10 for none, zoom 13 for one, bounds with maximum zoom 13 for multiple. Selection pans and adjusts zoom. ResizeObserver calls Leaflet's resize handling.
- Full workspace layout, compact floating controls, mobile filter sheet, theme-aware ELSET surfaces, loading/error messages and unmapped indicators.

## 2. Missing Google features before this task

The initial POC already had Advanced Markers, clustering, grouped details, record navigation, mobile controls and themed overlays. The pre-edit audit identified these gaps:

- Real records had addresses only; Google had no access to the coordinates resolved by the original map.
- Search/filter predicates and job-filter choices duplicated the original definitions.
- There was no initial or filtered fit-to-markers behavior.
- Filter changes rebuilt every marker and the entire clusterer.
- Provider count comparisons, dense mobile interaction and cache-refresh coverage had not been tested.

The audit findings and the coordinate limitation were reported before implementation changes.

## 3. Features ported

Both map renderers use `map-filters.js` for the original filter choices and predicates. Google reads the existing Geoapify cache through a development-only, authenticated, read-only endpoint, retaining validated saved coordinates as a fallback. It now fits initial/filtered positions, preserves its viewport during selection-independent updates, reconciles markers, exposes every grouped job, and reports missing coordinates explicitly.

The original map's only source change is extraction of its existing filter definitions/predicate into the shared module. Its data enrichment, Geoapify requests, marker offsets/rendering, popup, viewport effects, resize handling and JSX remain unchanged. The two original Map browser regressions passed after this extraction. This is behavior preservation, not a claim that `JobsMapManager.jsx` is byte-for-byte unchanged.

## 4. Data parity result

There is one underlying ELSET dataset: the existing authenticated workspace jobs/customers/sites. No parallel record store, coordinate persistence or business-data writes were introduced.

`GET /api/dev/map-locations` enumerates authorized workspace jobs and looks up their normalized address in the existing Geoapify runtime cache. It returns job ID and a validated coordinate pair or null; no customer/address text or raw provider payload is returned. It uses the existing admin/office authorization middleware and `Cache-Control: no-store`. The route is absent unless the local development flag is enabled, and is disabled for production/Fly environments.

The Google component makes one coordinate read for a stable job/address dataset, with explicit refresh and window-focus refresh. Search/filter changes do not fetch or geocode per record. Requests are aborted on teardown, stale responses are ignored, and changed datasets cannot reuse old-address coordinates.

Current local file audit: **53 jobs, 67 sites, 0 coordinate-bearing jobs, 0 coordinate-bearing sites**. Its size and modification time remained 263,921 bytes and 11 September 2026, 13:30:56. The existing site normalizer still does not preserve additional coordinate fields; it was not changed.

For live comparison, load the original local Map and allow its normal address resolution to finish, then open the Google test route in the same backend session and use **Refresh coordinates**. Server restarts clear the Geoapify cache. This warm-cache dependency is a material remaining difference, so this report does not declare full real-data parity complete.

## 5. Pin/record count comparison

The comparison uses 12 isolated jobs: 11 resolvable, one unresolved. Both renderers receive the same job records and the same coordinate results. Google groups the 11 jobs into five exact positions; cluster/marker labels count jobs, so counting Google DOM markers would be misleading.

| Search/filter state | Leaflet eligible jobs | Google eligible jobs |
| --- | ---: | ---: |
| Default | 11 | 11 |
| Job number 8001 | 1 | 1 |
| Customer search | 8 | 8 |
| Address search | 1 | 1 |
| Job title search | 1 | 1 |
| Completed | 4 | 4 |
| Incomplete | 7 | 7 |
| Urgent | 6 | 6 |
| Commercial sites | 3 | 3 |
| Strata customers | 8 | 8 |
| Site type Not set | 0 | 0 |
| Unresolved address | 0 | 0 |

Machine-readable evidence: `test-results/google-maps/parity-counts.json`. A separate dense fixture represented **240 jobs at 12 positions**, with all 240 available in grouped details; Completed filtered that to **80 jobs**. Fixtures were intercepted in the test browser and were not inserted into local records.

## 6. Clustering implementation

Uses the existing POC dependency `@googlemaps/markerclusterer`, which is the utility described in [Google's marker clustering guide](https://developers.google.com/maps/documentation/javascript/marker-clustering). A SuperCluster algorithm uses radius 60 and maximum clustering zoom 16. Advanced Markers render compact counts. Clicking a cluster fits its bounds and opens the complete job list.

One clusterer survives for the lifetime of the map. Location marker identities survive filters; additions/removals are incremental. Content/status changes update existing markers, and cluster totals redraw when membership changes even if positions stay the same. Removed dataset entries and unmounted listeners are cleaned up. Reconciliation and dense browser tests verify these behaviors; no formal real-dataset timing benchmark was performed.

## 7. Same-location handling

Exact coordinate pairs form one location group. Its marker shows the number of jobs and opens all of them. No record is silently hidden or truncated, and no display-coordinate offsets are invented. Nearby clusters also expose every constituent job. The dense test scrolls to the final job and verifies its Open Job action remains reachable.

## 8. Search behavior

The original case-insensitive, trimmed substring search is retained across job number, customer name, title, description, address, formatted customer type and formatted site type. Both renderers call the same predicate with the existing type formatters. Search is deferred for responsiveness. This is ELSET record search; no Places search was added.

## 9. Filters ported

All Jobs, Incomplete, Urgent and Completed, plus the existing site/customer type lists and Not set options. Existing semantics are preserved: Completed means status exactly `Completed`; Incomplete includes everything else; Urgent means urgency `High`, including completed high-urgency jobs. No invented date or active-job filter was added.

Desktop uses floating controls; mobile/tablet uses the existing compact filter sheet pattern and Reset/Done controls. The original site's filter JSX remains intact; only its definitions/predicate were extracted.

## 10. Marker information and navigation

The ELSET-owned React panel includes job number, status, title, customer, site label/address, Open Job and Open Site when a site is available. Its list scrolls and supports every job in a location/cluster. Marker titles provide job number/title hover text for single jobs. Completed/urgent/other single-location color meanings match the original; mixed groups prioritize incomplete urgent jobs, and clusters use the theme primary color.

Navigation uses the existing `useWorkspaceNavigation` actions and browser history. No full application reload occurs. The original Google map instance is retained when a record temporarily hides it, preserving filters/viewport and avoiding accidental background Geoapify requests. The POC already introduced the origin-map metadata; this follow-up retained and reverified it.

## 11. Viewport, mobile and tablet behavior

Initial/filtered fit follows the useful original behavior: Melbourne at zoom 10 with no positions, one position at zoom 13, multiple positions fitted with a maximum zoom of 13. A 250 ms delay coalesces typing/coordinate arrival. The fit key contains distinct visible positions: theme, selected jobs, record text and sidebar resize do not reset the viewport. Filtering membership at unchanged positions also leaves the view alone. This is intentionally less disruptive than refitting for every content update. See [Google's fitBounds reference](https://developers.google.com/maps/documentation/javascript/reference/map#Map.fitBounds).

The map fills the available workspace at 390x844, 820x1180, 1024x768 and 1440x900. The dense mobile test uses real browser touch events to pan, checks search focus retains that viewport, uses the filter sheet, and checks grouped details. Tablet checks cover workspace height and no horizontal overflow. Zoom controls and Google attribution remain visible. Touch pinch-zoom was not separately automated; Google's Zoom out button was tapped and the resulting zoom change verified in the dense mobile test.

Visual review found a details/status overlap when records were unmapped. The panel now follows the status message's measured height and limits its own height. Screenshot checks assert that the two panels do not overlap.

## 12. Theme, loading and errors

Midnight Signal search/filter surfaces and job details are dark with light text and theme borders. Light themes use the matching existing ELSET surfaces. Google base tiles retain the standard Google style. No hardcoded white ELSET panel or custom base-map style was introduced.

The compact loading state remains until initial tiles load. Missing key, blocked network load, timeout and authentication rejection show safe messages without crashing navigation or displaying the key. Reading existing coordinates has a compact progress indicator. Cache errors/missing coordinates remain visible, with an explicit refresh action. Coordinate failures never invoke a new resolver.

## 13. Packages

No packages were added or changed by this parity follow-up. The branch already contained `@googlemaps/js-api-loader` 2.1.1 and `@googlemaps/markerclusterer` 2.6.2 from the POC. Leaflet and the original dependencies remain installed. No Places, Google Geocoding, Routes or Directions services were added.

## 14. Files changed

| File | Parity follow-up |
| --- | --- |
| `src/components/map/map-filters.js` | New shared original filter definitions and predicate |
| `src/components/map/JobsMapManager.jsx` | Behavior-preserving filter extraction only |
| `src/components/map/GoogleMapFilters.jsx` | Shared filter choices; singular job count |
| `src/components/map/google-map-data.js` | Reexports shared predicate; existing coordinate validation/grouping retained |
| `src/components/map/useExistingMapLocations.js` | New read-only, stale-safe cache hook |
| `server-map-comparison-routes.js` | New local development cache-read endpoint |
| `server-app.js` | Import and register that endpoint; existing Geoapify routes unchanged |
| `src/components/map/google-marker-manager.js` | New persistent clusterer and marker reconciliation |
| `src/components/map/GoogleMapsTest.jsx` | Cache reuse, indexed enrichment, fit behavior and status/details layout |
| `src/components/map/GoogleMapsTest.css` | Details panel clearance and height constraint |
| `tests/google-marker-manager.test.js` | Marker reuse, grouping, content updates and cleanup |
| `tests/map-comparison-routes.test.js` | Environment gate, authorized access, cache misses and read-only behavior |
| `tests/e2e/google-maps-test.spec.mjs` | Provider/filter matrix, dense touch/theme checks, cache refresh and visuals |
| `docs/google-maps-parity-report.md` | Current report |
| `docs/google-maps-test-report.md` | Historical POC report marked superseded |

Earlier uncommitted POC changes also remain in `.env.example`, `package.json`, `package-lock.json`, `src/App.jsx`, `src/components/app/WorkspaceShell.jsx`, `src/hooks/useWorkspaceNavigation.js`, `src/components/map/google-maps-loader.js`, `tests/google-map-data.test.js` and `tests/workspace-navigation.test.js`.

## 15. Tests and audit

Observed commands/results for this follow-up:

```powershell
npm test
# PASS: 310 tests, 0 failures

npm run lint
# PASS

npm run build
# PASS; existing warning about the large main bundle

$env:ELSET_GOOGLE_MAPS_LIVE_TEST='1'
$env:ELSET_GOOGLE_MAPS_TEST_URL='http://localhost:5173'
npx playwright test tests/e2e/google-maps-test.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
# 8 passed, 1 failed: the comparison request-count assertion did not account for window-focus refreshes

npx playwright test tests/e2e/google-maps-test.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'live providers|live dense'
# PASS: 2 tests (50.0 seconds), after correcting that assertion and verifying final overlay clearance

npx playwright test tests/e2e/mobile-navigation-service-board.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'Map (search|fills)'
# PASS: 2 tests (13.8 seconds)

git diff --check
# PASS

git diff --exit-code -- src/index.css src/lib/app-support.jsx server-store.js server-workspace-db.js fly.toml
# PASS: unchanged

node test-results/google-maps/audit.mjs
# PASS: 270 Git-visible files; 0 source/production key matches; 0 production Google runtime matches
# Leaflet core, Geoapify routes and selected shared/production files unchanged
```

Live Google tests use the existing key on localhost:5173, since its existing referrer restrictions reject arbitrary test ports. Key settings were not changed. Workspace endpoints are mocked in the test browser, Google map requests are live, and Google-route checks reject business-data writes or geocoding calls. Traces/videos are disabled so provider URLs containing the browser key are not captured.

All nine Google suite scenarios have passing evidence across the full and final focused runs; a final all-nine pass in a single invocation is not claimed. The failed assertion occurred after all 12 provider count checks had passed: switching between provider tabs can legitimately refresh existing coordinates on window focus. The corrected assertion counts those focus events while continuing to reject per-filter/per-record fetching. The focused rerun also verified mobile zoom control access and the final details/status clearance.

The audit checks the exact local key without printing it. It verifies zero matches in Git-visible files and production JS/CSS, and no Google test runtime in production assets. `.env.local` remains ignored. It also compares the original Leaflet helpers/enrichment and its request/render/effect/JSX section against HEAD, and verifies the existing Geoapify API route section is unchanged. Shared data normalizers, storage, Fly configuration and common CSS are unchanged.

## 16. Screenshot paths and visual comparison

All paths are repository-relative, local and ignored by Git. Matched default and Urgent pairs use identical test records/filter states:

- `test-results/google-maps/parity-google-default-1440x900.png`
- `test-results/google-maps/parity-geoapify-default-1440x900.png`
- `test-results/google-maps/parity-google-urgent-1440x900.png`
- `test-results/google-maps/parity-geoapify-urgent-1440x900.png`
- `test-results/google-maps/parity-dense-dark-details-390x844.png`
- `test-results/google-maps/parity-dense-dark-filtered-390x844.png`
- `test-results/google-maps/parity-dense-dark-820x1180.png`
- `test-results/google-maps/parity-dense-dark-1024x768.png`
- `test-results/google-maps/google-cluster-details-1440x900.png`
- `test-results/google-maps/google-workspace-1440x900.png`
- `test-results/google-maps/google-workspace-820x1180.png`
- `test-results/google-maps/google-workspace-390x844.png`
- `test-results/google-maps/google-mobile-filters-390x844.png`
- `test-results/google-maps/google-no-saved-coordinates-1440x900.png`
- `test-results/google-maps/missing-key-1440x900.png`
- `test-results/google-maps/google-auth-error-1440x900.png`
- `test-results/mobile-service-board/fullscreen-map-workspace-{390x844,820x1180,1024x768,1440x900}.png`

**Visual limitation:** the Geoapify comparison uses deterministic test tiles because no Geoapify tile key was available to that isolated harness. Google screenshots use live Google tiles. The pairs establish marker coverage, control placement and density; they are not a live geographic tile-quality comparison between providers or screenshots of the 53 real jobs.

The default pair represents the same 11 jobs. Leaflet's same-address offsets appear crowded; Google represents five exact locations with compact job counts. Floating controls remain at the top of the same workspace. The dense mobile panel is readable, scrolls, and clears the status/zoom controls; tablet leaves the map dominant. Screenshot capture waits for the provider zoom/resize transition and image loading to settle.

## 17. Remaining differences and acceptance

- Cold-cache Google cannot independently place address-only jobs. The original map can geocode them; Google deliberately cannot under the existing-coordinates-only constraint. Actual 53-job eligible counts and a fully live Geoapify/Google visual comparison remain unverified.
- Google groups exact positions and nearby jobs rather than shifting one Leaflet pin per job. Job totals, not raw DOM marker counts, are the comparison measure.
- Google provides grouped details, status/address and Open Site; the legacy popup remains unchanged with Job Details.
- Google fits only when the set of visible positions changes, preserving the view across content/theme/selection-independent updates. Its standard tiles/navigation controls differ from Leaflet's.
- The development endpoint reuses existing authentication checks; there is no auth migration, schema change, business-data mutation, address-entry change or production route switch.

Full real-data acceptance should be completed before deciding whether to replace Geoapify. Both renderers remain available side by side, and the branch remains uncommitted and undeployed.
