import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { productionOrigin, readonlyUrl, objectReadPath, protectKey, unseal, seal, digest } from './lib/ob-private-backup.mjs'
import { productionSchemaLocally } from './lib/ob-production-local-schema.mjs'
import { canonical } from './lib/ob-restore-rehearsal.mjs'
import { collectScopedRowsBatched } from './lib/ob-backup-scope.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
assert.ok(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === '--original-fields')
const originalFields = process.argv[2] === '--original-fields'
const pointer = JSON.parse(await readFile(join(root, '.cache/ob-release/production-inventory-latest.json')))
const backup = JSON.parse(await readFile(join(root, '.cache/ob-release/production-backup-latest.json')))
assert.equal(pointer.project, productionOrigin)
assert.equal(dirname(resolve(pointer.folder)), resolve(homedir(), '.codex/backups/hushub-ob'))
assert.equal(dirname(resolve(backup.folder)), resolve(pointer.folder))
assert.equal(backup.consistentDoubleRead, true)
assert.equal(backup.localRestorePassed, true)
const key = protectKey(await readFile(join(pointer.folder, 'key.dpapi')), true)
const decode = async path => JSON.parse(unseal(await readFile(path), key))
const manifest = await decode(join(backup.folder, 'backup-manifest.gcm'))
const source = await decode(join(pointer.folder, 'schema.gcm'))
assert.equal(manifest.folder, backup.folder)
assert.equal(manifest.project, productionOrigin)
const expected = unseal(await readFile(join(backup.folder, 'rows.gcm')), key)
assert.equal(digest(expected), manifest.rows.sha256)
const env = parseEnv(await readFile(join(root, '.env.local'), 'utf8'))
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, productionOrigin)
assert.ok(env.SUPABASE_SERVICE_ROLE_KEY)
const run = { startedAt: new Date().toISOString(), sourceCapturedAt: manifest.startedAt,
  sourceRowsSha256: manifest.rows.sha256, sourceFolder: backup.folder,
  mode: originalFields ? 'post-migration-original-field-preservation' : 'pre-migration-full-scope-current',
  productionModified: false, current: false, checkedFiles: 0, checkedMissing: 0 }
let local
async function get(path, headers = {}) {
  return fetch(readonlyUrl(path), { method: 'GET', redirect: 'error', headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...headers,
  }, signal: AbortSignal.timeout(90000) })
}
async function inspectionIds() {
  const response = await get('/rest/v1/inspections?select=id&inspection_family=eq.OB&order=id&limit=1000', { Prefer: 'count=exact' })
  assert.equal(response.status, 200)
  const rows = await response.json()
  assert.equal(rows.length, Number(response.headers.get('content-range')?.split('/')[1]))
  assert.ok(rows.length > 0 && rows.length <= 100)
  return rows.map(row => row.id)
}
try {
  local = await productionSchemaLocally(root, source)
  const definitions = new Map(local.metadata.tables.map(table => [table.name, table]))
  let requests = 0
  async function readRows(table, filters) {
    if (table === 'auth.users') {
      filters.forEach(filter => assert.deepEqual(Object.keys(filter), ['id']))
      return filters.map(filter => ({ id: filter.id, email: null, raw_user_meta_data: {} }))
    }
    assert.ok(table.startsWith('public.') && definitions.has(table))
    const definition = definitions.get(table)
    assert.ok(definition.pk?.length)
    assert.ok(filters.length > 0 && filters.length <= 50)
    const terms = filters.map(filter => 'and(' + Object.entries(filter).map(([column, value]) => {
      assert.ok(definition.columns.includes(column) && /^[a-z_][a-z0-9_]*$/.test(column))
      return column + '.eq."' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"'
    }).join(',') + ')')
    const params = new URLSearchParams({ select: originalFields ? definition.columns.join(',') : '*',
      limit: '500', order: definition.pk.join(','), or: '(' + terms.join(',') + ')' })
    const rows = []
    for (let offset = 0; ; offset += 500) {
      params.set('offset', String(offset))
      const response = await get('/rest/v1/' + table.slice(7) + '?' + params, { Prefer: 'count=exact' })
      assert.ok([200, 206].includes(response.status), 'Table read failed: ' + table)
      const page = await response.json(), total = Number(response.headers.get('content-range')?.split('/')[1])
      assert.ok(Number.isInteger(total) && total <= 10000)
      rows.push(...page)
      if (++requests % 100 === 0) console.log('Read-only row requests: ' + requests)
      if (rows.length === total) return rows
      assert.ok(page.length && rows.length < total, 'Inconsistent pagination')
    }
  }
  const ids = await inspectionIds()
  const roots = ids.map(id => ({ table: 'public.inspections', filters: { id } }))
  const compare = async () => {
    const rows = await collectScopedRowsBatched(local.metadata, readRows, roots)
    assert.equal(digest(Buffer.from(canonical(rows))), manifest.rows.sha256, 'Production rows changed: fresh scoped backup required')
  }
  await compare()
  console.log('Current scoped rows equal the encrypted backup; checking original files.')
  for (const asset of manifest.assets) {
    const bytes = unseal(await readFile(join(backup.folder, 'blobs', asset.sha256 + '.gcm')), key)
    assert.equal(digest(bytes), asset.sha256)
    assert.equal(bytes.length, asset.bytes)
    if (asset.expected) assert.equal(asset.sha256, asset.expected)
    const response = await get(objectReadPath(asset.bucket, asset.path), asset.etag ? { Range: 'bytes=0-0' } : {})
    assert.ok(response.ok, 'Previously backed-up object is now unavailable')
    if (asset.etag) {
      assert.equal(response.headers.get('etag'), asset.etag, 'Object changed: fresh scoped backup required')
      await response.body?.cancel()
    } else assert.equal(digest(Buffer.from(await response.arrayBuffer())), asset.sha256)
    if (++run.checkedFiles % 100 === 0) console.log('Verified unchanged original files: ' + run.checkedFiles)
  }
  for (const asset of manifest.missingAssets) {
    const response = await get(objectReadPath(asset.bucket, asset.path))
    assert.equal(response.status, 400, 'Missing-object status changed; review required')
    const body = await response.json()
    assert.ok(body.error === 'not_found' || body.code === 'not_found', 'Expected known missing object, not an authorization failure')
    run.checkedMissing++
  }
  await compare()
  assert.deepEqual(await inspectionIds(), ids, 'Inspection inventory changed during validation')
  run.inspectionCount = ids.length
  run.current = true
} catch (error) {
  run.error = error.message.split('\n')[0]
  process.exitCode = 1
} finally {
  await local?.db.close()
  run.completedAt = new Date().toISOString()
  const encrypted = seal(Buffer.from(JSON.stringify(run)), key)
  await writeFile(join(backup.folder, `current-check-${Date.now()}.gcm`), encrypted, { flag: 'wx' })
  const receipt = originalFields ? 'production-preservation-latest.json' : 'production-backup-current.json'
  await writeFile(join(root, '.cache/ob-release', receipt), JSON.stringify(run, null, 2))
  key.fill(0)
  console.log(JSON.stringify(run))
}
