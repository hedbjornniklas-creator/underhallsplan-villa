# OB production-scope recovery check - 2026-09-14

Status: **RESTORE REHEARSAL PASSED; RELEASE APPROVED AND DEPLOYED 15 SEPTEMBER**.
The 14 September backup/rehearsal operations were read-only in production.
On 15 September the user approved database/access updates and publication with
building rollout OFF, explicitly accepting the three missing historical images
and preserving their original PDFs. The separate release then completed; no
inspection was activated or reopened. See `OB_RELEASE_RUNBOOK.md` for execution.

## Evidence

- Fresh schema export was read-only/repeatable-read on PostgreSQL 17.6; all 275
  chunks passed size/order/digest verification. Metadata changes since the
  original staging export match the already-installed profile organization-card
  migration `2026-09-12_07_profile_org_cards.sql`.
- Captured all 40 inventoried OB inspections, their FK descendants and necessary
  parent dependencies: 5,130 scoped rows in 74 tables. Shared owners/catalogues
  are dependencies only; their unrelated inspections are not traversed.
- Original row bytes were encrypted, read back and compared. A second independent
  production read matched the first. This is a consistency check of that scope,
  not a transactionally atomic whole-server snapshot or ongoing synchronization.
- 652 available Storage objects were encrypted and individually verified:
  576 inspection images, 67 original stored reports and 9 property-media files.
  Total object bytes: 2,257,586,859. All 67 stored PDF hashes match their report
  records. Two additional legacy embedded PDFs are preserved/verified in rows.
- Local PGlite restored the rows without timestamp/revision rewriting and
  validated actual FK definitions, including cyclic/composite dependencies.
- Offline replay decrypted and hash-checked all 652 available files again and
  applied all 11 proposed migrations. Original fields of inspections, control
  items, images, report links and profiles remained unchanged. Building rollout
  was not activated. No customer data went to staging or a public test service.

Private evidence pointers (ignored, not customer-data artifacts to commit):

- `.cache/ob-release/production-inventory-latest.json`
- `.cache/ob-release/production-backup-latest.json`
- `.cache/ob-release/production-local-rehearsal-latest.json`

Protected root is under the current user's `.codex/backups/hushub-ob/` directory.
The accepted row/file capture is `production-1789413740107/snapshot-1789415317173`,
captured 19:48:37-19:53:44 UTC. The successful offline migration replay completed
20:01:01 UTC. The immutable backup manifest retains its initial failed migration
attempt; the separate later rehearsal receipt records the successful correction.
Neither receipt labels the three absent objects as successfully backed up.

## Historical missing objects

Three JPEG references in four frozen report snapshots return Storage
`not_found` (HTTP 400), confirmed with a second read. They are not current
`inspection_images` rows or current cover paths. Every affected report's stored
original PDF is present and hash-verified in the backup, including the PDFs for
active links. The missing source images must not trigger regeneration/replacement
of those original PDFs. The user subsequently supplied a previously sent bearer
link. Its anonymous page and original PDF download passed on 14 September at
20:27 UTC: 32 readable pages, 19,960,502 bytes, identical to the stored checksum
and encrypted original. This closes the supplied-link baseline check, not every
historical link or post-deployment verification. No report was regenerated.
The URL/token is not committed; the private receipt is encrypted alongside the
backup. Safe status only: `.cache/ob-release/legacy-report-latest.json`.

Strict `backupComplete` remains false. The user explicitly accepted this
pre-existing limitation before the 15 September release. Acceptance does not
restore the missing files. Do not fabricate replacements or drop the references.

## Post-release preservation check, 15 September

Before the first migration, two scoped reads matched the original row hash and
all 652 available files were reverified. After the approved schema/application
updates, original-field verification completed at 05:08 UTC: all 40 OB roots,
two matching scoped row reads, 652 unchanged available files and the same three
missing objects. Added columns were excluded from original-field comparisons.
The original backup capture time and immutable manifest were not rewritten.

At 05:11 UTC the supplied old report link passed again: page 200, redirect 302,
PDF 200, 32 readable pages and 19,960,502 bytes identical to the stored checksum
and encrypted original. No PDF was regenerated. Rollout remains OFF, with zero
activated inspections. Receipts: `.cache/ob-release/production-preservation-latest.json`
and `.cache/ob-release/legacy-report-latest.json`.

## Encryption and recovery limits

Rows, schema, manifests and objects use AES-256-GCM with a random nonce and
authenticated envelope. The key uses Windows CurrentUser DPAPI; the directory
ACL is restricted to the current Windows identity and SYSTEM. Customer data and
keys must not enter Git, terminal output, synthetic staging or public buckets.

The original local copy is tied to this Windows profile. Copying those encrypted
files alone does not provide independent recovery. The subsequently approved
portable export below removes the cryptographic Windows dependency. On 15 September
the user explicitly confirmed separate secure custody of the recovery key; this
is user attestation, not inspection of their external storage. Agree retention before
relying on it for a production change. The existing scheduled Supabase database
backups exclude Storage objects.

Excluded: Auth accounts/passwords/MFA, full TU/EB scope, managed Supabase services,
cron/external integrations, managed-role memberships/default grants, and a full
remote Supabase restore. Auth UUID-only stand-ins are used exclusively for local
FK validation. Public relation/function ACLs are replayed from reviewed metadata
only inside local PGlite; this does not certify every live caller or admin role.

Initial local migration replay stopped because the shared staging schema builder
deliberately strips browser grants. The local-only fixture now replays reviewed
public ACLs before testing migrations. No migration guard was weakened and no
production grant was added. The original sealed staging builder is unchanged.

## Reproduction

- `node scripts/audit-ob-production-readonly.mjs`: pinned production GET-only
  inventory and protected schema capture. Requires the fresh reviewed catalog.
- `node scripts/backup-ob-production-readonly.mjs`: encrypted scoped rows/files,
  double-read, local restore and proposed-migration rehearsal.
- `node scripts/backup-ob-production-readonly.mjs --resume`: same protected key
  root and identical row hash required. Prior files are decrypted/hash-checked and
  remotely ETag-checked before hardlink reuse; unverified partial files are ignored.
- `node scripts/rehearse-ob-production-backup-locally.mjs`: entirely offline,
  repeats file/row validation and local migration replay from the encrypted copy.

An earlier attempt ran out of disk space. Its valid files were reused without
duplicating them; no cleanup deletion succeeded. New capture requires at least
1 GB initially and stops new downloads at a 650 MB reserve. These limits do not
replace adequate disk capacity. Do not delete failed evidence or other tasks'
files to force a production release through.

Tests: 22 targeted encryption, read-path, scoped closure, restoration, local ACL
and HTTPS gateway tests pass. The candidate's 131 application tests/build are
separate evidence. Refresh the scoped copy after an agreed editing pause before
any eventual migration/activation; this receipt is not a standing authorization.

## Portable removable-drive copy

The user explicitly approved `D:\HusHub-backup` on the removable exFAT device
with serial `31306631`. Export package:
`ob-2026-09-14-82d33318-fe87-4edf-978c-08ae14ea2321`.

Status: **COPIED AND INDEPENDENTLY VERIFIED; SEPARATE KEY CUSTODY USER-CONFIRMED**.
Copy and verification completed 2026-09-14 20:49:17 UTC. All 670 encrypted
data/metadata files passed, covering 652 available source object references
(650 unique content blobs) and 2,280,435,284 plaintext bytes including metadata.
Receipt: `.cache/ob-release/portable-backup-82d33318-fe87-4edf-978c-08ae14ea2321.json`.
No release approval follows from this export. The original source capture and
all known omissions remain; no customer plaintext was extracted onto D:.

`scripts/export-ob-portable-backup.mjs` creates a new, uniquely named directory
without merging or replacing existing files. It checks the device, free space,
non-linked paths, protected local key ACL and successful local-rehearsal receipt.
It copies only verified encrypted source objects and adds encrypted schema,
reviewed SQL, recovery evidence and restore-support source. Files are flushed
before verification. It does not fetch data, connect to production or refresh
the original capture time.

The data key is wrapped using a new random 256-bit recovery key with AES-GCM.
The recovery record is written only to the existing protected local backup root,
in `portable-recovery-<package-id>.json`. Its inherited ACL was checked: current
Windows identity and SYSTEM only. No plaintext key is placed on D:, in Git or in
terminal output. The record is intentionally portable, not DPAPI-bound.

**User confirmation:** on 15 September the user answered yes to separate secure
key custody outside this computer and USB drive. The local status receipt records
`recoveryKeyHandoffConfirmed: true`, recorded at 04:36 UTC. No key was requested,
read or posted in the conversation and no external storage was inspected. The
original package and its verification records have not been modified.
Do not delete the local backup/key, and do not put the key beside the USB copy.

The package includes a standalone Node verification/extraction tool, its two
library files, authenticated encrypted catalog and instructions. No npm install,
Supabase credentials or Windows DPAPI are needed to decrypt it. Copied tool
hashes are recorded with the separate key; obtain/check tools from a trusted
source before executing a package from untrusted storage.

Read-only verification uses the tool from D: in a new process with no application
secrets in its environment. It authenticates every envelope, compares ciphertext
and plaintext hashes and checks asset coverage against the original manifest.
The key comes from the separate portable record, not `key.dpapi`. This is not a
test on a second physical computer or a full Supabase-service restore.

`--extract-to NEW_DIRECTORY` is an explicit optional plaintext recovery operation.
It refuses existing or overlapping directories and unsafe/duplicate paths. A
failed extraction may leave partial files; only an extraction ending with
`RECOVERY-VERIFIED.json` is accepted. `blobs/` holds original bytes and the
recovered manifest maps hashes to original Storage buckets/paths. No live
database import is performed; that requires a separately reviewed scoped process.

Five new portable-backup tests cover independent verification, wrong keys,
corruption, omitted assets, safe paths, actual synthetic extraction and refusal
to overwrite existing files. All 27 combined backup/ACL/gateway tests pass, as
does targeted ESLint. The 45-file application candidate remains unchanged.
