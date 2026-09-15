import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

// Read-only database audit around reversible UI tests, limited to the synthetic fixture.
const phase = process.argv[2]
assert.ok(['before', 'detached', 'after'].includes(phase))
const folder = new URL('../.cache/ob-staging-app/', import.meta.url)
const keys = validateStagingKeys(JSON.parse(await readFile(new URL('keys.json', folder), 'utf8')))
const fixture = JSON.parse(await readFile(new URL('fixtures.json', folder), 'utf8'))
assert.equal(fixture.project, keys.url)
const db = createClient(keys.url, keys.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
assert.equal((await db.auth.signInWithPassword(fixture.owner)).error, null)
const tables = ['ob_inspection_buildings', 'ob_building_conditions', 'inspection_overview_selections',
  'inspection_interior_rooms', 'inspection_control_items', 'inspection_images']
const snapshot = { project: keys.url, inspection: fixture.inspection, tables: {} }
for (const table of tables) {
  const result = await db.from(table).select('*').eq('inspection_id', fixture.inspection).order('id')
  assert.equal(result.error, null, table)
  snapshot.tables[table] = result.data
}
assert.equal(snapshot.tables.ob_inspection_buildings.length, 2)
assert.ok(snapshot.tables.inspection_interior_rooms.some(r => r.id === fixture.room))
assert.ok(snapshot.tables.inspection_control_items.some(r => r.id === fixture.note))
const baseline = new URL('mobile-roundtrip-before.json', folder)
if (phase === 'before') {
  await writeFile(baseline, JSON.stringify(snapshot), { flag: 'wx' })
  console.log('PASS Synthetic baseline saved; existing baseline is never overwritten')
} else {
  const before = JSON.parse(await readFile(baseline, 'utf8'))
  assert.equal(before.project, snapshot.project)
  assert.equal(before.inspection, snapshot.inspection)
  if (phase === 'detached') {
    const guest = before.tables.ob_inspection_buildings.find(row => row.category_key === 'guesthouse')
    assert.ok(guest)
    const images = snapshot.tables.inspection_images.filter(row => {
      const original = before.tables.inspection_images.find(item => item.id === row.id)
      return original?.control_item_id && !row.control_item_id
    })
    assert.equal(images.length, 1)
    const image = images[0]
    const original = before.tables.inspection_images.find(row => row.id === image.id)
    assert.equal(image.building_part_id, guest.id)
    for (const key of ['file_path', 'interior_room_id', 'origin_building_part_id', 'origin_interior_room_id']) {
      assert.equal(image[key], original[key], key)
    }
    assert.equal(image.processing_status, 'unprocessed')
    const url = db.storage.from('inspection-images').getPublicUrl(image.file_path).data.publicUrl
    assert.equal(new URL(url).origin, keys.url)
    assert.equal((await fetch(url)).status, 200)
    console.log('PASS Detached guest image retains its file and original building/room; file is still readable')
    process.exit(0)
  }
  const changed = []
  const content = row => Object.fromEntries(Object.entries(row).filter(([key]) =>
    !['updated_at', 'ob_revision', 'revision'].includes(key)))
  for (const table of tables) {
    assert.equal(snapshot.tables[table].length, before.tables[table].length, `${table}: row count changed`)
    for (const [index, row] of snapshot.tables[table].entries()) {
      const original = before.tables[table][index]
      assert.deepEqual(content(row), content(original), `${table}/${row.id}: content or ownership changed`)
      if (row.ob_revision !== original.ob_revision || row.revision !== original.revision) {
        changed.push({ table, id: row.id })
      }
    }
  }
  assert.ok(changed.some(row => row.table === 'inspection_interior_rooms'), 'Exercise room rename and restore')
  assert.ok(changed.some(row => row.table === 'inspection_images'), 'Exercise image unlink and relink')
  const result = { project: snapshot.project, unchangedContent: true,
    rowCounts: Object.fromEntries(tables.map(table => [table, snapshot.tables[table].length])),
    revisedRows: changed }
  await writeFile(new URL('mobile-roundtrip-validation.json', folder), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
