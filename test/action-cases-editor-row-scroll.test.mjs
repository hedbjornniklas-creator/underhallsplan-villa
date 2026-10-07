import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function setup(t, viewport = 800) {
  const hooks = [], effects = [], scrolls = []
  let cursor = 0, changed = 0, bounds = { top: 300, height: 72 }
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: viewport, scrollBy: (options) => scrolls.push(options) }
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow })
  const react = {
    useId: () => 'row-id',
    useRef: (initial) => {
      const slot = cursor++
      return hooks[slot] ??= { current: initial }
    },
    useLayoutEffect: (effect, deps) => {
      const slot = cursor++
      const previous = hooks[slot]
      if (!previous || deps.some((value, index) => value !== previous[index])) effects.push(effect)
      hooks[slot] = deps
    },
  }
  const source = readFileSync(new URL('../src/components/tasks/ProjectEditorRow.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const loaded = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'lucide-react') return { ChevronDown: 'svg' }
    throw new Error('Unexpected dependency: ' + name)
  }, loaded, loaded.exports)
  const render = (open) => {
    cursor = 0
    const row = loaded.exports.default({ title: 'Entreprenor', open, onToggle: () => changed++, children: 'form' })
    const button = row.props.children[0].props.children
    button.props.ref.current = { getBoundingClientRect: () => bounds }
    for (const effect of effects.splice(0)) effect()
    return button
  }
  return { render, scrolls, setBounds: (top, height = 72) => { bounds = { top, height } }, changed: () => changed }
}

test('opening or restoring an editor does not scroll without an explicit row toggle', (t) => {
  const h = setup(t)
  h.render(false)
  h.setBounds(-400)
  h.render(true)
  assert.deepEqual(h.scrolls, [])
})

test('switching sections preserves the clicked heading before the next paint', (t) => {
  const h = setup(t)
  h.setBounds(300)
  h.render(false).props.onClick()
  assert.equal(h.changed(), 1)
  h.setBounds(-250)
  const opened = h.render(true)
  assert.deepEqual(h.scrolls, [{ top: -550, behavior: 'instant' }])
  assert.equal(opened.props['aria-expanded'], true)
  assert.equal(opened.props['aria-controls'], 'row-id')
  h.setBounds(10)
  h.render(true)
  h.render(false)
  assert.equal(h.scrolls.length, 1, 'later saves and external state changes must not reuse the click position')
})

test('a newly opened row near the bottom leaves room for the first fields', (t) => {
  const h = setup(t, 668)
  h.setBounds(590, 66)
  h.render(false).props.onClick()
  h.render(true)
  assert.deepEqual(h.scrolls, [{ top: 244, behavior: 'instant' }])
})

test('closing a visible row does not force its heading to the top of the page', (t) => {
  const h = setup(t)
  h.setBounds(300)
  h.render(true).props.onClick()
  h.render(false)
  assert.deepEqual(h.scrolls, [])
})

test('a small viewport reserves half the height for the opened form', (t) => {
  const h = setup(t, 320)
  h.setBounds(240, 72)
  h.render(false).props.onClick()
  h.render(true)
  assert.deepEqual(h.scrolls, [{ top: 168, behavior: 'instant' }])
})

test('browser scroll anchoring cannot compete with the editor toggle correction', () => {
  const css = readFileSync(new URL('../src/components/tasks/uppdrag-theme.css', import.meta.url), 'utf8')
  assert.match(css, /\.gizmo-editor-scroll-scope\s*\{\s*overflow-anchor:\s*none;/)
  assert.doesNotMatch(css, /(?:html|body)\s*\{[^}]*overflow-anchor:/)
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /className=\{`gizmo-editor-scroll-scope \$\{embedded \?/)
})
