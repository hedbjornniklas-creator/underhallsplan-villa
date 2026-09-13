import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import sharp from 'sharp'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'

const folder = new URL('../.cache/ob-staging-app/', import.meta.url)
const keys = validateStagingKeys(JSON.parse(await readFile(new URL('keys.json', folder), 'utf8')))
const fixture = JSON.parse(await readFile(new URL('fixtures.json', folder), 'utf8'))
assert.equal(fixture.project, keys.url)
const base = process.argv[2] ?? 'http://127.0.0.1:57100'
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
const admin = createClient(keys.url, keys.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
async function identity(person) {
  const cookies = new Map()
  const db = createServerClient(keys.url, keys.anonKey, { cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: all => all.forEach(c => cookies.set(c.name, c.value)),
  } })
  assert.equal((await db.auth.signInWithPassword({ email: person.email, password: person.password })).error, null)
  return { db, headers: { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } }
}
const owner = await identity(fixture.owner)
const stranger = await identity(fixture.stranger)
const checks = []
function pass(name) { checks.push(name); console.log(`PASS ${name}`) }
async function rows(table, client = owner.db) {
  const result = await client.from(table).select('*').eq('inspection_id', fixture.inspection)
  assert.equal(result.error, null, `${table}: ${result.error?.message}`)
  return result.data
}
async function command(operation, payload, status = 200, actor = owner) {
  const response = await fetch(`${base}/api/ob/inspections/${fixture.inspection}/buildings`, {
    method: 'POST', headers: { ...actor.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, payload }),
  })
  const result = await response.json()
  assert.equal(response.status, status, JSON.stringify(result))
  return result.data
}
async function update(table, current, patch, status = 200, actor = owner) {
  return command('row', { table, operation: 'update', partId: current.building_part_id,
    id: current.id, revision: current.ob_revision, requestId: randomUUID(), row: patch }, status, actor)
}
async function insert(table, partId, id, row) {
  return command('row', { table, operation: 'insert', partId, id, row, requestId: randomUUID() })
}
const parts = await rows('ob_inspection_buildings')
assert.equal(parts.length, 2, 'This fixture exercise expects exactly two synthetic buildings')
const main = parts.find(p => p.category_key === 'main')
const guest = parts.find(p => p.category_key === 'guesthouse')
assert.ok(main && guest)
const rooms = await rows('inspection_interior_rooms')
const mainRoom = rooms.find(r => r.id === fixture.room)
const guestRoom = rooms.find(r => r.building_part_id === guest.id && r.room_label === 'Hall i g\u00e4sthus')
assert.equal(mainRoom.building_part_id, main.id)
assert.ok(guestRoom)
const notes = await rows('inspection_control_items')
const mainNote = notes.find(n => n.id === fixture.note)
const guestNote = notes.find(n => n.interior_room_id === guestRoom.id && n.note.startsWith('Endast g\u00e4sthus:'))
assert.ok(mainNote && guestNote)
const original = JSON.parse(await readFile(new URL('before-activation.json', folder), 'utf8'))
assert.equal(mainNote.note, original.inspection_control_items.find(n => n.id === fixture.note).note)
assert.equal(mainRoom.floor_label, original.inspection_interior_rooms.find(r => r.id === fixture.room).floor_label)

// Add only missing synthetic configuration. Existing choices and user edits are never upserted.
async function config(table, match, values) {
  const found = await admin.from(table).select('*').match(match).maybeSingle()
  assert.equal(found.error, null)
  if (found.data) return found.data
  const created = await admin.from(table).insert({ ...match, ...values }).select('*').single()
  assert.equal(created.error, null, `${table}: ${created.error?.message}`)
  return created.data
}
const catalog = [
  ['building_year', 'Byggnads\u00e5r', '1980', '2020'],
  ['foundation', 'Grundl\u00e4ggning', 'K\u00e4llare', 'Platta p\u00e5 mark'],
  ['frame', 'Stomme', 'Tr\u00e4', 'L\u00e4ttbetong'],
  ['joists', 'Bj\u00e4lklag', 'Tr\u00e4bj\u00e4lklag', 'Betong'],
  ['facade', 'Fasad', 'Pl\u00e5t', 'Tr\u00e4panel'],
  ['windows', 'F\u00f6nster', 'Tv\u00e5glas', 'Treglas'],
  ['roof', 'Yttertak', 'Betongpannor', 'Papp'],
  ['heating', 'Uppv\u00e4rmning', 'V\u00e4rmepump', 'Direktverkande el'],
  ['ventilation', 'Ventilation', 'Mekanisk fr\u00e5nluft', 'Sj\u00e4lvdrag'],
  ['water', 'Vatten', 'Kommunalt vatten', 'Vatten saknas'],
  ['sewer', 'Avlopp', 'Kommunalt avlopp', 'Avlopp saknas'],
]
const selections = await rows('inspection_overview_selections')
for (const [index, [key, label, first, second]] of catalog.entries()) {
  const item = await config('settings_overview_items', { key }, { label, sort_order: (index + 1) * 100, note_enabled: true })
  const groupKey = key === 'building_year' ? 'year' : 'type'
  const group = await config('settings_overview_groups', { overview_item_id: item.id, key: groupKey },
    { label: key === 'building_year' ? '\u00c5r' : 'Utf\u00f6rande', field_type: key === 'building_year' ? 'year' : 'select' })
  for (const value of [first, second]) {
    await config('settings_overview_options', { group_id: group.id, value }, { label: value })
  }
  for (const [part, value] of [[main, first], [guest, second]]) {
    if (!selections.some(s => s.building_part_id === part.id && s.overview_item_id === item.id)) {
      await insert('inspection_overview_selections', part.id, randomUUID(), {
        overview_item_id: item.id, floor_key: null, set_index: 0, values: { [groupKey]: value },
        note: key === 'facade' ? `TEST ${part.name}: kompletterande fri text om fasaden.` : null,
      })
    }
  }
}
const point = await config('settings_control_points', { key: 'staging_hall_door' }, {
  scope: 'interior', room_type_key: 'hall', title: 'TEST - D\u00f6rrar i hall', sort_order: 100,
})
await config('settings_control_point_outcomes', { control_point_id: point.id, outcome_key: 'staging_door' }, {
  label: 'TEST - D\u00f6rr k\u00e4rvar', note_template: 'TEST: D\u00f6rren k\u00e4rvar vid \u00f6ppning.',
})
pass('Representative conditions, free text and a synthetic note suggestion added without replacing existing rows')

let conditions = await rows('ob_building_conditions')
const beforeGuest = conditions.find(c => c.building_part_id === guest.id)
assert.ok(beforeGuest)
const mainConditions = conditions.find(c => c.building_part_id === main.id)
assert.ok(mainConditions)
// A same-value write exercises revisions without overwriting later manual changes.
const saved = await update('ob_building_conditions', mainConditions, { furnishing_level: mainConditions.furnishing_level })
assert.ok(saved.ob_revision > mainConditions.ob_revision)
assert.deepEqual((await rows('ob_building_conditions')).find(c => c.id === beforeGuest.id), beforeGuest)
await update('ob_building_conditions', mainConditions, { furnishing_level: 'omoblerad' }, 409)
await update('ob_building_conditions', saved, { furnishing_level: 'omoblerad' }, 403, stranger)
assert.equal((await rows('ob_building_conditions', stranger.db)).length, 0)
assert.ok((await owner.db.from('ob_building_conditions').update({ furnishing_level: 'omoblerad' }).eq('id', saved.id)).error)
pass('Conditions read/write works; other building unchanged; stale, foreign-user and direct browser writes rejected')

const planUrl = new URL('building-test-fixtures.json', folder)
let plan
try { plan = JSON.parse(await readFile(planUrl, 'utf8')) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  plan = { project: keys.url, inspection: fixture.inspection, images: [main, guest].map(part => ({ partId: part.id, id: randomUUID() })) }
  await writeFile(planUrl, JSON.stringify(plan, null, 2), { flag: 'wx' })
}
assert.equal(plan.project, keys.url)
assert.equal(plan.inspection, fixture.inspection)
const allImages = await rows('inspection_images')
for (const [index, part] of [main, guest].entries()) {
  const entry = plan.images.find(p => p.partId === part.id)
  assert.ok(entry)
  const room = index === 0 ? mainRoom : guestRoom
  const note = index === 0 ? mainNote : guestNote
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="${index ? '#d8ede5' : '#dde5f8'}"/><path d="M180 320 L500 120 L820 320 V600 H180 Z" fill="${index ? '#286354' : '#385692'}"/><rect x="450" y="400" width="100" height="200" fill="white"/><text x="500" y="70" text-anchor="middle" font-family="Arial" font-size="38">TEST - ${index ? 'GASTHUS' : 'HUVUDBYGGNAD'}</text></svg>`)).png().toBuffer()
  const path = `${fixture.inspection}/round/staging-fixtures/${entry.id}.png`
  let image = allImages.find(i => i.id === entry.id)
  if (!image) {
    const uploaded = await owner.db.storage.from('inspection-images').upload(path, png, { contentType: 'image/png', upsert: false })
    assert.ok(!uploaded.error || String(uploaded.error.statusCode) === '409', uploaded.error?.message)
    image = await insert('inspection_images', part.id, entry.id, {
      file_path: path, label: `TEST - ${part.name}`, interior_room_id: room.id,
      origin_building_part_id: part.id, origin_interior_room_id: room.id,
      origin_floor_label: room.floor_label, origin_room_label: room.room_label,
      origin_room_type_key: room.room_type_key, source_area: 'interior',
    })
  }
  assert.equal(image.building_part_id, part.id, 'Do not modify a manually moved fixture image')
  assert.equal(image.file_path, path)
  assert.ok(image.control_item_id === null || image.control_item_id === note.id, 'Do not modify a manually relinked fixture image')
  const linked = await update('inspection_images', image, { control_item_id: note.id, processing_status: 'linked' })
  const detached = await update('inspection_images', linked, { control_item_id: null, processing_status: 'unprocessed' })
  assert.equal(detached.file_path, path)
  assert.equal(detached.origin_building_part_id, part.id)
  const publicUrl = owner.db.storage.from('inspection-images').getPublicUrl(path).data.publicUrl
  assert.equal((await fetch(publicUrl)).status, 200)
  const wrongRoom = index === 0 ? guestRoom : mainRoom
  await update('inspection_images', detached, { interior_room_id: wrongRoom.id }, 409)
  assert.equal((await rows('inspection_images')).find(i => i.id === entry.id).interior_room_id, room.id)
  await update('inspection_images', detached, { control_item_id: note.id, processing_status: 'linked' })

  const coverPath = `${fixture.inspection}/building-covers/${part.id}/staging-fixture.png`
  if (!part.cover_path) {
    const uploaded = await owner.db.storage.from('inspection-images').upload(coverPath, png, { contentType: 'image/png', upsert: false })
    assert.ok(!uploaded.error || String(uploaded.error.statusCode) === '409', uploaded.error?.message)
    await command('edit', { partId: part.id, revision: part.revision, requestId: randomUUID(), coverPath })
  }
}
pass('Images uploaded, linked, detached without file deletion, relinked; cross-building room references rejected; distinct covers saved')

conditions = await rows('ob_building_conditions')
assert.equal(conditions.length, 2)
assert.equal((await rows('inspection_control_items')).find(n => n.id === fixture.note).note, mainNote.note)
assert.equal((await rows('inspection_interior_rooms')).find(r => r.id === fixture.room).floor_label, mainRoom.floor_label)
pass('Original synthetic note and legacy floor label still unchanged')
await writeFile(new URL('building-test-results.json', folder), JSON.stringify({ project: keys.url, time: new Date().toISOString(), checks }, null, 2))
