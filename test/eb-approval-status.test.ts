import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { EB_APPROVAL_STATUS_VALUES, ebApprovalDecisionHeading, ebApprovalStatusLabel, ebApprovalStatusUsesObstacleExplanation, isEbLegacyPartlyApprovedStatus, normalizeEbApprovalStatus, toEbApprovalStatusStorageValue } from '../src/lib/eb/approvalStatus.ts'

test('uses exactly the three selected EB decisions', () => {
  assert.deepEqual([...EB_APPROVAL_STATUS_VALUES], [
    'approved',
    'not_approved',
    'interrupted',
  ])
  assert.equal(ebApprovalStatusLabel('approved'), 'Godkänd')
  assert.equal(ebApprovalStatusLabel('not_approved'), 'Ej godkänd')
  assert.equal(normalizeEbApprovalStatus('interrupted'), 'interrupted')
  assert.equal(ebApprovalStatusLabel('interrupted'), 'Avbruten')
  assert.equal(ebApprovalDecisionHeading('interrupted'), 'Besiktningen avbryts')
  assert.equal(ebApprovalStatusUsesObstacleExplanation('interrupted'), false)
})

test('writes interrupted as the persisted EB decision', () => {
  assert.equal(toEbApprovalStatusStorageValue('interrupted'), 'interrupted')
})

test('rejects unknown EB decisions', () => {
  assert.equal(normalizeEbApprovalStatus('partly-approved'), null)
  assert.equal(normalizeEbApprovalStatus('partly_approved'), null)
  assert.equal(normalizeEbApprovalStatus(null), null)
})

test('recognizes the retired decision only for immutable historical snapshots', () => {
  assert.equal(isEbLegacyPartlyApprovedStatus('partly_approved'), true)
  assert.equal(isEbLegacyPartlyApprovedStatus('interrupted'), false)
  assert.equal(ebApprovalDecisionHeading('partly_approved'), 'Arbetena godkänns delvis')
  assert.equal(ebApprovalStatusUsesObstacleExplanation('partly_approved'), true)
})
