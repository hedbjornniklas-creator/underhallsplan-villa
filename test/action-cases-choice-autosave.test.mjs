import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function harness() {
  const slots = [], timers = new Map(), requests = [], saved = [], errors = [], cleanups = []
  const react = {
    useRef: value => ({ current: value }), useCallback: fn => fn,
    useState(initial) { const slot = { value: initial }; slots.push(slot); return [initial, next => { slot.value = typeof next === 'function' ? next(slot.value) : next }] },
    useEffect(effect) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
  }
  function load(path, dependencies) {
    const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const mod = { exports: {} }
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(name => { if (name === 'react') return react; if (name in dependencies) return dependencies[name]; throw Error(name) }, mod, mod.exports,
      fn => { const key = Symbol(); timers.set(key, fn); return key }, key => timers.delete(key))
    return mod.exports
  }
  const queue = load('src/hooks/useAutosaveQueue.ts', {})
  const { useCustomerPlanningAutosave } = load('src/components/tasks/useCustomerPlanningAutosave.ts', { '@/hooks/useAutosaveQueue': queue })
  const api = useCustomerPlanningAutosave({ initialRevision: 4,
    save: (snapshot, revision) => new Promise((resolve, reject) => requests.push({ snapshot, revision, resolve, reject })),
    onSaved: (result, snapshot) => saved.push({ result, snapshot }), onError: error => errors.push(error) })
  return { api, requests, saved, errors, state: () => slots[0].value,
    timers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()) },
    async reply(index, error, revision) { const request = requests[index]; if (error) request.reject(Error(error)); else request.resolve({ revision: revision ?? request.revision + 1, ...request.snapshot }); await new Promise(resolve => setImmediate(resolve)) },
    dispose: () => cleanups.reverse().forEach(fn => fn()) }
}
const snapshot = title => ({ items: [{ id: 'option', title }], categories: [{ id: 'category', title: 'Fönster', optionIds: ['option'] }], costing: {}, optionFiles: [] })

test('opening choices never saves or converts categories; typing coalesces into one independent save', async () => {
  const h = harness()
  assert.equal(h.requests.length, 0)
  h.api.change(snapshot('V')); h.api.change(snapshot('VELFAC')); h.timers()
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.requests[0], { snapshot: snapshot('VELFAC'), revision: 4, resolve: h.requests[0].resolve, reject: h.requests[0].reject })
  await h.reply(0)
  assert.equal(h.api.getRevision(), 5); assert.equal(h.state().status, 'saved')
  h.dispose()
})

test('confirmed deletion flushes immediately and undo during a slow save is written at the next revision', async () => {
  const h = harness(), deleted = { items: [], categories: [], costing: {}, optionFiles: [] }
  h.api.change(deleted)
  const flushed = h.api.flush()
  assert.equal(h.requests.length, 1)
  h.api.change(snapshot('Återställd')); h.timers()
  await h.reply(0)
  assert.deepEqual(h.saved[0].snapshot, deleted)
  assert.equal(h.requests[1].revision, 5)
  assert.equal(h.requests[1].snapshot.items[0].title, 'Återställd')
  await h.reply(1)
  assert.equal(await flushed, true); assert.equal(h.state().status, 'saved')
  h.dispose()
})

test('newer text, private costing and PDF references stay together across an in-flight save', async () => {
  const h = harness(), old = snapshot('Gammal'), latest = { ...snapshot('Ny'), costing: { option: { version: 2 } }, optionFiles: [{ optionId: 'option', fileId: 'pdf' }] }
  h.api.change(old); h.timers(); h.api.change(latest); h.timers()
  await h.reply(0)
  assert.deepEqual(h.requests[1].snapshot, latest)
  assert.equal(h.requests[1].revision, 5)
  await h.reply(1)
  assert.deepEqual(h.saved[1].snapshot, latest)
  h.dispose()
})

test('save failures retain the latest deletion without automatic retry or success state', async () => {
  const h = harness(), deleted = { items: [], categories: [], costing: {}, optionFiles: [] }
  h.api.change(snapshot('Fönster')); h.timers(); h.api.change(deleted); h.timers()
  await h.reply(0, 'Konflikt')
  assert.equal(h.state().status, 'error'); assert.deepEqual(h.state().snapshot, deleted)
  h.api.change({ ...deleted, categories: [{ id: 'new' }] }); h.timers()
  assert.equal(h.requests.length, 1)
  const retry = h.api.retry()
  assert.equal(h.requests[1].revision, 4)
  await h.reply(1)
  assert.equal(await retry, true); assert.equal(h.errors.length, 1)
  h.dispose()
})

test('unconfirmed versions are rejected and explicit refresh resets the queue', async () => {
  const h = harness()
  h.api.change(snapshot('Text')); h.timers(); await h.reply(0, null, 40)
  assert.equal(h.state().status, 'error'); assert.equal(h.saved.length, 0)
  h.api.reset(12); h.api.change(snapshot('Uppdaterad')); h.timers()
  assert.equal(h.requests[1].revision, 12)
  await h.reply(1); h.dispose()
})

test('undo back to the saved draft replaces a failed deletion before retry', async () => {
  const h = harness(), original = snapshot('VELFAC')
  h.api.change({ items: [], categories: [], costing: {}, optionFiles: [] })
  const first = h.api.flush()
  await h.reply(0, 'Anslutningsfel')
  assert.equal(await first, false)
  h.api.change(original)
  const retry = h.api.retry()
  assert.deepEqual(h.requests[1].snapshot, original)
  await h.reply(1)
  assert.equal(await retry, true)
  h.dispose()
})

test('unmount cancels pending work without replaying it when an active request finishes', async () => {
  const h = harness()
  h.api.change(snapshot('Första')); h.timers(); h.api.change(snapshot('Nyare')); h.dispose()
  await h.reply(0); h.timers()
  assert.equal(h.requests.length, 1); assert.equal(h.saved.length, 0); assert.equal(await h.api.flush(), false)
})

test('choice autosave has no manual save or automatic customer sharing and cannot write agreements', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerPlanningEditor.tsx', import.meta.url), 'utf8')
  const sheet = readFileSync(new URL('../src/components/tasks/CustomerChoiceOptionSheet.tsx', import.meta.url), 'utf8')
  const status = readFileSync(new URL('../src/components/tasks/CustomerPlanningSaveStatus.tsx', import.meta.url), 'utf8')
  const save = editor.slice(editor.indexOf('const autosave ='), editor.indexOf('const autosaveRef ='))
  assert.match(save, /customer-planning/); assert.match(save, /operation: 'save'/)
  assert.doesNotMatch(save, /customer-offers|customer-contract|publish|toast.success|contractDetails|paymentPlan/)
  assert.doesNotMatch(editor + sheet, /Spara kategorier|Spara planering|onSave=|onSave\(\)/)
  assert.match(editor, /immediateSave.current = true/)
  assert.match(editor, /!dirty && !autosaveRef.current.isPending\(\) && autosaveRef.current.state\?\.status !== 'error'/)
  assert.match(editor, /onClick=\{\(\) => void action\('share'\)\}/)
  assert.match(status, /h-8 w-60 max-w-full/); assert.match(status, /Försök igen/)
})
