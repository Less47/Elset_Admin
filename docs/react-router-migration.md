# React Router migration

Completed locally on 2026-09-28. No push, deployment, production access, database/schema change, or backend/API change was made. The working tree was clean before this work; the existing local commit was preserved.

## Routing

Installed `react-router@8.4.0`. Its peer requirements need React 19.2.7 or newer, so React and React DOM were updated from 19.2.4 to 19.2.7. Unrelated dependency updates were removed. React Router's Node requirement is >=22.22.0; local verification used Node 24.19.0.

`src/main.jsx` creates a browser data router and renders `RouterProvider`. `src/routes.js` declares the nested workspace tree. `AppEntry` retains lazy application loading and the public legal-page boundary. `App` retains session/data ownership and passes existing workspace data/actions to record route elements through `Outlet`.

Preserved URLs:

```text
/
/customers
/customers/new
/customers/:customerId
/customers/:customerId/edit
/customers/:customerId/sites/new
/customers/:customerId/sites/:siteId
/customers/:customerId/sites/:siteId/edit
/jobs/new
/jobs/:jobId
/jobs/:jobId/quote
/jobs/:jobId/invoice
/maintenance
/maintenance/new
/maintenance/:planId
/maintenance/:planId/edit
/invoices
/invoices?customerId=...
/map
/settings
/legal/terms
/legal/privacy
```

Sites, Calendar, Job History, Staff, Parts Inventory, Statistics, and Recycle Bin retain their existing `/` URL and identify the active section through React Router location state. Unknown workspace paths retain the Service Board fallback. Legal pages remain public, including trailing-slash URLs.

Pages use `useParams`, `useMatches`, `useLocation`, and `useNavigate`; invoices use `useSearchParams`. Permissions remain at the existing session, component, and server boundaries. Back buttons use the in-app origin when present and explicit parent destinations for direct-loaded records. Browser Back/Forward is owned entirely by React Router.

## Cleanup and small retained helpers

Deleted `src/hooks/useWorkspaceNavigation.js` and `tests/workspace-navigation.test.js`. Removed the parser, global route object, direct history writes, popstate listener, history-index bookkeeping, blocked-pop flags, navigation props, and duplicate selected-job state. No replacement router facade was introduced. A final source search found none of that legacy routing code.

Only narrow supporting behavior remains:

- `record-link-state.js` creates return-label/source-section metadata. It neither matches routes nor performs navigation/history operations.
- `UnsavedChangesProvider` uses one `useBlocker` for SPA navigation and the unchanged ELSET dialog. `useUnsavedChanges` supplies draft state, acknowledges successful saves, and attaches `beforeunload` only while needed. The provider also guards non-route actions such as Settings tabs and sign-out.
- `WorkspaceShell` restores keyboard focus to the prior Service Board control. React Router `ScrollRestoration` handles scroll positions; no custom scroll/history manager remains.
- The pre-existing external accounting redirect and newly discovered invoice reload remain business-specific full-page operations.

## Verification

- `npm test`: **729 passed, 0 failed**.
- `npm run lint`: **passed**.
- `npm run build`: **passed**.
- `git diff --check`: **passed**.
- **53 distinct relevant Playwright tests passed across the main run and focused reruns.** The main run passed 46/53. Its seven failures were resolved with test updates and verified in focused reruns; the final maintenance/layout rerun passed 7/7, and the account/dirty-form tests passed in their rerun.

Browser coverage included all 20 workspace URLs loaded directly and refreshed; encoded params and query strings also have route/state unit coverage. It verified browser Back/Forward, direct parent fallbacks, Customer/Site/Edit and Customer/Job returns, Service Board/Job/Invoice/Back/Back, scroll restoration within 20 pixels, focus restoration, dirty-form Stay/Discard, browser refresh protection, failed/pending saves, Settings guards, technician/office/admin restrictions, login/session/logout, and public legal pages.

The focused browser selection covered `customer-workspaces`, `customer-account`, `document-workspaces`, `maintenance-calendar`, `mobile-navigation-service-board`, `theme-settings`, and `public-legal-pages`, using:

```text
npx playwright test --config=playwright.config.mjs --tsconfig=tsconfig.app.json ... --workers=1
```

Test repairs wait for committed URLs before refreshing and for dialog dismissal before replacing field text. Existing invoice-list expectations were corrected to exclude unissued drafts/quote-only jobs, and the old desktop-header inset assertion was aligned with the already-existing edge-to-edge header. No invoice-list/accounting logic or layout styles were changed.

This was local verification with synthetic fixtures and temporary databases. The entire unrelated Playwright suite and live external integrations were not run. No unresolved migration issue remains.

## Local commits

1. `f0693ab` — Add React Router route foundation
2. `2761376` — Migrate application navigation to React Router
3. Remove legacy navigation system — contains final cleanup, regression coverage, and this report.

## Files

Added:

- `src/routes.js`
- `src/components/jobs/JobRoutePages.jsx`
- `src/components/workspace/UnsavedChangesProvider.jsx`
- `src/components/workspace/unsaved-changes-context.js`
- `src/lib/record-link-state.js`
- `tests/react-router-routes.test.js`
- `docs/react-router-migration.md`

Modified:

- `package.json`, `package-lock.json`
- `src/main.jsx`, `src/AppEntry.jsx`, `src/App.jsx`
- `src/components/app/WorkspaceShell.jsx`
- `src/components/customers/CustomerPages.jsx`, `src/components/customers/CustomerFormPage.jsx`
- `src/components/sites/SiteWorkspace.jsx`
- `src/components/jobs/CreateJobPage.jsx`, `src/components/jobs/JobDetailsPage.jsx`
- `src/components/documents/DocumentEditor.jsx`
- `src/components/maintenance/MaintenancePlanPage.jsx`
- `src/components/settings/SettingsDraftScope.jsx`, `src/components/settings/SettingsManager.jsx`
- `src/components/settings/PriceListSettings.jsx`, `src/components/settings/AccountingSettings.jsx`
- `src/hooks/useWorkspaceActions.js`
- `tests/page-workspace-architecture.test.js`
- `tests/e2e/customer-workspaces.spec.mjs`, `tests/e2e/customer-account.spec.mjs`
- `tests/e2e/document-workspaces.spec.mjs`, `tests/e2e/maintenance-calendar.spec.mjs`
- `tests/e2e/mobile-navigation-service-board.spec.mjs`

Deleted:

- `src/hooks/useWorkspaceNavigation.js`
- `tests/workspace-navigation.test.js`
