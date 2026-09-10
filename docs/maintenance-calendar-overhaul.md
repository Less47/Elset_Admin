# Maintenance workspace and recurring Calendar integration

Implementation report — 10 September 2026. Changes are local and uncommitted. No push, merge or deployment was performed. Database writes used isolated test fixtures, not the operational workspace database.

1. **Existing Maintenance recurrence architecture.** `MaintenanceManager.jsx` rendered tall cards with checklist previews and aggregate recent activity, plus Due Queue and Active Maintenance Jobs panels. SQLite stored plan/customer references, site address, frequency, `next_due_date`, default technician, duration, contract price in cents, notes, generation/completion timestamps and the last generated job ID. Checklist text lived in `maintenance_checklist_items`. Optional site/asset data used `extra_json`. Frequencies were `monthly`, `quarterly`, `six-monthly`, and `annual` (1/3/6/12 months). Job generation advanced the mutable next due date; normal job completion only recorded the completion timestamp. Month arithmetic used sequential JavaScript `setMonth` rollover, so 31 January 2027 advanced to 3 March, not 28 February. There was no durable series anchor, occurrence exception model, active-state control or maintenance revision check.

2. **Existing Calendar architecture.** A custom React Calendar grouped scheduled jobs from the loaded workspace state. `CalendarMonth` rendered the visible six-week range and measured compact event capacity. `useCalendarDrag` handled native mouse dragging, intentional touch holds, cancellation and click suppression. `CalendarDayInspector` occupied the desktop mini-calendar column; `CalendarSheet` handled phone and intermediate layouts. Job scheduling already used targeted date APIs and optimistic rollback. Bulk day moves used job revision tokens. There was no Maintenance range endpoint or maintenance event type.

3. **Compact Maintenance dashboard.** Shared search/filter/sort/add controls are followed by Plans, Overdue, Due Soon, Active Jobs and Contract Value summaries. Compact cards show status, frequency, title, customer/site, next due, estimated time and price, with Open Plan, Generate Job and Edit. Due Queue remains on the right on desktop and stacks below on narrower screens. Checklist/activity and the Active Maintenance Jobs panel have been removed from the dashboard. Active Jobs counts jobs, rather than plans with an open job. An active job no longer hides a later overdue visit. Phone cards retain the shared semantic mobile record components.

4. **Plan routes and design.** `/maintenance`, `/maintenance/new`, `/maintenance/:id` and `/maintenance/:id/edit` are handled by the existing workspace navigator. Detail and edit use `RecordWorkspace`, with direct loading, back navigation and unsaved-edit protection. The detail page shows Plan Details and Recent Activity beside Checklist and Generated Jobs, stacked on phones. Deletion sits in a collapsed destructive section. Creation and editing are full pages.

5. **Contract-price attention.** Missing prices visibly say “Not set” with a pale rose background, a one-pixel muted red border and dark red text in both dashboard and detail metrics. Explicit zero is a valid saved price. A presence flag distinguishes a newly entered zero from older zero values, whose original missing/value distinction was not stored.

6. **Range expansion.** `src/lib/maintenance-recurrence.js` provides the shared date-only recurrence calculation for Calendar, dashboard, Due Queue and next due. Calendar requests only its visible six-week range from `GET /api/maintenance-occurrences`. The API validates inclusive `from`/`to` dates and caps requests at 732 days. Expansion preserves sequential rollover, fast-forwards distant ranges after the finite rollover prefix, and includes exceptions moved into the range. No future job records or years of occurrence rows are generated.

7. **Occurrence identity.** Each occurrence has a deterministic key composed of plan ID, schedule-segment ID and original occurrence date. A moved occurrence retains its key. The first visit of a changed schedule retains the selected visit's identity; subsequent visits belong to the new segment. Keys never depend on array positions. Events also carry the effective date, customer/site, frequency, plan title, revision, completion state and linked job details.

8. **Exception persistence.** `maintenance_occurrence_exceptions` is sparse: rows exist only for moved, generated or explicitly completed visits. It stores the stable key, plan/series IDs, original and override dates, a live job reference, a durable generated-job reservation, completion time, a snapshot, and created/updated timestamps. The stable key and plan/series/original-date tuple are unique. Job links are indexed and unique. Unchanged future visits remain derived.

9. **Schedule changes.** The authoritative plan `extra_json.recurrence` stores schedule segments. A schedule change closes the affected segment at the selected nominal visit and adds a new anchor/frequency for that visit and future dates. Earlier segments remain. Obsolete ungenerated future overrides are removed transactionally. Sparse mappings reserve already generated/completed future cycles at their factual dates, preventing an extra planned visit for the same cycle. This avoids generating hundreds of overrides.

10. **Confirmation and optimistic UI.** `MaintenanceDateChoice` is the same small dialog for Calendar drag/drop, Calendar date inputs and Edit Plan. It offers “This occurrence only”, “Change maintenance schedule” and “Cancel”. Changing frequency requires the schedule option. Calendar shows a tentative destination before the choice; no mutation is sent before confirmation. Cancel restores the original chip, and a failed request restores the view with an inline error. Same-date drops bypass both the dialog and API.

11. **History protection.** Completed visits and historically generated visits cannot be moved. Schedule changes preserve previous segments and all saved job/completion facts; ordinary job records are not rewritten. Plan/customer archive and restore retain recurrence snapshots and exceptions. A generated job's archived cycle remains reserved, preventing duplicate regeneration; restoring it reconnects the same occurrence. Known legacy jobs are retained at their recorded maintenance due dates. Since the old model did not retain its original anchor or ungenerated historic dates, existing plans begin derived expansion at their saved next due date; missing earlier planned history is not invented.

12. **Generated Job linkage.** Generate Job sends the occurrence key and plan revision. The server creates a normal ELSET job with the existing customer/site, technician, maintenance metadata and checklist-in-description behavior, then records the sparse occurrence link in the same transaction. Repeated requests for that key return the existing job, including completed jobs. Calendar keeps the maintenance chip and labels it with Job #. A linked job on the same day shares the chip; a job scheduled elsewhere remains a separate ordinary job with maintenance identification. Open Plan/Open Job are available in the inspector/sheet. Job dragging changes only the job schedule.

13. **Due Queue and next due.** The shared domain selects the earliest effective ungenerated, uncompleted visit. Single-visit moves affect that visit's date without shifting cadence. Generating a later visit does not skip earlier ungenerated work. Completion and job generation consume only the associated cycle. Both serialized workspace state and the SQL next-due cache use the same calculation. Inactive plans retain their information but do not create future Calendar visits or enter the Due Queue.

14. **Migration.** SQLite migration 5, `maintenance-recurrence-exceptions`, adds the sparse table and indexes and updates schema metadata. No existing table or record is deleted/rebuilt by the migration. Anchors, segment history, active state, price presence and monotonic maintenance revisions use the established extensible plan JSON storage. Export/import and archive/restore preserve the new metadata. Tests cover upgrading an existing v4 database and applying the migration twice. The migration has not been applied to the operational workspace by this task.

15. **API changes.** Existing admin/office authorization and SQLite storage guards are reused. Calendar range reads return only occurrence data; mutations retain the existing `{ ok, result, state }` response convention.

    | Operation | Contract |
    | --- | --- |
    | `GET /api/maintenance-occurrences?from=…&to=…` | Read the inclusive bounded Calendar range. |
    | `PATCH /api/maintenance-plans/:id/occurrences` | Single visit: `occurrenceKey`, `nextDueDate`, `revision`. |
    | `PATCH /api/maintenance-plans/:id/schedule` | Explicit recurrence scope, occurrence key, destination and revision. |
    | `PATCH /api/maintenance-plans/:id` | Metadata/active/price edits; date/frequency changes additionally require `revision` and `dateChange: { scope, occurrenceKey }`. |
    | `POST /api/maintenance-plans/:id/generate-job` | Requires occurrence identity and revision; duplicate identity returns its existing job. |
    | `POST /api/maintenance-plans/:id/complete-cycle` | Explicit occurrence completion requires identity/revision; the legacy aggregate-only completion path does not consume the next visit. |

    Date writes reject stale revisions with HTTP 409 and run inside SQLite transactions. No broad workspace-save endpoint was added. Persisted recurring-date editing requires SQLite workspace mode, consistent with existing Calendar job scheduling; JSON mode reports this requirement instead of silently applying a different recurrence rule.

16. **Files changed.** New files:

    ```text
    server-maintenance-occurrence-store.js
    src/lib/maintenance-recurrence.js
    src/components/calendar/CalendarMaintenanceItem.jsx
    src/components/maintenance/Maintenance.css
    src/components/maintenance/MaintenanceDateChoice.jsx
    src/components/maintenance/MaintenancePlanPage.jsx
    tests/maintenance-recurrence.test.js
    tests/e2e/maintenance-calendar.spec.mjs
    docs/maintenance-calendar-overhaul.md
    ```

    Updated files:

    ```text
    server-maintenance-routes.js
    server-store.js
    server-workspace-db.js
    server-workspace-importer.js
    server-workspace-jobs.js
    server-workspace-maintenance.js
    server-workspace-state.js
    src/App.jsx
    src/components/app/WorkspaceShell.jsx
    src/components/calendar/Calendar.css
    src/components/calendar/CalendarDayInspector.jsx
    src/components/calendar/CalendarJobCard.jsx
    src/components/calendar/CalendarManager.jsx
    src/components/calendar/CalendarMonth.jsx
    src/components/maintenance/MaintenanceManager.jsx
    src/hooks/useWorkspaceActions.js
    src/hooks/useWorkspaceNavigation.js
    src/lib/app-support.jsx
    tests/maintenance-routes.test.js
    tests/workspace-migration.test.js
    ```

17. **Tests added.** Fifteen domain/database tests cover automatic bounded expansion, both move scopes, repeat cutovers, stable identity, incoming/outgoing range overrides, out-of-order generation, completion, concurrent/stale writes, rollback, archived jobs, protected future work, active/deleted plans, export/import, additive migration, end-of-month/leap-year semantics and three timezones. One API test exercises range validation, concurrent moves and concurrent idempotent generation. Eight browser tests cover compact/detail/create/edit workflows, price states, effective due dates, activation, mouse dragging, cancel/no-op, refresh/navigation persistence, future cadence, failure recovery, linked job inspection, phones and tablets.

18. **Exact final validation results.** `npm test`: 215 passed, 0 failed. The existing Calendar browser suite passed all 42 tests in the final combined regression run. The Maintenance browser suite then passed 8/8 in its final isolated run after correcting a native-select test locator; all 50 distinct browser checks are passing. Commands used `npx playwright test … --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1`. The combined log retains that superseded test-selector failure; `maintenance-e2e.log` records the successful rerun. `npm run build`: passed, with a Vite bundle-size advisory. `npm run lint` and targeted lint after final changes: 0 errors, 0 warnings. `git diff --check`: passed. Logs: `test-results/maintenance-full-tests.log`, `maintenance-calendar-regression.log`, `maintenance-e2e.log`, `maintenance-build.log`, `maintenance-lint.log`, and `maintenance-final-lint.log`.

19. **Screenshots captured.** Thirteen feature screenshots are in `test-results/maintenance/`: dashboard (desktop/tablet/phone), plan detail (desktop/tablet/phone), Calendar (desktop/tablet/phone), date choice (desktop/tablet/phone), and desktop Day Inspector with a linked generated job. Layout checks verify no horizontal document overflow. The existing Calendar regression suite additionally captures density, bulk actions, inspector and responsive-layout screenshots in `test-results/calendar/`.

    | Surface | Desktop | Tablet | Phone |
    | --- | --- | --- | --- |
    | Dashboard | [View](../test-results/maintenance/maintenance-dashboard-desktop.png) | [View](../test-results/maintenance/maintenance-dashboard-tablet.png) | [View](../test-results/maintenance/maintenance-dashboard-phone.png) |
    | Plan detail | [View](../test-results/maintenance/maintenance-plan-detail-desktop.png) | [View](../test-results/maintenance/maintenance-plan-detail-tablet.png) | [View](../test-results/maintenance/maintenance-plan-detail-phone.png) |
    | Calendar | [View](../test-results/maintenance/maintenance-calendar-desktop.png) | [View](../test-results/maintenance/maintenance-calendar-tablet.png) | [View](../test-results/maintenance/maintenance-calendar-phone.png) |
    | Date choice | [View](../test-results/maintenance/maintenance-recurring-date-choice.png) | [View](../test-results/maintenance/maintenance-date-choice-tablet.png) | [View](../test-results/maintenance/maintenance-date-choice-phone.png) |

    [Day Inspector with a linked job](../test-results/maintenance/maintenance-calendar-inspector-linked-job.png).
