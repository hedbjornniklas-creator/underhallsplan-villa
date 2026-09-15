import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { productionOrigin, protectKey, unseal, seal, digest } from './lib/ob-private-backup.mjs'
import { productionSchemaLocally } from './lib/ob-production-local-schema.mjs'
import { restoreRowsLocally } from './lib/ob-restore-rehearsal.mjs'
import { rehearseLocalObMigrations } from './lib/ob-local-migration-rehearsal.mjs'

globalThis.fetch = () => { throw new Error('Network forbidden in local restore rehearsal') }
const root = fileURLToPath(new URL('../', import.meta.url))
const pointer = JSON.parse(await readFile(join(root, '.cache/ob-release/production-backup-latest.json')))
const keyFolder = dirname(resolve(pointer.folder))
assert.equal(dirname(keyFolder), resolve(homedir(), '.codex/backups/hushub-ob'))
const key = protectKey(await readFile(join(keyFolder, 'key.dpapi')), true)
const manifest = JSON.parse(unseal(await readFile(join(pointer.folder, 'backup-manifest.gcm')), key))
assert.equal(manifest.project, productionOrigin)
assert.equal(manifest.folder, pointer.folder)
assert.ok(manifest.consistentDoubleRead && manifest.localRestorePassed)
const run = { startedAt: new Date().toISOString(), backupFolder: pointer.folder, networkUsed: false,
  productionModified: false, localMigrationRehearsalPassed: false, filesVerified: 0, missingAssets: manifest.missingAssets.length }
let local
try {
  const rowsBytes = unseal(await readFile(join(pointer.folder, 'rows.gcm')), key)
  assert.equal(digest(rowsBytes), manifest.rows.sha256)
  const rows = JSON.parse(rowsBytes)
  for (const asset of manifest.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    const bytes = unseal(await readFile(join(pointer.folder, 'blobs', asset.sha256 + '.gcm')), key)
    assert.equal(digest(bytes), asset.sha256)
    assert.equal(bytes.length, asset.bytes)
    run.filesVerified++
  }
  const schema = JSON.parse(unseal(await readFile(join(keyFolder, 'schema.gcm')), key))
  local = await productionSchemaLocally(root, schema)
  await restoreRowsLocally(local.db, local.metadata, rows)
  console.log('Offline encrypted file verification and local row restore passed')
  await rehearseLocalObMigrations(local.db, local.metadata, rows, root, run)
} catch (error) { run.error = error.message; process.exitCode = 1 }
finally {
  await local?.db.close()
  run.completedAt = new Date().toISOString()
  const output = join(pointer.folder, 'local-migration-' + Date.now() + '.gcm')
  await writeFile(output, seal(Buffer.from(JSON.stringify(run)), key), { flag: 'wx' })
  key.fill(0)
  const summary = { ...run, error: run.error?.split('\n')[0], output }
  await writeFile(join(root, '.cache/ob-release/production-local-rehearsal-latest.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
}
