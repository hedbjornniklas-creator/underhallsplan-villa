import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createElement, type ComponentType, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { ReportSection } from '../src/lib/report/reportSpec'
import type { ReportSnapshotPayloadV1 } from '../src/lib/report/reportSnapshotPayload'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const cache = new Map<string, { exports: unknown }>()
const conditions = readFileSync(resolve(root, 'src/content/standardtexts/STD_VISUAL_INSPECTION_CONDITIONS.txt'), 'utf8')
const loads: string[] = []
const standard = (id: string) => {
  loads.push(id)
  return id === 'STD_VISUAL_INSPECTION_CONDITIONS' ? conditions :
    id.startsWith('STD_ASSIGNMENT_') ? `${id}: {{assignment_confirmation_date}}` : `CURRENT TEMPLATE ${id}`
}
function load(file: string): any {
  if (cache.has(file)) return cache.get(file)!.exports
  const mod = { exports: {} }; cache.set(file, mod)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === '@/content/standardtexts/loadStandardText') return { loadStandardText: standard }
    if (name === '@/lib/report/loadAppendixText') return { loadAppendixText: standard }
    if (name === '@/components/report/ReportRendererClient') return { default: () => null }
    if (name.startsWith('@/') || name.startsWith('.')) {
      const path = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(file), name)
      return load(`${path}.${existsSync(`${path}.tsx`) ? 'tsx' : 'ts'}`)
    }
    if (['react', 'react/jsx-runtime', 'lucide-react', 'next/link'].includes(name)) return require(name)
    throw Error(`Unexpected snapshot dependency: ${name}`)
  }, mod, mod.exports)
  return mod.exports
}
const { snapshotWithBuildings } = load(resolve(root, 'test/fixtures/report-snapshot-buildings-data.ts')) as {
  snapshotWithBuildings: () => ReportSnapshotPayloadV1
}
const { buildReportSpec } = load(resolve(root, 'src/lib/report/reportSpec.ts')) as {
  buildReportSpec: (options: object) => ReportSection[]
}
const { default: View } = load(resolve(root, 'src/components/report/ReportSnapshotView.tsx')) as {
  default: ComponentType<{ snapshot: ReportSnapshotPayloadV1 }>
}
const { default: PdfRenderer } = load(resolve(root, 'src/components/report/ReportRenderer.tsx')) as {
  default: (props: object) => ReactElement<{ spec: ReportSection[] }>
}
const render = (snapshot: ReportSnapshotPayloadV1) => renderToStaticMarkup(createElement(View, { snapshot }))
const snapshot = (side: ReportSnapshotPayloadV1['inspectionSide'] = 'seller') => {
  const value = snapshotWithBuildings()
  value.inspectionSide = side
  value.reportSpec = buildReportSpec({ layoutVersion: 2, inspectionSide: side,
    dynamicAppendices: { buildings: value.reportData.mock.appendices.buildings } })
  return value
}
function deepFreeze(value: unknown) {
  if (!value || typeof value !== 'object') return
  Object.values(value).forEach(deepFreeze); Object.freeze(value)
}

test('digital main-building furnishing matches the PDF for all sides, stored codes and legacy values', () => {
  for (const side of ['seller', 'buyer', 'apartment', null] as const) {
    for (const level of ['fullt_moblerad', 'delvis_moblerad', 'omoblerad', 'delvis m\u00f6blerad', 'Egen fryst beskrivning', '', '--', 'saknas', undefined]) {
      const value = snapshot(side)
      value.reportData.mock.inspection_conditions = { furnishing_level: level }
      const before = JSON.stringify(value); deepFreeze(value)
      const pdf = PdfRenderer({ spec: value.reportSpec, mockData: value.reportData, inspectionSide: side })
      const visual = pdf.props.spec.find(section => section.id === 'okular')!
      const table = visual.blocks.find(block => block.type === 'twoColumn')!
      assert.equal(table.type, 'twoColumn')
      if (table.type !== 'twoColumn') throw Error('Missing PDF conditions')
      const source = table.rows[0].value
      if (Array.isArray(source) || source.kind !== 'static') throw Error('Unresolved PDF text')
      assert.ok(render(value).includes(source.text), `${side}, ${level}: digital differs from PDF`)
      assert.equal(JSON.stringify(value), before)
    }
  }
})

test('assignment notices use the published date for seller, buyer and apartment without inventing a current date', () => {
  for (const side of ['seller', 'buyer', 'apartment'] as const) {
    const value = snapshot(side)
    value.reportData.mock.inspections.assignment_confirmation_date = '2026-10-20'
    const html = render(value)
    assert.ok(html.includes(`STD_ASSIGNMENT_${side.toUpperCase()}_NOTICE: 2026-10-20`))
    assert.doesNotMatch(html, /\{\{assignment_confirmation_date\}\}/)
  }
})

test('frozen custom text and explicit empty fields beat current templates in the digital view', () => {
  const value = snapshot()
  value.reportData.mock.inspection_conditions = { furnishing_level: 'omoblerad' }
  const assignment = value.reportSpec.find(section => section.id === 'assignment')!
  for (const block of assignment.blocks) {
    if (block.type === 'text') block.source = { kind: 'static', text: block.source.kind === 'standardText' ?
      'EXACT PUBLISHED ASSIGNMENT' : 'EXACT PUBLISHED QUALIFICATION' }
  }
  const visual = value.reportSpec.find(section => section.id === 'okular')!
  for (const block of visual.blocks) if (block.type === 'twoColumn') {
    block.rows[0].value = { kind: 'static', text: 'EXACT PUBLISHED CONDITIONS' }
    block.rows[1].value = { kind: 'static', text: '' }
  }
  const documents = value.reportSpec.find(section => section.id === 'handlingar')!.blocks.find(block => block.type === 'handlingarLayout')!
  if (documents.type !== 'handlingarLayout') throw Error('Missing document text')
  documents.infoDisclaimer = 'EXACT PUBLISHED OWNER DISCLAIMER'
  documents.renovationsLabel = 'EXACT PUBLISHED RENOVATION LABEL'
  value.reportData.mock.disclosures = { renovations: ['Renovation 1999'] }
  for (const section of value.reportSpec) {
    for (const block of section.blocks) if (block.type === 'boxedText') block.source = { kind: 'static', text: 'EXACT PUBLISHED FTU NOTICE' }
    if (section.id.startsWith('appendix-')) {
      section.appendixTextPath = `mock.frozen.${section.id}`
    }
  }
  value.reportData.mock.frozen = { 'appendix-1': 'EXACT PUBLISHED TERMS', 'appendix-2': '', 'appendix-3': 'EXACT PUBLISHED LIFESPANS' }
  const before = JSON.stringify(value); deepFreeze(value); loads.length = 0
  const html = render(value)
  for (const expected of ['ASSIGNMENT', 'QUALIFICATION', 'CONDITIONS', 'OWNER DISCLAIMER', 'RENOVATION LABEL', 'FTU NOTICE', 'TERMS', 'LIFESPANS']) {
    assert.ok(html.includes(`EXACT PUBLISHED ${expected}`), expected)
  }
  assert.equal(loads.length, 0, 'No replacement templates should be loaded for frozen text')
  assert.equal(JSON.stringify(value), before)
})

test('all inspection-specific content comes from the immutable published payload, including empty risk and FTU', () => {
  const value = snapshot()
  const mock = value.reportData.mock
  Object.assign(mock.properties, { address: 'PUBLISHED ADDRESS', municipality: 'PUBLISHED MUNICIPALITY', owner_name: 'PUBLISHED OWNER' })
  Object.assign(mock.inspections, { client_name: 'PUBLISHED CLIENT', assignment_number: 'PUBLISHED NUMBER',
    date_time: 'PUBLISHED INSPECTION TIME', attendees_text: 'PUBLISHED ATTENDEES', scope_text: 'PUBLISHED SCOPE' })
  mock.profile = { full_name: 'PUBLISHED INSPECTOR', sbr_group: 'PUBLISHED QUALIFICATION',
    certification_number: 'PUBLISHED CERTIFICATE', phone: 'PUBLISHED PHONE', email: 'published@example.invalid' }
  mock.buildingData.text = 'PUBLISHED WEATHER AND BUILDING DATA'
  mock.documents = { provided_rows: [{ title: 'PUBLISHED DOCUMENT', statusText: 'PUBLISHED DOCUMENT STATUS', note: 'PUBLISHED DOCUMENT NOTE' }] }
  mock.disclosures = { acquisition_text: 'PUBLISHED DISCLOSURE', property_faults: ['PUBLISHED FAULT'], renovations: ['PUBLISHED RENOVATION'] }
  mock.interior.blocks = [{ title: 'PUBLISHED ROOM', noteText: 'PUBLISHED NOTE', riskText: 'PUBLISHED RISK', ftuText: 'PUBLISHED FTU' },
    { title: 'PUBLISHED EMPTY ROOM', noteText: 'PUBLISHED EMPTY NOTE', riskText: '', ftuText: '' }]
  const before = JSON.stringify(value); deepFreeze(value)
  const html = render(value)
  for (const text of ['ADDRESS', 'MUNICIPALITY', 'OWNER', 'CLIENT', 'NUMBER', 'INSPECTION TIME', 'ATTENDEES', 'SCOPE',
    'INSPECTOR', 'QUALIFICATION', 'CERTIFICATE', 'PHONE', 'WEATHER AND BUILDING DATA', 'DOCUMENT', 'DOCUMENT STATUS',
    'DOCUMENT NOTE', 'DISCLOSURE', 'FAULT', 'RENOVATION', 'ROOM', 'NOTE', 'RISK', 'FTU', 'EMPTY NOTE']) {
    assert.ok(html.includes(`PUBLISHED ${text}`), text)
  }
  assert.ok(html.includes('published@example.invalid'))
  for (const text of ['Garagets frysta risktext', 'Garagets frysta FTU-text', 'Plan 0 - Garage', 'Plan 1 - Kontor']) assert.ok(html.includes(text), text)
  const empty = html.slice(html.indexOf('PUBLISHED EMPTY ROOM'), html.indexOf('data-snapshot-building'))
  assert.doesNotMatch(empty, />Risk:|>FTU:/)
  assert.equal(JSON.stringify(value), before)
})
