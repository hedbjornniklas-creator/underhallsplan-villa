import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as schedule from '../src/lib/action-cases/projectSchedule.ts'
import * as timeline from '../src/lib/action-cases/scheduleTimeline.ts'

const jsx = (type, props) => ({ type, props })
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : ''
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const row = (id, title) => ({ id, title, phase: '', startDate: '2026-11-02', endDate: '2026-11-13', status: 'planned', sourceItemId: null })
test('the table viewport contains its absolute screen-reader header on narrow screens', () => {
  const css = readFileSync(new URL('../src/components/tasks/project-schedule.css', import.meta.url), 'utf8')
  assert.match(css, /\.gizmo-schedule-table-scroll\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*auto;/)
})
function harness() {
  const state = [], effects = new Map(), timers = new Map(), requests = [], modules = new Map(), dirty = [], shared = []
  let cursor = 0, queued = []
  const react = {
    useRef(value) { const i = cursor++; return state[i] ??= { current: value } },
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useCallback(fn, deps) { const i = cursor++; if (!state[i] || deps.some((value, index) => !Object.is(value, state[i].deps[index]))) state[i] = { fn, deps }; return state[i].fn },
    useEffect(fn, deps = []) { const i = cursor++, before = effects.get(i); if (!before || deps.some((v, index) => !Object.is(v, before.deps[index]))) queued.push({ i, fn, deps }) },
  }
  const props = { caseId: a, items: [{ id: b, title: 'Nytt projektmoment' }], onDirty: value => dirty.push(value), onShared: value => shared.push(value) }
  const toast = { success() {}, error() {} }
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const compiled = { exports: {} }
    new Function('require','module','exports','fetch','window','setTimeout','clearTimeout', code)(name => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) })
      if (name.endsWith('.css')) return {}
      if (name === '@/components/ui/AppToastProvider') return { useToast: () => toast }
      if (name === '@/lib/action-cases/projectSchedule') return schedule
      if (name === '@/lib/action-cases/scheduleTimeline') return timeline
      if (name === './ProjectScheduleGantt' || name === './ProjectScheduleRowEditor') return { default: name }
      const resolved = name.startsWith('@/') ? `src/${name.slice(2)}.ts` : `src/components/tasks/${name.slice(2)}.ts`
      return load(resolved)
    }, compiled, compiled.exports, (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })),
    { addEventListener() {}, removeEventListener() {} }, fn => { const id = Symbol(); timers.set(id,fn); return id }, id => timers.delete(id))
    modules.set(path, compiled.exports); return compiled.exports
  }
  const Component = load('src/components/tasks/ProjectScheduleEditor.tsx').default
  const render = () => { cursor = 0; queued = []; const result = Component(props); for (const effect of queued) { effects.get(effect.i)?.cleanup?.(); effects.set(effect.i, { ...effect, cleanup: effect.fn() }) }; return result }
  const find = type => nodes(render()).find(node => node.type === type)
  const button = label => nodes(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node).trim() === label))
  const api = { props, requests, dirty, shared, render, find, button,
    async settle() { for (let i = 0; i < 8; i++) { render(); await new Promise(resolve => setImmediate(resolve)) } },
    async respond(index, data, status = 200) { requests[index].resolve(Response.json(data, { status })); await this.settle() },
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()) },
    rows: () => find('./ProjectScheduleGantt').props.rows,
    open(title) { button(`Redigera ${title}`).props.onClick(); render(); return find('./ProjectScheduleRowEditor') },
    dispose() { for (const effect of effects.values()) effect.cleanup?.() },
  }
  return api
}
async function ready(t) {
  const h = harness(); t.after(h.dispose); await h.settle()
  await h.respond(0, { available: true, revision: 3, rows: [row(a, 'Grund'), row(b, 'Tak')], sharedRows: [] })
  return h
}
test('mount, scale and selection are read-only; both views receive the same row order', async t => {
  const h = await ready(t)
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.rows().map(r => r.title), ['Grund','Tak'])
  h.find('./ProjectScheduleGantt').props.onSelect(b)
  assert.equal(h.find('./ProjectScheduleGantt').props.selectedId, b)
  assert.equal(h.requests.length, 1)
  assert.equal(h.dirty.at(-1), false)
})
test('pencil edits autosave existing rows only and keep later edits after an acknowledgement', async t => {
  const h = await ready(t)
  h.open('Grund').props.onPatch({ title: 'Grund A' }); await h.settle(); h.tick(); await h.settle()
  const submitted = JSON.parse(h.requests[1].init.body)
  assert.equal(submitted.operation, 'save'); assert.equal(submitted.revision, 3)
  assert.match(h.requests[1].url, /\/schedule$/)
  assert.equal(submitted.rows[0].title, 'Grund A')
  h.find('./ProjectScheduleRowEditor').props.onPatch({ title: 'Grund B' }); await h.settle()
  await h.respond(1, { available: true, revision: 4, rows: submitted.rows, sharedRows: [] })
  assert.equal(h.rows()[0].title, 'Grund B'); assert.equal(h.dirty.at(-1), true)
  h.find('./ProjectScheduleRowEditor').props.onClose(); h.render()
  assert.equal(h.rows()[0].title, 'Grund B')
})
test('invalid dates stay local, block sharing, and are not lost when the drawer closes', async t => {
  const h = await ready(t)
  h.open('Grund').props.onPatch({ endDate: '2026-11-01' }); await h.settle(); h.tick()
  assert.equal(h.requests.length, 1)
  assert.match(text(h.render()), /Komplettera moment och datum/)
  assert.equal(h.button('Visa för beställaren').props.disabled, true)
  h.find('./ProjectScheduleRowEditor').props.onClose(); h.render()
  assert.equal(h.rows()[0].endDate, '2026-11-01')
})
test('remove, undo and move use existing autosave rather than changing project work or the contract', async t => {
  const h = await ready(t)
  h.open('Grund').props.onMove(1); assert.deepEqual(h.rows().map(r => r.title), ['Tak','Grund'])
  h.find('./ProjectScheduleRowEditor').props.onRemove(); assert.deepEqual(h.rows().map(r => r.title), ['Tak'])
  h.button('Ångra borttagning').props.onClick(); assert.deepEqual(h.rows().map(r => r.title), ['Tak','Grund'])
  h.tick(); await h.settle()
  assert.ok(h.requests.slice(1).every(request => request.url.endsWith('/schedule')))
  assert.equal(h.shared.at(-1).length, 0)
})
test('save failures retain the drawer and draft until explicit retry; refresh requires inline confirmation', async t => {
  const h = await ready(t)
  h.open('Grund').props.onPatch({ title: 'Behåll mig' }); await h.settle(); h.tick(); await h.settle()
  await h.respond(1, { error: 'Simulerat sparfel' }, 503)
  assert.equal(h.rows()[0].title, 'Behåll mig')
  assert.match(text(h.render()), /Simulerat sparfel/)
  h.button('Hämta sparad tidsplan').props.onClick(); h.render()
  assert.match(text(h.render()), /Ersätta dina osparade tidsplaneändringar/)
  h.button('Avbryt hämtning').props.onClick(); h.render()
  assert.equal(h.rows()[0].title, 'Behåll mig')
  h.button('Försök igen').props.onClick(); await h.settle()
  assert.equal(h.requests.length, 3)
})
test('sharing remains an explicit command and uses only the saved schedule', async t => {
  const h = await ready(t)
  h.button('Visa för beställaren').props.onClick(); h.render()
  assert.equal(h.requests.length, 1)
  h.button('Bekräfta delning').props.onClick(); await h.settle()
  const command = JSON.parse(h.requests[1].init.body)
  assert.equal(command.operation, 'share'); assert.equal(command.confirmed, true)
  assert.equal(command.revision, 3)
  assert.deepEqual(command.rows, h.rows())
  assert.match(h.requests[1].url, /\/schedule$/)
})
