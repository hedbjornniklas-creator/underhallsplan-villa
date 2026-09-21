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
