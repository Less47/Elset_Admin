# Service Board controls and Completed pagination

Implemented locally on top of `1d36e72`. Changes remain uncommitted. No push or deployment was performed.

1. **Previous Recent source.** The shared `sortJobsForColumn` comparator used `updatedAt` descending, then job number descending. Desktop/tablet and mobile used this comparator and rendered every matching Completed job.

2. **Creation source now used.** Recent uses `job.createdAt` descending, mapped from `jobs.created_at` in `server-workspace-state.js:305`, with job number descending for ties. Oldest already used creation time ascending and is unchanged. Urgency, Customer, Scheduled and Highest Value retain their existing comparisons and tie-breaks. There is no fallback to activity time. Missing or invalid legacy creation dates use the existing timestamp-zero conversion and job-number tie-break. Existing backend creation-date normalization is unchanged.

3. **Completed pagination.** Both board layouts use the shared `useCompletedJobLimit` hook and `CompletedShowMore` component. Existing search and urgency filtering runs first, then column status filtering and the selected sort, then a client-side slice. Only 25 Completed cards render initially. The count shows the full matching total. To Do, In Progress and Tomorrow remain uncapped. No new API or database query was introduced.

4. **Show more batches.** The button adds 25 visible jobs per activation: 25, 50, 75, 100, 125, 150, 175 in the test fixture. Its label reports the next actual batch, such as `Show 20 more` for a partial final batch. It disappears once every matching job is visible. It uses the existing themed Button with a descriptive accessible label and keyboard activation.

5. **Reset behavior.** Search, High urgency only, or Completed sort changes reset the visible limit to 25. Job activity/status updates, other columns' sort choices, and List/Grid/Compact changes do not reset an expanded limit. Pagination state is local to the mounted board and is not saved as a user preference.

6. **Hide removal.** Removed Hide buttons, Show Columns toolbar control, hidden-status state, handlers, visibility calculations, related conditional layout classes and unused icons. Removed `boardHiddenColumns` from the personal preference defaults and allowlist. Previously stored values are ignored on read and removed from stored JSON on the next normal preference save. No schema migration or bulk data mutation was needed. The only remaining references document or test retirement of the preference.

7. **Column fullscreen removal.** Removed per-column expand/collapse buttons, `focusedColumnStatus`, its handlers and focused-column/autofill layout branches. This state was not persisted. The main page-level Full Screen control remains functional.

8. **Header layout.** Title and total count sit together on the left, with the count pill beside the title; sort and List/Grid/Compact controls align to the upper right and wrap when needed. The existing three-column board breakpoint remains 768px; phones retain one status at a time. Labels/tooltips remain available, existing touch-target rules are preserved, and the updated controls use theme tokens.

9. **Files changed.** Thirteen implementation files (seven runtime, five test and one documentation file), plus this generated report:

| File | Change |
| --- | --- |
| [WorkspaceShell.jsx](../src/components/app/WorkspaceShell.jsx) | Remove visibility preferences/handlers; pass reset criteria to the board |
| [OfficeBoard.jsx](../src/components/service-board/OfficeBoard.jsx) | Remove column hide/expand; compact headers; limit Completed rendering |
| [MobileServiceBoard.jsx](../src/components/service-board/MobileServiceBoard.jsx) | Apply Completed batching to the one-status mobile board |
| [service-board-utils.js](../src/components/service-board/service-board-utils.js) | Recent uses creation time; relative import supports direct unit tests |
| [useCompletedJobLimit.js](../src/components/service-board/useCompletedJobLimit.js) | New shared batch/reset hook |
| [CompletedShowMore.jsx](../src/components/service-board/CompletedShowMore.jsx) | New shared themed, accessible button |
| [user-ui-preferences.js](../src/lib/user-ui-preferences.js) | Retire hidden-column preference |
| [service-board-sort.test.js](../tests/service-board-sort.test.js) | Four focused sorting tests |
| [user-ui-preferences.test.js](../tests/user-ui-preferences.test.js) | Test retired preference rejection and safe cleanup |
| [service-board-controls.spec.mjs](../tests/e2e/service-board-controls.spec.mjs) | Eighteen focused browser tests |
| [mobile-navigation-service-board.spec.mjs](../tests/e2e/mobile-navigation-service-board.spec.mjs) | Replace obsolete column-expansion assertions |
| [theme-settings.spec.mjs](../tests/e2e/theme-settings.spec.mjs) | Remove obsolete hidden-column workflow; retain account isolation assertions |
| [user-ui-preferences.md](../docs/user-ui-preferences.md) | Document the 22-field schema and retired visibility preference |
| [service-board-controls-report.md](service-board-controls-report.md) | This generated implementation and verification report |

Final diff audit found no changes to status/drag/drop business handlers, card content, Job Details, customer/site data, invoices, maintenance, calendar, tag meanings, permissions, authentication code or database schema. Browser scenarios ran against isolated temporary workspaces and authentication databases.

10. **Tests added.** The new unit tests cover Recent/Oldest, creation-date ties and missing dates, activity independence, input immutability and unchanged other sort semantics. The new browser suite covers all requested A-K cases: 175 total/25 visible, full batching, eight-result search, partial batches, filter/sort resets, activity and completion of old jobs, removed controls, mobile batching and tablet three-column behavior. It also checks all six themes, page fullscreen, Tomorrow, account preference retirement, and that viewing/paging does not write business records.

11. **Observed results and exact commands.** All checks passed:

| Check | Result | Log |
| --- | --- | --- |
| `npm test` | 303 passed, 0 failed | [Unit log](service-board-unit.log) |
| `npm run lint` | Passed | [Lint log](service-board-lint.log) |
| `npm run build` | Passed; existing Vite chunk-size advisory remains | [Build log](service-board-build.log) |
| Focused Playwright suite below | 18 passed | [Browser log](service-board-browser.log) |
| Existing regressions below | 8 passed | [Regression log](service-board-regressions.log) |
| `git -c core.safecrlf=false diff --check` | Passed | Final diff audit |

Commands were run from the repository in PowerShell, with Node and Git prepended to PATH where needed:

```powershell
$env:PATH = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;' + $env:PATH
npm test
npm run lint
npm run build
npx playwright test tests/e2e/service-board-controls.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1
npx playwright test tests/e2e/mobile-navigation-service-board.spec.mjs tests/e2e/theme-settings.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1 --grep 'mobile navigation and one-status Service Board support|mobile and tablet viewport matrix keeps|mobile navigation and actions retain|desktop view retains three columns|tablet three-column board keeps|Service Board cards respect|visual density preserves|Customer, Site and Service Board display choices follow only their account'
git -c core.safecrlf=false diff --check
```

The eight existing regression cases cover mobile workflow/status sheets, viewport filtering/overflow, admin/office/technician permissions, native desktop drag/drop, tablet touch drag, Tomorrow, card gutters, density/focus/touch targets and account-specific view/sort preferences. Initial browser failures were corrected test-fixture/selector issues; no business logic changes were made to satisfy them.

12. **Screenshots captured.** Thirty-six task screenshots are in [test-results/service-board-controls](../test-results/service-board-controls). Initial board and Show more screenshots were captured at each requested viewport. Geometry assertions passed with no horizontal page overflow.

| Viewport | Initial board | Show more |
| --- | --- | --- |
| 1920x1080 | [Initial](../test-results/service-board-controls/initial-1920x1080.png) | [Button](../test-results/service-board-controls/show-more-1920x1080.png) |
| 1440x900 | [Initial](../test-results/service-board-controls/initial-1440x900.png) | [Button](../test-results/service-board-controls/show-more-1440x900.png) |
| 1280x720 | [Initial](../test-results/service-board-controls/initial-1280x720.png) | [Button](../test-results/service-board-controls/show-more-1280x720.png) |
| 1024x768 | [Initial](../test-results/service-board-controls/initial-1024x768.png) | [Button](../test-results/service-board-controls/show-more-1024x768.png) |
| 820x1180 | [Initial](../test-results/service-board-controls/initial-820x1180.png) | [Button](../test-results/service-board-controls/show-more-820x1180.png) |
| 390x844 | [Initial](../test-results/service-board-controls/initial-390x844.png) | [Button](../test-results/service-board-controls/show-more-390x844.png) |

All six themes also have initial and button screenshots at 1440x900 and 390x844. Filenames use `theme-{id}-{width}.png` and `theme-more-{id}-{width}.png`, where IDs are `elset`, `copper-dawn`, `evergreen-ledger`, `midnight-signal`, `studio-rose`, and `desert-circuit`. Representative screenshots from every theme were visually inspected, including [Midnight Signal desktop](../test-results/service-board-controls/theme-midnight-signal-1440.png) and [mobile Show more](../test-results/service-board-controls/theme-more-midnight-signal-390.png). These are automated browser screenshots with visual review.

Follow-up: the count pill was moved beside each column title. The sort trigger can shrink slightly to keep it beside the title/count on narrow columns. Build, lint, diff checks and the six viewport tests passed again; the twelve viewport screenshots above were refreshed. The twenty-four theme screenshots retain the preceding layout with the count below the title. The focused follow-up command was the same Playwright command above with `--grep 'Service Board controls and initial 25'`; results are in [the header layout log](service-board-header-layout.log).
