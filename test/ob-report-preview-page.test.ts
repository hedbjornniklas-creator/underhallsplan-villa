import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { authLoginUrl } from '../src/lib/auth/returnPath.ts'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
type Row = Record<string, any>

function harness(options: { side?: string; locked?: boolean; accessError?: string; failureTable?: string; canEdit?: boolean } = {}) {
  const side = options.side ?? 'apartment'
  const frozenProfile = { full_name: 'Original inspector', company_name: 'Original company', company_website: '' }
  const frozenCompany = { logo_url: 'original-logo.png' }
  const rows: Record<string, Row[]> = {
    inspections: [{ id: 'inspection', property_id: 'property', inspection_side: side,
      inspection_variant: 'OB', type: 'OB', date: '2026-10-01',
      locked_at: options.locked ? '2026-10-01T16:38:28Z' : null }],
    properties: [{ id: 'property', owner: 'inspector', address: 'Test address', brf_name: 'Test association' }],
    assignments: [{ id: 'assignment', inspection_id: 'inspection', org_id: 'org' }],
    inspection_report_links: [{ inspection_id: 'inspection', org_id: 'org', revoked_at: null,
      snapshot_payload: { reportData: { mock: { profile: frozenProfile, company: frozenCompany } } } }],
    inspection_interior_rooms: [{ id: 'room', inspection_id: 'inspection', floor_label: 'plan1',
      room_label: 'Test room', room_type_key: 'bedroom', note: '' }],
    inspection_control_items: [{ id: 'note', inspection_id: 'inspection', interior_room_id: 'room',
      exterior_observation_id: null, note: 'Saved observation', risk_text: 'Saved risk', ftu_text: 'Saved investigation' }],
  }
  const before = structuredClone(rows)
  const queries: string[] = []
  const authorized: unknown[][] = []
  const clients: string[] = []
  let liveIdentityReads = 0
  let rendered: Row | undefined
  const db = { from(table: string) {
    queries.push(table)
    let single = false
    const filters: Array<(row: Row) => boolean> = []
    const chain = {
      select() { return chain },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return chain },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return chain },
      is(key: string, value: unknown) { filters.push(row => row[key] === value); return chain },
      not(key: string, operator: string, value: unknown) {
        assert.equal(operator, 'is'); filters.push(row => row[key] !== value); return chain
      },
      order() { return chain }, limit() { return chain },
      maybeSingle() { single = true; return chain },
      then(onResolve: (value: unknown) => unknown, onReject?: (error: unknown) => unknown) {
        const result = (rows[table] ?? []).filter(row => filters.every(filter => filter(row)))
        const failed = options.failureTable === table
        return Promise.resolve({ data: failed ? null : single ? result[0] ?? null : result,
          error: failed ? { message: 'Synthetic read failure' } : null }).then(onResolve, onReject)
      },
    }
    return chain
  } }
  const stubs: Record<string, unknown> = {
    'server-only': {},
    'next/navigation': { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } },
    '@/components/auth/SessionAccessGuard': (props: Row) => props.children,
    '@/components/auth/DashboardAccessRecovery': (props: Row) => createElement('section', { 'data-recovery-reason': props.reason }, 'Session recovery'),
    '@/lib/auth/returnPath': { authLoginUrl },
    '@/lib/auth/serverRecovery': {
      currentAuthReturnPath: async () => '/utlatande/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002?orgId=org&embed=1',
      authRecoveryReason: (error: unknown) => error instanceof Error && ['PRODUCT_ACCESS_REQUIRED', 'MODULE_ACCESS_REQUIRED', 'ORG_MEMBERSHIP_REQUIRED'].includes(error.message) ? 'forbidden' : 'unavailable',
    },
    'next/headers': { cookies: async () => ({ getAll: () => [] }) },
    '../../_components/AutoPrintTrigger': () => null,
    '../../_components/ReportToolbar': (props: Row) => createElement('nav', { 'data-back-href': props.backHref }, 'Report toolbar'),
    '../../_components/SessionBridge': () => createElement('div', null, 'Session bridge'),
    '../../_components/ClientSessionDebug': () => null,
    '@/components/report/ReportRenderer': (props: Row) => {
      rendered = props
      return createElement('article', null, 'Report rendered')
    },
    '@/lib/supabase/server': { createSupabaseServerClient: () => { clients.push('user'); return db } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
      assert.equal(authorized.length, 1, 'privileged data reads follow the read guard')
      clients.push('admin'); return { ...db, storage: { from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/${path}` } }),
      }) } }
    } },
    '@/lib/ob/organizationBindings': { requireObInspectionReadContext: async (...args: unknown[]) => {
      authorized.push(args)
      if (options.accessError) throw Error(options.accessError)
      return { orgId: 'org', userId: options.canEdit === false ? 'viewer' : 'inspector', canEdit: options.canEdit !== false }
    } },
    '@/lib/organizations/profileCard': { requireConfiguredOrganizationProfileCard: async (input: Row) => {
      assert.equal(input.profileId, 'inspector', 'the saved property owner is the report inspector, never the viewer')
      liveIdentityReads++
      return { orgId: 'org', profileId: 'inspector', displayName: 'Current inspector' }
    } },
    '@/lib/organizations/companyProfile': { readOrganizationBranding: async () => {
      liveIdentityReads++
      return { id: 'org', configured: true, name: 'Current company' }
    } },
    '@/lib/report/pdfV2/buildReportDataV2': { buildReportDataV2: async () => assert.fail('Must exercise the non-building preview path') },
    '@/lib/ob/buildingReport': { readBuildingReportState: async () => null },
    '@/lib/ob/floorModelStore': { readObFloorModel: async () => null },
    '@/lib/report/environmentalAppendices': { readEnvironmentalAppendices: async () => [] },
    '@/lib/ob/assignmentWorkflowServer': { getObAssignmentWorkflow: async () => ({ canDeliver: true }) },
    '@/lib/certifications/profileResolver': { resolveInspectorCertificationSummary: async () => ({ summary: { all_selected_items: [] } }) },
  }
  const cache = new Map<string, { exports: any }>()
  function load(file: string): any {
    if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'))
    if (cache.has(file)) return cache.get(file)!.exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    new Function('require', 'module', 'exports', code)((name: string) => {
      if (Object.hasOwn(stubs, name)) return stubs[name]
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(file), name)
        const path = [target, `${target}.ts`, `${target}.tsx`].find(existsSync)
        assert.ok(path, name)
        return load(path)
      }
      return require(name)
    }, mod, mod.exports)
    return mod.exports
  }
  const Page = load(resolve(root, 'src/app/utlatande/[propertyId]/[inspectionId]/page.tsx')).default
  return { rows, before, queries, authorized, clients, get rendered() { return rendered }, get liveIdentityReads() { return liveIdentityReads },
    async render(embed = true, propertyId = 'property') {
      return renderToStaticMarkup(await Page({ params: Promise.resolve({ propertyId, inspectionId: 'inspection' }),
        searchParams: Promise.resolve({ orgId: 'org', ...(embed ? { embed: '1', pdf: '1' } : {}) }) }))
    } }
}

for (const side of ['apartment', 'buyer', 'seller']) {
  for (const locked of [false, true]) {
    test(`the complete ${locked ? 'locked' : 'open'} ${side} preview page renders using its authorized organization user`, async () => {
      const h = harness({ side, locked })
      const html = await h.render()
      assert.match(html, /Report rendered/)
      assert.doesNotMatch(html, /Session bridge|Report toolbar/)
      assert.deepEqual(h.authorized, [['inspection', 'org']])
      assert.equal(h.rendered?.inspectionSide, side)
      assert.equal(h.rendered?.rootClassName, 'report-root--pdf')
      assert.equal(h.rendered?.mockData.mock.profile.full_name, locked ? 'Original inspector' : 'Current inspector')
      assert.equal(h.liveIdentityReads, locked ? 0 : 2)
      assert.match(JSON.stringify(h.rendered?.mockData.mock.interior.blocks), /Saved observation/)
      assert.match(JSON.stringify(h.rendered?.mockData.mock.interior.blocks), /Saved risk/)
      assert.deepEqual(h.rows, h.before, 'preview must not mutate stored data or snapshots')
    })
  }
}

test('standalone preview preserves its toolbar without attempting a second session lookup', async () => {
  assert.match(await harness().render(false), /Report toolbar/)
})

test('the legacy preview rejects mismatched property URLs and never loads their issuer identity', async () => {
  const h = harness({ canEdit: false })
  h.rows.properties.push({ id: 'foreign-property', owner: 'foreign-inspector', address: 'Private foreign property' })
  await assert.rejects(h.render(false, 'foreign-property'), /OB_ORGANIZATION_FORBIDDEN/)
  assert.equal(h.liveIdentityReads, 0)
  assert.equal(h.rendered, undefined)
})

test('a colleague preview reads through the guarded client, preserves the owner identity and offers no editor link', async () => {
  const h = harness({ canEdit: false })
  const html = await h.render(false)
  assert.match(html, /Report rendered/)
  assert.equal(h.rendered?.mockData.mock.profile.full_name, 'Current inspector')
  assert.deepEqual(h.clients, ['admin'])
  assert.doesNotMatch(html, /data-back-href="\/properties\/property\/ob\/inspection/)
  assert.deepEqual(h.rows, h.before)
})

test('a colleague reading a locked preview sees the preserved original inspector without live identity reads', async () => {
  const h = harness({ canEdit: false, locked: true })
  assert.match(await h.render(false), /Report rendered/)
  assert.equal(h.rendered?.mockData.mock.profile.full_name, 'Original inspector')
  assert.equal(h.rendered?.mockData.mock.profile.company_name, 'Original company')
  assert.equal(h.liveIdentityReads, 0)
  assert.deepEqual(h.rows, h.before)
})

test('diagnostics use the verified user when a supporting query fails', async () => {
  const h = harness({ failureTable: 'inspection_documents' })
  const html = await h.render()
  assert.match(html, /Synthetic read failure/)
  assert.match(html, /&quot;hasUser&quot;: true/)
  assert.match(html, /&quot;userId&quot;: &quot;inspector&quot;/)
  assert.doesNotMatch(html, /Session bridge/)
})

for (const accessError of ['UNAUTHORIZED', 'OB_ORGANIZATION_MISMATCH', 'OB_ORGANIZATION_FORBIDDEN', 'MODULE_ACCESS_REQUIRED']) {
  test(`preview still fails closed for ${accessError}`, async () => {
    const h = harness({ accessError })
    if (accessError === 'UNAUTHORIZED') await assert.rejects(h.render(), /REDIRECT:\/login\?next=/)
    else assert.match(await h.render(), /data-recovery-reason="forbidden"/)
    assert.deepEqual(h.queries, [])
    assert.deepEqual(h.clients, [])
    assert.equal(h.rendered, undefined)
  })
}

test('a locked preview without its preserved issuer still refuses current profile data', async () => {
  const h = harness({ locked: true })
  h.rows.inspection_report_links = []
  await assert.rejects(h.render(), /OB_FROZEN_IDENTITY_REQUIRED/)
  assert.equal(h.liveIdentityReads, 0)
})

test('an unexpected initial preview access failure offers recovery without loading or leaking the report', async () => {
  const h = harness({ accessError: 'Synthetic private diagnostic' })
  const html = await h.render()
  assert.match(html, /data-recovery-reason="unavailable"/)
  assert.doesNotMatch(html, /Synthetic private diagnostic|Report rendered/)
  assert.deepEqual(h.queries, [])
  assert.deepEqual(h.clients, [])
})
