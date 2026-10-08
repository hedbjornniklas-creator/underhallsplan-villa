/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled module and React-hook harness. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'

export const organizationA = { id: '11111111-1111-4111-8111-111111111111', name: 'A', isDefault: true }
export const organizationB = { id: '22222222-2222-4222-8222-222222222222', name: 'B', isDefault: false }
export type Element = { type: any; key?: string; props: Record<string, any> }

function load(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const loaded = { exports: {} as Record<string, (...args: any[]) => any> }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  }, loaded, loaded.exports, ...Object.values(globals))
  return loaded.exports
}

export function organizationContextHarness() {
  type Hook = { value?: any; deps?: unknown[]; cleanup?: (() => void) | void }
  type Request = { url: URL; signal: AbortSignal; options: Record<string, unknown>; finish: (body: unknown, ok?: boolean, status?: number) => void; reject: (error: Error) => void }
  const stores = new Map<string, Hook[]>()
  const requests: Request[] = []
  const replacements: string[] = []
  const pushes: string[] = []
  const browser = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const listeners = new Set<(event: string, session: { user: { id: string } } | null) => void>()
  let hooks: Hook[] = [], cursor = 0, pathname = '/ob', search = '', confirmation = false, confirmCount = 0
  let effects: (() => void)[] = []
  let session: { user: { id: string } } | null = { user: { id: 'person-a' } }
  let stateChanged = false
  let switcherNode: Element | null = null
  let contextValue: any
  let contextCount = 0
  let now = 100_000
  class Clock extends Date { static now() { return now } }
  const router = { replace: (url: string) => replacements.push(url), push: (url: string) => pushes.push(url) }
  const changed = (old: unknown[] | undefined, next: unknown[]) => !old || old.length !== next.length || next.some((value, index) => !Object.is(value, old[index]))
  const react = {
    createContext(initial: unknown) {
      const context: any = { value: initial }
      context.Provider = { context, displayName: contextCount++ === 0 ? 'SharedProvider' : 'Provider' }
      return context
    },
    useContext: (context: { value: unknown }) => context.value,
    useState(initial: unknown) {
      const hook = hooks[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [hook.value, (value: any) => {
        const next = typeof value === 'function' ? value(hook.value) : value
        if (!Object.is(next, hook.value)) stateChanged = true
        hook.value = next
      }]
    },
    useRef(initial: unknown) { const hook = hooks[cursor++] ??= { value: { current: initial } }; return hook.value },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const hook = hooks[cursor++] ??= {}
      if (changed(hook.deps, deps)) { hook.deps = deps; hook.value = factory() }
      return hook.value
    },
    useCallback(callback: unknown, deps: unknown[]) { return react.useMemo(() => callback, deps) },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const hook = hooks[cursor++] ??= {}
      if (changed(hook.deps, deps)) {
        hook.deps = deps
        effects.push(() => { hook.cleanup?.(); hook.cleanup = effect() })
      }
    },
  }
  const jsx = (type: any, props: Record<string, unknown>, key?: string) => ({ type, props, key })
  const navigation = load('src/lib/organizations/navigation.ts', {})
  const sharedDependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { default: 'Link' },
    'next/navigation': { useRouter: () => router, usePathname: () => pathname, useSearchParams: () => new URLSearchParams(search) },
    '@/lib/organizations/navigation': navigation,
  }
  const globals = {
    Date: Clock,
    document,
    window: Object.assign(browser, { confirm: () => { confirmCount++; return confirmation }, document }),
    fetch: (url: string, options: { signal: AbortSignal }) => new Promise((resolve, reject) => requests.push({
      url: new URL(url, 'https://test.invalid'), signal: options.signal, options,
      finish: (body: unknown, ok = true, status = ok ? 200 : 403) => resolve({ ok, status, json: async () => body }), reject,
    })),
  }
  const supabase = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange(callback: (event: string, value: typeof session) => void) {
      listeners.add(callback)
      // Supabase emits INITIAL_SESSION asynchronously after installing the listener.
      void Promise.resolve().then(() => { if (listeners.has(callback)) callback('INITIAL_SESSION', session) })
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }
    },
  } }
  const provider = load('src/components/organizations/OrganizationContextProvider.tsx', {
    ...sharedDependencies, '@/lib/supabaseClient': { supabase },
  }, globals)
  const consumerDependencies = {
    ...sharedDependencies,
    '@/components/organizations/OrganizationContextProvider': provider,
    './OrganizationContextProvider': provider,
  }
  const component = load('src/components/ob/ObOrganizationBoundary.tsx', consumerDependencies, globals)
  const switcher = load('src/components/organizations/ActiveOrganizationSwitcher.tsx', {
    ...consumerDependencies, 'lucide-react': { Building2: 'Building2', ChevronDown: 'ChevronDown' },
  }, globals)
  function run<T>(name: string, work: () => T): T {
    if (!stores.has(name)) stores.set(name, [])
    hooks = stores.get(name)!
    cursor = 0
    return work()
  }
  function render(path = pathname, query = search): Element {
    pathname = path; search = query; effects = []; stateChanged = false
    const shared = run('provider', () => (provider.default ?? provider.OrganizationContextProvider)({ children: 'PAGE' }))
    assert.ok(shared.type.context, 'Provider renders its context')
    shared.type.context.value = shared.props.value
    contextValue = provider.useOrganizationContext()
    const result = run('boundary', () => component.default({ children: 'WORK' })) as Element
    switcherNode = run('switcher', () => switcher.default({ isLoggedIn: true, displayName: 'Person A', email: 'a@example.invalid', compact: false }))
    for (const effect of effects) effect()
    if (typeof result.type === 'object' && result.type?.displayName) return { ...result, type: result.type.displayName }
    return result
  }
  return {
    requests, replacements, pushes, render, component, navigation,
    context: () => contextValue,
    switcher: () => switcherNode,
    async ready(path = pathname, query = search) { render(path, query); await setImmediate(); return render() },
    async settle() {
      await setImmediate()
      let result = render()
      for (let iteration = 0; stateChanged && iteration < 5; iteration++) result = render()
      return result
    },
    async finish(index: number, org = organizationA) {
      requests[index].finish({ organization: org, organizations: [organizationA, organizationB] })
      await setImmediate()
    },
    auth(event: string, profileId: string | null) {
      session = profileId ? { user: { id: profileId } } : null
      for (const callback of listeners) callback(event, session)
    },
    focus: () => browser.dispatchEvent(new Event('focus')),
    advance(milliseconds: number) { now += milliseconds },
    guard(dirty: boolean, busy: boolean) {
      effects = []
      run('guard', () => component.useObOrganizationSwitchGuard(dirty, busy))
      for (const effect of effects) effect()
    },
    setConfirmation(value: boolean) { confirmation = value },
    switchAllowed() { return browser.dispatchEvent(new Event('hushub:before-organization-switch', { cancelable: true })) },
    confirmCount: () => confirmCount,
    dispose() { for (const store of stores.values()) for (const hook of store) hook?.cleanup?.() },
  }
}

export function elementText(node: any): string {
  if (Array.isArray(node)) return node.map(elementText).join(' ')
  if (node && typeof node === 'object') return elementText(node.props?.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
