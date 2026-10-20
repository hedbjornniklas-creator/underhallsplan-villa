import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native test runner needs the explicit TypeScript extension.
import { ebImageDisplayCaption, ebImageOriginLabel } from '../src/lib/eb/inspectionReuseDisplay.ts'

const reusedFrom = { variant: 'SLB', sequenceNo: 1, inspectionDate: '2026-09-03' }

test('ordinary photos do not get historical labels', () => {
  assert.equal(ebImageOriginLabel({ label: 'Vägg' }), null)
  assert.equal(ebImageDisplayCaption({ label: 'Vägg' }), 'Vägg')
})

test('previous image origin remains visible independently of edited or empty caption', () => {
  const origin = 'Bild från tidigare slutbesiktning 1 · 2026-09-03'
  assert.equal(ebImageOriginLabel({ reusedFrom, label: 'Ny bildtext' }), origin)
  assert.equal(ebImageOriginLabel({ reusedFrom, label: null }), origin)
  assert.equal(ebImageDisplayCaption({ reusedFrom, label: `${origin}\nSpricka vid dörr` }), 'Spricka vid dörr')
  assert.equal(ebImageDisplayCaption({ reusedFrom, label: origin }), null)
})

test('missing legacy date does not fabricate a capture date', () => {
  assert.equal(ebImageOriginLabel({ reusedFrom: { ...reusedFrom, inspectionDate: null } }), 'Bild från tidigare slutbesiktning 1')
})

test('unknown old source variant has a neutral label', () => {
  assert.equal(ebImageOriginLabel({ reusedFrom: { variant: 'legacy', sequenceNo: 0, inspectionDate: null } }), 'Bild från tidigare besiktning')
})
