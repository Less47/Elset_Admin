# Full QuickBooks reconciliation and per-line sales items

## Second-pass diagnostic — 22 September 2026

**Final second-pass reports: `2026-09-22T03-25-17-028Z`. Read-only analysis completed inside Fly; no apply, commit, push or deployment.** The exact first-pass QuickBooks archive captured at `2026-09-22T02:55:27.301Z` was reused, with its SHA-256 verified. All 180 production ELSET invoices still matched the baseline on normalized content, paid amounts, customer resolution, invoice mappings and classification. The database was opened `readonly: true`, `migrate: false`, with `query_only=ON`; its connection change counter remained unchanged. Both second-pass runs made **zero QuickBooks calls, zero token refreshes, zero QuickBooks mutations and zero database writes**. Only the temporary diagnostic script and generated reports were transferred. No database was downloaded.

This is analysis of the **same archived 171 QuickBooks invoices**, not a new live QuickBooks fetch. Raw ELSET description formatting and saved price-list provenance were read from the current production transaction because the first report did not retain them; normalized/financial/identity values were verified unchanged. The preliminary second-pass artifacts at `03-22-17-406Z` are retained but **superseded**: their positional comparison mistook reordered lines for changed wording/prices. Use the final files below.

### The 124 different invoices

| Exclusive discrepancy bucket | Count |
| --- | ---: |
| COSMETIC_ONLY | 69 |
| CONTENT_DIFF_NO_FINANCIAL_CHANGE | 20 |
| FINANCIAL_DIFF | 0 |
| CUSTOMER_OR_DATE_DIFF | 18 |
| PAYMENT_ONLY_DIFF | 3 |
| MULTIPLE_DIFF_TYPES | 14 |
| **Total** | **124** |

**No subtotal, GST, total, matched-line quantity, unit-price or line-amount differences were found in this cohort.** All 32 first-pass line differences are complete line reorderings. The second pass proves equality of the full description/quantity/rate/amount/type multiset, including repeated-line counts, before aligning lines; both original positions remain in the report. Otherwise it compares by position and retains unmatched values. Reordering is `LINE_ORDER_DIFF`, not a fabricated wording or rate change. Nine invoices have `DESCRIPTION_FORMAT_ONLY`; **zero have `DESCRIPTION_CONTENT_DIFF`** after this alignment. Whitespace, line endings and prose case are normalized; punctuation, numeric/model tokens, word order and case-sensitive electrical units are preserved.

Other flags: `CUSTOMER_DIFF=22` (includes unresolved customer identity, explicitly distinguished in each row), `DATE_DIFF=8`, `DOC_NUMBER_DIFF=124`, `LINE_COUNT_DIFF=0`, `PRODUCT_SERVICE_DIFF=124`, `BALANCE_DIFF=6`, `PAYMENT_STATE_DIFF=6`. Of the document-number differences, 123 are equivalent numeric references with different prefix/zero-padding; INV-0214 instead points to QB 307 / number 212. No renumbering is proposed.

The bucket rules treat harmless item/description/reference formatting as ancillary when customer/date, content/structure or payment issues exist. Multiple substantive categories produce `MULTIPLE_DIFF_TYPES`. The 20 content-only records comprise 19 reorderings and the INV-0214 material reference difference. The remaining 13 reorderings also have customer/date/payment issues. `FINANCIAL_DIFF=0` describes invoice amounts, not payment settlement or general-ledger equivalence.

**73 records are tagged `HISTORICAL_ITEM_DIFFERENCE_ONLY` for business-content comparison**: customer, date, descriptions, quantities, prices, GST and totals agree, with no line-order difference. This tag excludes document-reference formatting and payment state from its meaning; those flags remain visible. It does not mean ItemRef is literally the only different field: all 73 still have document-number differences and three have payment differences. `STRICT_ITEM_ONLY=0` makes that distinction explicit. No historical invoice should be rewritten solely to adopt the new Item model.

All **316 saved production invoice lines lack a `priceListItemId`**, so the new model would use configured fallback Item **123 / ELSET Services**, income account **9 / Services**. No catalog origin was guessed from a description. In 121 of the 124 invoices, the archived line income account also differs from that fallback; those account references are retained, and no revenue reclassification is proposed. The archive has no Account entities, so future Item/configuration eligibility would need live validation.

### Shared candidates and missing counterparts

The multiple-candidate CSV contains **33 candidate rows covering all 21 ELSET invoices**, including weak number-only alternatives, timestamps, existing mappings, competing local claims, linked payments/allocations and field matches. **20 have `CLEAR_CANONICAL_CANDIDATE` recommendations; one remains `REVIEW_REQUIRED`: INV-0242.** These are recommendations, not mapping changes. QB **343 / number 242**, total **$737.00**, fully matches **INV-0243**. INV-0242 has the same customer/date but totals **$1,496.00** and includes 12 remote handsets instead of the safety-beam repair. A matching legacy number alone does not make QB 343 its counterpart. Most other conflicts arise from shifted historical invoice numbering.

The 16 unconfirmed counterparts now divide into **1 SAFE_CREATE, 8 POSSIBLE_EXISTING_QB_RECORD, 7 REVIEW_BEFORE_CREATE**. The main CSV includes every invoice's customer/date/total, first-pass missing reason, creation assessment and full weak-candidate comparisons.

- **SAFE_CREATE:** INV-0142, Colour Earth Wrough Ironworks, 19 February 2026, **$550.00**, unpaid. This is a conditional future invoice-only proposal after current-state/accounting-period checks, not authorization to create.
- **POSSIBLE_EXISTING_QB_RECORD:** INV-0113, INV-0133, INV-0216, INV-0217, INV-0230, INV-0239, INV-0244, INV-0233.
- **REVIEW_BEFORE_CREATE:** INV-0043, INV-0195, INV-0030, INV-0192, INV-0145, INV-0114, INV-0246. Six have ELSET payments; INV-0114 has unresolved customer identity.

Only eight originally received CREATE proposals because seven of the other records had weak number collisions and one had unresolved customer identity. Seven of those eight CREATE proposals already had ELSET payments. Expanded searching now also flags **INV-0133 ↔ QB 326** on identical lines/amounts, although customer/date differ and this is not a confirmed match. It identifies additional review evidence at **INV-0216 ↔ QB 243**, **INV-0217 ↔ QB 241**, and **INV-0239 ↔ QB 277**. The complete archived Invoice collection was searched; no claim is made about unqueried SalesReceipts or JournalEntries.

### INV-0252: preserve the paid accounting history for review

ELSET: **Melbourne Auto Rental & Repairs Pty Ltd**, 27 August 2026; one line **“Double power point”, 3 × $160.00 = $480.00**, GST **$48.00**, total **$528.00**, paid **$528.00**, balance **$0.00**. Both QB invoices have exactly that customer, invoice date, description, quantity, price and tax/total.

| Field | QB 353 | QB 346 |
| --- | --- | --- |
| DocNumber | INV-0252 | 251 |
| Item | 123 / ELSET Services | 121 / DOUBLE GPO |
| Line income account | 9 / Services | 16 / Billable Expense Income |
| Balance / inferred paid | $528.00 / $0.00 | $0.00 / $528.00 |
| Payment/credit links | None | Payment 348; no credit |
| Created | 2026-09-21T19:05:40-07:00 | 2026-08-27T01:06:48-07:00 |
| Updated | 2026-09-21T19:05:40-07:00 | 2026-09-09T20:26:44-07:00 |
| Due date | 2026-08-27, same as ELSET | 2026-09-03 |
| Current ELSET invoice mapping | **Yes** | No |
| Email status | NotSet | EmailSent |

Payment **348**, dated **8 September 2026**, allocates **$528.00 specifically to invoice 346**, has zero unapplied amount and was created on `2026-09-09T20:26:23-07:00`. **QB 346 is the stronger historical accounting representation**, because its content and paid state agree with ELSET and are supported by that allocation. QB 353 is stronger for the exact current number, ELSET marker and saved mapping, but it is a later unpaid copy. Review preserving 346 and resolving 353/the mapping; **neither was remapped, voided or edited, and no payment was moved**. Account and due-date differences remain visible for that review.

### The 77 payment-review records

| Payment category | Count |
| --- | ---: |
| ELSET_PAID_QB_UNPAID | 16 |
| ELSET_PARTIAL_QB_UNPAID | 2 |
| QB_PAID_ELSET_UNPAID | 0 |
| PAYMENT_AMOUNT_DIFF | 2 |
| MATCHING_PAYMENT_STATE | 40 |
| CREDIT_OR_OTHER_LINKED_TRANSACTION | 0 |
| OTHER | 17 |
| **Total** | **77** |

The payment CSV has one row per case, ELSET total/paid, QB total/balance/inferred paid, comparison basis, identity-review flag and per-candidate transaction/receipt evidence. `OTHER` comprises the 16 unconfirmed counterparts plus unresolved INV-0242; no missing invoice is treated as an unpaid invoice with zero balance. For 20 clear candidate proposals, the comparison basis explicitly identifies the second-pass recommendation. **60 cases still carry an identity-review requirement**, including shared references; the 40 numeric matches are not permission to link or edit.

The two amount discrepancies are INV-0035: ELSET paid **$12,100.00**, QB inferred paid **$6,100.00**, balance **$6,000.00**; and INV-0219: ELSET paid **$5,170.00**, proposed QB 246 inferred paid **$1,166.00**, balance **$4,004.00**. Inferred settlement is `TotalAmt − Balance`; it is not automatically a cash receipt. Actual allocation evidence is retained using the Intuit [Payment line/link fields](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b501ee6-1a8e-88b0-9bfb-df31903d89d6.htm).

### Proposed phases — none executed

1. **Safe nondestructive:** one conditional create, INV-0142. Zero immediately proposed exact links or certain broken-mapping repairs. Review the 20 canonical recommendations before adding any link plan; they have historical reference conflicts.
2. **Safe content corrections:** zero current candidates. Keep historical item labels, equivalent reference formatting and harmless line order. Customer/date conflicts require review, and protected paid records are not safe update candidates.
3. **Canonical/duplicate review:** 22 ELSET records (21 shared-candidate cases plus INV-0252). Shared references do not establish duplicate financial invoices. Zero void proposals; a future void would require certain duplicate identity, resolved mapping, no linked accounting state, fresh reads and separate authorization.
4. **Accounting-aware payment reconciliation:** all 77 payment-review cases. Preserve payment/credit history and resolve ownership and allocations before any accounting-aware change. Phase memberships overlap.

### Second-pass artifacts and verification

- [Complete JSON](../output/quickbooks-reconciliation-second-pass-2026-09-22T03-25-17-028Z.json)
- [All 180 ELSET rows and detailed discrepancy CSV](../output/quickbooks-reconciliation-second-pass-2026-09-22T03-25-17-028Z.csv)
- [Multiple-candidate comparison CSV — 33 rows / 21 invoices](../output/quickbooks-multiple-candidate-review-2026-09-22T03-25-17-028Z.csv)
- [Payment-review CSV — 77 rows](../output/quickbooks-payment-review-2026-09-22T03-25-17-028Z.csv)

Money is integer **AUD cents**, except unit prices explicitly labelled **AUD millionths**. Null/blank means unavailable, not zero. Required difference columns are booleans for all 124 selected comparisons. JSON retains complete aligned line pairs, original positions, monetary differences and candidate evidence. CSV cells are escaped and formula-guarded. Output creation is exclusive, preserving earlier reports.

Temporary additions: `scripts/quickbooks-reconciliation-second-pass.mjs` and `tests/quickbooks-second-pass.test.js`. Observed checks: **16 diagnostic tests passed; full unit suite 622 passed; lint passed; artifact/CSV count assertions and SHA-256 local/Fly comparisons passed**. No browser/build rerun was needed for this diagnostic-only change. Exact execution:

```powershell
flyctl ssh console --app elset-admin --machine 080eed3f912458 -C "node /app/scripts/quickbooks-reconciliation-second-pass.mjs --dry-run"
```

| File | Verified SHA-256 |
| --- | --- |
| Second-pass script | `9c037226db4b41863308d56b709edda27fd459ef58977b229b843845cadc60ad` |
| Second-pass JSON | `8b6687a23a12327dc374545e2c985fbfb935a3cc9d3658e59d40aea1c2d90fc9` |
| Main CSV | `49bbf8def469b2b23a12bd0351b749f0a67f6a47a9fd962b8dcae8f70e604d55` |
| Multiple CSV | `32f338453c4e0fd02384bcd4e54c8da0a2d99752578809a9e14ebc4c9d592919` |
| Payment CSV | `c995d9dde178df2b8354b841cc89473e319de7d22390e74b9ec63815510b2cbd` |

**Stopped after diagnosis. The first-pass implementation and evidence below remain historical context; use this section and the final second-pass artifacts for the refined conclusions.**

## First-pass implementation and evidence

Implemented locally and completed the full-history production **dry-run only** on 22 September 2026. No reconciliation apply, invoice/customer/item financial write, void, delete, Payment operation or QuickBooks email-send operation was performed. Nothing was committed, pushed or deployed. Only the two temporary analysis scripts were transferred to the existing Fly machine; the permanent per-line feature remains undeployed.

## Final production result

Use the reports with timestamp **`2026-09-22T02-55-18-968Z`**. Company: **Elset**, realm `9341455117592074`, AU/AUD. Production configuration validation passed; no configuration was changed by this task.

All **180 current ELSET invoices** were eligible under the existing sent/payment semantics. All **171 QuickBooks invoices** returned by the full-history query were classified. Both datasets span 3 September 2025 through 21 September 2026. The separate archive of 19 deleted ELSET invoices was excluded from accounting candidates.

| ELSET primary classification | Count |
| --- | ---: |
| EXACT_MATCH | 19 |
| MISSING_IN_QB | 16 |
| DIFFERENT_IN_QB | 124 |
| MULTIPLE_QB_CANDIDATES, including shared external identity | 21 |
| MAPPING_BROKEN | 0 |
| VOIDED_IN_QB | 0 |

| QuickBooks primary classification | Count |
| --- | ---: |
| CANONICAL_ELSET_MATCH | 121 |
| LIKELY_DUPLICATE | 1 |
| QB_ONLY | 4 |
| AMBIGUOUS_QB_ONLY | 45 |
| VOIDED | 0 |

`CANONICAL_ELSET_MATCH` identifies a unique proposed counterpart, not a claim that all invoice content agrees. The ELSET classification and difference flags show whether its content differs.

Of the 124 different counterparts, **73 differ only in invoice number**. Another 21 also differ in lines, 9 in customer and lines, 6 in date, 13 in customer, and 2 in date and lines. The customer differences include unresolved or conflicting identities; they are not permission to move invoices between customers. Subtotal/GST/total agreed for these 124 counterparts. Ambiguous and unconfirmed candidates still require review.

The 16 `MISSING_IN_QB` records mean **no sufficiently confirmed counterpart**: eight have identity-safe create proposals, seven have weak number collisions that block creation, and one has unresolved customer identity. They must not be treated as 16 invoices to create.

| Proposed action, across both report sides | Count |
| --- | ---: |
| NONE | 19 |
| CREATE_QB_INVOICE | 8 |
| LINK_EXISTING_QB_INVOICE | 0 |
| UPDATE_QB_INVOICE_TO_ELSET | 0 |
| VOID_QB_DUPLICATE | 0 |
| REVIEW_DUPLICATE | 1 |
| REVIEW_QB_ONLY | 4 |
| REVIEW_PAYMENT | 119 |
| REVIEW_CONFLICT | 79 |

Review-action counts are record-level counts across both sides, so the same uncertain relationship can appear on its ELSET record and QuickBooks record. These are proposals, not approved operations.

The inventory also contains 101 Customers, 123 Items, 151 Payments, zero Credit Memos and one Deposit. **144 QuickBooks invoices have payment links**. **77 ELSET invoices require payment review** because a balance disagrees or the counterpart/customer cannot be established safely. That is a separate measure from the 119 `REVIEW_PAYMENT` actions: even matching balances do not make editing a payment-linked invoice safe.

The eight create candidates are `INV-0043`, `INV-0142`, `INV-0195`, `INV-0030`, `INV-0192`, `INV-0145`, `INV-0133` and `INV-0246`. **Seven already have payments recorded in ELSET.** No Payments will be exported to make a newly created QuickBooks invoice look paid. Accounting-period and payment reconciliation review is required before any future write.

## Payment-sensitive duplicate

One group relates to **INV-0252**, Melbourne Auto Rental & Repairs Pty Ltd, dated 27 August 2026, total **AUD 528.00**:

| QuickBooks ID | DocNumber | Balance | Links | Proposal |
| --- | --- | ---: | --- | --- |
| 353 | INV-0252 | AUD 528.00 | None | Existing mapped counterpart; no action |
| 346 | 251 | AUD 0.00 | Payment 348 | REVIEW_DUPLICATE |

Descriptions, quantities, prices, date, customer and totals agree. The current mapping points to 353, but the legacy invoice 346 is paid. The mapped record is only the **proposed** canonical record under mapping priority; an accounting reviewer must decide how to preserve the paid history and resolve the newer unpaid record/mapping. The tool does not void the paid invoice or move its payment. ELSET also records AUD 528.00 paid, so its mapped QuickBooks balance is flagged for payment review.

The four QB-only records are IDs 277/DocNumber 238, 241/211, 237/204 and 129/127. Two are paid and two unpaid. They remain review-only; being absent from ELSET is not evidence that an accounting invoice should be removed.

## Matching and fingerprints

The temporary runner uses the existing AccountingService/provider, encrypted credentials, integration lock, company/environment/scope checks and retry delays. It validates the existing production workspace schema without migration. It reads current invoice snapshots through `readAccountingInvoice`, with additional draft/archive/inactive checks; no ELSET financial content is rewritten.

All Invoice, Customer, Item, Payment, CreditMemo and Deposit pages are read in batches of 1,000 until an incomplete last page is returned. Customers and Items include inactive records for collision checks. Invalid responses, duplicate IDs across pages, provider/rate/auth errors and a ten-million-record safety bound fail closed; the script never reports a partial list as complete. Tests exercise 20,001 invoices, beyond the old provider settings-query cap. The actual production datasets fit in one page per entity.

Comparison uses deterministic SHA-256 fingerprints over normalized descriptions, customer identity, dates, line count/order, quantity millionths, rate millionths, line amount cents, subtotal cents, GST cents and total cents. Decimal conversion uses the repository's scaled-integer implementation. ItemRef and old private notes are excluded from financial content equality, so historical Product/Service differences alone do not propose an update. Discount lines and other unsupported QuickBooks line structures are retained in the archive/comparison and require review; the current ELSET model has no separate discount calculation to invent or export.

Matching priority is an existing current-company invoice mapping, exact DocNumber or ELSET identity marker, then corroborating customer/date/line/financial evidence. Broken/foreign-company ownership is never permission to recreate an invoice. Exact normalized customer name/email or an existing customer mapping is required for safe identity; contradictory names/emails, multiple candidates and reverse mapping collisions require review. An inactive/sub-customer/project is not safe for new linking/creation.

Legacy numeric numbers such as `27` versus `INV-0027` are **candidate evidence**, never normalized into equality or automatic renumbering authority. Corroborating date, customer, totals or lines can identify a different-content counterpart for review. A number variant with no supporting evidence is recorded under `possibleCandidates`, blocks creation, and leaves the QuickBooks record ambiguous. An external invoice claimed by multiple local invoices blocks automatic linking and forces payment review. ServiceM8 identifiers remain historical provenance; only current ELSET snapshots define the desired content.

Duplicate groups combine equal DocNumbers, explicit source/memo markers, exact customer/date/line/financial fingerprints, and near-identical records created within five minutes. Near-identical evidence requires the same customer/date/normalized descriptions and totals within the larger of AUD 1 or 5%; it is review evidence only. Canonical selection requires a unique existing mapping/counterpart or unique exact-content-and-number match. No arbitrary oldest-record tie-break chooses between indistinguishable invoices.

A void is only proposed when a uniquely canonical, eligible, exact ELSET counterpart exists, the second invoice has extremely strong matching evidence, is not mapped, has a valid SyncToken, is fully unpaid and has no linked/protected accounting state. Anything less certain remains `REVIEW_DUPLICATE`. This production run proposed **zero voids**.

## Payments, archives and execution boundary

The analysis includes invoice-level and line-level LinkedTxn, reverse Payment invoice allocations, CreditMemo links, Deposit links through Payments, and invoice Deposit amounts. Missing/partial balances, credits, deposits, unknown linked transaction types, paid/part-paid balances and void states prevent destructive proposals. Uncertain customer or invoice identity cannot be labelled PAYMENT_MATCH merely because its balance happens to agree.

The HTTP guard permits only production QuickBooks GETs and the existing OAuth token-refresh endpoint. It rejects financial POST/PUT/DELETE calls, sends (including an attempted GET send), Items, Payments, invoice updates and void/delete operations. Dry-run can maintain the local integration lock and encrypted token/retry metadata; it never writes invoice/customer/payment/mapping business rows.

**The old create-only apply path has been removed. This version accepts only `--dry-run`.** No apply executor has been enabled or verified. A future separately reviewed executor must re-read each affected entity, use its current SyncToken, revalidate customer identity and all linked accounting state, write a fresh successful archive before its first mutation, validate returned totals/tax/content before mapping, and preserve existing retry/idempotency protections. Today's archive is evidence, not a promise that a later state is unchanged.

Before analysis, the runner writes a complete machine-readable snapshot of all fetched invoices and associated entities to `quickbooks-reconciliation-prechange-<timestamp>.json`. It includes IDs, SyncToken, customer refs, numbers, dates, complete line/tax/total/balance/link fields and metadata. It is created exclusively (`wx`) with read-only mode `0400`; failure to archive prevents a completed action plan. Credential-shaped keys are stripped defensively; provider entities are saved, never HTTP headers or integration credential records. Reports contain private business data and should stay in a private audit location.

Three read-only passes were used to validate/refine the report. Earlier `02-46-23-552Z` and `02-53-24-373Z` reports are **superseded**: the first did not sufficiently account for historical number variants, and the intermediate pass did not force payment review for every uncertain identity. All earlier audit artifacts were retained. Use only the final `02-55-18-968Z` report for review.

Each pass made 14 QuickBooks GETs and zero mutations: **42 GETs and zero mutations in total**. The first pass refreshed credentials once using the existing encrypted storage; the final two needed no refresh. No production database, including auth.db, was downloaded. Only deployed source for compatibility checking and generated audit files were copied locally.

## Permanent per-line Product/Service mapping

Saved invoice lines already retain a provider-neutral `priceListItemId` in `extra_json`. The accounting projection now passes that identifier to the QuickBooks resolver. Provider/company-specific IDs are stored as `local_entity_type='price-list-item'` in the existing integration mapping table. There is no schema migration and no QuickBooks ID is inserted into historical invoice lines.

During normal QuickBooks sync:

1. Reuse and validate an existing mapping for the current company.
2. Otherwise search all active/inactive Items for an exact normalized name, including fully qualified names. A single eligible active Service/NonInventory item is reused and mapped.
3. If no name collision exists, create one Service item using the configured fallback item's active Income account. Reuse the existing durable request IDs, service lock and lost-response/name-race reconciliation; validate the response before mapping it.
4. Ambiguous/inactive/unsupported names, unsafe names, unavailable/archived source items or mapping collisions use the configured fallback and log `FALLBACK` with a safe reason. Provider outages/auth/rate errors stop rather than silently claiming success.
5. Ad-hoc lines continue using the configured fallback, normally ELSET Services.

Each line's resolved ItemRef is supplied separately from its saved Description, Qty, UnitPrice, Amount and TaxCodeRef. Existing AU GST and rounding rules remain unchanged. Later catalog name/description/price/archive changes do not rewrite saved ELSET lines; existing mappings are preferred over a rename. A protected mapped invoice is rejected before any new catalog Item is created. No invoice-send endpoint is called.

Settings now says **Fallback QuickBooks sales item** with the requested ad-hoc helper text. AU GST remains separate. Items & Price List shows optional current-company mapping state: unmapped, mapped item name, or fallback warning. The metadata is read-only, excludes credentials, and is absent when QuickBooks is not connected/enabled. The catalog and Xero do not require QuickBooks.

The Service/NonInventory eligibility and conservative name validation use the Intuit [Item field contract](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/850f7b3b-9e8b-679d-9389-6a487f859b39.htm); payment evidence follows the [Payment entity fields](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b501ee6-1a8e-88b0-9bfb-df31903d89d6.htm). No account, tax code or existing Item is automatically altered.

## Files and checks

Permanent implementation:

- `server-accounting-price-list.js` — scoped item resolution, fallback logs and read-only mapping metadata.
- `server-accounting-workspace.js` — expose saved price-list source IDs.
- `server-accounting-service.js` — per-line resolver and protected-invoice preflight.
- `server-accounting-providers/quickbooks.js` — reusable safe named-item matching/creation and per-line ItemRef.
- `server-price-list-routes.js` — optional mapping metadata on existing catalog reads; no new endpoint.
- `src/components/settings/AccountingSettings.jsx`, `QuickBooksSalesItemSettings.jsx`, `PriceListSettings.jsx` — fallback wording and catalog mapping display.
- `tests/quickbooks-accounting.test.js`, `tests/helpers/quickbooks-mock.js`, `tests/e2e/quickbooks-integration.spec.mjs` — per-line, snapshot, idempotency, fallback and browser coverage.
- `docs/items-price-list.md`, `docs/quickbooks-sales-item-configuration.md` and this report.

Temporary tooling: `scripts/quickbooks-one-time-backfill.mjs`, `scripts/quickbooks-reconciliation-core.mjs`, `tests/quickbooks-reconciliation.test.js` and generated audit reports. There is no reconciliation UI, API or recurring job.

Observed verification:

- Targeted accounting/price-list/Xero/reconciliation run: 147 passed before the two added legacy-number tests; final reconciliation tests: **29 passed**.
- Final full unit suite: **606 passed**, zero failures, including QuickBooks and Xero regressions.
- Browser tests: **116 scenarios passed across runs**. Initial broad run: 113 passed and three old helper-text assertions failed; the assertions were updated to the requested text and all three passed on rerun. The new mapping workflow passed at 390 and 1440 px; catalog/document, QuickBooks and Xero regressions were included.
- Mobile/desktop mapping-state screenshots were visually inspected; no clipping was observed.
- Lint passed after correcting a control-character-regex lint error. Build passed with the existing large-chunk advisory. `git diff --check` and script syntax checks passed.
- Final Fly dry-run exited 0, reported complete, made 14 GETs/zero refreshes/zero mutations, and generated all four reports.

Evidence is retained in `tmp/reconciliation-*.log` and screenshots under `test-results/quickbooks-v3/` (ignored local test artifacts).

## Exact transfer and execution

The scripts are already present on machine `080eed3f912458`. The exact production command was:

```powershell
flyctl ssh console --app elset-admin --machine 080eed3f912458 -C "node /app/scripts/quickbooks-one-time-backfill.mjs --dry-run"
```

For a future authorized transfer, use unused staging names because Fly SFTP refuses overwriting an existing file, then replace only these temporary script paths:

```powershell
flyctl ssh sftp put --app elset-admin --machine 080eed3f912458 scripts/quickbooks-reconciliation-core.mjs /app/scripts/quickbooks-reconciliation-core-review-stage.mjs
flyctl ssh console --app elset-admin --machine 080eed3f912458 -C "mv /app/scripts/quickbooks-reconciliation-core-review-stage.mjs /app/scripts/quickbooks-reconciliation-core.mjs"
flyctl ssh sftp put --app elset-admin --machine 080eed3f912458 scripts/quickbooks-one-time-backfill.mjs /app/scripts/quickbooks-one-time-backfill-review-stage.mjs
flyctl ssh console --app elset-admin --machine 080eed3f912458 -C "mv /app/scripts/quickbooks-one-time-backfill-review-stage.mjs /app/scripts/quickbooks-one-time-backfill.mjs"
```

No application modules or permanent mapping implementation are included in that transfer. Do not run an apply command; this tool rejects one.

## Final report locations and integrity

Identical local copies and Fly `/app/output/` copies are retained:

- [Reconciliation JSON](../output/quickbooks-reconciliation-2026-09-22T02-55-18-968Z.json)
- [Reconciliation CSV](../output/quickbooks-reconciliation-2026-09-22T02-55-18-968Z.csv)
- [Duplicate-review CSV](../output/quickbooks-duplicate-review-2026-09-22T02-55-18-968Z.csv)
- [Read-only pre-change archive](../output/quickbooks-reconciliation-prechange-2026-09-22T02-55-18-968Z.json)

Amounts in JSON and CSV financial columns are **integer cents**, including duplicate CSV columns `elsetTotal`, `qbTotal` and `qbBalance`. This report's AUD amounts are formatted dollars. All output CSV cells are escaped and guarded against spreadsheet formula execution.

Local/remote SHA-256 values were compared:

| Artifact | SHA-256 |
| --- | --- |
| Runner | `d8ad6e47cd5c46879fd79b993ede74b15660b9b84b382ad8af01fce13b18d94e` |
| Final core | `2e23bf865b19ba6cdd35e42f445a3700d7033c41e8d00b0b60702ac5603c5c8a` |
| JSON | `8a989517dc7aef728ecdd356b52a42d9ff27b7727dcd2f96eeebdc0e433f371b` |
| CSV | `c6180926706d54f7b28c1fbaa02a97d8a2e1b3fc575c1d5ffde9eb733dee315e` |
| Duplicate CSV | `f7d6591b3b94c1c4054c74734b56daba5275afb2348c2e122c97a0c33d0439cb` |
| Archive | `bee66ef71d323a4f371165239f4d69dd50a92d648a52706fee5296668041ff34` |

After an eventual separately approved reconciliation is complete and verified, retain the desired private audit copies and remove the two temporary scripts and dedicated reconciliation tests, including their Fly copies. Keep the permanent per-line feature and its accounting/browser regressions. Remove the ignored temporary compatibility source/check files when no longer useful.

**Stopped after dry-run. No apply, commit, push or deployment.**
