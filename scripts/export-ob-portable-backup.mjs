import assert from 'node:assert/strict'
import { readFile, mkdir, readdir, statfs } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { productionOrigin, protectKey, seal, unseal, digest, windowsPowerShellEnv } from './lib/ob-private-backup.mjs'
import { portableFormat, assertNoLinks, recoveryRecord, wrapPortableKey, writeNewDurable } from './lib/ob-portable-backup.mjs'
import { REVIEW_SHA256 } from './lib/ob-staging-schema.mjs'

globalThis.fetch = () => { throw new Error('Offline export only') }
const root = fileURLToPath(new URL('../', import.meta.url))
const target = resolve(process.argv[2] ?? '')
assert.equal(target, resolve('D:/HusHub-backup'), 'Only the user-approved removable destination is permitted')
const pointer = JSON.parse(await readFile(join(root, '.cache/ob-release/production-backup-latest.json')))
const keyFolder = dirname(resolve(pointer.folder))
assert.equal(dirname(keyFolder), resolve(homedir(), '.codex/backups/hushub-ob'))
assert.match(pointer.folder.split(/[\\/]/).pop(), /^snapshot-\d+$/)
await assertNoLinks(pointer.folder)
await assertNoLinks(dirname(target))
const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; $d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='D:'";
  $a=Get-Acl -LiteralPath $env:OB_BACKUP_KEY_FOLDER; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
  $bad=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.IdentityReference.Value -notin @($sid,'S-1-5-18')});
  @{serial=$d.VolumeSerialNumber; removable=($d.DriveType -eq 2); protectedAcl=$a.AreAccessRulesProtected; safeAcl=($bad.Count -eq 0)} | ConvertTo-Json -Compress`],
{ env: { ...windowsPowerShellEnv(), OB_BACKUP_KEY_FOLDER: keyFolder }, encoding: 'utf8', windowsHide: true })
assert.equal(check.status, 0, 'Destination/key-folder check failed')
const destinationCheck = JSON.parse(check.stdout)
assert.equal(destinationCheck.serial, '31306631', 'Destination device has changed; request review')
assert.ok(destinationCheck.removable && destinationCheck.protectedAcl && destinationCheck.safeAcl)
const disk = await statfs(dirname(target))
assert.ok(disk.bavail * disk.bsize > pointer.totalBytes + 500000000, 'Insufficient destination space')
const key = protectKey(await readFile(join(keyFolder, 'key.dpapi')), true)
const recoveryKey = randomBytes(32), packageId = randomUUID()
const folder = join(target, 'ob-' + new Date().toISOString().slice(0, 10) + '-' + packageId)
const keyFile = join(keyFolder, 'portable-recovery-' + packageId + '.json')
const run = { packageId, folder, keyFile, startedAt: new Date().toISOString(), verified: false,
  productionModified: false, networkUsed: false, recoveryKeyHandoffConfirmed: false }
try {
  const original = JSON.parse(unseal(await readFile(join(pointer.folder, 'backup-manifest.gcm')), key))
  assert.equal(original.project, productionOrigin)
  assert.equal(original.folder, pointer.folder)
  assert.ok(original.consistentDoubleRead && original.localRestorePassed)
  const rehearsal = JSON.parse(await readFile(join(root, '.cache/ob-release/production-local-rehearsal-latest.json')))
  assert.equal(rehearsal.backupFolder, pointer.folder)
  assert.ok(rehearsal.localMigrationRehearsalPassed && rehearsal.filesVerified === original.assets.length)
  assert.equal(dirname(rehearsal.output), pointer.folder)
  const rehearsalBytes = unseal(await readFile(rehearsal.output), key)
  assert.equal(JSON.parse(rehearsalBytes).localMigrationRehearsalPassed, true)
  try { await mkdir(target) } catch (error) { if (error.code !== 'EEXIST') throw error }
  await assertNoLinks(target)
  await mkdir(folder)
  for (const sub of ['data', 'blobs', 'lib']) await mkdir(join(folder, sub))

  const tools = [
    ['verify-ob-portable-backup.mjs', 'scripts/verify-ob-portable-backup.mjs'],
    ['lib/ob-portable-backup.mjs', 'scripts/lib/ob-portable-backup.mjs'],
    ['lib/ob-private-backup.mjs', 'scripts/lib/ob-private-backup.mjs'],
  ]
  const toolHashes = []
  for (const [path, source] of tools) {
    const bytes = await readFile(join(root, source))
    await writeNewDurable(join(folder, path), bytes)
    assert.equal(digest(await readFile(join(folder, path))), digest(bytes))
    toolHashes.push({ path, sha256: digest(bytes) })
  }
  const record = { ...recoveryRecord(packageId, recoveryKey), toolHashes,
    instruction: 'SECRET: keep this file in a password manager or separate secure location, never with the USB backup. It is required on another computer.' }
  await writeNewDurable(keyFile, Buffer.from(JSON.stringify(record, null, 2)))
  assert.deepEqual(JSON.parse(await readFile(keyFile)), record)
  await writeNewDurable(join(folder, 'key.wrap.gcm'), wrapPortableKey(key, recoveryKey, packageId))
  const catalog = { format: portableFormat, packageId, sourceCapturedAt: original.completedAt, files: [] }
  async function addEncrypted(path, restorePath, encrypted, expectedHash, expectedBytes) {
    const plain = unseal(encrypted, key)
    const hash = digest(plain), size = plain.length
    if (expectedHash) assert.equal(hash, expectedHash, 'Source checksum mismatch')
    if (expectedBytes) assert.equal(size, expectedBytes, 'Source size mismatch')
    plain.fill(0)
    await writeNewDurable(join(folder, path), encrypted)
    catalog.files.push({ path, restorePath, sha256: hash, bytes: size, encryptedSha256: digest(encrypted) })
  }
  await addEncrypted('data/rows.gcm', 'data/rows.json', await readFile(join(pointer.folder, 'rows.gcm')), original.rows.sha256, original.rows.bytes)
  await addEncrypted('data/schema.gcm', 'schema/production-schema.json', await readFile(join(keyFolder, 'schema.gcm')))
  await addEncrypted('data/inventory.gcm', 'data/inventory.json', await readFile(join(keyFolder, 'inventory.gcm')))
  await addEncrypted('data/backup-manifest.gcm', 'data/backup-manifest.json', await readFile(join(pointer.folder, 'backup-manifest.gcm')))
  await addEncrypted('data/local-rehearsal.gcm', 'data/local-rehearsal.json', seal(rehearsalBytes, key))
  const baseline = await readFile(join(root, '.cache/inspection-schema-export/production-schema-review.json'))
  assert.equal(digest(baseline), REVIEW_SHA256)
  await addEncrypted('data/baseline-schema.gcm', 'schema/baseline-schema.json', seal(baseline, key))
  const legacy = (await readdir(pointer.folder)).filter(name => /^legacy-public-link-\d+\.gcm$/.test(name)).sort().at(-1)
  if (legacy) await addEncrypted('data/legacy-link-check.gcm', 'data/legacy-link-check.json', await readFile(join(pointer.folder, legacy)))
  for (const migration of [...rehearsal.localMigrations, { name: '2026-09-12_07_profile_org_cards' }]) {
    assert.match(migration.name, /^[a-z0-9_-]+$/)
    const sql = await readFile(join(root, 'docs/db', migration.name + '.sql'))
    if (migration.sha256) assert.equal(digest(sql), migration.sha256, 'SQL changed since successful rehearsal')
    await addEncrypted('data/' + migration.name + '.gcm', 'schema/migrations/' + migration.name + '.sql', seal(sql, key))
  }
  const support = {}
  for (const name of ['ob-staging-schema', 'ob-production-local-schema', 'ob-restore-rehearsal', 'ob-local-migration-rehearsal', 'ob-private-backup']) {
    support[name + '.mjs'] = await readFile(join(root, 'scripts/lib', name + '.mjs'), 'utf8')
  }
  support['package-lock.json'] = await readFile(join(root, 'package-lock.json'), 'utf8')
  await addEncrypted('data/restore-support.gcm', 'schema/restore-support.json', seal(Buffer.from(JSON.stringify(support)), key))
  const seen = new Set()
  for (const asset of original.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    if (seen.has(asset.sha256)) continue
    seen.add(asset.sha256)
    await addEncrypted('blobs/' + asset.sha256 + '.gcm', 'blobs/' + asset.sha256,
      await readFile(join(pointer.folder, 'blobs', asset.sha256 + '.gcm')), asset.sha256, asset.bytes)
    if (seen.size % 50 === 0) console.log('Encrypted source objects copied: ' + seen.size)
  }
  await writeNewDurable(join(folder, 'catalog.gcm'), seal(Buffer.from(JSON.stringify(catalog)), key))
  await writeNewDurable(join(folder, 'package.json'), Buffer.from(JSON.stringify({ format: portableFormat, packageId }, null, 2)))
  const instructions = `HusHub OB encrypted recovery package

Package: ${packageId}
Source captured: ${original.completedAt}
Scope: ${original.inspectionCount} OB inspections, ${original.rowCount} rows, ${original.assets.length} available Storage objects.
Known limitation: ${original.missingAssets.length} historical source images were already absent. Original report PDFs are preserved.

KEEP THE RECOVERY KEY SEPARATE. It is deliberately NOT on this drive.
You need the matching recovery-key JSON file and Node.js 22 or newer on Windows, macOS or Linux.
The tools use built-in Node modules only; no login, Supabase key, npm install or Windows DPAPI is needed for verification/extraction.
Check tool hashes against the separate key record, or obtain the tools from the trusted source repository.

Read-only verification:
  node verify-ob-portable-backup.mjs "PATH_TO_THIS_FOLDER" "PATH_TO_SEPARATE_KEY.json"

Optional extraction of sensitive PLAINTEXT to a NEW, protected local directory:
  node verify-ob-portable-backup.mjs "PATH_TO_THIS_FOLDER" "PATH_TO_SEPARATE_KEY.json" --extract-to "NEW_RECOVERY_DIRECTORY"
Never extract on a public/shared/synced location. Existing directories are refused.
Only an extraction with RECOVERY-VERIFIED.json is complete. A failed extraction may leave partial files; do not use it as a verified restore.
blobs/ contains original file bytes named by SHA-256. data/backup-manifest.json maps each hash to its original Storage bucket/path.
schema/ includes the reviewed catalog, SQL versions and restore-support source. Do not run all SQL on a live system.

Extraction does not alter or restore a live database. Database import requires a separately reviewed scoped restore procedure.
Auth credentials, the full TU/EB scope, cron and managed Supabase services are not included.
The source snapshot must be refreshed after an editing pause before a later production change.
No production data was changed by this export. Do not delete the key or the original local copy before independent key storage is confirmed.
`
  await writeNewDurable(join(folder, 'README.txt'), Buffer.from(instructions))
  key.fill(0); recoveryKey.fill(0)

  // Launch only the copied, hash-checked portable tool. It reads D: plus the
  // separate recovery record, not the original backup or Windows DPAPI key.
  for (const tool of toolHashes) assert.equal(digest(await readFile(join(folder, tool.path))), tool.sha256)
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP)$/i.test(name)))
  const child = spawn(process.execPath, [join(folder, 'verify-ob-portable-backup.mjs'), folder, keyFile],
    { cwd: folder, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''
  child.stdout.on('data', chunk => { const text = chunk.toString(); output += text; process.stdout.write(text) })
  child.stderr.on('data', chunk => { errors += chunk.toString() })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  assert.equal(code, 0, 'Independent package verification failed: ' + errors)
  const result = JSON.parse(output.trim().split(/\r?\n/).at(-1))
  assert.equal(result.packageId, packageId)
  assert.ok(result.verified && result.independentOfWindowsKey && !result.extracted)
  Object.assign(run, result)
  await writeNewDurable(join(folder, 'verification.json'), Buffer.from(JSON.stringify(result, null, 2)))
  run.completedAt = new Date().toISOString()
  await writeNewDurable(join(root, '.cache/ob-release', 'portable-backup-' + packageId + '.json'), Buffer.from(JSON.stringify(run, null, 2)))
  console.log(JSON.stringify(run))
} catch {
  console.error('Portable export stopped. Preserve any partial package and its separate recovery key; production remains unchanged.')
  process.exitCode = 1
} finally { key.fill(0); recoveryKey.fill(0) }
