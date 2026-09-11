# OB Mobile Round: Prototype Parity Audit

Audit date: 2026-09-11.
Production source reviewed: `7f9312b4616c4a7fdadbf2cf65e4dfd055575723`.

## Original Audit Conclusion

The published **OB-runda (ny)** is not feature-complete relative to the approved
mobile prototype. Moving, deleting, and creating a note from an image were
implemented in the isolated prototype but omitted from the production UI.
Passing the current integration tests does not establish prototype parity.
The user should not have to rediscover these omissions through another review.

The original audit changed documentation only. It did not edit application behavior,
production records, or the working test copy. Do not remove the legacy round
until the missing workflows and their data/report effects have been verified.

## Implementation Follow-Up: 2026-09-11

The user approved transferring the missing functions, explicitly retaining
`Inget att notera`. The following implementation is local, NOT deployed yet.
The tables and checklist below preserve the original audit at the commit above;
they are not the current implementation status.

| IDs | Implemented now | Verification |
| --- | --- | --- |
| M1, M2 | Header icons; room/floor and note/room/exterior moves. Stable IDs, all note text and linked-image placement retained. | SQL transaction tests and synthetic browser confirm/cancel/save-flush tests. |
| D1 | Empty-room deletion only, in the room header. Blocks values, notes, marked checkpoints, quick text and current/origin images. | SQL content guards and browser confirmation/cancel/navigation tests. |
| D2 | Note deletion with confirmation; linked images retained under pending work. | SQL archive/unlink and browser lost-response retry tests. |
| D3 | Delete images from the link sheet or note editor. Note retained; original/thumbnail storage files NOT removed. | SQL metadata archive and browser image deletion/cancel tests. |
| I1-I3 | Existing/new tabs; free/catalog text; image-place preflight; atomic create-and-link with idempotency key. | SQL rollback/permissions/staleness and browser tab/cancel/retry tests. |

Verification performed:

- 24 passing tests across `ob-round-mutations`, `ob-round-mutation-api`,
  `ob-mobile-round` and `ob-early-start-api`.
- The expanded browser suite exercises the production UI with synthetic data,
  including failed saves, lost responses, repeated requests, pending uploads,
  and all nine sheet variants at 320/360/390/430/1280px. It makes no external requests.
- `npm run build` and TypeScript pass. Focused ESLint has no errors and five
  image-optimization warnings for the existing direct-image rendering pattern.
- Screenshots inspected for the editor, move room and new-image note at narrow
  phone widths; no overlapping header actions or horizontal overflow observed.
- The report builder still reads room floors and note/image placement from the
  same existing tables. No report/PDF code or existing record was rewritten.

Remaining release/acceptance gates:

- [ ] Apply `docs/db/2026-09-11_01_ob_round_mutations.sql` in Supabase before
  deploying the new frontend/API. No SQL execution access is available in this
  task; the migration has only been run on a disposable PGlite database.
- [ ] Verify the installed migration with the real existing triggers/RLS and
  multiple database connections on a disposable inspection.
- [ ] Verify the resulting PDF, including moving notes between inside/outside,
  on that disposable inspection. SQL row preservation is not a rendered PDF test.
- [ ] Test real phone camera/gallery, offline queue recovery and reconnect.
- [ ] Publish only after the database dependency is ready. Keep the old round.

See [deployment and recovery notes](OB_MOBILE_ROUND_V2.md) for the transaction
boundary and recovery limitations. No live inspection or working mockup data
was edited in this follow-up.

## Evidence And Scope

Reference implementation:

- `.cache/ob-safe-lab/ui/MobileRound.tsx`: approved mobile screens, movement,
  deletion, and two-tab image linking.
- `.cache/ob-safe-lab/ui/ImageNoteForm.tsx`: editable free/catalog image notes.
- `.cache/ob-safe-lab/ui/roundSearch.ts` and `mobile-round.css`: search and layout.
- [Local test-copy documentation](OB_LOCAL_TEST_COPY.md): recorded decisions
  and prototype mutation/verification contracts.

Production implementation:

- `src/components/ob/ObMobileRound.tsx`: four main views and four sheet types.
- `src/components/ob/ObStepRunda.tsx`: shared data/save/upload controller.
- `src/components/ob/mobile-round.css` and `src/lib/ob/roundSearch.ts`.
- `test/ob-mobile-round.test.ts`, `scripts/test-ob-mobile-round-ui.mjs`, and
  their synthetic fixtures.

The audit compares source, recorded decisions, and existing test coverage.
It is not a click test against the user's live inspection. "Present" below
means implemented in the production source, not fully accepted on real phones
or verified against production database permissions.

## Missing Workflows

| ID | Prototype contract | Production status |
| --- | --- | --- |
| M1 | Icon-only Flytta rum at the right of the room header; select another floor, review destination, confirm; retain room ID, notes and images. | Missing. Room header has only back arrow and place/title. |
| M2 | Icon-only Flytta notering at the right of the note header; choose floor/room or exterior part; move text, risk, investigation and linked images together. | Missing. Editor has no move action or callback. |
| D1 | Radera rum in the room header, not in the overview; explicit confirmation; only empty rooms may be removed. | Missing, including the content check and confirmation. |
| D2 | Radera notering in the note header; confirm; retain linked pictures at their place under Att bearbeta. | Missing, including retained-image handling. |
| D3 | Radera bild in Koppla bild and beside linked thumbnails; confirm; retain the note. | Missing in both locations. |
| I1 | Koppla bild has Befintlig notering and Ny notering tabs, retaining image/place context above both. | Only existing-note linking is present. |
| I2 | Ny notering searches suggestions, supports free text, and lets note/risk/investigation text be edited before creation. | Missing as part of I1. General free-note editing elsewhere is not equivalent. |
| I3 | Skapa och koppla uses the image's place, not the last visited room, and saves the note/link together. Tab changes/cancel create no empty record; retry creates no duplicate. | Missing, including production transaction and retry protection. |

The production props expose neither `onMove`, `onRemove`, nor
`onCreateImageNote`. This is missing implementation, not merely hidden icons.
Do not wire the prototype's local `/lab/*` handlers into the deployed app.

## Features Carried Over

| Area | Behavior | Status / qualification |
| --- | --- | --- |
| Places | Valj plats on the left; compact Insida/Utsida control on the right. | Present. |
| Places | No duplicate floor heading or visible Plan label; add-room icon beside floor selector. | Present. |
| Places | Select a floor, list rooms, add a room with type and optional name, enter exterior parts. | Present. Physical-device and database acceptance still required. |
| Context | Room/floor or exterior-part context, with a back arrow to places. No duplicate Byt plats action. | Present; move/delete header actions are missing (M1/D1). |
| Header | Inspection/address/menu header on Places, Notes and Pending Work; hidden inside rooms and exterior parts. | Present. Test-copy label is replaced with real inspection context. |
| Navigation | Bottom navigation: Platser, Noteringar, Att bearbeta. | Present. |
| Position | Remember view and selected place during the browser session. | Present with a production-specific storage key. Prototype position is not imported. |
| Sheets | Back arrow on the left; sticky header/footer; one scrolling body and background scroll lock. | Present in the four implemented sheets. Five move/delete sheets are absent. |
| Notes | Free note; edit note/risk/investigation; Klart and back flush pending saves. | Present. Free-note creation still creates an empty record immediately. |
| Save feedback | Debounced, serialized saves; visible failure; retain/recover a local draft; warn on leaving with drafts. | Present. Saving is not the same as report approval. |
| Suggestions | Grouped categories, expandable choices, full preview, quick-add button, open an already added choice. | Present. |
| Search | Denna plats/Hela biblioteket; local multiword/accent-insensitive matching, small synonym list, ranked wording matches. | Present. No AI or comprehensive semantic search. |
| Notes list | Search recorded notes; show place, text, risk/investigation badges and image count/thumbnail. | Present; see the existing classification limitation below. |
| Pending work | Empty free notes, known unfilled template fields, internal quick-note text, unlinked images and counts. | Present. Not a complete report-readiness check. |
| Images | Camera/gallery callbacks in the editor, camera in the place view, linked thumbnails/full-size links. | Present through the shared upload queue. Real camera/upload acceptance is not proved by synthetic tests. |
| Existing image link | Wrapped searchable radio list; image-place matches first; explicit confirmation; cancellation writes no link. | Present. No new-note tab (I1-I3). |
| Readability | Non-black primary buttons, readable disabled states, compact responsive layout. | Present for implemented mobile controls. Missing move/delete controls have not been rendered/tested. |
| Integration | Own OB-runda (ny) menu entry; old round retained; same inspection and existing workflow/lock guards. | Present. This is an additional frontend, not a separate copy of the live inspection. |

## Existing Limitations, Not Lost Prototype Fixes

- **Inget att notera:** both prototype and production `hasNote` include
  `status === 'ok'`, so these checkpoints still appear as notes and contribute
  to counts/link choices. The earlier concern is unresolved in both. Separate
  checked-without-finding state from authored notes without deleting records or
  dropping real note/risk/investigation text.
- **Five-second note / finished report on departure:** neither is an accepted
  performance/completeness guarantee. A pending count of zero and a saved note
  do not prove that the inspection report is ready for delivery.
- **Material choices and voice capture:** general free-note text does not add
  custom material values to other inspection forms. A dedicated voice-note
  workflow and full checkpoint-model replacement are not implemented by this
  mobile prototype transfer.
- **Test-copy data:** test moves, deletions and text edits are deliberately not
  synchronized to production. A floor or count differing between the prototype
  and the live inspection is not by itself evidence of lost production data.
  Never import the modified working copy over the ongoing inspection.

## Original Audit Checklist

This is the checklist as recorded before implementation. Current results and
remaining release gates are listed in the implementation follow-up above.

- [ ] M1: Move a room to another floor; confirm and cancel; retain ID and all
  related notes/images; correct destination after reload and in report data.
- [ ] M2: Move a note between rooms and between interior/exterior; flush edits
  first; retain text/risk/investigation/status/template references; linked
  images follow current placement while original capture metadata remains.
- [ ] D1: Delete an empty room; reject nonempty rooms, including images,
  quick-note text and marked checkpoints; return to a valid overview.
- [ ] D2: Delete a note only after confirmation; keep its images discoverable
  under Att bearbeta and preserve their capture metadata.
- [ ] D3: Delete linked/unlinked images through their detail views; retain
  notes; define safe recovery/shared-media handling, not accidental hard deletion.
- [ ] I1-I3: Both image tabs, free/catalog composition, editable templates,
  automatic image-place selection, atomic create-and-link, cancellation with
  zero writes, and retry after a lost response without duplicate notes.
- [ ] All mutation endpoints reject foreign inspection references, stale
  destinations/content, unauthorized users and locked/paused inspections.
  Partial failure must not leave records or relationships half-updated.
- [ ] Pending/failed uploads and text saves cannot race moves/deletions.
  Test multiple clicks, slow requests, failures, reloads and concurrent edits.
- [ ] All nine sheet variants have consistent back/move/delete placement and
  correct cancel destinations. Check 320/360/390/430px and desktop, long labels,
  keyboard focus, visible errors and no duplicate document scrollbar.
- [ ] Add an explicit prototype-to-production acceptance suite covering every
  M/D/I item. Current tests must not be presented as full parity checks.
- [ ] Verify existing and new report/PDF placement on a disposable inspection;
  verify a real phone camera/gallery and upload recovery without using the
  user's ongoing inspection for destructive tests.
- [ ] Document any remaining difference before publishing. Keep the old round
  available until it is no longer needed for missing workflows.

## Verification Performed In This Audit

- Source comparison of all prototype mobile views and nine sheet variants
  against the production component, controller integration and stylesheet.
- Read the prototype move/delete/image-note contracts and current test coverage.
- Unit/integration assertions: `node --experimental-strip-types --test
  test/ob-mobile-round.test.ts` (4 passed).
- Browser suite: `node scripts/test-ob-mobile-round-ui.mjs` passed for the
  implemented layouts, menu switching, search, save/recovery, existing image
  linking, and lock/pause states. Synthetic records only; no external requests.
  It has no move, delete, or new-image-note cases and is not a parity pass.

No live inspection mutations, prototype resets, database migrations, or
deployment were performed for this audit.
