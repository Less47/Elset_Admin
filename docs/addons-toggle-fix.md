# Add-ons toggle audit and fix

## Why the switch showed not-allowed

The switch is a native `button` with `role="switch"` in `src/components/settings/AddonsSettings.jsx`. There is no shared Switch component involved. Its original condition was:

```jsx
disabled={!available || loading || saving || Boolean(error)}
```

Two distinct causes were confirmed:

1. **The running local workspace uses legacy JSON storage.** A read-only request to `http://localhost:3101/api/health` returned `ok: true`, `storage.mode: "json"`, `sqliteExists: false`, and `jsonExists: true`. `SettingsManager` passes `available={isSqliteBackupMode}`, so `!available` is true in this workspace. This is a real current dependency: both add-on writes and Job Costing endpoints require SQLite and reject JSON mode with HTTP 409. No connected browser session was available; the observed runtime is the local server, not a verified production session.
2. **A failed request also disabled the switch after the request ended.** `useWorkspaceAddons` correctly clears loading/saving after errors and retains the prior state, but the UI's `Boolean(error)` kept the HTML control disabled. An isolated browser test reproduced this before the fix: after a failed PATCH, `toBeEnabled()` failed because the button still had `disabled`.

The `disabled:cursor-not-allowed` and `disabled:opacity-50` classes then displayed the restricted cursor and dimmed control. The inner decorative track's `pointer-events-none` is correct: clicks go to the button. The shared Button component's `disabled:pointer-events-none` is not used by this native switch. The registry's `defaultEnabled: false` sets the unchecked value; it does not disable interaction.

## Fix

The new condition is:

```jsx
disabled={!available || loading || saving}
```

- Errors remain visible, with the existing Retry action, but no longer prevent another toggle attempt.
- Interactive switches explicitly use `cursor-pointer`; genuinely disabled switches retain `disabled:cursor-not-allowed`.
- Initial load success or failure restores interaction in supported workspaces. A pending initial load remains disabled.
- Pending saves remain disabled, retain the last saved value, and show existing saving feedback. Success uses the server response. Failure preserves the previous value and permits an immediate retry.
- Legacy JSON mode now displays: **"Add-ons require SQLite workspace storage. This workspace is using legacy JSON storage."** The switch's accessible description includes this reason.

The current local JSON workspace remains restricted for this dependency. No database migration, storage-mode change, persistence redesign, Job Costing behavior change, or page redesign was made.

## Permissions and state

The existing mapping is correct: `useAppSession.canManageBusiness` permits `admin` and `office`; `WorkspaceShell` passes this as `canManageWorkspaceSettings`. Technicians do not see the Add-ons section. The PATCH endpoint independently requires admin/office and returns HTTP 403 for technicians. No new permission was introduced.

The workspace storage mode comes from `/api/app-state` during session restoration. Add-on values come from `/api/settings/addons`; they remain shared server settings, separate from personal preferences. Loading/saving cleanup and server persistence required no changes.

## Files changed for this fix

- `src/components/settings/AddonsSettings.jsx`: disabled condition, cursor, clear storage requirement and accessible description.
- `tests/e2e/job-costing.spec.mjs`: strengthen failed-save recovery and add six loading, saving, role, persistence, failed-disable and dependency tests.
- `docs/addons-toggle-fix.md`: this report.

Earlier uncommitted Add-ons/Costing and Calendar work is preserved. No commit, push or deployment was performed.

## Verification

All mutation checks use isolated synthetic workspace/auth databases. The running local workspace was only queried through its health endpoint.

- Before-fix regression: failed as expected after a simulated HTTP 503 save, with the switch still disabled. Evidence: `test-results/addons-toggle-baseline-e2e.log`.
- Full Add-ons/Costing browser suite: **29 passed, 0 failed** (1.1 minutes), including the existing six-theme/three-viewport Costing regression.
- Browser checks cover admin and office ON/OFF, real server values, refresh persistence, another authenticated session, delayed initial loads and saves, pointer/not-allowed CSS, successful and failed load recovery, failed enable/disable state preservation and immediate retry, technician UI/API denial, and the visible/accessibly associated JSON storage explanation. The JSON explanation test simulates the app-state storage-mode response; the actual local JSON mode was separately verified through health.
- `npm test`: 421 passed, 0 failed. Evidence: `test-results/addons-toggle-unit.log`.
- `npm run lint`: passed. Evidence: `test-results/addons-toggle-lint.log`.
- `npm run build`: passed with the existing bundle-size advisory. Evidence: `test-results/addons-toggle-build.log`.
- `git diff --check` and whitespace checks of the three untracked files changed by this fix: passed.

Browser command: `npx playwright test tests/e2e/job-costing.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1 --reporter=list`. Evidence: `test-results/addons-toggle-e2e.log`.
