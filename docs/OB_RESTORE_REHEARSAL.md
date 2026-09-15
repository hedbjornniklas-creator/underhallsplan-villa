# OB scoped restore rehearsal - 2026-09-14

Status: **synthetic staging rehearsal passed; not production restore approval**.
No production request, remote database write, migration, deployment or email was
performed. Existing report links were not enabled, reissued or rewritten.

## Scope and result

The completed delivery fixture from `OB_RELEASE_READINESS.md` was read from the
pinned staging project `lodbgdbmfdtdzfaezblx`. This is a separate synthetic
two-building property, not the original mobile click-test fixture or a customer
inspection. Its delivered report link remains revoked.

`scripts/test-ob-staging-restore.mjs` passes six integration check groups:

1. Capture the selected property/inspection and their FK descendants, then the
   required ancestors and explicitly selected settings/organization membership.
   Shared owners/catalogue rows do not pull in other properties or inspections.
   Two complete reads must agree before accepting the synthetic capture.
2. Verify row, schema, migration and file checksums, including correspondence
   between frozen image/PDF references and manifest entries. Missing files or
   manifest entries and corrupt rows, schema, SQL or file bytes are rejected.
3. Restore into a fresh, in-memory PGlite PostgreSQL database built from the saved
   schema export and 13 saved migrations. Original IDs, timestamps, revisions,
   JSON values and FK definitions are retained. The actual FK constraints are
   re-applied after the trigger-suppressed load to validate the relationships.
4. The restored building reader returns both buildings. Owner-filtered note
   reads work, another inspector sees no notes, and a populated target is refused.
5. Upload the saved files to a new private staging Storage bucket, download and
   compare their hashes/lengths. Overwrite and anonymous download are rejected.
6. Re-read source rows/files and the separate original click-test fixture. They
   remain unchanged, including revocation state. Delete only the new test bucket
   and its copied files; verify that the bucket no longer exists.

The passing capture includes 291 rows in 25 nonempty tables, including shared
settings and one minimal local Auth stand-in. It has three Storage objects:
two PNG images and the original 17-page PDF, totalling 693844 bytes. The PDF is
691364 bytes with SHA-256
`e16180428efeed695797aea5e900494bc56327153417bb9518594c3f984240d0`.
The restored database is disposable and is closed when the run finishes.

## Verification and evidence

Twelve focused tests in `test/ob-restore-rehearsal.test.mjs` cover ownership scope,
cycles/composite FKs, rollback on broken references, unique indexes without a
primary key, nullable/absent key rejection, exact revision/timestamp restoration,
nonempty/remote-style target rejection, checksums, missing assets, unsafe paths,
duplicate entries, external frozen-image references and distinguishing actual
Storage HTTP denials from generic network errors. Two additional staging
environment/API-allowlist regressions also pass.

Private evidence is ignored by Git:

- `.cache/ob-staging-app/restore-latest.json`: latest outcome, check groups,
  row counts, file counts and test bucket cleanup result.
- Each `restore-<timestamp>/manifest.json`: run receipt with the backup manifest
  checksum, source IDs and outcome. Failed attempts are retained too.
- Its `backup/` directory: `rows.json`, `schema/source.json`, 13 SQL files,
  content-addressed image/PDF blobs and a checksummed-file manifest.
- `restore-run.log` and `restore-unit.log`: current verification logs.

The final verified run was `restore-1789394527253`, completed at 14:04:31 UTC,
with six passing groups and verified bucket removal. A separate read-only bucket
inventory found zero remaining `ob-restore-test-*` buckets. Fourteen local tests
(twelve restore tests plus two staging guard regressions), targeted ESLint and
the diff whitespace check pass. No application-source or build change was made
in this restore step. The initial successful run was `restore-1789393604811`,
completed at 13:48:23 UTC; failed and later runs have separate manifests.
The two earlier attempts stopped before Storage writes: the local schema replay
needed the existing sealed-staging component read prerequisite, and the row-key
discovery needed to recognize the building conditions table's non-null unique
index. No source schema/data repair was made or needed.

A later stricter denial check initially failed because the installed Storage SDK
wraps failed blob-download Responses in `StorageUnknownError`, without a direct
`status` field. The check now reads the actual nested Response status and still
rejects generic network errors. That failed run removed its temporary bucket.
Another attempt stopped on a transient fetch failure during source reads, before
creating a bucket. Idempotent GET/HEAD requests now have at most two retries for
transport failures and selected temporary HTTP errors. Mutating requests are not
automatically repeated. The final successful run required no such read retry.

The files contain synthetic account metadata and frozen report/link data. Do not
commit, publish or serve the backup directory. It is not an encrypted off-device
backup. Reproduction requires the existing guarded staging keys, delivery
fixture, pinned schema-only export and local PGlite vector runtime:

```powershell
node --test test/ob-restore-rehearsal.test.mjs
node scripts/test-ob-staging-restore.mjs
```

The integration command intentionally writes copied bytes to a temporary private
bucket in the pinned test project. Its network guard denies remote DB mutations,
production origins and source-bucket writes. Cleanup retries target only that
run's random bucket. Any cleanup failure keeps the run failed and records the
bucket name for investigation; do not delete other staging buckets.

## Limits and remaining production gate

- This is a scoped logical rehearsal, not a complete Supabase backup/restore.
  Local Auth and Storage schemas are stand-ins; passwords, identities, sessions,
  managed platform metadata and real login recovery are not restored.
- The capture traverses reviewed FK relationships and explicit shared settings.
  It is not a general exporter for every table, opaque JSON reference, external
  attachment, integration, building cover or future schema extension.
- Schema reconstruction uses the pinned, sealed review export plus known
  migrations. It does not prove a current full production schema/ACL export.
- Two matching reads are only a stability check for a quiescent synthetic source,
  not a transactionally consistent backup under concurrent customer editing.
- Database restoration was local; Storage restoration used a separate private
  bucket with test-prefixed paths. This does not prove a running restored
  Supabase environment with original bucket names, URLs and public handlers.
- The original frozen PDF bytes and revoked link rows are preserved, but no old
  customer's delivered link was exercised or reactivated.

Before production rollout, agree the backup scope and destination, export the
actual current database rows/schema and referenced Storage/PDF bytes, and prove
their recovery in a separately guarded environment with the required Auth,
permissions and URL behavior. Keep original delivered PDFs unchanged. Obtain
fresh pause/upload confirmation before any ongoing-inspection activation and
separate approval for the release diff, environment and migration sequence.
Real-phone acceptance and approved external email acceptance also remain open.
