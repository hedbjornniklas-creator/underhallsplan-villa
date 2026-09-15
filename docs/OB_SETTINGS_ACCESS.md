# OB shared settings access

2026-09-14: permissions migration installed in **staging only**
(`lodbgdbmfdtdzfaezblx`). This is not production rollout approval.

## Boundary

The pinned schema-only export shows anonymous table writes with RLS disabled on
15 of the 19 catalogues below. `document_types` has an unrestricted authenticated
write policy. The three overview tables restrict row writes to legacy admins but
also have unsafe whole-table grants. These are schema findings, not evidence of
exploitation; no production customer records were read or changed in this audit.

`docs/db/2026-09-14_01_ob_settings_access.sql` protects this explicit scope:

- `document_types`
- `settings_disclosure_items`, `settings_basinfo_fields`, `settings_condition_options`
- `settings_overview_items`, `settings_overview_groups`, `settings_overview_options`
- `settings_exterior_items`, `settings_exterior_groups`, `settings_exterior_options`
- `settings_interior_room_types`, `settings_interior_groups`, `settings_interior_options`
- `settings_control_points`, `settings_control_point_options`, `settings_control_point_outcomes`
- `settings_text_snippets`, `settings_addon_services`, `settings_certifications`

Authenticated catalogue reads remain available. INSERT/UPDATE/DELETE require the
existing `is_hushub_besiktapp_admin()` predicate, including legacy admins and valid
global BesiktApp admin assignments. Organization administration is not sufficient.
Command-specific restrictive policies contain older permissive policies. Anonymous
access, column grants and whole-table browser operations are revoked; inherited
bypass privileges abort the transaction. Service privileges are preserved.

The migration requires `2026-09-13_04_component_catalogue_access.sql` first. It
checks the reviewed helper hash, protected profile/admin-role inputs, false admin
default, relation owners, schema permissions and PG17. Its explicit execution
approval is `app.ob_settings_access_approved='true'` inside the transaction.
Do not remove a guard when deploying to an unfamiliar schema.

No catalogue rows, inspection records, report snapshots, PDFs or Storage objects
are rewritten. Existing defaults, validation, foreign keys and delete cascades
remain unchanged. An authorized catalogue deletion still follows those existing
foreign-key rules; this change does not make every admin deletion non-destructive.

## Callers And UI

An AST scan of literal Supabase table calls found catalogue writes only in the
BesiktApp admin client and five dedicated settings editors. Normal OB conditions,
rounds, report building, profile certification selection and assignment add-ons
read these definitions; their instance writes use separate inspection tables.
The SQL functions referencing these catalogues were also inspected for writes.
Standard report text in the application is not a table named `standard_texts`.

The five editors (`forutsattningar`, `handlingar-upplysningar`, `ob-control-points`,
`ob-insida`, `ob-utsida`) and the BesiktApp admin page now share a fail-closed
catalogue guard using the existing permission hook. It checks again on focus and
auth changes. This hides configuration editing from ordinary inspectors, not the
actual inspection pages or the separate inside/outside component read-only views.
Database policies enforce every write even when an editor was already open.

`document_types` also serves EB/shared building documents. Its established central
BesiktApp administrator remains the writer. Service-managed EB/TU code retains its
access. This is not acceptance of all EB/TU/RenoApp workflows or external callers.
The derived AI search index and separate EB/TU configuration tables are outside
this migration; none receive new grants here.

## Verification And Reproduction

- `node --experimental-strip-types --test test/ob-settings-access.test.ts`:
  eight tests execute the actual migration and prerequisite, including all 19
  read/write boundaries, full upsert payloads, both admin models, service CRUD,
  expiry/revocation/scope/module checks, rollback and idempotence.
- `test/fixtures/ob-settings-access.sql` contains generated schema, never customer
  rows. `scripts/export-ob-settings-fixture.mjs` pins the source SHA256 and
  reproduces columns/defaults/constraints/triggers/policies. Local PostgreSQL uses
  a UUID extension shim; real Supabase tests retain the installed extension.
- The broader 70-test security/building/report/staging regression run passes.
- Prepare: `node scripts/test-ob-settings-staging.mjs --prepare`. This takes a
  before-snapshot and reuses three separate synthetic catalogue-test accounts,
  not the original click-test users. It creates no new credentials or authority.
- Execute: `node scripts/serve-ob-staging-access.mjs --ob-settings`. The reviewed
  SQL includes the pinned staging installation/source guard. It does not rerun
  the broad access/bootstrap bundle. The complete editor text was copied back and
  compared before Run; Supabase returned `Success. No rows returned`.
- Verify: `node scripts/test-ob-settings-staging.mjs <printed-folder> --ui`.
  Temporary inactive rows have unique IDs/keys and no inspection links. Actual
  JWTs exercise each catalogue; the UI uses isolated authenticated browser contexts.
- Recover an interrupted rehearsal with the same folder and `--cleanup`. Exact-ID
  cleanup revokes temporary authority before removing probe rows, retries only
  idempotent cleanup and records failures. No baseline row is a deletion target.

Evidence is ignored/private under
`.cache/ob-staging-app/ob-settings-1789388586015/` and `ob-settings-latest.json`.
The SQL wrapper SHA256 is
`cf1f3a15ce17443b4a757f5e7c0be6c88b49b1ff9dc2642cdcdb5e38171154fa`.
An initial UI run was interrupted and its cleanup hit a transport error. Temporary
admin authority was explicitly removed, then full cleanup and snapshot comparison
passed before rerunning. It must not be recorded as a passing end-to-end run.

The subsequent complete run passes all six real staging check groups, including
the five editors and admin page at 390px, actual JWT catalogue CRUD and revocation.
Original catalogue/inspection/profile snapshots are equal and temporary authority
is removed (`completed: true`, `authorityRemoved: true`). The denied-access view
and authorized conditions editor screenshots were visually checked. This verifies
permission states, not every existing admin form or its responsive layout.

The nine-group four-building safety rehearsal also passes after this migration:
independent conditions, rooms and actual image uploads; cross-building moves;
atomic image-first notes; lost-response replay; owner/stranger/anonymous boundaries;
frozen snapshots and locked edits. It creates a separate synthetic inspection.
Original click-test records remain byte-for-byte equal in the audited tables.
Evidence: `safety-1789391559452/` under the same ignored staging cache.

The isolated optimized Next build passes, including route types and all 62 static
pages, completed **2026-09-14 13:12:08 UTC**. All 731 source files were byte-compared
against the workspace. See `settings-build.log` and `release-build-latest.json`.
Targeted strict TypeScript for the new test and targeted ESLint pass. An earlier
workspace type check exposed stale generated route declarations and two test-only
type annotations, not an application build failure; annotations were corrected
and the stale generated declaration was backed up and refreshed from that build.
The final full-workspace `tsc --noEmit` also passes (`settings-types.log`).

## Remaining Release Gates

Follow `OB_RELEASE_READINESS.md`: real-device/offline checks, external email and
public HTTP delivery, scoped data/PDF/Storage backup and restore, real administrator
roster and wider caller audit, then explicit release diff/migration-order approval.
No production SQL, activation, commit, push or deployment was performed here.
