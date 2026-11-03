import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const jsx = (type, props) => ({ type, props })
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []

function harness(initialHeight = 374) {
  const state = [], effects = new Map(), observers = [], captures = new Set(), requests = []
  let cursor = 0, queued = [], focused = false, actualHeight = initialHeight
  const viewportRef = { current: { getBoundingClientRect: () => ({ height: actualHeight }) } }
  const react = {
    useId() { cursor++; return 'gantt-viewport' },
    useRef(value) { const i = cursor++; return state[i] ??= { current: value } },
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useEffect(fn, deps = []) { const i = cursor++, before = effects.get(i); if (!before || deps.some((value, index) => !Object.is(value, before.deps[index]))) queued.push({ i, fn, deps }) },
  }
  class ResizeObserver {
    constructor(fn) { this.fn = fn; observers.push(this) }
    observe(node) { this.node = node }
    disconnect() { this.disconnected = true }
  }
  const source = readFileSync(new URL('../src/components/tasks/ProjectScheduleGanttViewport.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', 'ResizeObserver', 'fetch', code)(name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) })
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports, ResizeObserver, (...args) => { requests.push(args); throw new Error('Resizing must never save or share') })
  const children = jsx('p', { children: 'Existing timeline' })
  const render = () => {
    cursor = 0; queued = []
    const tree = compiled.exports.default({ children, viewportRef })
    const region = nodes(tree).find(node => node.props.role === 'region')
    actualHeight = region.props.style?.height ?? initialHeight
    for (const effect of queued) { effects.get(effect.i)?.cleanup?.(); effects.set(effect.i, { ...effect, cleanup: effect.fn() }) }
    observers.filter(observer => !observer.disconnected).forEach(observer => observer.fn())
    return tree
  }
  const find = role => nodes(render()).find(node => node.props.role === role)
  const target = { focus() { focused = true }, setPointerCapture(id) { captures.add(id) }, hasPointerCapture(id) { return captures.has(id) }, releasePointerCapture(id) { captures.delete(id) } }
  const event = (extra = {}) => ({ pointerId: 1, button: 0, isPrimary: true, clientY: 400, currentTarget: target, preventDefault() { this.prevented = true }, ...extra })
  return {
    render, find, requests, observers, captures, viewportRef, children,
    event, focused: () => focused,
    handle: () => find('separator'),
    region: () => find('region'),
    reset: () => nodes(render()).find(node => node.type === 'button'),
    height: () => find('region').props.style?.height,
    pointer(type, extra) { const e = event(extra); find('separator').props[type](e); render(); return e },
    key(key, extra = {}) { const e = event({ key, ...extra }); find('separator').props.onKeyDown(e); render(); return e },
    dispose() { for (const effect of effects.values()) effect.cleanup?.() },
  }
}

test('the handle measures and controls the same scroll region without writes or changing children', t => {
  const h = harness(); t.after(h.dispose); h.render()
  assert.equal(h.region().props.style, undefined)
  assert.equal(h.region().props.children, h.children)
  assert.equal(h.handle().props['aria-controls'], h.region().props.id)
  assert.equal(h.handle().props['aria-valuenow'], 374)
  assert.equal(h.handle().props['aria-orientation'], 'horizontal')
  assert.equal(h.reset().props.disabled, true)
  assert.equal(h.observers.length, 1)
  assert.equal(h.observers[0].node, h.viewportRef.current)
  assert.equal(h.requests.length, 0)
  h.dispose(); assert.equal(h.observers[0].disconnected, true)
})

test('mouse and touch resize from actual height, capture the pointer and clamp both limits', t => {
  const h = harness(); t.after(h.dispose)
  assert.equal(h.pointer('onPointerDown').prevented, true)
  assert.equal(h.focused(), true); assert.equal(h.captures.has(1), true)
  h.pointer('onPointerMove', { clientY: 550 })
  assert.equal(h.height(), 524)
  assert.equal(h.region().props.style.maxHeight, 524)
  h.pointer('onPointerMove', { clientY: 10000 }); assert.equal(h.height(), 1000)
  h.pointer('onPointerMove', { clientY: -10000 }); assert.equal(h.height(), 180)
  h.pointer('onPointerUp'); assert.equal(h.captures.size, 0)
  h.pointer('onPointerMove', { clientY: 600 }); assert.equal(h.height(), 180)
  h.pointer('onPointerDown', { pointerId: 2, pointerType: 'touch', clientY: 200 })
  h.pointer('onPointerMove', { pointerId: 2, pointerType: 'touch', clientY: 300 })
  assert.equal(h.height(), 280)
  h.pointer('onPointerUp', { pointerId: 2 })
  assert.equal(h.handle().props['aria-valuetext'], '280 pixlar')
  assert.equal(h.requests.length, 0)
})

test('other pointers, secondary buttons and lost capture cannot move the viewport', t => {
  const h = harness(); t.after(h.dispose)
  h.pointer('onPointerDown', { button: 2 }); h.pointer('onPointerMove', { clientY: 600 })
  assert.equal(h.height(), undefined)
  h.pointer('onPointerDown', { isPrimary: false }); assert.equal(h.captures.size, 0)
  h.pointer('onPointerDown')
  h.pointer('onPointerDown', { pointerId: 2, clientY: 500 })
  h.pointer('onPointerMove', { pointerId: 2, clientY: 700 })
  h.pointer('onPointerUp', { pointerId: 2 })
  assert.equal(h.height(), undefined)
  h.pointer('onPointerMove', { clientY: 450 }); assert.equal(h.height(), 424)
  h.handle().props.onLostPointerCapture(); h.render()
  h.pointer('onPointerMove', { clientY: 650 }); assert.equal(h.height(), 424)
})

test('pointer cancellation and Escape restore the previous auto or explicit height', t => {
  const h = harness(); t.after(h.dispose)
  h.pointer('onPointerDown'); h.pointer('onPointerMove', { clientY: 500 })
  h.pointer('onPointerCancel'); assert.equal(h.height(), undefined)
  assert.equal(h.captures.size, 0)
  h.key('ArrowDown'); assert.equal(h.height(), 414)
  h.pointer('onPointerDown'); h.pointer('onPointerMove', { clientY: 600 })
  assert.equal(h.key('Escape').prevented, true)
  assert.equal(h.height(), 414); assert.equal(h.captures.size, 0)
  h.pointer('onPointerMove', { clientY: 800 }); assert.equal(h.height(), 414)
})

test('keyboard steps, boundaries and reset are read-only and retain current scroll content', t => {
  const h = harness(); t.after(h.dispose)
  assert.equal(h.key('ArrowDown').prevented, true); assert.equal(h.height(), 414)
  h.key('ArrowUp', { shiftKey: true }); assert.equal(h.height(), 314)
  h.key('Home'); assert.equal(h.height(), 180)
  h.key('ArrowUp'); assert.equal(h.height(), 180)
  h.key('End'); assert.equal(h.height(), 1000)
  h.key('ArrowDown', { shiftKey: true }); assert.equal(h.height(), 1000)
  assert.equal(h.key('Tab').prevented, undefined); assert.equal(h.height(), 1000)
  assert.equal(h.reset().props.disabled, false)
  h.reset().props.onClick(); h.render()
  assert.equal(h.height(), undefined); assert.equal(h.handle().props['aria-valuenow'], 374)
  assert.equal(h.region().props.children, h.children)
  assert.equal(h.requests.length, 0)
})

test('CSS keeps height overrides responsive and touch dragging local to the resize handle', () => {
  const css = readFileSync(new URL('../src/components/tasks/project-schedule.css', import.meta.url), 'utf8')
  assert.match(css, /\.gizmo-gantt-viewport\s*\{[^}]*min-height:\s*180px;[^}]*overflow:\s*auto/)
  assert.match(css, /\.gizmo-gantt-resizer\s*\{[^}]*touch-action:\s*none/)
  assert.match(css, /@media[\s\S]*\.gizmo-gantt-resizer\s*\{\s*height:\s*44px/)
  const source = readFileSync(new URL('../src/components/tasks/ProjectScheduleGantt.tsx', import.meta.url), 'utf8')
  assert.match(source, /timeline \? <ProjectScheduleGanttViewport viewportRef=\{viewport\}>/)
})
