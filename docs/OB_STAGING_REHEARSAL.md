# OB staging schema rehearsal

Status, 2026-09-12: reviewed schema and OB building migrations are installed in
`hushub-ob-test` (`lodbgdbmfdtdzfaezblx`). SQL smoke checks and initial authenticated
app/Storage checks pass. An isolated local app now has a synthetic two-building
inspection. Production is unchanged. This is NOT full app/security/PDF acceptance.

## Installed scope

The verified private `11` structure export was used to create a pinned, sealed
rehearsal of the installed public schema. The generator rejects any changed
export digest or different target argument. The remote bootstrap requires an
empty public schema; later parts require its private installation marker and
strict part order. The marker is not independent proof of project identity:
the operator MUST also verify the Dashboard project reference before execution.

The baseline contains 215 tables, 261 functions, 1,578 constraints, 749 indexes,
194 public policies and 289 public triggers. Before the building migrations,
the remote function-definition digest matched the source after normalizing
CRLF/LF: `b6cee5614f9e87ba9c1d0fd0175ad4dd`.

Ten cron/network integration functions were deliberately omitted. No production
role memberships, event triggers, publications, schedules, external credentials,
customer records, settings rows, auth users, Storage buckets/files/policies or
managed auth/storage definitions were cloned. The custom `on_auth_user_created`
trigger was not installed; new-user onboarding remains a gate. The later app
rehearsal below uses explicitly provisioned test profiles and real Auth login.
Supabase's own managed schemas were preserved. Only uuid-ossp, pgcrypto and vector
were enabled/required. Supabase reported no pg_net/pg_cron extension after setup.

During baseline installation browser table/function privileges were revoked, including between
schema parts. Service role has access for later server-side testing. Existing
public policy definitions are retained as review material, not made safe merely
by copying them; direct browser acceptance requires separately reviewed grants
and the pending security work. Supabase's automatic RLS rewrite was not applied
to the reviewed scripts. The private control schema is not exposed and its
client privileges are revoked.

Building migrations `01` through `04` were then applied through staging-only
wrappers. Final inventory: 223 tables, 273 functions, 1,609 constraints,
768 indexes, 199 policies and 314 public triggers. These counts are not a claim
that the rehearsal is a full restorable production backup.

## Verified checks

Local PGlite checks first reconstructed the installed schema and compared its
function definitions and object counts. They caught and corrected a missing
function terminator, loss of precision in bigint sequence settings, and foreign
keys depending on standalone unique indexes. The source export was not edited.
Large integer JSON values now use the parser's exact source text (Node 24).
The migration scripts were successfully applied twice locally. PGlite reported
PostgreSQL 18.3, while the actual Supabase rehearsal used 17.6; local catalog
counts exclude PG18's separately cataloged NOT NULL constraints. Both runtimes
passed the five checks below. The final normalized function-definition digest
also agrees locally/remotely: `d0a4276dbd8a856cfad3e9c60668b1be`.

The same synthetic SQL smoke ran successfully in Supabase:

- Activating a synthetic legacy OB preserves record IDs, text, floor labels and
  original image references.
- One OB includes four buildings and a separate Plan 0 room in an extra building.
- Wrong-building writes and a different actor are rejected.
- Moving a room keeps its notes, images, original capture building and retry result.
- Locked inspections reject adding another building.

The smoke runs as SQL-admin with synthetic actor/claim inputs, not as real
PostgREST-authenticated clients. It tests database commands, not UI/auth plumbing.
Its transaction ended with ROLLBACK. A separate read-only query then confirmed
zero auth users, profiles, organizations, properties, inspections, building parts
and inspection images, plus zero Storage buckets/files. The six building-category
defaults from the new migration are intentional configuration, not customer data.
At that checkpoint `ob_building_rollout.enabled` was false. Client table access
and function EXECUTE counts were zero. No persistent test users or report
deliveries were made in that rollback-only phase. The app phase below deliberately
changes staging grants and creates persistent synthetic fixtures.

## Reproducible artifacts

- `scripts/lib/ob-staging-schema.mjs`: pinned schema generation and staging guards.
- `scripts/prepare-ob-staging-schema.mjs`: versioned, no-overwrite private bundles.
- `scripts/rehearse-ob-staging-schema.mjs`: installed-schema local rehearsal;
  uses local auth/storage stand-ins, not a substitute for Supabase testing.
- `scripts/sql/ob-staging-building-smoke.sql`: rollback-only remote/local smoke.
- `scripts/sql/ob-staging-schema-verify.sql`: read-only catalog/access counts.
- `test/ob-staging-schema.test.ts`: target, source, transaction/order and rollback guards.

Private, git-ignored evidence remains in `.cache/inspection-schema-export`:
`staging-schema-v2/manifest.json`, `staging-schema-local-rehearsal.json` and
`staging-remote-rehearsal-2026-09-12.json`. Version 1 is an obsolete preparation
artifact and was never installed. The temporary loopback SQL transport is closed
after use; it serves only reviewed bundle files, not the raw export or repository.

## Isolated app rehearsal, 2026-09-12

The Dashboard-confirmed staging project now has the guarded `09` and `10`
security migrations. Their approval setting was supplied only inside transactions
that verify the private staging marker and pinned export digest. Production
approval was not granted. A separate staging-only grant script opens the selected
OB parent/settings tables and adds a permissive Storage policy underneath `10`'s
restrictive owner/path boundary. Maintenance-plan tables/views remain sealed.

An initial save exposed missing EXECUTE grants after the blanket baseline seal.
The two reviewed invoker helpers `set_inspection_ongoing_if_started(uuid)` and
`inspection_has_meaningful_content(uuid)` were restored for authenticated users;
their reads/writes remain subject to RLS. Privileged legacy RPCs stay inaccessible.

`scripts/start-ob-staging-app.mjs` copies an explicit source/config/public-asset
allowlist into a new ignored `.cache/ob-staging-app/app-*` directory. It does not
copy `.env*`, the original `.next`, git state, exports or customer data. The
original `.env.local` is untouched. A whitelisted child environment carries only
staging keys and normal OS runtime paths. The staging image host replaces the
hardcoded production host in the copied Next configuration. Browser CSP restricts
connections/images, and a generated local proxy denies all API paths except the
reviewed OB data routes, organization context and local test login. Mail, AI,
integration and delivery/cron routes return 403. This is not an OS network sandbox.

Keys and random test passwords are stored only in the ignored private directory,
with its Windows ACL restricted to the current user, not committed source or public assets.
A one-time, same-origin loopback form
accepted the Dashboard keys and then shut down. Synthetic users were created via
Auth admin with email confirmed, without sending messages. There are two inspector
identities in one synthetic organization. Staging rollout is now ON; production
and its rollout state were not modified.

The real UI was used to activate the primary building, add a guesthouse, create
a Plan 0 hall there and save a free note. A private pre-activation fixture copy
was recorded first. A separate database read verified the original hall ID,
legacy Plan 1 label and original note text are preserved in the primary building;
the new room/note belong only to the guesthouse. The menu shows separate conditions
and rounds for each building. The original cover selector disappears after
building activation. The room list was visually checked in a 390px iframe showing
the actual app, not the earlier mockup. Real phone gestures/camera are not tested.

`scripts/test-ob-staging-access.mjs` uses real Auth JWTs, PostgREST, Storage HTTP
and the running Next API. It verifies owner reads/saves, denied foreign note
reads/writes, denied anonymous access and privileged RPC execution, owner upload,
denied foreign upload/list/delete, and owner-only Next building access. Public
image download still works as designed; public buckets are NOT private storage.
The test upload is removed afterwards. Integration endpoint denial is tested.
Results are private in `.cache/ob-staging-app/access-test-results.json`.

Initial read-only SQL checkpoint: two Auth users, one property, one inspection,
two building parts, zero Storage objects after upload cleanup, both restrictive
image/Storage policies present, and zero public-table grants to `anon`.

Local startup: `node scripts/start-ob-staging-app.mjs 57100`.
Entry: `http://127.0.0.1:57100/staging`; mobile layout:
`http://127.0.0.1:57100/staging/mobile`. These are loopback-only, not reachable from
a separate phone. The test entry uses a local POST login into real staging Auth;
it does not bypass production authentication and exists only in the generated copy.
Changes to the main worktree require a fresh test copy/restart. Do not reseed over
user-edited fixtures without review; the seed script is for controlled setup.

No production suggestion library or conditions catalog was copied. The subsequent
exercise below adds representative synthetic settings, not the full live catalog.

## Conditions, images and draft PDF follow-up, 2026-09-12

The conditions page initially failed because the blanket staging seal had removed
SELECT on `ob_building_conditions`, and the staging app grant list omitted it.
`scripts/sql/ob-staging-conditions-access.sql` provides a staging-guarded incremental
repair; the initial app grant list now includes it too. No production grant was
changed. The existing owner-read RLS remains enabled; browser writes remain denied
and go through revision-checked building commands instead.

`scripts/exercise-ob-staging-buildings.mjs` uses real owner/stranger JWTs and the
running Next building API. It inserts missing settings/selections without upserting
over existing selections. Eleven representative building-data categories now have
distinct selections for the two buildings, including 1980/sheet-metal facade versus
2020/wood facade, plus free facade text and a synthetic hall-door suggestion.
Four explicitly synthetic illustrations were uploaded: one note image and one
cover per building. No customer photos were imported.

Verified in that exercise:

- Conditions read/save works; a main-building save leaves the guesthouse row
  unchanged. Stale revisions, the other inspector and direct browser updates are
  rejected. The other inspector cannot read the conditions.
- Images can be linked, detached without deleting the file, and relinked. The
  original capture-building identity and file path remain unchanged.
- An image update referencing the other building's room is rejected without
  changing its current room. This is not a full cross-building move acceptance test.
- Both covers save independently. Original synthetic room ID, legacy Plan 1 label
  and original note text remain unchanged.

In the actual 390px UI, both conditions lists showed their separate values. A free
facade text was edited in the main building, saved and recovered in the report;
the guesthouse kept its own facade text. Screenshot review covered the facade editor.

The first real PDF render stopped because the staging proxy blocked `/api/image-proxy`.
That existing endpoint was reviewed and added to the staging allowlist. Its own
host/path/DNS/IP/redirect validation remains unchanged, configured only with the
staging Storage host; no integration allowlist was opened. HTTP tests verify a
staging image renders and localhost/unconfigured hosts are rejected. Mail, delivery,
AI and cron endpoint denial is still tested.

The PDF also exposed a presentation bug: the building appendix printed
`fullt_moblerad`. `formatFurnishingLevel` now formats known codes when the renderer
reads a furnishing field, preserving already-readable or unknown legacy text.
Stored inspection data and existing PDF files are not rewritten. The two new unit
tests cover the three codes and legacy/empty values.

`scripts/render-ob-staging-report.mjs` renders the real authenticated draft URL with
the existing `renderPreviewPdf` from the isolated app copy. It uses a clean
environment, fixed local Chrome and a disposable profile, without report delivery,
mail, PDF jobs or report-link insertion. The result is a 17-page local test PDF.
`scripts/verify-ob-staging-pdf.py` checks extracted text and embedded fixture images:
conditions and notes are separated, mobile-saved text is present, and both covers
and note images belong to the expected sections. Pages 1, 5, 7, 16 and 17 were
rendered to PNG and visually inspected. Other standard-text pages were rendered
but were not re-reviewed for legal content.

Open visual finding: on page 17 the guesthouse note photo continues without a
repeated building/room heading. Content is retained, but pagination context should
be improved before multi-building report acceptance. The guesthouse conditions
also use a simpler layout than the primary building; full report-layout approval
is still outstanding.

Verification: 11 local tests passed (staging target/environment/API restrictions,
schema/export guards and furnishing formatting), 8 live access checks passed,
4 building exercise groups passed, and PDF content/image assertions passed.
Targeted lint passed for the new/updated scripts, tests and formatting helper.
Read-only staging counts afterwards: one property, one inspection, two building
parts, two conditions rows, two note-image records, zero report links and zero
outbound messages. Production was not accessed or changed during this follow-up.

Private evidence under `.cache/ob-staging-app`: `building-test-fixtures.json`,
`building-test-results.json`, `access-test-results.json`, `multi-building-test.pdf`,
`pdf-validation.json` and rendered `pdf-page-*.png`. These are test artifacts,
not a delivered or locked customer report. The app remains on the previous frozen
source copy, with only this report-format fix and staging-proxy adjustment applied;
the concurrent customer-reconciliation implementation/migration was not installed.

## GitHub backup branch (2026-09-13)

The Vercel dashboard identifies `main` as the production branch. Its project
environment-variable list currently scopes `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to All Environments.
Preview must therefore not be treated as the isolated Supabase test environment.
No credential values or environment settings were changed during this check.

Before publishing the local checkpoint, `vercel.json` disables automatic Git
deployments for the exact branch `codex/ob-staging-cleanup-2026-09-13`. Other
branches retain Vercel's existing default. This is a source-code backup, not an
approval to deploy, migrate production, merge into `main`, or test with customer
records. It does not disable existing previews or manual deployments.

Keep this guard until a separately approved preview is configured with isolated
test data and credentials. A differently named branch is not covered by this
rule and needs its own deployment review before pushing. See Vercel's
[Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).

## Type checks and report continuation, 2026-09-13

The seven TypeScript diagnostics were fixed in the five affected test files:
unused/misplaced import directives, redundant ES2018 regex flags and an inferred
union of partial profile-media inputs. The application's compiler target and
inspection persistence logic were not changed. Full `tsc --noEmit --incremental
false` passes. Targeted ESLint has no errors; the renderer retains its existing
Next.js warning for the native report-image element.

PDF pagination now measures a repeated section/place heading before inserting it
when a note segment starts a page. It retains the building appendix title and the
complete original floor/room label for photo, risk and investigation continuations.
Eight pagination tests cover heading height, exact fits, multiple photo pages,
different buildings, note ordering and unchanged legacy spacer/page-break behavior.
The browser stress test also exposed a pre-existing React state-update warning in
`ReportPhoto`. Its ready callback now deduplicates through a ref and notifies the
parent outside a child state updater. Four regression tests cover cached images,
load/error events and source changes.

The isolated app received only the reviewed renderer and pagination helper, plus
the renderer-only `test/fixtures/ob-report-pagination-page.tsx` at
`/staging/report-pagination`. Its synthetic four-building report has 12 pages,
8 notes, 24 photos and 8 continuation headings. Browser checks passed on initial
load and cache reload: every note appears once, all photos load, headings match
their building/place, and no content overlaps the footer or page edge. No React
errors remain. This is renderer coverage, not acceptance of four-building editing,
authorization, offline behavior or delivery.

The real authenticated synthetic two-building draft was rendered again as a
17-page PDF. Text and pixel comparisons against the retained prior PDF show
pages 1-16 unchanged; page 17 now identifies `Bilaga 4: Gästhus` and its actual
floor/room above the photo.
Content/image assertions pass and the changed page was visually reviewed. The
prior PDF is retained in `.cache/ob-staging-app/pdf-review-2026-09-13-before`;
latest PNGs, comparison evidence and test output are in `pdf-review-latest`.
The live customer's inspection, stored reports and production data were not used
or modified. No SQL migration, locking or report delivery was executed.
The final targeted local suite passed all 93 tests.

## Appendix layout and mobile round trip, 2026-09-13

The building appendix now uses the same measured label/value rows as the primary
building for building data, with an explicit furnishing label. A presentation-only
`text.layout` flag opts the appendix into the established row renderer. Legacy
source paths and all stored inspection data remain unchanged. Appendix headings
stay with their following block when the group fits a page. Continuation pages
retain their building title even when they start at a subsection or conditions row.

The authenticated two-building draft PDF still has 17 pages and four synthetic
illustrations. Only pages 16-17 differ in normalized text and rendered pixels;
pages 1-15 are unchanged. Both affected pages were visually reviewed: the interior
heading, note and photo now share page 17 with the guesthouse context. The source
PDF and runtime files are retained under `appendix-layout-before`; final PNGs,
comparison JSON and test output are under `appendix-layout-after`, all inside
`.cache/ob-staging-app`. The appendix introduction still uses the existing note/photo
presentation; a dedicated cover/scope layout is a later presentation refinement.

Real UI tests used the 390px `/staging/mobile` wrapper and synthetic authenticated
owner only. Verified separate menu entries and note lists for the two buildings,
back navigation through the in-app arrows, temporary guest-room rename and restore,
and image unlink/relink through the note editor's image bank in both buildings.
The detached guest image retained its Storage file, room and original building
reference. No permanent image/room deletion, email, report locking or delivery was
performed. The move-room dialog was opened and cancelled; this is not evidence of
a completed cross-building move. Hardware Back, touch swipes, camera/file selection
and offline recovery were not exercised in this pass.

`scripts/audit-ob-staging-mobile.mjs before|detached|after` provides a read-only
database audit around that reversible UI sequence. It validates the pinned staging
project, uses the fixture owner's authenticated client, refuses to overwrite the
baseline, and compares all content fields apart from revision/update metadata.
Final audit: all 33 rows unchanged across two building parts, two conditions rows,
22 overview selections, three rooms, two notes and two image records. Only the
renamed room and the two relinked images advanced their row revisions. Evidence:
`mobile-roundtrip-before.json` and `mobile-roundtrip-validation.json` in the ignored
staging cache. A repeat run must use or retain the existing baseline, not overwrite
it while a test is in progress.

The UI sequence exposed a stale local "image detached" message after relinking.
Closing the image bank now clears that message without changing save/link logic.
The fix was verified in the actual mobile-width UI and its existing source-contract
test was updated. No browser warnings/errors were reported in this sequence.

Final verification: full TypeScript checking passes and all 100 targeted tests
pass. The renderer-only four-building stress page still shows 12 pages, eight
notes exactly once and 24 loaded photos, with correct building context, no footer
or page-edge overlap and no browser warnings/errors. This remains renderer coverage,
not four-building editing acceptance. Only the four reviewed source files were
copied to the isolated frozen app; the rest of the working tree was not synced.
No SQL migration, production access, commit, push or deployment was performed.

## Four-building safety and local recovery, 2026-09-13

`scripts/test-ob-staging-safety.mjs` completed nine live check groups against the
pinned staging project and the loopback app. Before writing, it verifies the
staging keys, fixture project, runtime host and app project header. It creates a
new synthetic property with two inspections; the original two-building mobile
fixture is not reused for destructive, lock or snapshot tests.

Verified through the real authenticated building API and client adapter:

1. Four buildings retain separate conditions, rooms, notes and uploaded PNG files.
2. Building-scoped reads isolate notes; foreign-building room references and
   another inspection's building IDs are rejected.
3. Cross-building room/note moves carry their children, retain the image file and
   origin metadata, replay safely and reject a stale source. Downloaded image
   bytes still match the original SHA-256.
4. An unlinked image can create a note in another building. Replaying the same
   create/link request produces one note and one link.
5. Injected failure before sending leaves no row. Failure after the server commits
   can retry with the same request ID without duplication. Replays return current
   content after a later edit; stale writes and partial batches are rejected.
6. Owner, other-inspector and anonymous identities enforce the tested record and
   Storage-write boundaries. Direct browser writes cannot bypass the row command.
   This does not make existing public image URLs private.
7. A stale report revision is rejected. A frozen snapshot remains unchanged after
   subsequent live-note edits, and direct browser snapshot writes are denied.
8. A locked synthetic inspection rejects note edits, building additions, room
   moves and direct root-content edits. The second inspection on the same
   property remains unchanged.
9. The original mobile fixture is unchanged in all seven audited tables.

Evidence: `.cache/ob-staging-app/safety-1789296742221/` and `safety-latest.json`.
The new four-building inspection is intentionally left locked. The snapshot test
uses one already-revoked, terminal-failed report row with a random token hash and
no usable bearer token, active share link, PDF job or delivery. Its minimal payload
tests database snapshot guards, not the complete renderer/delivery workflow.
Earlier one-property/zero-report-link counts are historical, not current totals.
Do not rerun the original one-property seed script over these expanded fixtures.

The local image queue had a confirmed commit-order bug: it resolved on an
IndexedDB request's success event, before the transaction necessarily committed.
`roundImageUploadQueue.ts` now waits for transaction completion and rejects on
abort/error. Four deterministic tests failed before the fix and pass afterwards,
covering both enqueue and dequeue with a delayed commit or late abort. There is
no database version, key, blob or remote-upload schema change.

`test/fixtures/ob-recovery-page.tsx`, copied only to the frozen app's
`/staging/recovery`, exercises the real note editor, local drafts and IndexedDB.
The page's save callback simulates failure/success and stores its fake server
acknowledgment locally; it never calls an inspection API or uploads to Storage.
Browser checks confirmed:

- One queued 1,240-byte synthetic PNG per building survives reload with identical
  SHA-256 `6227277dfe17ef4947a9fef03de39c5d6d94b81302d2884d49d0ce0c49d5cc28`
  and distinct building references.
- A failed save displays `Ej sparad` and retains the entered text. Closing and
  reopening the tab restores that text in the editor.
- A second building deliberately using the same synthetic note ID does not
  inherit the first building's draft.
- Reopening with successful test saves enabled persists the recovered text and
  clears the pending draft only after acknowledgment.
- The fixture's own two images/drafts were cleared through its scoped cleanup
  control; unrelated local data was not cleared.

This is browser persistence and fault-injection coverage, not a physical phone
network-off/app-kill test, storage-eviction guarantee or camera acceptance.
The queue fix alone was copied into the frozen app, with its previous version
retained in the ignored cache. No production migration or configuration changed.
Full TypeScript checking and all 104 targeted tests pass; targeted ESLint for the
new safety/recovery files and queue change passes without warnings or errors.

## Optional building purpose catalogue, 2026-09-13

The Boverket purpose picker is now available in the frozen staging app. Building
names remain free text; classification can be omitted or cleared. Existing
categories are retained, not automatically mapped. See
`OB_BUILDING_PURPOSE_CATALOGUE.md` for source provenance, versioning and rollout.

Migrations `2026-09-13_01_ob_building_purpose.sql` and
`2026-09-13_02_ob_building_purpose_catalogue.sql` ran only in
`lodbgdbmfdtdzfaezblx`, using the pinned staging guard. The initial import contains
197 versioned concepts. A first live test detected missing report-service SELECT
on the catalogue table; the additive migration now includes that read privilege.

All 112 targeted regression tests and TypeScript checking pass. Six isolated live
API checks pass (catalogue read, optional activation, version persistence, clear,
legacy name edit, original fixture preservation). Their manifest is retained in
the ignored cache as `purpose-latest.json`. The browser test uses its own synthetic
property/inspection, not the original click-test inspection or customer data.
The existing fixture's building data, conditions, floors, rooms, notes and images
remain unchanged. No production deployment, migration, email or delivery occurred.

## Remaining gates

1. Broaden the synthetic conditions/suggestion catalog and app acceptance;
   representative two-building conditions, images and draft PDF checks now pass.
2. Complete the broader access work in `INSPECTION_ACCESS_ROLLOUT.md`. The
   maintenance-plan view/table owner boundary is now fixed and live-tested in
   staging, as documented in `COMPONENTS_ACCESS_ROLLOUT.md`. Component catalogue
   editing and the shared admin predicate's profile/role inputs are also tested
   in staging; see `COMPONENT_CATALOGUE_ACCESS.md`. The 19 shared OB settings
   catalogues are additionally covered by `OB_SETTINGS_ACCESS.md`. Configuration
   outside that scope and wider production callers/administrator identities still
   need review. All security migrations have run in staging only, not
   production, and are not blanket platform security acceptance.
3. Complete end-to-end phone acceptance: camera and multi-image selection, hardware
   Back/swipe, network-off/reconnect and reopening the app with pending uploads.
   Four-building API moves, retry/idempotency and browser-local draft/image
   persistence now pass; they do not replace these real-device checks.
4. The real multi-building delivery handler, frozen snapshot, PDF worker,
   private Storage and public-token handler now pass with synthetic fixtures;
   see `OB_RELEASE_READINESS.md`. Mail is captured locally and handlers use
   request-context adapters, so external email/public HTTP delivery acceptance,
   existing delivered-PDF compatibility and remaining report edge cases still
   need review. One PDF timeout remains unexplained despite two passing retries.
5. Verify production backups/restore and obtain separate production rollout
   approval. A scoped synthetic restore now passes; see `OB_RESTORE_REHEARSAL.md`
   for local PostgreSQL and private staging Storage results and limitations.

The environment now supports a limited synthetic click test. It is not permission
to activate an ongoing real inspection or publish the multi-building workflow.

The 2026-09-13 release audit is recorded in `OB_RELEASE_READINESS.md`, including
116 passing regression tests, the furnishing-text correction and the read-only
production backup observation. Listed database backups do not include Storage
files and have not been restore-tested in this audit.

The later catalogue review passes 62 targeted local tests and eight real staging
integration groups, plus a rerun of the earlier six private-component access
groups. The inside/outside and admin catalogue editors reflect database permissions;
profile autosave remains usable and new temporary test admin authority is removed.
Original inspection/profile/catalogue/component snapshots remain unchanged. This
does not resolve the legacy component-creation form's missing required lifespan
input, nor replace the real-device, external email and restore gates above.

On 2026-09-14 the separate 19-table OB settings permission migration also passed
70 local regression tests, six real settings-access groups (including actual
editor states and revocation), nine four-building safety groups and the optimized
Next build. See `OB_SETTINGS_ACCESS.md` for its prerequisite, source hash, first
interrupted rehearsal, successful rerun and verified removal of test authority.
The existing test fixture and catalogue definitions are unchanged.

The subsequent synthetic restore rehearsal passes twelve local tests and six
integration groups. Scoped rows and original image/PDF bytes are backed up,
restored in isolation and hash-checked. The disposable Storage bucket is removed
and source rows/files are unchanged. This is not a production or full Supabase
restore; see `OB_RESTORE_REHEARSAL.md` before treating it as release evidence.

References: PostgreSQL's [function-body validation setting](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CHECK-FUNCTION-BODIES)
explains the restore-time forward-reference behavior. Supabase's
[backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
describes the separate full-backup path. Neither makes this scoped rehearsal a backup.
