# Isolated OB UI Test Copy

The local workspace under `.cache/ob-safe-lab` is a private, ignored test
harness. It is not deployed and does not replace the production inspection.
Customer data, credentials and backup files must never be committed to Git.

## Start And Develop

From the repository root, run:

```powershell
powershell -NoProfile -File .cache/ob-safe-lab/start.ps1
```

The launcher prints a loopback URL, starts the server hidden on an available
port, and reuses an existing responsive instance. It does not reset data.
The computer and server must remain running to use that URL.

The root URL opens a phone-sized viewport (390 by 844 CSS pixels when space
allows). Dialogs and responsive breakpoints use that inner viewport, not the
desktop window. On narrow screens the view fills the available screen.
`/lab/mobile` opens the same UI directly for responsive tests. Framing is
allowed only from the same origin on that route; external frames remain blocked.

Mobile sheets lock document/body scrolling while any sheet is open. Only the
sheet body can scroll, with overscroll contained there; the header and footer
stay visible. The document scroll lock releases automatically when sheets
close. This is scoped to the local mobile experiment, not production styling.

The copied application source is in `.cache/ob-safe-lab/source/src`.
Local adapters are in `.cache/ob-safe-lab/ui`. Rebuild after editing these:

```powershell
node .cache/ob-safe-lab/tools/build.mjs
node .cache/ob-safe-lab/tools/typecheck.mjs
node --experimental-strip-types --test .cache/ob-safe-lab/tools/search.test.ts
node --test .cache/ob-safe-lab/tools/move.test.mjs
node --test .cache/ob-safe-lab/tools/removal.test.mjs
node .cache/ob-safe-lab/tools/verify.mjs
node .cache/ob-safe-lab/tools/verify-moves.mjs
node .cache/ob-safe-lab/tools/verify-removals.mjs
```

Verification uses disposable QA data, not the user's working test copy.
Reload the browser after rebuilding. Do not edit production `src` for an
experiment intended only for this test copy.

## Mobile Round Experiment

The default view now uses the new mobile round. The top-right inspection menu
retains the previous round and the other original inspection sections.
The experiment is implemented in `ui/MobileRound.tsx`, `ui/roundSearch.ts`, and
`ui/mobile-round.css`, with an opt-in presentation branch in the copied
`source/src/components/ob/ObStepRunda.tsx`. Production source is unchanged.

The new presentation keeps floor/room context visible, groups catalog outcomes,
searches their text locally, supports free notes, and lists unlinked images,
empty free notes, internal quick notes, and known unfilled template fields.
Room position is remembered within the browser session. Note editing saves
after 700 ms of inactivity, serializes writes, retains a local recovery draft,
and flushes before closing. Image capture/upload and linking reuse the copied
round's existing upload queue and persistence functions.

The place list shows the selected floor only in its selector. The add-room
icon sits beside it; the former repeated floor-heading row is removed.
The exterior list retains its building-parts heading. This is layout-only;
floor selection and room creation behavior are unchanged.

Image linking uses an in-view searchable radio list instead of a native select
containing long note text. Image-place matches appear first; room names, note
text, category, risk and investigation are searchable across the inspection.
Place and note text wrap on separate lines, and the selected note expands.
Selection is explicit and resets when the search changes or the sheet reopens.
Only the confirmation command links an image; cancellation does not write data.
The existing persistence and capture metadata handling are unchanged. Browser
tests cover mobile and desktop containment, keyboard selection and link retry.

Search currently uses accent-insensitive multiword matching, a small explicit
synonym list, and ranking of direct text matches. It is not AI or a complete
semantic search engine. Template note/risk/investigation text remains unchanged;
known `{plats}`, `{detalj}` and `{iakttagelse}` fields are flagged for completion.
"Saved" means persisted, not reviewed or ready to deliver. Pending-work counts
are not a complete report-quality audit.

Automated tests exercise the legacy and new views with disposable copied data,
including save failure/retry, closing before the debounce expires, reload,
outcome template preservation, image linking/upload, room creation, report-data
inclusion and narrow viewport bounds. Real phone camera permissions, keyboard,
offline recovery and the five-second field-work target still need user testing.

### Moving Rooms And Notes

The back arrow ("Till platser") returns to the place selector. The duplicate
"Byt plats" icon has been removed. Its former header position now holds an
icon-only "Flytta rum" command with a tooltip and accessible label, without an
extra toolbar row. It moves the current room to another available floor. "Flytta
notering" uses the same blue icon in the note editor's header action group,
alongside delete and close; its former text row below the place is removed.
It selects an existing room, or an exterior building part.
Both require an explicit destination and confirmation; cancellation does
not relocate anything. Note drafts are saved before leaving the editor.

Only the local test server implements these operations (`POST /lab/move`).
A room keeps its ID, contents and relationships; only floor, order and timestamp
change. A note keeps its ID, text, risk, investigation, status and template
references. Its current placement and linked images' current placement change
in one serialized file replacement. Image files and original capture metadata
(`origin_*`, source area) are retained. No merging or deletion is performed.
An exterior observation is reused, or created within that same local commit.

Moves reject locked inspections, foreign/missing destinations and stale source
locations. The UI waits for outstanding saves and uploads, and checks the local
image queue again before committing. These are prototype safeguards, not a
PostgreSQL transaction, production authorization or multi-device conflict policy.
Before a production implementation, SQL/RLS constraints, queued/offline writes,
concurrent editors and final report/PDF placement must be validated separately.

Move tests run on disposable copies and cover cancellation, immediate draft
flush, failure/retry, upload blocking, retained text/image relationships,
interior/exterior destinations, reload and report-data inclusion. Screenshots
check 360, 390 and 430 pixel views. Results are recorded in
`.cache/ob-safe-lab/latest-move-verification.json`. The user's working copy is
hash-checked and is not used for test mutations.

## Data Boundaries

### Deleting Mobile Content

Trash controls are available in the note editor, image linking sheet, next to
linked image thumbnails, and next to rooms in the place list. Each opens a
separate confirmation; cancellation returns to the prior editor or image sheet.
Note drafts are flushed before entering confirmation. Delete buttons use red
with readable disabled states, not black backgrounds or reduced text opacity.

Only the local server implements `POST /lab/removal`. A read-only preview
collects the target and related rows, checks room contents, and hashes that
snapshot. Confirmation must provide the same token; stale content, foreign
inspection relationships and locked inspections are rejected. Changes and a
local recovery snapshot are committed in one serialized file replacement.
Retrying a confirmed deletion with the same token returns its saved result.

- Deleting a note removes its note/risk/investigation record. Linked images
  remain at their current place, retain their original capture metadata, and
  become unprocessed images under "Att bearbeta".
- Deleting an image removes its active inspection row, not its note. Media
  bytes and asset mappings are retained for recovery and shared-file safety.
- Only empty rooms can be deleted. Authored notes (including empty free notes),
  marked checkpoints, room values/text, quick-note text, and current/original
  image relationships block removal. Untouched automatic checkpoint rows and
  empty internal quick-note rows are archived and removed with an empty room.

Saving or queued/active/failed image uploads block confirmation. Queue state is
checked again before a mutation. Late local adapter writes referencing a
missing room or note are rejected. This is not a production offline-sync or
multi-device concurrency guarantee. Queued images must finish uploading first;
they do not get silently discarded by deleting their destination.

`state/working.json` contains `removalArchive` recovery snapshots. There is no
restore button or restore API yet, and this is not permanent erasure of files.
Internal quick notes and exterior building-part definitions do not gain their
own deletion controls in this change. Production code/data remain unchanged.
The dedicated removal unit/browser suites use disposable QA data and cover
confirmation/cancel, draft flush, empty notes, protected/empty rooms, image
retention, failure/retry, upload blocking, reload and mobile bounds. Results are
written to `.cache/ob-safe-lab/latest-removal-verification.json`.

### Local Files

- `backups/`: original logical export, manifest, row counts and file hashes.
- `latest-backup.json`: points to the completed export.
- An independently hash-checked copy is also held outside the repository,
  under the user's `BesiktApp-sakerhetskopior/ob` directory.
- `state/baseline.json`: initial test data with remapped identifiers.
- `state/working.json` and `state/files/`: mutable test rows and separate media.
- `state/changes.jsonl`: local mutation log, not a production audit trail.
- `latest-verification.json`: latest automated checks and screenshot location.

Test edits never synchronize to production. Customer delivery and remote API
writes are blocked. The local adapter has no production credentials; the
one-off backup tool is separate and must not be rerun casually while the
original is being edited. Do not rerun seeding or replace working state to
refresh data without first preserving the current test work.

## Verification Scope

The export was compared before and after copying during a confirmed editing
pause. Copied files were checked with SHA-256. This is an inspection-scoped
logical backup, not a database-wide dump, an offsite backup, or a tested
Supabase restore. Schema, RLS and authentication accounts are not included.

The UI runs against a serialized, file-backed query adapter, not PostgreSQL.
It supports navigation, search and editing experiments, but does not prove
SQL constraints, RLS, triggers, cascades, real offline synchronization or
multi-user concurrency. Report data can be built locally; final PDF output,
publication and email delivery require separate verification before release.
