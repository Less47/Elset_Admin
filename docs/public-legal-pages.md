# Public ELSET legal pages

Implemented locally on 21 September 2026. Not committed, pushed or deployed.

## Routes and authentication

- `/legal/terms` — **ELSET Terms of Service and Software Licence**
- `/legal/privacy` — **ELSET Privacy Policy**

The intended production URLs are `https://admin.elset.com.au/legal/terms` and `https://admin.elset.com.au/legal/privacy`. They will be available there only after an authorised deployment. Production availability and Intuit acceptance have not been verified.

`AppEntry` selects these two public documents before loading `App` or mounting its session and workspace hooks. A trailing slash is supported; query strings and fragment links do not affect selection. All other paths retain the existing application authentication flow. The server's existing static SPA fallback serves these URLs without authentication; no backend route or middleware was changed. As with the existing app, rendering requires JavaScript.

The legal pages use static content, the public ELSET logo and the built-in ELSET palette. They do not read account preferences or workspace data and make no API requests. Small Terms and Privacy links appear beneath the login form. The authenticated operational screens are unchanged.

## Files changed

| File | Purpose |
| --- | --- |
| `src/main.jsx` | Mount the entry component. |
| `src/AppEntry.jsx` | Select the two public legal routes; lazily load the existing app elsewhere. |
| `src/components/legal/PublicLegalPage.jsx` | Shared responsive legal layout, document title, contents links, dates and contact block. |
| `src/lib/legal-documents.js` | Both document drafts and shared business/contact details. |
| `src/components/auth/LoginScreen.jsx` | Public Terms and Privacy links. |
| `tests/e2e/public-legal-pages.spec.mjs` | Public access, responsive layout and authentication regression tests. |
| `docs/public-legal-pages.md` | This implementation and verification report. |

No database schema, accounting behaviour or authentication implementation was changed. Tests use synthetic data and disposable databases, with authentication seeded in an isolated child process. The pre-existing `output/webhook-lease-repair/` directory was left untouched.

## Business details and publication review

Both pages use the business details supplied by the owner, held in `src/lib/legal-documents.js`:

- Business name: ELSET; trading name: ELSET AUTOMATION; structure: Pty Ltd.
- ABN: 93 686 524 621; ACN: 686 652 621 (transcribed as supplied).
- Business address: 7 Mohr St, Tullamarine, VIC 3043.
- Phone: 0422 662 095; website: elset.com.au.
- Business and privacy enquiries: ELSET administration, admin@elset.com.au.

All business/contact placeholders and the pending-details notice have been removed. Bank details and personal director identifiers are not part of these public legal pages. Confirm the effective and last-updated dates, currently **21 September 2026**; update the visible dates and matching `<time>` attributes together if changed.

These are drafts for business and Australian legal review, not confirmation of legal compliance or Intuit approval. Confirm they accurately describe actual subscription arrangements, support/request handling, retention and backups, service providers and overseas processing before publication. No fixed retention period, hosting country, certification, uptime guarantee or legal-compliance certification has been invented.

The terms preserve non-excludable consumer rights and use a qualified, mutual limitation of liability. The ACCC explains that contractual statements cannot remove applicable consumer guarantees: [Consumer rights and guarantees](https://www.accc.gov.au/consumers/buying-products-and-services/consumer-rights-and-guarantees). The privacy draft describes information, purposes, disclosures and request handling using the OAIC's policy guidance as a drafting reference, without asserting that ELSET has a particular statutory status or satisfies every legal requirement: [Guide to developing an APP privacy policy](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/more-guidance/guide-to-developing-an-app-privacy-policy).

## Verification

After replacing the business details, the nine legal-page browser tests, lint, build and whitespace check were rerun successfully. The 531-test unit result below is from the initial implementation; the unit suite was not repeated for this contact-text update.

- `npm test` — **531 passed**, zero failures.
- `npx playwright test tests/e2e/public-legal-pages.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json` — **9 passed**.
- `npm run lint` — passed.
- `npm run build` — passed; Vite reports a large application chunk warning (over 500 kB).
- `git diff --check` — passed.

Browser tests serve the built frontend through the real Express server with temporary authentication and workspace databases. They verify HTTP 200 and expected headings while logged out, document titles, no legal-page API calls, no private customer content or application shell, no session cookies created, direct/reloaded/trailing-slash routes, and navigation with API access blocked. Protected pages continue to show login and private APIs return 401. The tests also exercise invalid credentials, valid login, authenticated visits to both legal pages, session restoration after returning/reloading, and sign-out.

Both legal pages were checked at **320, 390 and 1440 px** with no horizontal overflow. Desktop/mobile screenshots of headings, contents links and the contact blocks, plus the login links, were visually inspected. Screenshot evidence is under `test-results/playwright/public-legal-pages-*`; unit output is in `test-results/legal-unit-tests.log`. These generated test artifacts are ignored by Git.

The first verification pass exposed a Fast Refresh lint constraint on a lazy component declared in `main.jsx`, resolved by moving routing into `AppEntry.jsx`. One initial API assertion targeted a nonexistent customer-list GET endpoint; it was corrected to the existing protected customer account-summary endpoint. The final lint and all nine browser tests pass.
