# Inspection access hardening

Status: local preparation and tests complete; a sealed schema rehearsal and OB
building migrations are installed in the separate staging project. Remote SQL
building smoke checks pass. Security migrations `09`/`10` have subsequently run
in staging only, followed by
initial real-JWT/PostgREST/Storage and isolated-app checks. Broader security,
offline and PDF acceptance remains outstanding. See
[OB staging rehearsal](OB_STAGING_REHEARSAL.md). No
production mutations, activation, Storage changes or real-inspection mutations. This
security release is independent of the optional multi-building release. Do not
execute all date-prefixed SQL files.

## Staging target

Verified in Supabase Dashboard on 2026-09-12:

- Organization: `HusHub Test` (Free).
- Project: `hushub-ob-test`.
- Project reference: `lodbgdbmfdtdzfaezblx`.
- API URL: `https://lodbgdbmfdtdzfaezblx.supabase.co`.
- Region: North EU (Stockholm), `eu-north-1`; compute: Nano.
- Initial Dashboard status: Healthy; no migrations reported at creation.

The user created the database and handled its password directly in Supabase.
No credentials belong in this document. Reviewed structure-only SQL and the OB
building migrations were subsequently installed as documented in the rehearsal.
No customer data, Storage files or production integration configuration was copied.
Project health is not application, permission or rollout acceptance.

Production reference `rfresrbuekidumbwzpcm` is NOT an import/test target. Any
future staging command must explicitly verify the staging project reference;
never rely on the displayed branch name `main` to distinguish environments.

The verified structure inventory below has now been used for a sealed staging
rehearsal, including functions, views, triggers and policies. Browser grants are
deliberately withheld pending the remaining access tests. The catalog
exports and synthetic fixtures are not a complete restorable schema. Do not
clone customer records, auth users, uploaded files or secrets.
Supabase-managed auth/storage schemas must not be blindly overwritten. Use
synthetic test users and records after the schema and dependencies are reviewed.

## Schema export progress

The user authorized read-only production structure export on 2026-09-12. A
catalog-only probe confirmed PostgreSQL 17.6, transaction_read_only=on and 218
public relations (tables/views/sequences). That small probe was downloaded as
CSV. No application rows were queried and no migration was executed.

The first full review inventory was submitted inside a repeatable-read,
read-only transaction with a 30-second statement timeout and a final ROLLBACK.
Its editor text was checked against the locally tested query before execution.
The SQL Editor then became unresponsive; that attempt was not downloaded or
validated. After the user closed the blocked tab, a new query was opened without
overwriting an existing user query. The first multipart attempt returned an
upstream timeout. No timeout increase or production mutation was performed.

`2026-09-12_11_schema_structure_export.sql` now returns numbered, checksummed
plain-text parts instead of one large JSON cell. Its snapshot and encoding CTEs
are materialized so the large payload is computed once rather than potentially
recomputed for each output part. The revised query was tested locally, checked
against the editor text, and successfully run in the read-only transaction.
All result rows were downloaded as CSV on 2026-09-12 at 14:43 local time.
`scripts/verify-schema-structure-export.ps1` validated and reassembled all parts.
The verifier rejects missing/duplicate/modified parts, wrong
transaction mode, unexpected section counts, existing output files and output
outside `.cache/inspection-schema-export`. The decoded inventory is private,
git-ignored review material, not executable restore SQL or a full backup.

Verified private artifacts (not to be committed):

- `.cache/inspection-schema-export/production-schema-review-parts.csv`: original
  downloaded CSV, 8,921,729 bytes, preserved without overwriting another file.
- `.cache/inspection-schema-export/production-schema-review.json`: 272 parts,
  6,680,934 decoded bytes; PostgreSQL 17.6; read-only `on`, isolation
  `repeatable read`; all 23 section counts match their arrays.
- Decoded MD5: `4f530b49dbf2b6acf8b96944b5de4ca7`.
- Decoded SHA-256: `7d53203bab004265bbc69f5b22e498e71dfa07490af736b0b66775c6d325827e`.
- Inventory: 215 tables, 2 views, 1 sequence, 2,956 columns, 271 functions,
  1,578 constraints, 749 indexes, 290 triggers and 200 policies. The 218 public
  relations agree with the earlier probe. The four legacy RPC definition MD5s
  agree with the earlier access export.

This verifies transport completeness within the query's stated scope, not a
restoration or full security review. Limited key-pattern screening found no
JWT/private-key/credentialed-Postgres-URL or supported provider-key patterns;
that is not a guarantee that definitions contain no embedded configuration.
Keep both artifacts private and review source/dependencies before any import.

The inventory covers public relations, columns, functions, types, sequences,
constraints, indexes, views, rules, triggers, policies, ACLs, dependencies and
selected platform metadata. It does not export customer rows, auth users,
Storage objects, role passwords, Vault values, cron jobs or integration secrets.
Definitions can still contain embedded configuration and require review before
sharing/importing. Aggregates are identified but have no generated definition;
managed schemas and external-service configuration are not restorable from this
inventory. Use a reviewed schema-only dump for a full restoration when needed.

Four focused tests passed: read-only catalog extraction with record canaries,
empty-schema behavior, a multi-part export of over 1 MB of synthetic source,
and the actual PowerShell multipart verifier (including truncation/corruption/
output-scope checks). Targeted ESLint passed. The later staging-only import and
its scope/omissions are documented in `OB_STAGING_REHEARSAL.md`.

## Current changes

- Building cutover `2026-09-12_04_ob_building_cutover.sql` now checks and removes
  the installed constraint-owned global overview uniqueness rule, only after
  creating its per-building and legacy replacements. Unexpected definitions
  abort the transaction. No dedupe, CASCADE or inspection-row edits.
- Security draft `2026-09-12_09_inspection_access_hardening.sql` enables RLS on the
  affected child tables and applies an owner boundary to all 19 targeted tables,
  including `building_media` from the second export.
  An additional restrictive policy constrains old permissive policies; adding
  only another permissive policy would not contain existing `USING(true)` rules.
- Anonymous/PUBLIC table and column grants are revoked on those targets.
  Browser CRUD remains for 12 existing client-written tables. Seven server-owned
  measurement/order/audit tables allow owner SELECT but not browser mutations.
- TRUNCATE/REFERENCES/TRIGGER are revoked from public/anon/authenticated in the
  inspection catalog scope. Existing service grants and triggers are retained.
  Missing tables, unsafe roles or inherited grants abort the transaction.
- No SECURITY DEFINER authorization helper, new org-wide permission, or change
  to the meaning of `properties.owner` is introduced. The future homeowner
  portal needs explicit separate access design; owner here is the existing
  platform user ID, not a free-text property-owner name.
- Additional draft `2026-09-12_10_inspection_rpc_media_hardening.sql` restricts
  four reviewed legacy functions to service-role calls and adds a restrictive
  owner/path boundary for the two shared media buckets. It does not replace
  function bodies, alter public bucket flags, delete files or rewrite URLs.

## Caller inventory

| Path | Existing access | Effect / required check |
| --- | --- | --- |
| `src/components/ob/ObStepRunda.tsx`, `ObStepInsida.tsx`, `ObStepUtsida.tsx`, `ObStepForutsattningar.tsx` | User-session reads/writes | Keep CRUD for own inspection; test both rounds and conditions. |
| `src/app/(app)/properties/[id]/buildings/page.tsx` and `[buildingsId]/page.tsx` | User-session building CRUD | Own-property boundary; verify gallery/Storage separately. |
| `src/app/api/ob/inspections/[id]/buildings/route.ts` | Checked server/service commands | Root/part checks unchanged; tested together with the hardening SQL. |
| OB addon-orders, area-measurement and moisture-control API routes | Org-filtered service queries | Preserve service DML; test owner and authorized colleague via API, not direct table writes. |
| EB inspection images and note-images API routes | Org/module checked service queries | Shared `inspection_images` service grants remain; test authorized and foreign-org requests. |
| EB lock/delivery/unlock and TU unlock API routes | Checked service RPC calls | Keep service EXECUTE; remove direct browser/anonymous EXECUTE. |
| OB default-room creation | SECURITY DEFINER insertion trigger | Trigger owner retains helper EXECUTE; callers do not need direct helper access. |
| OB profile settings uploads | Browser `profiles/{userId}/...` in property-media | Permit own profile path, not another user's; TU org-profile uploads remain server-managed. |
| `src/lib/tu/server.ts` | Service client and separate TU tables | No TU-table policy changes; regression-test its API access. |
| `src/app/utlatande/[propertyId]/[inspectionId]/page.tsx` | User-session report reads | Owner SELECT remains, including measurement attachments. |
| `src/app/api/reports/public/[token]/route.ts` | Hashed-token/revocation checks, service snapshot/PDF reads | Keep public delivery via this route, not anonymous operational-table access. Verify original PDF links. |

This inventory is source inspection plus local SQL tests, not live authorization
or delivery acceptance. `service_role` bypasses RLS, so route/RPC checks are still
required. Row isolation does not validate every cross-table reference. Storage
and owner-executed views/functions can expose data independently of table RLS.

## Second export review

The supplied `08` result has been reviewed: 4 roles, 21 memberships, 206 function
metadata entries, 36 tables, 7 media policies, 3 buckets, 2 views and no explicit
column grants. There are no exported API-schema role settings; that does NOT
prove the public schema is unexposed. No further copy of this same export is
needed before staging setup.

- anon/authenticated have no superuser/BYPASSRLS flags or service-role membership
  in this export. Service-role bypass and authenticator role switching are
  expected platform mechanisms, not findings to remove.
- `building_media_all_authed` is unrestricted; `09` now contains this table with
  a building -> property owner boundary for reads and writes.
- Both `inspection-images` and `property-media` are public. Their Storage
  policies permit broad authenticated writes and public object metadata reads.
  `10` bounds listing/signing and mutations to the correct owner; service-role
  EB/TU operations and other buckets retain their existing access.
- Source definitions for `ensure_inspection_default_other_room_and_points`,
  `lock_eb_inspection_report`, `unlock_eb_inspection_report` and
  `unlock_tu_investigation_report` were matched to the exported definition MD5s
  by reproducing pg_get_functiondef locally with CRLF bodies. The confirmed
  definitions do not authenticate their caller; all four are anon/authenticated
  executable and SECURITY DEFINER. A synthetic test reproduced an anonymous
  lock/unlock/default-room call even AFTER table hardening alone. No production
  function was invoked. `10` revokes these direct grants, permits the existing
  service callers and aborts for unknown definitions/inherited execute grants.
- `is_org_member` and `is_org_admin` use auth.uid() in their exported bodies.
  An execute grant alone is not proof of a vulnerability. Trigger-returning
  functions are not ordinary callable mutation RPCs; other module helpers must
  be judged separately, not indiscriminately revoked.
- `components_calc` has anon/authenticated SELECT and no security_invoker option.
  The later verified `11` inventory supplies its definition: it is owned by
  postgres and joins `components` to `component_types`, exposing property IDs
  and component comments without a view-level owner filter. It also confirms
  unrestricted authenticated SELECT/INSERT/UPDATE policies on `components`
  alongside owner policies; the permissive policies combine with OR. Changing
  the view to security_invoker alone would not fix those table policies.
  This remains an unresolved maintenance-plan access finding outside `09`/`10`,
  requiring caller review and staging tests before a separately scoped fix.
  No production customer rows were read to probe it. API exposure still needs
  verification; metadata does not establish prior exploitation.
  `renoapp_flow_connections` is security_invoker and has no anon/authenticated
  SELECT in the earlier export.
- Installed root lock guards permit family/variant metadata changes in addition
  to lock fields, unlike the earlier fixture version. Neither security draft
  changes these guard bodies; installed-schema integration still needs rehearsal.

Important residual: public asset URLs remain downloadable by anyone who knows
the URL. The new Storage policy does not make these downloads private. Changing
that requires an explicit private-serving/signed-URL design covering old report
snapshots, PDF rendering and profile images; it must not silently break existing
deliveries. This metadata is not evidence that anyone exploited the weaknesses.

## Execution gates

1. Review remaining view/API paths in the staging schema and resolve exposure
   findings before declaring isolation complete. Preserve
   the original catalog exports privately for comparison; do not commit live data.
2. Rehearse on a separate Supabase staging project with the installed schema,
   auth roles, triggers and Storage policies. Use synthetic owners A/B, a same-org
   colleague, another org and an anonymous client. Check real PostgREST and API
   reads/writes, locked reports, offline uploads/retry, old/new rounds, EB/TU,
   PDF generation and existing public-token downloads. PGlite is not this gate.
3. Verify a scoped database backup, original PDFs and Storage backups, with a
   tested restore procedure. Database backup alone does not back up image files.
4. After separate production approval, apply the revised `09`, then `10` for this
   security release, not the building SQL files. Both are transactional, use a
   5-second lock timeout, and deliberately fail with
   `INSPECTION_ACCESS_REVIEW_REQUIRED` unless its reviewed execution includes
   `set local app.inspection_access_hardening_approved = 'true';` after BEGIN in
   each approved execution. `10` requires the `09` building-media boundary first.
   Never remove that gate merely to work around an error.
5. Rerun the read-only `00` and `08` exports and the acceptance smoke tests.
   Compare policy/grant/trigger metadata and confirm PDF/image availability.
   If anything fails, stop rollout and diagnose; do not restore broad anonymous
   grants as a shortcut. No automated unsafe rollback is supplied.
6. Only later, after separate building acceptance, run the reviewed `01`-`04`
   sequence for that release. Keep its rollout OFF until explicit activation
   approval, backup verification and a pause in editing/uploads.

## Local verification

`test/inspection-access-hardening.test.ts` executes the real security SQL against
synthetic PostgreSQL fixtures, including actual SET ROLE anon/authenticated/
service_role. It checks CRUD isolation, reparent rejection, explicit column-grant
revocation, inherited-grant failure, read-only server tables, unchanged records,
idempotence and the existing inspection-lock migration.

`test/ob-buildings.test.ts` includes the installed overview uniqueness constraint,
known image CASCADE/origin SET NULL rules and the control-item side check. Tests
exercise duplicate/nonduplicate floors (including NULL), unexpected-schema abort,
legacy preservation and building service commands after access hardening.

`test/inspection-rpc-media-access.test.ts` loads the reviewed legacy SQL and
reproduces the anonymous definer-function bypass in an isolated database. It
then tests the real `10` migration: direct-call denial, service lock/unlock,
automatic initialization, owner-scoped object queries, upload/upsert and move
rejection, preservation of object rows/public bucket flags/function bodies,
other-bucket compatibility, and failure for unknown functions/inherited grants.
These are PostgreSQL permission tests, not live Supabase Storage HTTP tests.

Verification run, 2026-09-12:

- 77 targeted security/building/preflight/round/image/API/report tests passed.
- Strict targeted TypeScript checks pass for the three SQL test files.
- ESLint passes for the security and preflight tests. The existing building test
  fixture still has seven pre-existing explicit-any lint findings.
- Project-wide TypeScript reported existing errors in
  `test/ob-drainage-building-data.test.ts` (166, 168),
  `test/tu-workflow-profile.test.ts` (12, 16), and
  `test/tu-organization-profile-server.test.ts` (413). It also identified a query
  result typing issue in our earlier preflight test; that issue was corrected
  and verified by the targeted type check. No unrelated test files were edited.
- No full application build, live Supabase/PostgREST test, Storage migration,
  production backup/restore or PDF delivery acceptance was performed here.

Second-export follow-up: all 85 tests in the expanded targeted run passed. The
additional prerequisite/inherited-execute regression then passed in the complete
9-test RPC/media suite (86 distinct targeted tests covered). Strict targeted
TypeScript passes for all four SQL test files; ESLint passes for the two security
test files. No production statements, buckets or records were changed.

References: [PostgreSQL policies](https://www.postgresql.org/docs/17/sql-createpolicy.html)
and [PostgreSQL privilege revocation](https://www.postgresql.org/docs/17/sql-revoke.html),
[Supabase public/private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[Supabase function access](https://supabase.com/docs/guides/database/functions).
