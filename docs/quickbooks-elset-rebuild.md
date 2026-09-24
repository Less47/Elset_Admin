# One-time QuickBooks rebuild from ELSET

This temporary operator tool replaces the selected QuickBooks invoice and payment history with ELSET's saved invoices and receipts. It is not part of the web application or normal accounting sync.

The operator must run it inside the existing `elset-admin` Fly machine. It opens the existing `/app/data/elset-workspace.db` without migrations, verifies the current schema and connected production AU/AUD company, and requires the complete ELSET invoice history to fit the explicit date range. Never copy production `auth.db` locally.

## Preparation

```sh
node /app/scripts/quickbooks-elset-rebuild.mjs --prepare --from=2025-09-03 --to=2026-09-24 --payment-account=32 --preserve-external-accounts=true --reuse-customer-ids=54,55,64,91
```

The date range and account IDs above describe the reviewed Elset company, not portable defaults. The user confirmed the following on 24 September 2026:

- ELSET invoices and payments are authoritative; QuickBooks historical payments may be replaced.
- Retain the three existing QuickBooks-sourced receipts in the Elset bank account (54). Put the other rebuilt receipts in Undeposited funds (32).
- Reuse existing customers Kenny (54), AMV HOMES (55), Annie Williams (64) and Mirella Makcon (91), despite differing contact emails. Existing contact details remain unchanged. The customer and account ID spaces are separate.

Preparation allows accounting reads and OAuth maintenance, but blocks financial/customer/item writes and every send endpoint. It creates an immutable source archive and hashed plan on the mounted volume under `/app/data/quickbooks-elset-rebuild`. A changed local source aborts preparation; obtain a fresh plan after the source is stable.

For the final reviewed plan, append `--retain-invoice-ids=367,369,370`. QuickBooks rejected deletion of a bank-matched payment (error 6480). These three mapped invoices and their single QuickBooks-sourced bank receipts already exactly match ELSET; the planner verifies the entire financial content and allocation before retaining them. They remain in the full final comparison. Manual receipts, unmatched details or changed records cannot use this exception. The final plan replaces 176 invoices and 151 payments with 176 invoices and 180 payments, retaining three of each for a final 179 invoices and 183 payments.

The customer override only permits reusing the explicitly named IDs when the name match is unique and the record is active, is not a project/subcustomer, and is not owned by a different local customer. It cannot select a differently named or otherwise ambiguous customer.

## Apply and recover

Create a fresh snapshot of the mounted volume after the final preparation. Supply its ID, the plan path, and the exact report SHA printed by preparation:

```sh
node /app/scripts/quickbooks-elset-rebuild.mjs --apply --plan=PLAN_PATH --sha256=REPORT_SHA256 --volume-id=vol_rkg5j39m0855g6k4 --snapshot-id=SNAPSHOT_ID
```

`ELSET_RESET_FLY_API_TOKEN` must contain a temporary Fly token capable of reading the app's machine, volume and snapshots. Never print that token. The tool verifies the actual mount and a completed snapshot made after preparation, no more than one hour old. A second SQLite backup is created and integrity/source checked inside Fly before any provider changes.

Apply holds the integration lock, persists a pause of incoming QuickBooks sync, resolves customer and per-line product/service references, deletes scoped payments before invoices, recreates each invoice and its receipts, and updates integration mappings. It never changes ELSET financial rows. Existing manual receipts remain manual; normal payment reconciliation retains its manual-history review guard. The three QuickBooks-sourced receipt mappings are updated to the new provider IDs.

Every provider mutation is journalled, uses a durable request identity and is read back. The final comparison checks the complete invoice/payment inventory, historical line content, GST, dates, allocations, account destinations, local source fingerprint, mappings and preserved deposits/credits. Invoice email state is `NotSet`; payment creation does not invoke charging, and send endpoints are blocked.

The ledger and archives are persistent and restricted to the owner. On failure, keep incoming sync paused and inspect the safe stop code and ledger. After any financial mutation, resume the same plan and ledger with a fresh verified snapshot; completed steps are not repeated, and uncertain creates are recovered by unique markers and exact readback. Do not restore a database backup casually: it also contains integration metadata and encrypted credentials.

The initial attempt created two customers, then stopped at its first payment deletion. Before preparing the narrower plan, a new complete provider comparison proved all original financial records unchanged and all ELSET invoice/receipt projections identical. The initial ledger was marked `supersededBy` the new plan hash, which prevents accidentally applying the earlier plan. The new apply uses `--resume-enabled-from=52917fab3d2f5d1c563423bd2436f9acfed09f37072d2ff53a6288413b194c34` to inherit the original enabled state; the tool validates that the earlier paused ledger points to the current plan before accepting that setting.

This tool does not resolve the app's future payment ownership model or change live webhook formats. Do not present a successful one-time rebuild as proof of continuous sync.

## Verification

`tests/quickbooks-elset-rebuild.test.js` exercises the production executor with synthetic fixtures, including payment destination choices, customer confirmation boundaries, source/target drift, protected records, historical payloads, interruption recovery, repeat execution, exact readback, and transport rejection of send/charge/foreign-company/unapproved requests.

Production response differences covered by regression tests: removing one payment recalculates `Line.LineEx.any[Name=txnOpenBalance]` in another payment against that invoice; QuickBooks may omit the false `FreeFormAddress` default in a direct invoice read; and an unpaid invoice may gain a generated `InvoiceLink`. Only these nonfinancial response differences, version metadata and the expected invoice balance/payment links are normalised for scoped deletion recovery. Receipt amounts, accounts, allocations, dates, invoice content, customer/address details and email state remain protected. Full entity comparison remains in place for the retained bank records.

No application deployment is needed to run the temporary tool. Keep any unrelated working-tree changes uncommitted and undeployed unless separately authorised.

## Observed completion: 24 September 2026

Final verification completed at `2026-09-24T03:30:50.948Z`: 179 invoices, 183 payments; AUD 387,278.75 invoiced, 367,111.85 received and 20,166.90 outstanding. The final plan replaced 176 invoices and 151 payments, created 176 invoices and 180 payments, and retained the three matching bank pairs. Final readback matched every source record. An independent post-run comparison with the SQLite backup confirmed unchanged ELSET invoices, lines, payments and customers. QuickBooks was CONNECTED and enabled, the pause was removed, and the app health endpoint returned HTTP 200. All 706 tests passed, including 38 rebuild tests; scoped lint and whitespace checks passed.

Completed plan hash: `55e94b7d79652faa00b52579863f7ccfa1568ee4409baa592cc5c6494307877b`.

Final archive on Fly: `/app/data/quickbooks-elset-rebuild/quickbooks-elset-rebuild-final-2026-09-24T03-20-02-653Z.json`; SHA-256 `e143fbe602e4e8f5ba13ef83ebf44bdf3b7cc4213688ffa377f9d38ecdfe447c`.

Database backup on Fly: `/app/data/backups/quickbooks-elset-rebuild-2026-09-24T03-01-31-963Z.db`; SHA-256 `d262471d3000b8b90db3de43d63766a22b2af6c78991bbe4e0afe7fdc1533d4e`. Volume snapshot: `vs_vyVNGqDOj7J7sn2JmoZxJ`, created `2026-09-24T02:59:18Z`.

The completed run loaded runner SHA-256 `82796ceb217b37910eba7c8d387ad0574f3579f7bbccc3bf3232929f8fa5ddc4` and core SHA-256 `65ba9df35dbb41e065847844fc70a8d977e6c732fcf594da510cd2a2ecaf0591`. Its final attempt journal is `/app/data/quickbooks-elset-rebuild/quickbooks-elset-rebuild-journal-2026-09-24T03-20-02-653Z.jsonl`. Earlier journals record the completed deletes and controlled interruptions. No email-send calls were made in any attempt.
