import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, statfs, link } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { productionOrigin, readonlyUrl, protectKey, seal, unseal, digest, objectReadPath } from './lib/ob-private-backup.mjs'
import { productionSchemaLocally } from './lib/ob-production-local-schema.mjs'
import { canonical, restoreRowsLocally } from './lib/ob-restore-rehearsal.mjs'
import { collectScopedRowsBatched } from './lib/ob-backup-scope.mjs'
import { rehearseLocalObMigrations } from './lib/ob-local-migration-rehearsal.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const pointerPath = join(root, '.cache/ob-release/production-inventory-latest.json')
const pointer = JSON.parse(await readFile(pointerPath))
assert.equal(pointer.project, productionOrigin)
assert.equal(dirname(resolve(pointer.folder)), resolve(homedir(), '.codex/backups/hushub-ob'))
assert.match(pointer.folder.split(/[\\/]/).pop(), /^production-\d+$/)
assert.ok(Date.now() - Date.parse(pointer.capturedAt) < 6 * 3600000, 'Refresh production inventory')
const key = protectKey(await readFile(join(pointer.folder, 'key.dpapi')), true)
const readPrivate = async name => JSON.parse(unseal(await readFile(join(pointer.folder, name + '.gcm')), key))
const inventory = await readPrivate('inventory'), source = await readPrivate('schema')
const env = parseEnv(await readFile(join(root, '.env.local'), 'utf8'))
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, productionOrigin)
assert.ok(env.SUPABASE_SERVICE_ROLE_KEY)
const disk = await statfs(pointer.folder)
assert.ok(disk.bavail * disk.bsize >= 1000000000, 'At least 1 GB of free disk space is required before backup')
let previous
if (process.argv[2] === '--resume') {
  const receipt = JSON.parse(await readFile(join(root, '.cache/ob-release/production-backup-latest.json')))
  assert.equal(dirname(resolve(receipt.folder)), resolve(pointer.folder), 'Resume must use the same protected backup root')
  const manifest = JSON.parse(unseal(await readFile(join(receipt.folder, 'backup-manifest.gcm')), key))
  assert.equal(manifest.project, productionOrigin)
  assert.equal(manifest.folder, receipt.folder)
  assert.equal(manifest.keyFolder, pointer.folder)
  previous = manifest
}
const destination = join(pointer.folder, 'snapshot-' + Date.now())
await mkdir(destination)
const run = { project: productionOrigin, startedAt: new Date().toISOString(), folder: destination, keyFolder: pointer.folder,
  scope: 'all-current-OB-inspections-with-descendants-and-required-parent-rows',
  backupComplete: false, consistentDoubleRead: false, localRestorePassed: false, productionModified: false,
  assets: [], externalReferences: [], unresolvedPaths: [], missingAssets: [], checks: [] }
const privateSave = async (name, bytes) => {
  await writeFile(join(destination, name + '.gcm'), seal(bytes, key), { flag: 'wx' })
  const recovered = unseal(await readFile(join(destination, name + '.gcm')), key)
  assert.deepEqual(recovered, bytes, 'Encrypted read-back mismatch')
  return { name, sha256: digest(bytes), bytes: bytes.length }
}
await mkdir(join(destination, 'blobs'))
const realFetch = globalThis.fetch
async function get(path, headers = {}) {
  const url = readonlyUrl(path)
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await realFetch(url, { method: 'GET', redirect: 'error', headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, ...headers }, signal: AbortSignal.timeout(90000) })
      if (attempt >= 2 || ![429, 502, 503, 504].includes(response.status)) return response
      await response.body?.cancel()
    } catch (error) { if (attempt >= 2 || !(error instanceof TypeError)) throw error }
    await delay(500 * (attempt + 1))
  }
}
let local
try {
  local = await productionSchemaLocally(root, source)
  run.checks.push('Fresh production table/column/FK metadata matches the local restore schema')
  console.log('Local schema matches the fresh production metadata; collecting OB rows.')
  const definitions = new Map(local.metadata.tables.map(t => [t.name, t]))
  let requests = 0
  const readRows = async (table, filters) => {
    if (table === 'auth.users') {
      for (const filter of filters) assert.deepEqual(Object.keys(filter), ['id'])
      // Authentication is not part of this backup. These are explicit local
      // FK stand-ins only, not copies/restorable credentials of real accounts.
      return filters.map(filter => ({ id: filter.id, email: null, raw_user_meta_data: {} }))
    }
    assert.ok(table.startsWith('public.') && definitions.has(table))
    const data = [], params = new URLSearchParams({ select: '*', limit: '500' })
    const terms = filters.map(filter => 'and(' + Object.entries(filter).map(([column, value]) => {
      assert.ok(definitions.get(table).columns.includes(column) && /^[a-z_][a-z0-9_]*$/.test(column))
      const literal = String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
      return column + '.eq."' + literal + '"'
    }).join(',') + ')')
    assert.ok(terms.length > 0 && terms.length <= 50)
    params.set('or', '(' + terms.join(',') + ')')
    assert.ok(definitions.get(table).pk?.length, 'Unreviewed pagination key: ' + table)
    params.set('order', definitions.get(table).pk.join(','))
    for (let offset = 0; ; offset += 500) {
      params.set('offset', String(offset))
      const response = await get('/rest/v1/' + table.slice(7) + '?' + params, { Prefer: 'count=exact' })
      assert.ok([200, 206].includes(response.status), 'Table read failed: ' + table + ', HTTP ' + response.status)
      const page = await response.json()
      const total = Number(response.headers.get('content-range')?.split('/')[1])
      assert.ok(Number.isInteger(total) && total <= 10000, 'Unreviewed row count: ' + table)
      data.push(...page)
      requests++
      if (requests % 100 === 0) console.log('Read-only row requests: ' + requests)
      if (data.length === total) break
      assert.ok(page.length && data.length < total, 'Inconsistent pagination: ' + table)
    }
    return data
  }
  const ob = inventory.inspections.filter(i => i.inspection_family === 'OB')
  assert.ok(ob.length > 0 && ob.length <= 100)
  const roots = ob.map(i => ({ table: 'public.inspections', filters: { id: i.id } }))
  const rows = await collectScopedRowsBatched(local.metadata, readRows, roots)
  run.inspectionCount = ob.length
  run.tableCount = Object.keys(rows).length
  run.rowCount = Object.values(rows).reduce((n, data) => n + data.length, 0)
  run.authDependencyMode = 'ID-only local FK stand-ins; Auth accounts and credentials excluded'
  run.rows = await privateSave('rows', Buffer.from(canonical(rows)))
  if (previous?.rows) assert.equal(run.rows.sha256, previous.rows.sha256, 'Rows changed since interrupted backup; take a fresh snapshot')
  console.log(`Encrypted ${run.rowCount} scoped rows in ${run.tableCount} tables; reading original files.`)
  const assets = new Map(), seenDigests = new Set()
  const add = (bucket, path, expected) => {
    objectReadPath(bucket, path)
    const id = bucket + '/' + path
    const old = assets.get(id)
    assert.ok(!expected || !old?.expected || old.expected === expected, 'Conflicting original hashes')
    assets.set(id, { ...old, bucket, path, ...(expected ? { expected } : {}) })
  }
  for (const image of rows['public.inspection_images'] ?? []) if (image.file_path) add('inspection-images', image.file_path)
  for (const inspection of rows['public.inspections'] ?? []) if (inspection.cover_path && !/^https?:\/\//.test(inspection.cover_path)) add('inspection-images', inspection.cover_path)
  const embedded = []
  for (const report of rows['public.inspection_report_links'] ?? []) {
    if (report.pdf_storage_path) add(report.pdf_storage_bucket, report.pdf_storage_path, report.pdf_sha256)
    if (report.pdf_base64) {
      const bytes = Buffer.from(report.pdf_base64, 'base64')
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
      if (report.pdf_sha256) assert.equal(digest(bytes), report.pdf_sha256, 'Embedded original PDF hash mismatch')
      embedded.push({ report: report.id, sha256: digest(bytes), bytes: bytes.length })
    }
  }
  run.embeddedPdfs = embedded
  const paths = []
  function inspect(value, field = '', table = '') {
    if (typeof value === 'string') {
      if (/^https?:\/\//.test(value)) {
        const url = new URL(value)
        if (url.origin === productionOrigin && url.pathname.startsWith('/storage/v1/object/')) {
          const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
          if (match) add(match[1], decodeURIComponent(match[2]))
          else run.unresolvedPaths.push({ table, field, value })
        } else if (/\.(png|jpe?g|webp|pdf)(?:\?|$)/i.test(url.pathname)) run.externalReferences.push(value)
      } else if (value && /(?:_path|Path)$/.test(field) && !['itemsPath', 'rowsPath'].includes(field)) paths.push({ table, field, value })
    } else if (Array.isArray(value)) for (const child of value) inspect(child, field, table)
    else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) inspect(child, name, table)
  }
  for (const [table, values] of Object.entries(rows)) {
    if (table !== 'public.ob_round_mutation_events') inspect(values, '', table)
  }
  for (const path of paths) if (![...assets.values()].some(a => a.path === path.value)) run.unresolvedPaths.push(path)
  assert.ok(assets.size <= 2500, 'Review unexpectedly large file inventory')
  let totalBytes = 0
  for (const asset of assets.values()) {
    const old = previous?.assets.find(a => a.bucket === asset.bucket && a.path === asset.path && a.etag)
    if (old) {
      assert.match(old.sha256, /^[a-f0-9]{64}$/)
      const oldPath = join(previous.folder, 'blobs', old.sha256 + '.gcm')
      const recovered = unseal(await readFile(oldPath), key)
      assert.equal(digest(recovered), old.sha256)
      assert.equal(recovered.length, old.bytes)
      const check = await get(objectReadPath(asset.bucket, asset.path), { Range: 'bytes=0-0' })
      const unchanged = check.ok && check.headers.get('etag') === old.etag
      await check.body?.cancel()
      if (unchanged) {
        if (asset.expected) assert.equal(old.sha256, asset.expected)
        if (!seenDigests.has(old.sha256)) {
          await link(oldPath, join(destination, 'blobs', old.sha256 + '.gcm'))
          seenDigests.add(old.sha256)
        }
        run.assets.push({ ...old, reusedVerifiedBlob: true })
        totalBytes += old.bytes
        if (run.assets.length % 50 === 0) console.log('Reused verified original files: ' + run.assets.length)
        continue
      }
    }
    const free = await statfs(destination)
    assert.ok(free.bavail * free.bsize >= 650000000, 'Disk reserve reached; preserve this partial backup and free space')
    const response = await get(objectReadPath(asset.bucket, asset.path))
    if (!response.ok) {
      run.missingAssets.push({ ...asset, status: response.status }); await response.body?.cancel(); continue
    }
    assert.ok(Number(response.headers.get('content-length') ?? 0) <= 100000000, 'Review large object')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.ok(bytes.length && bytes.length <= 100000000)
    totalBytes += bytes.length
    assert.ok(totalBytes <= 4000000000, 'Backup exceeds reviewed 4 GB limit')
    const sha256 = digest(bytes)
    if (asset.expected) assert.equal(sha256, asset.expected, 'Original stored PDF checksum mismatch')
    if (asset.expected) assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    if (!seenDigests.has(sha256)) { await privateSave('blobs/' + sha256, bytes); seenDigests.add(sha256) }
    run.assets.push({ ...asset, sha256, bytes: bytes.length, etag: response.headers.get('etag') })
    if (run.assets.length % 25 === 0) console.log(`Encrypted original files: ${run.assets.length}/${assets.size}`)
  }
  run.totalBytes = totalBytes
  run.expectedAssets = assets.size
  const again = await collectScopedRowsBatched(local.metadata, readRows, roots)
  run.consistentDoubleRead = canonical(rows) === canonical(again)
  assert.ok(run.consistentDoubleRead, 'Production data changed during backup; retain evidence but do not accept it')
  await restoreRowsLocally(local.db, local.metadata, rows)
  run.localRestorePassed = true
  run.checks.push('Encrypted rows and file envelopes were decrypted and byte-compared')
  run.checks.push('Local-only PostgreSQL replay passes row equality and actual foreign-key validation')
  await rehearseLocalObMigrations(local.db, local.metadata, rows, root, run)
  run.checks.push('Proposed migrations replay on the restored local OB data without changing existing inspection, note, image, report or admin values')
  run.backupComplete = run.missingAssets.length === 0 && run.unresolvedPaths.length === 0 && run.externalReferences.length === 0
} catch (error) {
  run.error = error.message; process.exitCode = 1
} finally {
  await local?.db.close()
  run.completedAt = new Date().toISOString()
  await privateSave('backup-manifest', Buffer.from(JSON.stringify(run)))
  const summary = { folder: run.folder, startedAt: run.startedAt, completedAt: run.completedAt, inspectionCount: run.inspectionCount,
    rowCount: run.rowCount, tableCount: run.tableCount, files: run.assets.length, expectedAssets: run.expectedAssets,
    totalBytes: run.totalBytes, consistentDoubleRead: run.consistentDoubleRead, localRestorePassed: run.localRestorePassed,
    localMigrationRehearsalPassed: run.localMigrationRehearsalPassed ?? false,
    backupComplete: run.backupComplete, missingAssets: run.missingAssets.length, unresolvedPaths: run.unresolvedPaths.length,
    externalReferences: run.externalReferences.length, productionModified: false, error: run.error?.split('\n')[0] }
  await writeFile(join(root, '.cache/ob-release/production-backup-latest.json'), JSON.stringify(summary, null, 2))
  key.fill(0)
  console.log(JSON.stringify(summary))
}
