import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoundBackHistory, isObRoundBackManaged } from '../src/lib/ob/roundBackHistory.ts'

test('a building handoff consumes the shared Back boundary once and ignores retired owners', () => {
  const events = new EventTarget()
  const stack: unknown[] = [null]
  const pending: (() => void)[] = []
  const history = {
    get state() { return stack.at(-1) },
    pushState(state: unknown) { stack.push(state) },
    back() { pending.push(() => {
      stack.pop()
      events.dispatchEvent(Object.assign(new Event('popstate'), { state: history.state }))
    }) },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    history, location: { href: 'https://example.invalid/inspection' },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  } })
  let oldBacks = 0, newBacks = 0
  try {
    const oldRound = createRoundBackHistory('inspection', () => oldBacks++)
    oldRound.sync(true)
    assert.equal(stack.length, 2)
    const newRound = createRoundBackHistory('inspection', () => newBacks++)
    newRound.sync(false)
    oldRound.dispose()
    assert.equal(pending.length, 1, 'old cleanup must not issue a second browser Back')
    pending.shift()!()
    assert.equal(stack.length, 1)
    assert.equal(oldBacks, 0)
    newRound.sync(true)
    assert.equal(isObRoundBackManaged('inspection'), true)
    history.back()
    pending.shift()!()
    assert.equal(newBacks, 1)
    assert.equal(oldBacks, 0)
    assert.equal(stack.length, 2, 'Back restores the active local boundary')
    newRound.dispose()
    pending.shift()!()
    assert.equal(stack.length, 1)
    assert.equal(isObRoundBackManaged('inspection'), false)
    const departing = createRoundBackHistory('inspection', () => oldBacks++)
    departing.sync(true)
    departing.dispose()
    const arriving = createRoundBackHistory('inspection', () => newBacks++)
    arriving.sync(false)
    assert.equal(pending.length, 1, 'a new building waits for cleanup that already started')
    pending.shift()!()
    assert.equal(stack.length, 1)
    arriving.sync(true)
    assert.equal(stack.length, 2, 'the new round can add its own boundary after cleanup')
    arriving.dispose()
    pending.shift()!()
    assert.equal(stack.length, 1)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
