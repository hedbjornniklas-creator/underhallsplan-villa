# OB draft guards and image-link feedback

## Decision, 2026-09-21

The user reported repeated unsaved-text warnings when changing inspection steps
and creating an image note, plus action errors displayed as persistent inline
banners. They confirmed retaining the existing global upper-right desktop toast
placement (full safe width at the top on mobile), and approved publication after
passing verification.

## Causes and Correction

- The internal step menu reused the inspection-exit confirmation. A draft in any
  step therefore prompted even when navigating back to the editor needed to save
  it. Internal step/building changes now preserve the draft without that prompt.
  Actually leaving/reloading the inspection still has the data-loss guard.
- Creating a separate image note used the broad draft guard for destructive
  moves/removals. It now bypasses only that unrelated-text check. Lock, in-flight
  mutation and pending-image guards remain. Other operations retain their checks.
- DebouncedTextarea cleanup compared text to potentially lagging props and could
  recreate a draft after acknowledged saving. Cleanup now checks the dirty ref;
  blur does not resave clean text just because props lag behind. Failed or
  unfinished saves still retain their local text.
- After a successful round data read, local note drafts identical to the returned
  text are removed. This covers the current building scope and known retired
  note editors. Different, unknown, orphaned, malformed or concurrently replaced
  drafts remain untouched. Optimistic UI state is never used for this cleanup.
- Recoverable image-link/create errors now use the global toast queue. Text and
  retry request IDs remain intact when a toast closes. Locked states, placement
  validation and unavailable catalogue states remain persistent where needed.
- Toasts render in an open native dialog's top layer, or in the body otherwise,
  so the global queue is not hidden behind a modal backdrop. Position, timing,
  deduplication and announcement semantics remain shared across modules.

No customer records, authentication, permissions, SQL or report logic change.
Do not clear browser storage to work around warnings: it may contain real drafts
and pending images.

## Verification

```powershell
node --experimental-strip-types --test test/ob-draft-reconciliation.test.ts test/ob-mobile-round.test.ts test/ob-brand.test.ts test/ob-forms-brand.test.ts test/ob-room-name-images.test.ts test/eb-report-editing.test.ts test/ob-inspection-navigation.test.ts test/ob-workflow-read.test.ts
node scripts/test-ob-mobile-round-ui.mjs --core-only
node scripts/test-ob-resume-next.mjs
npx tsc --noEmit
```

The browser fixture deliberately retains an old field prop after an acknowledged
save, then unmounts the real textarea. It also checks failed-save restoration,
modal toast visibility, dismissal and mobile/desktop position. Image-note tests
cover retry and automatic error-toast dismissal without discarding entered text.
Menu tests verify internal navigation with retained drafts, and cancellation when
actually leaving the inspection. All fixtures use synthetic data and block
external requests. The live customer's local draft contents are not inspected.

## Publication Receipt, 2026-09-21

- Source commit: `672688691b2111b114779c43415d67b34db667b7`.
- Production commit: `4acefeb0de23ee92be5c0c238a0d3e7dc6ea4847`, isolated from
  unrelated Uppdrag and RenoApp work and pushed to `main` after verification.
- Vercel deployment: `AwEo7zM1UhQELhG8D88wPZpceP3g`, created at 23:22:38 CEST.
  Verified Ready, Production, current domain `hushub.se`, and the exact commit.
- 41 unit/static tests passed, together with TypeScript, the core browser suite,
  the Next.js navigation/resume test and an isolated `next build --webpack`.
  The initial full browser suite caught the clean-blur regression; after fixing
  it, the core suite passed. The full default suite was not rerun to completion.
- Mobile and desktop toast screenshots were visually inspected. Browser checks
  verified visibility above a native modal and automatic error dismissal.
- Read-only live smoke: the existing test inspection opened after authentication
  and its step menu rendered. No fields, rooms, notes or images were changed.
- No SQL migration is required. Reload only after pending saves/uploads finish;
  do not clear browser storage containing drafts or queued images.

## Follow-up: Native Reload Warning

After publication the user reported Chrome's native reload warning directly when
moving from the round to property/assignment, without pressing Reload. This is
not the removed internal-menu confirmation, and its cause is not yet confirmed.

The Next router regression now also seeds a retained local draft, reloads the
synthetic inspection, and repeats round-to-property navigation three times. It
passes without a document navigation or a dialog, and retains the exact draft.
The affected live inspection's initial page also loads in the separate in-app
browser session; no customer fields were edited and the round was not entered,
since entering it can initialize defaults. This does not establish the state of
the user's Chrome tab or its local drafts.

The next diagnostic is opening the same inspection in a new Chrome tab while
keeping the original tab intact. That loads the published code with fresh tab
history without clearing browser storage. Do not classify the inspection as
corrupt, discard drafts, or remove the actual leave/reload guard without evidence.

## Targeted Mutation Guards, 2026-09-22

The user then reported the same unsaved-text message when deleting a note. The
remaining move/removal guard was still inspection-wide: a draft in documents,
conditions, another note or a removed editor could block every deletion. The
previous release only exempted new image-note creation from that check. This is
a confirmed application defect, not evidence that the inspection is corrupt.
The native reload warning above remains a separate, unconfirmed issue.

- Note moves/removals now inspect drafts for that exact note ID, including old
  editors and all building scopes within the same inspection.
- Room moves/removals inspect that room's notes and local quick note. Other rooms
  and shared-step drafts do not block them. Existing server checks still reject
  deleting rooms with contents, stale confirmations and unauthorized operations.
- Image deletion retains note text, so text drafts do not block it. Renaming a
  room label likewise leaves note identity, contents and draft keys unchanged.
- Target drafts are protected even if their JSON is unreadable. Inaccessible
  local storage fails closed for note/room mutations. The guard clears no data.
- A successful note-write response may reconcile an identical draft using the
  existing exact-match cleanup. Different or unknown drafts are never discarded.
- Move/removal action errors now use the global auto-dismiss toast. Failed
  preview loading and locked/occupied states remain persistent; destructive
  confirmation, retry identity and the ability to recheck content remain intact.
- Pending saves/uploads, inspection-exit guards, server authorization and locks
  are unchanged. No SQL or customer-data maintenance is needed.

The user approved publication after passing tests. Regression coverage includes
unrelated retained drafts, a target draft introduced after deletion preview,
legacy/cross-building keys, room protection, retry with a lost response, toast
expiry and unchanged unrelated draft text. Synthetic fixtures use the production
target-selection helper; a separate adapter contract test verifies its wiring.

Verification before publication:

- 81 unit/static/API tests passed (the eight draft/navigation/brand suites above,
  plus `ob-round-mutations.test.ts` and `ob-round-mutation-api.test.ts`).
- `npx tsc --noEmit` and the isolated full `next build --webpack` passed.
- The full mobile-round browser run passed the earlier building, image, Back,
  swipe, room, suggestion, floor and mutation checks. Its feedback test then
  sampled a newly mounted field before its restore effect. The test now waits
  for the restored value; no textarea runtime code changed for this timing fix.
- `node scripts/test-ob-mobile-round-ui.mjs --core-only` subsequently passed,
  including scoped mutation guards, draft preservation, failed-response retries,
  modal toast expiry, navigation and 320-1280px layouts. No external requests.
- The removal-error mobile screenshot and desktop toast screenshot were visually
  inspected. No real customer deletion or move was used for verification.

## Publication Receipt, 2026-09-22

- Source commits: `6b95bd0` (runtime fix) and `61d1215` (verification).
- Production commit: `7d79a35bbbd914598e4e2ca2f02fcaa4d5f22a5c`, pushed to
  `main` from the clean, isolated release worktree. Unrelated work was excluded.
- Vercel deployment: `AsqnxFx3UVgfjzKmuM8cUh5ByHww`, created at
  08:54:25 CEST. Verified Ready, Latest, Production, domain `hushub.se`, and
  the exact production commit in the deployment overview.
- Verification results are recorded above. No customer data was moved, removed
  or edited to test the release. No SQL migration is required.
- The native reload warning remains unconfirmed. To compare the published
  version, open the inspection in a new tab and keep the old tab intact. Do not
  clear browser storage containing local drafts or queued images.

## Visible Local Drafts And Resumed Autosave, 2026-09-22

The browser's native reload message does not identify a field. The inspection
guard currently sees every local draft key; image upload queues can also trigger
the same native message. This report does not establish which key or queue item
exists in the user's separate Chrome session. Do not claim all local text is
unsaved or that this diagnosis establishes why a reload was initiated.

Confirmed code defect: a restored `DebouncedTextarea` marked its text dirty but
did not schedule autosave until focus/blur or another edit. Restored editable
text now resumes the existing debounce/save path. Disabled/read-only fields
never autosave; this includes inherited workflow fieldset locks and a lock
introduced while waiting for the debounce. Unlocking resumes the pending edit.
A late failed save cannot replace
newer local text or recreate an older draft after a successful newer save.

The inspection now lists its local text drafts via **Visa texter**. It displays
their step, text and, where comparison is supported, the server's version.
**Kontrollera mot sparat** issues only inspection-scoped reads. It removes a
local copy only when all recognized text fields exactly match a successful
server read and the stored raw draft has not changed during that read.
Different, missing, malformed or unsupported/composite drafts remain untouched.
Comparison currently supports round notes, document/disclosure notes and the
two inspection-level text fields; other forms are visible but not auto-cleared.
Unknown extra payload fields also prevent cleanup. No server record is changed.

The native exit guard remains as protection against genuine pending work.
The user approved publishing these changes after tests. Verification uses
synthetic text only, including late failures, locking, restoration without blur,
unknown records, failed reads, concurrent edits and mobile/desktop layouts.

Verification before publication:

- 37 unit/static tests passed across draft inventory/comparison, scoped draft
  reconciliation, mobile-round wiring, inspection navigation, workflow reads
  and the shared textarea's EB consumers.
- The core mobile-round browser regression passed, including 320-1280px layouts,
  autosave/recovery, image linking, paused/locked states, global toasts and drafts.
- The isolated real Next router test passed reload, Back, repeated menu entry,
  background return and retained drafts across internal step changes.
- Additional browser checks cover restored autosave without focus/blur, explicit
  and inherited locks, late failures and read-only comparison cleanup.

### Publication Receipt: Restored Autosave

- Source commit: `8dffefc`. Production commit:
  `e091f508b80777ec5156e4f618c124a070eaae23`.
- The final core browser regression passed again after the inherited fieldset
  lock checks. The isolated full `next build --webpack` passed, including
  TypeScript and all 62 static pages, using non-working build placeholders.
- Production was pushed from the clean release worktree. Only the ten scoped
  implementation, test and documentation files were included. Parallel Uppdrag
  and assignment-list changes remain untouched in the original workspace.
- Vercel deployment `6pTRqrditfP4kwerrXgD5vK2yX1N` was verified Ready, Latest,
  Production, with domain `hushub.se` and the exact production commit above.
  The deployment completed at 23:05:25 CEST on 2026-09-22. The public home page
  loaded successfully afterward.
- No SQL is needed for this release. No customer inspection record or the
  user's actual local drafts were modified during testing or verification.
- The user's separate Chrome draft contents and the initiator of the reported
  reload remain unverified. Open the inspection in a new tab while retaining
  the original, then inspect **Visa texter** / **Kontrollera mot sparat**.
  Do not clear browser storage as a workaround.
