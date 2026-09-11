import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type * as AssignmentServer from '../src/lib/assignments/server'
import type * as TuServer from '../src/lib/tu/server'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', code)(
    (key: string) => dependencies[key] ?? {},
    compiled,
    compiled.exports
  )

  return compiled.exports as T
}

type Membership = {
  org_id: string
  profile_id: string
  role: 'admin' | 'inspector'
  is_active: boolean
  is_default: boolean
  created_at: string
  organizations: {
    name: string
    email_from: string | null
  }
}

type QueryOrder = {
  column: keyof Membership
  ascending: boolean
}

function organizationContextHarness(memberships: Membership[]) {
  const profileId = 'profile-1'
  const membershipQueries: Array<{
    filters: Array<[string, unknown]>
    orders: QueryOrder[]
  }> = []
  const unexpectedTables: string[] = []

  const admin = {
    from(table: string) {
      if (table !== 'org_members') unexpectedTables.push(table)

      const filters: Array<[string, unknown]> = []
      const orders: QueryOrder[] = []

      function result() {
        if (table !== 'org_members') {
          throw new Error(`Unexpected table ${table}`)
        }

        membershipQueries.push({ filters: [...filters], orders: [...orders] })
        const rows = memberships
          .filter((membership) =>
            filters.every(([column, value]) => membership[column as keyof Membership] === value)
          )
          .sort((left, right) => {
            for (const order of orders) {
              const leftValue = left[order.column]
              const rightValue = right[order.column]
              if (leftValue === rightValue) continue
              const comparison = leftValue < rightValue ? -1 : 1
              return order.ascending ? comparison : -comparison
            }
            return 0
          })

        return { data: rows[0] ?? null, error: null }
      }

      const query = {
        select() {
          return query
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        order(column: keyof Membership, options?: { ascending?: boolean }) {
          orders.push({ column, ascending: options?.ascending !== false })
          return query
        },
        limit() {
          return query
        },
        single: async () => result(),
        maybeSingle: async () => result(),
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve().then(result).then(onfulfilled, onrejected)
        },
      }

      return query
    },
  }

  const assignments = load<typeof AssignmentServer>('src/lib/assignments/server.ts', {
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

  return {
    requireOrgContext: assignments.requireOrgContext as unknown as (
      requestedOrgId?: unknown
    ) => ReturnType<typeof assignments.requireOrgContext>,
    membershipQueries,
    unexpectedTables,
    profileId,
  }
}

function revokedBootstrapHarness(options: {
  inactiveMembership?: boolean
  existingCreatedOrganization?: boolean
}) {
  const profileId = 'profile-1'
  const writes: Array<{ table: string; operation: string }> = []
  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let operation = 'select'
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
        update() {
          operation = 'update'
          writes.push({ table, operation })
          return query
        },
        insert() {
          operation = 'insert'
          writes.push({ table, operation })
          return query
        },
        upsert() {
          operation = 'upsert'
          writes.push({ table, operation })
          return query
        },
        async maybeSingle() {
          if (table === 'profiles') {
            return {
              data: {
                id: profileId,
                is_admin: false,
                full_name: 'Tidigare medlem',
                email: 'person@example.test',
                org_name: null,
                company_name: null,
              },
              error: null,
            }
          }
          if (table === 'org_members') {
            const activeOnly = filters.some(
              ([column, value]) => column === 'is_active' && value === true
            )
            return {
              data:
                !activeOnly && options.inactiveMembership
                  ? {
                      id: 'member-1',
                      org_id: orgDefault,
                      role: 'inspector',
                      is_default: true,
                    }
                  : null,
              error: null,
            }
          }
          if (table === 'organizations') {
            return {
              data: options.existingCreatedOrganization ? { id: orgDefault } : null,
              error: null,
            }
          }
          throw new Error(`Unexpected table ${table}`)
        },
      }
      return query
    },
  }

  const assignments = load<typeof AssignmentServer>('src/lib/assignments/server.ts', {
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

  return { requireOrgContext: assignments.requireOrgContext, writes }
}

const orgDefault = '11111111-1111-4111-8111-111111111111'
const orgSelected = '22222222-2222-4222-8222-222222222222'
const orgUnauthorized = '33333333-3333-4333-8333-333333333333'

function membership(
  orgId: string,
  options: Partial<Membership> = {}
): Membership {
  return {
    org_id: orgId,
    profile_id: 'profile-1',
    role: 'inspector',
    is_active: true,
    is_default: false,
    created_at: '2026-01-01T00:00:00.000Z',
    organizations: {
      name: `Organisation ${orgId.slice(0, 4)}`,
      email_from: null,
    },
    ...options,
  }
}

test('explicit orgId resolves that active membership instead of the default organization', async () => {
  const harness = organizationContextHarness([
    membership(orgDefault, { is_default: true, role: 'admin' }),
    membership(orgSelected, {
      created_at: '2026-02-01T00:00:00.000Z',
      organizations: { name: 'Vald organisation', email_from: 'vald@example.test' },
    }),
  ])

  const context = await harness.requireOrgContext(orgSelected)

  assert.deepEqual(context, {
    userId: harness.profileId,
    orgId: orgSelected,
    role: 'inspector',
    orgName: 'Vald organisation',
    orgEmailFrom: 'vald@example.test',
  })
})

test('missing orgId falls back to the default active membership and then the oldest active membership', async () => {
  const withDefault = organizationContextHarness([
    membership(orgSelected, { created_at: '2025-01-01T00:00:00.000Z' }),
    membership(orgDefault, {
      is_default: true,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ])

  assert.equal((await withDefault.requireOrgContext()).orgId, orgDefault)

  const withoutDefault = organizationContextHarness([
    membership(orgSelected, { created_at: '2026-01-01T00:00:00.000Z' }),
    membership(orgDefault, { created_at: '2025-01-01T00:00:00.000Z' }),
  ])

  assert.equal((await withoutDefault.requireOrgContext()).orgId, orgDefault)
})

test('explicit unauthorized or inactive orgId is rejected without falling back or provisioning', async () => {
  for (const requestedMemberships of [
    [membership(orgDefault, { is_default: true })],
    [
      membership(orgDefault, { is_default: true }),
      membership(orgUnauthorized, { is_active: false }),
    ],
  ]) {
    const harness = organizationContextHarness(requestedMemberships)

    await assert.rejects(harness.requireOrgContext(orgUnauthorized))
    assert.deepEqual(harness.unexpectedTables, [])
  }
})

test('an explicit malformed organization selector is rejected instead of using the fallback', async () => {
  for (const malformed of [null, '', 'not-a-uuid', 42, { orgId: orgSelected }]) {
    const harness = organizationContextHarness([
      membership(orgDefault, { is_default: true }),
    ])

    await assert.rejects(harness.requireOrgContext(malformed))
    assert.deepEqual(harness.unexpectedTables, [])
  }
})

test('legacy bootstrap never reactivates or recreates a revoked membership', async () => {
  for (const options of [
    { inactiveMembership: true },
    { existingCreatedOrganization: true },
  ]) {
    const harness = revokedBootstrapHarness(options)

    await assert.rejects(harness.requireOrgContext(), /ORG_MEMBERSHIP_REQUIRED/)
    assert.deepEqual(harness.writes, [])
  }
})

type TuContext = Awaited<ReturnType<typeof TuServer.requireTuContext>>
type TuMembershipOption = {
  org_id: string
  is_default: boolean
  created_at: string
}

function tuContextHarness(
  hasAccess: (input: Record<string, unknown>) => boolean | Promise<boolean>,
  options: {
    initialOrgId?: string
    membershipOrgIds?: string[]
  } = {}
) {
  const orgRequests: unknown[] = []
  const accessRequests: Array<Record<string, unknown>> = []
  const selectedContext = {
    userId: 'profile-1',
    orgId: orgSelected,
    role: 'inspector' as const,
    orgName: 'Vald organisation',
    orgEmailFrom: null,
  }

  const tu = load<typeof TuServer>('src/lib/tu/server.ts', {
    'server-only': {},
    '@/lib/assignments/server': {
      requireOrgContext: async (requestedOrgId?: unknown) => {
        orgRequests.push(requestedOrgId)
        const orgId = typeof requestedOrgId === 'string'
          ? requestedOrgId
          : options.initialOrgId ?? orgSelected
        return {
          ...selectedContext,
          orgId,
          orgName: orgId === orgSelected ? 'Vald organisation' : 'Standardorganisation',
        }
      },
    },
    '@/lib/supabase/admin': {
      createSupabaseAdminClient: () => ({
        from: () => {
          const query = {
            select: () => query,
            eq: () => query,
            order: () => query,
            then: <TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: {
                data: TuMembershipOption[]
                error: null
              }) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
            ) => Promise.resolve({
              data: (options.membershipOrgIds ?? [orgSelected]).map((orgId, index) => ({
                org_id: orgId,
                is_default: index === 0,
                created_at: `2026-01-0${index + 1}T00:00:00.000Z`,
              })),
              error: null,
            }).then(onfulfilled, onrejected),
          }
          return query
        },
      }),
    },
    '@/lib/access/server': {
      hasCurrentUserAccess: async (input: Record<string, unknown>) => {
        accessRequests.push(input)
        return hasAccess(input)
      },
    },
  })

  return {
    requireTuContext: tu.requireTuContext as unknown as (
      requestedOrgId?: unknown
    ) => Promise<TuContext>,
    orgRequests,
    accessRequests,
    selectedContext,
  }
}

test('TU context forwards orgId and checks the exact TU module in the selected organization', async () => {
  const harness = tuContextHarness((input) =>
    input.productKey === 'dashboard' &&
    input.moduleKey === 'technical_investigations' &&
    input.scopeType === 'organization' &&
    input.scopeId === orgSelected
  )

  assert.deepEqual(await harness.requireTuContext(orgSelected), harness.selectedContext)
  assert.deepEqual(harness.orgRequests, [orgSelected])
  assert.deepEqual(harness.accessRequests, [
    {
      productKey: 'dashboard',
      moduleKey: 'technical_investigations',
      scopeType: 'organization',
      scopeId: orgSelected,
    },
    {
      productKey: 'dashboard',
      moduleKey: 'technical_investigations',
      scopeType: 'global',
    },
  ])
})

test('TU context rejects access granted for another organization or another module', async () => {
  const wrongOrganization = tuContextHarness((input) =>
    input.moduleKey === 'technical_investigations' &&
    input.scopeType === 'organization' &&
    input.scopeId === orgDefault
  )
  await assert.rejects(
    wrongOrganization.requireTuContext(orgSelected),
    /MODULE_ACCESS_REQUIRED/
  )

  const wrongModule = tuContextHarness((input) =>
    input.moduleKey === 'admin' && input.scopeId === orgSelected
  )
  await assert.rejects(wrongModule.requireTuContext(orgSelected), /MODULE_ACCESS_REQUIRED/)
})

test('TU context without orgId selects the first TU-enabled membership', async () => {
  const harness = tuContextHarness(
    (input) =>
      input.moduleKey === 'technical_investigations' &&
      input.scopeType === 'organization' &&
      input.scopeId === orgSelected,
    {
      initialOrgId: orgDefault,
      membershipOrgIds: [orgDefault, orgSelected],
    }
  )

  const context = await harness.requireTuContext()

  assert.equal(context.orgId, orgSelected)
  assert.deepEqual(harness.orgRequests, [undefined, orgSelected])
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : []
  })
}

function endpointMaySelectOrganizationInBody(endpoint: string) {
  const path = endpoint.split('?')[0]
  return path === '/api/tu/assignments'
    || path === '/api/tu/assignments/quick-send'
    || path === '/api/tu/investigations'
    || path.endsWith('/convert')
}

test('every internal TU assignment/investigation fetch carries an explicit orgId', () => {
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
  const files = [
    ...sourceFiles(join(repositoryRoot, 'src', 'components', 'tu')),
    ...sourceFiles(join(repositoryRoot, 'src', 'hooks')),
    ...sourceFiles(join(repositoryRoot, 'src', 'app', '(dashboard)', 'tu')),
  ]
  const violations: string[] = []

  for (const file of files) {
    const sourceText = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.ES2022,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    const initializers = new Map<string, ts.Expression>()

    function collectInitializers(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
      ) {
        initializers.set(node.name.text, node.initializer)
      }
      ts.forEachChild(node, collectInitializers)
    }
    collectInitializers(sourceFile)

    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'fetch'
        && node.arguments[0]
      ) {
        const urlArgument = node.arguments[0]
        const resolvedUrl = ts.isIdentifier(urlArgument)
          ? initializers.get(urlArgument.text) ?? urlArgument
          : urlArgument
        const urlText = resolvedUrl.getText(sourceFile)
        const endpoints = [
          ...urlText.matchAll(/\/api\/tu\/(?:assignments|investigations)[^'"`\s,)]*/gu),
        ].map((match) => match[0])

        if (endpoints.length > 0) {
          const organizationInUrl = /\b(?:orgId|organizationId)\b/u.test(urlText)
          const optionsText = node.arguments[1]?.getText(sourceFile) ?? ''
          const organizationInBody = /\borgId\b/u.test(optionsText)
            && endpoints.every(endpointMaySelectOrganizationInBody)

          if (!organizationInUrl && !organizationInBody) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
            violations.push(
              `${relative(repositoryRoot, file).replaceAll('\\', '/')}:${line} ${endpoints.join(' | ')}`
            )
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  assert.deepEqual(violations, [])
})
