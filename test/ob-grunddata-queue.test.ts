import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires the explicit extension.
import { enqueueObGrunddataWrite, waitForObGrunddataWrites } from '../src/lib/ob/grunddataWrites.ts'

test('queued saves preserve edit order and the comparison barrier includes queued work', async () => {
  const events: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const first = enqueueObGrunddataWrite('queued-inspection', async () => { events.push('first-start'); await gate; events.push('first-end') })
  const second = enqueueObGrunddataWrite('queued-inspection', async () => { events.push('second') })
  const wait = waitForObGrunddataWrites('queued-inspection').then(() => events.push('comparison'))
  await enqueueObGrunddataWrite('other-inspection', async () => { events.push('other') })
  assert.deepEqual(events, ['first-start', 'other'])
  release()
  await Promise.all([first, second, wait])
  assert.deepEqual(events, ['first-start', 'other', 'first-end', 'second', 'comparison'])
})

test('a failed write does not poison subsequent saves for the same inspection', async () => {
  const first = enqueueObGrunddataWrite('failed-queue', async () => { throw Error('offline') })
  const recovered = enqueueObGrunddataWrite('failed-queue', async () => 'saved')
  await assert.rejects(first, /offline/)
  assert.equal(await recovered, 'saved')
  await waitForObGrunddataWrites('failed-queue')
})
