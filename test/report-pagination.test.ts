import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { paginateReportEntries } from '../src/lib/report/paginateReportEntries.ts'

type Entry = { id: string; kind: 'block' | 'spacer'; height: number; sectionStartOnNewPage?: boolean; context?: string; keepWithNext?: boolean }
const block = (id: string, height: number, context?: string): Entry => ({ id, kind: 'block', height, context })
const spacer = (height: number): Entry => ({ id: 'spacer', kind: 'spacer', height })
const heading = (entry: Entry) => entry.context
  ? { entry: block(`heading:${entry.context}`, 15), height: 15 }
  : null
const paginate = (entries: Entry[]) => paginateReportEntries(entries, 100, entry => entry.height, heading)
const ids = (pages: Entry[][]) => pages.map(page => page.map(entry => entry.id))

test('a photo continuing on a new page gets the same building, floor and room context', () => {
  const context = 'Bilaga 4: Guesthouse | Plan -1 - Hall'
  const entries = [block('section', 15), block('note', 70, context), block('photos-1-2', 50, context)]
  assert.deepEqual(ids(paginate(entries)), [['section', 'note'], [`heading:${context}`, 'photos-1-2']])
})

test('repeated heading height is reserved before fitting further content', () => {
  const pages = paginate([block('previous-page', 95), block('photos', 60, 'Garage'), block('next-note', 30, 'Garage')])
  assert.deepEqual(ids(pages), [['previous-page'], ['heading:Garage', 'photos'], ['heading:Garage', 'next-note']])
  for (const page of pages) assert.ok(page.reduce((height, entry) => height + entry.height, 0) <= 100)
})

test('risk, investigation and multiple photo pages retain their context without duplicating note content', () => {
  const entries = ['note', 'risk', 'ftu', 'photos-1-2', 'photos-3-4', 'photo-5'].map(id => block(id, 60, 'Plan 0 - Kitchen'))
  const before = structuredClone(entries)
  const pages = paginate(entries)
  assert.equal(pages.length, entries.length)
  assert.deepEqual(pages.flat().filter(entry => !entry.id.startsWith('heading:')), entries)
  assert.deepEqual(entries, before)
})

test('headings are not repeated between segments sharing a page', () => {
  assert.deepEqual(ids(paginate([block('section', 10), block('note', 20, 'Hall'), block('risk', 20, 'Hall'), block('photo', 40, 'Hall')])),
    [['section', 'note', 'risk', 'photo']])
})

test('changing buildings never reuses the previous building or room heading', () => {
  const entries = ['Main', 'Garage', 'Guesthouse', 'Studio'].flatMap(context => [
    { ...block(`section:${context}`, 80), sectionStartOnNewPage: true }, block(`photo:${context}`, 40, context),
  ])
  const pages = paginate(entries)
  assert.equal(pages.length, 8)
  for (const page of pages.filter(page => page[0].id.startsWith('heading:'))) {
    assert.equal(page[0].id.slice('heading:'.length), page[1].context)
  }
})

test('long measured headings reduce remaining space and exactly fitting blocks stay on the page', () => {
  const entries = [block('photo', 45, 'Long name'), block('following', 20)]
  const pages = paginateReportEntries(entries, 100, entry => entry.height,
    entry => entry.context ? { entry: block('long-heading', 35), height: 35 } : null)
  assert.deepEqual(ids(pages), [['long-heading', 'photo', 'following']])
})

test('leading and overflowing spacers never create empty pages or orphan continuation headings', () => {
  assert.deepEqual(paginate([spacer(100), spacer(20)]), [])
  assert.deepEqual(ids(paginate([spacer(5), block('note', 90), spacer(20), block('photo', 50, 'Hall')])),
    [['note'], ['heading:Hall', 'photo']])
})

test('legacy pagination without continuation headings retains explicit breaks and oversized blocks', () => {
  const entries = [block('one', 40), spacer(10), { ...block('two', 110), sectionStartOnNewPage: true }, block('three', 5)]
  assert.deepEqual(ids(paginateReportEntries(entries, 100, entry => entry.height)), [['one', 'spacer'], ['two'], ['three']])
})

test('an appendix heading follows its first note to the next page', () => {
  assert.deepEqual(ids(paginate([block('previous', 85), { ...block('interior', 10), keepWithNext: true }, block('note', 30, 'Guesthouse')])),
    [['previous'], ['interior', 'note']])
})

test('consecutive headings stay with an exactly fitting first content block', () => {
  assert.deepEqual(ids(paginate([block('previous', 20), { ...block('building', 10), keepWithNext: true },
    { ...block('conditions', 10), keepWithNext: true }, block('content', 80)])),
    [['previous'], ['building', 'conditions', 'content']])
})

test('heading groups do not override explicit page breaks or lose oversized content', () => {
  const title = { ...block('title', 10), keepWithNext: true }
  assert.deepEqual(ids(paginate([title, { ...block('new-page', 20), sectionStartOnNewPage: true }])), [['title'], ['new-page']])
  assert.deepEqual(ids(paginate([title, block('oversized', 120)])), [['title'], ['oversized']])
  assert.deepEqual(ids(paginate([title, spacer(1), block('following', 20)])), [['title', 'spacer', 'following']])
})

test('an appendix starting at a subsection retains the building heading and reserves its height', () => {
  const entries = [block('previous', 90), { ...block('interior', 10, 'Guesthouse'), keepWithNext: true }, block('note', 75)]
  assert.deepEqual(ids(paginate(entries)), [['previous'], ['heading:Guesthouse', 'interior', 'note']])
})
