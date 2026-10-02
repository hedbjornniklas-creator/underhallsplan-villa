import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { TuMeasurement, TuObservation } from '../src/lib/tu/evidence'
import type { TuPrintMeasurementRow, TuPrintPagedDocumentProps, TuPrintSection } from '../src/components/tu/TuPrintPagedDocument'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { formatTuMeasurementAssessment, formatTuMeasurementResult } from '../src/lib/tu/measurementConfig.ts'

const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
const source = readFileSync(new URL('../src/lib/tu/reportSnapshot.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('snapshot.ts', source, ts.ScriptTarget.Latest, true)
const required = new Set(['EMPTY_PRINT_VALUES', 'normalizePrintableText', 'buildTuMeasurementPrintSection', 'insertTuMeasurementPrintSection'])
const declarations = ast.statements.filter((statement) => {
  if (ts.isFunctionDeclaration(statement)) return required.has(statement.name?.text ?? '')
  return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
    (declaration) => ts.isIdentifier(declaration.name) && required.has(declaration.name.text)
  )
})
assert.equal(declarations.length, required.size)
const snapshotCode = ts.transpileModule(declarations.map((node) => node.getText(ast)).join('\n'), { compilerOptions }).outputText
const snapshot = { exports: {} as {
  buildTuMeasurementPrintSection: (observations: TuObservation[]) => TuPrintSection | null
  insertTuMeasurementPrintSection: (sections: TuPrintSection[], measurements: TuPrintSection | null) => TuPrintSection[]
} }
new Function('exports', 'formatTuMeasurementAssessment', 'formatTuMeasurementResult', snapshotCode)(
  snapshot.exports, formatTuMeasurementAssessment, formatTuMeasurementResult
)
const { buildTuMeasurementPrintSection, insertTuMeasurementPrintSection } = snapshot.exports

type Block = {
  id: string
  type: string
  rows?: Array<TuPrintMeasurementRow & { detailsText?: string; continued?: boolean }>
  commonFields?: Record<string, string>
  continuation?: boolean
}
const printerSource = readFileSync(new URL('../src/components/tu/TuPrintPagedDocument.tsx', import.meta.url), 'utf8')
const printerCode = ts.transpileModule(`${printerSource}\nexport { buildPrintableBlocks, createPagePlan, buildTocEntries, PrintableBlockView };`, { compilerOptions }).outputText
const printer = { exports: {} as {
  buildPrintableBlocks: (props: TuPrintPagedDocumentProps) => Block[]
  createPagePlan: (blocks: Block[], heights: Map<string, number>) => { pages: Block[][] }
  buildTocEntries: (props: TuPrintPagedDocumentProps, pages: Block[][]) => Array<{ label: string; pageNumber: number }>
  TuReportMeasurementTable: ComponentType<{ rows: TuPrintMeasurementRow[]; print?: boolean }>
  PrintableBlockView: ComponentType<{ block: Block }>
} }
new Function('require', 'module', 'exports', printerCode)(createRequire(import.meta.url), printer, printer.exports)

function measurement(overrides: Partial<TuMeasurement> = {}): TuMeasurement {
  return {
    id: 'm1', observationId: 'o1', location: 'Vind, vid skorsten', measurementType: 'Fuktkvot (FK)',
    valueText: '45,1', unit: '% FK', method: 'Fuktkvotsmätning med stift', instrument: 'Elma Moisture Max',
    assessment: 'deviation', note: 'Råspont', measuredAt: '', createdAt: '', updatedAt: '', ...overrides,
  }
}

function observation(measurements = [measurement()], overrides: Partial<TuObservation> = {}): TuObservation {
  return {
    id: 'o1', sourceType: 'measurement', location: 'Vind', buildingComponent: null,
    noteText: '', transcriptText: null, riskNote: null, suggestedFollowUp: null,
    certainty: 'confirmed', reviewStatus: 'reviewed', targetSectionId: null,
    includeInReport: true, reportInclusion: 'include', imageIds: [], measurements,
    audioStorageBucket: null, audioStoragePath: null, audioContentType: null, audioDurationSeconds: null,
    observedAt: '', createdAt: '', updatedAt: '', ...overrides,
  }
}

function props(sections: TuPrintSection[]): TuPrintPagedDocumentProps {
  return {
    companyLogoUrl: null, companyLogoAlt: '', coverTitle: '', coverImage: null, parties: null,
    metaRows: [], objectRows: [], sections, signature: null, appendixImages: [],
    header: { documentTitle: '', objectIdentifierLabel: '', objectIdentifier: '', projectType: '', reportDate: '', address: '', assignmentNumber: '' },
    footer: { companyLines: [], contactLines: [] },
  }
}

function rows(measurements: TuMeasurement[]) {
  return buildTuMeasurementPrintSection([observation(measurements)])!.measurements!
}

function render(rows: TuPrintMeasurementRow[]) {
  return renderToStaticMarkup(createElement(printer.exports.TuReportMeasurementTable, { rows, print: true }))
}

test('measurement table preserves saved values, assessments, metadata, notes and order', () => {
  const section = buildTuMeasurementPrintSection([observation([
    measurement(), measurement({ id: 'm2', location: 'Norra sidan', valueText: '9,1', assessment: 'no_deviation' }),
  ])])!
  assert.equal(section.subsections, undefined)
  assert.deepEqual(section.measurements?.[0], {
    id: 'measurement-m1', location: 'Vind, vid skorsten', measurementType: 'Fuktkvot (FK)',
    result: '45,1 % FK', assessment: 'Avvikande resultat', method: 'Fuktkvotsmätning med stift',
    instrument: 'Elma Moisture Max', note: 'Råspont',
  })
  assert.equal(section.measurements?.[1].result, '9,1 % FK')
  assert.equal(section.measurements?.[1].assessment, 'Ingen avvikelse noterad')
  assert.deepEqual(JSON.parse(JSON.stringify(section)), section)
})

test('only reviewed, included measurements appear and empty sections are omitted', () => {
  const data = [observation([], {}), observation([measurement()], { reviewStatus: 'draft' }),
    observation([measurement()], { includeInReport: false, reportInclusion: 'internal' })]
  assert.equal(buildTuMeasurementPrintSection(data), null)
  assert.equal(buildTuMeasurementPrintSection([...data, observation()])?.measurements?.length, 1)
})

test('missing metadata stays missing and location falls back to the observation', () => {
  const row = rows([measurement({ location: ' ', instrument: null, method: null, assessment: null, note: null })])[0]
  assert.equal(row.location, 'Vind')
  assert.equal(row.method, '')
  assert.equal(row.instrument, '')
  assert.equal(row.assessment, '')
  assert.doesNotMatch(render([row]), /Ingen avvikelse|Metod:|Instrument:/u)
})

test('shared instrument and method appear once above the table', () => {
  const html = render(rows([measurement(), measurement({ id: 'm2' })]))
  assert.equal((html.match(/Elma Moisture Max/gu) ?? []).length, 1)
  assert.equal((html.match(/Fuktkvotsmätning med stift/gu) ?? []).length, 1)
  assert.match(html, /<table[^>]+aria-label="Mätningar"/u)
  assert.match(html, /Kontrollplats/u)
  assert.match(html, /Resultat/u)
  assert.match(html, /Bedömning/u)
  assert.match(html, /font-size:inherit;line-height:inherit/u)
})

test('different or partly missing metadata is attached only to its own row', () => {
  const data = rows([
    measurement(),
    measurement({ id: 'm2', measurementType: 'Fuktindikering', valueText: '62', instrument: 'Annat instrument', method: 'Indikativ ytmätning' }),
    measurement({ id: 'm3', instrument: null, method: null }),
  ])
  const html = render(data)
  const body = html.split('<tbody>')[1].split('</tbody>')[0]
  const renderedRows = body.match(/<tr[\s\S]*?<\/tr>/gu)!
  assert.match(renderedRows[0], /Instrument: Elma Moisture Max/u)
  assert.match(renderedRows[1], /Instrument: Annat instrument/u)
  assert.match(renderedRows[1], /62 \(indikationsvärde\)/u)
  assert.doesNotMatch(renderedRows[1], /62 %/u)
  assert.doesNotMatch(renderedRows[2], /Instrument:|Metod:/u)
})

test('measurement table follows observations without changing authored report text', () => {
  const sections = [
    { id: 'a', key: 'observed_execution', title: 'Iakttagelser', text: 'Manuellt justerad text.' },
    { id: 'b', key: 'assessment', title: 'Bedömning', text: 'Manuell bedömning.' },
  ]
  const table = buildTuMeasurementPrintSection([observation()])!
  const result = insertTuMeasurementPrintSection(sections, table)
  assert.deepEqual(result, [sections[0], table, sections[1]])
  assert.equal(sections.length, 2)
})

test('old snapshots keep their measurement subsections', () => {
  const section = { id: 'old', key: 'measurements', title: 'Mätningar', text: '', subsections: [
    { id: 'm1', title: 'Vind', text: 'Resultat: 17 % FK' },
  ] }
  const blocks = printer.exports.buildPrintableBlocks(props([section]))
  assert.deepEqual(blocks.map((block) => block.type), ['section', 'subsection'])
})

test('oversized comments become bounded continuation rows without losing text or repeating results', () => {
  const note = Array.from({ length: 400 }, (_, index) => `Kommentar${index}`).join(' ')
  const section = buildTuMeasurementPrintSection([observation([measurement({ note })])])!
  const blocks = printer.exports.buildPrintableBlocks(props([section]))
  const parts = blocks[0].rows!
  assert.ok(parts.length > 10)
  assert.ok(parts.every((row) => row.detailsText!.length <= 320))
  assert.equal(parts.filter((row) => row.result === '45,1 % FK').length, 1)
  assert.equal(parts.filter((row) => row.assessment === 'Avvikande resultat').length, 1)
  assert.equal(parts.map((row) => row.detailsText).join(' '), `Vind, vid skorsten Kommentar: ${note}`)
  assert.ok(parts.slice(1).every((row) => row.continued))
  assert.equal(section.measurements![0].note, note)
})

test('digital reports include measurement-only sections in both contents and report body', () => {
  const publicSource = readFileSync(new URL('../src/components/tu/TuPublicReportSnapshotView.tsx', import.meta.url), 'utf8')
  const publicCode = ts.transpileModule(publicSource, { compilerOptions }).outputText
  const publicView = { exports: {} as { default: ComponentType<{ snapshot: object }> } }
  const require = createRequire(import.meta.url)
  new Function('require', 'module', 'exports', publicCode)((name: string) => {
    if (name === '@/components/tu/TuPublicReportToolbar') return { default: () => null }
    if (name === '@/components/tu/TuPrintPagedDocument') return printer.exports
    return require(name)
  }, publicView, publicView.exports)
  const section = buildTuMeasurementPrintSection([observation()])!
  const html = renderToStaticMarkup(createElement(publicView.exports.default, {
    snapshot: { createdAt: null, report: props([section]) },
  }))
  assert.match(html, /href="#section-1"/u)
  assert.match(html, /id="section-1"/u)
  assert.match(html, /<table[^>]+aria-label="Mätningar"/u)
  assert.match(html, /45,1 % FK/u)
  assert.match(html, /Avvikande resultat/u)
})

test('long tables paginate at row boundaries with repeated headers, metadata and correct TOC', () => {
  const section = buildTuMeasurementPrintSection([observation(Array.from({ length: 40 }, (_, index) =>
    measurement({ id: `m${index}`, instrument: index === 39 ? 'Annat instrument' : 'Elma Moisture Max' })
  ))])!
  const input = props([{ id: 'a', key: 'background', title: 'Bakgrund', text: 'Inledning.' }, section])
  const blocks = printer.exports.buildPrintableBlocks(input)
  const table = blocks[1]
  const heights = new Map([[blocks[0].id, 650], [table.id, 150 + 40 * 35],
    ...table.rows!.map((row): [string, number] => [`${table.id}:${row.id}`, 35])])
  const { pages } = printer.exports.createPagePlan(blocks, heights)
  assert.equal(pages[0].length, 1, 'Heading and first measurement must move together')
  const fragments = pages.flat().filter((block) => block.type === 'measurements')
  assert.equal(fragments.length, 3)
  assert.deepEqual(fragments.flatMap((block) => block.rows), section.measurements)
  assert.equal(fragments[0].continuation, false)
  for (const block of fragments) {
    assert.equal(block.commonFields?.instrument, '', 'Pagination must not change which metadata is shared')
    assert.ok(150 + block.rows!.length * 35 <= (218 * 96) / 25.4)
    const html = renderToStaticMarkup(createElement(printer.exports.PrintableBlockView, { block }))
    assert.match(html, /<thead/u)
    assert.match(html, /2\. Mätningar/u)
    assert.match(html, /Fuktkvotsmätning med stift/u)
  }
  assert.equal(printer.exports.buildTocEntries(input, pages)[1].pageNumber, 3)
})
