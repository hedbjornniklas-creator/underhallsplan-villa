import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { actionScopeDraft, scopeDraftFingerprint, scopeSavePayload, mergeScopeSave } from '../src/lib/action-cases/scopeDraft.ts'

const item = { id: 'a', title: 'Grund', scope: 'Arbete', scopeNotesAvailable: true, scopeExclusions: '', scopeAdvice: '', scopeAttachmentIds: ['photo'], updatedAt: 'v1', costLines: [{ id: 'cost' }], workParts: [{ id: 'part' }], costSuggestion: { id: 'suggestion' } }
test('scope snapshots include the notes and selected files, without pricing or approval fields', () => {
  const draft = actionScopeDraft(item)
  assert.deepEqual(draft, { title: 'Grund', scope: 'Arbete', scopeExclusions: '', scopeAdvice: '', scopeAttachmentIds: ['photo'] })
  assert.equal('scopeAdvice' in actionScopeDraft({ ...item, scopeNotesAvailable: false }), false)
  assert.deepEqual(actionScopeDraft(item, ['legacy']).scopeAttachmentIds, ['legacy'])
})
test('fingerprints ignore normalized whitespace and selection order but not content changes', () => {
  const draft = actionScopeDraft(item, ['a', 'b'])
  assert.equal(scopeDraftFingerprint(draft), scopeDraftFingerprint({ ...draft, title: ' Grund ', scopeAttachmentIds: ['b', 'a', 'a'] }))
  for (const patch of [{ scope: 'Nyare text' }, { scopeAdvice: 'Avrådan' }, { scopeExclusions: 'Undantag' }, { scopeAttachmentIds: [] }]) {
    assert.notEqual(scopeDraftFingerprint(draft), scopeDraftFingerprint({ ...draft, ...patch }))
  }
})
test('the background endpoint requires optimistic locking and strips non-scope mutations', () => {
  const draft = actionScopeDraft(item)
  const input = { ...draft, itemId: 'a', expectedUpdatedAt: 'v1' }
  assert.deepEqual(scopeSavePayload({ ...input, status: 'approved', lumpSum: {}, ownLaborReady: true, orgId: 'foreign' }), input)
  for (const patch of [{ expectedUpdatedAt: '' }, { itemId: '' }, { title: ' ' }, { scope: 7 }]) assert.throws(() => scopeSavePayload({ ...input, ...patch }))
})
test('a scoped response preserves calculations, other actions and terminal project states', () => {
  const other = { id: 'b', title: 'Nyare arbete' }
  const project = { id: 'project', status: 'approved', items: [item, other] }
  const workspace = { cases: [project, { id: 'other', items: [] }] }
  const saved = { item: { id: 'a', scope: 'Sparad text', updatedAt: 'v2' }, caseStatus: 'pricing' }
  const merged = mergeScopeSave(workspace, saved)
  assert.equal(merged.cases[0].items[0].scope, 'Sparad text')
  assert.equal(merged.cases[0].items[0].costLines, item.costLines)
  assert.equal(merged.cases[0].items[0].workParts, item.workParts)
  assert.equal(merged.cases[0].items[0].costSuggestion, item.costSuggestion)
  assert.equal(merged.cases[0].items[1], other)
  assert.equal(merged.cases[1], workspace.cases[1])
  assert.equal(merged.cases[0].status, 'approved')
  assert.equal(item.scope, 'Arbete')
  assert.equal(mergeScopeSave({ cases: [{ ...project, status: 'quote_ready' }] }, saved).cases[0].status, 'pricing')
})
test('the drawer reuses the parent-owned autosave queue and never waits before opening the calculation', () => {
  const hook = readFileSync(new URL('../src/components/tasks/useActionScopeAutosave.ts', import.meta.url), 'utf8')
  const sheet = readFileSync(new URL('../src/components/tasks/ActionCaseItemSheet.tsx', import.meta.url), 'utf8')
  const api = readFileSync(new URL('../src/app/api/action-cases/route.ts', import.meta.url), 'utf8')
  assert.match(hook, /useAutosaveQueue/)
  assert.match(hook, /scopeDraftFingerprint\(current.draft\) === scopeDraftFingerprint\(submitted.draft\)/)
  assert.match(hook, /expectedUpdatedAt: result.item.updatedAt/)
  assert.match(sheet, /onScopeFlush\(\); setTab\('cost'\)/)
  assert.doesNotMatch(sheet, /Spara och gå till kalkyl/)
  assert.match(api, /if \(action === 'save_item_scope'\) return NextResponse.json\(await saveActionCaseScope\(ctx, scopeSavePayload\(payload\)\)\)/)
})

// Exercise both real hooks. Only React's storage/effect boundary, timers and
// HTTP are replaced; requests are manually resolved to test out-of-order edits.
function autosaveHarness() {
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
    new Function('require', 'exports', 'module', 'fetch', 'setTimeout', 'clearTimeout', code)(
      (name) => { if (name === 'react') return react; if (name in dependencies) return dependencies[name]; throw new Error(name) },
      mod.exports, mod,
      (_url, options) => new Promise((resolve) => requests.push({ body: JSON.parse(options.body), resolve })),
      (fn) => { const id = Symbol(); timers.set(id, fn); return id }, (id) => timers.delete(id),
    )
    return mod.exports
  }
  const queue = load('src/hooks/useAutosaveQueue.ts', {})
  const module = load('src/components/tasks/useActionScopeAutosave.ts', {
    '@/hooks/useAutosaveQueue': queue, '@/lib/action-cases/scopeDraft': { scopeDraftFingerprint },
  })
  const api = module.useActionScopeAutosave({ onSaved: (result) => saved.push(result), onError: (error) => errors.push(error) })
  return {
    api, requests, saved, errors, states: () => slots[0].value,
    timers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()) },
    reply: async (index, version, error) => {
      requests[index].resolve(Response.json(error ? { error } : { item: { id: requests[index].body.payload.itemId, updatedAt: version }, caseStatus: 'pricing' }, { status: error ? 503 : 200 }))
      await new Promise((resolve) => setImmediate(resolve))
    },
    dispose: () => cleanups.reverse().forEach((fn) => fn()),
  }
}

test('real queue coalesces typing and serializes different actions with the latest acknowledged version', async () => {
  const h = autosaveHarness(), draft = actionScopeDraft(item)
  h.api.change('a', 'v1', draft)
  assert.equal(h.requests.length, 0)
  h.timers()
  assert.equal(h.requests.length, 1)
  h.api.change('a', 'v1', { ...draft, scope: 'Mellantext' }); h.api.flush('a')
  h.api.change('a', 'v1', { ...draft, scope: 'Senaste text' }); h.api.flush('a')
  h.api.change('b', 'b1', { ...draft, title: 'Fönster' }); h.api.flush('b')
  assert.equal(h.requests.length, 1)
  await h.reply(0, 'v2')
  assert.equal(h.states().a.draft.scope, 'Senaste text')
  assert.equal(h.requests[1].body.payload.scope, 'Senaste text')
  assert.equal(h.requests[1].body.payload.expectedUpdatedAt, 'v2')
  await h.reply(1, 'v3')
  assert.equal(h.requests[2].body.payload.itemId, 'b')
  assert.equal(h.requests[2].body.payload.expectedUpdatedAt, 'b1')
  await h.reply(2, 'b2')
  assert.equal(h.states().a.status, 'saved'); assert.equal(h.states().b.status, 'saved')
  assert.equal(h.errors.length, 0); h.dispose()
})

test('failed saves retain newer text, stop automatic replay and retry using the original version', async () => {
  const h = autosaveHarness(), draft = actionScopeDraft(item)
  h.api.change('a', 'v1', draft); h.api.flush('a')
  h.api.change('a', 'v1', { ...draft, scopeAdvice: 'Ny avrådan' }); h.api.flush('a')
  await h.reply(0, null, 'Tillfälligt fel')
  assert.equal(h.states().a.status, 'error'); assert.equal(h.states().a.draft.scopeAdvice, 'Ny avrådan')
  assert.equal(h.requests.length, 1); assert.equal(h.saved.length, 0)
  h.api.retry('a')
  assert.equal(h.requests[1].body.payload.expectedUpdatedAt, 'v1')
  assert.equal(h.requests[1].body.payload.scopeAdvice, 'Ny avrådan')
  await h.reply(1, 'v2')
  assert.equal(h.states().a.status, 'saved'); h.dispose()
})

test('a missing title never sends an invalid request or pretends the draft is saved', () => {
  const h = autosaveHarness()
  h.api.change('a', 'v1', { ...actionScopeDraft(item), title: ' ' }); h.api.flush('a')
  assert.equal(h.requests.length, 0); assert.equal(h.states().a.status, 'pending')
  h.dispose()
})

test('the compact server response retains quote validation and never adopts a concurrent writer version', async () => {
  const source = readFileSync(new URL('../src/lib/action-cases/server.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'saveActionCaseScope')
  assert.ok(fn)
  const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const mode of ['direct', 'quotes', 'concurrent', 'error']) {
    const response = { item: { ...item, updatedAt: 'v2' }, caseId: 'project', caseStatus: 'pricing' }
    const filters = [], reads = []
    const query = {
      select() { return this }, eq(key, value) { filters.push([key, value]); return this },
      limit: async () => ({ data: mode === 'direct' ? [] : [{ id: 'quote-line' }], error: mode === 'error' ? {} : null }),
    }
    const mod = { exports: {} }, ctx = { orgId: 'trusted-org', userId: 'trusted-user' }
    new Function('exports', 'updateActionCaseItem', 'createSupabaseAdminClient', 'getActionCaseWorkspace', code)(
      mod.exports,
      async (context) => { assert.equal(context, ctx); return response },
      () => ({ from: (table) => { assert.equal(table, 'action_case_cost_lines'); return query } }),
      async (context, caseId) => {
        assert.equal(context, ctx); reads.push(caseId)
        return { cases: [{ id: caseId, items: [{ ...response.item, updatedAt: mode === 'concurrent' ? 'v3' : 'v2', costLines: [{ id: 'quote-line', verified: false }] }] }] }
      },
    )
    const result = mod.exports.saveActionCaseScope(ctx, {})
    if (mode === 'concurrent') await assert.rejects(result, /ACTION_CASE_ITEM_STALE/)
    else if (mode === 'error') await assert.rejects(result, /ACTION_CASE_ITEM_UPDATE_FAILED/)
    else {
      const saved = await result
      assert.equal(saved.item.updatedAt, 'v2')
      if (mode === 'quotes') assert.equal(saved.item.costLines[0].verified, false)
    }
    assert.ok(filters.some(([key, value]) => key === 'org_id' && value === ctx.orgId))
    assert.ok(filters.some(([key, value]) => key === 'action_case_item_id' && value === item.id))
    assert.deepEqual(reads, mode === 'direct' || mode === 'error' ? [] : ['project'])
  }
})
