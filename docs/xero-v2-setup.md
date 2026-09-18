# Xero V2 payment synchronisation and webhooks

V2 adds read-only Xero payment reconciliation for invoices already mapped through ELSET's Xero integration. See the [implementation audit](xero-v2-audit.md), [implementation report](xero-v2-report.md), and [V1 connection/configuration guide](xero-v1-setup.md).

Implementation and automated verification use synthetic data and mocked Xero responses. Live Demo Company consent, public HTTPS delivery and production setup remain unexecuted release checks. This guide does not authorise deployment, secret changes or production accounting writes.

## Customer workflow

1. Enable Xero in **Settings → Add-ons** and connect the intended organisation using the existing OAuth flow.
2. Existing V1 connections may show **Payment synchronisation: Additional Xero permission required**. Click **Update Xero Permissions** and approve consent in the same browser session. No manual disconnect is needed. If the current organisation remains authorised, its tenant selection, sales/tax configuration and invoice/Contact mappings are preserved.
3. Send a saved, issued invoice to Xero through **Send to Xero**. The existing issuance eligibility rule is unchanged: sent history or recorded payments; simply saving an invoice does not issue it.
4. Record and reconcile payments in Xero. Signed invoice UPDATE notifications trigger reconciliation when the webhook is configured. **Sync from Xero** performs the same reconciliation manually and is available without public webhook delivery.
5. The invoice displays **Xero payment** rows, paid/balance figures, payment sync status, last successful reconciliation and compact payment history. Customer Account derives its outstanding balance from those same payment rows.

Mapped invoices block local payment creation, editing and deletion, including after disabling/disconnecting Xero. Unmapped invoices retain their normal manual payment controls. Historical manual payments on mapped invoices remain visible and unchanged, but cause **Review required** even if their amounts equal Xero's amounts. V2 does not auto-match, delete, hide from totals, or combine these records. Have the accountant/operator review both systems; there is no force-reconcile or conflict-resolution button in V2. Do not clear mappings to bypass this protection.

Corrections update the same external payment identity. Payments removed from the authoritative invoice, or marked DELETED, stop contributing to ELSET's paid amount; their external ledger and activity remain. Invoice identity, contact, currency, total or status conflicts leave the last accepted local payment state unchanged. Credit notes and prepayment/overpayment allocations also require review.

An open, clean Invoice page reads local sync status on focus and every 30 seconds while visible. It does not poll Xero. Unsaved invoice drafts are not overwritten. Customer Account retains its existing local summary refresh. Settings saying payment synchronisation is Connected means permission is granted; it is not a claim that public webhook delivery is healthy.

## Operator configuration

The existing server credentials and stable encryption key from V1 remain required. V2 adds **`XERO_WEBHOOK_KEY`**, the application webhook signing key from Xero's Developer portal. It is server infrastructure, never a workspace setting, customer input, frontend variable or logged value. `.env.example` contains an empty placeholder only. Missing production configuration emits a fixed safe server diagnostic and prevents webhook acceptance.

OAuth requests these scopes:

```text
offline_access
accounting.contacts
accounting.invoices
accounting.settings.read
accounting.payments.read
```

No payment write scope or broad `accounting.transactions` scope is requested. Existing V1 grants can still perform V1 invoice operations while awaiting additional payment consent. Insufficient payment scope marks permission-required, pauses queued work, and prevents repeated payment API calls until consent is updated. [Xero scope reference](https://developer.xero.com/documentation/guides/oauth2/scopes/).

The database migrates transactionally from schema **9 to 10** once. Existing payments become `source=manual` without changing their amounts, dates, IDs, notes or links. Take a verified SQLite backup before an approved release and preserve the V1 encryption key separately. Integration identities, queue and reversal history require a database backup; JSON exports are not a replacement. Do not downgrade the schema number to roll back an application.

## Production webhook setup — document only

Complete these steps only during a separately authorised release:

1. In the intended **Xero Developer App → Webhooks**, subscribe to **Invoice** events. The application handles INVOICE UPDATE and safely ignores CREATE/unsupported events; it does not import arbitrary Xero invoices.
2. Set the delivery URL to **`https://admin.elset.com.au/api/integrations/xero/webhook`** for the intended production origin. The route is relative in application code; the hostname is not embedded in it. A separate test environment must use its own intentionally configured, publicly reachable HTTPS URL.
3. Obtain the **Webhook Key** from that app's Webhooks configuration and store it privately as the server secret `XERO_WEBHOOK_KEY`. Never add the value to Git, screenshots, tickets, frontend configuration or this guide.
4. The required Fly command template is below. It was **not executed**. Setting a secret can update running Machines; coordinate it with the approved release procedure.

   ```powershell
   fly secrets set XERO_WEBHOOK_KEY="<secret>" -a elset-admin
   ```

5. Deploy the reviewed V2 version through the existing release process, after backup and release checks. Verify startup completes, schema is 10, the server is healthy and no fixed missing-key diagnostic is present. This task performed no deployment.
6. Trigger Xero's **Intent to Receive** validation. A correctly signed empty event envelope must return 200; deliberately incorrect/missing signatures return 401. Responses have no authentication cookies or login redirects. Confirm Xero reports delivery validation OK. [Webhook validation and response requirements](https://developer.xero.com/documentation/guides/webhooks/overview/).
7. Have authorised workspace admins/office users use **Update Xero Permissions** for `accounting.payments.read`. Confirm the intended tenant and prior invoice/configuration mappings remain intact.
8. For a separately approved smoke test, use a known mapped invoice and a real, authorised accounting payment action. Check the webhook is acknowledged promptly, the durable event completes, the corresponding invoice payment/balance changes once, and Customer Account agrees. Repeat **Sync from Xero** and confirm no extra payment or history entry. Do not create fictitious production payments merely to test the integration.

The configured webhook belongs to the Xero app, not a browser session. This deployment owns one SQLite workspace; only its currently connected tenant and an exact tenant-scoped external InvoiceID mapping can select an ELSET invoice. Unknown tenants/invoices are safely recorded as ignored. Multiple separately hosted workspaces would need an app-level routing design before sharing a single webhook URL; V2 does not introduce that infrastructure.

## Exact Xero Demo Company test plan

Use a disposable synthetic ELSET workspace and a separate development Xero app connected **only to Xero Demo Company**. Do not copy production credentials or a connected production database. Set the development app's exact OAuth redirect and local frontend/auth origins following the V1 guide. Use a controlled local SMTP test sink or test recipient; do not fabricate send success.

1. Create customer **V2 Demo Payment Test**, a Site and a Job. Use a test email under your control/test sink. Enable Xero, connect Demo Company, select an appropriate sales account and 10% GST revenue tax mapping. If testing an old V1 grant, first verify permission-required, then run Update Xero Permissions and confirm tenant/configuration preservation.
2. Create an invoice with one line: quantity **1**, rate **$1,000.00** excluding GST. Confirm GST **$100.00**, total **$1,100.00**. Set valid issue/due dates, save, then use the existing **Preview & Send Invoice** flow to the controlled recipient and confirm actual delivery/send history. Do not add a manual payment to make this invoice eligible.
3. Click **Send to Xero**. Wait for **Synced**. Confirm the invoice number, Contact, total AUD $1,100 and AUTHORISED state in Demo Company. Record its external InvoiceID from operator mapping inspection; the same tenant/InvoiceID must be reused on subsequent syncs. No second invoice should appear after unchanged Update Xero.
4. In Demo Company, record a **$500** payment against that invoice using a suitable Demo bank account and a valid date.
5. In the local ELSET invoice click **Sync from Xero**. Confirm one read-only **Xero payment $500.00**, Paid so far **$500.00**, Balance **$600.00**, a partial/deposit/overdue status as appropriate to the due date, **Payment sync: Up to date**, and a last-sync timestamp.
6. Open that Customer's **Account** tab. With only this test invoice outstanding, confirm **$600.00** outstanding and the invoice balance **$600.00**.
7. Record the remaining **$600** against the same Demo invoice. Sync from Xero again. Confirm two external payments, **$1,100.00** paid, **$0.00** balance and **Paid** status. Confirm Customer Account outstanding **$0.00** and the settled invoice is absent from its outstanding list.
8. Repeat Sync from Xero twice. Confirm payment IDs/count and activity entries are unchanged; only last checked/synced metadata may advance.
9. If Demo Company permits, remove/reverse the $600 test payment. Sync again. Confirm only $500 counts, balance returns to $600, Paid clears, Customer Account returns to $600, and the removal/reversal is in payment sync history. The external ledger retains the removed payment identity.
10. If Demo Company permits editing an amount under the same PaymentID, correct $500 to **$300**, sync, and confirm the same local mapped row now counts $300, balance $800, with correction history. If Xero instead replaces a payment with a new ID, expect a removal plus a new payment, with only the current amount counted. Do not use unsupported API writes to manufacture an edit. The exact $5,000 → $500 same-ID case is automated in the mock suite.
11. On a separate synthetic invoice, record a **manual $500** in ELSET before mapping, send it to Xero, and record a Demo payment of $500. Sync from Xero: expect **Review required**, the original manual row unchanged, no Xero payment added and no $1,000 double count. Repeat with a differing Demo amount; expect the same preservation rule. Confirm manual payment controls/API writes are blocked after mapping.
12. On another disposable mapped, unpaid Demo invoice, void it in Xero if permitted. Sync from Xero: expect **Review required**, with the ELSET invoice, Job and history preserved. Restore/correct test conditions in Demo Company only as permitted, then manually sync to reassess. Test mismatched totals/number/contact/currency through mocks when Demo editing is restricted.
13. Verify the payment card and read-only rows on mobile/tablet and Midnight Signal; verify a normal unmapped invoice still accepts manual payments. Disconnect/disable at the end only if the test connection is no longer needed. Existing payment records and mappings remain.

Localhost is not a public webhook destination. The above Demo plan uses **Sync from Xero**. Automated tests exercise raw signatures and delivery without contacting Xero. Optional actual webhook testing requires a deliberately configured secure public HTTPS test endpoint, its correct signing key, Demo-only consent and the same signature checks. Do not weaken authentication or use production accounting for tunnel testing.

## Durable processing and recovery

The public route verifies HMAC-SHA256/base64 over the exact request bytes, using a timing-safe comparison, before parsing/persisting. It stores minimal event identities/sequence metadata, commits before returning 200, then wakes the queue consumer. It never fetches the event's resource URL. No OAuth tokens, full customer/payment payloads or bank details enter the inbox. [Current event schema](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-webhooks.yaml).

Delivery retries with the same batch bounds, event position and identities share an inbox ID. A rebundled event may have another ID, but authoritative reconciliation and SQLite payment uniqueness make the financial result idempotent. Old/out-of-order events read current Xero state, not historical amounts from the event.

| Inbox state | Handling |
| --- | --- |
| PENDING | Durable event waiting to be claimed. |
| PROCESSING | Two-minute lease renewed every 15 seconds. Expired work is recoverable after a crash. |
| RETRYABLE | Persisted next attempt; exponential delay from 30 seconds to one hour, respecting a longer Xero Retry-After. Maximum eight processing attempts. |
| PAUSED | Add-on disabled, disconnected, or additional permission/reauthorisation required. Eligible work resumes when the worker wakes after reconnect/consent/manual accounting actions or server startup; re-enabling alone may require Sync from Xero. |
| REVIEW_REQUIRED | Safe accounting conflict; inspect and correct the underlying condition, then use Sync from Xero. No automatic financial changes. |
| FAILED | Non-retryable failure or exhausted attempts. Diagnose the safe message, then use Sync from Xero after recovery. An expired final-attempt lease is marked FAILED. |
| PROCESSED / IGNORED | Completed reconciliation, or unsupported/unmapped event. Retained for diagnosis. |

Worker startup is non-blocking and consumes at most 20 events per batch. Retry due times and leases are persisted. Manual Sync from Xero is the supported recovery/reconciliation action for a mapped invoice and reads its latest authoritative state; it does not rewrite old inbox outcomes or blindly replay an old payment amount. Do not delete payment mappings or change source markers as a retry procedure.

Operator inspection can use read-only queries, for example:

```sql
SELECT status, COUNT(*) AS event_count FROM integration_webhook_events GROUP BY status;
SELECT id, status, attempt_count, retry_at, last_error_at, safe_error_message
FROM integration_webhook_events
WHERE status IN ('FAILED','REVIEW_REQUIRED','PAUSED','RETRYABLE')
ORDER BY received_at DESC LIMIT 20;
```

There is **no unattended periodic invoice reconciliation scheduler**. Timers consume already-persisted work while the server runs; startup recovers work after downtime. Fly autostop and process restarts prevent an in-process timer from guaranteeing scheduled catch-up. Missed events with no inbox row require Manual Sync from Xero. A true periodic safety net needs separately designed deployment scheduling.

## Verification commands

```powershell
npm test
npm run lint
npm run build
npx playwright test tests/e2e/xero-integration.spec.mjs tests/e2e/customer-account.spec.mjs tests/e2e/customer-workspaces.spec.mjs tests/e2e/customer-missing-email.spec.mjs tests/e2e/job-costing.spec.mjs tests/e2e/document-workspaces.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
git diff --check
```

These tests inject synthetic Xero HTTP responses, use disposable local databases and intercept OAuth consent. Document email tests use a local SMTP sink. Passing them does not establish live Demo consent, public webhook reachability, Xero's portal validation or production operational readiness.
