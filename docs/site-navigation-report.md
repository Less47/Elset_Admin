Shared Site navigation is implemented on `feature/google-maps-test`. Changes remain uncommitted. Nothing was pushed, merged or deployed.

> Historical report: this records an earlier migration stage. Current mapping uses Google only; retired routes and provider setup described below no longer apply. See [the cleanup report](geoapify-cleanup-report.md).

The pre-edit audit traced `/jobs/:jobId` through `App.jsx` to `JobDetailsPage.jsx`, whose sidebar and overview both rendered plain Site address text. `buildCustomerSites` resolves Sites within the selected customer by normalized address; jobs do not have a `siteId`. Sites carry optional `streetAddress` / `addressLine1`, `suburb` / `locality` / `city`, `state`, `postcode`, and coordinate metadata. `readSavedPosition` validates coordinate pairs, while `resolveJobMapPosition` preserves the existing Site-first behavior and explicitly cleared coordinates.

For `/map`, `WorkspaceShell.jsx` renders `GoogleJobsMap.jsx`. Its enriched jobs resolve the same customer/address relationship and use Site, existing cached, or Job coordinates according to the existing location helper. `groupJobsByPosition` already groups identical coordinates. The selected panel rendered an article per Job with Open Job and Open Site actions. No shared maps-launch or device-detection utility existed; workspace navigation helpers handle internal SPA routes, and the existing `window.open` calls handle document previews. `/map/legacy` is separately rendered by `JobsMapManager.jsx` and remains unchanged by this task.

1. **Shared helper and control.** `src/lib/site-navigation.js` provides `getNavigationLinks(destination, device)` and `jobNavigationDestination(job, site, position)`. Both screens use `SiteNavigationLink.jsx`; future actions can reuse the same control or link builder. The builder is synchronous and requires no key, SDK, geocoding request or data mutation. URLs use fixed HTTPS origins and `URLSearchParams`. Labels remain escaped React text and accessible labels, rather than being appended as provider search terms.

2. **Apple behavior.** iPhone, iPad and Mac prefer Apple Maps. Modern iPads presenting `Macintosh` / `MacIntel` are intentionally treated the same as Macs. The exact coordinate example is `https://maps.apple.com/?daddr=-37.7305%2C144.7428`. Only the destination is supplied, allowing Maps to use the current origin and preferred transport mode. This follows [Apple's documented directions parameters](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html).

3. **Android / non-Apple behavior.** Android, Windows and unknown platforms use `https://www.google.com/maps/dir/?api=1&destination=-37.7305%2C144.7428&dir_action=navigate`. Google documents app handoff on supported mobile devices, browser directions when the app is absent, and route preview when turn-by-turn navigation is unavailable. No custom URI scheme or default-app detection was added. See [Google Maps URLs](https://developers.google.com/maps/documentation/urls/guide).

4. **Web fallback.** On Apple, activating the primary link also reveals **Use Google Maps instead**, pointing to the same destination. This is an explicit fallback, not automatic app-install detection: a browser cannot reliably determine whether the external HTTPS link opened an installed application. No timer assumes handoff failure or opens a second destination unexpectedly. Unknown platforms go directly to Google's universal link. All links use `target="_blank" rel="noopener noreferrer"`, preserving the ELSET page and preventing access through `window.opener`.

5. **Job Details.** Both read-only Site fields now show an underlined address with a small navigation icon, visible keyboard focus and an accessible `Navigate to …` label. Phone/tablet links provide a minimum 44px tap height. The existing layout, editing controls, address autocomplete and stored address remain intact.

6. **Map pin panel.** A compact outline Navigate action sits beside Open Job / Open Site in the first selected Job article for each distinct coordinate pair. Coincident jobs share one action; a cluster containing different coordinates gets one action per location. The URL uses the resolved pin position, including coordinates already available from the existing cache. Renderer, clustering, filtering, zoom, pan and map CSS were not modified. Open Job, Back and Open Site were verified after navigating externally.

7. **Destination priority.** Complete, finite, in-range coordinates take priority, including zero and numeric strings. Next is the structured street plus available locality/state/postcode, then the formatted Site/Job address. A region alone does not replace a full formatted address. Explicitly cleared Site coordinates do not revive older Job coordinates. A coordinate-only record remains navigable. With no destination, the control shows `Navigation unavailable` without a link. Existing Site ownership is preserved; no new relationship is inferred for addressless records.

8. **Files changed in this task.**

   | File | Change |
   | --- | --- |
   | `src/lib/site-navigation.js` | Shared destination, platform and directions URL helpers |
   | `src/components/shared/SiteNavigationLink.jsx` | Accessible link/button and Apple fallback |
   | `src/components/jobs/JobDetailsPage.jsx` | Both read-only Site fields use the shared control |
   | `src/components/map/GoogleJobsMap.jsx` | One Navigate action per selected coordinate group |
   | `tests/site-navigation.test.js` | URL, platform, validation and data-priority tests |
   | `tests/e2e/site-navigation.spec.mjs` | Rendered-page, live-map, theme and platform checks |
   | `docs/site-navigation-report.md` | This audit and completion report |

   Prior uncommitted migration changes were preserved. The task-start hash audit is saved in `test-results/site-navigation/baseline.json`; the final comparison is in `test-results/site-navigation/diff-audit.json`.

9. **Tests and results.**

   - `node --test tests/site-navigation.test.js`: **8/8 passed**.
   - `npm test`: **325/325 passed**, including those eight tests.
   - `npm run lint`: **passed**.
   - `npm run build`: **passed**, with Vite's existing warning for chunks above 500 kB.
   - `git diff --check`: **passed** with the repository's normal Windows line-ending configuration.
   - Navigation Playwright suite: **26/26 passed** in 1.8 minutes. Includes all six themes, Windows desktop, iPhone, Android, iPad with desktop user agent, Mac, keyboard Enter, touch activation, safe new tabs, Google fallback, missing coordinates, missing formatted address, no destination, coincident jobs and multiple locations in a cluster.
   - Existing legacy-map regression: **1/1 passed**, covering Leaflet tiles, marker popup, Job Details and Back. Tile/geocoding responses in that regression are fixtures; it is not a live Geoapify service test.

   Commands for the browser checks:

   ```powershell
   $env:ELSET_GOOGLE_MAPS_LIVE_TEST='1'
   $env:ELSET_NAVIGATION_TEST_URL='http://localhost:5173'
   npx playwright test tests/e2e/site-navigation.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
   npx playwright test tests/e2e/google-maps-test.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --grep 'Legacy route keeps'
   ```

   Tests use isolated workspace API fixtures; no customer/site/job records were saved. Google map tests loaded the real Google SDK and map tiles on the existing allowed localhost referrer. The Sesame Street fixture deliberately gives the Job older coordinates, verifying that the saved Site pair `-37.7305,144.7428` wins. These are test fixture coordinates, not a new geocoding assertion about the address. External directions requests were intercepted after real link activation to inspect the new-tab destination. Device behavior was simulated in Chromium; physical Apple/Android app launch and third-party directions-page rendering remain unverified.

10. **Screenshots.** Captured under `test-results/site-navigation/`. Both pages were visually inspected in Midnight Signal, Elset Classic, Copper Dawn, Evergreen Ledger, Studio Rose and Desert Circuit. Phone and tablet screenshots show touch-sized controls and the Apple fallback without horizontal page overflow.

    - [Job Details, Midnight Signal](../test-results/site-navigation/job-midnight-signal-desktop.png)
    - [Map panel, Midnight Signal](../test-results/site-navigation/map-midnight-signal-desktop.png)
    - [iPhone Map with Google fallback](../test-results/site-navigation/map-iphone.png)
    - [Android Map](../test-results/site-navigation/map-android.png)
    - [iPad Map](../test-results/site-navigation/map-ipad-desktop-ua.png)
    - [iPad Job Details](../test-results/site-navigation/job-ipad-desktop-ua.png)

Business data, Site ownership, the legacy map, autocomplete, maintenance, calendar, invoices, quotes, auth, permissions and schema were not changed by this task.
