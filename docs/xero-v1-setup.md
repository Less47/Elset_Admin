# Xero V1 setup

For the current payment scope, invoice webhooks, schema 9 → 10 upgrade and payment ownership rules, use the [Xero V2 setup guide](xero-v2-setup.md). This document records V1's invoice-only baseline; its scope list, schema version and V2 boundary describe that earlier version.

Customers connect through **Settings → Add-ons → Xero → Enable → Connect to Xero → Xero authorisation → Connected**. They never generate, enter or configure encryption keys or application credentials. Workspace admins and office users use the existing shared business-settings permission.

Application infrastructure is configured once by the software operator. Developer/deployment instructions below are separate from the customer connection steps. No Fly secrets, deployment, real Xero connection or production data changes were made during implementation. Complete the Demo Company checks before approving production use.

## What this version does

An authorised admin or office user can enable Xero for the workspace, connect one organisation, choose its sales account and tax rate, then manually send or update saved, qualifying invoices. Customers become Xero Contacts as needed. Sync history remains separate from invoice status and payments.

The current workspace invoices in AUD and applies 10% GST to all lines. V1 requires an AUD Xero organisation and a matching revenue tax rate. The app has no GST-free invoice treatment to configure yet. Invoice eligibility follows the existing product rule: a saved invoice with sent history **or a positive recorded payment**, excluding inactive invoices. A due date alone does not make a draft eligible.

## Developer / deployment configuration

**Application operator only.** Configure these four server environment variables once for the application, using Fly secrets in production. Local developers supply them in their own server environment. Workspace customers do not perform any of steps 1–8.

| Server variable | Operator responsibility |
| --- | --- |
| `XERO_CLIENT_ID` | Registered application identity. |
| `XERO_CLIENT_SECRET` | Registered application's private OAuth credential. |
| `XERO_REDIRECT_URI` | Exact registered application callback. |
| `ACCOUNTING_INTEGRATION_ENCRYPTION_KEY` | One stable application-level key for encrypting stored OAuth tokens. |

These are not workspace settings, customer configuration or browser fields. All server instances serving these workspaces must receive the same application key; do not generate one per customer/workspace. Development uses a separate local key and synthetic credentials/data.

### 1. Register a Xero Developer app

Sign in to the [Xero Developer portal](https://developer.xero.com/app/manage). Create an OAuth 2.0 application using the **Auth Code** grant for a web server application. Use a separate development app for Demo Company testing. Follow Xero's [current authorization flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow/).

### 2. Register the exact redirect URI

Use the externally reachable application origin followed by `/api/integrations/xero/callback`. For example, the intended production domain would give `https://admin.elset.com.au/api/integrations/xero/callback`. This is an example, not a value embedded in the application.

Register the exact URI in Xero and use the same string for `XERO_REDIRECT_URI`. Scheme, hostname, port and path must agree. Do not use wildcards, query parameters or fragments.

For local testing, Xero supports HTTP `localhost`; it does not accept `http://127.0.0.1` as the registered redirect. A typical local callback is `http://localhost:3101/api/integrations/xero/callback` **if that is the API port you configured**. Use `localhost` consistently when signing into the app so the callback retains the authenticated session. [Xero redirect requirements](https://developer.xero.com/documentation/guides/oauth2/auth-flow/).

### 3. Confirm the granular scopes

The application requests exactly:

```text
offline_access
accounting.contacts
accounting.invoices
accounting.settings.read
```

These cover refresh credentials, Contacts, invoices and read-only accounting configuration. Check that the Developer app is configured to allow these permissions if the portal presents permission controls. The application supplies the scope list during consent. No `accounting.payments`, broad `accounting.transactions` or OpenID sign-in scopes are requested. [Current scope reference](https://developer.xero.com/documentation/guides/oauth2/scopes/).

### 4. Obtain the Client ID

Copy the Client ID from the app's developer configuration. Store it as server variable `XERO_CLIENT_ID`.

### 5. Generate the Client Secret

Generate a secret in the developer configuration and store it securely as `XERO_CLIENT_SECRET`. Do not paste it into source files, support tickets, browser configuration or this guide. Never add a `VITE_` prefix.

### 6. Generate the application encryption key once

Run this command locally in a private terminal with Node installed:

```powershell
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'));"
```

Store the resulting **64 hexadecimal characters** securely as server variable `ACCOUNTING_INTEGRATION_ENCRYPTION_KEY`. The command creates a new random 32-byte key; no example key is supplied here. The software operator owns this key. Keep it separate from database backups. Do not generate a new key on every deployment or for each workspace: existing credentials require the same key to decrypt.

### 7. Configure server secrets

For local development, the developer must set all four variables above, including `ACCOUNTING_INTEGRATION_ENCRYPTION_KEY`, in an untracked server `.env` or process environment. The server loads the root `.env`. `.env.example` contains empty Xero placeholders only. This is developer setup, never customer setup. Browser bundles must never contain these values.

For a later, approved Fly setup, the following are **templates only**. Replace each placeholder privately and confirm the target app. They have not been executed:

```powershell
fly secrets set XERO_CLIENT_ID="<client-id>" --stage -a elset-admin
fly secrets set XERO_CLIENT_SECRET="<client-secret>" --stage -a elset-admin
fly secrets set XERO_REDIRECT_URI="<exact-registered-callback>" --stage -a elset-admin
fly secrets set ACCOUNTING_INTEGRATION_ENCRYPTION_KEY="<64-hex-character-key>" --stage -a elset-admin
```

`--stage` defers updating running Machines until a later deployment/start. Without it, setting Fly secrets normally updates the running application. Treat terminal history as sensitive when entering secrets. [Fly secret documentation](https://fly.io/docs/apps/secrets/).

### 8. Deploy the approved application version

The developer should take a verified workspace backup, complete the normal release review, and use the repository's existing deployment process. The existing command is `npm run deploy:fly -- -a elset-admin`; it also requires the established Google Maps build environment. Do not replace or remove existing settings while adding Xero.

This guide does not authorise deployment. When an approved release starts, the normal SQLite migration upgrades schema **8 to 9** transactionally. It adds seven integration tables and preserves core business tables. Restarting does not repeat the migration. Older application versions will refuse the newer schema; an application rollback needs the corresponding pre-upgrade database backup, not a schema-number edit.

## Customer connection and invoice configuration

The operator completes the infrastructure setup once. Each authorised workspace customer then connects their own Xero organisation through OAuth. No infrastructure configuration is displayed or requested in this workflow.

### 9. Enable the workspace Add-on

Sign in as an **admin** or **office** user. Open **Settings → Add-ons** and enable **Xero**. Its state is shared across the workspace. If the application is temporarily unavailable, the card says **“Xero integration is temporarily unavailable. Please contact support.”** Customers are never asked to configure infrastructure.

### 10. Connect to Xero

Click **Connect to Xero**. Sign in to Xero and approve the requested permissions. For development, authorise **Demo Company only**. Return in the same authenticated browser session within ten minutes. Cancelling is safe; invalid, expired or reused connection state is rejected.

Connect is available to an authorised workspace admin/office user when the Add-on is enabled, the application is configured and no connection request/status load is active. After authorisation and organisation selection the card shows **Connected**. Account and tax selections below configure invoice syncing, not server infrastructure.

### 11. Choose the organisation

The app stores the authoritative tenant ID, not just the displayed name. If only one eligible organisation is returned on first connection, it is selected automatically. If several are returned, choose the intended organisation and click **Use organisation**.

Changing to a different organisation requires confirmation and resets account/tax configuration. Old mappings and history remain attached to the previous tenant. Reconnecting the same organisation reuses its mappings.

### 12. Select the sales account

Click **Configure**. Choose an active sales/revenue account fetched from that organisation. Account codes are not hardcoded and cannot be typed arbitrarily.

### 13. Select the tax mapping

Choose a matching rate under **Taxable sales (10% GST)** and save the configuration. The list uses Xero's active rates that can apply to revenue; the server checks the selected rate again. An empty list means the organisation's tax setup needs attention, not that zero tax will be used.

### 14. Test the connection

Click **Test connection**. The app checks credentials/scopes, refreshes credentials if needed, confirms tenant access, and reads organisation, account and tax settings. It creates no Contacts or invoices. A revoked connection presents **Reconnect Xero**.

### 15. Send the first test invoice to Demo Company

Use a separate, disposable local/test workspace containing synthetic customers, sites and jobs. Do not clone a connected production database into another running installation.

Create and save a test invoice with realistic quantities and GST. Make it eligible using the existing invoice workflow and a controlled test recipient; a positive test payment also qualifies under existing rules. Do not email a real customer or add a fictitious payment to production data.

Open the saved Invoice workspace. After configuration, its Xero card offers **Send to Xero**. Save any unsaved edits first. Click once and wait for **Synced** and the last-sync time.

In Demo Company, check the created authorised sales invoice: invoice number, dates, Contact, currency, quantities, unit prices, revenue account, tax rate, subtotal, tax and total. The app validates exact cents and invoice details before reporting success. This action does not email the Xero invoice and does not transfer payments.

### 16. Verify reuse and updates

- Refresh the app and sign into a second authorised session. Both should show the same connection and invoice mapping.
- Click **Update Xero** with unchanged details: it should find the existing invoice without creating another.
- Save a permitted invoice change, then click **Update Xero**: the same InvoiceID should be updated.
- Send a second test invoice for another Site of the same Customer: it should reuse the ContactID.
- Confirm Contact creation used Customer billing details, not a Site address. Newly created names include a short source suffix to avoid collisions; identical names/emails are never merged automatically.
- If a request fails, use **Retry Xero sync**. The application reconciles an exact matching remote invoice first. Respect any displayed retry time.
- Add a test payment/credit or edit the invoice in Xero: subsequent unsafe changes must be refused without a replacement invoice. Inventory, tracking and discount details also block updates.

Do not reset mappings or repeatedly edit/retry an uncertain request to force it through. Xero's idempotency cache is limited; the app reuses an unchanged request key for at most five minutes, then requires reconciliation. If the old request cannot be confirmed, it stops for review. [Xero idempotency behaviour](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/).

### 17. Disconnect the test organisation

In **Settings → Add-ons**, click **Disconnect** and confirm. The app attempts to remove the selected Xero tenant connection and always clears local active credentials. It preserves customers, invoices, account configuration, mappings and history.

If Xero cannot confirm removal, follow the displayed instruction to remove the app from **Xero Connected Apps**. If you authorised several organisations, only the selected connection is removed; review the others in Xero. If no organisation was selected, the app clears local credentials and asks you to remove the unselected grants in Xero. [Xero connection cleanup](https://developer.xero.com/documentation/best-practices/managing-connections/designing-and-implementing-connection-cleanup-routine).

**Disable Add-on** is separate: it hides invoice controls and blocks work without removing credentials, configuration or mappings. Explicit disconnect remains available for cleanup while disabled.

## Safe local test strategy

Automated tests use synthetic workspace/auth databases in temporary directories and an injected HTTP mock that never forwards requests to Xero. The browser consent page is intercepted too. No real credentials are needed:

```powershell
node --test tests/xero-accounting.test.js
npm test
npm run lint
npm run build
npx playwright test tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1
git diff --check
```

For intentional Demo Company testing, configure separate development credentials, a synthetic local workspace and matching Better Auth/frontend URLs. Use `localhost` consistently with the exact registered callback. If a remote development environment needs a tunnel, use an HTTPS origin, register its exact callback, and configure authentication/frontend URLs for that same origin; do not weaken state or redirect validation.

## Customer recovery

| Message/state | Next action |
| --- | --- |
| Xero integration is temporarily unavailable | Contact support. The software operator investigates; no customer key or server setup is required. |
| Reconnect Xero | Reconnect and approve required scopes. Failed refreshes are not retried repeatedly. |
| Sales account/tax mapping missing or invalid | Open Configure and select current options from Xero. |
| Invoice number conflict | Inspect the existing invoice in Xero; the app will not merge unrelated invoices. |
| External edit/protected accounting state | Review in Xero; V1 does not undo payments, credits or bookkeeper edits. |
| Totals/details mismatch | Review both records. The returned external ID is retained to prevent a replacement. |
| Uncertain request/retry window expired | Ask the developer/accountant to reconcile the pending operation against Xero before permitting another write. V1 has no force-reset button. |
| Rate limited | Wait until the displayed retry time. No automatic retry loop runs. |
| Interrupted request | Retry to reconcile; a dead worker's lease expires after two minutes. |

## Operator diagnostics and workspace isolation

Missing/invalid infrastructure produces generic customer-facing status and API errors. Only server logs name the configuration problem, for example `missing ACCOUNTING_INTEGRATION_ENCRYPTION_KEY`, `missing XERO_CLIENT_SECRET` or `invalid XERO_REDIRECT_URI`. Logs contain fixed diagnostic text/variable names only, never secret values, submitted URLs, OAuth payloads, tokens or ciphertext. Previously persisted technical setup messages are replaced with a safe support message when returned to the UI.

For missing configuration, the application operator supplies the server variable and restarts the server. Reloading connection status then restores Connect. If existing credentials cannot be decrypted, the operator must restore the original application key or arrange reconnection after verifying the server configuration. Replacing the key alone does not migrate existing ciphertext.

**One encryption key does not share OAuth credentials.** The current deployment stores one server-owned workspace identity per workspace database. Each workspace/provider integration keeps its own Xero tenant ID, encrypted access token, encrypted refresh token and account/tax configuration. Mapping and history queries also include the external tenant. AES-256-GCM binds each token to its workspace ID, provider and token kind through authenticated data; a token copied to another workspace cannot be decrypted there even with the same application key. OAuth state is also bound to workspace, user and session. No browser-supplied workspace ID selects another workspace, and no persistence or key-per-workspace architecture was introduced for this UX correction.

Automated coverage creates two synthetic workspace databases using the same application key and confirms distinct tenants, credentials, configuration, mappings and OAuth state; cross-workspace token decryption is rejected.

Database backups include encrypted credentials and integration history. Store backups securely and retain the matching encryption key separately. JSON workspace exports intentionally omit integration credentials/history. Restoring an old database can restore stale rotating credentials; reconnect if needed. Automated key rotation is not part of V1.

## Operational limits

There is no scheduled refresh or background sync. A long-unused/disabled connection may need renewed consent. Updates inspect Xero immediately before writing, but an external bookkeeper can still edit between that read and the write; V1 cannot provide an atomic lock across both products.

## Explicit V2 boundary

No payment sync, webhooks, expense/bill import, Job Costing integration, credit note sync, quote sync, customer/invoice imports, automatic/bulk/background invoice sync, QuickBooks, payroll, bank feeds, purchase orders, inventory sync or two-way accounting edits. No speculative QuickBooks UI is shown.

Real OAuth consent and a live Demo Company end-to-end run remain manual release checks; they are not claimed by the mocked automated tests.
