import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL(
  '../src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx', import.meta.url
), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
// Exercise the page's actual pure menu builder without loading React or Next.
const menuSource = source.statements.filter(statement =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === 'getVisibleSections'
  || ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
    ts.isIdentifier(declaration.name) && declaration.name.text === 'SECTIONS'
  )
).map(statement => statement.getText(source)).join('\n')
const getSections = new Function(ts.transpileModule(menuSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText + '\nreturn getVisibleSections;')() as (
  apartment: boolean, area: boolean, moisture: boolean,
  buildings?: { structure: object | null; parts: { id: string; name: string }[] } | null
) => { key: string; label: string; partId?: string }[]

test('each building has its conditions immediately followed by its round, preserving order and identity', () => {
  for (const count of [1, 2, 4, 20]) {
    const parts = Array.from({ length: count }, (_, index) => ({ id: `part-${index}`, name: `Hus ${index + 1}` }))
    const before = structuredClone(parts)
    const sections = getSections(false, false, false, { structure: {}, parts })
    assert.deepEqual(sections.map(row => row.key), ['grunddata', 'handlingar',
      ...parts.flatMap(() => ['forutsattningar', 'runda-ny']), 'review', 'delivery'])
    assert.deepEqual(sections.slice(2, -2).map(row => row.partId), parts.flatMap(part => [part.id, part.id]))
    for (const [key, label] of [['forutsattningar', 'Förutsättningar'], ['runda-ny', 'ÖB-runda']]) {
      assert.deepEqual(sections.filter(row => row.key === key), parts.map(part => ({
        key, label: `${label} · ${part.name}`, partId: part.id,
      })))
    }
    assert.equal(new Set(sections.map(row => `${row.key}:${row.partId ?? ''}`)).size, sections.length)
    assert.deepEqual(parts, before)
  }
})

test('all inspections expose the round without the retired inside/outside editors', () => {
  const keys = ['grunddata', 'handlingar', 'forutsattningar', 'runda-ny', 'review', 'delivery']
  for (const buildings of [undefined, null, { structure: null, parts: [] }]) {
    assert.deepEqual(getSections(false, false, false, buildings).map(row => row.key), keys)
    assert.deepEqual(getSections(true, false, false, buildings).map(row => row.key), keys.filter(key => key !== 'utsida'))
    assert.deepEqual(getSections(false, false, false, buildings).filter(row => row.key.startsWith('runda')), [
      { key: 'runda-ny', label: 'ÖB-runda' },
    ])
  }
})

test('shared add-ons and completion steps follow all building rounds', () => {
  const sections = getSections(false, true, true, { structure: {}, parts: [{ id: 'a', name: 'Hus' }, { id: 'b', name: 'Hus' }] })
  assert.deepEqual(sections.slice(-4), [
    { key: 'areamatning', label: 'Areamätning' }, { key: 'fuktkontroll', label: 'Fuktkontroll' },
    { key: 'review', label: 'Granska' }, { key: 'delivery', label: 'Skicka utlåtande' },
  ])
  assert.deepEqual(sections.filter(row => row.key === 'runda-ny').map(row => row.partId), ['a', 'b'])
})
