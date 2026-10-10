import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function harness() {
  const slots = [], timers = new Map(), requests = [], saved = [], errors = [], cleanups = []
  const react = {
    useRef: (value) => ({ current: value }), useCallback: (fn) => fn,
    useState: (initial) => {
      const slot = { value: initial }; slots.push(slot)
      return [initial, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
    },
    useEffect: (effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
  }
  const load = (path, dependencies) => {
    const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const mod = { exports: {} }
    new Function('require', 'exports', 'module', 'setTimeout', 'clearTimeout', code)(
      (name) => { if (name === 'react') return react; if (name in dependencies) return dependencies[name]; throw new Error(name) },
      mod.exports, mod,
      (fn) => { const id = Symbol(); timers.set(id, fn); return id }, (id) => timers.delete(id),
    )
    return mod.exports
  }
  const queue = load('src/hooks/useAutosaveQueue.ts', {})
  const { useCustomerOfferAutosave } = load('src/components/tasks/useCustomerOfferAutosave.ts', { '@/hooks/useAutosaveQueue': queue })
  const api = useCustomerOfferAutosave({ initialRevision: 5,
    save: (snapshot, revision) => new Promise((resolve, reject) => requests.push({ snapshot, revision, resolve, reject })),
    onSaved: (result, snapshot) => saved.push({ result, snapshot }), onError: (error) => errors.push(error),
  })
  return {
    api, requests, saved, errors, state: () => slots[0].value,
    timers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()) },
    reply: async (index, { error, revision } = {}) => {
      const request = requests[index]
      if (error) request.reject(new Error(error))
      else request.resolve({ revision: revision ?? request.revision + 1, draft: request.snapshot.draft, costing: request.snapshot.costing })
      await new Promise((resolve) => setImmediate(resolve))
    },
    dispose: () => cleanups.reverse().forEach((fn) => fn()),
  }
}
const snapshot = (text) => ({ draft: { terms: text }, costing: {} })

test('opening a contract does not write, and a typing pause coalesces edits through the existing queue', async () => {
  const h = harness()
  assert.equal(h.requests.length, 0)
  h.api.change(snapshot('Första texten'))
  h.api.change(snapshot('Senaste texten'))
  assert.equal(h.requests.length, 0)
  h.timers()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].snapshot.draft.terms, 'Senaste texten')
  assert.equal(h.requests[0].revision, 5)
  await h.reply(0)
  assert.equal(h.state().status, 'saved')
  assert.equal(h.api.isPending(), false)
  h.dispose()
})

test('slow saves retain new edits and every next write uses the acknowledged revision', async () => {
  const h = harness()
  h.api.change(snapshot('Första')); h.timers()
  h.api.change(snapshot('Mellantext')); h.timers()
  h.api.change(snapshot('Nyast')); h.timers()
  assert.equal(h.requests.length, 1)
  await h.reply(0)
  assert.equal(h.saved[0].snapshot.draft.terms, 'Första')
  assert.equal(h.requests[1].snapshot.draft.terms, 'Nyast')
  assert.equal(h.requests[1].revision, 6)
  assert.equal(h.state().status, 'saving')
  await h.reply(1)
  assert.equal(h.state().status, 'saved')
  assert.equal(h.requests.length, 2)
  h.dispose()
})

test('an explicit flush waits for newer queued text as well as the active request', async () => {
  const h = harness()
  h.api.change(snapshot('Första'))
  let finished = false
  const flush = h.api.flush().then((result) => { finished = result })
  h.api.change(snapshot('Nyare'))
  await h.reply(0)
  assert.equal(finished, false)
  assert.equal(h.requests[1].snapshot.draft.terms, 'Nyare')
  await h.reply(1)
  await flush
  assert.equal(finished, true)
  h.dispose()
})

test('errors retain the latest snapshot, do not automatically replay, and retry remains revision-guarded', async () => {
  const h = harness()
  h.api.change(snapshot('Första')); h.timers()
  h.api.change(snapshot('Nyare under anropet')); h.timers()
  await h.reply(0, { error: 'Utkastet har ändrats i en annan session.' })
  assert.equal(h.state().status, 'error')
  assert.equal(h.state().snapshot.draft.terms, 'Nyare under anropet')
  h.api.change(snapshot('Senaste efter felet')); h.timers()
  assert.equal(h.requests.length, 1)
  assert.equal(h.errors.length, 1)
  const retry = h.api.retry()
  assert.equal(h.requests[1].revision, 5)
  assert.equal(h.requests[1].snapshot.draft.terms, 'Senaste efter felet')
  await h.reply(1)
  assert.equal(await retry, true)
  assert.equal(h.state().status, 'saved')
  h.dispose()
})

test('an unexpected response version is never adopted; only an explicit refresh resets the revision', async () => {
  const h = harness()
  h.api.change(snapshot('Text')); h.timers()
  await h.reply(0, { revision: 99 })
  assert.equal(h.state().status, 'error')
  assert.equal(h.saved.length, 0)
  h.api.reset(12)
  h.api.change(snapshot('Efter uttrycklig uppdatering')); h.timers()
  assert.equal(h.requests[1].revision, 12)
  await h.reply(1)
  assert.equal(h.state().status, 'saved')
  h.dispose()
})

test('unmount cancels debouncing and does not replay edits after an active save finishes', async () => {
  const h = harness()
  h.api.change(snapshot('Första')); h.timers()
  h.api.change(snapshot('Nyare'))
  h.dispose()
  await h.reply(0)
  h.timers()
  assert.equal(h.requests.length, 1)
  assert.equal(h.saved.length, 0)
  assert.equal(await h.api.flush(), false)
})

test('contract autosave has a fixed status slot, no success toast, explicit recipient confirmation and manual delivery', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  const hook = readFileSync(new URL('../src/components/tasks/useCustomerOfferAutosave.ts', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../src/app/api/action-cases/[caseId]/customer-offers/route.ts', import.meta.url), 'utf8')
  assert.match(hook, /useAutosaveQueue<true, void>/)
  assert.match(editor, /if \(draftTarget === 'contract' && !locked && !running.current\) autosave.change/)
  const save = editor.slice(editor.indexOf('const autosave ='), editor.indexOf('useEffect(() => { onDirtyChange'))
  assert.match(save, /operation: 'autosave'/)
  assert.doesNotMatch(save, /toast.success|onCustomerChanged|setPlanningReset|publish'|bind_customer'/)
  assert.match(editor, /flex h-8 w-60 max-w-full shrink-0[^"]*" role="status" data-testid="contract-save-status"/)
  assert.match(editor, /Bekräfta mottagare/)
  assert.match(editor, /if \(running.current \|\| autosave.isPending\(\)\) return false/)
  assert.match(route, /body.operation === 'autosave'\) await saveCustomerOffer\(ctx, caseId, body, 'autosave', target\)/)
})

test('payment edits autosave without a manual save button and show pending/error state in a fixed slot', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  const payments = editor.slice(editor.indexOf("view === 'payments' ? <section"), editor.indexOf("view === 'customer' ? ("))
  assert.doesNotMatch(payments, /Spara utkast|action\('save'\)/)
  assert.match(payments, /role="status" data-testid="payment-save-status" className="flex h-8 w-60 max-w-full/)
  assert.match(payments, /autosave\.state\?\.status === 'error' \? 'Kunde inte spara' : autosave\.isSaving \? 'Sparar…'/)
  assert.match(payments, /aria-label="Försök spara betalningsplanen igen"[\s\S]*?autosave\.retry\(\)/)
  assert.match(payments, /onChange=\{\(paymentPlan\) => update\(\{ paymentPlan \}\)\}/)
  assert.match(payments, /onTermsChange=\{\(paymentTerms\) => update\(\{ paymentTerms \}\)\}/)
  assert.match(payments, /onConditionsChange=\{\(paymentConditions\) => update\(\{ paymentConditions \}\)\}/)
  assert.match(payments, /locked \? <>[\s\S]*?<PaymentPlanDocument/)
})
