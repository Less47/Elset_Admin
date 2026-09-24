# Customer Account: lifetime value and invoice receivables

## Lifetime summary added locally on 2026-09-22

The top of Customer > Account now shows **Total invoiced**, **Total received**, **Outstanding**, and **Invoices** in a compact two-column account card. Existing unpaid-invoice rows, overdue information, editor links, and View all invoices remain below it. Amounts use the existing AUD formatter and semantic theme tokens.

The existing read-only account query and JSON fallback now aggregate every eligible current invoice across all of the customer's jobs/sites before limiting the open-invoice list to five rows. `totalInvoicedCents` includes GST, `totalReceivedCents` sums currently recorded payments, and `invoiceCount` counts that same invoice set. Paid invoices contribute to lifetime totals and count even though they do not appear in the open-invoice list.

Eligibility retains ELSET's existing invoice-send-history or positive-payment evidence. It excludes quotes, unissued/unpaid drafts, explicit draft/unfinished/incomplete/invalid/archive metadata, inactive/deleted records, missing/invalid issue dates, missing/invalid lines, and nonpositive invoices. The current document is counted once by invoice ID; ServiceM8 references, send-history snapshots, cached totals and provider mappings are not additional invoices or revenue sources. No issuance, import, payment, job-costing or provider behavior was changed.

Outstanding still uses the authoritative sum of remaining per-invoice balances. Normally this equals invoiced minus received; existing overpayments stay attached to their invoice and do not settle another invoice without an allocation. Existing SQLite/JSON rounding and legacy JSON paid markers are preserved.

Files changed for this addition: `server-customer-account.js`, `src/lib/invoice-account.js`, `src/hooks/useCustomerAccount.js`, `src/components/customers/CustomerAccount.jsx`, `src/components/customers/CustomerWorkspace.css`, `tests/customer-account.test.js`, `tests/e2e/customer-account.spec.mjs`, and this report. No schema changes, provider queries, stored customer totals, graphs, date filters, integration changes or production access were added.

Local validation: **27 account unit tests passed; 659 full-suite tests passed; lint, build and `git diff --check` passed** (build retains the existing large-chunk advisory). Coverage includes multiple jobs/sites, full/partial/no payments, draft/deleted/invalid exclusions, zero state, actual historical ServiceM8 import and duplicate projections, invoice counts, current invoice edits, overpayments, and AUD formatting.

**15 relevant browser tests passed** using `tests/e2e/customer-account.spec.mjs` and `tests/e2e/customer-workspaces.spec.mjs` with `--config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --reporter=line`. These exercise the real local SQLite API, payment updates, new/deleted invoice refresh, errors/retry, navigation, customer/site editing, and **24 Account theme/viewport combinations** (eight presets at desktop, tablet and mobile sizes). Manually inspected the generated ELSET desktop, Harbour Steel tablet and Midnight Signal mobile screenshots: all four values and existing invoice rows are readable without horizontal overflow. Only temporary synthetic local databases were used. Work remains uncommitted, unpushed and undeployed.

## Model audited

- SQLite stores one invoice per job in `invoices`; `invoices.job_id -> jobs.customer_id` is the authoritative customer relationship. Sites, customer names, job prices and quote acceptance do not determine receivables.
- `invoice_line_items` supplies scaled quantities and integer rates in cents. `payments.invoice_id` supplies applied payment amounts in cents. Invoice send history supplies issuance evidence; receipt emails are not additional payments.
- Existing document financial helpers calculate line totals, GST, payments, nonnegative balance and overpayment. Those helpers remain authoritative. No Customer balance field, schema migration or stored aggregate was added.
- Existing dashboard/Invoice workspace outstanding totals include unissued drafts, and their status order can label a past-due draft Overdue. This was reported before implementation. Their balance calculation remains unchanged; Customer Account applies the requested issued-invoice eligibility filter.

## Exact balance definition

For the selected customer's actual invoices, sum each positive remaining balance after payments. Qualifying invoices have invoice send history or a recorded positive payment. Exclude unissued/unpaid drafts, archived/deleted invoices, explicit legacy void/cancel/delete markers, fully paid invoices and zero-value invoices.

Quotes, accepted quotes, quoted job values, estimated values and uninvoiced jobs contribute **zero**. A quote conversion contributes only through the resulting qualifying invoice. All of the customer's sites contribute through the invoice's customer relationship.

SQLite uses the existing `invoiceFinancialsFromRows` calculation, extracted without changing its arithmetic from `server-workspace-documents.js`. Summation and API money fields use safe integer cents. JSON storage uses the application's existing invoice monetary helpers against already-loaded actual invoice objects, then aggregates cents.

## Calculation and API

- `server-customer-account.js`: customer-scoped read transaction over invoices, invoice items, payments and invoice send history. Five queries cover the customer and their records; no per-invoice query loop.
- `src/lib/invoice-account.js`: shared eligibility, summary, sorting and calendar overdue helpers. Existing server/client invoice status functions now reuse the same status decision function and retain their labels and precedence.
- `GET /api/customers/:id/account-summary?today=YYYY-MM-DD`: authenticated admin/office access; `Cache-Control: no-store`. Uses the normal DB resolver and an existing-file, read-only connection without migrations. Missing customers return 404; unavailable data returns 503 rather than a false zero. Invalid dates return 400.
- Response: customer ID, as-of date, outstanding cents, open count, overdue count, oldest overdue days, up to five open invoice rows and `hasMore`. All open invoices contribute to totals. Paid history and other customers' records are not returned.
- The optional `today` is the browser's local calendar date, preserving the existing UI's date boundary when the server runs in another timezone. Overdue means positive eligible balance and a valid saved due date strictly before today. Missing/invalid due dates are not overdue. Day differences use calendar dates, avoiding daylight-saving hour errors.
- Legacy JSON mode derives the section from existing in-memory jobs; it adds no workspace fetch. The existing application still performs its normal initial workspace load.

## UI and refresh

- Desktop: Account is first in the right column, above Sites and Job History. Customer Details and Contacts retain the left column. This keeps the balance visible for customers with many sites.
- Tablet/mobile: Account is an additional existing-style tab; selection survives refresh and viewport changes.
- Summary states: account up to date; positive outstanding; overdue attention with text counts and oldest age. Invoice rows show number, issue date, due date, total, paid, remaining and status, sorted overdue first, nearest due date, then newest issue/reference.
- Rows open the existing invoice editor with its normal return navigation. If polling discovers a newly created invoice absent from the browser's workspace state, the existing editor route reloads its normal data.
- View all invoices opens `/invoices?customerId=<id>`. The filter includes only actual invoices for that customer, composes with existing invoice filters and supports refresh/Back/Forward and Clear customer filter.
- Changes to workspace jobs refresh Account; returning from invoice/payment edits reloads it. Visible pages also refresh every 30 seconds and on focus/visibility changes. Requests are cancelled on unmount/customer change, and responses from obsolete workspace revisions are ignored. Errors show an unavailable state with Retry.
- All six existing themes use semantic surface/text/status/border tokens. Three viewports per theme were captured: 1440x900, 820x1180 and 390x844. Screenshots are under `test-results/customer-account/` (generated, not source controlled).

## Accounting edge cases

- No native credit-note ledger or void/cancel workflow was found. Existing recorded payments reduce balances; no unsupported credit operation was introduced. Legacy explicit inactive markers are excluded defensively.
- Overpayment remains attached to its invoice and does not reduce another invoice's receivable.
- A positive recorded deposit counts even when invoice send history is absent, matching the existing Deposit Paid/Partially Paid semantics.
- Legacy JSON `paymentStatus: Paid` without payment rows is honored; cached totals/paid amounts are not used as a separate balance source.
- Existing SQLite arithmetic rounds each scaled line to cents; the existing JSON/browser helper rounds the subtotal. Fractional-line inputs can therefore produce a pre-existing one-cent difference between server financials and the editor. This change preserves the server's authoritative SQLite calculation and the legacy JSON helper rather than changing invoice amounts globally.
- Saved missing due dates remain missing in this summary. Existing editor normalization can supply a default date; the summary does not invent an authoritative due date.

## Files changed

| Area | Files |
| --- | --- |
| Account query and API | `server-customer-account.js`, `server-customer-routes.js` |
| Financial/status reuse | `server-workspace-documents.js`, `src/lib/invoice-account.js`, `src/lib/app-support.jsx` |
| Account UI and refresh | `src/components/customers/CustomerAccount.jsx`, `src/hooks/useCustomerAccount.js`, `src/components/customers/CustomerWorkspace.jsx`, `src/components/customers/CustomerWorkspace.css`, `src/components/customers/CustomerPages.jsx` |
| Invoice filter/navigation | `src/App.jsx`, `src/components/app/WorkspaceShell.jsx`, `src/components/invoices/InvoiceManager.jsx`, `src/hooks/useWorkspaceNavigation.js` |
| Tests | `tests/customer-account.test.js`, `tests/workspace-navigation.test.js`, `tests/e2e/customer-account.spec.mjs`, `tests/e2e/customer-workspaces.spec.mjs` |
| Report | `docs/customer-account-report.md` |

## Original receivables implementation verification

- `node --test tests/customer-account.test.js tests/workspace-navigation.test.js`: **24/24 passed**. The account tests cover the four required invoice-only scenarios in both SQLite and JSON, plus partial/full/multiple payments, multi-site ownership, overdue dates, drafts, deleted/void metadata, zero invoices, rounding, lifecycle changes, bounded response and API authorization/read-only behavior.
- `node --test --test-reporter=dot`: **376 passed**.
- `npm run lint`: **passed**.
- `npm run build`: **passed**, with Vite's large-chunk advisory.
- Browser tests use synthetic temporary SQLite/auth databases and the local built application. No production records or production database were accessed.
- `npx playwright test tests/e2e/customer-account.spec.mjs tests/e2e/customer-workspaces.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --reporter=line`: **15/15 passed** (five Account tests plus ten existing Customer/Site regressions). Account tests verify totals, editor/filtered-workspace navigation, payment edits, error/retry, cross-session invoice creation/deletion refresh and the 18-case theme/viewport matrix.
- Existing `tests/e2e/invoice-job-status-filter.spec.mjs`: **14/14 passed** with the same Playwright configuration in the earlier combined run. **29 distinct relevant browser tests passed overall.** An initial Account test had an ambiguous Saved-text locator; it was corrected and the Account suite passed in full.
- Visually inspected generated Account screenshots across all six themes, including Midnight Signal desktop, tablet and mobile. Confirmed compact rows, readable amounts/statuses, desktop placement and mobile wrapping. Browser assertions also checked horizontal overflow and read-only theme navigation.
- `git diff --check`: **passed**.

Implementation remains uncommitted, unpushed and undeployed.
