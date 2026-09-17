# Calendar Undo

## Mutation audit (before implementation)

Calendar is a month grid with a mini-calendar, scheduling queue and Day Inspector; there are no separate week/day views. `useCalendarDrag` sends mouse/touch drops to `CalendarManager.saveSchedule`. Day Inspector job drag/drop, queue drag/drop, date forms and Remove scheduled date converge on that handler.

| Calendar action / frontend handler | Existing API | Authoritative changes | Existing optimistic behavior |
| --- | --- | --- | --- |
| Job drop, Schedule/Reschedule form, Remove scheduled date; `saveSchedule` -> `handleScheduleJob` | PATCH `/api/jobs/:id/schedule` | One job's scheduled date and modification timestamp; no status, notes, assignment or documents | Local `pending` projects the new date; failure clears it; success applies server state |
| Day Inspector job drag or date action | Same handler and job endpoint | Same one-job update | Same pending projection |
| Completed maintenance drop/date correction; `proposeCompletedMove`, `commitCompletedMove` | PATCH job schedule with `completedMaintenanceCorrection` and `expectedScheduledDate` | Job date plus linked occurrence override in one transaction; appends correction history; preserves completion and plan recurrence | Confirmation first; pending job/occurrence projection after acceptance; occurrence range refreshed |
| Maintenance drop/date form, This occurrence only; `proposeMaintenanceMove`, `commitMaintenanceMove('occurrence')` -> `handleRescheduleMaintenance` | PATCH `/api/maintenance-plans/:id/occurrences` | One sparse occurrence override, plan revision/derived next-due cache; generated job's independent scheduled date is untouched | Tentative occurrence date while choice/save is pending; range refreshed after save |
| Change maintenance schedule; `commitMaintenanceMove('schedule')` | PATCH `/api/maintenance-plans/:id/schedule` | Cuts over recurrence segments, protects generated/completed facts, removes ungenerated overrides in replaced future segments, updates plan revision/cache | Same tentative occurrence projection and range refresh |
| Reschedule day; `openBulk`, `moveDayJobs` -> `handleRescheduleDayJobs` | GET/POST `/api/jobs/reschedule-day` | Selected active jobs' dates; full-record revision guards skip conflicts, eligible subset commits transactionally | Busy dialog until authoritative response; reconciles affected records. Existing notice Undo lasts 15 seconds, is single-use and discards failures |
| Generate maintenance job; `maintenanceActions.generate` | POST `/api/maintenance-plans/:id/generate-job` | Creates a job, occurrence fact and generation/cache fields | Busy state, followed by authoritative state and range refresh |
| Open Job / Open Plan | Navigation only | Subsequent edits belong to the other workspace | No Calendar scheduling mutation |

Permissions already require admin/office in the Calendar workspace and scheduling APIs. Targeted scheduling APIs require SQLite; Calendar already rejects legacy JSON writes. There is no general job scheduling activity ledger. Maintenance activity is derived from sparse exception snapshots; completed corrections already append history, whereas ordinary occurrence moves previously replaced the displayed move.

## Scope decisions

Version 1 covers job scheduling/removal, all equivalent drag/date controls including Day Inspector, completed maintenance corrections, occurrence-only moves, and successful members of a bulk day move as one history entry.

Change maintenance schedule is excluded: reverting it would need to restore replaced segments and deleted exceptions while accounting for subsequently generated/completed visits. Job generation is excluded because it creates operational records rather than only changing dates. All changes made from other workspaces remain outside Calendar history. Redo and keyboard shortcuts are omitted; native text-field Undo remains untouched.

## History and inverse writes

`CalendarManager` owns an in-memory, newest-first Undo stack capped at **10 successful actions**. It is never written to SQLite, localStorage or account preferences. It clears when Calendar unmounts (including navigation away), on page reload and on logout. No-op saves, cancelled confirmations and failed original requests create no entry. Successful maintenance writes enter history before the follow-up range request, so a failed refresh cannot lose a successfully saved action.

History stores only IDs, a short label, before/after scheduling fields and required scheduling guards. `?response=calendar` asks the existing job/occurrence scheduling endpoints for a minimal change description captured inside the write transaction. The ordinary response contract remains available to other callers. Bulk entries contain only the jobs actually moved, grouped as one action.

`calendar-undo.js` maps each entry back to an explicit scheduling request:

- Job: the same schedule PATCH, setting the original date (including an empty/unscheduled date), conditional on the current date matching `after`.
- Completed maintenance: the same correction PATCH, conditionally restoring both the job date and the linked occurrence's own prior date/override. These can be different for independently scheduled generated jobs.
- Occurrence: the same occurrence PATCH with the original date/override, expected current date and a recurrence/lifecycle token.
- Bulk: the same day POST with reversed dates and one expected-date guard per job. Normal bulk moves retain their existing full-record revision checks; inverse writes check dates so newer unrelated edits do not prevent safe date restoration.

Undo projects the original date immediately, locks scheduling/Undo against duplicate submissions, then applies the authoritative response. It removes the entry only after a successful inverse. A transient failure re-reads server state, clears the optimistic projection, displays an error and retains the entry. If the refresh also fails, the message explicitly says the saved state could not be confirmed. HTTP 404/409 removes the stale entry and displays a conflict message. Only maintenance date ranges are refreshed after successful occurrence/correction writes; successful Undo does not reload the whole page.

## Concurrency, transactions and partial bulk results

Single-job writes compare the expected date inside an immediate SQLite transaction. The payload never carries old status, notes, technician, invoice, quote or customer fields. Completed corrections additionally verify the occurrence identity, current date and requested prior override.

Occurrence inverse guards compare the expected date plus a token of the recurrence and occurrence lifecycle (active plan, linked/generated job and completion). This permits sequential reversals on the same occurrence or different occurrences of the same plan without depending on a stale global plan revision. Unrelated plan-note edits survive. Replaced recurrence, new generation/completion or a changed date blocks the inverse. A still-uncompleted generated visit moved into the past can return through this guarded inverse even though normal historical dragging is locked.

Bulk inverse writes run transactionally. Jobs with changed dates or deleted records are explicitly skipped; the remaining date-only updates commit together. One Undo click consumes that bulk entry, reports the restored count and lists **Jobs not restored**. It never retries stale members automatically. Unexpected database errors roll back all writes and leave the entry retryable.

Changing a maintenance schedule from Calendar invalidates older occurrence-only entries for that plan. It does not create a partial recurrence rollback or clear unrelated job history.

## Completion, recurrence and activity

Completed-maintenance Undo preserves Completed status, `completedAt`, technician completion data, completion history, invoices, quote/payment data, and the exact maintenance-plan row. It appends a reverse scheduling correction using the established correction activity format. It restores the occurrence's original override, including clearing it when the original visit had no override.

Occurrence-only Undo restores or clears the sparse date override using the existing unique occurrence key. It does not create duplicate occurrences, move the independent generated job, change recurrence frequency/segments, or alter other historical/future visits. The existing plan revision and derived next-due cache advance normally. A cleared exception row can remain to preserve its activity facts.

Ordinary occurrence moves and their inverse now append `occurrenceMoves` in the existing snapshot JSON. A captured baseline preserves an older derived move entry. Maintenance Plan activity displays both directions instead of rewriting the original move. This is factual activity history, not a persisted Undo stack. Ordinary jobs/bulk scheduling have no existing general date-change ledger; this feature does not invent one or remove any job notes/history.

## Toolbar and permissions

The permanent outline Undo button sits with Calendar toolbar controls. It uses `Undo2`, an accessible name of **Undo last calendar change**, a short current-action tooltip, existing semantic theme tokens and a native disabled state when history is empty or a scheduling request/confirmation is pending. Phone layouts show the icon; tablet/desktop also show **Undo**. Existing toolbar rows, grid density, mini-calendar and queue layouts remain intact.

Calendar and every inverse endpoint retain the existing admin/office permissions. No general undo endpoint, new permission, database migration or storage architecture change was added. Legacy JSON workspaces retain the existing restriction on Calendar scheduling APIs.

## Files changed

- `src/components/calendar/CalendarManager.jsx`: history, toolbar, pending projections, inverse execution, failure/conflict handling and bulk integration.
- `src/components/calendar/calendar-undo.js`: minimal inverse request/projection helpers and the history limit.
- `src/components/calendar/Calendar.css`: compact responsive Undo button styling.
- `src/components/app/WorkspaceShell.jsx`: passes the inverse action into Calendar.
- `src/hooks/useWorkspaceActions.js`: authoritative change receipts, targeted inverse requests and failure reconciliation.
- `src/hooks/workspace-customer-api.js`: retains HTTP status on API errors so conflicts can be distinguished from retryable failures.
- `server-job-routes.js`, `server-workspace-jobs.js`: conditional job dates, completed occurrence restoration, change receipts and guarded bulk inverse writes.
- `server-maintenance-routes.js`, `server-workspace-maintenance.js`: occurrence receipts, recurrence/lifecycle guards, sparse override restoration and appended activity.
- `src/components/maintenance/MaintenancePlanPage.jsx`: displays preserved original moves and their inverse activity.
- `tests/calendar-undo.test.js`: database-level inversion, preservation, conflicts and rollback.
- `tests/e2e/calendar-scheduling.spec.mjs`, `tests/e2e/maintenance-calendar.spec.mjs`: Undo workflows and responsive/regression coverage. Existing scheduling assertions now also check the expected-date guard; request intercepts include the Calendar response query.
- `docs/calendar-undo.md`: this report.

## Verification

All mutation checks use synthetic fixtures in temporary SQLite/auth databases. No operational workspace or production data was changed. No commit, push or deployment was performed.

- `npm test`: **429 passed, 0 failed** (6.2 seconds), including 8 new database-level Undo checks. Evidence: `test-results/calendar-undo-final-unit.log`.
- `npm run lint`: passed. Evidence: `test-results/calendar-undo-final-lint.log`.
- `npm run build`: passed with the existing bundle-size advisory. Evidence: `test-results/calendar-undo-build.log`.
- `git diff --check` and whitespace checks of all three new files: passed.
- **92 distinct Calendar/Maintenance browser tests passed across completed runs**, including 26 added Undo checks and the existing regression. This is a combined result, not one uninterrupted 92-test run.
- Browser coverage includes mouse/touch/date controls, Day Inspector, cancellation/no-op, reverse ordering, 10-entry eviction, failed original/failed inverse recovery, optimistic positioning, rapid double-click protection, newer unrelated edits, stale schedule protection, bulk partial conflicts, reload clearing, completion/invoice preservation, occurrence override restoration and truthful activity, failed range refresh, excluded recurrence replacement, and existing generation/recurrence/navigation/filtering workflows.
- All six themes passed at 390, 820 and 1440 pixels. Representative toolbar screenshots from every theme were visually inspected. Existing ten-layout, 320–430px mobile toolbar and five-job density checks also passed. Screenshots: `test-results/calendar/undo-*.png`.

The first full unit run hit an intermittent `SQLITE_BUSY` in the existing concurrent-startup migration test. That test passed in isolation (`test-results/calendar-undo-migration-recheck.log`), then all 429 tests passed in the final full run. Startup/storage code was not changed.

The initial browser runs exposed test assertions that measured before the existing workspace/viewport transition settled, and request expectations/intercepts that omitted the new expected-date guard or Calendar response query. Those tests now wait for the actual Calendar shell/viewport and assert/intercept the guarded request. No layout or scheduling rule was changed to bypass a regression assertion.

### Browser run evidence

Every command used `--config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1 --reporter=list`.

The initial full command selected `tests/e2e/calendar-scheduling.spec.mjs tests/e2e/maintenance-calendar.spec.mjs`. Subsequent commands selected the affected and not-yet-run tests by name or source line, retaining already-passed checks:

| Log under `test-results/` | Passed checks used in the final combined result |
| --- | --- |
| `calendar-undo-regression-e2e.log` | 53, before the workspace-transition assertion |
| `calendar-undo-inspector-recheck.log` | 2: ten-layout inspector and direct Inspector Undo |
| `calendar-undo-remaining-e2e.log` | 5 additional Inspector drag/failure/navigation/touch checks |
| `calendar-undo-final-e2e.log` | 2: Calendar density and 320–430px toolbar |
| `calendar-undo-last-e2e.log` | 26: remaining Calendar matrix/removal/filtering plus Maintenance/Undo workflows |
| `calendar-undo-maintenance-final-e2e.log` | 4: failed occurrence write, generation, phone/tablet recurrence |

The earlier focused Undo runs are additional evidence and are not counted twice.
