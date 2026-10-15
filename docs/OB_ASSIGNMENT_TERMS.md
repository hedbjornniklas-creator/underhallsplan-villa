# OB approved documents and terms

## Decisions, 2026-09-24

- Historical documents must never change. No generation, replacement or backfill
  of an older PDF from current assignment data, terms, templates or profiles.
- New acceptances keep both an immutable snapshot and the original PDF bytes.
- The email attachment and the inspector's download use the same archived file.
- Corrections require a new confirmation, not editing the accepted document.
  This initial implementation has one acceptance document per assignment.

## Editing lock correction, prepared 2026-10-15

The details form and OB PATCH endpoint now share one rule: only an unarchived
`draft` without `last_sent_at`, `accepted_at` or `booked_at` is editable. Conversion
to `completed`, cancellation, expiry or unlocking the inspection never unlocks
the confirmation. A replacement draft for an early-start inspection may retain
`inspection_id` and `converted_at`; these links do not make a new draft historical.

Content updates recheck the draft/issue markers in the database UPDATE itself,
so a stale tab cannot overwrite a draft issued by another tab. A conflict reloads
the saved data and disables further autosave. Booking, cancellation and archive
operations stay separate from content changes and do not normalize old fields.
Existing reissue remains limited to its supported sent/ordered/booked states;
completed and other historical documents offer a new-confirmation link instead.

Apply `docs/db/2026-10-15_01_ob_approved_assignment_content_lock.sql` before
production rollout. It installs an additional database guard for approved OB and
STATUS contents, including an acceptance-evidence check if old row markers are
inconsistent. It allows first customer acceptance, booking, conversion, reissue
and archive operations. It does not update/backfill old rows or regenerate files.
The public acceptance handler no longer performs its old post-acceptance field
sync for OB/STATUS: contents must be committed in the acceptance transaction,
before snapshot capture. TU/EB compatibility behavior is unchanged.

This correction is not yet published or applied to the production database.

## Published, activation setting confirmed

The code was published on 2026-09-24 as `a6b5ce9`. Production deployment
identity and anonymous access checks passed; see `OB_CONFIRMATION_RELEASE.md`.
The user confirmed applying SQL and then saving the Production archive flag
as `true`. A fresh deployment of the same application code is being triggered
to apply it. Authenticated live acceptance/email verification remains outstanding;
the public deployment checks do not independently verify new snapshot capture.

The inspector's details page shows approved terms outside its disabled form,
with a shortcut near the approval summary. PDF download is read-only and
organization-scoped. API responses, including errors, are private/no-store.

For legacy acceptances, both the stored version and text SHA-256 must match an
available buyer/seller/apartment document. The hash selects the text, independent
of a later edit to the assignment role. Missing references or unknown versions
show an explicit unavailable state, never newer replacement text. Missing old
PDFs remain missing. The actual original email attachment can be preserved
through a separately reviewed import; there is no automatic legacy import.

For new acceptances, when `OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED=true`:

1. The server resolves the exact approved terms and inspector/company identity
   before consuming the acceptance token. A setup/identity failure leaves the
   token unused. Client-supplied snapshot fields are not trusted.
2. An AFTER INSERT trigger on `assignment_acceptances` captures the updated
   assignment, full terms, selected addon names/prices, acceptance payload and
   inspector/company identity in the same database transaction. A capture
   failure rolls back the acceptance. Internal notes and personal identity
   numbers are excluded from the assignment copy.
3. `sendFrozenObConfirmation` reads only that snapshot, never current templates,
   prices or profile data. It first reads any existing PDF. If absent, it renders
   the first attachment, archives it, then reads back the stored winner before
   sending. Concurrent attempts cannot overwrite an original.
4. Original PDF reads verify size, signature and SHA-256. Download never renders
   a missing or corrupt PDF. It reports the missing original instead.
5. Rendering, archive or mail failures are recorded in `outbound_messages`.
   The inspector sees the send state alongside the terms. Explicit retry uses
   the frozen snapshot and original file. A pending attempt older than five
   minutes can also be retried after an interrupted request. A provider-accepted
   message is shown as sent, not as proof of inbox delivery. An uncertain send
   may already have reached the customer; retry is manual, not automatic.

Approval remains valid if the subsequent PDF/mail operation fails. A process
interruption before a mail log exists is shown as not sent on the next load;
the committed snapshot remains available for recovery.

Snapshot/PDF tables have RLS with no direct anonymous/authenticated access.
The service role can only read snapshots and read/insert PDFs; the snapshot
capture trigger is the only application writer. UPDATE, DELETE and TRUNCATE
are blocked by triggers. Foreign keys prevent hard-deleting referenced
acceptances, assignments and organizations. Normal soft archiving is unaffected.
Database owners remain responsible for backup and protection of schema changes.

## SBR layout remains a separate delivery

Original source documents were located in the user's `Dokument (5).zip`:
SHA-256 `8C570B94E53723E9A52976D77CC9274C90DCF9392EA3EE59A4443E1B28A756F7`.
The source mapping is documented in the separate, parallel
`assignment-confirmation-withdrawal-plan.md`. That plan is not implemented by
this change.

The existing email PDF renderer/layout and current terms have NOT changed.
They must not be described as a facsimile of SBR's original Word documents.
Buyer/seller original 2026.2 text differs from currently accepted 2026.1 content.
Introducing the original layout/text needs a new version for future confirmations
and visual verification against the sources. It must not modify the historical
text registry or archived PDFs. Preserve the `ob-confirmation-v1` rendering
contract for pending first-time generation; route any future format through a
new snapshot version rather than silently changing that renderer.

## Staging and rollout

1. Keep the flag unset/false. Back up the target database as normal.
2. In staging apply `docs/db/2026-09-24_01_ob_assignment_pdf_archive.sql`.
   It requires existing assignments, organizations, acceptances and addon orders
   plus the current token-consumption flow that writes addons before acceptance.
   The migration is transactional and repeatable; it does not modify old rows.
3. Deploy the application code to staging, then enable the flag there. Run a
   synthetic new acceptance and verify one snapshot, one original PDF, and that
   the email attachment and download SHA-256 are identical.
4. Attempt to change synthetic approved assignment contents: the database guard
   must reject it. Change synthetic current profile data: approved terms and the
   downloaded PDF must remain unchanged. Verify an old acceptance creates no
   new snapshot/PDF, and another organization's account cannot read the archive.
5. Exercise renderer/archive/mail failure recovery and manual retry. Verify the
   acceptance remains recorded and the first successful PDF is reused.
6. Production rollout requires explicit approval after staging verification.
   Apply SQL before enabling the application flag. The user has confirmed SQL
   application and authorized publication; deployment is recorded in the release
   log. No production customer emails or acceptances were used as tests.

Disabling the flag stops new opt-in captures and manual resend operations; it
does not remove archives. Read-only terms/PDF access continues. Do not drop
archive tables or restore an older database over archived documents as rollback.

## Verification

- The 2026-10-15 lock correction passed 185 focused/regression tests covering
  OB/STATUS approval, booking, early start/reissue, archives, terms/PDF originals,
  organization boundaries and unchanged TU behavior. The new tests are
  `ob-assignment-edit-lock.test.ts` and `ob-approved-assignment-content-sql.test.ts`;
  the OB status PATCH and public acceptance suites also cover this correction.
  The SQL suite executes the real token consumer, snapshot capture, conversion
  and early-start reissue routines with the new guard installed.
- `node scripts/preview-assignment-link-recovery.mjs --test-form-layout` passed
  at 320/390/768/1024/1280/1920, including disabled historical forms, no edits on
  mobile/desktop, ordinary draft autosave and concurrent issue conflicts without
  an autosave retry loop. Accepted-terms/PDF browser verification also passed.
  Desktop/mobile screenshots were visually inspected. All browser data is synthetic.
- Full `tsc --noEmit --incremental false` and the isolated Next production build
  passed using staging configuration only. Four changed source modules pass
  ESLint; the shared assignment server retains exactly its eight pre-existing
  `no-explicit-any` findings, with no new findings introduced.
- `node --experimental-strip-types --test test/assignment-pdf-archive.test.ts test/ob-confirmation-snapshot.test.ts test/ob-accepted-assignment-terms.test.ts test/assignment-public-link.test.ts`
- PGlite executes the actual migration twice and checks no backfill, atomic
  snapshot validation, addon capture, immutable rows, grants/RLS and deletion
  restrictions. Unit/API tests cover frozen-only rendering, original reuse,
  archive-before-send, failure logging, tenant boundaries and rollout isolation.
- Set `PORT=0`, then run
  `node scripts/preview-assignment-link-recovery.mjs --test-accepted-terms`.
  Uses synthetic HTTP responses with the real details component and text.
  Covers six desktop/mobile layouts, byte-identical PDF download, missing
  originals, unavailable terms, retry without form reset, mail retry and double
  click protection. No real emails or customer/database writes occur.
- Preview without the test flag: `/details?terms=buyer` (also `seller`,
  `apartment`, `missing`, `mismatch`, `retry`, `mail-failed`).
