# OB overview release, 2026-09-23

## Database pagination and refresh correction, 2026-09-25

The user requested fixing the slow overview and avoiding fetching every
inspection as the register grows. This update returns 10 rows by default
(25/50 selectable), with global search/filter/sort/counts in the database.
Ordinary pages evaluate authoritative workflow details only for their rows.
The action-required filter still evaluates all matching candidates for exact
results. Focus/visibility refreshes are deduplicated for five seconds; manual
refresh and mutation-triggered refresh remain immediate.

The isolated production candidate starts at `97b2d2a`. Only the overview's
component, API, loader/model/query parser, migration, tests and documentation
are included. The working branch's unpublished visual changes are excluded.

Pre-publication verification:

- 44 Node tests passed (39 overview tests plus five early-start API tests),
  with additional existing module/profile/dashboard assertions passing.
- SQL integration tests verify 50 workflows return 10 rows and 10 workflow
  evaluations normally; action-required filtering correctly evaluates all 50.
  RLS, org/owner boundaries, private fields, reissue/legacy links, paging limits,
  page clamping, counts and Swedish ordering are covered.
- Real-component synthetic browser checks passed at 12 viewport widths and
  seven panel widths, including search debounce, pagination, focus races,
  error recovery, 200 percent text and existing links.
- Scoped ESLint and the isolated production `next build --webpack`, including
  TypeScript and 62 static pages, passed using non-working Supabase values.
  Turbopack cannot use the external node_modules junction; no app configuration
  was changed to work around that local limitation.
- The production SQL was rehearsed in a transaction and rolled back, then
  installed before the application update. An authenticated-role SQL check
  returned 10 of 50 rows, 10 distinct rows on page two, one action-required row
  and page five when requesting beyond the last page. First query durations
  were 282.9 ms in the rehearsal and 28.3 ms in the warm installation check;
  these are individual database observations, not whole-page benchmarks.
- Production function bodies match the reviewed migration (Windows CRLF body
  MD5: page `616b90889e4841409f3e198fcdbffcde`, flags
  `694a75816f012ccc336596187854432f`). ACL checks passed: no anon execution,
  no authenticated execution of the full workflow-state RPC, invoker page
  function and restricted definer flag helper. No customer records changed.

Application deployment and authenticated browser verification are recorded
after publication. To roll back, deploy the previous application first, then
optionally remove only the two new functions as documented in
`docs/db/2026-09-25_01_ob_overview_pagination.sql`.

## City column and narrow-window correction, 2026-09-24

Published after the user's explicit approval:

- Source commit: `d28ede4`; production commit: `696c9f1`, based on `8bd72d6`.
- City has its own column immediately after address. Assignment numbers are
  hidden in desktop/mobile rows and expanded details, but remain searchable.
- The compact table is retained from 56 rem of available content width.
  Smaller screens and enlarged text retain the stacked mobile layout.
- Only five scoped component/CSS/profile/documentation/test files changed.
  Parallel assignment-confirmation documents were left untouched. No SQL,
  stored-data, API, access, workflow or environment changes were published.
- All 37 regression tests passed in the isolated production worktree.
- Synthetic browser checks passed at 12 viewport widths and seven panel
  widths, including 125 percent pixel density, 200 percent text, city column
  visibility, missing city, hidden-number search, uniform rows and details.
  Fresh desktop/panel and mobile screenshots were visually reviewed.
- Scoped ESLint and `next build --webpack`, including TypeScript, passed.
  The local build used non-working placeholder Supabase values.
- Vercel succeeded for `696c9f1`:
  [deployment](https://vercel.com/niklas-projects-65efdd50/underhallsplan-villa/3a7cp2kmz221jgePHXRBfPBfxzrP).
- Public hushub.se login-page assets identify that deployment:
  `dpl_3a7cp2kmz221jgePHXRBfPBfxzrP`. The login page returns 200, anonymous
  `/ob` redirects to `/login` with 307, and `/api/ob/overview` returns 401
  with `private, no-store`. No authenticated production click test was run.
- Code was synced to main and the working/backup branch. This verification
  receipt is kept on the backup branch without triggering another release.

To roll back only this follow-up, revert `696c9f1` on current main and deploy.
No database restore is needed; preserve unrelated later changes.

## Compact list update, 2026-09-24

Published the user-approved density update, isolated from other work:

- Source code commit: `2c5fc16`; production code commit: `cdffba1`.
- Production tip including approval documentation: `8bd72d6`, based on `f076e54`.
- Wider list, uniform 14/20 px desktop typography and 56 px standard rows,
  separate customer/number columns, labelled icon links and keyboard-accessible
  full-text detail rows. Mobile retains full text and visible action labels.
- Only seven OB page/component/profile/test files differ from the previous
  production version. No SQL, API, data model, access or workflow changes.
- All 37 regression tests passed in the isolated production worktree.
- Real-component synthetic browser suite passed at nine widths from 320 to
  1920 px, including 200 percent text, long values, equal row heights,
  full-width layout, keyboard details, page-size value fit and existing flows.
- Scoped ESLint and `next build --webpack` (including TypeScript) passed.
  The isolated local build used non-working placeholder Supabase values.
- Vercel status succeeded for `8bd72d6`:
  [deployment](https://vercel.com/niklas-projects-65efdd50/underhallsplan-villa/8ffx3cZzq9RQX3GkAU1uMFUJ3ZGA).
- The public hushub.se login-page assets identify that same deployment,
  `dpl_8ffx3cZzq9RQX3GkAU1uMFUJ3ZGA`. Anonymous `/ob` redirects to `/login`
  (307); the overview API returns 401 with `private, no-store`.
- The browser tool still fails during initialization. An authenticated live
  click test was not performed; synthetic UI checks are not that test.

To roll back this visual update only, revert `cdffba1` on current main and
deploy. Keep the overview feature and unrelated releases; no DB restore.

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
