# OB property workspace release - 2026-09-25

Status: published to hushub.se and verified at the deployment level.

## Scope

- Compact desktop workspace for Fastighet & uppdrag, with buildings inside
  Objekt and mobile-sized controls retained on touch layouts.
- Inspector details hidden only in this workspace. Review, reports, snapshots
  and stored inspector information retain their existing behavior.
- Cover image selection from the inspection image bank, copying the source
  image without removing it or its note association.
- Protected digital reader for the published, frozen customer report snapshot.
  This is an authenticated reader, not a reconstruction of the customer's
  original secret link. It does not regenerate historical reports.
- One PDF download action in the visible delivery log, with a status-panel
  fallback when no successful sent-report download is visible.

No SQL migration or production data edits were needed. No customer mail was sent
as part of this release verification.

## Commits and Deployment

- Source branch: `codex/ob-staging-cleanup-2026-09-13`.
- Source commit: `da7d641`.
- Production commit: `d2a1cf39817772e56f94b027b1aa434ffd268e96`.
- Vercel reported success for `dpl_AJyRaBZ3x8t8YZiWrgxeLwTD9C9T`.
- A separate floor-label fix was published immediately afterwards as
  `6030fa1569edcbf89977a63fcfff680e068c691f`. Git ancestry confirms that it
  includes this release; its changes touch only floor logic and its test.
- Live login HTML returned HTTP 200 and deployment identifier
  `dpl_1pKPze7Vy3MZBufRrnCZCB8KdupN`, matching that newer production deployment.
- An anonymous request to the new digital reader with synthetic UUIDs returned
  HTTP 307 to `/login`, as expected. This is not an authenticated customer-data
  click test.

## Verification

Executed against an isolated checkout of the production commit:

- 27 targeted unit, source and render tests passed across property forms,
  buildings, queued saves, cover selection, delivery links, PDF actions,
  published snapshot access and early-start API behavior.
- `next build --webpack` passed, including TypeScript and static generation.
  Local build used placeholder Supabase configuration, not production secrets.
- `preview-ob-brand.mjs --forms --test` passed at 320, 390, 768, 1024, 1280,
  1440 and 1920 pixels, plus enlarged-text cases. Checks cover overflow,
  controls, building placement, read-only state and retained review information.
- `test-ob-mobile-round-ui.mjs --cover-bank-only` passed on mobile and desktop.
- `preview-ob-brand.mjs --forms --test-autosave` passed at 320, 390 and 1280
  pixels for all three forms: no field-position, scroll or height shifts and no
  lost focus during autosave.

Synthetic browser fixtures were used for interaction checks; no inspection
content was changed in production to test the release.
