import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires the explicit extension.
import * as issuer from '../src/lib/assignments/issuerIdentity.ts'
// @ts-expect-error Node strip-types requires the explicit extension.
import { obIssuedIdentity, OB_TEST_ORG as ORG, OB_TEST_ACTOR as ACTOR } from './helpers/ob-issued-identity.ts'

function load<T>(file: string, deps: Record<string, unknown>, unused = false): T {
  const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === 'server-only') return {}
    if (name in deps) return deps[name]
    if (unused) return {}
    throw Error('Unexpected dependency ' + name)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const currentIdentity = {
  full_name: 'Current inspector', email: 'current@example.test', phone: null,
  company_name: 'Configured organization', company_orgno: '1234567890',
  company_address: null, company_postal_code: null, company_city: null, company_website: null, logo_path: null,
}
const terms = { role: 'buyer', version: 'test-v1', text: 'Approved terms', documentHash: 'a'.repeat(64), templateId: 'test' }
const assignment = { id: '22222222-2222-4222-8222-222222222222', org_id: ORG, responsible_profile_id: ACTOR,
  assignment_type: 'OB', price_amount: 100, accepted_at: null, status: 'draft',
  customer_email: 'customer@example.test', terms_version: terms.version, terms_document_hash: terms.documentHash,
  inspection_id: '66666666-6666-4666-8666-666666666666', property_id: '77777777-7777-4777-8777-777777777777',
}

test('new OB issuance validates exact organization branding before revocation and freezes mail/reply identity', async () => {
  const events: string[] = []
  const inserts: { table: string; value: Record<string, unknown> }[] = []
  const messages: Record<string, unknown>[] = []
  const frozen = obIssuedIdentity()
  const card = { id: frozen.card.id, version: frozen.card.version, source: 'organization_card', updatedAt: frozen.card.updatedAt,
    displayName: frozen.inspector.displayName, title: null, phone: null, email: frozen.inspector.email,
    avatarPath: null, signaturePath: null, companyName: 'Stale card company',
    companyOrgNo: null, companyAddress: null, companyPostalCode: null, companyCity: null,
    logoPath: null, reportFooterText: null, migrationRequired: false }
  const admin = { from: (table: string) => {
    assert.ok(['assignment_links', 'outbound_messages', 'assignments'].includes(table))
    const chain = {
      insert: (value: Record<string, unknown>) => { inserts.push({ table, value }); return chain },
      update: () => { events.push('update:' + table); return chain },
      eq: () => chain, is: () => chain, select: () => chain,
      single: async () => ({ data: { id: 'row' }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return chain
  } }
  const deps = {
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/organizations/profileCard': { requireConfiguredOrganizationProfileCard: async (input: unknown) => {
      assert.deepEqual(input, { orgId: ORG, profileId: ACTOR }); events.push('card'); return card
    } },
    '@/lib/ob/reportIdentity': { resolveObReportIdentity: async (input: { orgId: string; profileId: string }) => {
      assert.equal(input.orgId, ORG); assert.equal(input.profileId, ACTOR); events.push('identity'); return currentIdentity
    } },
    '@/lib/certifications/profileResolver': { resolveInspectorCertificationSummary: async (_admin: unknown, input: unknown) => {
      assert.deepEqual(input, { profileId: ACTOR, orgId: ORG })
      return { summary: { sbr_group: null, sbr_status: null, membership_number: null, certification_number: null,
        is_sbr_diplomerad_areamatning: false, all_selected_items: [] } }
    } },
    '@/lib/assignments/issuerIdentity': issuer,
    '@/lib/assignments/tokens': { generateAssignmentToken: () => 'test-token', hashAssignmentToken: () => 'test-hash' },
    '@/lib/assignments/terms': { resolveAssignmentTermsRole: () => 'buyer', getAssignmentTermsDocument: () => terms },
    '@/lib/assignments/emailTemplates': { buildAssignmentConfirmationEmail: (input: { orgName: string }) => {
      assert.equal(input.orgName, currentIdentity.company_name); return { subject: input.orgName, text: 'test', html: 'test' }
    } },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (input: Record<string, unknown>) => {
      messages.push(input); return { provider: 'test', providerMessageId: 'test' }
    } },
  }
  const server = load<typeof import('../src/lib/assignments/server')>('src/lib/assignments/server.ts', deps, true)
  const previous = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM = 'noreply@example.test'
  try {
    await server.sendAssignmentConfirmation({ assignment: assignment as never, orgName: 'Wrong caller company',
      responsibleEmail: 'wrong@example.test', requestedByUserId: ACTOR, baseUrl: 'https://app.example.test' })
  } finally {
    if (previous === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM
    else process.env.ASSIGNMENTS_MAIL_FROM = previous
  }
  assert.ok(events.indexOf('identity') < events.indexOf('update:assignment_links'))
  const captured = inserts.find(row => row.table === 'assignment_links')?.value.issuer_identity_snapshot
  const parsed = issuer.parseAssignmentIssuerIdentitySnapshot(captured, { orgId: ORG })!
  assert.equal(parsed.company.name, currentIdentity.company_name)
  assert.equal(messages[0].replyTo, frozen.inspector.email)
  assert.equal(inserts.find(row => row.table === 'outbound_messages')?.value.reply_to_email, frozen.inspector.email)
})

test('OB acceptance source uses issued identity unchanged after current card or responsible inspector changes', async () => {
  let currentReads = 0
  const api = load<typeof import('../src/lib/assignments/obConfirmationSnapshot')>('src/lib/assignments/obConfirmationSnapshot.ts', {
    'node:crypto': { createHash }, '@/lib/assignments/issuerIdentity': issuer,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
      assert.equal(table, 'assignment_confirmation_snapshots')
      return { select: () => ({ limit: async () => ({ error: null }) }) }
    } }) },
    '@/lib/ob/reportIdentity': { resolveObReportIdentity: async () => { currentReads++; return currentIdentity } },
    '@/lib/certifications/profileResolver': { resolveInspectorCertificationSummary: async () => { currentReads++; throw Error('No current certification') } },
  })
  const frozen = obIssuedIdentity()
  const reassigned = { ...assignment, responsible_profile_id: 'different-current-inspector' }
  const source = await api.prepareObConfirmationSource(reassigned, terms as never, frozen)
  assert.equal(source.issuerName, frozen.company.name)
  assert.equal(source.inspector.fullName, frozen.inspector.displayName)
  assert.equal(source.inspector.email, frozen.inspector.email)
  assert.equal(currentReads, 0)
  for (const invalid of [{ ...frozen, company: null }, { ...frozen, orgId: 'other-organization' }]) {
    await assert.rejects(api.prepareObConfirmationSource(reassigned, terms as never, invalid), /ASSIGNMENT_ISSUER_IDENTITY_INVALID/)
  }
  assert.equal(currentReads, 0)
})

test('new correspondence prefers archive then issued identity; old links use only configured exact-org card', async () => {
  for (const variant of ['archive', 'issued', 'legacy', 'invalid', 'failed'] as const) {
    let currentReads = 0
    const filters: unknown[] = []
    const frozen = obIssuedIdentity()
    const api = load<typeof import('../src/lib/assignments/obCorrespondenceIdentity')>('src/lib/assignments/obCorrespondenceIdentity.ts', {
      '@/lib/assignments/issuerIdentity': issuer, '@/lib/assignments/statusIssueSource': {},
      '@/lib/assignments/obConfirmationSnapshot': { getObConfirmationSnapshot: async (org: string, id: string) => {
        assert.equal(org, ORG); assert.equal(id, assignment.id)
        return variant === 'archive' ? { issuerName: 'Archived organization', inspector: { email: null } } : null
      } },
      '@/lib/ob/reportIdentity': { resolveObReportIdentity: async (input: unknown) => {
        currentReads++; assert.deepEqual(input, { orgId: ORG, profileId: ACTOR, locked: false, frozenProfile: null, frozenCompany: null }); return currentIdentity
      } },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
        assert.equal(table, 'assignment_links'); assert.notEqual(variant, 'archive')
        const query = { select: () => query, order: () => query, limit: () => query,
          eq: (key: string, value: unknown) => { filters.push([key, value]); return query }, not: () => query,
          maybeSingle: async () => ({ data: variant === 'legacy' ? null : { issuer_identity_snapshot: variant === 'invalid' ? {} : frozen },
            error: variant === 'failed' ? { message: 'private' } : null }) }
        return query
      } }) },
    })
    const run = () => api.resolveObCorrespondenceIdentity({ ...assignment, accepted_at: '2026-10-02T11:00:00Z' })
    if (variant === 'invalid' || variant === 'failed') {
      await assert.rejects(run(), new RegExp(variant === 'invalid' ? 'ASSIGNMENT_ISSUER_IDENTITY_INVALID' : 'OB_CONFIRMATION_SNAPSHOT_READ_FAILED'))
    } else {
      const result = await run()
      assert.equal(result.orgName, variant === 'archive' ? 'Archived organization' : variant === 'issued' ? frozen.company.name : currentIdentity.company_name)
      assert.equal(result.replyTo, variant === 'archive' ? null : variant === 'issued' ? frozen.replyToEmail : currentIdentity.email)
    }
    assert.equal(currentReads, variant === 'legacy' ? 1 : 0)
    if (variant !== 'archive') assert.deepEqual(filters, [['org_id', ORG], ['assignment_id', assignment.id]])
  }
})
