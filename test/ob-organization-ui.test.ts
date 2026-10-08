/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled dynamic module and React-hook harness. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires explicit TypeScript extensions.
import { organizationContextHarness } from './helpers/organization-context-harness.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loaded = { exports: {} as Record<string, (...args: any[]) => any> }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  }, loaded, loaded.exports, ...Object.values(globals))
  return loaded.exports
}
const navigation = load('src/lib/organizations/navigation.ts', {})
const organizationA = { id: '11111111-1111-4111-8111-111111111111', name: 'A', isDefault: true }
const organizationB = { id: '22222222-2222-4222-8222-222222222222', name: 'B', isDefault: false }

const harness = organizationContextHarness

test('OB switcher includes all work surfaces, excludes the legacy settings editor and leaves detail IDs behind', () => {
  for (const path of ['/ob', '/ob/assignments', '/ob/assignments/new', '/ob/assignments/id', '/inspections', '/properties/property/ob', '/properties/property/ob/inspection']) {
    assert.equal(navigation.organizationSwitcherSurfaceForPath(path), 'ob')
  }
  for (const path of ['/ob/settings', '/ob-other', '/properties/property', '/eb', '/properties/property/ob/inspection/report']) assert.equal(navigation.organizationSwitcherSurfaceForPath(path), null)
  assert.deepEqual(navigation.obOrganizationEntityForPath('/properties/p/ob/i'), { inspectionId: 'i' })
  assert.deepEqual(navigation.obOrganizationEntityForPath('/ob/assignments/a'), { assignmentId: 'a' })
  assert.deepEqual(navigation.obOrganizationEntityForPath('/ob/assignments/new'), {})
  assert.equal(navigation.organizationSwitchDestination({ pathname: '/properties/p/ob/i', search: 'step=report&orgId=A', surface: 'ob', orgId: 'B' }), '/ob?orgId=B')
})

test('children do not mount before validation, and missing selector becomes explicit in the current tab only', async () => {
  const view = harness()
  assert.equal((await view.ready()).props.role, 'status')
  assert.equal(view.requests[0].url.searchParams.get('surface'), 'ob')
  assert.equal(view.requests[0].url.searchParams.has('orgId'), false)
  await view.finish(0)
  const result = view.render()
  assert.equal(result.type, 'Provider')
  assert.equal(result.props.value.id, organizationA.id)
  assert.equal(result.props.children, 'WORK')
  assert.deepEqual(view.replacements, [`/ob?orgId=${organizationA.id}`])
  view.dispose()
})

test('old detail links resolve authoritative entity organization without default selection', async () => {
  const view = harness()
  await view.ready('/properties/p/ob/i', 'section=report')
  assert.equal(view.requests[0].url.searchParams.get('inspectionId'), 'i')
  assert.equal(view.requests[0].url.searchParams.has('orgId'), false)
  await view.finish(0, organizationB)
  assert.equal(view.render().props.value.id, organizationB.id)
  assert.deepEqual(view.replacements, [`/properties/p/ob/i?section=report&orgId=${organizationB.id}`])
  view.dispose()
})

test('organization switch immediately hides old work, aborts old load and cannot accept its late response', async () => {
  const view = harness()
  await view.ready('/ob', `orgId=${organizationA.id}`)
  assert.equal(view.render('/ob', `orgId=${organizationB.id}`).props.role, 'status')
  assert.equal(view.requests[0].signal.aborted, true)
  await view.finish(1, organizationB)
  assert.equal(view.render().props.value.id, organizationB.id)
  await view.finish(0, organizationA)
  assert.equal(view.render().props.value.id, organizationB.id)
  assert.deepEqual(view.replacements, [])
  view.dispose()
})

test('duplicate selectors make no request; mismatched or unauthorized selection never renders work or falls back', async () => {
  const duplicate = harness()
  assert.equal(duplicate.render('/ob', 'orgId=A&orgId=B').type, 'main')
  assert.equal(duplicate.requests.length, 0)
  duplicate.dispose()
  const denied = harness()
  await denied.ready('/ob/assignments/a', `orgId=${organizationB.id}`)
  assert.equal(denied.requests[0].url.searchParams.get('assignmentId'), 'a')
  denied.requests[0].finish({ error: 'Uppdraget tillhör en annan organisation.' }, false)
  await setImmediate()
  assert.equal(denied.render().type, 'main')
  assert.equal(denied.requests.length, 1)
  assert.deepEqual(denied.replacements, [])
  denied.dispose()
})

test('unsaved work can cancel switching and pending mutations always block switching', () => {
  const view = harness()
  view.guard(true, false)
  assert.equal(view.switchAllowed(), false)
  view.setConfirmation(true)
  assert.equal(view.switchAllowed(), true)
  const previous = view.confirmCount()
  view.guard(false, true)
  assert.equal(view.switchAllowed(), false)
  assert.equal(view.confirmCount(), previous)
  view.dispose()
  assert.equal(view.switchAllowed(), true)
})

test('an inconsistent successful context reply cannot render the wrong organization', async () => {
  const view = harness()
  await view.ready('/ob', `orgId=${organizationA.id}`)
  await view.finish(0, organizationB)
  assert.equal(view.render().type, 'main')
  assert.deepEqual(view.replacements, [])
  view.dispose()
})

test('creation surfaces use a scoped server endpoint and no longer insert inspections from the browser', () => {
  for (const path of ['src/components/ob/ObHomeActions.tsx', 'src/app/(dashboard)/inspections/page.tsx', 'src/app/(app)/properties/[id]/ob/page.tsx']) {
    const source = read(path)
    assert.match(source, /fetch\(withObOrganization\('\/api\/ob\/inspections', orgId\)/)
    assert.doesNotMatch(source, /\.insert\(/)
    assert.match(source, /body\.orgId !== orgId/)
  }
})

test('company profile cards use the selected organization and retain frozen identity for locked inspections', () => {
  for (const path of ['src/components/ob/ObStepGrunddata.tsx', 'src/app/(dashboard)/ob/assignments/new/NewAssignmentClient.tsx']) {
    const source = read(path)
    assert.match(source, /loadObOrganizationInspectorProfile\(orgId, controller.signal\)/)
    assert.doesNotMatch(source, /\.from\('profiles'\)/)
  }
  assert.match(read('src/lib/ob/profileCardClient.ts'), /profileId: workspace.profileId, orgId/)
  assert.match(read('src/components/ob/ObStepGrunddata.tsx'), /isInspectionLocked \? frozenInspectorProfile : inspectorProfile/)
})

test('the inspector card loader never borrows another organization or defaults certifications', async () => {
  const certificationCalls: unknown[] = []
  let responseOrg = organizationB.id
  const api = load('src/lib/ob/profileCardClient.ts', {
    '@/lib/supabaseClient': { supabase: 'signed-in-client' },
    '@/lib/certifications/profileResolver': { resolveInspectorCertificationSummary: async (client: unknown, params: unknown) => {
      assert.equal(client, 'signed-in-client')
      certificationCalls.push(params)
      return { summary: { sbr_group: null, sbr_status: null, membership_number: null, certification_number: null, all_selected_items: [] } }
    } },
  }, { fetch: async (url: string) => {
    assert.equal(new URL(url, 'https://test.invalid').searchParams.get('orgId'), organizationB.id)
    return Response.json({ workspace: { profileId: 'person', organization: { id: responseOrg }, card: {
      displayName: 'Person in B', companyName: 'B company', email: 'person@example.invalid', phone: null,
      companyOrgNo: null, companyAddress: null, companyPostalCode: null, companyCity: null, avatarPath: null,
    } } })
  } })
  const result = await api.loadObOrganizationInspectorProfile(organizationB.id)
  assert.equal(result.company_name, 'B company')
  assert.deepEqual(certificationCalls, [{ profileId: 'person', orgId: organizationB.id }])
  responseOrg = organizationA.id
  await assert.rejects(api.loadObOrganizationInspectorProfile(organizationB.id), /Profilen/)
  assert.equal(certificationCalls.length, 1)
})

test('property inspection deletion blocks switching and concurrent writes, then removes only its successful row', async () => {
  const guards = harness()
  const hooks: { value?: any; deps?: unknown[] }[] = []
  let cursor = 0
  let effects: (() => void)[] = []
  let confirmed = true
  const deletes: { id: string; finish: (result: { error: unknown }) => void }[] = []
  const alerts: string[] = []
  const requests: string[] = []
  const jsx = (type: any, props: Record<string, unknown>, key?: string) => ({ type, props, key })
  const react = {
    useState(initial: unknown) {
      const hook = hooks[cursor++] ??= { value: initial }
      return [hook.value, (value: any) => { hook.value = typeof value === 'function' ? value(hook.value) : value }]
    },
    useMemo: (factory: () => unknown) => factory(),
    useEffect(effect: () => void, deps: unknown[]) {
      const hook = hooks[cursor++] ??= {}
      if (!hook.deps || deps.some((value, index) => value !== hook.deps![index])) {
        hook.deps = deps
        effects.push(effect)
      }
    },
  }
  const page = load('src/app/(app)/properties/[id]/ob/page.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { default: 'Link' },
    'next/navigation': { useParams: () => ({ id: 'property' }), useRouter: () => ({ push() {} }) },
    '@/components/Protected': { default: 'Protected' },
    '@/components/ob/ObOrganizationBoundary': {
      default: 'Boundary', useObOrganization: () => organizationA,
      withObOrganization: guards.component.withObOrganization,
      useObOrganizationSwitchGuard: (dirty: boolean, busy: boolean) => guards.guard(dirty, busy),
    },
    '@/lib/supabaseClient': { supabase: { from: (table: string) => table === 'properties'
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'property', name: 'Property' }, error: null }) }) }) }
      : { delete: () => ({ eq: (column: string, id: string) => {
        assert.equal(table, 'inspections'); assert.equal(column, 'id')
        return new Promise(resolve => deletes.push({ id, finish: resolve }))
      } }) } } },
  }, {
    confirm: () => confirmed, alert: (message: string) => alerts.push(message), console: { error() {} },
    fetch: async (url: string) => {
      requests.push(url)
      return Response.json({ inspections: ['first', 'second'].map(id => ({ id, property_id: 'property', date: null, created_at: '2026-10-02', status: 'draft' })) })
    },
  })
  const content = page.default().props.children.type
  const flatten = (node: any): any[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object'
    ? [node, ...flatten(node.props?.children)] : []
  const render = () => {
    cursor = 0; effects = []
    const result = flatten(content())
    for (const effect of effects) effect()
    return result
  }
  render(); await setImmediate()
  let nodes = render()
  const deleteButtons = () => nodes.filter(node => node.type === 'button' && node.props.children === 'Radera')
  const rowKeys = () => nodes.filter(node => node.type === 'tr' && node.key).map(node => node.key)
  deleteButtons()[0].props.onClick()
  nodes = render()
  assert.equal(guards.switchAllowed(), false)
  assert.deepEqual(rowKeys(), ['first', 'second'])
  assert.ok(deleteButtons().every(node => node.props.disabled))
  const createButtons = nodes.filter(node => node.type === 'button' && node.props.onClick?.name === 'handleCreateNew')
  assert.ok(createButtons.length > 0 && createButtons.every(node => node.props.disabled))
  await createButtons[0].props.onClick()
  deleteButtons()[1].props.onClick()
  assert.equal(requests.length, 1); assert.equal(deletes.length, 1)
  assert.equal(deletes[0].id, 'first')
  deletes[0].finish({ error: null }); await setImmediate()
  nodes = render()
  assert.equal(guards.switchAllowed(), true)
  assert.deepEqual(rowKeys(), ['second'])
  deleteButtons()[0].props.onClick()
  nodes = render()
  deletes[1].finish({ error: new Error('Denied') }); await setImmediate()
  nodes = render()
  assert.deepEqual(rowKeys(), ['second'])
  assert.equal(alerts.length, 1); assert.equal(guards.switchAllowed(), true)
  confirmed = false
  deleteButtons()[0].props.onClick()
  assert.equal(deletes.length, 2)
  guards.dispose()
})

test('Grunddata guards every dirty form and pending write; only matching successful saves clear dirty state', () => {
  const hooks: { value?: any; deps?: unknown[] }[] = []
  let cursor = 0
  let effects: (() => void)[] = []
  const draft = load('src/components/ob/useObFormDraft.ts', { react: {
    useRef(initial: unknown) { const hook = hooks[cursor++] ??= { value: { current: initial } }; return hook.value },
    useState(initial: unknown) {
      const hook = hooks[cursor++] ??= { value: initial }
      return [hook.value, (value: unknown) => { hook.value = value }]
    },
    useCallback: (callback: unknown) => callback,
    useEffect(effect: () => void, deps: unknown[]) {
      const hook = hooks[cursor++] ??= {}
      if (!hook.deps || deps.some((value, index) => value !== hook.deps![index])) { hook.deps = deps; effects.push(effect) }
    },
  } })
  const render = (incoming = { address: 'Server address' }) => {
    cursor = 0; effects = []
    const result = draft.useObFormDraft('inspection', incoming)
    for (const effect of effects) effect()
    return result
  }
  const source = read('src/components/ob/ObStepGrunddata.tsx')
  const ast = ts.createSourceFile('Grunddata.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let guardArgs = ''
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useObOrganizationSwitchGuard') {
      guardArgs = node.arguments.map(argument => argument.getText(ast)).join(',')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(guardArgs)
  const fields = ['propertyDirty', 'inspectionDirty', 'ordererDirty', 'savingProp', 'savingInsp', 'savingOrderer', 'uploadingCover', 'changingInspectionSide', 'changingObjectType']
  const computeGuard = new Function(...fields, `return [${guardArgs}]`) as (...flags: boolean[]) => [boolean, boolean]
  const guards = harness()
  for (let index = 0; index < fields.length; index++) {
    const flags = fields.map((_, position) => position === index)
    assert.deepEqual(computeGuard(...flags), index < 3 ? [true, false] : [false, true])
  }
  let state = render()
  assert.equal(state[3], false)
  state[1]({ address: 'New address' }); state = render()
  guards.guard(state[3], false)
  assert.equal(guards.switchAllowed(), false)
  guards.setConfirmation(true)
  assert.equal(guards.switchAllowed(), true)
  guards.guard(state[3], true)
  assert.equal(guards.switchAllowed(), false)
  // A failed save does not acknowledge anything; server refresh cannot erase it.
  state = render({ address: 'Unchanged server address' })
  assert.equal(state[0].address, 'New address'); assert.equal(state[3], true)
  guards.setConfirmation(false); guards.guard(state[3], false)
  assert.equal(guards.switchAllowed(), false)
  state[2]({ address: 'New address' }); state = render({ address: 'New address' })
  guards.guard(state[3], false)
  assert.equal(state[3], false); assert.equal(guards.switchAllowed(), true)
  // A delayed success for an older value must not clear a newer edit.
  state[1]({ address: 'Latest address' }); state = render()
  state[2]({ address: 'New address' }); state = render()
  assert.equal(state[0].address, 'Latest address'); assert.equal(state[3], true)
  guards.dispose()
})
