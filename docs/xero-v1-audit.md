# Accounting integration V1 audit and report

## Architecture audit (before implementation)

- One deployment owns one SQLite workspace (`workspace_info.id = 1`); there is no client-selectable workspace. Auth is Better Auth in a separate database. `requireAuth` supplies user and session; admin/office manage shared settings and invoices. Technicians cannot access commercial APIs.
- Add-ons use `src/lib/addons.js`, a shared `settings.addons` row, `useWorkspaceAddons`, and `AddonsSettings`. SQLite is required. Disable preserves records.
- Customers own Sites and Customer Contacts. Jobs reference Customer IDs and snapshot contact/address fields; Sites are not accounting customers. Customer emails/names are not guaranteed unique, so automatic name/email matching is unsafe.
- Saved invoices have stable IDs, one per Job, ordered integer-micro quantities and integer-cent rates. Quotes are separate. Numbers use `buildDocumentReference`, not a separate accounting sequence.
- `isQualifyingActualInvoice` accepts sent history or positive recorded payments, excluding inactive invoices. Draft due dates alone do not qualify. This existing rule will be reused.
- `invoiceFinancialsFromRows` rounds each line to cents, then calculates 10% GST on the subtotal. The current product has no GST-free line flag or currency selector; document formatting is AUD. Only the current taxable treatment can be configured. Currency and tax assumptions belong in the workspace adapter, not the provider-neutral service.
- `DocumentEditor` owns an unsaved draft; sync must use saved database data and be disabled for dirty/busy drafts. Preview/email use the existing PDF generator and saved sent snapshots; integration does not change them.
- Customer Account and Job Costing read saved invoices/payments and the same actual-invoice rule. Neither should read accounting sync state as financial data.
- SQLite schema is version 8; startup applies contiguous, transactional forward migrations and refuses newer/inconsistent versions. Integration needs one version 9 migration. SQLite backups include database bytes; JSON workspace exports/projections do not include new integration tables.
- There is no reusable token encryption helper. Server environment uses unprefixed secrets; browser configuration is Vite-prefixed. New authenticated encryption must remain server-only.

## Implementation decisions

- Provider-neutral service, storage, invoice/customer DTOs and error contract; direct HTTP confined to Xero provider. The maintained xero-node SDK was evaluated, but native fetch fits existing ESM/Node architecture, injected mocked HTTP and the narrow endpoint set without a broad generated SDK dependency.
- OAuth scopes: `offline_access accounting.contacts accounting.invoices accounting.settings.read`. No payment scope. Hashed, expiring, single-use state is bound to the initiating authenticated session and server-resolved workspace.
- Customer mappings are tenant-aware. Existing mappings and this integration's deterministic ContactNumber are reused. No name/email merges; new contacts get a short unique source suffix. Mapped contact details are not overwritten.
- Manual invoice creation uses an authorised sales invoice. Updates read external state first; paid/credited/voided/locked or externally changed records fail safely. No replacement invoices.
- Persist operation keys before writes, reconcile exact source identity and invoice number after ambiguous responses, and validate subtotal/tax/total before recording success. Xero's idempotency cache lasts six minutes; durable reconciliation remains necessary after that window.

## Official references checked

- [Granular scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- [OAuth authorization code flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow/)
- [Idempotency](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/)
- [Invoices](https://developer.xero.com/documentation/api/accounting/invoices)
- [Contacts](https://developer.xero.com/documentation/api/accounting/contacts)
- [Accounts](https://developer.xero.com/documentation/api/accounting/accounts)
- [Tax mapping](https://developer.xero.com/documentation/guides/how-to-guides/tax-in-xero)
- [Maintained Node SDK](https://github.com/XeroAPI/xero-node)

## Delivered architecture and security

`AccountingService` owns connection status, OAuth state, organisation selection, configuration, customer mapping, invoice synchronization, safe errors and durable operations. `AccountingStore` scopes every query by the server's workspace identity and provider; entity/history queries also include the tenant. `server-accounting-workspace.js` adapts current customers/invoices and financial calculations to provider-neutral data. The registry resolves the concrete provider.

`XeroAccountingProvider` alone knows Xero URLs, headers, payloads, status restrictions and external IDs. Its contract covers connect/code exchange/refresh/disconnect, organisations/accounts/taxes, customer ensure/read, invoice create/read/find/update, comparison and safe-update validation. A future provider can implement that contract, register its Add-on, and supply configuration UI without replacing integration tables or invoice business state. No QuickBooks implementation or placeholder UI was added.

OAuth state contains 32 random bytes; only its SHA-256 digest is stored. It expires after ten minutes, is bound to user plus hashed auth session and workspace/provider, and is consumed once before exchanging a code. The callback has a fixed Settings destination and never trusts a query-supplied workspace/return URL. It distinguishes cancellation, invalid/expired state, missing/expired codes, provider errors and missing/multiple organisations.

Tokens use AES-256-GCM with a fresh 12-byte IV and authentication tag. Additional authenticated data binds each encrypted value to workspace, provider and credential kind. The encryption key must be 32 bytes represented as 64 hex characters. Browser responses return explicit safe projections, never encrypted or plaintext credentials. Errors never include raw OAuth/API payloads. The server fetch injection exists for tests; test-control HTTP endpoints exist only in `tests/fixtures/xero-server.mjs`.

A per-workspace/provider SQLite lease serializes connection work, refresh and invoice sync, including across processes. It lasts two minutes with a 15-second heartbeat, and is released on success/failure. Competing actions get a safe busy response. No SQLite transaction remains open while awaiting Xero. Access credentials refresh before their expiry is within 60 seconds; both encrypted rotated values and expiry are saved in one statement. Invalid grants/scopes mark `NEEDS_REAUTHORIZATION` and stop repeat refresh attempts.

Existing admin/office permissions govern both shared-settings and invoice actions; technician/unauthenticated requests are rejected. Mutation requests also require the app's custom request header and reject cross-site fetches. Disabled Add-ons reject server work, including checks immediately before external writes. An already dispatched request cannot be cancelled by a later disable; its result is retained for reconciliation. Explicit disconnect remains available while disabled.

## Schema 8 → 9

One additive, transactional forward migration: `provider-neutral-accounting-integrations`. No core tables are rebuilt or dropped.

| Table | Purpose and important constraints/indexes |
| --- | --- |
| `integration_workspace` | Singleton server-owned random workspace ID; primary key constrained to 1; unique workspace ID. |
| `workspace_integrations` | Connection, encrypted credentials, tenant, config and safe health state; unique `(workspace_id, provider)`. |
| `integration_entity_mappings` | Customer/invoice IDs scoped to tenant; unique `(workspace_id, provider, external_tenant_id, local_entity_type, local_entity_id)` and `(provider, external_tenant_id, local_entity_type, external_entity_id)`. |
| `integration_sync_log` | Separate safe integration history; `idx_integration_sync_entity` supports latest entity/tenant history, `idx_integration_sync_status` supports workspace/provider/status/time. |
| `integration_oauth_states` | Hashed nonce primary key, session/user/workspace/provider binding, expiry; `idx_integration_oauth_expiry`. |
| `integration_locks` | Lease owner/expiry; primary key `(workspace_id, provider)`. |
| `integration_operations` | Persisted request hash/key/state before a write; scoped entity primary key plus globally unique idempotency key. |

All integration data has a workspace foreign key. Mappings deliberately have no cascading foreign key to live Customer/Invoice tables, so business record archival does not erase accounting history. Existing migration ledgers, newer-schema rejection and backup validation remain in force. Full SQLite backups include integration records as encrypted database data; ordinary JSON state/export does not.

## Customer and invoice rules

- Reuse a tenant-aware Customer mapping first and verify the Contact is active. Otherwise look up only this workspace/Customer's deterministic source ContactNumber. Never match solely by name/email. Create-only PUT uses authoritative Customer email, phone and postal address plus a short source suffix in the name. Sites share their Customer Contact. Existing mapped Contact fields are never overwritten.
- Read only saved invoices for accessible Jobs/Customers. Reuse sent-or-positive-payment eligibility and inactive exclusions. Validate issue/due dates, descriptions, positive quantities and nonnegative rates. Quotes, job values and cost entries never become accounting invoices.
- Map to an `ACCREC`, initially `AUTHORISED`, exclusive-tax invoice with original invoice number, dates, AUD, ContactID, quantities, two-decimal source unit prices, line amounts, tax amounts, configured account/tax, and Job/source reference. No emails or payments are sent to Xero.
- The workspace adapter uses existing integer-cent line rounding and subtotal GST. It allocates line tax so the sum equals authoritative invoice GST. The provider receives a tax-treatment key, not a hardcoded Australian tax name. Configuration fetches active revenue accounts and revenue-compatible tax rates; no account code or tax type is assumed.
- Persist and reuse InvoiceID. Before updates, read the full invoice and reject payments, credits, void/paid/unsupported states, tracking, inventory, discounts or externally changed source-managed fields. Check exact returned details and subtotal/tax/total before declaring success. Retain external identity on mismatch or concurrent local edit, so retry cannot create a replacement.
- External edits between the final GET and write cannot be atomically locked across products. This remaining race is documented for release review.

## Duplicate prevention and recovery

Database uniqueness, a server-side lease, durable idempotency keys and provider reconciliation work together. Before creating, search the exact invoice number, fetch full details by InvoiceID, and require an exact match including Customer and workspace/invoice source reference. A number match with different details is a conflict.

Pending retries reuse an unchanged key for less than five minutes (inside Xero's documented six-minute window). After a lost response, an exact remote match recovers the mapping without another write, even after the key window. If the result cannot be verified or the pending payload changes, fail closed for manual reconciliation. Definite validation rejection permits a corrected request. No force reset or blind duplicate retry is available.

HTTP 429 stores and returns a retry time; subsequent work is blocked until then. Provider calls have 20-second timeouts and no aggressive retry loop. Errors are recorded with safe code/message/status/time, without tokens, codes, stack traces or customer payloads.

## User interface and lifecycle

- Xero uses the existing workspace Add-on registry/card. Enablement survives sessions and disabling preserves connection, config and history.
- Compact Settings controls: connect/reconnect, organisation selection with different-tenant confirmation, fetched account/tax choices, test connection, last success/error/retry time and deliberate disconnect confirmation.
- Invoice-only status card: Send to Xero, Update Xero or Retry, separate sync status, safe error, external number and last-sync time. Dirty drafts cannot sync; active syncing disables editing/saving/navigation and duplicate actions. Failed loads have a refresh action. Initial/loading/save states settle on success or failure.
- Test connection creates no business records. Disconnect attempts per-tenant removal and clears local credentials even if remote cleanup fails, with a visible cleanup warning. Same-tenant reconnect reuses mappings; switching tenants clears config and keeps old history isolated.
- Six themes use existing semantic tokens. Mobile/tablet/desktop layouts wrap controls and do not require horizontal scrolling. Optional external invoice deep links are omitted because no stable tenant-aware public URL contract was established.

## Environment and setup

Four server-only variables: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `ACCOUNTING_INTEGRATION_ENCRYPTION_KEY`. These are application-operator/developer infrastructure configuration, provisioned once for the application, never customer/workspace setup. Only empty placeholders were added to `.env.example`; no secret, Docker or Fly configuration was changed.

Customers enable Xero and connect through OAuth. Missing/invalid infrastructure disables Connect with a generic support message. Technical variable names and validation reasons are logged server-side without values. Decryption failures and previously stored infrastructure messages also return safe customer errors. One application encryption key protects independent workspace credentials; authenticated encryption continues to bind tokens to workspace/provider/token kind.

See [the 17-step setup guide](xero-v1-setup.md) for app registration, exact redirects, key generation, staged Fly command templates, deployment instructions, Demo Company verification, retry and disconnect. All operational commands are instructions for a future approved setup; none were executed here.

## Files changed

New server files:

- `server-accounting-schema.js`
- `server-accounting-crypto.js`
- `server-accounting-errors.js`
- `server-accounting-store.js`
- `server-accounting-workspace.js`
- `server-accounting-providers.js`
- `server-accounting-providers/xero.js`
- `server-accounting-service.js`
- `server-accounting-routes.js`

Server integration changes: `server-app.js`, `server-workspace-db.js`, `server-workspace-backup.js`, `.env.example`.

New UI files: `src/lib/accounting-api.js`, `src/components/settings/XeroSettings.jsx`, `src/components/invoices/InvoiceAccounting.jsx`.

UI integration changes: `src/lib/addons.js`, `src/App.jsx`, `src/hooks/useWorkspaceNavigation.js`, `src/components/app/WorkspaceShell.jsx`, `src/components/settings/SettingsManager.jsx`, `src/components/settings/AddonsSettings.jsx`, `src/components/documents/DocumentEditor.jsx`.

New tests/fixtures: `tests/xero-accounting.test.js`, `tests/helpers/xero-mock.js`, `tests/fixtures/xero-server.mjs`, `tests/e2e/xero-integration.spec.mjs`.

Existing test updates: `tests/job-costing.test.js` (new default-off registry entry), `tests/maintenance-recurrence.test.js` (genuine older-schema fixture), `tests/workspace-migration.test.js`, `tests/workspace-schema-upgrade.test.js` (version 9 expectations), `tests/e2e/customer-sqlite-workflow.spec.mjs` (stale Recycle Bin tab names corrected to existing UI), `tests/e2e/job-costing.spec.mjs` (status assertions scoped now that Xero has its own status panel).

Documentation: this audit/report and `docs/xero-v1-setup.md`. No dependency changes were needed.

## Verification

- `npm test`: **447/447 passed**, including 18 Xero service/API tests (`test-results/xero-unit-rerun.log`). Coverage includes OAuth/state/scopes, authenticated encryption, token rotation/concurrency, organisation selection, exact totals, contact reuse/ambiguity, lost create/update responses, external/local edit conflicts, permissions, server gating, workspace isolation and additive migration rollback/restart.
- `node --test tests/workspace-schema-upgrade.test.js`: **20/20 passed** (`test-results/xero-schema-rerun.log`). One earlier full run hit intermittent `SQLITE_BUSY` at the pre-existing `PRAGMA journal_mode=WAL`, before migration. The function is identical to HEAD; it was not changed here. The dedicated rerun and subsequent full run passed. This remains an existing startup concurrency caveat, not a claim that every startup race has been removed.
- `npm run lint`: passed (`test-results/xero-lint-verified.log`).
- `npm run build`: passed (`test-results/xero-build-final.log`), with the existing large-bundle advisory. A scan of `dist` found no Xero client-secret/encryption-key variable names, fixture tokens/secrets or credential field names.
- `git diff --check`: passed.
- Xero browser suite: **23/23 passed** (`test-results/xero-e2e-final.log`). Real local admin/office/technician sessions with mocked Xero HTTP/consent verify connect/configure/test/create/update/disconnect, eligibility, lost-response retry, renewal, shared session state, active-save disabling, six themes and 390/820/1440 px widths. Screenshots are in `test-results/xero-v1`; representative settings/invoice captures across all six themes were visually inspected, including fully dark Midnight Signal.
- Across the focused browser runs and corrected reruns: **157 distinct checks passed; 12 live Google Maps checks were intentionally skipped**. This includes the 23 Xero checks above plus 40 document workspace/PDF/local-mail tests, 33 Job Costing/Add-on tests, 34 theme/settings tests, 14 Site navigation tests, 5 Customer Account tests, 4 customer/Job SQLite workflow tests and 4 Create Job contact tests. No real emails were sent.
- Browser commands used `npx playwright test <spec files> --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --reporter=list`, with separate output directories. Evidence: `test-results/xero-regression.log` (initial 49 passing document/account/contact checks; also contains the superseded failures), `test-results/xero-regression-remaining.log` (4 corrected SQLite customer/Job checks), `test-results/xero-regression-final.log` (81 passed / 12 live-map skipped), `test-results/xero-e2e-final.log` (23 Xero passed). Initial failures were stale Recycle Bin labels and unscoped Add-on status locators; those test selectors were corrected without changing those workflows. The broad suite was completed through these focused reruns, not claimed as one uninterrupted green run.

No actual Xero OAuth consent or live Demo Company run was performed. Automated tests never call the real Xero endpoints; developer credentials are still required for the manual release checklist in the setup guide. No production database, live organisation or Fly secrets were modified; no commit, push or deployment was made.

## V1 boundary

Delivered: OAuth, organisation selection, account/tax configuration, conservative Customer-to-Contact mapping, manual invoice create/update, status/history, retry and disconnect.

Deferred: payments, webhooks, expense/bill imports, Job Costing accounting integration, credit notes, quotes, Xero imports, automated/bulk/background sync, QuickBooks, inventory, payroll, bank feeds, purchase orders and two-way accounting edits. Multi-currency/GST-free source modelling, intentional contact maintenance, a manual mapping/reconciliation UI and automated encryption-key rotation also remain future work.

## Infrastructure UX correction — 2026-09-17

The previous key validator threw a customer-facing setup instruction. `AccountingService.status()` exposed it as `setupMessage`, and `XeroSettings` rendered it directly. Xero client configuration and credential-decryption errors also referred customers to infrastructure configuration.

The corrected card shows **“Xero integration is temporarily unavailable. Please contact support.”** for an unconfigured server. API infrastructure errors use the equivalent provider-neutral support message. Detailed reasons stay in server logs and contain only fixed descriptions/variable names. Legacy persisted technical messages are sanitised on read, without changing stored business data or the schema. There is no key-entry field.

Connect retains `disabled={disabled || !status?.serverConfigured}`, with `disabled = busy || loading`; it is shown when Xero is enabled and the connection is not already connected. Existing admin/office authorisation is unchanged. An operator-configured server supports Enable → Connect → Xero consent → Connected. After an operator restores configuration and the customer reloads status, Connect becomes available.

The four application environment variables remain server-only and are configured once by the operator through production Fly secrets or the developer's untracked local server environment. One key encrypts independent workspace credentials with workspace/provider/token-kind authenticated data. No customer keys, persistence redesign, secret changes or deployment were introduced.

### Files changed for this correction

- `.env.example`
- `server-accounting-errors.js`
- `server-accounting-crypto.js`
- `server-accounting-providers/xero.js`
- `server-accounting-service.js`
- `src/components/settings/XeroSettings.jsx`
- `tests/xero-accounting.test.js`
- `tests/fixtures/xero-server.mjs`
- `tests/e2e/xero-integration.spec.mjs`
- `docs/xero-v1-setup.md`
- `docs/xero-v1-audit.md`

### Verification after this correction

- `node --test tests/xero-accounting.test.js`: **20/20 passed**. Covers missing/invalid infrastructure, safe diagnostics without values, old persisted errors, decryption failures/recovery, API status/503 responses and shared-key workspace isolation.
- `npm test`: **449/449 passed** (`test-results/xero-ux-unit.log`).
- `npm run lint`: **passed** (`test-results/xero-ux-lint.log`).
- `npm run build`: **passed**, with the existing bundle-size advisory (`test-results/xero-ux-build.log`).
- `npx playwright test tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --reporter=list --output=test-results/xero-ux-browser`: **25/25 passed** (`test-results/xero-ux-browser.log`). Both admin and office users were tested with each of the four missing server variables, disabled Connect, safe UI/API errors, server diagnostics, operator recovery and successful mocked OAuth consent. Existing technician denial, manual sync/update, reconnect, disconnect and responsive theme coverage passed.
- Visually inspected `test-results/xero-v1/xero-unavailable-admin.png`: generic support message beside disabled Connect, no infrastructure instructions or fields.
- Scanned `src` and built `dist`: no encryption-key/client-secret variable names or removed setup instructions found.
- `git diff --check`: **passed** (`test-results/xero-ux-diff.log`).

Real Xero consent and production configuration were not exercised. No commit, push or deployment was made.
