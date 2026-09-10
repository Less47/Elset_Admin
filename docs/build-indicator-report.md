ELSET Admin build indicator - 10 September 2026

1. **Existing implementation.** `BuildIndicator.jsx` was already shared by the desktop sidebar and mobile navigation drawer. It displayed `ELSET Admin`, package version `v0.0.0`, and a seven-character commit. `scripts/build-metadata.mjs` read the package version and Git revision; Vite embedded its public object as `__ELSET_BUILD__`. `server-app.js` serves the resulting `dist` assets, with no build-metadata endpoint or runtime lookup.

2. **Existing SHA flow, audited before edits.** `package.json` maps `npm run deploy:fly` to `node scripts/deploy-fly.mjs`. The script called the metadata utility, which preferred a validated `ELSET_BUILD_SHA` CI override, otherwise ran `git rev-parse --verify HEAD`. It shortened the revision before passing `--build-arg ELSET_BUILD_SHA=...` to `flyctl deploy`. Docker declared `ARG ELSET_BUILD_SHA` and ran `ELSET_REQUIRE_BUILD_SHA=true npm run build`. That guard rejected missing or malformed explicit metadata because `.dockerignore` excludes `.git`. Vite then embedded `{ version, commit }` into the bundle consumed by the indicator. There was no dirty-working-tree check; the script could include uncommitted files while displaying HEAD. That behavior is preserved. The normal workflow remains commit, push, deploy.

3. **Build timestamp.** Added `ELSET_BUILD_TIME`, validated and normalized as UTC ISO 8601, for example `2026-09-10T05:42:00.000Z`. The shared metadata object is now `{ version, commit, sha, buildTime }`: `commit` retains the seven-character display identifier, while `sha` retains the full supplied revision. Only these public fields are embedded. Invalid timestamps are omitted locally and rejected by the production guard. The indicator formats the injected instant; it never generates the current time.

4. **Deployment command.** The package script and deployment architecture are unchanged. `deploy-fly.mjs` now captures the current UTC time once at deployment start and supplies both Docker build arguments automatically. It generates a fresh timestamp even when deploying the same commit again or an old timestamp exists in the calling environment. The existing CI SHA override, extra Fly arguments, exit codes and launcher-error handling remain intact. No package-version mutation, Git write operation or new dirty-tree policy was added.

5. **Docker/build changes.** Added `ARG ELSET_BUILD_TIME` beside the existing SHA argument. The existing guarded Vite build now validates both. A changed timestamp also changes the build input for redeploys of the same source. No Fly configuration, secrets, runtime metadata endpoint or server implementation changed. Docker is unavailable in this environment, so an actual image build was not run; verification exercised the same guarded Vite build command locally and tested the exact Fly argument array with a stub launcher. No real Fly command ran.

6. **Final indicator.** Expanded sidebar and drawer: `ELSET Admin`, then `a31f82e · 10 Sept 2026 3:42 pm` in the tested Australian locale. Formatting follows the browser's locale and local timezone. The existing narrow sidebar stacks the short SHA, compact date such as `10/09/26`, and time. Hover details include the full supplied SHA, canonical UTC timestamp and package version. The sidebar width is unchanged. An already-open tab or cached bundle still identifies the assets it loaded until refreshed; this change does not force browsers to reload.

7. **Local development.** With no build timestamp, the expanded indicator shows the available short Git SHA and `Local development`; the narrow sidebar uses `dev`. Without Git, only the development fallback is shown. Local Vite startup and ordinary local builds do not require production metadata. The production Docker guard requires both SHA and timestamp.

8. **Files changed for this task.**

- [scripts/build-metadata.mjs](../scripts/build-metadata.mjs): full/short SHA and validated UTC time allowlist.
- [scripts/deploy-fly.mjs](../scripts/deploy-fly.mjs): capture the deployment timestamp once and forward both arguments.
- [Dockerfile](../Dockerfile): timestamp build argument.
- [src/lib/build-info.js](../src/lib/build-info.js): shared frontend object and localized formatting.
- [src/components/app/BuildIndicator.jsx](../src/components/app/BuildIndicator.jsx): compact SHA/time display, development fallback and hover details.
- [tests/build-metadata.test.js](../tests/build-metadata.test.js): metadata, validation, deployment forwarding, same-commit redeploy and timezone coverage.
- [tests/e2e/mobile-navigation-service-board.spec.mjs](../tests/e2e/mobile-navigation-service-board.spec.mjs): updated indicator checks, actual narrow-sidebar preference fixture, timestamp stability and responsive screenshots.
- [README.md](../README.md): updated metadata/deployment documentation.
- This report.

The prior theme-overhaul edits remain in the working tree. They are separate from the files/changes described above. `package.json`, `vite.config.js`, Fly configuration, production data, auth, preferences implementation, Maintenance, Calendar and business logic received no changes for this task.

9. **Test results.**

- `npm test`: **256 passed, zero failures**, including all 13 build-metadata tests. [Log](../test-results/build-indicator/unit-tests.log).
- `npm run lint`: **passed**. [Log](../test-results/build-indicator/lint.log).
- Two separate guarded Vite builds: **passed**, using synthetic metadata A (`a31f82e...`, `2026-09-10T05:42:00.000Z`) and B (`b42e93f...`, `2026-09-11T06:43:00.000Z`). The indicator source was unchanged between builds. [Build A](../test-results/build-indicator/build-a-build.log), [build B](../test-results/build-indicator/build-b-build.log).
- The existing responsive indicator browser test ran successfully against **both bundles and a third local fallback build**, for **15 viewport/build combinations**: 1440x900, 1280x720 with the narrow sidebar, 390x844, 375x667 with safe-area insets, and 820x1180. Verified displayed SHA/date/time, full SHA details, no indicator or page overflow, compact height, navigation, sign-out and mobile drawer behavior. Moving the browser clock to 2040 leaves the build timestamp unchanged. [A browser log](../test-results/build-indicator/build-a-browser.log), [B browser log](../test-results/build-indicator/build-b-browser.log), [local browser log](../test-results/build-indicator/local-browser.log).
- Missing SHA and missing timestamp each failed an actual guarded Vite build with the expected actionable error. [SHA rejection](../test-results/build-indicator/reject-missing-sha.log), [timestamp rejection](../test-results/build-indicator/reject-missing-time.log).
- Local Vite development server started without production metadata and returned HTTP 200 for the page, indicator module and shared build-info module. [Development log](../test-results/build-indicator/vite-development.log).
- `git diff --check`: **passed**. Production builds retain the pre-existing large-bundle warning.

Screenshots: [build A desktop](../test-results/mobile-service-board/build-indicator-a31f82e-2026-09-10T05-42-00.000Z-1440x900.png), [build B narrow sidebar](../test-results/mobile-service-board/build-indicator-b42e93f-2026-09-11T06-43-00.000Z-1280x720.png), [build B mobile drawer](../test-results/mobile-service-board/build-indicator-b42e93f-2026-09-11T06-43-00.000Z-390x844.png), [local development mobile](../test-results/mobile-service-board/build-indicator-local-375x667.png). Full captures for all 15 combinations are under `test-results/mobile-service-board/build-indicator-{build-label}-{width}x{height}.png`.

No commit, push, merge or deployment was performed.
