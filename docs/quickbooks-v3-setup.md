# QuickBooks Online V3 setup

This guide starts with an **Australian QuickBooks Online Sandbox** and a separate local ELSET test workspace. No production credentials or real company connection were configured during implementation. Customers use **Connect to QuickBooks**; only the operator configures server credentials.

## 1. Prepare the Intuit Sandbox

1. Sign in to [Intuit Developer](https://developer.intuit.com/) and create an app for **QuickBooks Online Accounting**. Do not select the merchant Payments product for this integration.
2. Create/open an **Australian Sandbox company** with AUD home currency. Use synthetic customer and invoice information.
3. In the app's **Development** settings, add this exact redirect URI: `http://localhost:3101/api/integrations/quickbooks/callback`.
4. Copy the **development** Client ID and Client Secret to the operator's local server configuration. Never paste them into ELSET's customer-facing settings or a ticket.
5. If Intuit asks for a reconnect URL, use the local settings URL for development: `http://localhost:5173/settings?accounting=quickbooks`. The corresponding production reconnect URL is `https://admin.elset.com.au/settings?accounting=quickbooks`.

The repository's API default is port **3101** (`server-auth.js` / server startup); the development frontend uses **5173**. If an operator overrides the API port, update both the registered URI and `QUICKBOOKS_REDIRECT_URI` to match exactly.

## 2. Configure the local test server

Use a separate local data directory and the development Intuit values. These are templates, not real credentials:

```dotenv
ELSET_WORKSPACE_STORAGE=sqlite
ELSET_DATA_DIR=./data-quickbooks-sandbox
ELSET_WORKSPACE_DB_PATH=./data-quickbooks-sandbox/elset-workspace.db
ELSET_AUTH_DB_PATH=./data-quickbooks-sandbox/auth.db
ELSET_FRONTEND_URL=http://localhost:5173
QUICKBOOKS_ENVIRONMENT=sandbox
QUICKBOOKS_CLIENT_ID=<development-client-id>
QUICKBOOKS_CLIENT_SECRET=<development-client-secret>
QUICKBOOKS_REDIRECT_URI=http://localhost:3101/api/integrations/quickbooks/callback
ACCOUNTING_INTEGRATION_ENCRYPTION_KEY=<64-hex-character-server-key>
# Needed only for incoming webhooks:
QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN=<development-webhook-verifier-token>
```

Reuse the existing accounting encryption key for an existing workspace; replacing it makes saved credentials unreadable. Keep configuration out of source control and backups shared with support. Do not point this test configuration at the real workspace database. Start the local application with `npm run dev`; use the repository's normal local admin/bootstrap and synthetic data workflow for this separate workspace. Schema 11 is applied through the existing startup migration mechanism.

Only `sandbox` or `production` is accepted, with no implicit default. Once a workspace has connected to QuickBooks, its environment is retained even after Disconnect. A different environment requires a separate workspace database; editing the environment value cannot reuse the old credentials or mappings.

## 3. Connect from ELSET

1. Sign in as an admin or office user. Open **Settings → Add-ons**.
2. If Xero is enabled, explicitly disable it first. Its connection, payments and historical mappings remain stored. Existing Xero invoices stay with Xero and cannot be exported to QuickBooks. Disabling also pauses its incoming reconciliation; resolve any operational handover before changing the provider used for new invoices.
3. Enable **QuickBooks Online**, then select **Connect to QuickBooks**.
4. Approve access to the **Australian Sandbox company** in Intuit. The requested scope is `com.intuit.quickbooks.accounting`.
5. On return, check the company name and the **Sandbox — test company** label.
6. If a different company was connected previously, explicitly confirm the new company. Old mappings remain with their original company. Configuration must be chosen again, and old invoices cannot be exported to the new company.

If Connect is unavailable, contact the operator. The UI intentionally has no credential-entry boxes. If the consent attempt expires, start Connect again; state lasts ten minutes and is single-use. The initiating ELSET session must remain valid even if the returning callback has no cookie.

## 4. Set the sales item and GST

First check the country and currency shown in Configure. The local Sandbox inspected on 18 September 2026 was **US/USD**, with California/Tucson tax codes, so it had no valid Australian 10% GST choice. A successful OAuth connection or loaded Product/Service list does not establish that the company is Australian. Connect an **Australian/AUD Sandbox**; do not substitute a US tax code. See the [live tax investigation](quickbooks-v3-tax-fix-report.md).

Enable **custom transaction numbers** in QuickBooks sales settings so ELSET's invoice number can be preserved. ELSET can use an existing active **Service** or **Non-inventory** sales item, or create a dedicated **ELSET Services** Service item using an existing income account you select. It never creates or changes accounting accounts.

In ELSET, select **Configure**:

- **Default QuickBooks sales item:** choose **Use existing QuickBooks item** to search by name, fully-qualified name, SKU, type or income account. Results show the item type and income account. Only eligible active items appear.
- Alternatively, choose **Create "ELSET Services" in QuickBooks**, explicitly select an active Income account, then **Create sales item**. An existing eligible exact name is reused case-insensitively with its original income account. An inactive, unsupported or ambiguous name conflict stops creation. If the item already appears in the list, the action is labelled **Use "ELSET Services"**. This action creates/reuses the QuickBooks item; **Save QuickBooks configuration** still saves the default selection.
- **Default QuickBooks GST code:** select the active Australian sales tax code at 10%. Combined tax codes, purchase-only taxes, US automated sales tax and a different home currency are outside V3.
- Select **Save QuickBooks configuration**, then **Test connection**. This health check creates no Customers or Invoices.

All invoice lines use the saved default QuickBooks item while retaining their ELSET descriptions, quantities and prices. ELSET's own Items & Price List remains separate, with no per-item QuickBooks mappings required. See the [sales item configuration report](quickbooks-sales-item-configuration.md) for eligibility, creation/retry safeguards and test evidence.

Invoice amounts are exclusive of tax. QuickBooks calculates GST using the chosen code; ELSET compares the result in cents. A mismatch retains the external ID but reports **Accounting review required**. Review the item/tax/company settings before retrying; do not manually create a replacement invoice.

## 5. Required Australian Sandbox acceptance test

Run this with real Sandbox credentials before approving production use. It was **not run** during this task. Mocked tests are not proof of regional Sandbox behavior.

1. Create ELSET Customer **QUICKBOOKS V3 TEST**, using a test inbox you control. Create a job/Site for that Customer.
2. Create an invoice for **$1,000 excluding GST**, **$100 GST**, **$1,100 total**. Save valid issue/due dates.
3. Send the invoice email normally through the configured ELSET mail service. Verify actual delivery. Do not fake SMTP success or add a false send-history record. In this checkout, a normal sent invoice is eligible for accounting; an unsent draft is not.
4. Open the saved Invoice and select **Send to QuickBooks**. Confirm one QuickBooks Customer, one Invoice, the same zero-padded ELSET invoice number, dates, CustomerRef, service item, quantity, unit price and 10% GST. The Customer's billing address must be used; a Site must not become a Customer.
5. Verify QuickBooks subtotal **$1,000**, GST **$100**, total **$1,100**. Confirm ELSET reports Synced. Check that ELSET did not call QuickBooks' email/send operation.
6. Select **Update QuickBooks** without changes. Confirm there is still one invoice. Make a small saved description change and update again; confirm the same external ID and correct SyncToken behavior.
7. Create/send a second invoice for another Site belonging to the same Customer. Confirm **one Customer, two Invoices**.
8. In QuickBooks, record a **$500 receipt** against the first invoice. In ELSET select **Sync from QuickBooks**. Verify **Paid $500, Outstanding $600**, a read-only QuickBooks payment row, and the corresponding Customer Account balance.
9. Repeat Sync from QuickBooks twice. Verify no duplicate receipt and unchanged balance.
10. Record the final **$600 receipt** in QuickBooks. Sync again. Verify **Paid $1,100, Outstanding $0, Paid** using ELSET's normal status calculation.
11. Correct the $500 receipt to $450. Sync and verify **Paid $1,050, Outstanding $50**; the existing receipt identity should be retained.
12. Remove/void that $450 receipt in QuickBooks. Sync and verify only the $600 receipt remains effective and the balance is **$500**. Historical removal evidence remains in the integration history.
13. Apply a separate receipt across two mapped invoices, then move its allocation from one invoice to the other. Sync either affected invoice. Verify each invoice receives only its allocation and that the total is never counted twice. Include an unapplied amount and an unmapped third invoice; neither should inflate ELSET receipts.
14. Test a historical manual ELSET payment. QuickBooks reconciliation must require review and retain the manual row. Confirm QuickBooks-owned receipts cannot be added, edited or deleted locally, including after Disconnect.
15. Change a managed invoice description directly in QuickBooks, then change ELSET and attempt an outbound update. Expect review, preserving the remote edit. Check a voided/deleted invoice is not recreated. Check an unsupported credit memo requires review.
16. Disconnect and reconnect to the same Sandbox company. Confirm configuration/mappings remain and repeated sync does not duplicate records. A different company must require confirmation; switching environments must fail closed.

Also test awkward cent/quantity combinations. Any Australian tax-rounding difference must be explained and resolved before go-live; V3 does not silently adjust ELSET totals to match QuickBooks.

## 6. Optional Sandbox webhooks

Manual **Sync from QuickBooks** works without a public tunnel. `localhost` cannot receive normal Intuit webhook deliveries. For live webhook validation, a developer may deliberately configure a secure HTTPS tunnel to the local API; none was created here.

In the app's Development webhook settings:

1. After the current local receiver and its tests are ready, turn **Enable cloud event payload format** **ON** on the correct app's **Development** webhook page. This receiver accepts CloudEvents arrays; legacy `eventNotifications` objects are not supported.
2. Register `https://<your-test-tunnel>/api/integrations/quickbooks/webhook`.
3. Subscribe to **Invoice** and **Payment** changes (create/update/delete/void where offered in the current portal). V3 recognizes `qbo.invoice.*.v1` and `qbo.payment.*.v1` created/updated/deleted/voided notifications. Confirm the enabled subscriptions by making the Sandbox changes above.
4. Put that environment's **webhook verifier token** in `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`, then restart the local server. This is not the OAuth secret.
5. Create/change a small payment on the intended **Sandbox** invoice. **Do not click Sync from QuickBooks** during this test. Inspect `integration_webhook_events` for the QuickBooks event and its own `external_tenant_id`; confirm it reaches **PROCESSED**, then confirm the invoice and Customer Account update automatically. Test correction and deletion too. Duplicate deliveries must not add another local receipt or queue row. Unrelated company and unmapped invoice events must not attach themselves by invoice number.

The endpoint checks `intuit-signature` against the exact raw body, validates the batch, saves minimal metadata, acknowledges, then uses the durable worker. It accepts JSON and CloudEvents JSON content types. Each event uses its own `intuitaccountid` and `intuitentityid`; the `data` object is ignored and the worker fetches current API state. New deduplication keys include provider, company, CloudEvent `source` and `id`; earlier inbox keys remain recognized without changing stored rows. Unsupported event types are recorded as IGNORED.

Missing/invalid signatures return 401. Signed malformed JSON/metadata or a legacy envelope returns 400 without partial inserts; bodies above 256 KiB return 413. Storage/configuration failure returns 503 so delivery can be retried. A 200 confirms durable acceptance (or a duplicate/ignored/empty batch), not completed reconciliation. Do not add browser login middleware, disable signatures or use a parser before the raw route. An operator can inspect the inbox for PENDING, RETRYABLE, PAUSED, REVIEW_REQUIRED and FAILED states. If no row arrives after the Sandbox change, investigate Intuit delivery/subscription/signature separately; do not use a successful manual sync as webhook evidence. There is no periodic CDC/company sweep in V3.

When changing Windows user environment variables, restart the launch terminal as well as the server, or explicitly refresh that launcher's environment. A server restarted by an existing Node watcher inherits the watcher's environment, which may predate a newly configured verifier token. Keep the Cloudflare tunnel running and confirm the Development endpoint still uses its current HTTPS URL.

## 7. Production go-live — documentation only

Complete the Sandbox test, review AU tax/numbering behavior and current Intuit production-app requirements, and obtain explicit deployment approval. Back up the real workspace before the existing startup migration. Review the single-provider handover and historical Xero invoices. Keep the production database separate from Sandbox, and preserve the production encryption key.

Production callback: `https://admin.elset.com.au/api/integrations/quickbooks/callback`.

Production webhook: `https://admin.elset.com.au/api/integrations/quickbooks/webhook`.

The following are **operator templates only; none were executed**:

```powershell
fly secrets set QUICKBOOKS_CLIENT_ID="<production-client-id>" -a elset-admin
fly secrets set QUICKBOOKS_CLIENT_SECRET="<production-client-secret>" -a elset-admin
fly secrets set QUICKBOOKS_REDIRECT_URI="https://admin.elset.com.au/api/integrations/quickbooks/callback" -a elset-admin
fly secrets set QUICKBOOKS_ENVIRONMENT="production" -a elset-admin
fly secrets set QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN="<production-webhook-verifier-token>" -a elset-admin
```

Ensure `ACCOUNTING_INTEGRATION_ENCRYPTION_KEY` already exists securely; do not casually replace it. Configure production values in Intuit's production settings, not development settings. Register the callback/webhook/reconnect URLs above and the supported entity subscriptions. After an approved deployment, authorize the intended real company explicitly, verify its identity/currency, configure its own item/GST mapping, and perform a controlled approved invoice/receipt check. No production setup, deployment, commit or push forms part of this implementation task.

See [audit and primary references](quickbooks-v3-audit.md) and [implementation report](quickbooks-v3-report.md).
