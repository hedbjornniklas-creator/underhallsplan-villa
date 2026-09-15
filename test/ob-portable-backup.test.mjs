import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { digest, seal, unseal } from '../scripts/lib/ob-private-backup.mjs'
import { portableFormat, recoveryRecord, verifyPortablePackage, wrapPortableKey, safeEntryPath } from '../scripts/lib/ob-portable-backup.mjs'

async function fixture() {
  const root = join(process.cwd(), '.cache', 'ob-portable-test-' + randomUUID())
  await mkdir(join(root, 'data'), { recursive: true })
  await mkdir(join(root, 'blobs'))
  const key = randomBytes(32), recoveryKey = randomBytes(32), packageId = randomUUID()
  const image = Buffer.from('synthetic photo'), imageHash = digest(image), rows = Buffer.from('{"rows":[]}')
  const source = { consistentDoubleRead: true, localRestorePassed: true, backupComplete: false,
    rows: { sha256: digest(rows) }, missingAssets: [{ path: 'already-missing.jpg' }],
    assets: [{ sha256: imageHash, bytes: image.length }] }
  const catalog = { format: portableFormat, packageId, files: [] }
  for (const [path, restorePath, bytes] of [
    ['data/rows.gcm', 'data/rows.json', rows],
    ['data/schema.gcm', 'schema/schema.json', Buffer.from('{"tables":[]}')],
    ['data/backup-manifest.gcm', 'data/backup-manifest.json', Buffer.from(JSON.stringify(source))],
    ['blobs/' + imageHash + '.gcm', 'blobs/' + imageHash, image],
  ]) {
    const encrypted = seal(bytes, key)
    await writeFile(join(root, path), encrypted)
    catalog.files.push({ path, restorePath, bytes: bytes.length, sha256: digest(bytes), encryptedSha256: digest(encrypted) })
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ format: portableFormat, packageId }))
  await writeFile(join(root, 'key.wrap.gcm'), wrapPortableKey(key, recoveryKey, packageId))
  await writeFile(join(root, 'catalog.gcm'), seal(Buffer.from(JSON.stringify(catalog)), key))
  return { root, key, recoveryKey, record: recoveryRecord(packageId, recoveryKey), catalog }
}

test('portable package verifies without DPAPI and retains known source omissions', async () => {
  const f = await fixture()
  const result = await verifyPortablePackage(f.root, f.record)
  assert.equal(result.verified, true)
  assert.equal(result.independentOfWindowsKey, true)
  assert.equal(result.verifiedFiles, 4)
  assert.equal(result.availableObjects, 1)
  assert.equal(result.missingSourceObjects, 1)
  assert.equal(result.sourceCaptureComplete, false)
})

test('wrong recovery keys, package identity and corrupted files fail closed', async () => {
  const f = await fixture()
  await assert.rejects(verifyPortablePackage(f.root, recoveryRecord(f.record.packageId, randomBytes(32))))
  await assert.rejects(verifyPortablePackage(f.root, { ...f.record, packageId: randomUUID() }))
  const path = join(f.root, 'data/rows.gcm'), bytes = await readFile(path)
  bytes[bytes.length - 1] ^= 1
  await writeFile(path, bytes)
  await assert.rejects(verifyPortablePackage(f.root, f.record), /checksum/)
})

test('authenticated catalog cannot silently omit original assets', async () => {
  const f = await fixture()
  f.catalog.files = f.catalog.files.filter(entry => !entry.path.startsWith('blobs/'))
  await writeFile(join(f.root, 'catalog.gcm'), seal(Buffer.from(JSON.stringify(f.catalog)), f.key))
  await assert.rejects(verifyPortablePackage(f.root, f.record), /coverage/)
})

test('extraction recovers original bytes only into a new directory', async () => {
  const f = await fixture(), output = f.root + '-recovered'
  const result = await verifyPortablePackage(f.root, f.record, { extractTo: output })
  assert.equal(result.extracted, true)
  for (const entry of f.catalog.files) {
    assert.deepEqual(await readFile(join(output, entry.restorePath)), unseal(await readFile(join(f.root, entry.path)), f.key))
  }
  await writeFile(join(output, 'existing.txt'), 'must remain')
  await assert.rejects(verifyPortablePackage(f.root, f.record, { extractTo: output }), /EEXIST/)
  assert.equal(await readFile(join(output, 'existing.txt'), 'utf8'), 'must remain')
  await assert.rejects(verifyPortablePackage(f.root, f.record, { extractTo: join(f.root, 'recovered') }), /outside/)
})

test('traversal, absolute paths and duplicate restore targets are rejected', async () => {
  const f = await fixture()
  for (const path of ['../secret', '/secret', 'C:/secret', 'data/../secret', 'data\\secret', 'data/%2e%2e/secret']) {
    assert.throws(() => safeEntryPath(f.root, path))
  }
  f.catalog.files[0].restorePath = f.catalog.files[1].restorePath
  await writeFile(join(f.root, 'catalog.gcm'), seal(Buffer.from(JSON.stringify(f.catalog)), f.key))
  await assert.rejects(verifyPortablePackage(f.root, f.record), /Duplicate/)
})
