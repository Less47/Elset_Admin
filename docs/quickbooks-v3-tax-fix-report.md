# QuickBooks V3: empty GST dropdown investigation

18 September 2026. The existing local connection was inspected using read-only calls to the **QuickBooks Sandbox API**. No production API, new company authorization, invoice write or company-settings change was performed. Changes remain local and uncommitted.

## 1. Existing behavior and actual cause

`GET /api/integrations/quickbooks/config` calls `AccountingService.getConfig()` → `options()` → `QuickBooksAccountingProvider.getTaxRates()`.

The implementation already requested **TaxCode and TaxRate**, using the Query API:

```text
GET https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/query
  ?query=SELECT * FROM TaxCode WHERE Active = true STARTPOSITION 1 MAXRESULTS 1000
  &minorversion=75

GET .../query
  ?query=SELECT * FROM TaxRate WHERE Active = true STARTPOSITION 1 MAXRESULTS 1000
  &minorversion=75
```

Queries are URL-encoded and paginated. TaxCode supplies the transaction identifier/name; TaxRate supplies the numeric percentage. The provider keeps active codes having one sales-rate reference that resolves to an active numeric rate, and returns `{ id: TaxCode.Id, name: TaxCode.Name, rate: TaxRate.RateValue, rateId: TaxRate.Id }`. Purchase-only and combined codes are outside the existing V3 policy. The UI further requires the percentage to equal the workspace's 10% treatment.

**The observed connection is US/USD, not Australian/AUD.** It has no matching 10% code. The original defect was the unexplained empty dropdown: company compatibility was only checked on save, which the empty required selector prevented. It was not a failure to request TaxCode, and it was not a TaxRate ID being stored as the invoice TaxCode.

## 2. Actual Sandbox response

Live read at `2026-09-18T03:53:27.650Z`; company identity/preferences were verified in an additional read immediately afterwards. No tokens or company/customer identities were printed or retained in the diagnostic artifact.

```json
{
  "CompanyInfo": { "Country": "US" },
  "Preferences": {
    "CurrencyPrefs": { "HomeCurrency": { "value": "USD" } },
    "TaxPrefs": { "UsingSalesTax": true }
  }
}
```

Tax query envelopes contained `QueryResponse.TaxCode[]` / `QueryResponse.TaxRate[]`, plus `startPosition`, `maxResults` and `totalCount`. An additional unfiltered TaxRate query returned the same three rates. The sanitized real response is retained as `tests/fixtures/quickbooks-tax-sandbox-us.json`. It is explicitly identified as **US**, not claimed as an Australian response.

## 3. GST/sales tax preference

`Preferences.TaxPrefs.UsingSalesTax` is **true** in the connected Sandbox. This establishes enabled US sales tax, not an Australian GST setup. The provider now exposes the boolean, or `null` when it was not supplied, and configuration displays the observed country/currency and preference.

For an AU company with the preference explicitly false, the UI and server now explain: **“GST is not enabled in this QuickBooks company. Enable GST in QuickBooks, then reload configuration.”** An omitted preference is reported as unknown rather than invented as enabled/disabled.

## 4. Query after the fix

The active TaxCode query above is retained because it successfully returned authoritative records. The TaxRate query remains a percentage lookup; invoice assignment continues to use TaxCode. No ID, percentage, tax calculation or fallback code was invented.

Configuration now returns a provider-generated `configurationIssue` for incompatible country/currency, disabled GST, or no active code matching the workspace tax treatment. The shared UI displays the explanation and disables tax selection/save until resolved. Product/Service retrieval remains available. An AU company with no matching codes gets exactly: **“No active QuickBooks GST tax codes were found. Check GST settings in your QuickBooks company.”** Server-side save/sync validation enforces the same checks.

Primary sources rechecked during this investigation:

- [Intuit TaxCode reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/taxcode) and [official TaxCode model](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPTaxCode.php): sales and purchase rate lists have distinct meanings.
- [Official TaxRate model](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPTaxRate.php): linked rate value, rather than a tax-code name, supplies the numeric rate.
- [Official TaxPrefs model](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPTaxPrefs.php): `UsingSalesTax`.
- [Official international transaction-tax model](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPTxnTaxDetail.php): international line tax-code references and provider tax calculation; transaction-level `TxnTaxCodeRef` is US-specific.
- [Intuit Australian Simpler GST guidance](https://static.developer.intuit.com/resources/Simpler_BAS_partner_FAQ.pdf): Australian simplified/detailed tax-code configuration. This is historical regional guidance, not proof that this US Sandbox has AU GST.

The JavaScript developer portal still returned a loading shell here; accessible primary SDK source and the actual authenticated Sandbox response provide the evidence above. Australian tax behavior must still be checked against an actual AU Sandbox.

## 5. Tax codes actually returned

| TaxCode ID | Authoritative name | Active | Sales-rate references | Effect in V3 |
| --- | --- | --- | --- | --- |
| `2` | California | true | TaxRate `3`, California, **8%** | Returned as an 8% option; not eligible for the 10% GST selector. |
| `3` | Tucson | true | TaxRate `1`, AZ State tax, **7.1%**; TaxRate `2`, Tucson City, **2%** | Combined rate list; excluded under existing single-rate policy. |

Both sales-rate details use `TaxTypeApplicable=TaxOnAmount`, `TaxOrder=0`; both purchase lists are empty. All three TaxRate records explicitly contain `Active=true`. No active Australian GST code was returned.

For opt-in diagnostics on a local development server, set `QUICKBOOKS_TAX_DIAGNOSTICS=1` before starting/restarting `npm run dev`. Output includes TaxCode count/IDs/names/Active, sales/purchase rate references, rate values and transformed option count. Logging requires Sandbox, a local callback hostname, development/unset `NODE_ENV`, and no `FLY_APP_NAME`. It is disabled by default and in production/test deployments. Only an explicit field allowlist is logged; no tokens, Client Secret, raw accounting payloads, customer information or company identities are logged. Remove the flag after inspection.

## 6. Stored identifier

`config.taxMappings.taxable` stores the selected **TaxCode.Id**. `config.taxRateIds.taxable` remains supporting rate metadata; it is not substituted for the tax-code reference. Selection persistence across reload is covered in the browser and service tests. The existing real connection/configuration was not modified during this investigation.

## 7. Invoice payload and remaining real AU test

The unchanged invoice payload sends:

```text
GlobalTaxCalculation = TaxExcluded
Line[].SalesItemLineDetail.TaxCodeRef.value = config.taxMappings.taxable
```

QuickBooks calculates GST; ELSET retains its exact-cent response checks. No TaxRate ID is sent in that TaxCodeRef, no US tax code is offered as AU GST, and no invoice was sent to the wrong-country Sandbox.

**The real $1,000 + $100 GST = $1,100 acceptance test remains pending an Australian/AUD Sandbox connection.** The available real company cannot satisfy that test. After connecting the correct Sandbox, reload Configure, verify `AU`/`AUD`, enabled GST and the actual 10% sales code; select/save it, refresh to verify persistence, and run the existing [Sandbox invoice test](quickbooks-v3-setup.md#5-required-australian-sandbox-acceptance-test). Do not create a fake 10% code in the US company to work around the country check.

## 8. Files changed for this follow-up

- `server-accounting-providers/quickbooks.js`: observed sales-tax preference, configuration issues and opt-in safe diagnostics.
- `server-accounting-service.js`: optional provider configuration issue in returned options.
- `src/components/settings/AccountingSettings.jsx`: country/tax explanation, useful empty/disabled states, blocked save and TaxCode wording.
- `tests/helpers/quickbooks-mock.js`: explicit sales-tax preference in the synthetic AU fixture.
- `tests/fixtures/quickbooks-tax-sandbox-us.json`: sanitized real response, preserving actual tax IDs/names/shapes.
- `tests/fixtures/quickbooks-server.mjs`, `tests/quickbooks-accounting.test.js`, `tests/e2e/quickbooks-integration.spec.mjs`: real-response regression, AU synthetic positive/negative cases, diagnostics isolation and UI/persistence checks.
- `docs/quickbooks-v3-setup.md` and this report.

The wider V3 changes were already present and remain uncommitted. No schema migration or invoice-calculation change was added for this fix.

## 9. Verification

- `node --test tests/quickbooks-accounting.test.js`: **26 passed**.
- `npm test`: **499 passed**, zero failures/skips.
- `npm run lint`: passed.
- `npm run build`: passed with the existing large-chunk advisory.
- Accounting browser regression: **51 passed** (23 QuickBooks, 28 Xero), using `npx playwright test tests/e2e/quickbooks-integration.spec.mjs tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1`.
- Final UI checks after displaying fresh company metadata and clearing unavailable selector values: **4 passed**, covering both tax-warning viewports, QuickBooks selection persistence/invoice flow, and Xero configuration/invoice flow (`-g 'tax configuration|QuickBooks consent|enable, mocked consent'` with the same Playwright config).
- `git diff --check`: passed.

Visually inspected the new country-mismatch, GST-disabled and missing-code states at mobile/desktop sizes. Logs: `output/quickbooks-tax-*.log`; screenshots: `test-results/quickbooks-v3/quickbooks-tax-*.png`.

AU positive-path tests remain explicitly synthetic; they are not described as captured AU Sandbox data. Live checks in this follow-up were confined to the existing Sandbox's tax/company preferences and proved the US/USD mismatch. Nothing committed, pushed or deployed.
