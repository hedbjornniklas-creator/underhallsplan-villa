import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'
import { createBuildingDataClient } from '../src/lib/ob/buildingDataClient.ts'

const folder = new URL('../.cache/ob-staging-app/', import.meta.url)
const keys = validateStagingKeys(JSON.parse(await readFile(new URL('keys.json', folder), 'utf8')))
const fixture = JSON.parse(await readFile(new URL('fixtures.json', folder), 'utf8'))
const running = JSON.parse(await readFile(new URL('running.json', folder), 'utf8'))
assert.equal(fixture.project, keys.url)
assert.equal(running.project, new URL(keys.url).hostname)
assert.equal(running.url, `http://127.0.0.1:${running.port}`)
const probe = await fetch(`${running.url}/staging`, { redirect: 'error' })
assert.equal(probe.headers.get('x-ob-test-project'), running.project)
const admin = createClient(keys.url, keys.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(keys.url, keys.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
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
const run = { project: keys.url, property: randomUUID(), inspection: randomUUID(), secondInspection: randomUUID(),
  startedAt: new Date().toISOString(), checks: [], completed: false }
const runFolder = new URL(`safety-${Date.now()}/`, folder)
await mkdir(runFolder)
await writeFile(new URL('manifest.json', runFolder), JSON.stringify(run, null, 2), { flag: 'wx' })
const tables = ['ob_inspection_buildings', 'ob_inspection_structure', 'ob_building_conditions',
  'inspection_interior_rooms', 'inspection_control_items', 'inspection_images', 'inspection_overview_selections']
async function rows(table, inspection = run.inspection, db = owner.db) {
  const result = await db.from(table).select('*').eq('inspection_id', inspection).order(table === 'ob_inspection_structure' ? 'inspection_id' : 'id')
  assert.equal(result.error, null, `${table}: ${result.error?.message}`)
  return result.data
}
async function snapshot(inspection) {
  const result = {}
  for (const table of tables) result[table] = await rows(table, inspection)
  return result
}
async function checked(request, label) {
  const result = await request
  assert.equal(result.error, null, `${label}: ${result.error?.message}`)
  return result.data
}
async function command(operation, payload, { inspection = run.inspection, actor = owner, status = 200 } = {}) {
  const response = await fetch(`${running.url}/api/ob/inspections/${inspection}/buildings`, {
    method: 'POST', headers: { ...actor.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, payload }), redirect: 'error',
  })
  const result = await response.json()
  assert.equal(response.status, status, `${operation}: ${JSON.stringify(result)}`)
  return result.data
}
async function overview(inspection = run.inspection, actor = owner, status = 200) {
  const response = await fetch(`${running.url}/api/ob/inspections/${inspection}/buildings`, { headers: actor.headers, redirect: 'error' })
  assert.equal(response.status, status)
  return (await response.json()).data
}
const insert = (table, partId, row) => command('row', { table, partId, row, operation: 'insert', id: randomUUID(), requestId: randomUUID() })
const update = (table, current, row, options) => command('row', { table, partId: current.building_part_id, id: current.id,
  operation: 'update', revision: current.ob_revision, row, requestId: randomUUID() }, options)
const round = (partId, operation, payload, options) => command('round', { partId, operation, ...payload }, options)
function pass(name) { run.checks.push(name); console.log(`PASS ${name}`) }
const initial = await snapshot(fixture.inspection)
await writeFile(new URL('original-fixture-before.json', runFolder), JSON.stringify(initial))

try {
  // A separate synthetic property keeps the existing user's click-test fixture intact.
  await checked(admin.from('properties').insert({ id: run.property, owner: fixture.owner.id,
    name: 'TEST - fyra byggnader, sakerhetsprov', address: 'Testgatan 4', city: 'Teststad' }), 'Property fixture')
  for (const id of [run.inspection, run.secondInspection]) {
    await checked(admin.from('inspections').insert({ id, property_id: run.property, type: 'OB', inspection_family: 'OB',
      date: '2026-09-13', inspector_name: 'OB Test owner', status: 'Utkast' }), 'Inspection fixture')
    const preview = await overview(id)
    await command('activate', { name: 'TEST Huvudbyggnad', buildingId: null, confirmed: true,
      activationToken: preview.activationToken, requestId: randomUUID() }, { inspection: id })
  }
  for (const [name, categoryKey] of [['TEST Garage', 'garage'], ['TEST Gasthus', 'guesthouse'], ['TEST Verkstad', 'complement']]) {
    await command('add', { name, categoryKey, buildingId: null, requestId: randomUUID() })
  }
  const state = await overview()
  assert.equal(state.parts.length, 4)
  const [main, garage, guest, studio] = state.parts
  const roomList = [], noteList = [], imageList = []
  const png = await readFile(new URL('../public/report-assets/mock-company-logo.png', import.meta.url))
  const pngHash = createHash('sha256').update(png).digest('hex')
  for (const [index, part] of state.parts.entries()) {
    const condition = (await rows('ob_building_conditions')).find(r => r.building_part_id === part.id)
    await update('ob_building_conditions', condition, { building_year: 1980 + index * 10 })
    const room = await insert('inspection_interior_rooms', part.id, { floor_label: 'plan0', room_type_key: 'hall', room_label: `TEST Hall ${index + 1}` })
    const note = await insert('inspection_control_items', part.id, { interior_room_id: room.id, title: `TEST Note ${index + 1}`, note: `TEST building ${index + 1}: unique note` })
    const imageId = randomUUID(), filePath = `${run.inspection}/round/safety/${imageId}.png`
    await checked(owner.db.storage.from('inspection-images').upload(filePath, png, { contentType: 'image/png', upsert: false }), 'Synthetic upload')
    const image = await command('row', { table: 'inspection_images', partId: part.id, id: imageId, requestId: randomUUID(), operation: 'insert', row: {
      file_path: filePath, label: `TEST image ${index + 1}`, interior_room_id: room.id, control_item_id: note.id, processing_status: 'linked',
      source_area: 'interior', origin_building_part_id: part.id, origin_interior_room_id: room.id,
      origin_floor_label: room.floor_label, origin_room_label: room.room_label, origin_room_type_key: room.room_type_key,
    } })
    roomList.push(room); noteList.push(note); imageList.push(image)
  }
  run.parts = state.parts.map(p => ({ id: p.id, name: p.name }))
  pass('Four independent buildings with distinct conditions, rooms, notes and real Storage uploads')
  const secondBefore = await snapshot(run.secondInspection)
  for (const [index, part] of state.parts.entries()) {
    const scoped = createBuildingDataClient(owner.db, run.inspection, part.id, command)
    const result = await scoped.client.from('inspection_control_items').select('*')
    assert.equal(result.error, null)
    assert.deepEqual(result.data.map(r => r.id), [noteList[index].id])
  }
  await update('inspection_control_items', noteList[0], { interior_room_id: roomList[1].id }, { status: 409 })
  await command('row', { table: 'inspection_control_items', partId: main.id, id: randomUUID(), requestId: randomUUID(),
    operation: 'insert', row: { note: 'forbidden' } }, { inspection: run.secondInspection, status: 409 })
  pass('Scoped reads isolate all four buildings; foreign-building and other-inspection references fail closed')

  const request = { kind: 'room', id: roomList[0].id, from: { floor: 'plan0' }, floor: 'plan0', targetBuildingPartId: garage.id, requestId: randomUUID() }
  const moved = await round(main.id, 'move', request)
  assert.equal(moved.room.building_part_id, garage.id)
  assert.deepEqual(await round(main.id, 'move', request), moved, 'Lost move response must replay without moving twice')
  for (const table of ['inspection_interior_rooms', 'inspection_control_items', 'inspection_images']) {
    const id = table === 'inspection_interior_rooms' ? roomList[0].id : table === 'inspection_control_items' ? noteList[0].id : imageList[0].id
    assert.equal((await rows(table)).find(r => r.id === id).building_part_id, garage.id)
  }
  const movedNote = (await rows('inspection_control_items')).find(r => r.id === noteList[0].id)
  const noteMove = { kind: 'note', id: movedNote.id, from: { roomId: movedNote.interior_room_id, observationId: null },
    target: { area: 'interior', roomId: roomList[2].id }, targetBuildingPartId: guest.id, requestId: randomUUID() }
  await round(garage.id, 'move', noteMove)
  await round(garage.id, 'move', { ...noteMove, requestId: randomUUID() }, { status: 409 })
  const relocated = (await rows('inspection_images')).find(r => r.id === imageList[0].id)
  assert.equal(relocated.building_part_id, guest.id)
  assert.equal(relocated.interior_room_id, roomList[2].id)
  assert.equal(relocated.origin_building_part_id, main.id)
  assert.equal(relocated.origin_interior_room_id, roomList[0].id)
  assert.equal(relocated.file_path, imageList[0].file_path)
  const imageUrl = owner.db.storage.from('inspection-images').getPublicUrl(relocated.file_path).data.publicUrl
  const downloaded = Buffer.from(await (await fetch(imageUrl)).arrayBuffer())
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), pngHash)
  pass('Room and note moves carry children across buildings, preserve image bytes/origin, and reject stale moves')

  const detached = await update('inspection_images', relocated, { control_item_id: null, processing_status: 'unprocessed' })
  const target = { area: 'interior', roomId: roomList[3].id }
  const preview = await round(guest.id, 'image-note-preview', { imageId: detached.id, target, targetBuildingPartId: studio.id })
  const createNote = { imageId: detached.id, target, targetBuildingPartId: studio.id, token: preview.token, requestId: randomUUID(),
    draft: { note: 'TEST image-first note in workshop', risk_text: '', ftu_text: '', outcomeId: null } }
  const created = await round(guest.id, 'image-note', createNote)
  const repeated = await round(guest.id, 'image-note', createNote)
  assert.equal(created.note.id, repeated.note.id)
  assert.equal(created.note.building_part_id, studio.id)
  assert.equal((await rows('inspection_control_items')).filter(r => r.note === createNote.draft.note).length, 1)
  assert.equal((await rows('inspection_images')).find(r => r.id === detached.id).control_item_id, created.note.id)
  pass('Image-first cross-building note creation is atomic and idempotent')

  // Fault injection exercises the actual client against real commands, not a mock database.
  const writes = []
  let mode = 'before-send'
  const scoped = createBuildingDataClient(owner.db, run.inspection, guest.id, async (operation, payload) => {
    writes.push(structuredClone(payload))
    if (mode === 'before-send') throw TypeError('TEST offline before send')
    const result = await command(operation, payload)
    if (mode === 'lost-response') throw TypeError('TEST server committed but response was lost')
    return result
  })
  const draft = { id: randomUUID(), inspection_id: run.inspection, interior_room_id: roomList[2].id, title: 'TEST recovery', note: 'TEST recovered after connection loss' }
  const save = () => scoped.client.from('inspection_control_items').insert(draft).select('*').single()
  assert.ok((await save()).error)
  assert.equal((await rows('inspection_control_items')).filter(r => r.id === draft.id).length, 0)
  mode = 'lost-response'
  assert.ok((await save()).error)
  assert.equal((await rows('inspection_control_items')).filter(r => r.id === draft.id).length, 1)
  mode = 'online'
  assert.equal((await save()).error, null)
  assert.deepEqual(writes[0], writes[1]); assert.deepEqual(writes[1], writes[2])
  const recovered = (await rows('inspection_control_items')).find(r => r.id === draft.id)
  assert.equal(recovered.note, draft.note)
  const newer = await update('inspection_control_items', recovered, { note: 'TEST newer text on another device' })
  const replay = await command('row', writes[0])
  assert.equal(replay.note, newer.note, 'Replay must return current data, not an old cached result')
  await update('inspection_control_items', recovered, { note: 'stale overwrite' }, { status: 409 })
  const batchBefore = await rows('inspection_interior_rooms')
  const freshRoom = batchBefore.find(r => r.id === roomList[1].id)
  await command('rows', { partId: garage.id, rows: [
    { table: 'inspection_interior_rooms', partId: garage.id, id: freshRoom.id, revision: freshRoom.ob_revision, requestId: randomUUID(), operation: 'update', row: { room_label: 'must roll back' } },
    { table: 'inspection_control_items', partId: garage.id, id: noteList[1].id, revision: 999999, requestId: randomUUID(), operation: 'update', row: { note: 'must fail' } },
  ] }, { status: 409 })
  assert.deepEqual(await rows('inspection_interior_rooms'), batchBefore)
  pass('Offline/lost-response retry saves exactly once; replay returns newer data; stale writes and partial batches are rejected')

  await overview(run.inspection, stranger, 403)
  for (const table of ['inspection_interior_rooms', 'inspection_control_items', 'inspection_images', 'ob_building_conditions']) {
    assert.equal((await rows(table, run.inspection, stranger.db)).length, 0)
  }
  await update('inspection_control_items', newer, { note: 'foreign write' }, { actor: stranger, status: 403 })
  assert.ok((await anon.from('inspection_control_items').select('id').eq('inspection_id', run.inspection)).error)
  assert.ok((await owner.db.from('inspection_control_items').update({ note: 'direct write' }).eq('id', newer.id)).error)
  assert.ok((await stranger.db.storage.from('inspection-images').upload(`${run.inspection}/round/safety/forbidden.png`, png)).error)
  const foreignDelete = await stranger.db.storage.from('inspection-images').remove([relocated.file_path])
  assert.equal(foreignDelete.error, null); assert.equal(foreignDelete.data.length, 0)
  pass('Real owner/stranger/anonymous identities enforce record and Storage write boundaries')

  // Revoked, terminal, unaddressable fixture: never create an active share link or PDF job.
  const currentState = await overview()
  const payload = { testOnly: true, reportData: { obBuildingRevision: currentState.structure.revision,
    buildings: (await rows('ob_inspection_buildings')).map(p => ({ id: p.id, name: p.name })), notes: await rows('inspection_control_items') } }
  const report = { id: randomUUID(), org_id: fixture.org, inspection_id: run.inspection,
    token_hash: randomBytes(32).toString('hex'), revoked_at: new Date().toISOString(), delivery_mode: 'link_only',
    pdf_status: 'failed', pdf_attempts: 3, pdf_max_attempts: 3, pdf_next_attempt_at: null,
    pdf_error: 'TEST ONLY - no PDF job or delivery', snapshot_schema_version: 'v1', created_by: fixture.owner.id }
  const stale = await admin.from('inspection_report_links').insert({ ...report, snapshot_payload: { reportData: { obBuildingRevision: currentState.structure.revision - 1 } } })
  assert.match(stale.error?.message ?? '', /OB_BUILDING_REPORT_STALE/)
  await checked(admin.from('inspection_report_links').insert({ ...report, snapshot_payload: payload }), 'Revoked snapshot fixture')
  run.revokedSnapshotId = report.id
  await update('inspection_control_items', newer, { note: 'TEST changed after frozen snapshot' })
  const frozen = await checked(admin.from('inspection_report_links').select('snapshot_payload').eq('id', report.id).single(), 'Frozen snapshot')
  assert.deepEqual(frozen.snapshot_payload, payload)
  const foreignSnapshot = await owner.db.from('inspection_report_links').update({ snapshot_payload: {} }).eq('id', report.id).select('id')
  assert.ok(foreignSnapshot.error || foreignSnapshot.data.length === 0)
  pass('Stale snapshot capture is rejected; revoked frozen snapshot remains unchanged by later live edits and browser writes')

  await checked(admin.from('inspections').update({ locked_at: new Date().toISOString(), locked_by: fixture.owner.id, status: 'completed' }).eq('id', run.inspection), 'Lock synthetic inspection')
  const lockedBefore = await snapshot(run.inspection)
  const lockedNote = lockedBefore.inspection_control_items.find(n => n.id === newer.id)
  await update('inspection_control_items', lockedNote, { note: 'must remain locked' }, { status: 409 })
  await command('add', { name: 'Forbidden after lock', categoryKey: 'garage', buildingId: null, requestId: randomUUID() }, { status: 409 })
  await round(guest.id, 'move', { kind: 'room', id: roomList[2].id, from: { floor: 'plan0' }, floor: 'plan0', targetBuildingPartId: main.id, requestId: randomUUID() }, { status: 409 })
  assert.ok((await owner.db.from('inspections').update({ inspector_name: 'forbidden' }).eq('id', run.inspection)).error)
  assert.deepEqual(await snapshot(run.inspection), lockedBefore)
  assert.deepEqual(await snapshot(run.secondInspection), secondBefore)
  pass('Locked building commands, room moves and direct root edits fail; the second inspection on the property is unchanged')
  assert.deepEqual(await snapshot(fixture.inspection), initial)
  pass('Original two-building click-test fixture remains byte-for-byte unchanged in audited tables')
  run.completed = true
} catch (error) {
  run.failure = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
  console.error(`FAIL ${run.failure}`)
} finally {
  run.finishedAt = new Date().toISOString()
  await writeFile(new URL('result.json', runFolder), JSON.stringify(run, null, 2))
  await writeFile(new URL('safety-latest.json', folder), JSON.stringify({ ...run, evidence: runFolder.href }, null, 2))
  console.log(JSON.stringify({ completed: run.completed, checks: run.checks.length, inspection: run.inspection, evidence: runFolder.href }))
}
