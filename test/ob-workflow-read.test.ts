import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires the explicit extension.
import { OB_WORKFLOW_CONNECTION_ERROR, startObWorkflowRead } from '../src/lib/ob/workflowRead.ts'

test('bounded reads return success and propagate a failed response', async () => {
  assert.equal(await startObWorkflowRead(async () => 42).promise, 42)
  await assert.rejects(startObWorkflowRead(async () => { throw Error('failed') }).promise, /failed/)
})
test('a hung read or save barrier cannot keep refresh controls pending forever', async () => {
  let signal: AbortSignal | undefined
  const request = startObWorkflowRead(async input => { signal = input; return new Promise(() => {}) }, 10)
  await assert.rejects(request.promise, { message: OB_WORKFLOW_CONNECTION_ERROR })
  assert.equal(signal?.aborted, true)
})
test('cleanup cancels reads even when the underlying request ignores abort', async () => {
  let resolve!: (value: number) => void
  const request = startObWorkflowRead(async () => new Promise<number>(done => { resolve = done }))
  await Promise.resolve()
  request.cancel()
  await assert.rejects(request.promise, { message: OB_WORKFLOW_CONNECTION_ERROR })
  resolve(1)
  assert.equal(await startObWorkflowRead(async () => 2).promise, 2)
})
