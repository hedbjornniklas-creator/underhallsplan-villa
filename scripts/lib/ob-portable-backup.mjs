import assert from 'node:assert/strict'
import { lstat, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'
import { digest, seal, unseal } from './ob-private-backup.mjs'

export const portableFormat = 'HUSHUB-OB-PORTABLE-1'

export async function assertNoLinks(path) {
  const absolute = resolve(path), root = parse(absolute).root
  let current = root
  for (const part of ['', ...absolute.slice(root.length).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part)
    assert.ok(!(await lstat(current)).isSymbolicLink(), 'Linked backup paths are not permitted')
  }
  return absolute
}

export function safeEntryPath(root, name) {
  assert.ok(typeof name === 'string' && /^[a-zA-Z0-9_.\/-]+$/.test(name), 'Unsafe package entry')
  assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe package entry')
  const target = resolve(root, name)
  const within = relative(resolve(root), target)
  assert.ok(within && !within.startsWith('..') && !parse(within).root, 'Entry escapes package')
  return target
}

export async function writeNewDurable(path, bytes) {
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}

export function recoveryRecord(packageId, recoveryKey) {
  assert.match(packageId, /^[a-f0-9-]{36}$/)
  assert.equal(recoveryKey.length, 32)
  return { format: portableFormat, packageId, recoveryKey: 'HHOB1.' + recoveryKey.toString('base64url') }
}

export function decodeRecoveryRecord(record, packageId) {
  assert.equal(record.format, portableFormat)
  assert.equal(record.packageId, packageId, 'Recovery key belongs to another package')
  assert.match(record.recoveryKey, /^HHOB1\.[a-zA-Z0-9_-]{43}$/)
  const key = Buffer.from(record.recoveryKey.slice(6), 'base64url')
  assert.equal(key.length, 32)
  assert.equal('HHOB1.' + key.toString('base64url'), record.recoveryKey, 'Invalid recovery key encoding')
  return key
}

export function wrapPortableKey(dataKey, recoveryKey, packageId) {
  assert.equal(dataKey.length, 32)
  return seal(Buffer.from(JSON.stringify({ format: portableFormat, packageId, key: dataKey.toString('base64url') })), recoveryKey)
}

async function readPackageFile(root, name, limit = 100000033) {
  const path = safeEntryPath(root, name)
  await assertNoLinks(path)
  const info = await lstat(path)
  assert.ok(info.isFile() && info.size <= limit, 'Unexpected package file size or type')
  return readFile(path)
}

export async function verifyPortablePackage(root, record, { extractTo, onProgress = () => {} } = {}) {
  root = await assertNoLinks(root)
  const header = JSON.parse(await readPackageFile(root, 'package.json', 10000))
  assert.equal(header.format, portableFormat)
  assert.match(header.packageId, /^[a-f0-9-]{36}$/)
  const recoveryKey = decodeRecoveryRecord(record, header.packageId)
  let dataKey
  try {
    const wrapped = JSON.parse(unseal(await readPackageFile(root, 'key.wrap.gcm', 10000), recoveryKey))
    assert.equal(wrapped.format, portableFormat)
    assert.equal(wrapped.packageId, header.packageId)
    dataKey = Buffer.from(wrapped.key, 'base64url')
    assert.equal(dataKey.length, 32)
    const catalog = JSON.parse(unseal(await readPackageFile(root, 'catalog.gcm', 10000000), dataKey))
    assert.equal(catalog.format, portableFormat)
    assert.equal(catalog.packageId, header.packageId)
    assert.ok(Array.isArray(catalog.files) && catalog.files.length > 0 && catalog.files.length < 3000)
    const names = new Set(), extractedNames = new Set()
    for (const entry of catalog.files) {
      safeEntryPath(root, entry.path)
      safeEntryPath(root, entry.restorePath)
      assert.ok(!names.has(entry.path) && !extractedNames.has(entry.restorePath), 'Duplicate package entry')
      names.add(entry.path); extractedNames.add(entry.restorePath)
      assert.match(entry.sha256, /^[a-f0-9]{64}$/)
      assert.match(entry.encryptedSha256, /^[a-f0-9]{64}$/)
      assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 100000000)
    }
    for (const name of ['data/rows.gcm', 'data/schema.gcm', 'data/backup-manifest.gcm']) assert.ok(names.has(name), 'Required backup entry missing')
    if (extractTo) {
      extractTo = resolve(extractTo)
      const between = relative(root, extractTo)
      const reverse = relative(extractTo, root)
      assert.ok(between && (between.startsWith('..' + sep) || parse(between).root), 'Extract outside the encrypted package')
      assert.ok(reverse && (reverse.startsWith('..' + sep) || parse(reverse).root), 'Extract outside the encrypted package')
      await assertNoLinks(dirname(extractTo))
      await mkdir(extractTo) // Must be a NEW directory; never merge/overwrite.
    }
    let verified = 0, bytes = 0, source
    for (const entry of catalog.files) {
      const encrypted = await readPackageFile(root, entry.path)
      assert.equal(encrypted.length, entry.bytes + 33, 'Encrypted size mismatch')
      assert.equal(digest(encrypted), entry.encryptedSha256, 'Encrypted checksum mismatch')
      const plain = unseal(encrypted, dataKey)
      assert.equal(plain.length, entry.bytes)
      assert.equal(digest(plain), entry.sha256, 'Plaintext checksum mismatch')
      if (entry.path === 'data/backup-manifest.gcm') source = JSON.parse(plain)
      if (extractTo) {
        const output = safeEntryPath(extractTo, entry.restorePath)
        await mkdir(dirname(output), { recursive: true })
        await assertNoLinks(dirname(output))
        await writeNewDurable(output, plain)
      }
      plain.fill(0)
      verified++; bytes += entry.bytes
      onProgress({ verified, total: catalog.files.length })
    }
    assert.ok(source && source.consistentDoubleRead && source.localRestorePassed)
    const blobs = new Set(source.assets.map(a => 'blobs/' + a.sha256 + '.gcm'))
    assert.deepEqual([...names].filter(n => n.startsWith('blobs/')).sort(), [...blobs].sort(), 'Original asset coverage mismatch')
    for (const asset of source.assets) {
      const entry = catalog.files.find(f => f.path === 'blobs/' + asset.sha256 + '.gcm')
      assert.equal(entry.sha256, asset.sha256)
      assert.equal(entry.bytes, asset.bytes)
    }
    assert.equal(catalog.files.find(f => f.path === 'data/rows.gcm').sha256, source.rows.sha256)
    const result = { packageId: header.packageId, verified: true, verifiedFiles: verified, bytes,
      availableObjects: source.assets.length, missingSourceObjects: source.missingAssets.length,
      sourceCaptureComplete: source.backupComplete, independentOfWindowsKey: true,
      extracted: Boolean(extractTo), networkUsed: false }
    if (extractTo) await writeNewDurable(join(extractTo, 'RECOVERY-VERIFIED.json'), Buffer.from(JSON.stringify(result, null, 2)))
    return result
  } finally { recoveryKey.fill(0); dataKey?.fill(0) }
}
