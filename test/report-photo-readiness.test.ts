import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = ts.createSourceFile('renderer.tsx', readFileSync(
  new URL('../src/components/report/ReportRendererClient.tsx', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declaration = source.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(item => item.name.getText(source) === 'ReportPhoto'))
assert.ok(declaration)
const compiled = ts.transpileModule(declaration.getText(source), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

type ImageProps = {
  src: string
  ref: (image: { complete: boolean; naturalWidth: number; naturalHeight: number } | null) => void
  onLoad: () => void
  onError: () => void
  'data-report-ready': string
}

function harness() {
  const hooks: unknown[] = []
  const updates: Array<() => void> = []
  let cursor = 0
  let reducingState = false
  let notifications = 0
  const jsx = (_tag: unknown, props: ImageProps) => ({ props })
  const Photo = new Function('require', 'useMemo', 'useCallback', 'useState', 'useRef', 'toProxyUrl', 'PHOTO_POLICY', 'TRANSPARENT_PIXEL',
    `const exports = {};\n${compiled}\nreturn ReportPhoto;`)(
    (name: string) => { assert.equal(name, 'react/jsx-runtime'); return { jsx } },
    (fn: () => unknown) => fn(), (fn: unknown) => fn,
    (initial: unknown) => {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (next: unknown) => updates.push(() => {
        reducingState = true
        try { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }
        finally { reducingState = false }
      })]
    },
    (initial: unknown) => {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    (src: string) => src, { digitalMaxLongSidePx: 1600, digitalQuality: 72 }, 'fallback-pixel'
  ) as (props: { src: string; alt: string; onSettled: () => void }) => { props: ImageProps }

  return {
    render(src = 'photo-a'): ImageProps {
      cursor = 0
      return Photo({ src, alt: 'Test', onSettled: () => {
        assert.equal(reducingState, false, 'Parent pagination must not update inside a child state updater')
        notifications++
      } }).props
    },
    flush() { while (updates.length) updates.shift()!() },
    notifications: () => notifications,
  }
}

test('cached images settle once even when the ref callback and load event both fire', () => {
  const h = harness(), image = h.render()
  image.ref({ complete: true, naturalWidth: 100, naturalHeight: 70 })
  image.onLoad()
  h.flush()
  const rerendered = h.render()
  rerendered.ref({ complete: true, naturalWidth: 100, naturalHeight: 70 })
  h.flush()
  assert.equal(h.notifications(), 1)
  assert.equal(rerendered['data-report-ready'], '1')
})

test('loading images remain pending until load and notify outside the child state updater', () => {
  const h = harness(), image = h.render()
  image.ref({ complete: false, naturalWidth: 0, naturalHeight: 0 })
  assert.equal(image['data-report-ready'], '0')
  assert.equal(h.notifications(), 0)
  image.onLoad()
  h.flush()
  assert.equal(h.notifications(), 1)
  assert.equal(h.render()['data-report-ready'], '1')
})

test('a failed image settles once and its fallback does not cause a pagination loop', () => {
  const h = harness()
  h.render().onError()
  h.flush()
  const fallback = h.render()
  assert.equal(fallback.src, 'fallback-pixel')
  assert.equal(fallback['data-report-ready'], '1')
  fallback.onLoad()
  h.flush()
  assert.equal(h.notifications(), 1)
})

test('changing image source requires a new settled notification, including returning to the old source', () => {
  const h = harness()
  for (const src of ['photo-a', 'photo-b', 'photo-a']) {
    const image = h.render(src)
    assert.equal(image['data-report-ready'], '0')
    image.onLoad()
    h.flush()
    assert.equal(h.render(src)['data-report-ready'], '1')
  }
  assert.equal(h.notifications(), 3)
})
