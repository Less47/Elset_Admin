# Completed maintenance Calendar corrections

## Audit

Completed generated maintenance jobs were usually represented by a maintenance occurrence chip, rather than a separate job chip. Calendar deduplicates a job and its linked occurrence when they share a date.

The restrictions were:

- `expandMaintenanceOccurrences()` sets `locked` when an occurrence has `completedAt`, or when generated work is historical.
- `CalendarMaintenanceChip` and `CalendarMaintenanceItem` passed `!occurrence.locked && occurrence.active` to the mouse/touch drag hook and hid Change date when locked.
- `CalendarManager.proposeMaintenanceMove()` rejected locked occurrences.
- `server-workspace-maintenance.js` rejected locked occurrences in the ordinary occurrence/schedule mutation path.

Ordinary completed jobs were already draggable and reschedulable through `PATCH /api/jobs/:id/schedule`. Their rules are unchanged. Bulk day moves still exclude completed jobs. Historical active maintenance, archived generated work, and completed occurrences without a live completed job retain their existing restrictions.

## Scheduling and completion fields

Calendar groups ordinary jobs by **`job.scheduledDate`** (`jobs.scheduled_date`). Maintenance chips use the effective occurrence date: an exception's `overrideDate`, its saved snapshot date, or the derived recurrence date.

The new correction updates the job's `scheduled_date` and the selected occurrence's `override_date` atomically. It preserves the occurrence key, original date, series ID, generated-job link, job ID, maintenance due date, customer/site, technician information, status, quote, invoice and job history. The usual job/exception/workspace modification timestamps advance.

No completion operation runs. Existing occurrence `completed_at`, explicit job `completedAt`, completion history and plan `last_completed_at` remain unchanged. For legacy jobs without a persisted occurrence completion timestamp, the correction freezes the completion timestamp already represented by the job before changing `updatedAt`. Occurrence reads now prefer an explicit job `completedAt` over that legacy `updatedAt` fallback.

## Confirmation and cancellation

Completed maintenance drag/drop and Change date use a compact **Move completed maintenance job?** dialog with the actual job number, original scheduled date and destination. It offers Cancel and Move job. It never offers Change maintenance schedule.

Before confirmation, the card remains on its original date and no scheduling request is sent. Cancel/close therefore leaves the job, occurrence and calendar position untouched; the date input is restored too. After confirmation, the existing pending-move display is used. Failed saves clear it and report the failure. Controls prevent duplicate submissions while saving.

The existing mouse and touch drag mechanisms, date highlighting, completed styling and labels are retained. The touch preview includes Completed. Day Inspector and the phone/tablet date action use the same confirmation.

## API and concurrency

The existing authenticated admin/office route accepts this narrowly scoped request:

```http
PATCH /api/jobs/:id/schedule
Content-Type: application/json

{
  "scheduledDate": "2026-09-16",
  "expectedScheduledDate": "2026-09-14",
  "completedMaintenanceCorrection": true
}
```

`correctCompletedMaintenanceJobSchedule()` validates the calendar date, permits only these three fields, reloads the job and linked occurrence inside a SQLite transaction, and requires the job still to be completed maintenance. A changed source date returns 409. Status/completion/invoice/recurrence fields in this correction payload are rejected. Unrelated concurrent job edits are retained because the SQL job update changes only the scheduled date and modification timestamp.

The server derives the linked occurrence from current records; the client sends no job object or recurrence configuration. The ordinary recurrence-edit endpoints remain locked for completed occurrences. Existing SQLite storage and authorization requirements remain in place.

## One occurrence and activity preservation

The existing sparse occurrence exception mechanism stores the corrected date. The correction does not write the maintenance plan row, revision, recurrence segments, frequency, next-due cache, last completion or generation fields. It does not generate, move or recalculate future visits.

Maintenance Plan activity is derived from exception records. Simply overwriting an exception date would have changed the label of an old completion and replaced its previous move entry. The first correction therefore captures the original activity date/override/timestamp in the existing snapshot JSON. Each correction appends its own from/to/time entry there. Plan activity uses those saved values to keep old entries intact and show separate **Schedule corrected from ... to ...** entries. No schema migration was added.

## Files changed

- `server-job-routes.js`: dispatch the explicit correction request through the existing schedule route.
- `server-workspace-jobs.js`: validation, stale-date protection and atomic job/occurrence correction.
- `src/lib/maintenance-recurrence.js`: preserve explicit job completion timestamps in occurrence reads.
- `src/hooks/useWorkspaceActions.js`: send the targeted correction fields.
- `src/components/calendar/calendar-utils.js`: identify completed maintenance jobs and allow their linked occurrence drag.
- `src/components/calendar/CalendarMaintenanceItem.jsx`: enable drag and Change date for that case.
- `src/components/calendar/CompletedMaintenanceMoveDialog.jsx`: compact confirmation.
- `src/components/calendar/CalendarManager.jsx`: shared completed-job proposal, confirmation, save and rollback behavior.
- `src/components/maintenance/MaintenancePlanPage.jsx`: preserve prior activity and display appended corrections.
- `tests/maintenance-recurrence.test.js`: date/completion separation, stable links, unchanged plan/future dates, unrelated edits, legacy completion and transaction rollback.
- `tests/maintenance-routes.test.js`: narrow payload, authorization and stale-request handling.
- `tests/e2e/maintenance-calendar.spec.mjs`: completed drag, cancel, confirmation, earlier/later dates, mobile/tablet actions, touch feedback, Day Inspector, failure recovery, active generated maintenance and separately scheduled completed jobs.
- `docs/completed-maintenance-calendar-correction.md`: this audit and report.

## Verification

- `npm test`: 403 passed, 0 failed. Log: `test-results/completed-maintenance-unit.log`.
- `npm run build`: passed, with the existing bundle-size advisory.
- `npm run lint`: passed.
- `git diff --check`: passed.
- Full Calendar and Maintenance browser regression: 64 passed in 3.0 minutes. Log: `test-results/completed-maintenance-e2e.log`.
- Two additional browser checks for active generated maintenance and separately scheduled completed jobs: 2 passed in 5.2 seconds. Log: `test-results/completed-maintenance-linked-jobs.log`. Total: 66 distinct browser tests passed across these runs.

```powershell
npx playwright test tests/e2e/maintenance-calendar.spec.mjs tests/e2e/calendar-scheduling.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1

npx playwright test tests/e2e/maintenance-calendar.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1 --grep 'active generated maintenance|separately scheduled completed'
```

The database tests include scheduled 14 September, actually completed 15 September, then corrected to 16 September: status and actual completion stay unchanged. Further corrections into past and future dates preserve the same occurrence and all other recurrence dates. A synthetic database failure after the occurrence write proves both writes roll back together.

Browser tests use isolated temporary workspace/auth databases. Representative desktop and phone confirmation screenshots and the tablet touch-drag preview were visually inspected. Artifacts are under `test-results/maintenance/completed-maintenance-*`; no operational data was changed.

Changes remain local. No commit, push or deployment performed.
