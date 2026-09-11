# OB Mobile Round V2: Separate Menu Entry

Status: first integration stage, available through its own menu entry. The
legacy round remains available. The approved prototype remains under
`.cache/ob-safe-lab`; its working copy is not imported, reset, or written by
this integration.

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
production inspection. No SQL migration or data import is required for this
menu change. Deployment uses the repository's existing Vercel pipeline.

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
node scripts/test-ob-mobile-round-ui.mjs
npx tsc --noEmit --incremental false
```

The browser test renders the real `ObMobileRound` with synthetic records and
callbacks. Supabase is replaced with a synthetic, paginated catalog; external
requests are blocked. It covers phone/desktop layout, place navigation,
search, notes, slow/failed saves, recovery after reload, the draft guard, image
linking, and locked/paused states. A second fixture renders the real inspection
page and workflow boundary with synthetic reads and an observing wizard stub;
it tests both menu entries, switching, fullscreen layout, the draft warning,
deep links, and apartment visibility. Unit tests separately verify the actual
wizard dispatch to the shared round component.
These tests do not prove real database permissions,
physical camera capture, real upload retries, or report output parity.

Interactive synthetic preview, with no credentials or database connection:

```powershell
node scripts/test-ob-mobile-round-ui.mjs --serve --port 57066
```

This separate preview uses invented data, not the user's working test copy.
Only synthetic note text is persisted in its own browser origin. Images and
rooms in this fixture reset on reload. The server must remain running.
Screenshots/build output are ignored under `tmp/ob-mobile-round-ui`.

Before retiring the legacy round, verify the production adapter against an
isolated database, test the real phone camera/upload queue, and compare the
saved report with the legacy round. Confirm backup/restore and the remaining
transaction-safe actions before considering this a full replacement.
