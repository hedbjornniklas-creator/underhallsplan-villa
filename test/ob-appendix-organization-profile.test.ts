import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function load<T>(path: string, deps: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === 'server-only') return {}
    assert.ok(name in deps, 'Unexpected dependency ' + name)
    return deps[name]
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const ID = 'inspection', ORG = 'bound-organization', ACTOR = 'owner'
function fixture(options: { locked?: boolean; frozen?: Record<string, unknown> | null; dbError?: boolean } = {}) {
  const reads: { table: string; filters: unknown[] }[] = []
  const currentCalls: { kind: string; input: unknown }[] = []
  const card = { orgId: ORG, profileId: ACTOR, displayName: 'Organization person', email: 'org@example.test',
    phone: null, avatarPath: 'organization-avatar' }
  const company = { id: ORG, configured: true, name: 'Bound company', organizationNumber: '1234567890',
    address: 'Org address', postalCode: '12345', city: 'Org city', website: null, logoPath: 'organization-logo' }
  const deps = {
    '@/lib/organizations/profileCard': { requireConfiguredOrganizationProfileCard: async (input: unknown) => {
      currentCalls.push({ kind: 'card', input }); return card
    } },
    '@/lib/organizations/companyProfile': { readOrganizationBranding: async (input: unknown) => {
      currentCalls.push({ kind: 'company', input }); return company
    } },
    '@/lib/certifications/profileResolver': { resolveInspectorCertificationSummary: async (_admin: unknown, input: unknown) => {
      currentCalls.push({ kind: 'certifications', input })
      return { summary: { sbr_group: 'org group', sbr_status: null, membership_number: null,
        certification_number: 'org cert', is_sbr_diplomerad_areamatning: true, all_selected_items: [] } }
    } },
    '@/lib/supabase/admin': {},
  }
  const identity = load('src/lib/ob/reportIdentity.ts', deps)
  const appendix = load<typeof import('../src/lib/ob/appendixProfile')>('src/lib/ob/appendixProfile.ts', {
    ...deps, '@/lib/ob/reportIdentity': identity,
  })
  const admin = { from: (table: string) => {
    assert.ok(['inspections', 'inspection_report_links'].includes(table), 'No global profile read or identity write')
    const read = { table, filters: [] as unknown[] }; reads.push(read)
    const error = options.dbError ? { message: 'private DB failure' } : null
    const rows = options.frozen === null ? [] : [{ snapshot_payload: { reportData: { mock: {
      profile: options.frozen ?? { full_name: 'Original person', company_name: 'Original issuer',
        email: null, avatar_path: null, certification_number: null, certification_items: [] },
      company: { logo_url: null },
    } } } }]
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query },
      is: (key: string, value: unknown) => { read.filters.push([key, value]); return query },
      maybeSingle: async () => ({ data: { id: ID, locked_at: options.locked ? '2026-01-01' : null }, error }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve),
    }
    return query
  } }
  const run = () => appendix.loadObAppendixProfile(admin as never, ID, ORG, ACTOR)
  return { run, reads, currentCalls }
}

test('new appendix identities and certifications use only the bound organization', async () => {
  const h = fixture()
  const result = await h.run()
  assert.equal(result.company_name, 'Bound company')
  assert.equal(result.email, 'org@example.test')
  assert.equal(result.avatar_path, 'organization-avatar')
  assert.equal(result.certification_number, 'org cert')
  assert.deepEqual(h.currentCalls.find(c => c.kind === 'certifications')?.input, { profileId: ACTOR, orgId: ORG })
  assert.ok(h.currentCalls.filter(c => c.kind === 'card').every(c => JSON.stringify(c.input) === JSON.stringify({ orgId: ORG, profileId: ACTOR })))
  assert.deepEqual(h.reads.map(r => r.table), ['inspections'])
})

test('locked appendix preserves original issuer and empty fields without loading current company, card or certificates', async () => {
  const h = fixture({ locked: true })
  const result = await h.run()
  assert.equal(result.full_name, 'Original person')
  assert.equal(result.company_name, 'Original issuer')
  assert.equal(result.email, null)
  assert.equal(result.avatar_path, null)
  assert.equal(result.certification_number, null)
  assert.equal(result.logo_path, null)
  assert.deepEqual(h.currentCalls, [])
  assert.deepEqual(h.reads[1].filters, [['inspection_id', ID], ['org_id', ORG], ['revoked_at', null]])
})

test('missing historical identity or failed reads never substitute current identity', async () => {
  const missing = fixture({ locked: true, frozen: null })
  await assert.rejects(missing.run(), { message: 'OB_FROZEN_IDENTITY_REQUIRED' })
  assert.deepEqual(missing.currentCalls, [])
  const failed = fixture({ dbError: true })
  await assert.rejects(failed.run(), { message: 'OB_ORGANIZATION_READ_FAILED' })
  assert.deepEqual(failed.currentCalls, [])
})

test('both private appendix APIs use the bound profile helper and delivery reply-to follows the issued profile', () => {
  for (const path of ['area-measurement', 'moisture-control']) {
    const source = readFileSync(new URL('../src/app/api/ob/inspections/[id]/' + path + '/route.ts', import.meta.url), 'utf8')
    assert.ok(source.includes('loadObAppendixProfile(admin, id, org.orgId, org.userId)'))
    assert.ok(source.indexOf('await requireObInspectionContext(') < source.indexOf('loadObAppendixProfile(admin,'))
    assert.doesNotMatch(source, /\.from\('profiles'\)/)
  }
  const delivery = readFileSync(new URL('../src/app/api/ob/inspections/[id]/report-delivery/route.ts', import.meta.url), 'utf8')
  assert.match(delivery, /replyToEmail = normalizedText\(reportData\.mock\?\.profile\?\.email\)/)
  assert.doesNotMatch(delivery, /getProfileContact/)
})
