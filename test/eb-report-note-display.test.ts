import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Display from '../src/lib/eb/reportNoteDisplay'

const output = ts.transpileModule(readFileSync(new URL('../src/lib/eb/reportNoteDisplay.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiled = { exports: {} }
new Function('exports', 'module', output)(compiled.exports, compiled)
const { sortEbReportNotes: sortNotes, ebReportNoteDisplayIndex: displayIndex } = compiled.exports as typeof Display

const notes = () => [
  { id: 'a', sortOrder: 300, noteNumber: 1, createdAt: '2026-09-01T08:00:00Z', noteText: 'Sist i utlåtandet' },
  { id: 'b', sortOrder: 100, noteNumber: 2, createdAt: '2026-09-01T08:01:00Z', noteText: 'Först i utlåtandet' },
  { id: 'c', sortOrder: 200, noteNumber: 81, createdAt: '2026-09-01T08:02:00Z', noteText: '' },
]

test('report display numbers follow sort order, not old database numbers or snapshot array position', () => {
  const report = { notes: notes() }
  assert.deepEqual(sortNotes(report.notes).map(note => note.id), ['b', 'c', 'a'])
  assert.deepEqual([...displayIndex(report)], [['b', 1], ['c', 2], ['a', 3]])
})

test('full report numbering is retained after blank, recipient or status filtering', () => {
  const report = { notes: notes() }
  const numbers = displayIndex(report)
  const actionable = sortNotes(report.notes).filter(note => note.noteText.trim())
  assert.deepEqual(actionable.map(note => [note.id, numbers.get(note.id)]), [['b', 1], ['a', 3]])

  const recipientSubset = actionable.filter(note => note.id === 'a')
  assert.deepEqual(recipientSubset.map(note => numbers.get(note.id)), [3],
    'a filtered list may start above one; it must retain the report reference')
})

test('sort order has precedence over original number, followed by created time', () => {
  const source = [
    { id: 'late', sortOrder: 100, noteNumber: 2, createdAt: '2026-09-02T10:00:00Z' },
    { id: 'high-sort', sortOrder: 200, noteNumber: 1, createdAt: '2026-09-01T10:00:00Z' },
    { id: 'early', sortOrder: 100, noteNumber: 2, createdAt: '2026-09-01T10:00:00Z' },
    { id: 'low-number', sortOrder: 100, noteNumber: 1, createdAt: '2026-09-03T10:00:00Z' },
  ]
  assert.deepEqual(sortNotes(source).map(note => note.id), ['low-number', 'early', 'late', 'high-sort'])
})

test('exact ordering ties preserve frozen source order instead of inventing an id tiebreak', () => {
  const source = ['z', 'a', 'm'].map(id => ({ id, sortOrder: 100, noteNumber: 1, createdAt: null }))
  assert.deepEqual(sortNotes(source).map(note => note.id), ['z', 'a', 'm'])
  assert.deepEqual([...displayIndex({ notes: source })], [['z', 1], ['a', 2], ['m', 3]])
})

test('legacy missing values use the same zero and empty-time fallbacks as the report', () => {
  const source = [
    { id: 'numbered', sortOrder: null, noteNumber: 1 },
    { id: 'dated', createdAt: '2026-09-01T10:00:00Z' },
    { id: 'undated', sortOrder: null, noteNumber: null, createdAt: null },
    { id: 'positive-sort', sortOrder: 1, noteNumber: null },
  ]
  assert.deepEqual(sortNotes(source).map(note => note.id), ['undated', 'dated', 'numbered', 'positive-sort'])
})

test('frozen report arrays and note evidence are not mutated or renumbered in place', () => {
  const source = Object.freeze(notes().map(note => Object.freeze(note)))
  const report = Object.freeze({ notes: source })
  const before = structuredClone(report)
  const sorted = sortNotes(source)
  const numbers = displayIndex(report)
  assert.notEqual(sorted, source)
  assert.equal(sorted[0], source[1])
  sorted.reverse()
  numbers.set('b', 999)
  assert.deepEqual(report, before)
  assert.deepEqual([...displayIndex(report)], [['b', 1], ['c', 2], ['a', 3]])
})

test('separate inspection rounds each begin at one, regardless of their old number sequence', () => {
  const firstRound = { notes: [{ id: 'slb-1-a', sortOrder: 100, noteNumber: 18 }] }
  const nextRound = { notes: [{ id: 'eb-2-a', sortOrder: 100, noteNumber: 41 }] }
  assert.deepEqual([...displayIndex(firstRound)], [['slb-1-a', 1]])
  assert.deepEqual([...displayIndex(nextRound)], [['eb-2-a', 1]])
})

test('drainage numbers use actual grouped checklist display, not global checkpoint or note order', () => {
  const report = {
    project: { projectTemplateKey: 'drainage_foundation' },
    notes: [
      { id: 'b-note', sortOrder: 10, noteNumber: 1 },
      { id: 'a-last', sortOrder: 20, noteNumber: 2 },
      { id: 'a-first', sortOrder: 30, noteNumber: 3 },
      { id: 'document-note', sortOrder: 40, noteNumber: 4 },
      { id: 'unlinked-note', sortOrder: 50, noteNumber: 5 },
    ],
    checkpoints: [
      { noteId: 'document-note', groupKey: 'documents', sortOrder: 0, title: 'Handling' },
      { noteId: 'a-first', groupKey: 'a', sortOrder: 100, title: 'A först' },
      { noteId: 'b-note', groupKey: 'b', sortOrder: 200, title: 'B först' },
      { noteId: null, groupKey: 'a', sortOrder: 250, title: 'A utan notering' },
      { noteId: 'a-last', groupKey: 'a', sortOrder: 300, title: 'A sist' },
    ],
  }
  const before = structuredClone(report)
  assert.deepEqual([...displayIndex(report)], [['a-first', 1], ['a-last', 3], ['b-note', 4]])
  assert.deepEqual(report, before)
  assert.equal(displayIndex(report).has('document-note'), false)
  assert.equal(displayIndex(report).has('unlinked-note'), false)
})

test('drainage equal sort orders use Swedish title collation and retain ties', () => {
  const report = {
    project: { projectTemplateKey: 'drainage_foundation' },
    notes: [],
    checkpoints: ['Örn', 'Älg', 'Ål', 'Zulu', 'Alfa', 'Alfa'].map((title, index) => ({
      noteId: `note-${index}`, groupKey: 'one', sortOrder: 100, title,
    })),
  }
  assert.deepEqual([...displayIndex(report)], [
    ['note-4', 1], ['note-5', 2], ['note-3', 3], ['note-2', 4], ['note-1', 5], ['note-0', 6],
  ])
})

test('drainage missing groups share the other group in first group appearance order', () => {
  const report = {
    project: { projectTemplateKey: 'drainage_foundation' },
    notes: [],
    checkpoints: [
      { noteId: 'no-group', sortOrder: 100, title: 'Första' },
      { noteId: 'named-group', groupKey: 'named', sortOrder: 200, title: 'Andra' },
      { noteId: 'empty-group', groupKey: '', sortOrder: 300, title: 'Tredje' },
    ],
  }
  assert.deepEqual([...displayIndex(report)], [['no-group', 1], ['empty-group', 2], ['named-group', 3]])
})

test('drainage without a displayed checkpoint does not fall back to unrelated raw note numbers', () => {
  assert.deepEqual([...displayIndex({
    project: { projectTemplateKey: 'drainage_foundation' }, notes: notes(),
  })], [])
  assert.deepEqual([...displayIndex({ notes: [] })], [])
})
