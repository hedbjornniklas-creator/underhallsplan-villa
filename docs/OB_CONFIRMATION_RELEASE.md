# OB confirmation archive release, 2026-09-24

## Approved scope

The user confirmed running the SQL migration and explicitly authorized
publication. Source commit `ae4ecd3` contains only the 20 OB implementation,
test, preview and documentation files. Other uncommitted plans remain untouched.
The isolated production candidate is `91aece9`, based on `696c9f1`.

This release adds approved-term display, immutable new-acceptance snapshots,
original PDF attachment archival/download and frozen-copy email recovery.
It does not change existing terms, PDF layout, historical documents or other
module workflows. Exact SBR original layout is not part of this release.

## Verified before publication

- 61 automated tests passed in the isolated production worktree.
- The real-component synthetic browser suite passed at mobile/desktop widths,
  including byte-identical download, missing historical original, retry,
  double-click prevention and no unrequested writes.
- `next build --webpack` passed, including TypeScript and 62 static pages.
  The local build used non-working placeholder Supabase credentials and the
  archive flag enabled. That local artifact is not a production deployment.
- Scoped ESLint passed. The existing shared server file retains its eight
  pre-existing no-explicit-any errors; they are not introduced by this release.
- Read-only checks against production project `rfresrbuekidumbwzpcm` verified
  both new tables and their expected columns. Service requests returned 200;
  anonymous requests returned 401. All reads used limit zero: no customer
  document contents were retrieved, and no production data was written.
- The actual migration's immutable triggers, snapshot transaction validation
  and privileges passed PGlite tests. The read-only production REST checks do
  not independently verify installed trigger definitions or authenticated RLS.

## Activation and remaining live checks

Production requires `OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED=true` in Vercel, saved
before the deployment that should enable capture. The browser/desktop control
tools failed to initialize, and no Vercel CLI credential was available. The
user confirmed saving the Production setting on 2026-09-24 after checking its
name, value and environment in the Vercel UI. A fresh deployment of unchanged
application code is being triggered to pick it up. Direct runtime confirmation
of the flag and an end-to-end live acceptance remain outstanding.

Until activation the existing acceptance/email behavior continues. Archived
document read endpoints do not require the flag. After activation, only new
acceptances opt in; no older PDFs or acceptances are reconstructed or backfilled.

An authenticated production click test and a new synthetic acceptance/email
delivery on the live deployment remain outstanding. No real customer approval,
email or inspection was used as a test. Deployment identity and anonymous route
checks are recorded below.

Rollback must preserve the archive tables and their contents. Disabling the
flag stops new capture/retry, not original-file reads. Do not restore an older
database over the immutable archive or overwrite accepted documents.

## Production deployment verified, 2026-09-24

- Published commit `a6b5ce9ae109131fdb2b8c9345b86e0d5defb1c3` to `main`
  using a normal fast-forward push from the isolated release worktree.
- Vercel reports success for deployment
  `dpl_G1NuEYsx6mREtdHsu1f5LtqBurqc`. The public `hushub.se/login` HTML
  references the same deployment ID and responds with HTTP 200.
- Anonymous `/ob` redirects to `/login` (307). Anonymous terms/PDF GETs and
  confirmation POST with an all-zero synthetic assignment ID return 401 and
  `Cache-Control: private, no-store`. No real assignment was used or changed.
- That deployment completed before the user confirmed saving the archive flag;
  it is not evidence that the flag was active on that deployment.
- This receipt was initially saved on the working/backup branch. It is now
  promoted together with the activation record to trigger the required rebuild,
  without bringing any parallel application work into production.

## Activation rebuild, 2026-09-24

The user confirmed `OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED=true` was saved for
Production and authorized the new deployment. The isolated release worktree
contains documentation-only changes since `a6b5ce9`; application code remains
the tested `91aece9` implementation. No SQL, customer acceptance, email or
historical document is modified by this activation deployment.
