# OB Mobile Round V2: Separate Menu Entry

Status: the first integration stage is published through its own menu entry.
The move/delete/create-and-link completion is implemented locally and awaits
the SQL migration and deployment. The
legacy round remains available. The approved prototype remains under
`.cache/ob-safe-lab`; its working copy is not imported, reset, or written by
this integration.

The
[prototype parity audit](OB_MOBILE_ROUND_PARITY.md) records the omitted
workflows, carried-over features, existing limitations, and acceptance
checklist and the current implementation/verification status. Synthetic tests
do not replace physical-device, production-database and report acceptance.

## Included In This Stage

- Mobile places, room/exterior detail, notes, and pending-work views.
- "Valj plats" on the left; inside/outside selector on the right. The floor
  selector has an accessible label without the duplicated visible heading.
- Back arrows in the room and mobile sheets; one scrolling sheet body.
- Inspection/address header on the three main views, including pending work;
  hidden inside a room or exterior part. The header opens the existing step menu.
- Room creation, free notes, and catalog suggestions through existing OB writes.
- Local text search across suggestion wording, risk/FTU, categories, and tags,
  with accent normalization and a small explicit synonym list. No AI request.
- Paginated catalog reads, using existing inspection-side and room-type rules.
- Serialized note autosave, visible save failures, close-time flushing, and
  local draft recovery. Draft keys use the existing inspection draft prefix,
  so the existing finalization/navigation guard detects unsaved mobile text.
- Camera/gallery callbacks use the existing IndexedDB upload queue and preserve
  existing origin metadata. Existing-note image linking uses a wrapped,
  searchable radio list, rather than a native select with very long options.
- Existing inspection locking and assignment-workflow boundary remain in place.
- Icon-only move and delete actions at the right of room/note headers; consistent
  back arrow at the left. Move a room to a floor, or a note to a room/exterior part.
- Confirmed deletion of empty rooms, notes and images. Deleting a note unlinks
  its pictures first, retaining them at their place under pending work.
- Image deletion in the link sheet and beside editor thumbnails. The note and
  the stored original/thumbnail files remain; deleted row metadata is archived.
- Existing/new note tabs in Koppla bild. New notes use free or editable catalog
  text and the image's saved place. No record is created on tab changes/cancel.
- Atomic move/delete/create-and-link with server authorization, workflow/lock
  guards, stale preflight checks and idempotency receipts. Local pending text
  drafts and uploads block these actions; editor actions flush text first.

## Not Included Yet

- Replacing the control-point data model or changing how "nothing to note"
  records contribute to existing counts. The user explicitly chose to leave
  this behavior unchanged and remove unwanted entries manually.
- Automatic user-facing undo/recovery. Deletion recovery is an administrative
  operation using archived rows and the retained storage files.
- Cross-device concurrent-edit conflict resolution or fully offline inspection
  creation. Existing remote writes still require connectivity; the text draft
  fallback is on the current device only.

The prototype's local file-transaction handlers are not used in production.
The new actions use `/api/ob/inspections/[id]/round` and `ob_round_mutate`.

## Required Database Migration

Apply `docs/db/2026-09-11_01_ob_round_mutations.sql` BEFORE deploying this update.
It has not been applied to Supabase by this task. It creates two private
receipt/archive tables and functions/triggers; it does not backfill or rewrite
existing inspection content. It requires the existing OB assignment-workflow
foundation and inspection write-lock guards.

The RPC is executable only by `service_role`. The API derives actor and active
organization from the authenticated session; the RPC additionally checks
membership and property ownership, matching the existing OB unlock owner rule.
An organization member does not gain access to other owners' inspections.
No client-supplied actor, organization or floor whitelist is trusted.

Inspection and workflow locks serialize new commands. OB child-write guards
reject removed IDs/foreign current references and place late linked uploads at
their note's current location. Original capture fields are retained. Existing
lock/workflow triggers remain. A conflicting multi-connection write can abort
and must be retried; this does not implement general cross-device text merging.

Removal archives the original row, affected children and stored file paths in
`ob_round_mutation_events`. Tombstones in `ob_round_removed_records` prevent
late offline inserts from resurrecting the deleted ID. To restore, an admin
must review conflicts, remove the relevant tombstones and restore archived
parent/child rows in a transaction. There is no automatic restore UI or tested
one-click recovery procedure. Do not delete archived files as cleanup.

The archive belongs to its inspection and is removed if the entire inspection
is explicitly deleted through the existing workflow. It does not replace a
database/storage backup and does not add a new restriction to inspection or
profile deletion. Keep normal backups before production rollout.

## Activation And Rollback

Open an inspection and choose **OB-runda (ny)** in the step menu. The existing
**OB-runda** entry continues to open the legacy interface. No environment flag
or special URL is required. Ordinary inspection links still start on Grunddata.
The previous optional deep link remains supported:

```text
/properties/<property-id>/ob/<inspection-id>?round=mobile-v2
```

Both entries use the same inspection ID, existing tables, persistence helpers,
image queue, assignment-workflow boundary, and finalization checks. The menu
choice is not a separate inspection, a data copy, or an authorization boundary.
It uses the application's configured Supabase environment. Switching steps
warns about outstanding local text drafts before leaving the current view.

Initial acceptance tests use synthetic data and must not modify an ongoing
production inspection. The original menu change needed no SQL migration, but
the new transaction-backed actions DO require the migration above. Deployment
uses the repository's existing Vercel pipeline.

To leave the pilot, first wait for saved text and completed image uploads.
Select the original OB-runda menu entry. Unsaved V2 text drafts must be
recovered by reopening their note in V2 on the same device; they are not
silently migrated into legacy field drafts.
Never clear browser storage to work around the finalization guard.

The legacy interface can be removed after feature parity and data/report
verification. Do not delete `ObStepRunda.tsx` wholesale: it currently owns the
shared persistence and upload queue used by both interfaces. Remove only its
legacy renderers, or extract the shared controller first. No data migration
should be needed just to retire the old interface.

## Verification And Safe Preview

```powershell
node --experimental-strip-types --test test/ob-mobile-round.test.ts
node --experimental-strip-types --test test/ob-round-mutations.test.ts test/ob-round-mutation-api.test.ts test/ob-early-start-api.test.ts
node scripts/test-ob-mobile-round-ui.mjs
npx tsc --noEmit --incremental false
```

The browser test renders the real `ObMobileRound` with synthetic records and
callbacks. Supabase is replaced with a synthetic, paginated catalog; external
requests are blocked. It covers phone/desktop layout, place navigation,
search, notes, slow/failed saves, recovery after reload, the draft guard, image
linking, moving, deleting, new-image notes, retries and locked/paused states.
SQL tests run the actual migration twice in a disposable PGlite schema, then
check transactions, preserved text/relationships, forbidden writes, stale
preflights, rollback on simulated failures and retry idempotency. API tests
verify request validation and session-derived identity. A second browser fixture renders the real inspection
page and workflow boundary with synthetic reads and an observing wizard stub;
it tests both menu entries, switching, fullscreen layout, the draft warning,
deep links, and apartment visibility. Unit tests separately verify the actual
wizard dispatch to the shared round component.
These tests do not prove deployed database permissions with all legacy triggers,
physical camera capture, real upload retries, or report output parity.

Interactive synthetic preview, with no credentials or database connection:

```powershell
node scripts/test-ob-mobile-round-ui.mjs --serve --port 57067
```

This separate preview uses invented data, not the user's working test copy.
Current preview: `http://127.0.0.1:57067/preview`. Older preview processes on
57065/57066 have not been stopped or reset by this update.
Only synthetic note text is persisted in its own browser origin. Images and
rooms in this fixture reset on reload. The server must remain running.
Screenshots/build output are ignored under `tmp/ob-mobile-round-ui`.

Before retiring the legacy round, verify the production adapter against an
isolated database, test the real phone camera/upload queue, and compare the
saved report with the legacy round. Confirm backup/restore and the remaining
transaction-safe actions before considering this a full replacement.
