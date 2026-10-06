# Customer, site and contact model

Schema **15**, migration **`contact-relationship-model`**, separates people from the accounts and locations where they are used.

| Concept | Responsibility |
| --- | --- |
| Customer | The business account; account email and phone remain valid billing fallbacks. |
| Site | A physical location owned by a customer. |
| Contact | One workspace-level person/contact identity: name, phone, email, position, notes and provenance. |
| Customer assignment | Roles, Primary and Billing flags for that account. Multiple billing contacts are allowed. |
| Site assignment | Roles and Primary flag at that location. A site may have no contacts. |
| Job contact | A historical requester, onsite or billing snapshot. Editing a person never updates saved job snapshots. |

## Storage and invariants

New tables are `contacts`, `customer_contact_links` and `site_contact_links`. Assignment primary keys are `(customer_id, contact_id)` and `(site_id, contact_id)`. Owner deletion cascades only to assignments; contact deletion is restricted while any assignment exists.

New indexes:

- `customer_contact_one_primary`: unique `customer_id` where `is_primary = 1`.
- `customer_contact_by_contact`: `contact_id` lookup.
- `site_contact_one_primary`: unique `site_id` where `is_primary = 1`.
- `site_contact_by_contact`: `contact_id` lookup.

Roles are arbitrary strings in assignment `roles_json`, not person job titles. Canonical contact metadata excludes customer/site ownership and assignment flags. Contact IDs are the only identity key: matching names, phone numbers or email addresses never merge people.

Admin/office workspace state contains top-level `contacts`, customer `contactAssignments` and site `contactAssignments`. Nested `customer.contacts` and `site.contacts` are hydrated display projections. Technician state retains its existing assigned-record restriction and does not receive the global directory.

An assignment contains `contactId`, `roles`, `isPrimary` and, for customers, `isBilling`. Forms can include an inline `contact` draft when creating or explicitly editing a person. Owner saves persist the person and assignments in one transaction. Unedited hydrated projections cannot overwrite newer canonical details. Existing-account/site edits and inline job site creation share the same persistence path.

Edit Customer shows the same related Contact identities as the Customer Profile: direct Customer contacts and contacts assigned only to its Sites. Each row labels Customer or Site-only ownership and shows read-only Site names, roles and Primary status. Only direct assignments have Customer roles, Primary/Billing controls and Remove from customer. Assign to customer adds the existing Contact ID to the direct assignment draft; Site links stay intact. Distinct IDs with matching names or phone numbers remain separate rows.

The display list is derived with `getCustomerRelatedContacts`; it is never serialized as Customer ownership. Customer saves still submit only the direct `contactAssignments` draft. Edited existing identities travel separately in a transport-only `contactUpdates` list of ID, name, position, phone, email and notes, applied in the same Customer transaction. Opening or saving without contact changes does not promote Site contacts. Identity edits propagate to other assigned owners through the existing workspace delta, while saved Job contact JSON stays unchanged. Site assignment editing remains on the Site profile. This editor fix requires no migration; the current workspace schema remains **18**.

## Migration and compatibility

Migration 15 runs transactionally with the schema ledger. It seeds legacy identities before building assignments so existing IDs can be reused across customers and sites. It reads `customer_contacts`, older `customers.extra_json.contacts`, raw site fields and `site.contactId` references. A final pass preserves legacy site memberships whose customer differs from the site's owner. Ordinary owner-edit APIs still enforce site ownership.

Legacy contact roles become assignment roles. Existing billing IDs become billing assignments. Raw site contacts become primary site assignments; missing IDs receive deterministic IDs. Empty sites remain empty. Synthetic account placeholders become account fallbacks rather than people; a modified placeholder that contains distinct person details is preserved. Import provenance and unknown person metadata survive in `extra_json`.

The migration does not rewrite jobs, quotes, invoices, payments, send history or accounting mappings. Regression fixtures include populated historical snapshot JSON with intentional whitespace, legacy scalar email recipients, accounting mappings and financial records; original rows are compared exactly before and after migration.

Retained for one compatibility release:

- Legacy `customer_contacts`, including `site_id`, `role` and `kind`.
- `sites.contact_name` and `sites.contact_phone`.
- Old contact-related values in customer/site `extra_json`, including `contacts`, `billingContactId`, `contactId` and `contactEmail` where present.
- Derived response projections: `customer.contacts`, `customer.billingContactId`, `site.contacts`, `site.contactId`, `site.contactName`, `site.contactPhone`, `site.contactEmail`.
- Job `requester_contact_json`, `onsite_contact_json` and `billing_contact_json` remain permanent historical storage, not deprecated fields.

Legacy storage is not dual-written by new forms or record APIs. New inserts leave old site columns blank; updates retain existing legacy columns. The contact compatibility boundary translates old imports and archives into the new tables. Future removal of retained columns/table requires a separate migration after consumers and older backups have been reviewed; no manual data cleanup is required now.

## APIs and lifecycle

All new endpoints use existing authentication and admin/office authorization. Successful writes return updated authorized state.

| Method | Endpoint | Effect |
| --- | --- | --- |
| POST | `/api/contacts` | Create a person. |
| PATCH | `/api/contacts/:contactId` | Edit person details. |
| DELETE | `/api/contacts/:contactId` | Delete an unused person; 409 while assigned. |
| PUT / DELETE | `/api/customers/:id/contacts/:contactId` | Save/remove a customer assignment. |
| PUT / DELETE | `/api/customers/:id/sites/:siteId/contacts/:contactId` | Save/remove a site assignment, validating its customer. |

Each write is transactional and checks foreign keys. Setting Primary clears the previous primary within the same transaction; SQLite also enforces uniqueness. Removing an assignment preserves the person and other assignments. Customer archives include assignment/person projections. Restore reconnects existing IDs, preserves newer shared person details and can recreate a deleted unused person from its archive. Pre-15 archives use the legacy translation boundary. Deleting a site never deletes a person.

## UI, job snapshots and email

Customer Contacts shows compact direct/site-only rows, position, Primary/Billing/role badges and assigned site names. Customer and site forms share an Existing/New contact editor with search by name, phone, email or position, explicit shared-person editing, suggested/custom roles and independent flags. Site Contacts lists the primary person first. All controls have labels and keyboard support; long roles/site names wrap on mobile.

Job pickers group site, customer and billing contacts by purpose. Onsite defaults to the site's primary; requester stays independent. Billing defaults to a primary billing assignment, then another billing assignment in stable ID order, then the account fallback, primary customer contact or first direct contact. Selecting a person copies identity/details/position/context into the job snapshot. Manual job contact edits create custom job details. Viewing an old job with no onsite snapshot can display the current site primary without saving anything.

Email suggestions prioritise current billing contacts, saved job billing, customer primary, requester/onsite, other customer/relevant site contacts and finally account email. Suggestions deduplicate email addresses. Existing default recipients and editable To/CC/BCC behavior are unchanged; suggestions never automatically add recipients.

## ServiceM8 and backup/restore

ServiceM8 imports primary and secondary named contacts, using stable provider contact IDs and preserving position, notes, source company/contact UUIDs, import timestamps and raw provider provenance. Root-company contacts become customer assignments; child/site-company contacts become site assignments. Existing local assignments survive merges and imports with contacts disabled. No name/email deduplication or accounting API call is introduced.

JSON export/import preserves canonical people, unassigned people, assignments and their timestamps. New SQLite backups validate all three tables. Old backup bytes/checksum/schema are validated first; migration occurs in an isolated temporary copy before the existing active-database restore procedure. Uploaded bytes and authentication storage are not migrated or copied. Contact/assignment counts, integrity and foreign keys are validated; failed JSON import validation rolls back.

## Regression coverage

`tests/contact-model.test.js` contains 19 focused tests covering schema, atomic rollback, APIs, identity/assignment lifecycle, snapshots, recipients, JSON and schema-14/15 SQLite restore. Migration fixtures cover 15 legacy input shapes: named table contacts, JSON-only contacts, raw name/phone/email, email-only, empty sites, site-only contacts, repeated IDs across sites, cross-customer raw ID references, cross-owner legacy `site_id`, identical values with distinct IDs, account placeholders, account placeholders on sites, named billing defaults, account billing defaults and billing IDs originally owned by another customer. Position/custom roles/provenance are checked alongside these shapes. Pre-15 recycle-bin archives are also covered.

The ServiceM8 route regression preserves primary, secondary and site-only contacts with matching names/emails. Browser coverage exercises desktop/mobile customer and site management, keyboard selection, primary changes, shared-person reuse, job snapshot independence, Settings ServiceM8 import with a local provider stub and Settings backup/restore. Existing customer, site, job, document/email and account suites remain part of validation. All databases/auth users are synthetic temporary fixtures; no production migration or provider/accounting request is needed.

Validation on 2026-09-30: `npm test` passed **799/799**; lint, build and `git diff --check` passed. Across the six relevant Playwright suites and focused reruns, **110 distinct tests passed**, with **14 live Google Maps tests skipped** because they require an enabled local map environment. Earlier browser failures from removed table actions and old contact markup were corrected; responsive fixtures also caught the mobile form footer covering the Add Contact button, which is fixed. Desktop/mobile contact screenshots were inspected. No push, deployment or production mutation was performed.

## Changed files

45 files in this change:

- Schema/state/persistence: `server-contact-schema.js`, `server-workspace-contacts.js`, `server-workspace-db.js`, `server-workspace-state.js`, `server-workspace-storage.js`, `server-workspace-summary.js`, `server-store.js`.
- Record APIs/import/backup: `server-customer-routes.js`, `server-workspace-customers.js`, `server-workspace-jobs.js`, `server-workspace-importer.js`, `server-workspace-backup.js`, `server-servicem8-importer.js`.
- Customer/site UI: `src/components/customers/CustomerFormPage.jsx`, `CustomerPages.jsx`, `CustomerWorkspace.jsx`; `src/components/sites/SiteWorkspace.jsx`.
- Job/shared/settings UI: `src/components/jobs/CreateJobPage.jsx`, `JobDetailsPage.jsx`, `JobRoutePages.jsx`; `src/components/shared/ContactAssignmentsEditor.jsx`, `ContactSnapshotEditor.jsx`; `src/components/settings/SettingsManager.jsx`; `src/index.css`.
- Frontend helpers: `src/lib/contact-model.js`, `src/lib/app-support.jsx`, `src/lib/document-email.js`.
- Unit/integration tests: `tests/contact-model.test.js`, `accounting-webhook-leases.test.js`, `document-email-composer.test.js`, `maintenance-recurrence.test.js`, `price-list.test.js`, `quickbooks-migration.test.js`, `servicem8-import-routes.test.js`, `workspace-migration.test.js`, `workspace-schema-upgrade.test.js`, `xero-accounting.test.js`, `xero-payments.test.js`.
- Browser tests/fixtures: `tests/e2e/create-job-contact.spec.mjs`, `customer-sqlite-workflow.spec.mjs`, `customer-workspaces.spec.mjs`, `document-workspaces.spec.mjs`; `tests/fixtures/create-job-contact.jsx`, `servicem8-fetch-stub.mjs`.
- This architecture note: `docs/contact-relationship-model.md`.
