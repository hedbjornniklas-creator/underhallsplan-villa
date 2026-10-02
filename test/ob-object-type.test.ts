import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires the explicit extension.
import { parseObObjectType, resolveObObjectType } from '../src/lib/ob/objectType.ts'

test('status object identity is independent of its status terms/profile', () => {
  assert.equal(resolveObObjectType('status', 'apartment'), 'apartment')
  assert.equal(resolveObObjectType('status', 'property'), 'property')
})

test('legacy status defaults to property without interpreting arbitrary descriptions', () => {
  for (const value of [undefined, null, '', 'villa', 'Badrum i lägenhet', {}, 1]) {
    assert.equal(parseObObjectType(value), null)
    assert.equal(resolveObObjectType('status', value), 'property')
  }
})

test('existing OB profiles are unchanged by stored status object markers', () => {
  for (const value of ['property', 'apartment', undefined]) {
    assert.equal(resolveObObjectType('apartment', value), 'apartment')
    assert.equal(resolveObObjectType('buyer', value), 'property')
    assert.equal(resolveObObjectType('seller', value), 'property')
  }
  assert.equal(resolveObObjectType(null, 'apartment'), 'property')
})
