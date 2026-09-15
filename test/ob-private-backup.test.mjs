import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { seal, unseal, readonlyUrl, objectReadPath } from '../scripts/lib/ob-private-backup.mjs'

test('private backup round-trips only with the correct key', () => {
  const key = randomBytes(32), bytes = Buffer.from('synthetic private backup')
  const encrypted = seal(bytes, key)
  assert.deepEqual(unseal(encrypted, key), bytes)
  assert.ok(!encrypted.includes(bytes))
  assert.throws(() => unseal(encrypted, randomBytes(32)))
  assert.notDeepEqual(encrypted, seal(bytes, key))
})
test('private backup rejects altered content, headers and truncation', () => {
  const key = randomBytes(32), encrypted = seal(Buffer.from('test'), key)
  for (const index of [0, 5, 17, encrypted.length - 1]) {
    const changed = Buffer.from(encrypted); changed[index] ^= 1
    assert.throws(() => unseal(changed, key))
  }
  assert.throws(() => unseal(encrypted.subarray(0, 25), key))
})
test('production reader rejects RPCs, external hosts and path escapes', () => {
  assert.equal(readonlyUrl('/rest/v1/inspections?select=id').hostname, 'rfresrbuekidumbwzpcm.supabase.co')
  for (const path of ['//evil.example/rest/v1/profiles', '/rest/v1/rpc/mutate', '/rest/v1/%72pc/mutate', '/rest/v1/table/../rpc/mutate', '/rest/v1/rpc', '/rest/v1/../../../auth/v1', '/auth/v1/admin/users', '/rest/v1/\\evil']) {
    assert.throws(() => readonlyUrl(path))
  }
})
test('storage object paths remain literal and traversal is rejected', () => {
  assert.equal(objectReadPath('inspection-images', 'test/photo 1.jpg'), '/storage/v1/object/inspection-images/test/photo%201.jpg')
  for (const path of ['../secret', 'a/../secret', '/leading', 'a\\b']) assert.throws(() => objectReadPath('inspection-images', path))
  assert.throws(() => objectReadPath('../bucket', 'photo.jpg'))
})
