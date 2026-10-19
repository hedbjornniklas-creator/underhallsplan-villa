import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { isValidElement, type ReactNode } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import ts from 'typescript'
import { authLoginUrl, safeAuthReturnPath } from '../src/lib/auth/returnPath.ts'
import * as recipientAuthPaths from '../src/lib/tasks/recipientAuthPaths.ts'

function loadModule(file: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name} in ${file}`)
    return dependencies[name]
  }, mod, mod.exports)
  return mod.exports
}

function serverRecovery(path: string | null) {
  return loadModule('src/lib/auth/serverRecovery.ts', {
    'server-only': {},
    'next/headers': { headers: async () => ({ get: (name: string) => name === 'x-hushub-return-path' ? path : null }) },
    '@/lib/auth/returnPath': { safeAuthReturnPath },
  }) as {
    currentAuthReturnPath: (fallback?: string) => Promise<string>
    authRecoveryReason: (error: unknown) => 'forbidden' | 'unavailable'
  }
}

const layouts = [
  ['src/app/(dashboard)/layout.tsx', '/dashboard-v1', { product: 'dashboard' }],
  ['src/app/(dashboard)/ob/layout.tsx', '/ob/assignments/draft-1?orgId=org-1&tab=details', { productKey: 'dashboard', moduleKey: 'inspections' }],
  ['src/app/(dashboard)/eb/layout.tsx', '/eb/projects/project-1/inspections/inspection-1/perform?view=round', { productKey: 'dashboard', moduleKey: 'construction_inspections' }],
  ['src/app/(dashboard)/tu/layout.tsx', '/tu/investigations/inspection-1?orgId=org-1&tab=report', { productKey: 'dashboard', moduleKey: 'technical_investigations' }],
  ['src/app/(dashboard)/fuktsakerhet/layout.tsx', '/fuktsakerhet/projekt/project-1?orgId=org-1', { productKey: 'dashboard', moduleKey: 'moisture_safety' }],
  ['src/app/(dashboard)/uppdrag/layout.tsx', '/uppdrag/case-1?view=contract', { productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: 'org-1' }],
  ['src/app/(app)/settings/layout.tsx', '/settings/organisation?orgId=org-1&tab=members', { product: 'dashboard' }],
  ['src/app/(app)/properties/layout.tsx', '/properties/property-1/ob?orgId=org-1', { product: 'dashboard' }],
  ['src/app/(app)/admin/layout.tsx', '/admin/access/organisations?tab=members', { product: 'hushub_admin' }],
  ['src/app/(app)/admin/access/layout.tsx', '/admin/access/organisations?tab=members', { productKey: 'hushub_admin', moduleKey: 'access_management' }],
  ['src/app/(app)/admin/besiktapp/layout.tsx', '/admin/besiktapp?tab=modules', { productKey: 'hushub_admin', moduleKey: 'besiktapp_admin' }],
  ['src/app/(app)/admin/renoapp/layout.tsx', '/admin/renoapp/brf/brf-1?tab=members', { productKey: 'hushub_admin', moduleKey: 'renoapp_admin' }],
  ['src/app/renoapp/app/layout.tsx', '/renoapp/app/cases/case-1?brfId=brf-1&tab=underlag', { productKey: 'renoapp', moduleKey: 'board_portal' }],
] as const

function layoutFixture(file: string, returnPath: string, error?: unknown) {
  const checks: unknown[] = []
  const Recovery = () => null
  const Shell = () => null
  const check = async (value: unknown) => { checks.push(value); if (error !== undefined) throw error }
  const mod = loadModule(file, {
    'react/jsx-runtime': jsxRuntime,
    'next/navigation': { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } },
    'next/link': { default: () => null },
    '@/lib/auth/returnPath': { authLoginUrl },
    '@/lib/auth/serverRecovery': serverRecovery(returnPath),
    '@/lib/access/server': { requireProductAccess: (product: string) => check({ product }), requireModuleAccess: check },
    '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId: 'org-1' }) },
    '@/components/auth/DashboardAccessRecovery': { default: Recovery },
    '@/components/auth/SessionAccessGuard': { default: Shell },
    '@/components/DashboardLayoutShell': { default: Shell },
    '@/components/eb/EbToastProvider': { EbToastProvider: Shell },
    './RenoAppAdminShell': { default: Shell },
  })
  return { checks, Recovery, call: () => (mod.default as (props: { children: ReactNode }) => Promise<ReactNode>)({ children: 'private page content' }) }
}

function findRecovery(node: ReactNode, recovery: unknown): { reason: string; returnTo: string; productLabel: string } | undefined {
  if (!isValidElement<{ children?: ReactNode; reason?: string; returnTo?: string; productLabel?: string }>(node)) return undefined
  if (node.type === recovery) return node.props as { reason: string; returnTo: string; productLabel: string }
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
  for (const child of children) {
    const found = findRecovery(child, recovery)
    if (found) return found
  }
}

test('the server return destination accepts only the proxy protected path and safely falls back', async () => {
  const exact = '/tu/investigations/inspection-1?orgId=org-1&tab=report'
  assert.equal(await serverRecovery(exact).currentAuthReturnPath('/tu'), exact)
  for (const bad of [null, '//elsewhere.invalid/tu', 'https://elsewhere.invalid/tu', '/login?next=%2Ftu', '/api/tu', '/renoapp/case/private-token', '/tu?access_token=secret']) {
    assert.equal(await serverRecovery(bad).currentAuthReturnPath('/tu'), '/tu')
  }
})

test('each protected server layout retains its original product/module guard and scope', async () => {
  for (const [file, path, expectedCheck] of layouts) {
    const f = layoutFixture(file, path)
    const result = await f.call()
    assert.deepEqual(f.checks, [expectedCheck], file)
    assert.ok(JSON.stringify(result).includes('private page content'), file)
    assert.equal(findRecovery(result, f.Recovery), undefined, file)
  }
})

test('every protected module redirects an expired session back to the exact detail page and safe query', async () => {
  for (const [file, path, expectedCheck] of layouts) {
    const f = layoutFixture(file, path, new Error('UNAUTHORIZED'))
    await assert.rejects(f.call(), error => error instanceof Error && error.message === `REDIRECT:${authLoginUrl(path)}`, file)
    assert.deepEqual(f.checks, [expectedCheck], file)
  }
})

test('permission denials and technical failures show recovery while withholding private children in every module', async () => {
  for (const [file, path] of layouts) {
    for (const [message, reason] of [['PRODUCT_ACCESS_REQUIRED', 'forbidden'], ['MODULE_ACCESS_REQUIRED', 'forbidden'], ['Synthetic private database diagnostic', 'unavailable']] as const) {
      const f = layoutFixture(file, path, new Error(message))
      const result = await f.call()
      const recovery = findRecovery(result, f.Recovery)
      assert.equal(recovery?.reason, reason, `${file}: ${message}`)
      assert.equal(recovery?.returnTo, path, file)
      assert.ok(recovery?.productLabel, file)
      const content = JSON.stringify(result)
      assert.ok(!content.includes('private page content'), file)
      assert.ok(!content.includes('Synthetic private database diagnostic'), file)
    }
  }
})

test('classification only treats explicit permission errors as forbidden', () => {
  const { authRecoveryReason } = serverRecovery('/app')
  for (const code of ['PRODUCT_ACCESS_REQUIRED', 'MODULE_ACCESS_REQUIRED', 'ORG_MEMBERSHIP_REQUIRED', 'ORG_ADMIN_REQUIRED', 'RENOAPP_MEMBERSHIP_REQUIRED', 'MOISTURE_FORBIDDEN', 'FORBIDDEN']) {
    assert.equal(authRecoveryReason(new Error(code)), 'forbidden', code)
  }
  for (const error of [new Error('Cookies can only be modified in a Server Action or Route Handler'), new Error('ACCESS_LOOKUP_FAILED'), new Error('PROFILE_NOT_FOUND'), 'MODULE_ACCESS_REQUIRED', null]) {
    assert.equal(authRecoveryReason(error), 'unavailable')
  }
})

const protectedPages = [
  'src/app/(app)/(organization-onboarding)/settings/organisation/skapa/page.tsx',
  'src/app/(app)/admin/access/organisations/page.tsx',
  'src/app/(app)/settings/organisation/page.tsx',
  'src/app/(app)/settings/profil/page.tsx',
  'src/app/(dashboard)/dashboard-v1/page.tsx',
  'src/app/(dashboard)/eb/page.tsx',
  'src/app/(dashboard)/eb/projects/[projectId]/page.tsx',
  'src/app/(dashboard)/eb/projects/[projectId]/remediation/page.tsx',
  ...['digital', 'follow-up-customer', 'perform', 'remediation', 'report', 'round'].map(view => `src/app/(dashboard)/eb/projects/[projectId]/inspections/[inspectionId]/${view}/page.tsx`),
  'src/app/(dashboard)/fuktsakerhet/page.tsx',
  'src/app/(dashboard)/fuktsakerhet/projekt/[id]/page.tsx',
  'src/app/(dashboard)/tu/page.tsx',
  'src/app/(dashboard)/tu/investigations/[inspectionId]/page.tsx',
  'src/app/(dashboard)/tu/investigations/[inspectionId]/digital/page.tsx',
  'src/app/(dashboard)/tu/investigations/[inspectionId]/print/page.tsx',
  'src/app/(dashboard)/uppdrag/page.tsx',
  'src/app/(dashboard)/uppdrag/[caseId]/page.tsx',
  'src/app/app/page.tsx',
  'src/app/mina-uppdrag/page.tsx',
  'src/app/mina-uppdrag/uppdrag/[taskId]/page.tsx',
  'src/app/ob/inspections/[id]/digital/page.tsx',
  'src/app/renoapp/review/[id]/page.tsx',
  'src/app/utlatande/[propertyId]/[inspectionId]/page.tsx',
]

/** Load just the page with auth/database boundaries stubbed; no credentials or database calls. */
function pageWithoutSession(file: string, destination: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const dependencies: Record<string, unknown> = {}
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue
    const name = node.moduleSpecifier.text
    const imported = node.importClause
    const stub: Record<string, unknown> = {}
    if (imported?.name) stub.default = () => null
    if (imported?.namedBindings && ts.isNamedImports(imported.namedBindings)) {
      for (const member of imported.namedBindings.elements) {
        stub[(member.propertyName ?? member.name).text] = async () => { throw new Error('UNAUTHORIZED') }
      }
    }
    dependencies[name] = stub
  }
  Object.assign(dependencies, {
    'react/jsx-runtime': jsxRuntime,
    'next/navigation': {
      redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) },
      notFound: () => { throw new Error('NOT_FOUND') },
    },
    '@/lib/auth/returnPath': { authLoginUrl },
    '@/lib/auth/serverRecovery': serverRecovery(destination),
    '@/lib/tasks/recipientAuthPaths': recipientAuthPaths,
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) },
  })
  Object.assign(dependencies, overrides)
  const mod = loadModule(file, dependencies)
  const id = '00000000-0000-4000-8000-000000000001'
  return () => (mod.default as (props: unknown) => Promise<ReactNode>)({
    params: Promise.resolve({ id, projectId: id, inspectionId: id, propertyId: id, caseId: id, taskId: id }),
    searchParams: Promise.resolve({ orgId: 'org-1', report: 'report-1', tab: 'members' }),
  })
}

test('detail, report, organization and recipient page guards also retain their original page after login', async () => {
  for (const file of protectedPages) {
    const route = file.replace('src/app/(dashboard)', '').replace('src/app/(app)/(organization-onboarding)', '').replace('src/app/(app)', '').replace('src/app', '').replace('/page.tsx', '')
      .replace(/\[[^\]]+\]/g, '00000000-0000-4000-8000-000000000001')
    const destination = route === '/settings/organisation/skapa' ? route : `${route}?orgId=org-1&tab=members`
    const call = pageWithoutSession(file, destination)
    await assert.rejects(call(), error => error instanceof Error && error.message === `REDIRECT:${authLoginUrl(destination)}`, file)
  }
})

test('recipient pages and the standalone consultant review watch for session loss while already open', async () => {
  const Guard = () => null
  const overrides = {
    '@/components/auth/SessionAccessGuard': { default: Guard },
    '@/lib/tasks/recipientPortal': {
      requireRecipientPortalSession: async () => ({ email: 'private@example.invalid' }),
      getRecipientPortalOverview: async () => ({ tasks: [] }),
      getRecipientPortalTaskWorkspace: async () => ({ task: { id: 'private-task' } }),
    },
  }
  for (const file of ['src/app/mina-uppdrag/page.tsx', 'src/app/mina-uppdrag/uppdrag/[taskId]/page.tsx']) {
    const result = await pageWithoutSession(file, '/mina-uppdrag', overrides)()
    assert.ok(isValidElement<{ productLabel: string }>(result))
    assert.equal(result.type, Guard, file)
    assert.equal(result.props.productLabel, 'Mina uppdrag', file)
  }
  const denied = await pageWithoutSession('src/app/mina-uppdrag/uppdrag/[taskId]/page.tsx', '/mina-uppdrag', {
    ...overrides,
    '@/lib/tasks/recipientPortal': { ...overrides['@/lib/tasks/recipientPortal'], getRecipientPortalTaskWorkspace: async () => null },
  })()
  assert.ok(isValidElement(denied))
  assert.equal(denied.type, Guard, 'Recipient denial also contains signed-in identity and must watch session loss')

  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: {}, error: null }),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  const review = await pageWithoutSession('src/app/renoapp/review/[id]/page.tsx', '/renoapp/app', {
    '@/components/auth/SessionAccessGuard': { default: Guard },
    '@/lib/renoapp/server': { getRenoAppConsultantCaseDetail: async () => ({
      item: {
        caseNumber: 'R-1', brf: { name: 'Testförening' }, title: 'Ansökan', status: 'submitted',
        applicant: { name: 'Private applicant' }, unit: {}, actionTypes: [], actionType: { label: 'Test' },
        underlag: [], documents: [], rulesAcceptance: { version: null }, reviewFlags: [], decisions: [], messages: [],
      },
      order: { brf_id: 'brf-1', price_ore: 150000 },
    }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => query }) },
  })()
  assert.ok(isValidElement<{ productLabel: string }>(review))
  assert.equal(review.type, Guard)
  assert.equal(review.props.productLabel, 'RenoApp')
})
