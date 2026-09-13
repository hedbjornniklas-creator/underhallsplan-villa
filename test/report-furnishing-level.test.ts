import test from 'node:test'
import assert from 'node:assert/strict'
import { formatFurnishingLevel } from '../src/lib/report/furnishingLevel.ts'

test('report formats stored furnishing codes without exposing database keys', () => {
  assert.equal(formatFurnishingLevel('fullt_moblerad'), 'fullt m\u00f6blerad')
  assert.equal(formatFurnishingLevel('delvis_moblerad'), 'delvis m\u00f6blerad')
  assert.equal(formatFurnishingLevel('omoblerad'), 'om\u00f6blerad')
})

test('report preserves already-readable legacy text and unknown values', () => {
  for (const value of ['', 'saknas', '--', 'delvis m\u00f6blerad', 'Egen beskrivning']) {
    assert.equal(formatFurnishingLevel(value), value)
  }
})
