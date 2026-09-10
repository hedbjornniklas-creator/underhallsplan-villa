# OB: start before customer approval

Date: 2026-09-10

## User Flow

1. Open a sent OB assignment confirmation. Select **Starta fore godkannande**.
2. Enter a reason (5-1000 characters) and explicitly acknowledge that customer approval is missing.
3. The responsible inspector or an active organization administrator may start. An unused, unrevoked, unexpired approval link must exist. Drafts and archived/cancelled/expired assignments cannot start this way.
4. The inspection opens for notes, images and other working material. The assignment remains `sent`; starting does not create customer acceptance or inspector booking.
5. Internal report previews/printouts carry a draft label. Final completion, locking, report-link creation, delivery and stored final-PDF download are blocked.
6. The customer approves through the existing public link. The inspector accepts the ordered assignment, then compares the original and current confirmation in the workflow panel. Customer changes and addon selections never overwrite inspection work automatically.
7. After differences have been handled in the inspection, explicitly confirm the reconciliation. Only then is final delivery available.

## Invariants

- All OB conversion calls use a single database transaction and assignment row lock. Repeated calls return the same property and inspection. Failed setup rolls back all created records.
- Only early starts create `ob_assignment_workflows`. Already booked normal OB starts need no extra reconciliation step. STATUS, EB and TU keep their existing conversion paths.
- The start records the actor, timestamp, reason and initial confirmation snapshot. Reissue/reconciliation append audit events.
- Approval requires an actual acceptance record matching the active assignment's acceptance timestamp. A booked status alone is insufficient.
- Reconciliation is bound to the current acceptance and confirmation content, including addons and terms. A stale review token is rejected.
- Only server-side privileged RPCs may start, reconcile or move the workflow. Browser writes cannot alter workflow metadata, forge acceptance on a tracked assignment, detach its inspection, or change the inspection family to bypass the guards.
- Existing locked-inspection write guards remain in place. Database triggers also protect direct inspection writes and report-link creation while approval/reconciliation is pending or work is paused.

## Reissued Confirmations

For an early-started inspection, reissue atomically cancels the old confirmation, revokes its unused approval links, creates a new draft, and moves the active workflow pointer. The inspection and its working material are retained; old confirmation IDs remain in audit history.

The new draft pauses inspection writes until it has been sent with a valid approval link. A cancelled, expired or archived active assignment also pauses work, as does expiry/revocation of the link while customer approval is pending. Reissue/pausing invalidates existing public report links; a later review never reactivates old links. Locked inspections must first be unlocked through the existing workflow.

The current assignment ID is not a permanent inspection identifier: always follow `ob_assignment_workflows.current_assignment_id`. Do not create another inspection when the replacement confirmation is approved.

## Deployment

1. Apply `docs/db/2026-09-10_02_ob_early_start.sql` to a staging database with the existing OB, addon, approval and report migrations installed.
2. Deploy the application only after the migration succeeds. Missing workflow schema fails closed, including report delivery for existing OB inspections.
3. Exercise the checklist below with test accounts before applying the migration and deployment in production. This change does not apply migrations or send real emails automatically.

The migration is transactional and repeatable. It wraps the currently installed `consume_assignment_token` function to serialize approval with start/reissue, retaining the installed acceptance logic under `consume_assignment_token_before_ob_early_start`. Do not rerun an older migration that replaces the public wrapper. Future approval-function changes must preserve this wrapper and its locking order.

Do not roll back by deleting workflow rows or removing delivery guards after early starts exist. Keep the guards and records until every active workflow has been resolved.

## Verification

- Database and API regression tests: `node --experimental-strip-types --test test/ob-early-start.test.ts test/ob-early-start-api.test.ts`.
- Synthetic browser tests: `node scripts/test-ob-early-start-ui.mjs` (local Chrome, or set `CHROME_PATH`). Uses actual components with mocked auth/navigation/API; no external requests. Screenshots go to `tmp/ob-early-start-ui`.
- Type check: `npx tsc --noEmit --incremental false`.
- Staging checklist: double-click/retry start; race customer approval against start and reissue from separate connections; approve with changed object/customer/addons; reconcile; complete and send; reissue unlocked work; verify old tokens and report links no longer work; check unauthorized and archived cases.

The PGlite tests cover transaction rollback, repeated calls, actor checks, evidence protection, delayed approval/addons, stale reconciliation, version handover, pausing, final-delivery guards and existing lock guards. They do not replace simultaneous-connection, live RLS/storage and email-provider checks in staging.
