# Service Board job notes — implementation report

Completed locally on 16 September 2026. No commit, push, deployment, or production data migration was performed.

## 1. Architecture audited

| Area | Existing implementation |
| --- | --- |
| Desktop and tablet | `WorkspaceShell.jsx` selects `OfficeBoard.jsx` at 768px and above. The same three-column board serves desktop and iPad. |
| Desktop cards | Internal `JobCard` in `OfficeBoard.jsx`, with list, grid, and compact views. |
| Mobile | `MobileServiceBoard.jsx` and `MobileJobCard.jsx`, with one selected status and dedicated Move/Tomorrow controls. |
| Tomorrow panel | `ServiceBoardTomorrowPanel` and `TomorrowJobCard` in `OfficeBoard.jsx`. |
| Toolbar and tag info | `WorkspaceShell.renderServiceBoardControls`, `ServiceBoardTagLegend`; mobile has an existing Filters button and indicator-label setting in `MobileBoardFilters`. |
| Normal opening | Desktop/tablet double-click opens Job Details; compact view also expands on single-click. Mobile's main button opens on one tap. |
| Drag/drop | Native desktop drag events and an existing 180ms long-press touch implementation in `OfficeBoard`. |
| Prices | Grid has an absolute bottom-right floating price. List, compact, and mobile prices are inside the card header. |
| Persistence | `useWorkspaceActions` → authenticated job routes → transactional `updateJobDetails`/`updateJobCore` → SQLite. Existing generic route responses include authorized workspace state. |
| Normalization | `server-workspace-state.js`, `server-workspace-importer.js`, `server-store.js`, and `src/lib/app-support.jsx`. |
| Update/error conventions | Existing job updates generally await the server and replace workspace state. Existing UI errors use inline alerts or `window.alert`. Notes use an inline retry alert and merge only the changed field. |

Existing cards were extended. The shared new components contain only note controls, the note pill, and the editor.

## 2. Toolbar button

Added a Lucide Pencil icon immediately after Show tag info on desktop/tablet. Mobile exposes the same button beside Filters, which contains its existing indicator-label control. It has `aria-label="Edit job notes"`, a matching tooltip, and `aria-pressed`. Active mode uses an orange surface, border, and ring. Desktop uses a compact 32px button; touch layouts use 44px controls.

## 3. Note-mode interaction

Clicking/tapping the card body in note mode opens one compact Radix anchored popover. Normal navigation and compact expansion are suppressed for that interaction. Dedicated buttons retain their actions. Keyboard users can focus a desktop card and press Enter/Space.

The editor has a labelled input, live character count, Save, Cancel, and Remove note for existing notes. Escape cancels; closing restores focus. Blank Save removes the note. Turning the pencil off immediately restores the original card behaviour.

## 4. Field

`Job.serviceBoardNote`, stored in `jobs.service_board_note`. Missing/blank notes use `NULL`. It is separate from Access Notes, diary notes, descriptions, invoice notes, and technician notes.

## 5. Persistence and concurrency

`PATCH /api/jobs/:id/service-board-note` accepts `{ "serviceBoardNote": "Waiting on parts" }` or `null`. The route permits the existing admin/office/technician roles and passes only this field into the authoritative job update function. Additional fields on this route cannot alter status or other job data.

SQLite saves update the pill immediately and close the editor. Only the note is merged into client state on success or rollback; the existing whole-workspace response is not used to refresh the board. On failure the previous note returns and the draft is retained for Retry, including failed removals. Duplicate saves for the same job are blocked while pending.

The legacy JSON mode also has a targeted server-side read/merge/write. Its client waits for the response and marks the state synced to avoid triggering a stale broad autosave.

## 6–7. Schema approach and production safety

The production audit used Fly SSH and `better-sqlite3` with `readonly: true, fileMustExist: true`. It read only app/schema metadata and job-column definitions; it did not invoke initialization or migration.

| Audited value | Result |
| --- | --- |
| Production app `WORKSPACE_SCHEMA_VERSION` | 6 |
| `workspace_info.schema_version` | 6 |
| SQLite `PRAGMA user_version` | 6 |
| Migration ledger | Versions 1–6, contiguous; latest `invoice-archive-records` |
| Original local schema version | 6 |
| New local schema version | 7 |
| New migration | `service-board-job-note` |

The existing `extra_json` field was evaluated. A dedicated column was chosen because this is an explicit Job field with a database length constraint, rather than miscellaneous import metadata.

Migration 7 adds one nullable TEXT column with a CHECK constraint. Every existing job receives NULL. It does not rebuild or delete the Jobs table. Existing migrations 1–6 remain unchanged. The existing immediate transaction and migration ledger apply 6 → 7 once; repeat startup performs no migration writes. Failure rolls back both DDL and metadata.

The existing startup guard still checks all three version records, contiguous migration ordering, required objects, integrity, and foreign keys. A version-6 app using this existing guard rejects a version-7 database rather than downgrading it. Version-7 startup additionally verifies the new column exists. Tests verify unchanged Jobs rootpage, preservation of existing rows, rollback/retry, concurrent initialization, and startup before listening.

## 8. Desktop pill

`JobNotePill` is absolutely positioned bottom-left with `translateY(50%)`, rounded styling, compact 10px text, and single-line ellipsis. It does not depend on edit mode or Show tag info. Grid cards measure the existing price pill with ResizeObserver and reserve its actual width. Existing price placement and calculations are unchanged.

Columns containing notes reserve enough vertical gap for the lower note and the next card's upper indicators. Compact cards receive 4px additional bottom padding where needed; list/grid card content heights remain unchanged.

## 9. Tablet/mobile

The existing tablet three-column layout is preserved, including 768px-wide checks. Tablet uses the same cards and editor with touch-size controls. Mobile uses the shared pill on its existing card, retains its header price, and adds 8px bottom padding only on cards with notes to clear action buttons. The desktop Tomorrow panel also displays/edits notes.

All six themes were checked: Elset Classic, Copper Dawn, Evergreen Ledger, Midnight Signal, Studio Rose, and Desert Circuit. Dedicated semantic `--board-note-*` tokens keep the pill orange and readable independently of theme action colours. The maintenance legend is unchanged.

## 10. Drag/drop

Note mode disables native dragging, touch-drag initiation, and column drops. An existing touch gesture is cancelled. Turning mode off restores dragging immediately. Browser tests cover both desktop drag events and actual touch-event long presses against the local API.

## 11. Length and normalization

The input has `maxlength=25`. A shared validator enforces the same limit on server update, create, import, restore, and client normalization paths. Leading/trailing whitespace is trimmed; whitespace-only values become NULL. Line-break/tab sequences become spaces. Null characters and values over 25 are rejected. A database CHECK provides an additional stored-value limit. Capitalization is preserved.

## 12. Files changed

| Files | Purpose |
| --- | --- |
| `server-job-routes.js` | Targeted authorized note endpoint |
| `server-workspace-db.js` | Schema 7, additive migration, column assertion |
| `server-workspace-jobs.js` | Job field, validation, insertion, partial update, restore |
| `server-workspace-state.js` | Database serialization |
| `server-workspace-importer.js` | Dedicated-column import and known-field handling |
| `server-store.js` | Legacy JSON normalization/persistence |
| `src/lib/service-board-note.js` (new) | Shared validation and maximum length |
| `src/lib/app-support.jsx` | Client normalization |
| `src/lib/theme-tokens.js`, `src/index.css` | Orange semantic tokens and edit-mode feedback |
| `src/hooks/useWorkspaceActions.js` | Targeted save, optimistic merge, rollback |
| `src/components/app/WorkspaceShell.jsx` | Shared mode/editor wiring, failure/retry alerts |
| `src/components/service-board/OfficeBoard.jsx` | Desktop/tablet/Tomorrow cards, toolbar, drag protection, spacing |
| `src/components/service-board/MobileServiceBoard.jsx` | Mobile toolbar and note-mode wiring |
| `src/components/service-board/MobileJobCard.jsx` | Mobile interaction, pill, and action clearance |
| `src/components/service-board/JobNoteModeButton.jsx` (new) | Accessible mode toggle |
| `src/components/service-board/JobNotePill.jsx` (new) | Shared floating note |
| `src/components/service-board/JobNoteEditor.jsx` (new) | Anchored editor |
| `src/components/service-board/useJobNoteEditor.js` (new) | Editor state, pending saves, retained drafts |
| `tests/job-routes.test.js` | CRUD, validation, concurrency safety, roles, JSON persistence |
| `tests/workspace-schema-upgrade.test.js` | Schema-7 expectations and migration safety tests |
| `tests/workspace-migration.test.js` | Latest migration expectation |
| `tests/maintenance-recurrence.test.js`, `tests/backfill-site-coordinates.test.js` | Correct historical-schema fixtures after schema 7 |
| `tests/e2e/service-board-controls.spec.mjs` | Nine note scenarios, viewport/theme checks, touch and mouse dragging |
| `output/service-board-job-notes-report.md` (new) | This report |

## 13. Verification

- `npm test`: **385 passed**, 0 failed.
- Full Service Board controls suite: **26 passed** in the first complete run (18 existing scenarios plus 8 note scenarios).
- Final targeted browser run: **11 passed** (9 note scenarios, including an additional dedicated-controls check, plus existing desktop and tablet regression scenarios).
- Total distinct browser scenarios verified: **29**.
- `npm run lint`: passed.
- `npm run build`: passed; existing large-bundle advisory remains.
- `git diff --check`: passed.

Tests cover note create/update/remove, 25/26-character boundaries, whitespace, invalid types, database constraints, reload, cross-browser persistence, unrelated-field preservation, archive/restore, optimistic failure and removal retries, keyboard interaction, mode toggling, drag restoration, independent visibility, price coexistence, clipping, counts, sorting, search, urgency filters, Completed batching, Full Screen, Tomorrow, and all themes. Tablet/mobile checks used touch-enabled Chromium emulation.

Visual inspection included the desktop light board, Midnight Signal tablet grid, 320px Midnight Signal mobile cards, and anchored editors. Screenshots are in `test-results/service-board-controls/`; test logs use `test-results/board-note-*.log`.

## 14. Edge cases and limits

- Desktop normal opening was double-click, not single-click; this remains unchanged. Mobile remains single-tap.
- Only the existing grid price floats at the bottom. Other views retain their existing header price.
- The existing maintenance semantic palette is green even though its legend dot is orange. Dedicated note tokens avoid changing either existing behaviour.
- At very narrow grid widths, long notes truncate to preserve the price; the full note remains in its tooltip/accessibility label and editor.
- The 25-unit input limit follows native HTML/JavaScript UTF-16 counting; emoji may consume two units.
- Concurrent edits to the same note use the existing last-successful-write behaviour. Other Job fields are never included in a note save. Other sessions obtain notes through the existing workspace fetch/reload flow.
- Failed drafts remain available within the current workspace session. Successful notes are persisted server-side.

No Access Notes indicator or custom legend entry was introduced. No Job Details component was changed.
