# QuickBooks V3 connected-company diagnosis

Observed 18 September 2026 at 04:13:40 UTC (14:13:40 Sydney time).

## Finding

The connected QuickBooks Sandbox API itself returned **US / USD**. Passing those responses through ELSET's existing provider produced the same values and the reported UI message. There is no AU/AUD-to-US/USD parsing error in this observed connection.

The selected realm matches ELSET's saved OAuth-authorised realm. Comparison with the user's intended Australian Sandbox remains pending its Company ID and name from Intuit Developer. A US-named API response alone does not prove what the user selected or saw in the Developer portal.

## Observed metadata

| Field | Observed value |
| --- | --- |
| Integration status | `CONNECTED` |
| Selected realm / Company ID | `9341457939429388` |
| Saved OAuth-authorised realm | `9341457939429388` |
| `CompanyInfo.CompanyName` | `Sandbox Company US 04a6` |
| `CompanyInfo.Country` | `US` |
| `Preferences.CurrencyPrefs.HomeCurrency.value` | `USD` |
| `Preferences.CurrencyPrefs.MultiCurrencyEnabled` | `false` |
| `Preferences.TaxPrefs.UsingSalesTax` | `true` |
| Saved integration `provider_environment` | `sandbox` |
| API host used for these reads | `sandbox-quickbooks.api.intuit.com` |

The other allowlisted tax preference fields inspected (`PartnerTaxEnabled`, `HideTaxManagement`, `PaySalesTax`) were absent. No missing field was interpreted as AU, US, AUD or USD. `CompanyInfo.Id` was `1`; that is the CompanyInfo record ID, not the realm ID.

The saved OAuth organisation snapshot also contains the same company name, country and currency. The stored initial connection timestamp is `2026-09-18T03:35:31.576Z`; this timestamp is preserved across reconnects and is not independent evidence of the latest consent time.

### Environment qualification

`QuickBooksAccountingProvider` reads `env.QUICKBOOKS_ENVIRONMENT` directly (`server-accounting-providers/quickbooks.js:29`), with no Sandbox or production default. OAuth stores that configured value in `provider_environment` (`server-accounting-service.js:118`). The saved value is **sandbox**, and the diagnostic successfully read that realm on the Sandbox API host.

The separate diagnostic shell has `QUICKBOOKS_ENVIRONMENT` unset. No `.env` file exists, and `.env.local` does not set that variable. The running server process's current environment was not independently inspected; the shell's unset value must not be reported as the running server's configuration. `server-app.js:61-64` loads `.env`.

## Exact UI trace

1. `server-accounting-providers/quickbooks.js:117-126` reads CompanyInfo under `context.tenantId`, assigns `CompanyInfo.Country` directly to `organisation.country`, and assigns `Preferences.CurrencyPrefs.HomeCurrency.value` to `organisation.currency`. The `ref` helper at line 13 unwraps `.value`, falling back to an empty string; missing country/currency causes a review error. There is no US/USD default.
2. `server-accounting-service.js:147-151` verifies the selected realm against the OAuth-authorised realm, fetches fresh organisation metadata and calls `configurationIssue()`.
3. `server-accounting-providers/quickbooks.js:168-169` checks whether the returned country is `AU` or `Australia`. For this response it constructs `This QuickBooks company uses ${company.country} tax settings and ${company.currency}. ...`. Therefore **"US tax settings" comes directly from `CompanyInfo.Country = "US"`** and **"USD" comes directly from `Preferences.CurrencyPrefs.HomeCurrency.value = "USD"`**. The wording "tax settings" is ELSET's text around the country value, not a separate tax-preference field returned by Intuit.
4. `src/components/settings/AccountingSettings.jsx:76` renders `options.configurationIssue.message` unchanged.

## OAuth realm comparison

The callback passes its `realmId` to `getOrganisations()` (`server-accounting-service.js:111`). The provider uses it as `context.tenantId`, verifies it via authenticated CompanyInfo/Preferences reads and returns it as the organisation ID (`server-accounting-providers/quickbooks.js:116-132`). The service saves that organisation and copies its ID/name into the selected integration (`server-accounting-service.js:118-130`).

Both the saved authorisation and selected integration identify `9341457939429388`. No selected-versus-authorised realm discrepancy was observed. ELSET does not retain a screenshot or independent record of the company-selection screen shown during OAuth.

To finish the intended-company comparison, open Intuit Developer, choose **My Hub > Sandboxes**, and inspect the existing Australian company's name, Company ID and region. Intuit documents this route to the Sandbox list in its [support guidance](https://quickbooks.intuit.com/learn-support/en-us/taxes/re-how-do-i-turn-off-sales-tax/01/1531335/highlight/true).

- If that Australian company's ID differs from `9341457939429388`, ELSET is connected to a different realm than the intended Sandbox.
- If its ID is the same and the portal shows Australia, the portal and authenticated API metadata disagree for the same realm. That would require investigation with Intuit; changing ELSET's country/currency parsing would not correct the returned metadata.

## Verification and scope

Two authenticated GET requests were made using the existing valid access token, without token refresh or database writes:

```text
GET https://sandbox-quickbooks.api.intuit.com/v3/company/9341457939429388/companyinfo/9341457939429388?minorversion=75
GET https://sandbox-quickbooks.api.intuit.com/v3/company/9341457939429388/preferences?minorversion=75
```

The actual returned responses were passed through the existing `getOrganisation()` and `configurationIssue()` methods in a one-off local diagnostic. The parsed country/currency were `US`/`USD`; the generated message exactly matched the reported UI text. Only allowlisted company metadata, currency/tax preferences and realm comparison were emitted to the ignored local file `output/quickbooks-realm-diagnosis.log`. Access tokens, refresh tokens, Client Secret and customer private data were not logged.

This diagnosis adds this report only. No application code, tax mapping, invoice tax behaviour or connection was changed. No Sandbox was created. No commit, push or deployment was performed. Application tests were not rerun for this documentation-only diagnosis; verification consisted of the live API reads, actual parser comparison and source trace above.
