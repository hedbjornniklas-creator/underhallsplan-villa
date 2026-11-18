import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Native Node TypeScript tests require the extension.
import { createGlobalSearchExecution } from '../src/lib/globalSearch/runtime.ts'

test('one execution limits concurrent work across providers', async () => {
  const execution = createGlobalSearchExecution(undefined, 1000, 3)
  let active = 0, peak = 0
  try {
    const values = await Promise.all(Array.from({ length: 12 }, (_, index) => execution.run(async () => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active--; return index
    })))
    assert.equal(values.length, 12)
    assert.equal(peak, 3)
  } finally { execution.dispose() }
})

test('parent abort interrupts active work and rejects queued work without starting it', async () => {
  const controller = new AbortController()
  const execution = createGlobalSearchExecution(controller.signal, 1000, 1)
  let started = 0
  const work = [execution.run(async () => { started++; await new Promise(resolve => setTimeout(resolve, 30)) }),
    execution.run(async () => { started++ })]
  await new Promise(resolve => setTimeout(resolve, 2))
  controller.abort()
  const outcomes = await Promise.allSettled(work)
  assert.equal(started, 1)
  assert.equal(outcomes.every(result => result.status === 'rejected' && result.reason.message === 'GLOBAL_SEARCH_ABORTED'), true)
  assert.throws(() => execution.check(), /GLOBAL_SEARCH_ABORTED/)
  execution.dispose()
})

test('deadline interrupts unresponsive work and distinguishes it from user cancellation', async () => {
  const execution = createGlobalSearchExecution(undefined, 5)
  try {
    await assert.rejects(execution.run(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }), /GLOBAL_SEARCH_TIMEOUT/)
    assert.equal(execution.signal.aborted, true)
  } finally { execution.dispose() }
})
