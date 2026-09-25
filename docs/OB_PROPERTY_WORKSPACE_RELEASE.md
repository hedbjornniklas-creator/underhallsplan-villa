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

## Cover Panel Follow-Up - 2026-09-25

Source commit: `a2154da`. Production candidate:
`99ce38d8f07ce4938b042f149c0f18e11f77f09e`, based on `6030fa1`.
Status: published and verified at the deployment level. Vercel reported success
for `dpl_9SNGWwJ4K2xGFJDdVhry8x58mK3t`; fresh hushub.se login HTML returned
HTTP 200 and the same deployment identifier. Anonymous HTML only exposes the
page shell, so this is not an authenticated production interaction test.

- Conditions now includes a closed-by-default Byggnadsbild row in the same
  list and panel navigation as other sections, on desktop and mobile.
- The same location applies without an activated building structure. The
  property workspace no longer shows a separate legacy cover control.
- Existing image paths are read in place. Building-specific covers still use
  building commands; unstructured inspections update only their existing
  `cover_path`, through the existing write queue and with a lock guard.
- Nested image-bank Escape handling closes only the topmost panel. The review
  page retains its existing cover presentation.
- No SQL, building activation, historical snapshot rewrite or image migration
  is included. Unrelated assignment-confirmation work is excluded.

Release-checkout verification:

- 25 targeted tests passed for forms, cover URLs, copy-only image selection,
  queued saves, building overview and published-report access.
- The forms browser suite passed at seven widths from 320 to 1920 pixels,
  including large text, panel navigation, nested bank dismissal, building
  separation, legacy image display/upload/retry, locked controls and unchanged
  inspection data when opening panels. Mobile and desktop captures inspected.
- Cover-bank browser tests passed at 320, 390 and 1280 pixels.
- Targeted ESLint: no errors; six existing image/dependency warnings.
- Production build passed with placeholder Supabase configuration, including
  TypeScript and all 62 static pages. The first local attempt failed inside
  webpack's WasmHash; the unchanged retry completed successfully.

These interaction tests use synthetic local fixtures, not production customer
records. No customer email was sent.
