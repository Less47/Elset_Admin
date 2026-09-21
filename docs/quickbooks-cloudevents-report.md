# QuickBooks CloudEvents receiver audit and verification

21 September 2026. Local changes only; no commit, push or deployment.

## 1. Previous supported format

At the start of this task, `server-quickbooks-webhooks.js` **already accepted CloudEvents arrays only**. Its first check required `Array.isArray(events)`, followed by `specversion`, `id`, `type`, `time`, `intuitentityid` and `intuitaccountid`. Existing unit and browser tests already sent CloudEvents. There was no QuickBooks `eventNotifications[].realmId` / `dataChangeEvent.entities[]` parser.

The original receiver verified the exact raw request bytes, persisted metadata transactionally and woke the shared durable worker after responding. Its weaknesses were case-sensitive event-type routing, permissive timestamp parsing, no required `source` validation, deduplication without source scope, and malformed metadata being reported as a storage-style 503. Duplicate deliveries also unnecessarily woke the worker.

The reported Development toggle being OFF is therefore a potential format mismatch. It is not proof that Intuit delivered a legacy request: the local inbox remains empty and no captured live delivery was available.

Intuit's [official migration announcement](https://medium.com/intuitdev/upcoming-change-to-webhooks-payload-structure-2a87dab642d0), including its 5 May update, confirms the extended **31 July 2026** deadline, array format, and per-event companies. Its [official sample tests](https://github.com/IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents/blob/main/src/test/java/com/intuit/developer/sampleapp/webhooks/service/CloudEventsWebhookParserTest.java) show the past-tense event naming, including `qbo.payment.created.v1`, `qbo.invoice.created.v1` and `qbo.invoice.deleted.v1`. The Developer Portal documentation URL returned a JavaScript loading shell, so the accessible official announcement, sample source and [CloudEvents specification](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md) were used for verification.

## 2. Parser design

`parseQuickBooksEvents()` validates the entire batch and returns only the metadata needed for identity and routing. The receiver requires a CloudEvents array, `specversion: "1.0"`, nonempty bounded identifiers/type/source, a numeric QuickBooks company ID and an ISO/RFC3339-shaped parseable timestamp. Supported Invoice/Payment events also require a numeric resource ID. Nanosecond timestamp strings and timezone offsets are accepted and preserved verbatim. This is an Intuit metadata validator, not a general-purpose CloudEvents SDK.

Types are normalized to lowercase before matching the existing Invoice/Payment `created`, `updated`, `deleted` and `voided` V1 routes. The existing void routes are retained; the live portal must determine which operations are available for subscription. Event identities and company IDs are not case-folded or rewritten.

`data` may be absent, empty or contain an entity snapshot; none of it is used or persisted. `datacontenttype` is optional and is checked as bounded text when present. Unknown entity types, operations and versions with valid routing metadata are recorded as terminal `IGNORED` events and never reconciled.

There was no legacy compatibility to retain. Legacy objects continue to be unsupported, now returning a deliberate 400 instead of the previous generic 503. No additional legacy adapter, schema migration, SDK dependency or automatic invoice-writing behavior was introduced. Workspace schema remains **12**.

## 3. Field mapping

| CloudEvent attribute | Inbox / processing use |
| --- | --- |
| `intuitaccountid` | `external_tenant_id`, independently for every event |
| `intuitentityid` | `external_resource_id`, the Payment or Invoice to inspect |
| `id` | Original immutable ID in `event_sequence`; participates in durable identity |
| `source` | Participates in the hashed identity; raw source is not stored |
| `time` | `event_date`, preserving the supplied timestamp string |
| `type` | Lowercase `event_type`; determines `PAYMENT`, `INVOICE` or `OTHER` category |
| `data` | Ignored; authoritative state comes from the QuickBooks API |

## 4. Signature and acknowledgement behavior

Security remains unchanged: the public route is registered before global JSON parsing and uses `express.raw`, the `intuit-signature` header, HMAC-SHA256 with `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`, and a timing-safe comparison. JSON parsing and inbox processing happen only after verification. No verifier, OAuth token, secret or raw customer payload is logged.

The route accepts `application/json`, `application/cloudevents+json` and `application/cloudevents-batch+json` through its existing content-type-independent raw parser. The existing 256 KiB request limit and disabled decompression remain intact.

| Condition | HTTP result |
| --- | --- |
| Valid batch durably stored, duplicate, ignored-only batch or empty array | 200 |
| Missing, malformed or incorrect signature, including changed raw bytes | 401 |
| Signed malformed JSON, malformed metadata, oversized event count or legacy envelope | 400; no partial inserts |
| Body exceeds 256 KiB | 413 |
| Missing configuration or failed storage transaction | 503; no false successful acknowledgement |

Metadata validation occurs before any inserts; persistence is one transaction. The response is sent before the worker is awakened, and only new inserts wake it. A test deliberately blocks the provider request and confirms that HTTP 200 still arrives before reconciliation can finish. On provider failure, the persisted event becomes retryable and survives worker restart.

## 5. Multiple companies

There is no batch-global realm. Each event keeps its own company and resource ID, including when two companies reuse the same event ID. The unchanged worker only reconciles the currently connected matching company. Other companies are marked IGNORED without sending their IDs through the active company's credentials. Old company mappings/history remain intact; pending-company-switch safeguards remain in force.

## 6. Deduplication

The [CloudEvents identity rule](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#id) scopes an ID to its source. New inbox primary keys are SHA-256 hashes of the unambiguous tuple:

```text
["quickbooks", company ID, source, event ID]
```

Repeated delivery uses `ON CONFLICT(id) DO NOTHING`: it does not reset attempts, leases, timestamps or payment state, and does not wake the worker again. Events from different companies or sources remain distinct.

Before inserting, the receiver also checks the earlier hash of `["quickbooks", company ID, event ID]`. An existing matching old row is treated as a replay without rekeying it or altering its retry state. Those old rows did not preserve source, so their original broader identity is conservatively retained. No migration or fabricated source metadata is used.

## 7. Payments and invoices

The accounting worker and payment reconciliation implementation were audited and left unchanged in this task:

- Payment create/update reads the Payment through the API, finds its invoice allocations and invokes the same payment reconciliation service used by manual sync.
- A moved payment reconciles both its historical invoice allocation and its new allocation.
- Payment deletion uses retained external-payment mappings to find affected invoices when the Payment lookup no longer exists, then reconciles current invoice/payment truth.
- Invoice events invoke the existing reconciliation and conflict-review behavior. They do not automatically write invoices back to QuickBooks.
- Durable retries, leases, provider isolation and the Xero pending-company guard remain unchanged.

Signed HTTP lifecycle tests observed a $500 payment becoming one 50,000-cent local receipt, correction to $350 updating that same local ID, and deletion removing its balance contribution while retaining a REMOVED external-payment record. Customer Account outstanding amounts changed to $600, $750 and $1,100 respectively. Webhook `data` deliberately contained contradictory amounts; the actual API state prevailed. Replaying each delivery left payments, sync history and attempt counts unchanged. Every provider request made by those webhook phases was GET.

## 8. Files changed in this task

1. `server-quickbooks-webhooks.js` — metadata parser, case handling, source-scoped identity with older-key compatibility, deliberate validation responses and duplicate wake suppression.
2. `tests/fixtures/quickbooks-cloudevents.json` — synthetic documented-shape events, including two companies and precise timestamps.
3. `tests/helpers/quickbooks-webhooks.js` — shared fixture constructor.
4. `tests/quickbooks-webhooks.test.js` — twelve additional receiver, persistence, security, lifecycle and recovery tests.
5. `tests/quickbooks-accounting.test.js` — existing scenarios now use complete CloudEvents fixture metadata.
6. `tests/e2e/quickbooks-integration.spec.mjs` — complete fixture metadata and CloudEvents content type through the actual server.
7. `docs/quickbooks-v3-setup.md` — Development toggle, live test steps, response semantics and Windows environment inheritance.
8. `docs/quickbooks-cloudevents-report.md` — this report.

Earlier QuickBooks/schema/worker changes in the shared workspace were preserved. `server-accounting-webhooks.js` and the schema-12 migration were not modified during this task.

## 9. Tests and observed results

| Verification | Result |
| --- | --- |
| Focused QuickBooks webhook/accounting, shared worker and Xero payments tests | **75 passed** |
| `npm test` | **531 passed**, 0 failed/skipped |
| QuickBooks and Xero Playwright suites | **53 passed** |
| `npm run lint` | Passed |
| `npm run build` | Passed; existing bundle-size warning above 500 kB |
| `git diff --check` | Passed |

Browser command:

```text
npx playwright test tests/e2e/quickbooks-integration.spec.mjs tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json
```

Coverage includes Payment Created/Updated/Deleted, Invoice, multiple events/companies, duplicate IDs and source scoping, missing/wrong/tampered signatures, malformed batches, unsupported events, explicit legacy rejection, transaction rollback, durable restart, blocked-provider acknowledgement, retries, moved allocations, balances and Xero regressions. The initial new malformed-input test hit the body limit before the event-count limit; these are now separately asserted as 413 and 400 without weakening either limit.

Logs: `output/quickbooks-cloudevents-focused.log`, `output/quickbooks-cloudevents-unit.log`, `output/quickbooks-cloudevents-browser.log`, `output/quickbooks-cloudevents-lint.log`, `output/quickbooks-cloudevents-build.log` and `output/quickbooks-cloudevents-local-readiness.log`.

## 10. Safe to enable Development CloudEvents

**Yes: the current local receiver is ready for the Development/Sandbox toggle.** At **2026-09-21T00:40:30.363Z** (10:40:30 AEST), the actual local API returned:

```text
Signed empty CloudEvents array: 200
Invalid signature:             401
Signed legacy envelope:        400
Workspace schema:              12
Inbox rows:                    0, unchanged by probes
```

The first readiness probe found that the then-running API had not inherited the verifier token from the Windows user environment. The existing token was loaded into the replacement development API watcher without printing, replacing or persisting a new secret. This restored the expected signature responses. Keep that server running; when launching from another terminal, ensure it has inherited the existing user environment. The API is on port 3101, the frontend on 5173, and Cloudflare process 4632 remains running. The portal's selected app, toggle and public endpoint were not changed by this task.

On the correct app's **Development** webhook page, verify the current tunnel URL ending in `/api/integrations/quickbooks/webhook`, turn **Enable cloud event payload format** ON, and subscribe to Payment create/update/delete events (plus intended Invoice events). Then make a small payment change in the intended Sandbox, without manual Sync from QuickBooks. Confirm the inserted event reaches PROCESSED and the invoice and Customer Account update automatically.

**Live Intuit delivery is still unproven.** No Sandbox payment or portal setting was changed during this task. Signed local empty-batch probes create no queue events and do not prove public delivery. If no event is inserted after the actual Sandbox change, investigate Intuit delivery, subscription, endpoint or signature configuration separately. No commit, push or deployment was performed.
