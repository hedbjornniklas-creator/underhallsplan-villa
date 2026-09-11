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
- Att bearbeta has a multiple-image gallery picker. Imported files use the same
  local upload queue, with no inherited room, exterior part, floor or note.
  Each file is saved independently; failed local saves are listed without
  discarding successful files. Cancel creates nothing and locked/paused views
  cannot import. Images can be linked to existing notes after upload; creating
  a new image note still requires a saved place. No database migration is needed.
- The note editor has three photo actions: camera, device gallery, and Bildbank.
  Bildbank selects multiple existing unhandled images, grouped by the note's
  place, other places, and no place. Search does not clear selections; back
  discards the selection without linking. Opening the bank flushes note text
  first, and returning preserves the editor draft. Linking requires confirmation
  and completed uploads. The conditional update is scoped to the inspection and
  still-unlinked, non-ignored rows, so a concurrent link is not overwritten.
  Successful partial updates remain visible; retry includes only remaining
  selections. Image files and original capture metadata are not changed.
  This addition needs no new database migration.
- In Att bearbeta, pressing an image thumbnail opens a large, uncropped preview
  in the current tab. Back/Escape returns to the list at its scroll position.
  Previous/next arrows and a position counter follow the same pending-image
  list, without wrapping at either end. Linked/ignored images are excluded.
  The place label and link action follow the image currently displayed.
  The adjacent place/arrow still opens image linking directly, and the preview
  also has a link action. Viewing images does not write inspection data; locked
  inspections and queued uploads can be previewed without enabling linking.
- Existing inspection locking and assignment-workflow boundary remain in place.
- Icon-only move and delete actions at the right of room/note headers; consistent
  back arrow at the left. Move a room to a floor, or a note to a room/exterior part.
- The room title has a pencil and opens "Byt rumsnamn" with explicit save/back.
  Rename updates only `room_label` on the same inspection/room, conditional on
  the previous name. Room type, floor, order, values, notes, pictures and capture
  origins are not rewritten. Failed saves retain the name draft; an identical
  retry after a lost response is accepted. Pending text/uploads and locks block
  rename. It uses existing RLS/write guards and needs no new migration.
- Room/exterior details have a collapsed image section above catalog suggestions:
  "Bilder i rummet" / "Bilder på platsen", with total and unlinked counts. It is
  hidden during text search. Expand to see linked and unlinked thumbnails;
  preview an image, then open its existing note or link an unlinked photo using
  the existing/new-note flow. Viewing never creates a note or image link.
  Current note/image placement takes precedence over capture origin, which is
  only a fallback for photos without a current place. A moved image appears at
  its current place, not at both places. Historical origin labels are preserved.
- Confirmed deletion of empty rooms, notes and images. Deleting a note unlinks
  its pictures first, retaining them at their place under pending work.
- The trash icon beside editor thumbnails offers two actions: remove from the
  note (unlink) or delete from the inspection. Unlink retains the image row,
  file, placement and capture origin, and returns it to Att bearbeta/Bildbank.
  It flushes note text first, blocks during uploads, and conditionally updates
  the expected note link so another editor's changed link is not removed.
  An already-unlinked image is accepted when retrying a lost response.
  Deletion still uses the separate confirmation/archiving flow; the note and
  stored files remain. Deletion in the image link sheet is unchanged.
- Existing/new note tabs in Koppla bild. New notes use free or editable catalog
  text and default to the image's saved place, never the last visited room.
  Under Ny notering, select Insida → Plan → Rum or Utsida → Byggnadsdel to
  assign an unplaced image or choose another destination. Draft text survives
  place changes. Only Skapa och koppla creates the note and assigns the image,
  in one transaction; selecting a place, previewing, switching tabs or
  cancelling changes no inspection records. Capture origin is retained.
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

Place selection for new image notes additionally requires
`docs/db/2026-09-11_07_ob_image_note_place.sql` after the foundation above and
before deploying the place-selector UI/API. This forward migration replaces
the RPC function without rewriting existing rows. It has not been applied to
Supabase by the place-selector task. Explicit targets use new RPC operation
names, so a database without this migration rejects the request instead of
silently ignoring the selected destination. Legacy no-target requests retain
their current/origin placement behavior. Target selection, current image state
and destination state are verified again during the atomic save.

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
node scripts/test-ob-mobile-round-ui.mjs --image-place-only
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
node scripts/test-ob-mobile-round-ui.mjs --serve --port 57068
```

This separate preview uses invented data, not the user's working test copy.
Current preview: `http://127.0.0.1:57068/preview?levels`. Older preview processes on
57065/57066/57067 have not been stopped or reset by this update.
Synthetic note text and imported test files are persisted in the preview's own
browser origin. Displayed images and rooms in this fixture reset on reload;
the fixture does not upload imported files to Supabase. The server must remain running.
Screenshots/build output are ignored under `tmp/ob-mobile-round-ui`.
Image-import checks: `node --experimental-strip-types --test test/ob-round-image-import.test.ts`
and `node scripts/test-ob-mobile-round-ui.mjs --images-only`.
Image-bank checks: `node --experimental-strip-types --test test/ob-round-image-bank.test.ts`
and `node scripts/test-ob-mobile-round-ui.mjs --image-bank-only`.
Image-preview checks: `node scripts/test-ob-mobile-round-ui.mjs --image-preview-only`.
Image removal choices: `node scripts/test-ob-mobile-round-ui.mjs --image-removal-only`
and `node --experimental-strip-types --test test/ob-round-image-unlink.test.ts`.
Room rename and place-image checks: `node --experimental-strip-types --test test/ob-room-name-images.test.ts`
and `node scripts/test-ob-mobile-round-ui.mjs --room-name-images-only`.

### Touch navigation between rooms

- In an interior room, swipe left for the next room or right for the previous
  room, using the same descending order as the selected floor's room list.
  Navigation stops at the first/last room; it never wraps or changes floors.
- This is navigation only: no rooms, notes, images or inspection data are written.
  The existing back arrow and place list remain available on all devices.
- Short, vertical, slow, multi-finger and screen-edge gestures do not navigate.
  Fields, image galleries, dialogs and action buttons are excluded. Swiping a
  note row or suggestion category does not also activate it. Mouse dragging is
  unchanged; vertical scrolling and pinch zoom retain browser behavior.
- Synthetic touch checks: `node scripts/test-ob-mobile-round-ui.mjs --swipe-only`.
  Preview with several rooms on one floor: `http://127.0.0.1:57068/preview?levels&swipe`.

### Phone/browser Back

- The new round owns one same-URL history boundary while a detail view, a tab
  other than Places, or a round dialog is open. Browser/phone Back first closes
  the top dialog; without a dialog it returns to Places on the selected floor.
  From Places, normal browser navigation remains available.
- Dialog Back uses the existing cancel/arrow callback. The note editor flushes
  pending text before closing, stays open on save failure, and ignores further
  close requests while saving. Busy mutation dialogs retain their close guard.
- Moving between rooms (including swipes) does not add history entries. In-app
  arrows and step changes remove the boundary. Reload reuses it rather than
  adding another. A retired forward boundary is skipped, not an extra blank step.
- Existing router history metadata is preserved. The inspection page does not
  add its separate text-draft boundary while this local boundary handles Back;
  its existing unload/link/leave protections remain unchanged.
- Navigation does not change inspection records; closing an edited note uses
  the same existing autosave as its in-app arrow. No SQL migration is required.
- Check: `node scripts/test-ob-mobile-round-ui.mjs --back-only`. Tests exercise
  actual browser history, the production round/editor and the real inspection
  page's draft guard with synthetic data, including slow/failed saves, nested
  dialogs, normal exit, reload, Strict Mode and switching steps.

### Free-note suggestions for the catalog

- Free notes have a secondary "Föreslå till biblioteket" action. It saves the
  original first, then opens an editable, separate text copy. Opening/canceling
  sends no email; changing the copy does not change the inspection note.
- Only "Skicka förslag" sends note, risk, further-investigation text and an
  optional room type/building-part category to admin for manual review. The
  sender's profile email is included for replies. No images, property address,
  inspection link or customer records are attached. Users review the text for
  personal details before sending. Nothing is added to the catalog automatically.
- API: `/api/ob/inspections/[id]/note-suggestions`. Requires authentication and
  active organization membership, verifies the OB property owner, and scopes the
  free note to that inspection. Uses read-only queries, no migration required.
- Mail uses existing `RESEND_API_KEY` and `ASSIGNMENTS_MAIL_FROM` configuration.
  Recipient defaults to the existing HusHub admin address `jn@hedbjorn.se`;
  optional server variable `OB_NOTE_SUGGESTIONS_EMAIL` overrides it. The browser
  cannot select a recipient. Provider idempotency keys deduplicate identical
  retries within the provider's retention period; this is not a permanent
  suggestion register. A bounded, instance-local limit permits 20 attempts per
  user/hour (not a distributed limit). Errors retain the editable copy.
- Checks: `node --experimental-strip-types --test test/ob-note-suggestion.test.ts`
  and `node scripts/test-ob-mobile-round-ui.mjs --note-suggestion-only`.
  The local preview uses synthetic callbacks and never sends real email.

Before retiring the legacy round, verify the production adapter against an
isolated database, test the real phone camera/upload queue, and compare the
saved report with the legacy round. Confirm backup/restore and the remaining
transaction-safe actions before considering this a full replacement.
