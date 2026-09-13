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

## Remaining gates

1. Broaden the synthetic conditions/suggestion catalog and app acceptance;
   representative two-building conditions, images and draft PDF checks now pass.
2. Complete the access work in `INSPECTION_ACCESS_ROLLOUT.md`, including the
   unresolved maintenance-plan view/table policies. `09`/`10` have run in staging
   only, not production, and are not blanket platform security acceptance.
3. Test actual PostgREST/API identities, mobile navigation, two/four-building
   workflows, uploads, image linking/moving, offline retry and draft recovery.
4. Fix/review report continuation layout, then test multi-building frozen snapshots,
   locking and delivery using synthetic fixtures. Draft PDF content/image checks
   are not delivery acceptance. Review compatibility with existing delivered PDFs.
5. Verify backups/restore and obtain separate production rollout approval.

The environment now supports a limited synthetic click test. It is not permission
to activate an ongoing real inspection or publish the multi-building workflow.

References: PostgreSQL's [function-body validation setting](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CHECK-FUNCTION-BODIES)
explains the restore-time forward-reference behavior. Supabase's
[backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
describes the separate full-backup path. Neither makes this scoped rehearsal a backup.
