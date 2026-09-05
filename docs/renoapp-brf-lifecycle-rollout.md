# RenoApp BRF lifecycle rollout

## Deploy order

1. Take the normal database backup and run `docs/db/2026-09-05_00_renoapp_brf_preflight.sql` read-only against the target environment.
2. Inspect duplicate organization numbers and access discrepancies. Do not merge or delete associations automatically. Existing duplicates can remain until reviewed; new duplicates are rejected.
3. Apply `docs/db/2026-09-05_01_renoapp_brf_lifecycle.sql` before deploying this application version. It requires the existing RenoApp onboarding/completion/listing/terms and platform access migrations. The migration runs in one transaction and can be rerun.
4. Deploy the application and verify the two onboarding paths below using test accounts. This code change does not apply the SQL or deploy to production itself.

The migration enables RLS and removes browser-role access to BRF associations, memberships, invitations, requests and internal history. These tables are accessed through authorized server APIs using the service role. Lifecycle RPCs are also service-role-only; API handlers verify identity and BRF scope before calling them.

## One lifecycle

- Public request: request -> HusHub approval -> BRF and invitation -> board completes details and accepts terms -> active BRF.
- Manual creation: HusHub creates BRF and invitation -> the same completion and activation process.
- Approval or manual creation does not activate the BRF. Activation, invitation state, and visibility to applicants are separate concepts.
- Visibility is public search, direct link only, or closed to new applications. Existing case links still allow completion of existing applications when new applications are closed.
- The BRF list opens `/admin/renoapp/brf/[id]`, with overview, details, members/invitations and history. HusHub admin uses `hushub_admin/renoapp_admin` access, not a personal board membership.
- The board portal only shows explicitly authorized associations, even for a HusHub admin. A single association is selected automatically. Existing multi-association selection remains available only when needed.

## Existing data and recovery

- Active legacy memberships with no normalized board grant receive a grant. Inactive memberships lose board grants. Existing disabled or expired grants are not automatically restored.
- An admin can explicitly restore access for an active member from the BRF detail page. This action is recorded in history.
- Older invitations have unknown delivery status. Accepted invitations are not reopened. Expired or failed invitations can be replaced using a new link; the previous unused link is revoked.
- Acceptance commits the BRF, terms, membership, normalized grant and invitation together. Auth account creation is external to that transaction; if activation fails after account creation, sign in with that account and resume the still-open invitation.
- Mail sending is outside the database transaction. A failed or interrupted send leaves a visible failed/pending invitation. Use the admin resend action; repeated creation/approval requests never create another BRF or silently send another invitation.
- Rejected request emails can be resent from request history. Only the external message is sent, never the internal note.
- Optional extra invitations are processed after successful activation. Their failures are reported separately and do not undo activation.
- Returning through login preserves the invitation URL and temporarily retains form data in that browser tab for 30 minutes. Passwords and acceptance of terms are never stored.
- Historical actions before the migration do not have a new audit trail. Previously emailed internal comments cannot be recalled.

## Verification

- `npm run test:renoapp-brf`: PostgreSQL migration tests using PGlite and service tests with stubbed mail/auth/database boundaries. No production credentials or mail delivery are used.
- `npx tsc --noEmit` and `npm run build`.
- Local browser smoke tests of the actual admin detail component with fixture data: desktop/mobile tabs, overflow, saving visibility, explicit access restoration, error/retry dialogs and invitation renewal.
- Local browser smoke tests of the invitation component: login return URL, restored form, no stored password or terms acceptance, completed activation with optional-invitation warnings and visible missing-access feedback.
- Before release: complete both onboarding paths with new and existing accounts; verify the resulting board access, public search/direct-link visibility, invitation renewal and member removal in the target database.
