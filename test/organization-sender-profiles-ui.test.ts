import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { OrganizationSenderProfile, OrganizationSenderWorkspace } from '../src/lib/organizations/senderProfileTypes'

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROFILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const componentPath = 'src/components/organizations/OrganizationSenderProfiles.tsx'
const source = readFileSync(new URL(`../${componentPath}`, import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function workspace(overrides: Partial<OrganizationSenderWorkspace> = {}): OrganizationSenderWorkspace {
  return {
    organization: { id: ORG, name: 'Befintligt visningsnamn', organizationNumber: '559281-0823',
      legalName: 'Styr Projekt Stockholm AB', legalNameVersion: 3 },
    canEdit: true, migrationRequired: false, profiles: [], ...overrides,
  }
}

function profile(overrides: Partial<OrganizationSenderProfile> = {}): OrganizationSenderProfile {
  return { id: PROFILE, orgId: ORG, version: 4, name: 'Besiktningsbolaget Stockholm',
    address: 'Testgatan 1', postalCode: '111 22', city: 'Stockholm', email: 'kontakt@example.test',
    phone: '08-123456', website: 'https://example.test/', logoPath: null,
    reportFooterText: 'Profilens sidfot', isActive: true, ...overrides }
}

type UiNode = { type: unknown; props: Record<string, unknown> }
type VisibleNode = UiNode & { disabled: boolean }
type FetchCall = { url: string; init?: RequestInit }
type Effect = { dependencies: readonly unknown[]; cleanup?: () => void }
const jsx = (type: unknown, props: Record<string, unknown>): UiNode => ({ type, props })

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

function harness(initial = workspace()) {
  const hooks: unknown[] = []
  const effects = new Map<number, Effect>()
  const pendingEffects: Array<{ index: number; dependencies: readonly unknown[]; run: () => void | (() => void) }> = []
  let cursor = 0
  let serverWorkspace = structuredClone(initial)
  const calls: FetchCall[] = []
  const confirmations: string[] = []
  let confirmAnswer = true
  const events = new EventTarget()
  const windowMock = {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    confirm: (message: string) => { confirmations.push(message); return confirmAnswer },
  }
  function defaultReply(call: FetchCall): Response {
    if (call.init?.method === 'PUT') {
      const request = JSON.parse(String(call.init.body))
      if (request.action === 'legalName') serverWorkspace = { ...serverWorkspace, organization: {
        ...serverWorkspace.organization, legalName: request.legalName, legalNameVersion: request.expectedVersion + 1,
      } }
      else {
        const saved = { ...request.values, id: request.id, orgId: ORG, version: request.expectedVersion + 1 }
        serverWorkspace = { ...serverWorkspace, profiles: [...serverWorkspace.profiles.filter(row => row.id !== request.id), saved] }
      }
      return Response.json({ saved: true, workspace: serverWorkspace })
    }
    return Response.json({ workspace: serverWorkspace })
  }
  let responder: (call: FetchCall) => Response | Promise<Response> = defaultReply
  const react = {
    useState(initialValue: unknown) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initialValue === 'function' ? initialValue() : initialValue
      return [hooks[index], (next: unknown) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
    },
    useRef(current: unknown) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current }
      return hooks[index]
    },
    useEffect(run: () => void | (() => void), dependencies: readonly unknown[]) {
      const index = cursor++
      const previous = effects.get(index)
      if (!previous || previous.dependencies.length !== dependencies.length ||
        dependencies.some((value, dependency) => !Object.is(value, previous.dependencies[dependency]))) {
        pendingEffects.push({ index, dependencies, run })
      }
    },
  }
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', 'fetch', 'window', compiled)(
    (name: string) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol('Fragment') }
      if (name === 'lucide-react') return {}
      throw new Error(`Unexpected dependency ${name}`)
    }, compiledModule, compiledModule.exports, async (url: string, init?: RequestInit) => {
      const call = { url, init }; calls.push(call); return responder(call)
    }, windowMock,
  )
  const component = compiledModule.exports as { default: (props: { orgId: string }) => UiNode }
  function render() {
    cursor = 0
    const tree = component.default({ orgId: ORG })
    for (const effect of pendingEffects.splice(0)) {
      effects.get(effect.index)?.cleanup?.()
      const cleanup = effect.run()
      effects.set(effect.index, { dependencies: effect.dependencies, cleanup: typeof cleanup === 'function' ? cleanup : undefined })
    }
    return tree
  }
  const all = () => nodes(render())
  function input(name: string) {
    const found = all().find(node => ['input', 'textarea'].includes(String(node.type)) && node.props.name === name)
    assert.ok(found, `Missing input ${name}`)
    return found
  }
  function button(label: string) {
    const found = all().find(node => node.type === 'button' && text(node) === label)
    assert.ok(found, `Missing button ${label}`)
    return found
  }
  return {
    calls, confirmations, defaultReply, render, all, input, button,
    setResponder(next: typeof responder) { responder = next },
    setConfirm(answer: boolean) { confirmAnswer = answer },
    async settle() { for (let index = 0; index < 4; index++) { render(); await new Promise<void>(resolve => setImmediate(resolve)) }; return render() },
    change(name: string, value: string) {
      const control = input(name); assert.equal(control.disabled, false, `${name} must be editable`)
      ;(control.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } })
      render()
    },
    click(label: string) {
      const control = button(label); assert.equal(control.disabled, false, `${label} must be enabled`)
      ;(control.props.onClick as () => void)(); render()
    },
    submit(inputName: string) {
      const form = all().find(node => node.type === 'form' && nodes(node).some(child => child.props.name === inputName))
      assert.ok(form, `Missing form containing ${inputName}`)
      ;(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => undefined })
      render()
    },
    showArchived() {
      const checkbox = all().find(node => node.type === 'input' && node.props.type === 'checkbox')
      assert.ok(checkbox)
      ;(checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } }); render()
    },
    dispatchSwitch(detail: { confirmed?: boolean } = {}) {
      render()
      const event = new Event('hushub:before-organization-switch', { cancelable: true })
      Object.defineProperty(event, 'detail', { value: detail })
      events.dispatchEvent(event)
      return { prevented: event.defaultPrevented, detail }
    },
    unload() { render(); const event = new Event('beforeunload', { cancelable: true }); events.dispatchEvent(event); return event.defaultPrevented },
    dispose() { for (const effect of effects.values()) effect.cleanup?.(); effects.clear() },
  }
}

const writes = (ui: ReturnType<typeof harness>) => ui.calls.filter(call => call.init?.method === 'PUT')

test('members read their profiles without mutation controls or side effects', async t => {
  const ui = harness(workspace({ canEdit: false, profiles: [profile()] })); t.after(ui.dispose)
  assert.match(text(ui.render()), /Hämtar avsändarprofiler/)
  await ui.settle()
  assert.match(text(ui.render()), /Besiktningsbolaget Stockholm/)
  assert.match(text(ui.render()), /Organisationens administratör gör ändringar/)
  assert.equal(ui.input('legalName').disabled, true)
  assert.equal(ui.all().some(node => node.type === 'button' && /Ny avsändarprofil|Öppna profil|Spara bolagsnamn/.test(text(node))), false)
  ui.submit('legalName')
  await ui.settle()
  assert.equal(writes(ui).length, 0)
  assert.equal(ui.calls.length, 1)
  assert.equal(ui.calls[0].url, `/api/organizations/sender-profiles?orgId=${ORG}`)
  assert.equal(ui.calls[0].init?.credentials, 'same-origin')
  assert.equal(ui.unload(), false)
})

test('missing migration permits reading but disables even an administrator from writing', async t => {
  const ui = harness(workspace({ migrationRequired: true })); t.after(ui.dispose)
  await ui.settle()
  assert.match(text(ui.render()), /Databasstödet för avsändarprofiler behöver installeras/)
  assert.equal(ui.input('legalName').disabled, true)
  assert.equal(ui.all().some(node => node.type === 'button' && text(node) === 'Ny avsändarprofil'), false)
  ui.submit('legalName'); await ui.settle()
  assert.equal(writes(ui).length, 0)
})

test('administrator explicitly saves the legal name before creating a separate sender profile', async t => {
  const initial = workspace()
  initial.organization.legalName = null
  const ui = harness(initial); t.after(ui.dispose)
  await ui.settle()
  assert.equal(ui.input('legalName').props.value, '', 'The current display name must not be assumed to be the legal name')
  assert.equal(ui.button('Ny avsändarprofil').disabled, true)
  ui.change('legalName', 'Styr Projekt Stockholm AB')
  ui.submit('legalName'); await ui.settle()
  assert.deepEqual(JSON.parse(String(writes(ui)[0].init?.body)), {
    action: 'legalName', expectedVersion: 3, legalName: 'Styr Projekt Stockholm AB',
  })
  assert.match(text(ui.render()), /Visningsnamnet Befintligt visningsnamn/)
  ui.click('Ny avsändarprofil')
  assert.equal(ui.input('legalName').disabled, true)
  assert.equal(ui.input('name').props.value, '', 'No implicit profile is copied or created')
  ui.change('name', 'Besiktningsbolaget Stockholm')
  ui.change('email', 'besiktning@example.test')
  ui.submit('name'); await ui.settle()
  const request = JSON.parse(String(writes(ui)[1].init?.body))
  assert.equal(request.action, 'saveProfile')
  assert.equal(request.expectedVersion, 0)
  assert.match(request.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u)
  assert.equal(request.values.name, 'Besiktningsbolaget Stockholm')
  assert.equal(request.values.email, 'besiktning@example.test')
  assert.equal(request.values.isActive, true)
  assert.deepEqual(Object.keys(request).sort(), ['action', 'expectedVersion', 'id', 'values'])
  for (const forbidden of ['legalName', 'organizationNumber', 'orgId', 'isDefault', 'permissions', 'fortnox']) assert.equal(Object.hasOwn(request.values, forbidden), false)
  assert.equal(ui.input('legalName').props.value, 'Styr Projekt Stockholm AB')
  assert.match(text(ui.render()), /Befintliga dokument har inte ändrats/)
  assert.ok(ui.calls.every(call => call.url === `/api/organizations/sender-profiles?orgId=${ORG}`))
})

test('unknown save outcomes freeze the exact UUID and payload across retries and suppress double submission', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.click('Ny avsändarprofil'); ui.change('name', 'Besiktningsbolaget Stockholm')
  let rejectRequest: (error: Error) => void = () => { throw new Error('Request not started') }
  ui.setResponder(() => new Promise<Response>((_resolve, reject) => { rejectRequest = reject }))
  ui.submit('name'); ui.submit('name')
  assert.equal(writes(ui).length, 1)
  assert.equal(ui.input('name').disabled, true)
  assert.equal(ui.button('Stäng').disabled, true)
  assert.equal(ui.dispatchSwitch().prevented, true)
  assert.equal(ui.confirmations.length, 0, 'In-flight saves block switching without asking to discard')
  rejectRequest(new Error('Response lost after server commit'))
  await ui.settle()
  assert.match(text(ui.render()), /Sparandet kunde inte bekräftas/)
  assert.equal(ui.input('name').disabled, true)
  const first = writes(ui)[0].init?.body
  ui.setResponder(ui.defaultReply)
  ui.click('Försök spara igen'); await ui.settle()
  assert.equal(writes(ui).length, 2)
  assert.equal(writes(ui)[1].init?.body, first)
  assert.equal(ui.all().filter(node => node.type === 'article').length, 1)
  assert.equal(ui.unload(), false)
})

test('wrong-organization load or mutation results are never displayed or treated as confirmed', async t => {
  const foreign = workspace({ organization: { ...workspace().organization, id: OTHER_ORG, legalName: 'Hemligt annat företag' }, profiles: [profile({ orgId: OTHER_ORG })] })
  const rejectedLoad = harness(); t.after(rejectedLoad.dispose)
  rejectedLoad.setResponder(() => Response.json({ workspace: foreign }))
  await rejectedLoad.settle()
  assert.match(text(rejectedLoad.render()), /Avsändarprofilerna kunde inte läsas/)
  assert.doesNotMatch(text(rejectedLoad.render()), /Hemligt annat företag|Besiktningsbolaget Stockholm/)
  assert.equal(rejectedLoad.all().some(node => node.type === 'form'), false)

  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.click('Ny avsändarprofil'); ui.change('name', 'Egen profil')
  ui.setResponder(() => Response.json({ saved: true, workspace: foreign }))
  ui.submit('name'); await ui.settle()
  assert.equal(ui.input('name').disabled, true)
  assert.equal(ui.input('legalName').props.value, 'Styr Projekt Stockholm AB')
  assert.doesNotMatch(text(ui.render()), /Hemligt annat företag/)
  const first = writes(ui)[0].init?.body
  ui.setResponder(ui.defaultReply); ui.click('Försök spara igen'); await ui.settle()
  assert.equal(writes(ui)[1].init?.body, first)
})

test('archiving and restoring keep the same profile and preserve its saved fields', async t => {
  const saved = profile()
  const ui = harness(workspace({ profiles: [saved] })); t.after(ui.dispose)
  await ui.settle()
  ui.click('Öppna profil')
  ui.click('Arkivera profil'); await ui.settle()
  assert.equal(ui.all().filter(node => node.type === 'article').length, 0)
  const archived = JSON.parse(String(writes(ui)[0].init?.body))
  assert.equal(archived.id, PROFILE); assert.equal(archived.expectedVersion, 4)
  assert.equal(archived.values.isActive, false)
  assert.equal(archived.values.email, saved.email)
  ui.showArchived()
  assert.match(text(ui.render()), /Arkiverad profil/)
  ui.click('Öppna profil'); ui.click('Återaktivera profil'); await ui.settle()
  const restored = JSON.parse(String(writes(ui)[1].init?.body))
  assert.equal(restored.id, PROFILE); assert.equal(restored.expectedVersion, 5)
  assert.deepEqual(restored.values, { ...archived.values, isActive: true })
  assert.match(text(ui.render()), /Aktiv profil/)
  assert.equal(ui.confirmations.length, 2)
})

test('an ambiguous HTTP response retains the draft while a classified conflict permits correction', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  ui.click('Ny avsändarprofil'); ui.change('name', 'Första namnet')
  ui.setResponder(() => new Response('upstream unavailable', { status: 502 }))
  ui.submit('name'); await ui.settle()
  assert.equal(ui.input('name').disabled, true)
  const first = writes(ui)[0].init?.body
  ui.setResponder(() => Response.json({ saved: true }))
  ui.click('Försök spara igen'); await ui.settle()
  assert.equal(writes(ui)[1].init?.body, first)
  assert.equal(ui.input('name').disabled, true, 'A success response without its workspace is still unconfirmed')
  ui.setResponder(() => Response.json({ code: 'ORG_CONFLICT', error: 'Profilen har ändrats. Hämta om uppgifterna.' }, { status: 409 }))
  ui.click('Försök spara igen'); await ui.settle()
  assert.equal(ui.input('name').disabled, false)
  assert.equal(ui.input('name').props.value, 'Första namnet')
  assert.match(text(ui.render()), /Profilen har ändrats/)
  ui.change('name', 'Korrigerat namn')
  ui.setResponder(ui.defaultReply); ui.submit('name'); await ui.settle()
  assert.equal(JSON.parse(String(writes(ui)[3].init?.body)).values.name, 'Korrigerat namn')
})

test('a profile from another organization invalidates even an otherwise correctly scoped workspace', async t => {
  const ui = harness(workspace({ profiles: [profile({ orgId: OTHER_ORG, name: 'Främmande profil' })] })); t.after(ui.dispose)
  await ui.settle()
  assert.match(text(ui.render()), /Avsändarprofilerna kunde inte läsas/)
  assert.doesNotMatch(text(ui.render()), /Främmande profil/)
  assert.equal(ui.all().some(node => node.type === 'form'), false)
  assert.equal(writes(ui).length, 0)
})

test('malformed workspaces fail closed without rendering unsafe controls', async t => {
  const malformed = [
    { ...workspace(), profiles: [null] },
    { ...workspace(), organization: { ...workspace().organization, legalNameVersion: undefined } },
    { ...workspace(), organization: { ...workspace().organization, name: undefined } },
    { ...workspace(), profiles: [{ ...profile(), name: undefined }] },
    { ...workspace(), profiles: [profile({ version: 0 })] },
    { ...workspace(), profiles: [profile(), profile()] },
  ]
  for (const value of malformed) {
    const ui = harness(); t.after(ui.dispose)
    ui.setResponder(() => Response.json({ workspace: value }))
    await ui.settle()
    assert.match(text(ui.render()), /Avsändarprofilerna kunde inte läsas/)
    assert.equal(ui.all().some(node => node.type === 'form'), false)
    assert.equal(writes(ui).length, 0)
  }
})

test('archiving cannot bypass unsaved edits and declining archive leaves the saved profile untouched', async t => {
  const ui = harness(workspace({ profiles: [profile()] })); t.after(ui.dispose)
  await ui.settle(); ui.click('Öppna profil')
  ui.change('email', 'osparat@example.test')
  assert.equal(ui.button('Arkivera profil').disabled, true)
  ui.change('email', 'kontakt@example.test')
  assert.equal(ui.button('Arkivera profil').disabled, false)
  ui.setConfirm(false); ui.click('Arkivera profil'); await ui.settle()
  assert.equal(writes(ui).length, 0)
  assert.equal(ui.input('email').props.value, 'kontakt@example.test')
})

test('dirty forms guard unload and organization navigation and honor earlier guard confirmation', async t => {
  const ui = harness(); t.after(ui.dispose)
  await ui.settle()
  assert.equal(ui.unload(), false)
  assert.equal(ui.dispatchSwitch().prevented, false)
  ui.click('Ny avsändarprofil')
  assert.equal(ui.unload(), true, 'An unsaved blank profile is still a draft')
  ui.setConfirm(false)
  assert.equal(ui.dispatchSwitch().prevented, true)
  const confirmationCount = ui.confirmations.length
  assert.equal(ui.dispatchSwitch({ confirmed: true }).prevented, false)
  assert.equal(ui.confirmations.length, confirmationCount)
  ui.setConfirm(true)
  assert.equal(ui.dispatchSwitch().detail.confirmed, true)
  ui.click('Stäng')
  assert.equal(ui.unload(), false)
  ui.change('legalName', 'Utkast till registrerat namn')
  assert.equal(ui.button('Ny avsändarprofil').disabled, true)
  assert.equal(ui.unload(), true)
  ui.setConfirm(false); ui.click('Hämta om'); await ui.settle()
  assert.equal(ui.calls.length, 1, 'Declining refresh preserves the legal-name draft')
  assert.equal(ui.input('legalName').props.value, 'Utkast till registrerat namn')
  ui.setConfirm(true); ui.click('Hämta om'); await ui.settle()
  assert.equal(ui.input('legalName').props.value, 'Styr Projekt Stockholm AB')
  assert.equal(ui.unload(), false)
})
