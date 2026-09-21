# Assignment link recovery, 2026-09-21

## Incident and isolation

The public token resolver embedded `assignments` without naming a relationship.
After the organization-scoped foreign key was added, PostgREST found two possible
relationships and returned PGRST201. The public route returned HTTP 500.
The resolver now explicitly uses `assignment_links_org_assignment_fkey` and keeps
the `assignments` response alias. This is also used by the legacy-column fallback.

The hotfix was released as `47fd5f2` from production baseline `5bc8659`.
Work was isolated from unrelated dirty files in the main workspace.
No customer link was replaced, revoked, resent or accepted during verification.

## Recovery and notifications

- Technical open/accept failures return a safe Swedish message, a random reference
  and a retry indication. Database details and raw tokens are not returned/logged.
- Retry reads status; it never automatically submits an acceptance. Text is retained
  on same-link retries. Changed terms require fresh consent.
- Failed confirmation email delivery does not invalidate a saved acceptance.
- Server-side incident rows contain assignment/link IDs, sanitized error codes,
  references, timestamps and notification state, not tokens or customer form data.
- Only the responsible active organization member is eligible for an alert email.
  The alert contains an authenticated internal assignment URL, not a customer link.
- Failures on the same active incident are grouped. Notification claims are locked
  per link and limited to one attempt per incident and at most one per 24 hours.
- Successful reads clear earlier open failures. Confirmed acceptance clears earlier
  failures. Request start time prevents a success clearing a newer known failure.
- The OB assignment list and detail view show unresolved incidents. Diagnostic
  storage failure is shown as unavailable, not as a false all-clear.

## Database rollout

`docs/db/2026-09-21_01_assignment_link_incidents.sql` was applied to staging and
production on 2026-09-21. It is additive and does not rewrite assignments or links.
An idempotent organization/assignment unique index supports older staging schemas;
production already had the index from the organization-card migration.

Verified in both environments: RLS enabled; anon/authenticated table access and
incident RPC execution denied; service-role RPC execution permitted; an unknown
synthetic token hash ignored; initial incident count zero.

## Verification

- 79 targeted Node tests pass: resolver/fallback, public GET/POST, consent, link
  state, saved-acceptance follow-up failures, SQL access/deduplication, notification
  recipient scoping, mailer, PDF generation and existing OB/TU assignment behavior.
- Production Next.js webpack build and TypeScript checks pass.
- Scoped lint has no newly introduced errors. Eight existing explicit-any errors
  in `server.ts` also reproduce on baseline `5bc8659`; one existing img warning.
- Actual React pages were click-tested against synthetic HTTP fixtures on desktop
  and 390px mobile: retry, retained text, safe status check, saved acceptance with
  failed email, inspector detail warning and list badge. No real contract submitted.
- The hotfix production API returns 404 for an unknown diagnostic token rather
  than 500. A read-only query with the reported latest link hash resolves its row.

## Limits and rollback

Historical failures are not backfilled. Alerts require a known active link and
working server/database/mail dependencies; they are not email delivery monitoring.
Provider acceptance is not proof of inbox delivery. Alerts have no automatic retry
worker; a failed attempt is visible in the inspector view. A process interruption
can leave a pending attempt. No intentional production failure or real customer
acceptance was triggered to test notifications end-to-end.

The follow-up app changes can be reverted independently while retaining hotfix
`47fd5f2`. Leave the additive diagnostics table/functions in place; do not delete
incident history or alter customer links as part of rollback.

Synthetic UI preview: `node scripts/preview-assignment-link-recovery.mjs`.
It binds only to loopback and uses no database or mail credentials.
