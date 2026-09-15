import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner requires explicit TypeScript imports.
import { putRoundImageUploadItem, deleteRoundImageUploadItem, type RoundImageUploadItem } from '../src/lib/ob/roundImageUploadQueue.ts'

// Model the distinction between a successful IDB request and a committed transaction.
function idbTransaction() {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  let closed = false
  const request = { result: 'image', error: null as DOMException | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
  const transaction = { error: null as DOMException | null, oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null, onerror: null as (() => void) | null,
    objectStore: () => ({ put: () => request, delete: () => request }) }
  const db = { transaction: () => transaction, close: () => { closed = true } }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open: () => {
      const opening = { result: db, onsuccess: null as (() => void) | null }
      queueMicrotask(() => opening.onsuccess?.())
      return opening
    },
  } })
  return { request, transaction, closed: () => closed, restore: () => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  } }
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve))

for (const [name, operation] of [
  ['enqueue', () => putRoundImageUploadItem({ id: 'image' } as RoundImageUploadItem)],
  ['dequeue', () => deleteRoundImageUploadItem('image')],
] as const) {
  test(`${name} is not acknowledged until the IndexedDB transaction commits`, async () => {
    const fake = idbTransaction()
    try {
      let settled = false
      const pending = operation().then(() => { settled = true })
      await turn()
      fake.request.onsuccess?.()
      await turn()
      assert.equal(settled, false, 'Request success is not durable transaction success')
      assert.equal(fake.closed(), false)
      fake.transaction.oncomplete?.()
      await pending
      assert.equal(settled, true)
      assert.equal(fake.closed(), true)
    } finally { fake.restore() }
  })

  test(`${name} reports an abort even when its request already succeeded`, async () => {
    const fake = idbTransaction()
    try {
      const pending = operation().then(() => null, error => error)
      await turn()
      fake.request.onsuccess?.()
      await turn()
      const error = new DOMException('TEST disk transaction aborted', 'AbortError')
      fake.transaction.error = error
      fake.transaction.onabort?.()
      assert.equal(await pending, error)
      assert.equal(fake.closed(), true)
    } finally { fake.restore() }
  })
}
