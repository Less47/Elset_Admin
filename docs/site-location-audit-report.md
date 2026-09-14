# Production map Site-coordinate audit

> Historical report: this records an earlier migration stage. Current mapping uses Google only; retired routes and provider setup described below no longer apply. See [the cleanup report](geoapify-cleanup-report.md).

Date: 14 September 2026. The workspace was already on `main`; the branch was not changed. Changes are local and uncommitted. No deployment, production data update, or external geocoding backfill was performed.

## Finding

Production shows **204 jobs / 0 mapped because no persisted production Site or Job contains coordinates**. The Google Maps loader and negative-coordinate validation are not the cause.

The old Geoapify map geocodes addresses on demand. `server-app.js` stores its results as `lat` / `lon` in the process-local `geoapifyGeocodeCache` Map; it does not save them to Sites. That cache disappears when the process restarts. The previous Google implementation tried saved Site coordinates, the read-only Geoapify runtime cache endpoint, then Job coordinates. None supplies a durable position for the current dataset after a cold start.

## Production evidence

The audit read the existing `/app/data/elset-workspace.db` on the running `elset-admin` Fly machine. It opened SQLite with `readonly: true`, `fileMustExist: true`, and `PRAGMA query_only = ON`. It ran SELECT/metadata reads without importing application startup or migration code. Output contained aggregate counts and field names only.

| Measure | Observed |
| --- | ---: |
| Jobs | 204 |
| Jobs with `siteId` / `site_id` | 0 |
| Jobs with coordinate fields, including nested candidates | 0 |
| Persisted Sites | 161 |
| Sites with valid coordinates | 0 |
| Sites missing coordinates | 161 |
| Sites with addresses but no coordinates | 161 |
| Sites with legacy or nested coordinate fields | 0 |
| Jobs matching a unique saved Site within their customer | 175 |
| Unique saved Sites referenced by those jobs | 122 |
| Jobs without a matching saved Site | 29 |
| Distinct customer/address pairs among those unmatched jobs | 24 |
| Ambiguous Site matches | 0 |

The production schema is version **6**, with migration ledger entries 1–6. `sites` has `id`, `customer_id`, `address` and `extra_json`, but no dedicated coordinate columns. `jobs` has `customer_id`, `job_address` and `extra_json`, but no Site ID or coordinate columns. Optional fields are supported through `extra_json`.

All production Site extras have an empty field inventory. No coordinate/geocode/cache table was found. Recursive checks found no current or legacy coordinate candidates in Site or Job extras, including `siteLatitude` / `siteLongitude`, snake-case equivalents, `location`, `coordinates` and geometry records. The retained historical `app-data.json` also contains no Site or Job coordinate candidates. There are no persisted Geoapify coordinates to reuse.

Both read-only SSH queries emitted complete aggregate JSON after closing SQLite. The Windows Fly CLI then exited 1 with `The handle is invalid.` during transport cleanup. The database results were received; the SSH process itself did not have a successful exit status. Local aggregate evidence is retained in ignored `test-results/site-location-audit/production-aggregate.json`.

## Data flow and fields

The active route is `/map` → `App` / `WorkspaceShell` → lazy-loaded `GoogleJobsMap`. `/api/app-state` supplies authorized Jobs and Customers containing saved Sites. `server-workspace-storage.js` reads SQLite afresh; `server-workspace-state.js` merges `extra_json` into records, followed by existing normalization in `server-store.js`.

Canonical Google Places metadata is `latitude`, `longitude`, `streetAddress`, `suburb`, `state`, and `postcode`. The formatted address is stored in `sites.address`; optional metadata persists in `sites.extra_json`. No new schema migration is needed.

The existing shared `readSavedPosition` helper accepts:

- `latitude` / `longitude`;
- `lat` / `lon` and `lat` / `lng`;
- those pairs under `location`.

It normalizes numeric strings, accepts negative values and zero, and rejects empty/null values, nonnumeric types, NaN/infinity and coordinates outside latitude ±90 / longitude ±180. Explicitly cleared canonical coordinates suppress old aliases so a manual address edit cannot revive a stale location. No additional alias was needed for production: none of the candidate fields exists there.

The corrected flow is Job → authoritative saved Site → shared coordinate validation → `{ lat, lng }` → `groupJobsByPosition` → existing Google marker manager and clusterer. An explicit Site ID wins, scoped to the Job's customer. Legacy Jobs without IDs match their actual `jobAddress` to a unique saved Site under that customer, using case/whitespace normalization. Missing, wrong-owner or ambiguous links remain unmapped. Customer main addresses, embedded Site snapshots, runtime Geoapify results and Job coordinate copies cannot substitute for the saved Site.

`/api/map/locations` now returns `source: "saved-site-coordinates"`, per-Job Site IDs/positions/reason codes, and aggregate diagnostics. It retains authorization and `no-store` behavior and has no geocoder or database write dependency. Google map refresh reads current Site coordinates, including explicit missing positions, without editing Jobs. The existing map renderer and clustering implementation are unchanged.

The status shows total Jobs, mapped Jobs and missing locations, with a separate count for Jobs lacking a unique matching saved Site. The map panel and Open Site action use the resolved Site even when an explicitly linked Job has a stale address.

## Backfill requirement and prepared tool

**161 unique existing Sites need coordinates.** Of these, 122 currently serve 175 Jobs; 39 are not referenced by the current Jobs. Successfully filling those 122 referenced Sites would map **175 of 204 Jobs**. Backfill alone cannot resolve the remaining 29 Jobs across 24 customer/address pairs. They require separate Site reconciliation; this change does not create Sites or rewrite Job links.

For production, follow [the Fly-only backfill runbook](site-coordinate-backfill.md). The counts above are historical audit results, not a current production inventory. Only a dry-run inside the deployed Machine against `/app/data/elset-workspace.db` establishes current production counts.

`scripts/site-locations.mjs` is the older explicit-path audit and bounded backfill interface. The following describes that interface; use the new Fly-only entry point for the production workflow:

```text
node scripts/site-locations.mjs audit --db <existing-workspace.db>
node scripts/site-locations.mjs backfill --db <existing-workspace.db> --limit 25
node scripts/site-locations.mjs backfill --db <existing-workspace.db> --apply --limit 25
```

Audit and default backfill preview open the database read-only and make no provider requests. Applied backfill requires the explicit `--apply` flag and server environment variable `GOOGLE_GEOCODING_API_KEY`. It never reads the browser Maps key.

Each batch considers existing unique Site records, skips valid canonical/legacy coordinates, and uses a structured full Site address or its formatted address fallback. Sites with only a locality and no street/formatted address are skipped. The default batch is 25, with sequential requests and a short delay. One successful Site lookup supplies every Job linked to that Site.

The shared helper now updates only `latitude` and `longitude` inside Site `extra_json`. Failed attempts make no writes. Existing historical `coordinateBackfill` markers are preserved; old failure markers still require `--retry-failed` or a changed address. Addresses, ownership, other metadata, notes and Jobs are preserved. A compare-and-set update prevents an in-flight result overwriting a concurrent Site edit. Successful Sites are skipped on later runs. Transient failures receive up to two retries; permission, exhausted quota and network failures stop the batch. Progress reports counts and codes without keys, addresses or raw provider errors.

The provider adapter accepts one non-partial Australian rooftop result of street/premise/subpremise type with valid coordinates. Ambiguous, approximate or rejected results are left without coordinates for review. Consequently, 175 mapped is the maximum expected from the existing links, not a guaranteed provider success count.

The one-time backfill uses **Google Geocoding API**, via its server REST endpoint. A separate server key should be restricted to Geocoding API and the execution host's appropriate source IPs; a website-restricted Maps JavaScript key should not be reused. No key was requested, printed, hardcoded or configured. See [Geocoding requests and result semantics](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding) and [Google API security guidance](https://developers.google.com/maps/api-security-best-practices).

## Current address workflow verification

No form/persistence correction was necessary: current Google Places workflows already persist metadata on the authoritative Site.

| Flow | Verified behavior |
| --- | --- |
| Create Customer | `CustomerFormPage` selection → `primarySiteAddress` → `useWorkspaceActions` primary Site; SQLite and JSON reload retain address and coordinates. |
| Edit Customer / Site | Customer editing reaches the linked Site profile for address changes; it renders the Google picker. |
| Create / Edit Site | `SiteWorkspace` saves selected metadata; a later manual address change clears coordinates and stale structured fields. |
| Create Job → Add New Customer | Embedded creation saves the new Customer's Site coordinates. |
| Create Job → Add New Site | Embedded creation adds the Site to the existing Customer and preserves coordinates. |

The shared picker is `GoogleAddressAutocompleteInput`. `server-workspace-customers.js`, `server-workspace-jobs.js`, `server-store.js`, and shared Site metadata helpers preserve the fields in existing SQLite/JSON persistence paths.

## Changed files

| File | Change |
| --- | --- |
| `src/lib/site-location.js` | Site indexes, authoritative Job-to-Site resolution, full-address selection, aggregate counts. |
| `server-map-locations-routes.js` | Read saved Site positions and return diagnostics. |
| `server-app.js` | Remove the Google location endpoint's runtime cache dependency. |
| `src/components/map/useExistingMapLocations.js` | Read saved-Site response entries and refresh them. |
| `src/components/map/GoogleJobsMap.jsx` | Resolve saved Sites, refresh coordinates, show meaningful counts and correct Site actions. |
| `server-site-location-tools.js` | Read-only audit, constrained geocoder and safe Site backfill. |
| `scripts/site-locations.mjs` | Explicit audit/preview/apply CLI. |
| `tests/site-location-resolution.test.js` | Coordinates, Site ownership, missing/ambiguous links, grouping and counts. |
| `tests/site-location-backfill.test.js` | Read-only CLI, no-address skips, preservation, retries, concurrency and provider validation. |
| `tests/map-locations-routes.test.js` | Authorized, read-only saved-Site endpoint behavior. |
| `tests/e2e/google-maps-test.spec.mjs` | Saved-Site fixtures, production-shaped reproduction, explicit Site IDs and refresh. |
| `tests/e2e/google-places.spec.mjs` | Updated location endpoint fixture source. |
| `tests/e2e/site-navigation.spec.mjs` | Updated endpoint fixture and no-Site map expectation. |
| `docs/site-location-audit-report.md` | This report. |

The pre-existing user edit to `.dockerignore` is preserved. Google key/loading/deployment configuration, schema migrations, current forms and persistence modules, marker clustering code and `/map/legacy` implementation remain unchanged. Geoapify routes and the runtime cache still serve the legacy Leaflet map.

The final SHA-256 comparison against the task-start file baseline found exactly the nine intended tracked-file edits and no missing files; 276 baseline files were unchanged, including local `data/app-data.json` and `.env.local`. Five new files, including this report, complete the 14-file change. Comparison results are in ignored `test-results/site-location-audit/diff-audit.json`.

## Verification results

- `npm test`: **343/343 passed**, zero skipped. Includes the new resolver, route and backfill tests, existing Google Places normalization/persistence tests and build-metadata checks.
- `node --test tests/site-location-resolution.test.js tests/site-location-backfill.test.js`: **13/13 passed** after the no-address guard was added.
- `npm run lint`: passed.
- `npm run build`: passed. Vite reported its existing chunk-size advisory.
- `git diff --check`: passed.
- Focused Playwright: **14/14 passed** in two runs. Real Google Maps rendered fixture Site coordinates and clusters. Production-shaped fixture: **204 / 0 mapped** initially, then **175 mapped / 29 missing location** after updating only linked Site coordinates. Jobs remained unchanged. Explicit multi-site IDs, Site refresh, missing Site/coordinates, filters and record actions passed.
- Rendered address persistence checks used mocked Places selections with real local SQLite/JSON fixture persistence. Create Customer, Create/Edit Site, Edit Customer's Site link and both embedded Job creation paths passed. A saved Places fixture rendered on real Google Maps without a geocoding call.
- Legacy Leaflet tiles/markers/popup and Job Details interaction passed with fixture provider responses. No production legacy-map request was needed.
- Applied backfill tests used temporary/in-memory databases and fake provider responses only. No live Google Geocoding API request or real-data backfill was performed.

Browser commands used the existing local Vite at `http://localhost:5173` for live Google Maps, `ELSET_GOOGLE_MAPS_LIVE_TEST=1`, `ELSET_GOOGLE_MAPS_TEST_URL=http://localhost:5173`, and `ELSET_GOOGLE_PLACES_LIVE_TEST=1`:

```text
npx playwright test tests/e2e/google-maps-test.spec.mjs tests/e2e/google-places.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep "production-shaped|explicitly linked|live Google renders|live Site refresh|Legacy route keeps|Create Customer saves|Create/Edit Site|embedded Customer|saved Places fixture"
```

The additional run also set `ELSET_NAVIGATION_TEST_URL=http://localhost:5173`:

```text
npx playwright test tests/e2e/google-maps-test.spec.mjs tests/e2e/google-places.spec.mjs tests/e2e/site-navigation.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep "leaves a Job without|shows address-only|active address route.*edit-customer-site-link"
```

Production still needs an approved deployment and subsequent coordinate backfill/Site reconciliation. None was performed in this task.
