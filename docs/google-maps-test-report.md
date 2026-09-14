# Google Maps proof of concept

> Historical report: this records an earlier migration stage. Current mapping uses Google only; retired routes and provider setup described below no longer apply. See [the cleanup report](geoapify-cleanup-report.md).

> Current route arrangement is documented in the [primary-route promotion report](google-map-promotion-report.md): Google at `/map`, Leaflet at `/map/legacy`, and the retired test URL redirects to `/map`.

> Historical POC snapshot. The follow-up [feature parity report](google-maps-parity-report.md) supersedes this report's coordinate, viewport, shared-filter, source-preservation and verification claims. In particular, the Google page now reads existing Geoapify cache results, fits filtered positions, and shares the original filter definitions; the legacy component has a behavior-preserving filter extraction.

Branch: `feature/google-maps-test`. Verified locally on 14 September 2026. Changes are uncommitted; no push, merge or deployment was performed.

Open **http://localhost:5173/map/google-test** while Vite is running. **http://localhost:5173/map** still selects Geoapify/Leaflet. The normal sidebar Map action remains unchanged.

## Outcome and coordinate limitation

Google Maps JavaScript API loads with the existing local key, displays Melbourne and renders interactive Advanced Markers and clusters. All ELSET filters and Open Job/Open Site interactions passed browser checks using isolated coordinate-bearing job fixtures.

**Actual local records cannot yet appear as Google markers:** the audited `data/app-data.json` contains 53 jobs and 67 sites, with zero coordinate-bearing jobs or sites. ELSET currently stores addresses, then obtains coordinates at runtime through Geoapify. The test displays an explicit unmapped count; it does not insert demo jobs into the application, invent positions, geocode records, or write business data.

The Google adapter accepts complete `latitude`/`longitude`, `lat`/`lon`, or `lat`/`lng` pairs on a supplied job or its `location`. It validates finite values and geographic ranges, preserves valid zero values, and rejects empty/null/partial pairs. It can also read the same fields from a matching supplied site. However, existing site normalizers and storage do not preserve site coordinate fields: this site fallback is not a persisted site-coordinate workflow. Adding coordinate persistence is a separate prerequisite for a future migration; no shared normalizer or schema was changed here.

## Existing architecture, audited before editing

- `JobsMapManager.jsx` renders jobs from the authenticated workspace's `data.jobs` and enriches them with customer type and site type. It uses `buildCustomerSites`, matching customer ID plus normalized job address, and sorts by most recently updated.
- `GET /api/map/config` returns Geoapify tile URLs, style and attribution. `GEOAPIFY_MAPS_API_KEY` falls back to `GEOAPIFY_API_KEY`; server configuration also supports country, style and autocomplete settings.
- `POST /api/map/geocode` geocodes distinct saved addresses through Geoapify. The response contains `location.lat` and `location.lon`. The server cache is an in-memory Map, and the component keeps an in-memory address-to-location map. These coordinates are not persisted on the local jobs or sites.
- Leaflet uses a tile layer and an ordinary `L.layerGroup` of job markers. It has no clustering. Jobs sharing a normalized address receive small circular display offsets; nearby different addresses can overlap.
- Existing filters are text search, All/Incomplete/Urgent/Completed jobs, site type and customer type, including Not set. Urgent includes completed high-urgency jobs. Search covers job number, customer, title, description, address and formatted type labels.
- Markers are green for completed, red for incomplete high urgency, and purple otherwise. Hover tooltips show job number/title. The popup shows title, number/customer and a Job Details button using the existing record navigation action.
- `WorkspaceShell` provides a fixed, full-height map workspace beside the existing sidebar, with mobile navigation above it. Floating controls and mobile filter sheets use shared ELSET components and theme variables. Leaflet uses `invalidateSize` and a ResizeObserver.
- Routing uses `useWorkspaceNavigation` and browser history, not React Router. Previously the normal sidebar stored `section: map` at `/`; a fresh `/map` URL was not explicitly recognized. This change adds explicit `/map` and `/map/google-test` parsing without changing the sidebar action.
- Vite loads local environment files through the existing Vite configuration. `.env.local` is ignored by Git. Browser access uses `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`.

## Google implementation

The component is lazy loaded behind `import.meta.env.DEV`. The production build excludes the Google component, loader, marker code and local key. A production visit to the test path shows a development-only message. Existing admin/office access rules still apply.

The loader uses `setOptions` once and `importLibrary('maps')` / `importLibrary('marker')`, following [Google's current loading documentation](https://developers.google.com/maps/documentation/javascript/load-maps-js-api). Its singleton also survives Vite hot updates, avoiding repeated configuration and vendor warnings that could expose options. Missing configuration, network failure, a 20-second load timeout, and `gm_authFailure` produce explanatory development messages. Errors never include the key or raw provider request URLs. Initial readiness waits for Google's `tilesloaded` event.

The map starts at latitude -37.8136, longitude 144.9631, zoom 10. It fills the existing workspace, observes container resizing, supports pan/drag and zoom, and retains Google's standard base map and attribution. Fullscreen, Street View and map-type controls are omitted for this first comparison. No Places, Geocoding, Routes or Directions library or service is requested by the implementation.

Markers use [AdvancedMarkerElement](https://developers.google.com/maps/documentation/javascript/advanced-markers/add-marker) with Google's documented `DEMO_MAP_ID` for development. Identical coordinate pairs share one marker, without shifting the actual position; its details include every matching job. Nearby locations use [Google's marker-clustering utility](https://developers.google.com/maps/documentation/javascript/marker-clustering) and a custom Advanced Marker renderer, so cluster counts represent **jobs**, not just locations. Clicking a cluster zooms to its bounds and lists every job, including jobs at coincident coordinates or dense maximum-zoom locations.

ELSET renders the details card through React with job number, title, status, customer, site label/address, Open Job and Open Site. The scrollable list does not truncate jobs. Navigation retains the originating Google map variant even when a record page hides the map, preventing an accidental background mount of Geoapify and its geocoding requests. Filters and selection remain in place on return.

## Filters and behavior retained or deferred

Search, all job filters, site type, customer type and Not set semantics are retained. The new page reuses ELSET's site-building/type-formatting helpers, responsive controls, filter sheet, Select and Button components. Filter predicates mirror the existing page and are covered by focused tests. The original `JobsMapManager.jsx` remains byte-for-byte unchanged.

Geoapify address geocoding, circular marker offsets, hover tooltips and automatic fitting of all filtered jobs are not migrated. Google starts at the requested Melbourne view; a cluster click adjusts the view. No Google address autocomplete or additional service was added. The main limitation is absent persisted coordinates, not a changed eligibility dataset.

## Files and dependencies

| File | Change |
| --- | --- |
| `.env.example` | Empty development variable and configuration comments; all Geoapify variables retained |
| `package.json`, `package-lock.json` | Added the two small Google utility packages |
| `src/App.jsx` | Passes the active/originating map variant |
| `src/components/app/WorkspaceShell.jsx` | Lazy development route integration; existing Leaflet component retained |
| `src/hooks/useWorkspaceNavigation.js` | Explicit map paths and origin metadata for record navigation |
| `src/components/map/GoogleMapsTest.jsx` | Google map, markers, clusters, loading/errors and record details |
| `src/components/map/GoogleMapsTest.css` | CSS scoped to Google-owned test markup and ELSET overlays |
| `src/components/map/GoogleMapFilters.jsx` | Existing filter choices in shared ELSET controls |
| `src/components/map/google-map-data.js` | Read-only coordinate validation, grouping and filter predicates |
| `src/components/map/google-maps-loader.js` | Singleton dynamic loader and authentication error subscription |
| `tests/google-map-data.test.js` | Coordinate, grouping and filter edge cases |
| `tests/workspace-navigation.test.js` | Map path and return-origin cases |
| `tests/e2e/google-maps-test.spec.mjs` | Isolated browser checks and optional live Google verification |
| `docs/google-maps-test-report.md` | This report |

Added `@googlemaps/js-api-loader` **2.1.1** and `@googlemaps/markerclusterer` **2.6.2**. Leaflet and all existing packages remain. Lockfile changes are limited to the added dependency trees. npm install reported 24 dependency audit findings; no broad dependency remediation was attempted.

## Verification

| Requirement | Observed result |
| --- | --- |
| A. Existing `/map` | Passed: Leaflet tiles/marker/popup/navigation with isolated tile and geocode responses; existing Map filter and responsive suites also passed |
| B. Google route | Passed using the existing key on `http://localhost:5173` |
| C. Melbourne | Live Google tiles visually inspected at zoom 10, centered at -37.8136 / 144.9631 |
| D. Existing coordinates | Coordinate-bearing ELSET job fixtures render; actual local jobs/sites have no persisted coordinates, so real-record marker verification is unavailable |
| E. Marker content | Passed for single jobs, identical coordinates and nearby clustered jobs |
| F. Navigation | Open Job, Open Site and browser Back passed; no background Geoapify requests |
| G. Missing/rejected key | Missing key, blocked script and simulated auth failure all show clear messages; actual temporary-port referrer rejection was also observed |
| H. Key handling | Exact local key absent from 263 Git-visible files scanned and built production JS/CSS; live console check found no key logging |

The local key rejects arbitrary test-runner ports with `RefererNotAllowedMapError`. Live tests therefore used the already running Vite server at port 5173; key/referrer settings were not changed. Browser tests mock only local workspace endpoints, with synthetic records and GET-only assertions. Live Google requests remain real. Traces and videos are disabled in this suite because network traces would capture the browser key.

Commands and results:

```powershell
npm run lint
# PASS

npm run build
# PASS; existing large-main-chunk warning

npm test
# 307 passed, 0 failed

node --test tests/google-map-data.test.js tests/workspace-navigation.test.js
# 7 passed, 0 failed, after the navigation-origin adjustment

$env:ELSET_GOOGLE_MAPS_LIVE_TEST='1'
$env:ELSET_GOOGLE_MAPS_TEST_URL='http://localhost:5173'
npx playwright test tests/e2e/google-maps-test.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
# 6 passed (27.0s)

npx playwright test tests/e2e/mobile-navigation-service-board.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'Map (search|fills)'
# 2 passed (12.7s)

git diff --check
# PASS

git diff --exit-code -- src/components/map/JobsMapManager.jsx src/index.css server-app.js fly.toml
# PASS: unchanged

node test-results/google-maps/audit.mjs
# 0 source key matches; 0 production key matches; 0 production Google code matches
```

The explicit `--tsconfig=tsconfig.app.json` is needed because this checkout's root `tsconfig.json` is empty. An initial run without that argument failed before executing tests. Subsequent browser iterations corrected a test capture timing assumption and the dark-theme fixture; final results above passed.

## Screenshots

All paths below are relative to the repository and ignored by Git. Google screenshots use live tiles and isolated test records, not inserted local records.

- `test-results/google-maps/google-melbourne-cluster-1440x900.png`
- `test-results/google-maps/google-cluster-details-1440x900.png`
- `test-results/google-maps/google-workspace-1440x900.png`
- `test-results/google-maps/google-workspace-820x1180.png`
- `test-results/google-maps/google-workspace-390x844.png`
- `test-results/google-maps/google-mobile-filters-390x844.png`
- `test-results/google-maps/google-no-saved-coordinates-1440x900.png` (dark theme)
- `test-results/google-maps/missing-key-1440x900.png`
- `test-results/google-maps/google-auth-error-1440x900.png`
- `test-results/google-maps/geoapify-regression-fixture-1440x900.png`

The preserved Geoapify viewport suite also captured `test-results/mobile-service-board/fullscreen-map-workspace-{390x844,820x1180,1024x768,1440x900}.png`.

No Fly configuration, production secrets, deployment, business records, schema, auth, autocomplete, or existing Geoapify implementation was changed.
