import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires an explicit source extension.
import { MoistureError, getMoistureError, parseMoistureId, parseMoistureProjectInput, parseMoistureProjectUpdate } from '../src/lib/moisture/domain.ts'

const id = '11111111-1111-4111-8111-111111111111'
const create = () => ({ projectId: id, title: 'Fuktinventering', description: null, scopes: ['inventory'], pricingMode: 'undecided', customerId: null,
  property: { mode: 'new', name: 'Testfastighet', address: null, cadastralId: null, municipality: null, postalCode: null, city: null }, buildingIds: [], newBuildings: [] })

test('normalizes supported input while preserving unknown property data as null', () => {
  const value = parseMoistureProjectInput({ ...create(), title: '  Fuktsäkerhet  ', description: ' ', scopes: ['design', 'inventory', 'design'], newBuildings: [' Hus A '] })
  assert.equal(value.title, 'Fuktsäkerhet')
  assert.equal(value.description, null)
  assert.deepEqual(value.scopes, ['inventory', 'design'])
  assert.deepEqual(value.newBuildings, ['Hus A'])
  assert.deepEqual(value.property, create().property)
  assert.equal(parseMoistureId(id.toUpperCase()), id)
})

test('draft can omit customer, cadastral designation and buildings, but needs a scope and named property', () => {
  assert.equal(parseMoistureProjectInput(create()).customerId, null)
  for (const input of [{ ...create(), scopes: [] }, { ...create(), title: ' ' }, { ...create(), property: { mode: 'new', name: '' } }]) {
    assert.throws(() => parseMoistureProjectInput(input), (error: unknown) => getMoistureError(error).status === 400)
  }
})

test('rejects malformed types, invalid IDs, excessive fields and privilege/immutability overrides', () => {
  for (const input of [null, [], 'text', { ...create(), customerId: 'foreign' }, { ...create(), title: 7 }, { ...create(), pricingMode: 'free' },
    { ...create(), scopes: ['unknown'] }, { ...create(), property: { mode: 'new', name: 'X', owner: id } }, { ...create(), orgId: id },
    { ...create(), status: 'active' }, { ...create(), newBuildings: [''] }, { ...create(), buildingIds: null },
    { ...create(), description: 'x'.repeat(5001) }, { ...create(), newBuildings: Array(51).fill('Hus') }]) {
    assert.throws(() => parseMoistureProjectInput(input), /MOISTURE_INVALID_INPUT/)
  }
})

test('new property cannot select old buildings; existing building IDs are normalized without duplicates', () => {
  assert.throws(() => parseMoistureProjectInput({ ...create(), buildingIds: [id] }), /MOISTURE_INVALID_INPUT/)
  const value = parseMoistureProjectInput({ ...create(), property: { mode: 'existing', id }, buildingIds: [id, id] })
  assert.deepEqual(value.buildingIds, [id])
})

test('update requires an integer revision and never accepts a changed property, status or project ID', () => {
  const { projectId, property, ...fields } = create()
  void projectId; void property
  assert.equal(parseMoistureProjectUpdate({ ...fields, revision: 2 }).revision, 2)
  for (const revision of [undefined, null, 0, -1, 1.5, '1', Infinity, 2147483647]) {
    assert.throws(() => parseMoistureProjectUpdate({ ...fields, revision }), /MOISTURE_INVALID_INPUT/)
  }
  for (const extra of [{ property: { mode: 'existing', id } }, { projectId: id }, { status: 'archived' }]) {
    assert.throws(() => parseMoistureProjectUpdate({ ...fields, revision: 1, ...extra }), /MOISTURE_INVALID_INPUT/)
  }
})

test('errors expose safe Swedish messages and field feedback without database details', () => {
  const fieldError = new MoistureError('MOISTURE_INVALID_INPUT', { title: 'Fyll i fältet.' })
  assert.deepEqual(getMoistureError(fieldError).fieldErrors, { title: 'Fyll i fältet.' })
  assert.equal(getMoistureError(new Error('MOISTURE_CONFLICT')).status, 409)
  assert.equal(getMoistureError(new Error('MOISTURE_SCHEMA_REQUIRED')).status, 503)
  assert.ok(getMoistureError(new Error('MOISTURE_CUSTOMER_INVALID')).fieldErrors?.customerId)
  for (const error of [new Error('secret password SQL connection string'), { message: 'secret' }, 'secret']) {
    const result = getMoistureError(error)
    assert.equal(result.status, 500)
    assert.doesNotMatch(JSON.stringify(result), /secret|password|SQL/)
  }
})
