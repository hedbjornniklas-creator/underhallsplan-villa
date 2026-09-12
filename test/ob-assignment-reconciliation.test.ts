import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner requires the explicit extension.
import { comparableObAssignmentValue, getObAssignmentTransferRows, getObAssignmentReconciliationPatches, isObAssignmentTransferFields } from '../src/lib/ob/assignmentWorkflow.ts'
import type { ObAssignmentWorkflow } from '../src/lib/ob/assignmentWorkflow'
// @ts-expect-error Node's strip-types runner requires the explicit extension.
import { ObGrunddataWriteError, recordObGrunddataWriteResult, trackObGrunddataWrite, waitForObGrunddataWrites } from '../src/lib/ob/grunddataWrites.ts'

function workflow(): ObAssignmentWorkflow {
  return { inspectionId: 'inspection', assignmentId: 'assignment', status: 'booked', startedAt: '2026-09-10',
    startReason: 'Tidigt besök', acceptedAt: '2026-09-12', bookedAt: '2026-09-12',
    initialSnapshot: { customer_name: 'Vid start' },
    currentSnapshot: { customer_name: 'Kundens nya namn', customer_phone: '0701234567', customer_email: 'customer@example.invalid', preferred_time: '10:00:00', property_city: null },
    inspectionSnapshot: { customer_name: 'Besiktningsmannens namn', customer_email: 'customer@example.invalid', customer_phone: null, preferred_time: '10:00', property_city: 'Stockholm' },
    reviewToken: 'review', reconciliationToken: 'current', needsReview: true, paused: false, canDeliver: false, reason: 'Stäm av' }
}

test('preselection fills blank fields only, compares live Grunddata rather than start snapshot', () => {
  const rows = getObAssignmentTransferRows(workflow())
  assert.deepEqual(rows.filter(row => row.preselected).map(row => row.key), ['customer_phone'])
  assert.equal(rows.find(row => row.key === 'customer_name')?.before, 'Besiktningsmannens namn')
  assert.equal(rows.find(row => row.key === 'customer_name')?.preselected, false)
  assert.equal(rows.find(row => row.key === 'property_city')?.canTransfer, false, 'blank customer field must not delete data')
  assert.equal(rows.find(row => row.key === 'preferred_time')?.differs, false)
  assert.deepEqual(getObAssignmentTransferRows({ ...workflow(), inspectionSnapshot: undefined }), [])
})

test('only explicitly transferable unique keys accepted, including a conscious keep-all-values choice', () => {
  for (const value of [null, undefined, 'customer_phone', [null], ['addons'], ['price_amount'], ['client_contact'], ['__proto__'], ['customer_phone', 'customer_phone']]) {
    assert.equal(isObAssignmentTransferFields(value), false)
  }
  assert.equal(isObAssignmentTransferFields([]), true)
  assert.equal(isObAssignmentTransferFields(['customer_phone', 'property_address']), true)
})

test('server result patches selected fields and aliases, never unrelated work or the entire page', () => {
  const updated = workflow()
  updated.inspectionSnapshot = { ...updated.inspectionSnapshot, customer_phone: '0701234567' }
  const patches = getObAssignmentReconciliationPatches({ workflow: updated, fields: ['customer_phone'] })
  assert.deepEqual(patches, { inspection: { customer_phone: '0701234567', client_contact: '0701234567 | customer@example.invalid' }, property: { customer_phone: '0701234567' } })
  assert.deepEqual(getObAssignmentReconciliationPatches({ workflow: updated, fields: [] }), { inspection: {}, property: {} })
  assert.deepEqual(getObAssignmentReconciliationPatches({ workflow: { ...updated, inspectionSnapshot: undefined }, fields: ['customer_phone'] }), { inspection: {}, property: {} })
})

test('property snapshot mapping, role and dates use saved values, not untrusted draft proposal', () => {
  const updated = workflow()
  updated.inspectionSnapshot = { property_address: 'Ny adress', orderer_role: 'seller', preferred_date: '2026-09-15', assignment_number: '2026-0915-02', customer_name: 'Sparat namn' }
  assert.deepEqual(getObAssignmentReconciliationPatches({ workflow: updated, fields: ['property_address', 'orderer_role', 'preferred_date', 'customer_name'] }), {
    property: { address: 'Ny adress', customer_name: 'Sparat namn' },
    inspection: { inspection_side: 'seller', date: '2026-09-15', assignment_number: '2026-0915-02', customer_name: 'Sparat namn', client_name: 'Sparat namn' },
  })
  assert.equal(comparableObAssignmentValue('orderer_role', 'Säljare'), 'seller')
  assert.equal(comparableObAssignmentValue('orderer_role', 'Lägenhetsköpare'), 'apartment')
  assert.equal(comparableObAssignmentValue('customer_email', ' A@EXAMPLE.INVALID '), 'a@example.invalid')
  assert.equal(comparableObAssignmentValue('preferred_time', '10:00'), '10:00')
  assert.equal(comparableObAssignmentValue('preferred_time', '10:00:00'), '10:00')
})

test('resolved-but-failed save blocks comparison until the affected fields are saved, not another field', async () => {
  const id = 'failed-save-inspection'
  await trackObGrunddataWrite(id, async () => {
    recordObGrunddataWriteResult(id, ['inspection:customer_name'], true)
    return null // Supabase errors are handled by the form rather than thrown.
  })
  await assert.rejects(waitForObGrunddataWrites(id), ObGrunddataWriteError)
  recordObGrunddataWriteResult(id, ['inspection:date'], false)
  await assert.rejects(waitForObGrunddataWrites(id), ObGrunddataWriteError)
  recordObGrunddataWriteResult(id, ['inspection:customer_name'], false)
  await waitForObGrunddataWrites(id)
})

test('comparison waits for delayed contact autosave and its UI callback before reading', async () => {
  const events: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const write = trackObGrunddataWrite('inspection', async () => {
    await gate
    events.push('saved')
    events.push('local-form-updated')
  })
  const compare = waitForObGrunddataWrites('inspection').then(() => events.push('compare'))
  await waitForObGrunddataWrites('other-inspection')
  assert.deepEqual(events, [])
  release()
  await Promise.all([write, compare])
  assert.deepEqual(events, ['saved', 'local-form-updated', 'compare'])
  await waitForObGrunddataWrites('inspection')
})
