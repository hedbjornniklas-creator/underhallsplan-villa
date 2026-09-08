import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type * as DigitalPage from '../src/app/(dashboard)/eb/projects/[projectId]/inspections/[inspectionId]/digital/page'
import type { EbFollowUpOffer } from '../src/lib/eb/followUp'

const require = createRequire(import.meta.url)
function loadPage(dependencies: Record<string, unknown>): typeof DigitalPage {
  const path = 'src/app/(dashboard)/eb/projects/[projectId]/inspections/[inspectionId]/digital/page.tsx'
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (['react', 'react/jsx-runtime'].includes(name)) return require(name)
    throw new Error(`Unexpected internal-preview dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as typeof DigitalPage
}

function fixture() {
  const calls: Array<{ name: string; input?: unknown }> = []
  const state = {
    authError: '', missingProject: false, wrongInspection: false,
    report: { project: { id: 'project' }, inspection: { inspectionId: 'inspection' } },
    offer: { available: false, retryable: false, alreadyActive: false,
      reason: 'Tjänsten är inte aktiverad för nya beställningar.' } as EbFollowUpOffer,
  }
  const viewProps: Array<Record<string, unknown>> = []
  const page = loadPage({
    'next/navigation': {
      notFound: () => { throw new Error('NOT_FOUND') },
      redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) },
    },
    '@/lib/access/server': { requireModuleAccess: async (input: unknown) => {
      calls.push({ name: 'module-access', input })
      if (state.authError) throw new Error(state.authError)
    } },
    '@/lib/assignments/server': { requireOrgContext: async () => {
      calls.push({ name: 'org-access' }); return { orgId: 'authenticated-org' }
    } },
    '@/lib/eb/server': { getEbProjectById: async (input: unknown) => {
      calls.push({ name: 'project', input })
      return state.missingProject ? null : { inspections: [{ inspectionId: state.wrongInspection ? 'other' : 'inspection' }] }
    } },
    '@/lib/eb/reportSnapshot': {
      getEbInspectionReportFromSnapshot: () => state.report,
      isEbReportSnapshotPayloadV1: () => false,
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from: (table: string) => {
        assert.equal(table, 'inspection_report_links')
        const query = {
          select: (fields: string) => { calls.push({ name: 'select', input: fields }); return query },
          eq: (key: string, value: unknown) => { calls.push({ name: 'filter', input: [key, value] }); return query },
          is: (key: string, value: unknown) => query.eq(key, value),
          order: (key: string) => { calls.push({ name: 'order', input: key }); return query },
          limit: () => query,
          maybeSingle: async () => ({ error: null, data: { id: 'existing-link-id', created_at: '2026-09-07', snapshot_payload: {}, pdf_status: 'ready' } }),
        }
        return query
      },
    }) },
    '@/lib/eb/followUpServer': { getEbFollowUpOfferForInspection: async (input: unknown) => {
      calls.push({ name: 'offer', input }); return state.offer
    } },
    '@/components/eb/EbPublicReportSnapshotView': { __esModule: true, default: (props: Record<string, unknown>) => {
      viewProps.push(props); return createElement('main', null, 'Det fastställda utlåtandet')
    } },
    '@/components/eb/EbInspectionReportView': { __esModule: true, default: () => createElement('main', null, 'PDF-utlåtande') },
    '@/components/eb/EbToastProvider': { EbToastProvider: ({ children }: { children: React.ReactNode }) => children },
  })
  const render = async (pdf = false) => renderToStaticMarkup(await page.default({
    params: Promise.resolve({ projectId: 'project', inspectionId: 'inspection' }),
    searchParams: Promise.resolve(pdf ? { pdf: '1' } : {}),
  }))
  return { state, calls, viewProps, render }
}

test('authenticated internal preview shows the actual unavailable reason without a purchasable offer', async () => {
  const f = fixture()
  const html = await f.render()
  assert.match(html, /Intern förhandsvisning/)
  assert.match(html, /inte aktiverad för nya beställningar/)
  assert.match(html, /Köpknappen visas inte här/)
  assert.match(html, /Det fastställda utlåtandet/)
  assert.doesNotMatch(html, /599 kr|<button|<form|\/rapport\//)
  assert.deepEqual(f.calls.slice(0, 3), [
    { name: 'module-access', input: { productKey: 'dashboard', moduleKey: 'construction_inspections' } },
    { name: 'org-access' },
    { name: 'project', input: { orgId: 'authenticated-org', projectId: 'project' } },
  ])
  assert.deepEqual(f.calls.find(call => call.name === 'offer')?.input, {
    orgId: 'authenticated-org', inspectionId: 'inspection', reportLinkId: 'existing-link-id',
  })
  assert.deepEqual(f.calls.filter(call => call.name === 'filter').map(call => call.input), [
    ['org_id', 'authenticated-org'], ['inspection_id', 'inspection'], ['revoked_at', null],
  ])
  assert.deepEqual(f.calls.filter(call => call.name === 'order').map(call => call.input), ['created_at', 'id'])
  assert.doesNotMatch(JSON.stringify(f.calls), /token|insert|update|rpc/)
  assert.equal(f.viewProps[0].followUpEndpoint, undefined)
  assert.equal(f.viewProps[0].shareUrl, null)
})

test('internal preview accurately distinguishes available, already purchased and technical retry states', async () => {
  const f = fixture()
  f.state.offer = { ...f.state.offer, available: true, reason: null }
  const available = await f.render()
  assert.match(available, /tillgänglig för beställning för 599 kr inkl. moms/)
  assert.doesNotMatch(available, /<button|<form/)
  f.state.offer = { ...f.state.offer, alreadyActive: true }
  const paid = await f.render()
  assert.match(paid, /redan beställd/)
  assert.match(paid, /utan en ny avgift/)
  assert.doesNotMatch(paid, /599 kr|<button|<form/)
  f.state.offer = { ...f.state.offer, available: false, alreadyActive: false, retryable: true,
    reason: 'Tillgängligheten kunde inte kontrolleras just nu. Försök igen om en stund.' }
  const retry = await f.render()
  assert.match(retry, /Tillfälligt tekniskt fel/)
  assert.match(retry, /Försök igen/)
  assert.doesNotMatch(retry, /599 kr|<button|<form/)
})

test('unauthenticated or mismatched project/inspection previews never load follow-up status', async () => {
  for (const error of ['UNAUTHORIZED', 'ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED']) {
    const f = fixture()
    f.state.authError = error
    await assert.rejects(f.render(), /REDIRECT:/)
    assert.equal(f.calls.some(call => call.name === 'offer'), false)
  }
  for (const mismatch of ['project', 'inspection', 'snapshot-project', 'snapshot-inspection']) {
    const f = fixture()
    if (mismatch === 'project') f.state.missingProject = true
    if (mismatch === 'inspection') f.state.wrongInspection = true
    if (mismatch === 'snapshot-project') f.state.report.project.id = 'other'
    if (mismatch === 'snapshot-inspection') f.state.report.inspection.inspectionId = 'other'
    await assert.rejects(f.render(), /NOT_FOUND/)
    assert.equal(f.calls.some(call => call.name === 'offer'), false)
  }
})

test('internal PDF output remains the report alone and does not check follow-up availability', async () => {
  const f = fixture()
  const html = await f.render(true)
  assert.match(html, /PDF-utlåtande/)
  assert.doesNotMatch(html, /förhandsvisning|uppföljning|599/)
  assert.equal(f.calls.some(call => call.name === 'offer'), false)
})
