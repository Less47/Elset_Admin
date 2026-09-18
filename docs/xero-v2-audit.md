# Xero V2 audit and decisions

Audited the current checkout before implementation (18 September 2026). The prior Customer missing-email changes remain uncommitted and separate in scope.

- V1: `AccountingService`, `AccountingStore`, the provider registry and `XeroAccountingProvider` separate provider HTTP from workspace invoice data. Tokens are AES-GCM encrypted with workspace/provider/kind AAD. OAuth state is hashed, expiring, single-use and session-bound. A SQLite lease with heartbeat serializes refresh and sync across processes. Account/tax settings and tenant-specific mappings already exist.
- Each deployment resolves one server-owned SQLite workspace. There is no browser-selectable workspace. Webhooks must resolve the tenant against this database's integration, then the external InvoiceID against its mapping. Unknown tenants/resources must not select records by name or number.
- Schema is 9. Existing payments have integer cents, date, method, reference, notes and JSON extras, with no authoritative source marker. Payment add/update/delete uses dedicated authenticated document endpoints. Normal invoice replacement does not replace payments. Broad SQLite workspace saves are disabled.
- Paid/outstanding are derived from payment rows by `invoiceFinancialsFromRows`; status uses `invoiceStatusFromAmounts`. Customer Account and Job Costing reuse these calculations. Actual invoices require sent history or recorded payments; issuance is still tied to the existing sent-history rule. V2 does not change this rule, email delivery, PDF generation or invoice numbering.
- `InvoiceAccounting` provides manual outbound sync. `DocumentEditor` edits local payment drafts. `XeroSettings` handles connection/configuration. Admin/office may perform commercial actions; technicians may not. Browser accounting mutations have an origin/header guard.
- `createServerApp` installs global JSON parsing before authenticated accounting routes. The new public raw-body webhook must be registered before that parser and must never invoke browser auth middleware.
- `server.js` initializes storage and authentication before listening; `dev-server.js` delegates to it. There is no durable scheduler. The only accounting interval renews an active lock. Fly permits autostop (one minimum machine), so an in-process interval is not a periodic reconciliation guarantee.

## Chosen payment policy

Mapped invoices block new manual payment entries. Existing manual rows are retained and cause review-required reconciliation, even when amounts match. No inferred duplicate matching, automatic deletion, or automatic addition of external amounts to manual amounts. Historical manual records remain protected for explicit accounting review; automatic conflict resolution is outside V2.

Effective Xero payments use the existing payments table with a trusted source column. A separate durable external-payment ledger retains PaymentID, tenant/invoice identity, local payment ID, latest amount/date/status/update time even after reversal. Only effective payments contribute through the normal calculation path. Corrections update the same payment; removed payments leave the effective table but retain their ledger and sync-history evidence. Reconciliation and history changes are one transaction.

One additive migration, 9 to 10, supplies source metadata, invoice payment-sync state, external payment identities and a durable webhook inbox. Webhook processing runs after acknowledgement and on startup, with leases, bounded retries and persisted retry times. It is not a substitute for an external periodic scheduler.

## Current official contracts checked

- [Scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/): add read-only `accounting.payments.read`; preserve V1 scopes. Existing grants can be expanded through OAuth without disconnecting.
- [Webhooks](https://developer.xero.com/documentation/guides/webhooks/overview/): raw payload HMAC-SHA256/base64, `x-xero-signature`, 401 for invalid signatures, signed empty validation events, no cookies, response within five seconds.
- [Webhook schema](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-webhooks.yaml): tenant/resource/category/type and batch first/last sequence; never trust a webhook resource URL for outbound HTTP.
- [Invoices](https://developer.xero.com/documentation/api/accounting/invoices): current invoice totals, payment references, status and credit allocations determine reconciliation safety.
- [Payments](https://developer.xero.com/documentation/api/accounting/payments): read PaymentID/InvoiceID, Amount (invoice currency), Date, Status and UpdatedDateUTC. Deleted/reversed payments cease contributing. Credit/prepayment/overpayment allocations require review and are not reconciled in V2.
