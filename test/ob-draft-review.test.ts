import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { listObDraftEntries, clearVerifiedObDraft } from '../src/lib/ob/draftReview.ts'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return { get length() { return values.size }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) }, clear: () => values.clear() }
}
const key = (path: string) => `ob:text-draft:v1:ob:i:${path}`

test('inventory identifies current inspection drafts without deleting unknown or malformed text', () => {
  const storage = memoryStorage()
  storage.setItem(key('building:b:mobile-round:n'), JSON.stringify({ note: 'Text', risk_text: 'Risk', ftu_text: '' }))
  storage.setItem(key('handlingar:defect_disclosures'), JSON.stringify({ value: 'Fel', updatedAt: '2026-09-22' }))
  storage.setItem(key('forutsattningar:item:nofloor:0:note'), 'damaged json')
  storage.setItem(key('areamatning:form'), JSON.stringify({ value: { comment: 'Form text' } }))
  storage.setItem('ob:text-draft:v1:ob:other:mobile-round:n', 'Other inspection')
  const entries = listObDraftEntries('i', storage)
  assert.equal(entries.length, 4)
  assert.equal(entries.find(e => e.buildingId === 'b')?.values?.risk_text, 'Risk')
  assert.match(entries.find(e => e.path[0] === 'handlingar')!.title, /Upplysningar om fel/)
  assert.equal(entries.find(e => e.path[0] === 'forutsattningar')?.preview, 'damaged json')
  assert.match(entries.find(e => e.path[0] === 'areamatning')!.preview, /Form text/)
  assert.equal(storage.length, 5)
})

test('only exact server-confirmed copies can be cleared; differing, missing and concurrent text remains', () => {
  const storage = memoryStorage(), k = key('grunddata:attendees_other')
  storage.setItem(k, JSON.stringify({ value: 'Person A' }))
  const [entry] = listObDraftEntries('i', storage)
  const mismatches: (Record<string, string> | null)[] = [null, {}, { attendees_other: 'Person A ' }, { note: 'Person A' }]
  for (const saved of mismatches) {
    assert.equal(clearVerifiedObDraft(entry, saved, storage), false)
    assert.equal(storage.getItem(k), entry.raw)
  }
  storage.setItem(k, JSON.stringify({ value: 'Person B' }))
  assert.equal(clearVerifiedObDraft(entry, { attendees_other: 'Person A' }, storage), false)
  storage.setItem(k, entry.raw)
  assert.equal(clearVerifiedObDraft(entry, { attendees_other: 'Person A' }, storage), true)
  assert.equal(storage.length, 0)
})

test('empty notes require all fields to match and unknown extra content is never discarded', () => {
  const storage = memoryStorage(), k = key('mobile-round:n')
  storage.setItem(k, JSON.stringify({ note: '', risk_text: '', ftu_text: 'Utredning' }))
  const [entry] = listObDraftEntries('i', storage)
  assert.equal(clearVerifiedObDraft(entry, { note: '', risk_text: '', ftu_text: '' }, storage), false)
  assert.equal(clearVerifiedObDraft(entry, entry.values, storage), true)
  storage.setItem(k, JSON.stringify({ ...entry.values, extraText: 'Keep this too' }))
  const [unknown] = listObDraftEntries('i', storage)
  assert.equal(unknown.values, null)
  assert.equal(clearVerifiedObDraft(unknown, entry.values, storage), false)
})

test('saved-text reads are inspection-scoped, bounded and never write data', async () => {
  const calls: unknown[][] = []
  let data: Record<string, unknown> | null = { note: 'Sparat', risk_text: null, ftu_text: '' }
  let error: Error | null = null
  const query = {
    select: (fields: string) => { calls.push(['select', fields]); return query },
    eq: (field: string, value: string) => { calls.push(['eq', field, value]); return query },
    abortSignal: (signal: AbortSignal) => { assert.ok(signal instanceof AbortSignal); return query },
    maybeSingle: async () => ({ data, error }),
  }
  const output = ts.transpileModule(readFileSync(new URL('../src/lib/ob/draftReviewClient.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} as { readObDraftSavedText: (inspection: string, entry: ReturnType<typeof listObDraftEntries>[number]) => Promise<Record<string, string> | null> } }
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.equal(name, '@/lib/supabaseClient')
    return { supabase: { from: (table: string) => { calls.push(['from', table]); return query } } }
  }, compiled, compiled.exports)
  const storage = memoryStorage()
  storage.setItem(key('building:b:mobile-round:n'), JSON.stringify({ note: 'Sparat', risk_text: '', ftu_text: '' }))
  const [entry] = listObDraftEntries('i', storage)
  assert.deepEqual(await compiled.exports.readObDraftSavedText('i', entry), entry.values)
  assert.deepEqual(calls, [['from', 'inspection_control_items'], ['select', 'note,risk_text,ftu_text'], ['eq', 'inspection_id', 'i'], ['eq', 'id', 'n']])
  data = null
  assert.equal(await compiled.exports.readObDraftSavedText('i', entry), null)
  error = Error('Read failed')
  await assert.rejects(compiled.exports.readObDraftSavedText('i', entry), /Read failed/)
  const before = calls.length
  assert.equal(await compiled.exports.readObDraftSavedText('i', { ...entry, path: ['unknown'] }), null)
  assert.equal(calls.length, before)
  assert.equal(storage.getItem(entry.key), entry.raw)
})
