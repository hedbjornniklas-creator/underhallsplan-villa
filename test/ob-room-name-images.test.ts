import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error Native Node tests require the .ts extension.
import { renameRoundRoom } from '../src/lib/ob/renameRoundRoom.ts'
// @ts-expect-error Native Node tests require the .ts extension.
import { roundImageLocation } from '../src/lib/ob/roundImageLocation.ts'
import type { InspectionControlItem, InspectionExteriorObservation, RoundImage } from '../src/components/ob/ObStepRunda'

const room = { id: 'room-1', inspection_id: 'inspection-1', room_label: 'Badrum' as string | null, room_type_key: 'badrum', floor_label: 'plan2', order_index: 30, values: { floor: 'tile' }, note: 'Behåll' }
function fixture(initial: typeof room | null = room) {
  let current = initial ? { ...initial } : null
  let fail = false
  const requests: { method: string; url: URL; body: Record<string, unknown> | null }[] = []
  const client = createClient('https://synthetic.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({ url, method, body })
      assert.equal(url.pathname, '/rest/v1/inspection_interior_rooms')
      assert.ok(method === 'PATCH' || method === 'GET')
      if (fail) return Response.json({ message: 'Locked inspection' }, { status: 403 })
      const matches = current && ['inspection_id', 'id', 'room_label'].every(key => !url.searchParams.has(key) ||
        url.searchParams.get(key) === (current![key as keyof typeof room] === null ? 'is.null' : `eq.${current![key as keyof typeof room]}`))
      if (method === 'PATCH' && matches) current = { ...current!, ...body }
      return Response.json(method === 'PATCH' ? matches ? current : null : matches ? [current] : [])
    } },
  })
  return { client, requests, current: () => current, fail: () => { fail = true } }
}

test('rename patches only the expected name on the same inspection/room, preserving type, floor and values', async () => {
  const f = fixture()
  const updated = await renameRoundRoom(f.client, room.inspection_id, room.id, room.room_label, '  Badrum vid sovrum  ')
  assert.deepEqual(updated, { ...room, room_label: 'Badrum vid sovrum' })
  assert.deepEqual(f.requests[0].body, { room_label: 'Badrum vid sovrum' })
  for (const [key, value] of Object.entries({ inspection_id: room.inspection_id, id: room.id, room_label: room.room_label })) {
    assert.equal(f.requests[0].url.searchParams.get(key), `eq.${value}`)
  }
  assert.deepEqual(await renameRoundRoom(f.client, room.inspection_id, room.id, room.room_label, 'Badrum vid sovrum'), updated)
})

test('rename refuses stale names, removed/foreign rooms, invalid input and database lock failures', async () => {
  for (const row of [{ ...room, room_label: 'Nytt namn från annan enhet' }, { ...room, inspection_id: 'other' }, null]) {
    const f = fixture(row)
    await assert.rejects(renameRoundRoom(f.client, room.inspection_id, room.id, room.room_label, 'Namn'), /ändrats eller tagits bort/)
    assert.deepEqual(f.current(), row)
  }
  const f = fixture()
  for (const name of ['', '   ', 'x'.repeat(121)]) await assert.rejects(renameRoundRoom(f.client, room.inspection_id, room.id, room.room_label, name))
  assert.equal(f.requests.length, 0)
  f.fail()
  await assert.rejects(renameRoundRoom(f.client, room.inspection_id, room.id, room.room_label, 'Namn'), /Locked inspection/)
  assert.deepEqual(f.current(), room)
  const unnamed = fixture({ ...room, room_label: null })
  assert.equal((await renameRoundRoom(unnamed.client, room.inspection_id, room.id, null, 'Hall')).room_label, 'Hall')
})

test('image location follows linked/current placement, never displaying a moved picture at its old origin too', () => {
  const image = { id: 'image-1', interior_room_id: 'room-1', exterior_observation_id: null, origin_interior_room_id: 'old-room' } as RoundImage
  const observations = [{ id: 'obs-1', exterior_item_id: 'fasad' }] as InspectionExteriorObservation[]
  assert.deepEqual(roundImageLocation(image, [], observations), { roomId: 'room-1', exteriorItemId: null })
  assert.deepEqual(roundImageLocation({ ...image, interior_room_id: null, exterior_observation_id: 'obs-1' }, [], observations), { roomId: null, exteriorItemId: 'fasad' })
  const notes = [{ id: 'note-1', interior_room_id: 'room-2', exterior_observation_id: null }] as InspectionControlItem[]
  assert.deepEqual(roundImageLocation({ ...image, control_item_id: 'note-1' }, notes, observations), { roomId: 'room-2', exteriorItemId: null })
  assert.deepEqual(roundImageLocation({ ...image, interior_room_id: null }, [], observations), { roomId: 'old-room', exteriorItemId: null })
  assert.deepEqual(roundImageLocation({ id: 'unplaced' } as RoundImage, [], [{ exterior_item_id: 'fasad' }] as InspectionExteriorObservation[]), { roomId: null, exteriorItemId: null })
  assert.deepEqual(roundImageLocation({ ...image, interior_room_id: null, exterior_observation_id: 'missing' }, [], observations), { roomId: null, exteriorItemId: null })
})

test('production rename blocks drafts/uploads and does not rewrite image origins or reports', () => {
  const source = readFileSync('src/components/ob/ObStepRunda.tsx', 'utf8')
  const rename = source.slice(source.indexOf('async function renameRoomLabel'), source.indexOf('const deleteControlItem'))
  assert.ok(rename.includes('hasObTextDraftsForInspection(inspection.id)'))
  assert.ok(rename.includes('listRoundImageUploadItems(inspection.id)'))
  assert.ok(rename.includes('roundMutationRef.current = true'))
  assert.ok(rename.includes('renameRoundRoom(supabase, inspection.id, room.id, room.room_label ?? null, name)'))
  assert.ok(!rename.includes('setImages('))
})
