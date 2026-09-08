import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import type * as Service from '../src/lib/besiktapp/interestTracking'
import type * as Route from '../src/app/api/admin/besiktapp-interest/route'
// @ts-expect-error Node strip-types requires extension.
import * as contracts from '../src/lib/besiktapp/interestTrackingContracts.ts'

const require = createRequire(import.meta.url)
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'node:crypto') return require(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const id = 'f543b282-1bc6-401a-9f3c-ef4492187c62'
const update = { id, status: 'contacted', owner_name: 'Ansvarig', follow_up_on: '2026-09-10', revision: 0 }
test('admin update validation rejects unknown statuses, impossible dates and malformed fields', () => {
  assert.deepEqual(contracts.validateInterestUpdate(update), update)
  assert.equal(contracts.validateInterestUpdate({ ...update, follow_up_on: null })?.follow_up_on, null)
  for (const patch of [{ status: 'admin' }, { status: '__proto__' }, { id: 'invalid' }, { follow_up_on: '2026-02-30' }, { follow_up_on: 'today' }, { owner_name: 'a\nb' }, { owner_name: 2 }, { revision: -1 }, { revision: 1.2 }]) {
    assert.equal(contracts.validateInterestUpdate({ ...update, ...patch }), null)
  }
})

function route(authorization: () => Promise<void>, storage: Partial<typeof Service> = {}) {
  return load<typeof Route>('src/app/api/admin/besiktapp-interest/route.ts', {
    '@/lib/access/server': { requireModuleAccess: authorization },
    '@/lib/besiktapp/interestTracking': storage,
    '@/lib/besiktapp/interestTrackingContracts': contracts,
  })
}
function patch(body: unknown = update, origin = 'https://example.test') {
  return new Request('https://example.test/api/admin/besiktapp-interest', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
test('both admin endpoints reject unauthorized users before accessing storage', async () => {
  for (const [error, status] of [['UNAUTHORIZED', 401], ['MODULE_ACCESS_REQUIRED', 403]] as const) {
    const api = route(async () => { throw new Error(error) })
    assert.equal((await api.GET(new Request('https://example.test/api/admin/besiktapp-interest'))).status, status)
    assert.equal((await api.PATCH(patch())).status, status)
  }
})
test('admin API validates filters, protects mutations against cross-origin requests and disables caching', async () => {
  let calls = 0
  const api = route(async () => {}, { listInterests: async (status, page) => { calls++; assert.equal(status, 'new'); assert.equal(page, 2); return { items: [], total: 0 } } })
  assert.equal((await api.GET(new Request('https://example.test/api/admin/besiktapp-interest?page=-1'))).status, 400)
  assert.equal((await api.GET(new Request('https://example.test/api/admin/besiktapp-interest?status=bad'))).status, 400)
  assert.equal((await api.PATCH(patch(update, 'https://other.test'))).status, 403)
  assert.equal((await api.PATCH(patch({ ...update, status: 'bad' }))).status, 400)
  const response = await api.GET(new Request('https://example.test/api/admin/besiktapp-interest?status=new&page=2'))
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(calls, 1)
})
test('admin API reports disabled tracking and edit conflicts without raw database errors', async () => {
  const disabled = route(async () => {}, { listInterests: async () => { throw new Error('TRACKING_DISABLED') } })
  assert.equal((await disabled.GET(new Request('https://example.test/'))).status, 503)
  const conflict = route(async () => {}, { updateInterest: async () => { throw new Error('TRACKING_CONFLICT') } })
  assert.equal((await conflict.PATCH(patch())).status, 409)
})

type Stored = Record<string, unknown>
function storageHarness() {
  const rows: Stored[] = []
  const db = { from: () => {
    let operation = 'select'; let values: Stored = {}; const filters: Array<(row: Stored) => boolean> = []
    function run() {
      if (operation === 'insert') {
        if (rows.some(row => row.request_key === values.request_key)) return { data: null, error: { code: '23505' } }
        const row = { ...values, id: `${rows.length}`, status: 'new', notification_state: 'pending', revision: 0 }
        rows.push(row); return { data: row, error: null }
      }
      const row = rows.find(row => filters.every(filter => filter(row)))
      if (row && operation === 'update') Object.assign(row, values)
      return { data: row ? { ...row } : null, error: null }
    }
    const query = {
      insert(value: Stored) { operation = 'insert'; values = value; return query },
      update(value: Stored) { operation = 'update'; values = value; return query },
      select() { return query },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
      neq(key: string, value: unknown) { filters.push(row => row[key] !== value); return query },
      single: async () => run(), maybeSingle: async () => run(),
      then(resolve: (value: ReturnType<typeof run>) => unknown) { return Promise.resolve(resolve(run())) },
    }
    return query
  } }
  const service = load<typeof Service>('src/lib/besiktapp/interestTracking.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './interestTrackingContracts': contracts,
  })
  return { service, rows }
}
test('storage is opt-in and retries preserve administrator changes and accepted notification status', async context => {
  const previous = process.env.BESIKTAPP_INTEREST_TRACKING
  context.after(() => { if (previous === undefined) delete process.env.BESIKTAPP_INTEREST_TRACKING; else process.env.BESIKTAPP_INTEREST_TRACKING = previous })
  process.env.BESIKTAPP_INTEREST_TRACKING = '0'
  const { service, rows } = storageHarness()
  const submission = { name: 'Test', email: 'test@example.test', phone: '', company: '', message: '', website: '', submissionId: id }
  await assert.rejects(service.recordInterest(submission), /TRACKING_DISABLED/)
  assert.equal(rows.length, 0)
  process.env.BESIKTAPP_INTEREST_TRACKING = '1'
  const savedId = await service.recordInterest(submission)
  rows[0].status = 'contacted'; rows[0].owner_name = 'Team'
  assert.equal(await service.recordInterest(submission), savedId)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'contacted')
  assert.equal(rows[0].owner_name, 'Team')
  await service.markInterestNotification(savedId, 'accepted')
  await service.markInterestNotification(savedId, 'failed')
  assert.equal(rows[0].notification_state, 'accepted')
  await service.recordInterest({ ...submission, message: 'Changed request' })
  assert.equal(rows.length, 2)
  await assert.rejects(service.updateInterest({ ...update, id: savedId, revision: 999, status: 'closed' }), /TRACKING_CONFLICT/)
  assert.equal(rows[0].status, 'contacted')
  const saved = await service.updateInterest({ ...update, id: savedId, status: 'closed' })
  assert.equal(saved.revision, 1)
  await assert.rejects(service.updateInterest({ ...update, id: savedId, status: 'new' }), /TRACKING_CONFLICT/)
})

test('migration enforces uniqueness, valid statuses and blocks direct browser-role access', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
    await db.exec(readFileSync(new URL('../docs/db/2026-09-08_01_besiktapp_interest_tracking.sql', import.meta.url), 'utf8'))
    await db.exec('set role service_role')
    const key = 'a'.repeat(64)
    await db.query('insert into besiktapp_interest_requests(request_key,name,email) values($1,$2,$3)', [key, 'Test', 'test@example.test'])
    await assert.rejects(db.query('insert into besiktapp_interest_requests(request_key,name,email) values($1,$2,$3)', [key, 'Duplicate', 'test@example.test']), /unique/)
    await assert.rejects(db.query("update besiktapp_interest_requests set status = 'administrator'"), /check constraint/)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`)
      await assert.rejects(db.query('select * from besiktapp_interest_requests'), /permission denied/)
      await assert.rejects(db.query("update besiktapp_interest_requests set status = 'activated'"), /permission denied/)
      await assert.rejects(db.query('delete from besiktapp_interest_requests'), /permission denied/)
    }
  } finally { await db.close() }
})
