import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { OrganizationProfileWorkspace } from '../src/lib/organizations/profileCardTypes'

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROFILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_PROFILE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const DEBOUNCE = 700
const componentPath = 'src/components/tu/TuOrganizationProfileEditor.tsx'
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const compiled = compile(componentPath)

function workspace(overrides: Partial<OrganizationProfileWorkspace> = {}): OrganizationProfileWorkspace {
  return {
    profileId: PROFILE,
    organization: { id: ORG, name: 'Exempel Besiktning AB', isDefault: true },
    role: 'inspector', configured: true, migrationRequired: false, version: 4,
    source: 'organization_card', sharedCompany: true, companyConfigured: true,
    legacyMediaAvailable: { avatarPath: false, logoPath: false, signaturePath: false },
    card: {
      displayName: 'Anna Andersson', title: 'Besiktningsman', phone: '070-1234567',
      email: 'anna@example.test', companyName: 'Exempel Besiktning AB', companyOrgNo: '559281-0823',
      companyAddress: 'Testgatan 1', companyPostalCode: '111 22', companyCity: 'Stockholm',
      avatarPath: null, logoPath: null, signaturePath: null, reportFooterText: 'Gemensam sidfot',
    },
    ...overrides,
  }
}

type UiNode = { type: unknown; props: Record<string, unknown>; key?: unknown }
type VisibleNode = UiNode & { disabled: boolean }
type FetchCall = { url: string; init?: RequestInit }
type Effect = { dependencies?: readonly unknown[]; cleanup?: () => void }
type Memo = { dependencies?: readonly unknown[]; value: unknown }
type LinkClickOptions = { target?: string; download?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }
const jsx = (type: unknown, props: Record<string, unknown>, key?: unknown): UiNode => ({ type, props, key })

class ElementMock {
  anchor: AnchorMock | null = null
  closest(selector: string) { assert.equal(selector, 'a[href]'); return this.anchor }
}

class AnchorMock extends ElementMock {
  href: string
  target: string
  download: boolean
  constructor(href: string, options: LinkClickOptions) {
    super()
    this.href = href; this.target = options.target ?? ''; this.download = options.download ?? false
    this.anchor = this
  }
  hasAttribute(name: string) { return name === 'download' && this.download }
}

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
  let hooks: unknown[] = []
  const effects = new Map<number, Effect>()
  const pendingEffects: Array<{ index: number; dependencies?: readonly unknown[]; run: () => void | (() => void) }> = []
  let cursor = 0
  let activeKey: unknown
  let mounted = true
  let initialWorkspace = structuredClone(initial)
  let serverWorkspace = structuredClone(initial)
  let now = 0
  let nextTimer = 1
  const timers = new Map<number, { due: number; run: () => void }>()
  const calls: FetchCall[] = []
  const confirmations: string[] = []
  const reloads: string[] = []
  let confirmAnswer = true
  const events = new EventTarget()
  const documentListeners = new Set<(event: Event) => void>()
  const documentMock = {
    addEventListener(type: string, listener: (event: Event) => void, capture: boolean) {
      assert.equal(type, 'click'); assert.equal(capture, true); documentListeners.add(listener)
    },
    removeEventListener(type: string, listener: (event: Event) => void, capture: boolean) {
      assert.equal(type, 'click'); assert.equal(capture, true); documentListeners.delete(listener)
    },
  }
  const setTimeoutMock = (run: () => void, delay = 0) => {
    const id = nextTimer++
    timers.set(id, { due: now + delay, run })
    return id
  }
  const clearTimeoutMock = (id: number) => { timers.delete(id) }
  const windowMock = {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    location: { href: `https://app.example.test/settings/profil?orgId=${ORG}`, reload: () => { reloads.push('reload') } },
    confirm: (message: string) => { confirmations.push(message); return confirmAnswer },
    setTimeout: setTimeoutMock, clearTimeout: clearTimeoutMock,
  }
  function defaultReply(call: FetchCall): Response {
    if (call.init?.method === 'PUT') {
      const request = JSON.parse(String(call.init.body))
      const card = Object.fromEntries(Object.entries(request.card).map(([field, value]) => {
        const trimmed = typeof value === 'string' ? value.trim() : value
        return [field, field === 'email' && typeof trimmed === 'string' ? trimmed.toLowerCase() || null : trimmed || null]
      }))
      serverWorkspace = {
        ...serverWorkspace, version: (request.expectedVersion ?? 0) + 1, configured: true, source: 'organization_card',
        card: { ...serverWorkspace.card, ...card },
      }
      return Response.json({ workspace: serverWorkspace })
    }
    if (call.url.includes('/media?')) return Response.json({ path: `organizations/${serverWorkspace.organization.id}/avatar.png` })
    if (call.init?.method === 'POST') {
      const request = JSON.parse(String(call.init.body))
      assert.equal(request.action, 'import_legacy_media')
      serverWorkspace = {
        ...serverWorkspace, version: request.expectedVersion + 1,
        card: { ...serverWorkspace.card, avatarPath: `organizations/${serverWorkspace.organization.id}/legacy-avatar.png` },
      }
      return Response.json({ workspace: serverWorkspace })
    }
    throw new Error(`Unexpected request ${call.init?.method} ${call.url}`)
  }
  let responder: (call: FetchCall) => Response | Promise<Response> = defaultReply
  const sameDependencies = (previous?: readonly unknown[], next?: readonly unknown[]) =>
    previous !== undefined && next !== undefined && previous.length === next.length &&
    next.every((value, index) => Object.is(value, previous[index]))
  const react = {
    useState(initialValue: unknown) {
      const index = cursor++
      const state = hooks
      if (!(index in state)) state[index] = typeof initialValue === 'function' ? initialValue() : initialValue
      return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef(current: unknown) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current }
      return hooks[index]
    },
    useMemo(compute: () => unknown, dependencies?: readonly unknown[]) {
      const index = cursor++
      const previous = hooks[index] as Memo | undefined
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) hooks[index] = { dependencies, value: compute() }
      return (hooks[index] as Memo).value
    },
    useCallback(callback: unknown, dependencies?: readonly unknown[]) {
      return react.useMemo(() => callback, dependencies)
    },
    useEffect(run: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = cursor++
      if (!effects.has(index) || !sameDependencies(effects.get(index)?.dependencies, dependencies)) {
        pendingEffects.push({ index, dependencies, run })
      }
    },
  }
  const moduleCache = new Map<string, unknown>()
  function requireMock(name: string): unknown {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol('Fragment') }
    if (name === 'lucide-react') return {}
    if (name === 'next/link') return { default: 'a' }
    if (name === '@/lib/organizations/profileCardAutosave') {
      if (!moduleCache.has(name)) {
        const imported = { exports: {} }
        new Function('require', 'module', 'exports', compile('src/lib/organizations/profileCardAutosave.ts'))(
          requireMock, imported, imported.exports,
        )
        moduleCache.set(name, imported.exports)
      }
      return moduleCache.get(name)
    }
    throw new Error(`Unexpected dependency ${name}`)
  }
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', 'fetch', 'window', 'document', 'Element', 'HTMLAnchorElement', 'setTimeout', 'clearTimeout', compiled)(
    requireMock, compiledModule, compiledModule.exports,
    async (url: string, init?: RequestInit) => { const call = { url, init }; calls.push(call); return responder(call) },
    windowMock, documentMock, ElementMock, AnchorMock, setTimeoutMock, clearTimeoutMock,
  )
  const component = compiledModule.exports as { default: (props: { initialWorkspace: OrganizationProfileWorkspace }) => UiNode }
  function cleanup() {
    for (const effect of effects.values()) effect.cleanup?.()
    effects.clear()
    pendingEffects.length = 0
  }
  function render() {
    assert.equal(mounted, true, 'Cannot render an unmounted editor')
    cursor = 0
    let tree = component.default({ initialWorkspace })
    if (typeof tree.type === 'function') {
      if (!Object.is(activeKey, tree.key)) {
        cleanup()
        hooks = []
        activeKey = tree.key
      }
      cursor = 0
      tree = (tree.type as (props: Record<string, unknown>) => UiNode)(tree.props)
    }
    for (const effect of pendingEffects.splice(0)) {
      effects.get(effect.index)?.cleanup?.()
      const cleanupEffect = effect.run()
      effects.set(effect.index, { dependencies: effect.dependencies, cleanup: typeof cleanupEffect === 'function' ? cleanupEffect : undefined })
    }
    return tree
  }
  const all = () => nodes(render())
  function input(label: string) {
    const found = all().find(node => node.props.label === label && typeof node.props.onChange === 'function')
    assert.ok(found, `Missing input ${label}`)
    return found
  }
  function media(field: string) {
    const found = all().find(node => node.props.field === field && typeof node.props.onUpload === 'function')
    assert.ok(found, `Missing media input ${field}`)
    return found
  }
  function button(label: string) {
    const found = all().find(node => node.type === 'button' && text(node) === label)
    assert.ok(found, `Missing button ${label}`)
    return found
  }
  async function settle() {
    for (let index = 0; index < 4; index++) {
      if (mounted) render()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    return mounted ? render() : null
  }
  return {
    calls, confirmations, reloads, defaultReply, render, all, input, media, button, settle,
    setResponder(next: typeof responder) { responder = next },
    setConfirm(answer: boolean) { confirmAnswer = answer },
    replaceWorkspace(next: OrganizationProfileWorkspace) { initialWorkspace = structuredClone(next); serverWorkspace = structuredClone(next); render() },
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
    change(label: string, value: string) {
      const control = input(label); assert.equal(control.disabled, false, `${label} must be editable`)
      ;(control.props.onChange as (value: string) => void)(value)
      render()
    },
    click(label: string) {
      const control = button(label); assert.equal(control.disabled, false, `${label} must be enabled`)
      if (control.props.type === 'submit') {
        const form = all().find(node => node.type === 'form')
        assert.ok(form)
        ;(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => undefined })
      } else (control.props.onClick as () => void)()
      render()
    },
    upload(field: string) {
      const control = media(field); assert.equal(control.disabled, false, `${field} upload must be enabled`)
      ;(control.props.onUpload as (event: unknown, field: string) => void)({
        target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })], value: 'avatar.png' },
      }, field)
      render()
    },
    dispatchSwitch() {
      render()
      const event = new Event('hushub:before-organization-switch', { cancelable: true })
      events.dispatchEvent(event)
      return event.defaultPrevented
    },
    linkClick(href: string, options: LinkClickOptions = {}) {
      if (mounted) render()
      const event = new Event('click', { cancelable: true })
      const target = new ElementMock()
      target.anchor = new AnchorMock(href, options)
      let stopped = false
      for (const [name, value] of Object.entries({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...options, target })) {
        Object.defineProperty(event, name, { value })
      }
      Object.defineProperty(event, 'stopPropagation', { value: () => { stopped = true } })
      for (const listener of documentListeners) listener(event)
      return { prevented: event.defaultPrevented, stopped }
    },
    unload() { render(); const event = new Event('beforeunload', { cancelable: true }); events.dispatchEvent(event); return event.defaultPrevented },
    dispose() { cleanup(); mounted = false },
  }
}

const writes = (ui: ReturnType<typeof harness>) => ui.calls.filter(call => call.init?.method === 'PUT')
const body = (call: FetchCall) => JSON.parse(String(call.init?.body))

test('rapid edits save only the final personal values after the debounce', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.render(); await ui.advance(DEBOUNCE * 3)
  assert.equal(ui.calls.length, 0, 'Opening a profile must not write it')
  ui.change('Namn', 'Anna B'); await ui.advance(300)
  ui.change('Namn', 'Anna Berg'); await ui.advance(DEBOUNCE - 1)
  assert.equal(writes(ui).length, 0)
  await ui.advance(1)
  assert.equal(writes(ui).length, 1)
  assert.deepEqual(body(writes(ui)[0]), {
    orgId: ORG, expectedVersion: 4,
    card: { displayName: 'Anna Berg', title: 'Besiktningsman', phone: '070-1234567', email: 'anna@example.test', avatarPath: null, signaturePath: null },
  })
  assert.equal(writes(ui)[0].url, '/api/organizations/member-profile')
  assert.equal(writes(ui)[0].init?.credentials, 'same-origin')
  assert.equal(ui.unload(), false)
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 1)
})

test('typing during a pending save survives its reply and the next save uses the new version', async t => {
  const ui = harness(); t.after(ui.dispose)
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.change('Namn', 'Anna Berg'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.media('avatarPath').disabled, true)
  assert.equal(ui.dispatchSwitch(), true)
  assert.equal(ui.unload(), true)
  ui.change('Namn', 'Anna Lind'); ui.change('Telefon', '070-7654321')
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 1, 'Only one write may be in flight')
  pending.resolve(ui.defaultReply(writes(ui)[0])); await ui.settle()
  assert.equal(ui.input('Namn').props.value, 'Anna Lind')
  assert.equal(ui.input('Telefon').props.value, '070-7654321')
  ui.setResponder(ui.defaultReply); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 2)
  assert.equal(body(writes(ui)[1]).expectedVersion, 5)
  assert.equal(body(writes(ui)[1]).card.displayName, 'Anna Lind')
  assert.equal(body(writes(ui)[1]).card.phone, '070-7654321')
  assert.equal(ui.unload(), false)
})

test('server normalization is adopted without a repeated autosave loop', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.change('Namn', '  Anna Berg  ')
  ui.change('Arbetsmejl i organisationen', '  ANNA.BERG@EXAMPLE.TEST  ')
  ui.change('Titel/roll', '  ')
  await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.input('Namn').props.value, 'Anna Berg')
  assert.equal(ui.input('Arbetsmejl i organisationen').props.value, 'anna.berg@example.test')
  assert.equal(ui.input('Titel/roll').props.value, '')
  await ui.advance(DEBOUNCE * 5)
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.unload(), false)
})

test('a failed autosave preserves the draft and waits for an explicit retry', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.setResponder(() => Promise.reject(new Error('Nätverket är inte tillgängligt.')))
  ui.change('Namn', 'Anna Berg'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.input('Namn').props.value, 'Anna Berg')
  assert.match(text(ui.render()), /Nätverket är inte tillgängligt/)
  ui.change('Telefon', '070-7654321'); await ui.advance(DEBOUNCE * 10)
  assert.equal(writes(ui).length, 1, 'Editing after a failure must not cause an automatic retry')
  assert.equal(ui.unload(), true)
  ui.setConfirm(false); assert.equal(ui.dispatchSwitch(), true)
  ui.setResponder(ui.defaultReply); ui.click('Försök spara igen'); await ui.settle()
  assert.equal(writes(ui).length, 2)
  assert.equal(body(writes(ui)[1]).expectedVersion, 4)
  assert.equal(body(writes(ui)[1]).card.phone, '070-7654321')
  assert.equal(ui.unload(), false)
  ui.change('Titel/roll', 'Projektledare'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 3, 'Confirmed explicit retry resumes normal autosaving')
  assert.equal(body(writes(ui)[2]).expectedVersion, 5)
})

test('a conflict never reloads or automatically overwrites the local draft', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.setResponder(() => Response.json({ code: 'ORG_PROFILE_CARD_CONFLICT', error: 'Profilen har ändrats. Ladda om sidan.' }, { status: 409 }))
  ui.change('Namn', 'Lokalt namn'); await ui.advance(DEBOUNCE)
  ui.change('Titel/roll', 'Lokalt utkast'); await ui.advance(DEBOUNCE * 10)
  assert.equal(ui.calls.length, 1)
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.input('Namn').props.value, 'Lokalt namn')
  assert.equal(ui.input('Titel/roll').props.value, 'Lokalt utkast')
  assert.match(text(ui.render()), /Profilen har ändrats/)
  assert.equal(ui.all().find(node => node.type === 'button' && node.props.type === 'submit')?.disabled, true)
  assert.equal(ui.unload(), true)
})

test('same-tab navigation protects a dirty draft and asks only once for an approved click', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.change('Namn', 'Lokalt utkast'); ui.setConfirm(false)
  assert.deepEqual(ui.linkClick('/tu'), { prevented: true, stopped: true })
  assert.equal(ui.confirmations.length, 1)
  assert.equal(ui.input('Namn').props.value, 'Lokalt utkast')
  assert.equal(writes(ui).length, 0)

  ui.setConfirm(true)
  assert.deepEqual(ui.linkClick('/tu'), { prevented: false, stopped: false })
  // Trusted browser clicks may drain microtasks before React's bubble handler.
  await Promise.resolve()
  ui.setConfirm(false)
  assert.equal(ui.dispatchSwitch(), false, 'A link-specific handler may repeat the guard in the same click')
  assert.equal(ui.confirmations.length, 2, 'The repeated guard must reuse the click approval')
  await ui.advance(0)
  assert.equal(ui.dispatchSwitch(), true, 'Approval expires in the next task after the click')
  assert.equal(ui.confirmations.length, 3)
  ui.dispose()
  assert.deepEqual(ui.linkClick('/tu'), { prevented: false, stopped: false }, 'Unmount removes the document guard')
  assert.equal(ui.confirmations.length, 3)
})

test('same-tab navigation is blocked without confirmation while a save is pending', async t => {
  const ui = harness(); t.after(ui.dispose)
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.change('Namn', 'Anna Berg'); await ui.advance(DEBOUNCE)
  assert.deepEqual(ui.linkClick('/tu'), { prevented: true, stopped: true })
  assert.equal(ui.confirmations.length, 0)
  pending.resolve(ui.defaultReply(writes(ui)[0])); await ui.settle()
  assert.deepEqual(ui.linkClick('/tu'), { prevented: false, stopped: false })
  assert.equal(ui.confirmations.length, 0)
})

test('modified, new-tab, download and same-page links do not prompt about the current draft', t => {
  const ui = harness(); t.after(ui.dispose)
  ui.change('Namn', 'Lokalt utkast'); ui.setConfirm(false)
  const ignored: Array<[string, LinkClickOptions]> = [
    ['/tu', { ctrlKey: true }], ['/tu', { metaKey: true }], ['/tu', { shiftKey: true }], ['/tu', { altKey: true }],
    ['/tu', { button: 1 }], ['/tu', { target: '_blank' }], ['/file.pdf', { download: true }],
    [`/settings/profil?orgId=${ORG}#contact`, {}], ['mailto:anna@example.test', {}],
  ]
  for (const [href, options] of ignored) assert.deepEqual(ui.linkClick(href, options), { prevented: false, stopped: false })
  assert.equal(ui.confirmations.length, 0)
  assert.equal(ui.input('Namn').props.value, 'Lokalt utkast')
})

test('unconfirmed or incorrectly scoped replies retain the draft and pause autosaving', async t => {
  const submitted = { ...workspace().card, displayName: 'Anna Berg' }
  const replies = [
    { workspace: undefined },
    { workspace: workspace({ version: 5, profileId: OTHER_PROFILE, card: submitted }) },
    { workspace: workspace({ version: 5, organization: { id: OTHER_ORG, name: 'Främmande företag', isDefault: false }, card: submitted }) },
    { workspace: workspace({ version: 4, card: submitted }) },
    { workspace: workspace({ version: 5, card: { ...submitted, displayName: 'Fel sparade uppgifter' } }) },
  ]
  for (const reply of replies) {
    const ui = harness(); t.after(ui.dispose)
    ui.setResponder(() => Response.json(reply))
    ui.change('Namn', 'Anna Berg'); await ui.advance(DEBOUNCE)
    assert.equal(ui.input('Namn').props.value, 'Anna Berg')
    assert.doesNotMatch(text(ui.render()), /Främmande företag|Fel sparade uppgifter/)
    assert.match(text(ui.render()), /kunde inte bekräftas/)
    assert.equal(ui.unload(), true)
    await ui.advance(DEBOUNCE * 5)
    assert.equal(writes(ui).length, 1)
  }
})

test('invalid name, email and length wait for correction before autosaving', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.change('Namn', ' '); await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 0)
  ui.change('Namn', 'Anna Berg'); ui.change('Arbetsmejl i organisationen', 'anna@')
  await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 0)
  ui.change('Arbetsmejl i organisationen', 'anna.berg@example.test'); ui.change('Titel/roll', 'x'.repeat(161))
  await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 0)
  ui.change('Titel/roll', 'Projektledare'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(body(writes(ui)[0]).card.email, 'anna.berg@example.test')
})

test('a suggested unsaved profile is not created on mount and can be explicitly confirmed', async t => {
  const initial = workspace({ configured: false, version: null, source: 'legacy_profile' })
  const ui = harness(initial); t.after(ui.dispose)
  ui.render(); await ui.advance(DEBOUNCE * 5)
  assert.equal(ui.calls.length, 0)
  ui.click('Bekräfta min profil'); await ui.settle()
  assert.equal(writes(ui).length, 1)
  assert.equal(body(writes(ui)[0]).expectedVersion, null)
  assert.equal(ui.unload(), false)
})

test('manual save flushes an edit and cancels its queued autosave', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.change('Namn', 'Anna Berg'); ui.click('Spara nu'); await ui.settle()
  assert.equal(writes(ui).length, 1)
  await ui.advance(DEBOUNCE * 3)
  assert.equal(writes(ui).length, 1)
})

test('simultaneous submit and stale upload callbacks cannot start overlapping operations', async t => {
  const ui = harness(); t.after(ui.dispose)
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.change('Namn', 'Anna Berg')
  const form = ui.all().find(node => node.type === 'form')
  assert.ok(form)
  const submit = form.props.onSubmit as (event: { preventDefault: () => void }) => void
  const upload = ui.media('avatarPath').props.onUpload as (event: unknown, field: string) => void
  submit({ preventDefault: () => undefined })
  submit({ preventDefault: () => undefined })
  upload({ target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })], value: 'avatar.png' } }, 'avatarPath')
  assert.equal(ui.calls.length, 1, 'The operation lock applies before React renders updated disabled controls')
  pending.resolve(ui.defaultReply(writes(ui)[0])); await ui.settle()
  assert.equal(ui.unload(), false)
})

test('same-profile props do not erase a pending draft', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.change('Namn', 'Lokalt utkast')
  ui.replaceWorkspace(workspace())
  assert.equal(ui.input('Namn').props.value, 'Lokalt utkast')
  await ui.advance(DEBOUNCE)
  assert.equal(body(writes(ui)[0]).card.displayName, 'Lokalt utkast')
})

test('a late save from the old organization cannot affect the new organization', async t => {
  const ui = harness(); t.after(ui.dispose)
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.change('Namn', 'Första organisationen'); await ui.advance(DEBOUNCE)
  const oldReply = Response.json({ workspace: workspace({ version: 5, card: { ...workspace().card, displayName: 'Första organisationen' } }) })
  const next = workspace({ organization: { id: OTHER_ORG, name: 'Andra organisationen', isDefault: false }, version: 9 })
  next.card.displayName = 'Andra profilnamnet'
  ui.replaceWorkspace(next)
  pending.resolve(oldReply); await ui.settle()
  assert.equal(ui.input('Namn').props.value, 'Andra profilnamnet')
  assert.match(text(ui.render()), /Andra organisationen/)
  ui.setResponder(ui.defaultReply); ui.change('Namn', 'Ändrat i andra'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 2)
  assert.equal(body(writes(ui)[1]).orgId, OTHER_ORG)
  assert.equal(body(writes(ui)[1]).expectedVersion, 9)
})

test('changing profile identity discards the old debounce and unmount cancels pending autosaves', async t => {
  const ui = harness(); t.after(ui.dispose)
  ui.change('Namn', 'Gamla personens utkast')
  const next = workspace({ profileId: OTHER_PROFILE })
  next.card.displayName = 'Ny person'
  ui.replaceWorkspace(next); await ui.advance(DEBOUNCE * 2)
  assert.equal(ui.calls.length, 0)
  assert.equal(ui.input('Namn').props.value, 'Ny person')
  ui.change('Namn', 'Oskickat nytt utkast'); ui.dispose()
  await ui.advance(DEBOUNCE * 2)
  assert.equal(ui.calls.length, 0)
})

test('an upload serializes with saving and its returned path is autosaved with concurrent typing', async t => {
  const ui = harness(); t.after(ui.dispose)
  const upload = deferred()
  ui.setResponder(() => upload.promise)
  ui.upload('avatarPath')
  assert.equal(ui.calls.length, 1)
  assert.match(ui.calls[0].url, new RegExp(`/media\\?orgId=${ORG}&field=avatarPath$`))
  assert.equal(ui.media('signaturePath').disabled, true)
  ui.change('Namn', 'Anna under uppladdning'); await ui.advance(DEBOUNCE * 2)
  assert.equal(writes(ui).length, 0)
  assert.equal(ui.unload(), true)
  upload.resolve(Response.json({ path: `organizations/${ORG}/new-avatar.png` })); await ui.settle()
  ui.setResponder(ui.defaultReply); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(body(writes(ui)[0]).card.avatarPath, `organizations/${ORG}/new-avatar.png`)
  assert.equal(body(writes(ui)[0]).card.displayName, 'Anna under uppladdning')
  assert.equal(ui.unload(), false)
})

test('legacy import blocks navigation and editing and advances the version used by later autosaves', async t => {
  const ui = harness(workspace({ legacyMediaAvailable: { avatarPath: true, logoPath: false, signaturePath: false } })); t.after(ui.dispose)
  const pending = deferred()
  ui.setResponder(() => pending.promise)
  ui.click('Hämta bilder')
  assert.equal(ui.calls.length, 1)
  assert.equal(ui.input('Namn').disabled, true)
  assert.equal(ui.media('avatarPath').disabled, true)
  assert.equal(ui.unload(), true)
  assert.equal(ui.dispatchSwitch(), true)
  assert.equal(ui.confirmations.length, 0)
  pending.resolve(ui.defaultReply(ui.calls[0])); await ui.settle()
  assert.equal(ui.unload(), false)
  assert.equal(ui.input('Namn').disabled, false)
  ui.setResponder(ui.defaultReply); ui.change('Namn', 'Anna med bild'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(body(writes(ui)[0]).expectedVersion, 5)
  assert.equal(body(writes(ui)[0]).card.avatarPath, `organizations/${ORG}/legacy-avatar.png`)
})

test('a failed import freezes editing and its explicit retry repeats the import at the original version', async t => {
  const ui = harness(workspace({ legacyMediaAvailable: { avatarPath: true, logoPath: false, signaturePath: false } })); t.after(ui.dispose)
  ui.setResponder(() => Promise.reject(new Error('Importens svar saknas.')))
  ui.click('Hämta bilder'); await ui.settle()
  assert.match(text(ui.render()), /Importens svar saknas/)
  assert.equal(ui.input('Namn').disabled, true)
  assert.equal(ui.media('avatarPath').disabled, true)
  assert.equal(ui.media('signaturePath').disabled, true)
  assert.equal(ui.button('Ladda om profilen').disabled, false)
  assert.equal(ui.unload(), true)
  await ui.advance(DEBOUNCE * 5)
  assert.equal(ui.calls.length, 1)
  assert.equal(writes(ui).length, 0)
  ui.setResponder(ui.defaultReply); ui.click('Försök hämta bilder igen'); await ui.settle()
  assert.equal(ui.calls.length, 2)
  assert.equal(ui.calls[1].init?.method, 'POST')
  assert.equal(ui.calls[1].url, '/api/organizations/member-profile')
  assert.deepEqual(body(ui.calls[1]), { action: 'import_legacy_media', orgId: ORG, expectedVersion: 4 })
  assert.equal(ui.calls[1].init?.body, ui.calls[0].init?.body)
  assert.equal(ui.input('Namn').disabled, false)
  assert.equal(ui.media('avatarPath').disabled, false)
  assert.equal(ui.unload(), false)
  ui.change('Namn', 'Anna efter återförsök'); await ui.advance(DEBOUNCE)
  assert.equal(writes(ui).length, 1)
  assert.equal(body(writes(ui)[0]).expectedVersion, 5)
  assert.equal(body(writes(ui)[0]).card.avatarPath, `organizations/${ORG}/legacy-avatar.png`)
})

test('an import conflict pauses all writes and reload requires explicit confirmation', async t => {
  const ui = harness(workspace({ legacyMediaAvailable: { avatarPath: true, logoPath: false, signaturePath: false } })); t.after(ui.dispose)
  ui.setResponder(() => Response.json({ code: 'ORG_PROFILE_CARD_CONFLICT' }, { status: 409 }))
  ui.click('Hämta bilder'); await ui.settle()
  assert.match(text(ui.render()), /Profilen har ändrats på annat håll/)
  assert.equal(ui.button('Försök hämta bilder igen').disabled, true)
  assert.equal(ui.button('Hämta bilder').disabled, true)
  assert.equal(ui.input('Namn').disabled, true)
  assert.equal(ui.media('avatarPath').disabled, true)
  assert.equal(ui.unload(), true)
  await ui.advance(DEBOUNCE * 5)
  assert.equal(ui.calls.length, 1)
  assert.equal(writes(ui).length, 0)
  ui.setConfirm(false); ui.click('Ladda om profilen')
  assert.equal(ui.reloads.length, 0)
  assert.match(ui.confirmations[0], /Osparade ändringar.*försvinner/)
  ui.setConfirm(true); ui.click('Ladda om profilen')
  assert.equal(ui.reloads.length, 1)
  assert.equal(ui.calls.length, 1)
})

test('migration-required workspaces cannot autosave or upload', async t => {
  const ui = harness(workspace({ migrationRequired: true })); t.after(ui.dispose)
  ui.render(); await ui.advance(DEBOUNCE * 2)
  assert.equal(ui.calls.length, 0)
  assert.equal(ui.media('avatarPath').disabled, true)
  const name = ui.input('Namn')
  if (!name.disabled) ui.change('Namn', 'Osparat namn')
  await ui.advance(DEBOUNCE * 2)
  assert.equal(ui.calls.length, 0)
})
