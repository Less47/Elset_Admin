# QuickBooks / Xero webhook lease repair

Verified locally on 21 September 2026. Changes remain uncommitted. No push or deployment was performed.

## 1. Historical cause and Git evidence

The local database initially reported schema **11** in its metadata, but `PRAGMA table_info(integration_webhook_events)` had no `lease_owner`. Both inbox processors prepare statements using that column before looking for events, so even an empty inbox failed. Existing schema assertions checked the table and indexes, but did not probe the lease column.

The available Git history does **not** show a later committed mutation of schema 10:

- `9edb583c5ad16f3874945ab574d1f4a114283905` — **Add Xero payment sync and webhooks**, 18 September 2026, 11:23:06 AEST. This is the first commit containing `server-accounting-payment-schema.js`; its creation diff already contains `lease_owner TEXT NOT NULL DEFAULT ''`.
- `d016309fae17f16d23a0aa4e00268b436d5c7808` — **Merge Xero accounting integration V2**, 11:25:45 AEST, includes that definition.
- Current HEAD is `a62eedee061bce97b661db21e72c06399621a0a4`. The historical and working schema-10 file both have Git blob hash `5506f595fbf5c7f62e35cbc31f56c4413565f3f0`; their diff is empty.

Relevant lines from the original file-creation diff:

```diff
+    retry_at INTEGER NOT NULL DEFAULT 0,
+    lease_until INTEGER NOT NULL DEFAULT 0,
+    lease_owner TEXT NOT NULL DEFAULT '',
+    received_at TEXT NOT NULL,
```

The local migration ledger records schema 10 at **2026-09-18T00:18:41.420Z** (10:18:41 AEST), approximately 64 minutes **before** that first commit. Schema 11 was applied at **2026-09-18T02:35:50.789Z**.

Thus, the committed Xero V2 definition is known exactly and includes the column; the local applied schema does not. This supports an applied development definition having changed before commit, but Git cannot establish the exact pre-commit source or rule out a later out-of-band schema change. Applied-schema/code drift is confirmed; a later committed mutation is not. The missing-column fixture is explicitly labelled a reproduction of the observed local variant, not an exact recovered historical source file.

## 2. Migration strategy and versions

Selected **Option B**, a conditional forward migration:

- Latest version: **11 -> 12**, named `accounting-webhook-event-leases`.
- Migration 12 reads `PRAGMA table_info(integration_webhook_events)` and runs `ALTER TABLE ... ADD COLUMN lease_owner TEXT NOT NULL DEFAULT ''` only when absent.
- The callback executes inside the existing immediate migration transaction. DDL, `workspace_info`, migration ledger and `PRAGMA user_version` commit or roll back together.
- Schema-10 and schema-11 SQL are unchanged. No local-only patch, metadata reset or database recreation was used.

## 3. Fresh and existing database behavior

| Starting state | Result |
| --- | --- |
| Schema 10, column absent | Applies 11 then 12; existing rows preserved; empty-string lease defaults |
| Schema 11, column absent | Applies 12; existing rows preserved; empty-string lease defaults |
| Schema 10 or 11, column present | Skips column addition; preserves existing lease-owner values |
| Fresh empty database | Applies 1 through 12 once; version 10 creates the column and 12 skips addition |
| Current database reopened with `migrate=true` | No migration rerun or row changes |
| Current metadata, missing lease column | Schema assertion and migration/open reject it; no silent repair of current metadata |

Preservation tests include pending/retry/processing/completed webhook rows, payments, customer and invoice mappings, encrypted connection fields, OAuth state, payment reconciliation and sync history. A deliberately late version-12 failure verifies rollback of both schema and metadata, including the preceding version-11 migration when starting at 10.

## 4. Schema assertion

`assertWorkspaceSchemaObjects()` now explicitly prepares `SELECT lease_owner FROM integration_webhook_events LIMIT 0` for version 12 and later. Metadata alone can no longer pass validation without the runtime-required column. Older versions remain eligible for the forward repair.

## 5. Provider isolation and durable retries

`createAccountingInboxWorker()` catches processing and scheduling errors separately for Xero and QuickBooks. A failure logs its provider and permits the other provider's turn. The failed provider schedules a 60-second retry; ready-time queries are provider scoped so its overdue rows do not cause a one-second failure loop. Earlier work due for the other provider still takes priority.

Claim transactions, lease ownership, heartbeat, attempt limits and event retry/finish behavior are unchanged. Tests exercise failures in both directions, intact pending rows after a failed claim, continued healthy-provider work and recovery on the next retry.

`pendingQuickBooksCompany()` already returns `null` before reading metadata when the provider is not QuickBooks. No behavior change was needed. A regression verifies this guard and Xero's resumption of paused work even with malformed QuickBooks-specific metadata on its connection.

## 6. Safe diagnostic logging

Both provider-level failures and shared database-open failures now log a diagnostic object with a controlled error type, SQLite code, allowlisted message and reconstructed source locations. The missing-column failure is visible as **`no such column: lease_owner`**.

Raw exceptions, causes, messages, request objects, URLs and payload bodies are not serialized. Unrecognized SQLite messages and JSON parse fragments are withheld. Tests inject synthetic OAuth/verifier/client-secret/authorization-code/customer-body values and verify that none appear in captured diagnostics.

## 7. Files changed for this repair

- `server-workspace-db.js` — version 12, conditional callback and required-column probe.
- `server-accounting-webhooks.js` — provider isolation, retry scheduling and safe diagnostics; this file was already untracked QuickBooks work when the repair began.
- `fixtures/accounting-payment-schema-v10-without-leases.sql` — frozen reproduction of the observed missing-column variant.
- `tests/accounting-webhook-leases.test.js` — repair, preservation, rollback, fresh/open and corruption coverage.
- `tests/accounting-inbox-worker.test.js` — isolation, recovery, diagnostics and Xero guard coverage.
- `tests/quickbooks-migration.test.js`, `tests/xero-payments.test.js`, `tests/xero-accounting.test.js`, `tests/workspace-schema-upgrade.test.js`, `tests/workspace-migration.test.js` — latest-version/name expectations, complete migration sequences and future-version rejection fixtures updated to schema 12/13 as appropriate.
- `docs/quickbooks-webhook-lease-repair.md` — this report.

Other pre-existing workspace changes were retained.

## 8. Regression results

| Command / coverage | Observed result |
| --- | --- |
| Focused Node tests: new lease/worker tests, QuickBooks migration/accounting, Xero accounting/payments, workspace schema upgrades | **110 passed** |
| `npm test` | **519 passed**, 0 failed/skipped |
| `npx playwright test tests/e2e/quickbooks-integration.spec.mjs tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json` | **53 passed** |
| `npm run lint` | Passed |
| `npm run build` | Passed; Vite reports a bundle-size warning above 500 kB |
| `git diff --check` | Passed |

Initial runs exposed stale version/name expectations and an invalid new fixture enabling both exclusive accounting add-ons. Those expectations and the fixture were corrected; accounting-provider exclusivity and test assertions were retained.

Logs are in the ignored local `output/webhook-lease-repair/` directory. Browser cases use disposable fixture databases and simulated providers; they do not prove live Intuit delivery.

## 9. Existing local database and server

Database: `data/elset-workspace.db`.

The already-running Node watch server restarted after the code edit and applied migration 12 through the normal startup path at **2026-09-21T00:09:08.510Z**. Subsequent explicit `initializeWorkspaceStorage()` and `migrate=true` fixture/reopen verification succeeded without rerunning migrations.

Local verification at **2026-09-21T00:13:23.101Z**:

```text
PRAGMA user_version = 12
workspace_info.schema_version = 12
lease_owner: TEXT, NOT NULL, DEFAULT ''
integrity_check: ok
foreign_key_check: no violations
xero processed: 0
quickbooks processed: 0
```

The inbox was empty before and after this repair. Hash comparisons covering all 40 application tables confirmed no stored-row changes during the explicit post-upgrade startup and separate processor verification. These hashes were taken after the automatic startup migration; full upgrade preservation is covered by the seeded migration tests above, not a claimed pre-upgrade local hash comparison.

The running server initially lacked `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`, even though it existed in the Windows user environment. The local API watcher was restarted with that existing value, without printing or changing it. Cloudflare process **4632** remained running throughout. After restart, an invalid well-formed signature returned **401** rather than the prior **503**; a correctly signed empty batch returned **200**. No synthetic webhook event was inserted. The restarted server is listening on port 3101 and the frontend remains on 5173.

Final check at **2026-09-21T00:15:00.798Z** confirmed schema 12, exactly one migration-12 ledger row, zero inbox rows and zero inbox-processing/missing-column failures in the restarted server logs.

## 10. Live webhook retest status

**Intuit delivery remains unproven.** No Sandbox payment was created or changed during this repair; the target invoice/payment and test amount were requested from the user and remain unspecified. No manual Sync from QuickBooks was invoked. The inbox remains empty, so no actual Intuit event, automatic payment reconciliation or live customer-account update is claimed.

The next live test is to change the intended Sandbox payment while the API and tunnel remain running, then inspect the persisted event and automatic invoice/payment/customer-account update. If no event arrives after that change, investigate delivery, signature and subscription separately from this repaired schema issue. The local signed-empty-batch check verifies only the local handler and configured verifier, not the public tunnel, Intuit subscription or delivery.
