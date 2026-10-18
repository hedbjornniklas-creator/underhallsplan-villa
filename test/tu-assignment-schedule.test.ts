import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import type * as ScheduleDomain from '../src/lib/tu/assignmentSchedule'
import type * as ScheduleServer from '../src/lib/tu/assignmentScheduleServer'
import type * as ScheduleRoute from '../src/app/api/tu/assignments/[id]/schedule/route'
type MailInput = Parameters<typeof import('../src/lib/assignments/mailer').sendAssignmentEmail>[0]

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  }, compiled, compiled.exports)
  return compiled.exports as T
}

const domain = load<typeof ScheduleDomain>('src/lib/tu/assignmentSchedule.ts', {})
const ORG = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const VERSION = '2026-10-15T06:00:00.123456+00:00'
const context = { orgId: ORG, assignmentId: ID, userId: 'inspector', expectedUpdatedAt: VERSION }
const values = { preferredDate: '2026-10-15', preferredTime: '13:00' }
const assignment = (): ScheduleDomain.TuAssignmentSchedule & {
  assignment_type: string; customer_name: string; property_address: string;
  preliminary_address: null; responsible_profile_id: string;
} => ({
  id: ID, org_id: ORG, assignment_type: 'TU', status: 'sent', archived_at: null, accepted_at: null,
  updated_at: VERSION, preferred_date: '2026-10-12', preferred_time: '09:30:00',
  customer_email: 'kund@example.test', customer_name: 'Testkund', property_address: 'Testgatan 1',
  preliminary_address: null, responsible_profile_id: 'inspector',
})

function harness(overrides: Record<string, unknown> = {}) {
  const state = { assignment: { ...assignment(), ...overrides }, missing: false, race: false, failMail: false, failWrite: false }
  const calls: Array<{ table: string; kind: string; payload: Record<string, unknown>; filters: unknown[][] }> = []
  const mails: MailInput[] = []
  const dependencies = {
    'server-only': {}, 'node:crypto': { createHash }, '@/lib/tu/assignmentSchedule': domain,
    '@/lib/tu/server': {
      getTuAssignmentById: async (orgId: string, id: string) => {
        assert.equal(orgId, ORG); assert.equal(id, ID)
        return state.missing ? null : { ...state.assignment }
      },
      requireTuOrganizationProfileCard: async ({ orgId, profileId }: { orgId: string; profileId: string }) => {
        assert.equal(orgId, ORG); assert.equal(profileId, 'inspector')
        return { companyName: 'Exempelbolaget', email: 'inspector@example.test' }
      },
    },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (input: MailInput) => {
      mails.push(input)
      if (state.failMail) throw new Error('PRIVATE_PROVIDER_DIAGNOSTIC')
      return { provider: 'resend', providerMessageId: 'mail-1' }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from(table: string) {
      assert.ok(['assignments', 'outbound_messages'].includes(table), 'No acceptance-link changes permitted')
      const call = { table, kind: '', payload: {} as Record<string, unknown>, filters: [] as unknown[][] }
      const result = () => {
        calls.push(call)
        if (table === 'assignments') {
          if (state.failWrite) return { error: { message: 'private database detail' }, data: null }
          if (state.race) return { error: null, data: null }
          state.assignment = { ...state.assignment, ...call.payload, updated_at: '2026-10-15T06:01:00.000123+00:00' }
          return { error: null, data: state.assignment }
        }
        return { error: null, data: { id: 'log-1' } }
      }
      const query = {
        update(payload: Record<string, unknown>) { call.kind = 'update'; call.payload = payload; return query },
        insert(payload: Record<string, unknown>) { call.kind = 'insert'; call.payload = payload; return query },
        eq(...args: unknown[]) { call.filters.push(['eq', ...args]); return query },
        in(...args: unknown[]) { call.filters.push(['in', ...args]); return query },
        is(...args: unknown[]) { call.filters.push(['is', ...args]); return query },
        select() { return query },
        maybeSingle: async () => result(), single: async () => result(),
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
      }
      return query
    } }) },
  }
  return { state, calls, mails, server: load<typeof ScheduleServer>('src/lib/tu/assignmentScheduleServer.ts', dependencies) }
}

test('dates and times are calendar-validated without timezone conversion', () => {
  for (const date of ['2026-10-15', '2028-02-29']) assert.equal(domain.validTuSchedule({ ...values, preferredDate: date }), true)
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '15/10/2026', '', '0026-10-15']) assert.equal(domain.validTuSchedule({ ...values, preferredDate: date }), false)
  for (const time of ['24:00', '13:60', '9:00', '13:00:00']) assert.equal(domain.validTuSchedule({ ...values, preferredTime: time }), false)
  assert.equal(domain.validTuSchedule({ ...values, preferredTime: '' }), true)
  assert.equal(domain.formatTuSchedule(values), '15 oktober 2026 kl. 13:00')
})

test('only editable TU schedules are updated, with atomic version and approval guards', async () => {
  const h = harness()
  const result = await h.server.updateTuAssignmentSchedule({ ...context, ...values })
  assert.equal(result.preferred_date, values.preferredDate)
  assert.equal(result.status, 'sent')
  assert.deepEqual(h.calls[0].payload, { preferred_date: values.preferredDate, preferred_time: values.preferredTime, updated_by: 'inspector' })
  assert.deepEqual(h.calls[0].filters, [
    ['eq', 'id', ID], ['eq', 'org_id', ORG], ['eq', 'assignment_type', 'TU'], ['eq', 'updated_at', VERSION],
    ['in', 'status', ['draft', 'sent']], ['is', 'accepted_at', null], ['is', 'archived_at', null],
  ])
  assert.equal(h.calls.length, 1)
  assert.equal(h.mails.length, 0)
})

test('draft changes and an optional empty time are supported', async () => {
  const h = harness({ status: 'draft' })
  await h.server.updateTuAssignmentSchedule({ ...context, ...values, preferredTime: '' })
  assert.equal(h.calls[0].payload.preferred_time, null)
  assert.equal(h.state.assignment.status, 'draft')
})

test('no-op save does not change the version or send anything', async () => {
  const h = harness({ preferred_date: values.preferredDate, preferred_time: '13:00:00' })
  assert.equal((await h.server.updateTuAssignmentSchedule({ ...context, ...values })).updated_at, VERSION)
  assert.deepEqual(h.calls, [])
})

test('approved, booked, completed, archived and cancelled confirmations cannot be edited', async () => {
  for (const fields of [{ status: 'ordered' }, { status: 'booked' }, { status: 'completed' }, { status: 'cancelled' }, { accepted_at: VERSION }, { archived_at: VERSION }]) {
    const h = harness(fields)
    await assert.rejects(h.server.updateTuAssignmentSchedule({ ...context, ...values }), /TU_SCHEDULE_LOCKED/)
    assert.deepEqual(h.calls, [])
  }
})

test('missing assignment, stale version, invalid date and concurrent approval do not write', async () => {
  for (const scenario of ['missing', 'stale', 'invalid', 'race']) {
    const h = harness()
    h.state.missing = scenario === 'missing'; h.state.race = scenario === 'race'
    await assert.rejects(h.server.updateTuAssignmentSchedule({ ...context, ...values,
      ...(scenario === 'stale' ? { expectedUpdatedAt: 'old' } : {}),
      ...(scenario === 'invalid' ? { preferredDate: '2026-02-30' } : {}),
    }), /TU_SCHEDULE_(NOT_FOUND|CONFLICT|INVALID)/)
    assert.equal(h.state.assignment.preferred_date, '2026-10-12')
    assert.equal(h.mails.length, 0)
  }
})

test('notification uses current saved time, existing mailer, organization identity and logs, never changes links or status', async () => {
  const oldFrom = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM = 'test@example.test'
  try {
    const h = harness({ preferred_date: values.preferredDate, preferred_time: '13:00:00' })
    await h.server.notifyTuAssignmentSchedule(context)
    assert.equal(h.mails.length, 1)
    assert.match(h.mails[0].text, /15 oktober 2026 kl\. 13:00/)
    assert.equal(h.mails[0].replyTo, 'inspector@example.test')
    assert.equal(h.mails[0].to, 'kund@example.test')
    assert.ok(h.mails[0].idempotencyKey?.startsWith(`tu-schedule-${ID}-`))
    assert.ok(h.calls.every(call => call.table === 'outbound_messages'))
    assert.equal(h.calls[0].payload.template_key, 'tu_assignment_schedule_notice')
    assert.equal(h.calls[1].payload.status, 'sent')
    assert.equal(h.state.assignment.status, 'sent')
    assert.equal(h.state.assignment.updated_at, VERSION)
    await h.server.notifyTuAssignmentSchedule(context)
    assert.equal(h.mails[0].idempotencyKey, h.mails[1].idempotencyKey)
  } finally { if (oldFrom === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM; else process.env.ASSIGNMENTS_MAIL_FROM = oldFrom }
})

test('drafts and stale versions cannot trigger a notice', async () => {
  const h = harness({ status: 'draft' })
  await assert.rejects(h.server.notifyTuAssignmentSchedule(context), /TU_SCHEDULE_NOT_SENT/)
  h.state.assignment.status = 'sent'
  await assert.rejects(h.server.notifyTuAssignmentSchedule({ ...context, expectedUpdatedAt: 'old' }), /TU_SCHEDULE_CONFLICT/)
  assert.deepEqual(h.calls, []); assert.deepEqual(h.mails, [])
})

test('notification escapes user-supplied HTML', () => {
  const h = harness()
  const message = h.server.buildTuScheduleNotice({ customerName: '<script>x</script>', address: 'A&B', companyName: 'Test AB', values })
  assert.ok(!message.html.includes('<script>'))
  assert.ok(message.html.includes('A&amp;B'))
})

test('mail failure is logged without reverting the saved schedule', async () => {
  const oldFrom = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM = 'test@example.test'
  try {
    const h = harness({ preferred_date: values.preferredDate, preferred_time: '13:00:00' })
    h.state.failMail = true
    await assert.rejects(h.server.notifyTuAssignmentSchedule(context), /PRIVATE_PROVIDER_DIAGNOSTIC/)
    assert.ok(h.calls.every(call => call.table === 'outbound_messages'))
    assert.equal(h.calls.at(-1)?.payload.status, 'failed')
    assert.equal(h.state.assignment.preferred_date, values.preferredDate)
    assert.equal(h.state.assignment.preferred_time, '13:00:00')
    assert.equal(h.state.assignment.updated_at, VERSION)
  } finally { if (oldFrom === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM; else process.env.ASSIGNMENTS_MAIL_FROM = oldFrom }
})

function routeHarness(options: { error?: Error; accessError?: Error } = {}) {
  const calls: Array<{ orgId: string }> = []
  const route = load<typeof ScheduleRoute>('src/app/api/tu/assignments/[id]/schedule/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/tu/assignmentSchedule': domain,
    '@/lib/assignment-customers/http': load('src/lib/assignment-customers/http.ts', { 'server-only': {} }),
    '@/lib/tu/server': { requireTuContext: async (orgId: string) => {
      if (options.accessError) throw options.accessError
      assert.equal(orgId, ORG)
      return { orgId, userId: 'inspector' }
    } },
    '@/lib/tu/assignmentScheduleServer': {
      updateTuAssignmentSchedule: async (input: { orgId: string }) => { calls.push(input); if (options.error) throw options.error; return assignment() },
      notifyTuAssignmentSchedule: async (input: { orgId: string }) => { calls.push(input); if (options.error) throw options.error; return { recipient: 'kund@example.test' } },
    },
  })
  const request = (method: string, body: unknown, query = `orgId=${ORG}`) => new Request(`https://hushub.se/api/tu/assignments/${ID}/schedule?${query}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: 'https://hushub.se' }, body: JSON.stringify(body),
  })
  return { calls, route, request, params: { params: Promise.resolve({ id: ID }) } }
}

test('schedule API checks authorization and accepts only schedule fields with a version', async () => {
  const h = routeHarness()
  assert.equal((await h.route.PATCH(h.request('PATCH', { ...values, expectedUpdatedAt: VERSION }), h.params)).status, 200)
  assert.equal(h.calls[0].orgId, ORG)
  for (const body of [{ ...values }, { ...values, expectedUpdatedAt: VERSION, customerEmail: 'other@test.test' }, { ...values, expectedUpdatedAt: VERSION, status: 'ordered' }, null]) {
    assert.equal((await h.route.PATCH(h.request('PATCH', body), h.params)).status, 400)
  }
  assert.equal(h.calls.length, 1)
  assert.equal((await h.route.PATCH(h.request('PATCH', { ...values, expectedUpdatedAt: VERSION }, ''), h.params)).status, 400)
  const denied = routeHarness({ accessError: new Error('MODULE_ACCESS_REQUIRED') })
  assert.equal((await denied.route.PATCH(denied.request('PATCH', { ...values, expectedUpdatedAt: VERSION }), denied.params)).status, 403)
  assert.deepEqual(denied.calls, [])
  const crossOrigin = h.request('PATCH', { ...values, expectedUpdatedAt: VERSION })
  crossOrigin.headers.set('Origin', 'https://other.example')
  assert.equal((await h.route.PATCH(crossOrigin, h.params)).status, 403)
  assert.equal(h.calls.length, 1)
})

test('POST only notifies the saved version, rejecting unsaved values and arbitrary recipients', async () => {
  const h = routeHarness()
  assert.equal((await h.route.POST(h.request('POST', { expectedUpdatedAt: VERSION }), h.params)).status, 200)
  for (const body of [{ expectedUpdatedAt: VERSION, ...values }, { expectedUpdatedAt: VERSION, recipient: 'other@test.test' }]) {
    assert.equal((await h.route.POST(h.request('POST', body), h.params)).status, 400)
  }
  assert.equal(h.calls.length, 1)
})

test('known conflicts are actionable and unexpected diagnostics are not exposed to users', async () => {
  const h = routeHarness({ error: new Error('TU_SCHEDULE_CONFLICT') })
  const response = await h.route.PATCH(h.request('PATCH', { ...values, expectedUpdatedAt: VERSION }), h.params)
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /Hämta aktuella uppgifter/)
  const oldError = console.error
  console.error = () => {}
  try {
    const failed = routeHarness({ error: new Error('PRIVATE_PROVIDER_DIAGNOSTIC') })
    const response = await failed.route.POST(failed.request('POST', { expectedUpdatedAt: VERSION }), failed.params)
    assert.equal(response.status, 500)
    const body = await response.json()
    assert.match(body.error, /fortfarande sparade/)
    assert.ok(!JSON.stringify(body).includes('PRIVATE_PROVIDER'))
  } finally { console.error = oldError }
})
