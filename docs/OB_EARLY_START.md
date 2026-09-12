# OB: start before customer approval

Date: 2026-09-10

## User Flow

1. Open a sent OB assignment confirmation. Select **Starta fore godkannande**.
2. Enter a reason (5-1000 characters) and explicitly acknowledge that customer approval is missing.
3. The responsible inspector or an active organization administrator may start. An unused, unrevoked, unexpired approval link must exist. Drafts and archived/cancelled/expired assignments cannot start this way.
4. The inspection opens for notes, images and other working material. The assignment remains `sent`; starting does not create customer acceptance or inspector booking.
5. Internal report previews/printouts carry a draft label. Final completion, locking, report-link creation, delivery and stored final-PDF download are blocked.
6. The customer approves through the existing public link. The inspector accepts the ordered assignment, then compares the current **Grunddata** against the customer confirmation. Blank inspection fields with a nonempty customer value are preselected; existing values require an explicit choice. A blank customer value never clears inspection data.
7. **Uppdatera Grunddata och bekräfta avstämning** imports only the checked contact/object/date/time/role fields and records the review in the same transaction. With no checked fields, **Bekräfta avstämning** retains all inspection values. Scope, addons, prices, invoice details and terms remain a separate manual comparison; they are not imported.
8. Current local Grunddata saves finish before comparison, and the underlying form is disabled while comparing. Failed field saves block import until those fields are saved successfully (unrelated successful saves do not clear the failure). Close the comparison to retry editing. Version tokens cover both the confirmation and saved inspection data: concurrent edits stop the operation without partial import. Re-read the comparison and explicitly confirm again after a conflict. The open page receives only selected saved fields, without reloading notes or images.
9. **Jämför kundens uppgifter med Grunddata** remains available after a previous review, including reviews made with the old acknowledgment-only flow. This lets the inspector bring in a missing phone number later. Locked/finalized inspections cannot be changed here.

## Invariants

- Selective import requires `docs/db/2026-09-12_12_ob_assignment_reconciliation.sql`, applied after the early-start migration and before deploying this UI/API. Installing it does not rewrite historical inspection/customer data. Without the new state/token fields, the UI refuses to acknowledge or transfer, rather than silently falling back to acknowledgment-only behavior.
- Contact fields are stored on `inspections`; object fields on `ob_property_snapshot`, never on the shared `properties` record. The comparison includes the same legacy/fallback values displayed in Grunddata. Legacy contact aliases retain unselected effective contact details. For legacy records with all structured customer fields empty, the displayed fallback values are materialized on the first contact import so switching storage mode cannot hide unselected details; this normalization is audited. Notes, images and nonselected displayed values are preserved.
- A selected date change uses the normal date-based assignment-number rule on the server in the same transaction. The updated number is returned to the open page, even when reconciliation runs outside the Grunddata step.
- Review events include selected field keys and before/after inspection snapshots. Already-reviewed workflows can be reopened safely; inspector edits alone do not reset approval/delivery status.

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
