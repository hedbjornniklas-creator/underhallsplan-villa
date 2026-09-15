# OB release readiness - updated 2026-09-14

Status: **NOT APPROVED FOR PRODUCTION**. This audit does not deploy code, run
production SQL, activate an existing inspection or authorize those operations.

Current release boundary and execution gates: `OB_RELEASE_RUNBOOK.md`. Historical
checks below retain their original scope; later acceptance does not retroactively
turn an in-process staging test into a production or public HTTP test.

## Completed in this audit

- 116 targeted regression tests pass, including building commands, navigation,
  report building separation, access guards, image recovery and TU regressions.
- Two additional page-query regression tests pass for promised search parameters,
  redirect encoding, array values and default selection. Full workspace TypeScript
  checking and targeted ESLint for the new harnesses/query changes also pass.
- The isolated optimized Next build passes (exit 0): compilation, generated route
  types, all 62 static pages and build traces. No warning/error was logged. Its
  source tree was byte-compared against the current workspace before building.
  The build uses staging keys only and is not a deployable production artifact.
- `scripts/test-ob-staging-delivery.mjs` passes nine integration check groups
  against the pinned staging project `lodbgdbmfdtdzfaezblx` and loopback app.
- Real authenticated building API calls create a new synthetic two-building
  inspection with separate conditions, rooms, notes and uploaded PNG files.
  The original mobile click-test fixture is unchanged in the seven audited tables.
- The actual delivery handler denies another inspector in the same organization,
  freezes both building classifications (versions 2 and 4) and locks the report.
  A locked note edit is rejected. A later property edit leaves the snapshot intact.
- The actual PDF worker renders the signed internal page in Chrome and stores
  a private, hash-verified PDF. Unsigned internal rendering, anonymous direct
  Storage download and another inspector's direct download are denied.
- The actual public-token handler returns the identical PDF through a signed
  Storage URL; unknown tokens and newly requested downloads after revocation fail.
  Already-issued Storage URLs are not tested as immediately revocable.
- The local test mail transport captures one message to `recipient@example.invalid`.
  No SMTP/provider mail is sent. The delivery/public-token handlers run in process
  with test request-context adapters, not through the public staging HTTP proxy.
  This is not full external email delivery acceptance.
- Every test link is revoked on exit, including a link created before an error
  response. Synthetic rows/files are retained only in staging for inspection.

Evidence is private/ignored: `.cache/ob-staging-app/delivery-1789303672748/`,
`delivery-latest.json`, `release-regression.log` and `release-types.log`.
The passing frozen PDF has 17 pages, 691364 bytes and SHA-256
`e16180428efeed695797aea5e900494bc56327153417bb9518594c3f984240d0`.
`scripts/verify-ob-staging-delivery-pdf.py` verifies its hash, independent building
years/furnishing values, unique notes and images on both note pages. Pages 5, 7,
16 and 17 were rendered and visually checked: no clipping or footer overlap.
These are sparse synthetic fixtures, not a review of a customer's final wording.
Captured mail contains a bearer URL and must not be committed or shared.

## Defects found

1. The primary building's two-column conditions block ignored its furnishing
   value and printed the default "fullt moblerad" wording. `ReportRenderer.tsx`
   now resolves that standard-text field with the stored furnishing value.
   The regression failed before the fix and passes afterwards. The new frozen
   PDF correctly shows an unfurnished main house and fully furnished guesthouse.
   Stored/delivered PDF bytes are not rewritten by this change.
2. Isolated optimized builds exposed old Next PageProps declarations on the
   admin landing, standard-text debug and statement pages. Their params and
   searchParams now match Next's Promise contract; fallback records have explicit
   types. The debug page now awaits its query. Redirect/report behavior is
   unchanged. The final optimized build passes after these corrections.
3. One earlier PDF worker run timed out with `PDF_RENDER_TIMEOUT`; the next two
   runs succeeded in roughly 11 and 20 seconds. The cause is not established.
   Keep the failed manifest as evidence; do not treat a retry as a diagnosis.

## Production backup observation

Read-only inspection of the production dashboard showed seven scheduled physical
database backups. A fresh read-only check on 2026-09-14 shows the latest at
**2026-09-13 22:05:05 UTC** (14 September 00:05:05 Swedish time). The page explicitly
states that Storage objects are not included.
At that earlier observation, no restore/download operation or production data
query was performed. The later scoped read-only capture below is separate.

Source: [project backup page](https://supabase.com/dashboard/project/rfresrbuekidumbwzpcm/database/backups/scheduled).
This establishes a listed database backup, not recoverability of images/PDFs,
coverage of changes after that timestamp or a completed restore rehearsal.

## Remaining release gates

1. Complete the broader access work in `INSPECTION_ACCESS_ROLLOUT.md`. The
   `components_calc`/`components` owner-boundary fix is now installed and tested
   in staging; see `COMPONENTS_ACCESS_ROLLOUT.md`. Eight local tests and six real
   PostgREST check groups pass. It has not run in production. The component catalogue
   and its admin-input boundary are now separately hardened and live-tested in staging;
   see `COMPONENT_CATALOGUE_ACCESS.md`. The additional 19 OB settings catalogues
   are now hardened in staging; see `OB_SETTINGS_ACCESS.md` for exact scope and
   current verification evidence. Remaining configuration outside that scope, the
   real administrator roster and wider production callers still require review.
   The old add-component form also omits its required lifespan input. Existing public image URLs
   also remain public; the private PDF test does not change that limitation.
2. The user has accepted real Android camera, multi-select, hardware Back and
   text/image saves after airplane mode through the guarded HTTPS staging entry.
   Separate swipe and close/reopen-with-pending-work acceptance was not explicitly
   reported; retain that distinction. See `OB_ANDROID_TEST.md`. The existing
   Vercel Preview configuration still points at production Supabase.
3. Back up scoped rows, original PDF bytes and Storage files, then prove restore
   in isolation. A synthetic two-building scoped restore now passes locally with
   a real private staging Storage round trip; see `OB_RESTORE_REHEARSAL.md`.
   This does not replace a current production backup or a full isolated Supabase
   restore. Recheck existing delivered PDF links without rewriting them.
4. The user has confirmed receipt of the synthetic test email and opening its PDF
   at the approved inbox. Public HTTP delivery/link acceptance, broader caller/role
   checks, report edge cases and PDF timeout diagnosis remain separate checks.
5. Review an explicit release diff, migration order and environment configuration.
   Obtain separate rollout approval. Any ongoing-inspection activation needs a
   fresh device/editing pause and confirmation that all uploads are saved.

No production migration, activation, commit, push or deployment occurred in this
audit. The running staging app retains its isolated environment and fixtures.

Build evidence: `.cache/ob-staging-app/release-build-latest.json` and
`release-build.log`, completed 2026-09-13 13:07:16 UTC. The final incremental
rebuild reused the isolated candidate only after copying the reviewed statement
page fix and verifying all source files match. A fresh reproduction is available
with `node scripts/check-ob-release-build.mjs` once the guarded staging keys exist.

The subsequent catalogue/admin-input review is recorded in
`COMPONENT_CATALOGUE_ACCESS.md`: 62 targeted local tests, eight new real staging
check groups and the six earlier private-component check groups pass. The final
isolated optimized build completed **2026-09-13 14:23:27 UTC**, exit 0, with all
62 static pages and source equality verified after the catalogue layout changes.
See `catalogue-build-final.log` and the updated `release-build-latest.json`.
These successful checks do not waive any remaining gate above.

2026-09-14 settings follow-up: 70 regression tests, six real settings-access check
groups and nine four-building safety groups pass. The isolated optimized build
completed at 13:12:08 UTC with all 62 static pages; all 731 source files match the
workspace. Original fixture/catalogue snapshots are unchanged and temporary test
authority has been removed. See `OB_SETTINGS_ACCESS.md`, `settings-build.log` and
the new settings/safety evidence directories. Production remains untouched.

2026-09-14 restore follow-up: twelve local tests and six staging integration
groups pass for scoped row/schema/file capture, local PostgreSQL replay and
temporary private Storage restoration. The original PDF hash matches, source
rows/files remain unchanged and the temporary bucket is removed. Exact scope,
evidence and limitations are in `OB_RESTORE_REHEARSAL.md`; gate 3 remains open
for production recovery and existing delivered-link compatibility.

2026-09-14 release follow-up: physical Android acceptance now covers camera,
multiple-image selection, hardware Back and text/image saving after airplane
mode. The user also confirmed receiving and opening the synthetic PDF sent to
the explicitly approved inbox `jn@hedbjorn.se`, subject
`TEST - OB publiceringskontroll, syntetisk testrapport`.

`scripts/send-ob-release-test-email.mjs` used the actual mailer and Resend with
the production-configured sender `Hushub <noreply@hushub.se>`. The initial local
test sender was rejected by the provider; the accepted attempt used a separate
receipt after that definite rejection. The accepted receipt is private at
`.cache/ob-release/external-email-verified-sender.json`. Do not resend it.
The attached 691364-byte PDF has the frozen hash recorded above. No customer
report, public delivery link, environment setting or production row was changed.
This closes inbox/attachment acceptance only, not end-to-end public HTTP delivery.

The candidate check uses the exact deployed main baseline plus an explicit list
of 45 application files, not the entire development branch. See
`scripts/release/ob-2026-09-14.json`, `scripts/check-ob-release-candidate.mjs` and
the private `candidate-latest.json` evidence. The runbook records final results
and exclusions; unrelated RenoApp work stays outside this release boundary.

Final isolated candidate check completed 2026-09-14 18:57:13 UTC: 131/131 tests,
optimized build, TypeScript, 62 static pages and post-build source comparisons
pass. Both process exit codes are 0. Evidence:
`.cache/ob-release/candidate-1789411835805/`. The build emitted a nested-workspace
lockfile/tracing-root warning; it is not warning-free. The earlier failed
candidate's unrelated RenoApp verification fixture is excluded by the corrected
copy filter. No application file was changed to work around that test isolation
issue. Production recovery, permission preflight and full public HTTP delivery
checks remain open as described in `OB_RELEASE_RUNBOOK.md`.

## Later production-scope and HTTP checks

The fresh production catalog comparison and read-only encrypted recovery capture
are now complete within the documented scope. See `OB_PRODUCTION_BACKUP.md` for
40 OB inspections, 5,130 rows, 652 available original objects and successful local
FK restore/all 11 migrations. Three historical JPEG references are already absent;
all affected original PDFs are preserved. Strict complete/offsite recovery and an
existing delivered production-link check remain open. One global profile admin
and two active organization admins were found; intended global-admin identity
and wider caller review still require confirmation. No production ACL changed.

`scripts/test-ob-release-http-report.mjs` now passes six actual HTTP integration
groups on the exact optimized candidate and synthetic staging data. A temporary
HTTPS gateway exposes only this synthetic report, its exact snapshot image URLs
through the image proxy and static report assets. It rejects inspection editing
and unrelated routes, strips credentials, expires and is stopped on test exit.
The existing Android entry and its user-created data were not changed.

HTTP owner/anonymous/colleague isolation, fresh frozen snapshot creation,
intentional missing-mail transport failure, cold/warm PDF regeneration, public
signed download and revoked/unknown-token denial all pass. Revoked public API
links return the implemented HTTP 404, not 410. Previously issued Storage URLs
are not claimed to revoke immediately. The original source fixture report row
is unchanged, and the new test links are revoked on exit. No email was sent by
this test; inbox/attachment acceptance remains the separate user-confirmed test.

Passing evidence: `.cache/ob-release/http-report-1789416201250/`. Cold/warm runs
took 17,392/8,346 ms, each producing 691364 bytes and 17 pages. Each download hash
matches its own stored PDF. The two generated PDFs have identical extracted text
and embedded images; binary hashes differ. Building facts and notes are separate
and correct. Pages 5, 7, 16 and 17 were rendered and visually checked with no text
clipping or footer overlap. Images are the intended synthetic test placeholders,
not customer photographs. `scripts/verify-ob-release-http-pdf.py` reproduces the
checks and renders. This sparse fixture does not cover every report edge case.

Earlier attempts exposed test-harness problems: stale snapshot guards correctly
refused copied context, plain HTTP was rejected by the production-mode renderer,
and the report-only proxy initially blocked required images/static route chunks.
These were corrected in test tooling only, with negative proxy/ACL regression
tests. The successful runs do not establish the cause of the older intermittent
`PDF_RENDER_TIMEOUT` recorded above; no application timeout was increased.

22 verification-tool tests pass. These additions do not change the 45-file
application release candidate. No production migration, activation, deployment,
commit or push was performed. The inspection from the earlier screenshots is
now completed/locked and must not be silently reopened for activation.

2026-09-14 20:27 UTC existing-link follow-up: the user supplied a previously
delivered production report URL. It opened in the browser without authentication;
anonymous GET checks returned 200 for the page, 302 for the PDF API and 200 for
the signed original Storage object. The 19,960,502-byte PDF has 32 readable pages
and is byte-for-byte identical to the encrypted backup, with the matching stored
SHA-256. `scripts/verify-ob-legacy-public-report.mjs` accepts the bearer URL only
on stdin, does not use admin credentials and stores only encrypted identifiers
and a non-sensitive status receipt. No production write or regeneration occurs.
This closes the supplied-link baseline check; repeat after approved deployment.
It is not a full content/layout audit of the customer report or proof that every
historic link works. Independent recovery and the other release gates remain.

2026-09-14 20:49 UTC portable-backup follow-up: the user approved the removable
`D:\HusHub-backup` destination. All 670 encrypted data/metadata files pass an
independent verification process using the copied standalone tool and separate
portable recovery key. The original local backup/DPAPI key is not read by that
process. The package covers all 652 available source object references and
retains the three documented pre-existing missing historical images. No live
source data was refreshed/changed and no plaintext customer data was extracted.
Five additional portable-backup tests pass, 27 combined verification-tool tests
pass, targeted ESLint passes, and all 45 application files still match the tested
candidate. Independent off-computer custody of the secret recovery record is
pending user confirmation; this is not yet a closed disaster-recovery gate or
permission to deploy. See `OB_PRODUCTION_BACKUP.md` for recovery instructions.
