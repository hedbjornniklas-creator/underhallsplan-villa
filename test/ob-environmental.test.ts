import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// @ts-expect-error Node's strip-types runner requires the file extension.
import { environmentalLoader } from './helpers/environmental-load.ts'
import type * as Protocol from '../src/lib/ob/environmentalProtocol'
import type * as Appendices from '../src/lib/report/environmentalAppendices'
import type * as Spec from '../src/lib/report/reportSpec'
import type * as View from '../src/components/report/ReportSnapshotView'
import type * as Fixture from './fixtures/report-snapshot-buildings-data'

const load = environmentalLoader({
  '@/content/standardtexts/loadStandardText': { loadStandardText: () => 'Standardtext' },
  '@/lib/report/loadAppendixText': { loadAppendixText: () => 'Bilagetext' },
})
const p = load<typeof Protocol>('src/lib/ob/environmentalProtocol.ts')
const { environmentalAppendicesFromRows: appendices } = load<typeof Appendices>('src/lib/report/environmentalAppendices.ts')
const { buildReportSpec } = load<typeof Spec>('src/lib/report/reportSpec.ts')
function radon() {
  return { ...p.emptyProtocol(), include: true, fields: { instrument: 'Instrument X', started_at: '2026-09-28T08:00', ended_at: '2026-09-29T08:00' }, rows: [{ id: randomUUID(), fields: { building: 'Garage', location: 'Plan 0', value: '0', uncertainty: '' } }] }
}
test('radon accepts zero and comma decimals, never assumes an uncertainty or health verdict', () => {
  const doc = p.parseEnvironmentalProtocol(radon(), 'radon')
  assert.deepEqual(p.protocolPublicationErrors(doc, 'radon'), [])
  doc.rows[0].fields.value = '12,5'
  const a = appendices([{ kind: 'radon', document: doc }], [])[0]
  assert.match(a.rows[0].result, /12,5/)
  assert.doesNotMatch(a.rows[0].result, /Mätosäkerhet|20%|godkänd|frisk|under gränsvärde/i)
  assert.match(a.notice, /ersätter inte/)
})
test('validation rejects invalid numbers, dates, duplicate IDs and reversed periods', () => {
  for (const value of ['-1', 'NaN', 'Infinity', '12x', '1e99']) {
    const doc = radon(); doc.rows[0].fields.value = value
    assert.throws(() => p.parseEnvironmentalProtocol(doc, 'radon'))
  }
  for (const value of ['2026-02-31T10:00', '2026-09-28T25:00', '2026-09-28T12:90']) {
    const doc = radon(); doc.fields.started_at = value
    assert.throws(() => p.parseEnvironmentalProtocol(doc, 'radon'))
  }
  const doc = radon(); doc.fields.ended_at = '2026-09-27T10:00'
  assert.throws(() => p.parseEnvironmentalProtocol(doc, 'radon'), /före/)
  doc.fields.ended_at = ''; doc.rows.push(doc.rows[0])
  assert.throws(() => p.parseEnvironmentalProtocol(doc, 'radon'), /Dubbla/)
  assert.equal(p.isEnvironmentalDraft({ schema: 1 }), false)
  const partial = radon(); partial.rows[0].fields.value = '12,'
  assert.equal(p.isEnvironmentalDraft(partial), true)
})
test('unchecked protocols are omitted; incomplete included protocols block report creation', () => {
  assert.deepEqual(appendices([{ kind: 'radon', document: p.emptyProtocol() }], []), [])
  assert.throws(() => appendices([{ kind: 'radon', document: { ...p.emptyProtocol(), include: true } }], []), /minst en/)
})
test('pending mould samples are explicit, analyzed samples need result and laboratory source', () => {
  const doc = { ...p.emptyProtocol(), include: true, rows: [{ id: randomUUID(), fields: { building: 'Huvudbyggnad', location: 'Vind', sample_id: 'P1', sampled_at: '2026-09-28T12:00', method: 'Tejpprov', status: 'Inväntar laboratoriesvar', result: '' } }] }
  const a = appendices([{ kind: 'mould', document: doc }], [])[0]
  assert.match(a.rows[0].result, /Inväntar laboratoriesvar/)
  assert.doesNotMatch(a.source, /SBR/)
  doc.rows[0].fields.status = 'Analyserat'
  assert.throws(() => appendices([{ kind: 'mould', document: doc }], []), /analysresultat saknas/)
  doc.rows[0].fields.result = 'Laboratoriets bedömning'
  assert.throws(() => appendices([{ kind: 'mould', document: doc }], []), /laboratorium/)
})
test('snapshot copies results and attachment metadata; missing or foreign files cannot be included', () => {
  const doc = radon(), id = randomUUID()
  doc.attachments.push(id)
  const file = { id, kind: 'radon', name: 'original.pdf', path: 'original', sha256: 'a'.repeat(64), size: 9 }
  const a = appendices([{ kind: 'radon', document: doc }], [file])[0]
  doc.rows[0].fields.value = '999'; file.name = 'changed.pdf'
  assert.match(a.rows[0].result, /Bq\/m³\): 0/)
  assert.equal(a.files[0].name, 'original.pdf')
  assert.throws(() => appendices([{ kind: 'radon', document: doc }], []), /bilaga saknas/)
  assert.throws(() => appendices([{ kind: 'radon', document: doc }], [{ ...file, kind: 'mould' }]), /bilaga saknas/)
})
test('new PDF sections opt into paginated text; the unchanged config keeps the old spec', () => {
  const before = buildReportSpec()
  const spec = buildReportSpec({ dynamicAppendices: { environmental: [{ kind: 'radon', title: 'Radonindikering' }, { kind: 'mould', title: 'Mögelprov' }] } })
  const sections = spec.filter(section => section.id.startsWith('appendix-environmental'))
  assert.equal(sections.length, 2)
  assert.equal(sections[0].title, 'Bilaga 4: Radonindikering')
  assert.ok(sections[1].blocks.some(block => block.type === 'text' && block.paginate))
  assert.deepEqual(before, buildReportSpec())
})
test('long protocol text splitting preserves exact content and bounds newline-heavy entries', () => {
  const { protocolTextChunks } = load<{ protocolTextChunks: (text: string) => string[] }>('src/lib/report/protocolTextChunks.ts')
  for (const text of ['Laboratoriets resultat. '.repeat(400), 'ord\n'.repeat(1000), 'x'.repeat(10000)]) {
    const parts = protocolTextChunks(text)
    assert.equal(parts.join(''), text)
    assert.ok(parts.every(p => p.length <= 600 && (p.match(/\n/g) ?? []).length <= 10))
  }
})
test('actual public viewer displays frozen results and linked originals, not later changes', () => {
  const { default: Component } = load<typeof View>('src/components/report/ReportSnapshotView.tsx')
  const { snapshotWithBuildings } = load<typeof Fixture>('test/fixtures/report-snapshot-buildings-data.ts')
  const snapshot = snapshotWithBuildings(), doc = radon(), fileId = randomUUID()
  doc.attachments.push(fileId)
  snapshot.reportData.mock.appendices.environmental = appendices([{ kind: 'radon', document: doc }], [{ id: fileId, kind: 'radon', name: 'Sparat original.pdf', path: 'original', sha256: 'a'.repeat(64), size: 10 }])
  const frozen = JSON.stringify(snapshot)
  const html = renderToStaticMarkup(createElement(Component, { snapshot, environmentalFilesEndpoint: '/frozen-files' }))
  assert.match(html, /Radonindikering/); assert.match(html, /Sparat original.pdf/)
  assert.ok(html.includes(`/frozen-files?file=${fileId}`))
  assert.equal(JSON.stringify(snapshot), frozen)
  delete snapshot.reportData.mock.appendices.environmental
  assert.doesNotMatch(renderToStaticMarkup(createElement(Component, { snapshot })), /Radonindikering|Mögelprov/)
})
