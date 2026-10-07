# Job Billing Type

Jobs now carry a revenue classification independently of their operational status.
Supported values are `billable` and `warranty`. Ordinary and legacy Jobs default to
Billable. Further types require an explicit future validation/schema change.

## Storage and migration

Schema 18 appends `job-billing-classification` to released schema 17. It adds:

- `jobs.billing_type TEXT NOT NULL DEFAULT 'billable'`, checked against the supported values.
- `jobs.warranty_reason TEXT NOT NULL DEFAULT ''`, limited to 240 characters.
- An index on billing type/status and four database guards protecting invoice writes and accounting ownership.

The migration is transactional and does not change existing invoices, payments,
accounting mappings, Job IDs or operational fields. Existing Jobs receive Billable
and an empty reason. Released migrations remain unchanged.

The shared validators reject unknown or null types and non-string, excessive or
unsafe-control-character reasons. Reasons are trimmed. Canonical columns win over
extra JSON. State projections, explicit JSON imports, SQLite backups, Job archives
and restoration preserve the fields. Old data without these fields receives the
defaults. JSON runtime persistence is not introduced.

Maintenance generation defaults to Billable and accepts explicit validated billing
fields. ServiceM8 creates ordinary Billable Jobs, retains an existing Job's local
classification/reason, and skips a replacement containing an invoice when that Job
is Warranty, reporting a conflict before replacing its Job tree or costs.

## Forms and operational UI

Create Job and Edit Job Details share a compact Billing Type selector. Warranty
reveals a short non-billable hint and an optional reason. Switching to Billable
hides the reason while preserving it, including across saves. Existing Admin/Office
create/edit permissions apply; Technician field permissions remain unchanged.

Job Details shows classification and reason in its existing information panel.
Warranty Service Board cards use a semantic teal surface/border and readable text,
without a Warranty pill or badge. Classification remains visible in Job Details and Job History.
List, Compact, Grid and Mobile keep their existing layout and interaction
handlers. Existing urgency, quote, maintenance, QuickBooks, price and note indicators
retain their positions and label rules.

The board legend includes Warranty. Its existing filter controls now contain
All/Billable/Warranty; this combines with search and urgency and the existing status
and authorized technician visibility. Search includes classification and reason.
Completed pagination resets when the billing
filter changes; sorting is unchanged. The filter is temporary, like search/urgency.

Job History displays `Warranty · non-billable`, including on completed Jobs. Its
Completed not invoiced filter excludes Warranty; Without invoice can still include
Warranty with the explicit explanation. History search includes classification and
reason. No new analytics dashboard is added; the canonical columns and existing cost
records are available for future reporting.

## Documents and accounting safety

While Warranty, invoice editor actions and Quote to Invoice are unavailable. A
direct Invoice URL explains: "Warranty job — non-billable. Change Billing Type to
Billable before creating an invoice." Stale conversion drafts are ignored. Quotes
remain accessible. Normal Invoice defaults, unsaved quote conversion and the server's
create-only/non-overwrite protection remain intact.

Server invoice creation/replacement and archived invoice restoration reject Warranty
with HTTP 409; database triggers additionally protect direct inserts/reassociation.
Both accounting providers reject invoice sync before provider work, locks or sync
logs. No missing-invoice/QuickBooks-not-sent warning is produced merely because a
Warranty Job has no invoice. Payment sync architecture is unchanged.

Changing an invoiced Job to Warranty is rejected. Invoice mappings are protected
even when a default-ID invoice is absent or a custom-ID invoice is archived. The
message asks the user to resolve/remove the invoice and review its accounting
mapping. Classification never automatically deletes or voids an invoice, removes a
mapping, changes a payment, or contacts an accounting provider. Returning to Billable
restores normal invoice availability.

## Costing and scope

Warranty Jobs retain Job Costing when the existing add-on is enabled: labour,
materials, subcontractors, travel, sundries, plant/equipment and other. Arithmetic,
permissions, cost entry editing and archive restoration are unchanged. A Warranty
Job without an invoice has zero invoice revenue while its costs remain recorded.

Only Billable/Warranty are implemented. There is no claims, expiry, RMA or Warranty
analytics module. Verification uses isolated synthetic workspaces, mock accounting
providers and local mail sinks. No production data, real customer emails, push or
deployment is part of this change.

## Verification observed locally on 2026-10-06

| Check | Result |
| --- | --- |
| `node --test tests/job-billing.test.js` | 38 passed |
| `npm.cmd test` | 979 passed; no failures, skips or cancellations |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed |
| `git diff --check` | Passed |
| Warranty Playwright suite | 16 passed |
| Existing relevant Playwright cases | 253 distinct cases covered successfully, including the rerun described below |
| Isolated `npm.cmd start` | Schema 17 -> 18; healthy API; Job rows preserved; integrity/foreign-key checks passed |

Browser commands used `--tsconfig=tsconfig.app.json`. The regression suites were
Service Board controls, document workspaces, Job Costing, Invoice Job Status filter,
QuickBooks integration, Xero integration and Create Job contacts. The initial combined
run passed 252/253; a QuickBooks error-display check at 390px failed once. That case
passed on isolated retry, then the complete QuickBooks suite passed 43/43. No payment
or accounting implementation was changed to address that test. Together with the
16 Warranty cases, 269 distinct browser cases have successful results.

The new browser cases exercise real isolated SQLite Job/document/cost routes and
existing role gates. They cover creation, edits and reason retention, invoice/quote
availability, direct Invoice URLs, cost entry creation, completed History labels,
combined board filters, mobile status changes, desktop drag moves and all eight
theme presets. Screenshots were reviewed at 390, 820 and 1440 pixels for Create,
Edit, board indicators/modes, legend/filter, Details, History and Documents; no
horizontal overflow was found. Mobile uses its current card layout; desktop List,
Compact and Grid were checked at 820/1440. Warranty card text contrast is at least
4.5:1 in all eight presets. Local screenshots/logs are under
`test-results/warranty-visual` and `test-results/warranty-*.log` (ignored QA artifacts).
Four interrupted billing-test folders remain in Windows Temp because automatic
approval review rejected both batch and exact-path cleanup with `blocked by policy`.

## Changed files

- `docs/job-billing.md`
- `server-accounting-service.js`
- `server-accounting-workspace.js`
- `server-job-billing.js`
- `server-servicem8-importer.js`
- `server-store.js`
- `server-workspace-billing-schema.js`
- `server-workspace-db.js`
- `server-workspace-documents.js`
- `server-workspace-importer.js`
- `server-workspace-jobs.js`
- `server-workspace-maintenance.js`
- `server-workspace-servicem8-import.js`
- `server-workspace-state.js`
- `src/App.jsx`
- `src/components/app/WorkspaceShell.jsx`
- `src/components/jobs/CreateJobPage.jsx`
- `src/components/jobs/JobBillingFields.jsx`
- `src/components/jobs/JobDetailsPage.jsx`
- `src/components/jobs/JobHistoryManager.jsx`
- `src/components/jobs/JobRoutePages.jsx`
- `src/components/service-board/JobBillingFilter.jsx`
- `src/components/service-board/MobileBoardSheets.jsx`
- `src/components/service-board/MobileJobCard.jsx`
- `src/components/service-board/MobileServiceBoard.jsx`
- `src/components/service-board/OfficeBoard.jsx`
- `src/components/service-board/ServiceBoardIndicatorSymbol.jsx`
- `src/components/service-board/service-board-utils.js`
- `src/components/service-board/useCompletedJobLimit.js`
- `src/hooks/useWorkspaceActions.js`
- `src/hooks/useWorkspaceViewModel.js`
- `src/index.css`
- `src/lib/app-support.jsx`
- `src/lib/job-billing.js`
- `src/lib/quote-to-invoice.js`
- `src/lib/theme-tokens.js`
- `tests/accounting-webhook-leases.test.js`
- `tests/contact-model.test.js`
- `tests/create-job-sites.test.js`
- `tests/e2e/customer-workspaces.spec.mjs`
- `tests/e2e/job-billing.spec.mjs`
- `tests/helpers/workspace-billing-schema.js`
- `tests/helpers/workspace-media-schema.js`
- `tests/job-billing.test.js`
- `tests/maintenance-service.test.js`
- `tests/price-list.test.js`
- `tests/quickbooks-migration.test.js`
- `tests/workspace-media.test.js`
- `tests/workspace-migration.test.js`
- `tests/workspace-schema-upgrade.test.js`
- `tests/xero-accounting.test.js`
- `tests/xero-payments.test.js`
