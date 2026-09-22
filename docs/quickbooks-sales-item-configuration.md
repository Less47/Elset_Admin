# QuickBooks default sales item configuration

## Previous behaviour

QuickBooks configuration used a native **Product / Service** select containing item names without type, SKU or income-account context. It loaded eligible Service/NonInventory items, but choosing one from a large catalogue was difficult. Setup required an existing item; ELSET offered no item creation action.

Invoice sync already supplied the selected ItemRef separately from each ELSET line's description, quantity, unit price and tax code. That invoice payload builder is unchanged.

## New configuration UX

- **Default QuickBooks sales item** replaces **Product / Service**. Its helper text is: “ELSET uses this QuickBooks item when creating invoice lines in QuickBooks. Your ELSET descriptions, quantities and prices are still sent separately.”
- **Create "ELSET Services" in QuickBooks** opens a dialog naming the connected company and requiring an income-account choice. Nothing is created just by opening configuration or the dialog.
- If one eligible item with the exact name is already in the loaded options, the action reads **Use "ELSET Services"** and shows its existing income account.
- **Use existing QuickBooks item** opens a searchable dialog. Results show name, type, income account, fully-qualified name when different, and SKU when present.
- Search covers name, fully-qualified name, SKU, raw type, readable type (including “Non-inventory”) and income-account name. It searches the entire loaded list. Only 100 matching results render initially; **Show more items** adds 100 at a time inside the scrollable dialog.
- Selecting or creating an item updates the draft selection. **Save QuickBooks configuration** explicitly saves the default and tax mapping. Creation preserves an unsaved GST selection.
- The selected item remains visible with its type and account after saving and reloading. If it is no longer eligible, configuration asks for another active item.

## Item eligibility

Eligibility is enforced on the server when loading options and rechecked when saving configuration and syncing invoices:

- Active must be explicitly `true`.
- Type must be `Service` or `NonInventory`.
- QuickBooks special items are excluded, as are Inventory, Group, Category and all other types.
- A valid item ID and a reference to an active income account are required.
- Existing items backed by active `Income` or `Other Income` accounts retain the previous support rules.

Queries retain complete pagination in 1,000-record pages. The existing bounded pagination guard fails closed instead of returning a partial catalogue. A fixture with 2,002 eligible items verifies later-page visibility; browser fixtures search 601 eligible items.

## ELSET Services creation and reuse

`POST /api/integrations/quickbooks/sales-item` accepts the current `tenantId` and a selected `incomeAccountId`. It is protected by authentication, admin/office permissions, the integration-enabled guard, the existing request-origin checks and the accounting lock. A pending company switch blocks it, and a stale company ID is rejected before any item write. Existing AU/AUD/GST configuration checks also apply.

The server freshly queries items, including inactive records for collision detection. Names are compared exactly after Unicode compatibility normalization, trimming and case folding; there is no fuzzy matching. Name and fully-qualified name are considered. A single eligible exact match is reused with its existing income account, even if a different account was chosen in the dialog. Existing items are never renamed, reactivated, deleted or assigned a different account.

An inactive, unsupported, missing-account or ambiguous same-name match stops creation. If none exists, the only item write is:

```json
{
  "Name": "ELSET Services",
  "Type": "Service",
  "Active": true,
  "IncomeAccountRef": { "value": "<selected existing account ID>" }
}
```

The existing operation ledger persists the request ID before the write. Concurrent local creation is locked. A lost response or a duplicate-name race triggers another item lookup and reuses an eligible result. Uncertain retries retain the same request ID; a changed payload or an expired unresolved retry window stops safely. No item creation occurs during invoice sync.

The creation/reuse action adds an accounting audit entry but does not change saved configuration, invoice/customer mappings, document lines, payments or ELSET's price list. It introduces no database migration or new table.

## Income-account handling

The creation dialog requires an explicit selection, even when there is only one account. New ELSET Services items can use only an existing active account of type `Income`; expenses, liabilities, inactive accounts and `Other Income` are not offered for new service creation. Reusing an existing eligible item preserves its current account.

No account is guessed, created or modified. With no eligible account, the dialog instructs the user to set up an appropriate income account in QuickBooks and reload configuration. The relationship uses `IncomeAccountRef`, which Intuit documents as the account recording sale proceeds and a required reference for Service items. See [Intuit's IncomeAccountRef reference](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/e53f8d57-d526-2cee-9c6b-03359cfaae37.htm).

## GST and invoice behaviour

**Default QuickBooks GST code** retains the existing Australian sales tax-code mapping. Its helper explains ELSET's current 10% GST treatment. Only matching active 10% sales codes remain eligible; existing country/currency checks and combined/purchase-only tax restrictions remain.

All ELSET invoice lines use the configured default item. A line reading **Replace compressor control board**, quantity **1**, rate **$850**, still reaches QuickBooks with that description, quantity and rate, plus **$85 GST** and a **$935 total**. Item names do not replace ELSET descriptions. The existing `TaxExcluded` calculation and cents-based reconciliation remain unchanged.

ELSET Items & Price List is separate. No price-list selection or per-item QuickBooks mapping is required. Existing invoice mapping identities and payment behaviour remain unchanged; Xero's account and tax configuration remains unchanged.

## Files changed for this request

| File | Change |
| --- | --- |
| `server-accounting-providers/quickbooks.js` | Context-rich eligible item options, explicit service-item creation and exact-name reuse/reconciliation. |
| `server-accounting-service.js` | Company-bound creation under existing locks, operation ledger and audit logging. |
| `server-accounting-routes.js` | Protected sales-item action. |
| `src/components/settings/AccountingSettings.jsx` | New field labels/helpers, creation result handling and draft-preserving integration. |
| `src/components/settings/QuickBooksSalesItemSettings.jsx` | Searchable item picker, selection summary and income-account creation dialog. |
| `tests/quickbooks-accounting.test.js` | Eligibility, pagination, creation/reuse, conflicts, uncertain writes, concurrency, company/auth guards and invoice/GST preservation. |
| `tests/helpers/quickbooks-mock.js` | Synthetic Item creation, duplicate-name rejection and lost-response simulation. |
| `tests/fixtures/quickbooks-server.mjs` | Test-only large catalogues and item-write evidence. |
| `tests/e2e/quickbooks-integration.spec.mjs` | Updated configuration flow and mobile/tablet/desktop search/create/reuse tests. |
| `docs/quickbooks-v3-setup.md` | Current setup instructions. |
| `docs/quickbooks-v3-report.md` | Updated item strategy. |
| `docs/quickbooks-sales-item-configuration.md` | This report. |

Earlier uncommitted price-list and theme changes remain in the working tree; they are not additional changes for this request.

## Verification

- `npm test`: **563 passed, zero failures**. Includes all QuickBooks accounting/migration/webhook tests, Xero accounting/payment tests and the price-list provider/PDF regressions.
- `npx playwright test tests/e2e/quickbooks-integration.spec.mjs tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=2 --reporter=list`: **68 passed** (**34 QuickBooks, 34 Xero**), zero failures.
- The new browser scenarios cover a 601-item catalogue, name/FQN/SKU/type/account search, unsupported/inactive exclusion, keyboard selection, explicit income selection, save/reload, creation/reuse, unchanged invoice descriptions and GST at **390, 820 and 1440px**. Existing integration scenarios cover all eight themes at those widths.
- `npm run lint`: passed.
- `npm run build`: passed; the existing JavaScript chunk-size advisory remains.
- `git diff --check`: passed.
- Visually inspected the mobile search picker and desktop creation dialog. Screenshots are under `test-results/quickbooks-v3/`.
- Final logs: `test-results/quickbooks-sales-item-all-unit.log` and `test-results/quickbooks-sales-item-browser.log`.

Tests use isolated local databases, authenticated test sessions and synthetic QuickBooks/Xero HTTP fixtures. No live QuickBooks item was created or modified; live AU Sandbox acceptance remains unverified. No commit, push or deployment was performed.
