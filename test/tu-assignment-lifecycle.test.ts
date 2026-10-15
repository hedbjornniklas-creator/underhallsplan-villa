import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Domain from '../src/lib/tu/assignmentProgress'
import type * as Editing from '../src/lib/tu/assignmentEditing'
import type * as Actions from '../src/lib/tu/assignmentActionsServer'
import type * as Progress from '../src/lib/tu/assignmentProgressServer'
import type * as Route from '../src/app/api/tu/assignments/[id]/actions/route'
import type * as DetailRoute from '../src/app/api/tu/assignments/[id]/route'

function load<T>(path: string, dependencies: Record<string, unknown> = {}): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name] }, compiled, compiled.exports)
  return compiled.exports as T
}
const domain = load<typeof Domain>('src/lib/tu/assignmentProgress.ts')
const editing = load<typeof Editing>('src/lib/tu/assignmentEditing.ts')
const http = load('src/lib/assignment-customers/http.ts', { 'server-only': {} })
const ORG = '11111111-1111-4111-8111-111111111111'
const VERSION = '2026-10-15T08:00:00.000123Z'
const base = (overrides: Partial<Domain.TuProgressAssignment> = {}) => ({
  id: 'assignment', org_id: ORG, updated_at: VERSION, assignment_type: 'TU', status: 'sent' as const,
  customer_email: 'customer@example.test', customer_name: 'Test', scope_description: 'Kontroll', price_amount: 1000,
  accepted_at: null, booked_at: null, inspection_id: null, archived_at: null, last_sent_at: VERSION,
  terms_version: 'v1', terms_document_hash: 'hash', responsible_profile_id: 'inspector',
  progress: { available: true, approvalVerified: false, linkState: 'active' as const, linkExpiresAt: '2099-10-01' }, ...overrides,
})
const approved = () => base({ status: 'ordered', accepted_at: VERSION, progress: { available: true, approvalVerified: true, linkState: 'used', linkExpiresAt: null } })

test('status distinguishes real approval, active links, expired links and missing data', () => {
  assert.equal(domain.tuAssignmentState(base()).label, 'Inväntar kund')
  assert.equal(domain.tuAssignmentState(approved()).label, 'Godkänd av kund')
  assert.equal(domain.tuAssignmentState({ ...approved(), booked_at: VERSION }).label, 'Godkänd och accepterad')
  assert.equal(domain.tuAssignmentState(base({ status: 'ordered', accepted_at: VERSION })).label, 'Godkännande behöver kontrolleras')
  assert.equal(domain.tuAssignmentState(base({ progress: undefined })).label, 'Status behöver hämtas')
  const mismatched = base({ progress: { available: true, approvalVerified: false, approvalRecorded: true, linkState: 'used', linkExpiresAt: null } })
  assert.equal(domain.tuAssignmentState(mismatched).label, 'Godkännande behöver kontrolleras')
  assert.equal(domain.canTuAssignmentAction(mismatched, 'send'), false)
  for (const state of ['missing', 'revoked', 'expired'] as const) {
    const item = base({ progress: { available: true, approvalVerified: false, linkState: state, linkExpiresAt: null } })
    assert.match(domain.tuAssignmentState(item).label, /förnyas|gått ut/)
    assert.equal(domain.tuSendLabel(item), 'Förnya och skicka bekräftelse')
  }
})

test('sent and approved records require a new version for content edits; draft remains editable', () => {
  assert.equal(domain.canEditTuAssignmentDetails(base({ status: 'draft', last_sent_at: null })), true)
  for (const record of [base(), approved(), base({ status: 'draft' }), base({ status: 'draft', archived_at: VERSION })]) assert.equal(domain.canEditTuAssignmentDetails(record), false)
})

test('actions never fabricate approval and archive/restore never reopen a cancelled contract', () => {
  assert.equal(domain.canTuAssignmentAction(base(), 'send'), true)
  assert.equal(domain.canTuAssignmentAction(base({ progress: undefined }), 'send'), false)
  assert.equal(domain.canTuAssignmentAction(approved(), 'send'), false)
  assert.equal(domain.canTuAssignmentAction(base({ status: 'ordered' }), 'book'), false)
  assert.equal(domain.canTuAssignmentAction(approved(), 'book'), true)
  assert.equal(domain.canTuAssignmentAction({ ...approved(), inspection_id: 'inspection' }, 'reissue'), false)
  for (const status of ['sent', 'ordered', 'booked'] as const) assert.equal(domain.canTuAssignmentAction(base({ status }), 'archive'), false)
  const archived = base({ status: 'cancelled', archived_at: VERSION })
  assert.deepEqual(Object.keys(domain.TU_ACTION_LABELS).filter(action => domain.canTuAssignmentAction(archived, action as Domain.TuAssignmentAction)), ['restore'])
})

test('draft edits allow optional object IDs but reject status, approval, date and org changes', () => {
  const body = { expectedUpdatedAt: VERSION, customer_email: 'test@example.test', price_amount: '4500,50', brf_name: '', apartment_number: '', cadastral_id: '' }
  assert.equal(editing.parseTuAssignmentEdit(body).patch.price_amount, 4500.5)
  assert.equal(editing.parseTuAssignmentEdit(body).patch.brf_name, null)
  for (const key of ['status', 'accepted_at', 'org_id', 'preferred_date', 'assignment_type']) assert.throws(() => editing.parseTuAssignmentEdit({ ...body, [key]: 'changed' }))
  for (const change of [{ customer_email: 'bad' }, { customer_email: '' }, { price_amount: '-1' }, { price_amount: 'abc' }, { expectedUpdatedAt: '' }, { scope_description: 12 }]) assert.throws(() => editing.parseTuAssignmentEdit({ ...body, ...change }))
})

function actionHarness(record = base()) {
  const calls: Array<{ name: string; value?: unknown }> = []
  const state = { record, mailFails: false, termsMatch: true, writeConflict: false }
  const server = load<typeof Actions>('src/lib/tu/assignmentActionsServer.ts', {
    'server-only': {}, './assignmentProgress': domain,
    './assignmentProgressServer': { loadTuAssignmentProgress: async (org: string) => { assert.equal(org, ORG); return new Map([[state.record.id, state.record.progress]]) } },
    '@/lib/tu/server': {
      getTuAssignmentById: async (org: string, id: string) => { assert.equal(org, ORG); assert.equal(id, 'assignment'); return state.record },
      requireTuOrganizationProfileCard: async () => ({ companyName: 'Testbolaget', email: 'inspector@example.test' }),
      sendTuAssignmentConfirmation: async () => { calls.push({ name: 'send' }) },
    },
    '@/lib/assignments/terms': { getAssignmentTermsDocument: () => ({ version: state.termsMatch ? 'v1' : 'v2', documentHash: 'hash' }) },
    '@/lib/assignments/server': {
      updateAssignmentById: async (input: { orgId: string; expectedUpdatedAt: string; patch: Record<string, unknown> }) => {
        assert.equal(input.orgId, ORG); assert.equal(input.expectedUpdatedAt, VERSION)
        if (state.writeConflict) throw new Error('ASSIGNMENT_VERSION_CONFLICT')
        calls.push({ name: 'update', value: input.patch }); return { ...state.record, ...input.patch }
      },
      createReissuedAssignmentDraft: async (input: { expectedUpdatedAt: string }) => { assert.equal(input.expectedUpdatedAt, VERSION); calls.push({ name: 'reissue' }); return { draft: { id: 'new-draft' } } },
      sendAssignmentOrderReceipt: async () => { calls.push({ name: 'book-mail' }); if (state.mailFails) throw new Error('private diagnostic') },
      sendAssignmentAcceptedNotice: async () => { calls.push({ name: 'receipt' }) },
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw new Error('Unexpected database access') } },
  })
  const run = (action: Domain.TuAssignmentAction, version = VERSION) => server.runTuAssignmentAction({ orgId: ORG, userId: 'user', assignmentId: 'assignment', expectedUpdatedAt: version, action })
  return { state, calls, run }
}

test('stale snapshot and disallowed state make no writes and send no emails', async () => {
  const h = actionHarness()
  await assert.rejects(h.run('send', 'old'), /VERSION_CONFLICT/)
  await assert.rejects(h.run('book'), /NOT_ALLOWED/)
  assert.equal(h.calls.length, 0)
})
test('sending requires the basic content; creating a new version sends nothing', async () => {
  const h = actionHarness()
  h.state.record.scope_description = ''
  await assert.rejects(h.run('send'), /INCOMPLETE/)
  assert.equal(h.calls.length, 0)
  const result = await h.run('reissue')
  assert.equal('draftId' in result && result.draftId, 'new-draft')
  assert.deepEqual(h.calls.map(call => call.name), ['reissue'])
})
test('accepting an approved job sends one receipt; a write conflict sends none', async () => {
  const h = actionHarness(approved())
  h.state.writeConflict = true
  await assert.rejects(h.run('book'), /VERSION_CONFLICT/)
  assert.equal(h.calls.length, 0)
  h.state.writeConflict = false
  await h.run('book')
  assert.deepEqual(h.calls.map(call => call.name), ['update', 'book-mail'])
})
test('failed receipt does not hide that acceptance was saved; old terms never appear as newly accepted', async () => {
  for (const termsMatch of [true, false]) {
    const h = actionHarness(approved())
    h.state.mailFails = true; h.state.termsMatch = termsMatch
    const result = await h.run('book')
    assert.ok('warning' in result && result.warning)
    assert.deepEqual(h.calls[0], { name: 'update', value: { status: 'booked' } })
    assert.equal(h.calls.some(call => call.name === 'book-mail'), termsMatch)
  }
})
test('cannot re-render a godkännandebekräftelse with different terms', async () => {
  const h = actionHarness(approved()); h.state.termsMatch = false
  await assert.rejects(h.run('receipt'), /COPY_UNAVAILABLE/)
  assert.equal(h.calls.length, 0)
})
test('resending the inspector receipt cannot accept the job a second time', async () => {
  const h = actionHarness({ ...approved(), status: 'booked', booked_at: VERSION })
  await h.run('bookingReceipt')
  assert.deepEqual(h.calls.map(call => call.name), ['book-mail'])
})
test('cancel archives, restore only clears archive; neither sends email', async () => {
  const h = actionHarness()
  await h.run('cancel')
  assert.equal((h.calls[0].value as Record<string, unknown>).status, 'cancelled')
  h.state.record = base({ status: 'cancelled', archived_at: VERSION })
  await h.run('restore')
  assert.deepEqual(h.calls[1].value, { archived_at: null, archived_by: null })
  assert.ok(h.calls.every(call => call.name === 'update'))
})

test('progress is organization-scoped, paginated and verifies actual acceptance', async () => {
  const queries: Array<{ table: string; filters: unknown[][]; range: number[] }> = []
  const server = load<typeof Progress>('src/lib/tu/assignmentProgressServer.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from(table: string) {
      const call = { table, filters: [] as unknown[][], range: [] as number[] }; queries.push(call)
      const query = { select: () => query, order: () => query,
        eq: (...args: unknown[]) => { call.filters.push(args); return query }, in: (...args: unknown[]) => { call.filters.push(args); return query },
        range: async (from: number, to: number) => {
          call.range = [from, to]
          return { error: null, data: table === 'assignment_acceptances' ? [{ assignment_id: 'assignment', accepted_at: VERSION }]
            : from === 0 ? Array.from({ length: 500 }, () => ({ assignment_id: 'other', expires_at: '2099-01-01', used_at: null, revoked_at: null }))
              : [{ assignment_id: 'assignment', expires_at: '2099-01-01', used_at: VERSION, revoked_at: null }] }
        },
      }; return query
    } }) },
  })
  const result = await server.loadTuAssignmentProgress(ORG, [approved()])
  assert.equal(result.get('assignment')?.approvalVerified, true)
  assert.equal(result.get('assignment')?.linkState, 'used')
  assert.equal(queries.filter(call => call.table === 'assignment_links').length, 2)
  assert.ok(queries.every(call => call.filters.some(filter => filter[0] === 'org_id' && filter[1] === ORG)))
})

test('failed status or mail-history reads stay unknown, never empty/successful', async () => {
  const result = { data: null, error: { message: 'test database failure' } }
  const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
    range: async () => result, limit: async () => result }
  const server = load<typeof Progress>('src/lib/tu/assignmentProgressServer.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => query }) },
  })
  const progress = (await server.loadTuAssignmentProgress(ORG, [approved()])).get('assignment')!
  assert.equal(progress.available, false)
  assert.equal(progress.approvalVerified, false)
  assert.equal(await server.loadTuAssignmentMessages(ORG, 'assignment'), null)
})

test('actual TU send path claims the current version before changing links; stale or approved states do not send', async () => {
  const path = 'src/lib/tu/server.ts'
  const source = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.ES2022, true)
  const dependencies: Record<string, unknown> = {}
  for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) dependencies[statement.moduleSpecifier.text] = {}
  const calls: string[] = []
  let conflict = false
  let approvalRecorded = false
  let available = true
  dependencies['@/lib/tu/assignmentProgressServer'] = { loadTuAssignmentProgress: async () => new Map([['assignment', { available, approvalRecorded }]]) }
  dependencies['@/lib/organizations/profileCard'] = { requireConfiguredOrganizationProfileCard: async () => ({ companyName: 'Test', email: 'inspector@example.test' }) }
  dependencies['@/lib/assignments/server'] = {
    updateAssignmentById: async (input: { expectedUpdatedAt: string }) => { assert.equal(input.expectedUpdatedAt, VERSION); if (conflict) throw new Error('ASSIGNMENT_VERSION_CONFLICT'); calls.push('claim'); return { ...base(), updated_at: 'new' } },
    sendAssignmentConfirmation: async (input: { assignment: { updated_at: string } }) => { assert.equal(input.assignment.updated_at, 'new'); calls.push('send') },
  }
  const baseUrlDependency = source.statements.filter(ts.isImportDeclaration).find(statement => statement.getText(source).includes('buildBaseUrl'))!
  const baseUrlPath = (baseUrlDependency.moduleSpecifier as ts.StringLiteral).text
  dependencies[baseUrlPath] = { ...(dependencies[baseUrlPath] as object), buildBaseUrl: () => 'https://example.test' }
  const server = load<{ sendTuAssignmentConfirmation: (input: unknown) => Promise<unknown> }>(path, dependencies)
  const send = (assignment = base()) => server.sendTuAssignmentConfirmation({ assignment, orgName: 'Test', requestedByUserId: 'user' })
  await assert.rejects(send(approved()), /NOT_ALLOWED/)
  approvalRecorded = true
  await assert.rejects(send(), /NOT_ALLOWED/)
  approvalRecorded = false; available = false
  await assert.rejects(send(), /NOT_ALLOWED/)
  available = true
  conflict = true
  await assert.rejects(send(), /VERSION_CONFLICT/)
  assert.equal(calls.length, 0)
  conflict = false
  await send()
  assert.deepEqual(calls, ['claim', 'send'])
})

function actionRoute(error?: Error) {
  const calls: unknown[] = []
  const route = load<typeof Route>('src/app/api/tu/assignments/[id]/actions/route.ts', {
    'next/server': { NextResponse: { json: Response.json } }, '@/lib/tu/assignmentProgress': domain,
    '@/lib/assignment-customers/http': http,
    '@/lib/tu/server': { requireTuContext: async (orgId: string) => { assert.equal(orgId, ORG); return { orgId, userId: 'user' } } },
    '@/lib/tu/assignmentActionsServer': { runTuAssignmentAction: async (input: unknown) => { calls.push(input); if (error) throw error; return { message: 'Klart' } } },
  })
  const post = (body: unknown, origin = 'https://hushub.se', query = `orgId=${ORG}`) => route.POST(new Request(`https://hushub.se/api/tu/assignments/assignment/actions?${query}`, {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: 'assignment' }) })
  return { calls, post }
}
test('action API enforces same-origin, exact organization and strict payloads', async () => {
  const h = actionRoute()
  const body = { action: 'send', expectedUpdatedAt: VERSION }
  assert.equal((await h.post(body, 'https://evil.test')).status, 403)
  assert.equal((await h.post(body, undefined, `orgId=${ORG}&orgId=other`)).status, 400)
  for (const invalid of [null, [], { ...body, action: '__proto__' }, { ...body, orgId: 'other' }, { action: 'send' }]) assert.equal((await h.post(invalid)).status, 400)
  assert.equal(h.calls.length, 0)
  assert.equal((await h.post(body)).status, 200)
  assert.equal(h.calls.length, 1)
})
test('action API returns useful errors, no private diagnostics, and disables caching', async () => {
  for (const [code, status] of [['ASSIGNMENT_VERSION_CONFLICT', 409], ['TU_ACCEPTED_COPY_UNAVAILABLE', 409], ['PRIVATE_SQL_TOKEN', 500]] as const) {
    const response = await actionRoute(new Error(code)).post({ action: 'send', expectedUpdatedAt: VERSION })
    assert.equal(response.status, status)
    assert.match(response.headers.get('Cache-Control')!, /no-store/)
    assert.ok(!(await response.text()).includes(code))
  }
})

test('detail PATCH only writes a version-checked unissued draft and cannot assign a status', async () => {
  let record = base({ status: 'draft', last_sent_at: null })
  const writes: Record<string, unknown>[] = []
  const route = load<typeof DetailRoute>('src/app/api/tu/assignments/[id]/route.ts', {
    'next/server': { NextResponse: { json: Response.json } }, '@/lib/assignment-customers/http': http,
    '@/lib/tu/assignmentProgress': domain, '@/lib/tu/assignmentEditing': editing,
    '@/lib/tu/server': { requireTuContext: async () => ({ orgId: ORG, userId: 'user' }), getTuAssignmentById: async () => record },
    '@/lib/assignments/server': { updateAssignmentById: async (input: Record<string, unknown>) => { writes.push(input); return record } },
    '@/lib/assignments/consumer': {}, '@/lib/assignments/terms': {}, '@/lib/supabase/admin': {}, '@/lib/tu/assignmentProgressServer': {}, '@/lib/assignments/linkIncidents': {},
  })
  const patch = (body: unknown) => route.PATCH(new Request(`https://hushub.se/api/tu/assignments/assignment?orgId=${ORG}`, { method: 'PATCH', headers: { origin: 'https://hushub.se' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'assignment' }) })
  assert.equal((await patch({ expectedUpdatedAt: VERSION, status: 'ordered' })).status, 400)
  assert.equal((await patch({ expectedUpdatedAt: VERSION, scope_description: 'Ny omfattning' })).status, 200)
  assert.equal(writes[0].expectedUpdatedAt, VERSION); assert.equal(writes[0].requireUnissuedDraft, true)
  record = approved()
  assert.equal((await patch({ expectedUpdatedAt: VERSION, scope_description: 'Ny omfattning' })).status, 409)
  assert.equal(writes.length, 1)
})
