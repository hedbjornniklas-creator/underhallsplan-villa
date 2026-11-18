import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Extended from '../src/lib/globalSearch/extended'

type Row = Record<string, unknown>
type Call = { mode: 'user' | 'admin'; table: string; columns: string; filters: Array<[string, string, unknown]>; offset: number; size: number }
const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

function compiled<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected extended search dependency ${name}`)
    return dependencies[name]
  }, loaded, loaded.exports)
  return loaded.exports as T
}
const model = compiled<Record<string, unknown>>('src/lib/globalSearch/model.ts', {})

function like(value: unknown, pattern: string) {
  let expression = ''
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]
    if (character === '\\' && index + 1 < pattern.length) expression += pattern[++index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (character === '%') expression += '.*'
    else if (character === '_') expression += '.'
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${expression}$`, 'iu').test(String(value ?? ''))
}

function harness(options: {
  data?: Record<string, Row[]>; tasksAllowed?: boolean; customerAllowed?: boolean;
  authorizedBrfs?: string[]; renoError?: string; failedTables?: string[];
  timeoutFields?: string[]
  execution?: { signal: AbortSignal; run<T>(work: () => Promise<T>): Promise<T>; check(): void }
  taskAccess?: () => Promise<boolean>
} = {}) {
  const calls: Call[] = []
  let guardReads = 0
  class Reader implements PromiseLike<{ data: Row[] | null; error: unknown }> {
    filters: Call['filters'] = []
    offset = 0
    size = Number.POSITIVE_INFINITY
    mode: Call['mode']
    table: string
    columns: string
    constructor(mode: Call['mode'], table: string, columns: string) {
      this.mode = mode
      this.table = table
      this.columns = columns
    }
    eq(field: string, value: unknown) { this.filters.push(['eq', field, value]); return this }
    in(field: string, value: string[]) { this.filters.push(['in', field, value]); return this }
    is(field: string, value: null) { this.filters.push(['is', field, value]); return this }
    ilike(field: string, value: string) { this.filters.push(['ilike', field, value]); return this }
    order() { return this }
    limit(size: number) { this.size = size; return this }
    range(from: number, to: number) { this.offset = from; this.size = to - from + 1; return this }
    abortSignal() { return this }
    then<TResult1 = { data: Row[] | null; error: unknown }, TResult2 = never>(
      fulfilled?: ((value: { data: Row[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      calls.push({ mode: this.mode, table: this.table, columns: this.columns, filters: this.filters, offset: this.offset, size: this.size })
      if (this.filters.some(([method, field]) => method === 'ilike' && options.timeoutFields?.includes(`${this.table}.${field}`))) {
        return Promise.reject(new Error('GLOBAL_SEARCH_TIMEOUT')).then(fulfilled, rejected)
      }
      if (options.failedTables?.includes(this.table)) return Promise.resolve({ data: null, error: { message: 'Private database failure' } }).then(fulfilled, rejected)
      let rows = (options.data?.[this.table] ?? []).filter(row => this.mode !== 'user' || row.visible !== false)
      for (const [method, field, value] of this.filters) rows = rows.filter(row => {
        if (field === 'action_cases.org_id') return (row.action_cases as Array<{ org_id: string }> | undefined)?.some(item => item.org_id === value)
        if (method === 'ilike') return like(row[field], String(value))
        if (method === 'in') return (value as string[]).includes(String(row[field]))
        if (method === 'is') return row[field] == null
        return row[field] === value
      })
      rows = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(this.offset, this.offset + this.size)
      return Promise.resolve({ data: rows, error: null }).then(fulfilled, rejected)
    }
  }
  const database = (mode: Call['mode']) => ({ from: (table: string) => ({ select: (columns: string) => new Reader(mode, table, columns) }) })
  const server = compiled<typeof Extended>('src/lib/globalSearch/extended.ts', {
    'server-only': {}, './model': model,
    '@/lib/access/server': { hasCurrentUserAccess: async () => { guardReads++; return options.tasksAllowed ?? true } },
    '@/lib/supabase/server': { createSupabaseServerClient: () => database('user') },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => database('admin') },
    '@/lib/customers/server': { getOrganizationCustomerNavigationContext: async (orgId: string) => {
      assert.equal(orgId, ORG)
      if (options.customerAllowed === false) throw new Error('PRODUCT_ACCESS_REQUIRED')
      return { organization: { id: ORG } }
    } },
    '@/lib/renoapp/server': { requireRenoAppViewerContext: async () => {
      if (options.renoError) throw new Error(options.renoError)
      return { userId: USER, authorizedBrfIds: options.authorizedBrfs ?? [], accessibleBrfIds: ['brf-a'] }
    } },
  })
  return { calls, get guardReads() { return guardReads }, search: (query: string) => server.searchExtendedModules({ orgId: ORG, userId: USER, role: 'inspector', query, execution: options.execution }, options.taskAccess) }
}

test('Gizmo designation search uses only org-linked properties and preserves private task RLS', async () => {
  const h = harness({ data: {
    properties: [
      { id: 'linked', owner: 'another-user', cadastral_id: 'Björnen 1:2', address: 'Skogsvägen', action_cases: [{ id: 'project', org_id: ORG }] },
      { id: 'foreign', owner: 'another-user', cadastral_id: 'Björnen 1:2', action_cases: [{ id: 'secret-project', org_id: OTHER_ORG }] },
    ],
    action_cases: [
      { id: 'project', org_id: ORG, property_id: 'linked', title: 'Slutfört projekt', status: 'completed' },
      { id: 'secret-project', org_id: OTHER_ORG, property_id: 'foreign', title: 'Secret project' },
    ],
    operational_tasks: [
      { id: 'allowed-task', org_id: ORG, title: 'Björnen 1:2', status: 'approved', archived_at: null },
      { id: 'hidden-task', org_id: ORG, title: 'Björnen 1:2 private', visible: false },
      { id: 'archived-task', org_id: ORG, title: 'Björnen 1:2 archive', archived_at: '2026-01-01' },
    ],
  } })
  const result = await h.search('Bjornen1:2')
  assert.deepEqual(result.results.map(row => row.id).sort(), ['tasks:project:project', 'tasks:task:allowed-task'])
  assert.equal(result.results.find(row => row.kind === 'project')?.propertyDesignation, 'Björnen 1:2')
  assert.equal(result.results.find(row => row.kind === 'project')?.status, 'Slutfört')
  assert(h.calls.filter(call => call.mode === 'admin' && call.table === 'properties').every(call => call.columns.includes('action_cases!inner') && call.filters.some(([method, field, value]) => method === 'eq' && field === 'action_cases.org_id' && value === ORG)))
  assert(h.calls.filter(call => call.table === 'operational_tasks').every(call => call.mode === 'user' && call.filters.some(([, field, value]) => field === 'org_id' && value === ORG)))
})

test('inactive modules and denied customer product do not run their metadata queries', async () => {
  const h = harness({ tasksAllowed: false, customerAllowed: false, renoError: 'RENOAPP_MEMBERSHIP_REQUIRED' })
  const result = await h.search('Björnen')
  assert.deepEqual(result.results, [])
  assert.deepEqual(result.issues, [])
  assert(h.calls.every(call => !['action_cases', 'operational_tasks', 'organization_customers', 'renovation_cases', 'brf_associations'].includes(call.table)))
})

test('property search pages past older nonmatches and never includes another owner', async () => {
  const records = Array.from({ length: 85 }, (_, index) => ({ id: `p${String(index).padStart(3, '0')}`, owner: USER,
    name: 'Villa', cadastral_id: index === 84 ? 'Parken 9:9' : `Parken 1:${index + 100}` }))
  const h = harness({ tasksAllowed: false, data: { properties: [...records, { id: 'other-owner', owner: 'other', name: 'Villa', cadastral_id: 'Parken 9:9' }] } })
  const result = await h.search('Villa Parken9:9')
  assert.deepEqual(result.results.map(row => row.id), ['properties:property:p084'])
  assert(h.calls.some(call => call.table === 'properties' && call.offset >= 75))
  assert.equal(result.hasMore, false)
})

test('RenoApp searches every authorized BRF, including a draft and a BRF beyond the first64', async () => {
  const ids = Array.from({ length: 80 }, (_, index) => `brf-${index}`)
  const h = harness({ tasksAllowed: false, authorizedBrfs: ids, data: {
    brf_associations: [...ids.map((id, index) => ({ id, name: `BRF ${index}`, property_designation: index === 79 ? 'Eken 4:2' : 'Other' })), { id: 'foreign-brf', property_designation: 'Eken 4:2' }],
    renovation_cases: [
      { id: 'draft-case', brf_id: 'brf-79', title: 'Badrum', case_number: 'R-79', status: 'draft', plain_token: 'never-return-token' },
      { id: 'foreign-case', brf_id: 'foreign-brf', title: 'Eken 4:2' },
    ],
  } })
  const result = await h.search('Eken 4:2')
  assert.deepEqual(result.results.map(row => row.id), ['renoapp:case:draft-case'])
  assert.equal(result.results[0].status, 'Utkast')
  assert.equal(result.results[0].href, '/renoapp/app/cases/draft-case')
  assert(!JSON.stringify(result).includes('never-return-token'))
  assert(h.calls.filter(call => call.table === 'renovation_cases').every(call => call.filters.some(([method, field]) => method === 'in' && field === 'brf_id')))
})

test('customer number lookup is org-scoped, excludes personalIDs and opens inactive registry results', async () => {
  const h = harness({ tasksAllowed: false, data: { organization_customers: [
    { id: 'customer', org_id: ORG, customer_number: 123, name: 'Testkund', is_active: false, personal_identity_number: 'never-return-private' },
    { id: 'foreign', org_id: OTHER_ORG, customer_number: 123, name: 'Foreign' },
  ] } })
  const result = await h.search('123')
  assert.equal(result.results.length, 1)
  const url = new URL(result.results[0].href, 'https://hushub.se')
  assert.equal(url.pathname, '/settings/kunder')
  assert.equal(url.searchParams.get('orgId'), ORG)
  assert.equal(url.searchParams.get('customerId'), 'customer')
  assert.equal(url.searchParams.get('q'), '123')
  assert.equal(url.searchParams.get('inactive'), '1')
  assert(!JSON.stringify(result).includes('never-return-private'))
  assert(h.calls.filter(call => call.table === 'organization_customers').every(call => !/personal_identity|invoice|email|phone/.test(call.columns)))
})

test('partial Gizmo failure retains allowed task results without exposing the underlying error', async () => {
  const h = harness({ failedTables: ['action_cases'], data: { operational_tasks: [{ id: 'task', org_id: ORG, title: 'Silvern', archived_at: null }] } })
  const result = await h.search('Silvern')
  assert.equal(result.results.some(row => row.id === 'tasks:task:task'), true)
  assert.equal(result.issues?.some(issue => issue.moduleId === 'tasks'), true)
  assert(!JSON.stringify(result).includes('Private database failure'))
})

test('expired authentication propagates instead of returning a partial cached search', async () => {
  await assert.rejects(harness({ renoError: 'UNAUTHORIZED' }).search('Silvern'), /UNAUTHORIZED/)
})

test('Gizmo pages past partial title matches and combines linked property metadata', async () => {
  const h = harness({ data: {
    action_cases: Array.from({ length: 60 }, (_, index) => ({ id: `project-${String(index).padStart(3, '0')}`, org_id: ORG,
      title: 'Badrum', property_id: index === 59 ? 'target-property' : null })),
    properties: [{ id: 'target-property', name: 'Eken', cadastral_id: 'Eken 3:7', action_cases: [{ org_id: ORG }] }],
  } })
  const result = await h.search('Badrum Eken3:7')
  assert.deepEqual(result.results.map(row => row.id), ['tasks:project:project-059'])
  assert(h.calls.some(call => call.table === 'action_cases' && call.offset >= 50))
})

test('query punctuation cannot replace fixed organization, owner or archive predicates', async () => {
  const h = harness({ data: {
    properties: [{ id: 'foreign-property', owner: 'other', name: 'Björnen' }],
    action_cases: [{ id: 'foreign-project', org_id: OTHER_ORG, title: 'Björnen' }],
    operational_tasks: [{ id: 'foreign-task', org_id: OTHER_ORG, title: 'Björnen' }],
    organization_customers: [{ id: 'foreign-customer', org_id: OTHER_ORG, name: 'Björnen' }],
  } })
  const result = await h.search('Björnen%,org_id.eq.other(_')
  assert.deepEqual(result.results, [])
  assert(h.calls.filter(call => ['action_cases', 'operational_tasks', 'organization_customers'].includes(call.table))
    .every(call => call.filters.some(([method, field, value]) => method === 'eq' && field === 'org_id' && value === ORG)))
  assert(h.calls.filter(call => call.mode === 'user' && call.table === 'properties')
    .every(call => call.filters.some(([method, field, value]) => method === 'eq' && field === 'owner' && value === USER)))
})

test('deadline retains accepted property matches and reports an incomplete search', async () => {
  const h = harness({ tasksAllowed: false, execution: {
    signal: new AbortController().signal,
    run: async work => await work(),
    check: () => {
      if (h.calls.some(call => call.mode === 'user' && call.table === 'properties')) throw new Error('GLOBAL_SEARCH_TIMEOUT')
    },
  }, data: {
    properties: Array.from({ length: 50 }, (_, index) => ({ id: `p${String(index).padStart(3, '0')}`, owner: USER,
      cadastral_id: index === 0 ? 'Parken 9:9' : 'Parken 1:2' })),
  } })
  const result = await h.search('Parken 9:9')
  assert.deepEqual(result.results.map(row => row.id), ['properties:property:p000'])
  assert.equal(result.hasMore, true)
  assert(result.issues?.some(issue => issue.moduleId === 'properties' && issue.message.includes('lång tid')))
  assert(h.calls.filter(call => call.mode === 'user' && call.table === 'properties').every(call => call.offset === 0))
})

test('request cancellation propagates and is never presented as an empty successful search', async () => {
  const h = harness({ tasksAllowed: false, execution: {
    signal: new AbortController().signal,
    run: async work => await work(),
    check: () => { throw new Error('GLOBAL_SEARCH_ABORTED') },
  } })
  await assert.rejects(h.search('Parken'), /GLOBAL_SEARCH_ABORTED/)
  assert.equal(h.calls.length, 0)
})

test('exact owned designation beats many earlier prefix matches', async () => {
  const h = harness({ tasksAllowed: false, data: { properties: [
    ...Array.from({ length: 70 }, (_, index) => ({ id: `p${String(index).padStart(3, '0')}`, owner: USER, cadastral_id: `Björnen 1:2${index + 10}` })),
    { id: 'p999', owner: USER, cadastral_id: 'Björnen 1:2' },
  ] } })
  const result = await h.search('Bjornen1:2')
  assert.equal(result.results[0].id, 'properties:property:p999')
  assert.equal(result.results[0].propertyDesignation, 'Björnen 1:2')
})

test('exact Gizmo designation survives project prefixes beyond the first page', async () => {
  const linked = Array.from({ length: 40 }, (_, index) => ({ id: `property-${index}`, cadastral_id: `Eken 1:2${index + 10}`, action_cases: [{ org_id: ORG }] }))
  const h = harness({ data: {
    properties: [...linked, { id: 'target-property', cadastral_id: 'Eken 1:2', action_cases: [{ org_id: ORG }] }],
    action_cases: [...linked.map((row, index) => ({ id: `project-${String(index).padStart(3, '0')}`, org_id: ORG, property_id: row.id, title: 'Projekt' })),
      { id: 'project-999', org_id: ORG, property_id: 'target-property', title: 'Rätt projekt' }],
  } })
  const result = await h.search('Eken1:2')
  assert.equal(result.results.find(row => row.moduleId === 'tasks')?.id, 'tasks:project:project-999')
})

test('exact RenoApp designation is retained beyond a page of cases in prefix BRFs', async () => {
  const h = harness({ tasksAllowed: false, authorizedBrfs: ['prefix-brf', 'exact-brf'], data: {
    brf_associations: [{ id: 'prefix-brf', property_designation: 'Eken 1:20' }, { id: 'exact-brf', property_designation: 'Eken 1:2' }],
    renovation_cases: [...Array.from({ length: 40 }, (_, index) => ({ id: `case-${String(index).padStart(3, '0')}`, brf_id: 'prefix-brf', title: 'Ärende' })),
      { id: 'case-999', brf_id: 'exact-brf', title: 'Rätt ärende' }],
  } })
  const result = await h.search('Eken1:2')
  assert.equal(result.results.find(row => row.moduleId === 'renoapp')?.id, 'renoapp:case:case-999')
})

test('Gizmo reuses request-scoped module access without repeating platform identity reads', async () => {
  const h = harness({ tasksAllowed: false, taskAccess: async () => true, data: {
    operational_tasks: [{ id: 'task', org_id: ORG, title: 'Harsyran 12', archived_at: null }],
  } })
  const result = await h.search('Harsyran 12')
  assert(result.results.some(row => row.id === 'tasks:task:task'))
  assert.equal(h.guardReads, 0)
})

test('denied request-scoped Gizmo access prevents all project and task queries', async () => {
  const h = harness({ tasksAllowed: true, taskAccess: async () => false })
  const result = await h.search('Harsyran 12')
  assert.deepEqual(result.results, [])
  assert.equal(h.guardReads, 0)
  assert(h.calls.every(call => !['action_cases', 'operational_tasks'].includes(call.table)))
})

test('fulfilled field pages survive another field reaching the deadline', async () => {
  const h = harness({ tasksAllowed: false, timeoutFields: ['properties.address'], data: {
    properties: [{ id: 'found-by-name', owner: USER, name: 'Harsyran', cadastral_id: 'Annan 1:2' }],
  } })
  const result = await h.search('Harsyran')
  assert.deepEqual(result.results.map(row => row.id), ['properties:property:found-by-name'])
  assert(result.issues?.some(issue => issue.moduleId === 'properties'))
  assert.equal(result.hasMore, true)
})
