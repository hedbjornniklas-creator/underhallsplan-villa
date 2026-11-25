import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as icons from 'lucide-react'
import * as jsxRuntime from 'react/jsx-runtime'
import { questionUuid } from '../src/lib/action-cases/projectQuestions.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = id(1), org = id(2), project = id(3), question = id(4), memberId = id(5), contact = id(6), file = id(7)
function load(path, deps) {
  const loaded = { exports: {} }
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', source)(name => deps[name] || {}, loaded, loaded.exports)
  return loaded.exports
}
function query(table, records, calls) {
  let values = [...records], from = 0, to = Number.MAX_SAFE_INTEGER
  const q = {
    select(fields) { calls.push({ table, fields }); return q },
    eq(key, value) { values = values.filter(row => row[key] === value); return q },
    in(key, list) { assert.ok(list.length <= 200 || table !== 'action_case_questions'); values = values.filter(row => list.includes(row[key])); return q },
    not(key, _operator, value) { values = values.filter(row => row[key] !== value); return q },
    lte(key, value) { values = values.filter(row => row[key] <= value); return q },
    gte(key, value) { values = values.filter(row => row[key] >= value); return q },
    or() { return q }, order() { return q }, limit(value) { to = value - 1; return q }, range(a, b) { from = a; to = b; return q },
    async maybeSingle() { return { data: values[0] || null, error: null } },
    then(resolve, reject) { return Promise.resolve({ data: values.slice(from, to + 1), error: null }).then(resolve, reject) },
  }
  return q
}
function dialogueFixture({ revokeAfterSigning = false } = {}) {
  let active = true
  const calls = [], signed = []
  const member = { id: memberId, org_id: org, action_case_id: project, question_id: question, contact_id: contact, person_kind: 'contact', person_id: contact, name: 'Viewer', email: 'viewer@example.invalid', active: true, shared: true, joined_at: '2026-11-18' }
  const tables = {
    action_case_questions: [{ id: question, org_id: org, action_case_id: project, body: { title: 'PRIVATE DRAFT', status: 'open', note: 'PRIVATE NOTE' } }],
    action_case_question_conversations: [{ question_id: question, shared_body: { title: 'Published', description: 'Published description' }, shared_at: '2026-01-01', version: 12 }],
    action_case_question_participants: [member],
    action_case_question_messages: [
      { id: id(20), question_id: question, participant_id: memberId, operation: 'share', actor_name: 'Manager', actor_method: 'internal_login', message: '', snapshot: { title: 'Old publication', description: 'Old version' }, created_at: '2026-01-01', files: [{ attachment_id: file, file_name: 'Published.pdf' }] },
      { id: id(21), question_id: question, participant_id: memberId, operation: 'reply', actor_name: 'Previous participant', actor_method: 'personal_link', message: 'Historic public reply', created_at: '2026-01-02', files: [] },
    ],
    action_case_question_events: [
      { id: id(22), org_id: org, question_id: question, task_id: id(50), operation: 'send', title: 'Originally sent', description: 'Original description', actor_id: id(90), actor_name: 'Manager', created_at: '2026-01-01' },
      { id: id(23), org_id: org, question_id: question, operation: 'note', title: 'PRIVATE NOTE', description: 'PRIVATE FILE', created_at: '2026-01-03' },
    ],
    action_case_question_message_files: [{ message_id: id(20), attachment_id: file }],
    action_case_attachments: [{ id: file, org_id: org, action_case_id: project, storage_bucket: 'private-test', file_path: 'published.pdf' }],
  }
  const db = {
    async rpc(name, args) { calls.push({ name, args }); assert.equal(name, 'resolve_recipient_question_scope'); assert.equal(args.p_auth_user_id, user); return { data: active ? [member] : [], error: null } },
    from(table) { return query(table, tables[table] || [], calls) },
    storage: { from() { return { async createSignedUrl(path) { signed.push(path); if (revokeAfterSigning) active = false; return { data: { signedUrl: 'https://storage.invalid/authorized' }, error: null } } } } },
  }
  const server = load('../src/lib/action-cases/questionDialogueServer.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './projectQuestions': { questionUuid } })
  return { server, calls, signed }
}

test('a newly joined participant reads every public message, but never private notes, drafts or selected-only files', async () => {
  const { server } = dialogueFixture()
  const result = await server.getRecipientQuestionDialogue(user, question)
  assert.equal(result.messages.length, 3)
  assert.ok(result.messages.some(message => message.text === 'Historic public reply'))
  assert.ok(result.messages.some(message => message.snapshot?.title === 'Originally sent'))
  assert.equal(result.canManage, false); assert.equal(result.managerId, null)
  assert.equal(result.participants[0].email, null); assert.equal(result.participants[0].personId, '')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|link_nonce|link_expires_at|recipient_identity/)
})

test('file authorization checks the exact published reference and rechecks membership before returning a signed URL', async () => {
  const allowed = dialogueFixture()
  assert.equal(await allowed.server.questionDialogueFile(project, question, file, { recipientAuthUserId: user }), 'https://storage.invalid/authorized')
  assert.equal(allowed.signed.length, 1)
  await assert.rejects(allowed.server.questionDialogueFile(project, question, id(99), { recipientAuthUserId: user }), /NOT_FOUND/)
  assert.equal(allowed.signed.length, 1)
  const revoked = dialogueFixture({ revokeAfterSigning: true })
  await assert.rejects(revoked.server.questionDialogueFile(project, question, file, { recipientAuthUserId: user }), /NOT_FOUND/)
})

test('recipient replies cannot invoke participant management or impersonate another session', async () => {
  const calls = [], parser = load('../src/lib/action-cases/questionDialogue.ts', { './projectQuestions': { questionUuid } })
  const server = load('../src/lib/action-cases/questionDialogueServer.ts', { './projectQuestions': { questionUuid }, './questionDialogue': parser,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ async rpc(name, args) { calls.push({ name, args }); return { data: args.p_request.requestId } } }) } })
  const request = { requestId: id(40), operation: 'reply', text: 'Public', version: 1, fileIds: [], authUserId: id(99), actorName: 'Spoofed' }
  await server.replyRecipientQuestion(user, question, request)
  assert.equal(calls[0].name, 'reply_recipient_project_question'); assert.equal(calls[0].args.p_auth_user_id, user)
  assert.equal('actorName' in calls[0].args.p_request, false)
  await assert.rejects(server.replyRecipientQuestion(user, question, { ...request, operation: 'participants', participants: [] }), /FORBIDDEN/)
  assert.equal(calls.length, 1)
})

test('the portal reads more than one thousand participations without fetching private draft bodies', async () => {
  const calls = [], members = Array.from({ length: 1001 }, (_, i) => ({ id: id(i + 100), org_id: org, question_id: id(i + 2000), action_case_id: project, contact_id: contact }))
  const tables = {
    action_case_questions: members.map((m, i) => ({ id: m.question_id, number: i + 1, action_case_id: project, status: 'open' })),
    action_case_question_conversations: members.map(m => ({ question_id: m.question_id, shared_body: { title: 'Published' }, shared_at: '2026-01-01' })),
    action_cases: [{ id: project, title: 'Project' }],
  }
  const db = { rpc(name, args) { calls.push({ name, args }); return query(name, name === 'resolve_recipient_question_scope' ? members : [], calls) }, from(table) { return query(table, tables[table] || [], calls) } }
  const server = load('../src/lib/tasks/recipientParticipation.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/action-cases/projectQuestions': { questionUuid } })
  const result = await server.getRecipientSharedItems({ authUserId: user })
  assert.equal(result.length, 1001); assert.ok(result.some(row => row.id === members.at(-1).question_id))
  for (const call of calls.filter(call => call.table === 'action_case_questions')) assert.equal(call.fields, 'id,number,action_case_id,status:body->>status')
})

test('question links contain only this recipients assigned task ids, never other participants ids', async () => {
  const calls = [], own = id(50), foreign = id(51)
  const tables = {
    action_case_questions: [{ id: question, number: 12, action_case_id: project, status: 'open' }],
    action_case_question_conversations: [{ question_id: question, shared_body: { title: 'Published' }, shared_at: '2026-01-01' }],
    action_cases: [{ id: project, title: 'Project' }],
    action_case_question_events: [{ id: id(60), question_id: question, task_id: own }, { id: id(61), question_id: question, task_id: foreign }],
  }
  const db = { rpc(name) { return query(name, name === 'resolve_recipient_question_scope' ? [{ id: memberId, question_id: question, action_case_id: project }] : [], calls) }, from(table) { return query(table, tables[table] || [], calls) } }
  const server = load('../src/lib/tasks/recipientParticipation.ts', { '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/action-cases/projectQuestions': { questionUuid } })
  const result = await server.getRecipientSharedItems({ authUserId: user }, [own])
  assert.deepEqual(result[0].assignedTaskIds, [own]); assert.doesNotMatch(JSON.stringify(result), new RegExp(foreign))
})

test('the inbox shows four unique cases, while linked tasks remain available to responsibility filters', () => {
  const analytics = load('../src/lib/tasks/analytics.ts', { './contracts': load('../src/lib/tasks/contracts.ts', {}) }).buildTaskAnalyticsScope({ tasks: [], deadlineRequests: [], asOf: '2026-11-25T10:00:00Z' })
  const overview = {
    recipientName: 'Recipient', tasks: [
      { id: id(50), title: 'DUPLICATE-TASK-CARD', status: 'in_progress', risk: 'green', dueAt: '2027-01-01T10:00:00Z', dueTimeZone: 'Europe/Stockholm', issuerName: 'Manager', unreadMessageCount: 0 },
      { id: id(51), title: 'Completed ordinary task', status: 'approved', risk: 'green', dueAt: '2027-01-01T10:00:00Z', dueTimeZone: 'Europe/Stockholm', issuerName: 'Manager', unreadMessageCount: 0 },
    ], summary: { active: 1, needsAction: 0, overdue: 0, completed: 1, unreadMessages: 0 }, analytics: { asOf: '2026-11-25T10:00:00Z', defaultPeriod: '90d', self: analytics },
    participations: [12, 21, 2].map(n => ({ id: id(n), kind: 'question', title: `Question ${n}`, status: 'open', contextLabel: 'Project', href: '#', sharedAt: '2026-11-25', assignedTaskIds: n === 2 ? [id(50)] : [] })),
  }
  for (const filter of ['active', 'all']) {
    const ui = load('../src/components/tasks/RecipientPortalOverviewClient.tsx', {
      react: { ...React, useState: value => React.useState(value === 'active' ? filter : value) }, 'react/jsx-runtime': jsxRuntime,
      'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }, 'next/navigation': { useRouter: () => ({}) }, 'lucide-react': icons,
      './SigneMark': { SigneMark: () => null }, './TaskStatusBadge': { TaskRiskDot: () => null, TaskStatusBadge: () => null },
      '@/lib/tasks/dateTime': { formatTaskDateTime: () => '1 januari', normalizeTaskTimeZone: () => 'Europe/Stockholm', taskTimeZoneLabel: () => 'Stockholm' },
      '@/lib/tasks/recipientAuthPaths': { recipientTaskPath: value => `/mina-uppdrag/uppdrag/${value}` },
    }).default
    const html = renderToStaticMarkup(React.createElement(ui, { initialOverview: overview }))
    assert.doesNotMatch(html, /DUPLICATE-TASK-CARD/)
    assert.equal((html.match(/Question (?:12|21|2)</g) || []).length, 3)
    assert.equal(html.includes('Completed ordinary task'), filter === 'all')
  }
  const source = readFileSync(new URL('../src/components/tasks/RecipientPortalOverviewClient.tsx', import.meta.url), 'utf8')
  assert.match(source, /!drilldownTaskIds && \['active', 'completed', 'all'\]\.includes\(filter\)/)
})

test('new endpoints require the real session and same-origin body validation, not a caller-supplied user', async () => {
  const calls = [], after = []
  const route = load('../src/app/api/mina-uppdrag/projektfragor/[questionId]/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) }, after: callback => after.push(callback) },
    '@/lib/tasks/recipientPortal': { async requireRecipientPortalSession() { return { authUserId: user } } },
    '@/lib/action-cases/customerOffersHttp': { async offerRequestBody(request) { if (request.headers.get('origin') !== new URL(request.url).origin) throw Error('FOREIGN'); return request.json() }, customerOfferError: error => ({ status: 403, error: error.message }) },
    '@/lib/action-cases/questionDialogueServer': { async replyRecipientQuestion(...args) { calls.push(args); return { messageId: id(40), questionId: question } }, async deliverQuestionMessages() {} },
  })
  const make = origin => new Request(`https://hushub.test/api/mina-uppdrag/projektfragor/${question}`, { method: 'POST', headers: { origin }, body: JSON.stringify({ operation: 'reply', authUserId: id(99) }) })
  assert.equal((await route.POST(make('https://foreign.invalid'), { params: Promise.resolve({ questionId: question }) })).status, 403)
  await route.POST(make('https://hushub.test'), { params: Promise.resolve({ questionId: question }) })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0, 2), [user, question]); assert.equal(after.length, 1)
})

test('former task history is bounded by the sent publication and reassignment, and excludes other recipients', async () => {
  const calls = [], task = id(50), scope = { grant_id: id(51), org_id: org, contact_id: contact, task_id: task, shared_from: '2026-11-10', shared_until: '2026-11-12', snapshot: { title: 'Sent title' } }
  const tables = {
    operational_tasks: [{ id: task, org_id: org, issuer_profile_id: id(90) }], task_attachments: [],
    task_events: [
      { id: id(60), org_id: org, task_id: task, event_type: 'comment', actor_type: 'profile', message: 'BEFORE PRIVATE', created_at: '2026-11-09' },
      { id: id(61), org_id: org, task_id: task, event_type: 'comment', actor_type: 'profile', message: 'Shared reply', created_at: '2026-11-11' },
      { id: id(62), org_id: org, task_id: task, event_type: 'comment', actor_type: 'contact', actor_contact_id: id(99), message: 'OTHER PRIVATE', created_at: '2026-11-11' },
      { id: id(63), org_id: org, task_id: task, event_type: 'comment', actor_type: 'profile', message: 'AFTER PRIVATE', created_at: '2026-11-13' },
    ],
  }
  const db = { rpc() { return query('scope', [scope], calls) }, from(table) { return query(table, tables[table] || [], calls) } }
  const server = load('../src/lib/tasks/recipientParticipation.ts', { '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/action-cases/projectQuestions': { questionUuid } })
  const result = await server.getRecipientTaskParticipation({ authUserId: user }, task)
  assert.equal(result.events.length, 1); assert.equal(result.events[0].message, 'Shared reply')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
})
