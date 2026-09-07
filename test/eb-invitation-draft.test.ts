import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { SaveEbInvitationDraftInput, EbInvitationParticipant, saveEbInvitationDraft } from '../src/lib/eb/server'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText

// Execute the production functions with storage/access boundaries replaced.
// These tests never access Supabase or send email.
function service(dependencies: Record<string, unknown>) {
  const names = ['normalizeText', 'normalizeEmail', 'normalizePartyKey', 'normalizeParticipantInput',
    'participantHasContent', 'isEbInvitationParticipantDraftInput', 'saveEbInvitationDraft']
  const ast = ts.createSourceFile('server.ts', read('src/lib/eb/server.ts'), ts.ScriptTarget.Latest, true)
  const source = ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
      ['PARTY_KEY_VALUES', 'EMAIL_REGEX'].includes(declaration.name.getText(ast))))
  ).map(node => node.getText(ast)).join('\n')
  const bindings = { exports: {}, ...dependencies }
  return new Function(...Object.keys(bindings), `${compile(source)}; return {saveEbInvitationDraft,isEbInvitationParticipantDraftInput}`)(
    ...Object.values(bindings)
  ) as {
    saveEbInvitationDraft: typeof saveEbInvitationDraft
    isEbInvitationParticipantDraftInput: (value: unknown) => boolean
  }
}

const participant = {
  personName: 'Deltagaren', roleLabel: 'Beställare', companyName: null, email: 'person@example.test', phone: null,
  attended: true, receivesInvitation: true, receivesReport: true, representsPartyKey: 'client' as const, canRepresentParty: true,
}
const input = { orgId: 'org', projectId: 'project', inspectionId: 'inspection', requestedByUserId: 'inspector' }

function fixture(initialEmail: Record<string, string | null> = {}) {
  const email: Record<string, string | null> = {
    invitation_subject: null, invitation_body: null, invitation_sent_at: '2026-09-01T09:00:00.000Z',
    invitation_sent_by: 'sender', invitation_message_id: 'message', invitation_method: 'E-post', invitation_date: '2026-09-01',
    ...initialEmail,
  }
  const participantWrites: EbInvitationParticipant[][] = []
  const emailWrites: Array<{ patch: Record<string, string | null>; filters: Array<[string, string]> }> = []
  const settings: { accessError?: string; afterParticipantWrite?: () => void } = {}
  let reads = 0
  const api = service({
    assertEbInspectionEditable: async (scope: typeof input) => {
      assert.deepEqual(scope.orgId, input.orgId)
      if (settings.accessError) throw new Error(settings.accessError)
    },
    replaceInspectionParticipants: async (scope: typeof input & { participants: EbInvitationParticipant[] }) => {
      assert.equal(scope.orgId, input.orgId)
      assert.equal(scope.projectId, input.projectId)
      assert.equal(scope.inspectionId, input.inspectionId)
      participantWrites.push(structuredClone(scope.participants))
      settings.afterParticipantWrite?.()
    },
    getEbInvitationContext: async () => {
      reads += 1
      return { subject: email.invitation_subject ?? 'Genererat ämne', body: email.invitation_body ?? 'Genererad text', participants: [] }
    },
    createSupabaseAdminClient: () => ({ from: (table: string) => {
      assert.equal(table, 'eb_inspection_details')
      return { update: (patch: Record<string, string | null>) => {
        const filters: Array<[string, string]> = []
        const query = {
          eq: (key: string, value: string) => { filters.push([key, value]); return query },
          then: (resolve: (result: { error: null }) => unknown) => {
            emailWrites.push({ patch, filters })
            Object.assign(email, patch)
            return Promise.resolve({ error: null }).then(resolve)
          },
        }
        return query
      } }
    } }),
  })
  return { api, email, participantWrites, emailWrites, settings, reads: () => reads,
    save: (patch: Partial<SaveEbInvitationDraftInput> = {}) => api.saveEbInvitationDraft({ ...input, participants: [participant], ...patch }) }
}

test('participant-only saves preserve raw email fields, including NULL, without an email update or pre-read', async () => {
  for (const original of [{ invitation_subject: null, invitation_body: null },
    { invitation_subject: '  Sparat ämne  ', invitation_body: 'Egen text\n\nMed radbrytning.  ' }]) {
    const f = fixture(original)
    const before = structuredClone(f.email)
    await f.save()
    assert.equal(f.participantWrites.length, 1)
    assert.equal(f.participantWrites[0][0].attended, true)
    assert.deepEqual(f.email, before)
    assert.deepEqual(f.emailWrites, [])
    assert.equal(f.reads(), 1, 'Only the response is read, never used as a save payload')
  }
})

test('a participant save cannot overwrite an invitation saved concurrently', async () => {
  const f = fixture({ invitation_subject: 'Gammalt', invitation_body: 'Gammal text' })
  f.settings.afterParticipantWrite = () => {
    f.email.invitation_subject = 'Nyare ämne'
    f.email.invitation_body = 'Nyare kallelsetext'
    f.email.invitation_sent_at = '2026-09-07T11:00:00.000Z'
  }
  await f.save()
  assert.equal(f.email.invitation_subject, 'Nyare ämne')
  assert.equal(f.email.invitation_body, 'Nyare kallelsetext')
  assert.equal(f.email.invitation_sent_at, '2026-09-07T11:00:00.000Z')
  assert.equal(f.emailWrites.length, 0)
})

test('the existing full invitation editor can save both fields without changing sent metadata', async () => {
  const f = fixture()
  await f.save({ subject: '  Mitt ämne  ', body: '  Min kallelse\nRad två.  ' })
  assert.deepEqual(f.emailWrites, [{ patch: { invitation_subject: 'Mitt ämne', invitation_body: 'Min kallelse\nRad två.' },
    filters: [['org_id', 'org'], ['eb_project_id', 'project'], ['inspection_id', 'inspection']] }])
  assert.equal(f.email.invitation_sent_at, '2026-09-01T09:00:00.000Z')
  assert.equal(f.email.invitation_method, 'E-post')
})

test('an explicitly cleared email field changes only that field; omitted and undefined fields remain untouched', async () => {
  const f = fixture({ invitation_subject: 'Sparat', invitation_body: 'Bevara texten exakt.  ' })
  await f.save({ subject: null, body: undefined })
  assert.deepEqual(f.emailWrites[0].patch, { invitation_subject: null })
  assert.equal(f.email.invitation_body, 'Bevara texten exakt.  ')
})

test('malformed participant payloads are rejected before replacing participants or changing email', async () => {
  for (const participants of [undefined, null, {}, [null], ['row'], [[]], [{}], [{ personName: 123 }],
    [{ personName: 'Deltagare', attended: 'false' }]]) {
    const f = fixture()
    await assert.rejects(() => f.save({ participants } as unknown as Partial<SaveEbInvitationDraftInput>), /INVITATION_PARTICIPANTS_INVALID/)
    assert.equal(f.participantWrites.length, 0)
    assert.equal(f.emailWrites.length, 0)
  }
})

test('autosaving a well-formed blank form row is supported, and an explicit empty list can remove all participants', async () => {
  const f = fixture()
  const blank = { ...participant, personName: '', roleLabel: '', email: '', representsPartyKey: null }
  await f.save({ participants: [participant, blank] })
  assert.equal(f.participantWrites[0].length, 1)
  await f.save({ participants: [] })
  assert.deepEqual(f.participantWrites[1], [])
  assert.equal(f.emailWrites.length, 0)
})

test('lock and scoped access failures stop all draft writes', async () => {
  for (const code of ['EB_REPORT_LOCKED', 'EB_INSPECTION_NOT_FOUND']) {
    const f = fixture()
    f.settings.accessError = code
    await assert.rejects(() => f.save({ subject: 'Ett ämne' }), new RegExp(code))
    assert.equal(f.participantWrites.length, 0)
    assert.equal(f.emailWrites.length, 0)
  }
})

function route() {
  const calls: SaveEbInvitationDraftInput[] = []
  const ast = ts.createSourceFile('route.ts', read('src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/invitation/route.ts'), ts.ScriptTarget.Latest, true)
  const source = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n')
  const bindings = {
    exports: {}, NextResponse: { json: Response.json },
    requireModuleAccess: async () => undefined, requireOrgContext: async () => ({ orgId: 'org', userId: 'inspector' }),
    isEbInvitationParticipantDraftInput: fixture().api.isEbInvitationParticipantDraftInput,
    saveEbInvitationDraft: async (payload: SaveEbInvitationDraftInput) => { calls.push(payload); return {} },
  }
  const patch = new Function(...Object.keys(bindings), `${compile(source)}; return PATCH`)(...Object.values(bindings)) as
    (request: Request, context: { params: Promise<{ projectId: string; inspectionId: string }> }) => Promise<Response>
  return { calls, patch: (body: unknown, raw = false) => patch(new Request('https://example.test/invitation', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: raw ? String(body) : JSON.stringify(body),
  }), { params: Promise.resolve({ projectId: 'project', inspectionId: 'inspection' }) }) }
}

test('PATCH requires a valid participant array and never forwards malformed requests as an empty list', async () => {
  const r = route()
  for (const body of [null, [], {}, { participants: null }, { participants: {} }, { participants: [null] },
    { participants: [{ personName: 10 }] }, { participants: [participant], subject: 10 }]) {
    assert.equal((await r.patch(body)).status, 400)
  }
  assert.equal((await r.patch('{', true)).status, 400)
  assert.equal(r.calls.length, 0)
})

test('PATCH forwards only explicitly supplied email fields and accepts blank form rows', async () => {
  const r = route()
  assert.equal((await r.patch({ participants: [participant, { personName: '' }] })).status, 200)
  assert.equal(Object.hasOwn(r.calls[0], 'subject'), false)
  assert.equal(Object.hasOwn(r.calls[0], 'body'), false)
  assert.equal((await r.patch({ participants: [], subject: null, body: 'Ny text' })).status, 200)
  assert.equal(r.calls[1].subject, null)
  assert.equal(r.calls[1].body, 'Ny text')
})
