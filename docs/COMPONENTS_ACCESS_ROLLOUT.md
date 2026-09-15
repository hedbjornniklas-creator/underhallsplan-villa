# Component access hardening

Status, 2026-09-13: installed and tested in `lodbgdbmfdtdzfaezblx` only.
No production SQL, deployment, customer records or Storage files were changed.
This is a separate security migration, not an OB building activation.

## Scope and evidence

The verified PG17 schema inventory showed two independent problems:

- `components_calc` executes with the view owner's permissions and had anonymous
  SELECT. Its formula reads property IDs and private component comments.
- `components` has unrestricted authenticated SELECT/INSERT/UPDATE policies in
  addition to owner policies. Permissive policies combine with OR.

Both were reproduced with synthetic local PostgreSQL rows. Making the view an
invoker view alone still exposed both properties to a logged-in test user.
No production records were read to demonstrate either problem. The exported
schema is not evidence of prior exploitation.

Current source search found no runtime callers of `components` or `components_calc`.
Generated Supabase types refer to both; `actions.component_id` references the table
with ON DELETE SET NULL. No exported function body references either target.
The active admin and inside/outside settings pages use **component_types**, the
shared catalogue, which is not the private `components` table.

## Migration

`docs/db/2026-09-13_03_components_access_hardening.sql`:

- Revokes anonymous/PUBLIC table and column grants on the two targets.
- Preserves authenticated owner CRUD on `components`; adds a restrictive owner
  boundary that also contains the old open policies. The owner is the existing
  `properties.owner` platform user ID, not the owner's name in an OB report.
- Makes `components_calc` security_invoker and authenticated read-only. Existing
  calculations, IDs, data, foreign keys and service-role grants remain unchanged.
- Removes unused browser whole-table privileges, including PG17 MAINTAIN, and
  aborts for inherited grants that would retain those privileges.
- Requires PG17, parent RLS/read access, safe roles/owners and the reviewed view
  definition MD5 `38bc1fab925f9f9e25764354522d46c1`. A changed formula requires review,
  not removing the guard. The migration is transactional with a 5-second lock timeout.

No new SECURITY DEFINER helper, organization-wide sharing or homeowner-portal
access model is introduced. The migration does not edit grants/policies on the
shared catalogue, properties, actions, OB, TU or EB tables, or make media private.

## Tests and staging

- Local tests cover the original leak, repeat application, unchanged records and
  calculations, anonymous denial, owner CRUD, cross-property read/write/reparent
  rejection, service compatibility, inherited column/table grants, unexpected
  schemas/roles and rollback without partially opening a sealed table.
- Six live PostgREST check groups pass with real synthetic owner/other-owner JWTs,
  an anonymous client and the staging service client. The two owners belong to
  the same synthetic organization; being a colleague does not grant ownership.
- Both seeded records and every calculated value match the pre-migration snapshot.
  The original OB mobile fixture remains unchanged in all seven audited tables.
- Staging evidence: `.cache/ob-staging-app/components-access-1789306773207/` and
  `components-access-latest.json`. These private files are not production backups.
- Final verification: 54 targeted security/building/report/staging regression
  tests pass, including the eight new component-access tests. Workspace TypeScript
  and targeted ESLint pass. No frontend source changed in this step, so the previous
  successful isolated app build was not repeated for this SQL-only correction.

The SQL editor's full text was copied back through its UI and compared with the
reviewed file before execution. It reported `Success. No rows returned`.
The staging wrapper verifies the pinned project/source/installation marker before
granting authenticated **SELECT only** on the previously sealed `component_types`
catalogue, then runs the real migration in that same transaction. This prerequisite
grant is staging-only; production already had catalogue SELECT. Catalogue writes
remain sealed for browser users in staging. Wrapped SQL SHA-256:
`f057454d7070cf63ba5573f7618175cea4169cad6aada6e9c5edbaf8df794267`.

Reproduction: run `node --experimental-strip-types --test test/components-access-hardening.test.ts`.
For guarded live tests, `node scripts/test-components-staging-access.mjs --prepare`
creates a new, separate synthetic fixture. Run the guarded migration using
`node scripts/serve-ob-staging-access.mjs --components-access`, then pass the
printed fixture directory to `test-components-staging-access.mjs`. Do not remove
the project guard or run the staging access/seed bundle against production.

## Before production

1. Review current metadata and any external callers, including services outside
   this repository. Reconfirm ownership semantics and the unchanged view definition.
2. Complete the wider access/role acceptance in `INSPECTION_ACCESS_ROLLOUT.md`.
   The separate catalogue/admin-input migration is now installed and tested in
   staging; see `COMPONENT_CATALOGUE_ACCESS.md`. It protects both catalogue writes
   and the profile/role inputs to the existing admin predicate. Other configuration
   tables and production profile-management callers still require acceptance.
3. Complete the backup/restore, original PDF, phone and external delivery gates
   in `OB_RELEASE_READINESS.md`, then obtain explicit production rollout approval.
4. Run only the reviewed migration with
   `set local app.components_access_hardening_approved = 'true';` inside BEGIN.
   Do not batch all date-prefixed SQL files or use the staging wrapper in production.
5. Verify owner and foreign-owner reads/writes, unchanged calculations and retained
   data. Stop on errors; never restore anonymous/open grants as an automatic rollback.

References: PostgreSQL [invoker views](https://www.postgresql.org/docs/17/sql-createview.html)
and [restrictive policies](https://www.postgresql.org/docs/17/sql-createpolicy.html).
