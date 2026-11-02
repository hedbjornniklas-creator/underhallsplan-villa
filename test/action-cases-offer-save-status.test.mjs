import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { emptyCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { customerOfferSaveChanges } from '../src/lib/action-cases/customerOfferSaveChanges.ts'
import { sharedWorkScopeKey } from '../src/lib/action-cases/contractWork.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const jsx = (type, props) => ({ type, props })
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && value.props
  ? [value, ...nodes(value.props.children)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value)
  ? value.map(text).join('') : value?.props ? text(value.props.children) : ''

function harness({ target = 'offer', active = true, dropFirstChange = false, accepted = false } = {}) {
  const hooks = [], effects = new Map(), timers = new Map(), modules = new Map(), requests = [], dirtyStates = [], listeners = new Map()
  let cursor = 0, queued = [], tree, changeCalls = 0
  const successes = []
  const draft = { ...emptyCustomerOffer('Fiktiv offert'), contractForm: 'custom', introduction: 'Befintlig text' }
  const workspace = { revision: 2, draft, costing: {}, costingAvailable: true, offers: [], planning: { available: true, revision: 0, items: [], sharedItems: [], categories: [] } }
  if (accepted) workspace.offers = [{ id: 'accepted', status: 'accepted', snapshot: draft, version: 1, files: [], acceptedOptionIds: [] }]
  const props = { draftTarget: target, active, initial: workspace, view: target === 'offer' ? 'edit' : 'contract',
    actionCase: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Fiktivt projekt', customerName: 'Testkund', propertyAddress: 'Testgatan', items: [], attachments: [], participants: [] },
    issuerName: 'Testbygg AB', replyEmail: 'test@example.test', embedded: true, onDirtyChange: value => dirtyStates.push(value) }
  const react = {
    useId: () => `test-${cursor++}`,
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index] },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }] },
    useCallback: fn => fn,
    useEffect(run, dependencies = []) { const index = cursor++, previous = effects.get(index)
      if (!previous || dependencies.length !== previous.dependencies.length || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) queued.push({ index, dependencies, run }) },
  }
  const window = { addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn), sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports
    const compiled = { exports: {} }; modules.set(file, compiled)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    new Function('require', 'module', 'exports', 'window', 'fetch', 'setTimeout', 'clearTimeout', code)(name => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => `icon:${String(key)}` })
      if (name === '@/components/ui/AppToastProvider') return { useToast: () => ({ error() {}, info() {}, warning() {}, success: message => successes.push(message) }) }
      if (name.startsWith('@/components/')) return { default: name }
      if (name.startsWith('./') && file.endsWith('CustomerOfferEditor.tsx') && name !== './useCustomerOfferAutosave') return { default: name, ...new Proxy({}, { get: (_, key) => key }) }
      const path = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(file), name)
      const dependency = [path, `${path}.ts`, `${path}.tsx`].find(path => existsSync(path))
      if (!dependency) throw Error(`Unexpected dependency ${name}`)
      const result = load(dependency)
      if (dropFirstChange && name === './useCustomerOfferAutosave') return { useCustomerOfferAutosave: options => {
        const api = result.useCustomerOfferAutosave(options)
        return { ...api, change: value => { changeCalls++; if (changeCalls > 1) api.change(value) } }
      } }
      return result
    }, compiled, compiled.exports, window, (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })),
    fn => { const id = Symbol(); timers.set(id, fn); return id }, id => timers.delete(id))
    return compiled.exports
  }
  const component = load(resolve(root, 'src/components/tasks/CustomerOfferEditor.tsx')).default
  function render() {
    cursor = 0; queued = []; tree = component(props)
    for (const effect of queued) { effects.get(effect.index)?.cleanup?.(); const cleanup = effect.run(); effects.set(effect.index, { ...effect, cleanup }) }
    return tree
  }
  return { props, requests, dirtyStates, listeners, render, successes,
    status: () => text(nodes(render()).find(node => node.props['data-testid'] === 'contract-save-status')),
    changeTitle(value) { const label = nodes(render()).find(node => node.type === 'label' && text(node).trim() === 'Rubrik *')
      assert.ok(label); nodes(label).find(node => node.type === 'input').props.onChange({ target: { value } }); render() },
    title: () => nodes(render()).find(node => node.type === 'label' && text(node).trim() === 'Rubrik *').props.children.find(node => node?.type === 'input').props.value,
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()) },
    async settle() { for (let i = 0; i < 5; i++) { render(); await new Promise(resolve => setImmediate(resolve)) }; return render() },
    async reply(index, error) { const request = requests[index]; assert.ok(request, `Missing request ${index}`)
      const body = JSON.parse(request.init.body)
      request.resolve(error ? Response.json({ error }, { status: 409 }) : Response.json({ ...workspace, revision: body.revision + 1, draft: normalizeCustomerOffer(body.draft), costing: body.costing ?? {} }))
      await this.settle() },
    async respond(index, result) { requests[index].resolve(Response.json(result)); await this.settle() },
    changes: () => changeCalls,
    dispose() { for (const effect of effects.values()) if (typeof effect.cleanup === 'function') effect.cleanup() },
  }
}

test('a pristine hidden contract does not report prepared defaults as unsaved and never writes', async t => {
  const ui = harness({ target: 'contract', active: false }); t.after(ui.dispose)
  await ui.settle(); ui.tick()
  assert.equal(ui.dirtyStates.at(-1), false)
  assert.equal(ui.listeners.get('beforeunload')?.size ?? 0, 0)
  assert.equal(ui.requests.length, 0)
  assert.match(ui.status(), /Sparat/)
})

test('the independent offer does not mount a second planning or billing editor', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  assert.equal(ui.dirtyStates.at(-1), false)
  assert.equal(ui.requests.length, 0)
  assert.equal(nodes(ui.render()).some(node => ['./CustomerPlanningEditor', './ProjectBillingEditor'].includes(node.type)), false)
})

test('real offer edits list their section, autosave and clear dirty state only after acknowledgement', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  ui.changeTitle('Ny offerttext')
  assert.match(text(ui.render()), /Rubrik, inledning eller giltighetsdatum/)
  assert.equal(ui.dirtyStates.at(-1), true)
  ui.tick(); assert.equal(ui.requests.length, 1)
  assert.match(ui.requests[0].url, /\?draftTarget=offer$/)
  await ui.reply(0)
  assert.match(ui.status(), /Sparat/)
  assert.equal(ui.dirtyStates.at(-1), false)
  assert.equal(ui.title(), 'Ny offerttext')
})

test('an edit without a queued request is recovered without a reload or a contract write', async t => {
  const ui = harness({ dropFirstChange: true }); t.after(ui.dispose); await ui.settle()
  ui.changeTitle('Behall min text'); await ui.settle(); ui.tick()
  assert.equal(ui.changes(), 2)
  assert.equal(ui.requests.length, 1)
  assert.equal(JSON.parse(ui.requests[0].init.body).draft.title, 'Behall min text')
  await ui.reply(0)
  assert.equal(ui.dirtyStates.at(-1), false)
})

test('slow saves cannot clear or overwrite newer offer text', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  ui.changeTitle('Forsta text'); ui.tick()
  ui.changeTitle('Senaste text'); ui.tick()
  await ui.reply(0)
  assert.equal(ui.title(), 'Senaste text')
  assert.equal(ui.dirtyStates.at(-1), true)
  assert.equal(ui.requests.length, 2)
  await ui.reply(1)
  assert.equal(ui.dirtyStates.at(-1), false)
  assert.equal(ui.title(), 'Senaste text')
})

test('a save conflict remains visible with the affected section and never discards local text', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  ui.changeTitle('Osparad text'); ui.tick()
  await ui.reply(0, 'Offerten har ändrats i en annan flik.')
  assert.match(ui.status(), /Kunde inte spara/)
  assert.match(text(ui.render()), /Offerten har ändrats i en annan flik/)
  assert.match(text(ui.render()), /Rubrik, inledning eller giltighetsdatum/)
  ui.changeTitle('Nyare text efter felet'); await ui.settle(); ui.tick()
  assert.equal(ui.requests.length, 1)
  assert.equal(ui.title(), 'Nyare text efter felet')
  assert.match(text(ui.render()), /Offerten har ändrats i en annan flik/)
  assert.equal(ui.dirtyStates.at(-1), true)
})

test('pending child editors identify their own section instead of claiming the offer draft is dirty', async t => {
  const ui = harness({ target: 'contract', active: false }); t.after(ui.dispose); await ui.settle()
  nodes(ui.render()).find(node => node.type === './CustomerPlanningEditor').props.onDirty(true)
  await ui.settle()
  assert.match(ui.status(), /Sparat/)
  assert.match(text(ui.render()), /Ändringar i Val och tillval/)
  assert.equal(ui.dirtyStates.at(-1), true)
})

test('locked contracts remain pristine and the recovery effect never writes them', async t => {
  const ui = harness({ target: 'contract', active: false, accepted: true }); t.after(ui.dispose)
  await ui.settle(); ui.tick()
  assert.equal(ui.requests.length, 0)
  assert.equal(ui.dirtyStates.at(-1), false)
})

test('change summaries cover prices, scope, documents and internal calculations without exposing their contents', () => {
  const saved = emptyCustomerOffer(), draft = { ...saved, items: [{ id: 'x', title: 'Privat rad', scope: 'Hemlig text', kind: 'included', amountOre: null }], baseAmountOre: 0, paymentTerms: '10 dagar', terms: 'Villkor' }
  const changes = customerOfferSaveChanges(draft, saved, { x: { purchaseOre: 0 } })
  assert.deepEqual(changes, ['Arbetsmoment och omfattning', 'Pris och prisvillkor', 'Villkor och bilagor', 'Betalningsplan eller betalningsvillkor', 'Intern priskalkyl'])
  assert.doesNotMatch(changes.join(' '), /Hemlig|Privat/)
})

test('shared scope fingerprints ignore prices, costing, row order and option rows', () => {
  const a = { id: 'a', title: 'Grund', scope: 'Text', amountOre: 100 }, b = { id: 'b', title: 'Tak', scope: 'Taktext' }
  assert.equal(sharedWorkScopeKey([a,b]), sharedWorkScopeKey([b,{...a,amountOre:200}, { id:'c', title:'Tillval', scope:'Inte delat',kind:'option' }]))
  assert.notEqual(sharedWorkScopeKey([a]),sharedWorkScopeKey([{...a,scope:'Ny text'}]))
})

test('a clean offer reloads changed shared scope from its own endpoint, without saving or touching the contract', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  ui.props.actionCase.items = [{ id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'Grund',scope:'Ny projekttext' }]
  await ui.settle()
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].init.method, 'GET')
  assert.match(ui.requests[0].url,/\?draftTarget=offer$/)
  await ui.respond(0,{...ui.props.initial, revision:3})
  assert.equal(ui.dirtyStates.at(-1),false)
  assert.equal(ui.requests.length,1)
  assert.deepEqual(ui.successes,[])
})

test('a failed shared-scope read can be retried explicitly and does not alter local text or autosave', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  ui.props.actionCase.items = [{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'Grund',scope:'Ny projekttext'}]
  await ui.settle(); ui.requests[0].reject(new Error('Tillfalligt lasfel')); await ui.settle()
  assert.match(text(ui.render()), /Den gemensamma omfattningen kunde inte hämtas/)
  assert.equal(ui.title(),'Fiktiv offert'); assert.equal(ui.requests.length,1)
  const retry = nodes(ui.render()).find(node=>node.type==='button'&&text(node)==='Försök hämta omfattningen igen')
  assert.ok(retry); assert.equal(Boolean(retry.props.disabled),false); retry.props.onClick(); await ui.settle()
  await ui.respond(1,{...ui.props.initial,revision:3})
  assert.doesNotMatch(text(ui.render()),/Den gemensamma omfattningen kunde inte hämtas/)
})

test('an in-flight scope read never replaces text entered after the request began', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  ui.props.actionCase.items = [{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'Grund',scope:'Ny projekttext'}]
  await ui.settle()
  ui.changeTitle('Ny lokal text under hamtningen')
  await ui.respond(0,{...ui.props.initial,revision:3,draft:{...ui.props.initial.draft,title:'Annan sparad rubrik'}})
  assert.equal(ui.title(),'Ny lokal text under hamtningen')
  assert.equal(ui.dirtyStates.at(-1),true)
  assert.match(text(ui.render()),/Den gemensamma omfattningen kunde inte hämtas/)
})

test('the shared source refresh waits for unsaved edits and never discards a failed local draft', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  ui.changeTitle('Behall utkastet'); ui.tick()
  ui.props.actionCase.items = [{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'Grund',scope:'Ny projekttext'}]
  await ui.settle(); assert.equal(ui.requests.length,1)
  await ui.reply(0,'Offerten har andrats i annan flik.'); await ui.settle()
  assert.equal(ui.title(),'Behall utkastet'); assert.equal(ui.requests.length,1)
})

test('linked offer scope fields are read-only once their source is locked', async t => {
  const ui = harness(); t.after(ui.dispose)
  const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ui.props.initial.draft.items=[{id,sourceItemId:id,title:'Grund',scope:'Last text',scopeConditions:'Last villkor',kind:'included',amountOre:100}]
  ui.props.actionCase.items=[{id,title:'Grund',scope:'Last text',contractWork:{locked:true}}]
  await ui.settle()
  assert.match(text(ui.render()),/Momentets rubrik och omfattning är låsta med avtalet/)
  const labels=['Arbetsrubrik *','Omfattning och avgränsningar *','Förutsättningar (valfritt)']
  for(const label of labels) {
    const wrapper=nodes(ui.render()).find(node=>node.type==='label'&&text(node).trim()===label)
    assert.ok(wrapper,label); assert.equal(nodes(wrapper).find(node=>['input','textarea'].includes(node.type)).props.disabled,true)
  }
  assert.equal(ui.requests.length,0)
})

test('discarding a failed offer requires explicit confirmation and replaces it only after a successful read', async t => {
  const ui=harness();t.after(ui.dispose);await ui.settle()
  ui.changeTitle('Osparat lokalt utkast');ui.tick();await ui.reply(0,'Offerten har andrats i en annan flik.')
  const refresh=()=>nodes(ui.render()).find(node=>node.type==='button'&&text(node)==='Hämta sparad offert').props.onClick()
  refresh();await ui.settle()
  assert.match(text(ui.render()),/Ersätta dina osparade offertändringar/)
  assert.equal(ui.requests.length,1);assert.equal(ui.title(),'Osparat lokalt utkast')
  nodes(ui.render()).find(node=>node.type==='button'&&text(node)==='Avbryt hämtning').props.onClick();await ui.settle()
  assert.equal(ui.requests.length,1);assert.equal(ui.title(),'Osparat lokalt utkast')
  refresh();await ui.settle()
  nodes(ui.render()).find(node=>node.type==='button'&&text(node)==='Ersätt med sparad offert').props.onClick();await ui.settle()
  assert.equal(ui.requests[1].init.method,'GET');assert.equal(ui.title(),'Osparat lokalt utkast')
  await ui.respond(1,{...ui.props.initial,revision:3,draft:{...ui.props.initial.draft,title:'Senast sparad offert'}})
  assert.equal(ui.title(),'Senast sparad offert');assert.equal(ui.dirtyStates.at(-1),false)
  assert.equal(ui.requests.length,2)
})

test('a failed explicit reload retains the local offer and the original save conflict', async t => {
  const ui=harness();t.after(ui.dispose);await ui.settle()
  ui.changeTitle('Behall denna offerttext');ui.tick();await ui.reply(0,'Offerten har andrats i en annan flik.')
  nodes(ui.render()).find(node=>node.type==='button'&&text(node)==='Hämta sparad offert').props.onClick();await ui.settle()
  nodes(ui.render()).find(node=>node.type==='button'&&text(node)==='Ersätt med sparad offert').props.onClick();await ui.settle()
  ui.requests[1].reject(Error('Misslyckad hamtning'));await ui.settle();ui.tick()
  assert.equal(ui.title(),'Behall denna offerttext');assert.equal(ui.dirtyStates.at(-1),true)
  assert.match(ui.status(),/Kunde inte spara/);assert.equal(ui.requests.length,2)
})
