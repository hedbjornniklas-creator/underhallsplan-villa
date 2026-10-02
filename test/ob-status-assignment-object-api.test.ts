import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
function load(path: string, deps: Record<string, unknown>): Record<string, (...args: any[]) => any> {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name in deps) return deps[name]
    throw Error('Unexpected dependency: ' + name)
  }, module, module.exports)
  return module.exports
}
const objectType = load('src/lib/ob/objectType.ts', {})
const json = (payload: unknown, options?: { status?: number }) => ({ status: options?.status ?? 200, payload })
const request = (body: unknown) => new Request('http://localhost/api/ob/assignments', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
function harness(path: string, existing: Record<string, unknown> = {}) {
  const created: any[] = [], updated: any[] = []
  const assignment = { id: 'assignment', status: 'draft', assignment_type: 'STATUS', accepted_at: null,
    last_sent_at: null, assignment_details: { statusCancellationFee: 0, unrelated: 'preserve' }, ...existing }
  const server = {
    requireOrgContext: async () => ({ orgId: 'org', userId: 'actor', orgName: 'Org' }),
    createAssignment: async (input: unknown) => { created.push(input); return { ...assignment, responsible_profile_id: 'actor' } },
    getAssignmentById: async () => assignment,
    updateAssignmentById: async (input: any) => { updated.push(input); return { ...assignment, ...input.patch } },
    getProfileContact: async () => ({ email: 'inspector@example.test' }),
    sendAssignmentConfirmation: async () => ({ acceptUrl: 'http://localhost/accept/test', expiresAt: null }),
    sendAssignmentOrderReceipt: async () => ({}),
    buildBaseUrl: () => 'http://localhost',
    isMissingEnvError: () => false,
    AssignmentEmailSendError: class extends Error {},
  }
  const route = load(path, {
    'next/server': { NextResponse: { json } },
    '@/lib/assignments/server': server,
    '@/lib/assignments/linkIncidents': { listAssignmentLinkIssues: async () => ({ available: true, items: [] }) },
    '@/lib/ob/objectType': objectType,
  })
  return { route, server, created, updated }
}
const draftPath = 'src/app/api/ob/assignments/route.ts'
const patchPath = 'src/app/api/ob/assignments/[id]/route.ts'
const quickPath = 'src/app/api/ob/assignments/quick-send/route.ts'
const valid = { assignmentType: 'STATUS', ordererRole: 'Statusbesiktning', customerEmail: 'test@example.test',
  objectType: 'apartment', apartmentNumber: '1202', statusCancellationFee: 0, scopeDescription: 'Badrum', priceAmount: 1000 }
const context = { params: Promise.resolve({ id: 'assignment' }) }

for (const path of [draftPath, quickPath]) {
  test(`${path}: status apartment keeps profile, object type and apartment fields`, async () => {
    const h = harness(path)
    const result = await h.route.POST(request(valid))
    assert.ok(result.status < 300)
    assert.equal(h.created.length, 1)
    assert.equal(h.created[0].assignmentType, 'STATUS')
    assert.equal(h.created[0].ordererRole, 'Statusbesiktning')
    assert.deepEqual(h.created[0].assignmentDetails, { statusCancellationFee: 0, objectType: 'apartment' })
    assert.equal(h.created[0].apartmentNumber, '1202')
    assert.equal(h.created[0].brfName, null)
    assert.equal(h.created[0].apartmentHolderName, null)
  })
  test(`${path}: invalid status object type is rejected`, async () => {
    const h = harness(path)
    assert.equal((await h.route.POST(request({ ...valid, objectType: 'villa' }))).status, 400)
    assert.equal(h.created.length, 0)
  })
  test(`${path}: ordinary apartment OB is not reclassified`, async () => {
    const h = harness(path)
    assert.ok((await h.route.POST(request({ ...valid, assignmentType: 'OB', ordererRole: 'Lägenhet', objectType: undefined }))).status < 300)
    assert.equal(h.created[0].assignmentType, 'OB')
    assert.equal(h.created[0].ordererRole, 'Lägenhet')
    assert.equal(h.created[0].assignmentDetails, undefined)
  })
}
test('new status draft may defer object choice, quick-send may not', async () => {
  const draft = harness(draftPath), quick = harness(quickPath)
  assert.equal((await draft.route.POST(request({ ...valid, objectType: null }))).status, 201)
  assert.equal(draft.created[0].assignmentDetails.objectType, null)
  assert.equal((await quick.route.POST(request({ ...valid, objectType: null }))).status, 400)
  assert.equal(quick.created.length, 0)
})
test('status PATCH merges object type and fee without dropping unrelated details', async () => {
  const h = harness(patchPath)
  assert.equal((await h.route.PATCH(request({ objectType: 'apartment', statusCancellationFee: 125, apartment_number: '1401' }), context)).status, 200)
  assert.deepEqual(h.updated[0].patch.assignment_details, { statusCancellationFee: 125, unrelated: 'preserve', objectType: 'apartment' })
  assert.equal(h.updated[0].patch.apartment_number, '1401')
  assert.equal(h.updated[0].patch.orderer_role, 'Statusbesiktning')
})
test('status PATCH rejects invalid objects, but old OB PATCH ignores status-only object type', async () => {
  const status = harness(patchPath), ob = harness(patchPath, { assignment_type: 'OB' })
  assert.equal((await status.route.PATCH(request({ objectType: 'villa' }), context)).status, 400)
  assert.equal(status.updated.length, 0)
  assert.equal((await ob.route.PATCH(request({ objectType: 'apartment', notes_internal: 'unchanged OB semantics' }), context)).status, 200)
  assert.equal(ob.updated[0].patch.assignment_details, undefined)
})
for (const existing of [
  { status: 'sent' }, { status: 'completed' }, { status: 'cancelled', last_sent_at: '2026-10-02' },
  { status: 'draft', accepted_at: '2026-10-02' },
]) {
  test(`issued status object cannot change: ${JSON.stringify(existing)}`, async () => {
    const h = harness(patchPath, existing)
    assert.equal((await h.route.PATCH(request({ objectType: 'apartment' }), context)).status, 409)
    assert.equal(h.updated.length, 0)
  })
}
test('quick-send maps deployment preflight errors without silently issuing', async () => {
  const h = harness(quickPath)
  h.server.sendAssignmentConfirmation = async () => { throw Error('STATUS_OBJECT_TYPE_NOT_CONFIGURED') }
  assert.equal((await h.route.POST(request(valid))).status, 503)
})
for (const code of ['OB_STATUS_OBJECT_AGREEMENT_LOCKED', 'OB_STATUS_PROFILE_AGREEMENT_LOCKED']) {
  test(`partially issued draft maps database guard ${code} to an actionable conflict`, async () => {
    const h = harness(patchPath)
    h.server.updateAssignmentById = async () => { throw Error(code) }
    const body = code === 'OB_STATUS_OBJECT_AGREEMENT_LOCKED' ? { objectType: 'apartment' } : { assignment_type: 'OB' }
    const result = await h.route.PATCH(request(body), context)
    assert.equal(result.status, 409)
    assert.match(result.payload.error, /redan utfärdad uppdragsbekräftelse/)
    assert.match(result.payload.error, /Skapa en ny uppdragsbekräftelse/)
    assert.equal(h.updated.length, 0)
  })
}
