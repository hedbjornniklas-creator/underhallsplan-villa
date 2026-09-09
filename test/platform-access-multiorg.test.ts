import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as AccessServer from '../src/lib/access/server'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', code)(
    (key: string) => {
      if (key in dependencies) return dependencies[key]
      throw new Error(`Unexpected dependency ${key}`)
    },
    compiled,
    compiled.exports
  )

  return compiled.exports as T
}

type OrgMember = {
  id: string
  org_id: string
  profile_id: string
  role: 'admin' | 'inspector'
  is_active: boolean
}

function accessHarness(memberships: OrgMember[]) {
  const profileId = 'profile-1'
  const orgQueries: Array<Array<[string, unknown]>> = []

  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []

      function result() {
        if (table === 'profiles') {
          return {
            data: {
              id: profileId,
              full_name: 'Testperson',
              email: 'person@example.test',
              is_admin: false,
            },
            error: null,
          }
        }

        if (table === 'platform_access_assignments') {
          return {
            data: null,
            error: { message: 'relation platform_access_assignments does not exist' },
          }
        }

        if (table === 'org_members') {
          orgQueries.push([...filters])
          const row = memberships.find((membership) =>
            filters.every(([column, value]) => membership[column as keyof OrgMember] === value)
          )
          return { data: row ?? null, error: null }
        }

        throw new Error(`Unexpected table ${table}`)
      }

      const query = {
        select() {
          return query
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        maybeSingle: async () => result(),
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve(result()).then(onfulfilled, onrejected)
        },
      }

      return query
    },
  }

  const access = load<typeof AccessServer>('src/lib/access/server.ts', {
    'server-only': {},
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/supabase/server': {
      createSupabaseServerClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: profileId, email: 'person@example.test', user_metadata: {} } },
            error: null,
          }),
        },
      }),
    },
  })

  return { access, orgQueries, profileId }
}

const moduleAccess = {
  productKey: 'dashboard',
  moduleKey: 'admin',
  scopeType: 'organization',
} as const

test('legacy dashboard access resolves the requested organization in a multi-org membership', async () => {
  const targetOrg = 'org-target'
  const profileId = 'profile-1'
  const { access, orgQueries } = accessHarness([
    { id: 'member-first', org_id: 'org-other', profile_id: profileId, role: 'inspector', is_active: true },
    { id: 'member-target', org_id: targetOrg, profile_id: profileId, role: 'admin', is_active: true },
  ])

  await assert.doesNotReject(
    access.requireModuleAccess({ ...moduleAccess, scopeId: targetOrg })
  )
  assert.deepEqual(orgQueries, [[
    ['profile_id', profileId],
    ['is_active', true],
    ['org_id', targetOrg],
  ]])
})

test('legacy dashboard access denies another organization and an inspector in the requested organization', async () => {
  const targetOrg = 'org-target'
  const otherOnly = accessHarness([
    { id: 'member-other', org_id: 'org-other', profile_id: 'profile-1', role: 'admin', is_active: true },
  ])

  await assert.rejects(
    otherOnly.access.requireModuleAccess({ ...moduleAccess, scopeId: targetOrg }),
    /MODULE_ACCESS_REQUIRED/
  )

  const inspector = accessHarness([
    { id: 'member-other', org_id: 'org-other', profile_id: 'profile-1', role: 'admin', is_active: true },
    { id: 'member-target', org_id: targetOrg, profile_id: 'profile-1', role: 'inspector', is_active: true },
  ])

  await assert.rejects(
    inspector.access.requireModuleAccess({ ...moduleAccess, scopeId: targetOrg }),
    /MODULE_ACCESS_REQUIRED/
  )
  assert.ok(
    [...otherOnly.orgQueries, ...inspector.orgQueries].every((filters) =>
      filters.some(([column, value]) => column === 'org_id' && value === targetOrg)
    )
  )
})
