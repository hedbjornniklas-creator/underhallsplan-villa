import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(storage = new Map()) {
  const states = [], refs = [], requests = [], saved = []
  let stateIndex = 0, refIndex = 0, hook, tail = Promise.resolve(), brokenStorage = false
  const original = globalThis.localStorage
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem(key, value) { if (brokenStorage) throw Error('Storage disabled'); storage.set(key, value) }, removeItem(key) { if (brokenStorage) throw Error('Storage disabled'); storage.delete(key) } }
  const react = {
    useState(value) { const index = stateIndex++; if (index >= states.length) states[index] = typeof value === 'function' ? value() : value; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }] },
    useRef(value) { return refs[refIndex++] ??= { current: value } }, useEffect() {},
  }
  const module = { exports: {} }
  const source = ts.transpileModule(readFileSync(new URL('../src/components/tasks/useQuestionAutosave.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', source)(name => name === 'react' ? react : { useAutosaveQueue: ({ save }) => ({ enqueue: () => { const job = tail.then(() => save(true)); tail = job.catch(() => undefined); return job } }) }, module, module.exports)
  const render = () => { stateIndex = 0; refIndex = 0; hook = module.exports.useQuestionAutosave({ valid: value => Boolean(value.text.trim()), save: attempt => new Promise((resolve, reject) => requests.push({ ...attempt, resolve, reject })), onSaved: (value, revision) => saved.push({ value, revision }) }); return hook }
  render()
  return { storage, requests, saved, render, get hook() { return hook },
    async settle(index, error) { if (error) requests[index].reject(Error(error)); else requests[index].resolve(); await tick(); render() },
    breakStorage() { brokenStorage = true },
    dispose() { globalThis.localStorage = original },
  }
}

test('autosave serializes edits, keeps newer typing and advances the revision without touching explicit commands', async () => {
  const h = harness()
  try {
    h.hook.seed('question', { text: 'Original' }, 3)
    h.hook.change({ text: 'Första ändringen' }); const done = h.hook.flush(); await tick(); h.render()
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].revision, 3)
    h.hook.change({ text: 'Nyare ändring' }); h.render()
    assert.equal(h.requests.length, 1)
    await h.settle(0)
    assert.equal(h.requests.length, 2); assert.equal(h.requests[1].revision, 4)
    assert.equal(h.requests[1].value.text, 'Nyare ändring')
    assert.notEqual(h.requests[0].requestId, h.requests[1].requestId)
    await h.settle(1); assert.equal(await done, true)
    assert.equal(h.hook.revision(), 5); assert.equal(h.hook.dirty, false)
    assert.equal(h.storage.has('question'), false)
    assert.deepEqual(h.saved.map(s => s.revision), [4, 5])
  } finally { h.dispose() }
})

test('an uncertain save is retried exactly before newer edits and survives reopening', async () => {
  const h = harness()
  try {
    h.hook.seed('question', { text: 'Original' }, 1); h.hook.change({ text: 'Sparas' })
    const first = h.hook.flush(); await tick(); const original = h.requests[0]
    await h.settle(0, 'Nätverksfel'); assert.equal(await first, false)
    h.hook.change({ text: 'Nyare text' }); h.render()
    const local = JSON.parse(h.storage.get('question'))
    assert.equal(local.pending.requestId, original.requestId)
    const retry = h.hook.retry(); await tick()
    assert.equal(h.requests[1].requestId, original.requestId)
    assert.deepEqual(h.requests[1].value, original.value)
    await h.settle(1)
    assert.equal(h.requests[2].value.text, 'Nyare text'); assert.equal(h.requests[2].revision, 2)
    await h.settle(2); assert.equal(await retry, true)
    const restored = h.hook.seed('question', { text: 'Nyare text' }, 3)
    assert.equal(restored.text, 'Nyare text'); await h.hook.flush()
  } finally { h.dispose() }
})

test('incomplete drafts are kept locally, and a stale local draft cannot autosave over a newer server revision', async () => {
  const h = harness()
  try {
    h.hook.seed('question', { text: 'Original' }, 2); h.hook.change({ text: '' })
    assert.equal(await h.hook.flush(), false); assert.equal(h.requests.length, 0)
    assert.equal(h.hook.seed('question', { text: 'Ny servertext' }, 4).text, '')
    h.render(); assert.match(h.hook.error, /äldre version/)
    await h.hook.flush(); assert.equal(h.requests.length, 0)
    assert.equal(h.hook.seed('question', { text: 'Ny servertext' }, 4, true).text, 'Ny servertext')
    assert.equal(await h.hook.flush(), true)
  } finally { h.dispose() }
})

test('a local pending request is replayed after reload even when its first commit is already visible', async () => {
  const storage = new Map([['question', JSON.stringify({ value: { text: 'Text' }, saved: { text: 'Original' }, revision: 7, pending: { value: { text: 'Text' }, revision: 7, requestId: '00000000-0000-4000-8000-000000000001' } })]])
  const h = harness(storage)
  try {
    h.hook.seed('question', { text: 'Text' }, 8); const flushed = h.hook.flush(); await tick()
    assert.equal(h.requests[0].revision, 7)
    assert.equal(h.requests[0].requestId, '00000000-0000-4000-8000-000000000001')
    await h.settle(0); assert.equal(await flushed, true)
    assert.equal(h.hook.revision(), 8); assert.equal(h.requests.length, 1)
  } finally { h.dispose() }
})

test('disabled local storage is not reported as a safely retained draft', async () => {
  const h = harness()
  try {
    h.hook.seed('question', { text: 'Original' }, 0); h.breakStorage(); h.hook.change({ text: '' }); h.render()
    assert.equal(h.hook.isLocal(), false); assert.equal(h.hook.local, false)
    await h.hook.flush(); assert.equal(h.requests.length, 0)
  } finally { h.dispose() }
})

test('a confirmed server save can be closed even if local draft cleanup is blocked', async () => {
  const h = harness()
  try {
    h.hook.seed('question', { text: 'Original' }, 1); h.breakStorage(); h.hook.change({ text: 'Sparad på servern' })
    const done = h.hook.flush(); await tick(); await h.settle(0)
    assert.equal(await done, true); assert.equal(h.hook.dirty, false); assert.equal(h.hook.isLocal(), true)
    assert.equal(h.hook.seed('other-question', { text: 'Nästa fråga' }, 1).text, 'Nästa fråga')
    assert.equal(await h.hook.flush(), true)
  } finally { h.dispose() }
})
