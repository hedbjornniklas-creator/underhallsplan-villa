import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as AccessServer from '../src/lib/access/server'

const PROFILE = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
type Grant = { module: string, org: string, active: boolean, source: string, expiresAt?: string }

function harness(options: { grants?: Grant[], legacyAdmin?: boolean, schemaMissing?: boolean, historyError?: boolean, assignmentsError?: string } = {}) {
  let historyReads = 0
  const grants = options.grants ?? []
  const db = {
    from(table: string) {
      let selected = ''
      let single = false
      const filters: Array<[string, unknown]> = []
      const sets: Array<[string, unknown[]]> = []
      function result() {
        if (table === 'profiles') return { data: { id: PROFILE, full_name: 'Anna', email: 'anna@example.test', is_admin: options.legacyAdmin ?? false }, error: null }
        if (table === 'org_members') {
          const members = [ORG_A, ORG_B].map(org_id => ({ id: org_id, org_id, profile_id: PROFILE, role: 'inspector', is_active: true }))
          const rows = members.filter(row => filters.every(([key, value]) => row[key as keyof typeof row] === value))
          return { data: single ? rows[0] ?? null : rows, error: null }
        }
        if (table !== 'platform_access_assignments') throw new Error(`Unexpected table ${table}`)
        if (options.schemaMissing) return { data: null, error: { message: 'relation platform_access_assignments does not exist' } }
        if (options.assignmentsError) return { data: null, error: { message: options.assignmentsError } }
        const history = selected.includes('!inner')
        if (history) {
          historyReads++
          if (options.historyError) return { data: null, error: { message: 'connection unavailable' } }
          assert.ok(filters.some(([key, value]) => key === 'profile_id' && value === PROFILE))
          assert.ok(filters.some(([key, value]) => key === 'platform_products.key' && value === 'dashboard'))
          assert.ok(filters.some(([key, value]) => key === 'scope_type' && value === 'organization'))
          assert.equal(filters.some(([key]) => key === 'is_active'), false)
          const sourceSet = sets.find(([key]) => key === 'source_system')?.[1] ?? []
          const row = grants.find(grant => sourceSet.includes(grant.source))
          return { data: row ? { id: 'history-id' } : null, error: null }
        }
        return { data: grants.filter(grant => grant.active).map((grant, index) => ({
          id: `grant-${index}`, product_id: 'dashboard', module_id: grant.module, role_id: grant.module === 'admin' ? 'dashboard_admin' : 'inspector',
          scope_type: 'organization', scope_id: grant.org, expires_at: grant.expiresAt ?? null,
          platform_products: { key: 'dashboard', label: 'BesiktApp' },
          platform_modules: { key: grant.module, label: grant.module },
          platform_roles: { key: grant.module === 'admin' ? 'dashboard_admin' : 'inspector', label: 'Medlem' },
        })), error: null }
      }
      const builder = {
        select(columns: string) { selected = columns; return builder },
        eq(key: string, value: unknown) { filters.push([key, value]); return builder },
        in(key: string, values: unknown[]) { sets.push([key, values]); return builder },
        limit() { return builder },
        maybeSingle: async () => { single = true; return result() },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve().then(result).then(resolve, reject) },
      }
      return builder
    },
  }
  const dependencies: Record<string, unknown> = {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: PROFILE, email: 'anna@example.test' } }, error: null }) } }) },
  }
  const compiled = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/access/server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  }, compiled, compiled.exports)
  return { access: compiled.exports as typeof AccessServer, historyReads: () => historyReads }
}

test('managed inspector with the last TU grant revoked cannot gain any dashboard modules through legacy membership', async () => {
  const { access } = harness({ grants: [{ module: 'technical_investigations', org: ORG_A, active: false, source: 'organization_administration' }] })
  for (const moduleKey of ['technical_investigations', 'inspections', 'construction_inspections', 'admin', 'tasks', 'moisture_safety'] as const) {
    assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey }), false, moduleKey)
    assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey, scopeType: 'organization', scopeId: ORG_B }), false, `${moduleKey} other org`)
  }
  // Active members can still reach their personal organization settings.
  await assert.doesNotReject(access.requireProductAccess('dashboard'))
})

test('migration history and expiry both prevent legacy is_admin resurrecting TU or other modules', async () => {
  for (const grant of [
    { module: 'technical_investigations', org: ORG_A, active: false, source: 'organization_admin_migration' },
    { module: 'technical_investigations', org: ORG_A, active: true, source: 'organization_administration', expiresAt: '2000-01-01T00:00:00Z' },
  ]) {
    const { access } = harness({ grants: [grant], legacyAdmin: true })
    for (const moduleKey of ['technical_investigations', 'inspections', 'construction_inspections', 'admin'] as const) {
      assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey }), false)
    }
    assert.equal(await access.hasCurrentUserAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' }), true)
  }
})

test('an old member without organization-management history keeps the earlier legacy behavior', async () => {
  const { access } = harness({ grants: [{ module: 'technical_investigations', org: ORG_A, active: false, source: 'legacy_import' }] })
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'inspections' }), true)
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'construction_inspections' }), true)
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations' }), false)
})

test('missing normalized schema keeps fallback behavior and never queries managed history', async () => {
  const { access, historyReads } = harness({ schemaMissing: true, legacyAdmin: true })
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations' }), true)
  assert.equal(historyReads(), 0)
})

test('admin-only explicit grant permits settings and its own organization administration without TU or cross-org access', async () => {
  const { access, historyReads } = harness({ grants: [{ module: 'admin', org: ORG_A, active: true, source: 'organization_administration' }] })
  await assert.doesNotReject(access.requireProductAccess('dashboard'))
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'admin', scopeType: 'organization', scopeId: ORG_A }), true)
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'admin', scopeType: 'organization', scopeId: ORG_B }), false)
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations' }), false)
  assert.equal(historyReads(), 0)
})

test('explicit TU access in another organization still requires exact scope after managed history exists', async () => {
  const { access } = harness({ grants: [
    { module: 'technical_investigations', org: ORG_A, active: false, source: 'organization_administration' },
    { module: 'technical_investigations', org: ORG_B, active: true, source: 'organization_administration' },
  ] })
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations', scopeType: 'organization', scopeId: ORG_B }), true)
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations', scopeType: 'organization', scopeId: ORG_A }), false)
  assert.equal(await access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations', scopeType: 'global' }), false)
})

test('history read failure denies access instead of silently restoring legacy permissions', async () => {
  const { access } = harness({ historyError: true, legacyAdmin: true })
  await assert.rejects(access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations' }), /PLATFORM_ACCESS_READ_FAILED/)
})

test('assignment read errors that mention a platform table are not mistaken for missing schema', async () => {
  for (const assignmentsError of ['permission denied for table platform_access_assignments', 'timeout reading platform_access_assignments']) {
    const { access } = harness({ assignmentsError, legacyAdmin: true })
    await assert.rejects(access.hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations' }),
      error => error instanceof Error && error.message === assignmentsError)
  }
})
