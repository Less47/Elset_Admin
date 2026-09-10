# Automatic workspace schema upgrade

Implemented and verified locally against isolated temporary databases. No production database was opened or modified. No commit, push, or deployment was performed; Fly configuration, application UI, Maintenance recurrence behavior, and authentication schema code were not changed.

1. **Exact v5 change.** Commit `d6bbe71` introduced workspace schema 5 for Maintenance recurrence exceptions. The existing migration creates `maintenance_occurrence_exceptions` with `occurrence_key` as its primary key; `plan_id`, `series_id`, `original_date`, `override_date`, `job_id`, `generated_job_id`, `completed_at`, `snapshot_json`, `created_at`, and `updated_at` columns; uniqueness on `(plan_id, series_id, original_date)`; a cascading plan foreign key; and a job foreign key using `ON DELETE SET NULL`. It creates `idx_maintenance_exception_plan`, `idx_maintenance_exception_date`, and the partial unique `idx_maintenance_exception_job` index for non-null job IDs. Per-user preferences use separate tables in `auth.db` and did not introduce workspace v5.

2. **Why production crashed.** `server.js` called `assertProductionWorkspaceStorageReady()` before listening. Its `assertSqliteWorkspaceReady()` opened the database with `readonly: true, migrate: false` and demanded `workspace_info.schema_version === 5`. A valid v4 database therefore failed before any connection could apply the already-defined v5 migration. This exact compatibility failure is reproduced before initialization in the new regression test.

3. **Previous migration behavior.** `migrateWorkspaceSchema()` already applied missing migration SQL and recorded the migration ledger plus `PRAGMA user_version` inside a transaction. Writable `openWorkspaceDb()` calls and the JSON importer invoked it, but production readiness did not. The runner trusted ledger membership without checking contiguous history or agreement with `workspace_info` and `user_version`. Fresh bootstrap also left the `workspace_info` singleton absent until JSON import. The old recurrence migration test manufactured v4 by dropping the v5 table and ledger entry without resetting `workspace_info`; that test now keeps all version markers consistent, and the new production regression uses an actual historical schema fixture.

4. **Startup order.** The normal `server.js` entry point now calls `initializeWorkspaceStorage()` before awaiting authentication readiness and creating/listening on the server. The initializer validates the storage mode and persistent directory, opens the existing mounted workspace DB, invokes the shared migration runner, closes the writable connection, and runs the strict read-only final assertion. Health checks continue to use the read-only assertion and never trigger migrations. This runs on the normal application machine against `/app/data/elset-workspace.db`; no `release_command` or Fly configuration change is involved.

5. **Exact 4 → 5 implementation.** The existing v5 SQL is retained unchanged. The repaired runner validates the three version sources and existing required schema objects, verifies integrity and foreign keys, applies the v5 table/index SQL, records migration 5, and sets `user_version` to 5. The v5 SQL updates `workspace_info.schema_version` to 5. It verifies the resulting metadata, required tables/indexes, exception-table columns, integrity, and foreign keys before committing. The normal strict readiness assertion runs again afterward. Existing business rows and recurrence JSON are not transformed, rebuilt, re-imported, or backfilled.

6. **Transaction and restart safety.** `BEGIN IMMEDIATE` acquires the write lock before inspecting versions, so concurrent initializers cannot independently decide to apply the same migration. All pending migrations, their DDL, the version row, the ledger entries, and `user_version` commit together. An injected failure while recording migration 5 rolls back the new table/indexes and restores every version marker. The tests cover both 4 → 5 and 3 → 4 → 5 failure, including rollback of the v4 changes in the latter case. A successful restart validates v5 without additional migration entries, metadata changes, or migration logging. Failed opens close their connection. Startup logs contain only versions and progress:

   ```text
   Workspace database schema: 4
   Migrating workspace schema 4 -> 5
   Workspace schema migration complete: 5
   ```

7. **Fresh DB behavior.** An explicitly created fresh database runs the known migrations through v5 and now has complete, consistent metadata immediately. The JSON importer updates this bootstrap singleton while retaining its existing non-empty-workspace/duplicate-import guard and import transaction. Fresh bootstrap, import counts/totals, malformed input, failed-import rollback, and duplicate-import rejection all pass. Production startup still refuses a missing persistent directory or database file; `fileMustExist` prevents a missing production DB from being silently recreated during startup.

8. **Existing DB behavior and preservation.** Valid v4 upgrades to v5; valid v3 upgrades sequentially through v4; valid v5 validates without migration. A newer version reported by any metadata source, gaps or disagreement in migration history, missing metadata, an unrelated database, missing required schema objects, and foreign-key violations fail startup. The preservation fixture populates every business table in the historical v4 schema, including customers, sites, contacts, assets, access notes, staff, maintenance plans/checklists/recurrence JSON, jobs/notes/attachments, quotes and invoices with line items, payments, document snapshots, settings, templates, inventory, archives, and external references. Before/after comparisons verify every pre-existing row. Only the workspace schema version changes and migration 5 is appended; the new exception table starts empty. Workspace account references remain intact, and a separate temporary `auth.db` containing preferences remains byte-for-byte unchanged during workspace initialization.

9. **Files changed.**

   - `server-workspace-db.js`: shared schema/integrity validation, sequential atomic migration runner, immediate lock, complete fresh metadata, and failed-open cleanup.
   - `server-workspace-storage.js`: startup initialization, persistent-file checks, and separate read-only readiness assertions.
   - `server.js`: initialize workspace storage before final server startup.
   - `server-workspace-importer.js`: populate the bootstrap metadata singleton without changing duplicate-import protection.
   - `fixtures/workspace-schema-v4.sql`: frozen v1–v4 definitions from `cbde92f:server-workspace-db.js`, with historical migration metadata. Tests do not require Git or create a v5 schema and downgrade it to obtain this fixture.
   - `tests/workspace-schema-upgrade.test.js`: new upgrade, preservation, failure, concurrency, and real startup regression tests.
   - `tests/maintenance-recurrence.test.js`: correct the existing legacy simulation's metadata consistency.
   - This report.

10. **Tests added.** Seventeen new tests cover populated v4 startup and restart; sequential v3 upgrade; transactional failures from v3 and v4 and successful retry; newer versions in each metadata source; ledger gaps; mismatched/missing metadata; unknown and damaged schemas; foreign-key failure; fresh bootstrap and refusal to create missing production storage; continued exception/job functionality; concurrent initializers applying migration 5 once; and a real production-mode `server.js` child process returning healthy SQLite storage after migration completes and before serving requests. The feature test moves one visit, verifies the later six-month dates stay unchanged, then generates a job linked through the new exception table.

11. **Exact results.**

   | Check | Result |
   | --- | --- |
   | `node --test tests/workspace-schema-upgrade.test.js tests/workspace-migration.test.js` | 35 passed, 0 failed; 3,594 ms |
   | `npm test` | 243 passed, 0 failed; 13,589 ms |
   | `npm run lint` | Passed, no findings |
   | `git diff --check` | Passed |

   The full suite includes current Maintenance recurrence/API, customer/site, jobs, documents/payments, settings, user preferences, workspace migration, backup, and restore regressions. Logs are saved locally as `test-results/workspace-schema-upgrade-focused.log`, `test-results/workspace-schema-upgrade-full.log`, and `test-results/workspace-schema-upgrade-lint.log`. No frontend files changed, so browser/layout tests were not rerun. Production remains on the user's existing image until a separately authorized deployment.
