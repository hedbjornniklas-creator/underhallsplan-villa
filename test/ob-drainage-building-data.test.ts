import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { OverviewSelection } from '../src/lib/report/buildingData'

const readSource = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readSource(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    compiled,
    compiled.exports,
  )
  return compiled.exports as T
}

const template = readSource('src/content/standardtexts/STD_BUILDING_DATA_TEMPLATE.txt')
const report = load<typeof import('../src/lib/report/buildingData')>(
  'src/lib/report/buildingData.ts',
  {
    'server-only': {},
    '@/content/standardtexts/loadStandardText': {
      loadStandardText: (id: string) => {
        assert.equal(id, 'STD_BUILDING_DATA_TEMPLATE')
        return template
      },
    },
    '@/lib/ob/floorModel': load('src/lib/ob/floorModel.ts', {}),
  },
)

const drainageItem = { id: 'drainage-item', key: 'item_ye11n', label: 'Dränering' }
const input = (note: string | null, values: OverviewSelection['values'] = {}) => ({
  items: [drainageItem],
  groups: [],
  options: [],
  selections: [{ overview_item_id: drainageItem.id, values, note }],
})

test('shared report keys include the configured drainage key without losing existing categories', () => {
  assert.deepEqual(new Set(report.BUILDING_DATA_OVERVIEW_ITEM_KEYS), new Set([
    'weather', 'building_type', 'building_form', 'building_year', 'foundation',
    'item_ye11n', 'structure', 'frame', 'joist', 'joists', 'facade', 'windows',
    'roof', 'heating', 'ventilation', 'water', 'sewage', 'sewer',
  ]))
  assert.equal(
    report.BUILDING_DATA_OVERVIEW_ITEM_KEYS.length,
    new Set(report.BUILDING_DATA_OVERVIEW_ITEM_KEYS).size,
  )
})

test('configured drainage category preserves note-only selections with empty or null values', () => {
  for (const values of [{}, null]) {
    const map = report.buildBuildingDataMap(input('  Dräneringen uppges vara från 2018.  ', values))
    assert.equal(map['Dränering:'], 'Dräneringen uppges vara från 2018.')
    assert.match(
      report.renderBuildingDataTextFromTemplate(map),
      /^Dränering: Dräneringen uppges vara från 2018\.$/m,
    )
  }
})

test('drainage supports structured option labels together with a free note', () => {
  const map = report.buildBuildingDataMap({
    ...input('Uppgift från säljaren.', { type: 'pipe', year: 2018 }),
    groups: [
      { id: 'drainage-type', overview_item_id: drainageItem.id, key: 'type', sort_order: 1 },
      { id: 'drainage-year', overview_item_id: drainageItem.id, key: 'year', sort_order: 2 },
    ],
    options: [{ group_id: 'drainage-type', value: 'pipe', label: 'Dräneringsledning' }],
  })
  assert.equal(map['Dränering:'], 'Dräneringsledning, 2018. Uppgift från säljaren.')
})

test('unfilled drainage does not add an empty row to existing reports', () => {
  for (const note of [null, '', '   ', '--']) {
    const map = report.buildBuildingDataMap(input(note))
    assert.equal(map['Dränering:'], '--')
    assert.doesNotMatch(report.renderBuildingDataTextFromTemplate(map), /^Dränering:/m)
  }
  const map = report.buildBuildingDataMap({ items: [], groups: [], options: [], selections: [] })
  assert.doesNotMatch(report.renderBuildingDataTextFromTemplate(map), /^Dränering:/m)
})

test('filled drainage appears directly after foundation and before frame in the standard template', () => {
  const map = report.buildBuildingDataMap({
    ...input('Ålder okänd.'),
    conditions: { foundation: 'Platta på mark', frame: 'Trä' },
  })
  const text = report.renderBuildingDataTextFromTemplate(map)
  assert.match(text, /Grundläggning: Platta på mark\nDränering: Ålder okänd\.\nStomme: Trä/)
  assert.equal(text.match(/^Dränering:/gm)?.length, 1)
})

test('unrelated overview items are not accidentally mapped to drainage', () => {
  const map = report.buildBuildingDataMap({
    items: [{ id: 'unrelated', key: 'item_other', label: 'Annan kategori' }],
    groups: [],
    options: [],
    selections: [{ overview_item_id: 'unrelated', values: {}, note: 'Orelaterad uppgift.' }],
    conditions: { foundation: 'Krypgrund' },
  })
  const text = report.renderBuildingDataTextFromTemplate(map)
  assert.equal(map['Dränering:'], '--')
  assert.equal(map['Grundläggning:'], 'Krypgrund')
  assert.doesNotMatch(text, /Dränering:|Orelaterad uppgift/)
})

test('buyer and seller reports include drainage but apartment ignores even stale multiline selections', () => {
  const note = 'Dräneringen uppges vara omlagd.\nÅrtal: 2018\nUnderlag saknas.'
  for (const inspectionSide of ['buyer', 'seller']) {
    const map = report.buildBuildingDataMap({ ...input(note), inspectionSide })
    assert.equal(map['Dränering:'], note)
    assert.ok(report.renderBuildingDataTextFromTemplate(map).includes(`Dränering: ${note}`))
  }
  const map = report.buildBuildingDataMap({
    ...input(note),
    inspectionSide: 'apartment',
    conditions: { weather: 'Klart', building_year: 2020 },
  })
  const text = report.renderBuildingDataTextFromTemplate(map)
  assert.equal(map['Dränering:'], '--')
  assert.doesNotMatch(text, /Dränering:|omlagd|Årtal:|2018|Underlag saknas/)
  assert.equal(map['Väderlek:'], 'Klart')
  assert.equal(map['Byggnadsår:'], '2020')
})

test('adding drainage leaves existing component labels, notes and conditions unchanged', () => {
  const map = report.buildBuildingDataMap({
    ...input('Från byggnadsåret.'),
    items: [drainageItem, { id: 'foundation', key: 'foundation' }],
    groups: [{ id: 'foundation-type', overview_item_id: 'foundation', key: 'type' }],
    options: [{ group_id: 'foundation-type', value: 'slab', label: 'Platta på mark' }],
    selections: [
      ...input('Från byggnadsåret.').selections,
      { overview_item_id: 'foundation', values: { type: 'slab' }, note: 'Delvis källare.' },
    ],
    conditions: { frame: 'Trä', roof: 'Takpannor', heating: 'Fjärrvärme', sewer: 'Kommunalt' },
  })
  assert.equal(map['Grundläggning:'], 'Platta på mark. Delvis källare.')
  assert.equal(map['Stomme:'], 'Trä')
  assert.equal(map['Yttertak:'], 'Takpannor')
  assert.equal(map['Uppvärmning:'], 'Fjärrvärme')
  assert.equal(map['Avlopp:'], 'Kommunalt')
  assert.equal(map['Dränering:'], 'Från byggnadsåret.')
})

for (const path of [
  'src/app/utlatande/[propertyId]/[inspectionId]/page.tsx',
  'src/lib/report/pdfV2/buildReportDataV2.ts',
]) {
  test(`${path} uses the shared overview keys and forwards inspection side`, () => {
    const source = readSource(path)
    assert.match(source, /import\s*\{[^}]*\bBUILDING_DATA_OVERVIEW_ITEM_KEYS\b[^}]*\}\s*from\s*['"]@\/lib\/report\/buildingData['"]/s)
    assert.match(source, /\.in\(\s*['"]key['"]\s*,\s*BUILDING_DATA_OVERVIEW_ITEM_KEYS\s*\)/)
    assert.match(source, /buildBuildingDataMap\(\{[^}]*\binspectionSide\b[^}]*\}\)/s)
  })
}
