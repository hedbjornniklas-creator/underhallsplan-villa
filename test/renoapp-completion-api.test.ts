import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import type * as UploadRoute from '../src/app/api/renoapp/case-access/[token]/documents/route'
import type * as PublicRoute from '../src/app/api/renoapp/public/applications/route'
import type * as DocumentRoute from '../src/app/api/renoapp/app/cases/[id]/documents/[documentId]/route'
import type { CreatePublicApplicationInput, RenoAppCaseMessage, UpdateRenoAppCaseStatusInput, upsertPublicApplication } from '../src/lib/renoapp/server'
import type { CompletionRequest } from '../src/lib/renoapp/completion'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', compile(read(path)))((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('node:') || name === 'next/server') return require(name)
    throw new Error(`Unexpected dependency ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
// Exercise the real orchestration functions without network, credentials or email delivery.
function serviceFunction<T>(names: string[], dependencies: Record<string, unknown>): T {
  const ast = ts.createSourceFile('server.ts', read('src/lib/renoapp/server.ts'), ts.ScriptTarget.Latest, true)
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(functions.length, names.length)
  const code = functions.map(node => node.getText(ast)).join('\n')
  return new Function(...Object.keys(dependencies), `${compile(code)};return ${names[0]}`)(...Object.values(dependencies)) as T
}
const common = load<typeof import('../src/lib/renoapp/completion')>('src/lib/renoapp/completion.ts', {})
const clarifications = load<typeof import('../src/lib/renoapp/clarifications')>('src/lib/renoapp/clarifications.ts', {})
const templates = load<Record<string, unknown>>('src/lib/renoapp/emailTemplate.ts', {})

function boardDecisionFixture(currentStatus = 'review', authorized = true) {
  const writes: Array<{ table: string; value: Record<string, unknown> }> = []
  const messages: Array<Record<string, unknown>> = []
  const detail = { id: 'case', status: currentStatus, clarifications: [{ state: 'pending' }] }
  const admin = { from(table: string) {
    return {
      select() { return { eq() { return { maybeSingle: async () => ({ error: null,
        data: { id: 'case', brf_id: 'brf', status: currentStatus },
      }) } } } },
      update(value: Record<string, unknown>) { return { eq: async () => {
        writes.push({ table, value }); return { error: null }
      } } },
      async insert(value: Record<string, unknown>) { writes.push({ table, value }); return { error: null } },
    }
  } }
  const service = serviceFunction<typeof import('../src/lib/renoapp/server').updateRenoAppCaseStatus>(
    ['updateRenoAppCaseStatus', 'normalizeText'], {
      exports: {}, createSupabaseAdminClient: () => admin,
      requireRenoAppViewerContext: async () => ({ profile: { id: 'actor' }, authorizedBrfIds: authorized ? ['brf'] : ['another-brf'] }),
      getRenoAppCaseDetail: async () => detail,
      insertCaseMessage: async (message: Record<string, unknown>) => { messages.push(message) },
      publishRenoAppCompletion: async () => detail,
    })
  return { writes, messages, detail, submit: (input: UpdateRenoAppCaseStatusInput) => service('case', input) }
}

test('every board decision requires a nonblank reason before any write; conditional also requires conditions', async () => {
  for (const status of ['approved', 'conditional', 'rejected'] as const) {
    for (const reason of [undefined, null, '', ' \n\t ']) {
      const f = boardDecisionFixture()
      await assert.rejects(f.submit({ status, reason, conditions: 'Conditions' }), /DECISION_REASON_REQUIRED/)
      assert.deepEqual(f.writes, [])
    }
  }
  const f = boardDecisionFixture()
  await assert.rejects(f.submit({ status: 'conditional', reason: 'Board assessment', conditions: ' ' }), /DECISION_CONDITIONS_REQUIRED/)
  assert.deepEqual(f.writes, [])
})

test('approval preserves open questions and saves the reason separately from conditions', async () => {
  for (const status of ['approved', 'conditional', 'rejected'] as const) {
    const f = boardDecisionFixture('need_info')
    await f.submit({ status, reason: ' Board assessment ', conditions: status === 'conditional' ? 'Before starting' : null })
    assert.deepEqual(f.writes[0], { table: 'renovation_cases', value: { status } })
    assert.equal(f.writes[1].table, 'renovation_case_decisions')
    assert.equal(f.writes[1].value.reason, 'Board assessment')
    assert.equal(f.writes[1].value.conditions, status === 'conditional' ? 'Before starting' : null)
    assert.equal(f.writes.length, 2)
    assert.deepEqual(f.detail.clarifications, [{ state: 'pending' }])
    assert.match(String(f.messages[0].message), /Board assessment/)
    if (status === 'conditional') assert.match(String(f.messages[0].message), /Before starting/)
  }
})

test('draft and cross-association protections remain; requesting completion does not require a decision reason', async () => {
  for (const status of ['approved', 'conditional', 'rejected'] as const) {
    const draft = boardDecisionFixture('draft')
    await assert.rejects(draft.submit({ status, reason: 'Reason', conditions: 'Conditions' }), /DRAFT_CASE_LOCKED/)
    assert.deepEqual(draft.writes, [])
  }
  const other = boardDecisionFixture('review', false)
  await assert.rejects(other.submit({ status: 'approved', reason: 'Reason' }), /CASE_NOT_FOUND/)
  assert.deepEqual(other.writes, [])
  const f = boardDecisionFixture()
  await f.submit({ status: 'need_info' })
  assert.deepEqual(f.writes, [])
})

test('decision API returns a neutral required-reason error for approval and preserves the supplied reason', async () => {
  let input: UpdateRenoAppCaseStatusInput | undefined
  const route = load<typeof import('../src/app/api/renoapp/app/cases/[id]/route')>(
    'src/app/api/renoapp/app/cases/[id]/route.ts', {
      '@/lib/renoapp/server': { updateRenoAppCaseStatus: async (_id: string, body: UpdateRenoAppCaseStatusInput) => {
        input = body
        if (!body.reason?.trim()) throw new Error('DECISION_REASON_REQUIRED')
        return { id: 'case' }
      } },
      '@/lib/renoapp/completion': common, '@/lib/renoapp/clarifications': clarifications,
    })
  for (const reason of ['', 'Assessment']) {
    const response = await route.POST(new Request('https://example.test/api/renoapp/app/cases/case', {
      method: 'POST', body: JSON.stringify({ status: 'conditional', reason, conditions: 'Conditions' }),
    }), { params: Promise.resolve({ id: 'case' }) })
    assert.equal(response.status, reason ? 200 : 400)
    assert.equal(input?.reason, reason)
    if (!reason) assert.deepEqual(await response.json(), { error: 'Motivering krävs för beslutet.' })
  }
})

function confirmationFixture(status: 'new' | 'draft' | 'need_info', requestedRoles = ['plumber']) {
  const form = {
    applicantName: 'Applicant', applicantEmail: 'applicant@example.test', applicantPhone: '0700000000',
    unitNumberInternal: '1', unitNumberSkatteverket: '1101', description: 'Wall removal',
    actionTypeKeys: ['wall'], questionAnswers: { plumbing: ['yes'] },
    contractorName: '', contractorOrgNumber: '', contractorEmail: '', contractorPhone: '', contractorHasRequiredCertification: false,
    participantEntries: [] as NonNullable<CreatePublicApplicationInput['participantEntries']>,
  }
  const input: CreatePublicApplicationInput = { ...form, brfSlug: 'test', mode: 'submit',
    draftToken: status === 'new' ? null : 'secret', completionRequestId: 'round', completionRevision: 0 }
  const calls: string[] = []
  const persist = async (kind: string) => { calls.push(kind); throw new Error(`REACHED_${kind}`) }
  const admin = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, in: () => query,
      maybeSingle: async () => ({ error: null, data: table === 'case_access_links'
        ? { case_id: 'case', expires_at: '2099-01-01', revoked_at: null }
        : { id: 'case', brf_id: 'brf', status, case_number: 'RA-TEST' } }),
      then: (done: (value: unknown) => unknown) => done({ error: null, data: [{ participant_role_id: 'builder' }] }),
    }
    return query
  } }
  const service = serviceFunction<typeof upsertPublicApplication>([
    'upsertPublicApplication', 'normalizeText', 'normalizeEmail', 'normalizeMachineKey', 'assertValidEmail',
    'canonicalStringSet', 'canonicalQuestionAnswers', 'canonicalParticipantEntry',
  ], {
    exports: {}, EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    createSupabaseAdminClient: () => admin, hashToken: (token: string) => token,
    getPublicBrfBySlug: async () => ({ id: 'brf', slug: 'test', is_public_apply_enabled: true }),
    loadActiveActionTypesByKeys: async () => [{ id: 'wall', key: 'wall' }],
    listActiveApplyQuestions: async () => ({ questions: [], options: [], links: [], triggers: [] }),
    buildContractorRequirementSummary: () => [], requiresQualifiedContractor: () => false,
    resolveApplicableQuestionsForSelection: () => [{ id: 'plumbing', key: 'plumbing', options: [{ key: 'yes', triggers: [{ triggerType: 'participant_role', participantRoleId: 'plumber' }] }] }],
    getPublishedRules: async () => null, rulesAcceptanceFields: () => ({}),
    getPublicApplicationDraftByToken: async () => ({ state: 'open', case: { id: 'case' }, form,
      completionRequest: { id: 'round', requestedParticipants: requestedRoles.map(participantRoleId => ({ participantRoleId })) } }),
    upsertPublicApplicationContact: () => persist('INITIAL_SAVE'),
    saveCompletion: () => persist('COMPLETION_SAVE'), buildAbsoluteUrl: (origin: string, path: string) => origin + path,
  })
  return { input, form, calls, save: () => service(input, 'https://example.test') }
}

test('new applications and resumed initial drafts reach persistence without confirming suggested companies', async () => {
  for (const status of ['new', 'draft'] as const) {
    const f = confirmationFixture(status)
    // Both action-linked and answer-triggered companies are suggested, not yet requested by the board.
    await assert.rejects(f.save(), /REACHED_INITIAL_SAVE/)
    assert.deepEqual(f.calls, ['INITIAL_SAVE'])
  }
})

test('completion submission still requires both confirmations for every company in the sent request', async () => {
  for (const flags of [null, [false, false], [true, false], [false, true]]) {
    const f = confirmationFixture('need_info')
    f.input.participantEntries = flags ? [{ participantRoleId: 'plumber', hasVerifiedAuthorization: flags[0], acceptsResponsibility: flags[1] }] : []
    await assert.rejects(f.save(), /PARTICIPANT_CONFIRMATION_REQUIRED/)
    assert.deepEqual(f.calls, [])
  }
  const confirmed = confirmationFixture('need_info')
  confirmed.input.participantEntries = [{ participantRoleId: 'plumber', hasVerifiedAuthorization: true, acceptsResponsibility: true }]
  await assert.rejects(confirmed.save(), /REACHED_COMPLETION_SAVE/)
})

test('document-only completions and completion drafts do not require company confirmations', async () => {
  const documentsOnly = confirmationFixture('need_info', [])
  await assert.rejects(documentsOnly.save(), /REACHED_COMPLETION_SAVE/)
  const draft = confirmationFixture('need_info')
  draft.input.mode = 'draft'
  await assert.rejects(draft.save(), /REACHED_COMPLETION_SAVE/)
})

test('unrequested existing companies need no new confirmation and remain protected from edits', async () => {
  const f = confirmationFixture('need_info')
  const unrequested = { participantRoleId: 'builder', companyName: 'Original builder', hasVerifiedAuthorization: false, acceptsResponsibility: false }
  f.form.participantEntries = [unrequested]
  f.input.participantEntries = [unrequested, { participantRoleId: 'plumber', hasVerifiedAuthorization: true, acceptsResponsibility: true }]
  await assert.rejects(f.save(), /REACHED_COMPLETION_SAVE/)
  f.input.participantEntries[0] = { ...unrequested, companyName: 'Changed builder' }
  await assert.rejects(f.save(), /COMPLETION_BASE_FIELDS_LOCKED/)
})

test('board history contains sent requests and applicant replies, without deleting the full event log', async () => {
  const message = (id: string, type = 'request_for_info', authorRole = 'board', text = id) => ({
    id, case_id: 'case', type, author_role: authorRole, message: text, created_at: '2026-09-07',
    author_profile_id: authorRole === 'board' ? 'board' : null,
    author_contact_id: authorRole === 'applicant' ? 'applicant' : null,
  })
  const tables: Record<string, Array<Record<string, unknown>>> = {
    renovation_case_messages: [message('sent-new'), message('reply', 'applicant_reply', 'applicant'), message('sent-old'),
      message('failed'), message('pending'), message('legacy-unknown'), message('empty', 'request_for_info', 'board', '  '),
      message('empty-reply', 'applicant_reply', 'applicant', ''), message('internal', 'status_change'),
      message('upload', 'document_uploaded'), message('decision', 'decision'), { ...message('other-case'), case_id: 'other' }],
    renoapp_completion_requests: [
      { id: 'sent-new', case_id: 'case', delivery_status: 'sent' }, { id: 'sent-old', case_id: 'case', delivery_status: 'sent' },
      { id: 'failed', case_id: 'case', delivery_status: 'failed' }, { id: 'pending', case_id: 'case', delivery_status: 'pending' },
      { id: 'empty', case_id: 'case', delivery_status: 'sent' }, { id: 'other-case', case_id: 'other', delivery_status: 'sent' },
    ],
    profiles: [{ id: 'board', full_name: 'Board Person' }], contacts: [{ id: 'applicant', name: 'Applicant Person' }],
  }
  let failDeliveryRead = false
  const admin = { from: (table: string) => {
    let rows = tables[table]
    assert.ok(rows, `Unexpected table ${table}`)
    const query = {
      select: () => query, order: () => query,
      eq: (column: string, value: unknown) => { rows = rows.filter(row => row[column] === value); return query },
      in: (column: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[column])); return query },
      then: (done: (value: unknown) => unknown) => done({ data: rows, error: table === 'renoapp_completion_requests' && failDeliveryRead ? { message: 'Delivery read failed' } : null }),
    }
    return query
  } }
  const list = serviceFunction<(admin: object, caseId: string, options?: { sentOnly?: boolean }) => Promise<RenoAppCaseMessage[]>>(
    ['listCaseMessages', 'mapCaseMessage'], {}
  )
  const sent = await list(admin, 'case', { sentOnly: true })
  assert.deepEqual(sent.map(row => row.id), ['sent-new', 'reply', 'sent-old'])
  assert.deepEqual(sent.map(row => row.authorName), ['Board Person', 'Applicant Person', 'Board Person'])
  assert.equal((await list(admin, 'case')).length, 11)
  tables.renoapp_completion_requests.find(row => row.id === 'failed')!.delivery_status = 'sent'
  assert.deepEqual((await list(admin, 'case', { sentOnly: true })).map(row => row.id), ['sent-new', 'reply', 'sent-old', 'failed'])
  failDeliveryRead = true
  await assert.rejects(list(admin, 'case', { sentOnly: true }), /Delivery read failed/)
})

test('failed completion email stays visible; retry sends the same snapshot and does not duplicate history', async () => {
  const requestId = randomUUID(), sent: Array<{ html: string; text: string; idempotencyKey: string }> = []
  let request: CompletionRequest | null = null, publications = 0, failMail = true
  const underlag = [
    { id: 'document:drawing', category: 'document', label: 'Received drawing', checked: true, requirementDecision: 'requested' },
    { id: 'participant:plumber', category: 'participant', label: 'Plumber', checked: false, requirementDecision: 'requested' },
  ]
  const admin = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      publications++
      request = { id: requestId, case_id: 'case', items: args.p_items, message: args.p_message,
        created_at: new Date().toISOString(), submitted_at: null, revision: 0, draft: {}, delivery_status: 'pending', delivery_error: null,
      } as CompletionRequest
      return { error: null }
    },
    from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { email: 'board@example.test' } }),
        update: (values: object) => { assert.equal(table, 'renoapp_completion_requests'); Object.assign(request!, values); return query },
      }
      return query
    },
  }
  const publish = serviceFunction<(id: string, input: UpdateRenoAppCaseStatusInput, actor: string, status: string) => Promise<{ completion: CompletionRequest }>>(['publishRenoAppCompletion'], {
    getRenoAppCaseDetail: async () => ({ id: 'case', caseNumber: 'RA-TEST', underlag,
      applicant: { name: 'Test <Person>', email: 'applicant@example.test' }, brf: { id: 'brf', name: 'Test BRF', slug: 'test' }, completion: request }),
    getLatestCompletion: async () => request, createSupabaseAdminClient: () => admin,
    ...common, ...clarifications, ...templates, canonicalStringSet: (values: string[]) => [...new Set(values)].sort().join(','),
    getMailFromAddress: () => 'Hushub <noreply@example.test>', ensureReusableCaseAccessToken: async () => 'same-token',
    buildAbsoluteUrl: (origin: string, path: string) => new URL(path, origin).toString(),
    escapeHtml: (value: string) => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    sendAssignmentEmail: async (input: typeof sent[number]) => { sent.push(input); if (failMail) throw new Error('Simulated provider failure'); return { providerMessageId: 'test-provider-id' } },
    console: { error: () => {} },
  })
  const input: UpdateRenoAppCaseStatusInput = { status: 'need_info', completionRequestId: requestId,
    previousCompletionId: null, selectedRequirementIds: underlag.map(row => row.id), requestOrigin: 'https://example.test' }
  const failed = await publish('case', input, 'actor', 'review')
  assert.equal(failed.completion.delivery_status, 'failed')
  assert.ok(failed.completion.delivery_error)
  assert.deepEqual(failed.completion.items.map(item => item.id), ['participant:plumber'])
  assert.equal(publications, 1)
  failMail = false
  const retried = await publish('case', { ...input, retryCompletion: true }, 'actor', 'need_info')
  assert.equal(retried.completion.delivery_status, 'sent')
  assert.equal(retried.completion.provider_message_id, 'test-provider-id')
  assert.equal(publications, 1)
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[0], sent[1])
  assert.match(sent[0].html, /same-token/)
  assert.doesNotMatch(sent[0].text, /Received drawing/)
  await publish('case', { ...input, retryCompletion: true }, 'actor', 'need_info')
  assert.equal(sent.length, 2)
  await assert.rejects(publish('case', { ...input, retryCompletion: true, completionRequestId: randomUUID() }, 'actor', 'need_info'), /COMPLETION_CHANGED/)
})

test('reusing an applicant link renews expiration and never revives a revoked token', async () => {
  let existing: object | null = { id: 'link', token: 'same-token', email: 'applicant@example.test' }
  const writes: Array<{ expires_at: string }> = [], filters: unknown[] = []
  const admin = { from: () => ({ update: (values: { expires_at: string }) => {
    writes.push(values)
    return { eq: () => ({ is: (...args: unknown[]) => { filters.push(args); return { select: () => ({ maybeSingle: async () => ({ data: { id: 'link' }, error: null }) }) } } }) }
  } }) }
  const renew = serviceFunction<(input: object) => Promise<string>>(['ensureReusableCaseAccessToken'], {
    findReusableCaseAccessToken: async () => existing,
    createCaseAccessToken: async () => ({ token: 'new-token' }),
  })
  assert.equal(await renew({ admin, caseId: 'case' }), 'same-token')
  assert.ok(Date.parse(writes[0].expires_at) > Date.now() + 13 * 86400000)
  assert.deepEqual(filters, [['revoked_at', null]])
  existing = null
  assert.equal(await renew({ admin, caseId: 'case' }), 'new-token')
})

test('applicant API passes the round and revision and returns reloadable conflicts', async () => {
  let input: Record<string, unknown> = {}
  let conflict = false
  const route = load<typeof PublicRoute>('src/app/api/renoapp/public/applications/route.ts', {
    '@/lib/renoapp/server': { upsertPublicApplication: async (value: typeof input) => { input = value; if (conflict) throw new Error('COMPLETION_DRAFT_CHANGED'); return { completionRevision: 4 } } },
    '@/lib/renoapp/completion': common, '@/lib/renoapp/renovationRules': { RULES_ERRORS: {} },
    '@/lib/renoapp/clarifications': clarifications,
  })
  const request = () => new Request('https://example.test/apply', { method: 'POST', body: JSON.stringify({ mode: 'draft', completionRequestId: 'round', completionRevision: 3, replyMessage: 'Saved reply' }) })
  assert.equal((await route.POST(request())).status, 201)
  assert.equal(input.completionRequestId, 'round')
  assert.equal(input.completionRevision, 3)
  assert.equal(input.replyMessage, 'Saved reply')
  conflict = true
  const response = await route.POST(request())
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'COMPLETION_DRAFT_CHANGED')
})

test('clarification API validates input and returns assessment conflicts without leaking errors', async () => {
  let calls = 0
  let failure = ''
  const route = load<typeof import('../src/app/api/renoapp/app/cases/[id]/clarifications/route')>('src/app/api/renoapp/app/cases/[id]/clarifications/route.ts', {
    '@/lib/renoapp/clarifications': clarifications,
    '@/lib/renoapp/server': { reviewRenoAppClarification: async () => { calls++; if (failure) throw new Error(failure); return { id: 'case' } } },
  })
  const post = (body: unknown) => route.POST(new Request('https://example.test/clarifications', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'case' }) })
  const valid = { questionId: randomUUID(), revision: 0, action: 'resolve', note: 'Checked' }
  for (const invalid of [null, {}, { ...valid, revision: -1 }, { ...valid, note: 'x'.repeat(4001) }, { ...valid, action: 'approve' }]) assert.equal((await post(invalid)).status,400)
  assert.equal(calls,0)
  assert.equal((await post(valid)).status,200)
  for (const [code, status] of [['UNAUTHORIZED',401],['CASE_NOT_FOUND',404],['CLARIFICATION_CHANGED',409],['CLARIFICATION_REVIEW_REQUIRED',409],['secret database error',500]] as const) {
    failure = code
    const response = await post(valid)
    assert.equal(response.status,status)
    assert.doesNotMatch(JSON.stringify(await response.json()), /secret database/)
  }
})

test('clarification assessment authorizes the case before any database mutation', async () => {
  let allowed = false, mutations = 0
  const service = serviceFunction<(id:string,input:object) => Promise<unknown>>(['reviewRenoAppClarification'], {
    exports: {}, requireRenoAppViewerContext: async () => ({ authorizedBrfIds:['allowed'], profile:{id:'actor'} }),
    getRenoAppCaseDetail: async () => ({ brf: { id: allowed ? 'allowed' : 'other' } }),
    createSupabaseAdminClient: () => ({ rpc: async () => { mutations++; return { error:null } } }),
  })
  const input = {questionId:randomUUID(),revision:0,action:'request',note:''}
  await assert.rejects(service('case',input), /CASE_NOT_FOUND/)
  assert.equal(mutations,0)
  allowed = true
  await service('case',input)
  assert.equal(mutations,1)
})

test('public API passes clarification drafts separately from locked base answers', async () => {
  let saved: Record<string, unknown> | null = null
  const route = load<typeof PublicRoute>('src/app/api/renoapp/public/applications/route.ts', {
    '@/lib/renoapp/server': { upsertPublicApplication: async (value: Record<string, unknown>) => { saved=value; return {} } },
    '@/lib/renoapp/completion':common, '@/lib/renoapp/renovationRules':{RULES_ERRORS:{}}, '@/lib/renoapp/clarifications':clarifications,
  })
  const answers = { [randomUUID()]:{optionId:randomUUID(),note:'Investigated'} }
  const post = (clarificationAnswers:unknown) => route.POST(new Request('https://example.test/apply',{method:'POST',body:JSON.stringify({questionAnswers:{original:['needs_investigation']},clarificationAnswers})}))
  assert.equal((await post(answers)).status,201)
  assert.deepEqual(saved?.['clarificationAnswers'],answers)
  assert.deepEqual(saved?.['questionAnswers'],{original:['needs_investigation']})
  assert.equal((await post({bad:'value'})).status,400)
})

test('a clarified answer recalculates existing document suggestions without requesting them automatically', () => {
  const build = serviceFunction<(input:object) => Array<{id:string;requirementDecision:string|null;suggestionSources:Array<{answerLabel:string}>}>>(
    ['buildCaseUnderlagItems','resolveApplicableQuestionsForSelection'], {})
  const configuration = {
    selectedActionTypes:[{id:'wall',label:'Riva vägg'}], requirements:[],
    questionConfig:{
      questions:[{id:'municipal',key:'municipal',label:'Kommunens besked?',response_type:'single_select',sort_order:10}],
      options:[{id:'unknown',question_id:'municipal',key:'needs_investigation',label:'Undersöka',sort_order:10},{id:'yes',question_id:'municipal',key:'yes',label:'Ja',sort_order:20}],
      links:[{action_type_id:'wall',question_id:'municipal',is_required:true,sort_order:10}],
      triggers:[{id:'trigger',option_id:'yes',trigger_type:'document',document_type_id:'startbesked',sort_order:10}],
    },
    documentTypes:[{id:'startbesked',label:'Startbesked',key:'startbesked'}],documents:[],participantRows:[],
    participantRoles:[],actionTypeParticipantRoles:[],requirementDecisions:[],
  }
  assert.deepEqual(build({...configuration,questionAnswerRows:[{question_id:'municipal',option_id:'unknown'}]}),[])
  const clarified=build({...configuration,questionAnswerRows:[{question_id:'municipal',option_id:'yes'}]})
  assert.equal(clarified[0].id,'document:startbesked')
  assert.equal(clarified[0].requirementDecision,null)
  assert.equal(clarified[0].suggestionSources[0].answerLabel,'Ja')
})

test('a concurrent round change must not remove storage before the guarded delete succeeds', async () => {
  const calls: string[] = []
  const route = load<typeof UploadRoute>('src/app/api/renoapp/case-access/[token]/documents/route.ts', {
    '@/lib/renoapp/server': { getCaseAccessByToken: async () => ({ state: 'open', case: { id: 'case', status: 'need_info' }, access: { allowedActions: ['upload_documents'] } }) },
    '@/lib/renoapp/completionServer': { getLatestCompletion: async () => ({ id: 'round', submitted_at: null }) },
    '@/lib/renoapp/completion': common,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from: () => { let deleting = false; const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { id: 'doc', completion_request_id: 'round', storage_bucket: 'bucket', file_path: 'file' }, error: null }),
        delete: () => { deleting = true; calls.push('delete-row'); return query },
        then: (resolve: (value: unknown) => unknown) => resolve({ error: deleting ? { message: 'COMPLETION_CHANGED' } : null }),
      }; return query },
      storage: { from: () => ({ remove: async () => { calls.push('remove-file'); return { error: null } } }) },
    }) },
  })
  const response = await route.DELETE(new Request('https://example.test/documents?documentId=doc&completionRequestId=round'), { params: Promise.resolve({ token: 'secret' }) })
  assert.equal(response.status, 409)
  assert.deepEqual(calls, ['delete-row'])
})

test('open document is inline; normal download is unchanged and BRF authorization still applies', async () => {
  const signed: unknown[] = []
  let authorized = true
  const route = load<typeof DocumentRoute>('src/app/api/renoapp/app/cases/[id]/documents/[documentId]/route.ts', {
    '@/lib/renoapp/server': { requireRenoAppViewerContext: async () => ({ authorizedBrfIds: authorized ? ['brf'] : ['other'] }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'renovation_cases' ? { brf_id: 'brf' } : { storage_bucket: 'bucket', file_path: 'file', file_name: 'Drawing.pdf' }, error: null }) }; return query
    }, storage: { from: () => ({ createSignedUrl: async (_path: string, _ttl: number, options: unknown) => { signed.push(options); return { data: { signedUrl: 'https://example.test/signed' }, error: null } } }) } }) },
  })
  const context = { params: Promise.resolve({ id: 'case', documentId: 'document' }) }
  assert.equal((await route.GET(new Request('https://example.test/document?view=1'), context)).status, 307)
  assert.equal((await route.GET(new Request('https://example.test/document'), context)).status, 307)
  assert.deepEqual(signed, [undefined, { download: 'Drawing.pdf' }])
  authorized = false
  assert.equal((await route.GET(new Request('https://example.test/document?view=1'), context)).status, 404)
  assert.equal(signed.length, 2)
})
