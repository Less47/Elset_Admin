# Add-ons and Job Costing

## Scope and audit

This change adds a shared catalogue for built-in optional modules and implements Job Costing as the first module. Job Costing is disabled by default. No other optional modules, accounting integrations, timesheets, reporting suite, or application rebrand are included.

All work is local. Nothing has been committed, pushed, deployed, or applied to production data. The existing uncommitted completed-maintenance Calendar work is preserved.

## Add-ons

### Shared state and registry

- The existing SQLite `settings` key/value table stores one `addons` JSON object, for example `{"jobCosting":true}`. This is a company/workspace setting, not an account preference.
- An absent key means the registry's disabled default. Migration does not need to populate or rewrite existing settings.
- `src/lib/addons.js` owns `ADDONS`, `ADDON_LIST`, normalization, and `isAddonEnabled(addons, key)`. Each registry entry supplies its name, description, includes list, and disable-confirmation text. Future modules can use the same catalogue and persistence shape.
- `useWorkspaceAddons` reads and updates the server state, refreshes on workspace/navigation changes and window focus, and checks visible sessions every 30 seconds. It does not persist availability in browser storage or personal preferences. Session-scoped requests prevent a late response from a previous account replacing the current account's state.
- The focused add-ons endpoint validates known registry keys and boolean values. The generic settings PATCH rejects `addons`, so it cannot bypass that validation. Existing shared settings reset groups do not contain this key. Broad workspace saves remain prohibited in SQLite mode.

### Settings UI and disable behaviour

The existing Settings navigation now contains **Add-ons**. It renders a compact built-in module row with the description, included functions, enabled/disabled badge, and switch. Disabling presents **Cancel** and **Disable** with an explicit data-preservation message. A successful toggle updates the current session immediately.

Disabling hides the Job Details Costing tab and blocks every costing read/write endpoint with HTTP 403 and `code: "ADDON_DISABLED"`. It changes only the shared setting. It does not delete cost records, drop tables, alter jobs, or modify commercial documents. Re-enabling reads the same stored entries.

### Permissions

The application already permits `admin` and `office` to change shared workspace settings and edit general Job details. These roles can toggle add-ons and read/create/edit/delete costs. Job Details already hides commercial document controls from technicians; costing follows that existing commercial access boundary. Technicians cannot call the costing endpoints. Authenticated users may read shared add-on availability.

The current application gives admin/office access to all active Jobs; there is no additional job-specific ownership permission. Every costing request checks the actual Job record. Cost entry updates/deletes select by both entry ID and Job ID, so a cost from another Job cannot be changed through a different Job URL.

## Job Costing model

Each `job_cost_entries` row belongs to one Job through a foreign key. Unlimited rows can be stored per Job; no material/labour total fields were added to Jobs.

| Column | Meaning |
| --- | --- |
| `id`, `job_id` | Entry identity and owning Job |
| `category` | Stable category key, constrained by the database |
| `description` | Required description |
| `quantity_micros` | Positive quantity scaled by 1,000,000 |
| `unit_cost_cents`, `total_cost_cents` | Non-negative integer cents, excluding GST |
| `supplier`, `cost_date`, `notes` | Optional supporting details |
| `created_by` | Authenticated creator ID, without a cross-database auth foreign key |
| `created_at`, `updated_at` | Creation and last-edit timestamps |

Categories are Materials (`materials`), Labour (`labour`), Subcontractors (`subcontractors`), Sundries (`sundries`), Plant / Equipment (`plantEquipment`), Travel (`travel`), and Other (`other`).

Quantity supports up to six decimal places and must exceed zero. Unit cost accepts non-negative integer cents, including zero. The UI accepts dollars with up to two decimal places. Shared parsing uses decimal text and BigInt intermediates; each line rounds half-up to the nearest cent, matching existing invoice line arithmetic. Numeric text length and safe-integer limits are checked before persistence. The server recalculates totals and rejects client-supplied IDs, totals, creator fields, other protected fields, malformed dates, unknown categories, and invalid quantities/money.

Version 1 does not support negative costs/credits or finalisation/locking. Labour is entered manually using actual internal cost; invoice charge-out rates are never copied into labour cost. Future sources such as timesheets can create proper entries without replacing this model.

## Accounting definitions and existing discoveries

### Revenue and invoice eligibility

**Revenue is the sum of ex-GST line subtotals from qualifying active invoice records linked to exactly this Job.** It never comes from a quote, Job price, estimate, payment total, or manually entered revenue.

The existing Customer Account eligibility rule was extracted into `isQualifyingActualInvoice` and reused:

1. The invoice must have actual invoice send history or a positive recorded payment.
2. Explicit legacy void, cancellation, and deletion markers exclude it.
3. Deleted invoices reside in the separate archive and are not queried.

An unpaid, unsent draft contributes no revenue even if its due date is in the past. An invoice with a recorded deposit qualifies. Fully paid invoices remain revenue; only the Customer Account outstanding list applies the additional positive-balance filter. No existing account behaviour was changed.

**Existing architecture constraint:** the current `invoices.job_id` database column is UNIQUE, and the application exposes one live invoice per Job. This change does not rebuild the invoice table or redesign document creation. The costing query reads all invoice rows for the selected Job, and its projection aggregates multiple distinct invoices while deduplicating invoice IDs. Both the projection and the SQL summary are tested with multiple invoices; the SQL test uses connection-local temporary views and leaves the production constraint unchanged. Creating multiple live invoices for one Job remains outside the existing document architecture.

### Quotes, cash and GST

- **Quoted** is the current linked quote's ex-GST subtotal, shown only as a comparison. An absent quote is indicated separately using `quoteCount`; a quote-only Job has zero Revenue.
- **Invoiced** equals qualifying invoice Revenue, excluding GST.
- **Variance** is Invoiced minus Quoted and is absent when there is no quote.
- **Paid** sums authoritative payment rows for the qualifying invoices. **Outstanding** sums each invoice's existing non-negative balance calculation. These figures include GST and are explicitly labelled as cash/receivable figures in the UI.
- Invoice and quote subtotals, per-line rounding, GST, payments, and balances use `invoiceFinancialsFromRows`. The existing application applies 10% GST to the document subtotal. Cached Job/document totals are ignored.
- Direct costs must be entered **excluding GST**. Version 1 collects an ex-GST unit cost; it does not guess whether an entered amount includes tax or implement tax-credit accounting.

### Profit and margin

`grossProfitCents = revenueCents - totalCostCents`

`marginPercent = grossProfitCents / revenueCents * 100`, displayed to one decimal place.

Totals and subtraction use checked integer cents. Percentage calculations use integer intermediates before producing the displayed decimal. Zero Revenue returns a null margin and the UI shows a dash, avoiding NaN/Infinity. Payments do not change gross profit or margin.

## Job Details UI

When enabled for an authorised user, **Costing** appears in the existing Job Details tabs. Its compact layout contains:

- Revenue, Total Costs, Gross Profit, and Margin as the strongest metrics.
- Separate Quoted, Invoiced, Paid, Outstanding, and quote/invoice variance figures with their GST basis labelled.
- Category breakdown and a simple Revenue minus Costs profit summary.
- A dense desktop cost list with unobtrusive Edit/Delete actions.
- An Add/Edit dialog for category, description, quantity, ex-GST unit cost, supplier, date, and notes, with an exact live total.
- A small deletion confirmation. Successful mutation responses replace the summary and entries together.

Phone layouts stack the summary and use compact entry cards. Tablet summaries use a two-column arrangement where needed, and the entry table reserves enough width for 44-pixel touch actions without covering totals. Desktop retains the normal Job Details workspace. Components use semantic theme tokens, including positive/negative profit treatments. Theme and viewport verification results are recorded below.

## API contracts

All responses set `Cache-Control: no-store`. Reads open the database read-only, and request handlers do not run schema migrations.

| Method and route | Access and result |
| --- | --- |
| `GET /api/settings/addons` | Authenticated; `{ok:true,result:{jobCosting:boolean}}` |
| `PATCH /api/settings/addons` | Admin/office; strict `{jobCosting:boolean}` patch; returns saved availability |
| `GET /api/jobs/:id/costing` | Admin/office plus enabled module; current summary and entries |
| `POST /api/jobs/:id/costs` | Admin/office plus enabled module; creates entry and returns recalculated summary |
| `PATCH /api/jobs/:id/costs/:costId` | Same; partial entry update and recalculated summary |
| `DELETE /api/jobs/:id/costs/:costId` | Same; removes entry and returns recalculated summary |

Cost write fields are `category`, `description`, `quantity`, `unitCostCents`, `supplier`, `costDate`, and `notes`. A quantity is sent as decimal text. No whole-Job or whole-workspace save is used.

The summary includes `jobId`, `revenueCents`, `quotedCents`, `invoicedCents`, `paidCents`, `outstandingCents`, `totalCostCents`, `grossProfitCents`, `marginPercent`, `quoteCount`, `invoiceCount`, `varianceCents`, `categories`, and `entries`.

Legacy JSON mode reports disabled add-ons and does not permit module mutations. Job Costing uses the production SQLite persistence path.

## Migration, preservation and activity

`WORKSPACE_SCHEMA_VERSION` advances exactly once: **7 -> 8**.

Migration 8 adds only `job_cost_entries`, `idx_job_cost_job_date(job_id, cost_date)`, and `idx_job_cost_category_date(category, cost_date)`, then records the new version through the existing migration machinery. It does not rebuild Jobs, Invoices, or Quotes. Existing startup migrations execute transactionally under a write lock, update all schema metadata consistently, refuse downgrade, and do not reapply after restart. Feature toggles do not execute DDL.

The existing Job/customer recycle-bin flows physically remove Jobs after archiving them. Their new hooks preserve cost rows in the existing deleted-Job archive metadata and restore those rows when the Job is restored, even while Job Costing is disabled. The ServiceM8 import's Job replacement also snapshots/restores existing costs within its transaction.

SQLite backup/restore bundles contain the complete database, including cost rows, archive metadata, and add-on state; backup validation now requires the cost table. Ordinary frontend workspace/Job projections intentionally omit cost data. The legacy JSON workspace projection is not a Job Costing backup format.

The application has no general persisted Job activity ledger for arbitrary operational events. This change retains entry creator and timestamps rather than creating a new activity framework or logging full financial payloads.

## Files changed for this feature

### Shared framework and backend

- `src/lib/addons.js` — registry and availability helpers.
- `src/lib/job-costing.js` — categories, exact arithmetic and summary projection.
- `src/lib/invoice-account.js` — shared invoice eligibility with unchanged account semantics.
- `server-workspace-db.js` — additive schema 8 migration.
- `server-workspace-addons.js`, `server-addon-routes.js` — shared persistence and API.
- `server-workspace-job-costing.js`, `server-job-costing-routes.js` — cost validation, CRUD, summary and API.
- `server-workspace-settings.js` — reserve add-on updates for the validated endpoint.
- `server-workspace-backup.js` — require the new table in SQLite backup validation.
- `server-workspace-jobs.js`, `server-workspace-customers.js` — cost preservation through recycle-bin flows; prior Calendar edits are retained.
- `server-workspace-servicem8-import.js` — preserve costs through imported Job replacement.
- `server-app.js` — register the new route groups.

### Frontend

- `src/hooks/useWorkspaceAddons.js` — server-sourced availability and toggles.
- `src/components/settings/AddonsSettings.jsx`, `src/components/settings/SettingsManager.jsx` — catalogue and Settings section.
- `src/components/jobs/JobCostingTab.jsx`, `src/components/jobs/JobDetailsPage.jsx` — optional Costing workspace and tab.
- `src/App.jsx`, `src/components/app/WorkspaceShell.jsx`, `src/lib/app-support.jsx` — shared availability and native Settings/Job integration.

### Verification and documentation

- `tests/job-costing.test.js` — arithmetic, commercial data, API, permissions, preservation and backup checks.
- `tests/e2e/job-costing.spec.mjs` — Add-ons and Job Details workflow/layout coverage.
- `fixtures/workspace-schema-v7.sql`, `tests/workspace-schema-upgrade.test.js`, `tests/workspace-migration.test.js` — frozen schema-7 fixture and forward/restart migration verification.
- `tests/maintenance-recurrence.test.js` — account for the new table when reconstructing its legacy schema fixture; existing Calendar behavior tests are preserved.
- `tests/e2e/document-workspaces.spec.mjs` — correct three stale invoice-navigation assertions to the existing canonical `/invoices` route.
- `tests/e2e/mobile-navigation-service-board.spec.mjs` — refresh stale selectors against existing screen behavior and isolate screenshot directories during concurrent test runs.
- `docs/addons-job-costing.md` — this report.

## Verification

- `npm test`: **421 passed, 0 failed**, approximately 6.6 seconds. Captured in `test-results/addons-job-costing-unit.log`.
- Focused backend lint: passed for all new backend/shared files and modified persistence files at that check.
- Existing Job/customer/shared-settings/Customer Account checks: 52 passed; ServiceM8 import regression: 9 passed.
- New feature and migration checks include disabled-default state, shared persistence, role enforcement, feature-disabled CRUD, cost preservation across disable/re-enable and recycle-bin restore, ServiceM8 replacement and rollback, exact quantities/cents, aggregate overflow rollback, quote-only zero Revenue, invoice eligibility, partial/full payment effects, multiple invoice projections, other-Job exclusion, input rejection, SQLite backup restoration, genuine schema-7 forward migration, restart, rollback and downgrade refusal.
- `npm run lint`: passed with no warnings or errors.
- `npm run build`: passed, with the existing bundle-size advisory.
- All **23 Add-ons/Costing browser tests** pass, including the six-theme matrix at 390, 820 and 1440 pixels, shared enablement, CRUD, cancel, failed-save retry, disabling during an open draft, cross-session hide/re-enable, and permissions. The final run also passed all 34 Service Board and 34 Settings/theme tests: **91 passed** together. Log: `test-results/addons-job-costing-final-e2e.log`.
- Representative Add-ons catalogue, desktop Costing, Midnight Signal phone/tablet/desktop, and phone cost-editor screenshots were visually inspected. Tablet action widths were corrected after visual inspection, then rechecked with an assertion that action buttons cannot overlap row totals. Screenshots: `test-results/job-costing/`.
- The wider regression covers Calendar, Maintenance, job creation, Job Details/documents, PDFs, payments, Customer Account, mobile navigation, shared settings, and personal preferences. Initial runs encountered stale existing assertions for canonical Invoice URLs, recycle-bin tab names, and current Maintenance/customer/site screens, plus a test that assumed List view despite the same account having saved Grid view. Test expectations/setup were aligned with unchanged application behavior; no product navigation or record layouts were changed for those assertions.
- Across the completed runs and targeted rechecks, **226 distinct browser tests passed**: Calendar 42; job creation/contact 4; Customer Account 5; document workspaces 40; Add-ons/Costing 23; Maintenance 24; mobile navigation/records 20; Service Board 34; Settings/themes 34. This is a combined result, not one uninterrupted 226-test run.
- `git diff --check`: passed.

### Browser commands and evidence

All Playwright commands used `--config=playwright.config.mjs --tsconfig=tsconfig.app.json`. The nine suites listed above were first run together with two workers. After resolving stale assertions, interrupted suites and affected tests were run separately; already-passing behavior was retained as evidence.

- Initial regression: `test-results/addons-job-costing-e2e.log` (124 passed before the stale Invoice/recycle-bin assertions stopped the run).
- Maintenance/mobile continuation: `test-results/addons-job-costing-remaining-e2e.log` (24 passed before further stale mobile assertions); final phone/tablet Maintenance checks: `test-results/addons-maintenance-final.log` (2 passed).
- Final `job-costing.spec.mjs service-board-controls.spec.mjs theme-settings.spec.mjs`: `test-results/addons-job-costing-final-e2e.log` (91 passed).
- Final mobile suite: `test-results/addons-mobile-final.log` (19 passed); List/Grid isolation correction recheck: `test-results/addons-mobile-containment-final.log` (1 passed).
- Invoice navigation recheck: `document-workspaces.spec.mjs --grep 'Invoices create and edit actions keep their origin' --workers=1 --output=test-results/addons-doc-recheck --reporter=list` (1 passed); its `.last-run.json` records success.
- Inventory of all selected tests: `test-results/addons-test-inventory.json`.

All database, browser and mail/PDF checks used isolated synthetic fixtures. No operational or production records were changed.
