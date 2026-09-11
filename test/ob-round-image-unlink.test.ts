import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error Native Node tests require the .ts extension.
import { unlinkRoundImage } from '../src/lib/ob/unlinkRoundImage.ts'

const before = {
  id: 'image-1', inspection_id: 'inspection-1', control_item_id: 'note-1',
  interior_room_id: 'room-1', origin_interior_room_id: 'room-2',
  file_path: 'kept/photo.jpg', label: 'Bild', processing_status: 'linked',
}
function fixture(row: typeof before | null = before) {
  let current: Record<string, unknown> | null = row ? { ...row } : null
  const requests: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = []
  let fail = false
  const client = createClient('https://synthetic.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), method = init?.method || 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({ url, method, body })
      assert.equal(url.pathname, '/rest/v1/inspection_images')
      if (fail) return Response.json({ message: 'Locked inspection' }, { status: 403 })
      const matches = current && ['inspection_id', 'id', 'control_item_id'].every(key =>
        !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${current?.[key]}`)
      if (method === 'PATCH' && matches) current = { ...current, ...body }
      else assert.ok(method === 'PATCH' || method === 'GET')
      return Response.json(method === 'PATCH' ? matches ? current : null : matches ? [current] : [])
    } },
  })
  return { client, requests, current: () => current, fail: (value: boolean) => { fail = value } }
}

test('unlink updates only the relationship/status; files, placement and capture origin survive', async () => {
  const f = fixture()
  const result = await unlinkRoundImage(f.client, before.inspection_id, before.id, before.control_item_id)
  assert.deepEqual(result, { ...before, control_item_id: null, processing_status: 'unprocessed', ignored_at: null })
  assert.deepEqual(f.requests.map(request => request.method), ['PATCH'])
  assert.deepEqual(f.requests[0].body, { control_item_id: null, processing_status: 'unprocessed', ignored_at: null })
  for (const [key, value] of Object.entries({ inspection_id: 'inspection-1', id: 'image-1', control_item_id: 'note-1' })) {
    assert.equal(f.requests[0].url.searchParams.get(key), `eq.${value}`)
  }
})

test('a changed note, foreign inspection or missing image is not detached', async () => {
  for (const row of [{ ...before, control_item_id: 'other-note' }, { ...before, inspection_id: 'other-inspection' }, null]) {
    const f = fixture(row)
    await assert.rejects(unlinkRoundImage(f.client, 'inspection-1', 'image-1', 'note-1'), /koppling har ändrats/)
    assert.deepEqual(f.current(), row)
  }
})

test('retry after a lost response accepts an already detached image, without deleting anything', async () => {
  const f = fixture()
  const first = await unlinkRoundImage(f.client, 'inspection-1', 'image-1', 'note-1')
  const retry = await unlinkRoundImage(f.client, 'inspection-1', 'image-1', 'note-1')
  assert.deepEqual(retry, first)
  assert.deepEqual(f.requests.map(request => request.method), ['PATCH', 'PATCH', 'GET'])
})

test('server rejection preserves the image and missing identifiers never issue a request', async () => {
  const f = fixture()
  f.fail(true)
  await assert.rejects(unlinkRoundImage(f.client, 'inspection-1', 'image-1', 'note-1'), /Locked inspection/)
  assert.deepEqual(f.current(), before)
  f.requests.length = 0
  await assert.rejects(unlinkRoundImage(f.client, 'inspection-1', 'image-1', ''), /saknas/)
  assert.equal(f.requests.length, 0)
})

test('the editor flushes text before offering image removal choices', () => {
  const source = readFileSync('src/components/ob/ObMobileRound.tsx', 'utf8')
  assert.match(source, /finish\(\(\) => \{\s*setImageNotice\(''\)\s*setImageActionsId\(image.id\)/)
  assert.ok(source.includes('onDelete={() => onDeleteImage(imageActions)}'))
})
