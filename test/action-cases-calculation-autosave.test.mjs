import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { normalizeCostLine } from '../src/lib/action-cases/costing.ts'
import { normalizeLumpSum } from '../src/lib/action-cases/lumpSum.ts'
import { normalizeWorkPartAction } from '../src/lib/action-cases/workParts.ts'
import { offerId } from '../src/lib/action-cases/customerOffers.ts'

function load(path, dependencies, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', ...Object.keys(globals), compiled)(name => {
    if (name in dependencies) return dependencies[name]
    throw new Error(name)
  }, module.exports, module, ...Object.values(globals))
  return module.exports
}
const domain = load('src/lib/action-cases/calculationSave.ts', {
  './costing': { normalizeCostLine }, './lumpSum': { normalizeLumpSum }, './workParts': { normalizeWorkPartAction }, './customerOffers': { offerId },
})
const project = randomUUID(), item = randomUUID(), line = randomUUID()
const version = n => `2026-11-02T12:00:00.${String(n).padStart(6, '0')}Z`
const data = { id: line, create: false, category: 'material', description: 'Testprodukt', quantity: '2', unit: 'st', unitCost: '0', markupPercent: '15', priceSource: 'manual', quantityBasis: 'provided', verified: false }
const edit = (patch = {}, id = line) => ({ key: `line:${id}`, itemId: item, operation: 'line', data: { ...data, ...patch, id } })
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness(kind = 'calculation') {
  const slots = [], timers = new Map(), requests = [], saved = [], errors = [], cleanups = []
  const react = { useRef: value => ({ current: value }), useCallback: fn => fn,
    useState: value => { const slot = { value }; slots.push(slot); return [value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next }] },
    useEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
  }
  const globals = {
    fetch: (_url, options) => new Promise((resolve, reject) => requests.push({ body: JSON.parse(options.body), resolve, reject })),
    setTimeout: fn => { const key = Symbol(); timers.set(key, fn); return key }, clearTimeout: key => timers.delete(key),
  }
  const dependencies = { react, '@/lib/action-cases/calculationSave': domain }
  dependencies['@/hooks/useAutosaveQueue'] = load('src/hooks/useAutosaveQueue.ts', dependencies, globals)
  const coordinate = load('src/components/tasks/useActionSaveCoordinator.ts', dependencies, globals).useActionSaveCoordinator()
  let api
  if (kind === 'calculation') api = load('src/components/tasks/useActionCalculationAutosave.ts', dependencies, globals).useActionCalculationAutosave({ caseId: project, coordinate, onSaved: result => saved.push(result) })
  else api = load('src/components/tasks/useProjectScheduleAutosave.ts', dependencies, globals).useProjectScheduleAutosave({
    save: (rows, revision) => new Promise((resolve, reject) => requests.push({ body: { rows, revision }, resolve, reject })),
    onSaved: result => saved.push(result), onError: error => errors.push(error),
  })
  return { api, requests, saved, errors, states: () => slots[0].value,
    timers: async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await tick() },
    reply: async (index, n, patch = {}) => {
      const request = requests[index], submitted = request.body.payload
      request.resolve(kind === 'calculation' ? Response.json({ requestId: submitted.requestId, expectedUpdatedAt: submitted.expectedUpdatedAt, updatedAt: version(n), item: { id: item, updatedAt: version(n), costLines: [] }, caseId: project, ...patch }) : { revision: n, rows: request.body.rows, sharedRows: [], ...patch })
      await tick()
    },
    fail: async index => { requests[index].reject(new Error('Nätfel')); await tick() },
    dispose: () => cleanups.reverse().forEach(fn => fn()),
  }
}

test('calculation versions preserve microseconds, timezone equivalence and reject malformed values', () => {
  assert.equal(domain.sameCalculationVersion(version(1), '2026-11-02T13:00:00.000001+01:00'), true)
  assert.equal(domain.sameCalculationVersion(version(1), version(2)), false)
  for (const bad of ['', 'tomorrow', '2026-11-02', '2026-11-02T12:00:00.0000001Z']) assert.equal(domain.sameCalculationVersion(bad, bad), false)
})

test('zero, empty and invalid prices remain distinct; non-calculation fields are stripped', () => {
  assert.equal(domain.calculationData(edit({ orgId: 'foreign', status: 'approved' }), project, version(1)).unitCost, 0)
  assert.equal(domain.calculationData(edit({ unitCost: '' }), project, version(1)).unitCost, null)
  assert.equal('status' in domain.calculationData(edit({ status: 'approved' }), project, version(1)), false)
  assert.throws(() => domain.calculationData(edit({ unitCost: '-1' }), project, version(1)))
  assert.throws(() => domain.calculationData(edit({ description: '' }), project, version(1)))
  for (const value of ['', ' ', null, 1001]) assert.throws(() => domain.calculationData({ ...edit(), operation: 'markup', data: { id: line, markupPercent: value } }, project, version(1)))
})

test('optimistic overlays and scoped acknowledgements preserve other projects and contract prices', () => {
  const original = { id: item, updatedAt: version(1), costLines: [{ ...data, quantity: 2, unitCost: 10 }], contractWork: { price: { amountOre: 900 } } }
  const overlay = domain.overlayCalculation(original, [edit({ unitCost: '' })])
  assert.equal(overlay.costLines[0].unitCost, null)
  assert.equal(original.costLines[0].unitCost, 10)
  assert.equal(overlay.contractWork, original.contractWork)
  const workspace = { cases: [{ id: project, items: [original, { id: 'other-item' }] }, { id: 'other-project' }] }
  const merged = domain.mergeCalculationSave(workspace, { caseId: project, item: overlay, caseStatus: 'pricing' })
  assert.equal(merged.cases[0].items[1], workspace.cases[0].items[1])
  assert.equal(merged.cases[1], workspace.cases[1])
})

test('typing coalesces; another row remains editable while saving and uses our acknowledged version', async () => {
  const h = harness(), second = randomUUID()
  h.api.change(edit({ unitCost: '10' }), version(1)); h.api.change(edit({ unitCost: '20' }), version(1))
  assert.equal(h.requests.length, 0); await h.timers()
  assert.equal(h.requests[0].body.payload.data.unitCost, 20)
  h.api.change(edit({ unitCost: '30' }), version(1)); h.api.change(edit({ unitCost: '40' }, second), version(1)); await h.timers()
  assert.equal(h.requests.length, 1)
  await h.reply(0, 2)
  assert.equal(h.requests[1].body.payload.data.unitCost, 30)
  assert.equal(h.requests[1].body.payload.expectedUpdatedAt, version(2))
  await h.reply(1, 3)
  assert.equal(h.requests[2].body.payload.data.id, second)
  assert.equal(h.requests[2].body.payload.expectedUpdatedAt, version(3))
  await h.reply(2, 4)
  assert.ok(Object.values(h.states()).every(entry => entry.status === 'saved')); h.dispose()
})

test('an ambiguous response retries the exact request ID before saving newer input', async () => {
  const h = harness()
  h.api.change(edit({ create: true, unitCost: '10' }), version(1)); await h.timers()
  const first = h.requests[0].body
  h.api.change(edit({ create: true, unitCost: '20' }), version(1)); await h.fail(0)
  assert.equal(h.states()[`line:${line}`].status, 'error')
  await h.timers(); assert.equal(h.requests.length, 1)
  h.api.retry(`line:${line}`); await tick()
  assert.deepEqual(h.requests[1].body, first)
  await h.reply(1, 2); await h.timers()
  assert.equal(h.requests[2].body.payload.data.create, false)
  assert.equal(h.requests[2].body.payload.data.unitCost, 20)
  assert.notEqual(h.requests[2].body.payload.requestId, first.payload.requestId)
  await h.reply(2, 3); h.dispose()
})

test('incomplete newer input survives an active save and cannot be discarded mid-flight', async () => {
  const h = harness()
  h.api.change(edit(), version(1)); await h.timers()
  h.api.change(edit({ description: '' }), version(1))
  assert.equal(h.states()[`line:${line}`].status, 'invalid')
  assert.equal(h.states()[`line:${line}`].inFlight, true)
  assert.equal(h.api.discardItem(item), false)
  await h.reply(0, 2)
  assert.equal(h.states()[`line:${line}`].edit.data.description, '')
  assert.equal(h.states()[`line:${line}`].status, 'invalid')
  assert.equal(await h.api.flushAll(), false)
  assert.equal(h.api.discardItem(item), true); h.dispose()
})

test('delete during first create queues a tombstone; blank unsent rows never reach the server', async () => {
  const h = harness()
  h.api.change(edit({ create: true, description: '' }), version(1)); await h.timers()
  h.api.removeLine(item, line, version(1)); assert.equal(h.states()[`line:${line}`], undefined)
  assert.equal(h.requests.length, 0)
  h.api.change(edit({ create: true }), version(1)); await h.timers()
  h.api.removeLine(item, line, version(1)); await tick()
  await h.reply(0, 2)
  assert.equal(h.requests[1].body.payload.operation, 'delete_line')
  assert.equal(h.requests[1].body.payload.expectedUpdatedAt, version(2))
  await h.reply(1, 3)
  assert.equal(h.states()[`line:${line}`].status, 'saved'); h.dispose()
})

test('a newly saved work part reuses the returned ID when newer text is queued', async () => {
  const h = harness(), temporary = randomUUID(), actual = randomUUID()
  const part = title => ({ key: `part:${temporary}`, itemId: item, operation: 'work_part', data: { operation: 'save', partId: null, title, scope: '' } })
  h.api.change(part('Snickeri'), version(1)); await h.timers()
  h.api.change(part('Snickeri och dörrar'), version(1)); await h.timers()
  await h.reply(0, 2, { partId: actual })
  assert.equal(h.requests[1].body.payload.data.partId, actual)
  await h.reply(1, 3, { partId: actual }); h.dispose()
})

test('unmount cancels new debounced writes, including newer edits after an active save', async () => {
  const h = harness()
  h.api.change(edit(), version(1)); await h.timers()
  h.api.change(edit({ unitCost: '90' }), version(1)); h.dispose()
  await h.reply(0, 2); await h.timers()
  assert.equal(h.requests.length, 1)
})

test('schedule preserves newer rows, advances only acknowledged revisions and requires explicit retry', async () => {
  const h = harness('schedule')
  h.api.reset(4); h.api.change([{ id: 'row', title: 'A' }], true); await h.timers()
  h.api.change([{ id: 'row', title: 'B' }], true); await h.timers()
  await h.reply(0, 5)
  assert.equal(h.requests[1].body.revision, 5)
  assert.equal(h.requests[1].body.rows[0].title, 'B')
  await h.fail(1)
  h.api.change([{ id: 'row', title: 'C' }], true); await h.timers()
  assert.equal(h.requests.length, 2)
  const retried = h.api.retry(); await tick(); assert.equal(h.requests[2].body.rows[0].title, 'C')
  await h.reply(2, 6); assert.equal(await retried, true); h.dispose()
})

test('invalid schedule edits cannot appear saved or trigger sharing after an earlier save completes', async () => {
  const h = harness('schedule')
  h.api.change([{ title: 'A' }], true); await h.timers()
  h.api.change([{ title: '' }], false)
  assert.equal(h.states().inFlight, true)
  await h.reply(0, 1)
  assert.equal(h.states().status, 'invalid'); assert.equal(await h.api.flush(), false)
  const editor = readFileSync(new URL('../src/components/tasks/ProjectScheduleEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /loadedRefresh.current === customerRefresh \|\| dirty \|\| saveRef.current.isPending\(\)/)
  assert.match(editor, /before !== JSON.stringify\(currentRows.current\) \|\| saveRef.current.isSaving/)
  assert.match(editor, /autosave.isPending\(\) \|\| \(operation === 'share'/)
  h.dispose()
})

test('the calculation server scopes responses and accepts only its exact write acknowledgement, not a concurrent version', async () => {
  const source = ts.createSourceFile('server.ts', readFileSync(new URL('../src/lib/action-cases/server.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'saveActionCaseCalculation')
  const compiled = ts.transpileModule(fn.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const mode of ['ok','concurrent','ack','schema']) {
    const calls = [], reads = [], requestId = randomUUID(), context = { orgId: randomUUID(), userId: randomUUID() }, module = { exports: {} }
    new Function('exports','offerId','text','sameCalculationVersion','calculationData','createSupabaseAdminClient','getActionCaseWorkspace',compiled)(module.exports, offerId, value => typeof value === 'string' ? value.trim() : '', domain.sameCalculationVersion, domain.calculationData,
      () => ({ rpc: async (name, args) => {
        calls.push({ name, args })
        return mode === 'schema' ? { error: { code: 'PGRST202' } } : { data: { requestId: mode === 'ack' ? randomUUID() : requestId, expectedUpdatedAt: version(1), updatedAt: version(2) } }
      } }),
      async (ctx, caseId) => { assert.equal(ctx, context); reads.push(caseId); return { cases: [{ id: caseId, status: 'pricing', items: [{ id: item, updatedAt: version(mode === 'concurrent' ? 3 : 2) }] }] } },
    )
    const request = module.exports.saveActionCaseCalculation(context, { caseId: project, itemId: item, requestId, expectedUpdatedAt: version(1), operation: 'line', data: { ...data, orgId: 'untrusted', userId: 'untrusted' } })
    if (mode === 'ok') { const result = await request; assert.equal(result.item.id, item); assert.equal('workspace' in result, false) }
    else await assert.rejects(request, mode === 'concurrent' ? /ITEM_STALE/ : mode === 'schema' ? /CALCULATION_SCHEMA/ : /WRITE_FAILED/)
    assert.equal(calls[0].args.p_org_id, context.orgId); assert.equal(calls[0].args.p_user_id, context.userId)
    assert.equal('orgId' in calls[0].args.p_data, false)
    assert.deepEqual(reads, mode === 'schema' || mode === 'ack' ? [] : [project])
  }
})

test('old non-versioned direct row writes require a reload, and background requests use existing origin and contract guards', () => {
  const server = readFileSync(new URL('../src/lib/action-cases/server.ts', import.meta.url), 'utf8')
  for (const name of ['updateActionCaseCostLine','deleteActionCaseCostLine']) assert.match(server, new RegExp(`function ${name}[^}]+ACTION_CASE_CALCULATION_CLIENT_OLD`))
  const api = readFileSync(new URL('../src/app/api/action-cases/route.ts', import.meta.url), 'utf8')
  assert.match(api, /action === 'save_calculation'/)
  assert.ok(api.indexOf('await assertContractWorkMutation') < api.indexOf('await saveActionCaseCalculation'))
  assert.match(api, /request.headers.get\('origin'\)/)
})
