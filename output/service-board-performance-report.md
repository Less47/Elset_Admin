# Service Board performance audit and optimisation

Completed locally on 16 September 2026. No commit, push, deployment, production-data changes, or Fly resource changes were made.

## 1. Main causes

The primary bottlenecks were browser work and unnecessary data transfer, with avoidable database reads contributing:

- In SQLite mode, the card waited for the entire status request before moving.
- A small status PATCH returned the complete workspace. At 500 synthetic jobs this was approximately **465 KB**, followed by whole-workspace normalization, serialization, and replacement in React.
- Replacing the workspace recreated every job object. All **375 rendered desktop cards** then rerendered, including their price and indicator calculations.
- Tablet touch coordinates were React board state. Twelve movement events caused **4,500 card renders and 36 column sorts** with 500 jobs.
- The status path loaded every workspace table **three times**: to find the original job, to return the updated job, and to build the response state. The ordinary status request executed **105 SQLite statements**, although only two statements wrote data.

Desktop native `dragstart`/`dragover` already performed no React state updates or API requests. The measured desktop problem was primarily the delay after dropping. Increasing Fly RAM/CPU would not remove the frontend wait, large response, or repeated tablet rendering.

## 2. Optimistic updates and the full interaction trace

Previously, SQLite status changes were not optimistic. Legacy JSON mode already changed local state immediately and retains its existing path.

| Step | Previous SQLite path | Updated SQLite path |
| --- | --- | --- |
| Drag start | Desktop sets the job ID in `dataTransfer`; tablet creates a small gesture session and starts the existing 180 ms hold timer | Same interaction; tablet priming stays in a ref |
| Drag over / movement | Desktop only permits dropping; tablet updates React coordinates and renders/sorts the whole board | Coordinates stay in a ref; one animation-frame callback positions the preview with a transform and checks the target column |
| Drop | Find the job and retain the existing confirmation when reopening Completed work | Same validation/confirmation |
| Frontend state | Wait for server success | Immediately patch that job's status/timestamp; completion immediately clears its Tomorrow marker |
| API | `PATCH /api/jobs/:id/status` with `{status}` | Same endpoint with `?response=delta` and `{status, expectedStatus}` |
| Server | Authenticate, check the existing role permission, open SQLite, load the workspace | Same authentication/permission and connection checks; read the targeted job's status fields |
| SQLite | Update the selected job; preserve completion side effects; update workspace metadata; validate foreign keys | Same writes, transaction, completion semantics, and foreign-key validation |
| Activity/history | Update `jobs.updated_at` and workspace metadata; no separate status-history or job-note insert | Unchanged |
| Response | Updated job plus complete workspace state | Status/timestamp/Tomorrow fields, plus affected maintenance-completion fields when needed |
| Frontend refresh | Normalize and replace the complete workspace | Merge only returned status fields into the current job; retain unrelated job/customer/site references |
| Final render | All cards render after persistence | Destination card renders immediately; acknowledgement updates only the changed card and relevant derived data |

Failures restore the last confirmed status and relevant Tomorrow fields, then use the existing ELSET alert. Unrelated note edits and newer field edits survive rollback. Rapid successive moves of the same job save in order; different jobs save independently. An older acknowledgement cannot overwrite a newer optimistic move. A conflicting server status returns HTTP 409 and restores the authoritative status instead of silently overwriting another session.

The mobile Move sheet retains its existing pending/success behavior: board data changes optimistically, while the sheet confirms success and switches tabs after persistence succeeds.

## 3. Full board refetches

There was **no separate GET refetch after a drop**. The equivalent full reload happened inside the PATCH response: all jobs, customers, sites, and other workspace records were loaded and returned, then replaced locally.

The new board path performs one targeted PATCH and no `/api/app-state`, customer, or site GET. A held-response browser test verifies that the card moves before persistence, a concurrent note edit survives acknowledgement, and no API GET occurs. Legacy callers that omit `response=delta` retain the existing full-state response contract.

## 4. React rendering and derived-data audit

The following are instrumented component-function calls, not counts of every nested icon or primitive component. The 500-job desktop/tablet fixture renders 375 cards: 200 To Do, 150 In Progress, and the first 25 Completed.

| Interaction at 500 jobs | Before | After |
| --- | --- | --- |
| Desktop drag start / 12 drag-over events | 0 card renders; 0 sorts | Unchanged |
| Tablet start and hold | 750 card renders; 6 sorts | 0 card renders; 0 sorts |
| Tablet 12 movements, crossing into the destination | 4,500 card renders; 36 sorts; 12 board renders | 1 card render; 0 sorts; 2 board renders for activation/target changes |
| Desktop drop through save completion | 375 card renders | 2 renders of the same changed card: optimistic move and acknowledgement |
| Tablet drop through save completion | 750 card renders | 2 renders of the same changed card |
| Mobile opening the Move sheet, with 200 To Do cards | 200 card renders and a sort | 0 card renders and 0 sorts |

After a desktop drop, `WorkspaceShell`, the legend, and the board render once for the optimistic change and once for acknowledgement. The three small column controls render on these data changes. They are not recreated continuously during pointer movement. A new destination mobile tab still mounts its own cards; at 500 total jobs that is 151 In Progress cards after this move.

`React.memo` now protects desktop, mobile, and Tomorrow cards. Stable event callbacks read the latest handler, so memoization does not retain stale note-editor or navigation behavior. A date key also invalidates card memoization when date-dependent invoice indicators need updating.

Desktop columns are grouped in one pass and sorted with `useMemo` using job data and the three sort values as dependencies. Mobile selected-job sorting is likewise memoized. Completed slicing remains after sorting and still begins at 25. Existing search/urgency filtering and dashboard derivations were already memoized in `useWorkspaceViewModel`; they continue to update when their relevant data changes.

Cards use their job snapshots directly. There are no per-card `customers.find` or `sites.find` scans to replace with global indexes. The one job lookup at drop is inexpensive; the measured repeated work was rendering, invoice/price normalization, indicators, and sorting during movement. No speculative collection-wide indexing or virtualization was added.

## 5. API and frontend timing breakdown

Measurements use isolated local production builds, the real authentication/Express/SQLite path, synthetic data, Chromium with **2x CPU throttling**, and network emulation configured for **80 ms latency and 10 Mbit/s throughput**. Desktop events run through the real handlers; tablet gestures use CDP touch events. Each size/viewport was measured three times before and after, for 54 scenarios. The original instrumented build was preserved separately.

These are production-like measurements, **not measurements of the live Fly deployment**. Browser frame timings are two-animation-frame estimates after the DOM change, not a hardware display trace. Instrumentation runs only in copied benchmark builds. No production logging was added.

500-job desktop medians:

| Measurement | Before | After |
| --- | ---: | ---: |
| Drop event to request invocation | 0.8 ms | 1.2 ms |
| Client API duration, through parsed JSON | 496.0 ms | 123.7 ms |
| Server processing, including authentication and response construction | 47.5 ms | 25.8 ms |
| Transport/emulated-network estimate | 437.5 ms | 98.1 ms |
| Response processing after Resource Timing body completion | 4.7 ms | 1.3 ms |
| Response parsed to subsequent rendered frame | 101.4 ms | 19.2 ms |
| Drop event to destination DOM update | 597.1 ms | 22.2 ms |
| Drop event to subsequent frame | 622.1 ms | 49.1 ms |

The network estimate is Resource Timing duration minus measured server time; it includes transport and browser scheduling. The response-to-frame interval includes state normalization/reconciliation, layout, and frame scheduling, rather than claiming to be pure React CPU time. Independently calculated medians do not add exactly.

The request body grows from 24 to 49 bytes to include the concurrency guard. The ordinary 500-job response falls from approximately 464,641 serialized JSON characters in the synthetic fixture to a 219-byte status response. Maintenance completion responses additionally contain the affected plan/occurrence fields.

## 6. SQLite work and timing

500-job desktop medians for the measured status operation, including reads, writes, validation, and transaction completion:

| Measurement | Before | After |
| --- | ---: | ---: |
| Status operation | 13.12 ms | 7.68 ms |
| Executed SQLite statements, including connection/schema checks | 105 | 33 |
| SELECT statements | 85 | 15 |
| PRAGMA statements | 14 | 12 |
| Data-writing statements for To Do → In Progress | 2 | 2 |
| Full-workspace materializations | 3 | 0 |

The remaining statement count includes the existing connection setup/schema validation transaction and the status transaction. Those checks were preserved. The measured trace shows the actual status transaction's BEGIN-to-COMMIT-invocation interval falling from approximately 9.85 ms to 0.66 ms in the representative 500-job sample; the operation timing above also includes completion of COMMIT and is the more useful end-to-end database figure.

The two ordinary writes remain one targeted `UPDATE jobs ... WHERE id = ?` and the existing workspace metadata upsert. No unrelated job, document, customer, or site is rewritten. There are no activity/history inserts on this path.

Completion retains the extra Tomorrow-clear update. For maintenance jobs it also retains the plan completion timestamp, occurrence completion updates, and revision increment. The compact response returns those effects so the local maintenance state stays consistent. Tests verify these effects and confirm that technician responses do not expose maintenance-plan records.

`EXPLAIN QUERY PLAN` confirms the status lookup uses `sqlite_autoindex_jobs_1 (id=?)`. Updates use the same primary-key lookup. Existing maintenance indexes and queries remain in place. No schema, index, WAL, synchronization, migration, or durability behavior was changed. The database read optimisation was made only after the trace demonstrated the repeated whole-workspace reads.

## 7. Changes made

- Optimistic, field-specific status updates with rollback and per-job request ordering.
- Optional compact status responses with an atomic expected-status check.
- Targeted database status reads instead of whole-workspace materialization on the compact path.
- Preservation and local reconciliation of completion/Tomorrow/maintenance effects.
- Memoized cards with stable callbacks and date-based invalidation.
- Memoized column grouping/sorting and mobile sorting.
- Tablet preview position held in refs and painted once per animation frame with a transform; no collection or coordinates are copied into React state on each movement.
- Isolated benchmark tooling and regression coverage. Layouts, note-pill placement, orange tokens, note editing, status rules, sorting/filtering options, and the initial 25 Completed jobs remain intact.

## 8. Before/after interaction results

Median drop-to-subsequent-frame time:

| Total jobs | Desktop before → after | Tablet before → after | Rendered desktop/tablet cards |
| ---: | ---: | ---: | ---: |
| 50 | 195.7 → **29.6 ms** | 189.0 → **41.4 ms** | 50 |
| 200 | 340.0 → **39.1 ms** | 325.6 → **43.3 ms** | 165 |
| 500 | 622.1 → **49.1 ms** | 603.5 → **54.3 ms** | 375 |

All 18 optimised desktop/tablet samples were below 100 ms; the largest was 68.3 ms. The visible-card counts are identical before and after.

On mobile, the optimistic source-list update reached a subsequent frame in 25.6 / 35.1 / 45.4 ms for 50 / 200 / 500 jobs. This occurs while the existing Move sheet is pending. Confirmed destination-tab display remains slower: approximately 178 / 249 / 366 ms after optimisation versus 219 / 388 / 731 ms before. At 500 jobs it still mounts 151 destination cards. This remaining mobile tab-mount cost is documented rather than hiding jobs or changing the mobile workflow.

## 9. Tests and reproducibility

- `npm run build`: passed on the final production source.
- `npm run lint`: passed.
- `git -c core.safecrlf=false diff --check`: passed.
- `npm test`: **395 passed**, including eight status-queue tests and the compact endpoint/completion tests.
- **41 distinct browser scenarios passed across the regression runs**: all 34 board-control scenarios and seven mobile/tablet/desktop/navigation/permission/Job Details scenarios. The final focused status/drag run passed all six selected scenarios. Intermediate test expectations were updated for the additional `expectedStatus` field, the response query parameter, and the existing edit-mode behavior that disables dragging.
- Benchmark: **27 before + 27 after scenarios**, with no live production writes.

Regression cases include delayed responses, immediate movement, failed-save rollback at desktop/tablet/mobile sizes, concurrent note edits, rapid same-job moves, independent different-job saves, conflicts, Tomorrow restoration, maintenance completion, technician permissions, unchanged note layouts, mouse/touch dragging, sorting/filtering, pagination, responsive containment, and Job Details status changes.

Reproduce with new output labels:

```powershell
node scripts/benchmark-service-board.mjs another-baseline baseline
node scripts/benchmark-service-board.mjs another-optimised
```

The first command uses the preserved original instrumented build. The second snapshots and instruments the current source, without modifying production files. Each run uses its own synthetic SQLite/auth databases and local server. Existing output labels are refused.

Evidence is under `test-results/board-performance/`: `baseline-final/results.json`, `after-final/results.json`, their `server.ndjson` SQL traces, and `summary.json`. Logs include `board-performance-unit.log`, `board-performance-controls.log`, `board-performance-final-regressions.log`, `board-performance-status-final.log`, `board-performance-build.log`, and `board-performance-lint.log`.

## 10. Files changed in this task

| File | Purpose |
| --- | --- |
| `server-job-routes.js` | Optional compact response and conflict result; existing role boundary retained |
| `server-workspace-jobs.js` | Targeted status reads, expected-status check, completion result fields |
| `src/hooks/useWorkspaceActions.js` | Optimistic queue integration and maintenance reconciliation |
| `src/hooks/workspace-job-status.js` | Compact request, field merging, ordered saves and rollback |
| `src/hooks/useStableCallback.js` | Stable callbacks using the latest handler |
| `src/components/service-board/OfficeBoard.jsx` | Card memoization, cached columns, lightweight touch preview |
| `src/components/service-board/MobileServiceBoard.jsx` | Cached selected jobs and stable card callbacks |
| `src/components/service-board/MobileJobCard.jsx` | Card memoization |
| `tests/workspace-job-status.test.js` | Queue/concurrency/rollback/request tests |
| `tests/job-routes.test.js` | Compact status, conflict, completion, and response-permission tests |
| `tests/e2e/service-board-controls.spec.mjs` | Optimistic and failed-save browser coverage; query-aware response matching |
| `tests/e2e/mobile-navigation-service-board.spec.mjs` | Concurrency-field request expectations |
| `scripts/benchmark-service-board.mjs` | Repeatable isolated measurements |
| `output/service-board-performance-report.md` | This report |

Earlier note-feature/layout work remains uncommitted and was preserved. The performance task did not change `server-workspace-db.js`, `server-workspace-state.js`, `src/index.css`, the note pill, or the note editor.
