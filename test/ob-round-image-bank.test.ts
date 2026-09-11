import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bank = readFileSync('src/components/ob/ObRoundImageBank.tsx', 'utf8')
const editor = readFileSync('src/components/ob/ObMobileRound.tsx', 'utf8')
const controller = readFileSync('src/components/ob/ObStepRunda.tsx', 'utf8')

test('image bank uses unhandled, uploaded images and recomputes selected rows for retries', () => {
  assert.ok(bank.includes("!image.control_item_id && image.processing_status !== 'ignored'"))
  assert.ok(bank.includes('images.filter(image => !image.local_queue_id)'))
  assert.ok(bank.includes('available.filter(image => selectedIds.has(image.id))'))
  assert.ok(bank.includes('p.onLinkImages(selected, note)'))
})

test('entering the bank flushes text and does not discard the editor state', () => {
  assert.ok(editor.includes('finish(() => setImageBankOpen(true))'))
  assert.ok(editor.includes('onClose={() => setImageBankOpen(false)}'))
  assert.ok(editor.includes('p.onCamera(note.id!)'))
  assert.ok(editor.includes('p.onGallery(note.id!)'))
})

test('production batch link is inspection scoped and cannot replace another note link', () => {
  const start = controller.indexOf('const linkSelectedImagesToControlItem = async')
  const link = controller.slice(start, controller.indexOf('const unlinkImageFromControlItem', start))
  assert.ok(link.includes(".eq('inspection_id', inspection.id)"))
  assert.ok(link.includes("query.is('control_item_id', null)"))
  assert.ok(link.includes(".or('processing_status.is.null,processing_status.neq.ignored')"))
  assert.ok(controller.includes('linkSelectedImagesToControlItem(note.id, images, true)'))
  assert.ok(link.indexOf('setImages(prev =>') < link.indexOf('updated.length !== serverImageIds.length'))
})
