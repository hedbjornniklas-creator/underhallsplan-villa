import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
// @ts-expect-error Node strip-types requires the explicit extension.
import { clearConfirmedObNoteDrafts, getObTextDraftStorageKey, hasObTextDraftsForRoundTarget } from '../src/lib/ob/localTextDrafts.ts'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
  }
}
test('only server-confirmed identical note drafts are cleared, including retired editors', () => {
  const storage = memoryStorage()
  const confirmed = { id: 'n1', note: 'Saved text', risk_text: null, ftu_text: '' }
  const saved = [
    ['ob:i:mobile-round:n1', { note: 'Saved text', risk_text: '', ftu_text: '' }],
    ['ob:i:building:b1:mobile-round:n1', { note: 'Saved text', risk_text: '', ftu_text: '' }],
    ['ob:i:runda:control-item:n1:note', { value: 'Saved text' }],
    ['ob:i:insida:control-item:n1:risk_text', { value: '' }],
  ] as const
  const retained = [
    ['ob:i:utsida:control-item:n1:note', { value: 'Newer unsaved text' }],
    ['ob:other:mobile-round:n1', { note: 'Saved text', risk_text: '', ftu_text: '' }],
    ['ob:i:building:b2:mobile-round:n1', { note: 'Saved text', risk_text: '', ftu_text: '' }],
    ['ob:i:mobile-round:deleted-note', { note: 'Keep orphaned text', risk_text: '', ftu_text: '' }],
    ['ob:i:handlingar:defect_disclosures', { value: 'Saved text' }],
    ['ob:i:utsida:control-item:n1:risk_text', { value: 123 }],
  ] as const
  for (const [key, value] of [...saved, ...retained]) storage.setItem(getObTextDraftStorageKey(key)!, JSON.stringify(value))
  clearConfirmedObNoteDrafts('i', [confirmed], 'i:building:b1', storage)
  for (const [key] of saved) assert.equal(storage.getItem(getObTextDraftStorageKey(key)!), null)
  for (const [key, value] of retained) assert.equal(storage.getItem(getObTextDraftStorageKey(key)!), JSON.stringify(value))
})
test('missing server rows, corrupt JSON and a concurrently replaced draft are retained', () => {
  const storage = memoryStorage(), key = getObTextDraftStorageKey('ob:i:mobile-round:n1')!
  storage.setItem(key, 'bad json')
  clearConfirmedObNoteDrafts('i', [{ id: 'n1' }], 'i', storage)
  assert.equal(storage.getItem(key), 'bad json')
  const raw = JSON.stringify({ note: 'Saved', risk_text: '', ftu_text: '' })
  storage.setItem(key, raw)
  clearConfirmedObNoteDrafts('i', [], 'i', storage)
  assert.equal(storage.getItem(key), raw)
  let reads = 0
  const getItem = storage.getItem
  storage.getItem = current => {
    if (current === key && ++reads === 2) storage.setItem(key, 'newer draft')
    return getItem(current)
  }
  clearConfirmedObNoteDrafts('i', [{ id: 'n1', note: 'Saved' }], 'i', storage)
  assert.equal(getItem(key), 'newer draft')
})
test('note mutations ignore unrelated drafts but protect the target in every building and retired editor', () => {
  const storage = memoryStorage(), target = { kind: 'note', id: 'n1' }
  for (const key of [
    'ob:i:handlingar:defect_disclosures', 'ob:i:grunddata:attendees_other',
    'ob:i:mobile-round:n10', 'ob:i:mobile-round:orphaned-note',
    'ob:i:building:b2:mobile-round:n2', 'ob:other:mobile-round:n1',
    'ob:inspection-starting-with-i:mobile-round:n1',
  ]) storage.setItem(getObTextDraftStorageKey(key)!, 'Retain unrelated text')
  const count = storage.length
  assert.equal(hasObTextDraftsForRoundTarget('i', target, [], storage), false)
  for (const key of [
    'ob:i:mobile-round:n1', 'ob:i:building:b1:mobile-round:n1',
    'ob:i:building:b2:mobile-round:n1', 'ob:i:runda:control-item:n1:note',
    'ob:i:insida:control-item:n1:risk_text', 'ob:i:utsida:control-item:n1:ftu_text',
    'ob:i:building:b1:runda:control-item:n1:note',
  ]) {
    const fullKey = getObTextDraftStorageKey(key)!
    storage.setItem(fullKey, 'Unreadable target draft is protected too')
    assert.equal(hasObTextDraftsForRoundTarget('i', target, [], storage), true, key)
    assert.equal(storage.getItem(fullKey), 'Unreadable target draft is protected too')
    storage.removeItem(fullKey)
  }
  assert.equal(storage.length, count, 'guard never clears unrelated drafts')
})

test('room mutations protect only their notes and quick notes, including cross-building scopes', () => {
  const storage = memoryStorage(), target = { kind: 'room', id: 'r1' }
  const notes = [{ id: 'n1', interior_room_id: 'r1' }, { id: 'n2', interior_room_id: 'r2' }]
  storage.setItem(getObTextDraftStorageKey('ob:i:mobile-round:n2')!, 'Other room text')
  storage.setItem(getObTextDraftStorageKey('ob:i:runda:quick-note:interior:r10:note')!, 'Other quick note')
  assert.equal(hasObTextDraftsForRoundTarget('i', target, notes, storage), false)
  for (const key of [
    'ob:i:mobile-round:n1', 'ob:i:building:old-building:mobile-round:n1',
    'ob:i:runda:quick-note:interior:r1:note',
  ]) {
    const fullKey = getObTextDraftStorageKey(key)!
    storage.setItem(fullKey, 'Unsaved room text')
    assert.equal(hasObTextDraftsForRoundTarget('i', target, notes, storage), true)
    storage.removeItem(fullKey)
  }
  assert.equal(storage.length, 2)
})

test('image removal cannot delete note drafts; unknown targets and inaccessible storage fail closed', () => {
  const storage = memoryStorage()
  storage.setItem(getObTextDraftStorageKey('ob:i:mobile-round:n1')!, 'Unsaved')
  assert.equal(hasObTextDraftsForRoundTarget('i', { kind: 'image', id: 'image1' }, [], storage), false)
  assert.equal(hasObTextDraftsForRoundTarget('i', {}, [], storage), true)
  Object.defineProperty(storage, 'length', { get() { throw Error('Storage unavailable') } })
  assert.equal(hasObTextDraftsForRoundTarget('i', { kind: 'note', id: 'n2' }, [], storage), true)
})

test('mutation adapter uses target guards; creation, previews and renaming do not use inspection-wide guards', () => {
  const round = readFileSync(new URL('../src/components/ob/ObStepRunda.tsx', import.meta.url), 'utf8')
  assert.match(round, /operation === 'move' \|\| operation === 'remove'/)
  assert.match(round, /hasObTextDraftsForRoundTarget\(inspection.id, target, controlItems\)/)
  assert.doesNotMatch(round, /hasObTextDraftsForInspection/)
  assert.match(round, /if \(isInspectionLocked\) throw/)
  assert.match(round, /listRoundImageUploadItems\(inspection.id\)/)
  assert.match(round, /clearConfirmedObNoteDrafts\(inspection.id, confirmedNotes, draftScope\)/)
  assert.match(round, /clearConfirmedObNoteDrafts\(inspection.id, \[saved\], draftScope\)/)
})
