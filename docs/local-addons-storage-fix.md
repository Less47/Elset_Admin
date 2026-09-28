# Local Add-ons disabled: storage audit and fix

Historical incident report, superseded by [SQLite-only workspace runtime](sqlite-only-runtime-report.md). The September 2026 local incident involved a workspace that had not yet been migrated. That environment was explicitly migrated offline and validated; production was not changed during the incident.

Current runtime behavior requires an existing, valid SQLite database. Add-ons use record-specific SQLite APIs; their switches still respect loading, saving, permissions and provider mutual exclusion. The old storage-engine selection, JSON API fallback and storage-dependent switch explanation have been removed.

Historical verification records are available in Git history. They are not operational instructions for the SQLite-only runtime.
