import assert from 'node:assert/strict'
import { test } from 'node:test'

const textModule = '../src/lib/ob/noteText.ts'
const mobileModule = '../src/lib/ob/mobileRound.ts'
const draftModule = '../src/lib/ob/localTextDrafts.ts'
const { copyObOutcomeText, copyStatusOutcomeText, copyExistingNoteOutcomeText, readStatusNoteText } = await import(textModule) as typeof import('../src/lib/ob/noteText')
const { restoreRoundDraft } = await import(mobileModule) as typeof import('../src/lib/ob/mobileRound')
const { clearConfirmedObNoteDrafts, getObTextDraftStorageKey, hasObTextDraftsForRoundTarget } = await import(draftModule) as typeof import('../src/lib/ob/localTextDrafts')
const searchModule = '../src/lib/ob/roundSearch.ts'
const { hasNote, unfinishedFields } = await import(searchModule) as typeof import('../src/lib/ob/roundSearch')

test('status copies the existing observation without treating OB risk/FTU as recommendations', () => {
  const outcome = { note_template: 'Avvikande genomföring.', risk_template: 'OB-risk', ftu_template: 'OB-FTU' }
  assert.deepEqual(copyObOutcomeText(outcome), { note: outcome.note_template, risk_text: 'OB-risk', ftu_text: 'OB-FTU' })
  assert.deepEqual(copyStatusOutcomeText(outcome), { note: outcome.note_template, risk_text: '', ftu_text: '',
    recommendation_text: '', comment_text: '' })
  assert.equal(readStatusNoteText({ note: '', recommendation_text: 'Undersök vidare.', comment_text: 'Kommentar.' }).recommendation_text, 'Undersök vidare.')
})

test('a new catalogue selection on existing status notes preserves hidden OB and manual texts', () => {
  const original = { note: 'Tidigare', risk_text: 'Äldre OB-risk', ftu_text: 'Äldre OB-FTU',
    recommendation_text: 'Manuell rekommendation', comment_text: 'Manuell kommentar' }
  const outcome = { note_template: 'Ny notering', risk_template: 'Ny OB-risk', ftu_template: 'Ny OB-FTU' }
  assert.deepEqual({ ...original, ...copyExistingNoteOutcomeText(outcome, true) }, { ...original, note: outcome.note_template })
  assert.deepEqual(copyExistingNoteOutcomeText(outcome, false), copyObOutcomeText(outcome))
})

test('profile-bound drafts and status queues never reinterpret hidden OB fields', () => {
  const ob = copyObOutcomeText({ note_template: 'OB', risk_template: 'Risk', ftu_template: 'Utredning' })
  const status = readStatusNoteText({ note: 'STB', recommendation_text: 'Manuellt', comment_text: 'Kommentar' })
  assert.deepEqual(restoreRoundDraft(JSON.stringify(status), ob), ob)
  assert.deepEqual(restoreRoundDraft(JSON.stringify(ob), status), status)
  const hiddenOb = { risk_text: 'Risk {detalj}', ftu_text: 'Utred {plats}' }
  assert.equal(hasNote(hiddenOb, true), false)
  assert.deepEqual(unfinishedFields(hiddenOb, true), [])
  assert.equal(hasNote({ recommendation_text: 'Rekommendation' }, true), true)
  assert.deepEqual(unfinishedFields({ comment_text: '{plats}' }, true), ['{plats}'])
  assert.equal(hasNote(hiddenOb), true)
  assert.equal(unfinishedFields(hiddenOb).length, 2)
})

test('status drafts retain manual text and clear only after the same text is confirmed by the server', () => {
  const original = readStatusNoteText({ note: 'Notering', recommendation_text: 'Server', comment_text: '' })
  const draft = { ...original, recommendation_text: 'Lokalt', comment_text: 'Kvar' }
  assert.deepEqual(restoreRoundDraft(JSON.stringify(draft), original), draft)
  const entries = new Map<string, string>()
  const storage = {
    get length() { return entries.size },
    key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
    clear: () => entries.clear(),
  } as Storage
  const key = getObTextDraftStorageKey('ob:inspection:mobile-round:note')!
  storage.setItem(key, JSON.stringify(draft))
  clearConfirmedObNoteDrafts('inspection', [{ id: 'note', ...original }], 'inspection', storage)
  assert.equal(storage.getItem(key), JSON.stringify(draft))
  clearConfirmedObNoteDrafts('inspection', [{ id: 'note', ...draft }], 'inspection', storage)
  assert.equal(storage.getItem(key), null)
  // New STB keys compare only their visible fields, preserving hidden OB text
  // and independently retained old-profile drafts across all building scopes.
  const statusKey = getObTextDraftStorageKey('ob:inspection:building:b:mobile-round-status:note')!
  storage.setItem(statusKey, JSON.stringify(draft))
  storage.setItem(key, JSON.stringify({ note: 'Äldre utkast', risk_text: 'Kvar', ftu_text: '' }))
  const server = { id: 'note', ...draft, risk_text: 'Dold OB-risk', ftu_text: 'Dold OB-FTU' }
  assert.equal(hasObTextDraftsForRoundTarget('inspection', { kind: 'note', id: 'note' }, [server], storage), true)
  clearConfirmedObNoteDrafts('inspection', [server], 'inspection:building:b', storage)
  assert.equal(storage.getItem(statusKey), null)
  assert.notEqual(storage.getItem(key), null)
  // Old OB drafts have only the original three fields and still clear normally.
  storage.setItem(key, JSON.stringify({ note: 'OB', risk_text: '', ftu_text: '' }))
  clearConfirmedObNoteDrafts('inspection', [{ id: 'note', note: 'OB' }], 'inspection', storage)
  assert.equal(storage.getItem(key), null)
})
