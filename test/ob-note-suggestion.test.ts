import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'
// @ts-expect-error Native Node tests require the .ts extension.
import { parseObNoteSuggestion } from '../src/lib/ob/noteSuggestion.ts'
// @ts-expect-error Native Node tests require the .ts extension.
import { createNoteSuggestionLimit, NoteSuggestionError, sendObNoteSuggestion } from '../src/lib/ob/noteSuggestionServer.ts'

const inspectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const noteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const suggestion = { noteId, note: 'Spricka vid dörr.', risk_text: 'Risktext', ftu_text: 'Utredning', category: 'Hall' }
type Mail = Parameters<Parameters<typeof sendObNoteSuggestion>[0]['send']>[0]

function fixture() {
  const rows: Record<string, Record<string, unknown> | null> = {
    inspections: { id: inspectionId, property_id: 'property-1', inspection_family: 'OB', type: 'OB' },
    properties: { id: 'property-1', owner: actorId },
    inspection_control_items: { id: noteId, inspection_id: inspectionId, control_point_id: null },
    profiles: { id: actorId, email: 'inspector@example.test' },
  }
  const requests: URL[] = [], mails: Mail[] = []
  const db = createClient('https://synthetic.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      assert.equal(init?.method ?? 'GET', 'GET', 'Suggestions must never write inspection or catalog records')
      const url = new URL(String(input))
      requests.push(url)
      const table = url.pathname.split('/').pop()!
      assert.ok(Object.hasOwn(rows, table), `Unexpected table: ${table}`)
      const row = rows[table]
      const matches = row && [...url.searchParams.entries()].every(([key, value]) => key === 'select' || value === `eq.${row[key]}`)
      return Response.json(matches ? [row] : [])
    } },
  })
  const args = { db, actorId, inspectionId, suggestion, from: 'HusHub <noreply@example.test>', send: async (mail: Mail) => {
    mails.push(mail)
    return { provider: 'synthetic', providerMessageId: 'synthetic-message' }
  } }
  return { args, rows, requests, mails }
}

test('only explicit bounded text fields are accepted, never client recipients/attachments', () => {
  assert.deepEqual(parseObNoteSuggestion(inspectionId, { ...suggestion, note: '  Spricka vid dörr.  ', to: 'intruder@example.test', attachments: ['secret'] }), suggestion)
  for (const value of [null, [], {}, { ...suggestion, note: '' }, { ...suggestion, note: ' ' }, { ...suggestion, note: 'x'.repeat(20001) }, { ...suggestion, risk_text: 3 }, { ...suggestion, category: 'x'.repeat(201) }, { ...suggestion, noteId: 'invalid' }]) {
    assert.equal(parseObNoteSuggestion(inspectionId, value), null)
  }
  assert.equal(parseObNoteSuggestion('invalid', suggestion), null)
})

test('an owned free note sends a text-only copy to configured admin without changing records', async () => {
  const f = fixture()
  await sendObNoteSuggestion(f.args)
  assert.equal(f.mails.length, 1)
  assert.equal(f.mails[0].to, 'jn@hedbjorn.se')
  assert.equal(f.mails[0].replyTo, 'inspector@example.test')
  assert.ok(f.mails[0].text.includes(suggestion.note))
  assert.ok(f.mails[0].text.includes(suggestion.risk_text))
  assert.ok(f.mails[0].text.includes(suggestion.ftu_text))
  assert.equal(f.mails[0].attachments, undefined)
  assert.equal(f.mails[0].text.includes(inspectionId), false)
  assert.equal(f.requests.find(url => url.pathname.endsWith('/properties'))?.searchParams.get('owner'), `eq.${actorId}`)
  const noteQuery = f.requests.find(url => url.pathname.endsWith('/inspection_control_items'))!
  assert.equal(noteQuery.searchParams.get('inspection_id'), `eq.${inspectionId}`)
  assert.equal(noteQuery.searchParams.get('id'), `eq.${noteId}`)
})

test('foreign owners, notes from other inspections, catalog notes and non-OB inspections never send', async () => {
  const cases = [
    ['properties', { id: 'property-1', owner: 'someone-else' }],
    ['inspection_control_items', { id: noteId, inspection_id: 'other', control_point_id: null }],
    ['inspection_control_items', { id: noteId, inspection_id: inspectionId, control_point_id: 'point-1' }],
    ['inspection_control_items', null],
    ['inspections', { id: inspectionId, property_id: 'property-1', inspection_family: 'EB', type: 'OB' }],
  ] as const
  for (const [table, row] of cases) {
    const f = fixture()
    f.rows[table] = row
    await assert.rejects(sendObNoteSuggestion(f.args), NoteSuggestionError)
    assert.equal(f.mails.length, 0)
  }
})

test('HTML is escaped and failed delivery can retry the identical provider key', async () => {
  const f = fixture()
  f.args.suggestion = { ...suggestion, note: '<img src=x onerror=alert(1)> & text' }
  const send = f.args.send
  f.args.send = async mail => { await send(mail); throw Error('Lost response') }
  await assert.rejects(sendObNoteSuggestion(f.args), /Lost response/)
  f.args.send = send
  await sendObNoteSuggestion(f.args)
  assert.equal(f.mails[0].idempotencyKey, f.mails[1].idempotencyKey)
  assert.ok(f.mails[0].html.includes('&lt;img'))
  assert.ok(!f.mails[0].html.includes('<img'))
  f.args.suggestion = { ...suggestion, note: 'Different copy' }
  await sendObNoteSuggestion(f.args)
  assert.notEqual(f.mails[1].idempotencyKey, f.mails[2].idempotencyKey)
})

test('missing/invalid mail configuration fails closed, with a server-only recipient override', async () => {
  const f = fixture()
  await assert.rejects(sendObNoteSuggestion({ ...f.args, from: '' }), { status: 503 })
  await assert.rejects(sendObNoteSuggestion({ ...f.args, recipient: 'bad address' }), { status: 503 })
  assert.equal(f.mails.length, 0)
  await sendObNoteSuggestion({ ...f.args, recipient: 'admin@example.test' })
  assert.equal(f.mails[0].to, 'admin@example.test')
})

test('the bounded rate limit is per authenticated actor and expires', () => {
  const permit = createNoteSuggestionLimit()
  for (let i = 0; i < 20; i++) assert.equal(permit(actorId, 1000), true)
  assert.equal(permit(actorId, 1000), false)
  assert.equal(permit('other-actor', 1000), true)
  assert.equal(permit(actorId, 3601000), true)
})

test('route authenticates first and UI saves the original before editing a separate copy', () => {
  const route = readFileSync('src/app/api/ob/inspections/[id]/note-suggestions/route.ts', 'utf8')
  assert.ok(route.indexOf('await requireOrgContext()') < route.indexOf('await sendObNoteSuggestion('))
  assert.ok(route.includes('actorId: org.userId'))
  const editor = readFileSync('src/components/ob/ObMobileRound.tsx', 'utf8')
  assert.ok(editor.includes('finish(() => setSuggestionOpen(true))'))
  assert.ok(editor.includes('!note.control_point_id &&'))
})

test('HTTP route enforces authentication, same-origin JSON, validation and safe error responses', async () => {
  const f = fixture()
  let authError = '', sendError = false
  const source = readFileSync('src/app/api/ob/inspections/[id]/note-suggestions/route.ts', 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiled = { exports: {} as { POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } }
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/assignments/server': { requireOrgContext: async () => { if (authError) throw Error(authError); return { userId: actorId, orgId: 'org-1' } } },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (mail: Mail) => { if (sendError) throw Error('Private provider response'); return f.args.send(mail) } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => f.args.db },
    '@/lib/ob/noteSuggestion': { parseObNoteSuggestion },
    '@/lib/ob/noteSuggestionServer': { createNoteSuggestionLimit, NoteSuggestionError, sendObNoteSuggestion },
  }
  const env = { RESEND_API_KEY: 'synthetic-key', ASSIGNMENTS_MAIL_FROM: 'noreply@example.test', OB_NOTE_SUGGESTIONS_EMAIL: 'admin@example.test' }
  new Function('require', 'module', 'exports', 'process', 'console', output)((name: string) => {
    assert.ok(Object.hasOwn(deps, name), `Unexpected route dependency ${name}`)
    return deps[name]
  }, compiled, compiled.exports, { env }, { error: () => {} })
  const post = (body: unknown = suggestion, headers: Record<string, string> = { 'Content-Type': 'application/json' }) => compiled.exports.POST(
    new Request(`https://app.example.test/api/ob/inspections/${inspectionId}/note-suggestions`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: inspectionId }) },
  )
  for (const [code, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403]] as const) {
    authError = code
    assert.equal((await post()).status, status)
  }
  authError = ''
  assert.equal((await post({}, { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await post(suggestion, { 'Content-Type': 'application/json', Origin: 'https://other.example.test' })).status, 403)
  assert.equal((await post({ ...suggestion, note: '' })).status, 400)
  assert.equal((await post({ ...suggestion, note: 'x'.repeat(100001) })).status, 413)
  assert.equal(f.mails.length, 0)
  sendError = true
  const failure = await post()
  assert.equal(failure.status, 502)
  assert.equal(JSON.stringify(await failure.json()).includes('Private provider'), false)
  sendError = false
  const success = await post({ ...suggestion, to: 'intruder@example.test' })
  assert.equal(success.status, 200)
  assert.deepEqual(await success.json(), { ok: true })
  assert.equal(f.mails[0].to, 'admin@example.test')
})
