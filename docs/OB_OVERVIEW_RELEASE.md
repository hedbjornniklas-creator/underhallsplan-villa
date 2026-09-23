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

Push only the isolated release to main, without force. Confirm the matching
GitHub Vercel status succeeds, then check hushub.se for the new overview client
and an unauthenticated API response of 401 with private, no-store caching.

The in-app browser tool failed to initialize during this publication task.
An authenticated end-to-end browser check on production remains outstanding;
synthetic browser tests and the database read must not be represented as that.
The user should check their own rows and both existing detail links after login.

## Rollback

Revert the isolated overview code commit on top of current main, then deploy.
No database restore or reverse migration is needed. Keep unrelated later
changes and the separate backup commits intact.
