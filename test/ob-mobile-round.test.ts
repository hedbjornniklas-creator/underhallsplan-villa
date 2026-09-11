import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
// Node needs file extensions at runtime; the project's type-only imports omit them.
const mobileModule = '../src/lib/ob/mobileRound.ts'
const searchModule = '../src/lib/ob/roundSearch.ts'
const draftModule = '../src/lib/ob/localTextDrafts.ts'
const { getInitialObSection, isObRoundSection, restoreRoundDraft } = await import(mobileModule) as typeof import('../src/lib/ob/mobileRound')
const { matchesWords, noteMatchRank, unfinishedFields } = await import(searchModule) as typeof import('../src/lib/ob/roundSearch')
const { getObTextDraftStorageKey, getObTextDraftInspectionPrefix } = await import(draftModule) as typeof import('../src/lib/ob/localTextDrafts')

test('both rounds have their own section; ordinary links keep the original start page', () => {
  assert.equal(getInitialObSection(''), 'grunddata')
  assert.equal(getInitialObSection('?round=unknown'), 'grunddata')
  assert.equal(getInitialObSection('?round=mobile-v2'), 'runda-ny')
  assert.equal(isObRoundSection('runda'), true)
  assert.equal(isObRoundSection('runda-ny'), true)
  assert.equal(isObRoundSection('review'), false)
})

test('draft restoration accepts text fields only, without changing persisted records', () => {
  const original = { note: 'Server text', risk_text: '', ftu_text: '' }
  for (const raw of [null, '', 'bad json', 'null', '[]', '{}', '{"note":123}']) {
    assert.equal(restoreRoundDraft(raw, original), original)
  }
  const draft = { note: 'New text', risk_text: 'Risk', ftu_text: 'FTU' }
  assert.deepEqual(restoreRoundDraft(JSON.stringify({ ...draft, id: 'other', status: 'ok' }), original), draft)
  assert.notEqual(restoreRoundDraft(JSON.stringify(original), original), original, 'even an equal local draft still needs a confirmed save')
  assert.equal(original.note, 'Server text')
  assert.ok(getObTextDraftStorageKey('ob:test-inspection:mobile-round:note-1')?.startsWith(getObTextDraftInspectionPrefix('test-inspection')))
})

test('search is accent insensitive, matches all words, supports synonyms and ranks note wording', () => {
  assert.ok(matchesWords('Fasad av stål med sprickbildning', 'plåt spricka'))
  assert.ok(matchesWords('FUKTSKADA vid dörr', 'fukt DÖRR'))
  assert.equal(matchesWords('Fasad av trä', 'plåt fasad'), false)
  assert.equal(noteMatchRank({ label: 'Sprickor i fasad', note_template: 'Kontroll' }, 'spricka'), 3)
  assert.equal(noteMatchRank({ label: 'Fasad', note_template: 'Sprickbildning' }, 'spricka'), 2)
  assert.deepEqual(unfinishedFields({ note: '{plats} vid {detalj}', risk_text: '{plats}' }), ['{plats}', '{detalj}'])
})

test('production integration uses existing writes and the draft guard, not the test-copy adapter', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const round = read('src/components/ob/ObStepRunda.tsx')
  const mobile = read('src/components/ob/ObMobileRound.tsx')
  const page = read('src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx')
  const wizard = read('src/components/ob/ObWizard.tsx')
  assert.match(round, /mobileLayout = false/)
  assert.match(round, /onNewNote=\{createFreeNote\}/)
  assert.match(round, /onUpdateNote=\{\(id, patch\) => updateControlItem\(id, patch, \{ throwOnError: true \}\)\}/)
  assert.match(round, /onCamera=\{openCameraCapture\}/)
  assert.match(round, /onGallery=\{openGalleryPicker\}/)
  assert.match(round, /linkSelectedImagesToControlItem\(note.id, \[image\]\)/)
  assert.match(page, /\{ key: 'runda', label: 'ÖB-runda' \}/)
  assert.match(page, /\{ key: 'runda-ny', label: 'ÖB-runda \(ny\)' \}/)
  assert.match(wizard, /case 'runda':\s+case 'runda-ny':\s+return <ObStepRunda/)
  assert.match(wizard, /mobileLayout=\{activeSection === 'runda-ny'\}/)
  assert.match(page, /showStatus=\{!isRoundSection\}/)
  assert.match(page, /!confirmLeaveIfTextDrafts\(\)/)
  assert.doesNotMatch(page, /NEXT_PUBLIC_OB_MOBILE_ROUND_V2/)
  assert.match(mobile, /getObTextDraftStorageKey/)
  assert.doesNotMatch(mobile + round, /@lab|\/lab\/|ob-safe-lab|working\.json/)
})
