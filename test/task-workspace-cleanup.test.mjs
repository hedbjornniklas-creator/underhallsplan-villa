import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as dateTime from '../src/lib/tasks/dateTime.ts'
import * as completion from '../src/lib/tasks/manualCompletion.ts'

const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const sheet = read('src/components/tasks/TaskDetailSheet.tsx')
function render(overrides = {}, busy = false) {
  const loaded = { exports: {} }, noop = () => null
  const compiled = ts.transpileModule(sheet, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', compiled)(name => {
    if (['react', 'react/jsx-runtime', 'lucide-react'].includes(name)) return require(name)
    if (name === '@/lib/tasks/dateTime') return dateTime
    if (name === '@/lib/tasks/manualCompletion') return completion
    if (name === './TaskStatusBadge') return { TaskRiskDot: noop, TaskStatusBadge: noop, taskStatusLabel: value => value }
    return { __esModule: true, default: noop }
  }, loaded, loaded.exports)
  const task = { id: 'task', title: 'Fiktiv uppgift', dueAt: '2027-01-15T15:00:00Z', dueTimeZone: 'Europe/Stockholm', nextFollowupAt: null, status: 'assigned',
    issuerId: 'issuer', issuerName: 'Anna Exempel', assignee: { id: 'recipient', kind: 'profile', name: 'Bo Exempel' },
    canDelete: true, canCompleteManually: true, childCount: 0, openChildCount: 0, depth: 0, requirements: [], attachments: [], evidenceRequirements: [], deadlineRequests: [], events: [],
    aiSuggestions: [{ id: 'old', title: 'Historiskt AI-förslag' }], ...overrides }
  const workspace = { timeZone: 'Europe/Stockholm', currentUser: { id: 'issuer', isOrgAdmin: false }, tasks: [], limits: { maxDepth: 2, maxOpenChildren: 5 } }
  return renderToStaticMarkup(createElement(loaded.exports.default, { task, workspace, busy }))
}

test('Att göra changes visible labels, not the current view key or existing task links', () => {
  const source = read('src/components/tasks/TaskDashboardClient.tsx')
  assert.equal((source.match(/Att göra/g) ?? []).length, 2)
  assert.doesNotMatch(source, /Aktuellt/)
  assert.match(source, /setWorkspaceView\('current'\)/)
  assert.match(source, /get\('task'\)/)
  assert.match(source, /suggestion=\{null\}/)
})

test('task suggestions and their commands are removed while manual subtasks and history remain', () => {
  assert.doesNotMatch(sheet, /SigneCheckIcon|request_signe_suggestions|reject_signe_suggestion|task\.aiSuggestions|förslag på nästa steg/)
  const html = render()
  assert.doesNotMatch(html, /Historiskt AI-förslag/)
  assert.match(html, /Underuppgifter/)
  assert.match(sheet, /<TaskHistoryDisclosure events=\{task.events\}/)
  assert.match(sheet, /onCreateSubtask\(task\)/)
})

test('delete lives in the pinned footer alongside completion and cancellation, not the scroll body', () => {
  const html = render(), footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0]
  assert.ok(footer); assert.match(footer, /Uppdragsåtgärder/)
  for (const label of ['Klarmarkera manuellt', 'Avbryt uppdrag', 'Radera uppdrag']) assert.ok(footer.includes(label))
  assert.equal((html.match(/Radera uppdrag/g) ?? []).length, 2, 'Only button title and label; no second danger section')
  assert.doesNotMatch(footer, /absolute|overflow-x-auto/)
  assert.match(sheet, /<div className="flex shrink-0 flex-wrap gap-2">/)
})

test('closed tasks retain deletion permission without regaining active status actions', () => {
  for (const status of ['approved', 'cancelled']) {
    const html = render({ status })
    assert.match(html, /Radera uppdrag/)
    assert.doesNotMatch(html, /Klarmarkera manuellt|Avbryt uppdrag|>Underuppgift</)
    assert.doesNotMatch(render({ status, canDelete: false }), /<footer/)
  }
})

test('deletion retains permission, child and busy guards and the original confirmed archive operation', () => {
  assert.doesNotMatch(render({ canDelete: false }), /Radera uppdrag/)
  assert.match(render({ childCount: 1 }), /disabled=""[^>]*aria-describedby="task-delete-blocked"/)
  assert.match(render({}, true), /disabled=""[^>]*title="Radera uppdrag"/)
  assert.match(sheet, /if \(deleteBusy \|\| task.childCount > 0\) return/)
  assert.match(sheet, /onAction\('archive_task', \{ taskId: task.id, version: task.version \}\)/)
  assert.match(sheet, /role="alertdialog"/)
  assert.match(sheet, /Historik och bilagor sparas för spårbarhet/)
})
