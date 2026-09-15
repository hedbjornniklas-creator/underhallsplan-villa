# Component catalogue and admin-input boundary

2026-09-13: installed and verified in `lodbgdbmfdtdzfaezblx` only.
No production SQL, deployment or existing administrator assignments changed.

## Findings and scope

The verified PG17 schema export shows unrestricted authenticated writes to the
shared `component_types` catalogue. Its intended admin predicate is the existing
`is_hushub_besiktapp_admin()` used by TU settings: legacy `profiles.is_admin`, or
an active, unexpired, global BesiktApp-admin assignment in `hushub_admin` with
`product_admin`/`hushub_superadmin`. Organization administration is not sufficient.

The predicate's inputs also need protection: the exported self-profile UPDATE
and INSERT grants include `is_admin`. The platform product/module/role tables
have browser write grants without RLS. Local tests reproduce self-promotion and
catalogue writes with synthetic records only. This is not evidence of exploitation;
no production customer records were queried to demonstrate these findings.

`docs/db/2026-09-13_04_component_catalogue_access.sql` changes only permissions
on these six existing relations and adds command-specific restrictive policies:

- `profiles`: existing self-profile reads and ordinary fields remain editable,
  including the actual OB autosave/upsert payload, logo and signature references.
  `is_admin` cannot be inserted or updated by browser clients. New profiles use
  the verified false default. Service-managed profile/role administration stays intact.
- `platform_products`, `platform_modules`, `platform_roles`: existing read grants
  are preserved; browser mutation and whole-table privileges are revoked.
- `platform_access_assignments`: remains server-only, including reads.
- `component_types`: authenticated read remains; INSERT, UPDATE and DELETE require
  the existing BesiktApp-admin predicate. Restrictive policies contain old open
  permissive policies. Anonymous access and whole-table operations are denied.

No rows, classifications, formulas, admin assignments or shared helper body are
rewritten. Existing component references retain their foreign-key behavior.
The migration pins the reviewed helper definition, default, owners, PG17 and safe
schema/role permissions. It aborts atomically for unsafe inherited grants. It
requires `app.component_catalogue_access_approved='true'` inside its transaction.
Do not remove a guard to make an unfamiliar environment pass.

All three catalogue editors use the same database predicate for their UI state.
Controls fail closed while loading or on error. Search remains available. Mutation
responses must return one row before the client reports success, so revoked access
cannot silently appear saved. Database policies, not these UI controls, authorize writes.
The tables own their horizontal scrolling on narrow screens; search, headings and
navigation no longer expand to the table's intrinsic width.

## Rehearsal

- Local: `node --experimental-strip-types --test test/component-catalogue-access.test.ts`.
  Eight tests cover reproduced leaks, repeatability, unchanged data/calculations,
  ordinary/admin/service users, profile upsert, foreign profiles, FK protection,
  expired/scoped/wrong-module assignments and guarded rollback.
- Prepare new synthetic accounts only:
  `node scripts/test-component-catalogue-staging.mjs --prepare`.
- Serve the staging-guarded SQL:
  `node scripts/serve-ob-staging-access.mjs --component-catalogue`.
  This adds the pinned `lodbgdbmfdtdzfaezblx` installation/source guard, not a new
  administrator. Never run the old broad staging access bundle for this step.
- Verify using the printed fixture directory as the script argument. Optional
  `--ui` checks the real editors in a fresh headless browser against loopback57100.
  Only reviewed source files may be copied into the frozen runtime first.
  Each run removes its temporary test admin assignments/flag in `finally`.

Private evidence and credentials remain under ignored `.cache/ob-staging-app/`.
The original mobile fixture and its two user profiles are not edited by this test.

Completed evidence:

- 62 targeted local security/building/report/staging tests pass, including eight
  new catalogue/admin-input tests. Workspace TypeScript and targeted ESLint pass.
- The final isolated optimized Next build passes, including route typing and all
  62 static pages. It completed 2026-09-13 14:23:27 UTC after the final catalogue
  width changes, with every source file byte-compared against the workspace.
  Build evidence: `release-build-latest.json` and `catalogue-build-final.log` in
  the private cache. Its staging-only environment is not a production deployment.
- Eight live integration check groups pass, including real authenticated catalogue
  CRUD, OB profile autosave payloads, self-promotion and organization-admin denial,
  real UI state at 390/1440px, simulated failed permission requests and revocation.
- The real inside/outside editors were checked as inspector, legacy admin and
  assigned BesiktApp admin; the admin catalogue tab was checked under both admin
  models. Browser contexts, not mocked authorization booleans, supplied real JWTs.
  This verifies permission states, not every control in every admin tab.
- A failed first UI setup lacked Dashboard access for the new synthetic account.
  A separate test organization/membership fixed the fixture; no application access
  guard was relaxed. Temporary memberships and both forms of admin authority are
  removed on completion. No administrator remains from these verification runs.
- Original OB rows, the original two profiles, catalogue records, private component
  records and their calculated values exactly match the pre-migration snapshot.
- The six earlier live `components`/`components_calc` check groups also pass after
  this migration, including foreign-owner denial and unchanged original inspection.
- Evidence: `component-catalogue-1789308297747/` and
  `component-catalogue-latest.json` under `.cache/ob-staging-app/`.
- The SQL editor's complete selected text was copied back and compared before Run.
  It reported `Success. No rows returned` in the pinned test project. Wrapper SHA256:
  `d454d9fef4c744a60b85c08e1ff6bff5ec6d3de07785eb953c4f2645d26f27b2`.

## Release limits

This does not finish every settings-table or application-role audit. Other global
settings catalogues, external callers, service functions and the wider OB/TU/EB
acceptance still require explicit review. New permissions also cannot establish
whether a historical administrator flag was legitimately assigned; review the real
administrator roster separately before release, without automatically demoting users.

The legacy add-component UI currently omits the required `default_lifespan_years`;
the database CRUD tests provide it explicitly. That pre-existing creation-form
problem is not repaired by an access migration or a successful permission probe.
Other admin tabs remain outside this change, including their existing responsive
header details and sealed configuration-table writes in staging.

Follow `OB_RELEASE_READINESS.md` for production backup/restore, real phone, delivery,
migration order and separate rollout approval. Do not publish merely because these
security checks pass. Production profile and platform-management callers must be
verified before executing the migration there.

References: PostgreSQL [table and column grants](https://www.postgresql.org/docs/17/sql-grant.html)
and [restrictive policies](https://www.postgresql.org/docs/17/sql-createpolicy.html).
