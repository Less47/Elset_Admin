# QuickBooks Online V3 implementation report

Implemented locally on 18 September 2026. QuickBooks Online now uses the existing accounting service, encrypted credentials, mappings, operations, payment reconciliation, webhook inbox and UI. No commit, push, deployment, Fly secret change, production database access or real Intuit company connection was performed.

The automated integration tests use synthetic HTTP fixtures and temporary local databases. **Live Australian Sandbox acceptance has not been run:** no development credentials were supplied. Complete the [Sandbox procedure](quickbooks-v3-setup.md#5-required-australian-sandbox-acceptance-test) before production use. Primary references and the documentation-access limitations are recorded in the [audit](quickbooks-v3-audit.md).

## 1. Existing provider architecture

`AccountingService`, `AccountingStore`, the provider registry and Xero adapter already owned OAuth, encryption, connection health, locking, configuration, mappings, durable write identities and logs. V2 added the external-payment ledger, inbound sync status and webhook inbox. V3 extends these boundaries. Customer Account remains a consumer of ordinary invoice/payment calculations.

## 2. Xero assumptions generalized

Moved Xero payment response translation into its adapter helper. Parameterized payment source/method, ownership projection, routes, receipt labels and accounting settings. Extracted the durable queue worker while retaining Xero's signature and event normalization. Restored the shared secure callback design because this checkout still contained browser-dependent callback code and a missing server authorizer export.

## 3. QuickBooks provider

Added `QuickBooksAccountingProvider` and registered `quickbooks`. It translates OAuth, CompanyInfo/Preferences, configuration queries, Customer creation/reuse, Invoice creation/update and authoritative Payment allocations. Intuit calls remain server-side. No separate credential store, queue, invoice system or customer balance system was introduced.

## 4. OAuth scope and flow

Requests only `com.intuit.quickbooks.accounting`. State combines a purpose prefix and cryptographically random nonce; only its digest is stored with workspace/provider, initiating user/session, environment and ten-minute expiry. The callback consumes state once and rechecks the original session, role and ban status on the server, without requiring a returning browser cookie. It returns an empty 302 to the fixed provider settings page with `no-store` and `no-referrer`. Other management endpoints retain authentication, role and origin checks.

## 5. Realm/company handling

Numeric OAuth `realmId` scopes authenticated CompanyInfo/Preferences reads and becomes the external tenant ID. `CompanyInfo.Id` is a separate record ID and is not compared with the realm. Company name, country and home currency are persisted; settings display company identity and environment. A different authorized company requires explicit confirmation, resets incompatible configuration and preserves the old company's mappings.

## 6. Sandbox/production separation

`QUICKBOOKS_ENVIRONMENT` must explicitly be `sandbox` or `production`. Connections and pending OAuth states retain the environment. A mismatch fails before token use or API calls, including after Disconnect. Use separate workspace databases for Sandbox and production; old environment mappings cannot be reused by changing an environment variable.

## 7. Token encryption and refresh

Reuses AES-256-GCM and workspace/provider/token-kind authenticated context. Access and rotating refresh tokens are saved together under the existing provider/workspace lock. Returned refresh-expiry metadata is retained. Expired/revoked access changes health to `NEEDS_REAUTHORIZATION`; subsequent actions require reconnect. No token/client secret is exposed through status, workspace data or UI.

## 8. Configuration requirements

An Australian company with the workspace's AUD currency, custom transaction numbers, an existing eligible sales item and a matching 10% GST sales code is required. Configuration and health checks read company data without creating Customers, Invoices, Items or Accounts. Missing operator configuration produces a customer-safe support message.

## 9. Product/Service strategy

Lists active Service and NonInventory Items backed by active income accounts in a searchable picker with type, account and SKU context. The selected ItemRef is used on invoice sales lines; each line keeps ELSET's own description, quantity and unit price. The explicit **Create "ELSET Services" in QuickBooks** setup action creates one Service item using a selected existing Income account, or reuses an eligible exact-name item. Invoice sync never creates items, and no chart-of-accounts entries are modified. See the [sales item configuration report](quickbooks-sales-item-configuration.md).

## 10. GST strategy

Uses Australian non-US sales TaxCode references with `GlobalTaxCalculation=TaxExcluded`. Supports an active single-rate sales code matching ELSET's existing treatment. QuickBooks calculates tax; subtotal, GST and total must match authoritative ELSET integer cents. A mismatch retains external identity and returns `ACCOUNTING_REVIEW_REQUIRED`. Live regional tax/rounding behavior remains a Sandbox acceptance check.

## 11. Customer mapping

Looks up the generic workspace/provider/realm/Customer mapping first. Newly created Customers receive a deterministic workspace/customer suffix and Notes marker; exact marker verification permits safe recovery after an ambiguous create. Similar names or emails are never merged. Existing mapped Customers are reused without overwriting their master data. Billing fields come from Customer; multiple Sites still share that Customer.

## 12. Invoice mapping

Uses the existing qualifying actual-invoice rule and manual outbound action. Drafts and quotes are blocked. Maps CustomerRef, generated DocNumber, dates, item/tax references, quantities, amounts, currency and a concise job/source memo. Stores the external ID, realm, DocNumber, SyncToken and fingerprint. It does not send invoice email through QuickBooks or change ELSET's issuance/email flow.

## 13. SyncToken and updates

Reads the mapped Invoice immediately before writing and compares managed fields and totals with the saved fingerprint. Sparse updates carry the current Id and SyncToken. Unrelated top-level fields survive; unmanaged line details, payments, credits, voids and external managed-field edits stop for review. Error 5010 causes a refetch and a rejected-operation state, never an automatic overwrite of unseen edits. A subsequent reviewed retry uses a new request identity.

## 14. Duplicate prevention

Reuses the shared durable operation UUID as Intuit `requestid`. Before an uncertain create is retried, exact DocNumber lookup must also match Customer, dates, lines and the source marker. Identity is stored before final totals validation. Unproven number ownership is a conflict. The application's five-minute uncertain-write retry limit is local policy, not a promise of indefinite Intuit idempotency.

## 15. Payment ownership

Historical Invoice mappings establish provider ownership. Server-side manual payment CRUD is blocked and imported receipts are read-only in the UI, even after disabling/disconnecting. Invoices already mapped to another provider or realm cannot be exported or reconciled under the new connection. Historical manual receipts are retained and require review.

## 16. Payment reconciliation

Reads current Invoice and linked Payment resources; imports only the amount allocated to that Invoice. Validates identity, currency, totals, dates, applied/unapplied amounts and consistency across repeated reads. Handles partial/full/multiple receipts, amount/date corrections and removal/reversal without duplicate activity. A Payment spanning invoices has one unique local receipt per allocation, never its full amount on every invoice.

All mapped invoices connected through current or historical allocations are prepared and committed in one SQLite transaction. Failed reconciliation cannot double-count both an old and a moved allocation. Unmapped allocations remain unimported. Groups above 100 invoices or 500 Payment identities require review. Credits and ambiguous linked lines require review.

## 17. Webhooks

Added public `POST /api/integrations/quickbooks/webhook`. Current CloudEvents Invoice/Payment created, updated, deleted and voided notifications persist minimal metadata in the existing inbox, acknowledge, then wake the shared worker. Unknown realms/resources never attach by name or invoice number. Payment events consider previous allocations too. Duplicate IDs are ignored, and authoritative reconciliation provides the financial idempotency. Retry-After, bounded exponential backoff, leases, restart recovery and paused/review states remain durable.

## 18. Signature verification

Checks `intuit-signature` as base64 HMAC-SHA256 over the exact raw body using `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`, with timing-safe comparison. The raw route precedes global JSON parsing and browser auth. Missing/invalid signatures return 401; unavailable configuration/storage returns 503. No auth cookie is written. Only a successfully persisted delivery is acknowledged with 200.

## 19. Customer Account

QuickBooks allocations become normal integer-cent `payments` rows. Existing invoice calculations and Customer Account queries immediately derive paid/outstanding values. No customer balance column/cache or provider-specific paid status was added. The automated partial-payment example verifies $500 paid and $600 outstanding on a $1,100 invoice.

## 20. Provider exclusivity

One accounting add-on may be enabled per workspace. Enabling the other is blocked with a deliberate explanation; the current provider must first be explicitly disabled. The server also blocks provider changes while accounting work holds a lease. Disabling preserves credentials/history and pauses reconciliation; Disconnect separately attempts revocation and clears active credentials. Historical invoices remain owned by their original provider.

## 21. SQLite version

Actual starting schema: **10**. Result: **11**, through one forward migration using the existing transactional migration mechanism. No downgrade or production migration was executed.

## 22. Tables/constraints

| Table | Change |
| --- | --- |
| `payments` | Rebuilt with `manual`, `xero`, `quickbooks` source constraint; every original column, extra JSON and existing row copied unchanged. |
| `integration_external_payments` | Identity includes the Invoice allocation; unique external Payment/Invoice relationship and local receipt ID prevent duplicate allocation rows. Existing Xero rows preserved. |
| `workspace_integrations` | Added provider environment and credential-expiry metadata JSON. |
| `integration_oauth_states` | Added provider environment. |
| `integration_entity_mappings` | Added external version/SyncToken. |
| Existing migration metadata | Version/ledger advance atomically; no business balance or status columns. |

The migration test constructs a genuine schema-10 database from historical migrations, retains business/Xero rows, injects a late failure to prove rollback, then checks successful upgrade, foreign keys, integrity and restart without repeat migration.

## 23. Xero regression results

Existing Xero accounting/payment unit tests pass as part of the full suite. All **28 Xero browser scenarios** pass, covering callback without cookies, permissions, configuration, invoice create/update/retry, payment changes, raw webhooks, unsaved edits, role guards and six themes at three viewport widths. Existing granular scopes, payloads, payment ownership and signature handling are retained.

## 24. QuickBooks and repository verification

| Command | Observed result |
| --- | --- |
| `npm test` | **494 passed; 0 failed, skipped or cancelled.** Includes 21 QuickBooks accounting tests and the genuine V10-to-V11 preservation/rollback test. |
| `npm run lint` | Passed. |
| `npm run build` | Passed; existing Vite large-chunk advisory remains. |
| `npx playwright test tests/e2e/quickbooks-integration.spec.mjs tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1` | **49 passed:** 21 QuickBooks, 28 Xero. |
| `git diff --check` | Passed. |

A repeat browser run exposed intermittent webhook-test contention: its status poll opened the database with migrations enabled, taking a write lock while the worker was processing. Polls now use read-only connections without migration. The targeted Xero webhook case then passed **five consecutive runs**; the complete accounting browser suite was rerun afterwards. The earlier diagnostic failure is retained in `output/quickbooks-v3-webhook-diagnostic.log`.

QuickBooks tests cover state/hash/expiry/replay, real initiating-session role/ban/expiry/revocation, encryption/rotation, environment/realm boundaries, configuration, Customer reuse, eligibility, lost responses, stale versions, protected edits, tax conflicts, payment allocations/corrections/removals, atomic reallocation rollback, ownership, exclusivity, raw signatures, durable events and real local worker execution. Browser HTTP fixtures never call Intuit.

Responsive checks cover 390, 820 and 1440px in Elset Classic, Copper Dawn, Evergreen Ledger, Midnight Signal, Studio Rose and Desert Circuit. Screenshots are under `test-results/quickbooks-v3`. Visual review sampled all six mobile settings themes, Midnight Signal tablet/settings/invoice/receipts, and Elset desktop settings; no claim is made of manual inspection of every screenshot. Logs are under `output/quickbooks-v3-*.log` (ignored by Git).

## 25. Sandbox manual test plan

The [setup guide](quickbooks-v3-setup.md) provides the complete unexecuted Australian Sandbox plan: Customer QUICKBOOKS V3 TEST, normal actual invoice email, $1,000 subtotal + $100 GST, one Customer/Invoice, repeat update, second Site, $500 then $600 receipts, correction/removal, cross-invoice allocation, manual conflict, remote edits and reconnect. It includes duplicate delivery and optional tunnel validation. No SMTP success or Sandbox result was fabricated.

## 26. Required environment variables

Operator-only: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI`, `QUICKBOOKS_ENVIRONMENT`, and `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN` for incoming webhooks. Reuse `ACCOUNTING_INTEGRATION_ENCRYPTION_KEY`. Exact default local callback: `http://localhost:3101/api/integrations/quickbooks/callback`; production template: `https://admin.elset.com.au/api/integrations/quickbooks/callback`. No real values were configured.

## 27. Documentation created

- [Audit and primary references](quickbooks-v3-audit.md)
- [Operator setup, Sandbox acceptance and production templates](quickbooks-v3-setup.md)
- This implementation report

## 28. Files changed

| Group | Files |
| --- | --- |
| Provider and shared accounting | `server-accounting-providers/quickbooks.js` (new), `server-accounting-providers/xero-payments.js` (new), `server-accounting-providers/xero.js`, `server-accounting-providers.js`, `server-accounting-service.js`, `server-accounting-store.js`, `server-accounting-errors.js`, `server-accounting-payments.js`, `server-accounting-payment-policy.js`, `server-accounting-routes.js` |
| Webhooks, auth and startup | `server-accounting-webhooks.js` (new), `server-quickbooks-webhooks.js` (new), `server-xero-webhooks.js`, `server-auth.js`, `server-app.js`, `server.js` |
| Workspace and migration | `server-accounting-v3-schema.js` (new), `server-workspace-db.js`, `server-workspace-state.js`, `server-workspace-addons.js` |
| Shared UI | `src/components/settings/AccountingSettings.jsx` (new), `src/components/settings/XeroSettings.jsx`, `src/components/settings/AddonsSettings.jsx`, `src/components/invoices/InvoiceAccounting.jsx`, `src/components/documents/DocumentEditor.jsx`, `src/App.jsx`, `src/lib/addons.js`, `src/lib/app-support.jsx` |
| New tests and fixtures | `tests/quickbooks-accounting.test.js`, `tests/quickbooks-migration.test.js`, `tests/helpers/quickbooks-mock.js`, `tests/fixtures/quickbooks-server.mjs`, `tests/e2e/quickbooks-integration.spec.mjs` |
| Regression expectations/fixtures | `tests/xero-accounting.test.js`, `tests/xero-payments.test.js`, `tests/e2e/xero-integration.spec.mjs`, `tests/job-costing.test.js`, `tests/workspace-migration.test.js`, `tests/workspace-schema-upgrade.test.js` |
| Documentation | The three `docs/quickbooks-v3-*.md` files above. |

## 29. Deferred and release boundaries

Live Intuit Sandbox authorization, Australian tax/numbering acceptance, actual email delivery and public HTTPS webhook delivery remain unverified. Intuit's current portal subscription options and production-app approval must be checked during operator setup. No tunnel or external credentials were configured.

Intentionally excluded: QuickBooks Desktop/Web Connector/qbXML; merchant Payments; outbound payment creation; suppliers/vendors/bills/expenses; Job Costing imports; credit memos; purchase orders; inventory; payroll; bank feeds; quotes/estimates; arbitrary imports; full two-way invoice editing; automated outbound invoice sending; customer master-data overwrite; periodic whole-company CDC polling. Different tax regimes, combined tax codes and non-AUD workspaces are outside this AU V3 configuration. Existing email-dependent invoice issuance is unchanged.

All changes remain local, uncommitted, unpushed and undeployed.
