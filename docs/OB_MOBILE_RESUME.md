# OB mobile resume correction, 2026-09-21

## Scope

Continuation approved by the user after the forms release and mobile investigation.
Only OB navigation and assignment-workflow reads change. No SQL, authentication,
authorization, inspection mutations, image storage, report or other module changes.

- The inspection page remembers section and building in sessionStorage, keyed
  by inspection id. It stores identifiers only, not text or permissions.
- Restoration validates the stored choice against this inspection's menu and
  buildings before mounting an editor. Missing/foreign building ids do not open
  an editor for a different building. Bad/unavailable storage falls back safely.
- The round's existing per-building room/view storage and Back boundary remain
  unchanged. The page now mounts that round directly on reload instead of first
  making the user choose it again. Existing explicit mobile-round links work.
- Add-on redirects wait for the add-on request so a restored step is not rejected
  solely because its selection is still loading.
- Workflow reads share one in-flight request and have a 15-second deadline,
  including the save barrier and response body. Stale/cancelled results cannot
  replace newer status. Cleanup cancels reads, never pending inspection writes.
- Returning from a hidden/offline state replaces interrupted reads. Focus,
  pageshow, visibilitychange, resume and online all trigger recovery; simultaneous
  events share the new request. The existing 30-second visible-page retry remains.
- Connection, expired-login and access errors have clear messages and a 48px retry
  control. Errors still disable editing; paused/locked/access safeguards are not
  bypassed. Recovery updates status in place, without reloading or replaying POSTs.

## Verification

```powershell
node --experimental-strip-types --test test/ob-inspection-navigation.test.ts test/ob-workflow-read.test.ts test/ob-mobile-round.test.ts test/ob-assignment-reconciliation.test.ts test/ob-grunddata-queue.test.ts test/ob-building-navigation.test.ts test/ob-brand.test.ts test/ob-forms-brand.test.ts
node scripts/test-ob-early-start-ui.mjs
node scripts/test-ob-mobile-round-ui.mjs
node scripts/test-ob-resume-next.mjs
npx tsc --noEmit
```

The Next test creates an isolated production-built fixture from checked-in test
sources. It uses the real inspection page, menu, round UI and Next router, with
synthetic auth/data adapters. It validates room/building/conditions restoration,
repeated menu re-entry, browser Back, root exit and inspection re-entry. No external
network requests or customer data are allowed. Temporary artifacts are ignored.
The normal full application release build checks production source separately.

The workflow browser suite verifies offline/online and visibility recovery,
deduplication, hung-request timeout, preserved note text, 401/403, and paused-state
guards. The full round regression retains save-error, local-draft, image queue,
link/unlink/delete, swipe, Back and lock coverage.

## Publication Receipt

Verified on 2026-09-21 at 22:50 CEST:

- Source commit `1b53daa` is pushed on `codex/ob-staging-cleanup-2026-09-13`.
- Only this fix was cherry-picked onto production as
  `a3b11e16ad2fc7b384e5fbcbd11cf43caed20fad`, following `109ba37`.
- All 29 targeted unit/static tests, both browser regression suites, the
  production-built Next router integration and full source TypeScript check pass.
- The isolated full application `next build --webpack` passes. Its build uses
  non-working environment placeholders, not production credentials.
- Vercel deployment `78omne2w7Fq5nQHxWBYAEGwCXDrA` reports Ready, Production,
  commit `a3b11e1`, with `hushub.se` assigned.
- Read-only live verification loads the authenticated inspection form and menu,
  with one `OB-runda` entry and no captured browser console errors. No fields,
  rooms, notes, images or customer data were changed during this check.
- Unrelated Uppdrag/RenoApp work is excluded. No SQL was run or is required.

Deployment: https://vercel.com/niklas-projects-65efdd50/underhallsplan-villa/78omne2w7Fq5nQHxWBYAEGwCXDrA

## Remaining Real-Device Check

The exact Android app-switch failure cannot be asserted as reproduced end to end.
Protocol-level freeze tests were not reliable with the headless Next/BFCache
fixture, so the automated return-event test is not claimed to emulate OS discard.

After publication, open a room in an extra building, switch between Chrome and
another app several times, then reload and use Back. Repeat with a brief airplane
mode period, a pending note and an image upload. Check that the same building/room
returns, status recovers, and text/images remain. Do not clear browser storage:
pending local drafts and image uploads use it.

Rollback is a revert of only this release commit. No database rollback is needed;
the previous version ignores the new navigation key.
