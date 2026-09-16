# OB release runbook - 2026-09-14

Status: **PUBLISHED; BUILDING AVAILABILITY ENABLED ON 16 SEPTEMBER**.
The user approved the database/access update and application publication with
building rollout OFF, accepted the three pre-existing missing source images with
their original PDFs preserved, and confirmed separate secure recovery-key custody.
The backup is retained; no automatic deletion is scheduled. Do not publish the
mixed development branch or activate/reopen any inspection under this approval.
The user separately approved publishing feature availability on 16 September.
The feature flag is now ON; individual inspection activation still requires an
explicit main-building choice and confirmation. No inspection was enrolled by
the feature-flag change.

## Release boundary

- Baseline: `541b5b3dc4e901784f2060560c9a8ead51513933`, on `origin/main`.
- Vercel's pre-release production deployment was independently checked against that
  commit and the `hushub.se` domain, not inferred from a local branch name.
- Application scope: the 45 exact paths in `scripts/release/ob-2026-09-14.json`.
  These cover multi-building OB, building classification, navigation/contrast,
  image recovery, report rendering and the related access-aware editor routes.
- Candidate source is reconstructed from that baseline with only those paths
  overlaid. RenoApp brand/UI changes, media output, temporary files and unrelated
  environment/Git settings are excluded. All other workspace work is preserved.
- Test/document/script copies are verification support, not permission to add
  further application changes. The complete candidate source tree and allowed
  workspace files are hashed and compared after tests/build.
- Re-pin and repeat verification if main or any allowed application file changes.
  Do not deploy the local candidate: its build uses staging keys deliberately.
- Exact SQL bytes and phase boundaries are pinned in
  `scripts/release/ob-2026-09-14-migrations.json`. This is verification metadata,
  not an executable batch or production approval. The application deployment
  must occur between its two building-schema phases.

Production deployment observed after release: commit
`24a7c58824ac81a9582cb46f38972688dd2d2469`, Ready, serving `hushub.se`.
[Vercel deployment](https://vercel.com/niklas-projects-65efdd50/underhallsplan-villa/HSQH2h3v6SbrcSivF6Fi4Mu1b8bx).

## Current evidence

| Check | Evidence and limitation |
| --- | --- |
| Android | User confirmed camera, multiple-image selection, hardware Back and text/image saving after airplane mode. Close/reopen with pending work and swipe were not separately confirmed. |
| External email | User confirmed receipt at the approved inbox and opening the synthetic two-building PDF. Uses the actual mailer/Resend, not a simulated inbox. |
| Frozen report | Previously verified 17-page, 691364-byte synthetic PDF; the sent attachment has the same SHA-256. This is not a customer's final report review. |
| Isolated release tests/build | 131/131 tests pass; optimized Next build, TypeScript and all 62 static pages pass. Both exit codes are 0 and status is `local-checks-passed`. No production approval is derived from that status. |
| Staging access/recovery | Real role/API/Storage and synthetic scoped recovery evidence is recorded in the linked rollout documents. This is not a current production recovery copy. |
| Production database backup | Dashboard lists seven physical backups, latest 2026-09-13 22:05:05 UTC. Storage objects are explicitly excluded, and changes after that time are not covered by that backup. |
| Fresh production review | Read-only PG17.6 catalog export: 275 verified parts, 6,737,422 bytes, MD5 `ea4054449c1900a346cd132e515b30e1`. Changes since the pinned staging source match the already-installed profile organization-card migration `2026-09-12_07`. No production permissions were changed. |
| Production-scope recovery | Encrypted local copy: 40 OB inspections, 5,130 rows in 74 tables, 652 available files (about 2.26 GB). Double-read row equality, local FK restore and all 11 proposed migrations pass locally. Three historical snapshot images are already missing; original PDFs are present. This is not a complete/offsite Supabase backup. See `OB_PRODUCTION_BACKUP.md`. |
| Actual HTTP PDF/public download | Six integration groups pass through the optimized candidate and a report-only HTTPS gateway. Cold/warm PDF generation and signed downloads pass (17.4/8.3 seconds). Mail transport is intentionally absent; actual external inbox acceptance is the separate check above. |
| Existing production link | The user-supplied previously delivered link passed anonymous page/PDF checks on 14 September at 20:27 UTC: HTTP 200/302/200, 32 readable pages, 19,960,502 bytes. PDF bytes match both the stored original checksum and encrypted backup. No regeneration or production writes. This is a pre-deployment baseline; repeat after the approved changes. |
| Independent encrypted copy | User-approved export to removable `D:\HusHub-backup` completed at 20:49 UTC. All 670 encrypted data/metadata files verify using the standalone copied tool and a portable recovery key, without the original backup or DPAPI. On 15 September the user explicitly confirmed separate secure key custody outside the computer/USB drive. External storage was not inspected. Known missing historical objects remain unchanged. |

Candidate evidence: `.cache/ob-release/candidate-1789411835805/`, completed
2026-09-14 18:57:13 UTC. Source SHA-256:
`e262737d428b97ff58fa51ef3124e0602de7af668f781c4e5868a47ffbd11354`.
The build warned about multiple lockfiles and inferred tracing root because the
test copy is nested under the workspace. This is not a warning-free build or a
production deployment artifact. An earlier attempt failed TypeScript because an
unrelated RenoApp test fixture was copied into verification support; that copy
filter was corrected and the complete candidate check rerun successfully.

Mail receipt: `.cache/ob-release/external-email-verified-sender.json` (private).
The user-approved test was sent once successfully; do not resend an accepted or
uncertain request with a new idempotency key. The first local test sender was
rejected; the successful sender matches Vercel's Production setting.

## Environment check

Read-only Vercel review confirmed:

- `APP_BASE_URL`: `https://hushub.se`, All Environments.
- `NEXT_PUBLIC_SUPABASE_URL`: `https://rfresrbuekidumbwzpcm.supabase.co`,
  All Environments. Therefore this project's existing Preview is NOT staging.
- `ASSIGNMENTS_MAIL_FROM`: `Hushub <noreply@hushub.se>`, Production only.
- `RESEND_API_KEY`: Production only; its value was not revealed in the dashboard.
- Supabase anon/service variables exist for All Environments; values were not
  revealed. Do not copy them to the guarded Android entry or candidate build.

Approved test database: `lodbgdbmfdtdzfaezblx`. Local candidate and Android entry
remain pinned to it. No environment settings were changed. The ordinary local
mailer setting still uses the provider's restricted test sender; the test script
used an explicit sender override without editing `.env.local`.

### Release revalidation, 14 September

- At 21:24 UTC, a fresh `git ls-remote` still matched the pinned main commit.
  All 45 allowed workspace files, their candidate copies, all 731 candidate
  source files and all 11 SQL hashes matched the passing verification receipts.
  Tests/build were not rerun or represented as a new run; their source is unchanged.
- At 21:27 UTC, targeted read-only production queries checked the owner of the
  property supplied by the user. That account has `profiles.is_admin=true` and
  one currently qualifying global BesiktApp administrator assignment. It meets
  both branches of the existing administrator predicate. No role, membership or
  profile was changed. The test-email address did not identify a profile row;
  receipt of the test email is not evidence of an application's login identity.
- A repeat scan of the isolated candidate found the EB lock/unlock and TU unlock
  RPCs in their server routes, not browser callers. The routes use the admin
  client; migration 10 retains service execution. No source caller was found for
  the legacy default-room helper. This supplements the scoped caller reviews in
  the access documents, not acceptance of unknown external integrations or a new
  end-to-end production EB/TU test.
- Production SQL, deployment, inspection activation and recovery-key custody
  remained unperformed/unconfirmed at that check. No permission to alter a completed inspection
  follows from these read-only checks.

### Follow-up, 15 September

The user explicitly confirmed secure recovery-key custody independent of the
computer and USB drive. This attestation was recorded at 04:36 UTC in the local
portable-backup status receipt; the original encrypted package was not altered.
A fresh remote-main check and comparison of the 45 application files, all 731
candidate source files and 11 SQL files still match the passing receipts.
No application change or fresh build was needed for that confirmation. The user
subsequently explicitly approved the production update and accepted the known
missing-image limitation, with rollout OFF and backups retained.

### Production execution, 15 September

- The live schema digest again matched `ea4054449c1900a346cd132e515b30e1` before
  the first migration. Backup revalidation at 04:46 UTC confirmed all 40 OB roots,
  the original scoped row hash in two reads, 652 available objects and the same
  three missing historical objects. The original backup capture time is unchanged.
- The five access migrations completed. Read-only production checks passed owner
  and stranger reads on 19 tables, anonymous grant denial, existing admin access,
  four service-only legacy RPCs and 20 catalogue permission sets.
- The first three additive building migrations completed, without activation.
  The subsequent smoke check caught default browser table grants on the new
  `settings_ob_building_categories` table. RLS was enabled, but whole-table
  privileges must also be revoked. This was not a passing initial smoke check.
- Forward correction `2026-09-15_01_ob_building_catalogue_access.sql` removes only
  those excess catalogue grants and preserves rows, policies, inspector reads
  and service access. Two regression tests pass, including default column grants,
  actual TRUNCATE denial, repeatability and rollback for inherited permissions.
  The correction has been applied and is pinned in the migration manifest.
- An isolated Git worktree starts at the pinned main commit. The 45 application
  files are unchanged. Its 131 regression tests and TypeScript check pass; an
  initial test packaging attempt omitted read-only preflight SQL 08, which was
  added before the complete successful rerun. The two correction tests pass
  separately. No unrelated application files are included.

Local execution receipts: `production-migrations-applied.json`,
`production-backup-current.json`, `production-access-smoke.json` and
`production-source-regression.log` under `.cache/ob-release/`.
### Completed production verification, 15 September

- The isolated release commit `24a7c58824ac81a9582cb46f38972688dd2d2469`
  was pushed without force to `origin/main`. Vercel reported Ready in Production
  with the expected commit/domain. The mixed development branch was not merged.
- All 12 reviewed SQL updates, including the forward catalogue-grant correction,
  completed. The compatible application was deployed before index cutover and
  the two building-purpose migrations, as required by the phase boundaries.
- Post-migration read-only checks again passed all 19 owner/stranger/anonymous
  boundaries, existing administrator access, four service-only RPCs and 20
  catalogue grant sets. All eight new tables have RLS, rollout is OFF and both
  inspection activation/part tables are empty. No inspection was reopened.
- At 05:08 UTC, two scoped reads of original columns still matched the backup's
  original row hash across all 40 OB inspections. All 652 available files were
  reverified and the same three accepted missing objects remained missing.
  Added schema columns were intentionally excluded from original-field equality;
  this is not a claim that the complete database schema stayed unchanged.
- At 05:11 UTC, the user's old anonymous report link again returned page 200,
  signed redirect 302 and PDF 200. Its 32-page, 19,960,502-byte PDF is identical
  to both the original checksum and encrypted backup; no regeneration occurred.
- The new deployed building endpoint rejected an anonymous request with 401.
  No authenticated production browser session/edit was exercised during this
  final check. Device acceptance and synthetic workflows were tested earlier.

Safe local receipts: `production-final-verification.json`,
`production-preservation-latest.json`, `production-building-smoke.json`,
`production-access-smoke.json`, `production-deployment.json` and
`legacy-report-latest.json` under `.cache/ob-release/`.
The next step is separately approved activation of an explicitly chosen eligible
inspection. Publication alone does not make additional buildings available.

### Feature availability enabled, 16 September

- The user requested publication if no blockers remained. A fresh read confirmed
  rollout OFF, zero enrolled inspections and zero building parts before the
  change. The newly referenced inspection is ongoing and unlocked; it is not
  the earlier completed inspection discussed in section C.
- All 45 reviewed application files remain identical between the original OB
  release and current remote main `6d28a97938e4992d897eb47d94f32c55add3bdcf`.
  The newer unrelated application work was neither reverted nor redeployed.
  The 21 focused building, API/report and overview tests passed again.
- A conditional update changed only the singleton `ob_building_rollout.enabled`
  from false to true. Availability is global, not a per-inspection allowlist.
  Both old and new eligible inspections require their own explicit activation;
  locked/completed inspections remain protected by the existing write guards.
- Encrypted before/after records retain the flag, structure tables and the
  referenced inspection's rows. Those inspection rows are unchanged, and no
  inspection structure or building part was created. This record is not a new
  Storage backup and does not replace the per-inspection activation checks.
- An authenticated browser reload of that inspection showed an enabled
  "Välj huvudbyggnad" button. No activation dialog was confirmed, no new house
  was created and no completed inspection was reopened.
- The previously supplied public report was checked again at 06:50 UTC: page
  200, redirect 302, PDF 200, 32 pages and identical original/backup bytes.
  No report was regenerated.

Safe local receipt: `.cache/ob-release/rollout-enable-20260916.json`.
Before confirming a main building, verify the inspection's current recovery copy
and finish pending text/image saves on every device. The global availability
switch does not attest to those user-specific conditions.

## Before production approval

1. Capture a fresh read-only production schema/access preflight and compare the
   tables, grants, policies, functions and dependencies with the staged versions.
   Confirm real administrator membership and affected old/new OB, TU/EB and
   component/settings callers. Metadata does not prove prior exploitation.
   The 14 September catalog comparison is complete. One global profile admin and
   two active organization admins were found. The subsequently checked owner of
   the user's referenced property qualifies as a global BesiktApp administrator,
   so its catalogue access is preserved. Do not infer global rights from
   organization membership or the test-email address, or change any assignments
   as part of this release.
2. Establish a current recovery copy of the affected database scope AND its
   Storage objects, including original delivered PDFs. Keep identifiers and file
   hashes in a private manifest. Agree protected storage and retention; never
   commit customer data or upload it to synthetic/public test buckets.
   The scoped encrypted local copy/replay now exists. Resolve or explicitly
   accept its three pre-existing missing historical images and agree retention.
   The independently verified D: copy removes the cryptographic Windows-profile
   dependency. The user confirmed independent secure key custody on 15 September;
   this closes the custody question, not the known omissions or capture freshness.
3. Prove recovery in an isolated approved destination and compare original PDF
   bytes/links before and after the proposed changes. The current synthetic
   rehearsal and scheduled DB backup do not by themselves close this gate.
4. Preserve the passing actual HTTP PDF/public-download evidence and separately
   repeat the now-passing user-supplied production bearer-link check after the
   approved changes, without regeneration. The HTTP test exercises missing-mail failure followed
   by PDF regeneration, not a fresh successful HTTP-to-email-to-inbox chain.
   The Android gateway still blocks delivery; do not weaken it or use the
   production-backed Vercel Preview. Historical intermittent timeout root cause
   remains unproven; the new harness's HTTPS/asset-filter failures are diagnosed.
5. Approve the exact application diff, SQL versions and execution windows below.
   Build the approved source with the correct production environment only at
   deployment. Obtain explicit production approval before any writes/deployment.

## Proposed execution order

Each phase requires its own reviewed inputs, backup and verification. Stop on a
schema mismatch, unexpected grant, failed check or lock timeout; do not bypass
the SQL review gates or enable broad anonymous permissions as a workaround.

### A. Access boundary, separately approved

1. `2026-09-12_09_inspection_access_hardening.sql`.
2. `2026-09-12_10_inspection_rpc_media_hardening.sql`, after 09.
3. `2026-09-13_03_components_access_hardening.sql`, separately reviewed scope.
4. `2026-09-13_04_component_catalogue_access.sql`, including its administrator
   predicate/input checks, not an automatic rewrite of administrator membership.
5. `2026-09-14_01_ob_settings_access.sql`, after catalogue 04.

Use the exact explicit approval settings documented by each migration. Inspect
the actual schema and callers before this phase. Re-run role/owner, settings,
legacy OB/TU/EB, Storage and report-link smoke checks after it. Existing public
image URLs remain public; these migrations do not switch buckets to private.

### B. Additive building schema and compatible application

1. Confirm prerequisites through `2026-09-11_07` against installed metadata.
2. `2026-09-12_01_ob_building_parts.sql`, then `02_ob_building_commands.sql`, then
   `03_ob_building_round.sql`, each with the full `2026-09-12_` prefix.
   Apply forward correction `2026-09-15_01_ob_building_catalogue_access.sql`
   immediately afterward and verify new-table grants/RLS with rollout OFF.
3. Deploy only the reviewed compatible application; leave rollout OFF. Check a
   non-enrolled inspection, single-building reports and legacy editing behavior.
4. Only after compatible callers are deployed, apply
   `2026-09-12_04_ob_building_cutover.sql`. It creates scoped indexes before
   replacing reviewed global uniqueness rules and rejects ambiguous old writes.
   Never run a dedupe or cascade-delete script to force it through.
5. `2026-09-13_01_ob_building_purpose.sql`, then
   `2026-09-13_02_ob_building_purpose_catalogue.sql`. Existing classifications are
   not inferred or overwritten. Keep activation unavailable until both finish.
6. Check new schema/grants and deployed behavior with rollout still OFF; compare
   preserved legacy records/files and delivered links to the private manifest.

Preflight/export SQL (`00`, `08`, `11`), staging bootstrap files and synthetic
fixtures are not production migrations. Do not execute a date-sorted SQL folder.

### C. Explicit activation of an eligible inspection

The inspection shown earlier in this task is now completed and locked (12
September), not ongoing. Leave it locked and preserve its delivered PDFs. Obtain
the intended eligible inspection explicitly; never reopen a completed report as
a rollout shortcut.

1. Obtain a fresh pause on all devices; confirm drafts and uploads are saved.
2. Refresh that inspection's scoped recovery manifest and compare its report.
3. Feature availability is already enabled globally as of 16 September. Preview
   and explicitly confirm this inspection's main-building register mapping and
   activation fingerprint; do not bulk-enroll other inspections.
4. Verify unchanged IDs, notes, floor labels, main-building facts and file paths.
   Add the extra building only after the primary building comparison passes.
5. Verify independent conditions/round, image placement and the shared report,
   then let the user resume editing. Existing Plan 1 is not renumbered silently.

## Stop and recovery

Disabling rollout prevents new activation; it does NOT undo already activated
records. Do not deploy an incompatible old editor, null out building IDs or merge
extra-building data into the primary building. Prefer a compatible forward fix.
Before new edits, reversal still requires the reviewed per-inspection recovery
procedure. Never restore the entire shared production database to undo one OB.

## Supporting records

- `OB_RELEASE_READINESS.md`: report/image/access checks and known limitations.
- `OB_ANDROID_TEST.md`: device acceptance and guarded test entry lifecycle.
- `OB_RESTORE_REHEARSAL.md`: exact synthetic recovery scope and exclusions.
- `OB_PRODUCTION_BACKUP.md`: current encrypted production-scope recovery evidence,
  historical missing objects, local migration replay and recovery limitations.
- `INSPECTION_ACCESS_ROLLOUT.md`: paired inspection/RPC/media migration gates.
- `COMPONENTS_ACCESS_ROLLOUT.md`, `COMPONENT_CATALOGUE_ACCESS.md` and
  `OB_SETTINGS_ACCESS.md`: independently reviewed access scopes.
- `OB_PROPERTY_BUILDING_IMPLEMENTATION_PLAN.md`: identity, snapshots and explicit
  inspection activation, including future maintenance/TU/EB boundaries.
