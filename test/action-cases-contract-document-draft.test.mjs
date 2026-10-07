import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contractDocumentDraftState, contractDocumentsAcknowledged, readContractDocumentDraft, sameContractDocuments, writeContractDocumentDraft } from '../src/lib/action-cases/contractDocumentDraft.ts'

const caseId = '00000000-0000-4000-8000-000000000001'
const doc = (n, date = '') => ({ fileId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, type: 'Ritning', name: `Ritning ${n}.pdf`, date })
const store = () => {
  const data = new Map()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }
}
const now = 100000000

test('a reload before debounce or after failure can recover names, dates, additions and order', () => {
  const storage = store(), base = [doc(1)], current = [doc(2, '2026-05-11'), { ...doc(1, '2026-05-11'), type: 'Situationsplan', name: 'Eget namn' }]
  writeContractDocumentDraft(storage, caseId, base, current, now)
  const backup = readContractDocumentDraft(storage, caseId, now + 1)
  assert.deepEqual(backup.documents, current)
  assert.equal(contractDocumentDraftState(backup, base, current.map((d) => d.fileId)), 'restore')
  assert.equal(readContractDocumentDraft(storage, 'other-case', now), null)
})

test('an acknowledgement rebases the latest edit instead of clearing it during a slow save', () => {
  const storage = store(), first = [doc(1, '2026-05-11')], latest = [doc(1, '2026-05-11'), doc(2, '2026-05-11')]
  writeContractDocumentDraft(storage, caseId, [doc(1)], latest, now)
  writeContractDocumentDraft(storage, caseId, first, latest, now + 1)
  const backup = readContractDocumentDraft(storage, caseId, now + 2)
  assert.deepEqual(backup.base, first)
  assert.equal(contractDocumentDraftState(backup, first, latest.map((d) => d.fileId)), 'restore')
  writeContractDocumentDraft(storage, caseId, latest, latest, now + 3)
  assert.equal(readContractDocumentDraft(storage, caseId, now + 4), null)
})

test('a lost response after a committed save is not replayed and newer server data is never overwritten automatically', () => {
  const storage = store(), base = [doc(1)], current = [doc(1, '2026-05-11')]
  writeContractDocumentDraft(storage, caseId, base, current, now)
  const backup = readContractDocumentDraft(storage, caseId, now)
  assert.equal(contractDocumentDraftState(backup, current, [doc(1).fileId]), 'saved')
  assert.equal(contractDocumentDraftState(backup, [doc(1, '2026-06-01')], [doc(1).fileId]), 'conflict')
  assert.equal(contractDocumentDraftState(backup, base, []), 'conflict')
})

test('expiry, unavailable storage, malformed data and duplicate references are handled without affecting autosave', () => {
  const storage = store()
  writeContractDocumentDraft(storage, caseId, [], [doc(1)], now)
  assert.equal(readContractDocumentDraft(storage, caseId, now + 24 * 60 * 60 * 1000 + 1), null)
  assert.equal(readContractDocumentDraft(storage, caseId, now - 1), null)
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') }, removeItem() { throw new Error('blocked') } }
  assert.doesNotThrow(() => writeContractDocumentDraft(broken, caseId, [], [doc(1)], now))
  assert.equal(readContractDocumentDraft(broken, caseId, now), null)
  writeContractDocumentDraft(storage, caseId, [], [doc(1), doc(1)], now)
  assert.equal(readContractDocumentDraft(storage, caseId, now), null)
  storage.setItem(`gizmo:contract-documents:${caseId}:v1`, '{not-json')
  assert.equal(readContractDocumentDraft(storage, caseId, now), null)
})

test('server trimming is acknowledged but missing or changed document metadata is not', () => {
  assert.equal(sameContractDocuments([{ ...doc(1), type: ' Ritning ' }], [doc(1)]), true)
  assert.equal(sameContractDocuments([doc(1, '2026-05-11')], [doc(1)]), false)
  assert.equal(sameContractDocuments([doc(1)], []), false)
  const draft = (documents) => ({ contractDetails: { assignment: { documents } } })
  assert.equal(contractDocumentsAcknowledged(draft([doc(1)]), draft([doc(1)])), true)
  assert.equal(contractDocumentsAcknowledged(draft([doc(1, '2026-05-11')]), draft([doc(1)])), false)
  assert.equal(contractDocumentsAcknowledged(draft([doc(1)]), {}), false)
  assert.equal(contractDocumentsAcknowledged(draft([doc(1)]), draft([doc(140), doc(1)]), doc(140).fileId), true)
  assert.equal(contractDocumentsAcknowledged(draft([doc(140), doc(1)]), draft([doc(1)]), doc(140).fileId), true)
})

test('the editor recovers only an unlocked contract and uses the existing queue for edits made during manual saves', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  const assignment = readFileSync(new URL('../src/components/tasks/CustomerContractAssignmentEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /window\.sessionStorage/)
  assert.match(editor, /if \(!active \|\| !contractView \|\| locked \|\| recoveryChecked.current\) return/)
  assert.match(editor, /state === 'restore'\) restoreDocuments\(backup\)/)
  assert.match(editor, /documentConflict.current = backup/)
  assert.match(editor, /if \(!recoveryChecked.current \|\| documentConflict.current\) return/)
  assert.match(editor, /disabled=\{Boolean\(documentRecovery\)\}/)
  assert.match(editor, /aria-label="Behåll de sparade handlingarna"/)
  assert.match(editor, /autosave\.reset\(data.revision\)/)
  assert.match(editor, /if \(operation === 'save' && contractView && !locked &&[\s\S]*?autosave.change\(next\)/)
  assert.match(editor, /!contractDocumentsAcknowledged\(submitted.draft, result.draft/)
  assert.match(editor, /operation === 'save' && !contractDocumentsAcknowledged\(draft, data.draft/)
  assert.match(assignment, /type="date" min="0001-01-01" max="9999-12-31"/)
  assert.match(assignment, /!e.target.value \|\| e.target.validity.valid/)
})
