import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as navigation from '../src/lib/action-cases/projectNavigation.ts'

test('project views are allowlisted and URLs retain the project identity', () => {
  for (const view of navigation.projectViews) assert.equal(navigation.parseProjectView(view), view)
  for (const view of [undefined, null, '', 'constructor', 'payments/other', 'https://other.test']) assert.equal(navigation.parseProjectView(view), 'overview')
  assert.equal(navigation.projectUrl('project-a'), '/uppdrag/project-a')
  assert.equal(navigation.projectUrl('project-a', 'payments'), '/uppdrag/project-a?view=payments')
  assert.equal(navigation.projectUrl('../other', 'files'), '/uppdrag/..%2Fother?view=files')
})

test('list attention counts refer to work items, not fictitious project completion', () => {
  const project = { status: 'pricing', items: [{ status: 'scope_needed' }, { status: 'pricing_needed' }, { status: 'waiting_subcontractor' }] }
  assert.equal(navigation.projectNeeds(project), '1 saknar omfattning · 1 behöver pris · 1 väntar på UE')
  assert.equal(navigation.projectNeeds({ ...project, status: 'completed' }), 'Slutfört')
  assert.equal(navigation.projectNeeds({ ...project, status: 'cancelled' }), 'Avbrutet')
  assert.equal(navigation.projectNeeds({ status: 'pricing', items: [] }), 'Inget markerat åtgärdsbehov')
})

function loadPage(path, deps) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    if (!(name in deps)) throw new Error('Unexpected dependency: ' + name)
    return deps[name]
  }, loaded, loaded.exports)
  return loaded.exports.default
}
const id = '00000000-0000-4000-8000-000000000001'
function setup({ authorized = true, found = true, offerFails = false, companyFails = false } = {}) {
  const calls = []
  const page = loadPage('../src/app/(dashboard)/uppdrag/[caseId]/page.tsx', {
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND') }, redirect: (path) => { throw new Error('REDIRECT:' + path) } },
    '@/components/tasks/ActionCaseProject': () => {},
    '@/components/tasks/UppdragScope': () => {},
    '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId: 'org-a', userId: 'user-a', role: 'admin' }) },
    '@/lib/access/server': { requireModuleAccess: async (scope) => { calls.push(['access', scope]); if (!authorized) throw new Error('DENIED') } },
    '@/lib/action-cases/server': { getActionCaseWorkspace: async (ctx, caseId) => { calls.push(['workspace', ctx, caseId]); return { cases: found ? [{ id: caseId }] : [] } } },
    '@/lib/action-cases/customerOffersServer': { getCustomerOfferWorkspace: async (ctx, caseId) => { calls.push(['offer', ctx, caseId]); if (offerFails) throw new Error('unavailable'); return { revision: 1 } } },
    '@/lib/tasks/server': { getTaskPeople: async (ctx) => { calls.push(['people', ctx]); return [] } },
    '@/lib/organizations/companyProfile': { readOrganizationBranding: async (orgId) => {
      calls.push(['company', orgId]); if (companyFails) throw new Error('unavailable')
      return { name: 'Scoped company', organizationNumber: '556000-0000', address: 'Testgatan 1', postalCode: '11122', city: 'Stockholm' }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) },
    '@/lib/action-cases/projectNavigation': navigation,
  })
  return { page, calls, run: () => page({ params: Promise.resolve({ caseId: id }), searchParams: Promise.resolve({ view: 'payments' }) }) }
}

test('project page checks module access before loading organization-scoped data', async () => {
  const { run, calls } = setup()
  await run()
  assert.equal(calls[0][0], 'access')
  assert.equal(calls[0][1].scopeId, 'org-a')
  assert.deepEqual(calls[1], ['workspace', { orgId: 'org-a', userId: 'user-a' }, id])
  assert.deepEqual(calls[2], ['offer', { orgId: 'org-a', userId: 'user-a' }, id])
  assert.equal(calls[3][1].isOrgAdmin, true)
})

test('denied access never loads project or offer data', async () => {
  const { run, calls } = setup({ authorized: false })
  await assert.rejects(run, /DENIED/)
  assert.equal(calls.length, 1)
})

test('missing or other-organization project does not load its offers', async () => {
  const { run, calls } = setup({ found: false })
  await assert.rejects(run, /NOT_FOUND/)
  assert.equal(calls.some(([name]) => name === 'offer'), false)
})

test('offer unavailability does not remove access to existing project tools', async () => {
  const { run } = setup({ offerFails: true })
  const result = await run()
  const project = result.props.children.props.children[2]
  assert.equal(project.props.initialOffer, null)
  assert.match(project.props.initialOfferError, /fortfarande tillgängliga/)
  assert.equal(project.props.initialView, 'payments')
  assert.equal(project.props.initialWorkspace.cases[0].id, id)
})

test('contractor defaults use only the checked organization and optional profile failure leaves project tools available', async () => {
  const h = setup(), result = await h.run()
  const project = result.props.children.props.children[2]
  assert.deepEqual(h.calls.find(([name]) => name === 'company'), ['company', 'org-a'])
  assert.equal(project.props.contractorSource.organizationNumber, '556000-0000')
  assert.equal(project.props.contractorSource.companyName, 'Scoped company')
  assert.equal('fTax' in project.props.contractorSource, false)
  const failed = await setup({ companyFails: true }).run()
  assert.match(failed.props.children.props.children[1].props.children, /kunde inte hämtas/)
  assert.equal(failed.props.children.props.children[2].props.initialWorkspace.cases[0].id, id)
})

test('legacy customer editor URL redirects to the same project contract', async () => {
  const page = loadPage('../src/app/(dashboard)/uppdrag/[caseId]/kund/page.tsx', {
    'next/navigation': { redirect: (url) => { throw new Error(url) } },
    '@/lib/action-cases/projectNavigation': navigation,
  })
  await assert.rejects(() => page({ params: Promise.resolve({ caseId: id }) }), { message: navigation.projectUrl(id, 'contract') })
})
