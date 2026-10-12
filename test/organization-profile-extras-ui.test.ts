import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { AddonEntry, CertificationEntry, ProfileExtraMutation, ProfileExtrasWorkspace } from '../src/lib/organizations/profileExtrasTypes'

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROFILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_PROFILE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CERTIFICATION = '11111111-1111-4111-8111-111111111111'
const MEMBERSHIP = '22222222-2222-4222-8222-222222222222'
const ADDON = '33333333-3333-4333-8333-333333333333'
const SECOND_ADDON = '44444444-4444-4444-8444-444444444444'
const DEBOUNCE = 700
const ENDPOINT = '/api/organizations/member-profile/extras'
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function workspace(overrides: Partial<ProfileExtrasWorkspace> = {}): ProfileExtrasWorkspace {
  return {
    orgId: ORG, profileId: PROFILE,
    certifications: [
      {
        id: CERTIFICATION, key: 'certification', name: 'Besiktningscertifiering', description: 'Befintlig certifiering', exists: true,
        category: 'certification', requiresNumber: true, requiresValidTo: true,
        numberLabel: 'Certifikatnummer', validToLabel: 'Giltig till',
        value: { enabled: true, number: 'CERT-123', date: '2028-06-01' },
      },
      {
        id: MEMBERSHIP, key: 'membership', name: 'Föreningsmedlemskap', description: null, exists: true,
        category: 'membership', requiresNumber: true, requiresValidTo: false,
        numberLabel: 'Medlemsnummer', validToLabel: null,
        value: { enabled: true, number: 'MEMBER-456', date: '' },
      },
    ],
    addons: [
      { id: ADDON, key: 'radon', name: 'Radonmätning', description: 'Kundval', exists: true, currency: 'SEK', value: { enabled: true, price: '1500' } },
      { id: SECOND_ADDON, key: 'energy', name: 'Energirådgivning', description: null, exists: true, currency: 'SEK', value: { enabled: false, price: '900' } },
    ],
    ...overrides,
  }
}

type UiNode = { type: unknown; props: Record<string, unknown>; key?: unknown }
type VisibleNode = UiNode & { disabled: boolean }
type FetchCall = { url: string; init?: RequestInit }
type Effect = { dependencies?: readonly unknown[]; cleanup?: () => void }
type PendingEffect = { index: number; dependencies?: readonly unknown[]; run: () => void | (() => void) }
type Instance = { hooks: unknown[]; effects: Map<number, Effect>; pending: PendingEffect[] }
type Memo = { dependencies?: readonly unknown[]; value: unknown }
const jsx = (type: unknown, props: Record<string, unknown>, key?: unknown): UiNode => ({ type, props, key })

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object' && 'props' in value) return text((value as UiNode).props.children)
  return ''
}

function nodes(value: unknown, disabled = false): VisibleNode[] {
  if (Array.isArray(value)) return value.flatMap(child => nodes(child, disabled))
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const node = value as UiNode
  const isDisabled = disabled || node.props.disabled === true
  return [{ ...node, disabled: isDisabled }, ...nodes(node.props.children, isDisabled)]
}

function deferred() {
  let resolve!: (response: Response) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function harness(initial = workspace()) {
  const instances = new Map<string, Instance>()
  const componentIds = new Map<unknown, number>()
  let active!: Instance
  let cursor = 0
  let mounted = true
  let identity = { orgId: initial.orgId, profileId: initial.profileId }
  let serverWorkspace = structuredClone(initial)
  let now = 0
  let nextTimer = 1
  const timers = new Map<number, { due: number; run: () => void }>()
  const calls: FetchCall[] = []
  const events = new EventTarget()
  const confirmations: string[] = []
  let confirmAnswer = true
  const setTimeoutMock = (run: () => void, delay = 0) => {
    const id = nextTimer++
    timers.set(id, { due: now + delay, run })
    return id
  }
  const clearTimeoutMock = (id: number) => { timers.delete(id) }
  const windowMock = {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events), setTimeout: setTimeoutMock, clearTimeout: clearTimeoutMock,
    confirm: (message: string) => { confirmations.push(message); return confirmAnswer },
  }
  const sameDependencies = (previous?: readonly unknown[], next?: readonly unknown[]) =>
    previous !== undefined && next !== undefined && previous.length === next.length &&
    next.every((value, index) => Object.is(value, previous[index]))
  const react = {
    useState(initialValue: unknown) {
      const index = cursor++
      const state = active.hooks
      if (!(index in state)) state[index] = typeof initialValue === 'function' ? initialValue() : initialValue
      return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef(current: unknown) {
      const index = cursor++
      if (!(index in active.hooks)) active.hooks[index] = { current }
      return active.hooks[index]
    },
    useMemo(compute: () => unknown, dependencies?: readonly unknown[]) {
      const index = cursor++
      const previous = active.hooks[index] as Memo | undefined
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) active.hooks[index] = { dependencies, value: compute() }
      return (active.hooks[index] as Memo).value
    },
    useCallback(callback: unknown, dependencies?: readonly unknown[]) { return react.useMemo(() => callback, dependencies) },
    useEffect(run: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = cursor++
      if (!active.effects.has(index) || !sameDependencies(active.effects.get(index)?.dependencies, dependencies)) {
        active.pending.push({ index, dependencies, run })
      }
    },
  }
  const moduleCache = new Map<string, unknown>()
  function requireMock(name: string): unknown {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('Fragment') }
    if (name === 'lucide-react') return {}
    if (name === '@/lib/organizations/profileExtrasTypes') {
      if (!moduleCache.has(name)) {
        const imported = { exports: {} }
        new Function('require', 'module', 'exports', compile('src/lib/organizations/profileExtrasTypes.ts'))(requireMock, imported, imported.exports)
        moduleCache.set(name, imported.exports)
      }
      return moduleCache.get(name)
    }
    throw new Error(`Unexpected dependency ${name}`)
  }
  const helpers = requireMock('@/lib/organizations/profileExtrasTypes') as { parseProfileExtraMutation: (body: unknown) => ProfileExtraMutation }
  function defaultReply(call: FetchCall): Response {
    if (call.init?.method === 'PUT') {
      const mutation = helpers.parseProfileExtraMutation(JSON.parse(String(call.init.body)))
      assert.equal(mutation.orgId, serverWorkspace.orgId)
      const entries = mutation.kind === 'certification' ? serverWorkspace.certifications : serverWorkspace.addons
      const index = entries.findIndex(entry => entry.id === mutation.id)
      assert.ok(index >= 0)
      assert.deepEqual(mutation.expected, entries[index].exists ? entries[index].value : null)
      const entry = { ...entries[index], exists: true, value: mutation.values }
      entries[index] = entry as CertificationEntry & AddonEntry
      return Response.json({ orgId: serverWorkspace.orgId, profileId: serverWorkspace.profileId, kind: mutation.kind, entry })
    }
    assert.equal(call.url, `${ENDPOINT}?orgId=${encodeURIComponent(serverWorkspace.orgId)}`)
    return Response.json({ workspace: serverWorkspace })
  }
  let responder: (call: FetchCall) => Response | Promise<Response> = defaultReply
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', 'fetch', 'window', 'setTimeout', 'clearTimeout', compile('src/components/organizations/OrganizationProfileExtras.tsx'))(
    requireMock, compiledModule, compiledModule.exports,
    async (url: string, init?: RequestInit) => { const call = { url, init }; calls.push(call); return responder(call) },
    windowMock, setTimeoutMock, clearTimeoutMock,
  )
  const component = compiledModule.exports as { default: (props: { orgId: string; profileId: string }) => UiNode }
  function cleanup(instance: Instance) {
    for (const effect of instance.effects.values()) effect.cleanup?.()
    instance.effects.clear()
    instance.pending.length = 0
  }
  function render() {
    assert.equal(mounted, true, 'Cannot render an unmounted editor')
    const visited = new Set<string>()
    function expand(value: unknown, path: string): unknown {
      if (Array.isArray(value)) return value.map((child, index) => expand(child, `${path}/${index}`))
      if (!value || typeof value !== 'object' || !('props' in value)) return value
      const node = value as UiNode
      const nodePath = `${path}:${String(node.key ?? '')}`
      if (typeof node.type === 'function') {
        if (!componentIds.has(node.type)) componentIds.set(node.type, componentIds.size + 1)
        const instancePath = `${nodePath}:${componentIds.get(node.type)}`
        if (!instances.has(instancePath)) instances.set(instancePath, { hooks: [], effects: new Map(), pending: [] })
        visited.add(instancePath)
        active = instances.get(instancePath)!
        cursor = 0
        const output = node.type(node.props)
        return { ...node, props: { ...node.props, children: expand(output, `${instancePath}/output`) } }
      }
      return { ...node, props: { ...node.props, children: expand(node.props.children, `${nodePath}/children`) } }
    }
    const tree = expand(jsx(component.default, identity), 'root')
    for (const [key, instance] of instances) {
      if (!visited.has(key)) { cleanup(instance); instances.delete(key) }
    }
    for (const instance of instances.values()) {
      for (const effect of instance.pending.splice(0)) {
        instance.effects.get(effect.index)?.cleanup?.()
        const effectCleanup = effect.run()
        instance.effects.set(effect.index, { dependencies: effect.dependencies, cleanup: typeof effectCleanup === 'function' ? effectCleanup : undefined })
      }
    }
    return tree
  }
  const all = () => nodes(render())
  function row(id: string) {
    const found = all().find(node => (node.props.initialEntry as { id?: string } | undefined)?.id === id)
    assert.ok(found, `Missing row ${id}`)
    return found
  }
  function input(id: string, label: string) {
    const content = nodes(row(id))
    const labelNode = content.find(node => node.type === 'label' && text(node).trim().replace(/\s*\*$/u, '') === label)
    const found = content.find(node => node.type === 'input' && (node.props['aria-label'] === label || (labelNode?.props.htmlFor && labelNode.props.htmlFor === node.props.id)))
    assert.ok(found, `Missing input ${label} in ${id}`)
    return found
  }
  function button(id: string, label: string) {
    const found = nodes(row(id)).find(node => node.type === 'button' && text(node).trim() === label)
    assert.ok(found, `Missing button ${label} in ${id}`)
    return found
  }
  async function settle() {
    for (let index = 0; index < 5; index++) {
      if (mounted) render()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    return mounted ? render() : null
  }
  return {
    calls, confirmations, defaultReply, render, all, row, input, button, settle,
    setResponder(next: typeof responder) { responder = next },
    setConfirm(answer: boolean) { confirmAnswer = answer },
    setServerWorkspace(next: ProfileExtrasWorkspace) { serverWorkspace = structuredClone(next) },
    replaceWorkspace(next: ProfileExtrasWorkspace) { identity = { orgId: next.orgId, profileId: next.profileId }; serverWorkspace = structuredClone(next); render() },
    async advance(milliseconds: number) {
      const end = now + milliseconds
      for (;;) {
        const pending = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
        if (!pending) break
        now = pending[1].due; timers.delete(pending[0]); pending[1].run(); await settle()
      }
      now = end
      return settle()
    },
    change(id: string, label: string, value: string | boolean) {
      const control = input(id, label)
      assert.equal(control.disabled, false, `${label} must be editable by the member`)
      ;(control.props.onChange as (event: unknown) => void)({ target: { value, checked: value } })
      render()
    },
    click(id: string, label: string) {
      const control = button(id, label)
      assert.equal(control.disabled, false, `${label} must be enabled`)
      ;(control.props.onClick as () => void)()
      render()
    },
    dispatchSwitch(confirmed = false) {
      render()
      const event = new CustomEvent('hushub:before-organization-switch', { cancelable: true, detail: { confirmed } })
      events.dispatchEvent(event)
      return { prevented: event.defaultPrevented, confirmed: event.detail.confirmed }
    },
    unload() {
      render()
      const event = new Event('beforeunload', { cancelable: true })
      events.dispatchEvent(event)
      return event.defaultPrevented
    },
    dispose() { for (const instance of instances.values()) cleanup(instance); instances.clear(); mounted = false },
  }
}

const writes = (ui: ReturnType<typeof harness>) => ui.calls.filter(call => call.init?.method === 'PUT')
const body = (call: FetchCall) => JSON.parse(String(call.init?.body))

test('opening member extras loads the selected organization and preserves existing values without writes', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle(); await ui.advance(DEBOUNCE * 5)
  assert.equal(ui.calls.length, 1)
  assert.equal(ui.calls[0].url, `${ENDPOINT}?orgId=${ORG}`)
  assert.equal(ui.calls[0].init?.credentials ?? 'same-origin', 'same-origin')
  assert.equal(writes(ui).length, 0)
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'CERT-123')
  assert.equal(ui.input(CERTIFICATION, 'Giltig till').props.value, '2028-06-01')
  assert.equal(ui.input(MEMBERSHIP, 'Medlemsnummer').props.value, 'MEMBER-456')
  assert.equal(ui.input(CERTIFICATION, 'Använd i min profil: Besiktningscertifiering').props.checked, true)
  assert.equal(ui.input(ADDON, 'Erbjud till kunder: Radonmätning').props.checked, true)
})

test('rapid member edits save only the changed row after the debounce with its exact stored baseline', async t => {
  const initial = workspace()
  initial.certifications[0].value.number = '  STORED-123  '
  const ui = harness(initial); t.after(ui.dispose)
  await ui.settle()
  ui.change(CERTIFICATION, 'Certifikatnummer', 'CERT-2'); await ui.advance(300)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'CERT-234'); await ui.advance(DEBOUNCE - 1)
  assert.equal(writes(ui).length, 0)
  await ui.advance(1)
  assert.equal(writes(ui).length, 1)
  assert.equal(writes(ui)[0].url, ENDPOINT)
  assert.equal(writes(ui)[0].init?.credentials ?? 'same-origin', 'same-origin')
  assert.deepEqual(body(writes(ui)[0]), {
    orgId: ORG, kind: 'certification', id: CERTIFICATION,
    expected: initial.certifications[0].value,
    values: { enabled: true, number: 'CERT-234', date: '2028-06-01' },
  })
  assert.equal(ui.input(MEMBERSHIP, 'Medlemsnummer').props.value, 'MEMBER-456')
  await ui.advance(DEBOUNCE * 5)
  assert.equal(writes(ui).length, 1)
})

test('new catalog entries are not created until edited and enabled certification requirements gate autosave', async t => {
  const initial = workspace()
  initial.certifications[0] = { ...initial.certifications[0], exists: false, value: { enabled: false, number: '', date: '' } }
  const ui = harness(initial); t.after(ui.dispose)
  await ui.settle(); await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 0)
  ui.change(CERTIFICATION, 'Använd i min profil: Besiktningscertifiering', true)
  await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 0)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'NEW-123'); await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 0)
  ui.change(CERTIFICATION, 'Giltig till', '2026-02-30'); await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 0)
  ui.change(CERTIFICATION, 'Giltig till', '2028-02-29'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(body(writes(ui)[0]).expected, null)
  assert.deepEqual(body(writes(ui)[0]).values, { enabled: true, number: 'NEW-123', date: '2028-02-29' })
  ui.change(CERTIFICATION, 'Certifikatnummer', '')
  ui.change(CERTIFICATION, 'Giltig till', '')
  await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 1)
  ui.change(CERTIFICATION, 'Använd i min profil: Besiktningscertifiering', false)
  await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 2, 'Missing required fields must not prevent disabling a certification')
  assert.deepEqual(body(writes(ui)[1]).values, { enabled: false, number: '', date: '' })
})

test('disabling an existing certification preserves its number and validity date', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.change(CERTIFICATION, 'Använd i min profil: Besiktningscertifiering', false)
  await ui.advance(DEBOUNCE)
  assert.deepEqual(body(writes(ui)[0]).values, { enabled: false, number: 'CERT-123', date: '2028-06-01' })
  assert.equal(writes(ui).length, 1)
})

test('a pending row save retains newer edits and other rows can save independently', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  const pending = deferred()
  ui.setResponder(call => call.init?.method === 'PUT' && body(call).id === CERTIFICATION ? pending.promise : ui.defaultReply(call))
  ui.change(CERTIFICATION, 'Certifikatnummer', 'CERT-FIRST'); await ui.advance(DEBOUNCE)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'CERT-SECOND')
  ui.change(MEMBERSHIP, 'Medlemsnummer', 'MEMBER-NEW')
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 2, 'Different rows can save while only one write per row is in flight')
  assert.equal(body(writes(ui)[1]).id, MEMBERSHIP)
  pending.resolve(ui.defaultReply(writes(ui)[0])); await ui.settle()
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'CERT-SECOND')
  ui.setResponder(ui.defaultReply); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 3)
  assert.deepEqual(body(writes(ui)[2]).expected, { enabled: true, number: 'CERT-FIRST', date: '2028-06-01' })
  assert.equal(body(writes(ui)[2]).values.number, 'CERT-SECOND')
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 3)
})

test('server normalization is adopted without another autosave', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.change(CERTIFICATION, 'Certifikatnummer', '  CERT-TRIMMED  ')
  await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'CERT-TRIMMED')
  await ui.advance(DEBOUNCE * 5)
  assert.equal(writes(ui).length, 1)
})

test('late loading responses cannot replace the newly selected organization', async t => {
  const ui = harness(); t.after(ui.dispose)
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.render()
  const next = workspace({ orgId: OTHER_ORG })
  next.certifications[0].value.number = 'OTHER-ORG-CERT'
  ui.setResponder(ui.defaultReply); ui.replaceWorkspace(next); await ui.settle()
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'OTHER-ORG-CERT')
  pending.resolve(Response.json({ workspace: workspace() })); await ui.settle()
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'OTHER-ORG-CERT')
  ui.change(CERTIFICATION, 'Certifikatnummer', 'CHANGED-OTHER-ORG'); await ui.advance(DEBOUNCE)
  assert.equal(body(writes(ui)[0]).orgId, OTHER_ORG)
  assert.equal(body(writes(ui)[0]).expected.number, 'OTHER-ORG-CERT')
})

test('changing organization or member identity cancels old queued row writes', async t => {
  for (const next of [workspace({ orgId: OTHER_ORG }), workspace({ profileId: OTHER_PROFILE })]) {
    const ui = harness(); t.after(ui.dispose)
    await ui.settle()
    ui.change(CERTIFICATION, 'Certifikatnummer', 'OLD-UNSENT-DRAFT')
    next.certifications[0].value.number = 'NEW-IDENTITY'
    ui.replaceWorkspace(next); await ui.settle(); await ui.advance(DEBOUNCE * 3)
    assert.equal(writes(ui).length, 0)
    assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'NEW-IDENTITY')
  }
})

test('a late save response cannot affect rows in a newly selected organization', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'OLD-PENDING'); await ui.advance(DEBOUNCE)
  const oldReply = ui.defaultReply(writes(ui)[0])
  const next = workspace({ orgId: OTHER_ORG })
  next.certifications[0].value.number = 'NEW-ORG'
  ui.setResponder(ui.defaultReply); ui.replaceWorkspace(next); await ui.settle()
  pending.resolve(oldReply); await ui.settle()
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'NEW-ORG')
  ui.change(CERTIFICATION, 'Certifikatnummer', 'NEW-ORG-CHANGED'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 2)
  assert.equal(body(writes(ui)[1]).orgId, OTHER_ORG)
  assert.equal(body(writes(ui)[1]).expected.number, 'NEW-ORG')
})

test('unmount cancels queued row autosaves', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.change(CERTIFICATION, 'Certifikatnummer', 'UNSENT-DRAFT')
  ui.dispose(); await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 0)
})

test('addon prices accept Swedish decimals and normalize once while invalid prices never write', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  for (const invalid of ['-1', '1e3', '1,000,50', 'NaN', '10000000000']) {
    ui.change(ADDON, 'Pris (SEK)', invalid); await ui.advance(DEBOUNCE * 2)
    assert.equal(writes(ui).length, 0, `${invalid} must not be saved`)
    assert.match(text(ui.row(ADDON)), /giltigt pris/u)
  }
  ui.change(ADDON, 'Pris (SEK)', '1234,50'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.deepEqual(body(writes(ui)[0]), {
    orgId: ORG, kind: 'addon', id: ADDON,
    expected: { enabled: true, price: '1500' }, values: { enabled: true, price: '1234,50' },
  })
  assert.equal(ui.input(ADDON, 'Pris (SEK)').props.value, '1234.5')
  assert.equal(ui.input(SECOND_ADDON, 'Pris (SEK)').props.value, '900')
  await ui.advance(DEBOUNCE * 5)
  assert.equal(writes(ui).length, 1)
  ui.change(ADDON, 'Erbjud till kunder: Radonmätning', false); await ui.advance(DEBOUNCE)
  assert.deepEqual(body(writes(ui)[1]).values, { enabled: false, price: '1234.5' })
})

test('blank addon prices remain blank and expose their zero-price consequence', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.change(ADDON, 'Pris (SEK)', '')
  assert.match(text(ui.row(ADDON)), /0 SEK/u)
  await ui.advance(DEBOUNCE)
  assert.deepEqual(body(writes(ui)[0]).values, { enabled: true, price: '' })
  assert.equal(ui.input(ADDON, 'Pris (SEK)').props.value, '')
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 1)
})

test('network failure pauses only its row and explicit retry saves the latest draft', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.setResponder(call => call.init?.method === 'PUT' && body(call).id === CERTIFICATION
    ? Promise.reject(new Error('Offline')) : ui.defaultReply(call))
  ui.change(CERTIFICATION, 'Certifikatnummer', 'FAILED-DRAFT'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'FAILED-DRAFT')
  assert.match(text(ui.row(CERTIFICATION)), /Kunde inte spara/u)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'LATEST-DRAFT'); await ui.advance(DEBOUNCE * 5)
  assert.equal(writes(ui).length, 1, 'Editing after a failure must not retry automatically')
  ui.change(ADDON, 'Pris (SEK)', '1800'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 2)
  assert.equal(body(writes(ui)[1]).id, ADDON)
  ui.setResponder(ui.defaultReply); ui.click(CERTIFICATION, 'Försök spara igen'); await ui.settle()
  assert.equal(writes(ui).length, 3)
  assert.deepEqual(body(writes(ui)[2]).expected, workspace().certifications[0].value)
  assert.equal(body(writes(ui)[2]).values.number, 'LATEST-DRAFT')
  assert.doesNotMatch(text(ui.row(CERTIFICATION)), /Kunde inte spara/u)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'AFTER-RETRY'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 4, 'A successful explicit retry restores autosaving')
})

test('a conflict requires an explicit row reload and preserves another row draft', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.setResponder(call => call.init?.method === 'PUT'
    ? Response.json({ code: 'ORG_PROFILE_CARD_CONFLICT' }, { status: 409 }) : ui.defaultReply(call))
  ui.change(CERTIFICATION, 'Certifikatnummer', 'CONFLICTING-DRAFT'); await ui.advance(DEBOUNCE)
  assert.match(text(ui.row(CERTIFICATION)), /ändrats i ett annat fönster/u)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'STILL-LOCAL'); await ui.advance(DEBOUNCE * 5)
  assert.equal(writes(ui).length, 1)
  assert.equal(nodes(ui.row(CERTIFICATION)).some(node => node.type === 'button' && /Spara nu|Försök spara igen/u.test(text(node))), false)
  const saved = workspace()
  saved.certifications[0].value.number = 'FROM-OTHER-WINDOW'
  ui.setServerWorkspace(saved); ui.setResponder(ui.defaultReply)
  ui.change(MEMBERSHIP, 'Medlemsnummer', 'UNSAVED-OTHER-ROW')
  ui.setConfirm(false); ui.click(CERTIFICATION, 'Hämta sparade uppgifter'); await ui.settle()
  assert.equal(ui.calls.length, 2)
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'STILL-LOCAL')
  ui.setConfirm(true); ui.click(CERTIFICATION, 'Hämta sparade uppgifter'); await ui.settle()
  assert.equal(ui.calls.length, 3)
  assert.equal(ui.calls[2].url, `${ENDPOINT}?orgId=${ORG}`)
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'FROM-OTHER-WINDOW')
  assert.equal(ui.input(MEMBERSHIP, 'Medlemsnummer').props.value, 'UNSAVED-OTHER-ROW')
  await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 2)
  assert.equal(body(writes(ui)[1]).id, MEMBERSHIP)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'AFTER-RELOAD'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 3)
  assert.equal(body(writes(ui)[2]).expected.number, 'FROM-OTHER-WINDOW')
})

test('manual save cancels its debounce and a stale callback cannot start overlapping writes', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'MANUAL-SAVE')
  const click = ui.button(CERTIFICATION, 'Spara nu').props.onClick as () => void
  click(); click()
  assert.equal(writes(ui).length, 1, 'The request lock must be synchronous, before rendering disabled controls')
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 1)
  pending.resolve(ui.defaultReply(writes(ui)[0])); await ui.settle()
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 1)
})

test('unconfirmed or incorrectly scoped save replies preserve drafts and pause automatic writes', async t => {
  const entry = { ...workspace().certifications[0], value: { enabled: true, number: 'LOCAL-DRAFT', date: '2028-06-01' } }
  const valid = { orgId: ORG, profileId: PROFILE, kind: 'certification', entry }
  const replies = [
    {},
    { ...valid, orgId: OTHER_ORG },
    { ...valid, profileId: OTHER_PROFILE },
    { ...valid, kind: 'addon' },
    { ...valid, entry: { ...entry, id: MEMBERSHIP } },
    { ...valid, entry: { ...entry, exists: false } },
    { ...valid, entry: { ...entry, value: { ...entry.value, number: 'UNCONFIRMED-VALUE' } } },
    { ...valid, entry: { ...entry, value: null } },
  ]
  for (const reply of replies) {
    const ui = harness(); t.after(ui.dispose)
    await ui.settle()
    ui.setResponder(() => Response.json(reply))
    ui.change(CERTIFICATION, 'Certifikatnummer', 'LOCAL-DRAFT'); await ui.advance(DEBOUNCE)
    assert.equal(writes(ui).length, 1)
    assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'LOCAL-DRAFT')
    assert.match(text(ui.row(CERTIFICATION)), /Kunde inte spara/u)
    assert.doesNotMatch(text(ui.render()), /UNCONFIRMED-VALUE/u)
    ui.change(CERTIFICATION, 'Certifikatnummer', 'NEWER-LOCAL-DRAFT'); await ui.advance(DEBOUNCE * 3)
    assert.equal(writes(ui).length, 1)
  }
})

test('wrong identities, malformed entries, and duplicate catalog IDs are rejected on load', async t => {
  const initial = workspace()
  const replies = [
    {},
    { workspace: workspace({ orgId: OTHER_ORG }) },
    { workspace: workspace({ profileId: OTHER_PROFILE }) },
    { workspace: { ...initial, certifications: null } },
    { workspace: { ...initial, addons: [{ ...initial.addons[0], value: { enabled: true, price: 1500 } }] } },
    { workspace: { ...initial, certifications: [{ ...initial.certifications[0], requiresNumber: undefined }] } },
    { workspace: { ...initial, certifications: [initial.certifications[0], initial.certifications[0]] } },
    { workspace: { ...initial, addons: [initial.addons[0], initial.addons[0]] } },
  ]
  for (const reply of replies) {
    const ui = harness(); t.after(ui.dispose)
    ui.setResponder(() => Response.json(reply)); await ui.settle(); await ui.advance(DEBOUNCE * 2)
    assert.match(text(ui.render()), /Uppgifterna kunde inte hämtas/u)
    assert.equal(ui.all().some(node => node.type === 'input'), false)
    assert.equal(writes(ui).length, 0)
    ui.setResponder(ui.defaultReply)
    const retry = ui.all().find(node => node.type === 'button' && text(node) === 'Försök igen')
    assert.ok(retry)
    ;(retry.props.onClick as () => void)()
    await ui.settle()
    assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'CERT-123')
    assert.equal(ui.calls.length, 2)
    assert.equal(writes(ui).length, 0)
  }
})

test('multiple dirty rows share one navigation confirmation and cancel without losing drafts', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  assert.equal(ui.unload(), false)
  ui.change(CERTIFICATION, 'Certifikatnummer', 'DIRTY-CERTIFICATION')
  ui.change(ADDON, 'Pris (SEK)', '1800')
  assert.equal(ui.unload(), true)
  ui.setConfirm(false)
  assert.deepEqual(ui.dispatchSwitch(), { prevented: true, confirmed: false })
  assert.equal(ui.confirmations.length, 1)
  assert.equal(ui.input(CERTIFICATION, 'Certifikatnummer').props.value, 'DIRTY-CERTIFICATION')
  assert.equal(ui.input(ADDON, 'Pris (SEK)').props.value, '1800')
  ui.setConfirm(true)
  assert.deepEqual(ui.dispatchSwitch(), { prevented: false, confirmed: true })
  assert.equal(ui.confirmations.length, 2, 'The second dirty row must accept the confirmation from the first')
  await Promise.resolve()
  assert.deepEqual(ui.dispatchSwitch(), { prevented: false, confirmed: true })
  assert.equal(ui.confirmations.length, 2, 'A capture/bubble dispatch pair must keep approval through the microtask checkpoint')
  await ui.advance(0)
  assert.deepEqual(ui.dispatchSwitch(), { prevented: false, confirmed: true })
  assert.equal(ui.confirmations.length, 3, 'A later interaction must ask again while unsaved changes remain')
  await ui.advance(DEBOUNCE)
  assert.equal(ui.unload(), false)
})

test('prior navigation confirmation from the personal profile applies to all dirty extra rows', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.change(CERTIFICATION, 'Certifikatnummer', 'DIRTY-CERTIFICATION')
  ui.change(ADDON, 'Pris (SEK)', '1800')
  ui.setConfirm(false)
  assert.deepEqual(ui.dispatchSwitch(true), { prevented: false, confirmed: true })
  assert.equal(ui.confirmations.length, 0)
  await ui.advance(0)
  assert.deepEqual(ui.dispatchSwitch(), { prevented: true, confirmed: false })
  assert.equal(ui.confirmations.length, 1)
})

test('an active save blocks navigation even when another row or profile already confirmed leaving', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.change(ADDON, 'Pris (SEK)', '1800'); await ui.advance(DEBOUNCE)
  assert.equal(ui.unload(), true)
  assert.deepEqual(ui.dispatchSwitch(true), { prevented: true, confirmed: true })
  assert.equal(ui.confirmations.length, 0)
  pending.resolve(ui.defaultReply(writes(ui)[0])); await ui.settle()
  assert.equal(ui.unload(), false)
  assert.equal(ui.dispatchSwitch().prevented, false)
})

test('pristine rows cannot turn a rejected navigation into an approved repeated dispatch', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.change(ADDON, 'Pris (SEK)', '1800')
  ui.setConfirm(false)
  assert.deepEqual(ui.dispatchSwitch(), { prevented: true, confirmed: false })
  assert.deepEqual(ui.dispatchSwitch(), { prevented: true, confirmed: false })
  assert.equal(ui.confirmations.length, 2)
})
