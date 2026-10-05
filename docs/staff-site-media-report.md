# Staff profile photos and Site photo galleries

Implemented locally on 6 October 2026. The working tree was clean before work began. No prior migration SQL was edited.

## Storage and migration

Workspace schema **16 -> 17** adds one forward migration, `staff-site-media-explicit-job-site`.

Existing Job photos live as data URLs in `job_attachments` inside SQLite; there is no separate general file store. The existing `sharp` dependency already handles branding images. New media therefore shares SQLite persistence and image processing rather than adding a filesystem, cloud bucket, or backup system. Job attachments remain unchanged.

The new `workspace_media` table stores stable IDs, `staff`/`site` ownership, display filenames, WebP MIME type, byte size, caption, uploader display name, upload date, optimized image BLOB, and thumbnail BLOB. Neither Staff nor Site JSON contains image bytes. Staff references are derived from the owned media row; a partial unique index permits one current avatar per Staff member. Owner indexes support metadata listings. An insert trigger requires a live owner.

The same migration adds nullable `jobs.site_id`, a Site foreign key with `ON DELETE SET NULL`, an index, and insert/update triggers requiring the Site and Job to belong to the same Customer. Existing Jobs receive NULL; there is no address backfill or copying of Job photos.

## Explicit Site linking and Job history

Create Job sends the ID only for an actual persisted Saved Site. Inferred primary addresses and previous job addresses supply no Site ID. Inline Site creation links the Job to the newly created Site ID. Job editing links only when a persisted Saved Site is selected; free address editing clears the link. Both server validation and database triggers reject foreign Customer ownership. Maintenance generation carries its plan's already explicit Site ID into the Job; address-only plans remain unlinked. Deleted Job restoration clears a link if its Site no longer exists.

The gallery queries Site media and `job_attachments` joined through `jobs.site_id` and Customer ownership. It lists Job number, date, title, filename, and Open Job. Job images remain Job-owned and read-only in this gallery. Removing a Site photo cannot delete or unlink a Job attachment. The pre-existing address-based Job History section is unchanged; the new Photos tab uses explicit IDs exclusively.

## Uploads, serving, and limits

| Item | Behavior |
| --- | --- |
| Accepted uploads | Static JPEG, PNG, WebP |
| Staff input limit | 2 MiB per file |
| Site input limit | 8 MiB per file; multiple files upload sequentially |
| Decode limit | 24 megapixels; at most 12,000 pixels per side; animation rejected |
| Staff image | Optimized WebP, up to 512 x 512; 96 x 96 thumbnail |
| Site image | Optimized WebP, fits inside 2048 x 2048; 320 x 320 thumbnail |
| Stored bounds | Image at most 8 MiB; thumbnail at most 256 KiB |
| Caption | Optional, at most 240 characters |

Server validation checks request MIME, magic bytes, filename extension when supplied, byte size, and successful `sharp` decoding. Re-encoding applies EXIF rotation and strips embedded metadata. Executables, disguised content, corrupt images, excessive dimensions, and unsupported formats fail before persistence. Avatar replacement deletes and inserts in one transaction; decode failure preserves the prior image. Filenames are display metadata, sanitized and bounded, never filesystem paths.

Authenticated image endpoints recheck live owner access and use `private, no-store` plus `nosniff`. Upload authorization runs before bounded raw-body parsing. The database is reopened and ownership revalidated after asynchronous decoding, preventing upload into a stale database after restore or owner deletion. Media mutation responses return only the affected metadata/acknowledgement, never the full workspace or image bytes.

Existing Job thumbnails are generated on demand from bounded JPEG/PNG/WebP data URLs. Full-size requests serve the existing bytes, without copying them. Remote URLs and filesystem paths are never fetched or read by the gallery.

## Permissions and deletion

Admin and Office can upload, change, remove, caption, and view Staff/Site media. Technicians cannot mutate either. Existing Technician policy exposes all active Jobs; Site media is readable only when one of those accessible active Jobs explicitly links to the Site. An unrelated Site with no such Job is denied. Staff avatars are readable for the Technician's own Staff record and Staff assigned to accessible active Jobs. Anonymous image requests receive 401; unauthorized roles and unrelated owners are rejected. Existing Job photo mutation permissions are unchanged.

Staff archive and Customer archive retain media BLOBs because their restore workflow recreates the same owner IDs. Images cannot be served while the owner is archived. Restore makes the retained images accessible again. Permanent Site removal deletes its media in the same transaction and clears linked Jobs through the foreign key; the scoped response refreshes those Job links. Emptying the Customer recycle bin removes media for its archived Sites. Staff currently has archive/restore, with no permanent empty-bin workflow. Replacing or removing a current avatar removes its old media row immediately. SQLite reuses deleted pages under its existing policy; this feature adds no VACUUM operation.

## Backup and restore

Metadata, optimized images, thumbnails, and explicit Job links are all in the workspace database. The existing online SQLite snapshot, checksum validation, staged migration, and confirmed restore include them together. Backup validation expects `workspace_media` after migration, and its summary reports media count. Legacy backups migrate forward using the existing restore flow. A test restores actual BLOB and thumbnail bytes and verifies explicit links. No new backup system or binary folder is required.

## UI and performance

Staff editing has a compact Profile Photo area with upload/change/remove, current preview, error handling, and clear immediate-save wording. New Staff must be created before a photo is uploaded. Shared circular avatars fall back to initials when missing or unavailable. They appear in Staff lists/profile, Create Job and Edit Job assignment choices, the assigned Job technician display, and Maintenance default technician display. The client normalizer now preserves technician assignments across reload, allowing the derived avatar to survive refresh.

The saved Site profile has a Photos tab with All / Site Photos / Job Photos filters, multi-upload, uploader/date metadata, short captions, removal confirmation for Site media, and the existing dialog viewer. Linked Job Notes also provides the gallery so Technicians can view it without gaining Site management access. Missing images show an unavailable state with their source context.

Gallery responses contain metadata only, 30 photos per page (server maximum 60), with Load more. Thumbnails load lazily; full-size endpoint requests occur only when a viewer opens. Grids use 2 / 3 / 5 columns across mobile/tablet/desktop. Dialogs constrain height and scroll on small screens. Initial loading, failures, partial multi-upload success, and retry are handled.

## Verification

| Check | Observed result |
| --- | --- |
| Focused media, Staff, Customer, explicit Site, delta, migration tests | 75 passed, 0 failed; includes 31 dedicated media tests |
| Full `npm.cmd test` | 941 passed, 0 failed, 0 skipped |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed |
| `git diff --check` | Passed; only Git's routine LF/CRLF notices |
| Isolated `npm.cmd start` | Synthetic schema 16 migrated to 17 before listening; health OK; anonymous media 401; owned process stopped |
| Relevant Playwright | 71 passed, 0 failed across media, Customer workspace, SQLite workflows, Create Job contacts, and Maintenance service |

Node coverage includes all three formats for both owner types, spoof/corrupt/executable/size/decode rejection, persistence, atomic replacement, removal, permissions, inaccessible serving, captions, multiple uploads, explicit gallery membership and exclusions, deletion isolation, pagination, unsafe legacy URLs, scoped responses, archive/restore/cleanup, backup bytes, migration rollback and idempotence.

Browser coverage includes Staff upload/change/remove and persistence, fallback, Site multi-upload/caption/removal/filters/viewer, correct Open Job, assigned avatars, paging, thumbnail URLs and lazy loading, no full-size image requests before viewer opening, missing media, Technician read-only access, and existing Customer/Job/Staff/Maintenance workflows.

Visual review at 390, 820, and 1440 pixels covers Staff profile with/without image, Staff list with image/initials, Site-owned photos, Job photo history, upload controls, and full-size viewer. Measured horizontal overflow assertions pass. Local screenshots are in `test-results/media-visual`; they use synthetic gate imagery and fixture themes, not customer photos.

## Changed files

| Area | Files |
| --- | --- |
| New media server | `server-workspace-media-schema.js`, `server-workspace-media.js`, `server-workspace-media-routes.js` |
| Server integration | `server-app.js`, `server-store.js`, `server-workspace-db.js`, `server-workspace-state.js`, `server-workspace-staff.js`, `server-workspace-customers.js`, `server-workspace-jobs.js`, `server-workspace-maintenance.js`, `server-workspace-importer.js`, `server-workspace-delta.js`, `server-workspace-backup.js`, `server-workspace-summary.js` |
| New shared/client media | `src/lib/workspace-media.js`, `src/components/shared/StaffAvatar.jsx`, `src/components/shared/StaffIdentity.jsx`, `src/components/staff/StaffPhotoEditor.jsx`, `src/components/sites/SitePhotoGallery.jsx` |
| UI integration | `src/components/app/WorkspaceShell.jsx`, `src/components/customers/CustomerPages.jsx`, `src/components/staff/StaffManager.jsx`, `src/components/sites/SiteWorkspace.jsx`, `src/components/jobs/CreateJobPage.jsx`, `src/components/jobs/JobDetailsPage.jsx`, `src/components/jobs/JobRoutePages.jsx`, `src/components/maintenance/MaintenancePlanPage.jsx`, `src/hooks/useWorkspaceActions.js`, `src/lib/app-support.jsx` |
| New media tests | `tests/workspace-media.test.js`, `tests/e2e/workspace-media.spec.mjs`, `tests/helpers/workspace-media-schema.js` |
| Existing fixture/schema assertions | `tests/workspace-schema-upgrade.test.js`, `tests/workspace-migration.test.js`, `tests/create-job-sites.test.js`, `tests/contact-model.test.js`, `tests/maintenance-service.test.js`, `tests/maintenance-recurrence.test.js`, `tests/price-list.test.js`, `tests/quickbooks-migration.test.js`, `tests/accounting-webhook-leases.test.js`, `tests/xero-accounting.test.js`, `tests/xero-payments.test.js`, `tests/e2e/customer-workspaces.spec.mjs` |
| Report | `docs/staff-site-media-report.md` |

Accounting test changes only reconstruct old schema fixtures or update current version expectations; accounting runtime behavior was not changed. Maintenance's runtime addition carries the already explicit Site ID to generated Jobs; checklist/report architecture is unchanged.

## Known limitations

- Older unlinked Jobs remain excluded until a permitted user explicitly selects a saved Site and saves the Job. Address equality does not establish gallery ownership.
- New Staff/Site uploads retain optimized images, not original camera files. Job attachments remain in their existing format.
- Legacy Job images in remote URLs, filesystem paths, unsupported formats, or above the 8 MiB gallery serving limit show unavailable; Open Job remains available. Job thumbnails are generated per request without a persistent cache.
- The existing global workspace bootstrap still includes legacy Job data URLs. The new gallery adds only paginated metadata and thumbnail requests; a broader bootstrap/Job attachment refactor was kept outside this feature.
- SQLite grows with media. Existing 200 MiB SQLite backup and 275 MiB JSON restore-payload limits remain unchanged.
- Offset pagination is deterministic for a stable dataset; concurrent uploads/deletions can shift pages. There is no tagging, previous/next viewer navigation, or batch transaction spanning multiple uploads. Partial upload success is reported.

## Delivery boundaries

No Job photos were duplicated into Site storage. No fuzzy address matching was used for linking or gallery inclusion. No production data was changed. No real customer emails were sent. Nothing was pushed or deployed. One local commit is created only after all required checks pass; its hash is provided in the delivery message.
