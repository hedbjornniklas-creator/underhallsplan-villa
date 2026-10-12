import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { ProfileExtraSaved, ProfileExtrasWorkspace } from '../src/lib/organizations/profileExtrasTypes'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const ACTOR = '33333333-3333-4333-8333-333333333333'
const OTHER_PERSON = '44444444-4444-4444-8444-444444444444'
const CERT = '55555555-5555-4555-8555-555555555555'
const ADDON = '66666666-6666-4666-8666-666666666666'
const HIDDEN = '77777777-7777-4777-8777-777777777777'
const BASE = '88888888-8888-4888-8888-888888888888'
const MEMBERSHIP = '99999999-9999-4999-8999-999999999999'

type Row = Record<string, unknown>
type DbError = { code: string; message: string }
type Result = { data: Row[] | Row | null; error: DbError | null }
type Filter = { kind: 'eq' | 'is'; field: string; value: unknown }
type Mutation = { table: string; operation: 'insert' | 'update'; values: Row; filters: Filter[] }
type Domain = {
  getProfileExtrasWorkspace: (orgId: unknown) => Promise<ProfileExtrasWorkspace>
  saveProfileExtra: (body: unknown) => Promise<ProfileExtraSaved>
}
type Route = { GET: (request: Request) => Promise<Response>; PUT: (request: Request) => Promise<Response> }

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected profile extras dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

const http = load<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts', {})
const parsers = load<Record<string, unknown>>('src/lib/organizations/profileExtrasTypes.ts', {})
const addonHelpers = load<Record<string, unknown>>('src/lib/assignments/addons.ts', {})

function certificationRow(overrides: Row = {}): Row {
  return { org_id: ORG, profile_id: ACTOR, certification_id: CERT, is_enabled: false,
    number_value: null, valid_to: null, created_at: '2025-01-02', ...overrides }
}
function addonRow(overrides: Row = {}): Row {
  return { org_id: ORG, profile_id: ACTOR, addon_service_id: ADDON, is_enabled: true,
    price_amount: 125.5, currency: 'EUR', created_by: OTHER_PERSON, created_at: '2025-01-02', ...overrides }
}
function certificationMutation(overrides: Row = {}): Row {
  return { orgId: ORG, kind: 'certification', id: CERT, expected: null,
    values: { enabled: true, number: '  CERT-123  ', date: '2028-02-29' }, ...overrides }
}
function addonMutation(overrides: Row = {}): Row {
  return { orgId: ORG, kind: 'addon', id: ADDON, expected: null,
    values: { enabled: true, price: ' 123,455 ' }, ...overrides }
}

function harness(options: { signedIn?: boolean; active?: boolean; role?: string } = {}) {
  const state = {
    tables: {
      org_members: [
        { org_id: ORG, profile_id: ACTOR, role: options.role ?? 'inspector', is_active: options.active ?? true, is_default: false, created_at: '2025-01-01' },
        { org_id: OTHER_ORG, profile_id: ACTOR, role: 'admin', is_active: true, is_default: true, created_at: '2024-01-01' },
      ],
      organization_enabled_modules: [{ org_id: ORG, module_key: 'ob', is_active: true }],
      settings_certifications: [
        { id: CERT, key: 'certification', name: 'Besiktningsman', description: 'Certifiering', category: 'certification',
          requires_number: true, requires_valid_to: true, number_label: 'Certifikatnummer', valid_to_label: 'Giltig till', is_active: true, sort_order: 1 },
        { id: HIDDEN, key: 'inactive', name: 'Inaktiv', description: null, category: 'certification',
          requires_number: false, requires_valid_to: false, number_label: null, valid_to_label: null, is_active: false, sort_order: 0 },
        { id: MEMBERSHIP, key: 'membership', name: 'Medlemskap', description: null, category: 'membership',
          requires_number: false, requires_valid_to: false, number_label: null, valid_to_label: null, is_active: true, sort_order: 2 },
      ],
      settings_addon_services: [
        { id: ADDON, key: 'areamatning', name: 'Areamätning', description: 'Mätning', is_active: true, sort_order: 1 },
        { id: HIDDEN, key: 'inactive', name: 'Inaktiv', description: null, is_active: false, sort_order: 2 },
        { id: BASE, key: 'besiktning_av_huvudbyggnad', name: 'Huvudbyggnad', description: null, is_active: true, sort_order: 0 },
      ],
      profile_certifications: [],
      profile_addon_services: [],
    } as Record<string, Row[]>,
    events: [] as string[],
    mutations: [] as Mutation[],
    failures: {} as Record<string, DbError>,
    beforeUpdate: null as ((table: string) => void) | null,
    beforeInsert: null as ((table: string) => void) | null,
    migrationRequired: false,
  }

  class Query implements PromiseLike<Result> {
    private table: string
    private fields: string[] = []
    private filters: Filter[] = []
    private orders: { field: string; ascending: boolean }[] = []
    private limitCount = Number.POSITIVE_INFINITY
    private one = false
    private operation: 'select' | 'insert' | 'update' = 'select'
    private values: Row = {}
    constructor(table: string) { this.table = table }
    select(fields: string) { this.fields = fields.split(','); return this }
    eq(field: string, value: unknown) { this.filters.push({ kind: 'eq', field, value }); return this }
    is(field: string, value: unknown) { this.filters.push({ kind: 'is', field, value }); return this }
    order(field: string, options: { ascending?: boolean } = {}) { this.orders.push({ field, ascending: options.ascending ?? true }); return this }
    limit(count: number) { this.limitCount = count; return this }
    maybeSingle() { this.one = true; return this }
    single() { this.one = true; return this }
    update(values: Row) { this.operation = 'update'; this.values = structuredClone(values); return this }
    insert(values: Row) { this.operation = 'insert'; this.values = structuredClone(values); return this }
    private execute(): Result {
      state.events.push(`${this.operation}:${this.table}`)
      const failure = state.failures[this.table]
      if (failure) return { data: null, error: failure }
      const table = state.tables[this.table]
      assert.ok(table, `Unexpected table ${this.table}`)
      if (this.operation !== 'select') {
        state.mutations.push({ table: this.table, operation: this.operation, values: this.values, filters: this.filters })
        const hook = this.operation === 'insert' ? state.beforeInsert : state.beforeUpdate
        if (this.operation === 'insert') state.beforeInsert = null
        else state.beforeUpdate = null
        hook?.(this.table)
      }
      let rows: Row[]
      if (this.operation === 'insert') {
        const catalogField = this.table === 'profile_certifications' ? 'certification_id' : 'addon_service_id'
        if (table.some(row => row.org_id === this.values.org_id && row.profile_id === this.values.profile_id && row[catalogField] === this.values[catalogField])) {
          return { data: null, error: { code: '23505', message: 'private unique constraint diagnostic' } }
        }
        const inserted = structuredClone(this.values)
        table.push(inserted)
        rows = [inserted]
      } else {
        rows = table.filter(row => this.filters.every(filter => {
          if (filter.field === 'price_amount' && row.price_amount !== null && filter.value !== null) return Number(row.price_amount) === Number(filter.value)
          return row[filter.field] === filter.value
        }))
        if (this.operation === 'update') for (const row of rows) Object.assign(row, this.values)
      }
      rows = [...rows].sort((a, b) => {
        for (const order of this.orders) {
          const left = a[order.field]
          const right = b[order.field]
          if (left === right) continue
          const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))
          return order.ascending ? result : -result
        }
        return 0
      }).slice(0, this.limitCount)
      const projected = rows.map(row => Object.fromEntries(this.fields.map(field => [field, structuredClone(row[field])])))
      return { data: this.one ? projected[0] ?? null : projected, error: null }
    }
    then<TResult1 = Result, TResult2 = never>(resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
      reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve().then(() => this.execute()).then(resolve, reject)
    }
  }

  const admin = { createSupabaseAdminClient: () => {
    state.events.push('service-client')
    return { from: (table: string) => new Query(table) }
  } }
  const administration = load<Record<string, unknown>>('src/lib/organizations/administration.ts', {
    'server-only': {}, '@/lib/supabase/admin': admin,
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => {
      state.events.push('authenticate')
      return { data: { user: options.signedIn === false ? null : { id: ACTOR } }, error: null }
    } } }) },
    './companyProfile': { readOrganizationBranding: async (orgId: string) => {
      if (state.migrationRequired) throw new Error('ORG_MIGRATION_REQUIRED')
      return { id: orgId, name: 'Vald organisation' }
    } },
    './administrationTypes': {},
  })
  const domain = load<Domain>('src/lib/organizations/profileExtras.ts', {
    'server-only': {}, '@/lib/supabase/admin': admin, '@/lib/organizations/administration': administration,
    '@/lib/organizations/profileExtrasTypes': parsers, '@/lib/assignments/addons': addonHelpers,
  })
  const route = load<Route>('src/app/api/organizations/member-profile/extras/route.ts', {
    '@/lib/organizations/profileExtras': domain, '@/lib/organizations/administrationHttp': http,
  })
  return { state, domain, route }
}

function request(body: unknown = certificationMutation(), headers: Record<string, string> = {}, raw = false) {
  return new Request('https://hushub.se/api/organizations/member-profile/extras', { method: 'PUT',
    headers: { origin: 'https://hushub.se', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
    body: raw ? String(body) : JSON.stringify(body) })
}
function getRequest(query = `orgId=${ORG}`) {
  return new Request(`https://hushub.se/api/organizations/member-profile/extras?${query}`)
}
async function assertError(response: Response, status: number, code: string) {
  assert.equal(response.status, status)
  const body = await response.json()
  assert.equal(body.code, code)
  assert.doesNotMatch(JSON.stringify(body), /private.*diagnostic/u)
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/u)
  return body
}

test('GET uses the explicitly selected organization and authenticated person, with global active catalogs', async () => {
  const { state, route } = harness()
  state.tables.profile_certifications.push(
    certificationRow({ is_enabled: true, number_value: ' MY-CERT ', valid_to: '2028-02-29' }),
    certificationRow({ org_id: OTHER_ORG, number_value: 'WRONG-ORG' }),
    certificationRow({ profile_id: OTHER_PERSON, number_value: 'WRONG-PERSON' }),
    certificationRow({ certification_id: HIDDEN, number_value: 'HIDDEN' }),
  )
  state.tables.profile_addon_services.push(addonRow({ price_amount: '125.50' }), addonRow({ addon_service_id: BASE }), addonRow({ addon_service_id: HIDDEN }))
  const response = await route.GET(getRequest())
  assert.equal(response.status, 200)
  const { workspace } = await response.json() as { workspace: ProfileExtrasWorkspace }
  assert.equal(workspace.orgId, ORG)
  assert.equal(workspace.profileId, ACTOR)
  assert.deepEqual(workspace.certifications.map(entry => entry.id), [CERT, MEMBERSHIP])
  assert.deepEqual(workspace.certifications[0].value, { enabled: true, number: ' MY-CERT ', date: '2028-02-29' })
  assert.equal(workspace.certifications[0].exists, true)
  assert.equal(workspace.certifications[0].requiresNumber, true)
  assert.equal(workspace.certifications[0].requiresValidTo, true)
  assert.equal(workspace.certifications[0].numberLabel, 'Certifikatnummer')
  assert.deepEqual(workspace.certifications[1], { id: MEMBERSHIP, key: 'membership', name: 'Medlemskap', description: null,
    exists: false, category: 'membership', requiresNumber: false, requiresValidTo: false, numberLabel: null, validToLabel: null,
    value: { enabled: false, number: '', date: '' } })
  assert.deepEqual(workspace.addons, [{ id: ADDON, key: 'areamatning', name: 'Areamätning', description: 'Mätning',
    exists: true, currency: 'EUR', value: { enabled: true, price: '125.5' } }])
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.equal(state.mutations.length, 0)
})

test('active inspectors and admins can save their own rows; unauthenticated and inactive users cannot', async () => {
  for (const role of ['inspector', 'admin']) {
    const { state, route } = harness({ role })
    const response = await route.PUT(request())
    assert.equal(response.status, 200)
    assert.deepEqual(state.tables.profile_certifications, [{ org_id: ORG, profile_id: ACTOR, certification_id: CERT,
      is_enabled: true, number_value: 'CERT-123', valid_to: '2028-02-29' }])
    const result = await response.json() as ProfileExtraSaved
    assert.equal(result.orgId, ORG)
    assert.equal(result.profileId, ACTOR)
    assert.equal(result.kind, 'certification')
    assert.equal(result.entry.exists, true)
    assert.equal(state.events[0], 'authenticate')
  }
  for (const [options, status, code] of [
    [{ signedIn: false }, 401, 'UNAUTHORIZED'],
    [{ active: false }, 403, 'ORG_MEMBERSHIP_REQUIRED'],
    [{ role: 'viewer' }, 403, 'ORG_MEMBERSHIP_REQUIRED'],
  ] as const) {
    const { state, route } = harness(options)
    await assertError(await route.PUT(request()), status, code)
    await assertError(await route.GET(getRequest()), status, code)
    assert.equal(state.mutations.length, 0)
    assert.ok(!state.events.some(event => /settings_|profile_certifications|profile_addon_services/u.test(event)))
  }
  const denied = harness()
  await assertError(await denied.route.PUT(request(certificationMutation({ orgId: BASE }))), 403, 'ORG_MEMBERSHIP_REQUIRED')
  assert.equal(denied.state.mutations.length, 0)
})

test('GET and direct domain calls require a single explicit valid organization', async () => {
  for (const query of ['', 'orgId=invalid', `orgId=${ORG}&orgId=${OTHER_ORG}`]) {
    const { state, route } = harness()
    await assertError(await route.GET(getRequest(query)), 400, 'ORG_REQUEST_INVALID')
    assert.deepEqual(state.events, [])
  }
  const { domain, state } = harness()
  await assert.rejects(domain.getProfileExtrasWorkspace(undefined), { message: 'ORG_SELECTION_INVALID' })
  assert.deepEqual(state.events, [])
})

test('addon creation normalizes decimal commas, uses SEK, and preserves nullable price semantics', async () => {
  const { state, route } = harness()
  const response = await route.PUT(request(addonMutation()))
  assert.equal(response.status, 200)
  const result = await response.json() as ProfileExtraSaved
  assert.deepEqual(result.entry.value, { enabled: true, price: '123.46' })
  assert.deepEqual(state.tables.profile_addon_services, [{ org_id: ORG, profile_id: ACTOR, addon_service_id: ADDON,
    is_enabled: true, price_amount: 123.46, currency: 'SEK' }])
  const blank = harness()
  const blankResponse = await blank.route.PUT(request(addonMutation({ values: { enabled: true, price: '  ' } })))
  assert.equal(blankResponse.status, 200)
  assert.equal(blank.state.tables.profile_addon_services[0].price_amount, null)
  assert.deepEqual((await blankResponse.json()).entry.value, { enabled: true, price: '' })
})

test('an addon CAS updates only one scoped row and preserves currency, audit metadata, and hidden rows', async () => {
  const { state, route } = harness()
  const original = addonRow({ price_amount: '125.50' })
  const untouched = [addonRow({ org_id: OTHER_ORG }), addonRow({ profile_id: OTHER_PERSON }), addonRow({ addon_service_id: HIDDEN }), addonRow({ addon_service_id: BASE })]
  state.tables.profile_addon_services.push(original, ...structuredClone(untouched))
  const response = await route.PUT(request(addonMutation({ expected: { enabled: true, price: '125,50' }, values: { enabled: false, price: '200' } })))
  assert.equal(response.status, 200)
  assert.deepEqual(state.tables.profile_addon_services[0], { ...addonRow({ price_amount: '125.50' }), is_enabled: false, price_amount: 200 })
  assert.deepEqual(state.tables.profile_addon_services.slice(1), untouched)
  assert.equal((await response.json()).entry.currency, 'EUR')
  assert.deepEqual(state.mutations[0], { table: 'profile_addon_services', operation: 'update', values: { is_enabled: false, price_amount: 200 },
    filters: [
      { kind: 'eq', field: 'org_id', value: ORG }, { kind: 'eq', field: 'profile_id', value: ACTOR },
      { kind: 'eq', field: 'addon_service_id', value: ADDON }, { kind: 'eq', field: 'is_enabled', value: true },
      { kind: 'eq', field: 'price_amount', value: 125.5 },
    ] })
})

test('certification CAS preserves exact baseline text and correctly compares empty strings and nulls', async () => {
  for (const numberValue of [null, '', ' ORIGINAL ']) {
    const { state, route } = harness()
    state.tables.profile_certifications.push(certificationRow({ number_value: numberValue }))
    const response = await route.PUT(request(certificationMutation({ expected: { enabled: false, number: numberValue ?? '', date: '' } })))
    assert.equal(response.status, 200)
    assert.equal(state.tables.profile_certifications[0].created_at, '2025-01-02')
    assert.ok(state.mutations[0].filters.some(filter => filter.field === 'number_value' && filter.kind === (numberValue === null ? 'is' : 'eq') && filter.value === numberValue))
    assert.ok(state.mutations[0].filters.some(filter => filter.field === 'valid_to' && filter.kind === 'is' && filter.value === null))
  }
  const conflict = harness()
  conflict.state.tables.profile_certifications.push(certificationRow({ number_value: ' ORIGINAL ' }))
  await assertError(await conflict.route.PUT(request(certificationMutation({ expected: { enabled: false, number: 'ORIGINAL', date: '' } }))), 409, 'ORG_PROFILE_CARD_CONFLICT')
  assert.equal(conflict.state.mutations.length, 0)
})

test('each changed certification baseline field prevents an overwrite', async () => {
  for (const expected of [
    { enabled: true, number: '', date: '' },
    { enabled: false, number: 'stale', date: '' },
    { enabled: false, number: '', date: '2024-01-01' },
  ]) {
    const { state, route } = harness()
    state.tables.profile_certifications.push(certificationRow())
    await assertError(await route.PUT(request(certificationMutation({ expected }))), 409, 'ORG_PROFILE_CARD_CONFLICT')
    assert.deepEqual(state.tables.profile_certifications, [certificationRow()])
    assert.equal(state.mutations.length, 0)
  }
})

test('a concurrent change after the baseline read fails the atomic update without overwriting it', async () => {
  for (const changed of [{ is_enabled: true }, { number_value: 'Concurrent' }, { valid_to: '2029-05-06' }]) {
    const { state, route } = harness()
    state.tables.profile_certifications.push(certificationRow())
    state.beforeUpdate = table => Object.assign(state.tables[table][0], changed)
    await assertError(await route.PUT(request(certificationMutation({ expected: { enabled: false, number: '', date: '' } }))), 409, 'ORG_PROFILE_CARD_CONFLICT')
    assert.deepEqual(state.tables.profile_certifications[0], certificationRow(changed))
  }
  for (const changed of [{ is_enabled: false }, { price_amount: 999 }]) {
    const { state, route } = harness()
    state.tables.profile_addon_services.push(addonRow())
    state.beforeUpdate = table => Object.assign(state.tables[table][0], changed)
    await assertError(await route.PUT(request(addonMutation({ expected: { enabled: true, price: '125.5' } }))), 409, 'ORG_PROFILE_CARD_CONFLICT')
    assert.deepEqual(state.tables.profile_addon_services[0], addonRow(changed))
  }
})

test('missing-versus-existing rows and concurrent inserts return conflicts without upsert replacement', async () => {
  for (const kind of ['certification', 'addon']) {
    const table = kind === 'certification' ? 'profile_certifications' : 'profile_addon_services'
    const existingRow = kind === 'certification' ? certificationRow() : addonRow()
    const mutation = kind === 'certification' ? certificationMutation : addonMutation
    const expected = kind === 'certification' ? { enabled: false, number: '', date: '' } : { enabled: true, price: '125.5' }
    const existing = harness()
    existing.state.tables[table].push(structuredClone(existingRow))
    await assertError(await existing.route.PUT(request(mutation())), 409, 'ORG_PROFILE_CARD_CONFLICT')
    assert.deepEqual(existing.state.tables[table], [existingRow])
    const missing = harness()
    await assertError(await missing.route.PUT(request(mutation({ expected }))), 409, 'ORG_PROFILE_CARD_CONFLICT')
    assert.equal(missing.state.mutations.length, 0)
    const concurrent = harness()
    concurrent.state.beforeInsert = target => concurrent.state.tables[target].push(structuredClone(existingRow))
    await assertError(await concurrent.route.PUT(request(mutation())), 409, 'ORG_PROFILE_CARD_CONFLICT')
    assert.deepEqual(concurrent.state.tables[table], [existingRow])
  }
})

test('nullable addon baselines distinguish an absent price from an explicit zero', async () => {
  const { state, route } = harness()
  state.tables.profile_addon_services.push(addonRow({ price_amount: null }))
  await assertError(await route.PUT(request(addonMutation({ expected: { enabled: true, price: '0' } }))), 409, 'ORG_PROFILE_CARD_CONFLICT')
  const response = await route.PUT(request(addonMutation({ expected: { enabled: true, price: '' }, values: { enabled: true, price: '0' } })))
  assert.equal(response.status, 200)
  assert.ok(state.mutations[0].filters.some(filter => filter.kind === 'is' && filter.field === 'price_amount' && filter.value === null))
  assert.equal(state.tables.profile_addon_services[0].price_amount, 0)
})

test('only active allowed catalog entries can be modified', async () => {
  for (const body of [certificationMutation({ id: HIDDEN }), certificationMutation({ id: OTHER_PERSON }), addonMutation({ id: HIDDEN }), addonMutation({ id: BASE })]) {
    const { state, route } = harness()
    await assertError(await route.PUT(request(body)), 400, 'ORG_INPUT_INVALID')
    assert.equal(state.mutations.length, 0)
  }
})

test('certification validation honors catalog requirements and real dates without banning expired credentials', async () => {
  for (const values of [
    { enabled: true, number: ' ', date: '2028-02-29' },
    { enabled: true, number: '123', date: ' ' },
    ...['2025-02-29', '1900-02-29', '2024-04-31', '0000-01-01', '2024-13-01', '2024-00-01', '2024-01-00', '2024-01-32', '24-01-01', '2024-1-1'].map(date => ({ enabled: true, number: '123', date })),
  ]) {
    const { state, route } = harness()
    await assertError(await route.PUT(request(certificationMutation({ values }))), 400, 'ORG_INPUT_INVALID')
    assert.equal(state.mutations.length, 0)
  }
  for (const values of [{ enabled: true, number: '123', date: '2000-02-29' }, { enabled: false, number: '', date: '' }]) {
    const { route } = harness()
    assert.equal((await route.PUT(request(certificationMutation({ values })))).status, 200)
  }
})

test('addon prices use decimal rounding within numeric(12,2) and reject invalid or negative numbers', async () => {
  for (const [price, expected] of [['9999999999.99', '9999999999.99'], ['1.005', '1.01'], ['.5', '0.5'], ['0001,239', '1.24'], ['0', '0']]) {
    const { route } = harness()
    const response = await route.PUT(request(addonMutation({ values: { enabled: true, price } })))
    assert.equal(response.status, 200, price)
    assert.equal((await response.json()).entry.value.price, expected)
  }
  for (const price of ['9999999999.995', '10000000000', '-0.01', 'NaN', 'Infinity', '1e309', '1e3', '0x10', '1,2,3', '12 kr']) {
    const { state, route } = harness()
    await assertError(await route.PUT(request(addonMutation({ values: { enabled: true, price } }))), 400, 'ORG_INPUT_INVALID')
    assert.deepEqual(state.events, [])
  }
})

test('strict mutation shapes reject actor, target person, catalog metadata, currency, and invalid baseline injections', async () => {
  const certification = certificationMutation()
  for (const body of [
    { ...certification, profileId: OTHER_PERSON }, { ...certification, actorProfileId: OTHER_PERSON }, { ...certification, role: 'admin' },
    { ...certification, id: 'invalid' }, { ...certification, kind: 'other' }, { ...certification, expected: undefined },
    { ...certification, values: { enabled: true, number: '123', date: '2028-02-29', requiresNumber: false } },
    { ...certification, expected: { enabled: false, number: '', date: '', version: 1 } },
    { ...certification, values: { enabled: 'true', number: '123', date: '2028-02-29' } },
    { ...certification, values: { enabled: true, number: 123, date: '2028-02-29' } },
    addonMutation({ currency: 'EUR' }), addonMutation({ values: { enabled: true, price: '100', currency: 'EUR' } }),
    addonMutation({ expected: { enabled: true, price: 100 } }), addonMutation({ values: { enabled: true, price: null } }),
  ]) {
    const { state, route } = harness()
    await assertError(await route.PUT(request(body)), 400, 'ORG_INPUT_INVALID')
    assert.deepEqual(state.events, [])
  }
})

test('request origin, body size, JSON type, and syntax are guarded before authentication or database work', async () => {
  for (const [candidate, status, code] of [
    [request(undefined, { origin: 'https://attacker.test' }), 403, 'ORG_ORIGIN_FORBIDDEN'],
    [request(undefined, { 'sec-fetch-site': 'cross-site' }), 403, 'ORG_ORIGIN_FORBIDDEN'],
    [request(undefined, { 'content-type': 'text/plain' }), 415, 'ORG_CONTENT_TYPE_INVALID'],
    [request(undefined, { 'content-length': '9000' }), 413, 'ORG_REQUEST_TOO_LARGE'],
    [request(certificationMutation({ values: { enabled: true, number: 'å'.repeat(5000), date: '' } })), 413, 'ORG_REQUEST_TOO_LARGE'],
    [request('{', {}, true), 400, 'ORG_REQUEST_INVALID'],
    [request(null), 400, 'ORG_REQUEST_INVALID'],
    [request([]), 400, 'ORG_REQUEST_INVALID'],
  ] as const) {
    const { state, route } = harness()
    await assertError(await route.PUT(candidate), status, code)
    assert.deepEqual(state.events, [])
  }
})

test('database failures remain opaque and missing schema produces a recoverable setup error', async () => {
  for (const [code, status, publicCode] of [['XX000', 500, 'ORG_REQUEST_FAILED'], ['42P01', 503, 'ORG_SCHEMA_REQUIRED']] as const) {
    const { state, route } = harness()
    state.failures.settings_certifications = { code, message: 'private database diagnostic' }
    await assertError(await route.GET(getRequest()), status, publicCode)
    await assertError(await route.PUT(request()), status, publicCode)
    assert.equal(state.mutations.length, 0)
  }
})
