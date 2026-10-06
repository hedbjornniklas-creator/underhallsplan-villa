import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
type Row = Record<string, any>
type QueryLog = { table: string; select: string }

function fixture(status = true, failureTable?: string) {
  const frozenTerms = 'Frysta statusvillkor.'
  const frozenHash = createHash('sha256').update(frozenTerms).digest('hex')
  const frozenAssignment = { id: 'assignment', org_id: 'org', assignment_type: 'STATUS',
    scope_description: 'Endast badrummet på plan 1.', accepted_at: '2026-10-01',
    terms_version: 'stb-test', terms_document_hash: frozenHash }
  const rows: Record<string, Row[]> = {
    inspections: [{ id: 'inspection', property_id: 'property', date: '2026-10-02',
      inspection_side: status ? 'status' : 'buyer', inspection_variant: status ? 'SB' : 'OB', type: 'OB',
      assignment_number: '2026-1002-01', scope: 'main_building', assignment_confirmation_delivered_date: '2026-10-01' }],
    properties: [{ id: 'property', cadastral_id: 'TEST 1:1', address: 'Testgatan 1' }],
    assignments: [{ ...frozenAssignment, assignment_type: status ? 'STATUS' : 'OB', inspection_id: 'inspection' }],
    assignment_confirmation_snapshots: [{ org_id: 'org', assignment_id: 'assignment',
      schema_version: 'ob-confirmation-v1', accepted_at: frozenAssignment.accepted_at,
      snapshot_payload: { assignment: { ...frozenAssignment }, terms: { text: frozenTerms,
        role: 'status', verbatim: true, version: frozenAssignment.terms_version, documentHash: frozenHash },
        inspector: {}, addonOrders: [], acceptancePayload: {} } }],
    inspection_conditions: [{ furnishing_level: 'delvis_moblerad' }],
    settings_exterior_items: [{ id: 'roof', label: 'Yttertak' }, { id: 'wall', label: 'Fasad' }],
    // Seeded observations and rooms exist even before anyone inspects them.
    inspection_exterior_observations: [{ id: 'unvisited-roof', exterior_item_id: 'roof', note: '', values: {} }],
    inspection_interior_rooms: [
      { id: 'bathroom', floor_label: 'plan1', room_label: 'Badrum', room_type_key: 'bathroom', note: '', values: {} },
      { id: 'bedroom', floor_label: 'plan2', room_label: 'Sovrum', room_type_key: 'bedroom', note: '', values: {} },
      { id: 'ok-room', floor_label: 'plan1', room_label: 'Hall', room_type_key: 'hall', note: '', values: {} },
    ],
    inspection_control_items: [
      { id: 'note', interior_room_id: 'bathroom', exterior_observation_id: null, control_point_id: 'wetroom',
        note: 'Tätskiktsanslutningen kunde inte verifieras.', risk_text: 'Sparad ÖB-risk', ftu_text: 'Sparad ÖB-FTU',
        recommendation_text: 'Kontrollera dokumentationen.', comment_text: 'Endast synliga delar omfattas.' },
      { id: 'recommendation-only', interior_room_id: 'bathroom', exterior_observation_id: null, control_point_id: null,
        note: '', risk_text: '', ftu_text: '', recommendation_text: 'Begär installationsanvisningen.', comment_text: '' },
      { id: 'ok-control', interior_room_id: 'ok-room', exterior_observation_id: null, control_point_id: 'wall',
        note: '', status: 'ok', selected_outcome_id: null, risk_text: '', ftu_text: '' },
    ],
  }
  const calls: QueryLog[] = []
  const db = { auth: { getUser: async () => ({ data: { user: null } }) }, from(table: string) {
    const call = { table, select: '' }
    calls.push(call)
    let single = false
    const filters: Array<(row: Row) => boolean> = []
    const chain = {
      select(columns: string) { call.select = columns; return chain },
      eq(column: string, value: unknown) {
        // Most fixture rows omit scope keys. Filter only keys actually supplied.
        filters.push(row => !(column in row) || row[column] === value); return chain
      },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return chain },
      not(column: string, _operator: string, value: unknown) { filters.push(row => row[column] !== value); return chain },
      is(column: string, value: unknown) { filters.push(row => !(column in row) || row[column] === value); return chain },
      order() { return chain }, limit() { return chain },
      maybeSingle() { single = true; return chain },
      then(onResolve: (value: unknown) => unknown, onReject?: (error: unknown) => unknown) {
        const result = (rows[table] ?? []).filter(row => filters.every(filter => filter(row)))
        return Promise.resolve({ data: failureTable === table ? null : single ? result[0] ?? null : result,
          error: failureTable === table ? { message: 'Test query failure' } : null }).then(onResolve, onReject)
      },
    }
    return chain
  } }
  return { rows, calls, db }
}

function loadBuilder(db: unknown) {
  const cache = new Map<string, { exports: any }>()
  const stubs: Record<string, unknown> = {
    'server-only': {},
    '@/lib/supabase/server': { createSupabaseServerClient: () => db },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/ob/organizationBindings': { requireObInspectionContext: async (id: string) => {
      assert.equal(id, 'inspection')
      return { orgId: 'org', userId: 'inspector' }
    } },
    '@/lib/ob/reportIdentity': { resolveObReportIdentity: async (input: { orgId: string; profileId: string }) => {
      assert.equal(input.orgId, 'org'); assert.equal(input.profileId, 'inspector')
      return { full_name: 'Inspector', company_name: 'Organization', company_website: null }
    } },
    '@/lib/report/buildingData': { BUILDING_DATA_OVERVIEW_ITEM_KEYS: [], buildBuildingDataMap: () => ({}),
      buildBuildingTypeParts: () => ({ TYPE: '' }), renderBuildingDataTextFromTemplate: () => '' },
    '@/lib/ob/floorModelStore': { readObFloorModel: async () => null },
    '@/lib/report/profileWebsite': { readReportWebsite: async () => null },
    '@/lib/report/environmentalAppendices': { readEnvironmentalAppendices: async () => [] },
    '@/lib/ob/buildingReport': { readBuildingReportState: async () => null, assertBuildingReportRevision: async () => {} },
    '@/lib/ob/buildingStructure': { buildingCoverPath: () => null },
    '@/lib/ob/floorModel': {},
    '@/lib/ob/assignmentWorkflowServer': { getObAssignmentWorkflow: async () => ({ canDeliver: true }) },
    '@/lib/certifications/profileResolver': { resolveInspectorCertificationSummary: async () => ({ summary: { all_selected_items: [] } }) },
  }
  function load(file: string): any {
    if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'))
    if (cache.has(file)) return cache.get(file)!.exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText
    new Function('require', 'module', 'exports', source)((name: string) => {
      if (name in stubs) return stubs[name]
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(file), name)
        return load(existsSync(target) ? target : `${target}.ts`)
      }
      return require(name)
    }, mod, mod.exports)
    return mod.exports
  }
  return load(resolve(root, 'src/lib/report/pdfV2/buildReportDataV2.ts')).buildReportDataV2 as
    (params: { propertyId: string; inspectionId: string }) => Promise<{ mock: any }>
}

test('STB builder freezes scope and source and excludes untouched rooms and exterior placeholders', async () => {
  const f = fixture()
  const result = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(result.mock.inspections.side, 'status')
  assert.equal(result.mock.inspections.scope_text, 'Endast badrummet på plan 1.')
  assert.equal(result.mock.status_report.furnishing, 'delvis möblerad')
  assert.equal(result.mock.status_report.source.version, '2026.2')
  assert.match(result.mock.status_report.assignmentNotice, /till uppdragsgivaren 2026-10-01\./)
  assert.match(result.mock.status_report.terms, /Statusbesiktning enligt SBR-modellen\n\n\(2026\.1\)/)
  assert.deepEqual(result.mock.exterior.blocks, [])
  assert.equal(result.mock.interior.blocks.length, 3)
  assert.deepEqual(result.mock.interior.blocks[0], {
    title: 'Plan 1 - Badrum', noteText: 'Tätskiktsanslutningen kunde inte verifieras.', riskText: '', ftuText: '',
    recommendationText: 'Kontrollera dokumentationen.', commentText: 'Endast synliga delar omfattas.', photoUrls: [], hasDeviations: true,
  })
  assert.equal(result.mock.interior.blocks[1].noteText, '')
  assert.equal(result.mock.interior.blocks[1].recommendationText, 'Begär installationsanvisningen.')
  assert.equal(result.mock.interior.blocks[2].noteText, '-----', 'only an actually inspected OK room can become normal')
  assert.doesNotMatch(JSON.stringify(result), /Sparad ÖB-risk|Sparad ÖB-FTU|Sovrum/)
  assert.equal(result.mock.disclosures.acquisition_text, '')
  for (const call of f.calls.filter(call => call.table === 'inspection_control_items' || call.table === 'inspection_exterior_observations')) {
    assert.match(call.select, /recommendation_text, comment_text/)
  }
})

test('legacy OB builder keeps saved risk and FTU and does not require the new note columns', async () => {
  const f = fixture(false)
  const result = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(result.mock.inspections.side, 'buyer')
  assert.equal(result.mock.status_report, undefined)
  assert.ok(result.mock.interior.blocks.some((block: Row) => block.riskText === 'Sparad ÖB-risk' && block.ftuText === 'Sparad ÖB-FTU'))
  assert.ok(result.mock.interior.blocks.some((block: Row) => block.title === 'Plan 2 - Sovrum' && block.noteText === '--'))
  assert.equal(result.mock.exterior.blocks.length, 2)
  assert.equal(result.mock.disclosures.acquisition_text, 'Säljaren förvärvade fastigheten --.')
  assert.equal(f.calls.some(call => call.table === 'assignment_confirmation_snapshots'), false)
  for (const call of f.calls.filter(call => call.table === 'inspection_control_items' || call.table === 'inspection_exterior_observations')) {
    assert.doesNotMatch(call.select, /recommendation_text|comment_text/)
  }
})

test('STB uses the verified confirmation archive even if live scope or approval dates are edited', async () => {
  const f = fixture()
  f.rows.assignments[0].scope_description = 'Live edited scope that was never agreed.'
  f.rows.assignments[0].accepted_at = '2026-12-31'
  f.rows.inspections[0].assignment_confirmation_delivered_date = '2026-12-30'
  const result = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(result.mock.inspections.scope_text, 'Endast badrummet på plan 1.')
  assert.equal(result.mock.inspections.assignment_confirmation_date, '2026-10-01')
  assert.match(result.mock.status_report.assignmentNotice, /till uppdragsgivaren 2026-10-01\./)
  assert.doesNotMatch(JSON.stringify(result), /Live edited scope|2026-12-31|2026-12-30/)
  assert.equal(f.calls.filter(call => call.table === 'assignment_confirmation_snapshots').length, 1)
})

test('direct STB without a confirmation keeps inspection scope and does not claim the confirmation was delivered or reviewed', async () => {
  const f = fixture()
  f.rows.assignments = []
  f.rows.assignment_confirmation_snapshots = []
  f.rows.inspections[0].scope = 'Endast duschutrymmet på plan 1.'
  const result = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(result.mock.inspections.scope_text, 'Endast duschutrymmet på plan 1.')
  assert.equal(result.mock.inspections.assignment_confirmation_date, '')
  assert.equal(result.mock.inspections.assignment_confirmation_text, '')
  const text = result.mock.status_report.assignmentNotice
  assert.doesNotMatch(text, /överlämnades|gjordes en genomgång|uppdragsgivaren --/)
  assert.match(text, /Uppdraget utförs enligt ”villkor för statusbesiktning enligt SBR-modellen”\./)
  assert.match(text, /Besiktningsmannen ansvarar inte för fel/)
  assert.equal(f.calls.some(call => call.table === 'assignment_confirmation_snapshots'), false)
})

test('unapproved STATUS confirmation never supplies mutable scope or unsupported delivery claims', async () => {
  const f = fixture()
  f.rows.assignments[0].accepted_at = null
  f.rows.assignments[0].scope_description = 'Live draft scope, not agreed.'
  f.rows.assignment_confirmation_snapshots = []
  f.rows.inspections[0].scope = 'Endast bastun.'
  const result = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(result.mock.inspections.scope_text, 'Endast bastun.')
  assert.doesNotMatch(result.mock.status_report.assignmentNotice, /överlämnades|gjordes en genomgång/)
  assert.doesNotMatch(JSON.stringify(result), /Live draft scope/)
})

test('accepted STATUS without valid frozen confirmation fails closed instead of reverting to live data', async () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => { f.rows.assignment_confirmation_snapshots = [] },
    (f: ReturnType<typeof fixture>) => { f.rows.assignment_confirmation_snapshots[0].snapshot_payload.assignment.scope_description = '' },
    (f: ReturnType<typeof fixture>) => { f.rows.assignment_confirmation_snapshots[0].snapshot_payload.assignment.org_id = 'foreign-org' },
    (f: ReturnType<typeof fixture>) => { f.rows.assignments[0].org_id = null },
    (f: ReturnType<typeof fixture>) => { f.rows.assignments[0].org_id = 'foreign-org' },
    (f: ReturnType<typeof fixture>) => { f.rows.assignment_confirmation_snapshots[0].snapshot_payload.terms.text = 'Tampered terms' },
  ]) {
    const f = fixture()
    mutation(f)
    await assert.rejects(loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' }), /uppdragsbekräftelse.*statusbesiktning[\s\S]*Inget utlåtande skapas/i)
  }
})

test('STB query failures prevent an incomplete report instead of silently losing recommendations', async () => {
  const original = console.error
  console.error = () => {}
  try {
    for (const table of ['inspection_control_items', 'settings_exterior_items', 'ob_property_snapshot']) {
      const f = fixture(true, table)
      await assert.rejects(loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' }), /Inget ofullständigt utlåtande skapas/)
    }
  } finally { console.error = original }
})

test('STB apartment report takes identity from the inspection snapshot, not mutable assignment fields', async () => {
  const f = fixture()
  f.rows.ob_property_snapshot = [{ inspection_id: 'inspection', object_type: 'apartment',
    brf_name: 'BRF Fryst objekt', apartment_number: '1203', apartment_holder_name: 'Inspektionsinnehavare' }]
  Object.assign(f.rows.assignments[0], { brf_name: 'Ändrad levande BRF', apartment_number: '9999',
    apartment_holder_name: 'Ändrad levande innehavare', assignment_details: { objectType: 'property' } })
  const result = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(result.mock.inspections.side, 'status')
  assert.equal(result.mock.properties.object_type, 'apartment')
  assert.equal(result.mock.properties.brf_name, 'BRF Fryst objekt')
  assert.equal(result.mock.properties.apartment_number, '1203')
  assert.equal(result.mock.properties.apartment_holder_name, 'Inspektionsinnehavare')
  assert.doesNotMatch(JSON.stringify(result), /Ändrad levande|9999/)
  assert.equal(result.mock.status_report.source.version, '2026.2')
  assert.equal(result.mock.inspections.scope_text, 'Endast badrummet på plan 1.')
  assert.ok(result.mock.interior.blocks.some((block: Row) => block.recommendationText === 'Kontrollera dokumentationen.'))
  assert.match(f.calls.find(call => call.table === 'ob_property_snapshot')!.select,
    /object_type, brf_name, apartment_number, apartment_holder_name/)
})

test('new STB archive supplies apartment identity when the inspection has no explicit object type', async () => {
  const f = fixture()
  Object.assign(f.rows.assignment_confirmation_snapshots[0].snapshot_payload.assignment, {
    assignment_details: { objectType: 'apartment' }, brf_name: 'BRF Arkivet', apartment_number: '1102',
    apartment_holder_name: 'Arkiverad innehavare',
  })
  Object.assign(f.rows.assignments[0], { assignment_details: { objectType: 'property' }, brf_name: 'Mutable BRF' })
  const result = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(result.mock.properties.object_type, 'apartment')
  assert.equal(result.mock.properties.brf_name, 'BRF Arkivet')
  assert.equal(result.mock.properties.apartment_number, '1102')
  assert.equal(result.mock.properties.apartment_holder_name, 'Arkiverad innehavare')
  assert.doesNotMatch(JSON.stringify(result), /Mutable BRF/)
})

test('legacy and direct STB object identity cannot be inferred from mutable assignment details', async () => {
  const f = fixture()
  Object.assign(f.rows.assignments[0], { assignment_details: { objectType: 'apartment' }, brf_name: 'Mutable BRF' })
  const legacy = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(legacy.mock.properties.object_type, 'property')
  assert.equal(legacy.mock.properties.brf_name, '')
  f.rows.assignments = []
  f.rows.assignment_confirmation_snapshots = []
  f.rows.ob_property_snapshot = [{ inspection_id: 'inspection', object_type: 'apartment',
    brf_name: 'Direkt objekt', apartment_number: '1001', apartment_holder_name: '' }]
  const direct = await loadBuilder(f.db)({ propertyId: 'property', inspectionId: 'inspection' })
  assert.equal(direct.mock.inspections.side, 'status')
  assert.equal(direct.mock.properties.object_type, 'apartment')
  assert.equal(direct.mock.properties.apartment_number, '1001')
  assert.doesNotMatch(direct.mock.status_report.assignmentNotice, /överlämnades|gjordes en genomgång/)
})
