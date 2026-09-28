# Automatic bidirectional QuickBooks invoice payments

Payments can be entered in ELSET or QuickBooks. Saving an ELSET payment automatically queues its QuickBooks change. Signed QuickBooks Invoice/Payment CloudEvents automatically reconcile changes back into ELSET. **Sync with QuickBooks** remains available for recovery and reconciliation.

## Local saves and outbound processing

The existing admin/office document payment routes save the local receipt and accounting intent in one SQLite transaction. They wake the shared accounting worker after success. Provider availability does not determine whether a valid local payment saves. Local method, reference and notes remain local; amount and payment date synchronise.

The worker uses the existing accounting service, encrypted credentials, provider lock, realm/environment checks, invoice ownership, operation identities and audit log. Missing customer/invoice dependencies use the existing invoice sync routine, including the existing Product/Service and GST mappings. Payment sync does not invoke document generation, sending or customer email.

| Change | Result |
| --- | --- |
| Add in ELSET | Create one Accounting API Payment with the mapped CustomerRef and Invoice allocation. |
| Edit in ELSET | Read and compare the saved complete Payment snapshot, then update the same Payment ID with its current SyncToken. Preserve unrelated fields and other invoice allocations. |
| Remove in ELSET | Delete a sole fully applied Payment using Id and SyncToken. For a shared or partly unapplied Payment, remove only the target allocation and reduce TotalAmt by that allocation; preserve other allocations and unapplied money. |
| Create in QuickBooks | Read the current invoice/payment state and create one local row per mapped invoice allocation. |
| Edit/reallocate in QuickBooks | Update existing local receipt identities and reconcile the connected group of previous and current mapped allocations atomically. |
| Delete/void in QuickBooks | Remove affected local receipts, retain external mapping tombstones and audit history. |

Changing the date of a shared QuickBooks Payment changes its whole receipt date. Confirmation reconciliation refreshes every mapped allocation. Payments with unsupported credits, protected card/deposit links, inconsistent totals or conflicting external changes require review instead of a guessed mutation. This integration records accounting receipts; it never charges/refunds a card (`ProcessPayment` is false).

Payment create/update fields were checked against [Intuit's create schema](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/tools/create-payment.tool.ts) and [official Payment update example](https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/request/4884662-ff04dcf3-6b55-47c6-9472-cdbd062b9910). Delete uses the Accounting API Payment delete operation with the current Id/SyncToken, consistent with [Intuit's Payment delete handler](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/handlers/delete-quickbooks-payment.handler.ts) and [SDK deletion guidance](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/docs/_sources/quickstart.rst.txt). The public entity documentation portal returned a loading shell during this review. No live provider write was used for verification.

## Durable identity, retries and concurrency

- Migration **14** adds `integration_payment_outbox`, `integration_operations.request_json` and `integration_external_payments.external_snapshot_json`. It uses the existing forward migration/transaction/ledger mechanism. Existing rows are preserved; no historical receipts are automatically exported.
- The outbox retains the original workspace, provider, realm, environment, invoice and local payment ID, even after local deletion. Revisions preserve edits made while an earlier operation is in flight.
- `integration_external_payments` maps each provider/company/Payment/invoice allocation to its existing local payment ID. Incoming echoes update that row; reconciliation never creates outbound intent.
- A dispatched operation stores its exact request, revision and durable `requestid`. A create includes a unique private correlation marker. Recovery searches for that marker before repeating a request; after identifying the Payment, its ID is authoritative. Amount/date/description matching is not the identity mechanism.
- An uncertain update/delete is read back before retry. Successful writes are recognised without another POST. An unconfirmed retry uses the identical original request ID and payload within the existing five-minute application retry window. Expired, changed or ambiguous outcomes stop for review; a new create is never issued blindly.
- Provider SyncTokens and saved snapshots prevent overwriting unseen external edits. A stale SyncToken is rejected without refreshing it and blindly retrying the write.
- Inbound reconciliation checks for pending local writes both before provider reads and inside the final transaction. Dirty browser forms submit the original payment amount/date as edit/delete preconditions, rejecting stale form changes. A new receipt arriving behind a dirty form is not implicitly deleted.
- A successful outbound operation adds a durable confirmation event to the existing inbox. Shared allocation refresh does not depend solely on QuickBooks delivering its echo webhook.
- Retryable failures use bounded backoff; after repeated failures the change remains reviewable. Disabled/disconnected integrations and pending company confirmation pause work. Reconnect/wake resumes eligible work for its original company. New company/environment connections cannot receive old queued payments.

## Limits and recovery

Review errors preserve the local change and external accounting state. Manual **Sync with QuickBooks** retries/reconciles after the cause is resolved; it does not override a conflict or silently choose a winning system. Conflicting edits, unsupported credit/deposit/card states or irreconcilable uncertain results need accounting review.

Existing local positive-payment/overpayment validation remains unchanged. ELSET can retain a positive overpayment, but this invoice-allocation sync does not manufacture unapplied QuickBooks credit: an amount above the available QuickBooks invoice balance is retained locally with review status.

Incoming automatic changes require the configured signed webhook subscriptions and a running application worker. There is no whole-company polling/import. Receipts that predate the outbound queue and lack a known QuickBooks identity retain the historical manual-payment review guard. Xero payment ownership remains unchanged.

Verification uses only synthetic local databases, the existing QuickBooks HTTP mock and local browser fixtures. Real Australian Sandbox acceptance and production behaviour remain unverified. No production data, reset scripts, Fly deployment or customer email is part of this change.

## Observed verification

- `npm.cmd test`: **751 passed**, zero failed.
- `npm.cmd run lint`: passed.
- `npm.cmd run build`: passed.
- `git diff --check`: passed.
- `npx.cmd playwright test tests/e2e/quickbooks-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1`: **41 passed**.
- Document/Xero regression: **7 passed**, using those same Playwright config/tsconfig/worker flags with `tests/e2e/document-workspaces.spec.mjs tests/e2e/xero-integration.spec.mjs --grep 'invoice payment controls|existing invoice preserves|payments|receipt|external'`.
- After the final Settings wording change, five Settings/payment/re-enable browser cases passed again. The final unsent-invoice receipt-removal assertion also passed in its focused provider test.
- Visually inspected the Midnight Signal payment form at 390px and Elset Classic at 1440px. The broader browser run checks all eight themes at 390, 820 and 1440px for overflow.

The unit coverage includes outbound customer/invoice dependencies, create/edit/delete, shared allocations and dates, replay/echo handling, lost create/update/delete responses, restart, locks, stale forms, concurrent provider changes, SyncTokens, original-company isolation, outages, pause/resume, roles, no email, and migration rollback/preservation. Existing incoming CloudEvents and Xero tests continue to pass.

Logs and screenshots are local ignored artifacts under `test-results/` (`payment-full-unit.log`, `payment-lint.log`, `payment-build.log`, `payment-browser.log`, `payment-browser-regression.log`, and `payment-browser-final-settings.log`). No live provider or production verification is claimed.

## Files changed (37)

The schema-version expectation changes below are required by migration 14. Price List, maintenance and Xero business logic was not redesigned.

```text
docs/quickbooks-cloudevents-report.md
docs/quickbooks-payment-sync.md
docs/quickbooks-v3-report.md
docs/quickbooks-v3-setup.md
server-accounting-payment-intents.js
server-accounting-payment-outbox-schema.js
server-accounting-payment-outbox.js
server-accounting-payment-policy.js
server-accounting-payments.js
server-accounting-providers/quickbooks-payment-writes.js
server-accounting-providers/quickbooks.js
server-accounting-service.js
server-accounting-webhooks.js
server-addon-routes.js
server-document-routes.js
server-workspace-backup.js
server-workspace-db.js
server-workspace-documents.js
src/components/documents/DocumentEditor.jsx
src/components/invoices/InvoiceAccounting.jsx
src/components/jobs/JobRoutePages.jsx
src/components/settings/AccountingSettings.jsx
src/hooks/useWorkspaceActions.js
src/lib/addons.js
tests/accounting-webhook-leases.test.js
tests/e2e/quickbooks-integration.spec.mjs
tests/fixtures/quickbooks-server.mjs
tests/helpers/quickbooks-mock.js
tests/maintenance-recurrence.test.js
tests/price-list.test.js
tests/quickbooks-accounting.test.js
tests/quickbooks-migration.test.js
tests/quickbooks-webhooks.test.js
tests/workspace-migration.test.js
tests/workspace-schema-upgrade.test.js
tests/xero-accounting.test.js
tests/xero-payments.test.js
```
