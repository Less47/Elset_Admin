# Google Map markers and theme support

Implemented locally on 16 September 2026. No commit, push or deployment.

## 1. Existing clustering implementation

`WorkspaceShell.jsx` lazily mounts `GoogleJobsMap.jsx` for the Map workspace. `google-maps-loader.js` loads Google's weekly Maps JavaScript API through the existing singleton loader. The map uses `DEMO_MAP_ID` and custom DOM content inside `AdvancedMarkerElement`; it did not use `PinElement`.

Numbered bubbles previously came from two stages:

1. `groupJobsByPosition()` combined exact `latitude,longitude` matches into one group. `google-marker-manager.js` created one Advanced Marker per group and placed the job count inside its custom span when the group contained multiple jobs.
2. `@googlemaps/markerclusterer` combined nearby group markers using `SuperClusterAlgorithm({ radius: 60, maxZoom: 16 })`. Its renderer flattened the jobs behind those markers and displayed their total in a larger bubble. Clicking it selected every included job and fitted the map to the cluster bounds.

The existing React details panel read selected job IDs and supplied Open Job, Open Site and Navigate. ELSET's authoritative appearance state is `useThemePalette().themePalette.dark`, derived by `buildSemanticTheme()` from persisted account surface colours. The original map initialized once, without a colour-scheme option.

## 2. How clustering was removed

Removed the cluster imports, algorithm, renderer, cluster click/zoom handling and cluster CSS. The marker manager now reconciles one Advanced Marker per mapped job ID. Filtering detaches excluded markers and reuses their instances when they return; changes to a job update its existing marker.

Exact-coordinate deduplication remains only for viewport fitting. It no longer determines marker creation, job counts or selection. Search, job, Site type and Customer type filter semantics are unchanged. Mapped/missing counts now directly count filtered jobs with/without a usable position.

## 3. Old and new marker sizes

| Element | Before | Now |
| --- | --- | --- |
| Individual job symbol | 28 × 28 px | 18 × 18 px, approximately 64% of the previous width/height |
| Numbered cluster bubble | 36 × 36 px | Removed |
| Pointer/touch target | Symbol-sized | Transparent 44 × 44 px target |

The symbol has a white border, dark outer edge and contrasting glyph. Selection adds an outline without increasing the ordinary marker size. The compact text-labelled legend occupies a row within the existing count/status surface.

## 4. Status colours and fallback

The Service Board exports exactly `To Do`, `In Progress`, and `Completed` in `src/lib/job-status.js`. The job write validation and ServiceM8 import validation accept the same three values. No additional legitimate status was found in those definitions.

| Stored status | Map colour | Glyph |
| --- | --- | --- |
| `To Do` | Yellow/amber `#F5B700` | Dot |
| `In Progress` | ELSET blue `#0F90CD` | Chevron |
| `Completed` | Green `#149447` | Check |
| Missing or unrecognised value | Slate `#64748B` | Question mark |

The display helper lives alongside the existing Service Board status definitions. Dedicated semantic map tokens provide saturated fills across every palette; existing status text/surface tokens remain unchanged. Unknown values retain their text in the details panel and marker title and are never treated as Completed. An “Other / not set” legend entry appears when needed. Glyph/fill contrast tests pass at 4.5:1 or higher.

## 5. Jobs at the same coordinates

Every mapped job keeps its own marker at its original coordinates. Interaction stacks identify exact or near-identical positions within `0.00001` degrees of a fixed representative, approximately one metre. A spatial bucket index avoids repeated all-pairs comparisons, and grouping cannot chain across progressively distant sites.

Jobs in a stack are ordered deterministically by ID. Repeated activation cycles through them; the details panel also offers “Next job here”. Only the selected job's details and actions are shown. Filtering restricts cycling to visible jobs. There are no count bubbles, coordinate offsets or coordinate writes.

## 6. Collision behaviour and ordering

All markers explicitly use `CollisionBehavior.REQUIRED`, so collision handling does not suppress lower-priority jobs. Physical overlap remains intentional. Ordinary markers have z-index 1, hovered/keyboard-focused markers 100001, and the selected marker 100002. Closing selection restores normal ordering. This uses Google's documented [Advanced Marker collision behaviour](https://developers.google.com/maps/documentation/javascript/advanced-markers/collision-behavior).

Titles include job number, exact status, customer and job title, plus a cycling hint for stacked jobs. Google keyboard interaction remains enabled through `gmpClickable` and the supported `gmp-click` event. See the [Advanced Marker API reference](https://developers.google.com/maps/documentation/javascript/reference/advanced-markers).

## 7. Native dark/light map support

`WorkspaceShell` passes the authoritative `themePalette.dark` boolean. The loader imports `ColorScheme` from Google's core library, and map construction sets `ColorScheme.DARK` or `ColorScheme.LIGHT`. There is no CSS dark overlay or operating-system theme inference.

| ELSET preset | Google map scheme |
| --- | --- |
| Midnight Signal | DARK |
| Elset Classic | LIGHT |
| Copper Dawn | LIGHT |
| Evergreen Ledger | LIGHT |
| Studio Rose | LIGHT |
| Desert Circuit | LIGHT |

Custom palettes use the same semantic dark classification as the rest of ELSET, so other dark surface choices work too. Google's [map colour-scheme documentation](https://developers.google.com/maps/documentation/javascript/mapcolorscheme) specifies that this option must be supplied at initialization.

## 8. Live theme lifecycle

Only a light/dark boundary change recreates the map. Cleanup saves its center and zoom, removes listeners and observers, cancels pending work, detaches markers and clears the old map DOM. The replacement receives the saved view and new scheme. React retains filters and selected job IDs; marker reconciliation restores the selection and ordering.

Switching between light presets changes overlay tokens without reconstructing the map or its markers. Mouse movement and selection do not rebuild the marker collection. Native Maps and contract tests verify repeated transitions, retained center/zoom/search/selection, detached old markers, and cleanup of old listeners. A guard also prevents missing map-center errors following Google authorization failure.

## 9. Files changed

| Files | Purpose |
| --- | --- |
| `src/components/app/WorkspaceShell.jsx` | Pass authoritative theme state |
| `src/components/map/GoogleJobsMap.jsx` | Theme lifecycle, individual-job data, selection, stack action and legend |
| `src/components/map/google-marker-manager.js` | Individual marker reconciliation, accessibility, cycling and z-index |
| `src/components/map/google-map-data.js` | Near-exact interaction stack index |
| `src/components/map/google-maps-loader.js` | Import native colour-scheme constants |
| `src/components/map/GoogleJobsMap.css` | Compact symbols, touch targets, legend and selected outline |
| `src/lib/job-status.js` | Shared map status display helper |
| `src/lib/theme-tokens.js` | Saturated semantic marker tokens |
| `package.json`, `package-lock.json` | Remove unused clustering dependency tree |
| `tests/google-marker-manager.test.js` | Marker identity, status, overlap, ordering and 500-job reconciliation tests |
| `tests/e2e/google-map-markers.spec.mjs` | Counts, colours, actions, instance reuse and live theme lifecycle |
| `tests/e2e/fixtures/google-map-harness.html`, `google-map-harness.jsx` | Isolated React/theme lifecycle fixture |
| `tests/e2e/helpers/google-maps-stub.mjs` | Deterministic Maps contract fixture |
| `tests/e2e/google-maps-test.spec.mjs` | Individual-marker expectations, all-theme live checks and dense touch coverage |
| `tests/e2e/site-navigation.spec.mjs` | Per-job navigation and stacked selection expectations |
| `docs/google-map-markers-theme-report.md` | This report |

## 10. Tests and results

- `npm run lint`: passed.
- `npm run build`: passed. The existing main-bundle size warning remains; the map chunk is approximately 15.9 kB before gzip.
- `npm test`: **399 passed**, zero failures/skips.
- Playwright: **108 distinct scenarios passed** across the full regression run and focused reruns. The final focused run passed all 17 scenarios, including eight live Places checks that were initially opt-in skips. Old grouped-marker expectations were updated, and dense keyboard activation now waits for the fitted viewport and explicit focus.

Browser suites: `google-map-markers`, `google-maps-test`, `google-places`, `site-navigation`, and `theme-settings`. Live-provider checks use the existing allowed `http://localhost:5173` origin; arbitrary ports are rejected by the existing API key's referrer restriction. Key configuration was not changed, and traces/videos are disabled for Google checks.

Coverage includes:

- One marker per mapped job, no cluster bubbles, all status colours and unknown fallback, REQUIRED collision mode, hover/focus/selection order, click cycling and keyboard activation.
- The **206 jobs / 152 mapped / 54 missing** example; a **175-marker** Site coordinate refresh; **240 live markers** on mobile; 500-marker unit reconciliation retaining instances over 20 filtering passes.
- Unchanged search and filter results, including mapped/unmapped counts, urgent/completed semantics, Site type and Customer type.
- All six presets against live Google Maps; repeated native light/dark transitions while the map remains mounted; saved per-account appearance, reload and session isolation.
- Open Job, Open Site, Navigate, Apple/Google platform destinations, desktop keyboard and phone/tablet touch flows.
- Live Places suggestions, selection, saved Site coordinates and subsequent map display without geocoding; manual entry and provider error fallbacks.
- Built production assets, direct map links, refresh, full-workspace sizing and retired-route checks.

Visual QA inspected live screenshots at desktop 1440 × 900, tablet 820 × 1180, tablet landscape 1024 × 768 and mobile 390 × 844. The legend remains clear of zoom controls and attribution; details actions and scrolling remain usable. Examples: [desktop pins](../test-results/google-map-promotion/google-melbourne-pins-1440x900.png), [dark mobile details](../test-results/google-map-promotion/parity-dense-dark-details-390x844.png), [dark tablet](../test-results/google-map-promotion/parity-dense-dark-820x1180.png).

Application API responses and writes in browser tests use isolated fixtures or temporary databases. Business data, coordinate storage, address/geocoding logic and production services were not modified.

## 11. Remaining clustering dependency

None. Repository-wide audit found no other runtime consumer of `@googlemaps/markerclusterer`, so the package and its now-unused transitive dependencies were removed. `npm ls` and source/lockfile searches confirm their absence. Older audit reports retain historical descriptions of clustering; these are documentation, not active code. The existing Google API loader remains installed for Maps and Places.
