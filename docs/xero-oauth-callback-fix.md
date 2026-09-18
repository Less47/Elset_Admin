# Xero OAuth callback authentication fix

Implemented and verified locally on 18 September 2026. No commit, push, deployment, production configuration, real Xero consent or production accounting access was performed.

## 1. Exact rejection point

`server-accounting-routes.js` previously registered the callback as:

```js
router.get(`${route}/callback`, auth, manage, handle(...));
```

`server-app.js` supplies `requireAuth`. Its `if (!authSession?.user)` branch returns HTTP 401 with **`{"error":"Authentication required."}`** (currently line 184). This happens before the accounting callback handler, OAuth state validation, code exchange, redirect and callback security headers. No extra global authentication middleware intercepts the route. The handler did not separately call `requireAuthenticatedUser`.

The second dependency was in `AccountingService.callback`: consuming state also required the user ID and session hash taken from that returning browser session. Removing only the route middleware would therefore still fail state validation.

## 2. Production versus localhost

The reported production response establishes that the normal Better Auth session lookup returned no usable user at callback time. The local browser fixtures retain their authenticated local session, so the old route passed there. Production crosses back from Xero to the HTTPS callback, where coupling callback acceptance to that normal session lookup makes a missing/unusable cookie fatal before OAuth state is checked.

The exact production cookie/session trigger is **not proven** from the available code and reported response. No production browser cookies, authentication database, deployment environment values or sensitive callback URLs were collected. `getRequestAuthSession` also converts Better Auth lookup errors to a missing-session result, so the 401 alone cannot distinguish omitted cookie, expired/revoked session, cookie/host mismatch or session-verification failure. The fix addresses the confirmed architectural dependency without guessing at or changing global cookie settings.

## 3. Cookie audit

`server-auth.js` does not override cookie attributes or session lifetime. The installed Better Auth version is **1.6.16**. Its checked local source (`dist/cookies/index.mjs` and `dist/context/create-context.mjs`) supplies:

| Attribute | Configured/default behavior |
| --- | --- |
| SameSite | `Lax` |
| HttpOnly | `true` |
| Secure/name | `Secure` and `__Secure-` prefix when the resolved auth base URL is HTTPS; ordinary HTTP localhost does not use them. |
| Domain | Omitted: host-only; cross-subdomain cookies are not enabled. |
| Path | `/` |
| Session lifetime | Seven days by default, refreshed after the default one-day update interval; non-remembered browser cookies may be session cookies. |

The auth base URL comes from `BETTER_AUTH_URL`, otherwise the Fly HTTPS app URL, otherwise local HTTP. The checked-in Fly configuration enables HTTPS. The deployed values and an actual production Set-Cookie header were not inspected.

`SameSite=Lax` permits a normal top-level cross-site GET navigation; Xero's authorization return is a GET. The audit therefore does **not** establish that SameSite itself caused this incident. No SameSite=None change, cross-domain cookie sharing, secure-cookie override or CSRF bypass was introduced. See [Better Auth cookie documentation](https://better-auth.com/docs/concepts/cookies) and [Xero authorization flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow).

## 4. State validation before and after

Before: a random 32-byte state was hashed and stored with workspace, provider, initiating user, initiating session hash and ten-minute expiry. Callback deletion required an authenticated returning browser to supply that same user/session.

After: the state record itself supplies the trusted initiating identity. The callback:

1. Requires the `accounting-connect-v1.` purpose/version prefix followed by the full random 32-byte base64url nonce. The prefix and nonce are hashed together in the existing `state_hash`; changing purpose cannot reuse the stored authorization. Connect and Update Permissions intentionally use the same accounting-authorization purpose.
2. Looks up the hash only in the server-resolved workspace and requested registered provider, with unexpired server-side state. User/workspace/redirect/purpose query parameters supply no authority.
3. If a returning browser session can be authenticated, requires its user and session to match the stored initiator. A missing normal auth cookie is allowed.
4. Atomically deletes/returns the matching state once. Unknown, expired, replayed, wrong-provider, wrong-purpose and legacy-purpose states never reach code exchange.
5. Rechecks the stored initiating user against the server auth database: current admin/office role, no active ban, and the original session still present and unexpired with the matching hash. A missing authorizer fails closed. This validation does not need the browser to resend its cookie; logout/revocation, demotion, banning or expiry still invalidates consent.
6. Rejects missing/malformed code and OAuth cancellation/errors before exchange. Only validated consent enters the existing locked, encrypted credential flow.

Invalid public callbacks do not alter connection health or integration data. Consumed consent is never retried as a bearer credential: failure after consumption requires starting Connect/Update Permissions again. No schema migration was needed; schema remains **10**. Pre-fix in-flight nonces have no purpose prefix and must be restarted after an approved release (their existing lifetime was ten minutes).

## 5. Route authentication after the fix

Only GET `/api/integrations/:provider/callback` bypasses ordinary `requireAuth`/`requireRole`. It still authenticates the stored OAuth authorization and checks the initiator's current backend permission/session. Provider registration continues to allow only implemented providers.

Connect, settings, invoice operations, payment sync and every ordinary API keep their existing authentication, role and mutation-origin protections. The signature-authenticated Xero webhook remains separate and unchanged. The callback does not establish or return a login session for the arriving browser.

## 6. Redirect and information handling

Success returns **302**, empty body, and the configured frontend's fixed `/settings?accounting=xero&result=connected` route. Cancellation uses `result=cancelled`; other safe failures use `result=failed`. Both Connect and Update Permissions return to the existing Xero settings section. If that subsequent normal page lacks a usable login session, normal sign-in is still required.

All callback outcomes set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. No HTML is rendered, no auth cookie is set, and no code, token, client secret, state or raw provider error is copied into the response body or redirect. Redirect destinations never come from callback query parameters.

## 7. Safeguards and preservation

Retained 256-bit random entropy, hashed server state, ten-minute expiry, atomic single use, provider/workspace isolation, optional matching browser-session binding, current initiating permission/session checks, encrypted tokens with workspace/provider/kind AAD, secure OAuth code exchange and workspace refresh locking.

Update Permissions preserves the integration ID, original connection attribution/timestamp, tenant/connection identity, Contact/invoice mappings, account/tax configuration, created-at and last-success metadata. Credentials and granted scopes update normally; no second integration row is created. Additional authorised organisations do not replace an existing still-authorised tenant.

## 8. Files changed

- `server-accounting-routes.js`: state-authenticated callback, optional browser identity, empty 302 redirects.
- `server-accounting-service.js`: purpose-bound state, trusted initiator lookup/atomic consumption, backend-authorizer requirement, original connection metadata preservation.
- `server-auth.js`: read-only validation of stored initiating role, ban and active session.
- `server-app.js`: supplies the optional session lookup and backend authorizer to accounting routes.
- `tests/xero-accounting.test.js`: public callback, state/security, concurrent replay, response hygiene and permission-upgrade preservation coverage; explicit synthetic authorizer in the unit fixture.
- `tests/xero-payments.test.js`: explicit synthetic authorizer in its existing isolated fixture.
- `tests/e2e/xero-integration.spec.mjs`: 302 expectation, real local app callbacks without browser cookies, returning Settings UX, permissions/configuration preservation, and backend permission/session rejection cases.
- This report and pointers/updated callback instructions in `docs/xero-v1-setup.md`, `docs/xero-v2-setup.md` and `docs/xero-v2-report.md`.

Pre-existing Customer missing-email edits, test harness files and the unrelated untracked file were left untouched.

## 9. Tests and results

- `npm test`: **476 passed, 0 failed**, including all V1/V2 payment and webhook tests.
- `npm run lint`: passed.
- `npm run build`: passed, with the existing Vite >500 KB chunk warning.
- `npx playwright test tests/e2e/xero-integration.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1`: **30 passed**. Includes the actual server callback without a cookie, Connect, additional payment consent, existing localhost cookie flow, safe cancellation, ordinary API restrictions, independent webhook, and responsive/theme regressions.
- `git diff --check`: passed. The final targeted accounting rerun also passed **24/24** after tightening malformed-code test coverage.

The new HTTP test uses production HTTPS redirect/frontend configuration with mocked Xero and explicitly asserts no generic auth middleware executes on callback, safe 302 Location, no-store/no-referrer, no cookies, empty body and protected ordinary endpoints. The browser tests exercise the real local app/auth database while omitting the callback cookie and retaining the user's session for the following Settings navigation. Actual auth-database expiry, revocation, demotion and bans are tested against disposable fixtures.

Logs: `output/xero-oauth-unit.log`, `output/xero-oauth-lint.log`, `output/xero-oauth-build.log`, `output/xero-oauth-browser.log`. They contain local synthetic test results, not production evidence. Live production OAuth validation remains for a separately approved deployment; it was not performed here.
