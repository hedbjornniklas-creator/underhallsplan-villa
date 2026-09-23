# OB overview release, 2026-09-23

## Scope

The user authorized publishing the combined overview below the existing four
OB dashboard cards. Existing assignment and inspection lists remain available.
On mobile the existing cards are grouped under Genvagar.

- Source commit: `4e050b6` on the working/backup branch.
- Isolated release code: `6779e4f`, based on production `7c56262`.
- No SQL, environment changes, stored-data changes, deliveries or approval
  changes are part of this release. The new API is read-only.
- Uppdrag UI and Gizmo branding are preserved separately on the backup branch,
  with automatic deployment disabled there. They are not in this release.

## Completed checks before push

- 37 automated tests passed: overview model/loader/API, assignment module
  boundary, early-start API, existing OB profile and dashboard guide.
- Real-component synthetic browser checks passed at 320, 360, 390, 430, 768,
  1024, 1280 and 1440 pixels, plus 200 percent text. Search, filters, pagination,
  links, shortcuts, refresh races, empty state and error recovery were exercised.
- Clean production worktree passed `next build --webpack`, including TypeScript.
  Local build used non-working placeholder Supabase values, not live secrets.
- A scoped read-only production database check returned 86 rows, including
  41 inspections, in about 2.5 seconds. The existing tables and workflow RPC
  worked. This used admin credentials and is NOT an authenticated RLS test.
- No real customer data was changed and no email was sent by these checks.

## Release verification

Published 2026-09-23 with a normal fast-forward push to main:

- Production code commit: `6779e4f`; production tip including this release's
  preflight documentation: `f076e54`.
- GitHub commit status `Vercel` succeeded for `f076e54`.
- Deployment: `dpl_2EpBDpBNzCkuhEYutpNwePP9BLTD`.
  [Vercel deployment](https://vercel.com/niklas-projects-65efdd50/underhallsplan-villa/2EpBDpBNzCkuhEYutpNwePP9BLTD).
- Public hushub.se login-page assets identify that same deployment.
- Anonymous `/ob` correctly redirects to `/login` (HTTP 307).
- `GET /api/ob/overview` returns HTTP 401, `Cache-Control: private, no-store`,
  and the new route's explicit sign-in error. No customer rows are exposed.
- Scoped ESLint passed on the isolated release after the build and UI tests.

The in-app browser tool failed to initialize during this publication task.
An authenticated end-to-end browser check on production remains outstanding;
synthetic browser tests and the database read must not be represented as that.
The user should check their own rows and both existing detail links after login.

## Working branch cleanup

Saved separately on `codex/ob-staging-cleanup-2026-09-13`, not published:

- `74b0f21`: Uppdrag scoped visual implementation, assets and synthetic UI tests.
  Its browser suite passed on eight routes at 344, 390, 1024 and 1440 pixels.
- `c1d29ce`: Gizmo profile sources and original visual assets. This is a profile
  package, not an app identity change; the older Uppdrag profile remains history.
- `76644bf`: copied the existing RenoApp test report into docs and ignored four
  generated preview/test directories. Original temporary files remain on disk.

The backup branch was pushed with normal Git sync; automatic Vercel deployment
is disabled for that branch. No source files or customer data were deleted.

## Rollback

Revert the isolated overview code commit on top of current main, then deploy.
No database restore or reverse migration is needed. Keep unrelated later
changes and the separate backup commits intact.
