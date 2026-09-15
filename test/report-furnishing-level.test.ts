import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'
import type { ReactElement } from 'react'
import type { ReportSection } from '../src/lib/report/reportSpec'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { formatFurnishingLevel } from '../src/lib/report/furnishingLevel.ts'

test('report formats stored furnishing codes without exposing database keys', () => {
  assert.equal(formatFurnishingLevel('fullt_moblerad'), 'fullt m\u00f6blerad')
  assert.equal(formatFurnishingLevel('delvis_moblerad'), 'delvis m\u00f6blerad')
  assert.equal(formatFurnishingLevel('omoblerad'), 'om\u00f6blerad')
})

test('report preserves already-readable legacy text and unknown values', () => {
  for (const value of ['', 'saknas', '--', 'delvis m\u00f6blerad', 'Egen beskrivning']) {
    assert.equal(formatFurnishingLevel(value), value)
  }
})

test('server-resolved two-column conditions use the primary building furnishing value', () => {
  const text = 'Byggnaden var fullt m\u00f6blerad vid besiktningstillf\u00e4llet.'
  const dependencies: Record<string, unknown> = {
    'react/jsx-runtime': jsxRuntime,
    '@/content/standardtexts/loadStandardText': { loadStandardText: () => text },
    '@/lib/report/loadAppendixText': { loadAppendixText: () => '' },
    '@/lib/report/furnishingLevel': { formatFurnishingLevel },
    '@/components/report/ReportRendererClient': { default: () => null },
  }
  const compiled = { exports: {} }
  const output = ts.transpileModule(readFileSync(new URL('../src/components/report/ReportRenderer.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  }, compiled, compiled.exports)
  const renderer = (compiled.exports as { default: (props: object) => ReactElement<{ spec: ReportSection[] }> }).default
  const spec = [{ id: 'visual', title: 'Conditions', blocks: [{ type: 'twoColumn', rows: [{
    label: 'Conditions', value: { kind: 'standardText', id: 'STD_VISUAL_INSPECTION_CONDITIONS' },
  }] }] }]
  for (const value of ['omoblerad', 'delvis_moblerad', 'fullt_moblerad']) {
    const element = renderer({ spec, mockData: { mock: { inspection_conditions: { furnishing_level: value } } } })
    const block = element.props.spec[0].blocks[0]
    assert.equal(block.type, 'twoColumn')
    if (block.type !== 'twoColumn') throw Error('Unexpected block')
    assert.deepEqual(block.rows[0].value, { kind: 'static', text: text.replace('fullt m\u00f6blerad', formatFurnishingLevel(value)) })
  }
})
