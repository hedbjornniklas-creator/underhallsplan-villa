import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import ts from 'typescript'

type Element = { type: unknown; props: Record<string, unknown> }
type Hook = { value?: unknown; deps?: unknown[]; cleanup?: () => void }
type Request = { url: string; signal: AbortSignal; finish: (payload: unknown, ok?: boolean) => void; fail: (error: Error) => void }
const compiled = ts.transpileModule(readFileSync(new URL('../src/components/ob/ObOverview.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText

// Exercise the real component callbacks/effects with controlled hooks and deferred network replies.
function harness() {
  const hooks: Hook[] = [], requests: Request[] = []
  const browser = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  let cursor = 0, now = 10_000, refreshKey = 0
  let timerId = 0
  const timers = new Map<number, { callback: () => void; at: number }>()
  let effects: (() => void)[] = []
  const changed = (before: unknown[] | undefined, after: unknown[]) => !before || before.length !== after.length || after.some((value, i) => !Object.is(value, before[i]))
  const react = {
    useState(initial: unknown) {
      const hook = hooks[cursor++] ??= { value: initial }
      return [hook.value, (next: unknown) => { hook.value = typeof next === 'function' ? next(hook.value) : next }]
    },
    useRef(initial: unknown) { return (hooks[cursor++] ??= { value: { current: initial } }).value },
    useId() { return `id-${cursor++}` },
    useCallback(callback: unknown, deps: unknown[]) {
      const hook = hooks[cursor++] ??= {}
      if (changed(hook.deps, deps)) { hook.value = callback; hook.deps = deps }
      return hook.value
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const hook = hooks[cursor++] ??= {}
      if (changed(hook.deps, deps)) {
        hook.deps = deps
        effects.push(() => { hook.cleanup?.(); hook.cleanup = effect() })
      }
    },
  }
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props })
  const dependencies: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'lucide-react': {},
    '@/components/ui/ActionButton': { default: 'ActionButton' },
    '@/components/ui/PendingLink': { default: 'PendingLink' },
    '@/lib/ob/overview': { selectObOverview: (items: unknown[]) => items },
    './ob-overview.css': {},
  }
  const loaded = { exports: {} as { default: (props: { refreshKey: number }) => Element } }
  new Function('require', 'module', 'exports', 'window', 'document', 'fetch', 'Date', 'setTimeout', 'clearTimeout', compiled)(
    (name: string) => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name] },
    loaded, loaded.exports, browser, document,
    (url: string, options: { signal: AbortSignal; cache: string }) => {
      assert.equal(options.cache, 'no-store')
      return new Promise((resolve, reject) => requests.push({ url, signal: options.signal,
        finish: (payload, ok = true) => resolve({ ok, json: async () => payload }), fail: reject }))
    },
    class extends Date { static now() { return now } },
    (callback: () => void, delay: number) => { timers.set(++timerId, { callback, at: now + delay }); return timerId },
    (id: number) => timers.delete(id),
  )
  function render(nextRefreshKey = refreshKey) {
    refreshKey = nextRefreshKey
    cursor = 0
    effects = []
    const tree = loaded.exports.default({ refreshKey })
    for (const effect of effects) effect()
    return tree
  }
  function nodes(tree: unknown): Element[] {
    if (Array.isArray(tree)) return tree.flatMap(nodes)
    if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
    const element = tree as Element
    return [element, ...nodes(element.props.children)]
  }
  return {
    requests, render, nodes,
    advance: (ms: number) => {
      now += ms
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback() }
    },
    focus: () => browser.dispatchEvent(new Event('focus')),
    visibility: (state = 'visible') => { document.visibilityState = state; document.dispatchEvent(new Event('visibilitychange')) },
    refresh() {
      const button = nodes(render()).find(node => node.props['aria-label'] === 'Uppdatera uppdragslistan')!
      ;(button.props.onClick as () => void)()
    },
    dispose: () => { for (const hook of hooks) hook?.cleanup?.() },
  }
}

function payload(id: string) {
  return { items: [{ id, date: null, address: id, attention: [] }], total: 1,
    counts: { all: 1, active: 1, closed: 0 }, page: 1, pageSize: 10 }
}

test('focus and visibility share an in-flight load and briefly reuse a successful result', async () => {
  const view = harness()
  try {
    view.render()
    view.focus()
    view.visibility()
    assert.equal(view.requests.length, 1)
    assert.equal(view.requests[0].signal.aborted, false)
    view.requests[0].finish(payload('first'))
    await setImmediate()
    view.focus()
    view.visibility()
    assert.equal(view.requests.length, 1)
    view.advance(5_001)
    view.visibility('hidden')
    view.focus()
    assert.equal(view.requests.length, 1)
    view.visibility()
    view.focus()
    assert.equal(view.requests.length, 2)
    assert.equal(view.requests[1].signal.aborted, false)
  } finally { view.dispose() }
})

test('manual refresh and refreshKey bypass freshness and a superseded reply cannot win', async () => {
  const view = harness()
  try {
    view.render()
    view.requests[0].finish(payload('first'))
    await setImmediate()
    view.refresh()
    assert.equal(view.requests.length, 2)
    view.render(1)
    assert.equal(view.requests.length, 3)
    assert.equal(view.requests[1].signal.aborted, true)
    view.requests[2].finish(payload('latest'))
    await setImmediate()
    view.requests[1].finish(payload('superseded'))
    await setImmediate()
    const rows = view.nodes(view.render()).filter(node => node.props.item)
    assert.deepEqual(rows.map(node => (node.props.item as { id: string }).id), ['latest'])
    assert.equal(view.render().props['aria-busy'], false)
  } finally { view.dispose() }
})

test('failed refresh retains the last list and permits an explicit retry', async () => {
  const view = harness()
  try {
    view.render()
    view.requests[0].finish(payload('retained'))
    await setImmediate()
    view.advance(5_001)
    view.focus()
    view.requests[1].fail(new Error('Network unavailable'))
    await setImmediate()
    const tree = view.render()
    assert.equal(tree.props['aria-busy'], false)
    assert.ok(view.nodes(tree).some(node => node.props.role === 'alert'))
    assert.deepEqual(view.nodes(tree).filter(node => node.props.item).map(node => (node.props.item as { id: string }).id), ['retained'])
    view.refresh()
    assert.equal(view.requests.length, 3)
    view.requests[2].finish(payload('recovered'))
    await setImmediate()
    assert.ok(!view.nodes(view.render()).some(node => node.props.role === 'alert'))
  } finally { view.dispose() }
})

test('page changes request server pages and retain matching old metadata until success or after failure', async () => {
  const view = harness()
  try {
    view.render()
    assert.equal(new URL(view.requests[0].url, 'https://example.invalid').searchParams.get('pageSize'), '10')
    view.requests[0].finish({ ...payload('first-page'), total: 21, counts: { all: 21, active: 15, closed: 6 } })
    await setImmediate()
    const next = view.nodes(view.render()).find(node => node.props['aria-label'] === 'Nästa sida')!
    ;(next.props.onClick as () => void)()
    view.render()
    assert.equal(view.requests.length, 2, 'query change bypasses the freshness throttle')
    assert.equal(new URL(view.requests[1].url, 'https://example.invalid').searchParams.get('page'), '2')
    let tree = view.render()
    assert.ok(view.nodes(tree).some(node => node.props.children === '1–1 av 21 uppdrag'))
    assert.equal(view.nodes(tree).find(node => node.props['aria-label'] === 'Nästa sida')?.props.disabled, true)
    view.requests[1].fail(new Error('Unavailable'))
    await setImmediate()
    tree = view.render()
    assert.ok(view.nodes(tree).some(node => node.props.children === '1–1 av 21 uppdrag'))
    assert.deepEqual(view.nodes(tree).filter(node => node.props.item).map(node => (node.props.item as { id: string }).id), ['first-page'])
    view.refresh()
    // A concurrent deletion clamps page 2 to page 1. Display the response without triggering a fetch loop.
    view.requests[2].finish(payload('clamped-page'))
    await setImmediate()
    view.render()
    view.render()
    assert.equal(view.requests.length, 3)
    assert.ok(view.nodes(view.render()).some(node => node.props.children === '1–1 av 1 uppdrag'))
  } finally { view.dispose() }
})

test('search waits 250ms, resets the server page, and aborts an obsolete query', async () => {
  const view = harness()
  try {
    view.render()
    view.requests[0].finish({ ...payload('old'), page: 2, total: 21 })
    await setImmediate()
    const changeSearch = (value: string) => {
      const input = view.nodes(view.render()).find(node => node.props['aria-label'] === 'Sök uppdrag')!
      ;(input.props.onChange as (event: unknown) => void)({ target: { value } })
      view.render()
    }
    changeSearch('Li')
    view.advance(200)
    changeSearch('Lindvägen')
    view.advance(249)
    view.render()
    assert.equal(view.requests.length, 1)
    view.advance(1)
    view.render()
    assert.equal(view.requests.length, 2)
    const params = new URL(view.requests[1].url, 'https://example.invalid').searchParams
    assert.equal(params.get('search'), 'Lindvägen')
    assert.equal(params.get('page'), '1')
    changeSearch('Täby')
    view.advance(250)
    view.render()
    assert.equal(view.requests.length, 3)
    assert.equal(view.requests[1].signal.aborted, true)
    view.requests[2].finish(payload('current-search'))
    view.requests[1].finish(payload('stale-search'))
    await setImmediate()
    assert.deepEqual(view.nodes(view.render()).filter(node => node.props.item).map(node => (node.props.item as { id: string }).id), ['current-search'])
  } finally { view.dispose() }
})
