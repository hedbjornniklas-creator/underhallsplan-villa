import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Identity from '../src/lib/ob/reportIdentity'

function harness(options: { missingCompany?: boolean; configured?: boolean; cardError?: string; wrongOrg?: boolean } = {}) {
  const calls: unknown[] = []
  const code = ts.transpileModule(readFileSync('src/lib/ob/reportIdentity.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  const dependencies: Record<string, unknown> = {
    'server-only': {},
    '@/lib/organizations/profileCard': { requireConfiguredOrganizationProfileCard: async (input: unknown) => {
      calls.push(input)
      if (options.cardError) throw new Error(options.cardError)
      return { orgId: 'org-b', profileId: 'inspector', displayName: 'Consultant B', phone: '222', email: 'b@example.test',
        companyName: 'Stale card company must not win', logoPath: 'stale-logo.png' }
    } },
    '@/lib/organizations/companyProfile': { readOrganizationBranding: async (orgId: string) => {
      calls.push(orgId)
      return options.missingCompany ? null : { id: options.wrongOrg ? 'org-a' : 'org-b', configured: options.configured !== false,
        name: 'Company B', organizationNumber: '123456-7890', address: 'Address B', postalCode: '22222', city: 'Town B',
        website: 'https://b.example.test', logoPath: 'organizations/org-b/logo.png' }
    } },
  }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name)
    return dependencies[name]
  }, compiled, compiled.exports)
  return { service: compiled.exports as typeof Identity, calls }
}
const input = { orgId: 'org-b', profileId: 'inspector', locked: false, frozenProfile: null, frozenCompany: null }

test('new OB report identity uses the bound organization and personal card, never global or stale card company branding', async () => {
  const h = harness()
  const profile = await h.service.resolveObReportIdentity(input)
  assert.deepEqual(h.calls, [{ orgId: 'org-b', profileId: 'inspector' }, 'org-b'])
  assert.deepEqual(profile, {
    full_name: 'Consultant B', phone: '222', email: 'b@example.test', company_name: 'Company B',
    company_orgno: '123456-7890', company_address: 'Address B', company_postal_code: '22222', company_city: 'Town B',
    company_website: 'https://b.example.test', logo_path: 'organizations/org-b/logo.png',
  })
})

test('locked issuer is preserved including absent and explicitly empty historical fields without live profile reads', async () => {
  const h = harness({ cardError: 'must not read current profile' })
  const frozenProfile = { full_name: 'Original person', company_name: 'Original company', phone: null,
    company_website: '', company_address: 'Original address' }
  const before = structuredClone(frozenProfile)
  const profile = await h.service.resolveObReportIdentity({ ...input, locked: true, frozenProfile,
    frozenCompany: { logo_url: 'old-logo.png' } })
  assert.equal(profile.full_name, 'Original person')
  assert.equal(profile.company_name, 'Original company')
  assert.equal(profile.company_website, '')
  assert.equal(profile.company_orgno, null)
  assert.equal(profile.phone, null)
  assert.equal(profile.email, null)
  assert.equal(profile.logo_path, 'old-logo.png')
  assert.deepEqual(frozenProfile, before)
  assert.deepEqual(h.calls, [])
  assert.equal((await h.service.resolveObReportIdentity({ ...input, locked: true, frozenProfile, frozenCompany: null })).logo_path, null)
})

test('missing locked issuer fails closed instead of reconstructing old documents from current branding', async () => {
  const h = harness()
  await assert.rejects(h.service.resolveObReportIdentity({ ...input, locked: true }), /OB_FROZEN_IDENTITY_REQUIRED/)
  assert.deepEqual(h.calls, [])
})

test('unconfigured or mismatched company and missing personal card cannot enter a new frozen document', async () => {
  for (const options of [{ missingCompany: true }, { configured: false }, { wrongOrg: true }, { cardError: 'ORG_PROFILE_CARD_REQUIRED' }]) {
    await assert.rejects(harness(options).service.resolveObReportIdentity(input), /ORG_PROFILE_CARD_REQUIRED/)
  }
})

test('both OB preview builders resolve authorized bound identity and no longer read global company fields', () => {
  for (const path of ['src/lib/report/pdfV2/buildReportDataV2.ts', 'src/app/utlatande/[propertyId]/[inspectionId]/page.tsx']) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /requireObInspectionContext\(/)
    assert.match(source, /resolveObReportIdentity\(/)
    assert.match(source, /\.eq\('org_id', organization.orgId\)/)
    assert.match(source, /company_website: profile.company_website/)
    assert.match(source, /resolveInspectorCertificationSummary\(supabase, \{ profileId: userId, orgId: organization.orgId \}\)/)
    assert.doesNotMatch(source, /\.from\('profiles'\)/)
    assert.doesNotMatch(source, /readReportWebsite\(/)
  }
})
