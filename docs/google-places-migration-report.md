# Customer and Site Google Places migration

Branch: `feature/google-maps-test`. Changes are local and uncommitted. No push, merge or deployment.

**Follow-up correction:** The initial audit missed Customer/Site creation embedded in `/jobs/new`. Those fields have now been migrated too, and live Google Places suggestions and Details now pass. The service-disabled result below records the earlier run. See [the corrective audit and verification report](google-address-route-fix-report.md) for the current route coverage and results.

The implementation and controlled checks are complete. **Live autocomplete verification is blocked by Google configuration:** the configured browser key's project returns HTTP 403 / `SERVICE_DISABLED`, stating that **Places API (New) is disabled or has not been used**. Key restrictions and Google Cloud configuration were left unchanged. Manual entry works during this failure. A Site saved from a controlled Places response was separately verified on the live Google map.

1. **Existing architecture, audited before edits.** `AddressAutocompleteInput.jsx` debounced queries to authenticated `GET /api/address/autocomplete`; `server-app.js` forwarded them to Geoapify. Create Customer and Create/Edit Site used that component. Job create/edit also use it. Geoapify geocoding remains behind `/api/map/geocode` for Leaflet. `/api/map/locations` only reads the existing cache. Create Customer builds a primary Site through `handleCreateCustomer`. Edit Customer edits account/contact data and links to the Site profile for address changes. A Site's required field is its display `address`; Customer creation requires its name. Those rules remain.

2. **Shared component.** Added `GoogleAddressAutocompleteInput.jsx`, used by Customer primary address and both Site editing modes. It owns suggestions, loading/errors, keyboard/touch selection, response cancellation by revision, and normalized address output. An unfinished Details request temporarily disables Save; typing again cancels its authority to update the draft. Other form changes are preserved when Details resolves.

3. **Modern API.** The existing singleton Maps loader now also loads the `places` library, without creating a map. The component uses `AutocompleteSuggestion.fetchAutocompleteSuggestions()`, `AutocompleteSessionToken`, and prediction `toPlace().fetchFields()`. Details requests only `addressComponents` and `location`. Search begins after three trimmed characters and a 250 ms debounce, only on typing; opening/focusing a saved record performs no lookup. A token spans the typing session and is discarded after selection or dismissal. Requests have a 12-second timeout and stale responses cannot overwrite later input. This follows Google's [Autocomplete Data API](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data).

4. **Exact stored fields.** The Site owns `address`, `streetAddress`, `suburb`, `state`, `postcode`, `latitude`, `longitude`. Existing code already supported optional `streetAddress`, `addressLine1`, `suburb`, `city`, and `locality`; the Google map already recognized `latitude`/`longitude` and legacy aliases. There were no dedicated state/postcode/coordinate SQL columns. `state`, `postcode`, and the canonical coordinate pair now survive normalization as optional Site metadata in the existing SQLite `extra_json` slot or JSON Site record. No schema migration. `customer.address` remains the primary Site's display-address copy; coordinates are not duplicated onto the Customer. No Google place ID is persisted: there was no dedicated provider-ID slot or current consumer requiring it. Prediction IDs remain transient.

5. **Structured mapping.** `street_number` + `route` form `streetAddress`, prefixed with `Unit <subpremise>/` when provided. Suburb preference is `locality`, then `postal_town`, then `sublocality_level_1` / `sublocality`. State uses Google's short state component, with full Australian state names mapped to abbreviations. Postcode stays a string. Display is `streetAddress, suburb STATE postcode`, without appending Australia. Suburbs keep their normal casing. Searches restrict results to `includedRegionCodes: ["au"]`, with a 50 km Melbourne bias that does not exclude other Australian locations. Details must identify Australia. See Google's [request fields](https://developers.google.com/maps/documentation/javascript/reference/autocomplete-data).

6. **Coordinates and persistence.** Valid selection stores a finite, range-checked numeric coordinate pair with the structured address. Frontend Site normalization, merging, list/profile projection, draft creation, JSON server normalization, and SQLite saves all preserve it. Current saved Site coordinates take priority over older Geoapify cache or job coordinates on `/map`. Job lookup remains customer ID plus normalized address; no new Site/job relationship was introduced. No Google Geocoding API or duplicate Geoapify geocoding call was added.

7. **Manual entry.** Users can still save any nonempty Site address, including a PO box or unit address that Google cannot resolve. Lookup failure is a compact status message, not a form crash. A result without a complete street location cannot invent coordinates; manual entry or another result remains available. Existing saved Sites display directly from ELSET data without contacting Google.

8. **Stale coordinates.** Material manual changes clear the canonical coordinate pair and any previous structured components. Casing/whitespace-only changes preserve metadata. Selecting another address replaces it with that result's metadata. Explicit cleared coordinates also prevent the map from falling back to stale job/legacy coordinate aliases. A cache result for the current address may still be used. Untouched legacy records do not acquire empty metadata simply by being normalized.

9. **Customer flows.** Create Customer saves the selected primary Site through the existing customer-creation action in both SQLite and JSON modes. Edit Customer remains account/contact-only and continues linking to the Site profile. Customer search remains entirely ELSET data.

10. **Site flows and preservation.** Create/Edit Site share the same picker. Opening a form does not query Google or clear coordinates. Save/reload retains selected metadata. The audit also found that existing Site drafts discarded `label`, and repeat SQLite normalization nested optional metadata; both preservation paths were corrected. Contacts, assets, OC numbers, ownership, primary-address handling and existing address-reference synchronization are retained. Maintenance continues selecting an existing Site and using the unchanged naming function: `14 Sesame Street CAROLINE SPRINGS`, with the entire suburb. Recurrence logic was not changed.

11. **Geoapify retained.** Removed its autocomplete usage only from Customer and Site forms. The original shared Geoapify component, Job address fields, API routes, cache, environment settings, Leaflet dependencies and `/map/legacy` remain. The custom Google suggestion dropdown follows ELSET theme tokens, with separate visible Google Maps attribution. The compact attribution follows Google's [text-attribution guidance](https://developers.google.com/maps/documentation/places/web-service/policies).

12. **Required Google setup.** Use the existing `VITE_GOOGLE_MAPS_API_KEY`. Enable **Maps JavaScript API** and **Places API (New)** in its project, allow those APIs on the key, and keep the approved website referrer restrictions. No second key and no Geocoding API are needed. The current live blocker specifically reports `SERVICE_DISABLED` for Places API (New). After enabling it and allowing propagation, rerun the live test below. No key value is hardcoded or logged by the app; `.env.local` remains ignored. Vite embeds the browser key in client assets by design. Source scans found no literal key.

13. **Files changed by this task.** Earlier uncommitted map work was preserved. This task changes:

    - `.env.example`
    - `server-store.js`
    - `server-workspace-customers.js`
    - `src/components/customers/CustomerFormPage.jsx`
    - `src/components/sites/SiteWorkspace.jsx`
    - `src/components/shared/GoogleAddressAutocompleteInput.jsx` (new)
    - `src/components/map/google-maps-loader.js`
    - `src/components/map/google-map-data.js`
    - `src/components/map/GoogleJobsMap.jsx`
    - `src/hooks/useWorkspaceActions.js`
    - `src/lib/app-support.jsx`
    - `src/lib/site-location.js` (new)
    - `src/lib/google-place-address.js` (new)
    - `tests/google-place-address.test.js` (new)
    - `tests/e2e/google-places.spec.mjs` (new)
    - `docs/google-places-migration-report.md` (new)

14. **Tests and observed results.** `npm test`: **317 passed**. `npm run lint`: passed. `npm run build`: passed, with the existing large-main-chunk warning. `git diff --check`: passed. The new browser suite has **six controlled workflow tests passing**, plus a separate **live Google map test passing** using a Site saved from a controlled Places response (7 passed in 22.0 seconds). Existing Customer creation/editing, Site assets/editing/dirty guards, legacy map, and Google missing-key/blocked-request/auth-error regressions also passed (6 passed in 14.4 seconds). That is **13 passing browser checks**. The real Places autocomplete test fails on the external `SERVICE_DISABLED` response; successful real Places selection/Details remains unverified. Browser writes use isolated in-memory SQLite or isolated JSON state, and existing customer regression tests use temporary databases. No test writes to the user's workspace. The saved local `data/app-data.json` hash is unchanged. The diff audit found no changes in invoice/quote, job status, Maintenance recurrence, Service Board, auth/permissions, PDF, or Fly logic.

    Coverage includes Customer primary Site creation in both storage modes, Site create/edit/save/reload, untouched existing coordinates and other Site data, unit/highway addresses, three multi-word suburbs, leading-zero postcode, manual PO box, missing geometry, provider failure, Arrow Up/Down/Enter/Escape, spaces, debounce, session renewal, Details cancellation, save-pending behavior, touch selection, a 390 px viewport, and Midnight Signal. Mobile testing uses browser touch emulation; a physical phone's software keyboard was not tested.

    Commands used:

    ```powershell
    npm test
    npm run lint
    npm run build
    git diff --check
    $env:ELSET_GOOGLE_PLACES_LIVE_TEST='1'
    npx playwright test tests/e2e/google-places.spec.mjs --grep-invert 'live Places selection' --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
    npx playwright test tests/e2e/customer-workspaces.spec.mjs tests/e2e/google-maps-test.spec.mjs --grep 'Customer create and edit|Site creation, assets|Legacy route|missing key has|blocked Google request|Google authentication failure' --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
    ```

    Rerun the currently blocked end-to-end live test after the project enables Places API (New):

    ```powershell
    $env:ELSET_GOOGLE_PLACES_LIVE_TEST='1'
    npx playwright test tests/e2e/google-places.spec.mjs --grep 'live Places selection' --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
    ```

    The live URL defaults to `http://localhost:5173`, where the configured referrer works for Maps. Traces/videos are disabled to avoid capturing key-bearing provider request URLs.

15. **Screenshot paths.** Captured under `test-results/google-places/` (ignored artifacts). Customer selection, edited Site, mobile Midnight dropdown, live fallback, and saved-fixture live map screenshots were visually inspected.

    - `customer-selected-sqlite.png` — controlled Places selection, Create Customer.
    - `customer-selected-json.png` — same flow in JSON mode.
    - `site-edited.png` — edited Site with complete Brighton East suburb.
    - `manual-fallback.png` — simulated provider failure with manual save available.
    - `mobile-midnight-suggestions-390x844.png` — touch-tested unit result, dark dropdown and visible attribution.
    - `live-google-unavailable.png` — actual Google service-disabled fallback.
    - `saved-places-fixture-live-map.png` — actual Google map using the saved fixture Site's coordinates, no Geoapify geocode request.
    - `live-diagnostics.json` — redacted Google failure evidence.
    - `diff-audit.json` — task-local changed-file list, key scan and local-data hash result.

This report supersedes earlier map-stage statements that Places was unused or saved Sites could not retain coordinates. Those earlier reports describe their original stages.
