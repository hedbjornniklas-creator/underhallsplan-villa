import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleDate, scheduleDateLabel, scheduleDays, scheduleTimeline } from '../src/lib/action-cases/scheduleTimeline.ts'

const row = (startDate = '', endDate = '', extra = {}) => ({ id: 'a', title: 'Testmoment', phase: '', startDate, endDate, status: 'planned', sourceItemId: null, ...extra })
test('date-only values reject impossible dates without changing the source', () => {
  for (const value of ['', '2026-02-30', '2026-1-01', 'no-date']) assert.equal(scheduleDate(value), null)
  assert.equal(scheduleDate('2028-02-29').toISOString(), '2028-02-29T00:00:00.000Z')
  assert.equal(scheduleDateLabel(''), '–')
  assert.match(scheduleDateLabel('2026-11-02'), /2 nov.*2026/)
})
test('duration counts inclusive calendar days across DST, leap days and year boundaries', () => {
  assert.equal(scheduleDays(row('2026-03-28', '2026-03-30')), 3)
  assert.equal(scheduleDays(row('2026-10-24', '2026-10-26')), 3)
  assert.equal(scheduleDays(row('2028-02-28', '2028-03-01')), 3)
  assert.equal(scheduleDays(row('2026-12-31', '2027-01-01')), 2)
  assert.equal(scheduleDays(row('2026-11-02', '2026-11-02')), 1)
  assert.equal(scheduleDays(row('2026-11-03', '2026-11-02')), null)
})
test('empty plans have no invented dates or timeline', () => {
  assert.equal(scheduleTimeline([], 'week'), null)
  assert.equal(scheduleTimeline([row()], 'month'), null)
  assert.equal(scheduleDays(row('2026-11-02')), null)
})
test('a range, partial dates and unplanned rows retain exact source order without mutation', () => {
  const rows = [row('2026-11-02','2026-11-13'), row('2026-11-04','',{ id: 'b' }), row('','2026-12-01',{ id: 'c' }), row('','',{ id: 'd' }), row('2026-11-12','2026-11-01',{ id: 'e' })]
  const before = structuredClone(rows), result = scheduleTimeline(rows, 'week')
  assert.deepEqual(rows, before)
  assert.deepEqual(result.bars.map(bar => bar.kind), ['range', 'partial', 'partial', 'unplanned', 'invalid'])
  assert.deepEqual(result.bars.map(bar => bar.id), rows.map(row => row.id))
  for (const bar of result.bars) { assert.ok(bar.left >= 0 && bar.left <= 100); assert.ok(bar.width >= 0 && bar.width <= 100) }
})
test('single-day ranges remain visible and axis includes the entire final day', () => {
  const result = scheduleTimeline([row('2026-11-02','2026-11-02')], 'week')
  assert.ok(result.bars[0].width > 0)
  assert.ok(+result.end > +scheduleDate('2026-11-02'))
  assert.equal(result.ticks[0].label, 'v 45')
})
test('month scale follows real month lengths, rather than assuming thirty days', () => {
  const result = scheduleTimeline([row('2028-02-01','2028-03-31')], 'month')
  assert.equal(result.ticks.length, 2)
  assert.ok(result.ticks[0].width < result.ticks[1].width)
  assert.equal(result.bars[0].width, 100)
})
test('ISO weeks and month headings are unambiguous across years', () => {
  const result = scheduleTimeline([row('2026-12-28','2027-01-10')], 'week')
  assert.deepEqual(result.ticks.map(t => t.label), ['v 53', 'v 01'])
  assert.ok(result.bands.some(band => band.label.includes('2026')))
  assert.ok(result.bands.some(band => band.label.includes('2027')))
})
test('large or ancient ranges and two hundred rows have bounded axes and finite geometry', () => {
  for (const mode of ['week', 'month']) {
    const result = scheduleTimeline(Array.from({ length: 200 }, (_, i) => row('0001-01-01','9999-12-31',{ id: String(i) })), mode)
    assert.equal(result.bars.length, 200)
    assert.ok(result.ticks.length < 160)
    assert.ok(result.bands.length < 90)
    assert.ok(result.width <= 16000)
    for (const bar of result.bars) assert.ok(Number.isFinite(bar.left) && Number.isFinite(bar.width))
  }
})
