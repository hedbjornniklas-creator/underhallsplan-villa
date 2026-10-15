# OB release, 2026-10-15

## Authorization And Scope

The user confirmed running
`2026-10-15_01_ob_approved_assignment_content_lock.sql` and explicitly requested
publication. The release integrates these previously prepared chat commits with
production `f3cc130a`, preserving its dashboard and organization permissions:

- `491f6ee8`: member identity refresh, digital report tools and square photo cells.
- `f2ca35c3`: retire the two old generic lists and consolidate assignment actions.
- `79b7045f`: delivery text follows the actual lock, not completion status alone.
- `18534991`: issued/approved assignment confirmations remain read-only.

The integration keeps colleague access read-only, including unissued drafts.
Only the responsible editor may share a report link or archive/cancel an
assignment. Authorized colleagues may download the selected stored PDF; the
private status/download endpoint never renders or replaces a document.
Pending organization-visibility checkbox edits are protected against automatic
member-list refresh, including focus immediately after clicking the checkbox.

No historical texts, snapshots or PDFs are rewritten. Tests use synthetic data,
mocked email delivery and local PostgreSQL. No customer acceptance, inspection
change or real email is used as a production verification step.

## Database Boundaries

The new approved-content guard is covered by the user's SQL confirmation. The
earlier optional `2026-10-14_01_organization_invitation_profile_identity.sql`
only fills empty personal identity fields during future invitation acceptance;
this release does not claim that migration has been applied or run it remotely.
Member-list identity fallback and refresh do not require a historical backfill.
The organization colleague-read support comes from the existing production
release, not a new permission or database operation in this publication.

## Verification

The integrated candidate is checked against assignment lock, immutable archive,
early-start/reissue, organization read/write boundaries, legacy redirects,
selected-version PDF/sharing, overview and dashboard regression suites.
Browser probes use the real components with synthetic HTTP responses for
assignment forms, terms/original downloads, member refresh and legacy actions.
Full TypeScript checking and an isolated production build use staging-only
configuration. Public deployment verification must match Vercel's successful
commit deployment with the ID served by `hushub.se`; git push alone is not proof
of production activation. Authenticated customer-workflow smoke tests are not
performed automatically.
