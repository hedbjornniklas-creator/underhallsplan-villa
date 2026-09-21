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
node scripts/test-ob-mobile-round-ui.mjs
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
