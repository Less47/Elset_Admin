# Settings explicit Save and unsaved changes

Local implementation report, 24 September 2026.

Ordinary Settings edits now remain in a local draft until **Save changes**. The compact action is at the top right of the current section. It is disabled when clean, disabled as **Saving...** during requests, and enabled for retry after a failure. Successful saves retain the form and establish its new baseline.

## Converted sections and previous behaviour

| Section | Previously | Now |
| --- | --- | --- |
| Preferences: company, bank and email | Debounced field writes in SQLite; broad autosave after changing application state in JSON mode | One explicit save submits all changed preference fields |
| Preferences: Workspace Branding | File selection uploaded immediately; confirmed removal deleted immediately | File selection/removal stages a local preview; the section Save applies it |
| Document Templates: quote and invoice | Field changes and Reset immediately persisted | Draft wording and Reset; explicit Save; switching document type is guarded |
| UI Settings: themes, colours, layout, Reset UI | Immediate preview and debounced persistence | Local preview; explicit personal preference save; discard restores saved appearance |
| Add-ons | Toggle/disable confirmation immediately persisted | Switches stage a draft and Save submits the changed add-ons together |
| QuickBooks/Xero configuration | Provider-specific Save, without common dirty or leave protection | Editable account/item and tax mappings participate in the Add-ons section Save |
| Items & Price List | Explicit item save; closing an editor dropped edits silently | Existing Save item command retained; reusable draft tracking and cancel/leave protection added |

Company settings remain shared. Appearance remains personal to the signed-in account. Provider runtime status, loading flags and timestamps are excluded from editable comparisons. Price-list optimistic concurrency timestamps remain request metadata, outside dirty detection.

## Implementation

`createSettingsDraft` owns baseline, draft, structural equality, in-flight state and errors. Object key order does not make a draft dirty. Editing back to baseline makes it clean. A failed save retains both baseline and draft. Edits made during a request remain unsaved after its acknowledgement.

`useSettingsDraft` registers each editable resource with `SettingsDraftScope`. One section Save captures all resources at click time and processes them sequentially. Fields edited after that click require another Save. Resources with separate existing endpoints, such as a logo and company preferences, acknowledge independently; if a later request fails, retry saves only the remaining dirty resources. This is not a cross-endpoint database transaction.

`useSettingsPersistence` calls existing targeted APIs. SQLite preference writes merge only the acknowledged patch into current application state. Template writes merge only the template. Personal saves validate and canonicalize colours through the existing preference schema. The retired Settings autosave hook and old field/template save handlers were removed.

Legacy JSON settings use their existing full-state endpoint, explicitly on Save. Pending broad autosave is cancelled and an older in-flight autosave finishes first. Draft edits never enter shared application state. The browser transport regression uses a stubbed legacy JSON response, including save failure/retry; SQLite and provider regressions use isolated local servers and databases.

## Navigation and unload protection

Settings uses the existing workspace navigation blocker and Radix dialog conventions. Settings sections, template type changes, sidebar navigation, browser Back/Forward, sign-out and state-replacing provider commands use the same guard.

The dialog says:

> Unsaved changes
>
> You have changes that haven't been saved. If you leave this page, those changes will be discarded.

**Stay** keeps the draft and cancels the pending navigation. **Discard changes** restores the saved values and continues the original action. Neither silently saves. Discard is disabled while a save is in flight. Focus stays within the modal; keyboard focus and Stay/Discard are covered by browser tests.

A `beforeunload` listener is installed only while the active editor is dirty or a save is pending. It is removed on save completion with no newer edits, reverting to baseline, explicit discard and unmount. Tests check listener counts, a real browser reload warning, and clean reload after Save. Browsers control the native warning text.

Theme previews use the existing layout-effect palette application. Discard and section cleanup restore the saved theme before the next paint. Logo previews are local to the branding card until Save.

## Commands intentionally kept independent

Connect/reconnect/OAuth, disconnect, organisation/company switch, connection tests, explicit QuickBooks sales-item creation/reuse, import/export, backup/restore, and price-list archive/restore retain explicit command actions. Commands that navigate or replace settings state are guarded when a draft exists. Live connection status remains read-only and does not make a section dirty.

Backup/import options are command arguments, not persisted preferences. Customer/Site/Service Board display controls outside Settings retain their existing personal autosave behaviour.

No accounting provider implementation, sync architecture, reset tooling, production database, Fly configuration or deployment was changed for this task. All accounting browser tests use mocked providers.

## Files changed for this task

New:

- `src/lib/settings-draft.js`
- `src/hooks/useSettingsDraft.js`
- `src/hooks/useSettingsPersistence.js`
- `src/components/settings/settings-draft-context.js`
- `src/components/settings/SettingsDraftScope.jsx`
- `tests/settings-draft.test.js`
- `docs/settings-explicit-save.md`

Updated:

- `src/App.jsx`
- `src/components/app/WorkspaceShell.jsx`
- `src/components/settings/SettingsManager.jsx`
- `src/components/settings/ThemeColourField.jsx`
- `src/components/settings/WorkspaceBranding.jsx`
- `src/components/settings/AddonsSettings.jsx`
- `src/components/settings/AccountingSettings.jsx`
- `src/components/settings/PriceListSettings.jsx`
- `src/components/workspace/RecordWorkspace.jsx`
- `src/hooks/useAppSession.js`
- `src/hooks/useWorkspaceActions.js`
- `src/hooks/useWorkspaceNavigation.js`
- `src/hooks/useWorkspaceAddons.js`
- `src/hooks/useUserUiPreferences.js`
- `src/hooks/user-ui-preferences-store.js`
- `tests/user-ui-preferences-store.test.js`
- `tests/e2e/theme-settings.spec.mjs`
- `tests/e2e/job-costing.spec.mjs`
- `tests/e2e/quickbooks-integration.spec.mjs`
- `tests/e2e/xero-integration.spec.mjs`
- `tests/e2e/document-workspaces.spec.mjs`
- `docs/user-ui-preferences.md`

Removed: `src/hooks/useThemeSettingsSave.js`.

Other uncommitted changes already present in the workspace were preserved.

## Verification

- `npm test`: **668 passed**, zero failures/skips.
- `npm run lint`: passed without warnings.
- `npm run build`: passed; the existing large-bundle advisory remains.
- `git diff --check`: passed.
- **165 distinct browser tests passed across suite runs and focused reruns.** The four complete Settings/add-on/provider suites initially had 157 passes and one test failure; six navigation regressions passed and the additional legacy transport test failed. Both failures were corrected and their focused rerun passed (2/2). The first was a browser cancellation expectation; the second was a noncanonical legacy fixture contact. Existing behavioural assertions were retained.
- Browser command prefix: `npx playwright test --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --reporter=line`.
- Complete suites: `theme-settings.spec.mjs`, `job-costing.spec.mjs`, `quickbooks-integration.spec.mjs`, `xero-integration.spec.mjs`.
- Additional regressions: customer/site dirty forms, customer browser history, document navigation/reload/sign-out, price-list editing/discard, and legacy JSON Settings transport.
- New coverage includes initial clean state, revert-to-clean, zero writes before Save, grouped writes, failed-save retry, edits during requests, click-time capture across resources, partial-resource failure, unload listener lifecycle, native reload warning, tab/sidebar/history guards, theme restoration, provider status/commands, template switching, and per-account isolation.
- Desktop branding/Save placement and mobile colour controls were visually inspected from browser screenshots. Responsive screenshot and overflow checks cover the existing theme/provider matrices.

Detailed local logs: `tmp/settings-explicit-full-unit.log`, `tmp/settings-explicit-browser.log`, `tmp/settings-explicit-navigation.log`, `tmp/settings-explicit-final-browser.log`, `tmp/settings-explicit-lint.log`, `tmp/settings-explicit-build.log`.

No commit, push, deploy, Fly restart or production operation was performed.
