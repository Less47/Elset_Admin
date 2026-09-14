# Customer/Site address route correction

> Historical report: this records an earlier migration stage. Current mapping uses Google only; retired routes and provider setup described below no longer apply. See [the cleanup report](geoapify-cleanup-report.md).

Branch: `feature/google-maps-test`. Local, uncommitted changes only.

**Root cause:** the previous migration missed the Customer/Site creation forms embedded in **Create Job**. Their labels include **Add New Customer**, **Primary site address**, and **Add a new site**. They were incorrectly treated as Job-only address editing. This omission is now fixed.

1. **Exact warning source**

   `server-app.js:369` generates `Address lookup is not configured. Add GEOAPIFY_API_KEY ...` when `GET /api/address/autocomplete` has no Geoapify key. `src/components/shared/AddressAutocompleteInput.jsx` calls that endpoint at line 9, throws its error at line 16, catches it at line 94, and renders it at line 198.

   Before this correction, `src/components/jobs/CreateJobPage.jsx` imported that component and rendered it in the Site section, including the new Customer's primary Site. The regression test reproduced the exact warning in that rendered form before the fix, using a controlled response from the legacy endpoint. Evidence: `test-results/google-address-route-fix/embedded-new-before-fix.png`.

2. **Why the previous migration missed it**

   The first migration changed `CustomerFormPage` and `SiteWorkspace`, but deliberately retained Job address inputs. That classification overlooked the Customer and Site creation variants inside `CreateJobPage`. Its Site data also crosses a separate normalizer in `server-workspace-jobs.js`, which needed to preserve Places metadata through repeated normalization.

   The standalone `/customers/new` route was already using Google, both in source and in the modules served by the running Vite server. No stale-build explanation was needed to identify the embedded omission. The affected user tab itself was unavailable to browser inspection, so its exact URL was not established; the missed embedded path was independently reproduced and corrected.

3. **Actual routes and forms**

   `useWorkspaceNavigation.parseWorkspacePath` identifies the route. `App.jsx` renders `CustomerPages` for Customer/Site routes and `CreateJobPage` for `/jobs/new`. `WorkspaceShell` renders the selected workspace page. The Customer list's **New Customer** action calls the central navigator and opens `/customers/new`.

   | Entry | Rendered path | Result |
   | --- | --- | --- |
   | Create Customer | `/customers/new` → `CustomerPages` → `CustomerFormPage` → primary address | Google, previously migrated and reverified |
   | Create Site | `/customers/:id/sites/new` → `CustomerPages` → `SiteWorkspace` | Google, reverified |
   | Edit Site | `/customers/:id/sites/:siteId/edit` → `CustomerPages` → `SiteWorkspace` | Google, reverified |
   | Edit Customer address action | `/customers/:id/edit` → `CustomerFormPage` → **Open Site Profile** → **Edit Site Profile** → `SiteWorkspace` | Google, reverified |
   | Embedded new Customer | `/jobs/new` → `CreateJobPage` → **Add New Customer** → **Primary site address** | Corrected to Google |
   | Embedded new Site | `/jobs/new` → select existing Customer → **Change site** → **Add a new site** | Corrected to Google |

   Edit Customer itself has no editable address field. It retains its existing Site-profile action instead of adding a second address editor or changing ownership. Customer search remains ELSET customer data.

4. **Google component and failure behavior**

   All Customer/Site address-entry variants above now use `GoogleAddressAutocompleteInput`. The shared loader continues using `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`, with no second key and no Geoapify dependency for these forms.

   Missing key now has an explicit `GOOGLE_MAPS_KEY_MISSING` discriminator. The development field message starts **Google address lookup is not configured**, names `VITE_GOOGLE_MAPS_API_KEY`, and explains manual entry. A Places load/rejection failure instead says **Google Places address lookup could not be loaded**. Raw provider errors are not rendered. Production missing-key text stays user-facing and does not show local-file instructions.

   Manual entry and existing validation remain available. Save is temporarily disabled while a selected Place's Details resolves. The shared picker forwards blur validation and releases that pending state on unmount. Its address patch merges into the current Site draft, retaining other fields. The embedded SQLite Site normalizer now preserves structured address and coordinates through the existing `extra_json` slot. No schema, job status, ownership, or scheduling changes.

5. **Geoapify intentionally retained**

   `/map/legacy` remains `JobsMapManager` with its existing tile and geocoding handlers. Both that component and `server-app.js` match their task-start hashes. Geoapify configuration and dependencies are retained.

   The legacy address component/API remain for `JobDetailsPage`'s direct **job address** editor, which is outside Customer/Site creation and Site-profile editing. It is now the only source consumer of `AddressAutocompleteInput`. Repository searches found no legacy component, legacy autocomplete endpoint, or `GEOAPIFY_API_KEY` reference in Customer/Site components or `CreateJobPage`.

6. **Files changed in this correction**

   - `src/components/jobs/CreateJobPage.jsx` — migrate embedded Customer/Site input and guard pending Details.
   - `src/components/shared/GoogleAddressAutocompleteInput.jsx` — provider-specific messages, blur forwarding, pending-state teardown.
   - `src/components/map/google-maps-loader.js` — missing-key discriminator and address-specific messages; Map messages retained.
   - `server-workspace-jobs.js` — preserve Site metadata in its existing normalization path only.
   - `tests/e2e/google-places.spec.mjs` — route, missing-key, embedded save, and live `33 garr` regressions.
   - `docs/google-places-migration-report.md` — add a correction notice linking here.
   - `docs/google-address-route-fix-report.md` — this report.

7. **Verification and results**

   - `npm test`: **317 passed**.
   - `npm run lint`: passed.
   - `npm run build`: passed; existing large-main-chunk warning remains.
   - `git diff --check`: passed.
   - Places suite: **21 cases verified**. The final full run had 20 passing cases and one live test interrupted by a Vite page reload (the typed input became empty and the trace reported navigation). That exact case passed on rerun without another source change.
   - Focused follow-up: **9 passed in 25.3 seconds** — the rerun above, four existing Create Job contact/spacebar/save tests, and four map tests covering legacy rendering, missing Google key, blocked Google load, and authentication failure. There are **29 distinct passing browser checks** across the final runs.
   - Live Google suggestions for `33 garr` passed on all six entry paths in the table, including both previously missed embedded forms. Provider responses were HTTP 200 and legacy autocomplete request counts were zero.
   - Real Places selection/Details, saved Site coordinates and live Google `/map` passed. The previous `SERVICE_DISABLED` configuration blocker did not recur in successful live checks. No Google project/key settings were changed by this work.
   - Embedded new/existing Customer save tests use actual server persistence functions with isolated SQLite fixtures, and verify saved suburb/state/postcode/latitude/longitude. Dedicated Customer creation also exercises JSON storage.
   - `/map/legacy` interaction passed with controlled Geoapify-style tiles/geocode responses. This validates the retained renderer; it is not a claim of live Geoapify service availability.
   - Final hash audit: local `data/app-data.json`, legacy map source and legacy server handlers unchanged. No literal browser key in Git-visible files; `.env.local` remains ignored. No commit, push, merge or deployment.

   Commands:

   ```powershell
   npm test
   npm run lint
   npm run build
   git diff --check
   $env:ELSET_GOOGLE_PLACES_ACTIVE_URL='http://localhost:5173'
   $env:ELSET_GOOGLE_PLACES_LIVE_TEST='1'
   npx playwright test tests/e2e/google-places.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
   npx playwright test tests/e2e/google-places.spec.mjs tests/e2e/google-maps-test.spec.mjs tests/e2e/create-job-contact.spec.mjs --grep 'live Places selection|Legacy route|missing key has|blocked Google request|Google authentication failure|Site Contact|Create Job' --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
   ```

Screenshots and redacted response summaries are under `test-results/google-address-route-fix/`. The original warning and live corrected forms were visually inspected.

- `embedded-new-before-fix.png` — reproduced old warning in the embedded Primary site field.
- `live-embedded-new-customer-33-garr.png` — corrected embedded new Customer, actual Google suggestions.
- `live-embedded-new-site-33-garr.png` — corrected embedded new Site.
- `live-create-customer-33-garr.png` — standalone New Customer action and Google suggestions.
- `live-create-site-33-garr.png` — standalone new Site.
- `live-edit-site-33-garr.png` — existing Site edit.
- `live-edit-customer-site-link-33-garr.png` — Edit Customer's Site-edit path.
- `missing-google-key.png` — correct Vite key configuration message.
- `diff-audit.json` — changed-file, key-scan and preservation evidence.

These are isolated test records rendered by the active local client; no user business records were changed.
