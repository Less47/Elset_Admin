# Theme preset cleanup and additions

The chooser now contains eight presets in this exact display order:

| Row | Left | Right |
| --- | --- | --- |
| 1 | Elset Classic | Midnight Signal |
| 2 | Copper Dawn | Evergreen Ledger |
| 3 | Studio Rose | Desert Circuit |
| 4 | Harbour Steel | Alpine Frost |

All description paragraphs and their source strings are removed. Each card contains only a miniature UI preview, name and six colour swatches. Cards are 108px high at the nine tested viewport widths, with the existing 58px preview retained. Swatches align beside the name without wrapping. The existing selected outline, keyboard interaction and `aria-pressed` state remain.

The preset grid uses two columns from 768px and one column below that. The surrounding Workspace Preview moves alongside the controls from 1536px, leaving enough width for two compact preset cards on smaller desktops. Below 1536px, Workspace Preview follows the controls.

## Files changed for this request

- `src/lib/theme-presets.js`: reorder existing presets, remove descriptions and add the two stable IDs and palettes.
- `src/lib/theme-tokens.js`: add text palettes for the two new surface seeds; retain the shared semantic status system.
- `src/components/settings/SettingsManager.jsx`: compact preview/name/swatches cards and responsive chooser spacing.
- `tests/theme-tokens.test.js`: lock the eight IDs/order and original six colour palettes; existing contrast/schema checks automatically cover both additions.
- `tests/e2e/theme-settings.spec.mjs`: chooser layout, exact rendered names, new-theme persistence/reset, seven light-theme surfaces, and rapid switching through all eight presets.
- `tests/e2e/google-map-markers.spec.mjs`: find Midnight by stable ID instead of its former array position, preserving light/dark map-switch coverage after reordering.
- `docs/theme-preset-cleanup.md`: this report.

The earlier Items & Price List changes already present in the working tree are separate from this request.

## Palette values

These are the eleven values saved through the existing personal appearance controls. Both new presets use light mode, including their dialogs.

| Persisted key | Harbour Steel (`harbour-steel`) | Alpine Frost (`alpine-frost`) |
| --- | --- | --- |
| `pageBackgroundStart` | `#DDE5ED` | `#F8FBF9` |
| `pageBackgroundEnd` | `#C5D1DD` | `#EEF6F2` |
| `sidebarSurface` | `#1F2D3A` | `#EAF2EE` |
| `sidebarHeader` | `#152330` | `#DCE9E2` |
| `sidebarActive` | `#305773` | `#D7E6E0` |
| `heroSurface` | `#2B4357` | `#F2F7F4` |
| `actionColor` | `#25647A` | `#2D70B4` |
| `borderColor` | `#7A909F` | `#B8CDC3` |
| `dialogSurface` | `#EAF0F5` | `#F7FBF9` |
| `dataViewSurface` | `#ECF1F5` | `#FCFDFD` |
| `dataViewAccent` | `#618DA8` | `#7CA58F` |

The previews derive colours with the same `buildSemanticTheme()` function as the application. Selected derived values are:

| Semantic token | Harbour Steel | Alpine Frost |
| --- | --- | --- |
| `--foreground` | `#1D3344` | `#243B35` |
| `--text-secondary` | `#3C5363` | `#465E55` |
| `--muted-foreground` | `#485D6C` | `#546863` |
| `--surface-raised` | `#F0F4F7` | `#FDFDFD` |
| `--input-surface` | `#F4F7F9` | `#FDFEFE` |
| `--muted` | `#DAE4EB` | `#EBF2EF` |
| `--surface-hover` | `#D0DDE6` | `#E2EBE7` |
| `--surface-selected` | `#C9D8E2` | `#DCE7E2` |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--ring` | `#25647A` | `#2D70B4` |

Following feedback that the first versions looked too similar, Harbour Steel now combines deeper navy navigation and header areas with stronger steel-blue surfaces. Alpine Frost now has pale sage navigation, near-white content, a frosted green header and clear blue actions. The light versus dark navigation makes their overall silhouettes distinct. Both continue using ELSET's existing semantic status colours and contrast adjustment.

## Saved appearance and Reset UI

All six existing IDs and eleven-colour palettes are unchanged. Appearance is still saved as per-account colour values in the existing preference schema; preset IDs are stable UI identifiers, not a new storage field. No database migration, preference rewrite or automatic default reset was introduced. Customisation, save queuing, legacy Midnight handling and account isolation use the existing code.

Reset UI still calls the existing reset handler and restores Elset Classic plus the existing default UI settings. It leaves shared company and business records unchanged.

Accounts that selected the first version of Harbour Steel or Alpine Frost retain those saved colour values until they select the revised preset. The previous surface/text mappings remain available, preserving the appearance of those saved values. No automatic conversion of saved or customised colours is performed.

## Initial implementation verification

- Focused unit checks: 34 passed, covering tokens, contrast, preference validation/storage and save queues.
- `npm test`: 546 passed, zero failures.
- Focused browser checks: 12 passed, covering the nine widths (320, 390, 768, 820, 1024, 1280, 1440, 1536 and 1920px), both new themes across fresh sessions/reload/reset, and all seven light themes on actual customer surfaces and dropdowns.
- Remaining theme/browser regression checks: 34 passed, including Midnight across six viewport sizes, save queuing/retries, account isolation, refresh/server restart, unchanged Reset UI behaviour and the map theme-switching contract. Together with the focused run, all 45 tests in `theme-settings.spec.mjs` plus the map theme contract passed (46 browser tests, zero failures).
- `npm run lint`: passed.
- `npm run build`: passed; existing advisory for a JavaScript chunk above 500kB remains.
- `git diff --check`: passed.

Browser tests use isolated local fixture databases and authenticated test accounts. The map theme contract uses a Google Maps stub; no live provider acceptance is claimed. Preset screenshots at 320px and 1536px and both new themes on the Customer page were visually inspected. Additional screenshots are under `test-results/theme/`; test logs are `test-results/theme-preset-{unit,focused,regression}.log`.

## Palette revision verification

The revision changes only the two preset palettes, their new text mappings and this report.

- `node --test tests/theme-tokens.test.js`: 13 passed, including contrast and the original six palettes' compatibility.
- Focused Playwright: 3 passed, covering both revised presets across fresh sessions, reload and Reset UI, plus all seven light presets on Customer pages and dropdowns. Log: `test-results/theme-palette-revision.log`.
- Both revised Customer page screenshots were visually inspected: dark steel navigation versus pale sage navigation is clearly visible.
- Lint, build and `git diff --check`: passed. The existing build chunk-size advisory remains.
- The initial full-suite results above are from before this palette-only revision; the focused checks were rerun for the final revised colours.

No commit, push or deployment was performed.
