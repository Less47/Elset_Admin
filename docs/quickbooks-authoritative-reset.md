# One-time authoritative QuickBooks reset

Status: implemented and tested locally. The first production **dry-run completed successfully on 2026-09-22** for **2025-09-03 through 2026-09-22 inclusive**. The start date was first queried read-only from the current production workspace, as explicitly requested. No apply, commit, push, permanent deployment or UI addition has occurred. This report is a proposal, not approval to apply.

## Run and scope

Temporary entry point: `scripts/quickbooks-authoritative-reset.mjs`. Required mode and cutoff:

```text
node /app/scripts/quickbooks-authoritative-reset.mjs --reset-dry-run --from=YYYY-MM-DD [--to=YYYY-MM-DD]
```

`--from` has no default. `--to` defaults to the current date in Australia/Sydney. Invalid, reversed and future date ranges are rejected. The CLI runs only inside `elset-admin`, against the existing `/app/data/elset-workspace.db`, with schema validation and no migrations. It does not download a database.

All available QB Invoice/Customer/Item/Payment/CreditMemo/Deposit pages are read to detect cross-period collisions. Only ELSET invoices whose saved issue dates are inside the selected inclusive range are processed. **Every QB target's current TxnDate must also be inside that range**, including duplicates. An older plausible counterpart blocks creation/adoption instead of being silently edited or recreated. Draft/inactive/invalid invoices and foreign accounting ownership are review-only.

Dry-run produces:

- `output/quickbooks-authoritative-reset-reset-dry-run-<timestamp>.json`
- Matching `.csv`, one row per in-range ELSET invoice, with all candidate evidence and proposed operations.
- Matching `-exceptions.json`, including safety reviews and payment warnings.
- `quickbooks-authoritative-reset-archive-<timestamp>-<sequence>.json`, a complete live snapshot with invoice/customer/item/payment/credit/deposit detail and minimal ELSET inputs.
- A durable, secret-free `quickbooks-authoritative-reset-journal-<timestamp>.jsonl`.

The summary counts KEEP AS-IS, UPDATE QB TO ELSET, CREATE QB, REMAP TO DIFFERENT QB RECORD, VOID DUPLICATE, LEAVE/REVIEW, existing-record links, records with payments/credits and safety skips. Primary ELSET classifications are exclusive; operation counts overlap because one invoice can require update, remap and duplicate void. QB-only records are separately reported.

**Dry-run cannot obtain write capabilities, mutate QuickBooks, call send endpoints or write mappings.** It asserts that mapping and ELSET financial/business rows are unchanged. The existing AccountingService can maintain its integration lock, encrypted OAuth refresh credentials and retry metadata; those are connection bookkeeping, not invoice/payment/mapping writes. No Payment create/update/delete or email/send resource is available in either mode.

## Canonical identity and authority

ELSET wins for number, customer, invoice date and meaningful line/financial content. Candidate evidence combines the existing mapping, exact and legacy number evidence, customer/date/totals, normalized complete line content, and accounting links. A QB record strongly owned by another ELSET invoice cannot be adopted. Ties and ambiguous identities become REVIEW_REQUIRED.

A full business-content match with **verified legitimate Payment allocations** outranks a newer unpaid mapped copy. Receipt evidence must have matching customer/currency, positive single-invoice allocations summing to the inferred paid amount, and no credit/deposit/unknown linked state. A paid-looking Balance alone is insufficient.

For INV-0252, when it falls in the selected range and live facts still agree, the plan prefers **QB 346**, preserves **Payment 348**, remaps ELSET from 353 to 346, aligns 346's number and voids unlinked duplicate 353. Every condition is rechecked live before apply.

If an unlinked duplicate occupies the desired canonical number, the proposed sequence includes changing that duplicate's number to the unique `VOID-<QB ID>` reference before voiding it. This releases the desired number without an undocumented duplicate-number override. The original number is retained in the archive and journal. A conflicting/overlong release number stops that operation for review. No linked duplicate is renamed or voided.

Historical Product/Service, line order, whitespace and description formatting alone do not generate a content rewrite. Complete line multisets are compared with multiplicity and matched-line quantities/prices/amounts. Invoice numbers still align exactly as requested. On a protected payment-linked invoice, the only automated edit is a sparse **DocNumber-only** change with proven intact financial and payment state. Linked customer/date/financial changes, unverified settlement, credits/deposits/other links and unmanaged line attributes remain review-only.

Unlinked unambiguous invoices can receive needed customer/date/content corrections. Existing ItemRefs are retained during content replacement where possible. New invoices use saved `priceListItemId` mappings, validated exact-name Item reuse or a validated new Service Item. Ad-hoc, archived, ambiguous or ineligible catalog sources use the configured fallback. Saved descriptions, quantities, prices and totals are preserved. No source catalog relationship is guessed from a description.

Genuinely absent invoices can be created even if ELSET already records payments, but the report explicitly warns that the new QB invoice will remain unpaid. This tool never exports a Payment to make the balance agree. Uncertain QB-only records are left and reported; absence from ELSET is not proof of junk.

## Apply prerequisites — do not execute before dry-run approval

The implemented apply mode requires all of:

```text
--reset-apply
--from=YYYY-MM-DD
--to=YYYY-MM-DD
--approved-plan=/app/output/<reviewed-dry-run>.json
--approved-plan-sha256=<exact SHA-256>
--volume-id=<mounted production volume ID>
--snapshot-id=<fresh completed snapshot ID>
```

The approved report must be complete and match the company and exact date range. A changed decision/source/candidate state stops that invoice for renewed review; SyncToken-only or metadata-only changes use the freshly read version. Resources verified and created earlier in the same run can be reused for later rows without manufacturing a second Item/customer.

Before a separately approved apply, create a **new Fly snapshot** of the mounted production volume using `fly volumes snapshots create <volume-id>`, then wait until it is completed. Fly documents the lifecycle as waiting/running/created; scheduling alone is not a completed backup. See [Fly volume snapshots](https://fly.io/docs/volumes/snapshots/).

Apply verifies the snapshot through read-only [Fly Machines/Volumes API](https://fly.io/docs/machines/api/volumes-resource/) calls. It requires a short-lived app-scoped token in **`ELSET_RESET_FLY_API_TOKEN`** for that process; do not print it, write it into reports or install a permanent application secret. The verified volume must be attached to the running machine and mounted at `/app/data`; the snapshot must be newer than the approved dry-run, at most one hour old, have a completed digest/nonzero size, and not have a non-completed status. Wrong/missing/unverifiable snapshots fail closed. No snapshot has been created by this implementation task.

The runner writes and verifies an exclusive, fsynced full pre-apply archive before financial actions, plus fresh per-operation archives before invoice mutations. Archives retain IDs, SyncTokens, numbers, customers, dates, complete lines/tax/totals/balances, forward/reverse accounting links and full Payment/CreditMemo/Deposit records. Credential-shaped keys are scrubbed; no integration credential rows, authorization headers or Fly tokens are archived.

## Execution and recovery

One ELSET invoice is processed at a time under the existing QuickBooks integration lock. Each mutation needs a one-use capability bound to the exact resource, operation and JSON payload. Only invoice create/update/void and necessary new customer/Item writes are supported; hard deletes, Payment writes and send endpoints are rejected. Existing durable operation request IDs protect uncertain responses.

Before each invoice mutation, the tool refreshes provider state, re-reads the invoice with its current SyncToken, rechecks scope/identity/payment links, archives it and rechecks the local source. It then rereads and validates the result, including a second inventory comparison, before accepting success or storing mappings. For DocNumber-only edits, the complete financial/linked-payment signature must remain identical. Mapping replacements use a guarded current-company compare-and-set and reject foreign ownership or unexpected local mapping changes.

An existing paid canonical can be verified/remapped before voiding its unlinked duplicate. If a later operation fails, the journal retains the completed actions and the remaining exception; there is no fictitious rollback of accounting history. A stale token, lost response, changed links/source or failed readback never authorizes a blind retry or unverified mapping. Rerunning already aligned records performs no further accounting mutations. If a partial run changes the remaining plan, review a new dry-run before continuing it.

After apply, the runner refreshes the complete comparison immediately, checks Payment economic fields/allocations and out-of-range invoices against the pre-apply snapshot, writes a final archive, and emits remaining exceptions (including uncertain QB-only records). Numeric payment mismatches remain exceptions for accounting review. Automated completion is separate from achieving a completely exception-free mirror.

SyncTokens provide version protection; see the official Intuit [Invoice entity fields](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/f69ef5c3-ece2-c146-24a2-855dae75b3a2.htm). No production apply behavior is claimed as live-tested: apply validation here is synthetic only.

## Files, checks and temporary transfer

New files are limited to the two reset scripts, `tests/quickbooks-authoritative-reset.test.js` and this document. They reuse the existing temporary reconciliation projection/comparison modules; retain those dependencies while this tool is needed. No application endpoint, permanent UI, recurring job, Xero flow or database schema was changed for this reset.

Observed tests: **28 reset-specific tests and the final full suite of 650 tests passed**, covering paid canonical preference, linked/unlinked duplicates, creation, updates, verified mapping changes, no Payment/email/delete operations, stale tokens, cutoff boundaries, dry-run immutability, idempotency, per-line catalog mapping/fallback, archive/snapshot failures and Xero ownership exclusion. Full lint passed; the final changed scripts/tests were linted again after the last guard was added. `git diff --check` passed. No browser/build rerun was needed for these temporary command-line files.

Only the temporary reset scripts need transferring to the existing Fly machine. Their temporary comparison/projection dependencies are already present from the prior authorized diagnostics. Do not overwrite permanent server/provider modules or deploy the local per-line feature as part of this reset. Use unused staged names for subsequent transfers because Fly SFTP refuses overwriting, then replace only the exact temporary script path.

## First production dry-run: 2026-09-22

A separate read-only SQLite probe (`readonly: true`, `fileMustExist: true`, `migrate: false`) first confirmed 180 current invoice records, earliest saved issue date **2025-09-03**, latest **2026-09-21**, and zero invalid dates. That date was printed before running:

```text
node /app/scripts/quickbooks-authoritative-reset.mjs --reset-dry-run --from=2025-09-03 --to=2026-09-22
```

The command completed with exit code 0 and `complete: true`, from `2026-09-22T03:57:39.425Z` to `2026-09-22T03:57:53.787Z`, against production company Elset (AU/AUD). No source invoices were outside the selected period.

| Result | Count |
| --- | ---: |
| ELSET invoices in range | 180 |
| QuickBooks invoices in range | 171 |
| KEEP AS-IS | 18 |
| UPDATE QB TO ELSET operations | 116 |
| CREATE QB | 8 |
| REMAP TO DIFFERENT QB RECORD | 1 |
| VOID DUPLICATE | 1 |
| LEAVE / REVIEW | 38 |
| Records skipped for safety | 38 |
| Selected canonical counterparts with payments (including review cases) | 118 |
| All QB invoices with linked payments | 144 |
| ELSET invoices with recorded payments | 171 |
| Records with credits | 0 |
| QB-only or unresolved records left untouched | 36 |

Operation counts overlap: INV-0252 requires an update, remap and duplicate void. Exclusive primary classifications total 180: 18 keep, 115 update, 8 create, 1 remap, 38 review. Every one of the 116 proposed updates changes **DocNumber only**; no historical line, Product/Service, subtotal, GST or total rewrite is proposed. There are also 115 proposed links to verified existing QB invoices; no mappings were actually written.

Live INV-0252 evidence confirms QB **346**, total $528 and balance $0, paid by **Payment 348**; current mapped QB **353** has total/balance $528 and no accounting links. Proposal: preserve 346 and Payment 348, remap 353 to 346, release the invoice number by renaming unlinked 353 to `VOID-353`, void 353, and align 346's number to `INV-0252`. These are proposals only and each requires fresh safety checks during a separately approved apply.

The 38 reviews comprise 24 customer identity reviews, 6 canonical identity reviews and 8 protected customer/date/financial changes. The report's `qbOnlyLeaveReport: 36` is a broad unassigned-or-review count, **not 36 proven orphan invoices**. Of those, 34 have possible ELSET relationships and linked payments, and 2 have no plausible ELSET candidate: QB **237** (DocNumber 204, $7,150 unpaid) and QB **129** (DocNumber 127, $1,430 unpaid). All 36 remain untouched by the plan.

The 8 create proposals are INV-0043, INV-0142, INV-0195, INV-0030, INV-0192, INV-0145, INV-0133 and INV-0246. Seven already have ELSET payments; any newly created QB invoice would remain unpaid because this tool never exports or modifies Payments. Another 19 existing-canonical comparisons carry payment-amount warnings, which are retained for review and are not repaired by invoice-number changes.

Observed audit: **14 QB read calls, 0 QB mutations, 0 Payment mutations, 0 send calls, 0 blocked requests, 0 mapping writes, 0 ELSET business/financial writes**. One OAuth refresh occurred; the integration lock and encrypted connection bookkeeping are the only database-write allowance in dry-run. **No customer emails were sent; the tool's proposed create/update/void actions cannot call email or send endpoints.**

Artifacts were retained on Fly under `/app/output/` and copied as reports/archives to local `output/`; no production database was downloaded:

- `quickbooks-authoritative-reset-reset-dry-run-2026-09-22T03-57-39-424Z.json`
- Matching `.csv` and `-exceptions.json`
- `quickbooks-authoritative-reset-archive-2026-09-22T03-57-39-424Z-1.json`
- `quickbooks-authoritative-reset-journal-2026-09-22T03-57-39-424Z.jsonl`

The JSON report SHA-256 is `1d0ed40541d721f1cbfbeb897fe150521c13299f46a5f76256d6b6d135128aa4`; archive SHA-256 is `9e294061b1c890cbd84b3a431d7f3b58495460d5a89859fa764837556489402e`. Local copies were checked against Fly hashes. No apply or volume snapshot was performed. Apply remains dependent on explicit approval of the dry-run and a newly completed, verified production volume snapshot.
