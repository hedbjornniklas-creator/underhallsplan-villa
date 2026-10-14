import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const ORG = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)((key: string) => {
    if (Object.hasOwn(dependencies, key)) return dependencies[key]
    throw new Error(`Unexpected import ${key}`)
  }, mod, mod.exports)
  return mod.exports as T
}
type Result = { data: unknown; error: { code?: string; message?: string } | null }
type Permission = { canViewColleagues: boolean; revision: number; canEnable?: boolean }
type Domain = {
  listOrganizationObVisibility(orgId: string): Promise<{ permissions: Record<string, Permission>; migrationRequired: boolean }>
  setOrganizationObVisibility(values: Record<string, unknown>): Promise<Permission & { saved: boolean }>
}
type Http = {
  organizationFailure(error: Error): Response
  isOrganizationUuid(value: unknown): boolean
  readOrganizationJson(request: Request): Promise<Record<string, unknown>>
}
const http = load<Http>('src/lib/organizations/administrationHttp.ts', {})
function harness(options: { denied?: boolean; query?: Result; rpc?: Result } = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const db = {
    from: (table: string) => {
      calls.push({ name: 'from', args: [table] })
      const builder: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'limit']) builder[name] = (...args: unknown[]) => { calls.push({ name, args }); return builder }
      builder.then = (resolve: (r: Result) => unknown) => Promise.resolve(options.query ?? { data: [], error: null }).then(resolve)
      return builder
    },
    rpc: async (...args: unknown[]) => { calls.push({ name: 'rpc', args }); return args[0] === 'organization_member_ob_visibility_list'
      ? options.query ?? { data: [], error: null } : options.rpc ?? { data: { saved: true, canViewColleagues: true, revision: 1 }, error: null } },
  }
  const domain = load<Domain>('src/lib/organizations/obVisibilityAdministration.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/administration': { requireOrganizationAdmin: async (orgId: string) => {
      calls.push({ name: 'admin', args: [orgId] })
      if (options.denied) throw new Error('ORG_ADMIN_REQUIRED')
      return { profileId: ACTOR, organization: { id: ORG } }
    } },
  })
  return { domain, calls }
}
const draft = { orgId: ORG, profileId: MEMBER, canViewColleagues: true, revision: 0 }

test('ordinary members cannot read or set another member permission', async () => {
  const { domain, calls } = harness({ denied: true })
  await assert.rejects(domain.listOrganizationObVisibility(ORG), /ORG_ADMIN_REQUIRED/)
  await assert.rejects(domain.setOrganizationObVisibility(draft), /ORG_ADMIN_REQUIRED/)
  assert.deepEqual(calls.map(c => c.name), ['admin', 'admin'])
})
test('default-off list is organization scoped and missing migration is explicit', async () => {
  const { domain, calls } = harness()
  assert.deepEqual(await domain.listOrganizationObVisibility(ORG), { permissions: {}, migrationRequired: false })
  assert.deepEqual(calls.find(c => c.name === 'rpc')?.args, ['organization_member_ob_visibility_list', { p_actor: ACTOR, p_org: ORG }])
  const absent = harness({ query: { data: null, error: { code: '42P01' } } })
  assert.deepEqual(await absent.domain.listOrganizationObVisibility(ORG), { permissions: {}, migrationRequired: true })
})
test('only strict boolean and nonnegative revision accepted; caller cannot choose actor', async () => {
  for (const change of [{ canViewColleagues: 'true' }, { canViewColleagues: 1 }, { revision: -1 }, { revision: 1.5 }, { profileId: 'other' }]) {
    const { domain, calls } = harness()
    await assert.rejects(domain.setOrganizationObVisibility({ ...draft, ...change }), /ORG_REQUEST_INVALID/)
    assert.equal(calls.length, 0)
  }
  const { domain, calls } = harness()
  assert.deepEqual(await domain.setOrganizationObVisibility({ ...draft, actor: MEMBER }), { saved: true, canViewColleagues: true, revision: 1 })
  assert.deepEqual(calls.find(c => c.name === 'rpc')?.args, ['organization_member_ob_visibility_set', {
    p_actor: ACTOR, p_org: ORG, p_profile: MEMBER, p_can_view: true, p_revision: 0,
  }])
})
test('conflicts, missing SQL and module denial are not reported as saved', async () => {
  for (const [error, expected] of [
    [{ message: 'ORG_CONFLICT' }, 'ORG_CONFLICT'],
    [{ code: 'PGRST202' }, 'ORG_OB_VISIBILITY_SCHEMA_REQUIRED'],
    [{ message: 'ORG_OB_VISIBILITY_MODULE_REQUIRED' }, 'ORG_OB_VISIBILITY_MODULE_REQUIRED'],
  ] as const) {
    await assert.rejects(harness({ rpc: { data: null, error } }).domain.setOrganizationObVisibility(draft), new RegExp(expected))
  }
  await assert.rejects(harness({ rpc: { data: { saved: true, canViewColleagues: false, revision: 1 }, error: null } }).domain.setOrganizationObVisibility(draft), /ORG_REQUEST_FAILED/)
})
test('permission PATCH rejects cross-origin before any domain write and returns private responses', async () => {
  let writes = 0
  const route = load<{ PATCH(req: Request): Promise<Response> }>('src/app/api/organizations/members/ob-visibility/route.ts', {
    '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/obVisibilityAdministration': { setOrganizationObVisibility: async () => { writes++; return { saved: true } } },
  })
  const request = (origin: string) => new Request('https://hushub.se/api/organizations/members/ob-visibility', {
    method: 'PATCH', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
  })
  assert.equal((await route.PATCH(request('https://elsewhere.test'))).status, 403)
  assert.equal(writes, 0)
  const response = await route.PATCH(request('https://hushub.se'))
  assert.equal(response.status, 200)
  assert.equal(writes, 1)
  assert.match(response.headers.get('cache-control')!, /private, no-store/)
})

type UiNode = { type: unknown; props: Record<string, unknown> }
const jsx = (type: unknown, props: Record<string, unknown>): UiNode => ({ type, props })
function nodes(value: unknown): UiNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  return [value as UiNode, ...nodes((value as UiNode).props.children)]
}
function ui(options: { active?: boolean; modules?: string[]; selected?: boolean; disabled?: boolean; canEnable?: boolean } = {}) {
  const hooks: unknown[] = []; let cursor = 0
  const component = load<{ ObVisibilityEditor(props: unknown): UiNode }>('src/components/organizations/OrganizationSettingsClient.tsx', {
    react: {
      useState: (initial: unknown) => { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], (v: unknown) => { hooks[i] = v }] },
      useRef: (initial: unknown) => { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i] },
      useEffect: () => undefined,
    },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': {}, 'next/navigation': {}, 'lucide-react': {},
    '@/components/settings/FortnoxConnectionCard': {}, './OrganizationSenderProfiles': {},
  })
  let refreshed = 0
  const render = () => { cursor = 0; return component.ObVisibilityEditor({
    member: { profileId: MEMBER, displayName: 'Kollega', email: 'member@example.test', isActive: options.active ?? true,
      modules: options.modules ?? ['inspections'], obVisibility: { canViewColleagues: options.selected ?? false, revision: 0, canEnable: options.canEnable ?? true } },
    orgId: ORG, disabled: options.disabled ?? false, onSaved: async () => { refreshed++ },
  }) }
  return { render, refreshed: () => refreshed }
}
test('admin checkbox starts off and saves explicitly with correct org/member/revision', async () => {
  const h = ui(); let tree = h.render()
  const input = nodes(tree).find(n => n.type === 'input')!
  assert.equal(input.props.checked, false)
  assert.equal(nodes(tree).find(n => n.type === 'button')!.props.disabled, true)
  ;(input.props.onChange as (e: unknown) => void)({ target: { checked: true } })
  tree = h.render()
  const button = nodes(tree).find(n => n.type === 'button')!
  assert.equal(button.props.disabled, false)
  const old = globalThis.fetch; const requests: unknown[] = []
  globalThis.fetch = async (url, init) => {
    requests.push([url, JSON.parse(String(init?.body))])
    return Response.json({ saved: true, canViewColleagues: true, revision: 1 })
  }
  try {
    ;(button.props.onClick as () => void)()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(requests, [['/api/organizations/members/ob-visibility', draft]])
    assert.equal(h.refreshed(), 1)
    assert.equal(nodes(h.render()).find(n => n.type === 'button')!.props.disabled, true)
  } finally { globalThis.fetch = old }
})
test('inactive/non-OB members cannot opt in; existing permission can still be switched off', () => {
  for (const options of [{ active: false }, { canEnable: false }, { disabled: true }]) {
    assert.equal(nodes(ui(options).render()).find(n => n.type === 'input')!.props.disabled, true)
  }
  assert.equal(nodes(ui({ canEnable: false, selected: true }).render()).find(n => n.type === 'input')!.props.disabled, false)
  assert.equal(nodes(ui({ modules: [], canEnable: true }).render()).find(n => n.type === 'input')!.props.disabled, false, 'eligible unmanaged grant is not confused with editable module list')
})
