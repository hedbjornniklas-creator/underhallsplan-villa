# OB Mobile Round V2: Production Integration Pilot

Status: first integration stage, opt-in only. Not deployed. The approved
prototype remains under `.cache/ob-safe-lab`; its working copy is not imported,
reset, or written by this integration.

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

## Not Included Yet

- Moving or deleting rooms, notes, and images in the new mobile UI.
- Creating a new note and linking its image as one atomic operation.
- Replacing the control-point data model or changing how "nothing to note"
  records contribute to existing counts. No migration or report rewrite.
- Cross-device concurrent-edit conflict resolution or fully offline inspection
  creation. Existing remote writes still require connectivity; the text draft
  fallback is on the current device only.

The prototype contains additional actions backed by local file transactions.
Those must not be copied into production. Moving, deleting, and atomic
create-and-link need inspection-scoped database transactions, authorization,
lock checks, image-origin handling, and retry/idempotency tests first.

## Activation And Rollback

Both an environment flag and an explicit URL parameter are required:

```text
NEXT_PUBLIC_OB_MOBILE_ROUND_V2=true
/properties/<property-id>/ob/<inspection-id>?round=mobile-v2
```

The opt-in link starts at the round. Without either switch the existing round
is unchanged. Set the flag before starting/building Next.js. This is a UI
switch, not an authorization boundary. It does not select a test database:
the real application still uses its configured Supabase environment.

Do not use the ongoing production inspection for initial acceptance tests.
Use a separately verified test database/copy with matching credentials and
storage. No SQL migration, data import, or deployment is part of this stage.

To leave the pilot, first wait for saved text and completed image uploads.
Remove the URL parameter or disable the flag and rebuild. Unsaved V2 text
drafts must be recovered by reopening their note in V2 on the same device
before disabling it; they are not silently migrated into legacy field drafts.
Never clear browser storage to work around the finalization guard.

## Verification And Safe Preview

```powershell
node --experimental-strip-types --test test/ob-mobile-round.test.ts
node scripts/test-ob-mobile-round-ui.mjs
npx tsc --noEmit --incremental false
```

The browser test renders the real `ObMobileRound` with synthetic records and
callbacks. Supabase is replaced with a synthetic, paginated catalog; external
requests are blocked. It covers phone/desktop layout, place navigation,
search, notes, slow/failed saves, recovery after reload, the draft guard, image
linking, and locked/paused states. It does not prove real database permissions,
physical camera capture, real upload retries, or report output parity.

Interactive synthetic preview, with no credentials or database connection:

```powershell
node scripts/test-ob-mobile-round-ui.mjs --serve --port 57066
```

This separate preview uses invented data, not the user's working test copy.
Only synthetic note text is persisted in its own browser origin. Images and
rooms in this fixture reset on reload. The server must remain running.
Screenshots/build output are ignored under `tmp/ob-mobile-round-ui`.

Before deployment, verify the production adapter against an isolated database,
test the real phone camera/upload queue, and compare the saved report with the
legacy round. Confirm backup/restore and the remaining transaction-safe actions
before considering this a full replacement.
