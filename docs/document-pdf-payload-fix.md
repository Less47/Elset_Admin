# Invoice and quote PDF request-size fix

## Scope and evidence

Audited and verified locally on 2026-09-15. No production instance, production request body, or deployed revision was inspected. The reported production stack identifies JSON body parsing, but does not give its configured limit or request byte count. The checkout's actual limit and a reproducible failure are documented below; the exact production body size remains unknown.

PDF layout, calculations, record persistence, sent-history snapshots, and customer/job data are unchanged. Work remains uncommitted and undeployed.

## Request trace

| Operation | Frontend entry | Request | Server path |
| --- | --- | --- | --- |
| Invoice or quote editor preview | `DocumentEditor.previewDocument` -> `handlePreviewDocument` | `POST /api/quotes/preview-pdf` | `generateDocumentPdf` in `quote-pdf.js` |
| Generation, open in new tab, browser PDF download | Same preview request; `response.blob()` becomes a blob URL used by the iframe and new-tab link | Same POST; no separate download endpoint | PDF response with inline filename and `Cache-Control: no-store` |
| Historical sent copy | `handleOpenSentDocumentCopy` | `POST /api/quotes/preview-pdf` | Same renderer; supplied saved job/document/template snapshots |
| Email PDF attachment | `handleSendDocument` | `POST /api/documents/send` | `submitDocumentEmail` -> `generateDocumentPdf` -> Nodemailer |
| Legacy quote email alias | Retained server compatibility route | `POST /api/quotes/send` | Same email handler and renderer |

All are JSON POSTs. Before the fix, preview JSON was:

```js
{
  documentType: "invoice" /* or "quote" */,
  job: fullJob, // includes photos, notes, invoice, quote and their histories
  document: { ...editorDocument, sentHistory: editorDocument.sentHistory || [] },
  template: businessDetailsAndTemplate,
  stampText: ""
}
```

Sending added `emailPurpose` and `emailSettings: { fromEmail, replyToEmail, ccEmail, signature }`. Historical copies merged the saved job snapshot into the full current job, unnecessarily retaining its photos and document records.

## Body parser and middleware order

Both `server.js` and `dev-server.js` use `createServerApp()` in `server-app.js`.

Before this patch, the relevant order was:

1. Better Auth routes/handler.
2. Dedicated workspace-restore JSON parser, 275 MiB (unrelated, unchanged).
3. Global `express.json({ limit: "15mb" })`, **15,728,640 bytes**.
4. PDF/email routes with authentication and admin/office authorization.

Express 5.2.1 delegates JSON parsing to installed body-parser 2.2.2. Its `jsonParser` calls `read`, then raw-body 3.0.2 rejects excessive declared/received bytes with `entity.too.large`, HTTP 413, before the PDF route runs. No separate production `bodyParser.json()` or URL-encoded parser was found. Test harnesses using bare `express.json()` do not configure the production app. The separate workspace-logo upload uses a finite raw-body image parser, not this JSON pipeline.

Express's [body-parser documentation](https://expressjs.com/en/resources/middleware/body-parser/#limit) confirms that configured limits override the 100 KB default and that oversize entities produce 413 errors. The local 15 MiB setting is explicit; a 100 KB production limit cannot be inferred from the supplied stack alone.

The new order registers the complete PDF/email routes before the global parser, with:

```text
requireAuth -> requireRole([admin, office]) -> PDF JSON parser -> existing handler
```

The PDF parser allows **5,242,880 bytes (5 MiB)**, including inflated bodies. The existing global 15 MiB workspace limit is unchanged. This is a deliberate reduction of unnecessary PDF transport, not a global limit increase. Compact requests are about 1 KB in the tested editor fixtures; 172 KB of real line-item content already renders 44 pages. Five MiB gives substantial headroom for editable content without transporting photos/history or disabling limits.

## Size contributors and measurements

The concrete large-data source is **`job.photos[].url`**:

- `src/App.jsx` uses `readFileAsDataUrl()` to build uploaded photo objects.
- `useWorkspaceActions.handleAddJobPhotos()` sends individual photos to SQLite photo endpoints. A job can therefore accumulate a photo total larger than a single request limit.
- The old PDF request subsequently sent every photo together inside `job`.
- Three 4 MiB source images become about **16 MiB of base64 JSON**, exceeding the existing 15 MiB parser.

Additional unnecessary contributors are `job.notes`, both `job.invoice` and `job.quote`, their `sentHistory` arrays, and another copy of the selected document/history at the top level. Histories contain document/job/template snapshots, so repeated sends grow the duplication.

The renderer never uses job photos, attachments or histories. It loads **`public/elset-logo.png` from disk**. Current template construction does not add a base64 company logo. No data URLs were present in the local sample workspace. Extra template/image fields, if present in old data, were previously spread into requests and are now excluded. Preview has no email signature or HTML body; sending includes the configured signature, and the server constructs the email body and PDF attachment.

Only byte counts/field names were examined or printed during the local data audit; no customer values or image contents were logged.

| Evidence | Previous/request bytes | Compact bytes/result |
| --- | ---: | ---: |
| Local sample invoices (13) | 2,661-3,578 | Maximum 1,279 |
| Local sample quotes (26) | 2,099-3,394 | Maximum 1,245 |
| Browser invoice fixture with three 4 MiB photos | 16,780,067 | 1,167; real PDF succeeds |
| Browser quote fixture with same photos | 16,779,950 | 1,033; real PDF succeeds |
| Isolated reproduction against original 15 MiB parser | 16,777,694 -> 413 `entity.too.large` | 263 -> 200 |
| Large invoice with 250 detailed line items | 172,000 | Real 44-page PDF and matching email attachment |
| Large quote with 250 detailed line items | 171,866 | Real 44-page PDF and matching email attachment |

Photo fixtures are synthetic; these numbers are not measurements of the failing production request. If production runs this checkout's parser, the rejected body must exceed 15,728,640 bytes (after decompression where applicable).

## Transport projection and preservation

`buildDocumentPdfPayload()` selects only the inputs actually consumed by the renderer, template context and email composition:

- Job: `id`, `jobNumber`, `title`, `description`, `customerName`, `customerEmail`, `jobAddress`, `ocNumber`, billing contact name/email and Site snapshot OC.
- Document: `issueDate`, `dueDate`, `notes`, item descriptions/quantities/rates, payment amounts.
- Template: the existing supported company, bank, heading, text and color keys.
- Existing document type, stamp, email purpose and email settings.

It uses the provided editor draft or historical snapshot. It does not replace them with current database records. Item input types/values, payment calculations, recipient selection and saved historical Site details are preserved. The projection is applied only at the three fetch call sites; save/history payloads and source objects are untouched.

Oversize responses are JSON: `PDF preview payload is too large.` or `Document email payload is too large.` Diagnostics log only the constant route endpoint, numeric content-length (or null), limit and exceeded flag. They omit query strings, payloads, personal data, images, credentials and stack traces. Unauthenticated and technician requests return 401/403 before PDF JSON parsing.

## Files changed

- `server-app.js`: move complete PDF/email routes before global parsing; retain their handlers and role restrictions.
- `server-document-json.js`: finite PDF JSON parser and safe 413 diagnostics.
- `src/lib/document-pdf-payload.js`: shared transport projection.
- `src/hooks/useWorkspaceActions.js`: apply projection to current previews, historical copies and sends.
- `tests/document-json.test.js`: exact limit, over limit, gzip, chunked transfer and diagnostic checks.
- `tests/document-pdf-payload.test.js`: output/financial/email equivalence, oversized histories/images and source preservation.
- `tests/e2e/document-workspaces.spec.mjs`: photo-heavy unsaved previews, real large PDFs/download bytes, SMTP attachments and authorization/413 coverage.
- `docs/document-pdf-payload-fix.md`: this audit and verification report.

## Verification

- `npm test`: **380 passed, 0 failed**. Log: `test-results/document-payload-unit-tests.log`.
- `npm run lint`: passed.
- `npm run build`: passed; existing large-chunk advisory remains.
- `git diff --check`: passed.
- Focused Playwright: **8 passed in 22.4 seconds**, using isolated temporary SQLite/auth databases and a localhost-only SMTP sink. No real email was sent. Log: `test-results/document-payload-e2e.log`.

```powershell
npx playwright test tests/e2e/document-workspaces.spec.mjs --config=playwright.config.mjs --tsconfig=tsconfig.app.json --workers=1 --max-failures=1 --grep 'unsaved PDF requests|PDF routes reject|sends use actual|sent copies|phone receipt preview|new quote|new invoice'
```

Coverage includes new invoice/quote previews; unsaved notes/rates; unchanged stored photos, documents, payments and history; historical Site snapshot behavior; PDF filename/content type/no-store/downloadable bytes; normal UI sends and large real attachments captured locally; legacy quote send alias; office access; unauthorized large bodies; safe 413 responses; and phone preview behavior.

PDF equivalence tests compare text, coordinates, font sizes and filenames for full versus projected requests. All pages of the 44-page PDFs were parsed, the final item was verified, and attachment output matched preview output. Representative single-page invoice and quote previews and email attachments were rendered with Poppler and visually inspected: logo, addresses, stamp, items, totals and footer remained intact. Poppler emitted missing optional Symbol/ArialUnicode display-font warnings; inspected Latin-text pages rendered correctly. The full 44-page documents were not individually visually reviewed.

Production verification remains outstanding until an authorized release. Ship the frontend projection and server parser together; an old cached frontend still sends full jobs and should be reloaded after release. No commit, push or deployment was performed.
