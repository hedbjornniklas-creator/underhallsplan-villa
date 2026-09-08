import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import type * as Customer from '../src/lib/eb/followUpCustomer'
import type * as Templates from '../src/lib/inspections/reportEmailTemplates'
import type * as Route from '../src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/follow-up-customer/route'
import type * as Settings from '../src/components/eb/EbFollowUpCustomerSettings'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((id: string) => {
    if (id in dependencies) return dependencies[id]
    if (['react', 'react/jsx-runtime'].includes(id)) return require(id)
    throw new Error(`Unexpected customer test I/O: ${id}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const customer = load<typeof Customer>('src/lib/eb/followUpCustomer.ts', { 'server-only': {} })
const templates = load<typeof Templates>('src/lib/inspections/reportEmailTemplates.ts', { 'server-only': {} })

test('one accepted assignment is the default; a project email alone or disagreeing sources never authorizes a new purchase', () => {
  const choose = (assignmentEmail: unknown, projectEmail: unknown, confirmedEmail: unknown = null) =>
    customer.selectEbFollowUpCustomer({ assignmentEmail, projectEmail, confirmedEmail })
  assert.deepEqual(choose(' BUYER@example.test ', 'buyer@example.test'), { email: 'buyer@example.test', source: 'assignment' })
  assert.deepEqual(choose('buyer@example.test', null), { email: 'buyer@example.test', source: 'assignment' })
  assert.deepEqual(choose(null, 'project@example.test'), { email: null, source: 'missing' })
  assert.deepEqual(choose('buyer@example.test', 'project@example.test'), { email: null, source: 'conflict' })
  assert.deepEqual(choose('buyer@example.test', 'invalid'), { email: null, source: 'conflict' })
  assert.deepEqual(choose('changed@example.test', 'different@example.test', 'Confirmed@example.test'), { email: 'confirmed@example.test', source: 'confirmed' })
  for (const status of ['ordered', 'booked', 'completed', 'accepted']) {
    assert.equal(customer.isAcceptedEbFollowUpAssignment({ status, accepted_at: '2026-09-08' }), true)
    assert.equal(customer.isAcceptedEbFollowUpAssignment({ status, accepted_at: null }), false)
  }
  for (const status of ['draft', 'sent', 'cancelled', 'expired']) {
    assert.equal(customer.isAcceptedEbFollowUpAssignment({ status, accepted_at: '2026-09-08' }), false)
  }
})

type Row = Record<string, unknown>
function resolverFixture() {
  const scope = { org_id: 'org', eb_project_id: 'project', inspection_id: 'inspection' }
  const tables: Record<string, Row[]> = {
    eb_inspection_details: [{ ...scope }],
    eb_projects: [{ id: 'project', org_id: 'org', client_email: 'buyer@example.test' }],
    eb_follow_up_customers: [],
    eb_assignment_confirmations: [{ org_id: 'org', inspection_id: 'inspection', is_current: true, assignment_id: 'assignment' }],
    assignments: [{ id: 'assignment', org_id: 'org', status: 'ordered', accepted_at: '2026-09-08', customer_email: 'buyer@example.test' }],
    eb_follow_up_orders: [],
  }
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  let failure: string | null = null
  let rejection: { table: string; stage: 'from' | 'maybeSingle' } | null = null
  const admin = {
    from: (table: string) => {
      assert.ok(table in tables)
      if (rejection?.table === table && rejection.stage === 'from') throw new TypeError('fetch failed')
      const filters: Array<[string, unknown]> = []
      calls.push({ table, filters })
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        maybeSingle: async () => {
          if (rejection?.table === table && rejection.stage === 'maybeSingle') throw new TypeError('fetch failed')
          return { data: tables[table].find(row => filters.every(([key, value]) => row[key] === value)) ?? null,
            error: failure === table ? { code: '42P01', message: 'missing table' } : null }
        },
      }
      return query
    },
  }
  const input = { admin: admin as unknown as Parameters<typeof customer.resolveEbFollowUpCustomer>[0]['admin'],
    orgId: 'org', projectId: 'project', inspectionId: 'inspection' }
  return { tables, calls, input, scope, fail: (table: string) => { failure = table },
    reject: (table: string, stage: 'from' | 'maybeSingle') => { rejection = { table, stage } } }
}

test('server resolver verifies org/project/inspection, current assignment and actual accepted status', async () => {
  const f = resolverFixture()
  assert.deepEqual(await customer.resolveEbFollowUpCustomer(f.input), { email: 'buyer@example.test', source: 'assignment' })
  assert.deepEqual(f.calls.find(call => call.table === 'eb_inspection_details')?.filters,
    [['org_id', 'org'], ['eb_project_id', 'project'], ['inspection_id', 'inspection']])
  assert.ok(f.calls.every(call => call.filters.some(([key, value]) => key === 'org_id' && value === 'org')))
  for (const change of [{ orgId: 'other' }, { projectId: 'other' }, { inspectionId: 'other' }]) {
    await assert.rejects(customer.resolveEbFollowUpCustomer({ ...f.input, ...change }), /EB_INSPECTION_NOT_FOUND/)
  }
  f.tables.eb_assignment_confirmations[0].is_current = false
  assert.deepEqual(await customer.resolveEbFollowUpCustomer(f.input), { email: null, source: 'missing' })
  f.tables.eb_assignment_confirmations[0].is_current = true
  f.tables.assignments[0].status = 'sent'
  assert.deepEqual(await customer.resolveEbFollowUpCustomer(f.input), { email: null, source: 'missing' })
  f.tables.eb_follow_up_customers.push({ ...f.scope, email: 'confirmed@example.test', confirmed_at: 'today', confirmed_by: 'inspector' })
  assert.deepEqual(await customer.resolveEbFollowUpCustomer(f.input), { email: 'confirmed@example.test', source: 'confirmed' })
})

test('delivery uses only the designated contact, freezes a paid owner, and fails closed without breaking ordinary delivery', async () => {
  const f = resolverFixture()
  assert.equal(await customer.resolveEbFollowUpDeliveryCustomer(f.input), 'buyer@example.test')
  f.tables.eb_projects[0].client_email = 'other@example.test'
  assert.equal(await customer.resolveEbFollowUpDeliveryCustomer(f.input), null)
  f.tables.eb_follow_up_orders.push({ ...f.scope, buyer_snapshot: { email: 'original@example.test' } })
  assert.equal(await customer.resolveEbFollowUpDeliveryCustomer(f.input), 'original@example.test')
  f.fail('eb_follow_up_customers')
  assert.equal(await customer.resolveEbFollowUpDeliveryCustomer(f.input), 'original@example.test')
  f.tables.eb_follow_up_orders = []
  assert.equal(await customer.resolveEbFollowUpDeliveryCustomer(f.input), null)
  await assert.rejects(customer.resolveEbFollowUpCustomer(f.input), /EB_FOLLOW_UP_CONFIGURATION/)
})

test('delivery prefills accepted assignment then project, but suggestions never become purchase authority', async () => {
  const f = resolverFixture()
  f.tables.eb_projects[0].client_email = 'project@example.test'
  assert.deepEqual(await customer.getEbFollowUpDeliveryCustomerDefaults(f.input), {
    email: 'buyer@example.test', established: false, purchased: false,
  })
  assert.deepEqual(await customer.resolveEbFollowUpCustomer(f.input), { email: null, source: 'conflict' })
  f.tables.eb_assignment_confirmations = []
  assert.deepEqual(await customer.getEbFollowUpDeliveryCustomerDefaults(f.input), {
    email: 'project@example.test', established: false, purchased: false,
  })
  assert.deepEqual(await customer.resolveEbFollowUpCustomer(f.input), { email: null, source: 'missing' })
  f.tables.eb_projects[0].client_email = null
  assert.deepEqual(await customer.getEbFollowUpDeliveryCustomerDefaults(f.input), {
    email: null, established: false, purchased: false,
  })
  f.tables.eb_follow_up_customers.push({ ...f.scope, email: 'established@example.test' })
  assert.deepEqual(await customer.getEbFollowUpDeliveryCustomerDefaults(f.input), {
    email: 'established@example.test', established: true, purchased: false,
  })
  f.tables.eb_follow_up_orders.push({ ...f.scope, buyer_snapshot: { email: 'frozen@example.test' } })
  assert.deepEqual(await customer.getEbFollowUpDeliveryCustomerDefaults(f.input), {
    email: 'frozen@example.test', established: true, purchased: true,
  })
  for (const change of [{ orgId: 'other' }, { projectId: 'other' }, { inspectionId: 'other' }]) {
    await assert.rejects(customer.getEbFollowUpDeliveryCustomerDefaults({ ...f.input, ...change }), /EB_INSPECTION_NOT_FOUND/)
  }
})

test('delivery initialization passes only explicit server scope and returns authoritative RPC customer, not its requested address', async () => {
  const f = resolverFixture()
  const calls: Array<{ name: string; args: unknown }> = []
  let result: { data: unknown; error: { code?: string; message?: string } | null } = {
    data: { email: 'frozen@example.test', established: true, purchased: true }, error: null,
  }
  const admin = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return result } }
  const input = { ...f.input, admin: admin as unknown as typeof f.input.admin, email: ' NEW@example.test ', userId: 'inspector' }
  assert.deepEqual(await customer.initializeEbFollowUpDeliveryCustomer(input), result.data)
  assert.deepEqual(calls, [{ name: 'eb_initialize_follow_up_delivery_customer', args: {
    p_org_id: 'org', p_project_id: 'project', p_inspection_id: 'inspection', p_email: 'new@example.test', p_actor: 'inspector',
  } }])
  await assert.rejects(customer.initializeEbFollowUpDeliveryCustomer({ ...input, email: 'invalid' }), /EB_FOLLOW_UP_EMAIL_INVALID/)
  assert.equal(calls.length, 1)
  for (const code of ['EB_INSPECTION_NOT_FOUND', 'EB_FOLLOW_UP_EMAIL_INVALID', 'EB_FOLLOW_UP_ACTOR_INVALID']) {
    result = { data: null, error: { message: code } }
    await assert.rejects(customer.initializeEbFollowUpDeliveryCustomer(input), new RegExp(code))
  }
  result = { data: null, error: { code: 'PGRST202' } }
  await assert.rejects(customer.initializeEbFollowUpDeliveryCustomer(input), /EB_FOLLOW_UP_CONFIGURATION/)
  for (const data of [null, {}, [], { established: false }, { established: true, purchased: 'false' }]) {
    result = { data, error: null }
    await assert.rejects(customer.initializeEbFollowUpDeliveryCustomer(input), /EB_FOLLOW_UP_UNAVAILABLE/)
  }
})

test('delivery metadata normalizes thrown reads while retaining known scope/configuration errors', async () => {
  for (const table of ['eb_follow_up_orders', 'eb_follow_up_customers', 'assignments']) {
    for (const stage of ['from', 'maybeSingle'] as const) {
      const f = resolverFixture()
      f.reject(table, stage)
      await assert.rejects(customer.getEbFollowUpDeliveryCustomerDefaults(f.input), { message: 'EB_FOLLOW_UP_UNAVAILABLE' })
    }
  }
  const f = resolverFixture()
  f.fail('eb_follow_up_customers')
  await assert.rejects(customer.getEbFollowUpDeliveryCustomerDefaults(f.input), { message: 'EB_FOLLOW_UP_CONFIGURATION' })
  await assert.rejects(customer.getEbFollowUpDeliveryCustomerDefaults({ ...resolverFixture().input, inspectionId: 'other' }),
    { message: 'EB_INSPECTION_NOT_FOUND' })
})

test('delivery initialization normalizes synchronous and asynchronous RPC failures while retaining known errors', async () => {
  const f = resolverFixture()
  for (const rpc of [() => { throw new TypeError('fetch failed') }, async () => { throw new TypeError('fetch failed') }]) {
    await assert.rejects(customer.initializeEbFollowUpDeliveryCustomer({ ...f.input,
      admin: { rpc } as unknown as typeof f.input.admin, email: 'buyer@example.test', userId: 'inspector',
    }), { message: 'EB_FOLLOW_UP_UNAVAILABLE' })
  }
  for (const code of ['EB_INSPECTION_NOT_FOUND', 'EB_FOLLOW_UP_EMAIL_INVALID', 'EB_FOLLOW_UP_ACTOR_INVALID', 'EB_FOLLOW_UP_CONFIGURATION']) {
    const error = new Error(code)
    await assert.rejects(customer.initializeEbFollowUpDeliveryCustomer({ ...f.input,
      admin: { rpc: async () => { throw error } } as unknown as typeof f.input.admin,
      email: 'buyer@example.test', userId: 'inspector',
    }), failure => failure === error)
  }
})

test('management links and copy are recipient-specific; normal and shared emails contain only a reading link', () => {
  const input = { orgName: 'Inspector', customerName: 'Customer', propertyAddress: 'Street', inspectionDate: '2026-09-08', detailsUrl: 'https://example.test/rapport/token' }
  const matching = customer.ebFollowUpCustomerEntryUrl(input.detailsUrl, 'BUYER@example.test', 'buyer@example.test')
  assert.equal(matching, `${input.detailsUrl}?customer=1`)
  assert.equal(customer.ebFollowUpCustomerEntryUrl(`${input.detailsUrl}?arbitrary=value#secret`, 'buyer@example.test', 'buyer@example.test'), matching)
  for (const recipient of ['contractor@example.test', 'broker@example.test']) {
    const other = templates.buildInspectionReportDeliveryEmail({ ...input,
      customerManagementUrl: customer.ebFollowUpCustomerEntryUrl(input.detailsUrl, recipient, 'buyer@example.test') })
    assert.doesNotMatch(other.html + other.text, /customer=|Hantera din besiktning/)
  }
  assert.equal(customer.ebFollowUpCustomerEntryUrl(input.detailsUrl, 'buyer@example.test', null), null)
  const intended = templates.buildInspectionReportDeliveryEmail({ ...input, customerManagementUrl: matching })
  assert.match(intended.html, /Hantera din besiktning/)
  assert.match(intended.text, /customer=1/)
  assert.match(intended.text, /verifiera din e-postadress/)
  const shared = templates.buildInspectionReportShareEmail(input)
  assert.doesNotMatch(shared.html + shared.text, /customer=|Hantera din besiktning/)
})

test('authenticated API requires module and org access, an explicit confirmation, and uses only route/session scope', async () => {
  const calls: Array<{ name: string; input?: unknown }> = []
  let authError = ''
  const route = load<typeof Route>('src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/follow-up-customer/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/access/server': { requireModuleAccess: async () => { calls.push({ name: 'module' }); if (authError) throw new Error(authError) } },
    '@/lib/assignments/server': { requireOrgContext: async () => { calls.push({ name: 'org' }); return { orgId: 'authorized-org', userId: 'inspector' } } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => 'admin-client' },
    '@/lib/eb/followUpCustomer': {
      getEbFollowUpCustomerSettings: async (input: unknown) => { calls.push({ name: 'get', input }); return {} },
      confirmEbFollowUpCustomer: async (input: unknown) => { calls.push({ name: 'confirm', input }); return {} },
    },
  })
  const params = { params: Promise.resolve({ projectId: 'project', inspectionId: 'inspection' }) }
  const request = (body: unknown) => new Request('https://example.test/api/customer', { method: 'PATCH', body: JSON.stringify(body) })
  for (const [code, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403], ['MODULE_ACCESS_REQUIRED', 403]] as const) {
    authError = code
    assert.equal((await route.PATCH(request({ email: 'buyer@example.test', confirmed: true }), params)).status, status)
    assert.equal(calls.some(call => call.name === 'confirm'), false)
  }
  authError = ''
  for (const confirmed of [false, 'true', undefined]) {
    assert.equal((await route.PATCH(request({ email: 'buyer@example.test', confirmed }), params)).status, 400)
  }
  assert.equal((await route.PATCH(request({ email: 'buyer@example.test', confirmed: true, orgId: 'attacker', userId: 'attacker', inspectionId: 'attacker' }), params)).status, 200)
  assert.deepEqual(calls.find(call => call.name === 'confirm')?.input, {
    admin: 'admin-client', orgId: 'authorized-org', userId: 'inspector', projectId: 'project', inspectionId: 'inspection', email: 'buyer@example.test',
  })
  assert.equal((await route.GET(request(null), params)).headers.get('Cache-Control'), 'private, no-store')
})

test('correction settings explain automatic delivery contact without an upsell decision and never edit a paid owner', () => {
  const Component = load<typeof Settings>('src/components/eb/EbFollowUpCustomerSettings.tsx', {}).default
  const settings: Customer.EbFollowUpCustomerSettings = {
    email: null, source: 'missing', projectEmail: 'project@example.test', assignmentEmail: null,
    confirmedAt: null, confirmedBy: null, purchased: false, purchasedEmail: null,
  }
  const render = (changes: Partial<Customer.EbFollowUpCustomerSettings>) => renderToStaticMarkup(createElement(Component, {
    initialSettings: { ...settings, ...changes }, endpoint: '/scoped-api',
  }))
  const missing = render({})
  assert.match(missing, /sparas automatiskt vid den första leveransen från Fastställ och leverera/)
  assert.match(missing, /även utan uppdragsbekräftelse/)
  assert.match(missing, /Ingen beställaradress är sparad/)
  assert.match(missing, /value="project@example.test"/)
  assert.match(missing, /type="checkbox"/)
  assert.match(missing, /disabled=""/)
  assert.match(render({ source: 'conflict', assignmentEmail: 'buyer@example.test' }), /innehåller olika adresser/)
  assert.doesNotMatch(missing, /Aktivera köp|Tillåt köp|Nya beställningar är spärrade/)
  const paid = render({ purchased: true, purchasedEmail: 'original@example.test' })
  assert.match(paid, /original@example.test/)
  assert.match(paid, /Adressen kan inte ändras här efter ett köp/)
  assert.doesNotMatch(paid, /<form|<input|<button/)
})

const db = new PGlite()
const migration = read('docs/db/2026-09-08_01_eb_follow_up_customer.sql')
const deliveryMigration = read('docs/db/2026-09-08_03_eb_follow_up_delivery_customer.sql')
const org = randomUUID(), actor = randomUUID()
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges grant all on tables to service_role;
    create table organizations(id uuid primary key);
    create table profiles(id uuid primary key);
    create table eb_projects(id uuid primary key,org_id uuid,client_email text);
    create table eb_inspection_details(inspection_id uuid primary key,org_id uuid,eb_project_id uuid,report_locked_at timestamptz);
    create table assignments(id uuid primary key,org_id uuid,customer_email text,accepted_at timestamptz,status text);
    create table eb_assignment_confirmations(inspection_id uuid,org_id uuid,assignment_id uuid,is_current boolean);
    create table eb_follow_up_orders(id uuid primary key default gen_random_uuid(),org_id uuid,eb_project_id uuid,inspection_id uuid unique,buyer_snapshot jsonb);`)
  await db.exec(migration)
  await db.exec(migration)
  await db.exec(deliveryMigration)
  await db.exec(deliveryMigration)
  await db.query('insert into organizations values($1)', [org])
  await db.query('insert into profiles values($1)', [actor])
})
after(async () => { await db.close() })
async function sqlFixture() {
  const project = randomUUID(), inspection = randomUUID(), assignment = randomUUID()
  await db.query('insert into eb_projects values($1,$2,$3)', [project, org, 'buyer@example.test'])
  await db.query('insert into eb_inspection_details values($1,$2,$3,now())', [inspection, org, project])
  await db.query('insert into assignments values($1,$2,$3,now(),$4)', [assignment, org, 'buyer@example.test', 'ordered'])
  await db.query('insert into eb_assignment_confirmations values($1,$2,$3,true)', [inspection, org, assignment])
  const resolve = async (scope = [org, project, inspection]) => (await db.query<{ email: string | null }>(
    'select eb_resolve_follow_up_customer_email($1,$2,$3) email', scope)).rows[0].email
  const confirm = async (email: string, scope = [org, project, inspection]) => db.query(
    'select eb_confirm_follow_up_customer($1,$2,$3,$4,$5)', [...scope, email, actor])
  const buy = async (email: string) => db.query('insert into eb_follow_up_orders(org_id,eb_project_id,inspection_id,buyer_snapshot) values($1,$2,$3,$4)',
    [org, project, inspection, { email }])
  const initialize = async (email: string, scope = [org, project, inspection], userId: string | null = actor) =>
    (await db.query<{ customer: Customer.EbFollowUpDeliveryCustomer }>(
      'select eb_initialize_follow_up_delivery_customer($1,$2,$3,$4,$5) customer', [...scope, email, userId])).rows[0].customer
  return { project, inspection, assignment, resolve, confirm, buy, initialize }
}

test('migration is repeatable and denies anonymous/authenticated direct access and RPCs, including direct service writes', async () => {
  for (const role of ['anon', 'authenticated']) {
    const grants = (await db.query<{ read: boolean; write: boolean; confirm: boolean; resolve: boolean; initialize: boolean }>(`select
      has_table_privilege($1,'eb_follow_up_customers','SELECT') as read,
      has_table_privilege($1,'eb_follow_up_customers','INSERT') as write,
      has_function_privilege($1,'eb_confirm_follow_up_customer(uuid,uuid,uuid,text,uuid)','EXECUTE') as confirm,
      has_function_privilege($1,'eb_resolve_follow_up_customer_email(uuid,uuid,uuid)','EXECUTE') as resolve,
      has_function_privilege($1,'eb_initialize_follow_up_delivery_customer(uuid,uuid,uuid,text,uuid)','EXECUTE') as initialize`, [role])).rows[0]
    assert.deepEqual(grants, { read: false, write: false, confirm: false, resolve: false, initialize: false })
  }
  const service = (await db.query<{ write: boolean; confirm: boolean; initialize: boolean }>(`select
    has_table_privilege('service_role','eb_follow_up_customers','INSERT') as write,
    has_function_privilege('service_role','eb_confirm_follow_up_customer(uuid,uuid,uuid,text,uuid)','EXECUTE') as confirm,
    has_function_privilege('service_role','eb_initialize_follow_up_delivery_customer(uuid,uuid,uuid,text,uuid)','EXECUTE') as initialize`)).rows[0]
  assert.deepEqual(service, { write: false, confirm: true, initialize: true })
})

test('SQL and TS policy agree for actual accepted statuses, absent acceptance and source disagreement', async () => {
  const f = await sqlFixture()
  assert.equal(await f.resolve(), 'buyer@example.test')
  for (const status of ['booked', 'completed', 'accepted', 'sent', 'cancelled', 'expired', 'draft']) {
    await db.query('update assignments set status=$1 where id=$2', [status, f.assignment])
    assert.equal(await f.resolve(), ['booked', 'completed', 'accepted'].includes(status) ? 'buyer@example.test' : null)
  }
  await db.query("update assignments set status='ordered',accepted_at=null where id=$1", [f.assignment])
  assert.equal(await f.resolve(), null)
  await db.query('update assignments set accepted_at=now() where id=$1', [f.assignment])
  await db.query("update eb_projects set client_email='different@example.test' where id=$1", [f.project])
  assert.equal(await f.resolve(), null)
  await assert.rejects(f.buy('buyer@example.test'), /BUYER_MISMATCH/)
  await assert.rejects(f.buy('different@example.test'), /BUYER_MISMATCH/)
  for (const scope of [[randomUUID(), f.project, f.inspection], [org, randomUUID(), f.inspection], [org, f.project, randomUUID()]]) {
    assert.equal(await f.resolve(scope), null)
    await assert.rejects(f.confirm('buyer@example.test', scope), /INSPECTION_NOT_FOUND/)
  }
})

test('explicit confirmation works for old locked reports, is audited, supersedes sources, and cannot transfer an existing order', async () => {
  const f = await sqlFixture()
  const before = (await db.query('select * from eb_inspection_details where inspection_id=$1', [f.inspection])).rows[0]
  await f.confirm(' CONFIRMED@example.test ')
  assert.equal(await f.resolve(), 'confirmed@example.test')
  await db.query("update assignments set customer_email='changed@example.test' where id=$1", [f.assignment])
  assert.equal(await f.resolve(), 'confirmed@example.test')
  await f.confirm('replacement@example.test')
  await assert.rejects(f.buy('confirmed@example.test'), /BUYER_MISMATCH/, 'A contact changed after verification cannot buy using the stale address')
  await f.buy('replacement@example.test')
  await assert.rejects(f.confirm('new-owner@example.test'), /CUSTOMER_FROZEN/)
  const audit = (await db.query<{ previous_email: string | null; email: string; confirmed_by: string }>(
    'select previous_email,email,confirmed_by from eb_follow_up_customer_audit where inspection_id=$1 order by confirmed_at', [f.inspection])).rows
  assert.deepEqual(audit, [
    { previous_email: null, email: 'confirmed@example.test', confirmed_by: actor },
    { previous_email: 'confirmed@example.test', email: 'replacement@example.test', confirmed_by: actor },
  ])
  assert.deepEqual((await db.query('select * from eb_inspection_details where inspection_id=$1', [f.inspection])).rows[0], before)
  assert.deepEqual((await db.query<{ buyer_snapshot: { email: string } }>('select buyer_snapshot from eb_follow_up_orders where inspection_id=$1', [f.inspection])).rows[0].buyer_snapshot,
    { email: 'replacement@example.test' })
})

test('first delivery establishes its typed customer without an assignment, audits once and never changes a resend customer', async () => {
  const f = await sqlFixture()
  await db.query('delete from eb_assignment_confirmations where inspection_id=$1', [f.inspection])
  await db.query('update eb_projects set client_email=null where id=$1', [f.project])
  const before = (await db.query('select * from eb_inspection_details where inspection_id=$1', [f.inspection])).rows[0]
  assert.equal(await f.resolve(), null)
  assert.deepEqual(await f.initialize(' TYPED@example.test '), { email: 'typed@example.test', established: true, purchased: false })
  assert.equal(await f.resolve(), 'typed@example.test')
  assert.deepEqual(await f.initialize('different@example.test'), { email: 'typed@example.test', established: true, purchased: false })
  const audit = (await db.query('select previous_email,email,confirmed_by from eb_follow_up_customer_audit where inspection_id=$1', [f.inspection])).rows
  assert.deepEqual(audit, [{ previous_email: null, email: 'typed@example.test', confirmed_by: actor }])
  assert.deepEqual((await db.query('select * from eb_inspection_details where inspection_id=$1', [f.inspection])).rows[0], before)
  // Only the deliberate correction operation may change an established customer before purchase.
  await f.confirm('corrected@example.test')
  assert.deepEqual(await f.initialize('typed@example.test'), { email: 'corrected@example.test', established: true, purchased: false })
})

test('delivery initialization validates scope, email and actor before any contact or audit is written', async () => {
  const f = await sqlFixture()
  for (const scope of [[randomUUID(), f.project, f.inspection], [org, randomUUID(), f.inspection], [org, f.project, randomUUID()]]) {
    await assert.rejects(f.initialize('buyer@example.test', scope), /INSPECTION_NOT_FOUND/)
  }
  for (const userId of [null, randomUUID()]) {
    await assert.rejects(f.initialize('buyer@example.test', undefined, userId), /ACTOR_INVALID/)
  }
  for (const invalid of ['', 'not-an-email', 'a'.repeat(255) + '@example.test']) {
    await assert.rejects(f.initialize(invalid), /EMAIL_INVALID/)
  }
  assert.equal((await db.query('select * from eb_follow_up_customers where inspection_id=$1', [f.inspection])).rows.length, 0)
  assert.equal((await db.query('select * from eb_follow_up_customer_audit where inspection_id=$1', [f.inspection])).rows.length, 0)
})

test('serialized delivery/purchase outcomes preserve frozen buyers and prevent a stale accepted customer buying after initialization', async () => {
  const purchaseFirst = await sqlFixture()
  await purchaseFirst.buy('buyer@example.test')
  assert.deepEqual(await purchaseFirst.initialize('different@example.test'), { email: 'buyer@example.test', established: true, purchased: true })
  assert.equal((await db.query('select * from eb_follow_up_customers where inspection_id=$1', [purchaseFirst.inspection])).rows.length, 0)
  const deliveryFirst = await sqlFixture()
  await deliveryFirst.initialize('typed@example.test')
  await assert.rejects(deliveryFirst.buy('buyer@example.test'), /BUYER_MISMATCH/)
  await deliveryFirst.buy('typed@example.test')
  assert.deepEqual(await deliveryFirst.initialize('different@example.test'), { email: 'typed@example.test', established: true, purchased: true })
  // PGlite uses a single connection; verify both ordering outcomes above plus the
  // exact DB lock shared by initialization, correction and order validation.
  for (const signature of [
    'eb_initialize_follow_up_delivery_customer(uuid,uuid,uuid,text,uuid)',
    'eb_confirm_follow_up_customer(uuid,uuid,uuid,text,uuid)',
    'eb_guard_follow_up_order_customer()',
  ]) {
    const definition = (await db.query<{ definition: string }>('select pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition
    assert.match(definition, /pg_advisory_xact_lock\(hashtextextended\('eb-follow-up-order:'/)
  }
})
