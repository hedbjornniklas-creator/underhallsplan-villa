import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as SenderComponent from '../src/components/tasks/CustomerContractSenderProfile'
import type { CustomerOfferWorkspace } from '../src/lib/action-cases/customerOffers'
import type { ContractSenderProfileSnapshot } from '../src/lib/action-cases/contractSenderProfile'
import type { OrganizationSenderProfile } from '../src/lib/organizations/senderProfileTypes'

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', FOREIGN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const CASE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', PROFILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const path = 'src/components/tasks/CustomerContractSenderProfile.tsx'
type UiNode = { type: unknown; props: Record<string, unknown> }
type Props = Parameters<typeof SenderComponent.default>[0]
const jsx = (type: unknown, props: Record<string, unknown>): UiNode => ({ type, props })
const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
function load<T>(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const code = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  }, compiled, compiled.exports, ...Object.values(globals))
  return compiled.exports as T
}
const snapshotModule = load('src/lib/action-cases/contractSenderProfile.ts', {})
function profile(overrides: Partial<OrganizationSenderProfile> = {}): OrganizationSenderProfile {
  return { id: PROFILE, orgId: ORG, version: 4, name: 'Styr Projekt Stockholm', address: 'Testgatan 1', postalCode: '111 22',
    city: 'Stockholm', email: 'styr@example.test', phone: '08-123456', website: null, logoPath: null, reportFooterText: null, isActive: true, ...overrides }
}
function snapshot(overrides: Partial<ContractSenderProfileSnapshot> = {}): ContractSenderProfileSnapshot {
  return { version: 1, organizationId: ORG, profileId: PROFILE, profileVersion: 4, legalNameVersion: 2,
    name: 'Styr Projekt Stockholm', legalName: 'Styr Projekt Stockholm AB', organizationNumber: '559281-0823',
    address: 'Testgatan 1', postalCode: '111 22', city: 'Stockholm', email: 'styr@example.test', phone: '08-123456',
    website: null, logoPath: null, logoDataUrl: null, reportFooterText: null, ...overrides }
}
function choices() {
  return { available: true, organization: { id: ORG, name: 'Äldre organisationsnamn', legalName: 'Styr Projekt Stockholm AB',
    organizationNumber: '559281-0823', legalNameVersion: 2 }, profiles: [profile()], selected: null as ContractSenderProfileSnapshot | null }
}
function workspace(): CustomerOfferWorkspace {
  return { revision: 8, offers: [], draft: { senderProfile: snapshot(), title: 'Befintligt avtal', introduction: 'Behåll inledningen', baseAmountOre: 1234500,
    validUntil: '2027-03-01', contractForm: 'custom', terms: 'Befintliga villkor', paymentTerms: 'Befintliga betalningsvillkor', schedule: 'Befintlig tidplan',
    attachmentIds: [], termsAttachmentId: null, items: [] } }
}
function nodes(value: unknown): UiNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const node = value as UiNode
  return [node, ...nodes(node.props.children)]
}
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object' && 'props' in value) return text((value as UiNode).props.children)
  return ''
}
type FetchCall = { url: string; init?: RequestInit }
function harness(overrides: Partial<Props> = {}) {
  const hooks: unknown[] = []
  const effects = new Map<number, { dependencies: unknown[]; cleanup?: () => void }>()
  let cursor = 0
  const queued: Array<{ index: number; dependencies: unknown[]; run: () => void | (() => void) }> = []
  const calls: FetchCall[] = [], pendingChanges: boolean[] = [], applied: CustomerOfferWorkspace[] = []
  let reloads = 0
  let options: unknown = choices()
  let respond: (call: FetchCall) => Response | Promise<Response> = call => call.init?.method === 'POST'
    ? Response.json({ saved: true, workspace: workspace() }) : Response.json(options)
  const props: Props = { caseId: CASE, organizationId: ORG, selected: null, revision: 7, currentCompanyName: 'Befintliga entreprenörsuppgifter',
    blockedReason: null, onPendingChange: pending => { pendingChanges.push(pending); props.blockedReason = pending ? 'Ett arbete pågår.' : null },
    onApplied: result => { applied.push(result); props.selected = result.draft.senderProfile ?? null; props.revision = result.revision },
    onReload: async () => { reloads++; return true }, ...overrides }
  const componentModule = load<typeof SenderComponent>(path, {
    react: {
      useState(initial: unknown) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
        return [hooks[index], (next: unknown) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }] },
      useRef(current: unknown) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current }; return hooks[index] },
      useEffect(run: () => void | (() => void), dependencies: unknown[]) { const index = cursor++, previous = effects.get(index)
        if (!previous || dependencies.length !== previous.dependencies.length || dependencies.some((item, index) => !Object.is(item, previous.dependencies[index]))) queued.push({ index, dependencies, run }) },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('Fragment') }, 'lucide-react': {},
    '@/lib/action-cases/contractSenderProfile': snapshotModule,
  }, { fetch: async (url: string, init?: RequestInit) => { const call = { url, init }; calls.push(call); return respond(call) } })
  function render() {
    cursor = 0; const tree = componentModule.default(props)
    for (const effect of queued.splice(0)) { effects.get(effect.index)?.cleanup?.(); const cleanup = effect.run()
      effects.set(effect.index, { dependencies: effect.dependencies, cleanup: typeof cleanup === 'function' ? cleanup : undefined }) }
    return tree
  }
  function button(label: string) { const found = nodes(render()).find(node => node.type === 'button' && text(node) === label); assert.ok(found, `Missing button ${label}`); return found }
  return {
    props, calls, pendingChanges, applied, render, button, exports: componentModule,
    setChoices(value: unknown) { options = value },
    setResponder(value: typeof respond) { respond = value },
    select(value = PROFILE) { const node = nodes(render()).find(node => node.type === 'select')!; assert.ok(node); assert.equal(node.props.disabled, false)
      ;(node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); render() },
    click(label: string) { const node = button(label); assert.equal(node.props.disabled, false, `${label} is disabled`); (node.props.onClick as () => void)(); render() },
    async settle() { for (let index = 0; index < 4; index++) { render(); await new Promise<void>(resolve => setImmediate(resolve)) }; return render() },
    dispose() { for (const effect of effects.values()) effect.cleanup?.() },
    reloads: () => reloads,
  }
}
const posts = (ui: ReturnType<typeof harness>) => ui.calls.filter(call => call.init?.method === 'POST')

test('profile choice requires explicit confirmation and submits only scoped references and expected versions', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle()
  assert.match(text(ui.render()), /Ingen profil är vald/)
  ui.select(); assert.equal(posts(ui).length, 0)
  ui.click('Använd profil'); assert.equal(posts(ui).length, 0)
  assert.match(text(ui.render()), /beställare, pris och övrigt avtalsinnehåll behålls/)
  ui.click('Bekräfta profilbyte'); await ui.settle()
  assert.equal(posts(ui).length, 1)
  const request = JSON.parse(String(posts(ui)[0].init?.body))
  assert.deepEqual(Object.keys(request).sort(), ['confirmed', 'legalNameVersion', 'organizationNumber', 'profileId', 'profileVersion', 'requestId', 'revision'])
  assert.equal(request.revision, 7); assert.equal(request.profileId, PROFILE); assert.equal(request.profileVersion, 4)
  assert.equal(request.legalNameVersion, 2); assert.equal(request.organizationNumber, '559281-0823'); assert.equal(request.confirmed, true)
  assert.match(request.requestId, /^[\da-f-]{36}$/)
  assert.equal(posts(ui)[0].url, `/api/action-cases/${CASE}/sender-profile`)
  assert.equal(posts(ui)[0].init?.credentials, 'same-origin')
  assert.deepEqual(ui.pendingChanges, [true, false]); assert.equal(ui.applied.length, 1)
  assert.equal(ui.applied[0].draft.introduction, 'Behåll inledningen')
  assert.match(text(ui.render()), /Styr Projekt Stockholm AB/)
})

test('dirty, locked, published and unavailable states prevent selecting a new profile', async t => {
  for (const reason of ['Spara avtalsutkastet först.', 'Avtalet är låst.', 'Återkalla det utskickade avtalet.']) {
    const ui = harness({ blockedReason: reason }); t.after(ui.dispose); await ui.settle()
    assert.equal(nodes(ui.render()).find(node => node.type === 'select')?.props.disabled, true)
    assert.equal(ui.button('Använd profil').props.disabled, true)
    assert.match(text(ui.render()), new RegExp(reason.replace('.', '\\.')))
    assert.equal(posts(ui).length, 0)
  }
  const missing = harness(); t.after(missing.dispose); missing.setChoices({ ...choices(), available: false }); await missing.settle()
  assert.match(text(missing.render()), /Profilval behöver aktiveras/)
  assert.equal(nodes(missing.render()).some(node => node.type === 'select'), false)
})

test('lost or malformed responses lock the exact request until the same selection is confirmed', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.select(); ui.click('Använd profil')
  let finish: (response: Response) => void = () => { throw new Error('No request') }
  ui.setResponder(() => new Promise<Response>(resolve => { finish = resolve }))
  ui.click('Bekräfta profilbyte')
  assert.equal(posts(ui).length, 1)
  assert.equal(ui.button('Sparar…').props.disabled, true)
  finish(new Response('upstream response lost', { status: 502 })); await ui.settle()
  assert.match(text(ui.render()), /Avtalsutkastet är låst under tiden/)
  const first = posts(ui)[0].init?.body
  ui.setResponder(() => Response.json({ saved: true }))
  ui.click('Försök samma byte igen'); await ui.settle()
  assert.equal(posts(ui)[1].init?.body, first); assert.equal(ui.applied.length, 0)
  assert.equal(nodes(ui.render()).find(node => node.type === 'select')?.props.disabled, true)
  ui.setResponder(call => call.init?.method === 'POST' ? Response.json({ saved: true, workspace: workspace() }) : Response.json(choices()))
  ui.click('Försök samma byte igen'); await ui.settle()
  assert.equal(posts(ui)[2].init?.body, first); assert.equal(ui.applied.length, 1)
  assert.equal(ui.pendingChanges.at(-1), false)
})

test('a known stale version rejection unlocks without applying data and offers explicit reload', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.select(); ui.click('Använd profil')
  ui.setResponder(call => call.init?.method === 'POST' ? Response.json({ code: 'CUSTOMER_SENDER_STALE', error: 'Profilen har ändrats. Hämta den igen.' }, { status: 409 }) : Response.json(choices()))
  ui.click('Bekräfta profilbyte'); await ui.settle()
  assert.equal(ui.applied.length, 0); assert.equal(ui.pendingChanges.at(-1), false)
  assert.match(text(ui.render()), /Profilen har ändrats/)
  ui.click('Hämta aktuellt avtal'); await ui.settle(); assert.equal(ui.reloads(), 1)
})

test('foreign profiles and mismatched success snapshots never become the current selection', async t => {
  const invalid = harness(); t.after(invalid.dispose)
  invalid.setChoices({ ...choices(), profiles: [profile({ orgId: FOREIGN })] }); await invalid.settle()
  assert.equal(nodes(invalid.render()).some(node => node.type === 'select'), false)
  assert.match(text(invalid.render()), /kunde inte kontrolleras/)
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.select(); ui.click('Använd profil')
  const wrong = workspace(); wrong.draft.senderProfile = snapshot({ organizationId: FOREIGN })
  ui.setResponder(() => Response.json({ saved: true, workspace: wrong }))
  ui.click('Bekräfta profilbyte'); await ui.settle()
  assert.equal(ui.applied.length, 0); assert.equal(ui.pendingChanges.at(-1), true)
  assert.equal(ui.button('Försök samma byte igen').props.disabled, false)
})

test('archived selection stays visible and a newer profile version requires a deliberate update', async t => {
  const ui = harness({ selected: snapshot() }); t.after(ui.dispose)
  ui.setChoices({ ...choices(), selected: snapshot(), profiles: [profile({ isActive: false })] }); await ui.settle()
  assert.match(text(ui.render()), /arkiverad eller inte tillgänglig/)
  assert.equal(ui.button('Uppdatera profiluppgifter').props.disabled, true)
  ui.setChoices({ ...choices(), selected: snapshot(), profiles: [profile({ version: 5 })] }); ui.click('Hämta profiler'); await ui.settle()
  assert.equal(ui.button('Uppdatera profiluppgifter').props.disabled, false)
  assert.equal(posts(ui).length, 0)
})

test('organization number changes require explicit reapplication even with unchanged profile and legal-name versions', async t => {
  const ui = harness({ selected: snapshot() }); t.after(ui.dispose)
  ui.setChoices({ ...choices(), organization: { ...choices().organization, organizationNumber: '556000-0000' } }); await ui.settle()
  assert.equal(ui.button('Uppdatera profiluppgifter').props.disabled, false)
  assert.equal(posts(ui).length, 0)
})

test('an exact retry receipt can show a later valid selection without replaying over another user', async t => {
  const ui = harness(); t.after(ui.dispose); await ui.settle(); ui.select(); ui.click('Använd profil')
  ui.setResponder(() => new Response('lost response', { status: 502 }))
  ui.click('Bekräfta profilbyte'); await ui.settle()
  const first = posts(ui)[0].init?.body
  const later = workspace(); later.revision = 9
  later.draft.senderProfile = snapshot({ profileId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Senare vald profil' })
  ui.setResponder(call => call.init?.method === 'POST' ? Response.json({ saved: true, workspace: later }) : Response.json(choices()))
  ui.click('Försök samma byte igen'); await ui.settle()
  assert.equal(posts(ui)[1].init?.body, first)
  assert.equal(ui.applied[0].revision, 9); assert.equal(ui.pendingChanges.at(-1), false)
  assert.match(text(ui.render()), /Avtalet har därefter ändrats/)
  assert.match(text(ui.render()), /Senare vald profil/)
})

test('selected profile fields are read-only while personal contact details remain editable', () => {
  const parties = load<{ ContractContractorEditor: (props: object) => UiNode }>('src/components/tasks/CustomerContractPartiesEditor.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
  })
  const changed: unknown[] = []
  const value = { companyName: 'Styr Projekt Stockholm AB', organizationNumber: '559281-0823', contactName: 'Anna', mobile: '070123',
    street: 'Testgatan 1', postalCode: '11122', city: 'Stockholm', phone: '08123', fax: '', email: 'styr@example.test', fTax: 'yes' }
  const tree = parties.ContractContractorEditor({ value, source: { companyName: 'Gammal profil' }, companyFieldsReadonly: true, onChange: (next: unknown) => changed.push(next) })
  assert.doesNotMatch(text(tree), /Hämta företagsuppgifter/)
  for (const label of ['Firma', 'Organisationsnummer', 'Gata/Box', 'Postnummer', 'Ort', 'Telefon', 'E-postadress']) {
    const control = nodes(tree).find(node => node.props['aria-label'] === `Entreprenör: ${label}`)!
    assert.equal(control.props.disabled, true)
    ;(control.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'ignored' } })
  }
  assert.equal(changed.length, 0)
  for (const label of ['Kontaktperson', 'Mobiltelefon', 'Fax']) assert.equal(nodes(tree).find(node => node.props['aria-label'] === `Entreprenör: ${label}`)?.props.disabled, false)
  assert.equal(nodes(tree).find(node => node.type === 'select')?.props.disabled, undefined)
})

test('editor keeps profile request state mounted and guards autosave and manual actions while unresolved', () => {
  const editor = source('src/components/tasks/CustomerOfferEditor.tsx')
  assert.match(editor, /draftTarget === 'contract' && <div hidden=\{!contractView\}/)
  assert.match(editor, /if \(senderOperation\.current \|\| running\.current \|\| autosave\.isPending\(\)\) return false/)
  assert.equal((editor.match(/if \(senderOperation\.current\) return/g) ?? []).length, 2)
  assert.match(editor, /if \(!dirty && !planningDirty && !billingDirty && !senderPending\) return/)
  assert.match(editor, /issuerName: draft\.senderProfile\?\.name \?\? issuerName/)
  assert.match(editor, /companyFieldsReadonly=\{Boolean\(draft\.senderProfile\)\}/)
})
