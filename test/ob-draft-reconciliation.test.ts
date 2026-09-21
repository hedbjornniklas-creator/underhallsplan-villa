import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
// @ts-expect-error Node strip-types requires the explicit extension.
import { clearConfirmedObNoteDrafts, getObTextDraftStorageKey } from '../src/lib/ob/localTextDrafts.ts'

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
test('image-note creation is exempt from unrelated text guards, moves/removals remain guarded', () => {
  const round = readFileSync(new URL('../src/components/ob/ObStepRunda.tsx', import.meta.url), 'utf8')
  assert.match(round, /operation !== 'image-note' && hasObTextDraftsForInspection\(inspection.id\)/)
  assert.match(round, /if \(isInspectionLocked\) throw/)
  assert.match(round, /listRoundImageUploadItems\(inspection.id\)/)
  assert.match(round, /clearConfirmedObNoteDrafts\(inspection.id, confirmedNotes, draftScope\)/)
})
