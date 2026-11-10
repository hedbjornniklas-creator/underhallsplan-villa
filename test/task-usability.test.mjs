import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as drafts from '../src/lib/tasks/recipientDraft.ts'
import * as dates from '../src/lib/tasks/dateTime.ts'
import * as estimates from '../src/lib/tasks/timeEstimate.ts'
const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load(path, deps = {}, extra = '') {
  const loaded = { exports: {} }
  const code = ts.transpileModule(read(path) + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', code)(name => deps[name] ?? (['react', 'react/jsx-runtime', 'lucide-react'].includes(name) ? require(name) : {}), loaded, loaded.exports)
  return loaded.exports
}
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } }

test('private draft keys accept only non-secret server scopes, never names or bearer URLs', () => {
  assert.equal(drafts.recipientDraftKey('a'.repeat(64)), `hushub:task-recipient-draft:v1:${'a'.repeat(64)}`)
  for (const scope of ['Anna Exempel', '/api/signe/secret-token', '', 'a'.repeat(63)]) assert.equal(drafts.recipientDraftKey(scope), null)
  assert.notEqual(drafts.recipientDraftKey('a'.repeat(64)), drafts.recipientDraftKey('b'.repeat(64)))
})
test('drafts restore both fields, stay isolated, and successful submission clears only its own field', () => {
  const s = storage(), a = drafts.recipientDraftKey('a'.repeat(64)), b = drafts.recipientDraftKey('b'.repeat(64))
  drafts.writeRecipientDraft(s, a, { comment: 'Oskickat svar', evidenceText: 'Oskickat underlag' }, 100)
  assert.deepEqual(drafts.readRecipientDraft(s, a, 101), { comment: 'Oskickat svar', evidenceText: 'Oskickat underlag' })
  assert.deepEqual(drafts.readRecipientDraft(s, b, 101), drafts.EMPTY_RECIPIENT_DRAFT)
  drafts.writeRecipientDraft(s, a, { comment: '', evidenceText: 'Oskickat underlag' }, 102)
  assert.equal(drafts.readRecipientDraft(s, a, 103).evidenceText, 'Oskickat underlag')
  drafts.writeRecipientDraft(s, a, drafts.EMPTY_RECIPIENT_DRAFT)
  assert.equal(s.getItem(a), null)
})
test('expired, corrupt, oversized and future drafts are discarded, not restored across sessions', () => {
  const s = storage(), key = 'key'
  for (const raw of ['{broken', 'null', JSON.stringify({ schema: 2 }), JSON.stringify({ schema: 1, updatedAt: 101, comment: '', evidenceText: '' }), JSON.stringify({ schema: 1, updatedAt: 1, comment: 'x'.repeat(100001), evidenceText: '' })]) {
    s.setItem(key, raw)
    assert.deepEqual(drafts.readRecipientDraft(s, key, 100), drafts.EMPTY_RECIPIENT_DRAFT)
    assert.equal(s.getItem(key), null)
  }
  drafts.writeRecipientDraft(s, key, { comment: 'old', evidenceText: '' }, 100)
  assert.equal(drafts.readRecipientDraft(s, key, 101 + drafts.RECIPIENT_DRAFT_TTL_MS).comment, '')
  assert.equal(s.getItem(key), null)
})
test('storage failures are surfaced to the hook, not treated as successful persistence', () => {
  const s = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') }, removeItem() { throw Error('blocked') } }
  assert.throws(() => drafts.readRecipientDraft(s, 'key'), /blocked/)
  assert.throws(() => drafts.writeRecipientDraft(s, 'key', { comment: 'text', evidenceText: '' }), /full/)
  const hook = read('src/components/tasks/useTaskRecipientDraft.ts')
  assert.match(hook, /sessionStorage/); assert.doesNotMatch(hook, /fetch\(|localStorage/)
  assert.match(hook, /beforeunload/); assert.match(hook, /setStorageAvailable\(false\)/)
})
test('closed tasks never render an active deadline meter and never invent a completion date', () => {
  const Component = load('src/components/tasks/TaskTimeProgress.tsx', { '@/lib/tasks/dateTime': dates }).default
  for (const status of ['approved', 'cancelled']) {
    const html = renderToStaticMarkup(createElement(Component, { status, startedAt: '2026-01-01T10:00:00Z', dueAt: '2026-02-01T10:00:00Z' }))
    assert.doesNotMatch(html, /progressbar|försenad|Sluttiden är nu|Avslutat \d/)
    assert.match(html, status === 'approved' ? /Godkänd och klar/ : /avbrutet/)
  }
  assert.match(renderToStaticMarkup(createElement(Component, { status: 'approved', startedAt: '', dueAt: '', completedAt: '2026-11-06T10:00:00Z' })), /Avslutat 6 november/)
})
test('active and closed filters partition statuses without changing my-ball and review rules', () => {
  const { taskMatchesFilter } = load('src/components/tasks/TaskDashboardClient.tsx', { '@/lib/tasks/timeEstimate': estimates }, '\nexport { taskMatchesFilter };')
  for (const status of ['draft', 'assigned', 'in_progress', 'waiting', 'ready_for_review', 'returned', 'approved', 'cancelled']) {
    const task = { status, issuerId: 'issuer', assignee: { id: 'recipient', kind: 'profile' }, ballHolder: 'assignee', deadlineRequests: [], unreadMessageCount: 0 }
    assert.equal(taskMatchesFilter(task, 'active', 'issuer'), !['approved', 'cancelled'].includes(status))
    assert.equal(taskMatchesFilter(task, 'closed', 'issuer'), ['approved', 'cancelled'].includes(status))
    assert.equal(taskMatchesFilter(task, 'all', 'issuer'), true)
  }
  const source = read('src/components/tasks/TaskDashboardClient.tsx')
  assert.match(source, /selectTaskFilter\('active'\)/)
  assert.match(source, /aria-label="Sök uppgifter"/)
  assert.match(source, /Fler filter/)
  assert.match(source, /'all', 'active', 'closed', 'my_ball'/)
})
test('mail stays escaped, preserves personal URLs and Outlook fallback, and uses the Gizmo palette', () => {
  const email = load('src/lib/tasks/emailTemplates.ts')
  const html = email.buildTaskEmailHtml({ previewText: 'Test', eyebrow: 'Nytt uppdrag', heading: 'Fiktivt uppdrag', taskTitle: 'Fiktivt uppdrag', recipientName: '<script>', lead: 'Anna Exempel', contextLabel: 'Projekt A & B', dueLabel: '13 november', actionUrl: 'https://hushub.se/signe/test?x=1&y=2' })
  assert.match(html, /Projekt A &amp; B/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/)
  assert.match(html, /v:roundrect/); assert.match(html, /fillcolor="#252A2D"/); assert.match(html, /#F2D76A/)
  assert.match(html, /signe\/test\?x=1&amp;y=2/)
  assert.doesNotMatch(html, /&#10003;|#b45309|letter-spacing:-|letter-spacing:\./)
  assert.doesNotMatch(html, />Uppdrag<\/td>/, 'The main title is not repeated in the details')
  const digest = email.buildTaskReminderDigestEmailHtml({ previewText: 'Test', recipientName: 'Anna', heading: 'Att följa upp', lead: 'Test', items: [{ title: 'A', dueLabel: 'idag', statusLabel: 'Tilldelad', actionUrl: '/first' }, { title: 'B', dueLabel: 'idag', statusLabel: 'Tilldelad', actionUrl: '/second' }], visibleItemLimit: 1, overviewUrl: '/all' })
  assert.match(digest, /Ytterligare 1 uppdrag/); assert.match(digest, /href="\/first"/); assert.doesNotMatch(digest, /href="\/second"/)
})
test('assignment gains context and reply guidance without changing reply-to, recipients or status actions', () => {
  const server = read('src/lib/tasks/external.ts'), portal = read('src/lib/tasks/recipientPortal.ts'), recipient = read('src/components/tasks/TaskRecipientClient.tsx')
  assert.match(server, /description,context_label,status/)
  assert.match(server, /contextLabel: task.context_label/)
  assert.match(server, /Vanliga mejlsvar sparas inte automatiskt/)
  assert.match(server, /replyTo: issuer\?\.email \?\? null/)
  for (const source of [server, portal]) assert.match(source, /draftScope: hashAssignmentToken\(`task-draft:/)
  assert.doesNotMatch(recipient, /'Starta'|overflow-x-auto/)
  assert.match(recipient, /Fler åtgärder/); assert.match(recipient, /runAction\('start', \{ taskId: task.id, version: task.version \}/)
  assert.match(recipient, /disabled=\{isBusy \|\| readyForReviewBlocked\}/)
})
