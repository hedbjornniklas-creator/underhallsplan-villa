# OB form autosave layout, 2026-09-24

## Report and cause

The user reported mobile page movement while typing in Handlingar & upplysningar
and requested the same check for Forutsattningar and Fastighet & uppdrag.

The shared local-draft inventory polls every second. Before this fix it inserted
an in-flow banner while a draft existed, then removed it after autosave. Normal
typing therefore changed the page geometry even when the form was not reloaded.
The three forms also inserted/removed saving labels; Handlingar briefly added a
second, timed saved acknowledgement. Long headings could rewrap on mobile.

## Change

- Keep the draft-review row mounted, with neutral styling and a stable count
  area, including zero drafts. The review dialog and exact-server-comparison
  safeguards remain available. A zero count is not a promise that all fields
  elsewhere in the inspection are saved.
- Share a fixed-size, polite pending indicator across all three forms. No
  recurring saved-success acknowledgement or success toast after each edit.
- Do not change save timing, requests, draft storage, locks or error behavior.
  No production inspection data, SQL or historical documents are changed.

## Verification

Use the real components with an isolated in-memory adapter:

```sh
node scripts/preview-ob-brand.mjs --forms --test-autosave
node scripts/preview-ob-brand.mjs --forms --test
node --experimental-strip-types --test test/ob-forms-brand.test.ts test/ob-draft-review.test.ts test/ob-grunddata-queue.test.ts
```

The regression records field position, page/panel height, scroll, focus and
caret across debounce, delayed saves and the former acknowledgement expiry at
320, 390 and 1280px. The short viewport approximates space above a mobile
keyboard; it is not a physical Android keyboard test. Network fallback is
blocked. Failed writes and draft recovery are covered by the existing suites.

Before the fix, draft feedback changed page height by 61px, the conditions
panel by 43px, and property/orderer saving labels changed height by up to 85px
in the synthetic scenarios. The baseline regression failed as expected.

After the fix, all 15 regression scenarios passed with 0px movement across
all measured axes, preserved text/caret/focus, no form reload reads and no
unacknowledged drafts after successful saves.

Also passed:

- Existing form browser suite: 320/390/768/1280px, 200% text, save failures,
  delayed replies, field normalization, building isolation and locked views.
- Existing draft-feedback browser suite: failed/interrupted saves, recovery,
  exact-match draft cleanup and global toast placement above dialogs.
- 16 unit/contract tests for forms, draft review/reconciliation and save queues.
- Full TypeScript check (`tsc --noEmit --incremental false`).
- Scoped ESLint: no errors; six existing hook/image warnings remain.
- Mobile screenshots visually inspected; `git diff --check` passed.

## Publication approval

The user authorized publication on 2026-09-24 after reviewing the local result.
Only this fix and its tests/documentation are included; parallel plans remain
untouched. No SQL or environment changes are required. The production candidate
is based on `7d3849c`; build and deployment verification are recorded separately.
A physical Android keyboard test is still recommended after publication;
no real inspection was used by the automated tests.

## Published and verified, 2026-09-24

- Saved the 12 scoped implementation/test/documentation files in `e7ff4f2` on
  the working branch and cherry-picked them onto the isolated production
  worktree as `97b2d2a90bbf468afcb044dbabd158445ef7f950`.
- Verified all 12 files match the tested working-branch commit exactly.
- Re-ran all 16 unit/contract tests successfully in the production worktree.
- `next build --webpack` passed there, including TypeScript and 62 static pages.
  Local build credentials were non-working placeholders. Vercel builds from
  source with its own unchanged production settings.
- Published via a normal fast-forward push to `main`. Vercel reported success
  for deployment `dpl_AyRFy8D23hv55o1du1rWfsF1nzjL`.
- Live `hushub.se/login` returned 200 with that exact deployment ID. Anonymous
  `/ob` and a synthetic inspection-page URL both redirected to `/login` (307),
  also reporting that deployment ID. No real inspection data was read or written.
- No SQL or environment changes were made. The source changes and this receipt
  are committed and pushed on the working/backup branch; parallel plans remain
  untouched. This receipt alone does not trigger another production deployment.
- Physical Android keyboard verification remains a user follow-up. The live
  checks establish publication/authentication, not an authenticated mobile test.
