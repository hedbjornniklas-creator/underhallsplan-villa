import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires explicit TypeScript imports.
import { buildingCategoryLabel, findBuildingPurposes, type BuildingCategory, type BuildingPurpose } from '../src/lib/buildings/buildingPurpose.ts'

const snapshot = JSON.parse(readFileSync(new URL('../src/lib/buildings/boverketCatalogue.json', import.meta.url), 'utf8'))
const categories: BuildingCategory[] = snapshot.entries.map((entry: BuildingPurpose) => ({ key: entry.key, label: entry.label, is_active: true, catalogue_entry: entry }))
const legacy: BuildingCategory = { key: 'guesthouse', label: 'Gästhus', catalogue_entry: null }

test('imported catalogue has authoritative versioned identities and exactly matching migration metadata', () => {
  assert.equal(snapshot.source, 'https://api.boverket.se/andamalskatalogen/v1/Catalogue')
  assert.equal(categories.length, 197)
  assert.equal(new Set(categories.map(row => row.key)).size, categories.length)
  const sql = readFileSync(new URL('../docs/db/2026-09-13_02_ob_building_purpose_catalogue.sql', import.meta.url), 'utf8')
  for (const row of categories) {
    const entry = row.catalogue_entry!
    assert.equal(row.key, `boverket:${entry.conceptNumber}:v${entry.version}`)
    assert.equal(entry.uri, `https://api.boverket.se/andamalskatalogen/v1/concepts/${entry.conceptNumber}/${entry.version}`)
    assert.equal(entry.path.at(-1), row.label)
    assert.ok(sql.includes(JSON.stringify(entry).replaceAll("'", "''")))
  }
})

test('local search prioritizes common housing purposes, accepts Swedish synonyms and disambiguates garages', () => {
  assert.equal(findBuildingPurposes(categories, '')[0].label, 'Friliggande enbostadshus')
  assert.equal(findBuildingPurposes(categories, 'villa')[0].catalogue_entry!.conceptNumber, '010101')
  assert.ok(findBuildingPurposes(categories, 'gasthus').some(row => row.catalogue_entry!.conceptNumber === '010402'))
  assert.ok(findBuildingPurposes(categories, 'friggebod').length >= 2, 'Search must not automatically classify an ambiguous everyday name')
  const garages = findBuildingPurposes(categories, 'garage')
  assert.ok(garages.length > 1)
  assert.equal(findBuildingPurposes(categories, 'bostad garage').length, 1)
  assert.equal(findBuildingPurposes(categories, '010404')[0].label, 'Garage')
  assert.equal(findBuildingPurposes(categories, 'saknashelt').length, 0)
})

test('legacy and retired categories stay readable without appearing as new official choices', () => {
  const retired = { ...categories[0], is_active: false }
  assert.equal(findBuildingPurposes([legacy, retired], '').length, 0)
  assert.equal(buildingCategoryLabel([legacy], 'guesthouse'), 'Gästhus')
  assert.equal(buildingCategoryLabel([legacy], null), null)
  assert.equal(buildingCategoryLabel([retired], retired.key), retired.label)
})

function reportReader() {
  const source = readFileSync(new URL('../src/lib/ob/buildingReport.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    assert.equal(name, './floorModel'); return { validFloorLevels: () => true }
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as typeof import('../src/lib/ob/buildingReport')
}

test('report data includes the selected immutable version, including retired versions, and fails closed on missing metadata', async () => {
  const category = categories.find(row => row.key === 'boverket:010404:v2')!
  let metadata: BuildingCategory[] = [{ ...category, is_active: false }]
  const db = { from(table: string) {
    const result = { data: table === 'ob_inspection_structure' ? { primary_part_id: 'part', revision: 3 }
      : table === 'ob_inspection_buildings' ? [{ id: 'part', category_key: category.key }]
      : table === 'ob_building_floor_models' ? [{ building_part_id: 'part', levels: null }]
      : metadata, error: null }
    return { select() { return this }, eq() { return this }, order() { return this },
      maybeSingle: async () => result, in: async () => result, then(resolve: (value: unknown) => unknown) { return Promise.resolve(result).then(resolve) } }
  } }
  const reader = reportReader()
  const state = await reader.readBuildingReportState(db as never, 'root')
  assert.deepEqual(state!.parts[0].purpose, category.catalogue_entry)
  metadata = []
  await assert.rejects(reader.readBuildingReportState(db as never, 'root'), /ändamål/)
})
