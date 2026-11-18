/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled React-hook/DOM harness with synthetic data only. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
type UiNode = { type: any; key?: string; props: Record<string, any> }
const jsx = (type: any, props: Record<string, unknown>, key?: string): UiNode => ({ type, props, key })

function load(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loaded = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', ...Object.keys(globals), compiled)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  }, loaded, loaded.exports, ...Object.values(globals))
  return loaded.exports
}

function nodes(value: any): UiNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  return [value, ...nodes(value.props.children)]
}
function text(value: any): string {
  if (Array.isArray(value)) return value.map(text).join(' ')
  if (value && typeof value === 'object') return text(value.props?.children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
function markup(value: any, key?: string): any {
  if (Array.isArray(value)) return value.map((child, index) => markup(child, `static-${index}`))
  if (!value || typeof value !== 'object' || !('props' in value)) return value
  if (typeof value.type === 'function') return markup(value.type(value.props), value.key ?? key)
  const props = { ...value.props, key: value.key ?? key }
  // Next's Link consumes these properties; the harness renders its native anchor.
  if (value.type === 'a') { delete props.prefetch; delete props.replace; delete props.scroll }
  return createElement(value.type, props, markup(value.props.children))
}

function harness(initialOrg = ORG_A) {
  let organizationId = initialOrg, cursor = 0, nextId = 0, now = 0, timerId = 0
  let activeKey: unknown
  let hooks: Array<{ value?: any; deps?: unknown[]; cleanup?: () => void }> = []
  let pendingEffects: Array<() => void> = []
  const timers = new Map<number, { due: number; run: () => void }>()
  const authListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>()
  const pushes: string[] = [], assigned: string[] = [], signOuts: unknown[] = [], scrolls: string[] = []
  const requests: Array<{ url: URL; options: RequestInit; finish: (value: unknown, status?: number) => void }> = []
  const documentEvents = new EventTarget(), windowEvents = new EventTarget()
  const inputElement = { focus() { documentMock.activeElement = inputElement } }
  const rootElement = { contains(node: unknown) { return node === inputElement || node === rootElement } }
  const documentMock = Object.assign(documentEvents, { activeElement: inputElement as unknown,
    getElementById(id: string) { return { scrollIntoView() { scrolls.push(id) } } } })
  const changed = (before?: unknown[], after?: unknown[]) => !before || !after || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]))
  const react = {
    useState(initial: unknown) { const state = hooks[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [state.value, (value: any) => { state.value = typeof value === 'function' ? value(state.value) : value }] },
    useRef(initial: unknown) { const state = hooks[cursor++] ??= { value: { current: initial } }; return state.value },
    useMemo(factory: () => unknown, dependencies: unknown[]) { const state = hooks[cursor++] ??= {}
      if (changed(state.deps, dependencies)) { state.deps = dependencies; state.value = factory() }; return state.value },
    useId() { const state = hooks[cursor++] ??= { value: `search-${nextId++}` }; return state.value },
    useEffect(effect: () => (() => void) | void, dependencies: unknown[]) { const state = hooks[cursor++] ??= {}
      if (changed(state.deps, dependencies)) { state.deps = dependencies; pendingEffects.push(() => { state.cleanup?.(); const cleanup = effect(); state.cleanup = typeof cleanup === 'function' ? cleanup : undefined }) } },
  }
  const model = load('src/lib/globalSearch/model.ts', {})
  const auth = load('src/lib/auth/returnPath.ts', {})
  const component = load('src/components/search/HusHubSearch.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment }, 'next/link': { default: 'a' },
    'next/navigation': { useRouter: () => ({ push: (path: string) => pushes.push(path) }) },
    'lucide-react': Object.fromEntries(['ArrowUpRight', 'Building2', 'ClipboardCheck', 'FileText', 'LoaderCircle', 'LogIn', 'RefreshCw', 'Search', 'TriangleAlert', 'X'].map(name => [name, 'span'])),
    '@/lib/globalSearch/model': model, '@/lib/auth/returnPath': auth, './HusHubSearch.css': {},
    '@/lib/supabaseClient': { supabase: { auth: {
      onAuthStateChange(callback: (event: string, session: { user: { id: string } } | null) => void) {
        authListeners.add(callback)
        void Promise.resolve().then(() => { if (authListeners.has(callback)) callback('INITIAL_SESSION', { user: { id: USER_A } }) })
        return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } }
      },
      async signOut(options: unknown) { signOuts.push(options); return { error: null } },
    } } },
  }, {
    document: documentMock,
    window: Object.assign(windowEvents, { location: { pathname: '/dashboard-v1', search: `?orgId=${ORG_A}`, hash: '', assign: (path: string) => assigned.push(path) } }),
    fetch: (path: string, options: RequestInit) => new Promise(resolve => requests.push({
      url: new URL(path, 'https://search.example.test'), options,
      finish: (value, status = 200) => resolve({ ok: status >= 200 && status < 300, status, json: async () => value }),
    })),
    setTimeout: (run: () => void, delay: number) => { const id = ++timerId; timers.set(id, { due: now + delay, run }); return id },
    clearTimeout: (id: number) => timers.delete(id),
  })
  function cleanup() { for (const state of hooks) state?.cleanup?.(); pendingEffects = [] }
  function render(): UiNode {
    cursor = 0
    const wrapper = component.default({ organizationId }) as UiNode
    if (!Object.is(activeKey, wrapper.key)) { cleanup(); hooks = []; activeKey = wrapper.key }
    cursor = 0
    const tree = wrapper.type(wrapper.props) as UiNode
    for (const node of nodes(tree)) {
      if (node.type === 'input' && node.props.ref) node.props.ref.current = inputElement
      if (node.props.ref && String(node.props.className).startsWith('hh-search ')) node.props.ref.current = rootElement
    }
    for (const effect of pendingEffects.splice(0)) effect()
    return tree
  }
  function input() { const found = nodes(render()).find(node => node.props.role === 'combobox'); assert.ok(found); return found }
  function button(label: string) { const found = nodes(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node).trim() === label)); assert.ok(found, `Missing ${label}`); return found }
  render()
  return {
    render, requests, pushes, assigned, signOuts, scrolls,
    focus() { input().props.onFocus(); render() },
    change(value: string) { input().props.onChange({ target: { value } }); render() },
    key(key: string) { input().props.onKeyDown({ key, preventDefault() {} }); render() },
    click(label: string) { button(label).props.onClick(); render() },
    scope(org: string) { organizationId = org; render() },
    auth(userId: string | null) { for (const callback of authListeners) callback(userId ? 'SIGNED_IN' : 'SIGNED_OUT', userId ? { user: { id: userId } } : null); render() },
    advance(milliseconds: number) {
      const until = now + milliseconds
      for (;;) { const next = [...timers].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]
        if (!next) break
        now = next[1].due; timers.delete(next[0]); next[1].run()
      }
      now = until; render()
    },
    async settle() { for (let iteration = 0; iteration < 4; iteration++) { await setImmediate(); render() }; return render() },
    answer(index: number, title: string, changes: Record<string, unknown> = {}) {
      const request = requests[index]
      request.finish({ query: request.url.searchParams.get('q'), hasMore: false, issues: [], results: [{ id: `tu:${index}`, moduleId: 'tu', moduleLabel: 'Tekniska utredningar', kind: 'inspection', title, subtitle: 'Svanen 2:1 · Testgatan 1', href: `/tu/investigations/${index}?orgId=${request.url.searchParams.get('orgId')}` }], ...changes })
    },
    dispose() { cleanup(); timers.clear() },
  }
}

test('typing is debounced and late responses cannot replace the current query', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.focus(); ui.change('Svanen')
  ui.advance(249); assert.equal(ui.requests.length, 0)
  ui.advance(1); assert.equal(ui.requests.length, 1)
  assert.equal(ui.requests[0].options.cache, 'no-store'); assert.equal(ui.requests[0].options.credentials, 'same-origin')
  ui.change('Björken'); assert.equal(ui.requests[0].options.signal?.aborted, true)
  ui.advance(250); assert.equal(ui.requests.length, 2)
  ui.answer(1, 'Aktuell utredning'); await ui.settle(); assert.match(text(ui.render()), /Aktuell utredning/)
  ui.answer(0, 'Gammal utredning'); await ui.settle(); assert.doesNotMatch(text(ui.render()), /Gammal utredning/)
  assert.match(text(ui.render()), /Aktuell utredning/)
})

test('returning to an earlier query revalidates instead of reviving a cached snapshot', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.focus(); ui.change('Svanen'); ui.advance(250)
  ui.answer(0, 'Tidigare träff'); await ui.settle(); assert.match(text(ui.render()), /Tidigare träff/)
  ui.change('Björken'); ui.advance(250); ui.change('Svanen')
  assert.doesNotMatch(text(ui.render()), /Tidigare träff/)
  ui.advance(250); ui.answer(2, 'Ny verifierad träff'); await ui.settle()
  ui.answer(1, 'Försenad annan träff'); await ui.settle()
  assert.match(text(ui.render()), /Ny verifierad träff/); assert.doesNotMatch(text(ui.render()), /Tidigare träff|Försenad annan träff/)
  ui.change('Svanen '); assert.match(text(ui.render()), /Ny verifierad träff/, 'Only insignificant whitespace keeps the same verified query')
})

test('organization and identity changes discard results and in-flight requests', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.focus(); ui.change('Svanen'); ui.advance(250)
  ui.answer(0, 'Organisations A träff'); await ui.settle()
  ui.scope(ORG_B); assert.doesNotMatch(text(ui.render()), /Organisations A träff/)
  ui.focus(); ui.change('Svanen'); ui.advance(250); assert.equal(ui.requests[1].url.searchParams.get('orgId'), ORG_B)
  ui.scope(ORG_A); assert.equal(ui.requests[1].options.signal?.aborted, true)
  ui.answer(1, 'Organisations B träff'); await ui.settle(); assert.doesNotMatch(text(ui.render()), /Organisations [AB] träff/)
  ui.focus(); ui.change('Svanen'); ui.advance(250); ui.answer(2, 'Verifierad A träff'); await ui.settle()
  ui.auth(USER_B); assert.doesNotMatch(text(ui.render()), /Verifierad A träff/)
})

test('401 removes old results and offers explicit sign-in with the current return page', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.focus(); ui.change('Svanen'); ui.advance(250)
  ui.answer(0, 'Tidigare behörig träff'); await ui.settle()
  ui.key('Escape'); ui.focus(); assert.doesNotMatch(text(ui.render()), /Tidigare behörig träff/)
  ui.advance(250); ui.requests[1].finish({ error: 'UNAUTHORIZED' }, 401); await ui.settle()
  assert.match(text(ui.render()), /Logga in igen för att söka/); assert.equal(ui.signOuts.length, 0)
  ui.click('Logga in igen'); await ui.settle()
  assert.deepEqual(ui.signOuts, [{ scope: 'local' }])
  assert.equal(ui.assigned.length, 1); const destination = new URL(ui.assigned[0], 'https://search.example.test')
  assert.equal(destination.pathname, '/login'); assert.equal(destination.searchParams.get('next'), `/dashboard-v1?orgId=${ORG_A}`)
})

test('keyboard selection opens a local result and Escape closes the result list', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.focus(); ui.change('Svanen'); ui.advance(250)
  ui.answer(0, 'Tangentbordsträff'); await ui.settle(); ui.key('ArrowDown')
  const option = nodes(ui.render()).find(node => node.props.role === 'option')!
  assert.equal(option.props['aria-selected'], true); assert.equal(ui.scrolls.length, 1)
  ui.key('Enter'); assert.deepEqual(ui.pushes, [`/tu/investigations/0?orgId=${ORG_A}`])
  assert.equal(nodes(ui.render()).some(node => node.props.role === 'option'), false)
  ui.focus(); ui.key('Escape'); assert.equal(nodes(ui.render()).some(node => node.props.role === 'listbox'), false)
})

test('result text is escaped and unsafe destinations fail closed', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.focus(); ui.change('Svanen'); ui.advance(250)
  ui.answer(0, '<script>unsafe()</script>'); await ui.settle()
  const html = renderToStaticMarkup(markup(ui.render()))
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/)
  ui.change('Björken'); ui.advance(250)
  ui.answer(1, 'Otillåten destination', { results: [{ id: 'bad', moduleId: 'tu', moduleLabel: 'TU', kind: 'report', title: 'Otillåten destination', subtitle: '', href: '//outside.example.test/private' }] })
  await ui.settle(); assert.match(text(ui.render()), /Sökningen kunde inte hämtas/)
  assert.equal(nodes(ui.render()).some(node => node.props.role === 'option'), false); assert.equal(ui.pushes.length, 0)
})
