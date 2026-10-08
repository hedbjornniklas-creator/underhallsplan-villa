import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const uiPath = 'src/app/(app)/admin/access/organisations/OrganizationAdministrationClient.tsx'
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  }, mod, mod.exports)
  return mod.exports as T
}

test('organization admin page requires explicit global access-management gate', async () => {
  const calls: unknown[] = []
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const page = load<{ default: () => Promise<unknown> }>('src/app/(app)/admin/access/organisations/page.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/navigation': { redirect: () => { throw new Error('REDIRECT') } },
    '@/lib/access/server': { requireModuleAccess: async (scope: unknown) => { calls.push(scope) } },
    './OrganizationAdministrationClient': { default: 'Client' },
  })
  await page.default()
  assert.deepEqual(calls, [{ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' }])
})

test('draft comparison is order independent and checks role, membership and modules separately', () => {
  const ui = load<{ sameModules: (a: string[], b: string[]) => boolean; sameMember: (a: object, b: object) => boolean }>(uiPath, {
    react: {}, 'react/jsx-runtime': {}, 'next/link': {},
  })
  assert.equal(ui.sameModules(['b', 'a'], ['a', 'b']), true)
  const member = { role: 'inspector', isActive: true, modules: [] }
  assert.equal(ui.sameMember(member, { ...member }), true)
  assert.equal(ui.sameMember(member, { ...member, role: 'admin' }), false)
  assert.equal(ui.sameMember(member, { ...member, isActive: false }), false)
  assert.equal(ui.sameMember(member, { ...member, modules: ['technical_investigations'] }), false)
})

test('all central navigation surfaces expose organizations without replacing global module controls', () => {
  for (const file of ['src/app/(app)/admin/AdminLandingClient.tsx', 'src/app/(app)/admin/access/AccessManagementClient.tsx']) {
    assert.match(source(file), /\/admin\/access\/organisations/)
  }
  const access = source('src/app/(app)/admin/access/AccessManagementClient.tsx')
  assert.match(access, /Detta är en profiltext, inte medlemskap eller behörighet/)
  assert.match(access, /Öppna organisationshantering i ny flik/)
  assert.match(access, /scopeType: 'global'/)
})

test('write UI remains explicit, preserves optimistic baselines and freezes create retries', () => {
  const ui = source(uiPath)
  assert.match(ui, /window\.confirm/)
  assert.match(ui, /expectedModules: detail\.organization\.modules/)
  assert.match(ui, /memberBaselines\[profileId\]/)
  assert.match(ui, /pendingEdits\.current/)
  assert.match(ui, /generation !== detailGeneration\.current \|\| id !== selectedRef\.current/)
  assert.match(ui, /if \(!createAttempted\) setCreate/)
  assert.match(ui, /fieldset disabled=\{createAttempted\}/)
  assert.match(ui, /Väntande inbjudningar som innehåller något av dessa arbetsområden återkallas i sin helhet/)
  assert.match(ui, /EB och övriga moduler lämnas oförändrade/)
  assert.match(ui, /Ingen e-post skickas här/)
  assert.equal((ui.match(/moduleSetVersion: 2/g) ?? []).length, 3)
})

test('central admin lists and toggles OB and TU independently without losing the other module', () => {
  const ui = load<{ moduleLabel: (modules: string[]) => string; toggleModule: (modules: string[], module: string, enabled: boolean) => string[] }>(uiPath, {
    react: {}, 'react/jsx-runtime': {}, 'next/link': {},
  })
  assert.equal(ui.moduleLabel(['inspections']), 'Överlåtelsebesiktning (ÖB)')
  assert.equal(ui.moduleLabel(['technical_investigations']), 'Tekniska utredningar (TU)')
  assert.match(ui.moduleLabel(['inspections', 'technical_investigations']), /ÖB.*TU/)
  assert.deepEqual(ui.toggleModule(['technical_investigations'], 'inspections', true), ['technical_investigations', 'inspections'])
  assert.deepEqual(ui.toggleModule(['inspections', 'technical_investigations'], 'inspections', false), ['technical_investigations'])
  assert.deepEqual(ui.toggleModule(['inspections', 'technical_investigations'], 'technical_investigations', false), ['inspections'])
  assert.deepEqual(ui.toggleModule(['inspections'], 'inspections', true), ['inspections'])
})

test('module-disable confirmation identifies scoped revocation and mixed invitation impact', () => {
  const ui = load<{ moduleChangeWarning: (organization: object, modules: string[]) => string }>(uiPath, {
    react: {}, 'react/jsx-runtime': {}, 'next/link': {},
  })
  const organization = { modules: ['inspections', 'technical_investigations'], managedModules: ['inspections', 'technical_investigations'], tuManaged: true }
  const warning = ui.moduleChangeWarning(organization, ['technical_investigations'])
  assert.match(warning, /ÖB-behörigheter i denna organisation tas bort/)
  assert.doesNotMatch(warning, /TU-behörigheter i denna organisation tas bort/)
  assert.match(warning, /återkallas i sin helhet/)
  assert.match(warning, /andra organisationer och globala tilldelningar ändras inte/)
  const legacy = ui.moduleChangeWarning({ modules: ['technical_investigations'], managedModules: ['technical_investigations'], tuManaged: true }, ['inspections', 'technical_investigations'])
  assert.match(legacy, /Fastställ organisationsstyrning för ÖB/)
  assert.doesNotMatch(legacy, /behörigheter i denna organisation tas bort/)
})

test('TU-only saves leave absent OB management untouched without false warnings or perpetually enabled save', () => {
  const ui = load<{
    shouldSaveModules: (organization: object, modules: string[]) => boolean
    moduleChangeWarning: (organization: object, modules: string[]) => string
    moduleTransitions: (organization: object, modules: string[]) => { initialized: { key: string }[]; disabled: { key: string }[] }
  }>(uiPath, { react: {}, 'react/jsx-runtime': {}, 'next/link': {} })
  const organization = { modules: ['technical_investigations'], managedModules: ['technical_investigations'], tuManaged: true }
  assert.equal(ui.shouldSaveModules(organization, ['technical_investigations']), false)
  assert.equal(ui.shouldSaveModules(organization, []), true)
  const warning = ui.moduleChangeWarning(organization, [])
  assert.match(warning, /TU-behörigheter i denna organisation tas bort/)
  assert.doesNotMatch(warning, /ÖB/)
  assert.deepEqual(ui.moduleTransitions(organization, []), { initialized: [], disabled: [{ key: 'technical_investigations', short: 'TU', label: 'Tekniska utredningar (TU)' }] })
  assert.equal(ui.shouldSaveModules({ modules: [], managedModules: ['technical_investigations'], tuManaged: true }, []), false)
  const legacy = { modules: [], managedModules: [], tuManaged: false }
  assert.equal(ui.shouldSaveModules(legacy, []), true, 'Legacy TU alone may be established implicitly')
  assert.deepEqual(ui.moduleTransitions(legacy, []).initialized.map(module => module.key), ['technical_investigations'])
  assert.doesNotMatch(ui.moduleChangeWarning(legacy, []), /ÖB/)
  assert.deepEqual(ui.moduleTransitions(organization, ['inspections', 'technical_investigations']).initialized.map(module => module.key), ['inspections'])
})

test('invitation destination follows actual invited modules, not a hardcoded TU route', () => {
  const ui = load<{ invitationWorkspaceLinks: (modules: string[], orgId: string) => { href: string; label: string }[] }>('src/components/organizations/OrganizationInvitationAccept.tsx', {
    react: {}, 'react/jsx-runtime': {}, 'next/link': {}, 'lucide-react': {}, '@/lib/supabaseClient': {},
  })
  assert.deepEqual(ui.invitationWorkspaceLinks(['inspections'], 'org-a'), [{ href: '/ob?orgId=org-a', label: 'Gå till ÖB' }])
  assert.deepEqual(ui.invitationWorkspaceLinks(['technical_investigations'], 'org-b'), [{ href: '/tu?orgId=org-b', label: 'Gå till TU' }])
  assert.deepEqual(ui.invitationWorkspaceLinks(['inspections', 'technical_investigations'], 'org-a').map(link => link.href), ['/ob?orgId=org-a', '/tu?orgId=org-a'])
  assert.deepEqual(ui.invitationWorkspaceLinks([], 'org-a'), [])
  assert.deepEqual(ui.invitationWorkspaceLinks(['construction_inspections'], 'org-a'), [])
})

test('organization invitations retain least privilege defaults and an explicit OB choice', () => {
  const ui = source('src/components/organizations/OrganizationSettingsClient.tsx')
  assert.match(ui, /useState<Role>\('inspector'\)/)
  assert.match(ui, /useState<string\[\]>\(\['technical_investigations'\]\)/)
  assert.match(ui, /key: 'inspections', label: 'ÖB – överlåtelsebesiktning'/)
  assert.match(ui, /key: 'technical_investigations', label: 'TU – teknisk utredning'/)
  assert.doesNotMatch(ui, /key: 'construction_inspections'/)
  assert.match(ui, /role === 'inspector' && invitationModules\.length === 0/)
  assert.match(ui, /Använd personens befintliga inloggningsmejl/)
  assert.equal((ui.match(/moduleSetVersion: 2/g) ?? []).length, 2)
})

test('member editor clears OB and TU on deactivation, does not resurrect them, and submits an inactive empty grant list', async () => {
  type UiNode = { type: unknown; props: Record<string, unknown> }
  const values: unknown[] = []
  let hookIndex = 0
  const jsx = (type: unknown, props: Record<string, unknown>): UiNode => ({ type, props })
  const ui = load<{ MemberEditor: (props: object) => UiNode }>('src/components/organizations/OrganizationSettingsClient.tsx', {
    react: {
      useState: (initial: unknown) => {
        const index = hookIndex++
        if (index >= values.length) values[index] = initial
        return [values[index], (next: unknown) => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
      },
      useRef: (current: unknown) => ({ current }), useEffect: () => undefined,
    },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': {}, 'next/navigation': { useRouter: () => ({ refresh: () => undefined }) },
    'lucide-react': {}, '@/components/settings/FortnoxConnectionCard': {},
  })
  const member = { profileId: 'colleague', displayName: 'Kollega', email: 'colleague@example.test', role: 'inspector', isActive: true, modules: ['inspections', 'technical_investigations'] }
  const render = () => { hookIndex = 0; return ui.MemberEditor({ member, orgId: 'org-a', isSelf: false, enabledModules: member.modules, disabled: false, onSaved: async () => undefined }) }
  function nodes(node: unknown): UiNode[] {
    if (Array.isArray(node)) return node.flatMap(nodes)
    if (!node || typeof node !== 'object' || !('props' in node)) return []
    const element = node as UiNode
    return [element, ...nodes(element.props.children)]
  }
  const checkboxes = (tree: UiNode) => nodes(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox')
  function activate(tree: UiNode, active: boolean) {
    const control = nodes(tree).find(node => node.type === 'select' && ['active', 'inactive'].includes(String(node.props.value)))!
    ;(control.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: active ? 'active' : 'inactive' } })
  }
  let tree = render()
  assert.equal(checkboxes(tree).length, 2)
  assert.ok(checkboxes(tree).every(node => node.props.checked === true))
  activate(tree, false)
  tree = render()
  assert.ok(checkboxes(tree).every(node => node.props.checked === false && node.props.disabled === true))
  activate(tree, true)
  tree = render()
  assert.ok(checkboxes(tree).every(node => node.props.checked === false && node.props.disabled === false), 'Reactivation must not restore old grants')
  activate(tree, false)
  tree = render()
  const originalFetch = globalThis.fetch
  const requests: { url: unknown; options?: RequestInit }[] = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response('{}', { status: 200 }) }
  try {
    await (tree.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => undefined })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/api/organizations/members')
    assert.equal(requests[0].options?.method, 'PATCH')
    assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { orgId: 'org-a', moduleSetVersion: 2, profileId: 'colleague', role: 'inspector', isActive: false, modules: [] })
  } finally { globalThis.fetch = originalFetch }
})
