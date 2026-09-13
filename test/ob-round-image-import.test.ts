import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const path = '../src/lib/ob/roundImageImport.ts'
const { queueImageBatch, unplacedImagePlacement } = await import(path) as typeof import('../src/lib/ob/roundImageImport')

test('unplaced imports have no inherited room, exterior item, note or capture origin', () => {
  const placement = unplacedImagePlacement()
  assert.equal(placement.sourceArea, null)
  assert.ok(Object.values(placement.origin).every(value => value === null))
  assert.deepEqual(placement.link, {
    control_item_id: null, interior_room_id: null, exterior_observation_id: null,
    processing_status: 'unprocessed', ignored_at: null,
  })
  assert.notEqual(unplacedImagePlacement().origin, placement.origin)
})

test('every selected file is queued in order; a failed file does not discard later files', async () => {
  const files = ['first.jpg', 'failed.heic', 'last.png'].map(name => new File(['test'], name))
  const saved: string[] = []
  await assert.rejects(queueImageBatch(files, async (file, index) => {
    assert.equal(files[index], file)
    if (index === 1) throw Error('disk full')
    saved.push(file.name)
  }), /2 av 3 bilder sparades lokalt.*failed.heic/)
  assert.deepEqual(saved, ['first.jpg','last.png'])
  let count = 0
  await queueImageBatch([], async () => { count++ })
  assert.equal(count, 0)
  await queueImageBatch(files, async () => { count++ })
  assert.equal(count, 3)
})

test('production uses the durable upload queue with an explicit unplaced batch context', () => {
  const source = readFileSync(new URL('../src/components/ob/ObStepRunda.tsx', import.meta.url), 'utf8')
  assert.match(source, /onImportImages=\{async files =>/)
  assert.match(source, /queueImageBatch\(files, \(file, index\) => uploadImage\(file, file.name, null/)
  assert.match(source, /unplaced: true, throwOnError: true, sortOrder: maxSort \+ \(index \+ 1\) \* 10/)
  assert.match(source, /options.unplaced \? unplacedImagePlacement\(\) : null/)
  assert.match(source, /unplaced\?\.origin \?\? await \(captureContextRef.current\?\.origin \?\? getCaptureOrigin\)\(\)/)
  assert.match(source, /captureContextRef.current = \{ origin: getCaptureOrigin, area, partId \}/)
  assert.match(source, /await putRoundImageUploadItem\(item\)/)
})
