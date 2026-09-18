# Xero V2 implementation report

Implemented locally on 18 September 2026. No commit, push, deployment, Fly secret change, production webhook configuration or production accounting access was performed. Live Demo Company and public HTTPS validation remain unexecuted; the automated Xero coverage uses mocks.

## 1. V1 architecture discovered

`AccountingService`, `AccountingStore`, a provider registry and `XeroAccountingProvider` already supplied OAuth, server-owned workspace/tenant selection, Contact/invoice mapping, account/tax configuration, encrypted credentials, per-workspace leases and safe sync logs. AES-GCM credentials are bound to workspace/provider/token kind. Hashed OAuth state is expiring, single-use and session-bound. Refresh and sync use the existing SQLite lock. V2 extends these components; it does not replace V1.

The full pre-implementation audit, middleware/startup findings and official Xero contract references are in [xero-v2-audit.md](xero-v2-audit.md).

## 2. Existing payment architecture discovered

SQLite `payments` stores integer cents, date, method, reference, notes and extras, linked to an invoice. Dedicated authenticated APIs perform manual CRUD; ordinary invoice replacement does not replace payment rows. `invoiceFinancialsFromRows` and `invoiceStatusFromAmounts` supply derived financial values/status. Customer Account and Job Costing consume these normal calculations. There is no stored customer balance.

Invoice issuance still follows existing sent-history/positive-payment eligibility. V2 does not introduce independent issuance or change email/PDF behavior.

## 3. Payment ownership rule

An invoice with a Xero mapping uses Xero as its payment authority. Local add/edit/delete is blocked on the server and hidden in its payment UI. Ownership persists after disconnect/disable and is derived from authoritative mappings, not description text or client input. Unmapped invoice manual payments retain existing behavior. Existing historical manual records require review before any Xero amounts can be applied.

## 4. OAuth scopes

Added only `accounting.payments.read` to `offline_access`, `accounting.contacts`, `accounting.invoices` and `accounting.settings.read`. No payment write access, deprecated broad transactions scope or OpenID scopes were added. The V1 scopes remain the base requirement for invoice operations, so an old grant still supports V1 while awaiting payment permission.

## 5. Update Permissions

Settings detects persisted grants lacking payment scope and presents **Update Xero Permissions**. It reuses the secured OAuth flow without requiring disconnect. Consent preserves the current authorised tenant even when multiple organisations are returned, along with configuration and mappings. Insufficient scope produces `PAYMENT_PERMISSION_REQUIRED`, removes the unusable payment grant from local capability state and pauses further payment calls pending consent.

## 6. Webhook route

Public **POST `/api/integrations/xero/webhook`** is registered before the global JSON parser and outside browser auth. It accepts signed Xero intent validation and Invoice UPDATE events. Unsupported event types are recorded as ignored. It does not import Xero-created invoices.

## 7. Raw-body verification

The route captures an uninflated raw Buffer with a 256 KB limit, computes HMAC-SHA256 using server-only `XERO_WEBHOOK_KEY`, decodes `x-xero-signature` and compares equal-length digests with `timingSafeEqual`. Missing/malformed/wrong signatures return 401 before persistence or Xero calls. Signed JSON is parsed only after verification. Successful validation/delivery returns 200 without login redirects or authentication cookies. Missing server key prevents delivery and emits a fixed safe diagnostic in production.

## 8. Durable inbox and idempotency

Minimal sequence/category/type/tenant/resource/date metadata is stored transactionally before acknowledgement. The event ID hashes batch sequence bounds, event position and stable metadata; entropy and untrusted resource URLs are excluded. Replays in the same envelope deduplicate in SQLite. Rebundled/out-of-order events may produce another inbox row but always reconcile current authoritative state; unchanged payment state creates no duplicate financial/history entries.

The queue uses owner leases, crash recovery, persisted retry times, safe errors and eight-attempt bounds. It honours Retry-After and exponential backoff. Processing occurs after acknowledgement, not during remote API reads inside the webhook response.

## 9. Tenant/workspace mapping

Each deployment currently owns one server-resolved SQLite workspace. Only its selected external tenant may proceed. The event's tenant plus external InvoiceID must match its provider-scoped invoice mapping, joined to a current local invoice. Unknown tenants and unmapped resources are ignored without financial mutation. Invoice number, contact name, session, IP and resource URL never select a workspace/invoice. Sharing one app webhook across separately hosted workspaces would need additional routing infrastructure.

## 10. Reconciliation algorithm

1. Acquire the existing workspace/provider lease and enforce add-on, connection and retry constraints.
2. Resolve the mapped eligible local invoice and reject ambiguous manual payment ownership.
3. Use the existing encrypted/rotating credentials; verify the selected tenant remains authorised and the organisation identity/currency agrees.
4. Retrieve the mapped current invoice. Validate InvoiceID/number, expected Contact, ACCREC type, AUD currency, AUTHORISED/PAID status, exact total cents and consistent paid/due amounts. Reject credit/prepayment/overpayment allocations.
5. Read each referenced payment using GET `/Payments/{PaymentID}`. Verify invoice ownership, status, amount/date and aggregate agreement with AmountPaid. Read the invoice again to reject a changing remote snapshot.
6. In one SQLite transaction, recheck local source/connection/mapping/manual-payment state, upsert effective payments and external mappings, retire no-longer-effective rows, append only changed activity, and update payment sync metadata/timestamps. Existing derived calculations provide balances and status.

Total consistency uses exact rounded integer cents; there is no unexplained monetary tolerance. No Xero payment write endpoint is implemented or called.

## 11. External payment mapping

`integration_external_payments` records workspace/provider/tenant, external PaymentID, external InvoiceID, local invoice/payment IDs, amount/date, ACTIVE/REMOVED state and external/local timestamps. Composite primary/unique constraints prevent a PaymentID from producing another active local row or crossing invoice ownership. Local payment IDs are unique. `payments.source` is trusted server metadata; client extras cannot override it.

## 12. Partial payments

A $1,100 invoice with a $500 Xero payment has $500 paid and $600 outstanding. Its existing status logic yields a deposit/partial/overdue state according to payment count and due date, not Paid. Each payment keeps its own identity; $300 + $400 + $400 produces three effective payment rows.

## 13. Full payment

When validated Xero state and payment details agree on $1,100 paid and $0 due, the normal ELSET calculation returns Paid and zero outstanding. There is no competing stored financial-status model. A transition into full payment records a truthful payment-sync activity entry.

## 14. Corrections and reversals

Same-ID amount/date corrections update the existing local payment. The $5,000 → $500 case therefore leaves $500 counted, not $5,500. Missing or DELETED effective payments are removed from the normal financial rows, marked REMOVED in the external ledger and logged. Reappearance reuses the same local identity. Reversal evidence and previous activity remain; repeat reconciliation does not add duplicate activity.

## 15. Historical manual payment conflicts

Any existing manual row blocks inbound reconciliation, including an equal $500/$500 case and differing amounts. The original rows, totals and notes remain unchanged; no external amount is added. They are shown read-only as **Historical manual payment**. The conflict is recorded as review required. Automatic matching and a manual-conflict resolution workflow are intentionally absent; an accountant/operator must review the records. V2 supplies no destructive override.

## 16. Customer Account

Accepted Xero payments become normal effective payment rows, so the existing invoice-only query and summary derive the new outstanding amount. A partial $500 against $1,100 produces $600; settlement removes the invoice from the outstanding list. The existing summary refresh remains in use. An open clean invoice refreshes its local projection on focus/every 30 seconds, while unsaved drafts remain protected.

## 17. Voided and conflicting invoices

VOIDED, unexpected status, missing external invoice, changed number/contact/currency/total, unsupported allocations, tenant changes, inconsistent details and concurrent local edits fail safely. Accepted local financial data is retained and a safe review/reauthorisation/permission/error state is recorded as appropriate. Jobs, customers, invoices and sent history are not automatically deleted or voided.

## 18. Schema version

One forward migration: **9 → 10**, named `accounting-payment-reconciliation`. Tests construct a genuine schema-9 database, verify transactional rollback on migration failure, preservation of business records with source defaulting to manual, successful upgrade and no repeated migration on restart. Existing older-version/backup schema tests now expect 10.

## 19. Tables, columns and indexes

- `payments.source TEXT NOT NULL DEFAULT 'manual'`, constrained to manual/xero.
- `integration_invoice_payment_sync`: ownership, managed flag, sync/review state, safe error and success/external-update timestamps per invoice.
- `integration_external_payments`: durable external identity/payment ledger with composite uniqueness and unique local payment ID; `idx_external_payments_invoice` supports invoice reconciliation.
- `integration_webhook_events`: minimal durable event metadata, status, attempt/retry/lease fields and safe diagnostic timestamps; `idx_webhook_ready` supports queued recovery.

Existing generic mappings, encrypted credentials and sync-log tables remain in use. The migration does not rewrite existing business amounts or classify historical payments as Xero.

## 20. Manual Sync from Xero

Mapped invoices expose **Sync from Xero**, using authenticated, role-checked, origin-guarded POST `/api/jobs/:id/invoice/integrations/xero/sync-payments`. It invokes exactly the reconciliation used by the worker. Repeated sync is safe. The UI shows read-only Xero payment rows, payment sync health, last sync and history. Save unsaved invoice changes before manually syncing.

## 21. Background processing decision

No durable periodic scheduler was found. The new worker starts after server listen, processes bounded batches of up to 20 persisted events, recovers expired leases and schedules persisted retries while the process is alive. Webhook acknowledgement and successful accounting mutations wake it. Paused eligible work resumes on a subsequent wake/startup. Manual Sync from Xero is the recovery path for missed events and terminal conflicts/failures.

There is **no guaranteed unattended periodic reconciliation** of all mapped invoices. That needs deployment scheduler infrastructure and was not introduced to work around Fly autostop. In-process retry timers are not represented as such a scheduler.

## 22. Documentation

- [Audit and design decisions](xero-v2-audit.md).
- [Setup, recovery, Demo Company plan and production templates](xero-v2-setup.md).
- [V1 guide](xero-v1-setup.md) now points to V2 and labels its old scope/schema/boundary as the V1 baseline.
- `.env.example` contains an empty operator-only webhook-key placeholder.

## 23. Files changed

New runtime files: `server-accounting-payment-schema.js`, `server-accounting-payment-policy.js`, `server-accounting-payments.js`, `server-xero-webhooks.js`.

Updated runtime files: `.env.example`, `server-accounting-errors.js`, `server-accounting-providers/xero.js`, `server-accounting-routes.js`, `server-accounting-service.js`, `server-app.js`, `server-workspace-db.js`, `server-workspace-documents.js`, `server-workspace-state.js`, `server.js`, `src/App.jsx`, `src/components/documents/DocumentEditor.jsx`, `src/components/invoices/InvoiceAccounting.jsx`, `src/components/settings/XeroSettings.jsx`, `src/lib/app-support.jsx`.

Tests: new `tests/xero-payments.test.js`; updated `tests/xero-accounting.test.js`, `tests/helpers/xero-mock.js`, `tests/fixtures/xero-server.mjs`, `tests/e2e/xero-integration.spec.mjs`, `tests/workspace-schema-upgrade.test.js`, `tests/workspace-migration.test.js`, `tests/maintenance-recurrence.test.js`.

Documentation: new `docs/xero-v2-audit.md`, `docs/xero-v2-setup.md`, `docs/xero-v2-report.md`; updated `docs/xero-v1-setup.md`.

The preceding Customer missing-email task's uncommitted `CustomerManager.jsx`, `src/index.css`, missing-email browser test and two harness files were preserved. They are separate from V2.

## 24. Verification results

- `npm test`: **472 passed, 0 failed**. Includes 23 new payment/webhook/migration tests plus V1/whole-unit-suite regressions.
- `npm run lint`: passed.
- `npm run build`: passed; Vite emitted its existing >500 KB chunk-size warning.
- Browser regression: **123 distinct scenarios passed across the broad run and final Xero rerun**. The broad run had 122 passes and one old V1 assertion expecting `paymentManagement=manual` after mapping; it was corrected to expect Xero ownership while still requiring every business field to remain identical. The full Xero rerun then passed **28/28** in 49.4 seconds; the other **95/95** customer/document/Job Costing scenarios passed in the broad run. No runtime fix was needed for that assertion.
- Visual review: inspected the actual local screenshots across all six themes and phone/tablet/desktop sizes, including Midnight Signal payment rows, sync metadata/history control and mobile conflict display. Centered screenshot capture keeps the existing fixed mobile action bar from obscuring the captured card. Artifacts: `test-results/xero-v2/`.
- `git diff --check`: passed.

Observed logs: [unit/integration](../output/xero-v2-unit.log), [broad browser regression](../output/xero-v2-browser-regression.log), [final Xero browser suite](../output/xero-v2-browser-final.log), [lint](../output/xero-v2-lint.log). These are local verification artifacts, not production logs.

Tests cover partial/full/multiple payments, same-ID correction, removal/reappearance, replay/activity deduplication, historical manual conflicts, local CRUD protection after disconnect/disable, total/number/contact/currency/status/credit conflicts, missing invoice, wrong tenant, revoked access, insufficient scope and additive consent, refresh rotation, cross-invoice identities, transactional failure/concurrent edits, raw public signatures/intent/no cookies/fast durable acknowledgement, retries/Retry-After/crash exhaustion/startup, authenticated manual endpoint, mapped unpaid invoice restore and schema migration preservation.

The broad browser selection includes all six themes at phone/tablet/desktop for Xero and exercises Customer Account, Customer pages, Job Costing and existing document send/PDF workflows using only local synthetic data and a mail sink. Mock tests do not prove live Xero consent, public delivery or portal validation.

## 25. Exact Demo Company plan

The numbered [Demo Company plan](xero-v2-setup.md#exact-xero-demo-company-test-plan) covers synthetic customer/job creation, actual controlled test invoice sending, mapped $1,100 Demo invoice, $500 partial then $600 final payment, Customer Account, correction/removal, idempotency, manual conflict and VOIDED review. It uses Manual Sync locally because localhost is not a public webhook endpoint. **Not executed in this task.**

## 26. Production setup

The [operator-only production guide](xero-v2-setup.md#production-webhook-setup--document-only) specifies Invoice subscription, `https://admin.elset.com.au/api/integrations/xero/webhook`, private key retrieval/storage, approved deployment, Intent to Receive validation, additional consent and a controlled smoke test. Required command template, **not executed**:

```powershell
fly secrets set XERO_WEBHOOK_KEY="<secret>" -a elset-admin
```

## 27. Deliberately deferred

No Xero payment creation/edit/deletion, QuickBooks, credit-note reconciliation, supplier bills/expenses, bills-to-Job-Costing, bank feeds, purchase orders, arbitrary Xero invoice/contact import or full two-way invoice editing. Automatic historical manual-payment resolution, a true unattended reconciliation scheduler and multi-deployment webhook routing need separately scoped work. Live Demo Company and public HTTPS/production smoke checks remain release validation work, not claimed completed features.
