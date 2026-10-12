import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const formPath = 'src/components/organizations/OrganizationCreateForm.tsx'
const pagePath = 'src/app/(app)/(organization-onboarding)/settings/organisation/skapa/page.tsx'
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
type UiNode = { type: unknown; props: Record<string, unknown> }
const jsx = (type: unknown, props: Record<string, unknown>): UiNode => ({ type, props })

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
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

function harness() {
  const hooks: unknown[] = []
  let cursor = 0
  const component = load<{ default: () => UiNode }>(formPath, {
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
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': 'Link', 'lucide-react': {},
  })
  const render = () => { cursor = 0; return component.default() }
  const change = (name: string, value: string) => {
    const control = nodes(render()).find(node => node.type === 'input' && node.props.name === name)!
    ;(control.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } })
  }
  const submit = () => {
    const form = nodes(render()).find(node => node.type === 'form')!
    return (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => undefined })
  }
  const locked = () => nodes(render()).find(node => node.type === 'fieldset')?.props.disabled
  return { render, change, submit, locked }
}

async function withBrowser(task: (browser: { confirmations: string[]; destinations: string[] }) => Promise<void>) {
  const originalFetch = globalThis.fetch
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const confirmations: string[] = []
  const destinations: string[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    confirm: (text: string) => { confirmations.push(text); return true },
    location: { assign: (url: string) => { destinations.push(url) } },
  } })
  try { await task({ confirmations, destinations }) }
  finally {
    globalThis.fetch = originalFetch
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('organization creation authenticates without requiring an existing membership or product permission', async () => {
  let user: object | null = { id: 'new-account' }
  const redirects: string[] = []
  const page = load<{ default: () => Promise<UiNode> }>(pagePath, {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { redirect: (url: string) => { redirects.push(url); throw new Error('REDIRECT') } },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
    '@/components/organizations/OrganizationCreateForm': { default: 'CreateForm' },
    '@/components/settings/SettingsNav': { default: 'SettingsNav' },
  })
  assert.ok(nodes(await page.default()).some(node => node.type === 'CreateForm'))
  user = null
  await assert.rejects(page.default(), /REDIRECT/)
  assert.deepEqual(redirects, ['/login?next=%2Fsettings%2Forganisation%2Fskapa'])
  assert.doesNotMatch(source(pagePath), /requireProductAccess|requireModuleAccess|requireOrganizationContext/)
})

test('zero-product access preserves the settings gate and offers only the separate creation entry', async () => {
  const calls: string[] = []
  const layout = load<{ default: (props: { children: string }) => Promise<UiNode> }>('src/app/(app)/settings/layout.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { default: 'Link' },
    'next/navigation': { redirect: () => { throw new Error('REDIRECT') } },
    '@/lib/access/server': { requireProductAccess: async (key: string) => { calls.push(key); throw new Error('PRODUCT_ACCESS_REQUIRED') } },
  })
  const tree = await layout.default({ children: 'protected-settings-content' })
  assert.deepEqual(calls, ['dashboard'])
  assert.ok(nodes(tree).some(node => node.props.href === '/settings/organisation/skapa'))
  assert.doesNotMatch(JSON.stringify(tree), /protected-settings-content/)
})

test('creation only unlocks after a known, correctly classified rejection', () => {
  const form = load<{ isDefinitiveOrganizationCreateFailure: (status: number, code: unknown) => boolean; createdOrganizationDestination: (payload: unknown) => string | null }>(formPath, { react: {}, 'react/jsx-runtime': {}, 'next/link': {}, 'lucide-react': {} })
  assert.equal(form.isDefinitiveOrganizationCreateFailure(409, 'ORG_NUMBER_EXISTS'), true)
  assert.equal(form.isDefinitiveOrganizationCreateFailure(403, 'ORG_EMAIL_UNVERIFIED'), true)
  assert.equal(form.isDefinitiveOrganizationCreateFailure(429, 'ORG_CREATE_LIMIT'), true)
  assert.equal(form.isDefinitiveOrganizationCreateFailure(409, 'ORG_LEGACY_ACCESS_REVIEW_REQUIRED'), true)
  for (const [status, code] of [[500, 'ORG_NUMBER_EXISTS'], [409, 'ORG_CONFLICT'], [200, 'ORG_INPUT_INVALID'], [404, 'upstream-failure'], [409, null], [409, 'toString']] as const) {
    assert.equal(form.isDefinitiveOrganizationCreateFailure(status, code), false)
  }
  const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  assert.equal(form.createdOrganizationDestination({ saved: true, organizationId: orgId }), `/settings/organisation?orgId=${orgId}`)
  for (const payload of [null, {}, { saved: false, organizationId: orgId }, { saved: true, organizationId: 'https://example.test' }, { saved: true, organizationId: `${orgId}&admin=true` }]) assert.equal(form.createdOrganizationDestination(payload), null)
})

test('double submission is suppressed and unknown outcomes retry the exact request before navigating', async () => {
  await withBrowser(async browser => {
    const ui = harness()
    ui.change('name', '  Testbolaget  ')
    ui.change('organizationNumber', '  559281-0823  ')
    const requests: { url: unknown; options?: RequestInit }[] = []
    let resolveRequest: ((value: Response) => void) | undefined
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options })
      return new Promise<Response>(resolve => { resolveRequest = resolve })
    }
    const first = ui.submit()
    await ui.submit()
    assert.equal(requests.length, 1)
    assert.equal(ui.locked(), true)
    resolveRequest!(new Response('upstream unavailable', { status: 502 }))
    await first
    assert.equal(ui.locked(), true, 'Unknown result must not allow payload edits')
    const firstPayload = JSON.parse(String(requests[0].options?.body))
    assert.deepEqual(Object.keys(firstPayload).sort(), ['name', 'organizationNumber', 'requestId'])
    assert.equal(firstPayload.name, 'Testbolaget')
    assert.equal(firstPayload.organizationNumber, '559281-0823')
    assert.equal(requests[0].url, '/api/organizations')
    assert.equal(requests[0].options?.credentials, 'same-origin')
    const retry = ui.submit()
    assert.equal(requests.length, 2)
    assert.equal(requests[1].options?.body, requests[0].options?.body)
    const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    resolveRequest!(new Response(JSON.stringify({ saved: true, organizationId: orgId })))
    await retry
    assert.equal(browser.confirmations.length, 1, 'Retries must not repeat creation confirmation')
    assert.deepEqual(browser.destinations, [`/settings/organisation?orgId=${orgId}`])
    await ui.submit()
    assert.equal(requests.length, 2, 'Confirmed creation must not be posted again')
  })
})

test('definitive rejection permits correcting the input with a fresh request ID', async () => {
  await withBrowser(async browser => {
    const ui = harness()
    ui.change('name', 'Testbolaget')
    ui.change('organizationNumber', '559281-0823')
    const requests: string[] = []
    globalThis.fetch = async (_url, options) => {
      requests.push(String(options?.body))
      return new Response(JSON.stringify({ code: 'ORG_NUMBER_EXISTS', error: 'Be om en inbjudan.' }), { status: 409 })
    }
    await ui.submit()
    assert.equal(ui.locked(), false)
    ui.change('name', 'Annat företag')
    await ui.submit()
    assert.notEqual(JSON.parse(requests[0]).requestId, JSON.parse(requests[1]).requestId)
    assert.equal(JSON.parse(requests[1]).name, 'Annat företag')
    assert.equal(browser.confirmations.length, 2)
    assert.equal(browser.destinations.length, 0)
  })
})

test('malformed success does not navigate, unlock fields or lose the idempotency payload', async () => {
  await withBrowser(async browser => {
    const ui = harness()
    ui.change('name', 'Testbolaget')
    ui.change('organizationNumber', '559281-0823')
    const requests: string[] = []
    globalThis.fetch = async (_url, options) => {
      requests.push(String(options?.body))
      return new Response(JSON.stringify({ saved: true, organizationId: '/admin' }))
    }
    await ui.submit()
    assert.equal(ui.locked(), true)
    await ui.submit()
    assert.equal(requests[0], requests[1])
    assert.deepEqual(browser.destinations, [])
  })
})

test('creation entries and form respect dirty navigation, keep the existing default and explain the boundary', () => {
  const form = source(formPath)
  assert.match(form, /window\.addEventListener\('beforeunload', onUnload\)/)
  assert.match(form, /hushub:before-organization-switch/)
  assert.match(form, /if \(completed\.current\) return/)
  assert.match(form, /Inga arbetsområden aktiveras automatiskt/)
  assert.match(form, /Du får inte HusHubs övergripande administratörsbehörighet/)
  assert.doesNotMatch(form, /api\/admin\/organizations|adminProfileId|moduleSetVersion|is_default|setDefault/)
  assert.match(source('src/components/organizations/OrganizationSettingsClient.tsx'), /href="\/settings\/organisation\/skapa" onClick=\{event => \{ if \(!canNavigate\(\)\)/)
  assert.match(source('src/app/(app)/settings/organisation/page.tsx'), /href="\/settings\/organisation\/skapa"/)
  assert.match(source('src/app/app/page.tsx'), /href="\/settings\/organisation\/skapa"/)
  assert.match(source('src/components/public/PublicLogin.tsx'), /'\/settings\/organisation\/skapa': 'Skapa organisation'/)
})
