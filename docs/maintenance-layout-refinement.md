# Maintenance dashboard layout refinement

Completed 10 September 2026. This pass changes dashboard presentation only. Recurrence, Calendar integration, job generation, Due Queue and contract calculations, plan details, storage, APIs and permissions retain their existing behavior. All verification used temporary fixture databases. Changes remain local and uncommitted; no push, merge or deployment was performed.

1. **Previous proportions.** The grid used `minmax(0, 1fr) 300px` with a 16px gap, reduced the rail to 260px below 1200px, and stacked below 901px. At 1920px with the standard sidebar, the list was 1280px and the rail 300px: approximately 81% / 19% of the column area. A separate white five-stat strip and visible list heading added vertical space.

2. **New proportions.** The grid uses `minmax(0, 1fr) clamp(320px, 26%, 380px)` with a 12px gap and `align-items: start`. At 1920px it measures 1204px / 380px, approximately 76% / 24%. Plan cards and Due Queue start at the same vertical position. Card gaps remain 10px; toolbar-to-content spacing is 12px. The visible heading is replaced by an `sr-only` semantic heading.

3. **Due Queue width strategy.** The rail grows with the available dashboard width, stays between 320px and 380px, and retains natural content height. Below 900px of actual dashboard space, the columns stack so the rail does not squeeze plan content. The 320px minimum takes priority over percentage proportions on narrower desktops.

   | Viewport | Previous list / rail | Final list / rail | Final card height |
   | --- | --- | --- | --- |
   | 1920 × 1080 | 1280px / 300px | 1204px / 380px | 166px, unchanged |
   | 1440 × 900 | 800px / 300px | 784px / 320px | 166px, unchanged |
   | 1280 × 720 | 640px / 300px | 624px / 320px | 166px, unchanged |
   | 1024 × 768 | 424px / 260px | 700px, stacked | 166px, previously 210px |
   | 820 × 1180 | 788px, stacked | 788px, stacked | 166px, unchanged |
   | 390 × 844 | 366px, stacked | 366px, stacked | 217px, unchanged |

   Measurements use the standard sidebar, comfortable density and the same four fixture plans. Heights refer to the first fixture card.

4. **Statistics inside the toolbar.** The standalone white strip is removed. Plans, Overdue, Due Soon, Active and Contract now form a compact semantic definition list inside the existing themed toolbar. Small uppercase labels, tabular values and subtle separators replace the large boxes. The full “Active jobs” and “Contract value” labels remain available to screen readers. Calculations are unchanged. The shared controls gained optional content slots; pages that do not supply them retain their existing markup and layout.

5. **Responsive toolbar.** With at least 1260px of dashboard space, desktop controls, centered metrics and Add Maintenance Plan share one row. On narrower desktops, metrics occupy the second row inside the same toolbar. At tablet widths with at least 680px of dashboard space, the existing search/filter/sort/add controls also fit on one row, followed by metrics. Smaller screens retain the established stacked mobile controls and filter sheet. The full toolbar measures 82px at 1920px, 137px at 1440/1280px, 125px at 1024/820px and 221px on the 390px phone, including all statistics. The first desktop card moves upward by approximately 70–125px because the separate strip and heading are gone.

6. **Theme contrast.** Toolbar labels and values use Maintenance-scoped foreground variables selected from the existing app light/dark foreground colours using relative luminance against the user's toolbar colour. This corrects the Classic blue toolbar's weak white text without changing global theme behavior. Labels are muted only when there is enough contrast. Due Queue uses paired `--card` / `--card-foreground`, `--muted-foreground`, and existing border tokens. No list heading or result count remains visibly floating on the workspace gradient. Minimum measured metric contrast was 5.01:1 across all six presets and a custom light toolbar; Midnight Signal measured 14.74:1. Due Queue heading contrast was 19.80:1 in those presets.

7. **Files changed in this pass.**

   - [`MaintenanceManager.jsx`](../src/components/maintenance/MaintenanceManager.jsx): toolbar summary placement, accessible hidden heading/count, scoped theme foreground selection, Due Queue text classes.
   - [`Maintenance.css`](../src/components/maintenance/Maintenance.css): toolbar/grid proportions, container queries, compact metrics and theme-aware rail styling. Shared plan-detail and card metric styles remain unchanged.
   - [`ResponsivePageControls.jsx`](../src/components/shared/ResponsivePageControls.jsx): optional desktop summary and responsive in-toolbar summary slots.
   - This report. The temporary visual capture script, measurements and logs are under the ignored `test-results/maintenance-layout/` directory. No test source or business-logic file was changed in this pass.

   Verification passed: production build; targeted ESLint with no findings; 11 existing page architecture checks; the existing shared-controls browser matrix; and the existing Maintenance dashboard/detail/edit browser smoke test. The visual capture checked 17 viewport/theme combinations, with zero horizontal page or inspected component overflow. It also exercised search, clear search and the phone filter sheet. Vite emitted its bundle-size advisory. No broad business-logic test rerun was needed for this presentation-only change.

8. **Screenshots captured.** Twelve baseline screenshots and seventeen final screenshots are saved under `test-results/maintenance-layout/`. Final screenshots cover all six requested sizes in Classic and Midnight Signal, plus the four remaining presets and a custom light toolbar at 1440 × 900.

   | Viewport | Classic | Midnight Signal |
   | --- | --- | --- |
   | 1920 × 1080 | [View](../test-results/maintenance-layout/after/elset-1920x1080.png) | [View](../test-results/maintenance-layout/after/midnight-signal-1920x1080.png) |
   | 1440 × 900 | [View](../test-results/maintenance-layout/after/elset-1440x900.png) | [View](../test-results/maintenance-layout/after/midnight-signal-1440x900.png) |
   | 1280 × 720 | [View](../test-results/maintenance-layout/after/elset-1280x720.png) | [View](../test-results/maintenance-layout/after/midnight-signal-1280x720.png) |
   | 1024 × 768 | [View](../test-results/maintenance-layout/after/elset-1024x768.png) | [View](../test-results/maintenance-layout/after/midnight-signal-1024x768.png) |
   | 820 × 1180 | [View](../test-results/maintenance-layout/after/elset-820x1180.png) | [View](../test-results/maintenance-layout/after/midnight-signal-820x1180.png) |
   | 390 × 844 | [View](../test-results/maintenance-layout/after/elset-390x844.png) | [View](../test-results/maintenance-layout/after/midnight-signal-390x844.png) |

   Additional themes: [Copper Dawn](../test-results/maintenance-layout/after/copper-dawn-1440x900.png), [Evergreen Ledger](../test-results/maintenance-layout/after/evergreen-ledger-1440x900.png), [Studio Rose](../test-results/maintenance-layout/after/studio-rose-1440x900.png), [Desert Circuit](../test-results/maintenance-layout/after/desert-circuit-1440x900.png), [custom light](../test-results/maintenance-layout/after/custom-light-1440x900.png).
