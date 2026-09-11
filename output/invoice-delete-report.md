Delete Invoice implementation report — 11 September 2026

1. Existing architecture: the shared Document Editor edits an invoice owned by a job at `/jobs/:id/invoice`. SQLite stores invoice headers, line items, payments and send history separately. The existing invoice DELETE endpoint hard-deleted the invoice and cascaded to its children. It had no editor button. Recycle Bin already restored job/customer snapshots; other record types used dedicated archive tables.

2. Sent-state source: persisted `invoice.sentHistory`, backed by `document_send_history` in SQLite. The server checks current history when deletion is requested. If an invoice was sent after the confirmation opened, the server returns `409 INVOICE_ALREADY_SENT`; the editor switches to the stronger confirmation. A locally confirmed email success also strengthens the warning if history saving failed.

3. Placement: a separate Delete invoice section after Email, at the bottom of the saved Invoice Editor. Quotes and unsaved new invoices do not show it. The action is outside Save, Preview and Send controls.

4. Unsent confirmation: a compact existing-style dialog titled “Delete invoice?” explains removal from active invoices and recovery through Recycle Bin. Cancel receives initial focus. Dirty drafts explicitly say unsaved edits will be discarded. Cancel closes the dialog without sending a request.

5. Sent confirmation: “Delete sent invoice?” explicitly warns that the customer already received the invoice and deleting it will not remove their copy. The destructive button reads “Delete Sent Invoice”. Send history and its document/job/template snapshots are archived for recovery.

6. Financial safety: deletion is blocked when any SQLite payment row exists, including zero-value rows. Shared checks also block current payments, legacy paid markers and payment receipt history, including historical snapshots containing payments. This flow provides no override for paid/receipt-bearing invoices. Rejections leave the invoice and financial records intact.

7. Recovery choice: recoverable archival, implemented by the invoice-specific schema 6 `deleted_invoices` table and a matching JSON archive collection. SQLite snapshots and active-record removal happen in one transaction. Archives retain invoice identity, original number/customer, items, dates, notes, history, deletion time and deleting user. Archives remain until restored; no invoice auto-expiry or permanent-delete action was added. Restore requires the original job and refuses to overwrite a current invoice. Linked jobs, quotes, customers, sites, maintenance and other invoices remain intact. Numbering still follows the existing job-based rule. The existing backup importer requires the current schema version; schema 5 backup bundles require migration before use with schema 6.

8. API: `DELETE /api/jobs/:id/invoice` now archives an eligible invoice; sent invoices require JSON `{ "confirmSent": true }`. `POST /api/deleted-invoices/:id/restore` restores it. Both endpoints require the existing admin/office authorization and work in SQLite and JSON modes. Technicians cannot access invoice archives. Responses refresh the existing application state. Success returns to Invoices immediately with “Invoice moved to Recycle Bin”; the archived record disappears from normal billing results. Failures retain the editor and display a safe retryable error. Synchronous UI guards and disabled “Deleting...” controls prevent duplicate requests. JSON archive revisions prevent stale broad autosaves from resurrecting deleted invoices or erasing restored invoices.

9. Files changed for this feature (earlier uncommitted work was preserved):

   Backend: `server-document-routes.js`, new `server-invoice-archive.js`, `server-workspace-documents.js`, `server-workspace-db.js`, `server-workspace-state.js`, `server-workspace-storage.js`, `server-workspace-importer.js`, `server-workspace-backup.js`, `server-store.js`.

   Frontend: new `src/lib/invoice-deletion.js`, `src/App.jsx`, `src/components/app/WorkspaceShell.jsx`, `src/components/documents/DocumentEditor.jsx`, `src/components/recycle-bin/RecycleBinPanel.jsx`, `src/hooks/useWorkspaceActions.js`, `src/hooks/useWorkspaceNavigation.js`, `src/lib/app-support.jsx`.

   Tests: new `tests/invoice-deletion.test.js`, `tests/document-routes.test.js`, `tests/workspace-schema-upgrade.test.js`, `tests/workspace-migration.test.js`, `tests/maintenance-recurrence.test.js`, `tests/workspace-restore-routes.test.js`, `tests/e2e/document-workspaces.spec.mjs`.

10. Coverage: requested cases A–J, plus send-state races, zero-value payment rows, receipt snapshots, database rollback, exact invoice/history recovery, archive export/import and backup restore, missing-job and existing-invoice restore conflicts, schema 5→6 rollback/restart, stale JSON autosaves, authenticated roles, keyboard focus, all six themes, desktop and mobile. Browser fixtures use isolated temporary storage; email regressions use a local SMTP sink. Screenshots are in `test-results/document-workspaces/invoice-delete-*.png` and `invoice-recycle-*.png`. Desktop confirmation, mobile theme dialogs and mobile Recycle Bin were visually inspected.

11. Final validation results:

   - `npm test` — 298 passed, 0 failed.
   - `npm run lint` — passed, exit code 0.
   - `npm run build` — passed, exit code 0. Vite reports the existing advisory for chunks over 500 kB.
   - `git diff --check` — passed, exit code 0. Git's LF/CRLF notices are advisory; no whitespace errors were reported.
   - `npx playwright test tests/e2e/document-workspaces.spec.mjs tests/e2e/invoice-job-status-filter.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1` — 51 passed, including 13 new SQLite deletion tests and the existing document/email/PDF/navigation/payment/filter regressions.
   - JSON mode: set `$env:ELSET_DOCUMENT_E2E_STORAGE='json'`, run `npx playwright test tests/e2e/document-workspaces.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1 --grep 'invoice deletion'`, then `Remove-Item Env:ELSET_DOCUMENT_E2E_STORAGE` — 14 passed.

   Logs: `output/invoice-delete-unit.log`, `output/invoice-delete-lint.log`, `output/invoice-delete-build.log`, `output/invoice-delete-diff-check.log`, `output/invoice-delete-regressions.log`, `output/invoice-delete-json-browser.log`.

   Final diff audit confirmed that this feature adds no invoice/GST/payment calculations, numbering changes, PDF/email changes, auth-schema changes, or unrelated schema changes. Earlier Site OC, Create Job contact, email feedback and Job Status filter work remains in the working tree. Nothing is staged.

No commit, push or deployment was performed.
