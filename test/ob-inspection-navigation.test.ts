import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires the explicit extension.
import { inspectionNavigationKey, restoreInspectionNavigation as restore } from '../src/lib/ob/inspectionNavigation.ts'

const sections = [
  { key: 'grunddata' }, { key: 'handlingar' },
  { key: 'forutsattningar', partId: 'main' }, { key: 'runda-ny', partId: 'main' },
  { key: 'forutsattningar', partId: 'guest' }, { key: 'runda-ny', partId: 'guest' },
  { key: 'review' }, { key: 'delivery' },
]
test('restores section and exact building, including after visiting a shared step', () => {
  for (const section of ['runda-ny', 'forutsattningar', 'handlingar', 'review']) {
    assert.deepEqual(restore(JSON.stringify({ section, partId: 'guest' }), sections, 'grunddata', 'main'), { section, partId: 'guest' })
  }
  assert.notEqual(inspectionNavigationKey('first'), inspectionNavigationKey('second'))
})
test('does not mount a wrong building editor for removed, foreign or malformed positions', () => {
  for (const raw of [null, 'bad json', '[]', '{}', '{"section":"arbitrary"}', '{"section":"runda-ny","partId":"foreign"}']) {
    assert.deepEqual(restore(raw, sections, 'grunddata', 'main'), { section: 'grunddata', partId: 'main' })
  }
})
test('round deep links and the retired alias resolve to the current round', () => {
  assert.deepEqual(restore(null, sections, 'grunddata', 'main', true), { section: 'runda-ny', partId: 'main' })
  assert.deepEqual(restore('{"section":"runda","partId":"guest"}', sections, 'grunddata', 'main'), { section: 'runda-ny', partId: 'guest' })
  assert.deepEqual(restore('{"section":"handlingar","partId":"guest"}', sections, 'grunddata', 'main', true), { section: 'runda-ny', partId: 'guest' })
})
test('legacy inspections remain usable without building parts or valid storage', () => {
  assert.deepEqual(restore('{"section":"runda-ny"}', [{ key: 'grunddata' }, { key: 'runda-ny' }], 'grunddata', null), { section: 'runda-ny', partId: null })
})
