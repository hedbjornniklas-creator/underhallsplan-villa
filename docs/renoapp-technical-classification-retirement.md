# Retiring technical classification

## Application release first

The six technical classification checkboxes are removed from the flow builder,
including its editor, overview, help, copy/save payloads and AI proposal fields.
The board summary now lists only the applicant's selected renovation types.
Existing cases retain their stored renovation types and fall back to their legacy
action label when needed. Extra technical flags from an older API response are ignored.

The application no longer reads or writes the six `implies_*` columns on
`renovation_action_types` or the `renovation_case_checks` table. The unused legacy
`createPublicApplication` entry point and its checks-based risk calculation are removed;
the public route continues to use `upsertPublicApplication`.

Risk levels configured on renovation types, questions and answer triggers, document
requirements, participant roles, review flags, terminology and completion requests
are unchanged. Historical terminology records are not technical-classification
settings and are not deleted. Older AI proposals may fail the existing stale-snapshot
check after the release; reload the flow builder and generate a fresh proposal.

Deploy and verify this release while leaving the old database objects in place.
It must work both before and after the optional database cleanup. Check new drafts,
submission, reopening existing cases, completion rounds, admin edits/copying and AI.
Close or reload older browser tabs, and ensure no old deployment or external consumer
still reads/writes the retired objects before removing them.

## Optional database cleanup after deployment

`docs/db/2026-09-07_05_renoapp_retire_technical_classification.sql` is a separate,
manual follow-up, not a prerequisite for the code release. It is blocked unless
both `code_is_deployed` and `backup_is_verified` are `true`.

On 2026-09-07 the operator confirmed that the retired controls are absent from the
live flow builder and accepted the scheduled backup shown as 2026-09-06 22:05:19 UTC,
including the possible loss of later changes if a full restore is needed. Both
confirmations were set to `true` for that approved manual cleanup. No restore test or
successful production SQL execution has been verified here.

The repository defaults have since been restored to `false` to prevent accidental
reuse of that approval. This does not change the database or SQL already copied to
Supabase. Before any new execution, check the current database state, deployment,
backup and dependencies, then confirm both prerequisites in the manual execution
copy only. Keep the repository defaults `false`.

1. Verify a restorable backup covering the old columns and checks table.
2. Inspect production views, functions, triggers, policies and external integrations
   for dependencies. Repository searches alone cannot establish production state;
   PostgreSQL also does not track every dependency in procedural/dynamic SQL.
3. Confirm the code release is live and tested. Set both confirmations to `true`
   and run the complete migration in one transaction.
4. Recheck creation/submission, case reading and admin saving after cleanup.

The migration removes only the six columns and the checks table. It keeps the action
types, cases, configured risk levels, documents, participants and shared timestamp
function. Unknown table columns or database dependencies stop it; do not add `CASCADE`
to bypass a failure. The confirmed migration is rerunnable. Keep old migration files
as history; fresh databases apply them in order before this follow-up.

After cleanup, rolling back to an older application version requires restoring the
retired schema and data from backup first. No production SQL is run by the test suite.
