import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { getConsumerWithdrawalDeadline, requiresConsumerEarlyStartConsent, resolveAssignmentCustomerType } from '../src/lib/assignments/consumer.ts'

test('resolves explicit TU customer type and treats legacy TU conservatively as consumer', () => {
  assert.equal(resolveAssignmentCustomerType('TU', { customerType: 'consumer' }), 'consumer')
  assert.equal(resolveAssignmentCustomerType('TU', { customerType: 'business' }), 'business')
  assert.equal(resolveAssignmentCustomerType('TU', {}), 'consumer')
  assert.equal(resolveAssignmentCustomerType('EB', {}), null)
})

test('calculates the ordinary withdrawal deadline from acceptance', () => {
  const deadline = getConsumerWithdrawalDeadline('2026-09-08T10:00:00+02:00')
  assert.ok(deadline)
  assert.equal(deadline.toISOString().slice(0, 10), '2026-09-22')

  const weekendDeadline = getConsumerWithdrawalDeadline('2026-09-12T10:00:00+02:00')
  assert.equal(weekendDeadline?.toISOString().slice(0, 10), '2026-09-28')
})

test('requires explicit early-start consent only for a valid date within 14 days', () => {
  const acceptedAt = new Date('2026-09-08T10:00:00+02:00')
  assert.equal(requiresConsumerEarlyStartConsent('2026-09-08', acceptedAt), true)
  assert.equal(requiresConsumerEarlyStartConsent('2026-09-22', acceptedAt), true)
  assert.equal(requiresConsumerEarlyStartConsent('2026-09-23', acceptedAt), false)
  assert.equal(requiresConsumerEarlyStartConsent('not-a-date', acceptedAt), false)
})
