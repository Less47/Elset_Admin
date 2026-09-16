# Service Board note placement and spacing refinement

Completed locally on 16 September 2026. No commit, push, or deployment was performed.

## 1. Why the Grid note sat lower

The note used `bottom: 0` with `translateY(50%)`, while the existing Grid price used `bottom: 6px` with the same translation. That placed the note six pixels lower. Its left inset was also different from the price's right inset.

## 2. Shared Grid alignment

Both pills now use `.service-board-floating-pill`, which retains the price's existing `position: absolute`, `bottom: 6px`, and `transform: translateY(50%)`. The note uses `left: 0`; the price keeps `right: 0`. Their rendered heights are equal, and tests compare their top and bottom edges directly.

The measured price width limits the note width with an eight-pixel gap. At very narrow widths, the note's horizontal padding reduces enough to keep its ellipsis visible. Grid cards consistently use the existing price-card bottom padding, so adding/removing a note does not add a height rule or minimum height.

## 3. Placement by mode

| View | Note placement |
| --- | --- |
| Grid | Floating bottom-left, level with the bottom-right price |
| Normal (`list`) | Inline immediately left of the price, with a four-pixel gap |
| Compact | Same inline note/price row, retaining priority and action controls |
| Distinct mobile card / Tomorrow panel | Existing edge treatment retained |

One `JobNotePill` component supplies the variants. Normal/Compact notes have a maximum width of eight rem and enough minimum space for an ellipsis. The header reserves the measured price width, the gap, and that minimum note width. Prices do not shrink; note text remains one line. The orange tokens are unchanged. Narrow cards retain their existing customer-text wrapping/truncation behavior.

## 4. Cause of the Grid job-number/customer gap

The Job # paragraph had `min-h-8` and `max-lg:min-h-11`: a 32/44-pixel reserved height even when the number occupied one short line. Removing those minimum heights restores the existing four-pixel paragraph spacing. A floated, hidden spacer reserves horizontal room only across the lines occupied by the Tomorrow action, keeping the action clear of text without a blank row beneath Job #.

## 5. Cause of the Normal top gap

Every Normal card rendered an indicator wrapper with `min-h-6`, `max-lg:min-h-10`, and `mb-1`. Empty wrappers therefore consumed 24/40 pixels plus the four-pixel bottom margin.

## 6. Conditional indicator spacing

The entire Normal indicator wrapper now renders only when `cardIndicators.length > 0`. Cards with indicators retain their existing indicator placement, minimum height, and margin. Cards without indicators start Job # at the content's top padding. When necessary, horizontal space protects the Tomorrow action beside that header.

Normal/Compact no longer have floating notes or note-dependent bottom padding/extra row gaps. Existing priority, maintenance, status, and indicator semantics remain intact.

## 7. Files changed in this refinement

- `src/components/service-board/JobNotePill.jsx`: shared floating/inline/edge variants and bounded note widths.
- `src/components/service-board/OfficeBoard.jsx`: mode-specific placement, shared inline value row, price measurement, Grid text spacing, and conditional Normal indicator row.
- `src/index.css`: shared Grid pill positioning class.
- `tests/e2e/service-board-controls.spec.mjs`: mode-specific geometry checks and the layout scenario matrix.
- `tests/e2e/mobile-navigation-service-board.spec.mjs`: assert price/action non-overlap without assuming the price must sit below the action.
- `output/service-board-note-layout-report.md`: this report.

A hash comparison against 308 files at the start of this refinement confirmed that only the five existing files above changed. Persistence, API routes, database schema, note editor, pencil mode, validation/25-character limit, save/remove logic, mobile card implementation, sorting/filtering logic, drag/drop handlers, price calculation, customer/job data, and Access Notes were not modified by this refinement. Test fixtures use isolated temporary databases.

## 8. Checks and results

- `npm run build`: passed.
- `npm run lint`: passed.
- `git -c core.safecrlf=false diff --check`: passed.
- Full `service-board-controls.spec.mjs`: **30 passed**.
- Selected responsive tests in `mobile-navigation-service-board.spec.mjs`: **5 passed** (mobile core workflow, desktop board, tablet touch board, card containment, and visual density/touch targets).

The new matrix checks 108 combinations: six note/price/indicator cases across three modes, three widths (768, 1024, 1440), and two themes. Cases include no pills, note only, price only, both pills, short and 25-character notes, a five-figure price, indicators present/absent, priority, and Tomorrow actions. Checks cover matching Grid pill geometry, four-pixel inline spacing, visible ellipses, full prices, action clearance, and the removed empty vertical gaps.

Existing tests additionally cover all six themes, editing/removal/persistence, optimistic save and failed-save rollback, concurrent status changes, restoring normal card interactions, mouse/touch dragging, mobile Move controls, sorting/filtering, pagination, Full Screen, and Tomorrow. Responsive regression checks cover phone through wide desktop sizes and long-text/large-amount containment. Screenshots were visually reviewed for Grid, Normal, and Compact, including narrow cards.

Commands used for the final browser runs:

```powershell
npx playwright test --config=playwright.config.mjs --tsconfig=tsconfig.app.json tests/e2e/service-board-controls.spec.mjs
npx playwright test --config=playwright.config.mjs --tsconfig=tsconfig.app.json tests/e2e/mobile-navigation-service-board.spec.mjs --grep 'mobile navigation and one-status|desktop view retains|tablet three-column|Service Board cards respect column padding|visual density preserves'
```

Logs: `test-results/note-layout-build.log`, `test-results/note-layout-lint.log`, `test-results/note-layout-all-controls.log`, and `test-results/note-layout-responsive.log`. Layout screenshots: `test-results/service-board-controls/note-layout-*.png`.
