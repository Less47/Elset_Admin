# Blank document lines and Items & Price List

## Behaviour

New quotes and invoices now start with one blank description, quantity 1 and rate 0. Previously, quotes started with a job-title assessment/parts description at $150 and invoices with “Labour for [job title]” at $165. The shared factory only runs when a saved document is absent. Existing saved documents are not rewritten.

Both editors offer **Add blank line** and **Add from price list**. The searchable modal matches item name, code and description, excludes archived items, and reads the selected item again before adding it to catch a price change or archive performed in another tab. Manual lines remain fully available even when the catalog is empty or unavailable.

Settings → **Items & Price List** provides add, edit, archive, restore, search and Active/Archived/All filters. The catalog is workspace-level and shared by quotes and invoices. Admin and office users can manage/use it; unauthenticated users and technicians cannot access its API.

## Fields and storage

An item has `id`, `name`, `description`, optional `code` (SKU), `unit`, `unitPrice` excluding GST, `taxTreatment`, optional `category`, `archived`, `createdAt` and `updatedAt`. `archived: false` means active. Units are each, hour, day, km, metre and fixed. Names are required; an empty catalog description uses the item name when selected. Prices are non-negative with at most two decimal places.

Schema **13**, migration `workspace-price-list-items`, adds one `price_list_items` table and one status/name index. Money is stored as integer cents. The existing transaction-based startup migration applies it once, with rollback on failure. No quote/invoice tables or historical financial rows are changed. Catalog mutations update individual items and check `updatedAt` to reject stale edits. There is no hard-delete endpoint.

Legacy JSON workspaces store the same catalog under server-owned `priceListItems`. Normal workspace autosaves preserve it. JSON-to-SQLite import retains the catalog and IDs; current-schema SQLite backups include it. The existing backup restore policy still requires a matching schema version; this change does not redesign restoration of older SQLite backup bundles.

## Snapshot, GST and accounting behaviour

Selecting an item creates a new line ID and copies its description, quantity 1 and current price into the line. `priceListItemId`, `unit` and `taxTreatment` are retained as metadata through the existing line `extra_json`. Description, quantity and rate remain editable. Catalog changes do not resolve or recalculate saved lines, sent copies or totals. The existing document/PDF format uses description, quantity and rate; no unit column or provider item code is introduced.

The audited application applies 10% GST to document subtotals, and both accounting adapters expose only `taxable`. The price list therefore accepts **Taxable / 10% GST** only. GST-free was not already supported and has not been added. Existing rounding, PDF calculations, email/send history and accounting arithmetic are unchanged.

Xero and QuickBooks continue reading stored invoice lines. The catalog is independent of their enablement, credentials and configuration. No Xero Item or QuickBooks Product/Service creation is performed.

## API

- `GET /api/price-list-items?status=active|archived|all&search=...` (defaults to active).
- `GET /api/price-list-items/:id` for the current item.
- `POST /api/price-list-items` to create.
- `PATCH /api/price-list-items/:id` to edit or change `archived`, with the last-read `updatedAt`.

These routes use the existing session/role middleware. They return catalog records only; no broad workspace write is used. Validation errors, missing items and stale changes return 400, 404 and 409 respectively. Infrastructure failures return a generic error.

## Files

Application:

- `src/lib/app-support.jsx` — blank defaults and the Settings tab metadata.
- `src/lib/price-list.js` — shared units, filtering, blank lines and value snapshots.
- `src/hooks/usePriceList.js` — catalog loading and request errors.
- `src/components/settings/SettingsManager.jsx` and `PriceListSettings.jsx` — Settings integration and management form/list.
- `src/components/documents/DocumentEditor.jsx` and `PriceListPicker.jsx` — blank/manual and catalog line actions.
- `server-price-list-routes.js` and `server-workspace-price-list.js` — authenticated catalog API, validation, conflict checks and persistence.
- `server-app.js` — router registration.
- `server-workspace-db.js`, `server-workspace-importer.js`, `server-workspace-backup.js` — additive schema, import and backup support.

Tests:

- `tests/price-list.test.js` — catalog, snapshots, history, migration rollback, backups, API roles/isolation, legacy JSON, provider sync and PDFs.
- `tests/e2e/document-workspaces.spec.mjs` — blank defaults, management workflow, shared catalog, manual edits, archive exclusion, current-value selection and responsive picker.
- Schema-version expectations updated in `tests/accounting-webhook-leases.test.js`, `tests/maintenance-recurrence.test.js`, `tests/quickbooks-migration.test.js`, `tests/workspace-migration.test.js`, `tests/workspace-schema-upgrade.test.js`, `tests/xero-accounting.test.js` and `tests/xero-payments.test.js`.

## Verification

Verification uses synthetic workspaces, disposable databases, mocked accounting providers and the existing local SMTP test sink. No real provider invoice or email is sent by these checks.

- `npm test` — **543 passed**, zero failures (including 12 price-list tests).
- `node --test tests/price-list.test.js` — **12 passed** on the final focused run.
- `npm run lint` — passed.
- `npm run build` — passed, with Vite's application chunk-size warning over 500 kB.
- `git diff --check` — passed.
- `npx playwright test tests/e2e/document-workspaces.spec.mjs tests/e2e/quickbooks-integration.spec.mjs tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json` — **95 passed, 2 failed on the initial broad run**. Both failures were new blank-line assertions accidentally placed in existing-invoice deletion tests; those assertions belong only in new-document tests. They were moved, and the two deletion scenarios plus new quote/invoice scenarios were rerun: **4 passed**. All **44 document, 25 QuickBooks and 28 Xero scenarios** have therefore passed across these runs, with no remaining failed scenario.
- With `ELSET_DOCUMENT_E2E_STORAGE=json`, the four price-list browser scenarios — **4 passed**. The test save helper waits for the existing debounced JSON autosave before a hard reload; product save behaviour was not changed.

The browser checks cover new blank lines; catalog create/edit/search/archive; editable quote and invoice snapshots from one catalog; manual lines alongside catalog lines; changed prices and archiving while a picker is open; and picker layouts at **390, 820 and 1440 px**. Existing document regressions cover eight viewport sizes, history, payments, PDF preview/download, real PDF attachments captured by the local SMTP sink, delayed/failed delivery, retries, and truthful partial success when email is accepted but history persistence fails.

The added provider tests save an invoice at **$145 + $14.50 GST**, then change the source item to **$155** and archive it. Xero and QuickBooks still receive the invoice's original **$159.50** total and $145 rate, with no provider item creation. These are mock-provider regressions, not live accounting acceptance tests.

Rendered quote and invoice PDFs were visually inspected with Poppler, alongside the Settings list and mobile/tablet picker screenshots. No clipping or layout defects were observed. Units remain reference metadata and do not add columns to the existing PDF layout.

Evidence (ignored by Git): `test-results/price-list-unit-final.log`, `test-results/price-list-browser.log`, `test-results/price-list-json-browser.log`, and screenshots/PDFs under `test-results/document-workspaces/`. The final focused reruns are also recorded in the tool output for this session.

No commit, push or deployment is part of this work.
