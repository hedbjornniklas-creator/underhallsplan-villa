import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { OrganizationAdministrationWorkspace } from '../src/lib/organizations/administrationTypes.ts'

const clientPath = 'src/components/organizations/OrganizationSettingsClient.tsx'
const pagePath = 'src/app/(app)/settings/organisation/page.tsx'
type UiNode = { type: unknown; props: Record<string, unknown> }
type Tab = 'organization' | 'sender-profiles' | 'members' | 'integrations'
type ClientProps = { initialWorkspace: OrganizationAdministrationWorkspace; initialTab?: Tab }
const jsx = (type: unknown, props: Record<string, unknown>): UiNode => ({ type, props })

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  }, mod, mod.exports)
  return mod.exports as T
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
  if (!value || typeof value !== 'object' || !('props' in value)) return ''
  return text((value as UiNode).props.children)
}

function workspace(role: 'admin' | 'inspector'): OrganizationAdministrationWorkspace {
  return {
    profileId: 'viewer', role, modules: ['inspections', 'technical_investigations'], migrationRequired: false,
    organization: {
      id: 'current-org/with ?&=å', name: 'Aktuellt Företag AB', organizationNumber: '559281-0823',
      address: 'Testgatan 1', postalCode: '111 22', city: 'Stockholm', website: null,
      logoPath: null, reportFooterText: null, configured: true, version: 4,
    },
  }
}

function harness(initialWorkspace: OrganizationAdministrationWorkspace, initialTab: Tab = 'organization') {
  const hooks: unknown[] = []
  let cursor = 0
  const component = load<{ default: (props: ClientProps) => UiNode }>(clientPath, {
    react: {
      useState: (initial: unknown) => {
        const index = cursor++
        if (index >= hooks.length) hooks[index] = typeof initial === 'function' ? initial() : initial
        return [hooks[index], (next: unknown) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
      },
      useRef: (current: unknown) => {
        const index = cursor++
        if (index >= hooks.length) hooks[index] = { current }
        return hooks[index]
      },
      useEffect: () => undefined,
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'next/link': { default: 'a' },
    'next/navigation': { useRouter: () => ({ refresh: () => undefined }) },
    'lucide-react': {},
    '@/components/settings/FortnoxConnectionCard': { default: 'FortnoxConnectionCard' },
    './OrganizationSenderProfiles': { default: 'OrganizationSenderProfiles' },
  })
  const render = (props: ClientProps = { initialWorkspace, initialTab }) => {
    cursor = 0
    return component.default(props)
  }
  return { component: component.default, render }
}

function link(tree: UiNode, label: string): UiNode {
  const matches = nodes(tree).filter(node => node.type === 'a' && text(node) === label)
  assert.equal(matches.length, 1, `${label} must appear exactly once`)
  return matches[0]
}

function withNavigationDecision(allowed: boolean, task: (events: CustomEvent[]) => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events: CustomEvent[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: CustomEvent) => { events.push(event); return allowed } },
  })
  try { task(events) }
  finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('organization page renders only the compact settings navigation', async () => {
  const currentWorkspace = workspace('admin')
  const ui = harness(currentWorkspace)
  const requests: unknown[] = []
  const page = load<{ default: (props: { searchParams: Promise<{ orgId: string }> }) => Promise<UiNode> }>(pagePath, {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'a' },
    'next/navigation': { redirect: () => { throw new Error('Unexpected redirect') } },
    '@/components/organizations/OrganizationSettingsClient': { default: ui.component },
    '@/components/settings/SettingsNav': { default: 'nav' },
    '@/lib/organizations/administration': {
      getOrganizationWorkspace: async (orgId: unknown) => { requests.push(orgId); return currentWorkspace },
    },
  })
  const pageNodes = nodes(await page.default({ searchParams: Promise.resolve({ orgId: currentWorkspace.organization.id }) }))
  const clients = pageNodes.filter(node => node.type === ui.component)
  assert.equal(clients.length, 1)
  assert.deepEqual(requests, [currentWorkspace.organization.id])
  const renderedNodes = pageNodes.flatMap(node => node.type === ui.component ? nodes(ui.render(node.props as ClientProps)) : [node])
  const navigation = renderedNodes.filter(node => node.type === 'nav')
  assert.equal(navigation.length, 1)
  assert.equal(navigation[0].props['aria-label'], 'Organisationsinställningar')
})

for (const role of ['admin', 'inspector'] as const) {
  test(`compact navigation preserves current organization and ${role} access`, () => {
    const currentWorkspace = workspace(role)
    const tree = harness(currentWorkspace).render()
    const navigation = nodes(tree).filter(node => node.type === 'nav')
    assert.equal(navigation.length, 1)
    const buttons = nodes(navigation[0]).filter(node => node.type === 'button')
    assert.deepEqual(buttons.map(text), role === 'admin'
      ? ['Organisation', 'Avsändarprofiler', 'Medlemmar', 'Integrationer']
      : ['Organisation', 'Avsändarprofiler', 'Integrationer'])
    assert.equal(buttons.find(node => text(node) === 'Organisation')?.props['aria-current'], 'page')
    for (const [label, path] of [['Min profil', '/settings/profil'], ['Kundregister', '/settings/kunder']]) {
      const entry = link(tree, label)
      assert.equal(entry.props.href, `${path}?orgId=${encodeURIComponent(currentWorkspace.organization.id)}`)
      assert.ok(nodes(navigation[0]).includes(entry), `${label} belongs in the compact navigation`)
    }
    assert.equal(nodes(tree).filter(node => node.type === 'header').length, 0)
    assert.doesNotMatch(text(tree), /Aktiv arbetsorganisation|Företagets gemensamma uppgifter, medlemmar och anslutningar finns här/)
    const headings = nodes(tree).filter(node => node.type === 'h1')
    assert.equal(headings.length, 1)
    assert.match(String(headings[0].props.className), /(?:^|\s)sr-only(?:\s|$)/)
    assert.ok(text(headings[0]).trim(), 'The hidden page heading retains an accessible name')
  })

  test(`create-organization entry remains below the organization form for ${role}`, () => {
    const currentWorkspace = workspace(role)
    const tree = harness(currentWorkspace).render()
    const entry = link(tree, 'Skapa organisation')
    assert.equal(entry.props.href, '/settings/organisation/skapa')
    const allNodes = nodes(tree)
    const form = allNodes.find(node => node.type === 'form')!
    assert.ok(form)
    assert.ok(allNodes.indexOf(entry) > allNodes.indexOf(form))
    assert.equal(nodes(form).includes(entry), false, 'Creation is outside the company profile form')
    assert.equal(nodes(allNodes.find(node => node.type === 'nav')!).includes(entry), false)
    for (const tab of ['sender-profiles', 'integrations', ...(role === 'admin' ? ['members'] as const : [])] as const) {
      const otherTab = harness(currentWorkspace, tab).render()
      assert.equal(nodes(otherTab).filter(node => node.props.href === '/settings/organisation/skapa').length, 0, `No creation footer on ${tab}`)
    }
  })
}

test('inspector cannot open the members tab through the initial query', () => {
  const tree = harness(workspace('inspector'), 'members').render()
  assert.ok(nodes(tree).some(node => node.type === 'form'))
  const active = nodes(tree).filter(node => node.props['aria-current'] === 'page')
  assert.deepEqual(active.map(text), ['Organisation'])
  assert.equal(nodes(tree).some(node => node.type === 'button' && text(node) === 'Medlemmar'), false)
})

test('customer, profile and create links respect canceled and allowed unsaved-change navigation', () => {
  for (const allowed of [false, true]) {
    withNavigationDecision(allowed, events => {
      const currentWorkspace = workspace('admin')
      const ui = harness(currentWorkspace)
      const name = nodes(ui.render()).find(node => node.type === 'input' && node.props.value === currentWorkspace.organization.name)!
      ;(name.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Osparat företagsnamn' } })
      const tree = ui.render()
      assert.match(text(tree), /Du har osparade ändringar/)
      for (const label of ['Kundregister', 'Min profil', 'Skapa organisation']) {
        let prevented = false
        const entry = link(tree, label)
        ;(entry.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault: () => { prevented = true } })
        assert.equal(prevented, !allowed, `${label} honors the shared navigation decision`)
      }
      assert.equal(events.length, 3)
      for (const event of events) {
        assert.equal(event.type, 'hushub:before-organization-switch')
        assert.equal(event.cancelable, true)
        assert.deepEqual(event.detail, { fromOrgId: currentWorkspace.organization.id, orgId: currentWorkspace.organization.id })
      }
    })
  }
})
