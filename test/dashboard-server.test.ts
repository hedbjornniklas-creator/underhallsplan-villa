import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Server from '../src/lib/dashboard/server'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import * as model from '../src/lib/dashboard/model.ts'

const orgId = '11111111-1111-4111-8111-111111111111', otherOrgId = '22222222-2222-4222-8222-222222222222'
const context = { orgId, userId: 'me', role: 'admin', orgName: 'Test' }
function harness({ allowed = ['inspections', 'construction_inspections', 'technical_investigations', 'moisture_safety', 'tasks'],
  accessOrgId = orgId, orgError = null as Error | null, failed = '' } = {}) {
  const checks: Array<Record<string, unknown>> = [], reads: Array<{ module: string; orgId: string }> = [], selections: unknown[] = []
  const read = (module: string, selected: string, result: unknown) => {
    reads.push({ module, orgId: selected })
    if (failed === module) throw new Error('DATABASE_FAILED')
    return result
  }
  const deps: Record<string, unknown> = {
    'server-only': {}, './model': model,
    '@/lib/access/server': { hasCurrentUserAccess: async (check: Record<string, unknown>) => {
      checks.push(check)
      return check.scopeType === 'organization' && check.scopeId === accessOrgId && (!check.moduleKey || allowed.includes(String(check.moduleKey)))
    } },
    '@/lib/assignments/server': { requireOrgContext: async (selected?: unknown) => {
      selections.push(selected)
      if (orgError) throw orgError
      return { ...context, orgId: selected || orgId }
    } },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({}) },
    '@/lib/ob/overviewLoader': { loadObOverview: async ({ orgId: selected, options }: { orgId: string; options: { page: number } }) => read('ob', selected,
      { items: [], total: 0, page: options.page, pageSize: 50, counts: { active: 0, closed: 0, all: 0 } }) },
    '@/lib/tu/server': {
      requireTuContext: async (selected: string) => { selections.push(selected); return { ...context, orgId: selected } },
      listTuAssignments: async (selected: string) => read('tu', selected, []), listTuInvestigations: async (selected: string) => read('tu', selected, []),
    },
    '@/lib/eb/server': { listEbProjects: async (selected: string) => read('eb', selected, []) },
    '@/lib/eb/assignmentConfirmationServer': { listEbAssignmentConfirmationSummaries: async ({ orgId: selected }: { orgId: string }) => read('eb-confirmations', selected, []) },
    '@/lib/moisture/server': {
      requireMoistureContext: async (selected: string) => { selections.push(selected); return { ...context, orgId: selected } },
      listMoistureProjects: async ({ orgId: selected }: { orgId: string }) => read('moisture', selected, []),
    },
    '@/lib/tasks/server': { getTaskWorkspace: async ({ orgId: selected }: { orgId: string }) => read('tasks', selected, { currentUser: { id: 'me' }, tasks: [] }) },
  }
  const output = ts.transpileModule(readFileSync(new URL('../src/lib/dashboard/server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`)
    return deps[name]
  }, compiled, compiled.exports)
  return { server: compiled.exports as typeof Server, checks, reads, selections }
}

test('dashboard validates membership before readers and never reads a denied module', async () => {
  const h = harness({ allowed: ['technical_investigations'] })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.organizationId, orgId)
  assert.deepEqual(result.modules.filter(module => module.active).map(module => module.id), ['tu'])
  assert.ok(h.reads.every(read => read.module === 'tu' && read.orgId === orgId))
  assert.ok(h.checks.every(check => check.scopeType === 'global' || check.scopeId === orgId))
  assert.ok(h.selections.every(selected => selected === orgId || selected === undefined), 'module contexts cannot silently choose another organization')
  assert.equal(result.bookings.length, 0)
  assert.equal(result.actions.length, 0)
})

test('an access grant in another organization never authorizes dashboard reads in the selected one', async () => {
  const h = harness({ accessOrgId: otherOrgId })
  await assert.rejects(h.server.getDashboardData(orgId), /MODULE_ACCESS_REQUIRED/)
  assert.equal(h.reads.length, 0)
})

test('a different active organization cannot be aggregated when downstream modules use the default one', async () => {
  const h = harness({ accessOrgId: otherOrgId })
  await assert.rejects(h.server.getDashboardData(otherOrgId), /DASHBOARD_ORGANIZATION_UNSUPPORTED/)
  assert.deepEqual(h.selections, [otherOrgId, undefined], 'validate selected membership before comparing the default organization')
  assert.equal(h.reads.length, 0)
  assert.equal(h.checks.length, 0)
})

test('explicit default organization remains valid for map requests', async () => {
  const h = harness()
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.organizationId, orgId)
  assert.equal(result.issues?.length, 0)
  assert.ok(h.reads.length > 0)
})

test('auth, invalid selection and membership failures remain errors instead of empty dashboards', async () => {
  for (const code of ['UNAUTHORIZED', 'ORG_SELECTION_INVALID', 'ORG_MEMBERSHIP_REQUIRED']) {
    const h = harness({ orgError: new Error(code) })
    await assert.rejects(h.server.getDashboardData(orgId), new RegExp(code))
    assert.equal(h.reads.length, 0)
    assert.equal(h.checks.length, 0)
  }
})

test('one failed authorized reader reports its module while other data still loads', async () => {
  const h = harness({ failed: 'eb' })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.issues?.length, 1)
  assert.equal(result.issues?.[0].moduleId, 'eb')
  assert.equal(result.modules.find(module => module.id === 'eb')?.active, true)
  assert.ok(h.reads.some(read => read.module === 'tasks'))
  assert.ok(h.reads.some(read => read.module === 'moisture'))
  assert.ok(h.reads.every(read => read.orgId === orgId))
})
