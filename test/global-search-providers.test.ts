import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Providers from '../src/lib/globalSearch/providers'

type Row = Record<string, unknown>
const ORG = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const context = { orgId: ORG, userId: USER, role: 'admin' }
function compiled<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected provider dependency ${name}`)
    return dependencies[name]
  }, loaded, loaded.exports)
  return loaded.exports as T
}
const model = compiled<Record<string, unknown>>('src/lib/globalSearch/model.ts', {})
const candidates = compiled<Record<string, unknown>>('src/lib/globalSearch/candidates.ts', { './model.ts': model })
const runtime = compiled<typeof import('../src/lib/globalSearch/runtime')>('src/lib/globalSearch/runtime.ts', {})

function harness(options: { rows?: Record<string, Row[]>; deniedInspection?: string; wrongGuardOrg?: boolean; ready?: string[]; stalledGuard?: boolean } = {}) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; signal?: AbortSignal }> = []
  const authorized: string[] = []
  const value = (row: Row, field: string) => field.split('.').reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Row)[part] : undefined, row)
  class Query implements PromiseLike<{ data: Row[]; error: null }> {
    filters: Array<[string, unknown]> = []
    signal?: AbortSignal
    offset = 0
    size = 25
    table: string
    constructor(table: string) { this.table = table }
    select() { return this }
    eq(field: string, match: unknown) { this.filters.push([field, match]); return this }
    in(field: string, match: unknown[]) { this.filters.push([field, match]); return this }
    ilike() { return this }
    order() { return this }
    range(start: number, end: number) { this.offset = start; this.size = end - start + 1; return this }
    abortSignal(signal: AbortSignal) { this.signal = signal; return this }
    then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
      fulfilled?: ((result: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      calls.push({ table: this.table, filters: [...this.filters], signal: this.signal })
      const data = (options.rows?.[this.table] ?? []).filter(row => this.filters.every(([field, match]) => {
        const found = value(row, field)
        return Array.isArray(match) ? match.includes(found) : found === match
      })).slice(this.offset, this.offset + this.size)
      return Promise.resolve({ data, error: null }).then(fulfilled, rejected)
    }
  }
  const client = { from: (table: string) => new Query(table) }
  const api = compiled<typeof Providers>('src/lib/globalSearch/providers.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => client },
    '@/lib/ob/organizationBindings': {
      requireObContext: async () => ({ ...context, orgId: options.wrongGuardOrg ? 'other' : ORG }),
      requireObInspectionReadContext: async (inspectionId: string) => {
        authorized.push(inspectionId)
        if (options.stalledGuard) await new Promise(resolve => setTimeout(resolve, 40))
        if (inspectionId === options.deniedInspection) throw new Error('OB_ORGANIZATION_FORBIDDEN')
        return { ...context, canEdit: true }
      },
      filterObAssignmentList: async (rows: Row[]) => rows,
    },
    '@/lib/ob/memberVisibility': { canViewColleagueObAssignments: async () => true },
    '@/lib/ob/overviewPdfs': { loadOverviewPdfIds: async () => new Set(options.ready ?? []) },
    '@/lib/tu/server': { requireTuContext: async () => context },
    '@/lib/moisture/server': { requireMoistureContext: async () => context },
    './candidates': candidates, './model': model,
  })
  return { api, calls, authorized }
}

const ob = (inspectionId: string): Row => ({ inspection_id: inspectionId, org_id: ORG,
  inspections: { id: inspectionId, property_id: 'property', status: 'completed', type: 'OB',
    properties: { id: 'property', cadastral_id: 'Björnen 1:12', address: 'Gatan 1' } } })

test('OB matches never expose an inspection denied by its destination guard', async () => {
  const { api, authorized } = harness({ rows: { ob_organization_bindings: [ob('secret')] }, deniedInspection: 'secret', ready: ['secret'] })
  const response = await api.searchOb(context, 'Björnen 1:12')
  assert.deepEqual(response.results, [])
  assert.deepEqual(authorized, ['secret'])
})

test('organization guard mismatch stops all metadata reads', async () => {
  const { api, calls } = harness({ wrongGuardOrg: true })
  await assert.rejects(api.searchOb(context, 'Björnen'), /GLOBAL_SEARCH_SCOPE_MISMATCH/)
  assert.deepEqual(calls, [])
})

test('completed OB inspections include private report destinations and explicit org-scoped SDK queries', async () => {
  const { api, calls } = harness({ rows: { ob_organization_bindings: [ob('inspection')] }, ready: ['inspection'] })
  const execution = runtime.createGlobalSearchExecution()
  try {
    const response = await api.searchOb({ ...context, execution }, 'Björnen 1:12')
    assert.deepEqual(response.results.map(result => result.kind).sort(), ['inspection', 'report'])
    assert.equal(response.results.find(result => result.kind === 'inspection')?.status, 'Klar')
    assert.equal(response.results.find(result => result.kind === 'report')?.href, `/utlatande/property/inspection?orgId=${ORG}`)
    assert.equal(calls.every(call => call.filters.some(([field, match]) => field === 'org_id' && match === ORG)), true)
    assert.equal(calls.every(call => call.signal === execution.signal), true)
  } finally { execution.dispose() }
})

test('TU reports link printable private report even when delivery workflow is pending', async () => {
  const { api } = harness({ rows: { technical_investigation_details: [{ org_id: ORG, inspection_id: 'tu-id', title: 'Utredning',
    properties: { id: 'property', cadastral_id: 'Björnen 1:12' }, inspections: { id: 'tu-id', inspection_family: 'TU', status: 'draft' } }] }, ready: ['tu-id'] })
  const response = await api.searchTu(context, 'Björnen')
  const report = response.results.find(result => result.kind === 'report')
  assert.equal(report?.href, `/tu/investigations/tu-id/print?orgId=${ORG}`)
  assert.equal(report?.href.includes('/api/'), false)
})

test('deadline interrupts a stalled OB entity guard and returns a clearly partial result', async () => {
  const { api } = harness({ rows: { ob_organization_bindings: [ob('inspection')] }, stalledGuard: true })
  const execution = runtime.createGlobalSearchExecution(undefined, 5)
  try {
    const response = await api.searchOb({ ...context, execution }, 'Björnen')
    assert.deepEqual(response.results, [])
    assert.equal(response.hasMore, true)
    assert.match(response.issues?.[0].message ?? '', /lång tid/)
  } finally { execution.dispose() }
})
